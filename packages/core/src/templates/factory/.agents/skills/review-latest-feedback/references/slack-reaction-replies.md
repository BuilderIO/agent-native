# Slack Reaction Replies

Use the connected Slack integration for every Slack read and write. Never
operate Slack through computer use, a browser, screenshots, or UI automation.

For each eligible item, add `👀` before investigation. Keep all reactions
permanently: never remove or clean up `👀`, `✅`, `🎫`, or any other
reaction on a feedback item. Add `✅` when the accepted scope is complete and
verified: defects meet **Fixed**, and upvoted improvements meet **Shipped**
after delivery is verified. Add `🎫` only to distinct unfinished scope
needing a follow-up action or owner, whether or not a ticket exists.

Before posting, inspect the full thread for an earlier disposition reply. Send
one concise status reply per feedback item: what changed, meaningful scope
remaining, and the next action/owner/ticket if needed. For a beta app fix, link
the PR and say beta should follow soon after merge; give no exact date. If the
first reply is after merge, say it merged and check the matching publisher. If
publication is pending, say it should follow soon; if the publisher is missing
or failed, give no ETA and name the next action/owner. Never claim it is live
without verification. If an earlier reply already gives the disposition and
timing, keep later publisher checks in the recap; do not post just to announce
success. Correct a material change to availability or answer a reporter's
follow-up. A generic earlier “looking into this” does not count.

Identify known duplicates before claiming them. Represent duplicate non-owner
threads by permalink and **Clustered** in one owner-thread reply. Do not react
or reply in a non-owner thread unless a distinct question or update needs its
own disposition. If a duplicate is discovered after this run adds `👀` but
before its disposition reply, keep the eye and use that reply to say
**Clustered** with the owner permalink. If found after the owner reply,
preserve reactions and post one concise **Clustered** reply in the duplicate
thread with the owner permalink; do not post a second owner-thread update
unless its status changed.

For an open package PR, say publication follows merge without an ETA. If the
first reply is after merge, link the PR and state verified package availability;
if publication is pending or failed, name the next action/owner without an
ETA. Do not post a routine second reply just to announce package publication.

Read back each reaction and reply as the invoking identity before recording the
item as replied.
