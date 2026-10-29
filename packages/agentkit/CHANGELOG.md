# @agent-native/agentkit

## 0.222.2

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.222.1

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.222.0

### Patch Changes

- Release all public npm packages with a patch version bump.
- f8c2ba6: A reply the agent rewrote after a final-answer check now shows once. Before, the chat kept the rejected draft and added the rewrite to its end, and a reload showed the rewrite again as a second reply. Now the draft leaves the screen when the server discards it, and a run that fails after a discard no longer leaves the draft behind. A reply the agent sends together with its follow-up suggestions is now the final answer. Before, the server erased it and asked the model again, which wrote a short recap of a reply that was no longer on screen. A streamed reply with a reasoning part is now replaced by its saved reply like any other. While a turn is still working, its steps stay in one live row above the reply, even when the agent writes a line between steps. Before, each such line closed the steps above it into a "Worked for" row while the agent kept working, so the turn showed two rows. Lines the agent writes between steps also show as separate lines while they stream, instead of running together.

  AgentKit adds a `message.replaced` event, which swaps the parts of a message that is still streaming.

## 0.221.0

### Patch Changes

- 0ab7e59: Rebuild the right side of the agent chat prompt bar: context ring, model and effort, mic, then Send.
  - The Agent/Plan mode picker and its Shift+Tab shortcut are gone; the composer always acts. `/plan` now plans only the next message: it adds a removable Plan chip, that one send goes out as a plan turn, and the composer acts again after it. `/act` is removed. The "Implement" affordance after a plan reply still sends the plan in act mode.
  - Breaking for hosts: `execMode`, `onExecModeChange` and `planModeDisabledReason` are removed from `TiptapComposer`, `PromptComposer` and `AssistantChat`/`AgentKitAssistantChat`; `mode`, `defaultMode` and `onModeChange` are removed from `AgentKitComposer`; `execModeRef` is removed from the custom-transport adapter context; and `PlanModeCallout` takes only `onImplementPlan`. `TiptapComposer` and `PromptComposer` take `planCommand` to offer `/plan`, and report a planned send as `requestMode: "plan"` in their submit options. `AgentKitComposer` and `AssistantChat` offer `/plan` by default; `planModeDisabled` hides it.
  - A Plan mode saved by the old picker under `agent-native-exec-mode` is no longer read, by `AgentPanel` or by `sendToAgentChat`, so nobody is left stuck in plan.
  - The mic has its own slot beside Send and stays put while you type. Clicking it starts dictation right away (the browser asks for microphone access the first time); the "Use your voice" chooser and its "Remember my preference" setting are gone, and a previously saved preference is ignored. While dictating, the mic grows in place into a pill with a live waveform from the microphone level and a stop button: Stop inserts the transcript at the cursor, and Escape cancels. While the recording transcribes, a spinner takes the waveform's place and the control becomes Cancel transcription. A blocked, missing or busy microphone shows an amber notice in the composer that says how to allow it, with Try again, and the mic stays usable.
  - Send is always the last control. With an empty draft, no run active, and a realtime voice provider (Builder.io or an OpenAI key) ready, it starts voice chat instead; any text, attachment or Plan chip turns it back into Send. Without a provider it is a dimmed Send. While a run is active, Stop takes its place with no draft, and Send returns beside Stop once a draft exists.
  - Voice chat runs inside the composer instead of a floating orb. While a session is on, the mic's slot shows who is speaking (live bars from the microphone or the assistant's voice, with a Listening or Speaking status) and speaker and microphone mute toggles, and the primary slot becomes an End voice chat button that spins while connecting. The editor locks behind a "Listening…" placeholder because the realtime session takes no typed input, and a failed session shows as an amber composer notice with Try again.
  - Voice chat's microphone, language, intelligence and voice style settings move to Settings › Account › Preferences › Voice chat, next to Voice input, and a session picks up changes the next time it starts.
  - Both sides of a voice chat stream into the chat transcript in every host, including the full-page chat: your words fill in as a user message while you speak, the reply streams in as an assistant message, and each turn is finalized in place and saved with the thread when its transcript completes (a turn still being spoken is never saved or used for the chat title), so a reload shows the conversation. The shared `AgentKitChat` owns this; `AgentKitAssistantChat` no longer keeps its own copy. A new `AgentKitController.upsertLocalMessages()` adds or updates messages that arrive outside a run.
  - Breaking for hosts: `RealtimeVoiceModeEntry`, `RealtimeVoiceModeEntryProps`, `RealtimeVoiceModeDock` and `RealtimeVoiceModeDockProps` are removed; `RealtimeVoiceModeApi` drops `chatVisible` and `toggleChat` and adds `inputMuted`, `outputMuted`, `setInputMuted`, `setOutputMuted` and `dismissError`; `RealtimeVoiceModeCopy` drops the chooser, setup and chat-toggle fields; `appendRealtimeVoiceTranscriptToRepository` is removed; and `VoiceDictationApi` replaces `amplitude` with a `levels` store. Core's upgrade doctor and old `@agent-native/core/client/chat` entry report the Entry and Dock exports as removed, with a pointer to the AgentKit chat migration guide.
  - Dictation speech errors (no audio captured, speech service unreachable) are translated and point at Voice transcription in Settings.
  - The model chip reads as the model name followed by the effort in muted text, with no separator ("Opus 5.5 High", "Auto"), and only shows an effort once one is set. In narrow composers the model name truncates and the effort stays.
  - The context ring always shows: a thick track with a blue fill from 12 o'clock at the true share (amber from 80%), with square ends and no minimum arc, so low usage never looks like a loading spinner.
  - The context ring popover shows "Context window" with the usage on one row and a chevron that expands an inline breakdown under the bar: one row per bar segment with a matching swatch, tokens and share of the window, plus free space. The bar tooltip, the "See detailed breakdown" link, the in-popover X-Ray view and the `onOpenDetails` prop on `ThreadContextRing` and `ContextUsagePanelView` are removed.
  - The "Plan ready" note shows after any reply to a `/plan` message once the run is done, including a reloaded reply that carries no mode of its own, and the Chat template now shows it above its composer. New `getReplyRequestMode` and `IMPLEMENT_PLAN_PROMPT` exports from `run-recovery`.
  - A turn holds the thread from the moment its draft is taken, before preflight checks or a run id: Stop shows once the send reaches the controller and takes effect once the run registers (a failed stop says so), and a draft sent in that window, including from `AgentKitAssistantChat`, shows as a queued row right away and is queued behind the turn instead of being dropped or racing it as a second turn. Rows queued during a run still go into it from Send now. New `useAgentKitSubmissionStarting` and `useAgentKitSubmissionHoldsTurn` hooks, and a `queuesBehindSubmission` prop on `TiptapComposer` and `PromptComposer` that sends a draft entered while an earlier one is in flight as a queued send behind it.
  - Picking a slash command, skill or @ mention from the menu removes the whole typed token, read from the editor at pick time, even when the keys arrived before the menu opened. Disabling the composer now closes an open @ or / menu.
  - The voice providers status counts Builder the way the realtime voice and transcription routes authenticate, so a Builder OAuth sign-in turns on voice chat, not only a stored key pair. A provider whose credentials can't be read is listed in a new `credentialLookupFailed` field instead of being reported as not configured. Settings › Voice transcription uses the same rule for Builder realtime, and shows a provider whose credentials couldn't be read as unknown with Retry instead of asking you to configure it. `getVoiceProviderStatus()` returns the same `credentialLookupFailed` list.

