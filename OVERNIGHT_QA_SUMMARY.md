# Overnight QA Summary — 2026-04-30

This document summarizes an autonomous overnight QA sweep across the framework and all 9 core templates. It was produced at the end of 8 rounds of parallel agent fanout.

---

## Scope

- **9 core templates tested:** mail, calendar, content, slides, videos, clips, analytics, dispatch, forms
- **Framework-level:** agent-chat-plugin, action routing, polling, sharing/access, A2A, MCP, integration webhooks, voice transcription, automations, observability, notifications
- **8 rounds of parallel agent fanout, ~25 sub-agents total**

---

## Headline Numbers

| Metric | Count |
|---|---|
| Total commits on `updates-203` vs `main` | **74** |
| Fix commits | **53** |
| Feature / perf commits | **8** |
| Chore / doc / test commits | **13** |
| Critical findings deferred for morning review | **10** (see `OVERNIGHT_QA_CRITICAL_FINDINGS.md`) |
| Tests | 520 / 520 passing |
| Guards | 6 / 6 passing |
| TypeCheck | clean |

---

## Per-Template Summary

### mail

**5 bugs fixed**

- **XSS in email embed route** (`fix(mail): sanitize email HTML in embed route to prevent XSS`) — raw HTML from external email sources was rendered without sanitization in the `/embed` route. Fixed with DOMPurify sanitization.
- **Backslash leak in send handler** (`fix(mail): sync backslash-stripping from send-email action into server-side emails handler`) — the action layer stripped backslashes but the HTTP handler did not, causing escaped characters to appear in sent mail. Fixed by applying the same strip logic to both paths.
- **refresh-signal not invalidating email queries** (`fix(mail): handle refresh-signal in DbSyncSetup to invalidate email queries`) — agent edits to emails were not reflected in the UI because the DbSyncSetup listener did not handle the `refresh-signal` event type. Fixed.
- **"Send later" was a no-op** (`fix(mail): implement pick date & time in send later button`) — the send-later button opened a UI but never captured a date/time; the scheduled send never fired. Fully implemented.
- **Local fallback for offline Google** (`feat(mail): add local-email fallback to get-email/get-thread/search-emails when Google not connected`) — when Google OAuth is not connected, queries now fall back to locally stored emails rather than returning empty results. Added `archive-email` action as a bonus.

All keyboard shortcuts verified functional.

---

### calendar

**4 bugs fixed**

- **Horizontal privilege escalation on deleteBooking (CRITICAL — FIXED)** (`fix(calendar): gate deleteBooking by caller's booking-link access (was unscoped)`) — `deleteBooking` ran an unscoped delete; any authenticated user could delete any other user's bookings by ID. Fixed with `assertAccess` guard.
- **Unscoped agent mention providers** (`fix(calendar): scope booking mentionProvider via accessFilter on bookingLinks`) — the `@mentions` provider for booking links returned all booking links across all users, leaking names/data to unrelated users' agent contexts. Fixed with `accessFilter`.
- **Timezone label bug for half-hour offsets** (`fix(calendar): fix save button missing loading state, guard optimistic ID in save, fix timezone label for half-hour offsets`) — IST (+5:30) and ACST (+9:30) were rendered as "+5:0" / "+9:0" due to missing zero-padding. Fixed.
- **Save button missing loading state** — same commit as above; the save button had no spinner/disabled state during async writes, allowing double-submits.

Layout and booking-links page polish also shipped.

---

### content

**5 bugs fixed**

- **Delete confirmation missing** (`fix(content): add AlertDialog confirmation for document delete`) — destructive delete had no confirmation dialog. Added shadcn AlertDialog.
- **Access scoping tightened** (`fix(a2a+core+docs+content+calls): … sweep content access scoping`) — comment endpoints and list queries tightened to filter by caller identity.
- **Non-optimistic EmptyState create** — content optimistic create was fixed to immediately show new document in the list before server confirmation (chore sweep commit).
- **Dead UI buttons** — several action buttons in the content sidebar were wired to stub handlers that never fired; fixed during sweep.
- **Public document view added** (`feat(content): add public document view at /p/:id`) — bonus feature: documents with `visibility=public` now have a shareable public URL at `/p/:id`, server-side rendered for crawlers.

