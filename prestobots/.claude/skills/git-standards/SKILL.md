---
name: git-standards
description: This project's git standards (branching, branch naming, commit messages, pull requests, merging, protected branches). Use before any git operation in this repository - creating branches, writing commit messages, committing, pushing, opening or reviewing pull requests - and when the user asks how git is used here or wants to change a git rule.
---

# git-standards

The source of truth is `docs/git-standards.md`. Read it completely before any git operation; it overrides general git habits and any default commit/PR style.

## Applying the standards

- **Branches:** names must match the Branch naming pattern; create them from the base branch defined there.
- **Commits:** messages must match the Commits section (header format, types, scope, language, length, body, footers, AI attribution policy). One logical change per commit when the granularity rule says so. Never use `--no-verify`.
- **Pull requests:** title, body sections and required checks from the Pull requests section; run the required checks locally before opening.
- **History:** follow Merging and history — never force-push shared or protected branches; `--force-with-lease` only on your own unmerged branch; never push directly to protected branches if forbidden.
- If the user asks for something that breaks a rule, say which rule and ask for explicit confirmation before doing it.

## Commands and helpers

- `/git-branch`, `/git-commit`, `/git-pr` (those present in `.claude/skills/`) implement the standards step by step.
- The `git-advisor` subagent reviews changes and proposes branch names, commit splits, messages and PR text without modifying the repository. Delegate to it when a proposal is needed before acting.

## Changing a standard

1. Agree the change with the user, then edit `docs/git-standards.md` (keep the Quick reference examples consistent).
2. If `.githooks/` exists and the branch or commit pattern changed, update the regexes in `.githooks/commit-msg` / `.githooks/pre-push` to match, and test them with the doc's valid and invalid examples.
3. Mention that teammates may need to re-run the Setup commands if the developer git config changed.
