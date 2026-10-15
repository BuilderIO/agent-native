# Replies to outside contributors

These show the shape, not the words. Match the dev's own voice, fill every
bracket with something specific to this PR, and cut whatever doesn't apply.
Each one thanks first, names one specific good thing, makes at most one ask,
and says what happens next.

## First look, when a full review will take time

```text
hey Sam, thanks for this! [specific thing] is a nice touch. I'll give it a
proper review by [day].
```

## Asking what they're building

Ask this before reshaping or declining a core change (#7432).

```text
hey Eric, thanks for this! [specific thing] is really thoughtful. before we go
further, could you tell us a bit about what you're building? which app needs
this, and what doesn't work for you today?
```

## One ask, with the merge condition

```text
thanks for this, Till! [specific thing] looks good. one thing before we merge:
could you [ask] so [outcome]? then it's good to go.
```

Good examples: #2811 ("one last piece of feedback ... if you agree would be
great to get the fix in, then good to merge"), #4788 ("looks like just need a
lint issue fixed, and one additional ask to get this in").

## Checking direction first

For a major product call or a new framework API. Don't say who you're asking.

```text
thanks for this, Sam! this changes [workflow or API], so I want to check the
direction before you put more time in. I'll get back to you by [day].
```

## After their update

```text
thanks, that covers it! [merging once checks pass / one thing left: ...]
```

## After pushing to their branch

```text
main moved under this one, so I merged it in and fixed the conflicts in
[file]. I also [change] because [reason]. shout if that's not what you meant.
```

## Finishing it after 14 days of quiet

```text
hey Sam, I went ahead and finished this off: [what]. your commits are all
still here, and you'll be the author on the merge. thanks again!
```

## Rebuilt on their commits

On their PR, with the link (#7432 → #7449):

```text
thanks again, Eric. what you're building made it clear this should be
[the general shape], so I rebuilt it on top of your commits in #[new]. your
commits are in there and you're credited as co-author. would you mind trying it
with [their project]? I'll close this one once that lands.
```

## Merged

Name what shipped in user terms (#3639: "main moved to one mcp manager per user
after you opened this, so i hooked your authorize check into that and merged
it. it's in now 🙏").

```text
merged, thanks so much Till! [what users can do now] is in main.
```

## Declining

Give the real reason and an open door (#6706: "we want to keep our MCP
integrations to a small list of popular products given we will need to
maintain them forever").

```text
thanks for the suggestion, Robert. right now we're keeping [area] to [scope]
because [reason]. I'm going to close this for now, but if [condition], we can
revisit.
```

## The 30-day ping

```text
hey Sam, checking in on this one. what's left is [ask]. if you're busy, no
worries: [I can finish it / it can wait]. I'll close it next week if I don't
hear back, and you can reopen it anytime.
```

## Closing as stale

```text
closing this for now since it's been quiet. thanks for the work here! if you
pick it back up, reopen it or open a new PR from the same branch and I'll take
a look.
```

## What to avoid

| Instead of                                             | Do                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| "ready for internal approval" or "needs owner review"  | Approve and merge, or say "merging once checks pass"          |
| "please rerun CI" or "resolve the conflicts with main" | Rerun it, or merge main yourself                              |
| "take a look at the automated review comments"         | Decide which findings are real and ask for those, or fix them |
| Five asks in one comment                               | One ask, or finish the rest yourself                          |
| New asks after "final"                                 | Raise only what the new head introduced                       |
| "Thanks for the update" when nothing changed           | Thank them for the contribution                               |
| Asking for screenshots on a design doc                 | Ask only for evidence the change needs                        |
| Merging silently                                       | One line naming what shipped                                  |
| Greeting by @handle, or @-mentioning Builder people    | Their first name; ask teammates directly                      |
