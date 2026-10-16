---
"@agent-native/core": patch
---

`provider-api-request` now treats a listed set of read-only POST endpoints as reads: GA4 Data API reports, Search Console search analytics and URL inspection, BigQuery dry runs, HubSpot CRM search and batch reads, Gong call and stats reads, Notion search and queries, PostHog queries, Jira search, Prometheus queries, Google Calendar free/busy, and Google Sheets data-filter reads. A failed report or search no longer stops the run with `write_tool_outcome_unknown`, so the agent can correct its arguments and try again. Any other POST is still a write.
