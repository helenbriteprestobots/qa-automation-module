# prestobotsv3-main — Current PrestoBots platform (Salud/Cauce + Turnos)

> The current platform. The folder is named v3, but `package.json` still says `prestobotsv2`, and
> the README and docs say "Prestobots v2". It's a pnpm + Turbo monorepo with one TypeScript Cloud
> Functions source (Functions **v2**). That source is deployed as **two Firebase codebases/products**:
> **Salud** (brand **Cauce**, for clinics on Macena/Geclisa) and **Turnos** (generic SaaS booking).
> About 1,700 TS/TSX files and 358 Jest test files. It has its own extensive docs in `docs/`, listed in §11.

## 1. At a glance

| Item | Value |
| --- | --- |
| Tooling | Node **22**, **pnpm 10** (`packageManager: pnpm@10.10.0`), **Turbo 2**, Husky + lint-staged, Prettier, ESLint 9, knip, semantic-release |
| Backend | Firebase Functions **v2** (`firebase-functions@7`), TypeScript, bundled with **esbuild**, region pinned to `us-central1` in `src/config/globalOptions.ts` |
| NLU / engines | **Dialogflow CX** (main), Dialogflow ES (legacy orgs), "conversational agent", **n8n** automations. Selected per org via `ChatbotEngineId` |
| Channels | WhatsApp via **Gupshup** (v2 + v3 webhooks) and **Meta WhatsApp Business API** (embedded signup); **webchat**; **ElevenLabs** (voice); email via **AWS SES** |
| WhatsApp Flows | Encrypted `data_exchange` Flows endpoint (`flowEndpoint`). Main one: salud **turnos** flow (`products/salud/flows/turnos/flow.json`) and generic decision-tree flows per client (`core/flows/generic/{asistir_ac,osuthgra,punto_deporte,suma_salud}`) |
| HIS | **Macena/Geclisa** (`products/salud/.../macena`), MrTurno 5 (`ThirdPartySoftwareId`) |
| Payments | **MercadoPago** OAuth marketplace (deposits/"señas") + SaaS subscriptions (Turnos) |
| Other | Google Calendar sync, Cloud Tasks (reminders), Pub/Sub everywhere, Secret Manager, Slack, Qdrant (KB for the Cauce assistant), GA4 |
| Firebase projects | `turnos-stage`, `turnos-prod`, `salud-stage`, `salud-prod` (aliases `turnos:stage`, …). Each project has 2 Firestore DBs: its own `(default)` plus the other product's named DB (`salud`/`turnos`) |
| Frontends | React 19 + Vite 7 + Tailwind 4 + DaisyUI + Zustand + react-router 7 + i18next + Firebase JS 12 |

## 2. Workspace layout

```
apps/
  salud/dashboard     @pb/salud-dashboard   Cauce admin dashboard (181 TSX)        hosting: salud-dashboard
  salud/reminders     @pb/salud-reminders   Patient reminder landing (confirm/cancel from email link)  hosting: salud-reminders
  turnos/dashboard    @pb/turnos-dashboard  Turnos admin dashboard (102 TSX)        hosting: turnos-dashboard
  turnos/booking      @pb/turnos-booking    Public booking page  /c/:publicSlug     hosting: booking
  webchat             @pb/webchat           Embeddable webchat   /o/:slug           hosting: webchat (both products)
packages/
  core/types          @pb/core-types        Shared TS types/enums (ROLE, COLLECTIONS-related types, integrations…)
  core/utils          @pb/core-utils        Constants (COLLECTIONS map, timezone, CX base URL…) and helpers
  core/services       @pb/core-services     Frontend Firebase services (auth store, conversations, contacts, orgs…)
  core/shared         @pb/core-shared       Zustand stores, hooks, providers, middlewares
  core/ui             @pb/ui                Shared components (TipTap editor, pickers…) built with tsup
  pages               @pb/pages             Shared pages: Chats (inbox), Contacts, ContactScore, Login, ForgotPassword, Users, LogsActivity, NoAccess, NotFound
functions/            Single Functions source for both products
docs/                 Repo docs (plans/, features/, how-to/, kb/, reviews/)
scripts/              setup-env.js, setup-secrets.sh, cherry-pick-stage-to-main.sh, diff-coverage, staged test/typecheck, qdrant_kb/
.claude/skills/       crear-pr, flows, maquetas, revisar-reglas (Claude Code skills, in Spanish)
firestore.{salud,turnos}.rules / *.indexes.json, storage.rules, storage.lifecycle.json
firebase.json (deploy), firebase.local.json (emulators with per-codebase prefix), firebase.debug.salud.json (inspect)
```

