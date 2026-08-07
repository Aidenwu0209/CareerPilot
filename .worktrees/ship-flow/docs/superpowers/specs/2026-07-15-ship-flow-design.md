# Ship Flow Design

**Date:** 2026-07-15

**Status:** Approved for autonomous local implementation

**Source priority:** article workflow and user requirements first; reusable assets from `Aidenwu0209/coding` second

## 1. Purpose

Build a repository-local Codex tool that gives a beginner a maintainable end-to-end software shipping workflow. The tool must detect the current phase, perform deterministic workflow work automatically, resume safely after interruption, and ask the user only when judgment, missing configuration, credentials, or an irreversible action requires confirmation.

The design adopts the article's dumbbell model:

- Left side: a strong planning pass followed by an independent critical review of the plan.
- Middle: Codex performs long-running implementation in an isolated branch and worktree.
- Right side: deterministic tests, CI-compatible verification, real deployment health checks, and synchronization of code, documentation, project rules, and project knowledge.
- Final boundary: a human confirms the observed result before cleanup.

The user's required correction is mandatory: development, Review, and Verification are separate roles. A developer cannot declare its own work complete.

## 2. Goals

1. Work with any Git repository, not only a specific language or framework.
2. Detect common project commands and write a reviewable `.ship/manifest.toml`.
3. Create an isolated feature branch and linked worktree for every run.
4. Persist an explicit state machine and append-only event log outside the tracked worktree.
5. Require independent plan review, code Review, and deterministic Verification.
6. Invalidate stale review or verification evidence when the diff changes.
7. Support configured commit, push, pull-request, CI, deploy, health-check, and rollback commands without hard-coding one hosting provider.
8. Resume safely after a process, terminal, or Codex task interruption.
9. Install a concise Codex Skill that guides beginners through the engine.
10. Keep merge, production deployment, rollback with data impact, credential transmission, and cleanup behind explicit human approval.

## 3. Non-goals

- A hosted SaaS control plane.
- Provider-specific deployment implementations for every cloud platform.
- A graphical dashboard in the first version.
- Automatic production deployment when the repository has no confirmed deployment configuration.
- Automatic editing of global Codex memory or global security rules.
- Unlimited parallel runs. The engine supports isolated runs, but human attention remains the practical concurrency limit.
- Replacing a project's existing test framework or CI system.

## 4. User Experience

The beginner invokes the installed skill with natural language such as:

- `帮我 ship 这个功能`
- `把这个需求开发、测试并准备上线`
- `继续上次的 ship 流程`
- `现在进行到哪一步了？`

The Skill calls the local engine and explains only the current decision. It does not ask the user to understand Git internals.

On first use in a repository:

1. Inspect Git state, project files, package metadata, test directories, and existing CI configuration.
2. Propose detected commands for setup, lint, type checking, unit tests, integration tests, end-to-end tests, build, deploy, health check, and rollback.
3. Ask the user to confirm or correct the proposal.
4. Save the accepted configuration to `.ship/manifest.toml`.

During a run, the user is asked only at these gates:

- acceptance criteria or a material product decision is missing;
- the detected project commands need confirmation;
- the implementation plan is ready for approval;
- Review requests a product decision instead of a code correction;
- credentials or sensitive data must be sent to a destination;
- merge or production release is ready;
- rollback can affect data;
- post-release evidence is ready and cleanup is proposed.

## 5. Architecture

### 5.1 Hybrid shape

The tool has two cooperating parts:

1. **Codex Skill (`skills/ship-flow/`)** — natural-language front end, planning/review role prompts, confirmation protocol, and instructions for using Codex subagents.
2. **Deterministic Python engine (`src/ship_flow/`)** — project detection, manifest parsing, state transitions, Git/worktree operations, command execution, evidence validation, reconciliation, and CLI output.

The Python engine uses the Python 3.11+ standard library only. It never invokes Codex by bypassing approvals. Codex performs judgment-heavy work; the engine enforces mechanical invariants.

### 5.2 Files

