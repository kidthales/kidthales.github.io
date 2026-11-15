---
form: note
kind: field_note
title: Left-Hand Side Planning in the Software Foundry
description: Partitioning LHS problem modeling, model tiers, artifacts, and interview depth across three foundry intake tracks.
draft: true
---

Skipping problem-space modeling turns codebases into accidental data models. Running full architectural ceremonies on every dependency bump or one-line fix stalls delivery.

We partition **Left-Hand Side (LHS)** planning—problem models and invariants before **Right-Hand Side (RHS)** code—across **three intake tracks**.

## 1. Three-Track Planning Matrix

| Dimension | Track A: Greenfield, Major & Audits | Track B: Active Features | Track C: Fixes, Dependabot & Triage |
| :--- | :--- | :--- | :--- |
| **Complexity** | `High` / `Very High` | `Low` / `Medium` (`High` if escalated) | `Low` / `Medium` (narrow scope) |
| **Main Tier** | `Carbon` (`Med`/`High`) / `Hydrogen` (`XHigh`) | `Hydrogen` (`Med`/`High`; `XHigh` on `High`) | `Hydrogen` (`Low`/`Med`) / `Flash` |
| **Subagents** | `pro` (coach, `research`) | `flash_lite`/`flash` (`pro` on `High`) | `flash_lite`/`flash` (no `pro`/`inherit`) |
| **Skills / Flow** | `/boost`, `/plan`, semantic design | `/plan`, domain Tier 2 skills | Repro/changelog check or triage |
| **`/grill-me`** | `2–3` deep loops (forces, failures) | `1–2` loops (`0–1` if trivial) | `0` loops (`1` if ambiguous/breaking) |
| **Artifacts** | `Canvas`, `Parti`, `Matrix`, `ADR`, `Runbook`, `scratch/` | `2-part` spec (`4-part` + `Parti` if `High`) | Minimal `2-part` spec or triage |

Track-specific convergence keeps planning proportional to risk:

- **Track A (Greenfield, Major & Audits)**: Stays on LHS until forces settle. Throwaway `scratch/` spikes (zero git footprint) calibrate **Weighted Trade-off Scorecards** (`ADR-*.md`) before decomposing into an Epic `Runbook` and `<= 4`-checkbox sub-issues.
- **Track B (Active Features)**: Uses a `2-part` spec (`Overview` + `MVP Scope`), escalating to a `4-part` spec (`Baseline`, `Out of Scope`), `Architectural Parti`, and `Entity-State Matrix` for state machines or security-sensitive paths.
- **Track C (Fixes, Dependabot & Triage)**: Optimizes for fast disposition. Deterministic fixes and minor dependency bumps skip `/grill-me`; inbound requests triage to `Ready`, `Backlog`, or `Close`/`Merge`.

Across all tracks, `inherit` and omitted model tiers remain banned so subagents never clone parent quota.

## 2. Hard LHS/RHS Boundaries

Two explicit contracts prevent premature drift and silent architectural decay:

### Exploration != Sign-Off (Forward Gate)

Conversational steering (*"option 1 looks good"*) narrows the LHS design space without authorizing RHS work. Agents emit zero issues, branches, or edits until explicit promotion (*"proceed"* or *"create the issue"*).

### Mechanical Demotion (Reverse Bridge)

When RHS implementation hits a runtime limit, deadlock, or platform constraint falsifying an LHS invariant or state guard, the agent halts rather than adding an ad-hoc workaround:

- **Mark `Blocked`**: Halt the branch and cite the unmet invariant (*"Platform X fails Guard Y due to Z"*).
- **Demote & Amend**: Return to LHS Concept Stage to revise the Architectural *Parti*, Entity-State Matrix, and `ADR` before re-promoting.

## 3. Pros & Cons

**Pros**
- **Proportional overhead**: Matches `/grill-me` depth, model burn, and artifacts to blast radius.
- **Protected problem space**: `Exploration != Sign-Off` and `scratch/` spikes prevent premature code collapse.
- **Self-healing invariants**: Mechanical Demotion turns runtime blocks into durable ADR and matrix updates.

**Cons**
- **Misclassification risk**: Routing a structural Track A problem as Track B/C forces rework.
- **Interview friction**: Multi-loop `/grill-me` sessions delay the first RHS commit.
- **Demotion pauses**: Halting an active RHS branch for LHS revision trades speed for coherence.