- 0ab7e59: Narrate the Worked for disclosure as steps:
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

- 798991f: Reject unrelated 409 errors that carry a stray submitted-run receipt.
- 0ab7e59: Reorder queued messages and tidy the composer:
  - Queued messages can be reordered: drag a row by its handle, press ArrowUp or ArrowDown on the handle (or Alt+ArrowUp/ArrowDown anywhere in the row), or pick Move up or Move down from the row menu. The move is announced, persisted through the new `reorderQueuedMessages` transport operation (`PUT /threads/:id/queue`, the `reorder` queue mutation in Agent-Native), and rolled back with a notice if the server refuses it. A reorder that names a different message set than the queue holds fails with `queue_order_stale` instead of reordering blind.
  - The queue drawer keeps rows a fixed 32px with 14px/20px text, reserves its action columns so hovering and a second queued message never reflow a row, fades rows in instead of sliding them, and takes its corner radius from the composer so drawer and row corners are concentric.
  - The composer placeholder reads "Reply…" once a thread has messages (`placeholder`, `replyPlaceholder` and `conversationStarted` props).
  - ArrowUp in an empty composer edits the last sent message when the host passes `onRecallLastMessage`.
  - Suggestion chips read as active controls with a hairline border and a hover fill, and the suggestion row grows to fit its caption on an opaque backing, so transcript text never shows through it.
  - Reasoning renders as markdown.
  - Attachment remove buttons have a 24px hit target.
  - An empty slash menu says "No commands", or "No matches" for a query.

