# Slack Reaction Replies

For every Slack item this run independently marks with a workflow reaction,
send one concise reply under the same parent with its disposition. A same-run
fix gets its final reply after verification; continuing work gets a concrete
progress reply. An earlier generic “taking a look” does not satisfy this
update.

Preserve cluster handling: represent duplicate non-owner threads by permalink
and **Clustered** in one owner-thread status. Do not react or reply in a
non-owner thread unless a distinct question or update needs its own
disposition; if it does, react and reply there as a separate item.

Compare each reported symptom with the evidence. State what is fixed and what
is not. Use `✅` only for verified fixed scope. Use `🎫` for a distinct
unfinished scope needing human follow-through only when an existing ticket
names the owner and exact action; link it in both the ledger and reply. If no
such ticket exists, keep the item `👀`-only and open; state the fixed and
pending scopes, exact untracked handoff, and missing ticket in the reply and
ledger. Never imply a partial fix resolved the whole report.

For beta app fixes, check the matching merge-triggered publisher. While it is
queued or running, say what changed and that it should be on beta in about 24
hours. If it succeeds, report beta publication as complete; that does not
prove independent runtime behavior. If the run is missing or fails, omit the
ETA and state the next action and owner. Keep verification and rollout details
in the recap. For packages, state availability without verification details.

Read back the reaction and reply as the invoking identity before recording the
item as replied.
