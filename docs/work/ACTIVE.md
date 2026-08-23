# Active work packet

Last updated: 2026-08-24

- Status: `Verified`
- Approved for implementation: yes
- Target version: `v1.3.2`
- Plan: [`docs/plans/v1.3.2-usability-and-recovery.md`](../plans/v1.3.2-usability-and-recovery.md)
- Implementation branch: `codex/v1.3.2-windows-reminder-registration`
- Base: Windows local candidate `efcdf9f`
- Current step: Windows reminder registration fix verified and awaiting review
- Implementation handoff: [`docs/handoffs/v1.3.2-windows-reminder-registration.md`](../handoffs/v1.3.2-windows-reminder-registration.md)
- Release task: none

## Next action

Review and merge the bounded Windows registration-failure fix into local
`main`. Then provide the corrected local candidate for an administrator-assisted
registration or migration trial. A full release remains a separate task that
must prepare all three native candidates from one final commit. Do not push,
tag, publish, or start that release work without new explicit authorization.

## Repository note

v1.3.1 is the current immutable public release. Older local worktrees may still
contain unrelated uncommitted release or macOS-test notes. A new task must not
clean, overwrite, merge, or reuse those files without first inspecting their
Git status.
