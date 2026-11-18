---
"@agent-native/core": minor
"@agent-native/toolkit": minor
---

Saving a resource no longer silently overwrites someone else's newer save. Resource reads and writes now carry a `revision`; a `PUT /_agent-native/resources/:id` that sends it back as `expectedRevision` with new `content` is refused with a typed `save_conflict` carrying what's there now when someone saved other content after that read, and `useUpdateResource` accepts `expectedRevision`. A `PUT` without it still writes over whatever is there. Toolkit's `ResourceEditor` takes a new `saveContent` prop that saves this way, asks which version to keep on a conflict and offers the other back, and the Resources panel uses it.
