# Technical plan — Spec 001: Real bot access with Google sign-in

- **Spec:** [spec.md](./spec.md)
- **Date:** 2026-11-23

## Summary
The server gets a Google OAuth "installed app" flow: loopback redirect plus PKCE, with the `openid email cloud-platform` scopes (FR-10: the firebase-tools client refuses `datastore`). The session (email + refresh token) is stored in `app/secrets/google-session.json`. The runner stops using firebase-admin: `StageChannel` reads salud-stage through a small **Firestore REST client over `fetch`**, authenticated by a refresh-token access-token provider. Every Google request goes through one **Google guard**, which only allows the three Google hosts and project `salud-stage` (FR-10). The current stage guard is split into a target rule set and an account rule set, both enforced before any read or send (FR-9). A server-side `StageService` runs the six connection checks with a cache, and also sends the "test hola". It shares the "chatbot busy" rule with runs and generations. The Settings page gets a "Real bot (salud-stage)" card.

## Module structure
**packages/shared**
- `packages/shared/src/google.ts` (new): `googleSessionSchema` / `GoogleSession`, `stageCheckSchema` / `StageCheck`, `StageChecks`, `StageCheckId`, `TestMessageResult`, `GOOGLE_SIGN_IN_ERRORS` (the 5 reason codes) (FR-2, FR-13, FR-17, FR-22).
- `packages/shared/src/index.ts` (modified): re-exports `google.ts`.

**packages/runner**
- `packages/runner/src/stage/googleGuard.ts` (new): `GOOGLE_SCOPES`, `assertGoogleRequest(url, projectId)`, `guardedFetch(fetchImpl, projectId)` (FR-10).
- `packages/runner/src/stage/googleToken.ts` (new): `SignInExpiredError`, `createAccessTokenProvider({ clientId, clientSecret, refreshToken, fetch, now })`. It caches the token, refreshes it 60 s before expiry and maps `invalid_grant` to `SignInExpiredError` (FR-11).
- `packages/runner/src/stage/firestoreRest.ts` (new): `FirestoreRest` class (`getDocument(path, fieldMask)`, `runQuery(parent, structuredQuery)`), `decodeFields` (REST `Value` → plain JS, timestamps → ISO strings), `ReadAccessError` (403), `FirestoreUnavailableError` (other failures) (FR-8, FR-12, FR-14).
- `packages/runner/src/stage/guard.ts` (modified): `assertSafeTarget({ projectId, webhookUrl, orgId })` drops `credentialsProjectId`. It adds `assertSafeAccount(email | undefined)`, which requires a session and a verified `@prestobots.com` email, and `assertStageAccess(target, email)`, which runs the account rules first, then the target rules (FR-9).
- `packages/runner/src/stage/stageChannel.ts` (modified): uses `FirestoreRest` + token provider instead of firebase-admin. `StageChannelConfig` replaces `serviceAccountFile` with `google: { clientId, clientSecret, session: GoogleSession }` plus an optional `fetch`. Adds `StageChannel.readClinic()` (FR-13 checks 5–6), `fatal()` (FR-11) and `StageSession.lastAcceptedAt()` (FR-17). The webhook error text becomes "The bot did not accept the message (HTTP …)" (FR-18).
- `packages/runner/src/channels/types.ts` (modified): optional `ChatChannel.fatal?(): string | undefined` (FR-11).
- `packages/runner/src/index.ts` (modified): exports the new modules.
- `packages/runner/package.json` (modified): removes `firebase-admin`.

**apps/server**
- `apps/server/src/config.ts` (modified): removes `STAGE_SERVICE_ACCOUNT_FILE` from the schema and adds `legacyKeyFileSet` (FR-8). Adds `GOOGLE_OAUTH_CLIENT_ID/SECRET` → `config.google` = `{ clientId, clientSecret, sessionFile }`, defaulting to the firebase-tools client (FR-7). Replaces `missingStageSettings` with `stageSettingsProblems(stage)`, which includes the phone format (FR-13 check 1).
- `apps/server/src/google/sessionStore.ts` (new): `SessionStore` (`read(): { session } | { damaged: true } | { missing: true }`, `save(session)` (atomic temp + rename, mode 0600, folder 0700), `remove()`) (FR-2, FR-6, FR-21, FR-22).
- `apps/server/src/google/signIn.ts` (new): `GoogleSignIn`: `start(from)` → consent URL, `finish(query)` → `{ email }` or a reason code. Keeps an in-memory single-use `state` map with a 10 min TTL (injected `now`), uses PKCE S256, checks the origin allow-list, decodes the `id_token`, and applies the domain and verified-email rules (FR-1–FR-5, FR-7, FR-10).
- `apps/server/src/stage/stageService.ts` (new): `StageService`: `checks({ fresh })` with a 60 s cache and `invalidate()`, `busy()`, `sendTestMessage()`, `StageTestConflictError` (409), `StageTestFailedError` (502) (FR-11–FR-20).
- `apps/server/src/app.ts` (modified): routes `GET /api/google/sign-in`, `GET /api/google/callback`, `POST /api/google/sign-out`, `GET /api/stage/checks`, `POST /api/stage/test-message`. New `AppDeps.google` and `AppDeps.stage`, and the error mapping for the new errors (FR-1–FR-6, FR-13, FR-17–FR-20).
- `apps/server/src/index.ts` (modified): wires `SessionStore`, `GoogleSignIn`, `StageService` and the channel factory (session read on every run). `status()` comes from `stage.checks()`. The run blocker and the generation blocker include `stage.busy()` (FR-8, FR-15, FR-20).
- `apps/server/src/runManager.ts` (modified): after each test, `channel.fatal?.()`. If it is set, the remaining tests are saved as `skipped` with that message (FR-11).
- `apps/server/src/generation/generationManager.ts` (modified): `setBlocker(() => string | null)`, checked in `assertCanUseChatbot` (FR-20).

