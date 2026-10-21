export type DesignGenerationOutputStatus =
  | "has_output"
  | "no_output"
  | "unknown";

export interface DesignOutputWriteReceipt {
  changed: boolean;
  verified: true;
  summary: string;
  subject: string;
}

interface PersistedTurnEvent {
  runId: string;
  seq: number;
  event: unknown;
}

type InputDesignId =
  | { status: "readable"; designId?: string }
  | { status: "unreadable" };

export const DESIGN_OUTPUT_ACTIONS = new Set([
  "add-builder-screens",
  "add-localhost-screens",
  "add-session-replay-screenshots-to-board",
  "apply-a11y-fix",
  "apply-component-prop-edit",
  "apply-motion-edit",
  "apply-shader-fill",
  "apply-source-edit",
  "apply-visual-edit",
  "clone-creative-context-design",
  "create-component",
  "create-design-from-template",
  "create-file",
  "create-journey-canvas",
  "delete-file",
  "detach-component-instance",
  "duplicate-design",
  "edit-design",
  "edit-native-shader",
  "fill-figma-paste-image",
  "generate-design",
  "hydrate-figma-paste-images",
  "import-design-source",
  "import-figma-clipboard",
  "import-figma-frame",
  "insert-asset",
  "insert-design-native-asset",
  "insert-figma-library-asset",
  "migrate-board-objects-to-file",
  "present-design-variants",
  "remove-motion-timeline",
  "rename-component",
  "rename-screen",
  "swap-component-instance",
  "update-file",
  "update-screen-source",
]);

export function designOutputWriteReceipt(
  designId: string,
  fileCount: number,
): DesignOutputWriteReceipt {
  return {
    changed: fileCount > 0,
    verified: true,
    summary: `Design output: ${fileCount} files saved.`,
    subject: designId,
  };
}

export function classifyDesignGenerationOutput(options: {
  designId: string;
  runId: string;
  runStatus: string | null;
  runIds: readonly string[];
  events: readonly PersistedTurnEvent[];
}): DesignGenerationOutputStatus {
  const { designId, runId, runStatus, runIds, events } = options;
  if (
    runStatus !== "completed" ||
    !hasCompleteTurnJournal(events, runId, runIds)
  ) {
    return "unknown";
  }

  let unknownOutputEvidence = false;
  for (const { event } of events) {
    if (!isRecord(event) || event.type !== "tool_done") continue;
    const tool = typeof event.tool === "string" ? event.tool : "";
    if (!DESIGN_OUTPUT_ACTIONS.has(tool)) {
      if (event.completedSideEffect === true && tool !== "create-design") {
        const input = inputDesignId(event.input);
        if (
          input.status === "unreadable" ||
          !input.designId ||
          input.designId === designId
        ) {
          unknownOutputEvidence = true;
        }
      }
      continue;
    }

    const input = inputDesignId(event.input);
    if (
      input.status === "readable" &&
      input.designId &&
      input.designId !== designId
    ) {
      continue;
    }
    const receipt = parseDesignOutputReceipt(event.receipt, designId);
    if (receipt) {
      if (receipt.fileCount > 0) return "has_output";
      continue;
    }
    if (input.status === "unreadable") {
      unknownOutputEvidence = true;
      continue;
    }
    if (event.completedSideEffect === false && event.outcomeUnknown !== true) {
      continue;
    }
    unknownOutputEvidence = true;
  }

  for (const start of events) {
    const { event } = start;
    if (!isRecord(event) || event.type !== "tool_start") continue;
    if (typeof event.tool !== "string") {
      unknownOutputEvidence = true;
      continue;
    }
    const input = inputDesignId(event.input);
    if (
      input.status === "readable" &&
      input.designId &&
      input.designId !== designId
    ) {
      continue;
    }
    if (input.status === "unreadable") unknownOutputEvidence = true;
    if (typeof event.id !== "string" || !event.id) {
      unknownOutputEvidence = true;
      continue;
    }
    const matchingDone = events.some(
      (candidate) =>
        candidate.runId === start.runId &&
        isRecord(candidate.event) &&
        candidate.event.type === "tool_done" &&
        candidate.event.tool === event.tool &&
        candidate.event.id === event.id,
    );
    if (!matchingDone) unknownOutputEvidence = true;
  }

  return unknownOutputEvidence ? "unknown" : "no_output";
}

function hasCompleteTurnJournal(
  events: readonly PersistedTurnEvent[],
  finalRunId: string,
  expectedRunIds: readonly string[],
): boolean {
  if (events.length === 0 || expectedRunIds.length === 0) return false;
  const expectedRuns = new Set(expectedRunIds);
  if (expectedRuns.size !== expectedRunIds.length) return false;
  const byRun = new Map<string, PersistedTurnEvent[]>();
  for (const event of events) {
    if (
      !event.runId ||
      !expectedRuns.has(event.runId) ||
      !Number.isSafeInteger(event.seq) ||
      event.seq < 0 ||
      !isRecord(event.event)
    ) {
      return false;
    }
    const runEvents = byRun.get(event.runId) ?? [];
    runEvents.push(event);
    byRun.set(event.runId, runEvents);
  }

  if (expectedRunIds.some((runId) => !runId || !byRun.has(runId))) {
    return false;
  }

  for (const runEvents of byRun.values()) {
    const regular = runEvents
      .filter(({ seq }) => seq < 1_000_000_000)
      .sort((a, b) => a.seq - b.seq);
    if (regular.length === 0 || regular[0]?.seq !== 0) return false;
    if (regular.some((event, index) => event.seq !== index)) return false;
  }

  return (
    byRun.get(finalRunId)?.some(({ event }) => {
      return isRecord(event) && event.type === "done";
    }) === true
  );
}

function parseDesignOutputReceipt(
  value: unknown,
  designId: string,
): { fileCount: number } | null {
  if (
    !isRecord(value) ||
    value.verified !== true ||
    value.subject !== designId ||
    typeof value.summary !== "string"
  ) {
    return null;
  }
  const match = /^Design output: (0|[1-9]\d*) files saved\.$/.exec(
    value.summary,
  );
  if (!match) return null;
  const fileCount = Number(match[1]);
  if (!Number.isSafeInteger(fileCount) || value.changed !== fileCount > 0) {
    return null;
  }
  return { fileCount };
}

function inputDesignId(input: unknown): InputDesignId {
  if (input === undefined) return { status: "readable" };
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      return { status: "unreadable" };
    }
  }
  if (!isRecord(input)) return { status: "unreadable" };
  if (input.designId === undefined) return { status: "readable" };
  return typeof input.designId === "string"
    ? { status: "readable", designId: input.designId }
    : { status: "unreadable" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
