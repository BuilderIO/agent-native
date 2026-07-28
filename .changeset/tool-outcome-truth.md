---
"@agent-native/core": patch
---

Stop the chat from claiming a tool is running when nothing is running, and stop
recording interrupted actions as failures. A tool card only spins while a chat is
actually running — an activity placeholder alone no longer resurrects a spinner
on rehydrated history, which is how an email that WAS delivered showed as
perpetually "sending". When a stream ends with a tool still in flight the card is
now marked with a distinct unknown outcome ("it may or may not have completed")
instead of a red failure, both live and in the persisted transcript, because
"absent" and "unreadable" are not the same answer. The alternate runtime path now
settles its pending tool calls on `done` and on error like the main SSE path does,
and a turn whose tool never resolved keeps its "Worked for Xm Ys" summary instead
of rendering a permanent "Thinking" indicator with nothing behind it.
