# Architecture — prestobots

> Baseline captured by `/init-project` on 2026-11-23 from the existing code. It describes what the code **is**, not what it should be. Update it when the structure changes; specs and plans use it as their starting point.

## Overview
The Chatbot Testing Platform (`app/`) is a local web app. Admins manage test cases (patient stories with steps and checks), run them against a chatbot and read the reports. The server plays each story through a **channel**: the built-in demo bot, or the real Cauce bot on salud-stage (fake Gupshup webhook messages in, replies read from Firestore). It stores everything in SQLite and streams run progress to the React page. Optional Claude features (authoring, AI judge, failure analysis, test generation) and Jira cards hang off the server.

Workspace layout: `app/` is the code. `docs/` holds research, scope and these docs. `repos/` holds read-only, git-ignored copies of the client repos (`cauce-webpage-main`, `prestobots-master`, `prestobotsv3-main`), used as context and, optionally, by generation (`CHATBOT_REPO_DIR`).

## Entry points
- `app/apps/server/src/index.ts`: wires config, store, channels, AI, Jira, run and generation managers. Seeds starter test cases. Listens on `127.0.0.1:${PORT}` (4000) and, in production, serves `apps/web/dist`.
- `app/apps/server/src/app.ts`: `buildApp()` with all HTTP routes under `/api` (status, ai usage/budget, test-cases CRUD/draft/trial, runs + SSE `/api/runs/:id/events`, generations, Jira check/draft/create, Google sign-in `/api/google/sign-in|callback|sign-out`, real-bot checks `/api/stage/checks` and `/api/stage/test-message`).
- `app/apps/web/src/main.tsx` → `App.tsx`: routes `/test-cases`, `/test-cases/new|:id|:id/edit`, `/generate[/:id]`, `/runs[/:id]`, `/settings`.

## Modules
| Path | Responsibility | Notes |
| ---- | -------------- | ----- |
| `app/packages/shared` | Domain types as zod schemas: test case, run, chat message, generation, Jira | No I/O; imported by all others |
| `app/packages/runner` | Plays a test case through a `Channel`, evaluates checks, explores menus | `channels/` (demo bot), `stage/` (Gupshup payload, Firestore REST client, Google sign-in tokens, Google guard, stage guard, message reader), `checks.ts`, `executeTestCase.ts`, `explore.ts`, `starterTestCases.ts` |
| `app/packages/ai` | Every Claude call: drafting, judge, failure analysis, proposals, Jira card text, pricing | Only importer of `@anthropic-ai/sdk` (`src/client.ts`) |
| `app/apps/server` | Config, storage, API, run queue, generation, Jira | `config.ts` (env via zod), `db.ts` (`Store`), `runManager.ts`, `generation/`, `jira/`, `ai.ts` (facade + budget), `google/` (sign-in flow, session file), `stage/stageService.ts` (connection checks, test message, busy rule) |
| `app/apps/web` | Admin web page | React 19, TanStack Query, `api.ts` client, `pages/`, `components/` (incl. `RealBotCard`), `stageSettings.ts` (pure helpers, tested) |

## Data
- One SQLite file, `app/data/platform.db` (`DATABASE_FILE`), accessed via better-sqlite3 in `apps/server/src/db.ts` (`Store`). WAL mode.
- Tables: `test_cases`, `runs`, `test_results`, `ai_usage`, `settings`, `generations`, `jira_cards`. Each keeps the full object as JSON in `data` (validated with `packages/shared` schemas on read) plus filter/sort columns.
- The schema is created on startup with `CREATE TABLE IF NOT EXISTS`. There are no migrations.
- External, read-only: salud-stage Firestore `organizations/{org}` (name, Gupshup app only) and `conversations/{id}/messages`.
- The admin's Google sign-in: `app/secrets/google-session.json` (email + refresh token, mode 0600, validated with `googleSessionSchema`). Never sent to the web page, logs or Jira.

## External dependencies and integrations
- Node ≥22.12, pnpm 10.10, TypeScript 5.9, tsx 4, Vitest 3.
- Server: Fastify 5, @fastify/static 8, better-sqlite3 11, zod 3.
- Web: React 19, Vite 7, Tailwind 4, @tanstack/react-query 5, react-router-dom 6, lucide-react.
- Runner: no Google SDK. salud-stage is read through Firestore's REST API with `fetch`, signed in with the admin's prestobots.com Google account (OAuth for installed apps, scopes `openid email cloud-platform`; default client: firebase-tools' public one, overridable with `GOOGLE_OAUTH_CLIENT_ID/SECRET`).
- AI: @anthropic-ai/sdk 1.9. Models are set by `AI_MODEL_AUTHOR` (claude-opus-5-5) and `AI_MODEL_JUDGE` (claude-haiku-5-5), with a monthly budget.
- Jira Cloud REST (cards in ADF, `apps/server/src/jira/`).
- Env (`app/.env`, template `app/.env.example`): `CHATBOT_MODE`, `PORT`, `DATABASE_FILE`, `STAGE_*`, `TEST_PATIENT_*`, `TEST_RESET_MESSAGE`, `REPLY_TIMEOUT_SECONDS`, `GOOGLE_OAUTH_CLIENT_ID/SECRET` (optional), `CHATBOT_REPO_DIR`, `ANTHROPIC_API_KEY`, `AI_MODEL_*`, `AI_MONTHLY_BUDGET_USD`, `JIRA_*`.

## Commands
Run in `app/` (`npx pnpm@10.10.0 …` if pnpm isn't installed):
- `pnpm install`
- `pnpm dev`: server (`tsx watch`) + web (Vite :5173, proxies `/api` to :4000) in parallel
- `pnpm build`: builds the web page
- `pnpm start`: build + server in production mode on :4000
- `pnpm test`: `vitest run` in every package
- `pnpm typecheck`: `tsc --noEmit` in every package
- There are no lint, format or migration commands.

## Testing today
- Vitest. Tests live in `<package>/test/*.test.ts`:
  - `apps/server`: api, generation, jira, google (sign-in and session file), stageChecks, stageTest (92 cases);
  - `packages/runner`: checks, demoRun, explore, stage, stageChannel, firestoreRest, googleGuard, googleToken (76 cases);
  - `packages/ai`: ai, schemas (9 cases);
  - `packages/shared`: google (7 cases);
  - `apps/web`: stageSettings (9 cases).
- Tests run against the demo bot and fakes. They need no network or keys.

## Conventions observed
- ESM, strict TS with `noUncheckedIndexedAccess`, relative imports with `.ts` extensions, `type` imports, arrow functions, small modules.
- zod at every boundary: env, request bodies, DB rows, LLM structured output.
- Errors carry plain-language, actionable messages (e.g. `GuardError`, `AiError`, `StepError`).
- Style: 2 spaces, single quotes, semicolons, es5 trailing commas, ~120 cols. This is enforced by habit only; there is no formatter config.
- English identifiers, comments and UI text. Spanish test stories, starter cases and bot texts.

## Known gaps and risks
- No formatter or linter (target: Biome) and no CI for `app/`.
- `apps/web` only tests its pure helpers; React components are checked by hand.
- No DB migrations: schema changes rely on JSON stored in rows and `IF NOT EXISTS`.
- Stage mode is waiting on developer access (`docs/07-developer-requests.md`). The Dialogflow agent file and WhatsApp forms are not supported yet.
- Security findings in the client repos are listed in `docs/README.md`.