**apps/web**
- `apps/web/src/stageSettings.ts` (new): pure helpers `signInNotice(search: string)` (reason code → message, FR-2–FR-5) and `checkSymbol(state)` (FR-13).
- `apps/web/src/components/RealBotCard.tsx` (new): the "Real bot (salud-stage)" card: account line, Sign in/Sign out, check list, "Check again", "Send test hola" and its result (FR-1, FR-6, FR-13, FR-16, FR-17, FR-18).
- `apps/web/src/pages/SettingsPage.tsx` (modified): renders `RealBotCard` above the AI card and updates the subtitle.
- `apps/web/src/api.ts` (modified): `stageChecks(fresh)`, `signOut()`, `sendTestMessage()`.

**Docs**
- `app/.env.example`, `app/README.md`, `docs/architecture.md` (modified): Google sign-in replaces the key file, firebase-admin is gone, new modules.

## Data model
No SQLite changes. New file `app/secrets/google-session.json` (mode 0600, inside the git-ignored `secrets/`):
```json
{ "email": "juan@prestobots.com", "refreshToken": "1//0g…", "scopes": ["openid", "email", "https://www.googleapis.com/auth/cloud-platform"], "signedInAt": "2026-11-23T15:04:05.000Z" }
```
`googleSessionSchema = z.object({ email: z.string().email(), refreshToken: z.string().min(1), scopes: z.array(z.string()), signedInAt: z.string().datetime() })`. A file that fails this schema or `JSON.parse` counts as damaged (FR-22).

Shared API types:
```ts
type StageCheckId = 'settings' | 'guard' | 'signedIn' | 'domain' | 'readAccess' | 'clinic';
type StageCheck = { id: StageCheckId; label: string; state: 'passed' | 'failed' | 'skipped'; message: string; fix?: string };
type StageChecks = { ready: boolean; account: { email: string } | null; checks: StageCheck[] }; // always 6 checks, in order
type TestMessageResult = { sent: ChatMessage; replies: ChatMessage[]; replySeconds: number };
const GOOGLE_SIGN_IN_ERRORS = ['expired-state', 'cancelled', 'exchange-failed', 'wrong-domain', 'unverified-email'] as const;
```
Invariant: `ready === checks.every(c => c.state === 'passed')` (FR-15).

## Contracts
HTTP (all JSON unless noted; no response ever contains `refreshToken` or an access token, FR-21):
- `GET /api/google/sign-in?from=<origin>` → `302 Location: https://accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=http://127.0.0.1:<PORT>/api/google/callback&response_type=code&scope=openid%20email%20https://www.googleapis.com/auth/cloud-platform&state=<32 hex>&code_challenge=<S256>&code_challenge_method=S256&access_type=offline&prompt=consent`.
- `GET /api/google/callback?code=…&state=…` (or `?error=access_denied&state=…`) → `302 <origin>/settings?google=signed-in`, or `302 <origin>/settings?google=error&reason=<code>` (plus `&email=<email>` for `wrong-domain` and `unverified-email`, so the FR-5 text can name the account). When the state is unknown, `<origin>` is `http://localhost:<PORT>`.
- `POST /api/google/sign-out` → `200 { signedIn: false }`.
- `GET /api/stage/checks[?fresh=1]` → `200 StageChecks`.
- `POST /api/stage/test-message` → `200 TestMessageResult`; `409 { error }` (FR-19); `502 { error }` (FR-18).
- `POST /api/runs`, `POST /api/test-cases/trial` and `POST /api/generations` → `409 { error: "A test message is waiting for the bot's reply. Try again in a few seconds." }` while a test hola is in progress (FR-20).
- `GET /api/status`: shape unchanged. In stage mode, `ready = checks.ready`, `problems` = `message` (+ ` ${fix}`) of each failed check, and `target` = the clinic target when check 6 passes.

