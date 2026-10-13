<!--
Parked here, not published. `packages/docs` loads doc content with a flat,
non-recursive glob (`content/*.mdx`, `content/*.md`), so anything under this
`drafts/` subdirectory is never built, rendered, or search-indexed.

Meeting notes and Dictate hands-free are parked whole: both sit behind an
experimental Clips Labs flag (`templates/clips/shared/labs.ts`), off by
default (Meetings) or on by default but still a Labs toggle (Voice
dictation). To restore either, move its section back into
`template-clips-features.mdx` under "## Capture a recording", between
Import from Loom and Find anything across your library.

The third block below is only the *manual* click-and-drag editor's setup
paragraph and Steps (also Labs-gated, `clips.video-editing`). The rest of
Non-destructive editing, trim/split/remove-silences/remove-filler-words/
combine-clips, none of which are actually gated (no Labs check in any of
those action files), already lives in `template-clips-features.mdx` as its
own "## Non-destructive editing" section between Transcription and AI
metadata and Organizations and teams. To restore manual editing, append
this block's paragraph and Steps to the end of that live section instead of
replacing it.
-->

### Meeting notes

Clips can also take notes during a meeting on your calendar, turning the conversation into a transcript, a summary, and action items automatically.

This is an experimental Labs feature, off by default. Labs features are new and can still have bugs, and turning one on is how your feedback helps shape whether it becomes a permanent part of Clips.

<Steps>

### Open Labs in Settings

Open your account menu at the bottom of the sidebar, choose **Organization settings**, then open the **Labs** tab.

### Turn on Meetings and transcription

Toggle it on. **Meetings** in the sidebar now opens your meeting list instead of sending you back to this toggle.

</Steps>

Clips records a meeting the way Granola does, not the way a bot-based notetaker does. Instead of a separate bot joining the call, the Clips desktop app captures your own microphone and your machine's system audio (whatever the other participants are saying through your speakers) while you're already in the call yourself. That means it works with any video platform you join from your machine, Zoom, Google Meet, Microsoft Teams, or Webex, since capture only depends on audio, not which app is running it.

Connect Google Calendar so upcoming meetings show up in the sidebar with a reminder before each one starts.

<Steps>

### Connect your calendar

From the same **Organization settings**, connect Google Calendar.

### Start notes

Open Clips Desktop from the menu bar and choose **Start Meeting Notes**, or click **Start notes** when the reminder appears shortly before a scheduled meeting. A meeting with no calendar event works too, from **Record → Start notes**.

### Review the result

You get a live transcript plus an AI summary, bullet notes, and action items the moment the meeting ends.

</Steps>

<Video
  src="https://cdn.builder.io/o/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fde5c8ba437d0464189ba052482256fc1?alt=media&token=4a3e182a-8c3f-408a-a309-651a71c78cb8&apiKey=YJIGb4i01jvw0SRdL5Bt"
  alt="Enable the meetings feature in Clips."
  caption="Enable the meetings feature in Clips."
  autoplay={true}
  loop={true}
/>

Turning on automatic capture in Settings starts a recording without you clicking anything, either shortly before a calendar meeting's start time or shortly after Clips notices Zoom, Meet, or Teams become your active app with live audio. Turn it off if you'd rather always start notes yourself.

Two things worth knowing before you rely on this:

- **It needs the desktop app.** Recording a meeting is a desktop capture, using the same Screen Recording permission covered under [Desktop tray app](#desktop-tray-app). The web app can show and edit meeting notes, but it can't start the recording itself.
- **Per-attendee action items need both audio streams.** Clips tags each transcript segment by source, your microphone or your system audio. If system audio isn't captured, remote attendees come through silent in the transcript, so action items can't be attributed to them individually.

### Dictate hands-free

Hold Fn on your machine, speak, and the cleaned-up text drops into whatever app you're using. Every dictation is kept in a searchable history with the original and the AI-cleaned version side by side. Ask the agent to fix a mis-transcribed word or turn a ramble into bullet points, and the transcript updates live.

Voice dictation is also a Labs toggle, but it ships on by default. If **Dictate** is missing from the sidebar, check **Voice dictation** under the **Labs** tab in Organization settings.

## Manual click-and-drag editor (append to the end of the live "Non-destructive editing" section)

Prefer dragging a timeline yourself instead of asking for a trim? A visual, click-and-drag editor is also available. It's an experimental Labs feature, off by default.

<Steps>

### Open Labs in Settings

Open your account menu at the bottom of the sidebar, choose **Organization settings**, then open the **Labs** tab.

### Turn on Video editing

Toggle it on. An **Edit** option now appears in a recording's options menu.

</Steps>

Once it's on, drag the trim handles directly on the timeline, or use the toolbar's **Cut selection**, **Cut before playhead**, or **Cut after playhead**. Choose **Split at playhead** from the toolbar's Edit menu, or press **S**, to split the recording at the current position.
