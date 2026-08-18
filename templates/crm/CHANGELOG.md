# CRM changelog

## 2026-07-26

### Added

- CRM connects to HubSpot for scoped account intelligence, saved views, follow-up tasks, evidence, and approval-gated write proposals.
- CRM can prepare a record-scoped, default-off Clips review recipe while keeping media and transcripts in Clips.
- CRM can now find and review evidence-grounded call signals without storing transcripts or media.
- Approved sales automations can now update routine local CRM fields while provider changes remain reviewable proposals.
- CRM can now run as a standalone Native SQL system for accounts, people, opportunities, views, tasks, and cadence without an external provider.
- Pipeline now gives each CRM user a live, permission-aware view of opportunity value by stage.
- CRM can now connect to Salesforce alongside HubSpot for scoped account intelligence and follow-up work.

### Improved

- CRM can now manage keyword and smart call-signal trackers from Intelligence settings.

### Fixed

- Pipeline dashboards now install correctly from the CRM action CLI.
- CRM field validation now explains which fields cannot be edited instead of showing a generic error.
- Fixed HubSpot contact syncs missing records updated after the sync cursor.
- Fixed Pipeline dashboard panels so their opportunity data loads reliably.
- Full-page chat keeps the active conversation when moving to and from the sidebar.
