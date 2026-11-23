import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serializeActionQueryParams } from "@agent-native/core/client/use-action";
import {
  closeDbExec,
  createGetDb,
  runMigrations,
  type MigrationEntry,
} from "@agent-native/core/db";
import { htmlBakedBuildId } from "@agent-native/core/deploy/served-build";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { configureAgentNativeEmbeddedEnvironment } from "@agent-native/core/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  creationReceiptSchema,
  projectCreationSchema,
} from "../shared/notebook-creation.js";
import {
  notebookHistoryReadSchema,
  savedProjectVersionSchema,
} from "../shared/notebook-history.js";
import { operationReceiptSchema } from "../shared/notebook-operations.js";
import { CONTRACT_VERSION } from "../shared/notebook-snapshot-contract.js";

const origin = "http://127.0.0.1:3000";
const workspaceId = randomUUID();
const owner = "notebook-owner@example.test";
const member = "notebook-member@example.test";
const loadBuild = createRequire(import.meta.url);
const nitroRuntime = globalThis as typeof globalThis & {
  __nitro__?: {
    default?: { hooks?: { callHook(name: "close"): Promise<void> } };
  };
};
let app: { fetch(request: Request): Promise<Response> };
let directory: string | undefined;
let ownerCookie: string;
let memberCookie: string;

function request(path: string, cookie: string, body?: unknown) {
  return app.fetch(
    new Request(new URL(path, origin), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin,
        cookie,
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        "x-agent-native-frontend": "1",
      },
      body: JSON.stringify(body),
    }),
  );
}

