---
form: note
kind: field_note
title: "Right-Hand Side Execution: Gates, Clean-Room Audits, and CI Receipts"
description: Separation of powers in RHS execution via operator gates, atomic checkpoints, clean-room audits, and sealed CI receipts.
published_on: 2026-11-19
---

Self-reviewing agents optimize for plausibility over truth, dumping subtle defects onto human review.

During **Right-Hand Side (RHS)** execution, **separation of powers** splits duties: authors propose and checkpoint; isolated auditors falsify; sealed receipts attest; operators govern intent and trunk merges.

## 1. Operator Gates & Single-Agent Accountability

Each branch has one owning session and pauses at explicit human boundaries:

| Gate / Checkpoint | Enforced Contract | Authority |
| :--- | :--- | :--- |
| **Branch Hold** | Checkout `src-<base>/<type>/<id>-<slug>`, mark `In Progress`, halt before edits. | Operator (`go`) |
| **Checkpoints** | Per-checkbox commit (`targeted tests`, local-LLM lint/fallback, bot author, secret scrub) syncing issue + draft PR. | Author |
| **Sub-Issue Merge** | Verified sub-issues squash-merge to Epic branch and move to `In QA`. | Author |
| **Trunk & `Done`** | Trunk merges and `In QA -> Done` closures require `--operator-approved`. | Operator |

Single-agent ownership prevents conflicting edits and keeps commits, tiers, and checkboxes traceable. Checkpoints run targeted unit tests only; full CI waits for clean-tree verification.

## 2. Clean-Room Audits & Runner-Sealed CI Receipts

Verification scales with risk while blocking self-approval and forged local test claims:

| Path / Risk Tier | Verification Mechanism | Independence & Binding |
| :--- | :--- | :--- |
| **Non-escalated Low / Med Sub-Issue** | Tier-1 subagent critic (`flash` min; `flash_lite` retired). | Dispatched critic; stamped to head SHA. |
| **High+ / Epic / Trunk** | Tier-2 falsification bundle + isolated audit (`PASS`/`REVISE`/`BLOCK`). | `Author != Reviewer` (or `>= effort` flagship); weak/router barred. |
| **Local CI** | In-process runner on `dirty: 0` sealing a Schema v2 receipt. | Bound to SHA, log hash, and all gates. |

### The Absolute Authoring Boundary

For `High+`, Epics, trunk PRs, and guarded paths, a bundler emits a falsification packet:
- A `60/40` test-prioritized diff omitting lockfiles and generated noise.
- Deduplicated prior reviews, the issue MVP spec, and guarded-path flags.

Then the **authoring session halts**. An isolated clean-room session with zero shared trajectory enforces `Author != Reviewer` (or `>= effort` on the same flagship tier; weak, down-tier, or router models barred) and records `PASS`, `REVISE`, or `BLOCK` on the head SHA—undrafting only on `PASS`.

### Tamper-Evident CI Attestation

Passing `--local-ci` without a sealed receipt fails immediately. The runner executes on `dirty: 0`, captures the log, verifies every gate is `pass` or allowlisted `not-applicable`, and hashes the transcript into a SHA-bound Schema v2 receipt.

## 3. Pros & Cons

**Pros**
- **Protected attention**: Clean-room falsification and SHA-bound receipts catch subtle defects before trunk review.
- **Crisp accountability**: Single-agent branches and 1:1 checkbox commits keep progress and regressions traceable.
- **Unforgeable CI**: Clean-tree runs and transcript hashes block rubber-stamped or partial suites.

**Cons**
- **Handoff latency**: Branch Hold and Authoring Boundary gates add explicit operator and session turns.
- **Audit quota burn**: Clean-room `Author != Reviewer` (or `>= effort` flagship) pairing spends extra frontier capacity on `High+` and trunk PRs.
- **Strict tree hygiene**: Sealing on `dirty: 0` rejects runs when untracked or unstaged files remain.
