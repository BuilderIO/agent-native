# Changelog

All notable user-facing changes to Agent-Native Content are documented here. Open it any
time from the command menu (Cmd+K → "What's new").

Older updates live in [the changelog folder](./changelog/) and are included in the in-app "What's new" view.

## 2026-08-14

### Fixed

- Images fill the page width by default and remain visible when more images are added
- Images inserted from the slash command stay saved after upload
- SVG files can be selected reliably from the image picker

## 2026-08-13

### Fixed

- Blocks field conflicts now keep the newer saved version visible instead of leaving a rejected edit on screen

## 2026-08-12

### Improved

- Toggle blocks now follow Notion-style Enter and Shift-Tab behavior while preserving summaries and nested paragraphs.
- Shared Content documents now keep viewers read-only and let commenters add comments without editing the document.

### Fixed

- Image uploads now confirm the image can be displayed before reporting success

## 2026-08-11

### Improved

- Content opens your last page on return and gives new users a private welcome page.

### Fixed

- Chrome no longer offers to install Content as a desktop app.
- Content mutations delegated from verified Slack DMs now use the member's exact Personal scope and return verified row receipts.

## 2026-08-10

### Added

- Agents can safely insert, update, upsert, delete, and reorder one stable block in a database Blocks field.

### Improved

- Database Blocks fields now keep logical block identity through editing, reordering, deletion recovery, and reloads
- Database row actions now validate exact schemas and safe retries before changing data.
