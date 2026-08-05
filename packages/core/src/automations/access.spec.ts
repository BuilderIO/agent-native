import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  loadGrants: vi.fn(),
  loadOverlays: vi.fn(),
  resourceGet: vi.fn(),
  resourceListAllOwners: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));

vi.mock("../resources/store.js", () => ({
  SHARED_OWNER: "__shared__",
  organizationIdFromResourceOwner: (owner: string) =>
    owner.startsWith("__organization__:")
      ? owner.slice("__organization__:".length)
      : null,
  resourceGet: mocks.resourceGet,
  resourceListAllOwners: mocks.resourceListAllOwners,
}));

vi.mock("./sharing-store.js", () => ({
  loadAutomationSharingGrants: mocks.loadGrants,
  loadAutomationSharingOverlays: mocks.loadOverlays,
}));

import {
  listAccessibleAutomations,
  resolveAutomationAccess,
} from "./access.js";

interface TestResourceOptions {
  id: string;
  name?: string;
  owner: string;
  createdBy?: string;
  orgId?: string;
  explicit?: boolean;
}

function testResource(options: TestResourceOptions) {
  const frontmatter = [
    "---",
    'schedule: "0 8 * * *"',
    "enabled: true",
    ...(options.explicit ? ["triggerType: schedule"] : []),
    ...(options.createdBy ? [`createdBy: ${options.createdBy}`] : []),
    ...(options.orgId ? [`orgId: ${options.orgId}`] : []),
    ...(options.createdBy ? ["runAs: creator"] : []),
    "---",
    "",
    "Do the work.",
  ].join("\n");
  return {
    id: options.id,
    owner: options.owner,
    path: `jobs/${options.name ?? options.id}.md`,
    content: frontmatter,
    mimeType: "text/markdown",
    size: frontmatter.length,
    createdAt: 1,
    updatedAt: 1,
    createdBy: "user" as const,
    visibility: "workspace" as const,
    threadId: null,
    runId: null,
    expiresAt: null,
    metadata: null,
  };
}

function overlay(
  resourceId: string,
  visibility: "private" | "organization",
  organizationId: string | null,
) {
  return {
    resourceId,
    visibility,
    organizationId,
    createdAt: 1,
    updatedAt: 1,
  };
}

function grant(
  resourceId: string,
  email: string,
  role: "view" | "collaborate",
) {
  return {
    resourceId,
    email,
    role,
    createdAt: 1,
    updatedAt: 1,
  };
}

let membershipRows: Array<{ org_id: string; email: string }>;
let profileRows: Array<{
  email: string;
  name: string | null;
  image?: string | null;
}>;

beforeEach(() => {
  vi.clearAllMocks();
  membershipRows = [];
  profileRows = [];
  mocks.loadOverlays.mockResolvedValue(new Map());
  mocks.loadGrants.mockResolvedValue(new Map());
  mocks.resourceGet.mockResolvedValue(null);
  mocks.resourceListAllOwners.mockResolvedValue([]);
  mocks.execute.mockImplementation(async (statement: { sql: string }) => {
    if (statement.sql.includes("FROM org_members")) {
      return { rows: membershipRows };
    }
    if (statement.sql.includes('FROM "user"')) {
      return { rows: profileRows };
    }
    throw new Error(`Unexpected query: ${statement.sql}`);
  });
});

