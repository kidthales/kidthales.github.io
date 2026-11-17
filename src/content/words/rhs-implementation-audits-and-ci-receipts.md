---
form: note
kind: field_note
title: "Right-Hand Side Execution: Gates, Clean-Room Audits, and CI Receipts"
description: Enforcing separation of powers in RHS execution via operator hold/trunk gates, single-agent branch checkpoints, clean-room falsification bundles, and runner-sealed CI receipts.
draft: true
---

An agent that writes code, reviews its own diff, and asserts its own CI pass optimizes for plausibility over truth—dumping subtle defects onto human review.

During **Right-Hand Side (RHS)** execution, we enforce **separation of powers**: the implementing agent proposes and checkpoints; isolated auditors falsify; runner-sealed receipts attest; the human operator governs intent and trunk promotion.

## 1. Operator Gates & Single-Agent Accountability

Every branch belongs to one authoring session and pauses at explicit human boundaries:

| Gate / Checkpoint | Enforced Contract | Authority |
| :--- | :--- | :--- |
| **Branch Hold Gate** | Checkout `src-<base>/<type>/<id>-<slug>`, mark `In Progress`, and halt before edits. | Operator (`go`) |
| **Atomic Checkpoints** | Per-checkbox commit (`targeted tests`, local-LLM lint/fallback, bot author, secret scrub) syncing issue + draft PR. | Owning agent |
| **Sub-Issue Merge** | Verified sub-issues squash-merge to parent Epic branch and advance to `In QA`. | Owning agent |
| **Trunk & `Done` Gates** | Trunk (`main`) merges and `In QA -> Done` closures require `--operator-approved`. | Operator only |

Single-agent branch ownership prevents overlapping edits and keeps every commit, model tier, and checkbox progression traceable. During development, commits run only targeted unit tests; full CI suites wait for clean-tree verification to avoid dirty-tree stalls and wasted runs.

## 2. Clean-Room Audits & Runner-Sealed CI Receipts

Verification scales with blast radius while blocking self-approval and forged local test claims:

| Path / Risk Tier | Verification Mechanism | Independence & Binding |
| :--- | :--- | :--- |
| **Low / Med Sub-Issue** | Tier-1 specialist subagent critic (`flash` min; `flash_lite` retired). | Dispatched critic; stamped to PR head SHA. |
| **High+ / Epic / Trunk** | Tier-2 clean-room falsification bundle + isolated audit (`PASS`/`REVISE`/`BLOCK`). | `AuthorModel != ReviewerModel`; weak/unattributed barred. |
| **Local CI Assertion** | In-process CI runner on `dirty: 0` sealing a Schema v2 receipt. | Bound to commit SHA, log hash, and all gates. |

### The Absolute Authoring Boundary

For `High+`, Epics, bare trunk PRs, and diff-escalated changes, a bundler emits a self-contained falsification packet:
- A `60/40` test-prioritized diff excluding lockfiles and generated noise.
- Deduplicated prior review rounds paired with the issue MVP spec and guarded-path escalations.

Once the bundle emits, the **authoring session halts**. An isolated clean-room session with zero shared trajectory verifies `AuthorModel != ReviewerModel` (barring down-tiering and weak or dynamic router models) and records `PASS`, `REVISE`, or `BLOCK` against the head SHA before undrafting for operator review.

### Tamper-Evident CI Attestation

Passing `--local-ci` without a sealed receipt is rejected. The CI runner executes on a clean tree (`dirty: 0`), captures the full execution log, confirms every declared gate is `pass` or allowlisted `not-applicable`, and hashes the transcript into a Schema v2 receipt bound to the head SHA.

## 3. Pros & Cons

**Pros**
- **Protected review attention**: Clean-room falsification and SHA-bound CI receipts catch plausible-looking defects before trunk review.
- **Crisp accountability**: One-agent branches and 1:1 checkbox commits make progress and regressions trivial to trace.
- **Non-forgable local CI**: Clean-tree execution and transcript-hash receipts prevent rubber-stamping skipped or partial suites.

**Cons**
- **Handoff latency**: Stopping at the Branch Hold Gate and Absolute Authoring Boundary adds explicit operator and session turns.
- **Audit quota burn**: Clean-room `AuthorModel != ReviewerModel` pairing spends extra frontier capacity on `High+` and trunk PRs.
- **Strict tree hygiene**: Sealing receipts on `dirty: 0` rejects runs whenever untracked files or unstaged edits remain.
