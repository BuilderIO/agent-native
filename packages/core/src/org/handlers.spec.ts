import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn();
const mockTransaction = vi.fn(
  async (fn: (tx: { execute: typeof mockExecute }) => unknown) =>
    fn({ execute: mockExecute }),
);
const mockGetOrgContext = vi.fn();
const mockGetSession = vi.hoisted(() => vi.fn());
const mockAddFederatedOrganizationMember = vi.hoisted(() => vi.fn());
const mockRevokeFederatedOrganizationMember = vi.hoisted(() => vi.fn());
const mockUpdateFederatedOrganizationMemberRole = vi.hoisted(() => vi.fn());
const mockSyncOrganizationToIdentityHub = vi.hoisted(() => vi.fn());
const MockFederatedIconConflictError = vi.hoisted(
  () =>
    class extends Error {
      constructor(
        readonly icon: unknown,
        readonly iconRevision: number,
      ) {
        super("Workspace icon changed elsewhere; retry your selection");
      }
    },
);
const mockEvaluateFeatureFlagStrict = vi.hoisted(() => vi.fn());
const mockBootstrapAdminOrganization = vi.hoisted(() => vi.fn());
const mockOffboardMember = vi.hoisted(() => vi.fn());
const mockGetUserProfiles = vi.hoisted(() => vi.fn());
const mockTrackInviteAccepted = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getRouterParam: (event: any, key: string) => event._params?.[key],
  getRequestURL: (event: any) => new URL(event._url),
  createError: ({ statusCode, message }: any) =>
    Object.assign(new Error(message), { statusCode }),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mockExecute, transaction: mockTransaction }),
}));

vi.mock("../feature-flags/store.js", () => ({
  evaluateFeatureFlagStrict: (...args: any[]) =>
    mockEvaluateFeatureFlagStrict(...args),
}));

vi.mock("./context.js", () => ({
  getOrgContext: (...args: any[]) => mockGetOrgContext(...args),
  createOrganization: vi.fn(),
  bootstrapAdminOrganization: (...args: any[]) =>
    mockBootstrapAdminOrganization(...args),
}));

vi.mock("./federation.js", () => ({
  FederatedIconConflictError: MockFederatedIconConflictError,
  addFederatedOrganizationMember: (...args: any[]) =>
    mockAddFederatedOrganizationMember(...args),
  revokeFederatedOrganizationMember: (...args: any[]) =>
    mockRevokeFederatedOrganizationMember(...args),
  syncOrganizationToIdentityHub: (...args: any[]) =>
    mockSyncOrganizationToIdentityHub(...args),
  updateFederatedOrganizationMemberRole: (...args: any[]) =>
    mockUpdateFederatedOrganizationMemberRole(...args),
}));

vi.mock("../extensions/url-safety.js", () => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("../server/app-url.js", () => ({
  getAppProductionUrl: () => "https://app.example.test",
}));

vi.mock("../server/auth.js", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));

vi.mock("../identity/offboard.js", () => ({
  offboardMember: (...args: any[]) => mockOffboardMember(...args),
}));

import { resetAppConfigForTests } from "../app-config/index.js";

vi.mock("../server/email-templates.js", () => ({
  renderInviteEmail: vi.fn(() => ({ subject: "", html: "", text: "" })),
}));

vi.mock("../server/email.js", () => ({
  isEmailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
}));

const mockTrack = vi.hoisted(() => vi.fn());
const mockFlushTracking = vi.hoisted(() => vi.fn(async () => []));
vi.mock("../tracking/registry.js", () => ({
  track: (...args: any[]) => mockTrack(...args),
  flushTracking: () => mockFlushTracking(),
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: (event: any) => Promise.resolve(event._body),
}));

vi.mock("../settings/user-settings.js", () => ({
  putUserSetting: vi.fn(),
}));

vi.mock("../user-profile/store.js", () => ({
  getUserProfiles: (...args: any[]) => mockGetUserProfiles(...args),
}));
const mockRecordOrgAdminAuditEvent = vi.hoisted(() => vi.fn());
vi.mock("../audit/org-admin.js", () => ({
  recordOrgAdminAuditEvent: (...args: any[]) =>
    mockRecordOrgAdminAuditEvent(...args),
}));
vi.mock("./track-invite-accepted.js", () => ({
  trackInviteAccepted: (...args: any[]) => mockTrackInviteAccepted(...args),
  registerBackgroundWork: (event: any, promise: Promise<unknown>) => {
    if (typeof event?.waitUntil === "function") event.waitUntil(promise);
  },
}));

