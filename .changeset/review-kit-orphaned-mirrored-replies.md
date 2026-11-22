---
"@agent-native/core": patch
---

Comments & Review Kit: `deleteOrphanedMirroredReplies(resource, ids)` deletes the comments among `ids` whose thread's first comment the kit has deleted or never held, and returns their IDs. An app's startup copy passes the comments only the kit holds, so a reply written through the kit's own actions in a thread the app deleted only in its own table goes, as it would have had the delete gone through the kit. Plan and Clips copy their comments into the kit once more, in a release after every server writes both stores, and delete such replies as they copy.
