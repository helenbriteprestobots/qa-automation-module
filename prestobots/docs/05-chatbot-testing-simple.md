# Chatbot testing — the simple version

> For anyone, technical or not. It explains how we automatically check that the Cauce chatbot
> keeps working, how the checks keep up with new changes on their own, and what the platform admins do.
> The technical detail is in [04-e2e-testing-strategy.md](04-e2e-testing-strategy.md).

---

## 1. Dictionary

| Word | What it means in plain words |
| --- | --- |
| **Chatbot** | The automatic assistant that answers patients on WhatsApp (book, confirm or cancel appointments, answer questions). Its code is in the `prestobotsv3` repo, in the part called **Salud**. |
| **Gupshup** | The company we pay to connect our chatbot to WhatsApp. When a patient writes, WhatsApp hands the message to Gupshup, and Gupshup passes it on to us. Replies travel back the same way. Think of it as the **post office between WhatsApp and our bot**. |
| **Webhook** | A "mailbox" address on our servers. Gupshup drops every new patient message there. Our tests drop **fake patient messages** in the same mailbox, so the bot treats them exactly like real ones. |
| **Firestore** | The database where the chatbot stores everything: clinics, patients, appointments, chats. |
| **Firestore conversation** | One chat between a patient and the bot, as stored in the database: every message, in order, with who sent it. The tests **read** this to see what the bot answered. |
| **WhatsApp Flow** | The little forms that open inside WhatsApp (for example, "pick a specialty → pick a doctor → pick a time"). |
| **flowEndpoint** | The part of our servers that powers those forms. Each time the patient taps "next", WhatsApp asks flowEndpoint what to show. Each form is protected by a one-time key that only WhatsApp receives, so **automated tests can't fill the forms today**. They stop at "the bot offered the form", and the form itself stays a manual check (see doc 07, B3). |
| **Macena** | The appointment system many clinics use (their agenda). When the bot books an appointment, it actually creates it in Macena. |
| **Macena API / testing API** | The "door" our bot uses to talk to Macena. Macena offers a **testing** version with fake agendas, so tests can book and cancel without touching real patients. |
| **Dialogflow CX** | Google's tool that "understands" what the patient means ("I want an appointment" = *book*). The bot's conversation design lives there, in an agent called *Cauce V3*. |
| **salud-stage** | Our **rehearsal copy** of the Salud system. It looks and behaves like the real one (**salud-prod**) but has no real patients. **All tests run here, never on the real system.** |
| **QA organization** | A fake clinic created inside salud-stage just for testing, with its own test WhatsApp number. |
| **The runner** | The program that runs the tests: it plays the patient, sends the messages, waits for replies and writes down what passed and what failed. It runs automatically on a schedule, with nobody at a keyboard. |
| **Test case / scenario** | One short story the runner plays. Example: *"A patient asks to book a cardiology appointment, picks Tuesday 10:00 and gets a confirmation."* |
| **Check** | A yes/no question about the result: *Did the bot reply? Did it offer the right buttons? Was the appointment created in Macena?* |
| **AI judge** | A Claude model that reads the bot's replies and says whether they make sense and sound right, like a human reviewer would. It can flag a bad answer, but it can never turn a failed check into a pass. |
| **Agent (AI agent)** | An AI that does a task by itself: writing new test cases, investigating a failure, proposing a fix. |
| **PR (pull request)** | A developer's proposed code change, waiting to be accepted. |
| **Deploy** | Publishing a change so it becomes live (first on stage, later on prod). |

---

## 2. The idea in one picture

