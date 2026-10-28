import { useEffect, useRef, useState } from "react";

import { parsePartialJson, type PartialJson } from "./partial-json.js";
import {
  TOOL_DONE_EVENT,
  TOOL_INPUT_EVENT,
  type ToolDoneEventDetail,
  type ToolInputEventDetail,
} from "./tool-input-events.js";

/**
 * `streaming`: arguments are still arriving. `done`: the tool finished and
 * its real output is on its way to the UI. `failed`: the tool errored, so the
 * preview is not a result and must not be presented as one.
 */
export type StreamingToolInputStatus = "streaming" | "done" | "failed";

export interface StreamingToolInput<T> {
  callId: string | null;
  /** Stable for the call's lifetime, including calls that stream without an id. */
  key: string;
  tool: string;
  status: StreamingToolInputStatus;
  value: T;
}

export interface UseStreamingToolInputOptions<T> {
  /** Tool names to follow. */
  tools: readonly string[];
  enabled: boolean;
  /**
   * What the preview belongs to, such as a deck id plus its slide count.
   * Changing it drops the preview and ignores calls that started before.
   */
  scope: string;
  /**
   * Whether a call is for this scope: `true`, `false`, or `undefined` while
   * the deciding argument is still streaming. A `false` call is ignored to
   * the end.
   */
  matches?: (input: PartialJson, tool: string) => boolean | undefined;
  /** The preview value from the arguments so far, or `null` for nothing yet. */
  select: (input: PartialJson, tool: string) => T | null;
}

const REJECTED = "\u0000rejected";

interface ActiveCall {
  id: string | null;
  key: string;
  tool: string;
  argsText: string;
  status: StreamingToolInputStatus;
  /** The parse of `argsText` is stale. */
  dirty: boolean;
  value: unknown;
}

/**
 * Follows the agent's tool arguments as they stream, for previewing what a
 * tool is about to write. Parsing runs at most once per animation frame.
 * Follows the newest call; see `useStreamingToolInputs` for every call.
 */
export function useStreamingToolInput<T>(
  options: UseStreamingToolInputOptions<T>,
): StreamingToolInput<T> | null {
  return useStreamingToolInputs(options).at(-1) ?? null;
}

const NO_INPUTS: never[] = [];

/**
 * Finished calls kept for consumers still showing them (a settle or failure
 * hold). Older ones are dropped with their arguments, so a long session does
 * not hold every payload it ever previewed.
 */
const MAX_FINISHED_CALLS = 8;

/**
 * Calls tracked at once, finished or not. A run that is stopped or loses its
 * connection leaves its call streaming forever; this keeps those bounded.
 */
const MAX_TRACKED_CALLS = 32;

/**
 * Call ids remembered for their scope, so a late event for a call from an
 * earlier scope or another target is still ignored. Bounded, oldest first.
 */
const MAX_REMEMBERED_CALL_IDS = 256;

/**
 * Every call in the scope, in the order the agent started them, so a model
 * that writes several items in one response previews each one.
 */
