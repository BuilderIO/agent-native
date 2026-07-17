---
name: change-summary
description: >-
  End agent responses that include code changes with a Change summary table
  (Code / Tests / Config / Docs) and per-file line counts from git diff.
metadata:
  internal: true
---

# Change Summary

When you modify this repo, **end every response that includes code changes** with a **Change summary** section.

## Required format

Split the summary into four buckets. Omit a bucket only when nothing changed in it.

```md
## Change summary

### Code
| File | + | − |
|------|---|---|
| `path/to/file.ts` | 12 | 3 |

**Subtotal:** +N −M across K files

### Tests
| File | + | − |
|------|---|---|
| `path/to/file.test.ts` | 4 | 1 |

**Subtotal:** +N −M across K files

### Config
| File | + | − |
|------|---|---|
| `server/plugins/db.ts` | 1 | 1 |

**Subtotal:** +N −M across K files

### Docs
| File | + | − |
|------|---|---|
| `AGENTS.md` | 2 | 2 |

**Subtotal:** +N −M across K files

**Total:** +N −M across K files
```

## How to classify files

| Bucket | Include |
|--------|---------|
| **Code** | `actions/*.ts` (non-test), `app/**`, `server/**` except test-only helpers |
| **Tests** | `**/*.test.ts`, `**/test-*.ts`, in-memory test DB SQL in `server/db/test-tasks-table.ts` |
| **Config** | DB migrations and table defs (`server/plugins/db.ts`, `server/db/schema.ts`), `package.json`, `tsconfig*.json`, `vite.config.*`, CI/workflow YAML, env templates |
| **Docs** | `*.md`, skill files under `.agents/skills/` and `.claude/skills/` |

New untracked files: list under the right bucket with **+lines 0** (all lines are additions).

Renames/deletes: show the old path with deletions and the new path with additions, or one row with net +/−.

## How to compute counts

Prefer git over guessing:

```bash
git diff --numstat
git status --short   # for untracked files
wc -l <new-file>     # line count for new files
```

Use line counts from `git diff --numstat` (added, removed). Do not approximate from memory.

## When to include it

- Always after implementation, refactor, or fix commits in the working tree.
- Skip only for pure Q&A with **no** file edits.
- If the user asked only for a review with no changes, skip the summary.

Place the change summary **before** the final 🟢/🟡/🔴 status line.
