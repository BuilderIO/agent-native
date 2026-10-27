---
"@agent-native/core": patch
"@agent-native/agentkit": patch
"@agent-native/toolkit": patch
---

Send now adds a queued message to the running turn instead of stopping it:

- The run reads the message at its next tool boundary. It goes into the next model request as user text after the tool results it waited for, and the transcript shows it between the reply before it and the reply after it. The run emits a new `user_message` event, the reply is split there on both the server fold and the live stream, and saved threads without the event render as before.
- Delivery happens exactly once. The queue mutation `steer` flags the message and moves it to the head of the inbox. The run then takes it off the queue and marks its inbox receipt submitted to that run in one transaction, so the inbox never also starts it as a new turn.
- Cmd+Enter (Ctrl+Enter elsewhere) and Cmd-click on Send during a run do the same: the draft is queued and sent into the running turn. `SendMessageInput.deliverInActiveRun` carries that intent, and the queued payload no longer asks the server to stop the run.
- A message that misses the run's last tool boundary goes first as the next turn. The queue row shows "Sending…" while it waits and "Sends after this reply" once the reply is past its last step.
- Stop and send, a new item in the row menu, stops the current response at a safe boundary and then sends the message. For a message the server inbox owns, the inbox starts it, and the client waits up to 15 seconds for its receipt. If the run refuses to stop, or the receipt is still waiting at the deadline, the message stays queued to send after the reply.
- Queue errors (`queue_item_busy`, `queue_item_blocked`, `queue_order_stale`, `run_slot_busy`) show localized copy instead of inbox text and message ids. The typed codes stay on the error for logic and logs.
- New protocol fields: `SteerQueuedMessageInput.deliverInActiveRun`, the `{ delivery }` steer result, and `AgentQueuedMessage.delivery`.
- The work a run did before a delivered message shows as its own finished "Worked for" row above that message, and the reply after it counts only the work after it. A reply segment with nothing to show, such as one that only called tools, renders nothing of its own instead of an empty message with a toolbar. Saved threads keep the delivered message's place in the run's events, so a reload splits the work the same way. A run resumed after a crash replays each delivered message with its attachments, the same way it first read them.