export function useStreamingToolInputs<T>(
  options: UseStreamingToolInputOptions<T>,
): StreamingToolInput<T>[] {
  const { enabled, scope } = options;
  const toolsKey = options.tools.join("\n");
  const [preview, setPreview] = useState<{
    scope: string;
    inputs: StreamingToolInput<T>[];
  } | null>(null);
  const callbacksRef = useRef(options);
  callbacksRef.current = options;
  // The scope each call first arrived in. A call never moves to another
  // scope, so a preview can't leak into the deck or screen opened after it.
  const callScopesRef = useRef(new Map<string, string>());

  useEffect(() => {
    setPreview(null);
    if (!enabled) return;
    const tools = new Set(toolsKey.split("\n"));
    const callScopes = callScopesRef.current;
    const calls: ActiveCall[] = [];
    let frame: number | null = null;
    let disposed = false;

    const flush = () => {
      frame = null;
      if (disposed) return;
      const { matches, select } = callbacksRef.current;
      const inputs: StreamingToolInput<T>[] = [];
      for (const call of [...calls]) {
        if (call.dirty) {
          call.dirty = false;
          const input = parsePartialJson(call.argsText);
          const match = matches ? matches(input, call.tool) : true;
          if (match === false) {
            if (call.id) rememberScope(call.id, REJECTED);
            calls.splice(calls.indexOf(call), 1);
            continue;
          }
          if (match !== undefined) call.value = select(input, call.tool);
        }
        if (call.value === null) continue;
        inputs.push({
          callId: call.id,
          key: call.key,
          tool: call.tool,
          status: call.status,
          value: call.value as T,
        });
      }
      setPreview({ scope, inputs });
    };

    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(flush);
    };

    const rememberScope = (id: string, value: string) => {
      callScopes.set(id, value);
      if (callScopes.size <= MAX_REMEMBERED_CALL_IDS) return;
      const oldest = callScopes.keys().next();
      if (!oldest.done) callScopes.delete(oldest.value);
    };
    let anonymousCalls = 0;

    const onToolInput = (event: Event) => {
      const detail = (event as CustomEvent<ToolInputEventDetail | null>).detail;
      if (!detail?.tool || !tools.has(detail.tool)) return;
      const tool = detail.tool;
      const id = detail.id ?? null;
      if (id) {
        const callScope = callScopes.get(id);
        if (callScope !== undefined && callScope !== scope) return;
        rememberScope(id, scope);
      }
      // An id-less delta continues the last call only while that call is
      // still streaming the same tool; after it finishes, a new one starts.
      const last = calls.at(-1);
      let call =
        id === null
          ? detail.phase !== "start" &&
            last?.id === null &&
            last.status === "streaming" &&
            last.tool === tool
            ? last
            : undefined
          : calls.find((candidate) => candidate.id === id);
      if (!call) {
        call = {
          id,
          key: id ?? `\u0000call-${++anonymousCalls}`,
          tool,
          argsText: "",
          status: "streaming",
          dirty: true,
          value: null,
        };
        calls.push(call);
        if (calls.length > MAX_TRACKED_CALLS) calls.shift();
      }
      // A sender that tracks the call passes the arguments so far; one that
      // does not (a repeated id-less call) passes only this delta's text.
      if (typeof detail.argsText === "string") {
        call.argsText = detail.argsText;
        call.dirty = true;
      } else if (typeof detail.text === "string" && detail.text) {
        call.argsText += detail.text;
        call.dirty = true;
      }
      schedule();
    };

    const onToolDone = (event: Event) => {
      const detail = (event as CustomEvent<ToolDoneEventDetail | null>).detail;
      if (!detail) return;
      // Calls run in the order the agent wrote them. A finished call whose id
      // never streamed is one whose input arrived without an id, so it is the
      // oldest call of that tool still streaming. An id that streamed into
      // another scope or was rejected is not this scope's call.
      const doneId = detail.toolCallId ?? detail.eventId;
      const byId = doneId
        ? calls.find((candidate) => candidate.id === doneId)
        : undefined;
      const unseen = !doneId || !callScopes.has(doneId);
      const call =
        byId ??
        (unseen
          ? calls.find(
              (candidate) =>
                candidate.tool === detail.tool &&
                candidate.status === "streaming",
            )
          : undefined);
      if (!call || call.tool !== detail.tool) return;
      call.status = detail.isError ? "failed" : "done";
      const finished = calls.filter(
        (candidate) => candidate.status !== "streaming",
      );
      for (const stale of finished.slice(0, -MAX_FINISHED_CALLS)) {
        calls.splice(calls.indexOf(stale), 1);
      }
      schedule();
    };

    window.addEventListener(TOOL_INPUT_EVENT, onToolInput);
    window.addEventListener(TOOL_DONE_EVENT, onToolDone);
    return () => {
      disposed = true;
      window.removeEventListener(TOOL_INPUT_EVENT, onToolInput);
      window.removeEventListener(TOOL_DONE_EVENT, onToolDone);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [enabled, scope, toolsKey]);

  if (!enabled || preview?.scope !== scope) return NO_INPUTS;
  return preview.inputs;
}
