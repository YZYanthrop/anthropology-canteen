# Active work packet

Last updated: 2026-08-23

- Status: `Merged`
- Approved for implementation: yes
- Target version: `v1.3.2`
- Plan: [`docs/plans/v1.3.2-usability-and-recovery.md`](../plans/v1.3.2-usability-and-recovery.md)
- Implementation branch: local `main`; Windows trial branch:
  `codex/v1.3.2-windows-local-trial`
- Current step: Windows x64 local package ready for user migration and UI trial
- Implementation handoff: [`docs/handoffs/v1.3.2-windows-local-trial.md`](../handoffs/v1.3.2-windows-local-trial.md)
- Release task: none

## Next action

Extract the Windows local-trial ZIP into a new folder, run its old-version data
importer against the previous package's `data` folder, and verify subscriptions,
article state, reminder configuration, and reminder enable/migration behavior.
If the trial is accepted, open a separate release task to prepare all three
native candidates from one final commit. Do not push, tag, publish, or start
that release work without new explicit authorization.

## Repository note

v1.3.1 is the current immutable public release. Older local worktrees may still
contain unrelated uncommitted release or macOS-test notes. A new task must not
clean, overwrite, merge, or reuse those files without first inspecting their
Git status.
