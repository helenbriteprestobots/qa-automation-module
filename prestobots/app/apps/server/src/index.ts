import { DemoChannel, STARTER_TEST_CASES, StageChannel } from '@ctp/runner';
import type { PlatformStatus } from '@ctp/shared';

import { createAiFacade } from './ai.ts';
import { buildApp } from './app.ts';
import { config, missingStageSettings } from './config.ts';
import { Store } from './db.ts';
import { JiraClient, parseJiraSettings } from './jira/client.ts';
import { createJiraService } from './jira/service.ts';
import { type ChannelFactory, RunManager } from './runManager.ts';

const store = new Store(config.databaseFile);

if (store.countTestCases() === 0) {
  STARTER_TEST_CASES.forEach((testCase) => store.saveTestCase(testCase));
  console.log(`Loaded ${STARTER_TEST_CASES.length} starter test cases.`);
}

const stage = config.stage;

const channelFactory: ChannelFactory =
  config.mode === 'demo'
    ? async () => new DemoChannel()
    : async () => {
        const missing = missingStageSettings(stage);
        if (missing.length > 0) throw new Error(`Missing settings: ${missing.join('; ')}`);
        return StageChannel.create({
          projectId: stage.projectId,
          serviceAccountFile: stage.serviceAccountFile!,
          orgId: stage.orgId!,
          webhookUrl: stage.webhookUrl!,
          patientPhone: stage.patientPhone!,
          patientName: stage.patientName,
          resetMessage: stage.resetMessage,
          replyTimeoutMs: stage.replyTimeoutMs,
        });
      };

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

/** Checks the connection to salud-stage at most once a minute. */
type BaseStatus = Omit<PlatformStatus, 'activeRunId' | 'ai' | 'jira'>;
let stageCheck: { at: number; status: BaseStatus } | null = null;

const status = async (): Promise<BaseStatus> => {
  if (config.mode === 'demo') {
    return {
      mode: 'demo',
      target: defaultTarget,
      ready: true,
      problems: [],
      notes: ['Demo mode: tests talk to a simulated bot. Set CHATBOT_MODE=stage in .env to test the real chatbot.'],
    };
  }

  if (stageCheck && Date.now() - stageCheck.at < 60_000) return stageCheck.status;

  const notes: string[] = [];
  if (!stage.resetMessage) {
    notes.push('No reset message is set: each test continues the test patient\'s existing conversation.');
  }
  const missing = missingStageSettings(stage);
  let result: BaseStatus;
  if (missing.length > 0) {
    result = { mode: 'stage', target: defaultTarget, ready: false, problems: missing.map((m) => `Missing: ${m}`), notes };
  } else {
    try {
      const channel = await channelFactory();
      await channel.dispose?.();
      result = { mode: 'stage', target: channel.target, ready: true, problems: [], notes };
    } catch (error) {
      result = { mode: 'stage', target: defaultTarget, ready: false, problems: [(error as Error).message], notes };
    }
  }
  stageCheck = { at: Date.now(), status: result };
  return result;
};

const app = await buildApp({
  store,
  runs,
  status,
  ai,
  jira,
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
  await app.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
