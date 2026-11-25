# prestobots

Chatbot Testing Platform for the Cauce (PrestoBots Salud) WhatsApp chatbot. Non-technical admins create, run and review patient-story test cases against a demo bot or salud-stage, with AI authoring and judging, test generation and Jira cards.

## Stack
- Node ≥22.12, TypeScript 5.9 (strict), pnpm 10.10 workspaces in `app/`
- Fastify 5 (server), React 19 + Vite 7 + Tailwind 4 (web)
- SQLite (better-sqlite3) in `app/data/platform.db`
- Vitest

## Getting started
```bash
cd app
npx pnpm@10.10.0 install
cp .env.example .env          # demo mode works without changes
npx pnpm@10.10.0 start        # → http://localhost:4000  (dev: `pnpm dev` → :5173)
npx pnpm@10.10.0 test
```

Full usage guide: [`app/README.md`](./app/README.md). Research and scope: [`docs/`](./docs/README.md). Architecture: [`docs/architecture.md`](./docs/architecture.md).

## How this project is developed
Development is spec-driven and test-first:
- [`AGENTS.md`](./AGENTS.md) — entry point and rules for coding agents.
- [`docs/constitution.md`](./docs/constitution.md) — non-negotiable principles.
- [`specs/`](./specs/) — one folder per feature (`NNN-<slug>/`) with `spec.md` (what/why), `plan.md` (how) and `tasks.md` (ordered checklist); templates in `specs/_templates/`.

Workflow: `/spec-create` → `/spec-review` → `/spec-plan` → `/spec-tasks` → `/spec-implement` → `/spec-create done`.
