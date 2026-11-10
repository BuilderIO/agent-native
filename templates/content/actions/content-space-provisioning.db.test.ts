import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const provisionContentSpaces = vi.hoisted(() => vi.fn());

vi.mock("./_content-spaces.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_content-spaces.js")>();
  provisionContentSpaces.mockImplementation(actual.provisionContentSpaces);
  return { ...actual, provisionContentSpaces };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `content-space-provisioning-${process.pid}-${Date.now()}.pglite`,
);

let personalContentSpaceId: typeof import("./_content-spaces.js").personalContentSpaceId;
let organizationContentSpaceId: typeof import("./_content-spaces.js").organizationContentSpaceId;
let ensureContentSpacesAction: typeof import("./ensure-content-spaces.js").default;
let createDocumentAction: typeof import("./create-document.js").default;
let createContentDatabaseAction: typeof import("./create-content-database.js").default;

const as = <T>(email: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: email }, run);

type CreatePageInput = Parameters<
  typeof import("./create-document.js").default.run
>[0];
const pageInput = (
  input: Omit<CreatePageInput, "preserveLeadingTitleHeading" | "reuseLabels">,
): CreatePageInput => ({
  preserveLeadingTitleHeading: false,
  reuseLabels: [],
  ...input,
});

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  ({ personalContentSpaceId, organizationContentSpaceId } =
    await import("./_content-spaces.js"));
  ensureContentSpacesAction = (await import("./ensure-content-spaces.js"))
    .default;
  createDocumentAction = (await import("./create-document.js")).default;
  createContentDatabaseAction = (await import("./create-content-database.js"))
    .default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

beforeEach(() => {
  provisionContentSpaces.mockClear();
});

describe("creating in a workspace", () => {
  it("skips the workspace setup pass when the workspace already exists", async () => {
    const user = "provisioned@example.com";
    await as(user, () => ensureContentSpacesAction.run({}));
    provisionContentSpaces.mockClear();
    const personalSpaceId = personalContentSpaceId(user);

    const byId = await as(user, () =>
      createDocumentAction.run(
        pageInput({
          title: "By id",
          spaceId: personalSpaceId,
        }),
      ),
    );
    const byDefault = await as(user, () =>
      createDocumentAction.run(pageInput({ title: "By default" })),
    );
    const byName = await as(user, () =>
      createDocumentAction.run(
        pageInput({
          title: "By name",
          spaceName: "Personal",
        }),
      ),
    );
    const database = await as(user, () =>
      createContentDatabaseAction.run({
        spaceId: personalSpaceId,
        title: "Tracker",
        idempotencyKey: "provisioned-tracker",
      }),
    );

    expect([byId, byDefault, byName].map((page) => page.spaceId)).toEqual([
      personalSpaceId,
      personalSpaceId,
      personalSpaceId,
    ]);
    expect(database.database.spaceId).toBe(personalSpaceId);
    expect(provisionContentSpaces).not.toHaveBeenCalled();
  });

  it("sets up a new account's workspaces on its first page", async () => {
    const user = "first-page@example.com";

    const page = await as(user, () =>
      createDocumentAction.run(pageInput({ title: "First" })),
    );

    expect(page.spaceId).toBe(personalContentSpaceId(user));
    expect(provisionContentSpaces).toHaveBeenCalledTimes(1);
  });

  it("sets up a new account's workspaces when its first page names one", async () => {
    const user = "first-page-by-id@example.com";
    const personalSpaceId = personalContentSpaceId(user);

    const page = await as(user, () =>
      createDocumentAction.run(
        pageInput({
          title: "First",
          spaceId: personalSpaceId,
        }),
      ),
    );

    expect(page.spaceId).toBe(personalSpaceId);
    expect(provisionContentSpaces).toHaveBeenCalledTimes(1);
  });

  it("still refuses a workspace the caller cannot see", async () => {
    const owner = "workspace-owner@example.com";
    const outsider = "workspace-outsider@example.com";
    await as(owner, () => ensureContentSpacesAction.run({}));
    await as(outsider, () => ensureContentSpacesAction.run({}));
    provisionContentSpaces.mockClear();

    await expect(
      as(outsider, () =>
        createDocumentAction.run(
          pageInput({
            title: "Not mine",
            spaceId: personalContentSpaceId(owner),
          }),
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "SPACE_NOT_FOUND" });
    expect(provisionContentSpaces).not.toHaveBeenCalled();
  });

  it("sets up the workspace of an organization the caller just joined", async () => {
    const user = "new-member@example.com";
    await as(user, () => ensureContentSpacesAction.run({}));
    await getDbExec().execute({
      sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
      args: ["org-just-joined", "Just joined", user, Date.now()],
    });
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
      args: [
        "member-just-joined",
        "org-just-joined",
        user,
        "member",
        Date.now(),
      ],
    });
    provisionContentSpaces.mockClear();
    const orgSpaceId = organizationContentSpaceId("org-just-joined");

    const page = await as(user, () =>
      createDocumentAction.run(
        pageInput({
          title: "In the new organization",
          spaceId: orgSpaceId,
        }),
      ),
    );

    expect(page.spaceId).toBe(orgSpaceId);
    expect(provisionContentSpaces).toHaveBeenCalledTimes(1);
  });

  it("sets up an organization the caller just joined when a page names it", async () => {
    const user = "new-member-by-name@example.com";
    await as(user, () => ensureContentSpacesAction.run({}));
    await getDbExec().execute({
      sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
      args: ["org-joined-by-name", "Joined by name", user, Date.now()],
    });
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
      args: [
        "member-joined-by-name",
        "org-joined-by-name",
        user,
        "member",
        Date.now(),
      ],
    });
    provisionContentSpaces.mockClear();

    const page = await as(user, () =>
      createDocumentAction.run(
        pageInput({
          title: "In the organization named",
          spaceName: "Joined by name",
        }),
      ),
    );

    expect(page.spaceId).toBe(organizationContentSpaceId("org-joined-by-name"));
    expect(provisionContentSpaces).toHaveBeenCalledTimes(1);
  });

  it("finds a new organization that shares a name with an existing workspace", async () => {
    const user = "shared-name@example.com";
    const join = async (orgId: string) => {
      await getDbExec().execute({
        sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
        args: [orgId, "Shared name", user, Date.now()],
      });
      await getDbExec().execute({
        sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
        args: [`member-${orgId}`, orgId, user, "member", Date.now()],
      });
    };
    await join("org-shared-name-old");
    await as(user, () => ensureContentSpacesAction.run({}));
    await join("org-shared-name-new");
    provisionContentSpaces.mockClear();

    await expect(
      as(user, () =>
        createDocumentAction.run(
          pageInput({
            title: "Which one",
            spaceName: "Shared name",
          }),
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "SPACE_NAME_AMBIGUOUS" });
    expect(provisionContentSpaces).toHaveBeenCalledTimes(1);
  });

  it("refuses an unknown workspace name without the setup pass", async () => {
    const user = "unknown-name@example.com";
    await as(user, () => ensureContentSpacesAction.run({}));
    provisionContentSpaces.mockClear();

    await expect(
      as(user, () =>
        createDocumentAction.run(
          pageInput({
            title: "Nowhere",
            spaceName: "No such workspace",
          }),
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "SPACE_NAME_NOT_FOUND" });
    expect(provisionContentSpaces).not.toHaveBeenCalled();
  });
});
