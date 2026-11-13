---
form: note
kind: field_note
title: Antigravity 2.0 Model Routing and Opportunity Cost
description: Dated snapshot of Antigravity 2.0 cloud quota pools, host subagent tiers, local LAN offload, and per-model opportunity costs.
draft: true
---

Treating every prompt as a flagship problem wastes weekly quota on boilerplate. Routing architecture or review to a lightweight tier trades catch-rate for cheap tokens and forces rework.

As of **November 2026**, we route foundry work across **two cloud quota pools**, **three host subagent tiers**, and a **local LAN offload**.

## 1. Quota Pools & Host Dispatch

Antigravity 2.0 splits cloud capacity into two rate-limit pools alongside local inference and host-managed subagents:

| Surface | Active Models / Tiers | Primary Role |
| :--- | :--- | :--- |
| **Pool A (Google)** | Gemini 4 Hydrogen (Low–XHigh), Carbon (Low–High), Argon (Low–High), Gemini 3.8 Flash (Low–High), Orchestrator (Carbon/Argon) | Daily coding (`Hydrogen`), frontier audits (`Carbon`), utility (`Flash`). |
| **Pool B (Partner)** | Claude Opus 5.5 (Low–High), Claude Sonnet 5.5 (Low–High), GPT-OSS 120B (Medium) | Cross-pool audits (`Sonnet`/`Opus`), forensics, and fallback. |
| **Local LAN** | Self-hosted `3B` / `7B` coder | Zero-cloud-quota diff linting and commit synthesis. |
| **Host Subagents** | `flash_lite`, `flash`, `pro` (disallowed: `inherit`) | Scoped child workers dispatched by a session. |

Omitted `Model` and `inherit` are banned across **all** tiers (`Low`–`Very High`) so child turns never clone parent quota.

Low/Medium tasks limit workers to `flash_lite`/`flash` and retire `flash_lite` from critics (`flash` minimum for Low/Med sub-issue reviews). High/Very High unlock `pro` for research and coaching; High+, Epic, and trunk reviews move to clean-room sessions.

## 2. Per-Model Opportunity Costs

| Model / Route | Best Fit | Sober Opportunity Cost |
| :--- | :--- | :--- |
| **Gemini 4 Hydrogen** (Low–XHigh) | Daily coding across Low–High | Shares Pool A with `Carbon`; over-efforting trivial edits drains audit quota. |
| **Gemini 4 Carbon** (Low–High) | Frontier audits; V.High / Epic | Scarce Pool A capacity; routine coding starves clean-room reviews. |
| **Gemini 4 Argon** (Low–High) | Legacy / non-audit utility | Trails high-effort `Hydrogen`; barred from clean-room audit stamps. |
| **Orchestrator** (Carbon / Argon) | Dynamic multi-step routing | Obscures model attribution; excluded from commit and audit stamps. |
| **Gemini 3.8 Flash** (Low–High) | Browser, lookups, Low/Med critics | Fast Pool A burn; misses cross-repo invariants without tight specs. |
| **Claude Sonnet 5.5** (Low–High) | Cross-pool audits and fallback | Spares Pool A while burning Pool B; needs cold-start handoff context. |
| **Claude Opus 5.5** (Low–High) | Deep forensic root-cause | Highest Pool B cost and latency; kept out-of-band, never routine PRs. |
| **GPT-OSS 120B** (Medium) | Pool B open-weights fallback | Fixed `Medium` effort; lacks headroom for High+ adversarial audits. |
| **Subagent `flash_lite` / `pro`** | `flash_lite`: status; `pro`: High+ research | `flash_lite` drifts on ambiguity; `pro` adds high latency and burn. |
| **Local LAN (`3B` / `7B`)** | Diff lint (`3B`/`7B`), commit text | Hardware latency, ~4K context cap, and offline fallback if down. |

Clean-room `Author != Reviewer` pairing bars `*-low` audits and enforces an **Authoring Boundary**.

Audits run **intra-Pool-A** (`Hydrogen -> Carbon`, or `Carbon -> Carbon` when reviewer effort >= author effort, sharing Pool A) or **cross-pool** (`Pool A -> Sonnet/Opus`, spending Pool B to spare Pool A).

## 3. Pros & Cons

**Pros**
- **Quota resilience**: Two cloud pools plus local LAN offload prevent one rate limit from stalling work.
- **Controlled subagent burn**: Banning `inherit` on all tiers and retiring `flash_lite` critics protects quota and catch-rate.
- **Uncorrelated reviews**: Intra-Pool-A (`Hydrogen -> Carbon`) and cross-pool (`Pool A -> Sonnet/Opus`) pairing catch blind spots.

**Cons**
- **Handoff & pool contention**: Cross-pool switches need cold-start summaries; `Hydrogen -> Carbon` shares Pool A.
- **Misrouted complexity**: Ambiguous tasks on `flash`/`flash_lite` or diffs past ~4K local context cause rework or clipping.
- **Snapshot decay**: Model rosters, effort bands, and pool limits shift faster than static routing tables.
