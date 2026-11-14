---
"@agent-native/core": minor
"@agent-native/toolkit": minor
---

Comments & Review Kit: the comment box keeps drafts and takes images. `useReviewCommentDraft()` keeps a box's unsent text, mentions and images in the browser per thread, reply or edit, so a reload doesn't lose them. Give `ReviewCommentComposer` `images` and `onImagesChange` and it uploads pasted, dropped or picked images, up to five, and sends a comment that's only an image; a paste with text in it still pastes as text. Give the box the draft's `target` as `imageTarget`, so an image still uploading when the box moves to another draft isn't added to it. `create-review-comment` and `reply-review-comment` take an empty body when the comment keeps an image, and refuse one with neither as `empty_comment`. `update-review-comment` takes `attachments` to change an author's images, checked as a new comment's are; sent without `expectedRevision`, an image edit is refused as `revision_conflict` if the comment changes before it saves.
