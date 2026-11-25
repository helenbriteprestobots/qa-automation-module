---
name: git-commit
description: Commit the current changes following this project's git standards (docs/git-standards.md) - reviews the diff, proposes atomic commits with compliant messages, and commits only after the user confirms.
argument-hint: "[optional hint about the change]"
disable-model-invocation: true
---

# git-commit

Turn the current changes into one or more commits that follow `docs/git-standards.md`.

- Questions and messages: in the language the user is using in the session. Commit messages: in the language the standards define.
- One question per turn with `AskUserQuestion`; recommended option first with ` (Recommended)`.

## Steps

1. Read `docs/git-standards.md` (Commits, Merging and history).
2. Check the branch (`git branch --show-current`). If it is a protected branch and the standards forbid direct commits/pushes there, stop and suggest `/git-branch`.
3. Inspect changes: `git status --porcelain`, `git diff --staged`, `git diff`. If nothing changed, say so and stop. Never include files that look like secrets (`.env`, credentials, keys); if any is changed, warn and exclude it.
4. Plan the commits:
   - If something is already staged, propose committing exactly the staged changes.
   - Otherwise, group the changes into logical units per the granularity rule (e.g. a feature and its tests together; unrelated formatting separately). Propose the split (files per commit) and ask: `Use this split (Recommended)` / `Single commit` / `Change the split`.
5. For each commit, write a compliant message: header per the regex/format (type, optional scope, breaking marker), imperative subject within the length limit, a body explaining *why* when the rule requires it, footers (tickets, `BREAKING CHANGE:`), and the AI-attribution trailer per the policy. Use `$ARGUMENTS` as a hint. Validate the header against the regex in the standards.
6. Show each message and its files, and ask: `Commit (Recommended)` / `Edit message` / `Cancel`.
7. If the standards require every commit to pass the project's checks, run them first (the commands listed in the standards or AGENTS.md) and stop if they fail.
8. Commit: `git add <files>` then `git commit -F <message file>` (never `--no-verify`). If a hook rejects the commit, show its output, fix the message (not the hook) and ask again.
9. Report the created commits (`git log --oneline -n <count>`). Do not push.
