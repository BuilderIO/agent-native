import type { AssignedCanvasRegion } from "./canvas-math";

export type DesignGenerationSessionStatus =
  | "planning"
  | "generating"
  | "review"
  | "done"
  | "cancelled";

export type DesignGenerationFrameStatus =
  | "queued"
  | "thinking"
  | "writing"
  | "done"
  | "error";

export type DesignGenerationFrameRole = "screen" | "variant";

export interface DesignGenerationFrame {
  frameId: string;
  filename?: string;
  agentId: string;
  agentName: string;
  agentColor: string;
  region: AssignedCanvasRegion;
  role: DesignGenerationFrameRole;
  variantOf?: string;
  status: DesignGenerationFrameStatus;
  step?: string;
  progress?: number;
}

export interface DesignGenerationSession {
  id: string;
  designId: string;
  status: DesignGenerationSessionStatus;
  designSystemId?: string;
  prompt: string;
  contextRefs: string[];
  frames: DesignGenerationFrame[];
  startedAt: string;
}

export interface AgentCanvasPresence {
  kind: "agent";
  agentId: string;
  name: string;
  color: string;
  frameId: string;
  cursor: { x: number; y: number };
  status: DesignGenerationFrameStatus;
  step?: string;
  progress?: number;
}

export function designGenerationSessionKey(designId: string): string {
  return `design-generation-session:${designId}`;
}

export function clampGenerationProgress(progress: number | undefined): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress ?? 0));
}

export function updateGenerationSessionWithSavedFiles(
  session: DesignGenerationSession,
  savedFilenames: Iterable<string>,
): DesignGenerationSession {
  const saved = new Set(
    Array.from(savedFilenames).filter(
      (filename): filename is string =>
        typeof filename === "string" && !!filename,
    ),
  );
  if (saved.size === 0) return session;

  let changed = false;
  const frames = session.frames.map((frame) => {
    if (
      !frame.filename ||
      !saved.has(frame.filename) ||
      frame.status === "done"
    ) {
      return frame;
    }
    changed = true;
    return {
      ...frame,
      status: "done" as const,
      step: "Saved",
      progress: 1,
    };
  });

  if (!changed) return session;

  return {
    ...session,
    status: frames.every((frame) => frame.status === "done")
      ? "done"
      : "generating",
    frames,
  };
}