```text
pyproject.toml
src/ship_flow/
  __init__.py
  cli.py                 # `ship` command surface
  model.py               # enums and serializable run records
  subject.py             # immutable evidence subject and digest
  state.py               # transition rules, persistence, reconciliation
  manifest.py            # TOML loading, validation, safe project detection
  gitops.py              # Git inspection, branch/worktree lifecycle, fingerprints
  runner.py              # argv-only subprocess execution and evidence logs
  review.py              # structured review report validation
  verify.py              # configured verification command orchestration
  release.py             # configured integration/deploy/health/rollback commands
  sync.py                # code/docs/rules/project-knowledge consistency report
skills/ship-flow/
  SKILL.md
  agents/
    openai.yaml          # Codex display metadata and default invocation
  references/
    roles.md              # Planner, Developer, Reviewer, Verifier contracts
    workflow.md           # gate and recovery protocol
scripts/
  install-codex-skill.py  # verified Skill + self-contained engine installation
tests/
  unit/
  integration/
```

Repositories using the tool receive only:

```text
.ship/manifest.toml       # tracked, user-reviewed project policy
```

Runtime state and logs live under the repository's shared Git directory:

```text
<git-common-dir>/ship-flow/runs/<run-id>/
  state.json
  events.jsonl
  plan.md
  plan-review.json
  code-review.json
  verification.json
  release.json
  sync-report.json
  logs/
```

This location is shared by linked worktrees, survives interruption, and cannot accidentally be committed.

The verified local installation is self-contained and does not depend on a
temporary worktree, editable package, virtual environment, or `PYTHONPATH`:

```text
${CODEX_HOME:-~/.codex}/skills/ship-flow/
${CODEX_HOME:-~/.codex}/tools/ship-flow/
  bin/ship
  src/ship_flow/
```

Both targets are published through one recoverable transaction. The installed
launcher refuses to run while an installation journal is pending or either
installed tree differs from its activated digest.

## 6. Manifest Contract

`.ship/manifest.toml` contains only explicit, reviewable configuration:

```toml
version = 1

[project]
name = "example"
base_branch = "main"
remote = "origin"

[[development.setup]]
name = "install"
argv = ["npm", "ci"]
timeout_seconds = 900

[[verification.steps]]
name = "unit"
category = "unit"
argv = ["npm", "test"]
timeout_seconds = 900

[[verification.steps]]
name = "build"
category = "build"
argv = ["npm", "run", "build"]
timeout_seconds = 900

[release]
required = true

[[release.steps]]
name = "push-branch"
kind = "push"
target = "${remote}"
argv = ["git", "push", "-u", "${remote}", "${branch}"]
effect = "external_write"
idempotency = "probe"
probe_argv = ["git", "ls-remote", "--exit-code", "${remote}", "refs/heads/${branch}"]
timeout_seconds = 900

[[release.steps]]
name = "deploy"
kind = "deploy"
target = "production"
argv = ["deploy-command"]
effect = "external_write"
idempotency = "manual_reconcile"
timeout_seconds = 1800

[[release.healthchecks]]
name = "production-smoke"
argv = ["curl", "-fsS", "https://example.invalid/health"]
timeout_seconds = 60

[[rollback.steps]]
name = "rollback-release"
target = "production"
argv = ["rollback-command"]
effect = "external_write"
idempotency = "manual_reconcile"
data_impact = "possible"
timeout_seconds = 1800

[[rollback.healthchecks]]
name = "rollback-smoke"
argv = ["curl", "-fsS", "https://example.invalid/health"]
timeout_seconds = 60

[policy]
max_review_rounds = 3
max_verification_rounds = 3
require_plan_approval = true
require_release_approval = true
require_cleanup_approval = true
require_clean_base = true
```

Commands are arrays of argv tokens. The engine does not execute command strings through a shell. Only the documented placeholders `${repo}`, `${worktree}`, `${branch}`, `${base_branch}`, and `${remote}` are expanded. Engine-owned candidate commits are mandatory and are not configurable.

Every external-write step declares one idempotency policy:

- `safe`: repeating the exact step is explicitly safe;
- `probe`: `probe_argv` determines whether the effect already happened;
- `manual_reconcile`: an interrupted step becomes `UNKNOWN` and requires human reconciliation before retry.

`release.required = false` is valid for repositories whose deliverable is a local library or artifact. When any release step has `kind = "deploy"`, at least one release health check is mandatory. Rollback steps declare whether data impact is `none` or `possible`; possible data impact always requires action-time approval.

## 7. State Machine

The canonical states are:

