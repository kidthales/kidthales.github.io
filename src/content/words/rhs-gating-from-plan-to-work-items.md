---
form: note
kind: field_note
title: "Right-Hand Side Gating: From Plan to Work Items"
description: Compiling LHS plans into bounded RHS work items via risk floors, topologies, a four-checkbox cap, and orthogonal labels.
published_on: 2026-11-17
---

Uncapped issues grow into multi-week branches that outlast review windows; underspecified security work skips baseline invariants.

Once a **Left-Hand Side (LHS)** plan is approved, a **Ready** gate compiles it into bounded **Right-Hand Side (RHS)** work items before any branch opens.

## 1. Proportional Specs, Risk Floors & Topologies

Items enter the tracker unassigned—never pre-tagged with lifecycle labels—so `Ready` initializes the board card, validates structure, and sets complexity:

| Tier | Spec Shape | Risk-Floor Trigger | Topology |
| :--- | :--- | :--- | :--- |
| **Low / Med** | `2-part` (`Overview`, `MVP Scope`) | Default (`docs`, `chore`, `feat`, `fix`) | Standalone (`<= 4`) or sub-issue |
| **High** | `4-part` (`+ Baseline`, `Out of Scope`, *Parti*, Matrix) | `sec`, `P0`/`P1`, or guarded paths (hooks, FSM, auth, CI; `c:pinned` opts out) | Standalone or Epic + sub-issues |
| **Very High** | `4-part` (+ Epic `- [ ] #<id>` list if Epic) | `> 4` checkboxes or cross-module scope | Standalone or `Trunk <- Epic <- Sub-Issues` (or waves) |

Three decomposition topologies govern where branches land:

- **Bare Standalone (`Trunk <- Issue`)**: Self-contained work (`1–4` checkboxes) targeting trunk.
- **Epic + Sub-Issues (`Trunk <- Epic <- Sub-Issues`)**: Sub-issues declare `Parent: #<epic-id>` on line 1, merge to the Epic branch, and hold trunk sign-off at the Epic PR.
- **Epic Waves**: Multi-phase work splits into sequenced waves under an Epic so early slices verify first.

### Why Cap Items at <= 4 MVP Checkboxes?

Non-Epic items cap at **four MVP checkboxes** (oversized drafts promote to an Epic or split into sibling sub-issues):

- **1:1 atomic checkpoints**: Each checkbox maps to one verified commit, updating issue and draft PR checklists.
- **Bounded review diffs**: Four narrow steps keep PR diffs within local linter and clean-room auditor budgets.
- **Crisp blast radius**: Small slices isolate regressions and simplify mid-flight reverts.

## 2. Orthogonal Metadata & Label Axes

Filtering, risk floors, and queue ordering separate across four label axes and board fields:

| Axis | Canonical Values | Purpose |
| :--- | :--- | :--- |
| **Type / Kind** | `feat`, `fix`, `chore`, `docs`, `sec`, `epic` | Classifies work and triggers `sec` risk floors. |
| **Complexity** | `c(low)`, `c(medium)`, `c(high)`, `c(very high)`, `c:pinned` | Picks `2-part` vs. `4-part` spec, model tier, and audit gate. |
| **Priority** | `p0`–`p3` (board `P0`–`P3`) | Orders `Ready`; `P0`/`P1` force a `c(high)` floor. |
| **Lifecycle** | `backlog`, `ready`, `in progress`, `in review`, `in qa`, `blocked`, `on hold`, `done` | Tracks state transitions via tracker commands only. |

## 3. Pros & Cons

**Pros**
- **Proportional rigor**: Risk floors escalate security, `P0`/`P1`, and guarded paths without slowing trivial edits.
- **Predictable diff size**: The `<= 4` checkbox cap keeps commits atomic and reviews bounded.
- **Clean board telemetry**: Orthogonal labels and tracker-driven card setup prevent status drift.

**Cons**
- **Decomposition tax**: Splitting a 5-checkbox feature into an Epic and sub-issues adds setup overhead.
- **Override friction**: Low-risk `P1` fixes require `c:pinned` to avoid a `4-part` spec.
- **Multi-surface sync**: Cross-referencing `Parent: #<id>` links and Epic checkboxes demands tracker discipline.
