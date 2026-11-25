---
"@agent-native/core": minor
"@agent-native/toolkit": minor
---

Resource paths have one stored form, with no leading "/". Uploads used to store `/notes.md` while "Create file" stored `notes.md`, so the two never collided and the Resources panel listed two files with the same name. Now uploads store `notes.md`, every resource write stores the path without a leading "/", and every lookup by path (reads, writes, deletes, renames, the free-name search and the MCP resource lookup) also finds a row stored before this change under `/notes.md`. A write by path updates that older row in place instead of adding a second one, and the MCP lookup accepts a path with a leading "/". Where a name is already stored in both forms, both rows are kept: each spelling reaches its own row, and a path without the "/" reaches the one stored without it. `POST /_agent-native/resources` takes `uniquePath: true` to store a new file under the next free name when its name is taken, as an upload does, and the Resources panel and the resource settings "Create file" now send it instead of replacing the file there. `useCreateResource` throws the server's message, `errorCode` and `details`.
