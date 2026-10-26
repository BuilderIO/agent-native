---
"@agent-native/agentkit": patch
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Narrate the Worked for disclosure as steps:

- The collapsed row stays one line, "Worked for 1m 5s, 4 failed", with the failed count in amber. Credits used, Tool calls and Model used lead the expanded view.
- Expanded, each reasoning heading opens a step on a rail, with the calls that followed it grouped by what they did ("Searched 5 queries", "Read 4 pages", "Edited 3 files") and their queries, page domains or file names inline. The heading's reasoning opens from the step title.
- Failed calls read in place as "1 failed" with their short reason, and the failure lines add up to the summary's count. They stay in view past the step and group previews.
- Long runs show six steps and four groups per step before Show more; a running step stays in view.
- `ReasoningPart` gains an optional `toolCallIds`, and the agent-native transport fills it for saved replies, so reloaded threads keep reasoning between the calls it introduced.
- A user message's footer shows on hover or focus over the space under its bubble, and the agent turn starts a full turn gap below that space, so the two toolbars no longer stack.
- `agentWorkTimeline` and `agentWorkSteps` export the step model, and `useAgentKitInWorkStep` tells a host reasoning renderer it is inside a step.
- Once a reply finishes, its Worked for row moves under the reply onto one line with the reply's controls: Worked for on the left, copy, rating and more on the right. Its steps open full width below that line. While the reply runs, the live row stays above it.
- The move reads as one change: the row's old space above the reply closes over 180ms while the row fades in on the footer line, so the reply glides up instead of jumping. Only a finish seen live animates; a thread that loads already finished, and reduced motion, move at once. A row opened to watch the live work closes as it moves.
- Model used names the model the run's calls reported, by its catalog short name, so an Auto request shows the model Auto ran. Auto itself never shows as a model, and the row stays hidden when no model was recorded. `AgentKitRunUsage` gains an optional `model`, and `AgentKitRoot` takes `formatModelName` for the display name.
- A finished reply's work row always reads "Worked for <time>" ("Worked" when the time is unknown) with the clock icon, including a turn that only thought. "Thinking" shows only while it runs, and the thinking is listed as steps inside the row, titled by its own label when the agent gave one. `AgentKitLabels` drops `thought`, `thoughtFor` and `thoughtBriefly`.
