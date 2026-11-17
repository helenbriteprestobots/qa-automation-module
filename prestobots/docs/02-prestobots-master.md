# prestobots-master — Legacy PrestoBots platform (v1)

> The original multi-tenant WhatsApp/webchat bot platform for clinics. It is still in production for
> clients that haven't been migrated to v3. JavaScript, Firebase Functions **v1**
> (`functions.config()`), Dialogflow **ES**, React 17 CRA frontends. About 620 JS/TS source files.

## 1. At a glance

| Item | Value |
| --- | --- |
| Layout | Plain folder, not a monorepo: `functions/`, `panel/`, `webchat/`, `playground/`, `keys/` |
| Backend | Firebase Cloud Functions v1, Node **22** runtime, source in ES modules transpiled by **Babel** (`src → dist`) |
| NLU | **Dialogflow ES**: one agent per organization (`organization.provider.dfId`). Agent keys are read from Cloud Storage `keys/dialogflow keys/<dfId>.json` |
| Messaging | **Gupshup** (main WhatsApp BSP) and **WAPI** (`utils/wapi.js`); webchat via `gatewayWebChat` |
| HIS integrations | **Macena / Geclisa** (`controllers/macena`, `macenaV2`), **MrTurno 5** (`mrTurno5`), **decisionTree** (no HIS), **demo** |
| Other integrations | BigQuery (KPIs), HubSpot (tickets/leads), SendGrid + Gmail API (emails), Slack, Google Calendar, Google Drive (DF backups), Vertex, Cloud Vision, ffmpeg |
| Data | Firestore (default DB), BigQuery |
| Frontends | `panel/`: admin/support panel (React 17, MUI 5, Redux + react-redux-firebase, TypeScript partially). `webchat/`: embeddable chat (React 17, MUI 4) |
| Hosting | Firebase Hosting targets `panel` and `webchat` (SPA rewrites) |
| Environments | Firebase projects **tests**, **stage**, **master/prod**. `.env.tests / .env.stage / .env.master` per frontend. Prod project id referenced: `prestobots-296019` |
| Tests | Jest: 2 files in `functions/test/`, 1 in `panel/tests/`. No E2E |

## 2. Commands

```bash
# Functions (cd functions)
npm run build            # clean + babel src → dist
npm run watch            # babel --watch
npm run serve            # firebase emulators:start --only functions
npm run lint             # eslint ./src/**/*.js (also runs as predeploy hook)
npm test                 # jest --verbose (NODE_ENV=test → index.js loads ./src)
./build-function.sh <fn>            # build only src/<fn>
./deploy-functions.sh [fn ...]      # build + deploy one, many or all functions sequentially, with a log file
firebase deploy --only functions:<fn>
firebase functions:config:get > .runtimeconfig.json   # pull runtime config for emulators

# Frontends (cd panel | cd webchat)
yarn start                          # CRA dev server (:3000)
yarn build:tests|build:stage|build:master   # env-cmd -f .env.<env>
firebase deploy --only hosting:panel        # or hosting:webchat
firebase target:apply hosting panel panel-tests
```

Emulator ports (`firebase.json`): functions 5001, firestore 8080, database 9000, hosting 5000,
pubsub 8090, and the UI is enabled. For local functions against **remote** Firestore, set
`GOOGLE_APPLICATION_CREDENTIALS`.

⚠️ The `cronJobs` function must be deployed "the traditional way": build the whole project with
`watch`, then deploy `cronJobs` alone (per `functions/README.md`).

## 3. Functions architecture

`functions/index.js` globs `dist/**/index.js` (or `src/**` under test). It exports each folder as
one function named after the folder, and **only loads the one matching `process.env.FUNCTION_NAME`**
to keep cold starts fast. So **every folder in `src/` is one deployable Cloud Function**, and almost
all of them are `https.onRequest` Express apps.

Runtime config lives in `functions.config()`: `conf.*` (Firebase web config, `functionsurl`, `env`,
`location`, `slackapikey`), `config.gupshupapikey`, `config.secretproject`, `gupshuppartner.*`,
`macena.url`, and `api.token` (HubSpot API auth).

Auth middleware: `utils/middlewares.js#hasPermissions` verifies a Firebase **ID token** from
`Authorization: Bearer …` and exposes `request.claims.{isAdmin,isOrganizationAdmin}`.
(Bug: when the header is missing it sends 401 and then still continues, which produces a
"headers already sent" error.)