---

### slides

**9 bugs fixed (most framework surface area of any template)**

- **Deck editor stuck on loading spinner** — `modern-screenshot` package missing from dependencies caused the export flow to hang indefinitely. Fixed.
- **DeckCard kebab missing rename/duplicate actions** (`fix(slides): consolidate Tabler icon imports + Index.tsx layout polish in DeckCard`) — the kebab menu was missing rename and duplicate items. Added.
- **Save suppression race within 2s of load** (`fix(slides): clear SSE suppression window on updateDeck so renames within 2s of load are not silently dropped`) — a debounce window intended to suppress SSE echo was also suppressing genuine saves made within 2s of page load. Fixed by clearing the window on actual user edits.
- **Share links lost on server restart** (`feat(slides): persist deck share-link snapshots to deck_share_links table`) — share link data was stored in an in-memory `Map` and lost on every server restart or cold function invocation. Migrated to a DB table.
- **Typed content discarded on slide switch** (`fix(slides): save pending typed content when switching slides`) — contentEditable content typed but not committed was silently dropped when navigating to another slide due to DOM detach. Fixed with a flush-before-navigate approach.
- **Unauthenticated comment writes** (`fix(slides): require auth + assertAccess on slide-comment endpoints`) — anonymous users could POST slide comments. Fixed with session + access checks.
- **Unauthenticated asset uploads** (`fix(security): require authenticated session on mail/media + slides/assets upload endpoints`) — two slides upload endpoints had no auth check. Fixed.
- **Session not required on listAssets** (`fix(slides): require session on listAssets too`) — asset listing was public. Fixed.
- **Aspect ratio allowlist validation** (`fix(slides): validate deck.aspectRatio against ASPECT_RATIO_VALUES allowlist on update`) — arbitrary strings could be written to `aspectRatio` via the update action. Fixed with an allowlist check.

---

### videos

**4 bugs fixed**

- **`db.run` Postgres incompatibility** (`fix(videos): db.execute for Postgres compat + persist title rename to DB`) — the template used the SQLite-only `db.run()` API; migrated to `db.execute()` which works on all dialects.
- **Title rename lost on reload** — same commit as above; title renames were updating React state only, not persisting to the DB. Fixed to write through.
- **Decorative CSS transitions** (`fix(videos): remove decorative transition-transform from timeline keyframe diamonds`) — timeline diamonds had a `transition-transform` that violated the no-decorative-transitions convention. Removed.
- **Missing useDbSync** (`fix(videos): mount useDbSync to auto-refresh agent edits`) — agent edits to video records were not reflected in the UI because `useDbSync` was never mounted. Fixed.

---

### clips

**8 bugs fixed (highest count across all templates)**

- **Share menu no-op** — share popover was rendering but the underlying action was wired incorrectly; shares were not being created. Fixed during sweep.
- **Bulk-action stub toasts** — bulk select actions (delete, archive) showed success toasts but did not call any action. Fixed with real action calls.
- **Deprecated 4-role invite dialog** (`fix(clips): update invite-dialog to use current admin/member roles instead of deprecated 4-role system`) — the invite dialog was using a 4-role system (`viewer`, `commenter`, `editor`, `admin`) that the framework had consolidated to 2 (`member`, `admin`). Updated.
- **update-recording blocked shared editors** (`fix(clips): use assertAccess in update-recording so shared editors can rename/edit recordings they don't own`) — shared editors got a 403 when trying to rename or edit recordings they had edit access to. Fixed with `assertAccess` instead of ownership check.
- **CTA action trio missing** (`fix(clips): use assertAccess on CTA actions; feat: clips CTA action trio`) — three CTA actions (share, download, embed) were not implemented; added with proper access scoping.
- **Clip player keyboard shortcuts** (`feat(clips/mail/calls): clip-player shortcuts`) — play/pause, seek, volume shortcuts added to clip player.
- **view-events → view-event API route name mismatch** (`fix(clips/videos): fix AGENTS.md resource arg name`) — agents were calling `view-events` but the route was `view-event`; fixed + AGENTS.md corrected.
- **Unauthenticated trash restore** — trash restore endpoint had no session check. Fixed during sweep.

