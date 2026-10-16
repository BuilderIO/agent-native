# Slack Reaction Replies

Reply under the parent only when the reporter must act or their outcome changes:
a question they must answer, a verified fix, a beta or package availability
change, or a handoff they must act on. Otherwise post nothing; the reaction and
recap carry the status. Never post "taking a look," reaction explanations, or
ledger status. The one-time dispositions named in SKILL.md (**Skipped**,
**Clustered**, **Abandoned - no answer in 4 days**, **In progress**) are the
exception and still post once. Keep each reply to one or two sentences.

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
or owner is assigned, record the handoff in the recap only. Do not create or
promise a ticket without authorization. Never imply a partial fix resolved the
whole report.

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

Read back the reaction. If you posted a reply, read it back as the invoking
identity before recording the item as replied.
