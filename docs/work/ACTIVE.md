# Active work packet

Last updated: 2026-08-24

- Status: `Merged`
- Approved for implementation: yes
- Target version: `v1.3.2`
- Plan: [`docs/plans/v1.3.2-usability-and-recovery.md`](../plans/v1.3.2-usability-and-recovery.md)
- Implementation branch: local `main`
- Merged at: `6718d6a`
- Current step: v1.3.2 implementation and Windows registration fix merged;
  Windows administrator-assisted registration trial accepted
- Implementation handoff: [`docs/handoffs/v1.3.2-windows-reminder-registration.md`](../handoffs/v1.3.2-windows-reminder-registration.md)
- Release task: none

## Next action

The source is ready to enter a separate v1.3.2 release-candidate task. That task
must freeze one final commit and prepare and natively verify Windows x64, macOS
arm64, and macOS x64 candidates from it. Existing local Windows trial ZIPs are
not final release packages. Do not push, tag, publish, or start release work
without new explicit authorization.

## Repository note

v1.3.1 is the current immutable public release. Older local worktrees may still
contain unrelated uncommitted release or macOS-test notes. A new task must not
clean, overwrite, merge, or reuse those files without first inspecting their
Git status.