describe("automation access", () => {
  it("returns owners, organization viewers, and explicit view/collaborate grants with centralized capabilities", async () => {
    const resources = [
      testResource({
        id: "owned",
        owner: "alice@example.com",
        createdBy: "alice@example.com",
        explicit: true,
      }),
      testResource({
        id: "org",
        owner: "__organization__:org-1",
        createdBy: "creator@example.com",
        orgId: "org-1",
        explicit: true,
      }),
      testResource({
        id: "view",
        owner: "owner@example.com",
        createdBy: "owner@example.com",
        explicit: true,
      }),
      testResource({
        id: "collaborate",
        owner: "outside-owner@example.com",
        createdBy: "outside-owner@example.com",
        explicit: true,
      }),
    ];
    mocks.resourceListAllOwners.mockResolvedValue(resources);
    mocks.loadOverlays.mockResolvedValue(
      new Map([
        ["owned", overlay("owned", "private", null)],
        ["org", overlay("org", "organization", "org-1")],
        ["view", overlay("view", "private", null)],
        ["collaborate", overlay("collaborate", "private", null)],
      ]),
    );
    mocks.loadGrants.mockResolvedValue(
      new Map([
        [
          "owned",
          [
            grant("owned", " Viewer@Example.com ", "view"),
            grant("owned", "missing@example.com", "collaborate"),
          ],
        ],
        [
          "view",
          [
            grant("view", "alice@example.com", "view"),
            grant("view", "other-viewer@example.com", "view"),
          ],
        ],
        [
          "collaborate",
          [
            grant("collaborate", "alice@example.com", "collaborate"),
            grant("collaborate", "other-editor@example.com", "collaborate"),
          ],
        ],
      ]),
    );
    membershipRows = [
      { org_id: "org-1", email: "alice@example.com" },
      { org_id: "org-1", email: "creator@example.com" },
    ];
    profileRows = [
      { email: "creator@example.com", name: "Creator Name", image: null },
      {
        email: "viewer@example.com",
        name: "Viewer Name",
        image: "https://example.com/viewer.png",
      },
    ];

    const result = await listAccessibleAutomations({
      userEmail: "Alice@Example.com",
    });

    expect(
      result.map(({ resource, effectiveRole }) => [resource.id, effectiveRole]),
    ).toEqual([
      ["collaborate", "collaborate"],
      ["org", "view"],
      ["owned", "owner"],
      ["view", "view"],
    ]);
    expect(result.find((entry) => entry.resource.id === "owned")).toMatchObject(
      {
        capabilities: {
          canEdit: true,
          canOperate: true,
          canDelete: true,
          canManageSharing: true,
        },
        sharing: {
          source: "explicit",
          visibility: "private",
          grants: [
            {
              email: "viewer@example.com",
              role: "view",
              name: "Viewer Name",
              avatar: "https://example.com/viewer.png",
            },
            {
              email: "missing@example.com",
              role: "collaborate",
              name: null,
              avatar: null,
            },
          ],
        },
        classification: { kind: "automation" },
      },
    );
    expect(result.find((entry) => entry.resource.id === "org")).toMatchObject({
      capabilities: {
        canEdit: false,
        canOperate: false,
        canDelete: false,
        canManageSharing: false,
      },
      creator: { label: "Creator Name" },
    });
    expect(
      result.find((entry) => entry.resource.id === "collaborate")?.capabilities,
    ).toMatchObject({ canEdit: true, canOperate: true, canDelete: false });
    expect(
      result.find((entry) => entry.resource.id === "view")?.sharing,
    ).toMatchObject({ grantCount: 2 });
    expect(
      result.find((entry) => entry.resource.id === "view")?.sharing,
    ).not.toHaveProperty("grants");
    expect(
      result.find((entry) => entry.resource.id === "collaborate")?.sharing,
    ).toMatchObject({ grantCount: 2 });
    expect(
      result.find((entry) => entry.resource.id === "collaborate")?.sharing,
    ).not.toHaveProperty("grants");
  });

  it("allows personal resources to use organization and specific-sharing overlay context without changing their owner", async () => {
    const organizationVisible = testResource({
      id: "personal-organization",
      owner: "owner@example.com",
      createdBy: "owner@example.com",
      explicit: true,
    });
    const specificallyShared = testResource({
      id: "personal-specific",
      owner: "owner@example.com",
      createdBy: "owner@example.com",
      explicit: true,
    });
    mocks.resourceListAllOwners.mockResolvedValue([
      organizationVisible,
      specificallyShared,
    ]);
    mocks.loadOverlays.mockResolvedValue(
      new Map([
        [
          "personal-organization",
          overlay("personal-organization", "organization", "org-1"),
        ],
        ["personal-specific", overlay("personal-specific", "private", "org-1")],
      ]),
    );
    mocks.loadGrants.mockResolvedValue(
      new Map([
        [
          "personal-specific",
          [grant("personal-specific", "member@example.com", "collaborate")],
        ],
      ]),
    );
    membershipRows = [{ org_id: "org-1", email: "member@example.com" }];

    const memberResult = await listAccessibleAutomations({
      userEmail: "member@example.com",
    });
    expect(memberResult).toEqual([
      expect.objectContaining({
        resource: expect.objectContaining({ id: "personal-organization" }),
        effectiveRole: "view",
        owningOrganizationId: null,
        sharing: expect.objectContaining({
          visibility: "organization",
          organizationId: "org-1",
        }),
      }),
      expect.objectContaining({
        resource: expect.objectContaining({ id: "personal-specific" }),
        effectiveRole: "collaborate",
        owningOrganizationId: null,
        sharing: expect.objectContaining({
          visibility: "private",
          organizationId: "org-1",
        }),
      }),
    ]);

    const ownerResult = await listAccessibleAutomations({
      userEmail: "owner@example.com",
    });
    expect(ownerResult).toHaveLength(2);
    expect(ownerResult.every((entry) => entry.effectiveRole === "owner")).toBe(
      true,
    );
  });

  it("removes organization visibility with membership but preserves an explicit grant", async () => {
    const organizationOnly = testResource({
      id: "organization-only",
      owner: "owner@example.com",
      createdBy: "owner@example.com",
      explicit: true,
    });
    const explicitlyGranted = testResource({
      id: "explicitly-granted",
      owner: "owner@example.com",
      createdBy: "owner@example.com",
      explicit: true,
    });
    mocks.resourceListAllOwners.mockResolvedValue([
      organizationOnly,
      explicitlyGranted,
    ]);
    mocks.loadOverlays.mockResolvedValue(
      new Map([
        [
          "organization-only",
          overlay("organization-only", "organization", "org-1"),
        ],
        [
          "explicitly-granted",
          overlay("explicitly-granted", "organization", "org-1"),
        ],
      ]),
    );
    mocks.loadGrants.mockResolvedValue(
      new Map([
        [
          "explicitly-granted",
          [grant("explicitly-granted", "removed@example.com", "view")],
        ],
      ]),
    );
    membershipRows = [];

    const result = await listAccessibleAutomations({
      userEmail: "removed@example.com",
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      resource: { id: "explicitly-granted" },
      effectiveRole: "view",
    });
  });

  it("removes access after grant revocation or organization membership removal", async () => {
    const granted = testResource({
      id: "granted",
      owner: "owner@example.com",
      createdBy: "owner@example.com",
    });
    const organization = testResource({
      id: "organization",
      owner: "__organization__:org-1",
      createdBy: "creator@example.com",
      orgId: "org-1",
    });
    mocks.resourceListAllOwners.mockResolvedValue([granted, organization]);
    mocks.loadOverlays.mockResolvedValue(
      new Map([
        ["granted", overlay("granted", "private", null)],
        ["organization", overlay("organization", "organization", "org-1")],
      ]),
    );
    membershipRows = [{ org_id: "org-1", email: "creator@example.com" }];

    await expect(
      listAccessibleAutomations({ userEmail: "alice@example.com" }),
    ).resolves.toEqual([]);
  });

  it("honors an outside-organization explicit grant without inventing membership", async () => {
    const resource = testResource({
      id: "outside",
      owner: "__organization__:org-1",
      createdBy: "creator@example.com",
      orgId: "org-1",
      explicit: true,
    });
    mocks.resourceListAllOwners.mockResolvedValue([resource]);
    mocks.loadOverlays.mockResolvedValue(
      new Map([["outside", overlay("outside", "private", "org-1")]]),
    );
    mocks.loadGrants.mockResolvedValue(
      new Map([
        ["outside", [grant("outside", "guest@example.com", "collaborate")]],
      ]),
    );
    membershipRows = [{ org_id: "org-1", email: "creator@example.com" }];

    const [result] = await listAccessibleAutomations({
      userEmail: "guest@example.com",
    });
    expect(result).toMatchObject({
      effectiveRole: "collaborate",
      owningOrganizationId: "org-1",
    });
    expect(membershipRows).not.toContainEqual(
      expect.objectContaining({ email: "guest@example.com" }),
    );
  });

  it("fails closed for malformed or removed organization creators", async () => {
    const missingCreator = testResource({
      id: "missing",
      owner: "__organization__:org-1",
      orgId: "org-1",
    });
    const mismatchedOrg = testResource({
      id: "mismatch",
      owner: "__organization__:org-1",
      createdBy: "creator@example.com",
      orgId: "org-2",
    });
    const removedCreator = testResource({
      id: "removed",
      owner: "__organization__:org-1",
      createdBy: "removed@example.com",
      orgId: "org-1",
    });
    mocks.resourceListAllOwners.mockResolvedValue([
      missingCreator,
      mismatchedOrg,
      removedCreator,
    ]);
    mocks.loadOverlays.mockResolvedValue(
      new Map([["removed", overlay("removed", "organization", "org-1")]]),
    );
    membershipRows = [{ org_id: "org-1", email: "alice@example.com" }];

    await expect(
      listAccessibleAutomations({ userEmail: "alice@example.com" }),
    ).resolves.toEqual([]);
  });

  it("keeps duplicate names under different owners as distinct stable-id rows", async () => {
    const first = testResource({
      id: "first",
      name: "digest",
      owner: "first@example.com",
      createdBy: "first@example.com",
    });
    const second = testResource({
      id: "second",
      name: "digest",
      owner: "second@example.com",
      createdBy: "second@example.com",
    });
    mocks.resourceListAllOwners.mockResolvedValue([second, first]);
    mocks.loadOverlays.mockResolvedValue(
      new Map([
        ["first", overlay("first", "private", null)],
        ["second", overlay("second", "private", null)],
      ]),
    );
    mocks.loadGrants.mockResolvedValue(
      new Map([
        ["first", [grant("first", "alice@example.com", "view")]],
        ["second", [grant("second", "alice@example.com", "view")]],
      ]),
    );

    const result = await listAccessibleAutomations({
      userEmail: "alice@example.com",
    });
    expect(result.map(({ name, resource }) => [name, resource.id])).toEqual([
      ["digest", "first"],
      ["digest", "second"],
    ]);
  });

  it("does not disclose whether an inaccessible resource id exists", async () => {
    const inaccessible = testResource({
      id: "secret-id",
      owner: "owner@example.com",
      createdBy: "owner@example.com",
      explicit: true,
    });
    mocks.resourceGet
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(inaccessible);

    const missing = await resolveAutomationAccess(
      { userEmail: "alice@example.com" },
      "secret-id",
    );
    const denied = await resolveAutomationAccess(
      { userEmail: "alice@example.com" },
      "secret-id",
    );

    expect(missing).toBeNull();
    expect(denied).toBeNull();
  });

  it("preserves no-overlay legacy personal, organization, and __shared__ behavior", async () => {
    const resources = [
      testResource({
        id: "personal",
        owner: "alice@example.com",
        createdBy: "alice@example.com",
      }),
      testResource({
        id: "other-personal",
        owner: "other@example.com",
        createdBy: "other@example.com",
      }),
      testResource({
        id: "legacy-org",
        owner: "__organization__:org-1",
        createdBy: "creator@example.com",
        orgId: "org-1",
      }),
      testResource({
        id: "legacy-shared",
        owner: "__shared__",
      }),
    ];
    mocks.resourceListAllOwners.mockResolvedValue(resources);
    membershipRows = [
      { org_id: "org-1", email: "alice@example.com" },
      { org_id: "org-1", email: "creator@example.com" },
    ];

    const result = await listAccessibleAutomations({
      userEmail: "alice@example.com",
    });

    expect(
      result.map(({ resource, effectiveRole, sharing }) => ({
        id: resource.id,
        role: effectiveRole,
        source: sharing.source,
        visibility: sharing.visibility,
      })),
    ).toEqual([
      {
        id: "legacy-org",
        role: "view",
        source: "legacy",
        visibility: "organization",
      },
      {
        id: "legacy-shared",
        role: "view",
        source: "legacy",
        visibility: "shared",
      },
      {
        id: "personal",
        role: "owner",
        source: "legacy",
        visibility: "private",
      },
    ]);
    expect(
      result.find((entry) => entry.resource.id === "legacy-shared"),
    ).toMatchObject({
      immutableCreator: null,
      classification: { kind: "job" },
      capabilities: { canOperate: false },
    });
  });

  it("batches overlays, grants, owner and overlay memberships, and profile labels for the list", async () => {
    const organizationResources = Array.from({ length: 20 }, (_, index) =>
      testResource({
        id: `job-${index}`,
        owner: "__organization__:org-1",
        createdBy: `creator-${index}@example.com`,
        orgId: "org-1",
      }),
    );
    const overlayOrganizationResource = testResource({
      id: "personal-overlay-org",
      owner: "personal-owner@example.com",
      createdBy: "personal-owner@example.com",
    });
    const resources = [...organizationResources, overlayOrganizationResource];
    mocks.resourceListAllOwners.mockResolvedValue(resources);
    mocks.loadOverlays.mockResolvedValue(
      new Map([
        [
          "personal-overlay-org",
          overlay("personal-overlay-org", "organization", "org-2"),
        ],
      ]),
    );
    mocks.loadGrants.mockResolvedValue(
      new Map(
        organizationResources.map((resource, index) => [
          resource.id,
          [grant(resource.id, `grant-${index}@example.com`, "view")],
        ]),
      ),
    );
    membershipRows = [
      { org_id: "org-1", email: "alice@example.com" },
      ...organizationResources.map((_, index) => ({
        org_id: "org-1",
        email: `creator-${index}@example.com`,
      })),
      { org_id: "org-2", email: "alice@example.com" },
    ];

    await listAccessibleAutomations({ userEmail: "alice@example.com" });

    expect(mocks.resourceListAllOwners).toHaveBeenCalledTimes(1);
    expect(mocks.loadOverlays).toHaveBeenCalledTimes(1);
    expect(mocks.loadGrants).toHaveBeenCalledTimes(1);
    const membershipQueries = mocks.execute.mock.calls.filter(([statement]) =>
      statement.sql.includes("FROM org_members"),
    );
    const profileQueries = mocks.execute.mock.calls.filter(([statement]) =>
      statement.sql.includes('FROM "user"'),
    );
    expect(membershipQueries).toHaveLength(1);
    expect(membershipQueries[0]?.[0].args).toEqual(
      expect.arrayContaining(["org-1", "org-2"]),
    );
    expect(profileQueries).toHaveLength(1);
    expect(profileQueries[0]?.[0].args).toEqual(
      expect.arrayContaining([
        "creator-0@example.com",
        "creator-19@example.com",
        "grant-0@example.com",
        "grant-19@example.com",
        "personal-owner@example.com",
      ]),
    );
  });
});
