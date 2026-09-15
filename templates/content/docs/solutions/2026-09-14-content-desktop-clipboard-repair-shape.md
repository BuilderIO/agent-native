---
title: "Content desktop clipboard repair shape"
date: 2026-09-14
status: shape-complete
---

# Content desktop clipboard repair

## Outcome

Content copy controls use the existing host-aware clipboard boundary so **Copy page link** works from an ordinary Page and a database Board in Agent-Native Desktop while retaining the current web behavior. Clipboard failure remains explicit and never produces a success toast or analytics event.

This is a contract repair for `content.feature.durable-foundations` and `content.object.page`. It preserves the existing Page URL and sharing contracts; no product-record update or feature flag is needed.

## Evidence and decision

The reported Desktop failure is `navigator.clipboard.writeText(): Write permission denied`. The current `DocumentToolbar` calls that browser API directly, while Agent-Native Desktop already exposes `agentNativeDesktop.clipboard.writeText` and `writeClipboardText` already chooses the Desktop bridge before browser and DOM fallbacks. A current local web build successfully copied and pasted the canonical `/p/<document-id>` URL from an ordinary Page and a disposable database Board.

Use `@agent-native/core/client/clipboard` from Content. Do not change the shared helper or Desktop preload/IPC bridge for this repair.

## Implementation scope

1. In `DocumentToolbar.tsx`, replace all three direct text writes—Page link, local relative path, and local absolute path—with `writeClipboardText`. Remove the `navigator.clipboard` availability branch. Show success and emit `share_link_copied` only after a `true` result; use the existing failure copy when it returns `false`.
2. Apply the same text boundary to the other Content callers found by the fingerprint sweep:
   - `NotionButton.tsx`: redirect URI copy; do not report success on `false`.
   - `AudioBlock.tsx` and `VideoBlock.tsx`: source URL copy.
   - `ImageBlock.tsx`: retain the browser-only rich image attempt, but route its existing source-URL fallback through `writeClipboardText` and preserve the existing `urlCopied` versus failure feedback.
3. Update the layout assertion that currently requires `navigator.clipboard.writeText(copyPageUrl)`. Add focused behavior coverage for Page-link success and failure, including the expected canonical URL, truthful toast/analytics behavior, and a Content clipboard-boundary assertion preventing new direct text writes in these callers.
4. Format the touched source and run the focused checks below. No user-facing copy changes are planned; if implementation introduces any, update every configured locale and run the i18n guards.

The repository-wide sweep found direct clipboard calls in 63 files. Calls outside `templates/content/app` are enumerated evidence of a broader app-by-app audit, not authority to edit unrelated apps in this repair. Rich binary image clipboard support in Desktop is also out of scope because it requires a new binary bridge contract; the existing URL fallback must work.

## Frozen acceptance story

- **CLIP-01 — Desktop Page link:** From an ordinary Content Page in Agent-Native Desktop, activating **More page actions → Copy page link** copies the canonical `/p/<document-id>` URL, shows **Copied page link**, and does not show a permission error.
- **CLIP-02 — Desktop Board link:** The same interaction on a database Page while a Board view is active copies that database Page's canonical URL; the selected view neither changes the Page identity nor leaks personal View state.
- **CLIP-03 — Web regression:** CLIP-01 and CLIP-02 continue to work in a real web browser and paste the exact expected URL.
- **CLIP-04 — Truthful failure:** When every clipboard route is unavailable, the control shows the existing failure state, emits no success toast, and records no `share_link_copied` event.
- **CLIP-05 — Adjacent Content copies:** Local relative/absolute paths, the Notion redirect URI, audio/video URLs, and the image URL fallback use the host-aware text boundary and never report false success.
- **CLIP-06 — Keyboard and focus:** A keyboard user can open the Page actions menu, activate **Copy page link**, perceive the result, and continue without lost or trapped focus.
- **CLIP-07 — No contract drift:** The repair changes neither URL construction, Page access, sharing visibility, database/View state, nor clipboard contents beyond the selected value.

Human-QA independence is preferred with same-context custody; a separate tester is not required.

## Proof plan

Automated checks:

```text
corepack pnpm --filter @agent-native/core exec vitest --run src/client/clipboard.spec.ts
corepack pnpm --filter content exec vitest --run <focused toolbar and clipboard-boundary tests>
corepack pnpm --filter content exec vitest --run app/components/editor/DocumentEditor.layout.test.ts -t "copies the open page route for local-file documents"
corepack pnpm --filter content typecheck
pnpm test:content-product-impact
pnpm guard:i18n-catalogs
pnpm guard:i18n-changed-copy
```

Real-interface final pass:

1. On the final build, use a disposable ordinary Page and database Board in web and Agent-Native Desktop.
2. Exercise CLIP-01 through CLIP-03 by pointer and CLIP-06 by keyboard; paste into a safe disposable field to verify the exact value rather than trusting the toast.
3. Inject or configure a denied clipboard path for CLIP-04, then replay the success path after recovery.
4. Exercise the available changed sibling controls from CLIP-05; use focused component coverage for provider/media setup states that cannot be reached without unrelated configuration.
5. Reload the Page and Board and repeat one copy on each host, inspect console/network for relevant failures, capture one representative final screenshot, and remove every task-owned fixture and observer.

## Pull-request impact

```yaml
content_product_impact:
  lane: contract_repair
  features:
    - content.feature.durable-foundations
  capabilities:
    - content.object.page
  record_change: none
  proof:
    - Content clipboard unit and boundary tests
    - Web and Agent-Native Desktop human QA for Page and Board copy links
  rationale: The change routes existing Content copy controls through the established host-aware clipboard boundary without changing the Page URL contract.
```
