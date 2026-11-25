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
- **Iteration 4:** "Generate test cases": the platform explores the bot's menus, the AI proposes
  tests for what isn't covered, each one is tried twice, and you approve or reject them.

**Not yet:**
- reading the Dialogflow agent file, which is waiting for the file from the developers;
- WhatsApp forms.

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
| `stage` | The real Cauce chatbot on **salud-stage**, in the QA clinic | The stage block of `.env`, and signing in with your prestobots.com Google account in Settings |

In demo mode, `SAL-CANCEL-002` fails **on purpose** so you can see what a failure looks like.

### Setting up stage mode

1. Ask Pachi for a **prestobots.com Google account** with **read access (Cloud Datastore Viewer) on
   salud-stage**. It is the same access cauce-herramientas uses, but on salud-stage instead of salud-prod.
2. In `app/.env`: `CHATBOT_MODE=stage`, the QA clinic (`STAGE_QA_ORG_ID`), the webhook address
   (`STAGE_WEBHOOK_URL`) and the test phone (`TEST_PATIENT_PHONE`, digits only with country code).
   Restart the platform.
3. Open **Settings → Real bot (salud-stage)** and click **Sign in with Google**. Choose your
   prestobots.com account. Google asks for access to your Google Cloud data: the platform only reads,
   because your account can only read.
4. The card shows six checks (settings, safe target, signed in, prestobots.com account, can read
   salud-stage, QA clinic found). Each failed check says what to do. **Check again** runs them now.
5. **Send test hola** sends one message as the test patient and shows the bot's reply and how long it took.

No key file is needed (`STAGE_SERVICE_ACCOUNT_FILE` is no longer used). The sign-in is saved in
`secrets/google-session.json`, which only you can read and which is never sent to the web page or to
Jira. **Sign out** deletes it. If the sign-in expires, the checks and runs say so: sign in again.

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

## Generate test cases

**Test cases → Generate test cases** (needs the AI). The steps:

1. **Explore.** The platform says "Hola" and taps through the menus, one new conversation per path:
   - up to 3 taps deep and 25 paths;
   - it never types;
   - it never taps options that could book, confirm or cancel an appointment, pick an appointment
     time, or hand the chat over to clinic staff. These options are listed as "not tapped", with the
     reason.
2. **Your OK.** You see what was found and the estimated AI cost. Nothing is paid before you click
   **Continue**.
3. **The AI proposes.** Proposals cover what existing tests don't, and never repeat a proposal you
   rejected. In stage mode the AI also reads the WhatsApp booking form from the chatbot code
   (`CHATBOT_REPO_DIR`, by default `../repos/prestobotsv3-main`), if that copy exists.
4. **Each proposal is tried twice.** It is marked "Passed its trial", "Failed its trial" or
   "Inconsistent".
5. **You review** in **Test cases → To review**:
   - **Approve:** it joins "Run all active".
   - **Change with AI:** adjust it before approving.
   - **Reject:** optionally say why. The AI won't propose it again.

Runs and generation never use the chatbot at the same time, because both talk as the same test
patient.

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
     └──── reads the bot's replies (read-only, as you) ◀── Firestore conversations/{id}/messages
```

- The chatbot finds the clinic by the Gupshup app name inside the message. The platform reads that
  name from the QA clinic, so you only configure the clinic id.
- Safety:
  - only `salud-stage` is allowed;
  - you must be signed in with a prestobots.com Google account;
  - Google requests only go to Google's sign-in addresses and salud-stage's Firestore data;
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
