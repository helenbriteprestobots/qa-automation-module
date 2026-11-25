import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { type GoogleSession, googleSessionSchema } from '@ctp/shared';

export type SessionRead = { session: GoogleSession } | { missing: true } | { damaged: true };

/**
 * The admin's Google sign-in, in one file only the owner can read. Its contents never leave the
 * server: no API response, log or Jira card includes them.
 */
export class SessionStore {
  constructor(private readonly file: string) {}

  read(): SessionRead {
    if (!existsSync(this.file)) return { missing: true };
    try {
      const parsed = googleSessionSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
      return parsed.success ? { session: parsed.data } : { damaged: true };
    } catch {
      return { damaged: true };
    }
  }

  /** The saved session, or undefined when missing or damaged. */
  session(): GoogleSession | undefined {
    const read = this.read();
    return 'session' in read ? read.session : undefined;
  }

  /** Writes to a temporary file first, so a crash never leaves half a session behind. */
  save(session: GoogleSession): void {
    const folder = dirname(this.file);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    chmodSync(folder, 0o700);
    const temp = join(folder, `.google-session-${randomUUID()}.tmp`);
    writeFileSync(temp, JSON.stringify(googleSessionSchema.parse(session), null, 2), { mode: 0o600 });
    renameSync(temp, this.file);
    chmodSync(this.file, 0o600);
  }

  remove(): void {
    rmSync(this.file, { force: true });
  }
}
