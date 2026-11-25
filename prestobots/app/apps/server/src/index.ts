import { DemoChannel, STARTER_TEST_CASES, SignInExpiredError, StageChannel } from '@ctp/runner';

import { createAiFacade } from './ai.ts';
import { buildApp } from './app.ts';
import { config, stageSettingsProblems } from './config.ts';
import { Store } from './db.ts';
import { SessionStore } from './google/sessionStore.ts';
import { GoogleSignIn } from './google/signIn.ts';
import { JiraClient, parseJiraSettings } from './jira/client.ts';
import { GenerationManager } from './generation/generationManager.ts';
import { createJiraService } from './jira/service.ts';
import { type ChannelFactory, RunManager } from './runManager.ts';
import { StageService, TEST_MESSAGE_BUSY } from './stage/stageService.ts';

const store = new Store(config.databaseFile);

if (store.countTestCases() === 0) {
  STARTER_TEST_CASES.forEach((testCase) => store.saveTestCase(testCase));
  console.log(`Loaded ${STARTER_TEST_CASES.length} starter test cases.`);
}

const stage = config.stage;

const sessions = new SessionStore(config.google.sessionFile);

/** A read-only connection to the real bot, signed in as the admin. */
const createStageChannel = async (options: { resetMessage?: string } = {}): Promise<StageChannel> => {
  const problems = stageSettingsProblems(stage);
  if (problems.length > 0) throw new Error(problems.map((p) => p.message).join(' '));
  try {
    return await StageChannel.create({
      projectId: stage.projectId,
      google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret, session: sessions.session() },
      orgId: stage.orgId!,
      webhookUrl: stage.webhookUrl!,
      patientPhone: stage.patientPhone!,
      patientName: stage.patientName,
      resetMessage: options.resetMessage ?? stage.resetMessage,
      replyTimeoutMs: stage.replyTimeoutMs,
      isSignedIn: () => sessions.session() !== undefined,
    });
  } catch (error) {
    if (error instanceof SignInExpiredError) stageService.invalidate();
    throw error;
  }
};

const stageService = new StageService({
  mode: config.mode,
  stage,
  sessions,
  legacyKeyFileSet: config.google.legacyKeyFileSet,
  connect: createStageChannel,
  busyElsewhere: () => {
    const run = runs.activeRunId();
    if (run) return `Run #${run} is using the chatbot. Wait for it to finish or cancel it.`;
    const generation = generations.activeId();
    return generation ? `"Generate test cases" (#${generation}) is using the chatbot. Wait for it to finish or cancel it.` : null;
  },
});

const googleSignIn = new GoogleSignIn({
  clientId: config.google.clientId,
  clientSecret: config.google.clientSecret,
  port: config.port,
  projectId: stage.projectId,
  sessions,
  onSignedIn: () => stageService.invalidate(),
});

const channelFactory: ChannelFactory = config.mode === 'demo' ? async () => new DemoChannel() : () => createStageChannel();

const defaultTarget =
  config.mode === 'demo'
    ? 'Demo bot (simulated, not the real chatbot)'
    : `${stage.projectId} · ${stage.orgId ?? 'QA clinic not set'}`;

const ai = createAiFacade({
  store,
  apiKey: config.ai.apiKey,
  models: config.ai.models,
  defaultBudgetUsd: config.ai.defaultBudgetUsd,
  mode: config.mode,
});

const jiraSettings = parseJiraSettings(config.jira);
const jira = createJiraService({
  store,
  ai,
  client: jiraSettings.settings ? new JiraClient(jiraSettings.settings) : undefined,
  status: {
    configured: Boolean(jiraSettings.settings),
    site: jiraSettings.site,
    projectKey: jiraSettings.settings?.projectKey ?? config.jira.projectKey?.toUpperCase(),
    labels: jiraSettings.labels,
    priority: config.jira.priority,
    problems: jiraSettings.problems,
  },
});

const runs = new RunManager(store, channelFactory, config.mode, defaultTarget, () => ai.forRuns());
runs.recoverInterrupted();

const generations = new GenerationManager(store, channelFactory, config.mode, ai, runs, {
  chatbotRepoDir: config.chatbotRepoDir,
});
generations.recoverInterrupted();
runs.setBlocker(() => {
  if (stageService.busy()) return TEST_MESSAGE_BUSY;
  const active = generations.activeId();
  return active ? `"Generate test cases" (#${active}) is using the chatbot. Wait for it to finish or cancel it.` : null;
});
generations.setBlocker(() => (stageService.busy() ? TEST_MESSAGE_BUSY : null));

const app = await buildApp({
  store,
  runs,
  status: () => stageService.status(),
  ai,
  jira,
  generations,
  google: { signIn: googleSignIn, sessions, onSignedOut: () => stageService.invalidate() },
  stage: stageService,
  webDist: config.production ? config.webDist : undefined,
  logger: false,
});

await app.listen({ port: config.port, host: '127.0.0.1' });
console.log(
  `Chatbot Testing Platform (${config.mode} mode) ready on http://localhost:${config.port}` +
    (config.production ? '' : '  ·  web page: http://localhost:5173')
);

const shutdown = async (): Promise<void> => {
  const active = runs.activeRunId();
  if (active) runs.cancel(active);
  const generation = generations.activeId();
  if (generation) generations.cancel(generation);
  await app.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
