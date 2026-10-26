/**
 * Chunk timelines for the streaming replay harness. A timeline is the text a
 * reply streams, cut into the chunks the client receives, each with the time
 * (ms after the run starts) it arrives.
 */

export interface ReplayChunk {
  at: number;
  text: string;
}

export interface ReplayTimeline {
  name: string;
  prompt: string;
  chunks: ReplayChunk[];
  /** When the run completes, after the last chunk. */
  doneAt: number;
}

export type SyntheticTimelineKind =
  | "steady"
  | "bursty"
  | "very-fast"
  | "stall-flood";

/** Same server poll the SQL run subscription uses while a run is active. */
export const SERVER_POLL_MS = 125;

export const SAMPLE_MARKDOWN = `## How the pieces fit

Streaming feels smooth when the reveal keeps a steady pace. The model sends tokens in bursts, the server batches them on a poll, and the browser paints whenever a frame is ready. Each layer adds its own rhythm, so the reader sees the sum of all three.

- **Model pace** varies with load, prompt length, and the size of the reply.
- **Server batching** groups everything that arrived during one poll.
- **Frame timing** decides when a revealed word actually reaches the screen.

| Layer | Typical rhythm | What it looks like | Fix |
| --- | --- | --- | --- |
| Model | 40 to 200 words per second | Fast replies race ahead | Follow the measured rate |
| Server poll | Every 125 ms or so | Words land in clumps | Spread each clump over time |
| Browser frame | Every 16 ms | Several words in one frame | Cap words per frame |
| Scroll | Once per wrapped line | The transcript hops up | Glide to the new bottom |

A small example of a pacer step:

\`\`\`ts
function step(now: number): number {
  const elapsed = Math.min(100, now - lastTime);
  lastTime = now;
  carry += (rate * elapsed) / 1000;
  const count = Math.min(maxPerFrame, Math.floor(carry));
  carry -= count;
  return count;
}
\`\`\`

1. Measure how fast text arrives over the last second.
2. Reveal at that rate, plus a little extra when the backlog grows.
3. Ease every change, so the pace never steps.

That is the whole idea. The rest is tuning: how much lag to keep, how quickly to react, and how to finish promptly once the model is done. A reader should never notice the machinery, only that the words arrive the way a person would say them.
`;

/** Deterministic jitter so runs are comparable. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Splits text into model tokens: words with their leading whitespace. */
export function tokenize(text: string): string[] {
  return text.match(/\s*\S+|\s+$/g) ?? [];
}

/** Spaces tokens at `wordsPerSecond`, starting at `startAt`. */
function emitAtRate(
  tokens: readonly string[],
  wordsPerSecond: number,
  startAt: number,
): ReplayChunk[] {
  return tokens.map((text, index) => ({
    at: startAt + (index * 1000) / wordsPerSecond,
    text,
  }));
}

/** Groups chunks into the deliveries a server poll of `pollMs` produces. */
export function quantizeToPolls(
  chunks: readonly ReplayChunk[],
  pollMs: number,
  jitterMs: number,
  seed = 7,
): ReplayChunk[] {
  const random = seededRandom(seed);
  const delivered: ReplayChunk[] = [];
  let pollAt = 0;
  let index = 0;
  while (index < chunks.length) {
    pollAt += pollMs + random() * jitterMs;
    let text = "";
    for (
      let chunk = chunks.at(index);
      chunk && chunk.at <= pollAt;
      chunk = chunks.at(index)
    ) {
      text += chunk.text;
      index += 1;
    }
    if (text) delivered.push({ at: Math.round(pollAt), text });
  }
  return delivered;
}

function lastArrival(chunks: readonly ReplayChunk[], name: string): number {
  const last = chunks.at(-1);
  if (!last) throw new Error(`Timeline ${name} has no chunks.`);
  return last.at;
}