`pnpm-workspace.yaml` also lists `packages/core/{chats,rules,campaigns,contacts,auth,organization}`.
**These don't exist on disk.** They're leftovers that pnpm ignores. `llms.txt` (180 KB) is
MercadoPago developer documentation kept for LLM context. It doesn't describe this repo.

## 3. Commands (from the repo root)

```bash
pnpm install
pnpm dev:salud        # setup-env salud → emulators (functions:salud + pubsub, project salud-stage) + fn watch + salud dashboard + webchat + reminders
pnpm dev:salud:prod   # same against salud-prod (careful)
pnpm dev:salud:debug  # with --inspect-functions=9229
pnpm dev:turnos       # emulators (auth, functions:turnos, firestore, pubsub, storage; turnos-stage) + fn watch + turnos dashboard + booking + seed plans
pnpm build | lint | test | format | format:check
pnpm test:coverage    # functions coverage

# Functions (cd functions)
pnpm build            # tsc --noEmit && esbuild
pnpm build:watch
pnpm test             # = test:required (Core + Salud with coverage thresholds)
pnpm test:salud | test:all | test:watch | test:debug
pnpm deploy:salud-stage | deploy:salud-prod | deploy:turnos-stage | deploy:turnos-prod   (+ :batched)
node scripts/deploy.js --product=salud --env=prod --build-only|--skip-build|--batched|--function=X|--exclude=X|--release=TAG
pnpm deploy:flows --env=stage|prod   # publish WhatsApp Flow JSONs to Meta

# Root deploy shortcuts
pnpm deploy:dashboard:salud:stage|prod, deploy:reminders:salud:*, deploy:dashboard:turnos:*, deploy:webchat:{salud,turnos}:*, deploy:booking:turnos:*
pnpm deploy:firestore:{salud,turnos}:{stage,prod}     # rules + indexes (NOT deployed with functions)
pnpm release:prod                                       # functions/src/scripts/release/release.ts
pnpm sync:gupshup-templates | sync:gupshup-templates-to-db
```

Env handling: `scripts/setup-env.js <product> <dev|build> [env]` merges `functions/.env[.build].<product>[.<env>]`
into `functions/.env`. Frontends use Vite modes (`.env.stage`, `.env.production`, `turnos-stage`…).
Frontend env vars: `VITE_FIREBASE_*`, `VITE_FUNCTIONS_PREFIX` (callable name prefix, e.g.
`salud-` in emulators), `VITE_FUNCTIONS_EMULATOR_HOST|PORT`, `VITE_EMULATE_AUTH|FIRESTORE|FUNCTIONS`,
`VITE_RECAPTCHA_SITE_KEY` (App Check), `VITE_WEBCHAT_URL`, `VITE_PUBLIC_BOOKING_URL`,
`VITE_GA4_MEASUREMENT_ID`, `VITE_ENCRYPTION_SECRET_KEY`, and others.

### Local environment caveats (important for testing)

- **Salud local = remote stage data.** `dev:salud` only emulates `functions:salud` and `pubsub`.
  Auth and Firestore hit **salud-stage**. Per `docs/how-to/development-and-deployment.md`: *"No hay
  emulador de Firestore en este repo"* for salud, so new rules and indexes don't exist locally
  until they're deployed.
- **Turnos local = full emulators** (auth 9099, firestore 8080, functions 5001, pubsub 8085,
  storage 9199, UI 4000) plus `seed:plans`.
- In emulators, callables are prefixed (`firebase.local.json` sets `prefix: salud|turnos`), which
  is why frontends call `${VITE_FUNCTIONS_PREFIX}-name`.
- Webchat in dev only emulates Functions. Auth and Firestore stay online.
- **App Check is enforced** on webchat callables except when `FUNCTIONS_EMULATOR === 'true'`.

## 4. Build and deploy pipeline

