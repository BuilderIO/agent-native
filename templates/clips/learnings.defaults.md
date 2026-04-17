# Learnings

<!-- This file is Clips' memory. The agent reads it at the start of every conversation and updates it when it learns something new. -->
<!-- Your personal learnings.md is gitignored so preferences and private info stay local. -->
<!-- This defaults file is what new checkouts start with. -->

## Recording defaults

- New recordings default to **private** visibility unless the user asks otherwise.
- Default playback speed for viewers is **1.2x** (creator can override per video).
- Animated GIF thumbnails are enabled by default on new recordings — the first few seconds play as a hover preview.

## AI conventions

- Auto-generated titles and summaries are drafted from the transcript. Always offer the user a chance to edit before publishing.
- When a user shares a recording without a title, run `regenerate-title` on their behalf.
- Filler-word removal uses the "conservative" preset by default (only um / uh / ah) — escalate to "aggressive" (rambles, repeats) only if the user asks.

## View-counting rule

- A view counts only when the viewer watches **≥ 5 seconds**, OR **≥ 75%** of the video, OR **scrubs to the end**. Creators' own views don't count.
