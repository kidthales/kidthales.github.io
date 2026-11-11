---
form: note
kind: field_note
title: The 3-Layer Rule and 3-Tier Skill System
description: Why we partition agent context by scope and loading phase, how our byte and token caps derive from Antigravity runtime limits, and what we trade away.
published_on: 2026-11-10
---

Flat instruction files rot quickly. As a codebase grows across repositories, a single `AGENTS.md` accumulates contradictory domain rules, verbose runbooks, and one-off postmortem scars until every turn pays a permanent tax in latency, diluted attention, and silent host truncation.

We partition agent guidance along two orthogonal axes: **3 scope layers** (where an invariant applies) and **3 disclosure tiers** (when it enters the context window).

## 1. The Two Axes

### Scope Layers (Always-Loaded Rules)

| Layer | Scope | Path Pattern | Purpose |
| :--- | :--- | :--- | :--- |
| **Layer 1** | Universal | `plugins/*/rules/AGENTS.md` | Cross-silo safety, git lifecycle, and polyglot engineering pillars. |
| **Layer 2** | Silo / Foundry | `<silo>/.agents/rules/*.md` | Domain-specific invariants (e.g., OSS portfolio vs. game studio). |
| **Layer 3** | Leaf Repo | `<repo>/.agents/rules/*.md` | Repository-local overrides (`0 B` on clean-room public repos). |

### Progressive Disclosure Tiers (Loading Phase)

Following Antigravity's [progressive disclosure model](https://antigravity.google/docs/skills), workflows and reference manuals stay out of the baseline prompt:

| Tier | Artifact | Loading Phase | Contents |
| :--- | :--- | :--- | :--- |
| **Tier 1** | Rules + Skill Frontmatter | Always loaded (`every turn`) | Atomic invariants (`<= 3` lines) and YAML skill triggers (`name`, `description`). |
| **Tier 2** | Skill Bodies (`SKILL.md`) | On demand (`task activation`) | Domain workflows, checklists, and decision trees. |
| **Tier 3** | Reference Docs (`docs/`, `references/`) | Explicit lookup (`deep dive`) | Exhaustive schemas, CLI flags, and recovery runbooks. |

## 2. Why Those Numbers?

Google Antigravity's customization runtime ([Rules & Workflows](https://antigravity.google/docs/rules-workflows), `agy-customizations`) enforces two hard limits on workspace rules:
1. **Per-File Truncation Cap (`24,000` bytes / `24 KB`)**: Any rule file exceeding `24,000` bytes (after `@[label](path)` include expansion) is truncated on line boundaries.
2. **Aggregate Rules Budget (`20,000` tokens / `defaultRulesBudget`)**: Always-on and global rules share a `20,000`-token budget. Over-budget rules are silently demoted from inline text to bare file-path pointers.

To fail fast in CI before the host ever truncates a line or demotes a rule, `seldon budget` enforces stricter thresholds using CRLF-normalized byte counts and a deterministic `4 B/token` estimator:

| Threshold | Value | Rationale |
| :--- | :--- | :--- |
| **Hard Ceiling** | `20,000` tokens (`~80 KB`) | **100% of Antigravity's `defaultRulesBudget`**. Unlike the host, `seldon budget` counts both Layers 1–3 *and* Skill frontmatter against this ceiling; breaching it fails CI (`ERROR`). |
| **Comfort Budget** | `10,000` tokens (`~40 KB`) | **50% of `defaultRulesBudget`**. Maintains a `2x` safety margin across multi-plugin mounts and keeps baseline overhead under `~5%` of working context. |
| **Rule File Cap** | `12,000` bytes (`~3,000` tokens) | **50% of Antigravity's `24 KB` per-file cap**. Prevents line-boundary truncation, fits two full Layer 1 plugin rule files inside the comfort budget, and enforces **net-zero entropy** (new rules require consolidating or evicting old ones). |
| **Skill File Cap** | `8,000` bytes (`~2,000` tokens) | **1/3 of the `24 KB` file cap** (`~200` lines). Ensures any activated `SKILL.md` fits in one bounded read, pushing heavy tables into Tier 3 `references/`. |
| **Invariant Length** | `<= 3` lines | Stops tutorials from masquerading as Tier 1 rules; if it cannot be stated as a compact predicate, it routes to Tier 2 or Tier 3. |
| **Doc Blob Guard** | `20,000` bytes (`20 KB`) | Flags embedded `data:image` base64 blobs in Tier 3 markdown docs before an on-demand read detonates turn context. |

In steady state, always-loaded context sits near `~5.9K` tokens (`~23.7 KB`), while `~13.3K+` tokens (`~53.1 KB`) of specialized domain knowledge stay deferred on disk until needed.

## 3. Pros & Cons

**Pros**
- **Zero silent truncation or demotion**: Auditing at `50%` of the host's per-file and aggregate limits guarantees rules are never clipped or demoted to path pointers at runtime.
- **Bounded baseline burn**: Every turn pays only for active invariants and compact skill routing headers (`~780` tokens across 9 skills).
- **Higher instruction adherence**: Short, predicate-style rules in Tier 1 suffer far less attention dilution than monolithic prompt files.
- **Clean-room portability**: Keeping Layer 1/2 outside leaf repositories lets public repos ship with zero AI configuration clutter.

**Cons**
- **Activation misses**: If a skill's YAML `description` is poorly phrased, an agent may fail to load Tier 2 guidance before acting.
- **Extra tool-call hop**: Loading a Tier 2 `SKILL.md` and a Tier 3 `references/*.md` file costs `1–2` initial file reads on specialized tasks.
- **Editorial friction**: Authors must actively classify knowledge into invariants (Tier 1), workflows (Tier 2), or reference tables (Tier 3) to pass `seldon budget --strict`.