- `functions/scripts/deploy.js` builds the packages, typechecks, bundles, and copies everything to a
  temporary `functions-build/` (or the `functions-salud` / `functions-turnos` mirrors). It vendors
  `workspace:*` packages into `_workspace/` with `file:` paths, then deploys and cleans up.
  **Never edit the generated mirror folders.**
- It uses the repo's pinned `firebase-tools@14.27.0` and refuses other versions. A CLI version
  mismatch once deployed the same subscribers in two regions and processed each message twice
  (see `docs/plans/release-a-prod.md`). That's why `setGlobalOptions({ region: 'us-central1' })`
  must be the **first import** of every entrypoint.
- Batched deploys (40 functions, then a 65 s cooldown) avoid the GCP "Quota exceeded" error. They're
  **mandatory on a fresh project** (80+ functions).
- Deploy new Firestore composite indexes **before** the code that queries them, or the query fails
  with `FAILED_PRECONDITION`.
- Secrets: static platform secrets are `defineSecret` in `src/config/secrets.ts`, grouped in
  `functionSecrets.ts` and read at runtime via `runtimeSecrets.ts`. They include `GUPSHUP_*`,
  `GOOGLE_CLIENT_*`, `MERCADOPAGO_*`, `WHATSAPP_*`, `SLACK_API_KEY`, `MR_TURN5_PRIVATE_KEY`,
  `SUPERADMIN_SETUP_SECRET`, `AWS_*` (SES) and `ORCHARD_API_KEY` (speech-to-text). Per-tenant
  secrets go through `secretManagerService`. See `docs/how-to/security/secrets-convention.md`.

### CI/CD (`.github/workflows/`)

| Workflow | Trigger | Does |
| --- | --- | --- |
| `pull-request.yml` | PR → `stage` | Validates the conventional-commit PR title and posts a sticky comment |
| `pr-coverage.yml` | PR → `stage` | Runs `functions test:coverage`, then `scripts/report-cauce-diff-coverage.mjs` (diff coverage), comments on the PR and fails under the threshold |
| `deploy-hosting-on-pr.yml` | PR | Builds the salud dashboard and deploys a Firebase Hosting **preview channel** |
| `stage-release.yml` | push `stage` | semantic-release **beta** per package |
| `deploy-after-release-stage.yml` | after stage release / manual | Builds and deploys functions plus hosting to stage |
| `merge-to-prod.yml` | manual | Merges the selected PRs into `main` |
| `production-release.yml` → `deploy-after-release-prod.yml` | push `main` | semantic-release, then deploy to prod |
| `repo-settings.yml` | push | Repository settings |

Git hooks: **pre-commit** runs `lint-staged`, a staged-functions typecheck and staged-related
tests. **pre-push** runs `functions test:required`.
Branch naming is `<tipo>/V2-<ticket>-<desc>`, with conventional commits like `feat(V2-123): …`.
Work branches off `stage` and promotes to `main`.

## 5. Functions source map (`functions/src`)

Entrypoints: `index.ts` (local, loads dotenv, exports everything), `index.core.ts` (shared),
`index.salud.ts` (core + salud), `index.turnos.ts` (core + turnos), `index.salud.single.ts`.

```
config/         globalOptions (region), secrets, functionSecrets, runtimeSecrets
core/
  callables/    onCall APIs used by dashboards (≈19 files)
  cron/         onSchedule jobs
  flows/        WhatsApp Flows engine: router, journey, handoff, managements, notices, media, generic/ (per-client trees)
  services/     ≈50 services (conversation, contact, campaign, rules, flowSession, gupshup, whatsappBusiness, dialogflowCX/ES, n8n, cloudTasks, lock/lease, email, transcription…)
  subscribers/  Pub/Sub consumers (whatsapp/*, campaigns, conversations, logs…)
  triggers/     Firestore triggers (support-session analytics)
  utils/        handler.ts (incoming message pipeline), engines.ts, flowCrypto, logger, builders…
  webhooks/     onRequest endpoints
products/
  salud/        callables, cron, flows (macena, turnos), services, subscribers, triggers, utils, webhooks (macena/*)
  turnos/       cron, dashboard (callables), routers (Express REST API), services, triggers, webhooks, scripts
scripts/        ops/migration/QA scripts run with tsx (see §10)
```

