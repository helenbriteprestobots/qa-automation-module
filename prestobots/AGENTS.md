# AGENTS.md — prestobots

## Project
Chatbot Testing Platform: plays patient stories (test cases) against the Cauce WhatsApp chatbot (a demo bot, or salud-stage inside the QA clinic) and shows detailed reports. It also covers AI test authoring and judging, test generation and Jira cards. Runs locally with no login. Code lives in the pnpm workspace `app/`. `apps/server` (Fastify API, run/generation queue, SQLite in `app/data/platform.db`) and `apps/web` (React + Vite + Tailwind) sit on three packages: `packages/shared` (zod schemas), `packages/runner` (channels, checks, explore) and `packages/ai` (all Claude calls). `docs/` holds research and scope. `repos/` holds read-only copies of client repos; never edit them.

## Commands
Run from `app/` (`npx pnpm@10.10.0 …` if pnpm isn't installed):
- Install: `pnpm install`
- Run: `pnpm dev` (server :4000 + web :5173 with hot reload); `pnpm start` (build + serve on :4000)
- Tests: `pnpm test`
- Typecheck: `pnpm typecheck`

## Style
- Node ≥22.12, TypeScript 5.9 ESM, `strict` + `noUncheckedIndexedAccess`. Relative imports use the `.ts` extension. Arrow functions, `type`-only imports, zod for every boundary (env, HTTP bodies, DB rows, LLM output).
- Format like the existing code: 2 spaces, single quotes, semicolons, es5 trailing commas, ~120 cols.
- Minimal dependencies: justify each new one in the spec.
- Identifiers, comments and UI text in English, in plain words for non-technical admins. Test-case stories and bot texts in Spanish.

## Rules
- Read `docs/architecture.md` before changing code; keep it up to date when the structure changes.
- Read `docs/constitution.md` and the active spec (the `specs/NNN-<slug>/spec.md` with `Status: Active`) with its `plan.md` and `tasks.md` before touching code. Implement by working through `tasks.md` in order, one task at a time, ticking each when its check passes.
- New features start as a spec: `specs/NNN-<slug>/spec.md` from `specs/_templates/spec.md`, then its `plan.md` and `tasks.md` from `specs/_templates/` (`/spec-create`, `/spec-review`, `/spec-plan`, `/spec-tasks`), implemented with `/spec-implement` and closed with `/spec-create done`.
- Work test-first (TDD) on new and changed code: for every behavior, write the test, run it and see it fail for the expected reason, then implement until it passes, then refactor with all tests green.
- Never weaken the salud-stage guard (`packages/runner/src/stage/guard.ts`), never write to the chatbot's Firestore, never commit `.env`, `secrets/` or `data/`.
- Do not add dependencies or change data formats (zod schemas in `packages/shared`, SQLite tables) without updating the spec first.
- Do not modify files inside `specs/` unless explicitly asked.
- Follow docs/git-standards.md for branches, commits and pull requests (commands: `/git-branch`, `/git-commit`).

## When finishing any task
- Run `pnpm typecheck` and `pnpm test` in `app/`, and confirm in your response that everything passes.
