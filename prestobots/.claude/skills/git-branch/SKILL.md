---
name: git-branch
description: Create a new work branch that follows this project's git standards (docs/git-standards.md) - proposes a compliant name from a short description, starts it from the up-to-date base branch and switches to it.
argument-hint: "[short description of the work]"
disable-model-invocation: true
---

# git-branch

Create ONE work branch following `docs/git-standards.md`.

- Questions and messages: in the language the user is using in the session.
- One question per turn with `AskUserQuestion`; recommended option first with ` (Recommended)`.

## Steps

1. Read `docs/git-standards.md` (Branching strategy, Branch naming, Tickets).
2. Check the working tree (`git status --porcelain`). If there are uncommitted changes, ask: `Carry them to the new branch (Recommended)` / `Stash them first` / `Cancel`.
3. Determine the base branch from the standards (e.g. `main`, or `develop`/`main` for hotfixes in Git Flow). If a remote exists, `git fetch` and make sure the local base is up to date with its remote (fast-forward only); if it diverged, stop and report.
4. Build the name from `$ARGUMENTS` (or ask for a short description): choose the type, a short kebab-case slug, and the ticket ID if required. Propose 1–3 compliant names (best first) and let the user pick or type one (Other). Validate the choice against the branch regex in the standards; if it fails, explain why and ask again.
5. If the branch already exists locally or remotely, report it and ask: `Switch to it` / `Choose another name`.
6. Create and switch: `git switch -c <name> <base>`. Do not push (pushing is part of `/git-pr`).
7. Report the branch name and its base in one line.
