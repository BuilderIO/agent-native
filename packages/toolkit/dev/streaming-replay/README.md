# Streaming replay harness

Replays a reply stream through the real AgentKit chat (the transcript
scroller plus the chat template's Markdown renderer) and measures every
painted frame. No model runs and nothing leaves the page. It is dev-only: it
lives outside `src/`, is not in the package's published files, throws outside
a Vite dev build, and adds no route.

## Run it

With a chat app dev server running (default origin `http://localhost:3440`):

```sh
cd packages/toolkit
pnpm exec tsx dev/streaming-replay/run.ts \
  --thread <thread id> --run <run id> \
  --screenshot ../../.tmp/streaming/shots \
  --out ../../.tmp/streaming/results.json
```

`run.ts` drives headless Chromium, signs in with "Continue as local dev",
loads the harness onto the chat page (`/@fs/.../harness.tsx`) so it inherits
the page's styles, and runs each timeline on a fresh page. Headless Chromium
keeps a steady 60fps; a hidden or covered browser window throttles animation
frames and makes the numbers meaningless.

Options: `--timelines steady,bursty,very-fast,stall-flood,recorded,history,user-scroll`
(default all), `--reduced-motion`, `--samples` (every frame sample in the
JSON), `--count-code-tokens` (count highlighted code per token span instead of per
word), `--origin`, `--path`.

From a browser console on a dev chat page you can also call it directly:

```js
await import("/@fs/<repo>/packages/toolkit/dev/streaming-replay/harness.tsx");
await streamingReplay.runReplay({
  timeline: streamingReplay.syntheticTimeline("bursty"),
});
```

## Timelines

- `steady`: 45 words/s, one token per chunk.
- `bursty`: 90 words/s, delivered by a 125ms server poll with up to 60ms
  jitter (the SQL run subscription's active poll), as the chat template sees
  it in practice.
- `very-fast`: 250 words/s through the same poll.
- `stall-flood`: 60 words/s, a 2.5s stall, then 150 words at once.
- `recorded`: a stored run from the dev database. Run events are pruned after
  a run completes, so timing comes from the thread's persisted omission ranges
  (when each block of 256 deltas started) with deltas spread evenly inside
  each block, then grouped by the same server poll. The deltas themselves come
  from the run's event replay.
- `history`: opens a thread with long history and checks it lands at the
  bottom at once.
- `user-scroll`: the recorded run, scrolling up 240px at 3s and pressing jump
  to latest at 6s.

## Metrics

Per run: words revealed per frame (max, p95, p99), the longest stall while
received text waits (also excluding stalls after punctuation, and after
punctuation or a new block), pinned scroll movement per frame, frames that
moved half a line or more, how far table column starts move per frame, block
pops (a row, item, heading or code block that got 80% or more of its final
text in one frame), drain time after the run completes, and time to the first
word.
