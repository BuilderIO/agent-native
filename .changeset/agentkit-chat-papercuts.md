---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Polish the AgentKit chat experience:

- Composer buttons keep their styles (stop, send hover, voice recording, attachment thumbnails), and composer controls sit on the 24px size ramp.
- The transcript and composer share one centered lane, and jump to latest is visible again.
- Existing threads load behind a skeleton instead of flashing the empty state. A failed load shows a Retry, not a blank new chat.
- Markdown tables scroll instead of overflowing, and server-rendered links hydrate cleanly. Prose cells wrap within the lane at a readable minimum width while short cells stay on one line, so long answers in tables no longer scroll sideways.
- Stop reports a failed cancel and re-enables for the next run.
- Text and icon contrast meets AA in light and dark.
- Fewer console warnings.
- Guided questions show only the caller's options, drop the default description and eyebrow, and show progress in the submit label. Explore and Decide rows are opt-in.
- The page chat header shows one New chat icon button instead of a labelled pill.
- AgentKit's stylesheet is one `@layer components` cascade layer, so host and design-system utilities win over its defaults.
- Every composer variant shares one metric set: 32px send and stop, 14px/20px text (16px on phones), one-line minimum, 12rem maximum, and a focus border mixed from the ring color.
- Stop stays beside Send for the whole run, so typing a follow-up no longer hides it, and Escape in the composer stops the run without touching the draft.
- Approval cards send Cancel and Deny options as a denial; only `kind: "choice"` requests render as a pick-then-submit list, and the three approval cards share one `ApprovalCard`.
- In reply footers, More actions swaps in Feedback, Fork and Copy request ID in place and shows a pressed fill while open, Feedback is one popover with Good response, Bad response and an optional note, and older replies show the footer on hover without reserving space (24px between turns).
- With no model connected, the Connect AI card is the one setup path: it is a single row with inline Use Builder.io and Custom keys buttons, the model chip hides while it is on screen, and the composer stays editable so a draft can be typed before connecting (sending still waits for setup).
- The model picker is a menu with Agent, Model and Effort submenus that open by click or keyboard and stack into one menu on narrow screens, and the harness docs link is a menu item.
- Voice dictation shows its recording state in the mic's own toolbar slot, so the composer no longer grows while recording.
- The chat header row is reserved from the empty state on, with no divider and the title on the transcript lane, so the first send no longer pushes the transcript down; a toolbar with no title floats on its own, and `data-agentkit-chat-header` lets hosts hide it.
- The default empty state shows a visible greeting (the `emptyStateText` label) with starters in the shared suggestion bar, and follow-up chips fade into a fixed single-line row that mounts only while the idle thread has follow-ups.
- Work, tool, task, activity and reasoning disclosures share one summary row (`AgentKitDisclosureSummary`): a fixed icon column, the label, then the chevron, with the whole row as the toggle button.
- Expanded activity lists no longer scroll inside the transcript; they show eight rows and a "Show N more" row.
- Editing a sent message shows an "Editing message" row above the editor with a Cancel button and a tooltip saying the send forks the chat, the source bubble gets a subtle focus tint, and Escape cancels the edit; composers take a new `headerSlot` for rows like this.
- Recoverable failures (lost connection, retryable run errors, failed sends, queue and continue failures, stuck runs, unreadable history or run status) show once, as an amber notice with a dismiss button in a slot just above the composer input; they clear on the next send and on thread change, the duplicate run-failure row under a lost connection is gone, and red is kept for final failures.
- A sent message shows in the transcript as soon as you press Send, before AI readiness, history restore or uploads finish, in every host that sends through `AgentKitComposer` or `useAgentKitControl().sendMessage`. A failed send puts its text, references and attachments back in the draft and shows the error once in the notice slot, and the copy is swapped for the real message by its `clientRequestId` metadata, never by matching text. Composers take a new `onSubmitStart` prop for this.
- Chat tab strips contain only tabs: the close control beside each tab is pointer-only and out of the accessibility tree, and Delete or Backspace on a focused tab (announced through `aria-keyshortcuts`) closes it.
- The model chip's effort label uses the strong muted text color, so it meets 4.5:1 on dark composers.
- The context ring no longer asks for a manifest before a new chat has a message, and a thread the server has not saved reads as `absent` rather than as an error.
- A fresh chat in the agent panel starts on the app's configured default model (the server's current engine first), the same model the home composer starts on, with effort unset so the provider default runs. Core exports `resolveDefaultModelSelection()`, which both pickers use. Explicit choices are still kept per surface.
