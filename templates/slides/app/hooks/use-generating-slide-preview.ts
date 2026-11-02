import {
  DRAFT_FINISH_MS,
  isJsonStringComplete,
  readJsonPath,
  useStreamingToolInputs,
  type PartialJson,
} from "@agent-native/core/client/generation-stream";
import { useEffect, useState } from "react";

/**
 * How long a finished slide stays in the preview after its call lands, so the
 * last content streamed into it finishes drafting before the saved slide
 * replaces it.
 */
export const GENERATED_SLIDE_SETTLE_MS = DRAFT_FINISH_MS;

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
  /** Slides the agent is writing, in deck order, as they stream in. */
  slides: GeneratingSlidePreviewContent[];
  /** These slides replace the whole deck (a `create-deck` call). */
  replacesDeck: boolean;
  /**
   * The first call behind `slides`, known as soon as it parses, before any
   * of its slides has content or lands.
   */
  callKey: string | null;
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
 * far. Each slide shows as soon as its content starts streaming, and a
 * call's slides stay until it has landed and their last content has drafted.
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
  let nextAbandoned = abandoned;
  if (wasGenerating !== generating) {
    setWasGenerating(generating);
    const cutOff = keyed.filter((call) => call.status === "streaming");
    if (!generating && cutOff.length > 0) {
      nextAbandoned = new Set([
        ...nextAbandoned,
        ...cutOff.map((call) => call.callKey),
      ]);
    }
  }
  // Calls the stream hook has evicted take their abandoned mark with them.
  const liveCallKeys = new Set(keyed.map((call) => call.callKey));
  if ([...nextAbandoned].some((key) => !liveCallKeys.has(key))) {
    nextAbandoned = new Set(
      [...nextAbandoned].filter((key) => liveCallKeys.has(key)),
    );
  }
  if (nextAbandoned !== abandoned) setAbandoned(nextAbandoned);

  // When each call landed; a landed call stays while its last content drafts.
  const [landedAt, setLandedAt] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const [now, setNow] = useState(() => performance.now());
  const landedKey = keyed
    .map((call) => `${call.status === "streaming" ? "" : "!"}${call.callKey}`)
    .join("\n");
  useEffect(() => {
    const at = performance.now();
    setNow(at);
    setLandedAt((current) => {
      let next: Map<string, number> | null = null;
      const live = new Set<string>();
      for (const line of landedKey ? landedKey.split("\n") : []) {
        const landed = line.startsWith("!");
        const key = landed ? line.slice(1) : line;
        live.add(key);
        if (landed && !current.has(key)) {
          next ??= new Map(current);
          next.set(key, at);
        }
      }
      // Calls the stream hook retired take their landing time with them.
      for (const key of (next ?? current).keys()) {
        if (live.has(key)) continue;
        next ??= new Map(current);
        next.delete(key);
      }
      return next ?? current;
    });
  }, [landedKey]);

  const finishedAt = keyed.map((call) => {
    if (abandoned.has(call.callKey)) return Number.NEGATIVE_INFINITY;
    const landed = landedAt.get(call.callKey);
    if (landed === undefined) return null;
    return (
      landed +
      (call.status === "failed"
        ? FAILED_SLIDE_HOLD_MS
        : GENERATED_SLIDE_SETTLE_MS)
    );
  });
  const firstActive = finishedAt.findIndex(
    (finished) => finished === null || finished > now,
  );

  const wakeAt = finishedAt.reduce<number | null>(
    (soonest, finished) =>
      finished !== null && finished > now
        ? soonest === null
          ? finished
          : Math.min(soonest, finished)
        : soonest,
    null,
  );
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
    call.slides.map(({ key, content }) => ({
      key,
      content,
      failed: call.status === "failed",
      settling: call.status === "done",
    })),
  );
  return {
    slides,
    replacesDeck: shown.some((call) => call.tool === "create-deck"),
    callKey: shown.at(0)?.callKey ?? null,
  };
}
