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

/** The Google domain of the accounts allowed to read salud-stage. */
export const ALLOWED_ACCOUNT_DOMAIN = 'prestobots.com';

export interface SafeTargetInput {
  projectId: string;
  webhookUrl: string;
  orgId: string;
}

/** The admin must be signed in with Google, with a prestobots.com account. */
export const assertSafeAccount = (email: string | undefined): void => {
  if (!email) {
    throw new GuardError('Not signed in. Sign in with Google in Settings to use the real bot.');
  }
  if (!email.toLowerCase().endsWith(`@${ALLOWED_ACCOUNT_DOMAIN}`)) {
    throw new GuardError(`Sign in with your ${ALLOWED_ACCOUNT_DOMAIN} account (you used ${email}).`);
  }
};

/** Every rule, before any read from Firestore or message to the webhook: account first, then target. */
export const assertStageAccess = (target: SafeTargetInput, email: string | undefined): void => {
  assertSafeAccount(email);
  assertSafeTarget(target);
};

export const assertSafeTarget = (input: SafeTargetInput): void => {
  const { projectId, webhookUrl, orgId } = input;

  if (!(ALLOWED_PROJECTS as readonly string[]).includes(projectId)) {
    throw new GuardError(
      `Project «${projectId}» is not allowed. The platform only runs against: ${ALLOWED_PROJECTS.join(', ')}.`
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
