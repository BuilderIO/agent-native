import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCapture: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/brain.js", () => ({
  BrainCaptureBlockedError: class BrainCaptureBlockedError extends Error {},
  createCapture: mocks.createCapture,
  ensureManualSource: vi.fn(),
  serializeCapture: (capture: unknown) => capture,
  serializeSource: (source: unknown) => source,
}));

import action from "./import-transcript.js";

const baseArgs = {
  sourceId: "source-1",
  title: "Planning meeting",
  transcript: "Decision: ship the beta.",
  participants: [],
  tags: [],
  enqueueDistillation: false,
};

describe("import-transcript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createCapture.mockResolvedValue({ id: "capture-1" });
  });

  it("makes the authenticated importer the meeting audience when participants are omitted", async () => {
    mocks.getRequestUserEmail.mockReturnValue(" Importer@Example.Test ");

    await action.run(baseArgs);

    expect(mocks.createCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: expect.objectContaining({
          kind: "meeting",
          memberEmails: ["importer@example.test"],
        }),
        metadata: expect.objectContaining({
          participants: ["importer@example.test"],
        }),
      }),
    );
  });

  it("keeps an explicit participant ACL unchanged", async () => {
    mocks.getRequestUserEmail.mockReturnValue("importer@example.test");

    await action.run({ ...baseArgs, participants: ["attendee@example.test"] });

    expect(mocks.createCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: expect.objectContaining({
          memberEmails: ["attendee@example.test"],
        }),
      }),
    );
  });

  it("rejects an empty participant ACL without an authenticated importer", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);

    await expect(action.run(baseArgs)).rejects.toThrow(
      "requires an authenticated importer",
    );
    expect(mocks.createCapture).not.toHaveBeenCalled();
  });
});