- Release all public npm packages with a patch version bump.
- b14bed7: Realtime voice acts on requests instead of declining them and says what it is doing. The spoken GPT-Live model now gets its own instructions to delegate every lookup, web search, navigation, or change to the tool model, to name each action before it runs, and to mention a slow step instead of going quiet; the tool model keeps the app context. `web-search` and `web-request` load with each session. Voice now gets the same per-request actions as text chat, including the tools of MCP servers the user connected, which `tool-search` can find and voice can run. An action that needs approval now asks in the voice controls: Approve runs that exact call and tells the assistant the result, Deny tells it the call did not run, and an "always allow" set in chat applies in voice too. Apps can set `realtimeVoice` on `createAgentChatPlugin` to add voice guidance, preload their main edit tools (kept through tool discoveries), and choose a default intelligence that applies until the user picks one. On GPT-Live, Balanced now raises the tool model to medium reasoning and Deep to high. Each voice turn reports a `realtime_voice_turn` event with speech-to-first-audio time, tool call counts, and whether the user spoke again within 10 seconds of an edit, with no transcript text. While voice works, its status names the step it is running, such as "Patch deck", or says it is thinking between steps, and the chat's work row shows that live step as it does for a text run. Voice tool calls now show in the chat as one work item per request, like a text chat run's, and stay after a reload: AgentKit's new `appendLocalEvents` folds a local run's events into a thread without starting a server run. On GPT-Live a request is one delegation, and its work ends when the delegated model answers without calling a tool. GPT-Live transcripts are grouped into turns by the OpenAI SDK's Live transcript grouper (toolkit now depends on `openai`), so a reply spoken with short pauses is one message and a new message starts after two seconds of silence or a change of speaker.
- 0ab7e59: Send now adds a queued message to the running turn instead of stopping it:
  - The run reads the message at its next tool boundary. It goes into the next model request as user text after the tool results it waited for, and the transcript shows it between the reply before it and the reply after it. The run emits a new `user_message` event, the reply is split there on both the server fold and the live stream, and saved threads without the event render as before.
  - Delivery happens exactly once. The queue mutation `steer` flags the message and moves it to the head of the inbox. The run then takes it off the queue and marks its inbox receipt submitted to that run in one transaction, so the inbox never also starts it as a new turn.
  - Cmd+Enter (Ctrl+Enter elsewhere) and Cmd-click on Send during a run do the same: the draft is queued and sent into the running turn. `SendMessageInput.deliverInActiveRun` carries that intent, and the queued payload no longer asks the server to stop the run.
  - A message that misses the run's last tool boundary goes first as the next turn. The queue row shows "Sending…" while it waits and "Sends after this reply" once the reply is past its last step.
  - Stop and send, a new item in the row menu, stops the current response at a safe boundary and then sends the message. For a message the server inbox owns, the inbox starts it, and the client waits up to 15 seconds for its receipt. If the run refuses to stop, or the receipt is still waiting at the deadline, the message stays queued to send after the reply.
  - Queue errors (`queue_item_busy`, `queue_item_blocked`, `queue_order_stale`, `run_slot_busy`) show localized copy instead of inbox text and message ids. The typed codes stay on the error for logic and logs.
  - New protocol fields: `SteerQueuedMessageInput.deliverInActiveRun`, the `{ delivery }` steer result, and `AgentQueuedMessage.delivery`.
  - The work a run did before a delivered message shows as its own finished "Worked for" row above that message, and the reply after it counts only the work after it. A reply segment with nothing to show, such as one that only called tools, renders nothing of its own instead of an empty message with a toolbar. Saved threads keep the delivered message's place in the run's events, so a reload splits the work the same way. A run resumed after a crash replays each delivered message with its attachments, the same way it first read them.

- 2e8f454: Compile with `noImplicitOverride` and `noFallthroughCasesInSwitch`, and, where the code already passes them, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Optional fields that legitimately hold `undefined` are now typed `T | undefined`. No runtime behavior changes.

## 0.220.0

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.219.0

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.218.0

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.217.0

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.216.0

### Minor Changes

- b28df00: Agent chat now validates durable queued submission receipts against the original session and message identity, preserves retry context after an unreadable acknowledgement, and prevents attachment payloads from being admitted under a mismatched receipt. Queued follow-ups keep their attachment references, drain at completed-turn boundaries, and expose terminal receipt states so mobile turns can settle when admission expires or is blocked.

### Patch Changes

