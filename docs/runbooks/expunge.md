# Operator Runbook: Entry Expunge & Git History Redaction

**Audience**: Operator-only (`kidthales/kidthales.github.io` repository owner).
**Scope**: Permanent redaction of a published or withdrawn Words Entry (`src/content/words/<slug>.md`) when required by legal, privacy, or sensitive-data grounds.

> [!CAUTION]
> **Irreversible History Rewrite**: Executing Steps 2–8 rewrites git commit SHAs across `next`, `main`, and tags. Never execute this runbook autonomously or for routine content retractions. For standard retractions where git history may remain intact, use the `withdraw` transition (`withdrawn_on` + `withdrawal_note`) instead.

---

## Step (0): Confirm Legal/Privacy Grounds & Record Reason Privately

1. Confirm that full historical expungement is strictly required on legal, privacy, or sensitive-data grounds.
2. Record the incident context, date, target `<slug>`, and specific reason **privately** in offline operator records.
3. **Strict Non-Disclosure Invariant**: **NEVER** record the sensitive reason or redacted text in:
   - Git commit messages
   - Pull request titles, bodies, or review comments
   - Frontmatter `withdrawal_note` or `errata[].note` fields
   - Tracker issues or public logs

---

## Step (1): Land the Expunge PR Passing `errata-guard`

Before rewriting git history, transition the Entry to the expunged `Withdrawn` state on trunk via a standard PR so that `errata-guard` and all CI fitness gates validate the tombstone state:

1. Edit `src/content/words/<slug>.md`:
   - Keep frozen fields (`form`, `kind`, `published_on`, `title`) intact.
   - Ensure `withdrawn_on: YYYY-MM-DD` is set (preserved if already Withdrawn, or newly set if transitioning directly from Published).
   - Newly set `expunged_on: YYYY-MM-DD`.
   - Set `withdrawal_note` to a generic, non-revealing policy statement (e.g., `Expunged per privacy and compliance policy.`). Within the `expunge` transition only, an existing `withdrawal_note` may be replaced.
   - If `errata[]` items exist and their `note` text contains sensitive details, redact each affected `note` to the canonical redaction stub: `This Entry has been expunged.`
   - Replace the Markdown body **byte-for-byte** with the canonical redaction stub:
     ```markdown
     This Entry has been expunged.
     ```
2. Run `pwsh ./scripts/ci-local.ps1` and merge the PR through the trunk gate.

---

## Step (2): Rewrite Historical Blobs via `git filter-repo`

On a fresh, clean clone of `kidthales/kidthales.github.io`, run `git filter-repo` with a `--blob-callback` that replaces every historical revision of `src/content/words/<slug>.md` (and any quoting files) with the canonical expunged stub version from `HEAD`:

```bash
# 1. Save the canonical expunged file bytes from HEAD outside the repository
cp src/content/words/<slug>.md /tmp/expunged-entry-stub.md

# 2. Identify all historical blob hashes for the target file (and any quoting files)
git log --all --pretty=format: --raw -- src/content/words/<slug>.md \
  | awk '{print $3, $4}' | tr ' ' '\n' | grep -E '^[0-9a-f]{7,40}$' | sort -u > /tmp/target-blobs.txt

# 3. Execute git filter-repo blob callback replacing matching historical blobs with the stub
git filter-repo --force --blob-callback '
with open("/tmp/expunged-entry-stub.md", "rb") as f:
    stub_bytes = f.read()
with open("/tmp/target-blobs.txt", "r") as f:
    target_prefixes = [line.strip() for line in f if line.strip()]
orig_hex = blob.original_id.decode("ascii")
if any(orig_hex.startswith(prefix) for prefix in target_prefixes):
    blob.data = stub_bytes
'

# 4. Shred temporary files
rm -f /tmp/expunged-entry-stub.md /tmp/target-blobs.txt
```

If any other tracked files quoted the redacted passage, include their historical blob hashes in `/tmp/target-blobs.txt` (or map them to their redacted replacement bytes) in the same `git filter-repo` pass.

---