| State | Meaning | Allowed next states |
|---|---|---|
| `INITIALIZED` | Run record exists | `PLANNING`, `BLOCKED` |
| `PLANNING` | Plan and acceptance criteria are being produced | `PLAN_REVIEW`, `BLOCKED` |
| `PLAN_REVIEW` | Independent plan critic checks scope and risks | `AWAITING_PLAN_APPROVAL`, `PLANNING`, `BLOCKED` |
| `AWAITING_PLAN_APPROVAL` | Human decision required | `DEVELOPING`, `CANCELLED` |
| `DEVELOPING` | Developer works in the run worktree | `CODE_REVIEW`, `BLOCKED` |
| `CODE_REVIEW` | Independent Reviewer inspects the current diff | `VERIFYING`, `DEVELOPING`, `BLOCKED` |
| `VERIFYING` | Deterministic checks run and evidence is recorded | `AWAITING_RELEASE_APPROVAL`, `DEVELOPING`, `BLOCKED` |
| `AWAITING_RELEASE_APPROVAL` | Review and Verification are current and passing | `RELEASING`, `CANCELLED` |
| `RELEASING` | Configured push/integration/deploy steps execute | `POST_RELEASE_VERIFYING`, `ROLLBACK_PENDING`, `BLOCKED` |
| `POST_RELEASE_VERIFYING` | Real target health and smoke checks run | `SYNCING`, `ROLLBACK_PENDING`, `ROLLING_BACK`, `BLOCKED` |
| `ROLLBACK_PENDING` | Human decision is required when rollback can affect data | `ROLLING_BACK`, `BLOCKED` |
| `ROLLING_BACK` | Configured rollback executes | `ROLLBACK_VERIFYING`, `BLOCKED` |
| `ROLLBACK_VERIFYING` | The rolled-back target is checked | `ROLLED_BACK`, `BLOCKED` |
| `ROLLED_BACK` | Rollback succeeded and evidence is preserved | none |
| `SYNCING` | Code/docs/rules/project-knowledge consistency is checked | `AWAITING_CLEANUP_APPROVAL`, `DEVELOPING`, `BLOCKED` |
| `AWAITING_CLEANUP_APPROVAL` | User reviews final evidence | `COMPLETED`, `BLOCKED` |
| `COMPLETED` | Branch/worktree cleanup is confirmed and recorded | none |
| `BLOCKED` | Safe automatic progress is impossible | resumable by an explicit corrective action |
| `CANCELLED` | User cancelled before release | none |

Review failure and Verification failure loop back to `DEVELOPING`. A dirty run worktree always reconciles to `DEVELOPING`, because only the engine may create the next immutable candidate commit. A clean changed candidate HEAD reconciles to `CODE_REVIEW`. Plan approval is preserved only when its plan and manifest digests remain unchanged; later evidence and release approval are invalidated.

## 8. Role Separation

### Planner

- Converts the user's goal into observable acceptance criteria.
- Maps affected files and risks.
- Does not implement.

### Plan Critic

- Runs in a separate Codex context.
- Searches for missing product boundaries, isolation failures, rollout risks, and unverifiable criteria.
- Produces `plan-review.json` with `pass` or `changes_requested`.

### Developer

- Works only in the run worktree.
- Implements the approved plan.
- May run fast feedback tests.
- Cannot create a passing Review or Verification artifact.
- Cannot mark the run releasable.

### Reviewer

- Runs in a separate Codex context after development.
- Reviews requirement compliance, correctness, security, maintainability, migration safety, and test quality.
- Produces structured findings with severity and exact file locations.
- A `changes_requested` verdict returns the run to `DEVELOPING`.

### Verifier

- Treats developer and reviewer claims as untrusted.
- Executes all required manifest commands through the deterministic runner.
- Performs configured integration, end-to-end, build, and post-release checks.
- Records exit codes, duration, redacted log hashes, and the complete EvidenceSubject.
- Cannot repair failures; it only reports evidence.

### Human

- Resolves product ambiguity.
- Approves the plan, production release, sensitive transmissions, data-impacting rollback, and final cleanup.

## 9. Evidence Contracts

Every gate is bound to one immutable `EvidenceSubject` containing:

- run ID;
- base commit SHA;
- candidate commit SHA and Git tree SHA;
- plan SHA-256;
- confirmed manifest SHA-256;
- resolved command-set SHA-256.
- engine and evidence-schema version.