- b28df00: Preserve accepted inbox order, bounded retry behavior, effective run settings, and inline attachment identity when Agent-Native chat submissions are queued or promoted.
- b28df00: Keep receipt-backed queue promotion under the durable inbox retry policy and report cancellation failures without marking queued mobile turns stopped.
- Release all public npm packages with a patch version bump.

## 0.215.0

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.214.0

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.213.1

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.213.0

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.212.1

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.212.0

### Patch Changes

- d24c71c: Reloading a chat no longer shows a second copy of a reply when folded runs streamed into the same assistant message, and that message keeps streaming when an earlier folded run settles. A continuation that starts after its predecessor finished now appends to that reply, and one that fails or never writes no longer changes its status. Reloading while a continuation is still carrying an earlier run's reply no longer leaves that reply streaming after the continuation finishes.
- Release all public npm packages with a patch version bump.

## 0.211.0

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.210.2

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.210.1

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.210.0

### Minor Changes

- 41f86eb: Persist fenced agent execution steps and submission receipts across chat, automation, team, and A2A runs.

### Patch Changes

- Release all public npm packages with a patch version bump.
- 0cfbd4d: Include the MIT license text in the published package.
- 69b873f: Keep attachment submissions available without Web Crypto and reject leased run writes that lack an execution fence.

## 0.209.2

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.209.1

### Patch Changes

- Release all public npm packages with a patch version bump.
- c139e35: Expire queued chat submissions when their retry window closes, and require peer support before sending deadline-bound retries.

## 0.209.0

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.208.0

### Patch Changes

- 0fb4de3: Keep completed responses available when terminal replay catch-up is incomplete.
- afe2ee7: Preserve completed tool history and render legacy Plan blocks through their authoring controls.
- Release all public npm packages with a patch version bump.
- 0fb4de3: Report exhausted terminal catch-up transport failures through the normal stream error path.

## 0.207.1

### Patch Changes

- Release all public npm packages with a patch version bump.
- 77c15ee: Recover AgentKit run cursors from trusted protocol metadata, compact omitted event ranges, and retry transient first-run status failures.

## 0.207.0

### Minor Changes

- 41700be: Expose server-confirmed chat persistence, report snapshot save results, and allow canceled persistence requests so the UI can retry failed saves safely. The legacy `persistThreadSnapshot()` method rejects on unexpected transport failure and resolves for expected cancellation or queue deferral without confirming that the snapshot was saved. Use `persistThreadSnapshotWithResult()` when callers need the save outcome.

### Patch Changes

- 19cd58b: Fix chat turns that died or looked broken for recoverable reasons. A turn that yields to a connection request is recorded as awaiting input instead of a truncated run (no synthetic auto-continue, no chained successor), and automations record the yield as a typed connection_required failure and pause. Stale connection cards retire with their run, and a chat that does not own a pending connection resume no longer shows a stuck "Connection failed" banner. A failed peer-app call shows the app name once with a short reason and keeps its participant after the run finishes. Peer-app failures carry typed codes so the caller stops retrying an unfixable peer, and a peer that needs a connection returns a do-not-retry result. An org A2A secret equal to the deploy secret is refused, and the resulting identity demotion is logged.
- aa34418: Never persist inline image or file bytes in chat storage: thread snapshots, queued messages, run events and dispatch payloads keep a durable URL or an explicit omitted marker instead of `data:` URLs. Chat now reports typed, localized upload and attachment errors (including a "Retry without attachment" action for provider-rejected files), replays earlier attachments and the original ask in long threads, keeps a provider ownership check from failing on one unreachable provider, marks interrupted tool results as unknown-outcome errors, and no longer records experiment assignments when a model was chosen explicitly.
- ccddd3a: Preserve image attachments and user-selected output dimensions throughout agent chat and Design generation.
- Release all public npm packages with a patch version bump.
- ecfe037: Preserve opaque uploaded file IDs and show an error when retrying without attachments fails.

## 0.206.0

### Minor Changes

- e88f35c: Prevent new AI chat work from dispatching without an eligible provider, and provide a consistent Connect AI flow.

  `createProductionAgentHandler` now requires the `assertAiSetupReady` callback. Existing callers must provide a readiness assertion before upgrading; refusals can use the existing `onRunNotStarted` callback to retain the user's prompt and retry context.

  AgentKit transports must provide `assertAiSetupReady`, or clients for transports where shared Agent-Native provider setup does not apply must set `aiSetupReadiness: "not-applicable"` explicitly.

### Patch Changes