```
   ┌──────────────┐  fake patient    ┌───────────────┐      ┌─────────────────┐
   │  The runner  │ ───message────▶  │   Webhook     │ ───▶ │   Chatbot       │
   │ (plays the   │                  │  (mailbox)    │      │ (salud-stage)   │
   │  patient)    │                  └───────────────┘      └────────┬────────┘
   │              │ ◀── reads the reply from the Firestore conversation ┘
   │              │ ◀── checks the appointment in the Macena testing API
   └──────┬───────┘
          │ results
          ▼
   ┌──────────────┐        ┌──────────────────────────────┐
   │  AI judge    │ ─────▶ │  Report for the admins       │
   │ (did it make │        │  ✅ 18 passed  ❌ 1 failed    │
   │   sense?)    │        │  "Cancel appointment" broke  │
   └──────────────┘        └──────────────────────────────┘
```

**Why not use a real phone on WhatsApp?** Phones can't be automated reliably, it's slow,
and it would test nothing extra: the fake message enters at exactly the same door as a real one.
The bot can't tell the difference. The bot's replies do really go out to the test phone
through Gupshup, so a person can always look at that phone and see the conversation.

---

## 3. What gets tested first (MVP)

Five to ten everyday patient stories on the QA clinic:

1. Patient says hi → bot greets and shows the menu.
2. Patient books an appointment (up to the point where the bot offers the WhatsApp form; the form itself is checked by hand for now).
3. Patient confirms an appointment from a reminder.
4. Patient cancels an appointment from a reminder.
5. Patient asks to talk to a person → the chat is handed to the clinic staff.
6. Patient writes something nonsensical → bot answers politely with its fallback message.

Every story is checked in two ways:

- **Hard checks** (yes/no): the reply arrived, the right buttons appeared, the appointment exists in Macena.
- **AI judge**: the wording is clear, polite, in correct Spanish and makes sense for what the patient asked.

---

## 4. How the platform keeps up with changes by itself

The big risk with automated tests is that they **break every time the bot changes**, and
someone has to repair them. With no QA team, that can't happen. Four rules prevent it:

### 4.1 Tests check *what the bot achieves*, not the exact words

A test never says *"the bot must reply exactly 'Tu turno fue confirmado'"*. It says
*"the appointment ends up confirmed in Macena, and the AI judge agrees the patient was told so"*.
If someone rewrites the bot's messages, the tests still pass. They only fail when the
**outcome** breaks.

### 4.2 Tests run automatically when something changes

| When | What runs | Who sees it |
| --- | --- | --- |
| A developer opens a PR on the chatbot | An AI agent reads the change, works out which patient stories it can affect, and runs those | The developer, on the PR |
| A change is deployed to salud-stage | All stories | Admin report |
| Every night | All stories + an "explorer" that chats freely looking for dead ends | Admin report |
| Every week | **Discovery** (see section 5) | Admins get new stories to approve |

### 4.3 When a test fails, an AI investigates first

Nobody has to dig through logs. The investigating agent looks at the failure and sorts it into one of three boxes:

| Box | Meaning | What happens |
| --- | --- | --- |
| 🐞 **Real bug** | The bot is broken | A ticket is opened for the developers with the conversation, the cause and the suspected code change |
| ✏️ **Intended change** | The bot was changed on purpose (for example, a new step in booking) and the test is out of date | The agent rewrites the test and asks an admin to approve it in plain words: *"Booking now asks for the patient's insurance first. Update the test?"* |
| 🌩️ **Hiccup** | Something outside the bot failed (Gupshup slow, Macena testing down) | Run again automatically; reported only if it keeps happening |

### 4.4 Tests repair themselves, but a human approves

When the bot changes on purpose, the agent proposes the updated test. An admin accepts or
rejects it with one click. Admins never edit tests by hand.

---

## 5. How test cases are found (no manual writing)

The platform **discovers** test cases by itself from four sources:

| Source | What it looks at | Example of a story it creates |
| --- | --- | --- |
| **The bot's conversation design** (Dialogflow CX agent *Cauce V3*, read-only) | Every topic the bot understands and every path between them | *"Patient asks for clinic hours"* |
| **The WhatsApp forms** (the flow files in the code) | Every screen and every way to move between screens | *"Patient picks a specialty with no free slots"* |
| **Code changes** (each PR) | What the change touched | *"New 'reschedule' option: patient moves an appointment to another day"* |
| **Real chats, anonymized** (stage, and later prod with names and numbers removed) | Common patient journeys, and chats where the bot got confused or a person had to step in | *"Patient answers the reminder with 'sí pero a las 11'"* |