### 3.1 Function catalogue (`functions/src/<name>`)

| Function | Trigger | Purpose / routes |
| --- | --- | --- |
| `auth` | HTTP | `POST /user`, `DELETE /user/:id`, `POST /claims` (set `admin`, `organizationAdmin`, `organizationsViewer`) |
| `billing` | HTTP | `GET /get-old-prices`, `POST /update-one`, `/update-all`, `/calculate-total`, `GET /charts`, `/update-prices`, `PUT /update`, `/billing-review` (monthly invoices and KPIs per org) |
| `calendarPublisher` / `calendarSubscriptionsEvents` | HTTP → Pub/Sub | Google Calendar OAuth (`/calendar/auth`, `/set-token`, `/subscribe`, `/notifications`, `/subscrition-renew`) |
| `configurations` | HTTP | `/v1/save-one`, `/v1/save-one/subcollection`, `/v1/delete-many/subcollection`, `/v1/update-notifications`, `GET /v1/get-by-filters`, `/v1/get-notifications-filters`, `/v1/get-training-names` |
| `cronJobs` | HTTP (512MB/300s), called by Cloud Scheduler as `GET /<jobName>` with a Firestore lock (`cronjobLocks`) | 24 jobs: `gupshupBalance`, `cleanBigQueryDB`, `updateCharts`, `verifyNotificationsEnqueued`, `notificationsAlerts`, `schedulerDetention`, `updateSpecialtiesFromAPI`, `updateAgendaFilter`, `updateNotificationsInfo`, `notificationsScript`, `updateStatus`, `updateEnqueueTemplatesNotifications`, `sendGupshupNotifications`, `apiCache`, `macenaNotificationGeneratorV2`, `macenaNotificationRedelivery`, `updateNotificationsFilters`, `cancelationContinue`, `surveyGenerator`, `backupDFToDrive`, `demoRecordatorios`, `demoRecordatoriosRetry`, `cancelNoResponseAppointments`, `recontacto` |
| `dialogflow` | HTTP | DF ES agent admin: entities (professionals, specialties, insurances), common entities, intents, training phrases, fallbacks, bulk agent updates from the HIS API |
| `dialogflowPublisher` / `dialogflowRequest` | HTTP / Pub/Sub push | Dedupe DF webhook calls (`node-cache` by `responseId`) → topic `generic-webhook`; call DF ES detectIntent from a Pub/Sub event |
| **`genericWebhook`** | HTTP (Pub/Sub push from `dialogflowPublisher`) | **Bot brain.** DF ES fulfillment, see §3.2 |
| `gateway` | HTTP | Send a WhatsApp message *as a panel user* (human support) via Gupshup/WAPI |
| `gatewayWebChat` | HTTP multipart (512MB) | Webchat ingress: `body` = JSON `{organizationId, query, email, session}` + optional file → DF ES detectIntent → returns the DF response |
| `gupshupV3` | HTTP (Pub/Sub push) | Gupshup inbound message: resolve org by `appName`, check `chatbot` + `gupshup` integrations, publish to topic named after the integration (default `dialogflow`) or `send-message` |
| `gupshupV3Publisher` / `pubSubPublisher` | HTTP | Generic `{event, payload}` → topic via `utils/lib/pubSub/topics.js` |
| `gupshupSubscriptionsEvents` / `gupshupSubscriptionsMessage` | HTTP (Pub/Sub push, up to 2000 instances) | Delivery/read events, inbound message processing |
| `gestiones` | HTTP | `/v1/create`, `/v1/by-msgId`, `PATCH /v1/update-one/:id`, `/v1/recent-notifications`, `/v1/by-filters` |
| `getCredentials` | HTTP | Mints a **custom token** for the `organizationsViewer` user with `{organizationId}`, used by the webchat to read Firestore. ⚠️ Unauthenticated: anyone can mint a read token for any org id |
| `getToken` / `sendTemplateMessage` / `wrapperSendTemplateMessage` (onCall) | HTTP / callable | Google ID-token-protected Gupshup template sending (activation/"alta" templates) |
| `hubSpot` / `hubSpotSubscriptionsEvents` | HTTP | Ticket create/get/search (auth `api.token`); Pub/Sub ticket create/link/update |
| `messages` | HTTP | CRUD of institutional messages (`/v1/add`, `/v1/edit`, `/v1/delete`, `/v1/get`) |
| `notificationsPanel` | HTTP | Notifications sent from the panel |
| `notificationsSubscriptionsEvents` | HTTP (Pub/Sub push, 512MB/300s) | Reminder generation/redelivery/filters/send/update, demo reminders, no-response cancellation, massive cancellation |
| `onboarding` | HTTP | `/create-organization`, `/enable-turno-sin-ficha` |
| `overload` | HTTP | Load-testing helper that hammers HIS endpoints |
| `panel` | HTTP | `/chat-context`, `/event-logs`, `/ia-chat-message`, `/get-all-professionals`, `/appointments/cancellation-reasons`, `/save-notifications-demo-filters` |
| `recontacto` | HTTP | Process "recontacto" chats by org/provider and states |
| `scoring` | HTTP (1GB/540s) | `/v1/notifications`, `/v1/appointments`, `/v1` patient scoring |
| `sendAppointmentNotification`, `sendMessage`, `sendPendingNotifications`, `sendSurveyMessages` | HTTP | Outbound messaging utilities (reminders, queued messages after downtime, surveys) |
| `unsubscribe`, `updateUserConsent` | HTTP | Blacklist / consent |
| `verifyApi` | HTTP | Per-professional check that the HIS (MrTurno) returns slots; `/status` health |
| `vertex` | HTTP (Pub/Sub) | Vertex AI chatbot integration with callback topic |
| `exportKPI` | HTTP (1GB) | BigQuery exports by `type`, `initialDate`, `endDate` |
| `emails` | HTTP | Send email (SendGrid/Gmail), Gmail OAuth |

