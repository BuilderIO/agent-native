import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  use: vi.fn(),
  getSession: vi.fn(),
  resolveAccess: vi.fn(),
  readBody: vi.fn(),
  writeAwarenessRow: vi.fn(async () => true),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getMethod: (event: { method: string }) => event.method,
  getRouterParam: (
    event: { context: { params?: Record<string, string> } },
    name: string,
  ) => event.context.params?.[name],
  setResponseStatus: (event: { status?: number }, status: number) => {
    event.status = status;
  },
}));
vi.mock("../collab/payload.js", () => ({
  DEFAULT_COLLAB_MAX_PAYLOAD_BYTES: 1_000_000,
  getCollabMaxPayloadBytes: () => 1_000_000,
  readCollabBody: mocks.readBody,
}));
vi.mock("./auth.js", () => ({ getSession: mocks.getSession }));
vi.mock("../sharing/access.js", () => ({
  resolveAccess: mocks.resolveAccess,
  assertAccess: vi.fn(),
}));
vi.mock("../collab/awareness-store.js", () => ({
  writeAwarenessRow: mocks.writeAwarenessRow,
  loadAwarenessClientSequence: vi.fn(async () => undefined),
  loadAwarenessRows: vi.fn(async () => []),
}));
vi.mock("../collab/emitter.js", () => ({
  getCollabEmitter: () => ({ on: vi.fn() }),
}));
vi.mock("../org/context.js", () => ({
  getOrgContext: vi.fn(async () => null),
}));
vi.mock("./framework-request-handler.js", () => ({
  awaitBootstrap: vi.fn(async () => {}),
  getH3App: () => ({ use: mocks.use }),
}));
vi.mock("./core-routes-plugin.js", () => ({
  FRAMEWORK_ROUTE_PREFIX: "/_agent-native",
}));
vi.mock("./poll.js", () => ({ recordChange: vi.fn() }));
vi.mock("./request-context.js", () => ({
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
}));

import { createCollabPlugin, type CollabAccess } from "./collab-plugin.js";

const OWNER = "owner@example.com";

type TestEvent = {
  method: string;
  url: URL;
  headers: Headers;
  context: Record<string, unknown>;
  status?: number;
};

async function post(
  access: CollabAccess,
  docId: string,
  body: { clientId: number; state: string },
): Promise<TestEvent> {
  mocks.use.mockReset();
  await createCollabPlugin({ access })({});
  const handler = mocks.use.mock.calls.at(-1)?.[1] as (
    event: TestEvent,
  ) => Promise<unknown>;
  mocks.readBody.mockResolvedValue(body);
  const event: TestEvent = {
    method: "POST",
    url: new URL(`http://localhost/${docId}/awareness`),
    headers: new Headers(),
    context: {},
  };
  await handler(event);
  return event;
}

function storedState(): unknown {
  const call = mocks.writeAwarenessRow.mock.calls.at(-1) as
    | unknown[]
    | undefined;
  if (!call) throw new Error("no awareness state was stored");
  return JSON.parse(call[2] as string);
}

const PAGE: CollabAccess = { mode: "resource", resourceType: "document" };

describe("collab awareness edit capabilities", () => {
  beforeEach(() => {
    mocks.readBody.mockReset();
    mocks.writeAwarenessRow.mockClear();
    mocks.resolveAccess.mockReset();
    mocks.getSession.mockReset();
  });

  it.each([
    ["viewer", "canFlushDocument"],
    ["viewer", "canFlushTitle"],
    ["commenter", "canFlushDocument"],
    ["commenter", "canFlushTitle"],
  ])(
    "doesn't let a %s advertise %s as the page's owner",
    async (role, capability) => {
      mocks.getSession.mockResolvedValue({ email: "reader@example.com" });
      mocks.resolveAccess.mockResolvedValue({
        role,
        resource: { ownerEmail: OWNER },
      });

      const event = await post(PAGE, `${role}-${capability}`, {
        clientId: 7,
        state: JSON.stringify({
          user: { name: "Owner", email: OWNER },
          [capability]: true,
        }),
      });

      expect(event.status).toBeUndefined();
      expect(storedState()).toMatchObject({
        user: { email: "reader@example.com" },
        canFlushDocument: false,
        canFlushTitle: false,
      });
    },
  );

  it("marks a viewer's state that doesn't mention saving as unable to save", async () => {
    mocks.getSession.mockResolvedValue({ email: "reader@example.com" });
    mocks.resolveAccess.mockResolvedValue({ role: "viewer", resource: {} });

    await post(PAGE, "viewer-silent", {
      clientId: 7,
      state: JSON.stringify({ visible: true }),
    });

    expect(storedState()).toMatchObject({
      visible: true,
      canFlushDocument: false,
      canFlushTitle: false,
    });
  });

  it.each(["editor", "admin", "owner"])(
    "keeps an %s's save capabilities",
    async (role) => {
      mocks.getSession.mockResolvedValue({ email: "editor@example.com" });
      mocks.resolveAccess.mockResolvedValue({
        role,
        resource: { ownerEmail: OWNER },
      });

      await post(PAGE, `${role}-saves`, {
        clientId: 8,
        state: JSON.stringify({ canFlushDocument: true, canFlushTitle: true }),
      });

      expect(storedState()).toMatchObject({
        user: { email: "editor@example.com" },
        canFlushDocument: true,
        canFlushTitle: true,
      });
    },
  );

  it("keeps the save capabilities of any signed-in session when every session can edit", async () => {
    mocks.getSession.mockResolvedValue({ email: "member@example.com" });

    await post({ mode: "all-authenticated" }, "all-authenticated", {
      clientId: 9,
      state: JSON.stringify({ canFlushDocument: true, canFlushTitle: true }),
    });

    expect(mocks.resolveAccess).not.toHaveBeenCalled();
    expect(storedState()).toMatchObject({
      user: { email: "member@example.com" },
      canFlushDocument: true,
      canFlushTitle: true,
    });
  });
});