Every plan review and code review artifact contains:

- run ID;
- reviewer context identifier;
- the complete EvidenceSubject;
- verdict: `pass` or `changes_requested`;
- requirement, correctness, security, maintainability, migration-safety, and testing findings with severity and exact locations;
- UTC timestamp.

Plan Review additionally contains the plan digest and must come from a context different from the Planner. Code Review must come from a context different from the Developer.

Context IDs are backed by engine-issued one-time handoff nonces. This enforces honest role separation inside the Codex workflow, but is not presented as authentication against a malicious local process.

Every verification artifact contains:

- the complete EvidenceSubject;
- every configured command as argv;
- start/end timestamps, duration, exit code, and timeout status;
- path and SHA-256 of the complete log;
- aggregate verdict;
- verifier context identifier.

Artifacts and approvals are accepted only when their EvidenceSubject matches current Git, plan, manifest, and resolved-command state. Free-form text cannot advance the state machine.

## 10. Git, Integration, and Release

Each run creates:

- branch `ship/<goal-slug>-<short-run-id>`;
- worktree `.ship-worktrees/<repository>-<short-run-id>` next to the primary checkout;
- an append-only runtime record in the shared Git directory.

Before worktree creation, the engine requires a clean base when policy enables it. Existing user changes are never staged, reset, or moved.

The engine records the primary checkout, base commit, canonical worktree path, linked-worktree Git backlink, and run ownership. It validates branch names with `git check-ref-format`, rejects pre-existing or symbolic-link worktree paths, and compensates a partial creation only for paths and branches proven to belong to that run. Cleanup refuses a dirty, unowned, or unmerged worktree unless the exact condition was included in the user's cleanup approval. Before an engine-owned commit, suspicious secret files, private keys, oversized files, and files outside the approved plan are surfaced for confirmation.

When the Developer declares an iteration ready, the engine—not the Developer role—stages changes inside the isolated run worktree and creates the configured commit. Code Review and Verification therefore inspect a clean, immutable HEAD. A requested revision creates a new engine-owned commit and makes every artifact for the prior HEAD stale.

After Review and Verification pass:

1. The engine presents the exact push, PR/CI, merge, deploy, health-check, and rollback configuration.
2. The user approves the release.
3. Configured commands run in order and stop on the first failure. Before an external step, the engine durably records `PREPARED`, then `RUNNING`; after the action it records `SUCCEEDED`, `FAILED`, or `UNKNOWN` with a receipt.
4. Post-release health checks validate the real target.
5. Failed health checks move to `ROLLBACK_PENDING`; rollback is automatic only when the user already approved that exact non-data-destructive command.
6. The Skill checks whether code changes require updates to project documentation, `AGENTS.md`, project rules, or project-local knowledge files.
7. The user reviews evidence and approves cleanup.

The first version supports GitHub convenience through installed `gh` detection, but provider-neutral configured commands remain the source of truth.

Each operation receipt binds the EvidenceSubject, target, resolved argv, command digest, approval ID, idempotency policy, attempt number, and observed provider receipt. A production health check must identify the released candidate or release ID; merely observing an already healthy older version is not sufficient.

## 11. Recovery and Concurrency

- A repository lock serializes run/worktree creation, a per-run lock serializes state mutation, and a release-target lock prevents two runs from releasing to the same confirmed target.
- Events are a write-ahead JSON Lines log: append, flush, and `fsync` happen before the state snapshot changes.
- State snapshots carry a monotonic revision, use write-to-temp plus atomic rename, and can be rebuilt from events.
- `ship status` reconciles recorded state with branch existence, worktree existence, HEAD/tree SHA, dirty status, plan/manifest/command digests, step receipts, and artifact freshness.
- A crash with an external step left in `RUNNING` never causes blind replay. The engine runs the configured probe; without a conclusive probe it records `UNKNOWN` and blocks for human reconciliation.
- `ship resume` reports the single next safe action.
- Timeouts and non-zero exits never count as success.
- A Review or Verification loop exceeding policy limits becomes `BLOCKED`; it never becomes implicitly successful.
- Separate runs have separate branches, worktrees, locks, artifacts, and logs.

## 12. Safety

