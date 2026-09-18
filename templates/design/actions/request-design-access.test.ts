import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  requesterEmail: "viewer@example.com" as string | null,
  requesterName: "Viewer" as string | null,
  design: {
    id: "design-1",
    title: "Private checkout",
    ownerEmail: "owner@example.com",
  } as { id: string; title: string; ownerEmail: string | null } | undefined,
  access: null as { role?: string } | null,
  emailConfigured: true,
  insertConflict: false,
}));

const selectLimit = vi.hoisted(() =>
  vi.fn(async () => (state.design ? [state.design] : [])),
);
const insertReturning = vi.hoisted(() =>
  vi.fn(async () =>
    state.insertConflict ? [] : [{ id: "design-access-request-1" }],
  ),
);
const insertValues = vi.hoisted(() =>
  vi.fn(() => ({
    onConflictDoNothing: () => ({ returning: insertReturning }),
  })),
);
const db = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit: selectLimit })),
    })),
  })),
  insert: vi.fn(() => ({ values: insertValues })),
}));
const resolveAccess = vi.hoisted(() => vi.fn(async () => state.access));
const sendEmail = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../server/db/index.js", () => ({
  getDb: () => db,
  schema: {
    designs: {
      id: "designs.id",
      title: "designs.title",
      ownerEmail: "designs.owner_email",
    },
    designAccessRequests: {
      id: "design_access_requests.id",
      designId: "design_access_requests.design_id",
      requesterEmail: "design_access_requests.requester_email",
      requesterName: "design_access_requests.requester_name",
    },
  },
}));

vi.mock("@agent-native/core/server", () => ({
  emailStrong: (value: string) => `<strong>${value}</strong>`,
  getAppProductionUrl: () => "https://design.example",
  isEmailConfigured: () => Promise.resolve(state.emailConfigured),
  renderEmail: () => ({ html: "<html />", text: "email" }),
  sendEmail,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => state.requesterEmail,
  getRequestUserName: () => state.requesterName,
}));

vi.mock("@agent-native/core/sharing", () => ({
  registerShareableResource: vi.fn(),
  resolveAccess,
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

import action from "./request-design-access";

beforeEach(() => {
  vi.clearAllMocks();
  state.requesterEmail = "viewer@example.com";
  state.requesterName = "Viewer";
  state.design = {
    id: "design-1",
    title: "Private checkout",
    ownerEmail: "owner@example.com",
  };
  state.access = null;
  state.emailConfigured = true;
  state.insertConflict = false;
});

describe("request-design-access", () => {
  it("records and notifies a signed-in viewer", async () => {
    const result = await action.run({ designId: "design-1" });

    expect(result).toMatchObject({
      ok: true,
      alreadyRequested: false,
      notifiedOwner: true,
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        designId: "design-1",
        requesterEmail: "viewer@example.com",
        requesterName: "Viewer",
      }),
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
        templateId: "design.access-request",
      }),
    );
  });

  it("does not notify twice when the same viewer requests again", async () => {
    state.insertConflict = true;

    const result = await action.run({ designId: "design-1" });

    expect(result).toMatchObject({
      ok: true,
      alreadyRequested: true,
      notifiedOwner: false,
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("requires a signed-in viewer", async () => {
    state.requesterEmail = null;

    await expect(action.run({ designId: "design-1" })).rejects.toMatchObject({
      message: "Sign in to request access to this design.",
      statusCode: 401,
    });
  });
});
