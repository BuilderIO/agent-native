import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createEmbedSessionTicket: vi.fn(),
  getDb: vi.fn(),
  getRequestContext: vi.fn(),
  schema: {
    designs: {
      data: "designs.data",
      id: "designs.id",
      orgId: "designs.orgId",
      ownerEmail: "designs.ownerEmail",
      visibility: "designs.visibility",
    },
  },
}));

vi.mock("@agent-native/core", () => ({
  fail: (message: string) => {
    throw new Error(message);
  },
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core/server", () => ({
  buildEmbedStartPath: (ticket: string) =>
    `/_agent-native/embed/start?ticket=${ticket}`,
  createEmbedSessionTicket: mocks.createEmbedSessionTicket,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: mocks.getRequestContext,
}));

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ left, right }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: mocks.schema,
}));

import action from "./issue-visual-edit-access.js";

const requestContext = {
  caller: "frontend" as const,
  requestHeaders: new Headers({
    origin: "https://design.example.com",
    "sec-fetch-site": "same-origin",
  }),
};

function setDesign(design: {
  data: string;
  orgId: string | null;
  ownerEmail: string;
  visibility: string;
}) {
  mocks.getDb.mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                id: "design-1",
                ...design,
              },
            ]),
        }),
      }),
    }),
  });
}

describe("issue-visual-edit-access", () => {
  beforeEach(() => {
    mocks.createEmbedSessionTicket.mockReset();
    mocks.createEmbedSessionTicket.mockResolvedValue({ ticket: "ticket-1" });
    mocks.getRequestContext.mockReset();
    mocks.getRequestContext.mockReturnValue({
      requestOrigin: "https://design.example.com",
    });
    setDesign({
      data: JSON.stringify({ sourceType: "localhost" }),
      orgId: "org-1",
      ownerEmail: "owner@example.com",
      visibility: "public",
    });
  });

  it("mints an editor capability for a public localhost design", async () => {
    await expect(
      action.run({ designId: "design-1" }, requestContext),
    ).resolves.toEqual({
      startUrl: "/_agent-native/embed/start?ticket=ticket-1",
    });

    expect(mocks.createEmbedSessionTicket).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      targetPath: "/visual-edit/design-1?editorView=overview&embedChrome=1",
      scope: "capability:visual-edit:design:design-1",
      ttlSeconds: 300,
    });
  });

  it("binds the ticket to the design owner rather than the signed-in viewer", async () => {
    mocks.getRequestContext.mockReturnValue({
      requestOrigin: "https://design.example.com",
      userEmail: "viewer@example.com",
      orgId: "viewer-org",
    });
    await action.run({ designId: "design-1" }, requestContext);

    expect(mocks.createEmbedSessionTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.com",
        orgId: "org-1",
      }),
    );
  });

  it("rejects private and non-localhost designs", async () => {
    setDesign({
      data: JSON.stringify({ sourceType: "inline" }),
      orgId: null,
      ownerEmail: "owner@example.com",
      visibility: "private",
    });

    await expect(
      action.run({ designId: "design-1" }, requestContext),
    ).rejects.toThrow(/Only public localhost designs/);
    expect(mocks.createEmbedSessionTicket).not.toHaveBeenCalled();
  });

  it("rejects cross-origin callers", async () => {
    await expect(
      action.run(
        { designId: "design-1" },
        {
          caller: "frontend",
          requestHeaders: new Headers({ origin: "https://evil.example" }),
        },
      ),
    ).rejects.toThrow(/same-origin Design page/);
    expect(mocks.createEmbedSessionTicket).not.toHaveBeenCalled();
  });
});
