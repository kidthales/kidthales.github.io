---
form: note
kind: field_note
title: "Right-Hand Side Execution: Gates, Clean-Room Audits, and CI Receipts"
description: Enforcing separation of powers in RHS execution via operator gates, single-agent checkpoints, clean-room audits, and sealed CI receipts.
draft: true
---

An agent that writes code, reviews its own diff, and asserts its own CI pass optimizes for plausibility over truth—dumping subtle defects onto human review.

During **Right-Hand Side (RHS)** execution, we enforce **separation of powers**: the authoring agent proposes and checkpoints; isolated auditors falsify; sealed receipts attest; the operator governs intent and trunk merges.

## 1. Operator Gates & Single-Agent Accountability

Every branch belongs to one authoring session and pauses at explicit human boundaries:

| Gate / Checkpoint | Enforced Contract | Authority |
| :--- | :--- | :--- |
| **Branch Hold Gate** | Checkout `src-<base>/<type>/<id>-<slug>`, mark `In Progress`, and halt before edits. | Operator (`go`) |
| **Atomic Checkpoints** | Per-checkbox commit (`targeted tests`, local-LLM lint/fallback, bot author, secret scrub) syncing issue + draft PR. | Owning agent |
| **Sub-Issue Merge** | Verified sub-issues squash-merge to parent Epic branch and advance to `In QA`. | Owning agent |
| **Trunk & `Done` Gates** | Trunk (`main`) merges and `In QA -> Done` closures require `--operator-approved`. | Operator only |

Single-agent branch ownership prevents conflicting edits and keeps commits, model tiers, and checkboxes traceable. Checkpoints run targeted unit tests only; full CI waits for clean-tree verification to avoid stalls and wasted runs.

## 2. Clean-Room Audits & Runner-Sealed CI Receipts

Verification scales with blast radius while blocking self-approval and forged local test claims:

| Path / Risk Tier | Verification Mechanism | Independence & Binding |
| :--- | :--- | :--- |
| **Low / Med Sub-Issue** | Tier-1 specialist subagent critic (`flash` min; `flash_lite` retired). | Dispatched critic; stamped to PR head SHA. |
| **High+ / Epic / Trunk** | Tier-2 clean-room falsification bundle + isolated audit (`PASS`/`REVISE`/`BLOCK`). | `AuthorModel != ReviewerModel`; weak/unattributed barred. |
| **Local CI Assertion** | In-process CI runner on `dirty: 0` sealing a Schema v2 receipt. | Bound to commit SHA, log hash, and all gates. |

### The Absolute Authoring Boundary

For `High+`, Epics, trunk PRs, and guarded-path diffs, a bundler emits a falsification packet:
- A `60/40` test-prioritized diff omitting lockfiles and generated noise.
- Deduplicated prior reviews paired with the issue MVP spec and guarded-path flags.

Once emitted, the **authoring session halts**. An isolated clean-room session with zero shared trajectory enforces `AuthorModel != ReviewerModel` (no down-tiering, weak, or router models) and records `PASS`, `REVISE`, or `BLOCK` on the head SHA before undrafting.

### Tamper-Evident CI Attestation

Passing `--local-ci` without a sealed receipt fails immediately. The runner executes on `dirty: 0`, captures the full log, verifies every gate is `pass` or allowlisted `not-applicable`, and hashes the transcript into a SHA-bound Schema v2 receipt.

## 3. Pros & Cons

**Pros**
- **Protected review attention**: Clean-room falsification and SHA-bound CI receipts catch plausible defects before trunk review.
- **Crisp accountability**: Single-agent branches and 1:1 checkbox commits make progress and regressions easy to trace.
- **Unforgeable local CI**: Clean-tree runs and transcript-hash receipts block rubber-stamped or partial suites.

**Cons**
- **Handoff latency**: Stopping at Branch Hold and Authoring Boundary gates adds explicit operator and session turns.
- **Audit quota burn**: Clean-room `AuthorModel != ReviewerModel` pairing spends extra frontier capacity on `High+` and trunk PRs.
- **Strict tree hygiene**: Sealing receipts on `dirty: 0` rejects runs whenever untracked or unstaged files remain.
