# Spec 001 — Real bot access with Google sign-in

- **Status:** Active
- **Date:** 2026-11-23
- **Related:** none (first spec). Background: `docs/07-developer-requests.md` (Request 2, "your own Google account" fallback), `repos/cauce-herramientas/` (the team's read-only tool).

## Context and goal
The platform can already play test cases against the real Cauce bot on salud-stage (`StageChannel`). It sends fake Gupshup messages to the bot's webhook and reads the replies from Firestore. Reading today requires a service-account JSON key, which the team did not hand out. Instead they gave us `cauce-herramientas`, a read-only tool that signs in with the person's own prestobots.com Google account (role Cloud Datastore Viewer). It reads salud-prod by default and cannot send messages. This spec lets the platform read salud-stage with the admin's own Google account: sign in from the Settings page, then check step by step that everything the real bot needs is in place. The service-account key option goes away. An admin can then go from "nothing set up" to "a starter test passes on salud-stage" without editing code, and every problem comes with a plain-words fix. The AI features already work once `ANTHROPIC_API_KEY` is set and are not changed here.

## Users / actors
- **Admin** (non-technical): signs in, reads the connection check, sends the test "hola", runs tests.
- **Google** (OAuth 2.0 + Firestore REST): signs the admin in and serves salud-stage data read-only.
- **Cauce bot on salud-stage**: `webhookGupshupMessages` receives the fake messages; the QA clinic `testing-macena-gupshup-v3-qa` answers.

## User stories
- US-1: As an admin, I want to sign in with my prestobots.com Google account from the Settings page, so that the platform can read the real bot's replies without a key file.
- US-2: As an admin, I want a connection check that shows each piece the real bot needs, with what to do when one fails, so that I can fix setup problems without help.
- US-3: As an admin, I want a button that sends one test "hola" and shows the bot's reply, so that I know the webhook works before running tests.
- US-4: As an admin, I want the platform to stay strictly on salud-stage and keep my Google session private, so that signing in with my personal account can never touch production or leak access.

## Functional requirements (EARS acceptance criteria)
Sign-in
- FR-1: WHEN the admin clicks "Sign in with Google" on the Settings page, THE SYSTEM SHALL open Google's consent page for the configured OAuth client, with a random `state` value and a redirect back to the platform server's own address on `127.0.0.1`. Along with the `state` it SHALL remember the origin of the page that started the sign-in, accepting only `http://localhost` or `http://127.0.0.1` on the platform port or the Vite dev port (5173). Any other origin falls back to the platform's own address. [US-1]
- FR-2: WHEN Google redirects back with a valid code and the matching `state`, THE SYSTEM SHALL exchange the code, save the session (account email and refresh token) to `app/secrets/google-session.json`, and redirect the admin to `/settings` on the remembered origin, which shows "Signed in as <email>". [US-1]
- FR-3: IF the callback's `state` is missing or does not match one the platform issued in the last 10 minutes, or was already used (each `state` works once), THEN THE SYSTEM SHALL reject it, save nothing, and show "The sign-in link expired or was not started here. Click Sign in with Google again." [US-1, US-4]
- FR-4: IF the admin cancels on Google's page, or the code exchange fails, THEN THE SYSTEM SHALL save nothing and show a plain-words message with the reason and "Try again". [US-1]
- FR-5: IF the signed-in account's email does not end in `@prestobots.com` (case-insensitive), or Google does not mark it as verified (`email_verified`), THEN THE SYSTEM SHALL not save the session and SHALL show "Sign in with your prestobots.com account (you used <email>)." [US-4]
- FR-6: WHEN the admin clicks "Sign out", THE SYSTEM SHALL delete the session file and show the real bot as not ready. [US-1, US-4]
- FR-7: WHERE `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are set in `.env`, THE SYSTEM SHALL use them. Otherwise it SHALL use the public firebase-tools desktop client (the same one `firebase login` and cauce-herramientas use). [US-1]

Reading salud-stage
- FR-8: WHILE `CHATBOT_MODE=stage`, THE SYSTEM SHALL read salud-stage Firestore only with the saved Google session and SHALL no longer read `STAGE_SERVICE_ACCOUNT_FILE`. IF that variable is still set, THEN the status notes SHALL say "STAGE_SERVICE_ACCOUNT_FILE is no longer used; sign in with Google in Settings instead." [US-1]
- FR-9: THE SYSTEM SHALL run the salud-stage guard before any Firestore read or webhook call. The guard keeps every current rule (project on the allow-list, https Cloud Functions webhook of that project, not "prod", QA clinic set). In place of the key-file project rule it adds two rules: a saved session must exist, and its account must be `@prestobots.com`. [US-4]
- FR-10: THE SYSTEM SHALL request exactly the OAuth scopes `openid`, `email` and `https://www.googleapis.com/auth/cloud-platform`, for every OAuth client. The public firebase-tools client refuses the narrower `datastore` scope (`restricted_client`), and `cloud-platform` is the scope it and cauce-herramientas use. It SHALL send Google requests only to `accounts.google.com` (consent), `oauth2.googleapis.com` (token, user info) and `firestore.googleapis.com` for project `salud-stage`, and a Google guard SHALL refuse any other host or project before the request leaves. [US-4]
- FR-11: IF Google answers that the refresh token is expired or revoked, THEN THE SYSTEM SHALL mark the real bot not ready with "Your Google sign-in expired. Sign in again in Settings." A run that starts in this state SHALL fail before sending any message. IF the sign-in expires or is removed during a run, THEN the current test SHALL fail with the same message and the remaining tests SHALL not start. [US-2, US-4]
- FR-12: IF salud-stage answers "permission denied" for the signed-in account, THEN THE SYSTEM SHALL mark the real bot not ready with "Your account <email> can't read salud-stage. Ask Pachi for read access (Cloud Datastore Viewer) on salud-stage." [US-2]

Connection check
- FR-13: WHEN the Settings page opens or the admin clicks "Check again", THE SYSTEM SHALL run these read-only checks in order and report each as passed, failed or skipped, with a message and, when failed, what to do: (1) stage settings filled in `.env` (QA clinic, webhook URL, test phone), with the test phone as 10–15 digits (country code, no `+` or spaces; fix: "Write it like 5492611234567"); (2) target is safe (guard); (3) signed in with Google; (4) account is prestobots.com; (5) can read salud-stage; (6) QA clinic exists and has a Gupshup app. A check SHALL be skipped when an earlier one it depends on failed. [US-2]
- FR-14: IF check 5 or 6 fails for any reason other than those in FR-11 and FR-12 (no internet, Google server error, missing index…), THEN THE SYSTEM SHALL mark it failed with "Could not reach salud-stage: <Google's message>" and the fix "Check your internet connection and click Check again", skip the later checks, and not cache that result. [US-2]
- FR-15: THE SYSTEM SHALL report the real bot as ready (`/api/status` `ready: true`) only when all six checks pass. Results may be cached for at most 60 seconds. "Check again" SHALL bypass the cache, and saving or deleting the session, or Google answering that the sign-in expired (FR-11), SHALL clear it. [US-2]
- FR-16: WHILE `CHATBOT_MODE=demo`, THE SYSTEM SHALL show the Google section and its sign-in button with the note "Only needed for the real bot (CHATBOT_MODE=stage)", SHALL still run checks 1–4 (local, read-only), and SHALL skip checks 5–6 with that note. [US-2]

Test message
- FR-17: WHEN the admin clicks "Send test hola" while all six checks pass, THE SYSTEM SHALL send the reset message (`TEST_RESET_MESSAGE`, default "hola") as the test patient through the webhook. It SHALL wait up to `REPLY_TIMEOUT_SECONDS` for the bot's reply and show the sent message, the bot's replies (text and options) and how long the bot took (`replySeconds`: from the moment the webhook answered "ACK" to the saved time of the first bot or staff reply in salud-stage, rounded to 0.1 s and never below 0). [US-3]
- FR-18: IF the webhook does not answer "ACK", or no bot reply arrives in time, THEN THE SYSTEM SHALL show which half failed ("The bot did not accept the message (HTTP …)" vs "The bot accepted the message but no reply was saved in salud-stage within N s") and what to check. [US-3]
- FR-19: IF a run or a "Generate test cases" job is using the chatbot, or the checks do not all pass, THEN THE SYSTEM SHALL refuse "Send test hola" with the reason and send nothing. [US-3, US-4]
- FR-20: WHILE a test hola is waiting for the bot's reply, THE SYSTEM SHALL refuse to start a run or "Generate test cases" with HTTP 409 and "A test message is waiting for the bot's reply. Try again in a few seconds." [US-3, US-4]

Privacy
- FR-21: THE SYSTEM SHALL never return tokens or the session file's contents from any `/api` endpoint, write them to logs, or include them in Jira cards. It SHALL write the session file with owner-only permissions (0600). [US-4]
- FR-22: IF the session file is missing, unreadable or fails validation, THEN THE SYSTEM SHALL treat the admin as signed out, and check 3 SHALL say "Not signed in" (adding "the saved sign-in was damaged" when the file existed). [US-1, US-2]

## User-facing behavior
**Settings page → new "Real bot (salud-stage)" section**, above AI and Jira:
```
Real bot (salud-stage)                                   [Check again]
Google account:  Signed in as juan@prestobots.com        [Sign out]
  ✔ Stage settings filled in
  ✔ Target is safe (salud-stage · QA clinic testing-macena-gupshup-v3-qa)
  ✔ Signed in with Google
  ✔ prestobots.com account
  ✘ Can read salud-stage — Your account can't read salud-stage. Ask Pachi for read access (Cloud Datastore Viewer) on salud-stage.
  – QA clinic found (skipped: needs the check above)
                                                         [Send test hola] (disabled until all pass)
```
After "Send test hola": `You: hola` → `Bot (4.2 s): ¡Hola! Soy el asistente de … [Sacar turno] [Mis turnos] …`

**Endpoints** (all under `/api`, JSON, no secrets in any response):
- `GET /api/google/sign-in` → 302 to Google's consent URL.
- `GET /api/google/callback?code&state` → saves the session, 302 to `/settings?google=signed-in` or `/settings?google=error&reason=<code>` on the remembered origin. `<code>` is one of `expired-state` (FR-3), `cancelled` or `exchange-failed` (FR-4), `wrong-domain` or `unverified-email` (FR-5). The Settings page maps each code to its message, and any other value shows "Sign-in failed. Try again."
- `POST /api/google/sign-out` → `{ signedIn: false }`.
- `GET /api/stage/checks` (optional `?fresh=1`) → `{ ready, account: { email } | null, checks: [{ id, label, state: 'passed'|'failed'|'skipped', message, fix? }] }`.
- `POST /api/stage/test-message` → `{ sent: ChatMessage, replies: ChatMessage[], replySeconds }`, or 409 with `{ error }` (FR-19), or 502 with `{ error }` (FR-18).
- `POST /api/runs` and `POST /api/generations` also answer 409 while a test hola is in progress (FR-20).
- `GET /api/status` keeps its shape. `ready` and `problems` come from the checks above.

## Data model
- **New file** `app/secrets/google-session.json` (git-ignored by the existing `secrets/` rule, mode 0600), validated with a new zod schema `GoogleSession` in `packages/shared`: `{ email: string, refreshToken: string, scopes: string[], signedInAt: string (ISO) }`. It is not a SQLite table.
- **New shared types** (`packages/shared`): `StageCheck` `{ id: 'settings'|'guard'|'signedIn'|'domain'|'readAccess'|'clinic', label, state: 'passed'|'failed'|'skipped', message, fix? }` and `StageChecks` `{ ready, account, checks }`.
- **Env:** adds optional `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`. Removes `STAGE_SERVICE_ACCOUNT_FILE` (ignored, with a note per FR-8). `.env.example` and `app/README.md` are updated.
- **SQLite:** no changes.

## Non-functional requirements
- **Safety (constitution art. 2):** the key-file project rule is replaced, not dropped. The project allow-list, webhook and clinic rules stay. The new session and domain rules apply first, and guard tests cover each. The platform never reads `~/.cauce/` or the firebase-tools session, never targets salud-prod (even though the same Google account can read it), and only calls Firestore read endpoints.
- **Least privilege:** the scopes are fixed by FR-10 (`cloud-platform`, the narrowest scope the firebase-tools client accepts for Firestore). The token can do only what the account's IAM role allows (Cloud Datastore Viewer: read-only). The Google guard (FR-10) keeps requests to the three hosts and salud-stage's Firestore documents, and the platform calls only Firestore read endpoints.
- **Dependencies (art. 4):** prefer `fetch` plus the existing firebase-admin (authorized-user refresh token credential). Any new dependency must be justified in `plan.md`.
- **Tests (art. 6):** every FR is tested with fakes (fake Google token endpoint, fake Firestore, fake webhook). Tests make no network calls and need no keys.
- **Performance:** the six checks complete in under 10 s on a normal connection. The status cache stays ≤ 60 s (FR-15).
- **Language:** UI text in English, in plain words with a "what to do" for every failure. Bot texts stay in Spanish.

## Edge cases
- Callback opened twice, or after a restart (state no longer known) → rejected, nothing saved (FR-3).
- Admin picks a gmail.com or other domain account → refused (FR-5).
- Email domain in a different case (`Juan@PrestoBots.com`) → accepted (FR-5).
- Session file deleted by hand, truncated or edited → treated as signed out (FR-22).
- Signing out while a run is active → the current test fails with the "sign in again" message and the remaining tests don't start (FR-11). The sign-out itself is not blocked.
- Refresh token revoked from the Google account page → not ready, plus the sign-in-again message (FR-11).
- Account can read salud-prod but not salud-stage → "Can read salud-stage" fails with the ask-Pachi fix. Nothing falls back to prod (FR-12, FR-9).
- `STAGE_PROJECT_ID` set to `salud-prod` → the guard check fails and nothing is read (FR-9, FR-13).
- Test phone written with `+`, spaces or too few digits → check 1 fails with the example format (FR-13).
- `STAGE_SERVICE_ACCOUNT_FILE` still set → ignored, with a note (FR-8).
- Demo mode → checks 1–4 run and checks 5–6 are skipped with the demo note (FR-16).
- "Send test hola" clicked twice quickly, or while a run is active → the second request is refused (FR-19).
- Starting a run or "Generate test cases" while a test hola waits for its reply → refused with 409 (FR-20).
- No internet or a Google server error during checks 5–6 → failed with the retry hint and not cached (FR-14).
- Sign-in started from an unexpected origin (another host or port) → after the callback the admin lands on the platform's own address (FR-1, FR-2).
- Webhook answers 200 with a body other than "ACK" → reported as not accepted (FR-18).
- Bot replies arrive after the timeout → reported as no reply (FR-18). Late replies are ignored by the next test, as `StageSession` already does.

## Out of scope
- Reading the bot's Cloud Logging logs (errors next to failed steps, input to AI failure analysis).
- Choosing demo or real bot per run (`CHATBOT_MODE` stays a `.env` setting that needs a restart).
- Editing stage settings (QA clinic, webhook URL, test phone) from the UI. They stay in `.env`.
- Any change to AI features (they work once `ANTHROPIC_API_KEY` is in `.env`).
- Service-account key files (removed, not kept as a fallback).
- WhatsApp forms, reminders and Dialogflow agent import (see `docs/07-developer-requests.md` "Ask later").
- Multi-user sign-in, hosting, or using cauce-herramientas itself.

## Definition of done
- Every FR (FR-1…FR-22) has at least one passing Vitest test that names it, with fakes and no network.
- `pnpm typecheck` and `pnpm test` pass in `app/`.
- `docs/architecture.md`, `app/.env.example` and `app/README.md` describe Google sign-in instead of the key file.
- Manual demo on salud-stage with `CHATBOT_MODE=stage`: sign in with a prestobots.com account; all six checks pass; "Send test hola" shows a bot reply; one starter test case passes on salud-stage. This needs read access to salud-stage for the admin's account and `TEST_PATIENT_PHONE` set.

## Open questions
None.
