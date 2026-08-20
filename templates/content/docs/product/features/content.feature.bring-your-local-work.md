---
record_type: "feature"
id: "content.feature.bring-your-local-work"
number: 12
name: "Bring your local work"
chapter: "content.chapter.connected-sources"
order: 12
roadmap_status: "partially_implemented"
summary: "Open a folder or repository through the same Source model while keeping device authority and browser limitations honest."
example_workflow: "A developer opens a local documentation folder in Content Desktop, edits the files through Content, sees external file changes synchronize back, and later reads the last synchronized representation from Safari without exposing the folder path."
works_today: "Local File Mode, connected-folder Sources, source-backed Pages, Desktop folder grants, watched reconciliation, revision-guarded writes, and named local working-copy identity establish the first end-to-end local Markdown path behind its release flag."
remains: "The packaged Desktop story still needs independent H1-H10 acceptance before release; broader file families, queued remote writes, and provider-bound GitHub review remain later increments."
required_capabilities:
  [
    "content.source.local-bridge",
    "content.source.file-folder",
    "content.portability.source-representation",
    "content.portability.vault-export",
  ]
enhancing_capabilities:
  ["content.source.adapters", "content.source.sync-policy"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-08-17"
---

# Feature 12: Bring your local work

Open a folder or repository through the same Source model while keeping device authority and browser limitations honest.

## Product contract

- **Local Source Bridge:** Grants access to explicitly selected folders without storing raw paths or file handles in shared SQL.
- **Folders and repositories:** Materialize local files as ordinary Content records while preserving their source identity and structure.
- **Background synchronization:** Lets Desktop or a lightweight helper keep shared representations fresh for browser clients.
- **Browser degradation:** Shows the last authorized Content representation when Safari, Firefox, or another client cannot access local bytes.
- **Queued edits:** Holds permitted source-owned changes with their base revision until an authorized bridge returns.
- **Portable vault:** Keeps the human-readable folder separate from disposable caches and any particular desktop application bundle.
