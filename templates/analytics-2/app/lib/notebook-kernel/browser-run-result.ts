import { callAction } from "@agent-native/core/client/hooks";

import type admitBrowserNotebookRun from "../../../actions/admit-browser-notebook-run";
import type completeBrowserNotebookRun from "../../../actions/complete-browser-notebook-run";
import type { KernelEvent } from "../../../shared/kernel-contract";
import type { Snapshot } from "../../../shared/notebook-execution";
import type { LocalArtifact } from "./offline-kernel";

type BrowserAdmission = Awaited<ReturnType<typeof admitBrowserNotebookRun.run>>;
type BrowserCompletion = Awaited<
  ReturnType<typeof completeBrowserNotebookRun.run>
>;
type Event = KernelEvent["event"];
const arrowType = "application/vnd.apache.arrow.stream";
const jsonType = "application/json";
type BrowserResultEvents = Parameters<
  typeof completeBrowserNotebookRun.run
>[0]["events"];

function base64(bytes: Uint8Array) {
  let decoded = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    decoded += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(decoded);
}

function textArtifact(artifact: LocalArtifact) {
  const text = new TextDecoder().decode(artifact.bytes);
  if (artifact.format === "text") return { "text/plain": text };
  const value: unknown = JSON.parse(text);
  return {
    "text/plain": text,
    ...(typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
      ? { value }
      : {}),
  };
}

export async function startBrowserRunResult(
  snapshot: Snapshot,
  cellId: string,
  signal: AbortSignal,
) {
  const admitted = await callAction<BrowserAdmission>(
    "admit-browser-notebook-run",
    { snapshot, requestId: crypto.randomUUID(), cellId },
    { uiOnly: true, keepalive: false },
  );
  if (admitted.status !== "admitted")
    throw new Error("Browser run was not admitted");
  const events: BrowserResultEvents = [];
  return {
    runId: admitted.runId,
    outputGeneration: admitted.outputGeneration,
    async complete(complete: boolean) {
      signal.throwIfAborted();
      return callAction<BrowserCompletion>(
        "complete-browser-notebook-run",
        {
          runId: admitted.runId,
          attemptId: admitted.attemptId,
          outcome: complete ? "complete" : "failed",
          events,
        },
        { uiOnly: true, keepalive: false, signal },
      );
    },
    receive(event: Event, artifact?: LocalArtifact) {
      if (event.type === "stream" || event.type === "error") {
        const previous = events.at(-1);
        if (
          event.type === "stream" &&
          previous?.type === "stream" &&
          previous.channel === event.channel &&
          previous.text.length + event.text.length <= 262_144
        ) {
          previous.text += event.text;
        } else {
          events.push({ ...event });
        }
      } else if (
        (event.type === "display" || event.type === "result") &&
        artifact
      ) {
        const arrow = artifact.format === "arrow";
        const bytes =
          arrow || artifact.metadata
            ? artifact.bytes
            : new TextEncoder().encode(JSON.stringify(textArtifact(artifact)));
        events.push({
          type: event.type,
          contentType: arrow ? arrowType : jsonType,
          data: base64(bytes),
        });
      }
    },
  };
}