Pub/Sub topics (`utils/lib/pubSub/topics.js`): `gupshup-message-event`, `gupshup-message`,
`gupshup-template-event`, `hs-tickets-create|update|warm-leads`,
`notifications-redelivery-organizations|gestiones`, `notifications-generator-organization`,
`notifications-filters-update`, `notifications-send-organization`, `notifications-update`,
`survey-send-organization`, `billing-review-organization`, `df-entity-add|delete-organization`,
`df-update-organization`, `demo-notifications-generator|retry|retry-delivery`,
`cancel-notifications-process`, `recontacto-process`, plus `generic-webhook`, `dialogflow`,
`send-message`.

### 3.2 Conversation flow (WhatsApp)

```
Gupshup ─push─▶ gupshupV3 ─▶ topic "dialogflow" ─▶ dialogflowRequest (DF ES detectIntent)
                                                            │ fulfillment webhook
                                                            ▼
                          dialogflowPublisher (dedupe) ─▶ topic "generic-webhook" ─▶ genericWebhook
genericWebhook:
  1. parse Pub/Sub message → headers {wspusername, gsid, authorization, email}, body {session, queryResult}
  2. agentId = session.split('/')[1] → getOrganizationByAgentId
     (LOCAL DEV: requests from agents ≠ hard-coded `myAgentId = 'solano-ieuv'` are ignored)
  3. validateAgentCredentials (Storage keys/agents keys/agents.json)
  4. setChat (Firestore `chats`) — channel 1=WhatsApp, 0=webchat
  5. stop if chat.botStopped, or org.businessRules.restrictWhatsAppMessaging, or detention processes
  6. handleIntegrationRequest(org.healthSoftware.name || org.chatbotIntegration)
       → { mrTurno5 | macena | decisionTree | demo }(params)   (on error: chat marked training + INTERNAL_ERROR)
  7. the controller maps queryResult.action → actionHandlers → HIS API calls → setStateAndSave
```

- `controllers/macenaV2` exists (newer Macena API) but **is not wired** into
  `handleIntegrationRequest`. Only `helpers/userPhone.js` imports from it.
- The webchat bypasses Gupshup: `gatewayWebChat` calls DF ES directly with the agent key, and the
  same `genericWebhook` fulfils the request.

### 3.3 Firestore collections (by usage)

`chats` (most used; messages, status, statusHistory, botStopped), `organizations` (+ subcollections
like `integrations`, `configurations`), `users`, `gestiones`, `configurations`, `messages`, `bills`,
`patients`, `notifications`, `gupshupNotifications`, `templates`, `cronjobLocks`, `userConsent`,
`trainingNames`, `tags`, `surveys`, `quickResponses`, `contacts`, `chatsStopped`, `cache`,
`blackList`.

