---
"@agent-native/core": minor
---

Let a hosted app pay for its own AI with Builder credits. `BUILDER_GATEWAY_TOKEN`
plus `BUILDER_GATEWAY_SPACE_ID` now select the Builder engine and back the
gateway lane (chat, web search, realtime voice, transcription, scheduled and
event automations), so an anonymous visitor can use AI on a deployed site
without connecting anything. An injected gateway token can never move a
customer's spend onto Builder credits: it steps aside for any other engine whose
credentials resolve. A Builder key pair the customer configured themselves is
unchanged and keeps winning, as does `AGENT_ENGINE_PREFER_BYO_KEY`. Where the
deployment pays, a rejected or missing credential reads as one line to the
visitor, with the real reason kept on the error code for the owner; that holds
for the gateway's own 402/403 on voice and realtime transcription, for the auto
provider chain rather than only an explicit Builder preference, for a gateway
whose transport dropped or whose stream stopped early, and at the point the chat
renders an error — where a message the deployment already chose for a visitor is
no longer re-expanded from its code back into owner instructions. Owner surfaces
keep the copy that says what to fix, the workspace/preview runtime included, even
though it carries the same injected token as the published site. No recovery
decision depends on what the error message says any more: the Builder engine
marks a retryable gateway rejection and an over-long prompt structurally, and
those verdicts reach the chat client too. So an overloaded provider retries the
same way whoever is paying — without turning a provider throttle into a chain of
background continuations against the limit that just rejected it — a truncated
stream is still continued from where it stopped instead of ending the turn, and a
conversation that outgrew the context window still gets its one automatic trim
and retry. A background or
scheduled run keeps the message the server chose for its failure rather than
restating it from the terminal reason, and an earlier transient error in the same
run can no longer stand in for the reason the run actually died. Pasted
`ANTHROPIC_API_KEY` values are now validated when saved.
