---
form: note
kind: field_note
title: Antigravity 2.0 Model Routing and Opportunity Cost
description: A dated snapshot of how we route work across Antigravity 2.0's two cloud quota pools, host subagent dispatch tiers, and local LAN offload—and what each choice costs.
draft: true
---

Treating every prompt as a flagship-model problem burns weekly quota on boilerplate and stalls parallel work. Conversely, routing nuanced architecture or adversarial review to a lightweight tier trades away catch-rate for cheap tokens and forces expensive human rework.

As of **November 2026**, we route foundry sessions across **two independent cloud quota pools**, **three host subagent tiers**, and a **local LAN coder offload**.

## 1. Quota Pools & Host Dispatch Topology

Antigravity 2.0 partitions cloud capacity into two separate rate-limit pools, supplemented by local inference on the LAN:

| Pool / Surface | Models / Tiers | Primary Foundry Role |
| :--- | :--- | :--- |
| **Pool A (Google)** | Gemini Flash, Pro, flagship tiers | Default planning, implementation, and clean-room cross-checks. |
| **Pool B (Partner)** | Claude Sonnet / Opus, open-weights | Independent second-opinion reviews (`Author != Reviewer`) and fallback. |
| **Local LAN** | Self-hosted coder / summarizer | Zero-cloud-quota staged diff review and commit message synthesis. |
| **Host Subagents** | `flash_lite`, `flash`, `pro`, `inherit` | Scoped background workers dispatched by the parent session. |

Subagent dispatch defaults matter. Passing `inherit` (or omitting `Model`) clones the parent session's flagship quota into every child turn. Our governance linter flags `inherit` on Low/Medium tasks (`flash_lite` or `flash` required), reserving `pro` for deep research or adversarial review and `flash` as the default for browser automation.

## 2. Role & Opportunity Cost Matrix

| Tier / Route | Best Fit | Sober Opportunity Cost |
| :--- | :--- | :--- |
| **Flagship (Pool A / B)** | Multi-file architecture, specs, hard debugging | Highest quota burn; slow turn latency on trivial edits. |
| **Mid-Tier (`Pro` / `Sonnet`)** | Standard feature tickets, PR spec audits | Moderate burn; weaker on sprawling cross-repo invariants. |
| **Fast (`flash`)** | Browser workflows, scoped lookups, Low/Med tickets | Misses subtle multi-step constraints without tight specs. |
| **Lite (`flash_lite`)** | High-volume classification, status checks, formatting | High drift risk on ambiguous prompts; zero architectural judgment. |
| **Local LAN Offload** | Staged diff linting, commit formatting | Hardware-bound latency; degrades if LAN host is offline (requires fallback). |

Cross-pool pairing enforces an **Authoring Boundary**: a feature authored in Pool A is audited by a clean-room reviewer in Pool B (or a distinct model family), eliminating correlated blind spots from a single model's priors.

## 3. Pros & Cons

**Pros**
- **Quota resilience**: Two cloud pools plus local LAN offload prevent a single rate limit from halting delivery.
- **Controlled subagent burn**: Explicit `flash_lite` / `flash` dispatch stops child workers from draining flagship quota.
- **Uncorrelated reviews**: Cross-pool `Author != Reviewer` routing catches shared-prior blind spots before merge.

**Cons**
- **Handoff overhead**: Switching models or pools mid-ticket requires explicit state summaries and cold-start context.
- **Misrouted complexity**: Under-specifying a ticket on `flash` or `flash_lite` produces plausible-looking rework.
- **Snapshot decay**: Model rosters, pool boundaries, and relative costs shift faster than static routing tables.
