import type { H3Event } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOrgContext: vi.fn(),
  readBody: vi.fn(),
  recordChange: vi.fn(),
  runWithRequestContext: vi.fn(),
  listSlotsForExtension: vi.fn(),
  addExtensionSlotTarget: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getMethod: (event: { method: string }) => event.method,
  setResponseStatus: (event: { status: number }, status: number) => {
    event.status = status;
  },
}));
vi.mock("../../server/auth.js", () => ({ getSession: mocks.getSession }));
vi.mock("../../org/context.js", () => ({ getOrgContext: mocks.getOrgContext }));
vi.mock("../../server/h3-helpers.js", () => ({ readBody: mocks.readBody }));
vi.mock("../../server/poll.js", () => ({ recordChange: mocks.recordChange }));
vi.mock("../../server/request-context.js", () => ({
  runWithRequestContext: mocks.runWithRequestContext,
}));
vi.mock("./store.js", () => ({
  listSlotsForExtension: mocks.listSlotsForExtension,
  addExtensionSlotTarget: mocks.addExtensionSlotTarget,
  removeExtensionSlotTarget: vi.fn(),
  listExtensionsForSlot: vi.fn(),
  installExtensionSlot: vi.fn(),
  uninstallExtensionSlot: vi.fn(),
  listSlotInstallsForUser: vi.fn(),
}));

import { ForbiddenError } from "../../sharing/errors.js";
import { createSlotsHandler } from "./routes.js";

function event(method = "POST") {
  return {
    method,
    url: new URL("https://app.example.test/extension/fake-extension"),
    status: 200,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession
    .mockReset()
    .mockResolvedValue({ email: "member@example.test", orgId: "fake-org" });
  mocks.getOrgContext.mockReset().mockResolvedValue({ orgId: "fake-org" });
  mocks.runWithRequestContext.mockImplementation(
    (_context: unknown, run: () => unknown) => run(),
  );
  mocks.listSlotsForExtension.mockResolvedValue([{ slotId: "fake-slot" }]);
});

describe("extension-slot session boundary", () => {
  it.each([
    {
      name: "retryable scope failure",
      error: Object.assign(new Error("Session unavailable"), {
        statusCode: 503,
        headers: { "Retry-After": "5" },
        cause: Object.assign(new Error("Fake membership read failure"), {
          code: "42501",
        }),
      }),
    },
    { name: "definitive delegated refusal", error: new ForbiddenError() },
  ])("propagates $name before reading or changing slots", async ({ error }) => {
    mocks.getSession.mockRejectedValue(error);
    const request = event();
    await expect(
      createSlotsHandler()(request as unknown as H3Event),
    ).rejects.toBe(error);
    expect(mocks.getOrgContext).not.toHaveBeenCalled();
    expect(mocks.readBody).not.toHaveBeenCalled();
    expect(mocks.runWithRequestContext).not.toHaveBeenCalled();
    expect(mocks.addExtensionSlotTarget).not.toHaveBeenCalled();
    expect(mocks.recordChange).not.toHaveBeenCalled();
  });

  it("returns the existing 401 only for a genuinely missing session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const request = event();
    await expect(
      createSlotsHandler()(request as unknown as H3Event),
    ).resolves.toEqual({ error: "Authentication required" });
    expect(request.status).toBe(401);
    expect(mocks.getOrgContext).not.toHaveBeenCalled();
    expect(mocks.readBody).not.toHaveBeenCalled();
    expect(mocks.addExtensionSlotTarget).not.toHaveBeenCalled();
  });

  it("dispatches a healthy read within the established caller scope", async () => {
    const request = event("GET");
    await expect(
      createSlotsHandler()(request as unknown as H3Event),
    ).resolves.toEqual([{ slotId: "fake-slot" }]);
    expect(mocks.runWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "member@example.test", orgId: "fake-org" },
      expect.any(Function),
    );
    expect(mocks.listSlotsForExtension).toHaveBeenCalledWith("fake-extension");
    expect(request.status).toBe(200);
  });
});
