---
"@agent-native/core": patch
---

Agent chat now bails out of a degenerate repetition loop quickly instead of
burning the entire auto-continuation budget. When the model gets stuck
re-streaming the same narration every continuation without ever finishing a
tool (the classic "paste a large HTML file and ask to host it as an extension"
failure), it previously counted each repeat as progress and ran all 32 transient
continuations — re-sending the large pasted payload each round — before surfacing
a generic `connection_error`. A new repetition guard detects the non-advancing
loop and stops after a few rounds with a clear, actionable message, and the
`create-extension` large-payload nudge now also fires on mid-stream cutoffs
(`stream_ended`), not just run timeouts.