async function signIn(email: string) {
  const credentials = { email, password: randomBytes(24).toString("hex") };
  expect(
    (await request("/_agent-native/auth/register", "", credentials)).status,
  ).toBe(200);
  const login = await request("/_agent-native/auth/login", "", credentials);
  expect(login.status).toBe(200);
  return login.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

async function readAction(
  name: string,
  args: Record<string, unknown>,
  cookie = ownerCookie,
) {
  return request(
    `/_agent-native/actions/${name}?${serializeActionQueryParams(args)}`,
    cookie,
  );
}

async function writeAction(
  name: string,
  args: Record<string, unknown>,
  cookie = ownerCookie,
) {
  return request(`/_agent-native/actions/${name}`, cookie, args);
}

beforeAll(async () => {
  expect(loadBuild("../.output/nitro.json")).toMatchObject({
    preset: "standard",
  });
  directory = await mkdtemp(join(tmpdir(), "analytics-notebook-build-"));
  const databaseUrl = `pglite:${join(directory, "database")}`;
  vi.stubEnv("DATABASE_URL", databaseUrl);
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("BETTER_AUTH_URL", origin);
  vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("AUTH_SKIP_EMAIL_VERIFICATION", "1");
  vi.stubEnv("AUTH_MAGIC_LINK", "0");
  vi.stubEnv("AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT", "1");
  vi.stubEnv("AGENT_NATIVE_DISABLE_INPROCESS_SWEEPS", "1");
  vi.stubEnv("AGENT_NATIVE_CONFIG_RUNTIME_AUTH_ENABLED", "true");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubGlobal("__AGENT_NATIVE_EMBEDDED_RUNTIME__", undefined);
  vi.stubGlobal("__nitro__", undefined);
  configureAgentNativeEmbeddedEnvironment({ databaseUrl });
  const migrations = ORG_MIGRATIONS.map(
    ({ name, ...entry }): MigrationEntry =>
      name === undefined ? entry : { ...entry, name },
  );
  await runMigrations(migrations, { table: "qa_notebook_org_migrations" })(
    null,
  );
  const db = createGetDb({ organizations, orgMembers })();
  await db.insert(organizations).values({
    id: workspaceId,
    name: "Notebook proof",
    createdBy: owner,
    createdAt: Date.now(),
  });
  await db.insert(orgMembers).values(
    [owner, member].map((email) => ({
      id: randomUUID(),
      email,
      orgId: workspaceId,
      role: email === owner ? "owner" : "member",
      joinedAt: Date.now(),
    })),
  );
  await closeDbExec();
  ({ default: app } = loadBuild("../.output/server/index.mjs"));
  ownerCookie = await signIn(owner);
  memberCookie = await signIn(member);
  const ui = await request("/_agent-native/ui-capability", ownerCookie);
  expect(ui.status).toBe(200);
  ownerCookie = [
    ownerCookie,
    ...ui.headers.getSetCookie().map((value) => value.split(";", 1)[0]),
  ].join("; ");
}, 60_000);

afterAll(async () => {
  try {
    await nitroRuntime.__nitro__?.default?.hooks?.callHook("close");
    await closeDbExec();
    if (directory) await rm(directory, { recursive: true, force: true });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

it("recovers the exact creation receipt and opens the independently listed draft through compiled actions", async () => {
  const params = { requestId: randomUUID() };
  const initial = await writeAction("create-project", params);
  expect(initial.status).toBe(200);
  const recovered = await readAction("get-project-creation", params);
  expect(recovered.status).toBe(200);
  const read = projectCreationSchema.parse(await recovered.json());
  if (read.status !== "committed")
    throw new Error("First draft was not committed");
  const { receipt } = read;
  expect(receipt.snapshot.metadata.title).toBe("Untitled project");
  expect(receipt.snapshot.snapshot.head).toEqual({
    versionId: receipt.workingVersionId,
    revision: "0",
  });

  const rename = await writeAction("apply-notebook-operation", {
    protocol: CONTRACT_VERSION,
    projectId: receipt.projectId,
    workingVersionId: receipt.workingVersionId,
    opId: randomUUID(),
    observedHead: receipt.snapshot.snapshot.head,
    changes: [
      {
        type: "set-metadata",
        expectedMetadataRevision: receipt.snapshot.resources.metadataRevision,
        metadata: { title: "Revenue review" },
      },
    ],
  });
  expect(rename.status, await rename.clone().text()).toBe(200);
  const updated = operationReceiptSchema.parse(await rename.json());
  expect(updated.status).toBe("applied");
  const replay = await writeAction("create-project", params);
  expect(replay.status).toBe(200);
  expect(creationReceiptSchema.parse(await replay.json())).toEqual(receipt);
  expect(creationReceiptSchema.parse(await initial.json())).toEqual(receipt);

  const list = await readAction("list-projects", { search: "Revenue review" });
  expect(list.status).toBe(200);
  expect(
    z
      .object({
        projects: z.array(z.object({ id: z.string(), title: z.string() })),
      })
      .parse(await list.json()).projects,
  ).toEqual([{ id: receipt.projectId, title: "Revenue review" }]);
  const page = await request(receipt.href, ownerCookie);
  expect(page.status).toBe(200);
  expect(htmlBakedBuildId(await page.text())).toBe(
    process.env.AGENT_NATIVE_BUILD_ID ?? expect.any(String),
  );
  const open = await readAction("get-project", {
    projectId: receipt.projectId,
  });
  expect(await open.json()).toMatchObject({
    viewer: { orgId: workspaceId, email: owner },
    project: {
      id: receipt.projectId,
      workingVersionId: receipt.workingVersionId,
      title: "Revenue review",
      cells: [],
    },
  });
  const stale = await writeAction("save-project-version", {
    projectId: receipt.projectId,
    observedHead: receipt.snapshot.snapshot.head,
    name: "Stale checkpoint",
    opId: randomUUID(),
  });
  expect(stale.status).toBe(409);
  const checkpoint = await writeAction("save-project-version", {
    projectId: receipt.projectId,
    observedHead: updated.nextHead,
    name: "Revenue checkpoint",
    opId: randomUUID(),
  });
  expect(checkpoint.status).toBe(200);
  const saved = savedProjectVersionSchema.parse(await checkpoint.json());
  const history = await readAction("list-notebook-history", {
    projectId: receipt.projectId,
    filter: "versions",
  });
  expect(history.status).toBe(200);
  expect(
    notebookHistoryReadSchema.parse(await history.json()).items,
  ).toContainEqual({
    kind: "version",
    id: `version:${saved.version.id}`,
    version: saved.version,
  });
  const denied = await writeAction(
    "create-project",
    { requestId: randomUUID() },
    memberCookie,
  );
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({
    errorCode: "project_create_denied",
  });
});
