# Active work packet

Last updated: 2026-08-24

- Status: `In progress`
- Approved for implementation: yes
- Target version: `v1.3.2`
- Plan: [`docs/plans/v1.3.2-usability-and-recovery.md`](../plans/v1.3.2-usability-and-recovery.md)
- Implementation branch: local `main`
- Merged at: `6718d6a`
- Release preparation branch: `codex/v1.3.2-release-candidate`
- Current step: freeze one final v1.3.2 commit and run the authorized
  `candidate_sha` native gate
- Implementation handoff: [`docs/handoffs/v1.3.2-windows-reminder-registration.md`](../handoffs/v1.3.2-windows-reminder-registration.md)
- Release task: candidate preparation and verification only; tag and Release
  are not authorized

## Next action

Complete one local base-verification pass on the frozen commit, push that commit
to `main`, and dispatch exactly one `candidate_sha` workflow. Stop immediately
if any platform fails. If every native job passes, report the final SHA, Actions
run, platform results, and expected release files, then pause before creating or
pushing `v1.3.2` or creating a GitHub Release.

## Repository note

v1.3.1 is the current immutable public release. Older local worktrees may still
contain unrelated uncommitted release or macOS-test notes. A new task must not
clean, overwrite, merge, or reuse those files without first inspecting their
Git status.