import { putUserSetting } from "../settings/user-settings.js";
import { createOrganization } from "./context.js";
import {
  listMembersHandler,
  deleteOrgHandler,
  changeMemberRoleHandler,
  removeMemberHandler,
  retryPendingFederatedRemovalHandler,
  acceptInvitationHandler,
  createInvitationHandler,
  joinByDomainHandler,
  updateOrgHandler,
  setOrgVisualIdentityHandler,
  setDomainHandler,
  setWorkspaceAppDefaultVisibilityHandler,
  createOrgHandler,
} from "./handlers.js";
import {
  cachedMemberships,
  __resetProcessMemberOrgCacheForTests,
} from "./request-org-cache.js";

function makeEvent(path: string, body?: unknown) {
  return { _url: `https://app.example.test${path}`, _body: body } as any;
}

describe("org handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockReset();
    resetAppConfigForTests();
    delete process.env.ORG_CREATION;
    delete process.env.AUTH_BOOTSTRAP_ADMINS;
    mockGetOrgContext.mockResolvedValue({
      email: "owner@example.test",
      orgId: "org-1",
      orgName: "Example",
      role: "owner",
    });
    mockGetSession.mockResolvedValue({ email: "member@example.test" });
    mockExecute.mockResolvedValue({ rows: [], rowsAffected: 0 });
    mockAddFederatedOrganizationMember.mockResolvedValue(false);
    mockRevokeFederatedOrganizationMember.mockResolvedValue(false);
    mockUpdateFederatedOrganizationMemberRole.mockResolvedValue(false);
    mockSyncOrganizationToIdentityHub.mockResolvedValue(false);
    mockEvaluateFeatureFlagStrict.mockResolvedValue(false);
    mockBootstrapAdminOrganization.mockResolvedValue(false);
    mockGetUserProfiles.mockResolvedValue(new Map());
    mockOffboardMember.mockResolvedValue({
      removedMemberships: 1,
      removedAppRoles: 1,
      transferredRows: 0,
      revokedSessions: 0,
    });
  });

  it("blocks direct organization creation in a closed deployment", async () => {
    process.env.ORG_CREATION = "closed";
    resetAppConfigForTests();
    mockExecute.mockResolvedValueOnce({ rows: [{ id: "existing-org" }] });

    await expect(
      createOrgHandler(
        makeEvent("/_agent-native/org", { name: "Personal org" }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it("persists a validated workspace icon with a new revision", async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [
          {
            name: "Example",
            icon_revision: 4,
            identity_authority: null,
            identity_id: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ icon_revision: 5 }], rowsAffected: 1 });

    const icon = {
      version: 1 as const,
      kind: "library" as const,
      library: "tabler" as const,
      name: "building-community",
      color: "blue" as const,
    };
    await expect(
      setOrgVisualIdentityHandler(
        makeEvent("/_agent-native/org/visual-identity", { icon }),
      ),
    ).resolves.toEqual({
      orgId: "org-1",
      icon,
      iconRevision: 5,
      syncPending: false,
    });
    expect(mockExecute.mock.calls[1]?.[0]).toMatchObject({
      args: [JSON.stringify(icon), 5, "org-1", 4],
    });
  });

  it("commits a federated workspace icon before syncing and reports a pending hub update", async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [
          {
            name: "Example",
            icon_revision: 1,
            identity_authority: "https://dispatch.example.test",
            identity_id: "org-1",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ icon_revision: 2 }], rowsAffected: 1 });
    mockSyncOrganizationToIdentityHub.mockRejectedValueOnce(
      new Error("Identity authority unavailable"),
    );

    const icon = { version: 1 as const, kind: "emoji" as const, emoji: "🏗️" };
    await expect(
      setOrgVisualIdentityHandler(
        makeEvent("/_agent-native/org/visual-identity", { icon }),
      ),
    ).resolves.toEqual({
      orgId: "org-1",
      icon,
      iconRevision: 2,
      syncPending: true,
    });
    expect(mockExecute.mock.calls[1]?.[0]).toMatchObject({
      args: [JSON.stringify(icon), 2, "org-1", 1],
    });
    expect(mockSyncOrganizationToIdentityHub).toHaveBeenCalledTimes(1);
    expect(
      mockSyncOrganizationToIdentityHub.mock.calls[0]?.[1],
    ).not.toHaveProperty("iconRevision");
  });

  it("does not advance federation when the local workspace icon write loses its revision", async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [
          {
            name: "Example",
            icon_revision: 1,
            identity_authority: "https://dispatch.example.test",
            identity_id: "org-1",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 });

    await expect(
      setOrgVisualIdentityHandler(
        makeEvent("/_agent-native/org/visual-identity", {
          icon: { version: 1, kind: "emoji", emoji: "🏗️" },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockSyncOrganizationToIdentityHub).not.toHaveBeenCalled();
  });

  it("restores the authority icon and rejects a stale replica selection", async () => {
    const selected = {
      version: 1 as const,
      kind: "emoji" as const,
      emoji: "🏗️",
    };
    const canonical = {
      version: 1 as const,
      kind: "emoji" as const,
      emoji: "📚",
    };
    mockExecute
      .mockResolvedValueOnce({
        rows: [
          {
            name: "Example",
            icon_revision: 1,
            identity_authority: "https://dispatch.example.test",
            identity_id: "org-1",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ icon_revision: 2 }], rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [{ icon_revision: 5 }], rowsAffected: 1 });
    mockSyncOrganizationToIdentityHub.mockRejectedValueOnce(
      new MockFederatedIconConflictError(canonical, 5),
    );

    await expect(
      setOrgVisualIdentityHandler(
        makeEvent("/_agent-native/org/visual-identity", { icon: selected }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockExecute.mock.calls[2]?.[0]).toMatchObject({
      args: [
        JSON.stringify(canonical),
        5,
        "org-1",
        2,
        JSON.stringify(selected),
      ],
    });
  });

  it("refuses closed creation with no organizations and no bootstrap roster", async () => {
    process.env.ORG_CREATION = "closed";
    resetAppConfigForTests();
    mockExecute.mockResolvedValueOnce({ rows: [] });

    await expect(
      createOrgHandler(
        makeEvent("/_agent-native/org", { name: "Initial org" }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it("waits for a configured bootstrap admin before allowing closed creation", async () => {
    process.env.ORG_CREATION = "closed";
    process.env.AUTH_BOOTSTRAP_ADMINS = "admin@example.test";
    resetAppConfigForTests();
    mockExecute.mockResolvedValueOnce({ rows: [] });

    await expect(
      createOrgHandler(makeEvent("/_agent-native/org", { name: "Seized org" })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it("lets a bootstrap admin initialize only the canonical org in a closed deployment", async () => {
    process.env.ORG_CREATION = "closed";
    process.env.AUTH_BOOTSTRAP_ADMINS = "member@example.test";
    resetAppConfigForTests();
    mockGetSession.mockResolvedValue({
      email: "member@example.test",
      emailVerified: true,
    });
    mockExecute.mockResolvedValueOnce({ rows: [{ id: "existing-org" }] });
    mockBootstrapAdminOrganization.mockResolvedValue(true);

    await expect(
      createOrgHandler(
        makeEvent("/_agent-native/org", { name: "Unrelated org" }),
      ),
    ).resolves.toEqual({ success: true });
    expect(mockBootstrapAdminOrganization).toHaveBeenCalledWith(
      "member@example.test",
    );
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it("uses the canonical bootstrap path for a verified bootstrap admin on an empty database", async () => {
    process.env.ORG_CREATION = "closed";
    process.env.AUTH_BOOTSTRAP_ADMINS = "member@example.test";
    resetAppConfigForTests();
    mockGetSession.mockResolvedValue({
      email: "member@example.test",
      emailVerified: true,
    });
    mockExecute.mockResolvedValueOnce({ rows: [] });
    mockBootstrapAdminOrganization.mockResolvedValue(true);

    await expect(
      createOrgHandler(
        makeEvent("/_agent-native/org", { name: "Ignored by bootstrap" }),
      ),
    ).resolves.toEqual({ success: true });
    expect(mockBootstrapAdminOrganization).toHaveBeenCalledWith(
      "member@example.test",
    );
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it("keeps a federated removal atomic across the local and identity rosters", async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [{ role: "member", federation_removal_pending_at: null }],
        rowsAffected: 0,
      })
      .mockResolvedValueOnce({
        rows: [{ email: "successor@example.test" }],
        rowsAffected: 0,
      });
    mockRevokeFederatedOrganizationMember.mockResolvedValue(true);

    await expect(
      removeMemberHandler(
        makeEvent("/_agent-native/org/members/member@example.test", {
          transferTo: "successor@example.test",
        }),
      ),
    ).resolves.toEqual({ success: true });

    expect(mockRevokeFederatedOrganizationMember).toHaveBeenCalledWith(
      expect.anything(),
      {
        orgId: "org-1",
        actorEmail: "owner@example.test",
        actorRole: "owner",
        memberEmail: "member@example.test",
      },
    );
    expect(mockOffboardMember).toHaveBeenCalledWith(
      expect.anything(),
      "member@example.test",
      expect.objectContaining({
        transferTo: "successor@example.test",
        orgId: "org-1",
        actorEmail: "owner@example.test",
      }),
    );
  });

  it("does not remove a local member when federated revocation fails", async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [{ role: "member", federation_removal_pending_at: null }],
        rowsAffected: 0,
      })
      .mockResolvedValueOnce({
        rows: [{ email: "successor@example.test" }],
        rowsAffected: 0,
      });
    mockRevokeFederatedOrganizationMember.mockRejectedValue(
      new Error("identity authority unavailable"),
    );

    await expect(
      removeMemberHandler(
        makeEvent("/_agent-native/org/members/member@example.test", {
          transferTo: "successor@example.test",
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(mockExecute).toHaveBeenCalledTimes(3);
    expect(mockExecute.mock.calls[2][0].sql).toContain(
      "SET federation_removal_pending_at = ?",
    );
  });

  it("rejects a successor outside the active organization before revocation", async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{ role: "member", federation_removal_pending_at: null }],
      rowsAffected: 0,
    });

    await expect(
      removeMemberHandler(
        makeEvent("/_agent-native/org/members/member@example.test", {
          transferTo: "outsider@example.test",
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Transfer target must be an active member of this organization",
    });
    expect(mockRevokeFederatedOrganizationMember).not.toHaveBeenCalled();
    expect(mockOffboardMember).not.toHaveBeenCalled();
  });

  it("does not grant a domain join to a linked organization", async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          id: "org-1",
          name: "Example",
          allowed_domain: "example.test",
          identity_authority: "https://dispatch.example.test",
          identity_id: "dispatch-org-1",
        },
      ],
    });

    await expect(
      joinByDomainHandler(
        makeEvent("/_agent-native/org/join-by-domain", { orgId: "org-1" }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("registers invite_sent telemetry with the event's waitUntil", async () => {
    // Regression test for the P1 finding on PR #5765: the fire-and-forget
    // `invite_sent` import had no lifecycle hook, so a serverless runtime
    // could freeze the function before it ever emitted. Fails before the
    // fix (no waitUntil wiring existed) and passes after.
    mockExecute.mockResolvedValue({ rows: [], rowsAffected: 1 });
    const waitUntil = vi.fn();
    const event = {
      ...makeEvent("/_agent-native/org/invitations", {
        email: "new@example.test",
        role: "member",
      }),
      waitUntil,
    };

    await expect(createInvitationHandler(event)).resolves.toMatchObject({
      email: "new@example.test",
    });

    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
  });

  it("keeps invite_sent background work pending until providers flush", async () => {
    let releaseFlush!: () => void;
    mockFlushTracking.mockImplementationOnce(
      () => new Promise((resolve) => (releaseFlush = () => resolve([]))),
    );
    mockExecute.mockResolvedValue({ rows: [], rowsAffected: 1 });
    const waitUntil = vi.fn();
    await createInvitationHandler({
      ...makeEvent("/_agent-native/org/invitations", {
        email: "new@example.test",
        role: "member",
      }),
      waitUntil,
    });
    let settled = false;
    const registered = (waitUntil.mock.calls[0][0] as Promise<void>).then(
      () => {
        settled = true;
      },
    );

    await vi.waitFor(() => expect(mockFlushTracking).toHaveBeenCalled());
    expect(mockTrack).toHaveBeenCalledWith(
      "invite_sent",
      expect.anything(),
      expect.anything(),
    );
    expect(settled).toBe(false);

    releaseFlush();
    await registered;
    expect(settled).toBe(true);
  });

  it("waits for federated invitation approval before inserting local membership", async () => {
    mockExecute.mockImplementation(async (input: { sql: string }) => {
      const sql = input.sql;
      if (sql.includes("SELECT id, org_id AS")) {
        return {
          rows: [
            {
              id: "invite-1",
              orgId: "org-1",
              role: "member",
              invitedBy: "owner@example.test",
            },
          ],
        };
      }
      if (sql.includes("SELECT role, federation_removal_pending_at")) {
        return { rows: [] };
      }
      if (sql.includes("SELECT name, identity_authority")) {
        return {
          rows: [
            {
              name: "Example",
              identity_authority: "https://dispatch.example.test",
              identity_id: "dispatch-org-1",
            },
          ],
        };
      }
      if (sql.includes("SELECT role FROM org_members")) {
        return { rows: [{ role: "owner" }] };
      }
      return { rows: [], rowsAffected: 1 };
    });
    mockEvaluateFeatureFlagStrict.mockResolvedValue(true);
    mockAddFederatedOrganizationMember.mockImplementation(async () => {
      expect(
        mockExecute.mock.calls.some(([input]) =>
          input.sql.includes("INSERT INTO org_members"),
        ),
      ).toBe(false);
      return true;
    });

    // A `waitUntil`-carrying event, so we can assert the handler forwards it
    // to `trackInviteAccepted` instead of discarding the telemetry promise
    // (PR #5765 review: fire-and-forget telemetry can be dropped mid-flight
    // on a serverless runtime).
    const event = {
      ...makeEvent("/_agent-native/org/invitations/invite-1/accept"),
      waitUntil: vi.fn(),
    };

    await expect(acceptInvitationHandler(event)).resolves.toMatchObject({
      orgId: "org-1",
      role: "member",
    });
    expect(mockAddFederatedOrganizationMember).toHaveBeenCalled();
    expect(mockTrackInviteAccepted).toHaveBeenCalledWith({
      email: "member@example.test",
      orgId: "org-1",
      role: "member",
      invitedBy: "owner@example.test",
      federated: true,
      event,
    });
    expect(
      mockExecute.mock.calls.some(([input]) =>
        input.sql.includes("INSERT INTO org_members"),
      ),
    ).toBe(true);
  });

  it("accepts linked invitations locally when federation is disabled", async () => {
    mockExecute.mockImplementation(async (input: { sql: string }) => {
      const sql = input.sql;
      if (sql.includes("SELECT id, org_id AS")) {
        return {
          rows: [
            {
              id: "invite-1",
              orgId: "org-1",
              role: "member",
              invitedBy: "owner@example.test",
            },
          ],
        };
      }
      if (sql.includes("SELECT role, federation_removal_pending_at")) {
        return { rows: [] };
      }
      if (sql.includes("SELECT name, identity_authority")) {
        return {
          rows: [
            {
              name: "Example",
              identity_authority: "https://dispatch.example.test",
              identity_id: "dispatch-org-1",
            },
          ],
        };
      }
      if (sql.includes("SELECT role FROM org_members")) {
        return { rows: [{ role: "owner" }] };
      }
      return { rows: [], rowsAffected: 1 };
    });

    await expect(
      acceptInvitationHandler(
        makeEvent("/_agent-native/org/invitations/invite-1/accept"),
      ),
    ).resolves.toMatchObject({ orgId: "org-1", role: "member" });
    expect(mockAddFederatedOrganizationMember).not.toHaveBeenCalled();
    expect(
      mockExecute.mock.calls.some(([input]) =>
        input.sql.includes("INSERT INTO org_members"),
      ),
    ).toBe(true);
  });

  it("leaves a new member invitation pending when app-role assignment fails", async () => {
    mockExecute.mockImplementation(async (input: { sql: string }) => {
      const sql = input.sql;
      if (sql.includes("SELECT id, org_id AS")) {
        return {
          rows: [
            {
              id: "invite-1",
              orgId: "org-1",
              role: "member",
              invitedBy: "owner@example.test",
              appRolesJson: "{invalid",
            },
          ],
        };
      }
      if (sql.includes("SELECT role, federation_removal_pending_at")) {
        return { rows: [] };
      }
      if (sql.includes("SELECT name, identity_authority")) {
        return { rows: [{ name: "Example" }] };
      }
      if (sql.includes("SELECT role FROM org_members")) {
        return { rows: [{ role: "owner" }] };
      }
      return { rows: [], rowsAffected: 1 };
    });

    await expect(
      acceptInvitationHandler(
        makeEvent("/_agent-native/org/invitations/invite-1/accept"),
      ),
    ).rejects.toThrow();
    expect(
      mockExecute.mock.calls.some(([input]) =>
        input.sql.includes("UPDATE org_invitations SET status = 'accepted'"),
      ),
    ).toBe(false);
    expect(
      mockExecute.mock.calls.some(([input]) =>
        input.sql.includes("INSERT INTO org_members"),
      ),
    ).toBe(true);
  });

  it("leaves an existing member invitation pending when app-role assignment fails", async () => {
    mockExecute.mockImplementation(async (input: { sql: string }) => {
      const sql = input.sql;
      if (sql.includes("SELECT id, org_id AS")) {
        return {
          rows: [
            {
              id: "invite-1",
              orgId: "org-1",
              role: "member",
              invitedBy: "owner@example.test",
              appRolesJson: "{invalid",
            },
          ],
        };
      }
      if (sql.includes("SELECT role, federation_removal_pending_at")) {
        return { rows: [{ role: "member" }] };
      }
      if (sql.includes("SELECT name, identity_authority")) {
        return { rows: [{ name: "Example" }] };
      }
      return { rows: [], rowsAffected: 1 };
    });

    await expect(
      acceptInvitationHandler(
        makeEvent("/_agent-native/org/invitations/invite-1/accept"),
      ),
    ).rejects.toThrow();
    expect(
      mockExecute.mock.calls.some(([input]) =>
        input.sql.includes("UPDATE org_invitations SET status = 'accepted'"),
      ),
    ).toBe(false);
  });

  it("lets a pending member finish local cleanup after authority confirmation", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ role: "member", name: "Example" }] })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 });
    mockRevokeFederatedOrganizationMember.mockResolvedValue(true);

    await expect(
      retryPendingFederatedRemovalHandler(
        makeEvent("/_agent-native/org/federation-removal/retry", {
          orgId: "org-1",
          transferTo: "successor@example.test",
        }),
      ),
    ).resolves.toEqual({ success: true, orgId: "org-1" });
    expect(mockRevokeFederatedOrganizationMember).toHaveBeenCalledWith(
      expect.anything(),
      {
        orgId: "org-1",
        actorEmail: "member@example.test",
        actorRole: "member",
        memberEmail: "member@example.test",
      },
    );
    expect(putUserSetting).toHaveBeenCalledWith(
      "member@example.test",
      "active-org-id",
      { orgId: null },
    );
    expect(mockOffboardMember).toHaveBeenCalledWith(
      expect.anything(),
      "member@example.test",
      expect.objectContaining({
        transferTo: "successor@example.test",
        orgId: "org-1",
        actorEmail: "member@example.test",
      }),
    );
  });

  it("keeps pending cleanup retryable when the authority is still unavailable", async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{ role: "member", name: "Example" }],
      rowsAffected: 0,
    });
    mockRevokeFederatedOrganizationMember.mockRejectedValue(
      new Error("identity authority unavailable"),
    );

    await expect(
      retryPendingFederatedRemovalHandler(
        makeEvent("/_agent-native/org/federation-removal/retry", {
          orgId: "org-1",
          transferTo: "successor@example.test",
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(mockOffboardMember).not.toHaveBeenCalled();
  });

  it("searches organization members by profile name as well as email", async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          email: "bob@example.test",
          role: "member",
          joinedAt: 2,
          totalCount: 1,
        },
      ],
    });
    mockGetUserProfiles.mockResolvedValue(
      new Map([
        [
          "alice@example.test",
          { email: "alice@example.test", name: "Alice Jones" },
        ],
        ["bob@example.test", { email: "bob@example.test", name: "Bob Smith" }],
      ]),
    );

    await expect(
      listMembersHandler(
        makeEvent("/_agent-native/org/members?search=smith&limit=1&offset=0"),
      ),
    ).resolves.toMatchObject({
      totalCount: 1,
      hasMore: false,
      nextOffset: null,
      members: [
        {
          email: "bob@example.test",
          name: "Bob Smith",
        },
      ],
    });
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute.mock.calls[0][0].sql).toContain(
      "LOWER(COALESCE(u.name, '')) LIKE",
    );
    expect(mockGetUserProfiles).toHaveBeenCalledWith(["bob@example.test"]);
  });

  it("keeps SQL name matches when profile hydration is partial", async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          email: "bob@example.test",
          role: "member",
          joinedAt: 2,
          totalCount: 1,
        },
      ],
    });
    mockGetUserProfiles.mockResolvedValue(new Map());

    await expect(
      listMembersHandler(
        makeEvent("/_agent-native/org/members?search=smith&limit=1"),
      ),
    ).resolves.toMatchObject({
      totalCount: 1,
      members: [{ email: "bob@example.test", image: null }],
    });
  });

  it("rejects malformed workspace app visibility defaults", async () => {
    await expect(
      setWorkspaceAppDefaultVisibilityHandler(
        makeEvent("/_agent-native/org/workspace-app-default-visibility", {
          visibility: "everyone",
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "visibility must be either private or org.",
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("returns a total count with a paginated member page", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ totalCount: 31 }] })
      .mockResolvedValueOnce({
        rows: [
          { email: "alice@example.test", role: "owner", joinedAt: 1 },
          { email: "bob@example.test", role: "member", joinedAt: 2 },
          { email: "carol@example.test", role: "member", joinedAt: 3 },
        ],
      });

    await expect(
      listMembersHandler(
        makeEvent("/_agent-native/org/members?limit=2&offset=0"),
      ),
    ).resolves.toMatchObject({
      totalCount: 31,
      hasMore: true,
      nextOffset: 2,
      members: [
        { email: "alice@example.test", role: "owner", joinedAt: 1 },
        { email: "bob@example.test", role: "member", joinedAt: 2 },
      ],
    });
  });

  describe("deleteOrgHandler", () => {
    it("deletes invitations, settings, members, and the org, then repoints active-org-id", async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ name: "Example" }], rowsAffected: 0 }) // SELECT name
        .mockResolvedValueOnce({ rows: [], rowsAffected: 2 }) // DELETE org_invitations
        .mockResolvedValueOnce({ rows: [], rowsAffected: 4 }) // DELETE app_secrets
        .mockResolvedValueOnce({ rows: [], rowsAffected: 5 }) // DELETE settings
        .mockResolvedValueOnce({ rows: [], rowsAffected: 3 }) // DELETE org_members
        .mockResolvedValueOnce({ rows: [], rowsAffected: 1 }) // DELETE organizations
        .mockResolvedValueOnce({ rows: [{ orgId: "org-2" }], rowsAffected: 0 }); // SELECT next org

      const result = await deleteOrgHandler(
        makeEvent("/_agent-native/org", { name: "  example  " }),
      );

      expect(result).toEqual({
        success: true,
        orgId: "org-1",
        nextOrgId: "org-2",
      });

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledTimes(7);
      expect(mockExecute.mock.calls[1][0].sql).toContain(
        "DELETE FROM org_invitations WHERE org_id = ?",
      );
      expect(mockExecute.mock.calls[1][0].args).toEqual(["org-1"]);
      expect(mockExecute.mock.calls[2][0].sql).toContain(
        "DELETE FROM app_secrets WHERE scope IN ('org', 'workspace') AND scope_id = ?",
      );
      expect(mockExecute.mock.calls[2][0].args).toEqual(["org-1"]);
      expect(mockExecute.mock.calls[3][0].sql).toContain(
        "DELETE FROM public.settings WHERE key LIKE ? ESCAPE '!'",
      );
      expect(mockExecute.mock.calls[3][0].args).toEqual(["o:org-1:%"]);
      expect(mockExecute.mock.calls[4][0].sql).toContain(
        "DELETE FROM org_members WHERE org_id = ?",
      );
      expect(mockExecute.mock.calls[4][0].args).toEqual(["org-1"]);
      expect(mockExecute.mock.calls[5][0].sql).toContain(
        "DELETE FROM organizations WHERE id = ?",
      );
      expect(mockExecute.mock.calls[5][0].args).toEqual(["org-1"]);

      expect(putUserSetting).toHaveBeenCalledWith(
        "owner@example.test",
        "active-org-id",
        {
          orgId: "org-2",
        },
      );
    });

    it("repoints active-org-id to null (Personal) when the caller has no other org", async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ name: "Example" }], rowsAffected: 0 })
        .mockResolvedValueOnce({ rows: [], rowsAffected: 2 })
        .mockResolvedValueOnce({ rows: [], rowsAffected: 4 })
        .mockResolvedValueOnce({ rows: [], rowsAffected: 5 })
        .mockResolvedValueOnce({ rows: [], rowsAffected: 3 })
        .mockResolvedValueOnce({ rows: [], rowsAffected: 1 })
        .mockResolvedValueOnce({ rows: [], rowsAffected: 0 }); // no other membership

      const result = await deleteOrgHandler(
        makeEvent("/_agent-native/org", { name: "Example" }),
      );

      expect(result).toEqual({
        success: true,
        orgId: "org-1",
        nextOrgId: null,
      });
      expect(putUserSetting).toHaveBeenCalledWith(
        "owner@example.test",
        "active-org-id",
        {
          orgId: null,
        },
      );
    });

    it("rejects a non-owner with 403 and performs no queries", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "admin@example.test",
        orgId: "org-1",
        orgName: "Example",
        role: "admin",
      });

      await expect(
        deleteOrgHandler(makeEvent("/_agent-native/org", { name: "Example" })),
      ).rejects.toMatchObject({
        statusCode: 403,
        message: "Only the organization owner can delete an organization",
      });
      expect(mockExecute).not.toHaveBeenCalled();
      expect(putUserSetting).not.toHaveBeenCalled();
    });

    it("rejects a mismatched confirmation name with 400 and performs no deletes", async () => {
      mockExecute.mockResolvedValueOnce({
        rows: [{ name: "Example" }],
        rowsAffected: 0,
      });

      await expect(
        deleteOrgHandler(
          makeEvent("/_agent-native/org", { name: "Not The Org Name" }),
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: "Organization name does not match",
      });
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(putUserSetting).not.toHaveBeenCalled();
    });

    it("rejects deletion of a linked organization", async () => {
      mockExecute.mockResolvedValueOnce({
        rows: [
          {
            name: "Example",
            identity_authority: "https://dispatch.agent-native.com",
            identity_id: "canonical-org-1",
          },
        ],
      });

      await expect(
        deleteOrgHandler(makeEvent("/_agent-native/org", { name: "Example" })),
      ).rejects.toMatchObject({
        statusCode: 409,
        message:
          "Federated organizations cannot be deleted from an individual app",
      });
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("rejects with 400 when there is no active organization", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "owner@example.test",
        orgId: null,
        orgName: null,
        role: null,
      });

      await expect(
        deleteOrgHandler(makeEvent("/_agent-native/org", { name: "Example" })),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // `cachedMemberships` holds a JOIN of org_members and organizations for 15s
  // across requests. Anything that edits a column inside that projection —
  // `role`, `name`, `allowed_domain` — must evict it, or the process keeps
  // authorizing and rendering from the pre-write snapshot until the TTL lapses.
  describe("setDomainHandler", () => {
    it("lets an admin turn on auto-join for their own domain", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "admin@example.test",
        orgId: "org-1",
        orgName: "Example",
        role: "admin",
      });

      await expect(
        setDomainHandler(
          makeEvent("/_agent-native/org/domain", { domain: "example.test" }),
        ),
      ).resolves.toEqual({ domain: "example.test" });
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining(
            "UPDATE organizations SET allowed_domain",
          ),
          args: ["example.test", "org-1"],
        }),
      );
    });

    it("rejects a member", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "member@example.test",
        orgId: "org-1",
        orgName: "Example",
        role: "member",
      });

      await expect(
        setDomainHandler(
          makeEvent("/_agent-native/org/domain", { domain: "example.test" }),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  describe("membership cache invalidation", () => {
    function seedCachedMemberships() {
      const load = vi.fn(async () => [{ orgId: "org-1", role: "admin" }]);
      return {
        load,
        prime: () => cachedMemberships("member@example.test", load),
      };
    }

    beforeEach(() => {
      __resetProcessMemberOrgCacheForTests();
    });

    it("evicts the cached role when a member is demoted", async () => {
      const { load, prime } = seedCachedMemberships();
      await prime();
      await prime();
      expect(load).toHaveBeenCalledTimes(1);

      mockExecute.mockResolvedValue({ rows: [{ role: "admin" }] });
      await changeMemberRoleHandler(
        makeEvent("/_agent-native/org/members/member@example.test/role", {
          role: "member",
        }),
      );

      await prime();
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("propagates a role change before updating the local roster", async () => {
      mockExecute.mockResolvedValue({ rows: [{ role: "member" }] });
      mockUpdateFederatedOrganizationMemberRole.mockResolvedValue(true);

      await changeMemberRoleHandler(
        makeEvent("/_agent-native/org/members/member@example.test/role", {
          role: "admin",
        }),
      );

      expect(mockUpdateFederatedOrganizationMemberRole).toHaveBeenCalledWith(
        expect.anything(),
        {
          orgId: "org-1",
          actorEmail: "owner@example.test",
          actorRole: "owner",
          memberEmail: "member@example.test",
          memberRole: "admin",
        },
      );
    });

    it("records the role change in the organization audit log", async () => {
      mockExecute.mockResolvedValue({ rows: [{ role: "member" }] });
      mockUpdateFederatedOrganizationMemberRole.mockResolvedValue(true);

      await changeMemberRoleHandler(
        makeEvent("/_agent-native/org/members/member@example.test/role", {
          role: "admin",
        }),
      );

      expect(mockRecordOrgAdminAuditEvent).toHaveBeenCalledWith({
        action: "change-member-role",
        targetType: "org-member-role",
        targetId: "member@example.test",
        summary: "Changed member@example.test from member to admin",
        userEmail: "owner@example.test",
        orgId: "org-1",
        args: {
          email: "member@example.test",
          previousRole: "member",
          role: "admin",
        },
      });
    });

    it("evicts the cached org name when the org is renamed", async () => {
      const { load, prime } = seedCachedMemberships();
      await prime();
      expect(load).toHaveBeenCalledTimes(1);

      await updateOrgHandler(
        makeEvent("/_agent-native/org", { name: "Renamed" }),
      );

      await prime();
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("evicts the cached allowed domain when domain auto-join is set", async () => {
      const { load, prime } = seedCachedMemberships();
      await prime();
      expect(load).toHaveBeenCalledTimes(1);

      await setDomainHandler(
        makeEvent("/_agent-native/org/domain", { domain: "example.test" }),
      );

      await prime();
      expect(load).toHaveBeenCalledTimes(2);
    });
  });
});
