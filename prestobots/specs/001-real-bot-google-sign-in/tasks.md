# Tasks — Spec 001: Real bot access with Google sign-in

- **Spec:** [spec.md](./spec.md) · **Plan:** [plan.md](./plan.md)
- **Date:** 2026-11-23
- **Progress:** 26/28 tasks done

## How to work through this list
- Take tasks in order, one at a time. Do not start a task whose dependencies are not checked.
- Read the plan sections a task references before starting it.
- A task is done only when its **Done when** check passes. Then tick its box (`[x]`) and update **Progress**.
- If a task reveals a gap or contradiction in the plan or spec, stop and report it; do not improvise.
- Work test-first (TDD): in tasks marked *test-first*, write the tests and see them fail for the expected reason before writing the code. Never skip the red step.
- Keep the project building, linted and with passing tests after every task.
- All commands run in `app/` (`npx pnpm@10.10.0 …` if pnpm isn't installed).

## Phase 1 — Shared types

- [x] **T-01 — Add the Google session and stage check types**
  - **Files:** `packages/shared/test/google.test.ts` (new), `packages/shared/src/google.ts` (new), `packages/shared/src/index.ts` (modified)
  - **Covers:** FR-2, FR-13, FR-17, FR-22 · Plan: Data model, Contracts
  - **Depends on:** —
  - **Do:** (test-first)
    1. Red: write `google.test.ts`: `googleSessionSchema` accepts the plan's example and rejects a missing `refreshToken`, a bad email and a non-ISO `signedInAt`. `GOOGLE_SIGN_IN_ERRORS` lists the 5 codes. Run `pnpm --filter @ctp/shared test` → fails because `../src/google.ts` is not found.
    2. Green: create `google.ts` with `googleSessionSchema`/`GoogleSession`, `StageCheckId`, `stageCheckSchema`/`StageCheck`, `StageChecks`, `TestMessageResult` and `GOOGLE_SIGN_IN_ERRORS`, and re-export it from `index.ts`.
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/shared test` → passes; `pnpm typecheck` → passes.

## Phase 2 — Google guard

- [x] **T-02 — Add the Google request guard**
  - **Files:** `packages/runner/test/googleGuard.test.ts` (new), `packages/runner/src/stage/googleGuard.ts` (new)
  - **Covers:** FR-10 · Plan: Contracts (runner signatures), Technical decisions (one `guardedFetch`)
  - **Depends on:** —
  - **Do:** (test-first)
    1. Red: write tests. `assertGoogleRequest` allows `https://accounts.google.com/o/oauth2/v2/auth…`, `https://oauth2.googleapis.com/token` and `https://firestore.googleapis.com/v1/projects/salud-stage/databases/(default)/documents/…`. It refuses `http:`, other hosts, a Firestore path for `salud-prod`, and `projectId` not in `ALLOWED_PROJECTS`. `guardedFetch` never calls the inner fetch when refused. `GOOGLE_SCOPES` equals the three FR-10 scopes. Run `pnpm --filter @ctp/runner test` → fails because the module is not found.
    2. Green: implement `googleGuard.ts` (throws `GuardError`).
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/runner test` → passes.

## Phase 3 — Access-token provider

- [x] **T-03 — Add the refresh-token access-token provider**
  - **Files:** `packages/runner/test/googleToken.test.ts` (new), `packages/runner/src/stage/googleToken.ts` (new)
  - **Covers:** FR-11 · Plan: Key algorithms › Access token
  - **Depends on:** T-02
  - **Do:** (test-first)
    1. Red: with a fake fetch and injected `now`, test that the first `token()` POSTs `grant_type=refresh_token` to `oauth2.googleapis.com`. A second call within `expires_in − 60 s` makes no fetch, and one after it refreshes. A 400 `invalid_grant` → `SignInExpiredError` with the FR-11 text and `expired() === true`. Run the runner tests → fail because the module is not found.
    2. Green: implement `createAccessTokenProvider` and `SignInExpiredError` (extends `StepError`) using `guardedFetch`.
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/runner test` → passes.

## Phase 4 — Firestore REST client

- [x] **T-04 — Add the Firestore value decoder and clinic read**
  - **Files:** `packages/runner/test/firestoreRest.test.ts` (new), `packages/runner/src/stage/firestoreRest.ts` (new)
  - **Covers:** FR-8, FR-12, FR-14 · Plan: Key algorithms › Firestore REST (Clinic)
  - **Depends on:** T-03
  - **Do:** (test-first)
    1. Red: test `decodeFields` for string, integer, double, boolean, null, timestamp (→ ISO), nested map and array. Test `getDocument` with the field mask URL and Bearer header, and the error mapping: 200 → decoded fields; 403 → `ReadAccessError`; 404 → `StepError` with the clinic text; 401 → one refresh then `SignInExpiredError`; 500 or a thrown fetch → `FirestoreUnavailableError` carrying Google's message. Run → fails because the module is not found.
    2. Green: implement `FirestoreRest.getDocument`, `decodeFields` and the error classes.
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/runner test` → passes.

- [x] **T-05 — Add Firestore `runQuery` for conversations and messages**
  - **Files:** `packages/runner/test/firestoreRest.test.ts` (modified), `packages/runner/src/stage/firestoreRest.ts` (modified)
  - **Covers:** FR-8, FR-14 · Plan: Key algorithms › Firestore REST (Conversation, Messages)
  - **Depends on:** T-04
  - **Do:** (test-first)
    1. Red: test that `runQuery` POSTs to `{base}:runQuery` / `{base}/conversations/{id}:runQuery` with the structured queries from the plan (same filters, order and limit as today's `findConversationId` / `readMessages`). It returns `{ id, data }` per document, skips the empty `{ readTime }` rows, and maps errors like T-04. Run → fails because `runQuery` doesn't exist.
    2. Green: implement `runQuery`.
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/runner test` → passes.

## Phase 5 — Guard split

- [x] **T-06 — Split the stage guard into target and account rules**
  - **Files:** `packages/runner/test/stage.test.ts` (modified), `packages/runner/src/stage/guard.ts` (modified), `packages/runner/src/stage/stageChannel.ts` (modified, call site only)
  - **Covers:** FR-9 · Plan: Module structure (guard.ts), Technical decisions (guard split)
  - **Depends on:** —
  - **Do:** (test-first)
    1. Red: update `assertSafeTarget` tests to the new input (without `credentialsProjectId`) and drop the "key from another project" case. Add `assertSafeAccount` cases: undefined → refused, `x@gmail.com` → refused, `Juan@PrestoBots.com` → accepted. Add `assertStageAccess` checking the account first, then the target. Run → fails because `assertSafeAccount` isn't exported.
    2. Green: change `guard.ts`. In `stageChannel.ts`, call `assertSafeTarget` with the new shape so it still compiles.
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/runner test` → passes; `pnpm typecheck` → passes.

## Phase 6 — StageChannel on REST

- [x] **T-07 — Rewrite StageChannel creation and reading on Firestore REST**
  - **Files:** `packages/runner/test/stageChannel.test.ts` (new), `packages/runner/src/stage/stageChannel.ts` (modified), `packages/runner/src/channels/types.ts` (modified), `packages/runner/src/index.ts` (modified), `apps/server/src/index.ts` (modified, compile fix)
  - **Covers:** FR-8, FR-9, FR-11 · Plan: Module structure (stageChannel.ts), Contracts (`StageChannel.create`, `readClinic`, `fatal`)
  - **Depends on:** T-05, T-06
  - **Do:** (test-first)
    1. Red: with a fake fetch, test four cases. `create` with `projectId: 'salud-prod'` or no session → `GuardError` with zero fetch calls. `create` reads the clinic and sets `target` to `salud-stage · <name>`. `collectReplies` returns bot messages read through `runQuery`. `fatal()` returns the FR-11 text after the token provider expired, and after `isSignedIn()` returns false. Run → fails because the config shape and `fatal` don't exist.
    2. Green: replace firebase-admin with `FirestoreRest` + `createAccessTokenProvider` in `stageChannel.ts`, with config per the plan (`google`, `fetch?`, `isSignedIn?`). Add `readClinic()` and `fatal()`. Add the optional `fatal?()` to `ChatChannel`. Export the new modules from `index.ts`. In `apps/server/src/index.ts`, build the new `StageChannelConfig` from a temporary inline read of `app/secrets/google-session.json` (T-11 replaces it) so the server still compiles.
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/runner test` → passes; `pnpm typecheck` → passes.

- [x] **T-08 — Record the ACK time and align the webhook error text**
  - **Files:** `packages/runner/test/stageChannel.test.ts` (modified), `packages/runner/src/stage/stageChannel.ts` (modified)
  - **Covers:** FR-17, FR-18 · Plan: Key algorithms › Test hola (step 4)
  - **Depends on:** T-07
  - **Do:** (test-first)
    1. Red: test that `send` with an `ACK` body sets `lastAcceptedAt()` to the injected `now`. A 200 response with a non-ACK body throws `StepError` starting with "The bot did not accept the message (HTTP 200". Run → fails because `lastAcceptedAt` doesn't exist and the old text differs.
    2. Green: add `lastAcceptedAt()` and the new message.
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/runner test` → passes.

- [x] **T-09 — Remove firebase-admin (no TDD: setup)**
  - **Files:** `packages/runner/package.json` (modified), `pnpm-lock.yaml` (modified)
  - **Covers:** FR-8 · Plan: Dependencies, Implementation step 6
  - **Depends on:** T-08
  - **Do:**
    1. Remove `firebase-admin` from `packages/runner/package.json` and run `pnpm install`.
  - **Done when:** `grep -rn firebase-admin packages apps --include='*.ts' --include=package.json` → no matches; `pnpm typecheck` and `pnpm test` → pass.

## Phase 7 — Config

- [x] **T-10 — Add Google settings, phone format and legacy-key detection to config**
  - **Files:** `apps/server/test/stageChecks.test.ts` (new), `apps/server/src/config.ts` (modified), `apps/server/src/index.ts` (modified), `.env.example` (modified)
  - **Covers:** FR-7, FR-8, FR-13 (check 1) · Plan: Module structure (config.ts), Technical decisions (firebase-tools constants)
  - **Depends on:** T-09
  - **Do:** (test-first)
    1. Red: test that `stageSettingsProblems` reports a missing org, webhook or phone, and a phone with `+`, spaces or 9 digits, with the "Write it like 5492611234567" fix. A valid set → `[]`. Test a pure `parseGoogleConfig(env)`: the default firebase-tools client, the env override, and `legacyKeyFileSet` true when `STAGE_SERVICE_ACCOUNT_FILE` is set. Run → fails because the functions don't exist.
    2. Green: implement them in `config.ts`. Remove `STAGE_SERVICE_ACCOUNT_FILE` from the schema, add `config.google` (`clientId`, `clientSecret`, `sessionFile`), and replace `missingStageSettings` in `index.ts`. Update `.env.example` (drop the key file, add the optional `GOOGLE_OAUTH_CLIENT_ID/SECRET`).
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/server test` → passes; `pnpm typecheck` → passes.

## Phase 8 — Session store

- [x] **T-11 — Add the Google session file store**
  - **Files:** `apps/server/test/google.test.ts` (new), `apps/server/src/google/sessionStore.ts` (new), `apps/server/src/index.ts` (modified)
  - **Covers:** FR-6, FR-21, FR-22 · Plan: Data model, Technical decisions (atomic write)
  - **Depends on:** T-01, T-10
  - **Do:** (test-first)
    1. Red: using a `mkdtempSync` folder, test four things. `save` writes valid JSON with file mode `0o600` (folder `0o700`) and leaves no temp file. `read` → `{ missing: true }` when there is no file, `{ damaged: true }` for truncated JSON or a schema failure, and `{ session }` when valid. `remove` deletes the file and doesn't fail when it's absent. Run → fails because the module is not found.
    2. Green: implement `SessionStore`. Replace the temporary session read in `index.ts` with it.
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/server test` → passes.

## Phase 9 — Sign-in flow and routes

- [x] **T-12 — Add the consent URL with the origin allow-list**
  - **Files:** `apps/server/test/google.test.ts` (modified), `apps/server/src/google/signIn.ts` (new)
  - **Covers:** FR-1, FR-7, FR-10 · Plan: Key algorithms › Sign-in (step 1), Contracts
  - **Depends on:** T-02, T-11
  - **Do:** (test-first)
    1. Red: test that `start(from)` returns an `accounts.google.com` URL with `client_id` (default and override), `redirect_uri=http://127.0.0.1:<PORT>/api/google/callback`, the three scopes, a 32-hex `state`, an S256 `code_challenge`, `access_type=offline` and `prompt=consent`. The origin is kept for `http://localhost:5173` and `http://127.0.0.1:<PORT>`, and replaced by `http://localhost:<PORT>` for `http://evil.test` or `http://localhost:9999`. Run → fails because the module is not found.
    2. Green: implement `GoogleSignIn.start` with the in-memory state map and injected `now`.
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/server test` → passes.

- [x] **T-13 — Finish sign-in: state, code exchange and account rules**
  - **Files:** `apps/server/test/google.test.ts` (modified), `apps/server/src/google/signIn.ts` (modified)
  - **Covers:** FR-2, FR-3, FR-4, FR-5 · Plan: Key algorithms › Sign-in (steps 2–5), Error handling
  - **Depends on:** T-12
  - **Do:** (test-first)
    1. Red: with a fake token endpoint returning an `id_token`, test these cases:
       - success → session saved and `{ origin, email }`;
       - a reused state, an unknown state, or a state 11 minutes old (injected clock) → `expired-state`, nothing saved;
       - `error=access_denied` → `cancelled`;
       - token 400 or no `refresh_token` → `exchange-failed`;
       - `x@gmail.com` → `wrong-domain`;
       - `email_verified:false` → `unverified-email`;
       - `Juan@PrestoBots.com` → accepted.

       Run → fails because `finish` doesn't exist.
    2. Green: implement `finish` (PKCE verifier, `guardedFetch`, id_token decode, `SessionStore.save`, an `onSignedIn` callback for cache invalidation).
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/server test` → passes.

- [x] **T-14 — Add the sign-in, callback and sign-out routes**
  - **Files:** `apps/server/test/google.test.ts` (modified), `apps/server/src/app.ts` (modified), `apps/server/src/index.ts` (modified)
  - **Covers:** FR-1, FR-2, FR-3, FR-6, FR-21 · Plan: Contracts (HTTP)
  - **Depends on:** T-13
  - **Do:** (test-first)
    1. Red: through `buildApp` with `app.inject`, test five things:
       - `GET /api/google/sign-in?from=…` → 302 to Google;
       - callback success → 302 `<origin>/settings?google=signed-in`;
       - each failure → 302 `…google=error&reason=<code>` (plus `&email=` for the FR-5 codes);
       - `POST /api/google/sign-out` → `{ signedIn: false }` and the file is gone;
       - no response body or `Location` contains the refresh token.

       Run → fails with 404 because the routes don't exist.
    2. Green: add the routes and `AppDeps.google`, and wire them in `index.ts`.
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/server test` → passes; `pnpm typecheck` → passes.

## Phase 10 — Scope change and real sign-in smoke

- [x] **T-15 — Switch the Google scopes to cloud-platform**
  - **Files:** `packages/runner/test/googleGuard.test.ts` (modified), `apps/server/test/google.test.ts` (modified), `packages/runner/src/stage/googleGuard.ts` (modified)
  - **Covers:** FR-10 · Plan: Technical decisions (scopes), Contracts (consent URL), Implementation step 10
  - **Depends on:** T-14
  - **Do:** (test-first)
    1. Red: change the expected scopes in `googleGuard.test.ts` (`GOOGLE_SCOPES`) and in `google.test.ts` (consent URL `scope`, the session `scopes` fixtures) to `openid email https://www.googleapis.com/auth/cloud-platform`. Run `pnpm test` → fails because `GOOGLE_SCOPES` still has `datastore`.
    2. Green: change `GOOGLE_SCOPES` in `googleGuard.ts`.
    3. Refactor with all tests green.
  - **Done when:** `pnpm test` and `pnpm typecheck` → pass; `grep -rn "auth/datastore" packages apps --include='*.ts'` → no matches.

- [x] **T-16 — Smoke-test a real sign-in with the firebase-tools client (no TDD: manual risk check)**
  - **Files:** —
  - **Covers:** FR-7, FR-10 · Plan: Risks (callback path), Implementation step 10
  - **Depends on:** T-15
  - **Do:**
    1. `pnpm dev`, then open `http://localhost:4000/api/google/sign-in?from=http://localhost:5173` and sign in with your prestobots.com account.
    2. If Google answers `redirect_uri_mismatch` or refuses another way, stop and report it (a root-path callback needs a plan change).
  - **Done when:** the browser lands on `http://localhost:5173/settings?google=signed-in` and `app/secrets/google-session.json` exists with mode `-rw-------` (`ls -l`). Or: the refusal is reported to the developer.

## Phase 11 — Stage checks and status

- [x] **T-17 — Add stage checks 1–4 and demo mode**
  - **Files:** `apps/server/test/stageChecks.test.ts` (modified), `apps/server/src/stage/stageService.ts` (new)
  - **Covers:** FR-8, FR-9, FR-13, FR-16, FR-22 · Plan: Key algorithms › Checks (1–4, demo)
  - **Depends on:** T-11
  - **Do:** (test-first)
    1. Red: test the following:
       - the order and labels of the six checks;
       - a bad phone → check 1 failed and 2 skipped;
       - `STAGE_PROJECT_ID=salud-prod` → check 2 failed, with zero fake-fetch calls;
       - no session → 3 failed "Not signed in";
       - damaged file → the "damaged" text;
       - gmail session → 4 failed;
       - demo mode → 1–4 run and 5–6 skipped with the demo note;
       - `legacyKeyFileSet` → the FR-8 note is present.

       Run → fails because the module is not found.
    2. Green: implement `StageService.checks` for checks 1–4 and the demo behavior (5–6 skipped for now when not in demo).
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/server test` → passes.

- [x] **T-18 — Add checks 5–6 with the salud-stage error mapping**
  - **Files:** `apps/server/test/stageChecks.test.ts` (modified), `apps/server/src/stage/stageService.ts` (modified)
  - **Covers:** FR-11, FR-12, FR-13, FR-14 · Plan: Key algorithms › Checks (5–6)
  - **Depends on:** T-07, T-17
  - **Do:** (test-first)
    1. Red: with an injected channel factory that throws each error, test the mapping. OK → 5 and 6 passed. `ReadAccessError` → 5 failed with the ask-Pachi text and the email. `SignInExpiredError` → 5 failed with the sign-in-again text. A clinic `StepError` → 5 passed, 6 failed. `FirestoreUnavailableError` → 5 failed "Could not reach salud-stage: …" with the retry fix. Run → fails because checks 5–6 are always skipped.
    2. Green: implement the mapping.
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/server test` → passes.

- [x] **T-19 — Add the checks cache, the route and status from checks**
  - **Files:** `apps/server/test/stageChecks.test.ts` (modified), `apps/server/src/stage/stageService.ts` (modified), `apps/server/src/app.ts` (modified), `apps/server/src/index.ts` (modified)
  - **Covers:** FR-6, FR-15 · Plan: Key algorithms › Checks (7), Contracts (`GET /api/stage/checks`, `/api/status`)
  - **Depends on:** T-14, T-18
  - **Do:** (test-first)
    1. Red: test the following:
       - a second call within 60 s → no new factory call; after 60 s → a new call;
       - `fresh` → a new call;
       - `invalidate()` after sign-in, sign-out or `SignInExpiredError` → a new call;
       - a `FirestoreUnavailableError` result is not cached;
       - `GET /api/stage/checks[?fresh=1]` → `StageChecks` with no token;
       - `/api/status` `ready` is true only when all six pass, and `problems` lists the failed checks.

       Run → fails because there is no cache or route.
    2. Green: add the cache and `invalidate`, `AppDeps.stage`, the route, `status()` in `index.ts` based on checks, and wire `invalidate` into sign-in and sign-out.
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/server test` → passes; `pnpm typecheck` → passes.

## Phase 12 — Run abort on expiry

- [x] **T-20 — Stop a run when the Google sign-in expires**
  - **Files:** `apps/server/test/api.test.ts` (modified), `apps/server/src/runManager.ts` (modified), `apps/server/src/index.ts` (modified)
  - **Covers:** FR-11 · Plan: Key algorithms › Run abort on expiry
  - **Depends on:** T-07, T-19
  - **Do:** (test-first)
    1. Red: test that a fake channel whose `fatal()` returns the FR-11 text after test 1 leaves test 2 `skipped` with that `error` and the run `finished`. Test that a channel factory throwing `SignInExpiredError` gives every result an `error` "Could not connect to the chatbot: Your Google sign-in expired…" with zero sends. Run → fails because the remaining tests still run.
    2. Green: check `channel.fatal?.()` after each test in `RunManager.execute`, and pass `isSignedIn` from `SessionStore` in the `index.ts` channel factory.
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/server test` → passes.

## Phase 13 — Test hola and the busy rule

- [x] **T-21 — Add sending the test hola, with reply time and failure texts**
  - **Files:** `apps/server/test/stageTest.test.ts` (new), `apps/server/src/stage/stageService.ts` (modified)
  - **Covers:** FR-17, FR-18 · Plan: Key algorithms › Test hola (steps 2–5)
  - **Depends on:** T-08, T-19
  - **Do:** (test-first)
    1. Red: with a fake channel and session, test four cases. Success → `{ sent, replies, replySeconds }`, where `replySeconds` = 4.2 for an ACK at t and a first reply `createdAt` at t + 4.23 s, and 0 when the reply time is before the ACK. The default text is "hola" when `TEST_RESET_MESSAGE` is empty. Non-ACK `StepError` → `StageTestFailedError` with "The bot did not accept the message…". No bot reply → "The bot accepted the message but no reply was saved in salud-stage within N s…". Run → fails because `sendTestMessage` doesn't exist.
    2. Green: implement `sendTestMessage`, `StageTestFailedError` and the cleanup in `finally`.
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/server test` → passes.

- [x] **T-22 — Add the test-message route and its refusal rules**
  - **Files:** `apps/server/test/stageTest.test.ts` (modified), `apps/server/src/stage/stageService.ts` (modified), `apps/server/src/app.ts` (modified)
  - **Covers:** FR-19 · Plan: Contracts (`POST /api/stage/test-message`), Key algorithms › Test hola (step 1)
  - **Depends on:** T-21
  - **Do:** (test-first)
    1. Red: through `buildApp`, test that success → 200, and FR-18 failures → 502 `{ error }`. A run active, a generation active, checks not ready, or a second request while the first waits → 409 with the reason, and zero webhook calls. Run → fails with 404 because the route doesn't exist.
    2. Green: add `busy` (set before any `await`), `StageTestConflictError`, the route and the error mapping in `app.ts`.
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/server test` → passes.

- [x] **T-23 — Block runs and generations while a test hola waits**
  - **Files:** `apps/server/test/stageTest.test.ts` (modified), `apps/server/src/generation/generationManager.ts` (modified), `apps/server/src/index.ts` (modified)
  - **Covers:** FR-20 · Plan: Technical decisions (busy rule)
  - **Depends on:** T-22
  - **Do:** (test-first)
    1. Red: while a test hola is pending on a never-resolving fake, test that `POST /api/runs`, `POST /api/test-cases/trial` and `POST /api/generations` → 409 "A test message is waiting for the bot's reply. Try again in a few seconds." Run → fails because they return 201.
    2. Green: add `GenerationManager.setBlocker`. Combine the generation and stage blockers in `RunManager.setBlocker`, and set the generation blocker in `index.ts`. Mirror that wiring in the test's `buildApp` helper.
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/server test` → passes; `pnpm typecheck` → passes.

## Phase 14 — Web helpers

- [x] **T-24 — Add the Settings sign-in notice and check-symbol helpers**
  - **Files:** `apps/web/test/stageSettings.test.ts` (new), `apps/web/src/stageSettings.ts` (new)
  - **Covers:** FR-2, FR-3, FR-4, FR-5, FR-13 · Plan: Contracts (UI), Error handling
  - **Depends on:** T-01
  - **Do:** (test-first)
    1. Red: test that `signInNotice('?google=signed-in')` → a success notice. Each of the 5 reason codes → its FR-3/FR-4/FR-5 text, with `&email=` used for the FR-5 codes. An unknown code → "Sign-in failed. Try again." No `google` param → `null`. Test that `checkSymbol` gives ✔, ✘ or – per state. Run `pnpm --filter @ctp/web test` → fails because the module is not found.
    2. Green: implement `stageSettings.ts`.
    3. Refactor with all tests green.
  - **Done when:** `pnpm --filter @ctp/web test` → passes.

## Phase 15 — Settings card

- [x] **T-25 — Build the "Real bot (salud-stage)" Settings card (no TDD: UI, manual check)**
  - **Files:** `apps/web/src/api.ts` (modified), `apps/web/src/components/RealBotCard.tsx` (new), `apps/web/src/pages/SettingsPage.tsx` (modified)
  - **Covers:** FR-1, FR-6, FR-13, FR-16, FR-17, FR-18 · Plan: Contracts (UI)
  - **Depends on:** T-19, T-22, T-24
  - **Do:**
    1. Add `stageChecks(fresh)`, `signOut()` and `sendTestMessage()` to `api.ts`.
    2. Create `RealBotCard.tsx`: the account line with Sign in (`/api/google/sign-in?from=${location.origin}`) / Sign out, the notice from `signInNotice(location.search)`, six rows, "Check again", the demo note, and "Send test hola" (disabled unless `ready`) showing "Waiting for the bot…" and then the result or the error. After sign-out, invalidate the `status` and `stage-checks` queries.
    3. Render the card above the AI card in `SettingsPage.tsx` and update the subtitle.
  - **Done when:** `pnpm typecheck` → passes. Then `pnpm dev` (demo mode) → `http://localhost:5173/settings` shows the card with checks 1–4 and 5–6 skipped with the demo note, "Send test hola" disabled, and a working Sign in link.

## Phase 16 — Docs

- [x] **T-26 — Update the docs for Google sign-in (no TDD: docs)**
  - **Files:** `app/README.md` (modified), `app/.env.example` (modified), `docs/architecture.md` (modified)
  - **Covers:** FR-7, FR-8 · Plan: Module structure (Docs), Implementation step 15
  - **Depends on:** T-25
  - **Do:**
    1. Describe the stage setup in `app/README.md`: sign in with Google in Settings, the checks, Send test hola, and asking Pachi for read access on salud-stage.
    2. Check that `.env.example` has no key-file instructions and documents `GOOGLE_OAUTH_CLIENT_ID/SECRET`, with a note that `STAGE_SERVICE_ACCOUNT_FILE` is no longer used.
    3. In `docs/architecture.md`, cover the new modules, Firestore REST instead of firebase-admin, the session file, the new routes and the new test counts.
  - **Done when:** `grep -rn "SERVICE_ACCOUNT\|firebase-admin" app/README.md app/.env.example docs/architecture.md` → only the "no longer used" note.

## Phase 17 — Definition of done

- [ ] **T-27 — Run the full Definition of done (automated + manual on salud-stage)**
  - **Files:** —
  - **Covers:** FR-1…FR-22 · Plan: Test strategy (Manual), spec Definition of done
  - **Depends on:** T-26
  - **Do:**
    1. Run `pnpm typecheck` and `pnpm test` in `app/`.
    2. Confirm every FR-1…FR-22 is named in at least one test (`grep -rhoE "FR-[0-9]+" packages/*/test apps/*/test | sort -u`), or covered by this task's manual steps.
    3. Manual, with `CHATBOT_MODE=stage` and `TEST_PATIENT_PHONE` set, `pnpm dev`:
       - Settings → Sign in with Google → prestobots.com account → back on :5173 with "Signed in as …".
       - All six checks ✔.
       - Send test hola → a bot reply with seconds.
       - Run one starter test case → passed.
       - Sign out → "Not signed in".
  - **Done when:** typecheck and tests pass, all 22 FRs are found or manually covered, and each manual step shows the expected result.

- [ ] **T-28 — Mark the spec as Done**
  - **Files:** `specs/001-real-bot-google-sign-in/spec.md` (status line), this file
  - **Covers:** — · Plan: —
  - **Depends on:** T-27
  - **Do:**
    1. Run `/spec-create done`.
  - **Done when:** `/spec-create done` succeeds and the spec's status is `Done`.

## Coverage
| FR | Tasks |
|----|-------|
| FR-1 | T-12, T-14, T-25, T-27 |
| FR-2 | T-01, T-13, T-14, T-24 |
| FR-3 | T-13, T-14, T-24 |
| FR-4 | T-13, T-24 |
| FR-5 | T-13, T-24 |
| FR-6 | T-11, T-14, T-19, T-25 |
| FR-7 | T-10, T-12, T-16, T-26 |
| FR-8 | T-04, T-05, T-07, T-09, T-10, T-17, T-26 |
| FR-9 | T-06, T-07, T-17 |
| FR-10 | T-02, T-12, T-15, T-16 |
| FR-11 | T-03, T-07, T-18, T-20 |
| FR-12 | T-04, T-18 |
| FR-13 | T-01, T-10, T-17, T-18, T-24, T-25 |
| FR-14 | T-04, T-05, T-18 |
| FR-15 | T-19 |
| FR-16 | T-17, T-25 |
| FR-17 | T-01, T-08, T-21, T-25 |
| FR-18 | T-08, T-21, T-22, T-25 |
| FR-19 | T-22 |
| FR-20 | T-23 |
| FR-21 | T-11, T-14 |
| FR-22 | T-01, T-11, T-17 |
