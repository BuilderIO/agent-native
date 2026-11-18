---
"@agent-native/core": minor
---

Resource uploads and workspace file appends no longer write over another save. `POST /_agent-native/resources/upload` used to replace whatever was at the path; now an upload onto a taken name is stored under the next free one (`notes.md` becomes `notes-2.md`), and the response is the resource it made, with its `revision` for text files. Resending a text file that's already there unchanged counts as done (200, that resource). In an organization, a shared file from before organizations at the path counts as taken. When no name comes free the upload is refused with `name_taken` and a suggested name. The workspace files `append` adds its text onto the version it read and writes only if nothing changed since, reading again when another save landed first, so two appends at once both land; after five tries it fails with nothing appended.