### 5.1 Message pipeline (WhatsApp via Gupshup)

```
Gupshup ─▶ webhookGupshupMessages (onRequest)
             • ignore non-"message" events (ACK 200)
             • map payload.type → topic via GUPSHUP_EVENTS_TYPES (handle-text, handle-image, handle-list-reply, …)
             • buildGupshupTopicParams → org lookup by Gupshup app
             • handleConversation (create/update conversations/{id})
             • publishToTopic
                    ▼
        handleText | handleImage | handleAudio | handleButtonReply | handleListReply | handleQuickReply |
        handleLocation | handleContact | handleFile | handleSticker | handleVideo | handleReaction (onMessagePublished)
                    ▼
        core/utils/handler.ts#processIncomingMessage
             • replies to campaign / Macena reminder messages (context.gsId) → mark READ / appointment response
             • addMessageToConversation (conversations/{id}/messages)
             • pending-closure response handling
             • stop if conversation.isInterveningConversation || botStopped || org botStopConfig.isBotStopped
             • sendMessageToEngine (engines.ts): DF CX / ES / conversational agent / n8n
             • if the engine returns a Flow → send a WhatsApp Flow; otherwise map to Prestobots messages → provider delivery
Delivery events: webhookGupshupEvents → handleMessageEvent{Sent,Delivered,Read,Failed}
Meta path: whatsappBusinessWebhook (+ whatsappBusinessAuthorize/Callback/Config for embedded signup)
WhatsApp Flows: Meta → flowEndpoint (decrypt, verify signature, resolve flowSession by flow_token,
                route to products/salud/flows/turnos/router or core/flows/generic/router, re-encrypt)
Dialogflow CX fulfillment: cxEndpoint; rules engine: handleRulesRequest / getOrganizationRulesOnRequest;
HIS-agnostic webhook: thirdPartySoftwareWebhook; legacy-compatible: genericWebhook
```

### 5.2 Webchat pipeline (handy for testing)

`apps/webchat` (`/o/:slug`) signs in **anonymously**, with App Check via reCAPTCHA v3, and then calls:

1. `getWebchatConfig({ publicSlug })` → org branding and config
2. `initWebchatSession({ publicSlug, userMetadata })` → creates or reuses a conversation
3. `sendWebchatMessage({ conversationId, organizationId, content, userMetadata, attachmentData })`
   saves the user message, calls `sendMessageToEngine` **synchronously**, and writes the bot reply
   to `conversations/{id}/messages`. If the engine fails, it writes the org fallback
   (`settings.fallback.messageBeforeStopping`).

So webchat exercises the engine (CX intents, rules, HIS calls) without WhatsApp. It **doesn't**
exercise WhatsApp-only features like Flows, interactive lists or templates. `cleanupAnonymousUsersCron`
removes the anonymous users daily.

### 5.3 Core exports (both products)

- **Callables:** activities, API cache refresh, attachments (upload/signed URL/process), flow
  attachments, **billing** (close month, configs, PDFs, analytics), **blocklist**, **campaigns**,
  **contacts** (CRUD, stats, silence, block, tags), **conversations** (send as user/bot,
  intervention, transfer, bot stop, resolve, status, tags, mark read, history), **gupshup**
  (templates CRUD/sync/analytics, business profile, usage), **organizations** (create, load,
  update, bot status), quick responses, **rules**, **tags**, template messages, **users** (invite,
  accept, revoke, setRole, setSuperAdmin, setUserOrganization, delete, list), **webchat**,
  WhatsApp Business auth, `syncIntentFlowsFromCX`.
- **Crons:** `dailyAnalyticsReportCron` (00:01), `apiCacheUpdateSchedule` (04:00, 06:00),
  `campaignSender` (every 10 min), `cleanupAnonymousUsersCron` (23:50),
  `conversationsClosureSchedule` (every 5 min), `conversationsWindowClosure` (every 10 min),
  `expireFlowSessionsCron` (hourly), `gupshupUsageCron` (16:00),
  `supportSessionAnalyticsReconcileCron` (06:00). Timezone is mostly `America/Argentina/Buenos_Aires`.
- **Subscribers:** activity records, analytics report, API cache, campaign sender, conversation
  logs, closures, provider delivery, send-as-user engine, support sessions, flow attachments, rule
  execution logs, plus the WhatsApp handlers above.