- d6f1e18: Keep inline attachment bytes out of durable chat payloads, reject data URLs in queued file references, and distinguish stored references from unreadable malformed uploads.
- 80e66f8: Persist a sanitized first-prompt title for chat threads without replacing an existing title, hide prompt context from extracted previews, match context tags by exact name, and remove unused browser-installer dependencies from serverless functions.
- Release all public npm packages with a patch version bump.
- d6f1e18: Preserve image MIME types through shared chat attachments, report active engine configuration errors instead of treating them as missing provider credentials, validate queued image sizes before decoding, keep legacy queued messages readable, and avoid misleading storage setup guidance for generic upload failures.
- f3d2b81: Recover completed chat runs when terminal replay is briefly incomplete, keep invalid gateway requests from retrying as transient errors, classify completion timeouts with a stable error code, preserve retries for no-detail transient gateway codes, continue recoverable run timeouts, and reject partial completion when a stream ends cleanly after timeout.

## 0.205.0

### Patch Changes

- b7e32e4: Place the "tool-call history was omitted" note before the user's prompt in `sendMessage` requests, so the request ends on the user's turn instead of a synthetic assistant message.
- e7416e0: Keep runs awaiting approval active when the client needs to rebuild its run projection, so follow-up prompts stay queued.
- Release all public npm packages with a patch version bump.
- 5c5e00e: Keep approval-pending runs active when restoring a thread snapshot.
- 004f2a9: Continuing a stopped agent run no longer repeats the steps it already finished. A run the server ends after its worker died now saves its finished tool calls to the thread, a new message after an unfinished turn tells the agent what that turn already did, and the run failure card offers Continue, which resumes the stopped run's own turn so a finished send or charge is not run again. AgentKit transports can implement the new optional `continueRun`.

## 0.204.0

### Patch Changes

- Release all public npm packages with a patch version bump.
- bed3b01: Keep queued AgentKit messages behind replacement runs resumed from an approval.

## 0.203.1

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.203.0

### Patch Changes

- 3d573d7: Prevent duplicate chat output and bound custom transport snapshot persistence.
- Release all public npm packages with a patch version bump.
- 3d573d7: Persist AgentKit thread snapshots as bounded deltas so long conversations do not exceed hosting request limits.
- 4738d38: Include completed tool calls and results in the next AgentKit turn so the agent can answer questions about its prior tool activity.

## 0.202.0

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.201.1

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.201.0

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.200.0

### Patch Changes

- Release all public npm packages with a patch version bump.
- 5113a23: Make follow-up queueing reliable, preserve each prompt's run options, and keep internal context out of user-visible text.

## 0.199.0

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.198.8

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.198.7

### Patch Changes

- Release all public npm packages with a patch version bump.
- 3ba09b7: Copy complete Visual Edit instructions by default and show Builder.io for Builder credit connections.

## 0.198.6

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.198.5

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.198.4

### Patch Changes

- 85a87e6: Split ChatFirst navigation from its pane bundle, preserve queued chat intent through provider preparation, and keep client-only SSR stubs constructible.
- Release all public npm packages with a patch version bump.
- 20d3bb8: Retry automatic queued message promotion when the run slot remains occupied.

## 0.198.3

### Patch Changes

- Release all public npm packages with a patch version bump.
- ce1245c: Preserve queued chat intent through asynchronous preparation and resumed runtime streams.

## 0.198.2

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.198.1

### Patch Changes

- 0b127e9: Clear chat input immediately on submit and show the pending response status in the transcript.
- Release all public npm packages with a patch version bump.

## 0.198.0

### Minor Changes

- afbee14: Move runtime-backed React surfaces and generated source corpus out of Core's default package path, and move AgentKit's React entrypoints to Toolkit in a breaking AgentKit release. Follow the [Core 0.198.0 upgrade guide](https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx) when updating an existing app or consuming AgentKit directly.

### Patch Changes

- 8853f61: Keep reasoning inside collapsed work history, align disclosure chevrons with their labels, and tighten progress spacing. Show elapsed time once on the work summary instead of repeating the full run duration on each thought.
- 8853f61: Render model-authored follow-up suggestions only for the latest successfully completed turn, retire stale suggestions across new turns and restores, and submit full suggestion prompts through normal context and permission checks. Keep initial empty-state starters separate from conversational follow-ups.

  Pass the active thread ID to fullscreen callbacks instead of a menu selection event.