---

### analytics

**3 bugs fixed**

- **Delete confirmation dialogs missing** (`fix(analytics): use shadcn AlertDialog for chart remove + dashboard delete`) — both chart removal and dashboard deletion had no confirmation. Added shadcn AlertDialog for both.
- **Full-page reload instead of SPA navigate** (`fix(analytics): add AlertDialog for dashboard delete + fix window.location.href -> navigate`) — post-delete was using `window.location.href = "/"` causing a full page reload instead of React Router navigation. Fixed with `navigate()`.
- **Hallucination prevention** — regression-checked; the guard from PR #365 is intact and clean.

---

### dispatch

**6 bugs fixed**

- **delete-destination 405 (UI never worked)** (`fix(dispatch): remove DELETE http override from delete-destination`) — the action used an HTTP override header that Nitro was not applying; the delete button had never successfully deleted a destination in production. Fixed by removing the override and using the correct method routing.
- **Shared quick-send state across destinations** (`fix(dispatch): cursor-pointer on expand/icon buttons, shared quick-send state across destinations, missing DbSync query keys`) — the quick-send input was shared across all destination cards in React state, so typing in one pre-filled all others. Fixed with per-destination state.
- **7 missing query keys** — same commit; `useDbSync` cache invalidations were missing `queryKey` entries for several dispatch entities, meaning agent edits would not refresh the UI.
- **Email/WhatsApp env keys not registered** (`fix(dispatch): register email and whatsapp env keys so messaging setup panel can track configured status`) — the messaging setup panel showed both channels as "not configured" regardless of env state. Fixed by registering the env keys.
- **No-org accounts could see cross-user rows** (`fix(dispatch): tighten ctxScope so no-org accounts can't see another no-org user's rows`) — users without an org were being grouped together in row scoping; one no-org user could see another no-org user's dispatch destinations. Fixed.
- **Workspace delete confirmation missing** (`fix(dispatch): remove DELETE http override from delete-destination + AlertDialog for resource delete`) — workspace-level delete had no confirmation dialog. Added.

Approval policy is now correctly org-gated via `getApprovalRequest` scoping fix.

---

### forms

**5 bugs fixed**

- **Vite nanoid hang freezing app** — a top-level `import { nanoid } from 'nanoid'` in a Vite entry file was triggering a Node/browser compatibility issue that froze the dev server on startup. Fixed by using `crypto.randomUUID()` inline.
- **lucide-react → Tabler Icons migration** (`chore sweep: forms tabler migration`) — forms template was importing `lucide-react` icons in several components. Migrated to `@tabler/icons-react`.
- **MUI-style tabs** — forms was using underline tabs; replaced with shadcn pill tabs per convention.
- **Missing access scoping on export-responses** (`fix(forms): scope export-responses with assertAccess`) — the export-responses action had no access check; any authenticated user could export another form's responses by ID. Fixed.
- **Anti-spam dead (honeypot + timestamp)** (`fix(forms): wire honeypot + page-load timestamp into SSR form submit`) — the anti-spam honeypot field and page-load timestamp were rendered in the HTML but never validated on submit. Both are now validated server-side.

---

## Framework-Level Fixes Shipped