Cross-module signatures:
```ts
// runner
export const GOOGLE_SCOPES: readonly string[];
export const assertGoogleRequest: (url: string, projectId: string) => void;          // throws GuardError
export const guardedFetch: (fetchImpl: typeof fetch, projectId: string) => typeof fetch;
export class SignInExpiredError extends StepError {}                                   // message per FR-11
export const createAccessTokenProvider: (o: { clientId: string; clientSecret: string; refreshToken: string; projectId: string; fetch?: typeof fetch; now?: () => number }) => { token(): Promise<string>; expired(): boolean };
export const assertSafeAccount: (email: string | undefined) => void;
export const assertStageAccess: (target: SafeTargetInput, email: string | undefined) => void;
StageChannel.create(config: StageChannelConfig): Promise<StageChannel>;  // runs assertStageAccess first, then readClinic()
StageChannel.readClinic(): Promise<{ name: string; appName: string }>;   // throws ReadAccessError | FirestoreUnavailableError | StepError(no clinic / no app) | SignInExpiredError
StageChannel.fatal(): string | undefined;
// server
class StageService { checks(o?: { fresh?: boolean }): Promise<StageChecks>; invalidate(): void; busy(): boolean; sendTestMessage(): Promise<TestMessageResult>; }
class GoogleSignIn { start(from: string | undefined): string; finish(q: { code?: string; state?: string; error?: string }): Promise<{ origin: string; email: string } | { origin: string; reason: GoogleSignInError }>; }
```