- **Webhooks:** analytics (`getAnalyticsReport`, `process*Analytics`), `setConversationSummary`,
  `closeConversationTask` (Cloud Task), `cxEndpoint`, `flowEndpoint`, `genericWebhook`,
  `webhookGupshupEvents`, `webhookGupshupMessages`, rules, `sendGupshupTemplate`,
  `thirdPartySoftwareWebhook`, `whatsappBusinessWebhook`.

### 5.4 Salud exports (Cauce)

- **Callables:** appointment cube reports (`getAppointmentCubeAxis|Summary`), billing email, contact
  score distribution, **FAQs** CRUD, funnel data, health catalog, **locations**, **practices**,
  Macena helpers (cancellation reasons, enabled specialties, massive-cancelled, professionals),
  org channels/integrations/sections, `reminderEmailView/Response`, **reminder runs** (list,
  report, chains, CSV export, pause/resume), reminder settings.
- **Macena webhooks** (called by CX/Flows): `getHealthPractices`, `getMacenaAllServicesData`,
  `getMacenaInsurances`, `getMacenaPatients`, `getMacenaPendingAppointments`,
  `getMacenaProfessionalSchedule`, `getMacenaProfessionals`, `getMacenaSpecialties`,
  `macenaAppointmentAction`, `macenaCampaignAppointmentResponse`, `registerMacenaPatient`,
  `resolveMacena{Insurance,Professional,ProfessionalInsurance,SlotSelection,Specialty}`. These are
  documented one by one in `docs/features/salud/*.md`.
- **Reminders engine (Cloud Tasks):** `generateReminderRunTask` → `deliverReminderTask` →
  `reminderRunCompletionCheckTask` → `reminderRunFinalizeSubscriber`. SES events arrive through
  `sesReminderEvents`. The patient landing is `apps/salud/reminders`. See
  `docs/features/salud/Reminders.md`.
- **Appointments:** `getHealthAppointments`/`saveHealthAppointments`, `backfillAppointments` +
  `appointmentBackfillSubscriber`, `onSaludAppointmentWritten` trigger → `saludAppointmentEventSubscriber`,
  attendance, confirm/cancel sync, provider sync, `bookingNoticeSubscriber`,
  `contactScoreNightlySubscriber` (scoring).
- **Crons:** `apiSubcollectionCron` (07:00, syncs Macena catalogs into org subcollections),
  `appointmentReconciliationCron` (00:30).
- Others: `updateAPISubcollection`, `createElevenLabsConversation`.

### 5.5 Turnos exports

- **REST API** `appointments` (Express, `products/turnos/routers/app.ts`): `/v1/plans`,
  `/v1/orgs` (subscriptions, services, agendas), `/v1/availability` + `/v1/holds`,
  `/v1/appointments`, `/v1/ics`, `/v1/deposit-payment`, and public `/v1/public/*`
  (organizations, agendas, availability, holds, appointments, `qr-init`).
- **Callables:** appointments (create, confirm, cancel, complete, no-show, list), usage,
  subscriptions, MercadoPago OAuth, Google Calendar auth, **onboarding wizard** (`initialize`,
  `updateOnboardingStep`, `createOnboardingService|Agenda`, schedule/settings/policies,
  `regenerateSlots`, `completeOnboarding`), blocked dates.
- **Crons:** `checkGracePeriods` (00:00), `cleanExpiredHolds` (every minute),
  `completePastAppointments` (hourly), `generateUpcomingSlots` (06:00),
  `renewGoogleCalendarWatches` (03:00).
- **Triggers:** `onUserCreate` (creates the org, sets claims `{role: ADMIN_ORG, organizationId}`,
  initializes `settings.onboarding`), Google Calendar on appointment create/update, contact stats.
- **Webhooks:** `mercadoPagoWebhook`, `googleCalendarOAuthCallback`, `googleCalendarWebhook`.

## 6. Data model (Firestore)

