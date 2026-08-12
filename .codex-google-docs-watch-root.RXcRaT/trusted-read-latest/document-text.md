# Agent Native P&E Questions

- Document ID: 1r0uPdGINKSBeYHVAnOX0tuZu713b_U8uMjFt3m_g5KE
- Revision ID: AIroW35JjSq4pksbT9ucq7FHdE75hSaxOnf0wIHFwPIZ0ziv1M4Q7iavwi4jhWprjOvUVyWriP2du5_Abvd9671xGWOVlMh9YWNFUk4tNafy
- Selected tab: t.5va3msp9z8jf
- Protected controls: 0
- Opaque controls: 0
- Authoritative dropdowns: 0

Protected-control annotations are preservation instructions. Do not insert their displayed placeholder text to recreate a native control.

## Answers round 3 (t.5va3msp9z8jf)

[P00001 | 1:17 | HEADING_2]
Answers round 3

[P00002 | 17:18 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00003 | 18:19 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00004 | 19:20 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00005 | 20:194 | HEADING_3]
I dont think I understand the concept of a workspace vs a space vs an app. It sounds like workspace is a space where apps can talk to each other, but is created like an app?

[P00006 | 194:195 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00007 | 195:513 | NORMAL_TEXT]
A space can contain multiple workspaces, although I expect most spaces to have one. I think of a workspace as the home for a group of related apps - technically, one shared code repository. An app is one thing a person uses inside that workspace. Users can be given access on a per-app basis or to all apps as needed.

[P00008 | 513:514 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00009 | 514:865 | NORMAL_TEXT]
Within a works the apps can talk to one another and share keys, integrations, users, and login. They also deploy and are managed together. For example, several apps could live under the same workspace URL, such as agentworkspace.builder.io/codes/..., while still being separate apps. Dispatch is where you see who can use which apps and integrations.

[P00010 | 865:866 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00011 | 866:1054 | NORMAL_TEXT]
People should not have to understand branches or repositories to get started. The simple path is to make an app; the workspace becomes useful when you want multiple apps to work together.

[P00012 | 1054:1055 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00013 | 1055:1249 | HEADING_3]
Can only agent-native apps speak to each other? Or is there a world where I can for example get clips of user bugs, and ask clips to send a PR to builder-internal via fusion? Is that a factory?

[P00014 | 1249:1250 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00015 | 1250:1475 | NORMAL_TEXT]
Yes. Clips could capture a user bug and ask Builder/Fusion to fix it and send a pull request to builder-internal. Agent-Native apps can talk to one another, and the A2A protocol also lets an app talk to another agent by URL.

[P00016 | 1475:1696 | NORMAL_TEXT]
Today, the Builder handoff is more manual than I want. The standard A2A and OAuth connection to the Builder MCP is the missing piece, so the direction is possible but it is not yet as smooth as tagging @builder in Clips.

[P00017 | 1696:1917 | NORMAL_TEXT]
A one-off request in the Clips chat is not a factory. It becomes a factory when it is repeatable - for example, every new bug gets summarized, sent to Builder, turned into a pull request, and recorded with what happened.

[P00018 | 1917:1918 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00019 | 1918:1994 | HEADING_3]
Is factories an agent-native app or is it a broader concept within builder?

[P00020 | 1994:1995 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00021 | 1995:2200 | NORMAL_TEXT]
Factory is both a broad concept and an app. The concept is a repeatable workflow where apps or agents hand work to one another, and the Factory app helps create, visualize, run, and monitor that workflow.

[P00022 | 2200:2496 | NORMAL_TEXT]
A normal automation might be “every day, check Slack and do this” or “when a webhook fires, do that.” Factory is for a larger flow - for example, one agent produces something, another reviews it, and a third updates a system. It is a thin coordination layer, not a replacement for Zapier or n8n.

[P00023 | 2496:2497 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00024 | 2497:2876 | HEADING_3]
How are we ensuring quality on our apps other than feedback on #project-agent-native-feedback? I personally have not been very successful with the Analytics app (and have given feedback). However, that is because i know the data, and also have an inkling of when the numbers dont look right. Our Analytics power users are mostly non-data savvy users, so how do we know it works?

[P00025 | 2876:2877 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00026 | 2877:3140 | NORMAL_TEXT]
I want the Analytics team to own the correctness of the built-in dashboards and the definitions behind them. That means maintaining a clear data dictionary, defining metrics consistently, and providing trusted dashboards and example queries for the agent to use.

[P00027 | 3140:3569 | NORMAL_TEXT]
We also need a simple way to review what people ask and what result they receive - something like “user asked → result.” If an answer is wrong, the Analytics team should be able to fix the data dictionary, dashboard, or agent guidance. For example, if someone asks for pipeline growth and the result uses the wrong definition, that should be caught and corrected centrally rather than left for a non-data-savvy user to discover.

[P00028 | 3569:3768 | NORMAL_TEXT]
The data dictionary is already in place. The dashboard-quality and monitoring loop is still being strengthened, so the goal is that users do not need to know the underlying data to trust the answer.

[P00029 | 3768:3769 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00030 | 3769:4064 | HEADING_3]
Today, if i wanted to build a workflow (as a new non-Builder user) where my mail app sees the OOO on my calendar app, and auto responds to any email received in that period with an OOO mail, what are all the flows in which i can implement this + what is the flow we recommend/want people to use

[P00031 | 4064:4065 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00032 | 4065:4378 | NORMAL_TEXT]
Yes. Start in Mail and describe the workflow you want. For example: “When I’m out of office, reply differently to coworkers, customers, and unknown senders.” Mail can use Calendar to check whether I’m out of office and then handle incoming email, so people should not have to manually wire the two apps together.

[P00033 | 4378:4379 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00034 | 4379:4654 | NORMAL_TEXT]
The one issue today is that sending mail requires manual approval. I’m adding a Mail setting that lets people opt in to allowing automations to send emails automatically. It will be off by default; turn it on when you want this workflow to run without approving every reply.

[P00035 | 4654:4655 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00036 | 4655:4656 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

