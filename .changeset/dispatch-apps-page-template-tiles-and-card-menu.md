---
"@agent-native/dispatch": minor
---

Add a three-dots menu to each workspace app card with **Hide from list** (per-viewer), **Restore to list**, and **Remove from list** (for pending Builder branches). Hidden apps are reachable from a "Show N hidden apps" expander at the bottom of the page. Also add an "Add a template" section to the Apps page that lists first-party templates not yet installed under `apps/` and scaffolds them via `agent-native add-app` on click. New actions: `archive-workspace-app`, `unarchive-workspace-app`, `remove-pending-workspace-app`, `list-available-workspace-templates`, `scaffold-workspace-app`.
