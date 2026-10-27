---
record_type: "capability"
spec_version: 2
id: "content.discussion.page"
name: "Page Discussion"
user_promise: "Every Page has one Discussion that holds all of its comments: on the whole Page, on its text, and on its Properties."
primary_user_job: "Talk about a Page as a whole, and find every conversation about it in one place, without losing the exact text or value a comment concerns."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies:
  [
    "content.object.page",
    "content.object.blocks-field",
    "content.comment.page-owned",
  ]
related_features: ["content.feature.collaborate-in-context"]
roadmap_boundary: "feature"
acceptance_summary: "One Discussion panel per Page lists page comments, text comments, Property comments, and suggested edits, opens in page order with open threads, and offers personal, remembered sort and filters; page comments share Comment threads, replies, mentions, reactions, AI, resolution, notifications, and Actions."
proof_requirements:
  [
    "Page comments stored and resolved as ordinary Comment threads with no quote or Property",
    "One panel, toolbar count, and naming across locales",
    "Page order, Newest activity, and Oldest first, plus Status, Type, Points at, Who, Tab, and search filters that persist per person",
    "Replies, mentions, reactions, AI, notification links, Actions, and access on page comments",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-10-21"
---

# Page Discussion

## Why this exists

Some feedback is about a sentence; some is about the whole Page: is this ready, who owns it, what did we decide. Exact comments handle the first. Without a home for the second, people quote a random word to have somewhere to put it, and the conversation about a Page ends up split across margins, cells, and chat.

## Example workflow

A reviewer opens a Collection row's peek and, with nothing selected, writes "Looks ready, but who owns launch?" in the Discussion. It posts as a page comment: no quote, no label, not in the margin. The row's comment count and the Page's Discussion button both go up by one. The owner replies with an @mention, the reviewer reacts, and the thread is resolved; both counts go back down.

## Product contract

- Every Page has one Discussion. It holds every Comment thread the Page owns. A page comment has no quote and no Property; a text comment points at text; a Property comment points at one Property value (see `content.comment.page-owned`).
- The Discussion panel replaces the separate Comments panel. The panel, its toolbar button, its tab, its sheet title, and their tooltips say "Discussion" in every locale. The button shows how many open threads the Page has, the same number a Collection table shows on the row.
- The panel's composer, "Comment on this page…", starts a page comment. It supports @mentions, @AI, and reactions like any Comment. Page comments reply, resolve, reopen, notify, and react exactly like other threads, and they never show "Highlight unavailable". A text comment whose text was deleted still does, with its quote.
- Page comments do not appear in the margin beside the text, because they point at nothing there.
- The panel opens in page order with only open threads. Page order is page comments first, then Property comments in Property order, then text comments in reading order, then threads whose text is gone. Newest activity puts the thread with the latest reply on top; Oldest first sorts by when each thread started.
- Filters show as chips, like a Collection's: Status (Open by default, or Resolved), Type (Comments or Suggested edits), Points at (the Page, text, or a Property, where a thread on a video counts as text), Who (an author, or Mentions me), Tab (only on Pages with several Blocks fields), and search. Sort and filters are personal and remembered for each reader, and a search lasts until they leave the Page; none of it is saved on the Page.
- Opening a Comment link (`?comment=`) opens the Discussion at that thread, showing it even when the reader's filters would hide it, without changing those filters. Comment emails link to the thread this way. A page comment someone has just posted also stays in view until they change a filter.
- The same Comment Actions serve agents. `add-comment` with no quoted text, no Block, and no Property starts a page comment, and `list-comments` returns it.

## Boundaries and non-goals

- Discussion is not another body Block, Collection membership, task engine, or named Version.
- It does not replace History or Versions, and filters never change what is stored or who can see it.
- Page Version cursors on messages ("view the Page then") and status-change activity in the Discussion are later work, not part of this contract yet.

## Acceptance stories

### Comment on the whole Page from a row

Given a Collection row, when a commenter selects nothing and posts from the row's peek, the comment shows on the full Page with no quote and no label, and both the row's count and the Discussion button go up by one. Resolving it brings both back down.

### Treat a page comment like any comment

Given a page comment, replies, mentions, reactions, and @AI work on it, and a mention email opens the Page at that comment.

### Keep deleted-text warnings honest

Given a page comment and a text comment whose text was later deleted, the page comment never shows "Highlight unavailable"; the text comment still does, with its quote.

### Let an agent start the conversation

Given an agent with comment access, when it calls `add-comment` with no quote and no Property, then `list-comments` returns the page comment and the app shows it in the Discussion.

### Find the right thread

Given a Page with page, Property, and text comments, the panel opens in page order with only open threads. Choosing Newest activity puts the thread with the latest reply on top. Each filter shows as a chip like a Collection's, and both the sort and the filters survive a reload.

## Current evidence

Page comments use the existing `document_comments` storage: a root with no quoted text, no Block, and no Property. Collection row counts already count every open root, so page comments add to them with no new storage. The panel, composer, sort, filters, counts, naming, and email links are being built and tested; this remains `approved_shape` until that lands and Version cursors are designed.

## Proof plan

1. Post, reply, mention, react, resolve, and reopen page comments through the panel and through Actions.
2. Verify page order, Newest activity, and Oldest first, every filter and chip, and persistence across reloads for one reader without affecting another.
3. Verify the toolbar and row counts, the margin exclusion, "Highlight unavailable" rules, notification links, and every locale's naming.
4. Exercise keyboard, assistive technology, and narrow layouts.

## Open questions

How Version cursors and status-change activity appear in the Discussion is still to be designed; they must not make the Discussion the recovery authority or create a second Page identity.
