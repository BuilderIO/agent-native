import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createExtension: vi.fn(),
  ensureExtensionsTables: vi.fn(),
  getOrgContext: vi.fn(),
  getSession: vi.fn(),
  readBody: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getMethod: (event: { method?: string }) => event.method ?? "GET",
  setResponseHeader: vi.fn(),
  setResponseStatus: (event: { status: number }, status: number) => {
    event.status = status;
  },
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: (...args: unknown[]) => mocks.getOrgContext(...args),
}));

vi.mock("../server/auth.js", () => ({
  getSession: (...args: unknown[]) => mocks.getSession(...args),
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: (...args: unknown[]) => mocks.readBody(...args),
}));

vi.mock("../server/request-context.js", () => ({
  getRequestOrgId: () => "org-1",
  runWithRequestContext: (_context: unknown, run: () => Promise<unknown>) =>
    run(),
}));

vi.mock("./local.js", () => ({
  getLocalExtension: vi.fn(),
  isLocalExtensionRow: vi.fn(() => false),
  listLocalExtensions: vi.fn(async () => []),
}));

vi.mock("./store.js", () => ({
  createExtension: (...args: unknown[]) => mocks.createExtension(...args),
  deleteExtension: vi.fn(),
  ensureExtensionsTables: (...args: unknown[]) =>
    mocks.ensureExtensionsTables(...args),
  getExtension: vi.fn(),
  getExtensionHistoryVersion: vi.fn(),
  globalHideExtension: vi.fn(),
  globalUnhideExtension: vi.fn(),
  hideExtension: vi.fn(),
  listExtensionHistory: vi.fn(),
  listExtensions: vi.fn(async () => []),
  restoreExtensionHistoryVersion: vi.fn(),
  unhideExtension: vi.fn(),
  updateExtension: vi.fn(),
  updateExtensionContent: vi.fn(),
}));

import { createExtensionsHandler } from "./routes.js";

function createEvent(method = "POST") {
  return {
    method,
    url: new URL("http://app.test/"),
    status: 200,
  };
}

describe("createExtensionsHandler extension creation capability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      email: "owner@example.test",
      orgId: "org-1",
    });
    mocks.getOrgContext.mockResolvedValue({ orgId: "org-1" });
    mocks.readBody.mockResolvedValue({
      name: "One-off chart",
      content: "<div>Chart</div>",
    });
    mocks.createExtension.mockResolvedValue({ id: "extension-1" });
  });

  it("rejects authenticated collection creation by default", async () => {
    const event = createEvent();
    const handler = createExtensionsHandler();

    await expect(handler(event as never)).resolves.toEqual({
      error: "Extension creation is disabled for this app",
    });
    expect(event.status).toBe(403);
    expect(mocks.ensureExtensionsTables).not.toHaveBeenCalled();
    expect(mocks.readBody).not.toHaveBeenCalled();
    expect(mocks.createExtension).not.toHaveBeenCalled();
  });

  it("allows an opted-in app to create an extension", async () => {
    const event = createEvent();
    const handler = createExtensionsHandler({ extensionTools: true });

    await expect(handler(event as never)).resolves.toEqual({
      id: "extension-1",
    });
    expect(event.status).toBe(201);
    expect(mocks.ensureExtensionsTables).toHaveBeenCalledOnce();
    expect(mocks.createExtension).toHaveBeenCalledWith({
      name: "One-off chart",
      content: "<div>Chart</div>",
    });
  });

  it("continues to reject unauthenticated callers before capability checks", async () => {
    mocks.getSession.mockResolvedValue(null);
    const event = createEvent();
    const handler = createExtensionsHandler({ extensionTools: true });

    await expect(handler(event as never)).resolves.toEqual({
      error: "Authentication required",
    });
    expect(event.status).toBe(401);
    expect(mocks.createExtension).not.toHaveBeenCalled();
  });
});