Collection names live in `packages/core/utils/src/constants.ts` (`COLLECTIONS`). Main ones:
`organizations` (settings: engines, `gupshup`, `macena`, `botStopConfig`, `fallback`, onboarding…),
`conversations` + `conversations/{id}/messages`, `contacts`, `contactStats`, `campaigns`,
`campaignMessages`, `templates`, `rules`, `ruleExecutionLogs`, `tags`, `activities`,
`attachments`, `flowSessions`, `flowAttachments`, `managementEvents`, `managementSnapshots`,
`supportSessions`, `responseIntervals`, `conversationLogs`, `locks`, `billing` (+ `sentHistory`),
`analytics`, `faqs`, `inboxViews`, `inboxMenus`, salud `appointments`, `healthAppointments`
(+ slots), `reminderSettings`, `reminderRuns`, `reminderMessages`, `bookingNotices`,
`scoreEvents`, `scoreGuardDays`, catalog subcollections (`locations`, `practices`,
`professionals`, `specialties`, `filterMacenaReminder*`) and turnos `depositPayments`.
Rules: `firestore.salud.rules`, `firestore.turnos.rules`. Indexes: `firestore.*.indexes.json`.

## 7. Auth and roles

`ROLE` (`packages/core/types/src/auth.ts`) has a numeric hierarchy: `disabled`(0) < `user`(1) <
`admin_org`(20) < `soporte`(30) < `admin`(40) < `su`(100). Custom claims are
`{ role, organizationId, assignedTags }`. `ProtectedRoute` in each dashboard checks
`allowedRoles` and requires an org unless the role is `soporte` or higher. It polls claims while
`pendingSetup` is set and remembers the deep link for after login. Support and admin users get an
organization switcher (`docs/features/support/organization-switcher.md`). Some screens are gated by
Remote Config (for example `reminders_min_role`).

## 8. Frontends

### Salud dashboard (`apps/salud/dashboard`, Cauce)

Routes (`src/constants/routes.tsx`):

- Public: `/login`, `/forgot-password`, `/no-access`.
- Main: `/` (home), `/dashboard`, `/chats` and `/chats/:conversationId` (inbox from `@pb/pages`),
  `/contacts`, `/campaigns`, `/recordatorios` and `/recordatorios/:runId`.
- Reports: `/reportes`, `/reportes/turnos`, `/reportes/pacientes`.
- Users and logs: `/users`, `/logs`.
- Settings: `/settings/{chats,health-preferences,quick-replies,labels,practices,locations,faqs,billing,reminders,booking-notice,whatsapp,users,workflows}`.
  Old `/settings/{preferences,coverage-validation,cancellations}` URLs redirect.
- Admin: `/admin/settings/{profile,organization[/:orgId],notifications,preferences,billing,rules,logs,users}`
  and `/admin/logs`.

### Turnos dashboard (`apps/turnos/dashboard`)

`/login`, `/forgot-password`, `/no-access`, `/onboarding-setup`, `/setup` (onboarding wizard),
`/`, `/help`, `/campaigns`, `/dashboard`, `/chats[/:conversationId]`, `/contacts[/:id]`,
`/reservas`, `/users`, `/logs`, `/subscription[/success]`,
`/settings/{preferences,bot,quick-replies,labels,campaigns,whatsapp,users,workflows,agendas[/:agendaId[/blocked-dates[/create]]],qr-code,payments,google-calendar}`,
and `/admin/...` as in salud. New users are redirected to `/setup` until
`organization.settings.onboarding.isCompleted` is set (`docs/how-to/onboarding.md`).

### Other apps

- **Booking** (`apps/turnos/booking`): `/c/:publicSlug`. Public, no auth. Uses the `appointments`
  REST public routes (availability, holds, appointment, deposit through MercadoPago).
- **Webchat** (`apps/webchat`): `/o/:slug`, embeddable (`test-embed.html`). Anonymous auth plus App
  Check (§5.2).
- **Salud reminders** (`apps/salud/reminders`): single screen opened from a reminder email link
  with a token. Shows the appointment and lets the patient confirm or cancel (`reminderEmailView`
  / `reminderEmailResponse`). Strict CSP headers are set in `firebase.json`.

## 9. Tests that exist

- **Backend only.** Jest + ts-jest (ESM), 358 test files in `functions/test/**` (mirroring `src`)
  plus `src/**/__tests__`. Fixtures are in `test/fixtures/` (contacts, conversations, gupshup,
  organizations, rules, users). There's a mock for `@google-cloud/storage`. Coverage gates in
  `jest.required.config.mjs`: global 70%, and `src/products/salud/` 90% branches / 80% for the other metrics.
