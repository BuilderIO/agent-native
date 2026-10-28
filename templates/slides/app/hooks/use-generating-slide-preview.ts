import {
  isJsonStringComplete,
  readJsonPath,
  useStreamingToolInputs,
  type PartialJson,
} from "@agent-native/core/client/generation-stream";
import { useEffect, useState } from "react";

/**
 * How long a finished slide stays in the preview after its call lands. The
 * gateway delivers a slide in one late burst, so its frames are still drawing
 * when the saved slide arrives.
 */
export const GENERATED_SLIDE_SETTLE_MS = 1600;

/**
 * The gap between slides that arrive together. A whole deck usually lands in
 * one burst; revealing it slide by slide lets each one draw in turn.
 */
export const GENERATED_SLIDE_STAGGER_MS = 900;

/** A failed write stays on screen long enough to read. */
const FAILED_SLIDE_HOLD_MS = 5000;

export interface GeneratingSlidePreviewContent {
  key: string;
  content: string;
  failed: boolean;
  /** The call has landed; the preview is finishing its draft. */
  settling: boolean;
}

export interface GeneratingSlidePreviews {
  /** Slides the agent is writing, in deck order, revealed one at a time. */
  slides: GeneratingSlidePreviewContent[];
  /** These slides replace the whole deck (a `create-deck` call). */
  replacesDeck: boolean;
  /**
   * The first call behind `slides`, known as soon as it parses, before any
   * of its slides is revealed or lands.
   */
  callKey: string | null;
}

interface Timing {
  revealAt: number;
  doneAt: number | null;
}

const NO_PREVIEWS: GeneratingSlidePreviews = {
  slides: [],
  replacesDeck: false,
  callKey: null,
};

function slideContents(input: PartialJson, tool: string): string[] | null {
  if (tool === "add-slide") {
    const content = readJsonPath(input.value, ["content"]);
    return typeof content === "string" && content ? [content] : null;
  }
  const slides = readJsonPath(input.value, ["slides"]);
  if (!Array.isArray(slides)) return null;
  const contents: string[] = [];
  for (const slide of slides) {
    const content = readJsonPath(slide, ["content"]);
    if (typeof content !== "string" || !content) break;
    contents.push(content);
  }
  return contents.length > 0 ? contents : null;
}

/**
 * The slides the agent's `create-deck` and `add-slide` calls have streamed so
 * far. Slides that arrive together are revealed one after another, and a
 * call's slides stay until the last of them has landed and drawn.
 */
export function useGeneratingSlidePreviews({
  deckId,
  generating,
}: {
  deckId: string;
  generating: boolean;
}): GeneratingSlidePreviews {
  // Subscribed while the deck is open, not only while the run is: a slide
  // that lands as the run ends still has its settle (or failure) hold to show.
  const calls = useStreamingToolInputs<string[]>({
    tools: ["create-deck", "add-slide"],
    enabled: !!deckId,
    scope: deckId,
    matches: (input) =>
      isJsonStringComplete(input, ["deckId"])
        ? readJsonPath(input.value, ["deckId"]) === deckId
        : undefined,
    select: slideContents,
  });
  const keyed = calls.map((call) => {
    const callKey = call.key;
    return {
      ...call,
      callKey,
      slides: call.value.map((content, index) => ({
        key: `${callKey}:${index}`,
        content,
      })),
    };
  });

  // A call still streaming when the run ends was cut off, not finished.
  const [abandoned, setAbandoned] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [wasGenerating, setWasGenerating] = useState(generating);
  if (wasGenerating !== generating) {
    setWasGenerating(generating);
    const cutOff = keyed.filter((call) => call.status === "streaming");
    if (!generating && cutOff.length > 0) {
      setAbandoned(
        new Set([...abandoned, ...cutOff.map((call) => call.callKey)]),
      );
    }
  }

  const [timings, setTimings] = useState<ReadonlyMap<string, Timing>>(
    () => new Map(),
  );
  const [now, setNow] = useState(() => performance.now());
  const timingKey = keyed
    .flatMap((call) =>
      call.slides.map(
        ({ key }) => `${call.status === "streaming" ? "" : "!"}${key}`,
      ),
    )
    .join("\n");
  useEffect(() => {
    if (!timingKey) {
      setTimings((current) => (current.size > 0 ? new Map() : current));
      return;
    }
    const at = performance.now();
    setNow(at);
    setTimings((current) => {
      let next: Map<string, Timing> | null = null;
      let previousReveal = Number.NEGATIVE_INFINITY;
      for (const line of timingKey.split("\n")) {
        const landed = line.startsWith("!");
        const key = landed ? line.slice(1) : line;
        const known = current.get(key);
        const revealAt =
          known?.revealAt ??
          Math.max(at, previousReveal + GENERATED_SLIDE_STAGGER_MS);
        const doneAt = known?.doneAt ?? (landed ? at : null);
        if (!known || known.doneAt !== doneAt) {
          next ??= new Map(current);
          next.set(key, { revealAt, doneAt });
        }
        previousReveal = revealAt;
      }
      // Calls the stream hook retired take their timings with them.
      const live = new Set(
        timingKey
          .split("\n")
          .map((line) => (line.startsWith("!") ? line.slice(1) : line)),
      );
      for (const key of (next ?? current).keys()) {
        if (live.has(key)) continue;
        next ??= new Map(current);
        next.delete(key);
      }
      return next ?? current;
    });
  }, [timingKey]);

  // A call is finished once its last slide has landed and drawn.
  const finishedAt = keyed.map((call) => {
    if (abandoned.has(call.callKey)) return Number.NEGATIVE_INFINITY;
    const hold =
      call.status === "failed"
        ? FAILED_SLIDE_HOLD_MS
        : GENERATED_SLIDE_SETTLE_MS;
    let latest: number | null = Number.NEGATIVE_INFINITY;
    for (const { key } of call.slides) {
      const timing = timings.get(key);
      if (!timing || timing.doneAt === null || latest === null) {
        latest = null;
        continue;
      }
      latest = Math.max(latest, timing.revealAt, timing.doneAt);
    }
    return latest === null ? null : latest + hold;
  });
  const firstActive = finishedAt.findIndex(
    (finished) => finished === null || finished > now,
  );

  const wakeAt = keyed.reduce<number | null>((soonest, call, index) => {
    const candidates = [
      ...call.slides.map(({ key }) => timings.get(key)?.revealAt),
      finishedAt[index] ?? undefined,
    ];
    for (const candidate of candidates) {
      if (candidate !== undefined && candidate > now) {
        soonest = soonest === null ? candidate : Math.min(soonest, candidate);
      }
    }
    return soonest;
  }, null);
  useEffect(() => {
    if (wakeAt === null) return;
    const timer = window.setTimeout(
      () => setNow(performance.now()),
      Math.max(0, wakeAt - performance.now()),
    );
    return () => window.clearTimeout(timer);
  }, [wakeAt]);

  if (firstActive === -1) return NO_PREVIEWS;
  const shown = keyed
    .slice(firstActive)
    .filter((call) => !abandoned.has(call.callKey));
  const slides = shown.flatMap((call) =>
    call.slides.flatMap(({ key, content }) => {
      const timing = timings.get(key);
      if (!timing || timing.revealAt > now) return [];
      return [
        {
          key,
          content,
          failed: call.status === "failed",
          settling: call.status === "done",
        },
      ];
    }),
  );
  return {
    slides,
    replacesDeck: shown.some((call) => call.tool === "create-deck"),
    callKey: shown.at(0)?.callKey ?? null,
  };
}
