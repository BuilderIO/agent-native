---
"@agent-native/core": patch
---

Let an attached photo work as chat context with no file storage configured,
and stop reporting an unconfigured-storage condition as a size problem.

The inline attachment cap was a single 1,048,576-char budget derived from
OpenAI's `file_url` limit, but it was applied to image parts too. Images ride
`image_url` / `image.source.base64`, where the ceiling is 5 MB (Anthropic) to
20 MB (OpenAI), so any ordinary phone photo blew a limit that did not apply to
it, was dropped before reaching the model, and came back as "too large to send
inline for vision analysis". At the same time the pre-upload step told the
agent to open the storage setup card, so one attached photo produced two
unrelated and contradictory explanations, neither of which was true.

The image and file budgets are now separate and live in one module, the
model-visible placeholders quote the actual limit instead of leaving the model
to invent one, and a missing storage provider is reported as a missing durable
URL rather than an unreadable or oversized attachment. Attachments that are
readable inline this turn now say so explicitly, and the storage card is only
requested when an attachment genuinely could not be read.