- 8853f61: Clear shared chat composers when AgentKit owns the recoverable user message instead of waiting for the agent request to start. Preserve newer drafts, explicit send failures, and queued-message acknowledgement timing without sending local callbacks to transports or persisted submissions.
- 8853f61: Show catalog integration badges throughout live and expanded agent activity, retaining provider identity while tools run and keeping activity from different providers in separate groups.
- Release all public npm packages with a patch version bump.
- 8853f61: Collapse run activity by default, keep the latest active step visible, and group expanded history by purpose.
- 8853f61: Preserve completed runs when history refresh or stream closure fails, honor resolved approvals during hydration, keep connection continuations responsive, and expose tool, approval, and cancellation failures. Reject retained attachments if standalone upload access is withdrawn instead of silently dropping files. Reset chat disclosures across threads, preserve host composer gates, recognize streamed provider arguments, and contain long transcript content. Integrate thread- and account-scoped app composer context with exact revalidation, active-surface checks, and accepted-only cleanup while preserving ambient context, composer mode instructions, and full menu defaults.

## 0.5.1

### Patch Changes

- f2e8ffe: Center empty chat composers correctly and make send buttons circular across shared chat surfaces.
- Release all public npm packages with a patch version bump.
- 57e0a0f: Preserve live assistant messages through stale thread snapshots and reconcile terminal run status without skipping events.
- 82ad87c: Publish the current AgentKit runtime exports required by Core's chat surface.
- Updated dependencies [f2e8ffe]
- Updated dependencies [023ee9b]
- Updated dependencies [47985fe]
- Updated dependencies
- Updated dependencies [fa62fdf]
  - @agent-native/toolkit@0.23.1

## 0.5.0

### Minor Changes

- 108074a: Standardize full-page AgentKit chat homes and restore the Dispatch workspace app launcher.

### Patch Changes

- 7af9d3f: Refine AgentKit activity labels, approval details, and shared action cards.
- Release all public npm packages with a patch version bump.
- 230c5f0: Use the shared dropdown menu for message actions, matching chat menu styling and keyboard behavior.
- Updated dependencies
- Updated dependencies [a20f0b4]
  - @agent-native/toolkit@0.23.0

## 0.4.1

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [880740b]
- Updated dependencies [55c9666]
- Updated dependencies [55c9666]
- Updated dependencies
  - @agent-native/toolkit@0.22.3

## 0.4.0

### Minor Changes

- d462819: Move framework chat surfaces to AgentKit while preserving chat history, recovery, context, attachments, model selection, runs, and message actions. This removes the old assistant-ui transcript and stream owners, the `AssistantChat.createAdapter` prop, the public `AssistantMessageActionBar` export, and the adapter APIs `createAgentChatAdapter`, `createCodeAgentChatAdapter`, `createAgentChatRuntimeAdapter`, `codeAgentTranscriptEventsToContent`, and `codeAgentTranscriptHasPendingApproval`, plus their adapter-only options and event types. Use AgentKit `runtime` or `createTransport` for custom chat implementations.

### Patch Changes

- Release all public npm packages with a patch version bump.
- ed3801e: Remove nonessential source comments.
- Updated dependencies [d462819]
- Updated dependencies [797b3e2]
- Updated dependencies [e76947b]
- Updated dependencies
- Updated dependencies [adc7497]
- Updated dependencies [797b3e2]
- Updated dependencies [ed3801e]
- Updated dependencies [e7b6fcc]
- Updated dependencies [e76947b]
- Updated dependencies [2397f94]
  - @agent-native/toolkit@0.22.2

## 0.3.1

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [7e8a10a]
- Updated dependencies
  - @agent-native/toolkit@0.22.1

## 0.3.0

### Minor Changes

- 39a89d0: Add connected cascading composer context menus with declarative search, list, link, loading, error, retry, and pagination behavior, plus persistent footer actions for existing links or modal workflows. Apps register authorized data loaders or local choices instead of rebuilding picker views. Allow host file-staging adapters through PromptComposer and AgentKitComposer while preserving shared upload controls and attachment chips, with an opt-out from ordinary text-file inlining when the host already extracts those files. Document scope resets and source-version refreshes, with localized defaults in every supported locale.
- 39a89d0: Add opt-in hierarchical composer context menus, attachment status and recovery controls, bounded immutable context snapshots, and a shared quick-start submission handle. AgentKit awaits a beforeSend hook and carries the same context metadata through immediate and queued submissions. Composer drafts, files, and context can be staged before provider setup while submission remains gated; hosts can use `submissionDisabled` without disabling staging.
- 39a89d0: Add declarative context dialogs for URL attachment and paginated multi-selection, with validation, cancellation, batch callbacks, and localized shared controls. Expose the additive picker configuration through AgentKit while preserving existing submenu pickers.

  Add read-only website composer source requests and the server-side readComposerWebsiteSource helper. Website references retain bounded extraction status, warnings, rendering provenance, and explicit truncation, while failed extraction remains an error.

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [dbb10d5]
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
- Updated dependencies
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
  - @agent-native/toolkit@0.22.0