export function syntheticTimeline(
  kind: SyntheticTimelineKind,
  text = SAMPLE_MARKDOWN,
): ReplayTimeline {
  const tokens = tokenize(text);
  let chunks: ReplayChunk[];
  switch (kind) {
    case "steady":
      chunks = emitAtRate(tokens, 45, 300);
      break;
    case "bursty":
      chunks = quantizeToPolls(emitAtRate(tokens, 90, 300), SERVER_POLL_MS, 60);
      break;
    case "very-fast":
      chunks = quantizeToPolls(
        emitAtRate(tokens, 250, 300),
        SERVER_POLL_MS,
        60,
      );
      break;
    case "stall-flood": {
      const head = tokens.slice(0, 90);
      const flood = tokens.slice(90, 240);
      const tail = tokens.slice(240);
      const headChunks = emitAtRate(head, 60, 300);
      const floodAt = lastArrival(headChunks, kind) + 2_500;
      chunks = [
        ...quantizeToPolls(headChunks, SERVER_POLL_MS, 60),
        { at: floodAt, text: flood.join("") },
        ...quantizeToPolls(
          emitAtRate(tail, 60, floodAt + 100),
          SERVER_POLL_MS,
          60,
        ).filter((chunk) => chunk.at > floodAt),
      ];
      break;
    }
  }
  return {
    name: kind,
    prompt: `Synthetic ${kind} stream`,
    chunks,
    doneAt: lastArrival(chunks, kind) + 40,
  };
}

interface PersistedEvent {
  sequence: number;
  occurredAt: string;
  runId: string;
  type: string;
  payload?: { sourceType?: string; lastSequence?: number };
}

interface RawRunEvent {
  type: string;
  text?: string;
  seq: number;
}

/**
 * Rebuilds a run's arrival timeline from what the dev database keeps: the raw
 * text deltas (from the run's event replay) and the persisted omission ranges,
 * which record when each block of 256 deltas started. Deltas are spread
 * evenly inside each range, then grouped by the server poll.
 */
export function recordedTimeline({
  name,
  prompt,
  persistedEvents,
  rawEvents,
  runId,
  pollMs = SERVER_POLL_MS,
  pollJitterMs = 60,
}: {
  name: string;
  prompt: string;
  persistedEvents: readonly PersistedEvent[];
  rawEvents: readonly RawRunEvent[];
  runId: string;
  pollMs?: number;
  pollJitterMs?: number;
}): ReplayTimeline {
  const runEvents = persistedEvents.filter((event) => event.runId === runId);
  const started = runEvents.find((event) => event.type === "run.started");
  const completed = runEvents.find(
    (event) => event.type === "message.completed",
  );
  const ranges = runEvents.filter(
    (event) =>
      event.type === "x-agent-native.persisted-event-omission-range" &&
      event.payload?.sourceType === "message.delta",
  );
  if (!started || !completed) {
    throw new Error(`Run ${runId} has no recorded text delta ranges.`);
  }
  const origin = Date.parse(started.occurredAt);
  const anchors = ranges.map((range) => {
    const last = range.payload?.lastSequence;
    if (last === undefined) {
      throw new Error(`Run ${runId} has a delta range with no last sequence.`);
    }
    return {
      first: range.sequence,
      last,
      at: Date.parse(range.occurredAt) - origin,
    };
  });
  const firstAnchor = anchors.at(0);
  const lastAnchor = anchors.at(-1);
  if (!firstAnchor || !lastAnchor) {
    throw new Error(`Run ${runId} has no recorded text delta ranges.`);
  }
  const endAt = Date.parse(completed.occurredAt) - origin;
  const firstSequence = firstAnchor.first;
  const lastSequence = lastAnchor.last;
  const texts = rawEvents.filter(
    (event): event is RawRunEvent & { text: string } =>
      event.type === "text" && typeof event.text === "string",
  );

  // Raw and persisted sequences count different events, so a raw delta is
  // placed by its share of the text deltas.
  const timeAtSequence = (sequence: number): number => {
    for (const [index, anchor] of anchors.entries()) {
      if (sequence > anchor.last) continue;
      const nextAt = anchors.at(index + 1)?.at ?? endAt;
      const progress =
        (sequence - anchor.first) / (anchor.last - anchor.first + 1);
      return anchor.at + progress * (nextAt - anchor.at);
    }
    return endAt;
  };
  const placed = texts.map((event, index) => ({
    at: timeAtSequence(
      firstSequence +
        (index / texts.length) * (lastSequence - firstSequence + 1),
    ),
    text: event.text,
  }));
  const firstPlaced = placed.at(0);
  if (!firstPlaced) throw new Error(`Run ${runId} has no text deltas.`);
  // Reasoning and tools run before the text; the replay starts just before it.
  const shift = firstPlaced.at - 300;
  const model = placed.map((chunk) => ({ ...chunk, at: chunk.at - shift }));
  const chunks = quantizeToPolls(model, pollMs, pollJitterMs);
  return {
    name,
    prompt,
    chunks,
    doneAt: Math.max(endAt - shift, lastArrival(chunks, name) + 40),
  };
}

export function timelineText(timeline: ReplayTimeline): string {
  return timeline.chunks.map((chunk) => chunk.text).join("");
}
