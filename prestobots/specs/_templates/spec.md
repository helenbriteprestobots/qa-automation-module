# Spec NNN — <Feature name>

<!--
How to use this template:
- Lives at specs/NNN-<kebab-feature-name>/spec.md (NNN = next 3-digit number); its technical plan goes next to it as plan.md. Usually created with /spec-create.
- Keep it short and testable. Describe WHAT and WHY, not HOW in code detail.
- Every acceptance criterion must be verifiable by an automated test.
- Remove these comments in the final spec.
-->

- **Status:** Draft | Active | Done | Superseded  <!-- only ONE spec may be Active at a time -->
- **Date:** YYYY-MM-DD
- **Related:** <links to other specs or issues, or "none">

## Context and goal
<!-- What problem this solves and why it is worth doing. One paragraph. -->

## Users / actors
<!-- Who uses it (roles) and any external system involved. -->

## User stories
- US-1: As a <role>, I want <action> so that <benefit>.

## Functional requirements (EARS acceptance criteria)
<!--
One requirement per line, each with an ID, the user story it serves, and verifiable by an automated test.
EARS patterns:
- Event-driven:  WHEN <event>, THE SYSTEM SHALL <response>.
- Unwanted:      IF <undesired condition>, THEN THE SYSTEM SHALL <response>.
- State-driven:  WHILE <state>, THE SYSTEM SHALL <response>.
- Optional:      WHERE <feature/config is enabled>, THE SYSTEM SHALL <response>.
- Ubiquitous:    THE SYSTEM SHALL <always-true behavior>.
-->
- FR-1: WHEN <event>, THE SYSTEM SHALL <response> (expected output/result). [US-1]
- FR-2: IF <undesired condition>, THEN THE SYSTEM SHALL <response>. [US-1]
- FR-3: WHILE <state>, THE SYSTEM SHALL <response>. [US-1]
- FR-4: THE SYSTEM SHALL <permanent behavior>. [US-1]

## User-facing behavior
<!-- Screens, commands, endpoints or API surface, with concrete input/output examples. -->

## Data model
<!-- New or changed entities, fields, types, file/DB formats. Write "No changes" if none. -->

## Non-functional requirements
<!-- Only those that apply: performance, security, platforms, language, accessibility. Make them measurable. -->

## Edge cases
<!-- Empty input, duplicates, corrupt data, limits, concurrency... One bullet each, naming the FR that covers it. -->

## Out of scope
<!-- What is explicitly NOT done in this iteration. -->

## Definition of done
<!-- e.g. every FR has a passing test + manual demo of the main flow + lint passes. -->

## Open questions
<!-- Prefix each with [NEEDS CLARIFICATION]. A spec cannot move to Active while any remain. -->
- [NEEDS CLARIFICATION] <question>
