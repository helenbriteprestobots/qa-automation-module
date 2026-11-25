# PrestoBots / Cauce — Workspace Docs

Context docs for agents and developers working across the three repos in this folder.
Generated from a full read of the code on 2026-11-16. Where a repo's own docs disagree with
the code, these docs follow **the code** and flag the drift.

| Doc | Repo | What it is |
| --- | --- | --- |
| [04-e2e-testing-strategy.md](04-e2e-testing-strategy.md) | all | How to automate agentic E2E testing across the three repos, with the platform, architecture and rollout plan. |
| [05-chatbot-testing-simple.md](05-chatbot-testing-simple.md) | chatbot (v3 Salud) | Plain-language version of the chatbot testing plan for non-technical readers: dictionary, how tests adapt to changes, automatic test-case discovery and IDs, the admin role. |
| [06-mvp-scope.md](06-mvp-scope.md) | chatbot (v3 Salud) | **MVP scope** of the Chatbot Testing Platform: create test cases (AI + natural language), run them from the web page, detailed reports, Jira cards. Out of scope, done-criteria, open questions. |
| [07-developer-requests.md](07-developer-requests.md) | chatbot (v3 Salud) | **What to ask the developers** so the platform can test the real chatbot: what already exists (just access) vs. what would be new work, plus a ready-to-send message. |
| [../app/README.md](../app/README.md) | `app/` | The **Chatbot Testing Platform** itself (iteration 1): how to start it, demo vs stage mode. |

## How the three relate

```
                 ┌──────────────────────────┐
  Google Ads ──▶ │ cauce-webpage (caucebot) │── every CTA ──▶ wa.me/5492617450587 (sales bot)
                 └──────────────────────────┘
                                                     WhatsApp (Gupshup / Meta)
                                                              │
         ┌────────────────────────────────────────────────────┴───────────────┐
         ▼                                                                    ▼
┌─────────────────────────────┐                          ┌──────────────────────────────────┐
│ prestobots-master (legacy)  │   orgs being migrated ─▶ │ prestobotsv3-main (current)       │
│ Functions v1 + Dialogflow ES│   (scripts/migrations)   │ Functions v2 + Dialogflow CX +    │
│ panel (CRA) / webchat (CRA) │                          │ WhatsApp Flows; Salud + Turnos     │
│ HIS: Macena/Geclisa, MrTurno│                          │ HIS: Macena/Geclisa, MrTurno5      │
└─────────────────────────────┘                          └──────────────────────────────────┘
```

- **Cauce** = commercial brand of PrestoBots **Salud** (WhatsApp bot that automates the whole
  appointment cycle for clinics, natively integrated with the **Geclisa** HIS from **Macena**).
- **Turnos** = generic SaaS booking product (services, agendas, slots, MercadoPago deposits and
  subscriptions, Google Calendar). Same codebase as Salud in v3.
- The legacy repo still serves production clients. v3 has migration scripts
  (`functions/src/scripts/migrate-org-data.ts`, `docs/plans/migrations/`) to move orgs over.

## Glossary (Spanish terms that appear everywhere in code)

| Term | Meaning |
| --- | --- |
| turno | appointment |
| obra social (OS) / cobertura / plan | health insurance / coverage / insurance plan |
| particular | self-pay patient (no insurance) |
| prestador / profesional | provider / professional (doctor) |
| especialidad / práctica | specialty / medical practice (procedure) |
| sede / ubicación | clinic location / branch |
| ficha | patient record in the HIS |
| gestión / gestiones | a tracked bot "management" (booking, cancel, confirm…); billing unit |
| recordatorio | reminder (WhatsApp/email before the appointment) |
| recontacto | re-contact flow for patients who didn't answer |
| detención / bot detenido | bot paused for a chat or org (human takeover) |
| intervención | human agent intervening a conversation |
| seña | deposit payment |
| regla / aviso | rule / notice shown in a flow (v3 rules engine) |
| HIS | Hospital Information System (Geclisa/Macena, MrTurno) |
| DF ES / CX | Dialogflow ES (legacy) / Dialogflow CX (v3) |

## Security notes found during the review (act on these)

1. `prestobots-master/keys/firebase/*.json` contains **five committed GCP service-account key files**
   (prod, stage, tests). Rotate them and move them to Secret Manager.
2. `prestobots-master/functions/src/genericWebhook/controllers/mrTurno5/api/private.key` and
   `pubkey.key` are committed. v3 moved this to the `MR_TURN5_PRIVATE_KEY` secret.
3. `prestobots-master/panel/.env.*` and `webchat/.env.*` are committed. Firebase web keys are
   public by design, but the files also hold internal function URLs and an admin email.
4. Legacy `genericWebhook` sets `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'` globally, which
   disables TLS verification for every outbound call made by that function instance.
5. **v3 Firestore rules for conversations are open to any signed-in user.** In `repos/prestobotsv3-main/firestore.salud.rules`:

   ```
   match /conversations/{docId} {
     allow read, write: if request.auth != null;
     match /messages/{messageId} { allow read, write: if request.auth != null; }
   }
   ```

   The same `request.auth != null` rule covers `users/{userId}` and
   `organizations/{id}/attachments`. Neither rule checks the user's `organizationId` claim, unlike
   the `organizations/{id}` rule right below them. The webchat signs visitors in **anonymously**,
   and anonymous users count as signed in.
   - **Risk:** if these rules are deployed to salud-prod and Firestore App Check enforcement is not
     on, anyone could read and change every clinic's patient conversations.
   - **What can't be seen from the code:** whether App Check is enforced for Firestore. The
     developers need to check that in the Firebase console.
   - **How to raise it:** privately, to the tech lead, not in a shared channel.
6. These docs don't reproduce any secret values. Test credentials must never be committed into the
   QA module (see doc 04).
