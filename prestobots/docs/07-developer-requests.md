# What to ask the developers

> A short list of what the testing platform needs from the `prestobotsv3` team to test the real
> chatbot. Everything here was checked against the chatbot's code. Nothing on the "ask now" list is
> new work for them: they only need to give access or answer.

---

## 1. Why we need anything at all

A test has two halves:

```
1. SEND:  Platform ──"Hola" (as if from the test phone)──▶ the bot's mailbox
                                                              │
                                                     the bot thinks and replies
                                                              │
                                     ┌────────────────────────┴───────────────┐
                                     ▼                                        ▼
                         WhatsApp → test phone                   a copy in the bot's database
                         (a person can look,                                  │
                          the platform can't)                                 │
2. READ:  Platform ◀──────────── reads the answer from the database ──────────┘
```

- **The mailbox doesn't answer back.** It only says "received". The bot's reply goes to the phone,
  and a copy is saved in the database.
- **The platform can't look inside a phone,** so it reads the answer from the database copy.
- **So we need two things:** the mailbox's address (to send) and permission to read the database
  (to read the answer). Plus their OK to use their test clinic.

---

## 2. Already settled ✔️

| Topic | Answer |
| --- | --- |
| Test phone | Given by the team, only for testing, no message limit, no registration needed |
| Message that starts the bot | "hola" |
| Test clinic | We share theirs: `testing-macena-gupshup-v3-qa` on salud-stage |

---

## 3. Ask now

### Request 1 — OK to use the test clinic

> *Is it OK if the testing platform uses the QA clinic `testing-macena-gupshup-v3-qa` on salud-stage,
> shared with your manual tests? Is it still active?*

**Why:** all tests talk to that clinic only.

### Request 2 — Read-only access to the salud-stage database (the key)

> *Can you create a service account in salud-stage with the role **Cloud Datastore Viewer** and send
> me its JSON key privately?*

**Why:** this is how the platform reads the bot's answers.

**What it is in plain words:**
- **Service account:** a "user" for programs instead of people.
- **Cloud Datastore Viewer:** a standard Google permission that allows **reading only**. The
  platform cannot change anything with it.
- **JSON key:** the file that proves the platform is that user.

**How to receive it:**
- Privately, never in a group chat or email thread.
- Save it in `app/secrets/` on your computer. It is never uploaded anywhere.

**If their security rules don't allow key files:** they can give the same read-only permission to
your own Google account instead. Tell me and I'll adapt the platform.

### Request 3 — The mailbox address

> *What is the exact URL of the `webhookGupshupMessages` function on salud-stage?*

**Why:** that's where the platform sends the test messages, the same way WhatsApp does.

**Good to know:**
- It's probably `https://us-central1-salud-stage.cloudfunctions.net/webhookGupshupMessages`, but
  we want them to confirm it.
- Test messages are easy to recognise in their logs: their ids start with `qa-`.

### Three quick questions

1. *If the patient is in the middle of something and writes "hola", does the bot go back to the start?*
   **Why:** the platform sends "hola" before each test to start clean.
2. *If WhatsApp refuses to deliver a reply (because the phone hasn't written in the last 24 hours),
   is the reply still saved in the database?*
   **Why:** if not, you'll need to send a real "hola" from the test phone before each test session.
3. *Do test messages trigger anything else, like alerts to staff, emails or costs?*

---

## 4. Ask later (not now)

These are for later iterations. Mention them only if the conversation goes there.

| What | Why | Exists today? |
| --- | --- | --- |
| A copy of the **exported agent file** of Dialogflow CX "Cauce V3" (the ZIP they use to set up each clinic, e.g. `exported_agent_Cauce V3.zip`), exported in **JSON package** format | So the AI can propose test cases for what patients *type*, not only for the menus the platform finds by itself. One file, no permissions to grant. Ask them to make sure it carries no webhook passwords or keys (an agent export can include webhook settings) before sending it privately. | ✅ Yes, they already have it |
| Is the `appointments` data enough to confirm a booking, or do we need Macena's test system? | Checking that bookings and cancellations really happened | ✅ Yes, just a question |
| A way for tests to fill in the WhatsApp **forms** (booking form) | Each form uses a one-time key that only WhatsApp gets, and the bot doesn't keep a copy | ❌ No, it would be new work. Ask only whether it's feasible. |
| A way to trigger **reminder** messages for tests | Reminders come from scheduled jobs. The platform only reads, so it can't create them. | ❌ Not without their scripts or new work |

---

## 5. Raise privately with the tech lead (security)

While reviewing the code I found that the salud database rules let **any logged-in user read and
change every clinic's conversations**. That includes anonymous visitors of the webchat. Send this
privately, not in a group channel:

> *While reviewing the code I noticed `firestore.salud.rules` lets any signed-in user (including
> anonymous webchat visitors) read and write all conversations and messages, without checking their
> organization. Is Firestore App Check enforcement on in salud-prod, or is this exposed?*

Technical details: [README.md](README.md), security note 5.

---

## 6. Don't ask for these

| Thing | Why not |
| --- | --- |
| Production access | Never. The platform refuses to run on production. |
| Permission to change data | The platform only reads |
| A new cloud project or server | The platform runs on your computer |
| Gupshup passwords or app names | The platform finds the app name by itself in the database |
| Webchat / App Check settings | The platform doesn't use the webchat |
| Claude API key, Jira access | Those are yours, not theirs |

---

## 7. Message ready to send

> Hi team! I'm setting up an automated testing tool for the Cauce chatbot. It runs on my computer,
> only against **salud-stage**. It sends test WhatsApp messages to the bot (as our test phone, ids
> start with `qa-`) and reads the bot's answers from the database. It never changes any data.
>
> To connect it I need:
>
> 1. **OK to use the QA clinic** `testing-macena-gupshup-v3-qa`, shared with your manual tests. Is it still active?
> 2. **A service account on salud-stage with the role "Cloud Datastore Viewer"** (read-only), and its JSON key sent to me privately.
> 3. **The exact URL of `webhookGupshupMessages`** on salud-stage.
>
> And three quick questions:
>
> - If the patient is mid-conversation and writes "hola", does the bot go back to the start?
> - If WhatsApp refuses to deliver a reply (24-hour window), is the reply still saved in Firestore?
> - Do test messages trigger anything else (alerts, emails, costs)?
>
> Thanks!
