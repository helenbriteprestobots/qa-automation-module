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
  STAGE_SERVICE_ACCOUNT_FILE: optional,
  STAGE_QA_ORG_ID: optional,
  STAGE_WEBHOOK_URL: optional,
  TEST_PATIENT_PHONE: optional,
  TEST_PATIENT_NAME: z.string().default('QA Paciente'),
  TEST_RESET_MESSAGE: optional,
  REPLY_TIMEOUT_SECONDS: z.coerce.number().positive().default(45),
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

export const config = {
  mode: env.CHATBOT_MODE,
  port: env.PORT,
  databaseFile: resolve(APP_ROOT, env.DATABASE_FILE),
  webDist: resolve(APP_ROOT, 'apps/web/dist'),
  production: process.env.NODE_ENV === 'production',
  stage: {
    projectId: env.STAGE_PROJECT_ID,
    serviceAccountFile: env.STAGE_SERVICE_ACCOUNT_FILE
      ? resolve(APP_ROOT, env.STAGE_SERVICE_ACCOUNT_FILE)
      : undefined,
    orgId: env.STAGE_QA_ORG_ID,
    webhookUrl: env.STAGE_WEBHOOK_URL,
    patientPhone: env.TEST_PATIENT_PHONE,
    patientName: env.TEST_PATIENT_NAME,
    resetMessage: env.TEST_RESET_MESSAGE,
    replyTimeoutMs: env.REPLY_TIMEOUT_SECONDS * 1000,
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

/** Plain-words list of settings missing for stage mode. Empty when complete. */
export const missingStageSettings = (stage: Config['stage']): string[] => {
  const missing: string[] = [];
  if (!stage.serviceAccountFile) missing.push('STAGE_SERVICE_ACCOUNT_FILE (read-only key for salud-stage)');
  else if (!existsSync(stage.serviceAccountFile)) {
    missing.push(`The key file ${stage.serviceAccountFile} does not exist`);
  }
  if (!stage.orgId) missing.push('STAGE_QA_ORG_ID (the QA clinic)');
  if (!stage.webhookUrl) missing.push('STAGE_WEBHOOK_URL (the chatbot webhook address)');
  if (!stage.patientPhone) missing.push('TEST_PATIENT_PHONE (the test patient phone number)');
  return missing;
};
