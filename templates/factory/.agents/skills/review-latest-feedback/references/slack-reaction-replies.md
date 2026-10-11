# Slack Reaction Replies

For every Slack item this run independently marks with a workflow reaction,
send one concise reply under the same parent with its disposition. A same-run
fix gets its final reply after verification; continuing work gets a concrete
progress reply. An earlier generic “taking a look” does not satisfy this
update.

Preserve cluster handling: identify known duplicates before claiming them;
represent duplicate non-owner threads by permalink and **Clustered** in one
owner-thread status. Do not react or reply in a non-owner thread unless a
distinct question or update needs its own disposition; if it does, react and
reply there as a separate item. If a duplicate is discovered only after this
run added `👀`, keep it and post a concise **Clustered** reply with the owner
permalink; never remove the reaction.

Compare each reported symptom with the evidence. State what is fixed and what
is not. Use `✅` only for verified fixed scope. Use `🎫` for each distinct
unfinished scope that needs a human to take ownership or act, whether or not a
ticket exists. Link a verified ticket and name its owner/action; if no ticket
or owner is assigned, state the exact handoff and that gap in the reply and
ledger. Do not create or promise a ticket without authorization. Never imply a
partial fix resolved the whole report.

For beta app fixes, check the matching merge-triggered publisher, but keep its
details in the recap. In the reply, link the merged PR and say it merged, then
give the beta status in plain language. Say the behavior is live on beta only
after checking it there. While publication is queued or running, say the update
should arrive within about 24 hours. If publication finished but the app or
behavior is unavailable to check, say the beta update is out and briefly name
what could not be checked. If the publisher is missing or failed, give no ETA
and state the next action and owner. Leave commit hashes, branch names, CI
results, workflow or publisher details, and run IDs out of reporter replies.
For packages, link the merged PR and state availability without verification
details.

Read back the reaction and reply as the invoking identity before recording the
item as replied.
