/**
 * Safety rules for talking to the real chatbot. The platform must never send test traffic to
 * production or to a real clinic.
 */

/** The only Firebase projects the runner may target. */
export const ALLOWED_PROJECTS = ['salud-stage'] as const;

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardError';
  }
}

export interface GuardInput {
  projectId: string;
  /** project_id inside the service-account JSON. */
  credentialsProjectId: string | undefined;
  webhookUrl: string;
  orgId: string;
}

export const assertSafeTarget = (input: GuardInput): void => {
  const { projectId, credentialsProjectId, webhookUrl, orgId } = input;

  if (!(ALLOWED_PROJECTS as readonly string[]).includes(projectId)) {
    throw new GuardError(
      `Project «${projectId}» is not allowed. The platform only runs against: ${ALLOWED_PROJECTS.join(', ')}.`
    );
  }
  if (credentialsProjectId !== projectId) {
    throw new GuardError(
      `The service-account key belongs to «${credentialsProjectId ?? 'unknown'}», not to «${projectId}».`
    );
  }

  let url: URL;
  try {
    url = new URL(webhookUrl);
  } catch {
    throw new GuardError(`The webhook URL «${webhookUrl}» is not a valid URL.`);
  }
  const host = url.hostname;
  if (url.protocol !== 'https:') {
    throw new GuardError('The webhook URL must start with https://');
  }
  if (!host.endsWith('.cloudfunctions.net') && !host.endsWith('.run.app')) {
    throw new GuardError(`The webhook URL host «${host}» is not a Google Cloud Functions address.`);
  }
  if (/prod/i.test(webhookUrl)) {
    throw new GuardError('The webhook URL looks like production. Refusing to run.');
  }
  if (host.endsWith('.cloudfunctions.net') && !host.includes(projectId)) {
    throw new GuardError(`The webhook URL does not belong to «${projectId}».`);
  }

  if (!orgId.trim()) {
    throw new GuardError('The QA clinic (organization id) is not set.');
  }
};
