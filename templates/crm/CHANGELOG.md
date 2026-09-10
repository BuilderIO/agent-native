# CRM changelog

## 2026-08-11

### Improved

- Full-page chat composers stay at a focused 750px width.

### Fixed

- Chrome no longer offers to install CRM as a desktop app.

## 2026-08-10

### Improved

- Full-page chat now uses the available width up to 1000px for more comfortable prompts and responses.

## 2026-08-07

### Improved

- CRM settings show stable skeleton placeholders while lists, fields, connections, and intelligence trackers load.

## 2026-08-06

### Improved

- CRM starts faster after a deploy or idle period — one-time data backfills now run once as tracked migrations instead of on every cold start.

## 2026-07-29

### Improved

- Sidebar footers now keep Feedback, Search, and Collapse together, with language preferences available in Settings.

## 2026-07-26

### Added

- Any list or view can be shown as a board grouped by stage, so a pipeline can be dragged through its stages instead of edited row by row.
- CRM now finds likely duplicate records and tells you exactly why each pair matched, then merges them into the record you choose without losing anything from either side.
- Enrichment now shows what a run will cost before it starts, gathers free evidence first, and only spends on the records you approved.
- Lists turn any set of records into a pipeline with its own stage and fields, and they stay yours even when the records come from HubSpot or Salesforce.
- Opening a record now shows one page with its fields, the lists it belongs to, its activity and evidence, and the full change history of any single value.
- Press Cmd+K to jump to any record, list, view or setting, and use keyboard shortcuts to move through the grid without reaching for the mouse.
- Record reference fields like Account can now be linked from the record page: search records in a popover and see the link as a chip you can remove.
- Records now use typed fields — currency, dates, ratings, status, select, references and more — and every field remembers who changed it, when, and what it was before.
- Settings now has Fields and Lists tabs for adding fields, editing their allowed options and stage targets, and archiving what you no longer use.
- The record grid is now a real spreadsheet: filter, sort and page over the full data set, edit in place, and copy or paste ranges straight to a spreadsheet.

### Improved

- Provider record edits now show an exact before/after diff and open the record in HubSpot or Salesforce to finish the change, instead of reporting a failure
- Record page attribute labels now read in full instead of being cut off, and the Highlights panel starts from a curated set per record type.

### Fixed

- A half-typed number or date no longer saves as empty — the field says it cannot read the value and keeps what the record already had.
- A new pipeline board now opens with stage columns, a summable amount, and each card's values copied from the record it was added from
- Moving a record or list entry into a stage that was retired or never declared is now refused with the reason and the stages you can pick, and a stage somebody else moved in the meantime is reported instead of being overwritten
- Retyping a record field now replaces the old value instead of appending to it, wherever the field is edited.
- Retyping a value on the record page now replaces it instead of merging with the old text.
- The proposal review now shows the field that actually changed instead of reading "Empty" on both sides.

For the full list of updates, see the [changelog folder](./changelog/).
