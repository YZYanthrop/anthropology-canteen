# <version>: <plan title>

- Status: `Proposed`
- Last updated: YYYY-MM-DD
- Target version: `<version or undecided>`
- Planning task: `<task name>`
- Implementation branch: `none`

## Problem and outcome

Describe the user-visible problem and the result that will prove it is solved.

## Scope

- Required change 1.
- Required change 2.

## Non-goals

- Explicitly excluded work.

## Compatibility and invariants

- Data/schema impact and migration requirements.
- Windows/macOS parity requirements.
- Privacy, identity, and reminder constraints that must remain true.

## Implementation slices

1. Slice A: independently testable outcome and expected files.
2. Slice B: independently testable outcome and expected files.

Each slice should normally fit one implementation task and one short-lived
branch. Note file overlap when slices cannot safely run in parallel.

## Acceptance criteria

- Observable behavior 1.
- Observable behavior 2.

## Test plan

- Deterministic regression tests.
- Build/lint requirements.
- Platform smoke or human QA requirements.

## Risks and rollback

- Main failure modes.
- How old data and the previous stable release stay recoverable.

## Decisions requiring the user

- List only choices that materially change the result.

## Completion record

Fill during implementation:

- Status:
- Commit(s):
- Verification:
- Handoff:
- Remaining work:
