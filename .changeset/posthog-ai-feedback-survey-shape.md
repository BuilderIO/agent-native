---
"@agent-native/core": patch
---

Send PostHog AI feedback in the shape its LLM analytics feedback view actually reads. A thumbs vote now answers the survey's first question with PostHog's choice index (`1` up, `2` down) instead of the string `"thumbs_up"`, and the free text after a thumbs-down answers the follow-up question (`$survey_response_1`) rather than overwriting the rating. A vote and the text it opens share one submission id per rated message, so PostHog joins them into a single response, and the vote stays marked incomplete until the follow-up arrives. `POSTHOG_AI_FEEDBACK_SURVEY_ID` is the whole configuration; `POSTHOG_AI_FEEDBACK_SURVEY_QUESTION_ID` is no longer read.
