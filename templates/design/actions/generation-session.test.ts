import { describe, expect, it } from "vitest";

import {
  updateGenerationSessionWithSavedFiles,
  type DesignGenerationSession,
} from "../shared/generation-session.js";

function makeSession(): DesignGenerationSession {
  return {
    id: "session_123",
    designId: "design_123",
    status: "planning",
    prompt: "Generate checkout screens",
    contextRefs: [],
    frames: [
      {
        frameId: "frame_1",
        filename: "index.html",
        agentId: "agent_1",
        agentName: "Atlas",
        agentColor: "red",
        region: { x: 0, y: 0, width: 1200, height: 800 },
        role: "screen",
        status: "queued",
        progress: 0,
      },
      {
        frameId: "frame_2",
        filename: "details.html",
        agentId: "agent_2",
        agentName: "Nova",
        agentColor: "blue",
        region: { x: 1240, y: 0, width: 1200, height: 800 },
        role: "screen",
        status: "queued",
        progress: 0,
      },
    ],
  };
}

describe("updateGenerationSessionWithSavedFiles", () => {
  it("ignores saves that do not correspond to tracked generation frames", () => {
    const session = makeSession();

    expect(updateGenerationSessionWithSavedFiles(session, ["styles.css"])).toBe(
      session,
    );
  });

  it("marks matching frames done and keeps the finished session visible", () => {
    const session = makeSession();

    const partial = updateGenerationSessionWithSavedFiles(session, [
      "index.html",
    ]);
    expect(partial.status).toBe("generating");
    expect(partial.frames[0]).toMatchObject({
      status: "done",
      step: "Saved",
      progress: 1,
    });
    expect(partial.frames[1]?.status).toBe("queued");

    const finished = updateGenerationSessionWithSavedFiles(partial, [
      "details.html",
    ]);
    expect(finished.status).toBe("done");
    expect(finished.frames.every((frame) => frame.status === "done")).toBe(
      true,
    );
  });
});
