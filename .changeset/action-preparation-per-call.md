---
"@agent-native/core": patch
---

Stop reporting a turn as finished when an action input was announced and never
started. The run-manager's terminal gate tracked action preparation as one
last-wins flag, so any later text or sibling tool call retired it and the run
ended as a plain `done` — while the browser, which keeps one card per call,
still showed the action unstarted and told the user "the agent stopped before
starting the <action> action. No tool result was returned, so the requested
changes were not made." Preparation is now read per tool call through one
shared tracker used by both the terminal gate and the continuation prompt, so
the turn continues instead of dead-ending. A preparation the continuation
abandons is also dropped from the transcript at the continuation boundary, so a
superseded spinner is no longer reported as a never-run action on the
eventual `done`.