- **No frontend tests and no E2E.** No Playwright, Cypress or Vitest anywhere. There are **zero
  `data-testid`** attributes in any app (≈150 `aria-label`s across the salud dashboard and packages).
- Manual E2E guide: `docs/how-to/salud/qa-recordatorios-whatsapp.md`. It's a full WhatsApp
  reminders QA plan on **salud-stage** with a Macena *testing* API, a Gupshup test number and a
  dedicated QA org. Scripts are in `functions/src/scripts/salud/qa/` (`reminders-qa-preflight`,
  `-book-appointments`, `-fast-config`, `-shift-appointment`, `-collect`, `probe-ficha-*`). The scripts
  **refuse to run unless `PROJECT_ID` is `salud-stage`**, and they write PII output to the OS temp dir.
  This is the seed for automating the WhatsApp layer (doc 04).

## 10. Useful scripts (`functions/src/scripts`, run with `pnpm exec tsx`)

`clone-org.ts`, `copy-org-stage-to-prod.ts`, `migrate-org-data.ts` (legacy → v3),
`migrate-contacts.ts`/`revert-contacts-migration.ts`, `report-rule-executions*.ts`,
`measure-function-memory.ts`, `flows/deploy-flows.ts`, `gupshup/*`, `cx/*`,
`salud/*` (≈25: reminder runs, appointment cube audits, contact scores, flow previews such as
`get-flow-preview.ts`, `check-flow-key.ts`, email previews…), `release/release.ts`.
`products/turnos/scripts/seedPlans.ts` seeds plans into the turnos emulator.

## 11. Existing repo docs worth reading first

- `docs/README.md` explains the docs structure: plans / kb / features / how-to.
- `docs/how-to/development-and-deployment.md` covers local dev, deploy architecture and first-deploy pitfalls.
- `docs/how-to/release-a-prod.md` and `docs/plans/release-a-prod.md` cover the release process and the double-region incident.
- `docs/features/salud/flow-de-turnos/{README,lo-que-aprendimos}.md` explain the turnos WhatsApp Flow, screen by screen, with Meta constraints.
- `.claude/skills/flows/SKILL.md` lists the non-negotiable Flow rules: `routing_model` is a contract, ≤10 exits per screen, no A⇄B pairs, the INIT screen has no incoming edges. `test/products/salud/flows/turnos/flowJson.test.ts` checks the JSON structure (references, no A⇄B pairs, connectivity…). The skill says **"every `nextScreen` a resolver can return is in the current screen's routing_model" is not validated in CI**. `scripts/validate-turnos-flow-json.sh <flowId>` runs Meta's validator through the Gupshup Partner API by uploading a draft. It's manual.
- `docs/features/campaigns/*` covers the campaign state machine and sender. `docs/features/conversations/*` covers status history, manual close, logs and flow correction.
- `docs/features/salud/*.md` documents each Macena endpoint and resolver.
- `docs/kb/salud/*` holds user-facing FAQs (also indexed into Qdrant for the Cauce assistant).
- `GUIA_COMPLETA.md` and `SETUP_SUBSCRIPCIONES.md` cover the Turnos system (agendas, slots, MercadoPago, subscriptions, onboarding).
- `functions/AGENDAS_MULTIPLES_SERVICIOS.md` and `functions/WHATSAPP_BUSINESS_SETUP.md`.

## 12. Gotchas

- Root `README.md` paths (`dashboard/`, `booking/`, project `prestobotsv2-stage`) are outdated.
  The real paths are `apps/...` and the projects are `turnos-*` and `salud-*`.
- `funcs.json` at the root is a captured `functions:list` output showing
  `activityRecordSubscriber` in state `FAILED` on salud-stage. It's a stale artifact.
- `knip-results.txt` lists unused exports/files and is useful for cleanup.
- `apps/turnos/dashboard/src/{TestLint.tsx,test-any.ts}` and `tsc_output.txt` are leftovers.
- An emulator-only callable name is `<prefix>-<name>`. In deployed projects it has no prefix.
- Flows: a resolver returning a `nextScreen` that isn't declared in `routing_model` only fails
  **in production on the patient's phone**. Add a static resolver↔routing check (doc 04).
