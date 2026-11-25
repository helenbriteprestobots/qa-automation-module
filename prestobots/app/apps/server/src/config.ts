import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

/** The `app/` folder. Relative paths in `.env` are resolved from here. */
export const APP_ROOT = resolve(import.meta.dirname, '../../..');

const envFile = resolve(APP_ROOT, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const optional = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined));

const envSchema = z.object({
  CHATBOT_MODE: z.enum(['demo', 'stage']).default('demo'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_FILE: z.string().default('./data/platform.db'),
  STAGE_PROJECT_ID: z.string().default('salud-stage'),
  STAGE_QA_ORG_ID: optional,
  STAGE_WEBHOOK_URL: optional,
  TEST_PATIENT_PHONE: optional,
  TEST_PATIENT_NAME: z.string().default('QA Paciente'),
  TEST_RESET_MESSAGE: optional,
  REPLY_TIMEOUT_SECONDS: z.coerce.number().positive().default(45),
  GOOGLE_OAUTH_CLIENT_ID: optional,
  GOOGLE_OAUTH_CLIENT_SECRET: optional,
  ANTHROPIC_API_KEY: optional,
  AI_MODEL_AUTHOR: z.string().default('claude-opus-5-5'),
  AI_MODEL_JUDGE: z.string().default('claude-haiku-5-5'),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().min(0).default(20),
  CHATBOT_REPO_DIR: z.string().default('../repos/prestobotsv3-main'),
  JIRA_SITE: optional,
  JIRA_EMAIL: optional,
  JIRA_API_TOKEN: optional,
  JIRA_PROJECT_KEY: optional,
  JIRA_LABELS: optional,
  JIRA_PRIORITY: optional,
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('The .env file has invalid values:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

/**
 * The public OAuth client of firebase-tools (the one `firebase login` and cauce-herramientas use).
 * It ships inside those tools, so it is not a secret. Replaced by GOOGLE_OAUTH_CLIENT_ID/SECRET.
 */
export const FIREBASE_TOOLS_CLIENT = {
  clientId: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  clientSecret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
};

const filled = (value: string | undefined): string | undefined => (value && value.trim() !== '' ? value.trim() : undefined);

/** Which Google sign-in client to use, and whether the old key-file setting is still in .env. */
export const parseGoogleConfig = (
  raw: Record<string, string | undefined>
): { clientId: string; clientSecret: string; legacyKeyFileSet: boolean } => {
  const clientId = filled(raw.GOOGLE_OAUTH_CLIENT_ID);
  const clientSecret = filled(raw.GOOGLE_OAUTH_CLIENT_SECRET);
  const own = clientId && clientSecret ? { clientId, clientSecret } : FIREBASE_TOOLS_CLIENT;
  return { ...own, legacyKeyFileSet: Boolean(filled(raw.STAGE_SERVICE_ACCOUNT_FILE)) };
};

const google = parseGoogleConfig(process.env);

export const config = {
  mode: env.CHATBOT_MODE,
  port: env.PORT,
  databaseFile: resolve(APP_ROOT, env.DATABASE_FILE),
  webDist: resolve(APP_ROOT, 'apps/web/dist'),
  production: process.env.NODE_ENV === 'production',
  stage: {
    projectId: env.STAGE_PROJECT_ID,
    orgId: env.STAGE_QA_ORG_ID,
    webhookUrl: env.STAGE_WEBHOOK_URL,
    patientPhone: env.TEST_PATIENT_PHONE,
    patientName: env.TEST_PATIENT_NAME,
    resetMessage: env.TEST_RESET_MESSAGE,
    replyTimeoutMs: env.REPLY_TIMEOUT_SECONDS * 1000,
  },
  google: {
    clientId: google.clientId,
    clientSecret: google.clientSecret,
    /** The admin's saved Google sign-in. Inside secrets/, which git ignores. */
    sessionFile: resolve(APP_ROOT, 'secrets/google-session.json'),
    /** STAGE_SERVICE_ACCOUNT_FILE is still set: it is no longer used (FR-8). */
    legacyKeyFileSet: google.legacyKeyFileSet,
  },
  ai: {
    apiKey: env.ANTHROPIC_API_KEY,
    models: { author: env.AI_MODEL_AUTHOR, judge: env.AI_MODEL_JUDGE },
    defaultBudgetUsd: env.AI_MONTHLY_BUDGET_USD,
  },
  /** Local copy of the chatbot code, read only to find the WhatsApp booking form. Optional. */
  chatbotRepoDir: resolve(APP_ROOT, env.CHATBOT_REPO_DIR),
  jira: {
    site: env.JIRA_SITE,
    email: env.JIRA_EMAIL,
    apiToken: env.JIRA_API_TOKEN,
    projectKey: env.JIRA_PROJECT_KEY,
    labels: env.JIRA_LABELS,
    priority: env.JIRA_PRIORITY,
  },
};

export type Config = typeof config;

export interface StageSettingsProblem {
  message: string;
  fix: string;
}

/** What is missing or wrong in the stage settings of `.env`. Empty when complete. */
export const stageSettingsProblems = (stage: {
  orgId?: string;
  webhookUrl?: string;
  patientPhone?: string;
}): StageSettingsProblem[] => {
  const problems: StageSettingsProblem[] = [];
  if (!stage.orgId) {
    problems.push({
      message: 'STAGE_QA_ORG_ID (the QA clinic) is not set in .env.',
      fix: 'Add STAGE_QA_ORG_ID=testing-macena-gupshup-v3-qa to app/.env and restart the platform.',
    });
  }
  if (!stage.webhookUrl) {
    problems.push({
      message: 'STAGE_WEBHOOK_URL (the chatbot webhook address) is not set in .env.',
      fix: 'Ask the developers for the webhookGupshupMessages address on salud-stage, add it to app/.env and restart.',
    });
  }
  if (!stage.patientPhone) {
    problems.push({
      message: 'TEST_PATIENT_PHONE (the test patient phone number) is not set in .env.',
      fix: 'Add the test phone to app/.env (digits only, with country code) and restart the platform.',
    });
  } else if (!/^\d{10,15}$/.test(stage.patientPhone)) {
    problems.push({
      message: `TEST_PATIENT_PHONE «${stage.patientPhone}» must be 10–15 digits, with country code and no + or spaces.`,
      fix: 'Write it like 5492611234567 in app/.env and restart the platform.',
    });
  }
  return problems;
};
