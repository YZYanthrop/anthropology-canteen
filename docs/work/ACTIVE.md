# Active work packet

Last updated: 2026-08-23

- Status: `Merged`
- Approved for implementation: yes
- Target version: `v1.3.2`
- Plan: [`docs/plans/v1.3.2-usability-and-recovery.md`](../plans/v1.3.2-usability-and-recovery.md)
- Implementation branch: local `main`
- Current step: merged v1.3.2 implementation ready for local trial
- Implementation handoff: [`docs/handoffs/v1.3.2-slice-c.md`](../handoffs/v1.3.2-slice-c.md)
- Release task: none

## Next action

Inspect the compiled portable app locally. If the trial is accepted, open a
separate release task to freeze the version and prepare native candidates. Do
not push, tag, package, publish, or start release work without new explicit
authorization.

## Repository note

v1.3.1 is the current immutable public release. Older local worktrees may still
contain unrelated uncommitted release or macOS-test notes. A new task must not
clean, overwrite, merge, or reuse those files without first inspecting their
Git status.
