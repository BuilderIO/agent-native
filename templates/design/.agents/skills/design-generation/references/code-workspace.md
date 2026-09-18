# Code Workspace — VS Code-Style Workbench

The editor's left rail has a wide `code` panel: a VS Code-style workbench
(`app/components/design/code-workbench/`) with an explorer, workspace search,
editor tabs, quick open (⌘P), a command palette (⇧⌘P), and a status bar. Open
it with `navigate --view editor --designId <id> --leftPanel code` and
optionally pass `fileId`, `filename`, or `screen` to focus a file.

## Explorer roots

The explorer shows one root per workspace source:

- The design's SQL-backed files (`designfs://<designId>/`, backend
  `virtual-inline`) — always present.
- One root per localhost connection referenced by the design's screens.
  `list-local-files` / `read-local-file` proxy the `design connect` bridge;
  writes go through `write-local-file` and its user-approved consent grant —
  see the `visual-edit` skill for the full bridge/consent flow.

## Formatting

Inline design files are auto-formatted with Prettier the first time they are
opened in the workbench, and the formatted result is persisted. Local files
(the localhost root) are never auto-formatted.

## Inline source actions

- `list-source-files` inspects the inline source workspace; `read-source-file`
  returns file contents. Preserve the returned `versionHash` before writing.
- Do not return full file content from `view-screen`; it reports only active
  code file metadata and dirty state.
- `preview-source-edit` shows a diff without saving. `apply-source-edit` with
  the prior `versionHash` saves either a full replace or an exact replace.
  These update the same inline file state the UI uses — agent edits show up
  live in open workbench buffers.
- `resolve-selection-source` finds the best matching inline file
  location/snippet for the user's current canvas selection.

## Session state

The workbench session (open tabs, active file, sidebar layout) persists per
design in application state under `code-workbench:<designId>`.
