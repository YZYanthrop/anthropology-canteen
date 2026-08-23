# Active work packet

Last updated: 2026-08-23

- Status: `In progress`
- Approved for implementation: yes
- Target version: `v1.3.2`
- Plan: [`docs/plans/v1.3.2-usability-and-recovery.md`](../plans/v1.3.2-usability-and-recovery.md)
- Implementation branch: `codex/v1.3.2-reminder-accessibility-narrow`
- Current step: Slice C `Verified`, awaiting review and merge
- Implementation handoff: [`docs/handoffs/v1.3.2-slice-c.md`](../handoffs/v1.3.2-slice-c.md)
- Release task: none

## Next action

Review and merge `codex/v1.3.2-reminder-accessibility-narrow`. After merge,
start the compiled portable app locally for user trial. Do not push, tag,
package, publish, or start the separate release task.

## Repository note

v1.3.1 is the current immutable public release. Older local worktrees may still
contain unrelated uncommitted release or macOS-test notes. A new task must not
clean, overwrite, merge, or reuse those files without first inspecting their
Git status.
