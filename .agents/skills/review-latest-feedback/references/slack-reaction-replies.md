# Slack Reaction Replies

For every Slack item this run marks with a workflow reaction, send one concise
reply under the same parent before ending. A same-run fix gets one final reply
after verification; continuing work gets a concrete progress reply. An earlier
generic “taking a look” does not satisfy this update.

Compare each reported symptom with the evidence. State what is fixed and what
is not. Use `✅` only for verified fixed scope and `🎫` for each distinct
unfinished scope that needs human follow-through. Name the exact next action
and owner or responsible role, and link a ticket when available. Never imply a
partial fix resolved the whole report.

For beta app fixes, check the matching merge-triggered publisher. While it is
queued or running, say what changed and that it should be on beta in about 24
hours. If it succeeds, report beta publication as complete; that does not
prove independent runtime behavior. If the run is missing or fails, omit the
ETA and state the next action and owner. Keep verification and rollout details
in the recap. For packages, state availability without verification details.

Read back the reaction and reply as the invoking identity before recording the
item as replied.
