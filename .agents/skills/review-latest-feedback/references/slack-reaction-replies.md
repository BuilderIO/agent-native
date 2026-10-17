# Slack Reaction Replies

Use the connected Slack integration for every Slack read and write. Never
operate Slack through computer use, a browser, screenshots, or UI automation.

Reply under the parent only when the reporter must act or their outcome changes:
a question they must answer, a verified fix, a beta or package availability
change, or a handoff they must act on. Otherwise post nothing; the reaction and
recap carry the status. Never post "taking a look," reaction explanations, or
ledger status. The one-time dispositions named in SKILL.md (**Skipped**,
**Clustered**, **Abandoned - no answer in 4 days**, **In progress**) are the
exception and still post once, for eligible items only. Person-assigned threads
and Steve's `:mag:` items get no reply of any kind. Keep each reply to one or
two sentences.

For each eligible item, add `👀` before investigation. Keep all reactions
permanently: never remove or clean up `👀`, `✅`, `🎫`, or any other
reaction on a feedback item. Add `✅` when the accepted scope is complete and
verified: defects meet **Fixed**, and upvoted improvements meet **Shipped**
after delivery is verified. Add `🎫` only to distinct unfinished scope
needing a follow-up action or owner, whether or not a ticket exists. Do not use
it for routine beta or package publication, expected verification, or optional
scope without an assigned action or owner.

Before posting, inspect the full thread for an earlier disposition reply. Send one concise disposition reply per feedback item: what changed, meaningful scope remaining, and any action the reporter must take. Record owner and ticket handoffs in the recap only. Never imply a partial fix resolved the whole report. An earlier generic “looking into this” is not a disposition; follow it with this one reply. Once a disposition exists, do not post again just to announce merge, publication, or live beta. Answer a reporter's direct follow-up.

For an open beta app PR, link it and say beta should follow soon after merge;
give no exact date. Keep the item **In progress** until the source fix merges.
If the first disposition is after merge, verify the matching publisher. If
publication is pending, say it should follow soon; if the publisher is missing
or failed, give no ETA and name the next action/owner. Never claim it is live
without verification.

Resolve duplicates before claiming. For known non-owner duplicates, list the
permalink and **Clustered** once in the owner reply; do not react or reply
separately. For a late duplicate that already has `👀`, recheck the ownership
gate. Only if this task still owns it, keep the eye and post one concise
**Clustered** reply there with the owner permalink. This is its terminal
disposition, even if the owner reply was sent; do not send a second owner
update. If another task owns the eye or ownership is unclear, preserve it,
record the source in the ledger, and stop.

For package work, check whether the open PR is the source PR or the release PR.
If source merge creates a separate release PR, say publication follows that
release PR's merge and registry verification; do not imply source merge
publishes the package. If the open PR is itself the release PR, say publication
follows its merge, without an ETA. For a first reply after merge, verify the
release workflow and registry before claiming availability; if the release PR,
workflow, or publication is pending or failed, name the next action/owner
without an ETA. Do not post a routine second reply just to announce package
publication.

Read back each reaction and reply as the invoking identity before recording the
item as replied.
