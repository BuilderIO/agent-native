import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  defineAction: vi.fn((options: unknown) => options),
  getRequestUserEmail: vi.fn(),
  getRequestOrgId: vi.fn(),
  getRequestUserName: vi.fn(),
  resolveAccess: vi.fn(),
  getDb: vi.fn(),
  notify: vi.fn(),
  isEmailConfigured: vi.fn(),
  sendEmail: vi.fn(),
  renderEmail: vi.fn(() => ({ html: "<p>request</p>", text: "request" })),
  emailStrong: vi.fn((value: string) => value),
  getAppProductionUrl: vi.fn(() => "https://clips.example.com"),
  signScopedAgentAccessToken: vi.fn(() => "approval-token"),
  verifyScopedAgentAccessToken: vi.fn(),
  withConfiguredAppBasePath: vi.fn((value: string) => value),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => mocks.defineAction(options),
}));

vi.mock("@agent-native/core/notifications", () => ({
  notify: (...args: unknown[]) => mocks.notify(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  emailStrong: (...args: unknown[]) => mocks.emailStrong(...args),
  getAppProductionUrl: (...args: unknown[]) =>
    mocks.getAppProductionUrl(...args),
  isEmailConfigured: (...args: unknown[]) => mocks.isEmailConfigured(...args),
  renderEmail: (...args: unknown[]) => mocks.renderEmail(...args),
  sendEmail: (...args: unknown[]) => mocks.sendEmail(...args),
  signScopedAgentAccessToken: (...args: unknown[]) =>
    mocks.signScopedAgentAccessToken(...args),
  verifyScopedAgentAccessToken: (...args: unknown[]) =>
    mocks.verifyScopedAgentAccessToken(...args),
  withConfiguredAppBasePath: (...args: unknown[]) =>
    mocks.withConfiguredAppBasePath(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: (...args: unknown[]) =>
    mocks.getRequestUserEmail(...args),
  getRequestOrgId: (...args: unknown[]) => mocks.getRequestOrgId(...args),
  getRequestUserName: (...args: unknown[]) => mocks.getRequestUserName(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  desc: (column: unknown) => ({ type: "desc", column }),
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
  schema: {
    recordings: {
      id: "recordings.id",
      title: "recordings.title",
      ownerEmail: "recordings.ownerEmail",
      visibility: "recordings.visibility",
      trashedAt: "recordings.trashedAt",
    },
    recordingEvents: {
      id: "recording_events.id",
      recordingId: "recording_events.recording_id",
      kind: "recording_events.kind",
      createdAt: "recording_events.created_at",
      payload: "recording_events.payload",
    },
  },
}));

vi.mock("../server/lib/recordings.js", () => ({
  normalizeOwnerEmail: (value: string) => value.trim().toLowerCase(),
}));

import requestRecordingAccess, {
  renderRecordingAccessRequestEmail,
} from "./request-recording-access.js";

function createDb(
  recordingRows: unknown[],
  requestRows: unknown[] = [],
  insertedRows: unknown[] = [{ id: "event-1" }],
) {
  let selectIndex = 0;
  const db = {
    select: vi.fn(() => {
      const rows = selectIndex++ === 0 ? recordingRows : requestRows;
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        orderBy: vi.fn(() => builder),
        limit: vi.fn(async (count?: number) =>
          typeof count === "number" ? rows.slice(0, count) : rows,
        ),
        then: (resolve: (value: unknown[]) => unknown) =>
          Promise.resolve(rows).then(resolve),
      };
      return builder;
    }),
    insert: vi.fn(() => {
      const builder = {
        values: vi.fn(() => builder),
        onConflictDoNothing: vi.fn(() => builder),
        returning: vi.fn(async () => insertedRows),
      };
      return builder;
    }),
  };
  return db;
}

function privateRecording() {
  return {
    id: "rec-1",
    title: "Private demo",
    ownerEmail: "owner@example.com",
    visibility: "private",
    trashedAt: null,
  };
}

describe("request-recording-access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("viewer@example.com");
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.getRequestUserName.mockReturnValue("Viewer Example");
    mocks.resolveAccess.mockResolvedValue(null);
    mocks.isEmailConfigured.mockResolvedValue(true);
    mocks.notify.mockResolvedValue(undefined);
    mocks.sendEmail.mockResolvedValue(undefined);
    mocks.verifyScopedAgentAccessToken.mockReturnValue({ ok: true });
  });

  it("requires a requester identity", async () => {
    mocks.getRequestUserEmail.mockReturnValue(null);

    await expect(
      (requestRecordingAccess as any).run({
        recordingId: "rec-1",
        accessRequestToken: "request-token",
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("hides an inaccessible private recording without a request capability", async () => {
    const db = createDb([privateRecording()]);
    mocks.getDb.mockReturnValue(db);

    await expect(
      (requestRecordingAccess as any).run({ recordingId: "rec-1" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Recording rec-1 not found",
    });

    expect(db.select).not.toHaveBeenCalled();
    expect(mocks.verifyScopedAgentAccessToken).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("hides an inaccessible private recording with an invalid request capability", async () => {
    const db = createDb([privateRecording()]);
    mocks.getDb.mockReturnValue(db);
    mocks.verifyScopedAgentAccessToken.mockReturnValue({ ok: false });

    await expect(
      (requestRecordingAccess as any).run({
        recordingId: "rec-1",
        accessRequestToken: "invalid-token",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Recording rec-1 not found",
    });

    expect(db.select).not.toHaveBeenCalled();
    expect(mocks.verifyScopedAgentAccessToken).toHaveBeenCalledWith(
      "invalid-token",
      {
        resourceKind: "clips-access-request",
        resourceId: "rec-1",
      },
    );
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("records, stores an inbox notification, and emails the owner", async () => {
    const db = createDb([privateRecording()]);
    mocks.getDb.mockReturnValue(db);

    await expect(
      (requestRecordingAccess as any).run({
        recordingId: "rec-1",
        accessRequestToken: "request-token",
      }),
    ).resolves.toMatchObject({
      ok: true,
      alreadyHasAccess: false,
      alreadyRequested: false,
      notifiedOwner: true,
    });

    expect(db.insert).toHaveBeenCalledWith(expect.anything());
    expect(db.insert.mock.results[0].value.values).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "rec-1",
        kind: "access-request",
        payload: expect.stringContaining(
          '"requesterEmail":"viewer@example.com"',
        ),
      }),
    );
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Clip access requested" }),
      { owner: "owner@example.com" },
    );
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
        replyTo: "viewer@example.com",
        templateId: "clips.access-request",
      }),
    );
    expect(mocks.signScopedAgentAccessToken).toHaveBeenCalledWith({
      resourceKind: "clips-access-approval",
      resourceId: "rec-1",
      viewerEmail: "viewer@example.com",
      ttlSeconds: 604800,
    });
    expect(mocks.renderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        cta: {
          label: "Allow access",
          url: "https://clips.example.com/access-request/approve?recordingId=rec-1&token=approval-token",
        },
      }),
    );
    expect(mocks.verifyScopedAgentAccessToken).toHaveBeenCalledWith(
      "request-token",
      {
        resourceKind: "clips-access-request",
        resourceId: "rec-1",
      },
    );
  });

  it("records a guest request for the provided email", async () => {
    mocks.getRequestUserEmail.mockReturnValue(null);
    mocks.getRequestOrgId.mockReturnValue(null);
    const db = createDb([privateRecording()]);
    mocks.getDb.mockReturnValue(db);

    await expect(
      (requestRecordingAccess as any).run({
        recordingId: "rec-1",
        accessRequestToken: "request-token",
        requesterEmail: "Guest@Example.com",
      }),
    ).resolves.toMatchObject({
      ok: true,
      alreadyHasAccess: false,
      alreadyRequested: false,
      notifiedOwner: true,
    });

    expect(mocks.resolveAccess).toHaveBeenCalledWith("recording", "rec-1", {
      userEmail: "guest@example.com",
      orgId: undefined,
    });
    expect(db.insert.mock.results[0].value.values).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.stringContaining(
          '"requesterEmail":"guest@example.com"',
        ),
      }),
    );
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
        replyTo: "guest@example.com",
      }),
    );
  });

  it("does not send duplicate requests from the same viewer", async () => {
    const db = createDb(
      [privateRecording()],
      [{ payload: JSON.stringify({ requesterEmail: "VIEWER@example.com" }) }],
    );
    mocks.getDb.mockReturnValue(db);

    await expect(
      (requestRecordingAccess as any).run({
        recordingId: "rec-1",
        accessRequestToken: "request-token",
      }),
    ).resolves.toMatchObject({
      ok: true,
      alreadyHasAccess: false,
      alreadyRequested: true,
      notifiedOwner: false,
    });
    expect(db.insert).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("does not notify twice when concurrent inserts collide", async () => {
    const db = createDb([privateRecording()], [], []);
    mocks.getDb.mockReturnValue(db);

    await expect(
      (requestRecordingAccess as any).run({
        recordingId: "rec-1",
        accessRequestToken: "request-token",
      }),
    ).resolves.toMatchObject({
      ok: true,
      alreadyHasAccess: false,
      alreadyRequested: true,
      notifiedOwner: false,
    });

    expect(db.insert.mock.results[0].value.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^access-request-[a-f0-9]{64}$/),
      }),
    );
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("deduplicates a viewer whose request is older than the newest 100 events", async () => {
    const requestRows = [
      ...Array.from({ length: 100 }, (_, index) => ({
        payload: JSON.stringify({
          requesterEmail: `viewer-${index}@example.com`,
        }),
      })),
      { payload: JSON.stringify({ requesterEmail: "VIEWER@example.com" }) },
    ];
    const db = createDb([privateRecording()], requestRows);
    mocks.getDb.mockReturnValue(db);

    await expect(
      (requestRecordingAccess as any).run({
        recordingId: "rec-1",
        accessRequestToken: "request-token",
      }),
    ).resolves.toMatchObject({
      ok: true,
      alreadyHasAccess: false,
      alreadyRequested: true,
      notifiedOwner: false,
    });

    expect(db.insert).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("renders a direct share link in the owner email", () => {
    expect(
      renderRecordingAccessRequestEmail({
        requesterName: "Viewer Example",
        requesterEmail: "viewer@example.com",
        recordingTitle: "Private demo",
        url: "https://clips.example.com/share/rec-1",
        allowAccessUrl:
          "https://clips.example.com/access-request/approve?recordingId=rec-1&token=approval-token",
      }),
    ).toMatchObject({
      subject: 'Access request for "Private demo"',
      html: "<p>request</p>",
    });
    expect(mocks.renderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        cta: {
          label: "Allow access",
          url: "https://clips.example.com/access-request/approve?recordingId=rec-1&token=approval-token",
        },
        secondaryCta: {
          label: "Open Clip",
          url: "https://clips.example.com/share/rec-1",
        },
      }),
    );
  });
});
