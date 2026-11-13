---
form: note
kind: field_note
title: The 3-Layer Rule and 3-Tier Skill System
description: Why we partition agent context by scope and loading phase, how our byte and token caps derive from Antigravity runtime limits, and what we trade away.
published_on: 2026-11-10
errata:
  - on: 2026-11-13
    class: correction
    note: Updated Antigravity 2.0 defaultRulesBudget scope (always_on rules vs. CustomizationFootprint), Layer 1 vs. Layer 2/3 trigger semantics, clean-room hub/leaf multi-root workspace pairing, steady-state token telemetry, and generalized private CLI references.
---

Flat instruction files rot quickly. As a codebase grows across repositories, a single `AGENTS.md` accumulates contradictory domain rules, verbose runbooks, and one-off postmortem scars until every turn pays a permanent tax in latency, diluted attention, and silent host truncation.

We partition agent guidance along two orthogonal axes: **3 scope layers** (where an invariant applies) and **3 disclosure tiers** (when it enters context).

## 1. The Two Axes

| Axis | Level | Artifact / Path | Loading & Purpose |
| :--- | :--- | :--- | :--- |
| **Scope** | **Layer 1** | `plugins/*/rules/AGENTS.md`, `GEMINI.md` | Frontmatter-free `always_on` universal safety, git lifecycle, and polyglot pillars. |
| **Scope** | **Layer 2** | `<silo>/.agents/rules/*.md` | Silo-specific invariants (`trigger:`-capable: `always_on` or Tier 2 on-demand). |
| **Scope** | **Layer 3** | `<repo>/.agents/rules/*.md` | Leaf-repo `trigger:` rules (0 B on clean-room public repos). |
| **Phase** | **Tier 1** | `always_on` Rules + `CustomizationFootprint` | Always loaded across two pools: `always_on` rules (<= 3 lines) vs. customization metadata (Skill frontmatter, custom subagents, MCP schemas, `.agents/{skills,plugins}.json`). |
| **Phase** | **Tier 2** | `skills/*/SKILL.md`, triggered rules | On demand ([progressive disclosure](https://antigravity.google/docs/skills)); skill bodies plus `trigger: model_decision`/`glob`/`manual` rules. |
| **Phase** | **Tier 3** | `docs/`, `references/` | Explicit deep-dive lookup; schemas, flags, and runbooks. |

Layer 1 `AGENTS.md` and `GEMINI.md` files do not support frontmatter and load unconditionally as `always_on` (enforced in strict mode by our CI budget linter). Layer 2 and Layer 3 `.agents/rules/*.md` files support YAML `trigger:` modes: `always_on` loads in Tier 1, whereas `model_decision`, `glob`, and `manual` defer to Tier 2 on-demand loading.

Because Antigravity stops upward workspace discovery at a repository's `.git` boundary, clean-room public leaf repositories (`0 B` Layer 3) cannot inherit Layer 2 `.agents/rules/*.md` when opened alone. Authoring in a clean-room leaf repo requires a `[<hub>, <leaf>]` multi-root workspace paired with its silo hub (enforced by a workspace pre-invocation guard) so the hub root supplies Layer 2 rules.

## 2. Why Those Numbers?

Google Antigravity's runtime ([Rules & Workflows](https://antigravity.google/docs/rules-workflows), `agy-customizations`) enforces two hard limits on workspace rules: a **24,000 B (24 KB) per-file cap** (above which files truncate on line boundaries) and a **20,000-token aggregate budget** (`defaultRulesBudget`, above which rules demote from inline text to file pointers). In Antigravity 2.0, `defaultRulesBudget` covers **`always_on` rules across Layers 1–3** strictly; Skill frontmatter, custom subagents, MCP schemas, and `.agents/{skills,plugins}.json` manifests occupy a separate `CustomizationFootprint` pool.

To fail fast in CI before the host truncates a line or demotes a rule, our CI budget linter enforces stricter thresholds (CRLF-normalized at 4 B/token):

| Threshold | Limit | Upstream Anchor & Rationale |
| :--- | :--- | :--- |
| **Hard Ceiling** | 20,000 tokens (~80 KB) | **100% of `defaultRulesBudget`**. Counts `always_on` rules across Layers 1–3 only; breach fails CI (`ERROR`). |
| **Comfort Budget** | 10,000 tokens (~40 KB) | **50% of `defaultRulesBudget`**. Gives a 2x multi-plugin safety margin (<5% of working context). |
| **Customization Footprint** | Telemetry (separate pool) | Tracks Skill frontmatter, custom subagents, MCP schemas, and `.agents/{skills,plugins}.json` manifests outside `defaultRulesBudget`. |
| **Rule File Cap** | 12,000 B (~3,000 tokens) | **50% of the 24 KB file cap**. Prevents line truncation and forces **net-zero entropy** (consolidate or evict). |
| **Skill File Cap** | 8,000 B (~2,000 tokens) | **1/3 of the 24 KB file cap** (~200 lines). Fits one bounded read; pushes tables to Tier 3 `references/`. |
| **Invariant Length** | <= 3 lines | Keeps tutorials out of Tier 1; non-predicates route to Tier 2 or Tier 3. |
| **Doc Blob Guard** | 20,000 B (20 KB) | Flags embedded `data:image` base64 blobs in Tier 3 docs before they spike context on read. |

In steady state, `always_on` rules sit near ~5.1K tokens and the `CustomizationFootprint` pool near ~2.1K tokens (across 12 skills, 7 subagents, and 4 MCP servers), while ~15.8K tokens of on-demand skill bodies stay deferred on disk.

## 3. Pros & Cons

**Pros**
- **Zero silent truncation or demotion**: Auditing at 50% of host limits guarantees rules are never clipped or demoted to path pointers.
- **Bounded baseline burn**: Every turn pays only for active invariants (~5.1K `always_on` rule tokens) and compact customization metadata (~2.1K tokens across 12 skills, 7 subagents, and 4 MCP servers).
- **Higher adherence & clean-room repos**: Short Tier 1 predicates avoid attention dilution, and Layer 1/2 stay outside public leaf repos.

**Cons**
- **Activation misses**: Poorly phrased YAML `description` fields can cause an agent to skip Tier 2 guidance.
- **Extra tool-call hop**: Reading a Tier 2 `SKILL.md` and Tier 3 reference costs 1–2 initial file reads on specialized tasks.
- **Editorial friction**: Authors must classify guidance across Tiers 1–3 to pass strict CI budget checks.