## 0.2.13

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [6ff4d47]
  - @agent-native/toolkit@0.21.3

## 0.2.12

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [2ba6541]
  - @agent-native/toolkit@0.21.2

## 0.2.11

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.21.1

## 0.2.10

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [21fdd86]
- Updated dependencies [4917d34]
- Updated dependencies
- Updated dependencies [ac01083]
- Updated dependencies [21fdd86]
- Updated dependencies [185e25d]
  - @agent-native/toolkit@0.21.0

## 0.2.9

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.20.9

## 0.2.8

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.20.8

## 0.2.7

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [2427195]
- Updated dependencies [d43305d]
- Updated dependencies
  - @agent-native/toolkit@0.20.7

## 0.2.6

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [e973e00]
  - @agent-native/toolkit@0.20.6

## 0.2.5

### Patch Changes

- 93d3a58: Restore bullet and ordered-list markers in rendered AgentKit Markdown content.
- 93d3a58: Add an inline message action transition for copying the server request ID from AgentKit responses.
- 93d3a58: Keep AgentKit chat streams causally ordered across refreshes and settle streamed work when runs complete, fail, or cancel.
- Release all public npm packages with a patch version bump.
- 15ec2fb: Keep chat lifecycle state and queue rows clear of stale UI overlap, and reserve space for the share dialog close control.
- 93d3a58: Settle AgentKit assistant messages at terminal boundaries and preserve queue mutation intent across overlapping requests.
- Updated dependencies [58b0779]
- Updated dependencies [3ecc476]
- Updated dependencies
- Updated dependencies [15ec2fb]
  - @agent-native/toolkit@0.20.5

## 0.2.4

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [5ede9f7]
- Updated dependencies
- Updated dependencies [ffafd84]
- Updated dependencies [424d0cd]
  - @agent-native/toolkit@0.20.4

## 0.2.3

### Patch Changes

- 901376b: Keep composer controls balanced, keep popovers within the viewport, and prevent first-run prompts from racing model authentication.
- Release all public npm packages with a patch version bump.
- Updated dependencies [901376b]
- Updated dependencies [b35949b]
- Updated dependencies [116c315]
- Updated dependencies
  - @agent-native/toolkit@0.20.3

## 0.2.2

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [c9cb7de]
  - @agent-native/toolkit@0.20.2

## 0.2.1

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [9f08f5d]
- Updated dependencies [cd40555]
- Updated dependencies [1f43d89]
- Updated dependencies [25dc407]
- Updated dependencies [e32e1d5]
- Updated dependencies
- Updated dependencies [657bba1]
- Updated dependencies [25dc407]
- Updated dependencies [6ba23d3]
  - @agent-native/toolkit@0.20.1

## 0.2.0

### Minor Changes

- 210c7d0: **Breaking (pre-1.0):** AgentKit protocol v2 intentionally rejects v1-only
  peers because the AG-UI envelope is not wire-compatible with the original
  Builder envelope. Upgrade the AgentKit client and server together, then rerun
  transport conformance before deploying a custom adapter. The deprecated
  `resolveApproval` API remains only as a source-compatibility bridge after both
  peers are on v2.

  Carry AgentKit runs over the AG-UI wire format instead of a Builder-only
  envelope. Overlapping events map onto native AG-UI event types, and the
  Builder-specific events travel as a versioned typed extension profile over
  `CUSTOM`, so a stock AG-UI client can read the stream while AgentKit consumers
  still receive fully typed domain events. Sequencing, replay cursors, and profile
  version negotiation are defined as explicit extensions because AG-UI specifies
  none of them. Approvals now use AG-UI's interrupt model: the Core transport
  exposes `resumeRun` with `resume` entries in place of `resolveApproval`. An
  approval interrupt terminally closes its protocol run, and `resumeRun` returns
  the distinct replacement run that carries the resolution and continued work.

