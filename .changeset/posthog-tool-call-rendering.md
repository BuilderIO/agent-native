---
"@agent-native/core": patch
---

Fix tool calls rendering without their output in PostHog LLM analytics.

Engine messages shipped verbatim as `$ai_input`, in a shape PostHog does not
read: `tool-call` / `tool-result` parts with camelCase ids, and tool results
carried inside a `user` message because `EngineMessage` has no `tool` role.
PostHog dumps raw JSON for shapes it does not recognize, so a tool call rendered
as an escaped blob with its result nowhere in sight. Messages now normalize to
the OpenAI/Anthropic conventions PostHog reads, and attachment bodies become a
marker naming the media type and size instead of inlining base64.

- `tool_calls[].id` now carries the id the model issued rather than our span id,
  so a call and its result actually pair. Span id remains the fallback for
  emitters that report no call id.
- The byte-ceiling rescue in `boundAiContent` keeps "the last user message",
  which in engine shape was the last tool result — so the user's question was
  dropped from every oversized generation. Normalizing first fixes it.
- A tool span with `captureToolResults` off now carries an explicit "withheld"
  marker in `$ai_output_state` instead of omitting it, matching what the error
  path already did. An absent output state reads as a tool that returned
  nothing, and the tool did answer.
