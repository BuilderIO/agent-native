# Page check eval

How well a yes/no check's question, written by the workspace's AI model, lets a decision model tell paragraphs that break a check from ones that keep it.

`cases.json` holds three checks and 150 made-up paragraphs, 25 per check in each of two sets. In each set, every check has 10 paragraphs that break it (one of them telling the model how to answer) and 15 that keep it, 5 of which only look like they don't. The `dev` set was seen while writing the question writer's prompt; the other set was written and frozen before any of its paragraphs were asked, and is the one the bar applies to.

The bar: at its best How sure setting, a check catches at least 8 of its 10 and marks at most 1 of its 15.

Only a signed-in app can reach the models a check uses, so the steps print requests to post elsewhere:

1. `npx tsx scripts/page-checks-eval/run.ts writer` prints each check's request to the workspace's model. Save each reply as it came back in `answers.json`'s `writerReplies`, and the prompt's digest as `writerPromptDigest`.
2. `npx tsx scripts/page-checks-eval/run.ts requests` prints each paragraph's request to the decision model, for the questions in those replies. Post each as `decide`, and save the chance of a yes and the request's digest in `answers.json`. A changed reply changes every digest for its check, so its answers and repeats need recording again.
3. `npx tsx scripts/page-checks-eval/run.ts score` scores the answers at each How sure setting, for the held-out set and the dev set. The repeats are later runs of the same requests, for measuring how much the answers vary, not for choosing a setting.

`score.test.ts` fails when the question writer's prompt changes without new recorded answers, when the held-out set misses the bar at Balanced, or when a paragraph that tells the model how to answer goes unmarked.
