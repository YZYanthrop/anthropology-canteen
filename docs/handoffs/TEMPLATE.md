# <version/slice> implementation handoff

- Plan: `<relative plan path>`
- Status: `Verified | Merged | Blocked`
- Branch: `<branch>`
- Base commit: `<sha>`
- Final commit: `<sha>`
- Date: `YYYY-MM-DD`

## Outcome

State what now works from the user's point of view.

## Material changes

- Source behavior.
- Data/schema/migration.
- Platform or packaging.
- Documentation.

## Verification evidence

- `pnpm lint`:
- `pnpm build`:
- `node --test tests/*.test.mjs`:
- Platform smoke/human QA:

## Compatibility and privacy

Confirm old data preservation, blank-archive privacy, credential handling, and
cross-platform parity where applicable.

## Known limits and remaining work

- Unfinished or deliberately deferred item.
- External validation still required.

## Safe next action

Give the exact next task, files it should read, and whether merging, packaging,
tagging, or publication is authorized. A handoff never implies external release
permission.