`functions/utils/`: `db/` (generic collection/subcollection helpers), `df/` (DF ES admin:
entities, intents, synonyms, training phrases), `lib/` (billing, chats, organizations, gestiones,
gupshup notifications, hubspot, calendar, gmail, pubSub, userConsent), `gupshup.js`, `wapi.js`,
`mrTurno.js`, `slack.js`, `storage.js`, `secretManager/`, `scripts/` (monthly report, onboarding,
notifications).

## 4. `panel/`: admin and support panel

- React 17 + MUI 5 + Redux + `react-redux-firebase`/`redux-firestore` (live Firestore bindings),
  react-router 5, Chart.js/ApexCharts, Quill, SheetJS exports, SweetAlert2. A service worker is
  registered on non-iOS mobile.
- Env vars (`REACT_APP_*`): Firebase config, DF Messenger ids, and one URL per backend function
  (`GENERIC_WEBHOOK_URL`, `NOTIFICATIONS_URL`, `MESSAGES_URL`, `PANEL_URL`, `BILLING_URL`,
  `EXPORT_KPI`, `DIALOGFLOW`, `CONFIGURATIONS`, `EMAILS`, `VERIFYAPI`, `AUTH`, `GATEWAY_URL`,
  `GUPSHUP_SUBSCRIPTIONS_MESSAGE_URL`, `GATEWAY_WEB_CHAT_URL`, `ONBOARDING_URL`,
  `NOTIFICATIONS_SUBSCRIPTIONS_EVENTS_URL`).
- Roles come from `profile.claims` (an array): `admin` (PrestoBots staff) and `organizationAdmin`
  (client admin). `PrivateRoute` redirects to `/login` when access is denied.

| Route | Access | Screen |
| --- | --- | --- |
| `/login`, `/recover-password`, `/signup`, `/privacy`, `/privacy-policies`, `/patient-reminders`, `/templates-reminders` | public | auth and public pages |
| `/` | any logged-in user | home |
| `/dashboard`, `/dashboard/graphics` | admin, organizationAdmin | KPIs |
| `/dashboard/prepaid`, `/dashboard/prices` | admin | billing |
| `/chats` | any logged-in user | live chats (`screens/Chats/ActiveChats.js`), human takeover |
| `/messages`, `/users`, `/channels`, `/templates`, `/client-configuration`, `/reminders`, `/notifications` | admin, organizationAdmin | per-client configuration |
| `/configuration`, `/specialties`, `/training`, `/onboarding`, `/organizations` | admin | platform admin (DF training, Geclisa onboarding, orgs) |

## 5. `webchat/`: embeddable chat

- React 17 + MUI 4. Opened as `https://<webchat-host>/?id=<organizationId>&phone=<phone>&disabled=…`.
- Login flow: `GET REACT_APP_GETCREDENTIALS_URL/<orgId>` → custom token →
  `signInWithCustomToken`. It then reads the org configuration (colors) and the chat from Firestore
  and posts messages to `gatewayWebChat` (`REACT_APP_DIALOGFLOW_URL`).
- Components: `Webchat`, `Header`, `Chat`, `MessageBox`, `Message`, `InputMessage` (text + file).

## 6. `playground/`

A TypeScript sketch of a planned refactor (a `ControllerFactory` that picks a controller by HIS
`softwareName`, plus typed collections). It isn't used in production. Run it with
`npm start` (`ts-node index.ts`).

## 7. Tests that exist

- `functions/test/utils.test.js`: `standardString`, `getBillingRange`.
- `functions/test/availableAppointments.test.js`: Macena slot deduplication.
- `panel/tests/utils.test.js`: `setLinks`, `getDayRange`, `verifyOrganization`…
- Nothing covers the conversational flows end to end.

## 8. Gotchas for agents and devs

- Changing a shared `utils/` file affects every function, but each function deploys separately.
  Redeploy all dependents.
- `myAgentId` in `genericWebhook/index.js` must be changed locally to your DF agent. Don't commit it.
- In `getToken`, both prod and stage use `prestobots-296019` as the audience.
- `NODE_TLS_REJECT_UNAUTHORIZED = '0'` is set in `genericWebhook` (see the security notes in README).
- Babel targets Node 18, but the runtime is Node 22.
- Spanish identifiers and logs throughout. Log prefixes like `>> MACENA request` help when tracing.