Then:

1. The agent writes each idea as a **short story in plain Spanish** plus its checks.
2. The runner tries it several times on salud-stage. Stories that behave inconsistently are discarded.
3. The new stories show up in the admin report as **"Proposed"**.
4. An admin reads the story and clicks **Approve** (it joins the regular runs) or **Reject**.

The platform also keeps a **coverage map**: a list of everything the bot can do, each one
marked ✅ tested or ⬜ not tested yet. The agent keeps proposing stories for the ⬜ ones.

### 5.1 How each test case is identified

Every story gets an ID **automatically**, readable by anyone:

```
SAL-BOOK-003     Salud · Booking · story #3
SAL-REM-001      Salud · Reminders · story #1
SAL-HUMAN-002    Salud · Hand-over to a person · story #2
```

| Area code | Area |
| --- | --- |
| `GREET` | Greeting and menu |
| `BOOK` | Booking appointments (including the WhatsApp form) |
| `REM` | Reminder replies (confirm / cancel) |
| `CANCEL` | Cancelling or rescheduling outside a reminder |
| `HUMAN` | Hand-over to clinic staff |
| `INFO` | Questions (hours, address, insurance) |
| `FALLBACK` | Messages the bot doesn't understand |

Each story also records **where it came from** (which topic, form screen, PR or chat pattern).
So when that part of the bot changes, the platform knows exactly which stories to re-check or update.
IDs never change once given, even if the story is updated, so history stays readable:
*"SAL-BOOK-003 has passed 41 nights in a row"*.

---

## 6. What the admins do (non-technical)

About **15 minutes a week**. No code.

| Task | How often | Where |
| --- | --- | --- |
| Read the run summary | Daily, 1 minute | Report (Slack or email) |
| Approve or reject **proposed** new stories | Weekly | Admin page |
| Approve or reject **test updates** after intended bot changes | When asked | Admin page |
| Mark an AI judge decision as wrong (*"this reply was actually fine"*) | Occasionally | Admin page. This teaches the judge |
| Ask for a story in their own words (*"test a patient who writes in English"*) | Whenever | Admin page. The agent turns it into a test |

What admins **never** do: write tests, read logs, touch code, or run anything by hand.

---

## 7. Safety rules

- Tests **only** run on salud-stage, in the QA clinic. The runner refuses to start anywhere else.
- No real patient names, phone numbers or ID numbers in tests or reports.
- The AI agents get **read-only** access: they can look, not change the bot or its data.
- Real chats used for discovery are anonymized before any AI sees them.

---

## 8. What we need before starting

| Need | From whom |
| --- | --- |
| A QA clinic on salud-stage with its own Gupshup test number | Developers |
| A test phone that receives the bot's replies (for humans to peek at) | Operations |
| Access to the Macena **testing** API | Developers / Macena |
| Read-only access to salud-stage's database and to the Dialogflow CX agent | Developers |
| A Claude API key for the AI judge and agents | Admin |
| A place for the report and the admin page (to decide: start with Slack + a simple web page) | Team |

---

## 9. Plan

| Step | What | Done when |
| --- | --- | --- |
| **1. MVP** | The runner + the 6 stories from section 3 + daily report | 6 stories pass every night for a week |
| **2. Judge** | Turn on the AI judge; admins grade ~50 replies so we can see whether the judge agrees with them | Judge agrees with admins ≥90% of the time |
| **3. Self-care** | Failure investigation (section 4.3) + self-repairing tests with approval | First intended change handled without a developer |
| **4. Discovery** | Automatic story proposals + coverage map + admin page | Admins approve stories weekly; coverage keeps growing |
| **5. On every PR** | Run the affected stories on each chatbot code change | Developers see results before merging |
