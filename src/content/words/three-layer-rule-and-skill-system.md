---
form: note
kind: field_note
title: The 3-Layer Rule and 3-Tier Skill System
description: Why we partition agent context by scope and loading phase, how our byte and token caps derive from Antigravity runtime limits, and what we trade away.
published_on: 2026-11-10
errata:
  - on: 2026-11-13
    class: correction
    note: Aligned budgets, trigger modes, hub/leaf pairing, and telemetry with Antigravity 2.0; generalized CLI terms.
---

Flat instruction files rot quickly. A single `AGENTS.md` accumulates contradictory rules and runbooks until every turn pays in latency, diluted attention, and truncation.

We partition guidance by **3 scope layers** (where) and **3 disclosure tiers** (when).

## 1. The Two Axes

| Axis | Level | Artifact / Path | Loading & Purpose |
| :--- | :--- | :--- | :--- |
| **Scope** | **Layer 1** | `plugins/*/rules/AGENTS.md`, `GEMINI.md` | Universal safety, git lifecycle, and polyglot pillars. |
| **Scope** | **Layer 2** | `<silo>/.agents/rules/*.md` | Silo invariants (`always_on` or Tier 2). |
| **Scope** | **Layer 3** | `<repo>/.agents/rules/*.md` | Leaf overrides (`0 B` on clean-room repos). |
| **Phase** | **Tier 1** | `always_on` + `CustomizationFootprint` | Always loaded: rules (<= 3 lines) and metadata. |
| **Phase** | **Tier 2** | `skills/*/SKILL.md`, triggered rules | On demand ([progressive disclosure](https://antigravity.google/docs/skills)). |
| **Phase** | **Tier 3** | `docs/`, `references/` | Explicit lookup; schemas and runbooks. |

Layer 1 `AGENTS.md`/`GEMINI.md` are frontmatter-free `always_on` (strict-mode CI enforced). Layer 2–3 `.agents/rules/*.md` support `trigger:` modes: `always_on` (Tier 1) or `model_decision`/`glob`/`manual` (Tier 2).

Because discovery stops at `.git`, clean-room leaf repos (`0 B` Layer 3) cannot inherit Layer 2 rules alone; authoring requires a `[<hub>, <leaf>]` multi-root workspace with the silo hub (enforced by a workspace pre-invocation guard).

## 2. Why Those Numbers?

Antigravity ([Rules & Workflows](https://antigravity.google/docs/rules-workflows), `agy-customizations`) enforces a **24,000 B (24 KB) per-file cap** (line truncation) and a **20,000-token `defaultRulesBudget`** (pointer demotion). In Antigravity 2.0, `defaultRulesBudget` covers **`always_on` rules (Layers 1–3)** strictly; Skill frontmatter, custom subagents, MCP schemas, and `.agents/{skills,plugins}.json` manifests occupy a separate `CustomizationFootprint` pool.

Our CI budget linter enforces stricter thresholds (CRLF-normalized, 4 B/token):

| Threshold | Limit | Upstream Anchor & Rationale |
| :--- | :--- | :--- |
| **Hard Ceiling** | 20,000 tokens (~80 KB) | **100% of `defaultRulesBudget`**, `always_on` Layers 1–3 only (`ERROR`). |
| **Comfort Budget** | 10,000 tokens (~40 KB) | **50% of `defaultRulesBudget`** (<5% context). |
| **Customization Footprint** | Telemetry | Tracks Skill frontmatter, subagents, MCP schemas, and `.agents/` manifests. |
| **Rule File Cap** | 12,000 B (~3K tokens) | **50% of 24 KB cap**; prevents truncation, forces **net-zero entropy**. |
| **Skill File Cap** | 8,000 B (~2K tokens) | **1/3 of 24 KB cap** (~200 lines); tables move to Tier 3. |
| **Invariant Length** | <= 3 lines | Keeps tutorials in Tier 2/3. |
| **Doc Blob Guard** | 20,000 B (20 KB) | Flags `data:image` base64 blobs in Tier 3 docs. |

In steady state, `always_on` rules sit near ~5.1K tokens and `CustomizationFootprint` near ~2.1K tokens (12 skills, 7 subagents, 4 MCP servers), with ~15.8K tokens of skill bodies on disk.

## 3. Pros & Cons

**Pros**
- **Zero silent truncation or demotion**: 50% host-limit checks prevent clipping and demotion.
- **Bounded baseline burn**: Turns load only `always_on` rules (~5.1K) and metadata (~2.1K across 12 skills, 7 subagents, 4 MCP servers).
- **Higher adherence & clean-room repos**: Short Tier 1 predicates reduce dilution; Layers 1–2 stay outside public leaf repos.

**Cons**
- **Activation misses**: Weak `description` fields can miss Tier 2 skills.
- **Extra tool-call hop**: Reading Tier 2/3 files adds 1–2 reads.
- **Editorial friction**: Classifying rules across Tiers 1–3 for strict CI checks.