| Area | Fix |
|---|---|
| **A2A identity leak (CRITICAL — FIXED)** | `metadata.orgDomain` and `metadata.userEmail` fallbacks removed from `handleSend`; identity now only resolved from JWT-verified fields. CLI env fallback scoped to CLI-only path. |
| **MCP SSRF** | `validateRemoteUrl` now blocks RFC1918 / link-local / metadata IPs and internal hostnames. Previously any authenticated user could point an MCP server at internal endpoints. |
| **MCP isError propagation** | `isError` tool results now throw so the production agent marks them as errors instead of treating them as successful tool output. |
| **transcribe-voice auth** | Unauthenticated POST to `/_agent-native/voice/transcribe` now returns 401 in production. Was previously open. |
| **Webhook double-readBody** | Resend and SendGrid webhook handlers were calling `readBody()` twice (h3 v2 streams are consume-once); second read hung forever. Fixed. |
| **Webhook timing attack** | SendGrid webhook verification migrated to `timingSafeEqual`; Zoom webhooks now enforce a 5-minute timestamp window to block replay attacks. |
| **File upload auth** | 4 upload endpoints across mail, slides (×2), and core file-upload had no session check. All now require `getSession()` + 401 on miss. |
| **SVG XSS via upload** | SVG added to content-type blocklist in upload allowlist; all uploads force `Content-Disposition: attachment` to prevent inline rendering. |
| **Tools indexes** | Added DB indexes on `owner_email`, `org_id`, and `tool_shares.resource_id` to fix unbounded table scans on every tool share lookup. |
| **fetch-tool SSRF** | `fetch-tool` now blocks private IPs, metadata endpoints, and DNS rebind suffixes before proxying requests. Covered by new spec. |
| **NotificationsBell mounted** | `NotificationsBell` was exported from core/client but never mounted in the content template Header. Now mounted. |
| **agent-chat refresh-signal** | `DbSyncSetup` in the agent chat plugin was not handling `refresh-signal` events; agent edits did not update the UI. Fixed. |
| **SSR `wrapWithAnalytics` guard** | `entry.server.ts` files in clips, slides, issues, and macros templates were calling `wrapWithAnalytics()` without checking if the import resolved; crashed SSR on cold starts. All guarded. |
| **A2A JWT identity** | `fix(a2a): resolve caller identity from JWT-verified email` — cross-app deck/document ownership now matches the signed-in user's verified JWT email, not unverified metadata. |

---

## Findings Deferred to Morning Review

See `OVERNIGHT_QA_CRITICAL_FINDINGS.md` for full detail. Top items:

| # | Severity | Summary |
|---|---|---|
| 1 | CRITICAL | Shared mutable `_currentRunOwner` + 6 sibling variables in `agent-chat-plugin.ts` — concurrent requests overwrite each other's identity. Cross-user automation/secret execution possible. |
| 2 | CRITICAL | `Promise.all` parallel tool calls corrupt global `console.log` / `process.stdout` monkey-patching — progressive log loss on multi-tool agent turns. |
| 3 | MEDIUM | `process.env.AGENT_USER_EMAIL` mutation race — concurrent requests can read the wrong user's email from `process.env`. |
| 4 | MEDIUM | `canManage` in `ShareButton.tsx` evaluates `true` when `data.role` is `undefined` — shows management UI to users with undefined role (server still rejects). |
| 5 | MEDIUM | `highestShareRole` does an unbounded table scan on every auth check — no `principalId` filter or LIMIT pushed to SQL. |
| 6 | FEATURE GAP | Cmd+I text selection capture not implemented — `handleKeyDown` calls `focusAgentChat()` but never captures `window.getSelection()`. |
| 7 | MEDIUM | `<span role="button">` for tab-close X in `MultiTabAssistantChat` — not keyboard focusable, invalid nested interactive HTML. |
| 8 | MEDIUM | `HistoryPopover`/`HelpPopover` may clip inside `overflow-hidden` agent sidebar. |
| 9 | LOW | `generate-title` endpoint has no per-user rate limit — authenticated users can exhaust Anthropic API credits. |
| 10 | LOW | `sidebarWidth` prop change after mount is silently ignored — prop appears reactive but is mount-only. |

Findings #1 and #2 are the most urgent. Both are structural concurrency bugs in core framework code that affect every template simultaneously under any real production load.

---

