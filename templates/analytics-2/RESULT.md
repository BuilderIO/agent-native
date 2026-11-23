# QA repro batch: analytics-2 (qa-fleet@builder.io)

Run 2026-11-19 ~18:45-19:00 UTC against https://labs.agent-native.com/analytics-2.
Sign-in via runner-session returned 200 on the first try (no 404 wait needed).
Served build SHA (response header `x-agent-native-build-sha`): `25d8e62e5bdb02e3d512b698b07d37d06aed56e9`.
Screenshots were saved locally under `.tmp/qa/` (gitignored). They could not be re-read in this container, so the evidence below comes from page text, menu contents and network responses.

| id | verdict | evidence | served build sha |
|---|---|---|---|
| 1795110018875309 | needs-info | Notebook view shows Run all / Run mode (Auto, Cell+upstream, Cell only, Cell+downstream) / Variables / Environment / Files / Find / Data browser / TOC / History; cell menus include Query, Python, Text, Inputs, More. The 2 Hex screenshots are unavailable, so no option-by-option diff is possible. Question: which specific Hex notebook options (names) are missing? | 25d8e62e5bdb |
| 1795109526791369 | needs-info (lean no-repro) | Headless submit of an agent prompt on published project prj_2279bde2... did not fire a run request (no agent POST, no reply after 90s, tried Enter and "Send message"), so the agent path was not exercised. Code: `get-project` now tells agents to omit `surface/version/viewId` (commit 80afa1b77b, ancestor of the served build). `list-connection-datasets` error not reproduced. Question: exact prompt, project id and the tool-call error text for list-connection-datasets? | 25d8e62e5bdb |
| 1795106797160639 | repro (partial) | App builder tab lists only "APP TYPE: Classic app" (no Generative option). "Broken data screen" not seen on published QA Keyscreen 1118. On empty project prj_5934d7e7... the App builder tab/View app renders the notebook empty state (/latest/app), no app builder UI. | 25d8e62e5bdb |
| 1795106554678149 | repro | No "Scheduled run and notifications" anywhere: project toolbar, Project options (Rename, Duplicate, Export as, Set status, Add categories, Transfer owner, Move to trash), Run mode menu, Share dialog. Page text has no "schedule"/"notification". | 25d8e62e5bdb |
| 1795105345434779 | split: part 1 no-repro, part 2 repro | Part 1: clicking published project "QA Keyscreen 1118" in Projects list opens `/app/prj_2279.../ver_.../<viewId>` (app view). Part 2: toolbar next to Share only has View app / Share / Publish changes; no Presentation mode or similar options. | 25d8e62e5bdb |
| 1795033090 | needs-info | QA account has no dbt credentials, and Data sources only shows the "bigquery builder" connection, so a dbt setup could not be run. Question: dbt Cloud or dbt Core, which step fails, exact error text? | 25d8e62e5bdb |
| 1795030602 | repro | Settings > Organization has Name / Workspace URL / Membership / Asset status only. Asset statuses and Asset categories are separate pages. No "Customize categories and statuses, and set auto-archive criteria" section and no Auto-archive controls (auto-archive is only mentioned in a copy string in `project-lists.ts`). | 25d8e62e5bdb |

## Fix / PR
No fix is small and clear (Auto-archive settings, Generative app type, schedule/notifications and presentation options are features). No PR opened.

## Cleanup
No QA-wave1 data was created: the agent prompt never submitted. I opened the Share dialog on QA Keyscreen 1118 and closed it without sharing anything. Cleanup: nothing to delete (verified).
