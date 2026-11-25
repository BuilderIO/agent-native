---
"@agent-native/core": minor
"@agent-native/toolkit": minor
---

A created file and an upload with the same name no longer become two files. Uploads used to store `/notes.md` while "Create file" stored `notes.md`, so the Resources panel listed two files named notes.md.

- Uploads, "Create file", and renames now store the name without a leading "/". An upload whose path is only slashes is refused with a 400.
- `notes.md` and `/notes.md` (with any number of leading slashes) count as one name when a name is claimed: creating a file only if the name is free, finding the next free name for an upload, renaming or moving a file, and restoring a deleted file. If any spelling of the name is already stored, the claim is refused or moves on to the next free name.
- `POST /_agent-native/resources` takes `uniquePath: true`. It always creates a new file, at the next free name if the name is taken, even when the file already there is empty. The Resources panel and the resource settings "Create file" now send it, so creating a file never replaces one. Without `uniquePath`, a create still replaces the file at that exact path. `useCreateResource` throws the server's message, `errorCode` and `details`.
- The MCP `resources` read tool accepts a path with a leading "/" and finds the file under either spelling, trying the one asked for first.

Known limits. Nothing changes files already stored as `/notes.md`. Ordinary reads, writes and deletes by path still match the stored path exactly, as before: `notes.md` doesn't reach a file stored as `/notes.md`. A name already stored in both spellings stays two files. When a shared file from before organizations is first saved in an organization that already has the other spelling of its name, the save is refused. Two creates of different spellings of one name, at the same moment, can still both succeed.
