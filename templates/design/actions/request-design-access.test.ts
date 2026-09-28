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
  existingRequest: undefined as
    | { notifiedAt: string | null; notificationClaimedAt?: string | null }
    | undefined,
}));

const selectWhere = vi.hoisted(() =>
  vi.fn(async (condition: { column: string }) =>
    condition.column === "design_access_requests.id"
      ? state.existingRequest
        ? [state.existingRequest]
        : []
      : state.design
        ? [state.design]
        : [],
  ),
);
const insertReturning = vi.hoisted(() =>
  vi.fn(async () =>
    state.insertConflict
      ? []
      : [{ id: "design-access-request-1", notifiedAt: null }],
  ),
);
const insertValues = vi.hoisted(() =>
  vi.fn(() => ({
    onConflictDoNothing: () => ({ returning: insertReturning }),
  })),
);
const updateReturning = vi.hoisted(() =>
  vi.fn(async () =>
    state.insertConflict &&
    state.existingRequest?.notifiedAt === null &&
    !state.existingRequest.notificationClaimedAt
      ? [{ id: "design-access-request-1" }]
      : [],
  ),
);
const updateSet = vi.hoisted(() =>
  vi.fn(() => ({
    where: () => ({ returning: updateReturning }),
  })),
);
const db = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn((condition) => ({ limit: () => selectWhere(condition) })),
    })),
  })),
  insert: vi.fn(() => ({ values: insertValues })),
  update: vi.fn(() => ({ set: updateSet })),
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
      notifiedAt: "design_access_requests.notified_at",
      notificationClaimedAt: "design_access_requests.notification_claimed_at",
    },
  },
}));

vi.mock("../server/source-workspace.js", () => ({
  withDesignSourceMutationTransaction: async (
    _designId: string,
    callback: (transaction: typeof db) => unknown,
  ) => callback(db),
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
  and: (...conditions: unknown[]) => ({ conditions }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  isNull: (column: unknown) => ({ column, isNull: true }),
  lt: (column: unknown, value: unknown) => ({ column, value, lt: true }),
  or: (...conditions: unknown[]) => ({ conditions }),
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
  state.existingRequest = undefined;
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
    state.existingRequest = {
      notifiedAt: "2026-09-18T19:00:00.000Z",
    };

    const result = await action.run({ designId: "design-1" });

    expect(result).toMatchObject({
      ok: true,
      alreadyRequested: true,
      notifiedOwner: false,
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("retries an owner notification that previously failed", async () => {
    state.insertConflict = true;
    state.existingRequest = { notifiedAt: null };

    const result = await action.run({ designId: "design-1" });

    expect(result).toMatchObject({
      ok: true,
      alreadyRequested: true,
      notifiedOwner: true,
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith({
      notifiedAt: expect.any(String),
      notificationClaimedAt: null,
    });
  });

  it("does not send a duplicate while another notification is claimed", async () => {
    state.insertConflict = true;
    state.existingRequest = {
      notifiedAt: null,
      notificationClaimedAt: new Date().toISOString(),
    };

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