- 210c7d0: Introduce AgentKit as one public package with subpath exports for the protocol,
  headless client, HTTP transport, transport conformance, and React runtime
  (`@agent-native/agentkit`, `/protocol`, `/http`, `/conformance`, `/react`, and
  `/react/*`), where the root and `/http` entries stay React-free; a
  versioned, provider-neutral protocol; validated messages, runs, capabilities,
  approvals, activities, smart objects, uploads, actions, participants, tasks,
  custom content, and durable thread snapshots; and typed compatibility,
  cancellation, and error semantics. Add the headless client, resumable HTTP and
  SSE adapters, executable transport conformance, and composable React provider,
  hooks, slots, registries, semantic UI, safe streamed Markdown, run recovery,
  host-aware copy confirmation, capability-gated feedback and forking with
  visible mutation state, and durable queued-message promotion.
  Add typed, replay-safe contextual connection requests with host-controlled
  setup, retry, decline, and resumable-run handling.
  Choice prompts now offer a focused custom response by default, preserve that
  answer separately from predefined option ids across transports, and let hosts
  disable the affordance for deliberately constrained workflows.
  Completed activity groups now collapse to a duration-aware “Worked for…” row
  while preserving their expandable action history.
  Execution segments now settle at the first visible assistant output rather than
  the terminal run event, so response streaming time is not counted as working
  time and hidden reasoning does not prematurely end the work phase.
  Active execution segments now expose a duration-aware “Working for…” spine and
  cluster consecutive equivalent default tool activity without discarding trace
  detail or overriding host renderers.
  The entire chat frame now owns transcript scrolling while the inner transcript
  retains its constrained reading measure, so wheel input works from either gutter.
  Activity traces now share a protocol-level semantic taxonomy, render distinct
  icons for searches, reads, edits, commands, checks, MCP calls, connections,
  navigation, delegation, and approvals, and give the run-level work spine its own
  identity instead of presenting every operation as a generic tool.
  Run startup now becomes active before the first streamed event arrives, keeping
  rapid follow-ups in the durable queue instead of launching overlapping runs.
  Transcript following ignores queue-only state churn, follows queue-driven
  viewport resizing, distinguishes programmatic scrolls from deliberate history
  navigation, and avoids redundant scroll writes during sustained streamed
  output.
  Chat shells can now preserve accepted AgentKit runs across thread navigation,
  observe typed per-thread lifecycle state in surrounding chrome, show background
  activity in rails, and surface a newly submitted conversation before durable
  history catches up.
  Host chrome now distinguishes active execution from the pre-response working
  phase, so progress indicators settle when visible assistant output begins while
  queueing and cancellation remain active through the terminal event.
  Core and AgentKit now share one animation-frame-paced streaming primitive with
  adaptive backlog draining, incremental grapheme segmentation, reduced-motion
  support, background-tab catch-up, and stable memoized Markdown blocks, avoiding
  chunk dumps and whole-response reparsing during long answers.
- 210c7d0: Ship AgentKit as one package with subpath exports for the protocol, headless
  client, HTTP transport, conformance harness, and React runtime. The root and
  `/http` entries stay React-free, and an import-graph test fails with the
  offending file and specifier if that regresses.

  Gate capability-dependent UI on descriptors instead of the boolean projection.
  A capability the backend never reported is now `unknown` rather than
  indistinguishable from one it denied, `degraded` renders and surfaces its
  reason, and `unavailable` renders disabled, so a control is never offered that
  the client will reject or hidden when it would have worked.

  Report the four stream integrity failures a host cannot otherwise see —
  sequence gaps, duplicate events, runs that end without a terminal event, and
  queued follow-ups that are never promoted — through `onIntegrityReport`, which
  Agent-Native surfaces wire with `createAgentKitIntegrityReporter(surface)`.

  Remove the aliases that shipped a second way to do the same thing: `resumeRun`,
  `AgentThreadState.activeRunId`, `AgentTransport.getCapabilities`, the `error`
  render slot, and the thread scope's `resume`. Use `resubscribeRun`,
  `activeRunIds`, `discoverCapabilities`, `connectionError`, and `resubscribe`.

  Report `resumableRuns` as unsupported rather than degraded on the Agent-Native
  adapter. Replay is process-local and bounded by `x-run-replay-retention`;
  restart-safe resumption needs a durable event transport the adapter does not
  own.

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [210c7d0]
- Updated dependencies [743039f]
- Updated dependencies [bd3e96e]
- Updated dependencies [b83d472]
- Updated dependencies [875f793]
- Updated dependencies [97564cd]
- Updated dependencies [64e6346]
- Updated dependencies [64e6346]
- Updated dependencies [a30a54d]
- Updated dependencies [587297c]
- Updated dependencies
- Updated dependencies [210c7d0]
- Updated dependencies [7a9238c]
- Updated dependencies [ccad889]
  - @agent-native/toolkit@0.20.0