- No `shell=True`; commands run as explicit argv arrays.
- Manifest commands are trusted executable code. The runner confines cwd to the run worktree, closes stdin, uses a new process group, terminates the group on timeout, caps persisted output, applies an environment allowlist, and requires extra confirmation for explicit shell wrappers such as `bash -c`.
- No approval-bypass flags.
- Configured known secret values are forbidden in state, logs, or reports. The runner receives confirmed sensitive values and environment-key names, redacts output before writing it, and never retains an unredacted raw log. Arbitrary project commands can still print an unknown secret, so logs remain local, permission-restricted, size-capped, and excluded from automatic chat output.
- The Skill must confirm the destination before transmitting credentials or private files.
- Merge, production deployment, cleanup, and data-impacting rollback require explicit action-time confirmation.
- The engine never runs destructive Git commands such as `reset --hard` or overwrites user changes.
- Deployment is unavailable until a user-reviewed command and health check exist.
- Global Codex rules and memory are read-only unless the user separately authorizes a change.

## 13. Testing Strategy

### Unit tests

- every legal and illegal state transition;
- manifest schema and standard-library TOML parsing;
- Node, Python, Go, Rust, and generic project detection;
- argv-only command enforcement;
- atomic state writes and event ordering;
- repository, run, and release-target lock contention;
- WAL recovery after failure between event `fsync` and snapshot replacement;
- review report validation;
- stale fingerprint invalidation;
- timeout and non-zero exit handling;
- secret redaction.

### Integration tests

Use temporary real Git repositories to verify:

- manifest initialization;
- branch and worktree creation;
- run isolation;
- Review failure returning to development;
- Verification failure returning to development;
- successful verification reaching the release gate;
- changed diff invalidating prior evidence;
- interrupted run recovery;
- configured fake deploy, health-check failure, and rollback gating;
- crash injection before and after an external effect, proving no blind replay;
- rollback verification reaching `ROLLED_BACK` only after a passing smoke check;
- sync report schema and EvidenceSubject freshness;
- cleanup only after approval.

### Skill tests

Pressure-test the Skill with subagents before installation:

- a beginner gives only a vague feature request;
- a developer attempts to skip Review;
- a reviewer passes a stale diff;
- a verifier is asked to fix its own failure;
- a deploy operation lacks a health check that asserts the current candidate;
- a user asks to merge or deploy without current evidence;
- a run is interrupted and resumed.

The baselines must expose at least one concrete unsafe failure without the
Skill; every Skill-enabled run must follow the gates. The immutable validation
receipt binds all fourteen fresh-run transcripts, runner IDs, scenario results,
the pressure specification, and the exact Skill tree digest.

## 14. Acceptance Criteria

1. `python3 -m unittest discover -s tests/unit -v` and `python3 -m unittest discover -s tests/integration -v` both pass with coverage of the state machine.
2. `python3 -m compileall -q src scripts` passes.
3. Installing the package exposes `ship --help` without third-party runtime dependencies.
4. `ship init` detects a temporary Node, Python, Go, Rust, and unknown Git repository and writes valid proposals.
5. `ship start` creates an isolated branch, worktree, run record, and event log.
6. Illegal phase skipping exits non-zero and leaves state unchanged.
7. Review failure and Verification failure each produce a tested development loop.
8. A changed diff makes previous passing evidence stale and prevents release.
9. A passing Review plus passing Verification is required to reach `AWAITING_RELEASE_APPROVAL`.
10. Release commands cannot execute without an explicit recorded approval.
11. Deployment without configured health checks is rejected.
12. A failed health check records evidence and enters `ROLLBACK_PENDING`.
13. An interrupted run is recoverable through `ship status` and `ship resume`.
14. The Codex Skill is installed locally only after all engine, integration, and pressure tests pass.
15. A fresh Codex task can discover the installed Skill and explain the next safe action to a beginner.
16. A simulated crash during an external release step never repeats the step without a conclusive probe or human reconciliation.
17. No persisted command log contains configured secret values.
18. `sync-report.json` is required before cleanup and is rejected when its EvidenceSubject is stale.

## 15. Delivery Boundary

The implementation is complete when the feature branch contains the engine, tests, Skill, installer, and documentation; all fresh verification commands pass; and the Skill is installed locally. The feature branch is not pushed, merged, or used to deploy a real external project without a separate user confirmation.
