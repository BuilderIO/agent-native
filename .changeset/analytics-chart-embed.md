---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Add the shared pieces for keeping a copy of another app's resource in a page: the Analytics panel capture contract and link parser, the embed audience check, and the `SourceEmbedFrame` that frames such a copy. A capture carries the columns a panel's chart draws, its data source and time range, and the chart settings and key dates its dashboard draws them with, so the other app draws it with toolkit's `DashboardPanelChart`. `DashboardPanelChart` takes `asOf`, so a copy dashes the day its rows were read as unfinished, and fills a pivot's time range up to that day, instead of today. Share controls take a `confirmVisibility` check so a resource can ask before going public, with detail for the visibility it would save.
