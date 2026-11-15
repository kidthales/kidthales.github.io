---
form: note
kind: field_note
title: Left-Hand Side Planning in the Software Foundry
description: Partitioning problem-space modeling, model tiers, planning artifacts, and interview depth across three software foundry intake tracks.
draft: true
---

Skipping problem-space modeling turns codebases into accidental data models. Running full architectural ceremonies on every dependency bump or one-line fix stalls delivery.

We partition **Left-Hand Side (LHS)** planning—problem definitions, metaphors, and state invariants before **Right-Hand Side (RHS)** code—across **three intake tracks**.

## 1. Three-Track Planning Matrix

| Dimension | Track A: Greenfield, Major Versions & Audits | Track B: Active-Project Features | Track C: Fixes, Dependabot & Triage |
| :--- | :--- | :--- | :--- |
| **Complexity** | `High` / `Very High` (cross-cutting) | `Low` / `Medium` (or escalated `High`) | `Low` / `Medium` (narrow blast radius) |
| **Main Tier** | `Carbon` (`Med`/`High`) or `Hydrogen` (`XHigh`) | `Hydrogen` (`Med`/`High`; `XHigh` if `High`) | `Hydrogen` (`Low`/`Med`) or `Flash` |
| **Subagents** | `pro` (pattern coach, `research`) | `flash_lite`/`flash` (`pro` only if `High`) | `flash_lite`/`flash` (zero `pro`, no `inherit`) |
| **Skills / Flow** | `/boost` + `/plan` + semantic design skill | `/plan` + domain Tier 2 skills | Direct repro/changelog check or triage |
| **`/grill-me`** | `2–3` deep loops (forces, failure modes) | `1–2` focused loops (`0–1` if trivial) | `0` loops (`1` if ambiguous or breaking) |
| **Artifacts** | `Concept Canvas`, `Parti`, `Matrix`, `ADR`, `Runbook`, `scratch/` spike | `2-part` issue spec (`4-part` + `Parti` if `High`) | Minimal `2-part` spec or triage disposition |

Track-specific convergence keeps planning weight proportional to architectural risk:

- **Track A (Greenfield, Major Versions & Audits)**: Lives strictly on the LHS until forces settle. Throwaway `scratch/` spikes (zero repository git footprint) empirically calibrate **Weighted Trade-off Scorecards** (`ADR-*.md`) before decomposing into an Epic `Runbook` and `<= 4`-checkbox sub-issues.
- **Track B (Active-Project Features)**: Inherits the existing architecture via a `2-part` spec (`Overview` + `MVP Scope`), escalating to a `4-part` spec (`Baseline`, `Out of Scope`), `Architectural Parti`, and `Entity-State Matrix` when touching state machines or high-risk security paths.
- **Track C (Fixes, Dependabot & Triage)**: Optimizes for fast disposition. Deterministic bug fixes and minor dependency PRs skip `/grill-me` completely; inbound requests triage into `Ready` specs, `Backlog` deferrals, or `Close`/`Merge` outcomes.

Across all tracks, `inherit` and omitted child model tiers remain prohibited so planning subagents never clone parent quota.

## 2. Hard LHS/RHS Boundaries

Two explicit contracts prevent premature implementation drift and silent architectural decay:

### Exploration != Sign-Off (Forward Gate)

Conversational steering (*"option 1 sounds good"*, *"I like this layout"*) narrows the LHS design space but **never** authorizes RHS execution. Agents remain strictly in the problem space—zero tracker issues, zero git branches, and zero repository edits—until the operator issues an explicit promotion command (*"proceed"* or *"create the issue"*).

### Mechanical Demotion (Reverse Bridge)

Architecture is bidirectional. When RHS implementation hits a runtime limit, concurrency deadlock, or platform API restriction that falsifies an LHS invariant or state guard, the agent halts immediately rather than inventing an ad-hoc syntactic workaround:

- **Mark `Blocked`**: Stop branch execution and post a formal defect citation (*"Platform X cannot satisfy Guard Y because Z"*).
- **Demote & Amend**: Return to LHS Concept Stage to revise the Architectural *Parti*, Entity-State Matrix, and `ADR` before re-promoting.

## 3. Pros & Cons

**Pros**
- **Proportional overhead**: Aligns `/grill-me` depth, model burn, and artifacts to actual blast radius.
- **Protected problem space**: `Exploration != Sign-Off` and zero-footprint `scratch/` spikes stop premature code collapse.
- **Self-healing invariants**: Mechanical Demotion turns runtime impossibilities into durable ADR and state-matrix amendments.

**Cons**
- **Misclassification risk**: Treating a structural Track A problem as Track B/C forces mid-flight rework.
- **Interview friction**: Multi-loop `/grill-me` sessions add latency before the first RHS commit.
- **Demotion pauses**: Halting an active RHS branch for LHS re-architecture trades short-term speed for coherence.
