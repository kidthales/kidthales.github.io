---
form: note
kind: field_note
title: "Right-Hand Side Gating: From Plan to Work Items"
description: Compiling approved Left-Hand Side plans into proportional Right-Hand Side work items via risk floors, decomposition topologies, a four-checkbox cap, and orthogonal labels.
draft: true
---

Uncapped issues turn into multi-week branches that outgrow review windows, while underspecified security changes skip baseline invariants.

Once a **Left-Hand Side (LHS)** plan passes sign-off, a **Ready** gate compiles it into bounded **Right-Hand Side (RHS)** work items before any branch opens.

## 1. Proportional Specs, Risk Floors & Topologies

Every work item enters the tracker in an unassigned default state—never pre-tagged with lifecycle labels—so a deterministic `Ready` transition initializes its board card, validates structure, and sets complexity:

| Tier | Spec Shape | Risk-Floor Trigger | Topology |
| :--- | :--- | :--- | :--- |
| **Low / Med** | `2-part` (`Overview`, `MVP Scope`) | Default for non-escalated `docs`, `chore`, `feat`, `fix` | Bare standalone (`<= 4` items) or sub-issue |
| **High** | `4-part` (`+ Baseline`, `Out of Scope`, *Parti*, Matrix) | `sec`, `P0`/`P1`, or guarded paths (hooks, FSM, auth, CI receipts) | Standalone or Epic + sub-issues (`c:pinned` opts out) |
| **Very High** | `4-part` + Epic breakdown (`>= 1` `- [ ] #<id>`) | `> 4` checkboxes or cross-module / multi-phase scope | `Trunk <- Epic <- Sub-Issues` (or Epic waves) |

Three decomposition topologies govern where branches land:

- **Bare Standalone (`Trunk <- Issue`)**: Self-contained changes (`1–4` checkboxes) targeting trunk directly.
- **Epic + Sub-Issues (`Trunk <- Epic <- Sub-Issues`)**: Sub-issues declare `Parent: #<epic-id>` on line 1, land autonomously on the Epic integration branch, and hold final trunk sign-off at the Epic PR.
- **Epic Waves**: Multi-phase work partitions into sequenced child waves under a parent Epic so early slices verify before later waves open.

### Why Cap Items at <= 4 MVP Checkboxes?

Non-Epic work items hard-cap at **four MVP checkboxes** (oversized drafts fail validation and must promote to an Epic or split into sibling sub-issues):

- **1:1 atomic checkpoints**: Each checkbox corresponds to one verified commit and progress update on both the issue and draft PR.
- **Bounded review diffs**: Four narrow steps keep PR diffs within local linter and clean-room auditor context budgets.
- **Crisp blast radius**: Smaller slices isolate regressions and simplify reverting or re-scoping mid-flight.

## 2. Orthogonal Metadata & Label Axes

Tracker filtering, risk floors, and queue ordering separate concerns across four non-overlapping label axes alongside custom board fields:

| Axis | Canonical Values | Purpose |
| :--- | :--- | :--- |
| **Type / Kind** | `feat`, `fix`, `chore`, `docs`, `sec`, `epic` | Classifies work nature and triggers `sec` risk floors. |
| **Complexity** | `c(low)`, `c(med)`, `c(high)`, `c(v.high)`, `c:pinned` | Selects `2-part` vs. `4-part` spec, model tier, and audit gate. |
| **Priority** | `p0`–`p3` | Orders the `Ready` queue; `P0`/`P1` force a `c(high)` floor. |
| **Lifecycle** | `backlog`, `ready`, `in progress`, `in review`, `in qa`, `blocked`, `on-hold`, `done` | Tracks state transitions; synced solely by tracker commands. |

## 3. Pros & Cons

**Pros**
- **Proportional rigor**: Risk floors escalate security, `P0`/`P1`, and guarded-path work without slowing trivial edits.
- **Predictable diff size**: The `<= 4` checkbox cap keeps commits atomic and PR reviews bounded.
- **Clean board telemetry**: Orthogonal labels and tracker-driven card initialization eliminate ad-hoc status drift.

**Cons**
- **Decomposition tax**: Splitting a 5-checkbox feature into an Epic and sub-issues adds setup overhead.
- **Override friction**: Legitimate low-risk `P1` fixes require explicit `c:pinned` annotation to avoid a `4-part` spec.
- **Multi-surface sync**: Cross-referencing `Parent: #<id>` links and Epic checkboxes relies on disciplined tracker usage.
