---
name: apply-slide-comments
description: >-
  Turn open slide comments into edits and resolve them. Use when the user asks
  to apply, address, resolve, or work through comments, review notes, or
  feedback left on a deck or slide.
---

# Apply Slide Comments

Comments are instructions anchored to a slide. Edits follow `slide-editing`;
this skill is the loop around them.

## Procedure

1. **Collect.** `list-slide-comments` with `deckId` (add `slideId` only when the
   user scoped the request; page with `next_cursor` while `has_more`). Keep
   threads with `resolved: false`. A thread is the root comment plus replies
   (`thread_id`, `parent_id`); read the whole thread, and treat the latest
   instruction as current.
2. **Group by slide** and note each comment's anchor: `anchor.objectId` is the
   `data-slide-object-id` element, `quoted_text` / `anchor.targetText` and the
   text offsets locate the words, and an anchor with only `x` / `y` is a
   position on the slide.
3. **Read each affected slide** once: `view-screen` for the open slide,
   `get-deck` with `slideIds` and `compact=false` for the rest. Interpret the
   comment against its anchor object, not the whole slide.
4. **Apply every edit for one slide in a single `patch-deck` `patch-slide`
   operation** with that slide's `baseContentHash`. Preserve ids and
   `left`/`top`/`width`, and change only what the comment asks for.
5. **Verify.** When text length changed, call `get-layout-overflows` once after
   all slides are written, and `audit-contrast` last (see `slide-editing`). Read
   the persisted slide back before resolving anything.
6. **Resolve** each applied thread: `update-slide-comment` with `id`, `deckId`,
   `resolved: true` (resolving applies to the full thread). Never delete a
   user's comment.
7. **Leave open** any comment you skipped, that is ambiguous, or that asks for
   something outside the deck (new data, an image only the user has). Say why
   in the summary; reply with `add-slide-comment` (`threadId` + `parentId`)
   only if the user asked you to.

## Judgment

- Ambiguous but low-risk: apply the smallest reasonable reading and state the
  assumption. Ambiguous and costly to undo (cuts content, changes numbers,
  conflicts with another comment): skip it.
- Conflicting comments on one element: apply neither, name both.
- A comment about a fact needs the source; follow `creative-context`, do not
  guess.
- Leave no TODO or "per comment" text in slide HTML.

## Summary

Finish with one line, `N applied, M skipped`, then one line per change
(slide number, what changed) and one per skipped comment with its reason.
