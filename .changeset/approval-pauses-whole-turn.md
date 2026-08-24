---
"@agent-native/core": patch
---

Stop later tool calls in the same assistant message from running while an action
waits for human approval.

The approval gate told the model "the turn is paused" and set
`requestedActionStop`, but that flag is only read after the tool loop finishes.
The flag that actually suppresses the remaining calls is `turnYieldedToUser`,
which the approval path never set — so on `[write(needs approval),
delete(no approval)]` in one message, the human saw an approval card for the
first while the second had already executed. The approval branch now yields the
turn like any other action that hands control to the user, and the message shown
for a suppressed call names the approval case as well as the ends-turn case.

A gated call is also no longer eligible for parallel batching. `flushParallelBatch`
dispatches a batch through `Promise.all`, so a gated call and its siblings all
start before the gate is reached and the suppression lands too late to stop a
sibling that already ran. Any action declaring `needsApproval` or `endsTurn` is
now serialized, which is what makes the suppression meaningful for the calls
after it.