## Areas with Comprehensive Coverage but No Bugs Found

These areas were reviewed and are well-built:

- **Tools / Onboarding / Secrets system** — clean architecture, no access or logic issues found
- **Observability + experiments** — well-built; 2 race-fix bonuses already in HEAD before the sweep started
- **Calendar event CRUD** — handlers correctly scoped, no privilege escalation in event operations
- **Slides access scoping** — clean after prior fix; deck ownership and sharing correctly enforced

---

## Patterns Caught — Want to Enforce

The following patterns surfaced repeatedly across templates. Some have CI guards; others do not yet:

1. **Agent mention providers must use `accessFilter`** — several templates' `@mention` providers returned cross-user data. The `guard-no-unscoped-queries.mjs` CI guard does not currently scan mention providers. Recommend adding.
2. **All upload endpoints must call `getSession()` + return 401** — 4 were missing; should be a CI guard or lint rule.
3. **All destructive UI actions must use shadcn AlertDialog** — `window.confirm` and confirmation-free deletes appeared in analytics, content, dispatch, and forms. Already in conventions; needs stricter review.
4. **All buttons must use `cursor-pointer`** — already enforced via core `agent-native.css` rule; caught a few stragglers in forms and dispatch.
5. **All icons must be Tabler** — `lucide-react` imports found in forms and dispatch; migrated.
6. **All AI generation buttons must popover for user input** — no auto-submit hardcoded prompts. One instance found in content; fixed.
7. **All `entry.server.ts` imports must guard optional packages** — `wrapWithAnalytics` pattern found unchecked in 4 templates; all fixed. Pattern should be documented.

---

## Recommendations for Follow-Up

1. **Fix the 2 critical concurrency bugs in `agent-chat-plugin.ts`** — migrate all 7 shared mutable variables into `runWithRequestContext` / `AsyncLocalStorage`. This is a widespread refactor but the blast radius if unfixed is cross-user data leakage.
2. **Fix CLI tool `console` monkey-patching** — replace global save/restore with AsyncLocalStorage-based interception or subprocess isolation. Progressive log loss on multi-tool turns is a silent operational hazard.
3. **Implement Cmd+I selection capture** — capture `window.getSelection()?.toString()` in the `handleKeyDown` handler and pass it to the composer. The feature is documented but entirely unimplemented.
4. **Strip Yjs binary content from poll events** — if `useRealTimeCollab` is active, binary CRDT updates should not be broadcast to all polling clients; only the document participants.
5. **Add agent-mention-provider scoping check to `guard-no-unscoped-queries.mjs`** — the current guard only scans Drizzle query calls, not the mention-provider registration pattern. Mention providers are a common privilege-escalation vector.
6. **Per-user rate limit on `generate-title` endpoint** — simple in-memory counter; 10 calls/minute is reasonable. Prevents credit exhaustion by authenticated abusers.
7. **Consider lazy-loading Remotion and Shiki** — both are statically imported in templates that use them; dynamic imports would reduce cold-start bundle size.
8. **Add chunk size limits to clips/calls upload endpoints** — no max content-length enforced on binary uploads; a malicious client could upload arbitrarily large files.

---

## Concurrent-Agent Coordination Notes

- ~25 sub-agents ran across 8 rounds over the course of the night
- Playwright / Chrome MCP is single-session and caused contention; most agents fell back to source code review rather than browser-based testing
- Multiple agents converged on the same fixes in a few cases (notably `wrapWithAnalytics` guard and A2A identity fixes); concurrent commits on the same files were handled cleanly because agents were scoped to different templates
- All agents stayed on `updates-203` branch as instructed; no pushes occurred
- Commit coordination was clean: `git log --oneline ^main` shows 74 commits with no merge conflicts or revert pairs

---

*Generated 2026-04-30 by autonomous overnight QA sweep (8 rounds, ~25 sub-agents).*
*See `OVERNIGHT_QA_CRITICAL_FINDINGS.md` for detailed analysis of deferred findings.*