## Step (3): Ruleset Override, Force-Push Under `GUARD-09`, and Ruleset Restoration

1. **Temporarily allow force-push** on the GitHub repository ruleset protecting `next` and `main` (Settings → Rules → Rulesets).
2. Re-attach the `origin` remote (removed by `git filter-repo`) and force-push `next`, `main`, and any affected tags under explicit operator confirmation (**`GUARD-09` force-ask**):
   ```bash
   git remote add origin https://github.com/kidthales/kidthales.github.io.git
   git push --force origin refs/heads/next:refs/heads/next
   git push --force origin refs/heads/main:refs/heads/main
   git push --force --tags origin
   ```
3. **Immediately restore the trunk ruleset** to block force-pushes and deletions on `next` and `main`.

---

## Step (4): Delete Workflow Runs and Build Artifacts Containing Old Text

Historical GitHub Actions runs and uploaded `dist/` artifacts prior to the expunge may contain the pre-expunge HTML:

1. List and delete all workflow runs and `dist` artifacts generated while the unredacted Entry existed:
   ```bash
   gh api repos/kidthales/kidthales.github.io/actions/artifacts --paginate \
     --jq '.artifacts[] | .id' \
     | xargs -I {} gh api -X DELETE repos/kidthales/kidthales.github.io/actions/artifacts/{}
   ```
2. Delete the corresponding workflow run logs in Actions (or via `gh run delete <run-id>`) for runs that built or logged the pre-expunge Entry.

---

## Step (5): GitHub Support Sensitive-Data Purge Request

Force-pushing branches does not immediately garbage-collect unreachable objects on GitHub servers if referenced by pull request refs (`refs/pull/*`), commit comment caches, or server-side object packs:

1. Open a **GitHub Support sensitive-data removal request** referencing `kidthales/kidthales.github.io`.
2. Request immediate purge of:
   - Cached commit views and diff renders for the old pre-filter commit SHAs
   - Pull request refs (`refs/pull/*/head` and `refs/pull/*/merge`) referencing pre-filter commits
   - Dangling commits and unreachable blobs via server-side `git gc --prune=now`

---

## Step (6): Google Search Console Removals & `noindex` Verification

1. Confirm that the deployed `/words/<slug>/` page renders the tombstone with `<meta name="robots" content="noindex">` and is absent from `/sitemap.xml`.
2. In **Google Search Console** → **Indexing** → **Removals**:
   - Submit a **New Request** (`Temporarily remove URL` + `Clear cached URL`) for `https://kidthales.github.io/words/<slug>/`.

---

## Step (7): Purge and Re-Clone Local Copies & Agent Workspaces

Every local environment that fetched the repository before Step (3) still holds the old git objects in `.git/objects` or cached logs:

1. Delete and freshly re-clone all local working copies and git worktrees (`git worktree prune` / delete directory and `git clone`).
2. Purge any local agent session artifacts, scratch files, or transcripts containing the pre-expunge text under:
   - `$HOME/.gemini/antigravity/brain/<conversation-id>/`
   - Any local temporary build logs or `/tmp` directories

---

## Step (8): Verification & Out-of-Reach Ledger

1. Verify that git history across all refs shows **only** the canonical redaction stub for `<file>`:
   ```bash
   git log --all -p -- src/content/words/<slug>.md
   ```
   Every commit patch touching `src/content/words/<slug>.md` must display `This Entry has been expunged.` as the body with zero occurrences of the prior text.
2. Verify zero occurrences across the entire object database:
   ```bash
   git rev-list --all --objects | cut -d ' ' -f 1 | git cat-file --batch-check \
     | awk '$2 == "blob" {print $1}' | xargs git grep -F "<distinctive-redacted-phrase>"
   ```
   (Must exit with no matches; clear shell history immediately after running.)
3. **Record Out-of-Reach Copies**: Document in private operator incident notes any known external copies outside repository control that cannot be purged by git rewrite:
   - Public GitHub forks created prior to Step (3)
   - Internet Archive (`web.archive.org`) snapshots (submit exclusion request if applicable)
   - Third-party search caches, RSS/scraper archives, or reader-saved copies
