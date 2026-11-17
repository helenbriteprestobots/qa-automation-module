# Chatbot Testing Platform

Plays patient stories (test cases) against the Cauce chatbot and shows a detailed report.
Runs on your computer. Plans and scope: [`../docs/06-mvp-scope.md`](../docs/06-mvp-scope.md).

**Included so far:**
- **Iteration 1:** test cases, manual runs, live progress, detailed report, a demo bot, and the
  connection to the real chatbot on salud-stage (waiting for access from the developers).
- **Iteration 2:**
  - writing and changing test cases in your own words, with "Try it";
  - the AI judge check;
  - AI explanations of failures and run summaries;
  - the monthly budget legend and Settings page.
- **Iteration 3:** Jira cards from failed tests (new card, or a comment on an earlier one).

**Not yet:** automatic test-case generation, WhatsApp forms.

## Start it

Requires **Node 22.12+**.

```bash
cd app
npx pnpm@10.10.0 install      # first time only
cp .env.example .env          # first time only; demo mode works without changes
npx pnpm@10.10.0 start        # builds the page and starts → http://localhost:4000
```

(`pnpm` alone also works if it is installed. `corepack` bundled with Node 22.12 has a known
signature bug, so `npx pnpm@10.10.0` is the safe way.)

For development with hot reload: `npx pnpm@10.10.0 dev`, then open http://localhost:5173.

## Demo mode vs stage mode

| `CHATBOT_MODE` | Talks to | Needs |
| --- | --- | --- |
| `demo` (default) | A simulated bot inside the platform. Lets you try everything today. | Nothing |
| `stage` | The real Cauce chatbot on **salud-stage**, in the QA clinic | Every value in the stage block of `.env` (see `docs/07-developer-requests.md`) |

In demo mode, `SAL-CANCEL-002` fails **on purpose** so you can see what a failure looks like.

The starter test cases follow the demo bot's menu. Against the real chatbot some option names will
be different. The first stage run will show which ones need adjusting.

## AI features

Add `ANTHROPIC_API_KEY` to `.env` (a key used only by this platform) and restart. The key comes
from the Claude Console (console.anthropic.com) and is billed per use from prepaid credits. That
is separate from a Claude Pro/Max subscription, which doesn't include API usage. Without it the
platform works the same, but writing tests with AI is disabled and AI-judge checks show as skipped.

| Feature | Model (configurable in `.env`) | When it runs |
| --- | --- | --- |
| Write or change a test case from your words | `AI_MODEL_AUTHOR` (Claude Opus 5.5) | When you click "Write the test case" / "Apply change" |
| AI judge check | `AI_MODEL_JUDGE` (Claude Haiku 5.5) | During runs, on steps that have an AI-judge check |
| Likely cause + run summary | `AI_MODEL_AUTHOR` | At the end of a run, only when something failed |

**Budget:**
- The header shows this month's spend: the platform's own calls, priced with Claude's price list.
- You set the monthly limit in **Settings**.
- At 80% the legend turns yellow.
- At 100% AI features pause, and tests still run with their rule checks.
- Also set a spend limit on the key itself in the Claude Console, as a hard stop.

## Jira cards

Add the Jira block from `.env.example` to `.env` and restart: site, account email, an
[API token](https://id.atlassian.com/manage-profile/security/api-tokens) for that account, project
key, and optionally labels and priority. Then use **Settings → Test the connection**. It only reads
from Jira and creates nothing.

- Every failed test in a run report has a **Create Jira card** button. The card is pre-filled, and you
  can edit the type (Bug or Task), the title and the description before sending.
- With AI on, Claude writes the title and the "What went wrong" paragraph, and suggests Bug or Task.
  Without AI, the card is filled from the test results.
- Each card includes the steps, what failed, the likely cause, and the full conversation. It never
  includes the test patient's phone number or any key.
- Nobody is assigned. Labels come from `JIRA_LABELS`, plus the test case id.
- If the test case already has a card, the platform offers to **add a comment** to it instead of
  creating a duplicate.
- The platform keeps only the link. It doesn't follow the card's status in Jira.
- The token needs the same rights as the account: it must be able to create cards in that project.
- Cards from demo-bot runs are marked `[DEMO]`.

## How stage mode works

```
the runner ──fake WhatsApp message (Gupshup format)──▶ webhookGupshupMessages (salud-stage)
     ▲                                                          │
     └──── reads the bot's replies (read-only) ◀── Firestore conversations/{id}/messages
```

- The chatbot finds the clinic by the Gupshup app name inside the message. The platform reads that
  name from the QA clinic, so you only configure the clinic id.
- Safety:
  - only `salud-stage` is allowed;
  - the key file must belong to salud-stage;
  - the webhook must be a Google Cloud address of that project;
  - anything that looks like production is refused.
- Every fake message id starts with `qa-`, so developers can spot test traffic in the logs.
- The platform never writes to the chatbot's database.

## Layout

```
apps/web        the web page (React + Vite + Tailwind)
apps/server     API, run queue, local storage (SQLite in data/platform.db)
packages/runner plays the patient: demo bot, salud-stage connection, checks
packages/ai     everything that talks to Claude: writing tests, judge, failure analysis, prices
packages/shared shared definitions: test case, run, chat message
```

Checks: `npx pnpm@10.10.0 test` and `npx pnpm@10.10.0 typecheck`.

## Where things are stored

- `data/platform.db`: test cases, runs, results. Copy it to back up.
- `.env` and `secrets/`: settings and keys. Ignored by git; never commit them.
