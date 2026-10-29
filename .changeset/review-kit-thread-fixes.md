---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Reply emails from the Comments & Review Kit now reach everyone in the thread on busy resources. The kit used to look for a thread's people among the resource's first 200 comments, so on a design or page with more comments than that, people in newer threads got no email; it now looks them up by thread with `listReviewThreadParticipantEmails`. Deleting a review comment now clears its text, mentions and image attachments, as apps that remove the row do; the row stays so replies keep their thread. The comment box's mention parser reads the characters beside each `@` without copying the line, so loading a long line with many `@` signs into the box takes linear time.