UI, Settings page, card "Real bot (salud-stage)" (see the spec's User-facing behavior):
- Account line: "Signed in as <email>" + [Sign out], or "Not signed in" + [Sign in with Google] (a link to `/api/google/sign-in?from=${location.origin}`).
- A notice from `?google=`: signed-in → "Signed in as <email>". Each error code → the FR-3/FR-4/FR-5 message. Unknown code → "Sign-in failed. Try again."
- Six rows: ✔ passed / ✘ failed + fix / – skipped. [Check again] calls `?fresh=1`.
- In demo mode: the note "Only needed for the real bot (CHATBOT_MODE=stage)".
- [Send test hola], disabled unless `ready`. While waiting it shows "Waiting for the bot…". Afterwards: `You: hola`, then `Bot (4.2 s): <text> [option] [option]`, or the error text.

## Key algorithms and flows
**Sign-in (FR-1–FR-5, FR-7, FR-10)**
1. `start(from)`: if `from` matches `^http://(localhost|127\.0\.0\.1):(<PORT>|5173)$`, the origin is `from`; otherwise it is `http://localhost:<PORT>`. Create `state` (16 random bytes, hex) and a PKCE `verifier` (32 random bytes, base64url), then store `{ origin, verifier, at: now() }`. Drop entries older than 10 min. Build the consent URL, run `assertGoogleRequest` on it, and return it.
2. `finish(q)`: look up and **delete** `state`. If it is missing or older than 10 min → `expired-state` (FR-3). If `q.error` is set → `cancelled` (FR-4).
3. POST `https://oauth2.googleapis.com/token` (`grant_type=authorization_code`, code, verifier, redirect_uri) through `guardedFetch`. If the response is not ok, or has no `refresh_token` or `id_token` → `exchange-failed` (FR-4).
4. Decode the `id_token` payload (base64url JSON, received directly from Google over TLS, so the signature is not checked). If `email_verified !== true` → `unverified-email`. If `!email.toLowerCase().endsWith('@prestobots.com')` → `wrong-domain` (FR-5). Nothing is saved in either case.
5. `sessionStore.save(...)`, `stage.invalidate()`, return `{ origin, email }` (FR-2, FR-15).

**Access token (FR-11)**: `token()` returns the cached token if it is still valid for more than 60 s. Otherwise it POSTs `grant_type=refresh_token`. A 400 with `error=invalid_grant` sets `expired = true` and throws `SignInExpiredError("Your Google sign-in expired. Sign in again in Settings.")`.

**Firestore REST (FR-8, FR-12, FR-14)**: base `https://firestore.googleapis.com/v1/projects/salud-stage/databases/(default)/documents`, with header `Authorization: Bearer <token>`.
- Clinic: `GET {base}/organizations/{org}?mask.fieldPaths=name&mask.fieldPaths=settings.gupshup.appName`. 200 → decode. 404 → `StepError("The QA clinic «org» does not exist in salud-stage.")`. 403 → `ReadAccessError`. 401 → refresh once, then `SignInExpiredError`. Anything else, or a network error → `FirestoreUnavailableError(googleMessage)`.
- Conversation: `POST {base}:runQuery`. The `structuredQuery` has `from: conversations`, a composite AND of `channelIdentifier.channelIdentifierUserId ==`, `lastActivityMessageAt >=`, `organizationId ==` and `channel == 'wsp'`, then `orderBy createdAt DESCENDING`, `limit 1` and `select: [__name__]`. These are the same filters as today, so the same index serves them.
- Messages: `POST {base}/conversations/{id}:runQuery` with `from: messages`, `createdAt >= timestampValue` and `orderBy createdAt ASCENDING`. Each document is decoded and passed to `normalizeFirestoreMessage(id, data)` (which already accepts ISO strings).

**Checks (FR-13–FR-16)**, in `StageService.checks`:
1. `settings`: `stageSettingsProblems(stage)`: org, webhook and phone must be present, and the phone must match `^\d{10,15}$` (fix: "Write it like 5492611234567").
2. `guard`: `assertSafeTarget(...)`. Skipped if 1 failed.
3. `signedIn`: `sessionStore.read()`. Missing → "Not signed in". Damaged → "Not signed in (the saved sign-in was damaged)".
4. `domain`: `assertSafeAccount(session.email)`. Skipped if 3 failed.
5–6. Demo mode → both skipped with the demo note (FR-16). Stage mode, if 1–4 passed: `StageChannel.create(...)` (which calls `readClinic()`), then dispose. The outcome maps as follows:
   - ok → 5 and 6 passed, with message `salud-stage · <name>`;
   - `ReadAccessError` → 5 failed (FR-12), 6 skipped;
   - `SignInExpiredError` → 5 failed (FR-11), 6 skipped, and `invalidate()`;
   - `StepError` (clinic missing, or no Gupshup app) → 5 passed, 6 failed;
   - `FirestoreUnavailableError` → 5 failed (FR-14), 6 skipped, **result not cached**.
   Otherwise 5 and 6 are skipped ("needs the checks above").
7. Cache `{ at, result }` for 60 s unless `fresh`. `invalidate()` clears it (sign-in, sign-out, expiry) (FR-15).

**Test hola (FR-17–FR-20)**:
1. Refuse with `StageTestConflictError` if `busy`, a run or a generation is active, or `checks()` is not `ready`. Then set `busy = true` synchronously, before any `await` (FR-19, FR-20).
2. `channel = channelFactory()`, `session = openSession()`, `const [sent, ...replies] = await session.prepare(signal)`. `prepare` ignores earlier messages, sends `resetMessage ?? 'hola'` and collects replies within `REPLY_TIMEOUT_SECONDS`.
3. A `StepError` from send → `StageTestFailedError(message + " Check STAGE_WEBHOOK_URL with the developers.")`. If no bot or staff reply comes back → `StageTestFailedError("The bot accepted the message but no reply was saved in salud-stage within N s. Check that the QA clinic's bot is on, then try again.")` (FR-18).
4. `replySeconds = max(0, round((Date.parse(firstBotReply.at) - session.lastAcceptedAt()) / 100) / 10)` (FR-17).
5. `finally`: `busy = false`, close the session, dispose the channel.

**Run abort on expiry (FR-11)**: the token provider sets `expired`. After each test, `RunManager.execute` calls `channel.fatal?.()`. `StageChannel.fatal()` returns the FR-11 message when the provider is expired. Every remaining test is saved as `skipped` with `error` = that message, and the run is marked `finished`. Sign-out mid-run: the provider holds the refresh token in memory, so the next token refresh fails. To make sign-out take effect at the next test, the channel factory passes `isSignedIn: () => sessionStore.read() has session`, and `fatal()` checks it too.

## Technical decisions
- **Test-first (TDD)** for every behavior step → constitution art. 6 and AGENTS.md. Each step below lists Red before Green.
- **Firestore REST over `fetch` and removing firebase-admin** → firebase-admin 12.7's Firestore only accepts certificate or ADC credentials (`getFirestoreOptions` throws `invalid-credential` otherwise). REST lets FR-10's guard see every URL. The developer chose this. Rejected: `@google-cloud/firestore` directly (a new direct dependency, gRPC hosts outside the guard) and an ADC temp file (process-wide env, token stored twice).
- **One `guardedFetch` wrapper** used by the token provider, Firestore REST and the sign-in code exchange → FR-10 is enforced in one place. A test for each host and project rule.
- **Split the guard into `assertSafeTarget` + `assertSafeAccount`, combined by `assertStageAccess`** → FR-9 keeps every target rule and replaces the key-file rule. Checks 2 and 4 report the two parts separately (FR-13). Every existing guard test is kept, minus the key-file case, which is replaced by the account cases.
- **Scopes `openid email https://www.googleapis.com/auth/cloud-platform` for every client, in one constant `GOOGLE_SCOPES`** → FR-10. Google refused `datastore` for the firebase-tools client with `Error 403: restricted_client` during the T-15 smoke test. Read-only access comes from the IAM role, and requests are limited by `guardedFetch`. Rejected: a different scope per client (two paths to test; the spec chose one).
- **PKCE S256 + single-use `state` in memory** → best practice for loopback OAuth, and FR-3 (a restart forgets states, which the edge case expects).
- **Email from the `id_token` of the token response** → FR-10 lists only three hosts, and a userinfo call would need a fourth (`openidconnect.googleapis.com`). Rejected: the userinfo endpoint.
- **Origin allow-list `localhost|127.0.0.1` on `<PORT>|5173`, sent as `?from=`** → FR-1. Vite's proxy keeps the browser's host, so the server can't infer the origin from `Host`.
- **The firebase-tools client ID and secret as constants in `config.ts`** → FR-7. They're public (shipped in firebase-tools and cauce-herramientas). They're overridden by `GOOGLE_OAUTH_CLIENT_ID/SECRET`.
- **The session is re-read on every channel creation, never cached in memory** → sign-in and sign-out take effect at the next run or check. FR-22 is checked on every read.
- **Atomic write (temp file + `rename`), `chmod 0600`, folder 0700** → FR-21. A crash never leaves a half-written session.
- **Injected `now` and `fetch`** in `GoogleSignIn`, `createAccessTokenProvider`, `FirestoreRest`, `StageService` and `StageChannel`; the `SessionStore` path points at a temp folder in tests → tests run with no network or keys (spec NFR).
- **Web logic in a pure module** (`stageSettings.ts`), tested with Vitest in the node environment → constitution art. 6 asks for tests of web logic. No jsdom or testing-library dependency. The React card is verified manually.
- **Busy rule:** `StageService.busy` is fed into `RunManager.setBlocker` (combined with the generation blocker) and the new `GenerationManager.setBlocker` → same pattern as today's generation blocker (FR-20).
- **`StepError` message text for webhook failures is aligned with FR-18** ("The bot did not accept the message (HTTP …)").
- The web app keeps its own import style (`'../api'`, no `.ts`), which matches the existing web code.

## Dependencies
None added. **Removed:** `firebase-admin` from `packages/runner/package.json`, and the lockfile is updated with `pnpm install`. Everything else uses Node 22's `fetch` and `node:crypto` plus zod.

## Error handling
| Failure (spec) | Detection | What the admin sees | Logged |
|---|---|---|---|
| Unknown, reused or expired state (FR-3) | `state` not in the map, or older than 10 min | Redirect `reason=expired-state` → FR-3 text | nothing |
| Cancelled on Google (FR-4) | `?error=` on callback | `reason=cancelled` → "You cancelled the Google sign-in. Try again." | nothing |
| Code exchange fails (FR-4) | token response not ok / missing tokens | `reason=exchange-failed` → "Google did not complete the sign-in. Try again." | status code only |
| Wrong domain / unverified email (FR-5) | id_token claims | `wrong-domain` / `unverified-email` → FR-5 text (email shown through `&email=`; the email is not secret) | nothing |
| Request to a non-allowed host/project (FR-10) | `assertGoogleRequest` before `fetch` | `GuardError` text in the failing check or run | nothing |
| Not signed in, damaged file (FR-22) | `SessionStore.read()` | Check 3 failed with text | nothing |
| Refresh token expired/revoked (FR-11) | `invalid_grant` | Check 5 failed; run "Could not connect to the chatbot: Your Google sign-in expired…"; mid-run: current test error, rest skipped | nothing |
| No read access (FR-12) | HTTP 403 | Check 5 failed with the ask-Pachi text | nothing |
| Network / Google 5xx / missing index (FR-14) | other non-ok or `fetch` throws | Check 5 failed "Could not reach salud-stage: <message>", not cached | nothing |
| Webhook not ACK (FR-18) | `body !== 'ACK'` | 502 "The bot did not accept the message (HTTP n: «…»)…" | nothing |
| No reply in time (FR-18) | no bot/staff reply | 502 "The bot accepted the message but no reply…" | nothing |
| Busy / not ready (FR-19, FR-20) | flags | 409 with reason | nothing |
| Legacy key var set (FR-8) | `legacyKeyFileSet` | Status note | nothing |
Tokens never go into error messages: Google's `error_description` is included, but request bodies are not.

## Test strategy
Vitest in each package, no network: a fake `fetch` (a function routing on URL and method that records calls), an injected `now`, and a temp dir (`mkdtempSync`) for the session file. Tests are written before the code in every behavior step.
- `packages/shared/test/google.test.ts`: the session schema accepts the example and rejects a missing token or bad email (FR-22).
- `packages/runner/test/googleGuard.test.ts`: allows the three hosts with the salud-stage path. Refuses http, other hosts, `salud-prod` in the Firestore path, and an unknown project. `guardedFetch` never calls the inner fetch on refusal (FR-10).
- `packages/runner/test/googleToken.test.ts`: caches until 60 s before expiry, refreshes after that, `invalid_grant` → `SignInExpiredError` + `expired()` (FR-11).
- `packages/runner/test/firestoreRest.test.ts`: decodes every Value type, including a nested map/array and a timestamp converted to ISO. Clinic GET with the field mask; 403 → `ReadAccessError`; 404 → StepError; 500 or a thrown fetch → `FirestoreUnavailableError`. The runQuery body for conversations and messages matches today's filters (FR-8, FR-12, FR-14).
- `packages/runner/test/stage.test.ts` (modified): guard cases. The key-file case is replaced by "no session", "gmail account" and "uppercase prestobots accepted". Other cases are unchanged (FR-9).
- `packages/runner/test/stageChannel.test.ts` (new): `create` runs the guard before any fetch, so a `salud-prod` project → zero fetch calls. `create` reads the clinic. `send` returns ACK and `lastAcceptedAt` is set. Non-ACK → FR-18 text. `fatal()` after expiry and after `isSignedIn() === false` (FR-9, FR-11, FR-17, FR-18).
- `apps/server/test/google.test.ts` (new): consent URL params and scopes (FR-1, FR-10). Origin allow-list (FR-1). Success saves the session, mode 0600, redirect to `<origin>/settings?google=signed-in` (FR-2, FR-21). State reused / unknown / 11 min old → `expired-state`, nothing saved (FR-3). `error=access_denied` → `cancelled`; token 400 → `exchange-failed` (FR-4). gmail → `wrong-domain`, `email_verified:false` → `unverified-email`, `Juan@PrestoBots.com` accepted (FR-5). Env override vs default client (FR-7). Sign-out deletes the file (FR-6). The response bodies of every google/stage route don't contain the refresh token (FR-21).
- `apps/server/test/stageChecks.test.ts` (new): every check mapping (FR-12–FR-14). Bad phone → check 1 fails with the example. `salud-prod` → check 2 fails and the fake fetch is never called (FR-9). Damaged file (FR-22). Cache hit within 60 s, `fresh` bypasses it, invalidation on sign-in/sign-out/expiry, FR-14 result not cached (FR-15). Demo mode runs 1–4 and skips 5–6 (FR-16). Legacy env note (FR-8). `/api/status` `ready` only when all six pass (FR-15).
- `apps/server/test/stageTest.test.ts` (new): success with `replySeconds` computed from the fake clock and the `createdAt` values (FR-17). Non-ACK → 502 text; no reply → 502 text (FR-18). Busy/run/generation/not-ready → 409 and zero webhook calls (FR-19). While a test hola waits, `POST /api/runs` and `POST /api/generations` → 409 with the FR-20 text (FR-20).
- `apps/server/test/api.test.ts` (modified): a run whose channel reports `fatal()` after test 1 → test 2 skipped with the message (FR-11). A run started while the session has expired → every result is an error before any send (FR-11).
- `apps/web/test/stageSettings.test.ts` (new): each reason code → its message, an unknown code → generic, signed-in notice (FR-2–FR-5). Check symbol per state (FR-13).
- Spec edge cases → tests above: callback opened twice / after restart (google.test), gmail (google.test), uppercase domain (google.test), damaged file (stageChecks), sign-out mid-run (api.test via `isSignedIn`), revoked token (googleToken + stageChecks), prod readable but not stage (stageChecks 403), `STAGE_PROJECT_ID=salud-prod` (stageChecks), legacy env (stageChecks), demo (stageChecks), double click / run active (stageTest), run during test hola (stageTest), no internet (stageChecks), unexpected origin (google.test), bad phone (stageChecks), 200 non-ACK (stageChannel + stageTest), late replies (stageTest: timeout → no reply).
- **Manual** (Definition of done): with `CHATBOT_MODE=stage`, `TEST_PATIENT_PHONE` set and `pnpm dev`: (1) Settings → Sign in with Google → choose the prestobots.com account → back on :5173 with "Signed in as …"; (2) all six checks ✔; (3) Send test hola → a bot reply with seconds; (4) run one starter test case → passed; (5) Sign out → the checks show "Not signed in". Also visually check the card in demo mode.

## Traceability
| FR | Implemented in | Tested by |
|----|----------------|-----------|
| FR-1 | `apps/server/src/google/signIn.ts`, `apps/web/src/components/RealBotCard.tsx` | `apps/server/test/google.test.ts`: consent URL + origin allow-list |
| FR-2 | `apps/server/src/google/signIn.ts`, `sessionStore.ts`, `apps/web/src/stageSettings.ts` | `google.test.ts`: success saves + redirects; `apps/web/test/stageSettings.test.ts`: signed-in notice |
| FR-3 | `apps/server/src/google/signIn.ts` | `google.test.ts`: reused/unknown/expired state |
| FR-4 | `apps/server/src/google/signIn.ts` | `google.test.ts`: cancelled, exchange-failed |
| FR-5 | `apps/server/src/google/signIn.ts` | `google.test.ts`: wrong-domain, unverified-email, uppercase accepted |
| FR-6 | `apps/server/src/app.ts` (sign-out), `sessionStore.ts` | `google.test.ts`: sign-out deletes file, checks not ready |
| FR-7 | `apps/server/src/config.ts`, `signIn.ts` | `google.test.ts`: env override vs default client id |
| FR-8 | `packages/runner/src/stage/stageChannel.ts`, `firestoreRest.ts`, `apps/server/src/config.ts` | `packages/runner/test/firestoreRest.test.ts`: queries; `stageChecks.test.ts`: legacy env note |
| FR-9 | `packages/runner/src/stage/guard.ts`, `stageChannel.ts` | `packages/runner/test/stage.test.ts`: guard cases; `stageChannel.test.ts`: guard before any fetch |
| FR-10 | `packages/runner/src/stage/googleGuard.ts` | `packages/runner/test/googleGuard.test.ts`; `google.test.ts`: scopes |
| FR-11 | `googleToken.ts`, `stageChannel.ts` (`fatal`), `apps/server/src/runManager.ts`, `stageService.ts` | `googleToken.test.ts`; `stageChannel.test.ts`: fatal; `api.test.ts`: remaining tests skipped / run fails before send |
| FR-12 | `firestoreRest.ts`, `stageService.ts` | `firestoreRest.test.ts`: 403; `stageChecks.test.ts`: ask-Pachi text |
| FR-13 | `apps/server/src/stage/stageService.ts`, `config.ts` (`stageSettingsProblems`) | `stageChecks.test.ts`: order, skip rules, phone format |
| FR-14 | `firestoreRest.ts`, `stageService.ts` | `stageChecks.test.ts`: generic failure, not cached |
| FR-15 | `stageService.ts`, `apps/server/src/index.ts` (status) | `stageChecks.test.ts`: cache + invalidation + ready rule |
| FR-16 | `stageService.ts`, `RealBotCard.tsx` | `stageChecks.test.ts`: demo runs 1–4, skips 5–6 |
| FR-17 | `stageService.ts`, `stageChannel.ts` (`lastAcceptedAt`) | `apps/server/test/stageTest.test.ts`: success + replySeconds |
| FR-18 | `stageService.ts`, `stageChannel.ts` | `stageTest.test.ts`: non-ACK and no-reply texts; `stageChannel.test.ts`: non-ACK |
| FR-19 | `stageService.ts` | `stageTest.test.ts`: 409 cases, zero webhook calls |
| FR-20 | `stageService.ts`, `runManager.ts` blocker, `generationManager.ts` blocker | `stageTest.test.ts`: runs/generations 409 while waiting |
| FR-21 | `sessionStore.ts`, `app.ts` | `google.test.ts`: file mode 0600, no token in any response |
| FR-22 | `sessionStore.ts`, `packages/shared/src/google.ts` | `packages/shared/test/google.test.ts`; `stageChecks.test.ts`: damaged file |

## Implementation steps
1. **Shared types** — FRs: FR-2, FR-13, FR-17, FR-22. Red: `packages/shared/test/google.test.ts`, which fails because `google.ts` doesn't exist. Green: `packages/shared/src/google.ts` + re-export. Check: `pnpm --filter @ctp/shared test` passes, `pnpm typecheck` passes.
2. **Google guard** — FR-10. Red: `googleGuard.test.ts`, which fails because the module is missing. Green: `googleGuard.ts`. Check: `pnpm --filter @ctp/runner test`.
3. **Access-token provider** — FR-11. Red: `googleToken.test.ts` (cache, refresh, `invalid_grant`), which fails because the module is missing. Green: `googleToken.ts`. Check: runner tests pass.
4. **Firestore REST client** — FR-8, FR-12, FR-14. Red: `firestoreRest.test.ts` (decode, clinic GET mapping, runQuery bodies), which fails because the module is missing. Green: `firestoreRest.ts`. Check: runner tests pass.
5. **Guard split** — FR-9. Red: update `stage.test.ts` with the account cases and the new `assertSafeTarget` signature. It fails because `assertSafeAccount` / `assertStageAccess` don't exist. Green: change `guard.ts`. `stageChannel.ts` keeps compiling by temporarily passing the target only. Check: runner tests + `pnpm typecheck`.
6. **StageChannel on REST** — FR-8, FR-9, FR-11, FR-17, FR-18. Red: `stageChannel.test.ts` (guard before fetch, clinic read, ACK + `lastAcceptedAt`, non-ACK text, `fatal()`), which fails against the firebase-admin version. Green: rewrite `stageChannel.ts` on `FirestoreRest` + token provider, add `fatal?` to `ChatChannel`, export from `index.ts`, remove `firebase-admin` from `packages/runner/package.json` and run `pnpm install`. Server compile fix: `index.ts` builds the new config from a `SessionStore` stub (step 8 finishes it). Check: `pnpm test` + `pnpm typecheck` in `app/`.
7. **Config** — FR-7, FR-8, FR-13 (check 1). Red: in `stageChecks.test.ts` (new file, first cases), `stageSettingsProblems` rejects a bad phone, and `legacyKeyFileSet` is true when `STAGE_SERVICE_ACCOUNT_FILE` is set. Both fail because the functions don't exist. Green: `config.ts` changes (google block, default firebase-tools client, `stageSettingsProblems`, `legacyKeyFileSet`), plus `.env.example` updated. Check: server tests pass.
8. **Session store** — FR-6, FR-21, FR-22. Red: `google.test.ts` cases for save (mode 0600, atomic), read missing / damaged / valid, remove. They fail because the module is missing. Green: `sessionStore.ts`. Check: server tests pass.
9. **Sign-in flow + routes** — FR-1–FR-7, FR-10, FR-21. Red: `google.test.ts` route cases through `buildApp` with a fake fetch and clock (consent URL, success, expired/reused state, cancelled, exchange-failed, wrong-domain, unverified-email, origin allow-list, sign-out, no token in responses). They fail because the routes don't exist. Green: `signIn.ts`, the routes in `app.ts`, `AppDeps.google`, wiring in `index.ts`. Check: server tests pass.
10. **Scope change to cloud-platform + real sign-in smoke** — FR-10. Red: change the scope expectations in `packages/runner/test/googleGuard.test.ts` (`GOOGLE_SCOPES`) and `apps/server/test/google.test.ts` (consent URL `scope`) to `cloud-platform`. They fail because the constant still says `datastore`. Green: change `GOOGLE_SCOPES` in `packages/runner/src/stage/googleGuard.ts`. Manual: `pnpm dev`, open `http://localhost:4000/api/google/sign-in?from=http://localhost:5173`, sign in with a prestobots.com account. Check: `pnpm test` passes, the browser lands on `http://localhost:5173/settings?google=signed-in`, and `app/secrets/google-session.json` exists with mode `-rw-------`.
11. **Stage checks + status** — FR-8, FR-11–FR-16, FR-22. Red: the remaining `stageChecks.test.ts` cases (order, skips, 403, expiry, generic failure not cached, cache/fresh/invalidate, demo, damaged file, `/api/status` ready rule, `GET /api/stage/checks`). They fail because `StageService` doesn't exist. Green: `stageService.ts` (checks part), the route, `status()` in `index.ts` based on checks, `invalidate()` called from sign-in/sign-out. Check: server tests pass.
12. **Run abort on expiry** — FR-11. Red: `api.test.ts` cases (a fake channel whose `fatal()` is set after test 1 → test 2 skipped with the message; a factory that throws `SignInExpiredError` → every result is an error, zero sends). They fail because RunManager ignores `fatal`. Green: `runManager.ts` checks `fatal?.()`, and the channel factory passes `isSignedIn`. Check: server tests pass.
13. **Test hola + busy rule** — FR-17–FR-20. Red: `stageTest.test.ts` (success + replySeconds, non-ACK, no reply, 409 cases with zero webhook calls, runs/generations 409 while waiting). They fail because there is no route or blocker. Green: `sendTestMessage`/`busy` in `stageService.ts`, `POST /api/stage/test-message`, error mapping, `GenerationManager.setBlocker`, combined run blocker in `index.ts`. Check: server tests pass.
14. **Web helpers** — FR-2–FR-5, FR-13. Red: `apps/web/test/stageSettings.test.ts`, which fails because the module is missing. Green: `apps/web/src/stageSettings.ts`. Check: `pnpm --filter @ctp/web test`.
15. **Settings card** (UI, verified manually) — FR-1, FR-6, FR-13, FR-16–FR-18. `api.ts` additions, `RealBotCard.tsx`, `SettingsPage.tsx`. Check: `pnpm typecheck`, then `pnpm dev`, and look at the card in demo mode.
16. **Docs** — `app/README.md`, `app/.env.example`, `docs/architecture.md` (modules, no firebase-admin, Google sign-in, new tests). Check: `grep -rn "SERVICE_ACCOUNT\|firebase-admin" app/README.md app/.env.example docs/architecture.md` finds only the "no longer used" note.
17. **Definition of done** — run `pnpm typecheck` and `pnpm test` in `app/` (all green). Confirm every FR-1…FR-22 is named in a test. Do the manual demo on salud-stage from the Test strategy.

## Risks and open issues
- **The firebase-tools OAuth client may refuse the `/api/google/callback` loopback path.** The `datastore` refusal is settled by FR-10 (now `cloud-platform`). Google refused the scope before it checked the redirect, so the path is still unproven (cauce-herramientas uses a root-path redirect on a random port). Mitigation: the step 10 manual smoke repeats the sign-in. If Google answers `redirect_uri_mismatch`, stop and report it: the fix (a root-path callback) needs a plan change.
- **The conversations query needs its existing composite index.** The REST `runQuery` uses the same filters and order as the chatbot's `getMostRecentConversation`, so the index already exists. A "missing index" error appears as FR-14 with Google's message, which includes the link to create it.
- **Clock differences** between this computer and Firestore affect `replySeconds`. It is floored at 0 by the spec (FR-17), and the existing 30 s skew margin for reading messages stays.
- **Removing firebase-admin** changes `pnpm-lock.yaml`. No other package imports it (checked: only `stageChannel.ts`).
- **Your account's read access to salud-stage** and `TEST_PATIENT_PHONE` are prerequisites only for the manual demo (Definition of done), not for the automated steps.
