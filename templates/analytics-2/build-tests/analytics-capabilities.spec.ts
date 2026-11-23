import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { serializeActionQueryParams } from "@agent-native/core/client/use-action";
import {
  closeDbExec,
  createGetDb,
  runMigrations,
  type MigrationEntry,
} from "@agent-native/core/db";
import { htmlBakedBuildId } from "@agent-native/core/deploy/served-build";
import { RECURRING_JOBS_SWEEP_PATH } from "@agent-native/core/jobs";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
} from "@agent-native/core/private-blob";
import { configureAgentNativeEmbeddedEnvironment } from "@agent-native/core/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryRouter,
  generatePath,
  matchRoutes,
  Outlet,
  RouterProvider,
  type ServerBuild,
} from "react-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { builtinEnvironments } from "vitest/runtime";
import { z } from "zod";

import messages from "../app/i18n/en-US.js";
import {
  routeCatalog,
  type ResolvedRoute,
} from "../app/routes/routing/registry.js";
import { getDb, schema } from "../server/db/index.js";
import {
  ANALYTICS_CONTROL_IDS,
  analyticsCapabilityDefinitions,
} from "../server/lib/analytics-capabilities.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { seedLegacyPublishedProject } from "../server/model/legacy-published-fixture.test-support.js";
import { createProject } from "../server/model/projects-store.js";
import { appSessionProjectionSchema } from "../shared/app-session-operations.js";
import { capabilityDecisionSchema } from "../shared/capabilities.js";
import { draftHeadSchema } from "../shared/notebook-snapshot-contract.js";
import {
  publishPreviewDetailSchema,
  publishPreviewReceiptSchema,
  publishProjectReceiptSchema,
} from "../shared/project-publish.js";
import {
  findPublishedAppColleaguesOutput,
  listPublishedAppAccessOutput,
  setPublishedAppAccessOutput,
} from "../shared/project-sharing.js";
import {
  listScheduleRunsOutput,
  setScheduleOutput,
} from "../shared/published-app-schedules.js";
import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";

const origin = "http://127.0.0.1:3000";
const owner = "compiled-owner@example.test";
const member = "compiled-member@example.org";
const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const draftOwner = "compiled-draft-owner@example.test";
const editor = "compiled-editor@example.test";
const viewer = "compiled-viewer@example.test";
const outsider = "compiled-outsider@example.test";
const proofProjectId = "mounted-proof-project";
const proofCellId = "mounted-proof-sql";
const proofTitle = "Mounted readback project";
const publishProofId = "mounted-publish-project";
const publishProofCellId = "mounted-publish-sql";
const sharingProofId = "mounted-share-project";
const sharingProofCellId = "mounted-share-sql";
const scheduleProofId = "mounted-schedule-project";
const scheduleProofCellId = "mounted-schedule-sql";
const memberDirectoryId = randomUUID();
const blobProviderId = "compiled-publish-proof";
const blobs = new Map<string, Uint8Array>();
const actorCookies = new Map<string, string>();
const scope = { kind: "workspace", workspaceId };
const endpoint = "/_agent-native/actions/";
const targets = analyticsCapabilityDefinitions.flatMap(
  ({ target, postcondition }) => [target, postcondition],
);
const loadBuild = createRequire(import.meta.url);
const nitroRuntime = globalThis as typeof globalThis & {
  __nitro__?: {
    default?: { hooks?: { callHook(name: "close"): Promise<void> } };
  };
};
let app: { fetch(request: Request): Promise<Response> };
let build: ServerBuild;
let directory: string | undefined;
let ownerCookie: string;
let memberCookie: string;

function request(path: string, cookie = "", body?: unknown) {
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

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

async function signIn(
  email: string,
  role: "owner" | "member",
  orgId = workspaceId,
) {
  const credentials = { email, password: randomBytes(24).toString("hex") };
  expect(
    (await request("/_agent-native/auth/register", "", credentials)).status,
  ).toBe(200);
  const login = await request("/_agent-native/auth/login", "", credentials);
  expect(login.status).toBe(200);
  const cookie = cookies(login);
  const membership = await request("/_agent-native/org/me", cookie);
  expect(await membership.json()).toMatchObject({
    email,
    orgId,
    role,
  });
  return cookie;
}

beforeAll(async () => {
  expect(
    loadBuild("../.output/nitro.json"),
    "Build with NITRO_PRESET=standard",
  ).toMatchObject({ preset: "standard" });
  directory = await mkdtemp(join(tmpdir(), "analytics-capabilities-build-"));
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
  registerPrivateBlobProvider({
    id: blobProviderId,
    name: "Compiled publish proof storage",
    isConfigured: () => true,
    async put({ key, data }) {
      if (!key) throw new Error("Expected a result segment key");
      blobs.set(key, Uint8Array.from(data));
      return {
        id: key,
        provider: blobProviderId,
        opaque: true,
        encrypted: false,
      };
    },
    async read(handle) {
      const data = blobs.get(handle.id);
      if (!data) throw new Error("The result fixture is missing");
      return { data, handle };
    },
    async delete({ id }) {
      return { deleted: blobs.delete(id), provider: blobProviderId };
    },
  });

  const migrations = ORG_MIGRATIONS.map(
    ({ name, ...entry }): MigrationEntry =>
      name === undefined ? entry : { ...entry, name },
  );
  await runMigrations(migrations, { table: "qa_c1_org_migrations" })(null);
  const db = createGetDb({ organizations, orgMembers, appMemberRoles })();
  await db.insert(organizations).values(
    [workspaceId, otherWorkspaceId].map((id) => ({
      id,
      name: id === workspaceId ? "Capability proof" : "Other workspace",
      createdBy: owner,
      createdAt: Date.now(),
    })),
  );
  await db.insert(orgMembers).values(
    [
      { email: owner, role: "owner" },
      { email: member, role: "member" },
      { email: draftOwner, role: "member" },
      { email: editor, role: "member" },
      { email: viewer, role: "member" },
      { email: outsider, role: "member" },
    ].map((actor) => ({
      ...actor,
      id: actor.email === member ? memberDirectoryId : randomUUID(),
      orgId: actor.email === outsider ? otherWorkspaceId : workspaceId,
      joinedAt: Date.now(),
    })),
  );
  await db.insert(appMemberRoles).values({
    id: randomUUID(),
    orgId: workspaceId,
    appId: "analytics-2",
    email: editor,
    role: "editor",
    updatedAt: Date.now(),
    updatedBy: owner,
  });
  await ensureAnalyticsDatabase();
  const draftScope = { ownerEmail: draftOwner, orgId: workspaceId };
  await createProject({
    ...draftScope,
    projectId: proofProjectId,
    title: proofTitle,
    cells: [
      {
        id: proofCellId,
        kind: "sql",
        label: "Orders proof",
        source: "select order_id from orders order by order_id limit 2",
        dataConnectionId: SAMPLE_DATA_SOURCE_ID,
        databaseSchema: null,
        resultVariable: null,
        outputResult: true,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
      },
    ],
  });
  await seedLegacyPublishedProject(draftScope, proofProjectId);
  for (const [projectId, cellId, source] of [
    [
      publishProofId,
      publishProofCellId,
      "select 62 as total from orders limit 1",
    ],
    [
      sharingProofId,
      sharingProofCellId,
      "select 11042 as total from orders limit 1",
    ],
    [
      scheduleProofId,
      scheduleProofCellId,
      "select 15040 as total from orders limit 1",
    ],
  ] as const) {
    await createProject({
      ...draftScope,
      projectId,
      title: "Mounted publish proof",
      cells: [
        {
          id: cellId,
          kind: "sql",
          label: "Published sentinel",
          source,
          dataConnectionId: SAMPLE_DATA_SOURCE_ID,
          databaseSchema: null,
          resultVariable: null,
          outputResult: true,
          hidden: false,
          gridX: 0,
          gridY: 0,
          gridWidth: 12,
          gridHeight: 2,
        },
      ],
    });
  }
  await getDb()
    .insert(schema.projectShares)
    .values(
      [proofProjectId, publishProofId].map((resourceId) => ({
        id: randomUUID(),
        resourceId,
        principalType: "user" as const,
        principalId: viewer,
        role: "viewer" as const,
        createdBy: draftOwner,
        createdAt: new Date().toISOString(),
      })),
    );
  await closeDbExec();

  ({ default: app } = loadBuild("../.output/server/index.mjs"));
  build = loadBuild("../build/server/index.js");
  ownerCookie = await signIn(owner, "owner");
  memberCookie = await signIn(member, "member");
  for (const actor of [draftOwner, editor, viewer, outsider])
    actorCookies.set(
      actor,
      await signIn(
        actor,
        "member",
        actor === outsider ? otherWorkspaceId : workspaceId,
      ),
    );
}, 60_000);

afterAll(async () => {
  try {
    await nitroRuntime.__nitro__?.default?.hooks?.callHook("close");
    await closeDbExec();
    if (directory) await rm(directory, { recursive: true, force: true });
  } finally {
    unregisterPrivateBlobProvider(blobProviderId);
    blobs.clear();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

function resolvesMountedRoute(id: string) {
  const route = routeCatalog.find((entry) => entry.id === id);
  if (!route?.path) return false;
  const path = generatePath(route.path, {
    projectLocator: "compiled-project",
    version: "compiled-version",
  });
  const routes = Object.values(build.routes).flatMap((entry) =>
    entry?.parentId === "root" && entry.path !== undefined
      ? [{ path: entry.path, component: entry.module.default }]
      : [],
  );
  const match = matchRoutes(routes, path)?.at(-1)?.route;
  const MountedRoute = match?.component;
  if (!match || !MountedRoute) return false;
  const router = createMemoryRouter(
    [
      {
        element: createElement(Outlet, {
          context: {
            renderFrame: (view: ResolvedRoute) => view.id,
          },
        }),
        children: [{ path: match.path, element: createElement(MountedRoute) }],
      },
    ],
    { initialEntries: [path] },
  );
  try {
    return (
      renderToStaticMarkup(createElement(RouterProvider, { router })) === id
    );
  } finally {
    router.dispose();
  }
}

async function registeredAction(name: string, cookie: string) {
  const path = endpoint + name;
  for (const body of [undefined, { manifestProbe: 1 }]) {
    const response = await request(
      body ? path : path + "?manifestProbe=1",
      cookie,
      body,
    );
    if (response.status === 400) {
      const body = z.object({ error: z.string() }).parse(await response.json());
      if (body.error.includes("Invalid action parameters")) return true;
    }
  }
  return false;
}

function verifyManifest(actionNames: Set<string>, routeIds: Set<string>) {
  for (const target of targets) {
    switch (target.kind) {
      case "action":
        if (!actionNames.has(target.actionName))
          throw new Error(`Unregistered action ${target.actionName}`);
        break;
      case "route":
        if (!routeIds.has(target.routeId))
          throw new Error(`Unmounted route ${target.routeId}`);
        break;
      default:
        throw new Error(`Missing compiled adapter for ${target.kind}`);
    }
  }
}

it("resolves every enabled target and readback in the compiled app and rejects a missing registration", async () => {
  const page = await request("/home/data");
  expect(page.status).toBe(200);
  const bakedBuildId = htmlBakedBuildId(await page.text());
  expect(bakedBuildId).toEqual(
    process.env.AGENT_NATIVE_BUILD_ID ?? expect.any(String),
  );
  const uiCapability = await request(
    "/_agent-native/ui-capability",
    ownerCookie,
  );
  expect(uiCapability.status).toBe(200);
  const cookie = `${ownerCookie}; ${cookies(uiCapability)}`;
  const actionNames = new Set<string>();
  const routeIds = new Set<string>();
  for (const target of targets) {
    if (
      target.kind === "action" &&
      !actionNames.has(target.actionName) &&
      (await registeredAction(target.actionName, cookie))
    )
      actionNames.add(target.actionName);
    if (target.kind === "route" && resolvesMountedRoute(target.routeId))
      routeIds.add(target.routeId);
  }
  verifyManifest(actionNames, routeIds);
  expect(resolvesMountedRoute("app-latest")).toBe(true);
  for (const name of ["create-project", "get-project"]) {
    const missing = new Set(actionNames);
    missing.delete(name);
    expect(() => verifyManifest(missing, routeIds)).toThrow(
      `Unregistered action ${name}`,
    );
  }
  routeIds.delete("data-browser");
  expect(() => verifyManifest(actionNames, routeIds)).toThrow(
    "Unmounted route data-browser",
  );
});

it("agrees with the compiled direct project action for an owner and a denied member", async () => {
  const { createProject, unsupportedConnector, placeholderColumn } =
    ANALYTICS_CONTROL_IDS;
  const query = serializeActionQueryParams({
    scope,
    controlIds: [createProject, unsupportedConnector, placeholderColumn],
  });
  const projectionPath = `${endpoint}get-analytics-capabilities?${query}`;
  expect((await request(projectionPath)).status).toBe(401);
  const readDecisions = async (cookie: string) => {
    const response = await request(projectionPath, cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-agent-native-browser-persist")).toBeNull();
    return z
      .object({ decisions: z.array(capabilityDecisionSchema) })
      .parse(await response.json()).decisions;
  };
  expect(await readDecisions(ownerCookie)).toEqual([
    {
      controlId: createProject,
      scope,
      status: "allowed",
      target: { kind: "action", actionName: "create-project" },
    },
    ...[unsupportedConnector, placeholderColumn].map((controlId) => ({
      controlId,
      scope,
      status: "unavailable",
      reason: "unsupported",
    })),
  ]);
  expect(await readDecisions(memberCookie)).toContainEqual({
    controlId: createProject,
    scope,
    status: "denied",
    reason: "access_denied",
  });

  const projectTitle = "Compiled capability proof";
  const created = await request(endpoint + "create-project", ownerCookie, {
    title: projectTitle,
  });
  expect(created.status).toBe(200);
  const { id } = z
    .object({ id: z.string().min(1) })
    .parse(await created.json());
  const readback = await request(
    `${endpoint}get-project?${serializeActionQueryParams({ projectId: id })}`,
    ownerCookie,
  );
  expect(readback.status).toBe(200);
  expect(await readback.json()).toMatchObject({
    project: { id, title: projectTitle },
  });

  const denied = await request(endpoint + "create-project", memberCookie, {
    title: "Denied capability proof",
  });
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({
    errorCode: "project_create_denied",
  });
  const memberProjects = await request(
    endpoint + "list-projects",
    memberCookie,
  );
  expect(await memberProjects.json()).toMatchObject({ projects: [] });
});

function read(name: string, params: Record<string, unknown>, cookie: string) {
  return request(
    `${endpoint}${name}?${serializeActionQueryParams(params)}`,
    cookie,
  );
}

function post(name: string, params: object, cookie: string) {
  return request(endpoint + name, cookie, params);
}

async function publishCompiledProject(projectId: string, owner: string) {
  const loaded = await read("get-project", { projectId }, owner);
  expect(loaded.status).toBe(200);
  const { project } = z
    .object({
      project: z.object({
        draftHead: draftHeadSchema,
        publishedVersionId: z.null(),
      }),
    })
    .parse(await loaded.json());
  const accepted = {
    projectId,
    expectedHead: project.draftHead,
    expectedReleaseId: project.publishedVersionId,
  };
  const created = await post(
    "create-project-publish-preview",
    { ...accepted, requestId: randomUUID() },
    owner,
  );
  expect(created.status).toBe(200);
  const { previewId } = publishPreviewReceiptSchema.parse(await created.json());
  const preview = async () => {
    const response = await read(
      "get-project-publish-preview",
      { projectId, previewId },
      owner,
    );
    expect(response.status).toBe(200);
    return publishPreviewDetailSchema.parse(await response.json());
  };
  await expect
    .poll(async () => (await preview()).state, { timeout: 20_000 })
    .toBe("ready");
  const checked = await preview();
  const committed = await post(
    "publish-project",
    {
      ...accepted,
      previewId,
      expectedManifestRevision: checked.manifestRevision,
      requestId: randomUUID(),
      mode: "ready",
    },
    owner,
  );
  expect(committed.status).toBe(200);
  const release = publishProjectReceiptSchema.parse(await committed.json());
  expect(release.manifestId).toBe(checked.manifestId);
  return { release, preview: checked };
}

it("publishes the compiled preview and reads its artifact through a separately scoped viewer session", async () => {
  const owner = actorCookies.get(draftOwner) ?? "";
  const reader = actorCookies.get(viewer) ?? "";
  const denied = actorCookies.get(outsider) ?? "";
  const projectId = publishProofId;
  const { release, preview } = await publishCompiledProject(projectId, owner);
  const resultId = preview.outputs.find(
    ({ cellId }) => cellId === publishProofCellId,
  )?.resultId;
  expect(resultId).toBeTruthy();
  const mounted = await request(release.releaseHref, reader);
  expect(mounted.status).toBe(200);
  expect(htmlBakedBuildId(await mounted.text())).toEqual(
    process.env.AGENT_NATIVE_BUILD_ID ?? expect.any(String),
  );
  const response = await post(
    "open-published-app-session",
    {
      projectId,
      version: "latest",
      openId: randomUUID(),
    },
    reader,
  );
  expect(response.status).toBe(200);
  const session = appSessionProjectionSchema.parse(await response.json());
  expect(session).toMatchObject({
    releaseId: release.releaseId,
    runId: null,
    baselineManifestId: release.manifestId,
  });
  const page = await read(
    "get-notebook-result-page",
    {
      resultId,
      sessionId: session.sessionId,
    },
    reader,
  );
  expect(page.status).toBe(200);
  expect(await page.json()).toMatchObject({ status: "ready", rows: [[62]] });
  for (const cookie of [owner, denied]) {
    const rejected = await read(
      "get-notebook-result-page",
      {
        resultId,
        sessionId: session.sessionId,
      },
      cookie,
    );
    expect(await rejected.json()).toMatchObject({
      status: cookie === denied ? "absent" : "denied",
    });
  }
  expect(resolvesMountedRoute("app-latest")).toBe(true);
});

it("serves the compiled app-only grant to a signed-in colleague and rejects the revoked session", async () => {
  const owner = actorCookies.get(draftOwner) ?? "";
  const { release } = await publishCompiledProject(sharingProofId, owner);
  const project = { projectId: sharingProofId };
  const directory = await read(
    "find-published-app-colleagues",
    { ...project, query: member },
    owner,
  );
  expect(directory.status).toBe(200);
  expect(
    findPublishedAppColleaguesOutput.parse(await directory.json()).people,
  ).toEqual([expect.objectContaining({ id: memberDirectoryId })]);
  const added = await post(
    "set-published-app-access",
    {
      ...project,
      opId: randomUUID(),
      expectedRevision: "0",
      change: {
        kind: "grant",
        memberId: memberDirectoryId,
        role: "app_viewer",
      },
    },
    owner,
  );
  expect(added.status).toBe(200);
  const receipt = setPublishedAppAccessOutput.parse(await added.json());
  expect(receipt).toMatchObject({
    effect: "added",
    revision: "1",
    appHref: `/app/${sharingProofId}/latest`,
  });
  const listed = await read("list-published-app-access", project, owner);
  expect(listed.status).toBe(200);
  expect(listPublishedAppAccessOutput.parse(await listed.json())).toMatchObject(
    {
      ...project,
      generalAccess: "private",
      supportedRoles: ["app_viewer"],
      grants: [receipt.grant],
      appHref: receipt.appHref,
    },
  );
  const mounted = await request(receipt.appHref, memberCookie);
  expect(mounted.status).toBe(200);
  expect(htmlBakedBuildId(await mounted.text())).toEqual(
    process.env.AGENT_NATIVE_BUILD_ID ?? expect.any(String),
  );
  const sessionInput = { ...project, version: "latest", openId: randomUUID() };
  const opened = await post(
    "open-published-app-session",
    sessionInput,
    memberCookie,
  );
  expect(opened.status).toBe(200);
  const session = appSessionProjectionSchema.parse(await opened.json());
  expect(session).toMatchObject({ releaseId: release.releaseId, runId: null });
  expect(session.projection.canViewSource).toBe(false);
  const artifact = {
    sessionId: session.sessionId,
    resultId: session.projection.outputs[sharingProofCellId]?.resultId,
  };
  const page = await read("get-notebook-result-page", artifact, memberCookie);
  expect(await page.json()).toMatchObject({ status: "ready", rows: [[11042]] });
  const draft = await read("get-project", project, memberCookie);
  expect([403, 404]).toContain(draft.status);
  const controls = ["explore", "explore-new", "open-exploration"];
  const capability = await read(
    "get-analytics-capabilities",
    {
      scope: { kind: "project", workspaceId, ...project },
      controlIds: controls,
    },
    memberCookie,
  );
  expect(capability.status).toBe(200);
  expect(await capability.json()).toMatchObject({
    decisions: controls.map((controlId) => ({
      controlId,
      status: "unavailable",
      reason: "missing_backing",
    })),
  });
  const wrongOrg = await post(
    "open-published-app-session",
    sessionInput,
    actorCookies.get(outsider) ?? "",
  );
  expect(wrongOrg.status).toBe(404);
  const revoke = await post(
    "set-published-app-access",
    {
      ...project,
      opId: randomUUID(),
      expectedRevision: "1",
      change: { kind: "revoke", grantId: receipt.grant.id },
    },
    owner,
  );
  expect(revoke.status).toBe(200);
  expect(setPublishedAppAccessOutput.parse(await revoke.json())).toMatchObject({
    effect: "removed",
    revision: "2",
  });
  const resumed = await post(
    "open-published-app-session",
    { ...sessionInput, sessionId: session.sessionId },
    memberCookie,
  );
  expect(resumed.status).toBe(404);
  const rejected = await read(
    "get-notebook-result-page",
    artifact,
    memberCookie,
  );
  expect(await rejected.json()).toMatchObject({ status: "denied" });
});

it("runs the compiled minutely scheduler twice and exposes one new published result from E1", async () => {
  const owner = actorCookies.get(draftOwner) ?? "";
  const { release, preview } = await publishCompiledProject(
    scheduleProofId,
    owner,
  );
  const published = preview.outputs.find(
    ({ cellId }) => cellId === scheduleProofCellId,
  )?.resultId;
  expect(published).toBeTruthy();
  const project = { projectId: scheduleProofId };
  const grant = await post(
    "set-published-app-access",
    {
      ...project,
      opId: randomUUID(),
      expectedRevision: "0",
      change: {
        kind: "grant",
        memberId: memberDirectoryId,
        role: "app_viewer",
      },
    },
    owner,
  );
  expect(grant.status).toBe(200);
  const fetch = globalThis.fetch;
  const sends: { key: string | null; payload: unknown }[] = [];
  const mail = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      if (input !== "https://api.resend.com/emails") return fetch(input, init);
      const payload: unknown = JSON.parse(z.string().parse(init?.body));
      sends.push({
        key: new Headers(init?.headers).get("Idempotency-Key"),
        payload,
      });
      return Response.json({ id: "compiled-schedule-delivery" });
    });
  const cronSecret = randomBytes(32).toString("base64url");
  vi.stubEnv("CRON_SECRET", cronSecret);
  vi.stubEnv("RESEND_API_KEY", randomBytes(32).toString("base64url"));
  vi.stubEnv("EMAIL_FROM", "Schedule proof <schedule@example.org>");
  vi.stubEnv("AGENT_NATIVE_ENABLE_LOCAL_RECURRING_JOBS", "1");
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const due = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 60_000);
    const scheduleId = randomUUID();
    const response = await post(
      "set-published-app-schedule",
      {
        ...project,
        opId: randomUUID(),
        change: {
          kind: "create",
          scheduleId,
          config: {
            cadence: { kind: "hourly", minute: due.getUTCMinutes() },
            timezone: "UTC",
            recipients: [{ memberId: memberDirectoryId, on: "both" }],
          },
        },
      },
      owner,
    );
    expect(response.status).toBe(200);
    const receipt = setScheduleOutput.parse(await response.json());
    expect(
      Date.parse(z.iso.datetime().parse(receipt.schedule.nextFireAt)),
    ).toBe(due.getTime());
    const sweep = async (instant: number) => {
      vi.setSystemTime(instant);
      const response = await app.fetch(
        new Request(new URL(RECURRING_JOBS_SWEEP_PATH, origin), {
          headers: { authorization: `Bearer ${cronSecret}` },
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        appSweepHandlers: { failed: [] },
      });
    };
    const readRunLog = async () => {
      const log = await read(
        "list-published-app-schedule-runs",
        { ...project, scheduleId },
        owner,
      );
      expect(log.status).toBe(200);
      return listScheduleRunsOutput.parse(await log.json()).runs;
    };
    await sweep(due.getTime());
    await sweep(due.getTime());
    const [admitted] = await readRunLog();
    const runId = z.string().parse(admitted?.runId);
    await expect
      .poll(
        async () => {
          const run = await read("get-notebook-run", { runId }, owner);
          expect(run.status).toBe(200);
          return run.json();
        },
        { timeout: 5000 },
      )
      .toMatchObject({
        status: "found",
        events: expect.arrayContaining([
          expect.objectContaining({
            event: {
              type: "attempt",
              receipt: expect.objectContaining({
                state: { status: "complete", resultIds: [expect.any(String)] },
              }),
            },
          }),
        ]),
      });
    await sweep(due.getTime() + 60_000);
    const runs = await readRunLog();
    expect(runs).toEqual([
      expect.objectContaining({
        scheduleId,
        releaseId: release.releaseId,
        runId,
        status: "succeeded",
        cache: "updated",
        deliveries: [
          expect.objectContaining({
            memberId: memberDirectoryId,
            outcome: "sent",
          }),
        ],
      }),
    ]);
    expect(sends).toEqual([
      {
        key: expect.any(String),
        payload: expect.objectContaining({
          to: member,
          subject: "Scheduled run succeeded: Mounted publish proof",
          text: expect.stringContaining(
            `/app/${scheduleProofId}/${release.releaseId}`,
          ),
        }),
      },
    ]);
    const opened = await post(
      "open-published-app-session",
      { ...project, version: "latest", openId: randomUUID() },
      owner,
    );
    expect(opened.status).toBe(200);
    const session = appSessionProjectionSchema.parse(await opened.json());
    const resultId = session.projection.outputs[scheduleProofCellId]?.resultId;
    expect(resultId).toEqual(expect.any(String));
    expect(resultId).not.toBe(published);
    const page = await read(
      "get-notebook-result-page",
      { sessionId: session.sessionId, resultId },
      owner,
    );
    expect(await page.json()).toMatchObject({
      status: "ready",
      rows: [[15040]],
    });
    const mounted = await request(release.releaseHref, owner);
    expect(htmlBakedBuildId(await mounted.text())).toEqual(
      process.env.AGENT_NATIVE_BUILD_ID ?? expect.any(String),
    );
  } finally {
    mail.mockRestore();
    vi.useRealTimers();
    vi.stubEnv("CRON_SECRET", undefined);
    vi.stubEnv("RESEND_API_KEY", undefined);
    vi.stubEnv("EMAIL_FROM", undefined);
    vi.stubEnv("AGENT_NATIVE_ENABLE_LOCAL_RECURRING_JOBS", undefined);
  }
});

describe("mounted workspace capability matrix", () => {
  let teardownDom: () => Promise<void> | void;
  beforeAll(async () => {
    const dom = await builtinEnvironments.jsdom.setup(globalThis, {
      jsdom: { url: origin, pretendToBeVisual: true },
    });
    teardownDom = () => dom.teardown(globalThis);
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
    vi.stubEnv("NODE_ENV", "test");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(max-width: 1050px)",
      addEventListener() {},
      removeEventListener() {},
    }));
  });
  afterAll(async () => {
    await teardownDom();
    vi.stubEnv("NODE_ENV", "production");
  });

  it.each([
    ["owning Member", draftOwner, false, true, true],
    ["workspace Editor", editor, true, false, false],
    ["read-granted viewer", viewer, false, false, true],
    ["wrong workspace", outsider, false, false, false],
  ] as const)(
    "agrees with compiled actions and direct links for %s in the narrow shell",
    async (_name, email, canCreate, canRun, canOpen) => {
      const cookie = actorCookies.get(email);
      if (!cookie) throw new Error("Actor did not sign in");
      localStorage.clear();
      sessionStorage.clear();
      const { createRoot } = await import("react-dom/client");
      const { WorkspaceApplication } =
        await import("../app/components/workspace/WorkspaceApplication");
      const { default: ApplicationRoute } = await import("../app/routes/$");
      const { notifySessionInvalidated } =
        await import("@agent-native/core/client/use-session");
      const liveFetch = globalThis.fetch;
      vi.stubGlobal(
        "fetch",
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
            origin,
          );
          if (url.origin !== origin) return liveFetch(input, init);
          const req = new Request(url, input instanceof Request ? input : init);
          const headers = new Headers(req.headers);
          headers.set("origin", origin);
          headers.set("cookie", cookie);
          headers.set("sec-fetch-site", "same-origin");
          return app.fetch(new Request(req, { headers }));
        },
      );
      await notifySessionInvalidated();
      const host = document.createElement("div");
      document.body.append(host);
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const router = createMemoryRouter(
        [
          {
            element: createElement(WorkspaceApplication),
            children: [{ path: "*", element: createElement(ApplicationRoute) }],
          },
        ],
        { initialEntries: ["/home"] },
      );
      const root = createRoot(host);
      const button = (label: string) =>
        [...host.querySelectorAll("button")].find(
          (entry) =>
            entry.getAttribute("aria-label") === label ||
            entry.textContent === label,
        );
      const wait = (assertion: () => void) =>
        vi.waitFor(
          async () => {
            await act(async () => {});
            assertion();
          },
          { timeout: 10000 },
        );
      const show = async (path: string) => {
        await act(async () => router.navigate(path));
      };
      try {
        await act(async () =>
          root.render(
            createElement(QueryClientProvider, {
              client: qc,
              children: createElement(AgentNativeI18nProvider, {
                catalog: { messages },
                persistPreference: false,
                children: createElement(RouterProvider, { router }),
              }),
            }),
          ),
        );
        await wait(() => expect(button("Open navigation")).toBeDefined());
        await act(async () => button("Open navigation")?.click());
        await wait(() => expect(button("Project")?.disabled).toBe(!canCreate));
        expect(host.querySelectorAll('a[href="/home/data"]')).toHaveLength(
          canCreate ? 1 : 0,
        );
        await wait(() =>
          expect(host.querySelector(".ws-home-prompt")).not.toBeNull(),
        );
        expect(button("Generate an app")).toBeUndefined();
        expect(host.textContent).not.toContain("Context management");

        const created = await request(endpoint + "create-project", cookie, {
          title: `Action proof ${email}`,
        });
        expect(created.status).toBe(canCreate ? 200 : 403);
        if (canCreate) {
          await act(async () =>
            window.dispatchEvent(
              new KeyboardEvent("keydown", {
                altKey: true,
                shiftKey: true,
                key: "N",
                bubbles: true,
              }),
            ),
          );
          await wait(() =>
            expect(router.state.location.pathname).toMatch(
              /\/project\/[^/]+\/latest$/,
            ),
          );
          const createdId = router.state.location.pathname.split("/")[2];
          const readback = await request(
            endpoint +
              "get-project?" +
              serializeActionQueryParams({ projectId: createdId }),
            cookie,
          );
          expect(await readback.json()).toMatchObject({
            project: { id: createdId, title: "Untitled project" },
          });
        }

        await show(`/project/${proofProjectId}/latest`);
        if (canOpen)
          await wait(() => expect(host.textContent).toContain(proofTitle));
        else
          await wait(() => {
            const denied = host.querySelector(
              `[data-project-not-found="${proofProjectId}"]`,
            );
            expect(denied?.textContent).toContain("App unavailable");
            expect(denied?.textContent).toContain(
              "You don’t have access to this page.",
            );
          });
        const run = host.querySelector<HTMLButtonElement>(
          '[data-rid="notebook.cell.run"]',
        );
        if (canRun) expect(run?.disabled).toBe(false);
        else expect(run).toBeNull();
        const runResponse = await request(
          endpoint + "run-project-cell",
          cookie,
          {
            projectId: proofProjectId,
            cellId: proofCellId,
          },
        );
        if (canRun) {
          expect(runResponse.status).toBe(200);
          expect(await runResponse.json()).toMatchObject({
            status: "complete",
            output: { rowCount: 2 },
          });
        } else expect(runResponse.status).toBe(403);

        const readParams = {
          projectId: proofProjectId,
          version: "latest",
          surface: "app",
          viewId: randomUUID(),
        };
        const appRead = await request(
          endpoint + "get-project?" + serializeActionQueryParams(readParams),
          cookie,
        );
        expect(appRead.status).toBe(canOpen ? 200 : 404);
        await show(`/app/${proofProjectId}/latest`);
        if (canOpen)
          await wait(() => expect(host.textContent).toContain(proofTitle));
        else
          await wait(() => {
            const denied = host.querySelector("[data-published-app]");
            expect(denied?.textContent).toContain("App unavailable");
            expect(denied?.textContent).toContain(
              "You don’t have access to this page.",
            );
          });
        await show("/context-studio/evals/compare");
        expect(host.textContent).toContain("Page not found");
      } finally {
        await act(async () => root.unmount());
        router.dispose();
        qc.clear();
        host.remove();
        vi.stubGlobal("fetch", liveFetch);
      }
    },
    40_000,
  );
});

it("the compiled Ask transport reports missing setup and refuses a providerless submission", async () => {
  const page = await request("/home");
  expect(page.status).toBe(200);
  expect(htmlBakedBuildId(await page.text())).toEqual(
    process.env.AGENT_NATIVE_BUILD_ID ?? expect.any(String),
  );
  const readiness = await request(
    "/_agent-native/agent-engine/status",
    ownerCookie,
  );
  expect(readiness.status).toBe(200);
  expect(await readiness.json()).toMatchObject({
    configured: false,
    chatEligible: false,
  });

  const response = await request("/_agent-native/agent-chat", ownerCookie, {
    message: "Show monthly order totals",
    history: [],
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    code: "AGENT_CHAT_AI_SETUP_REQUIRED",
  });
});

it("the compiled notebook actions insert Python between the saved anchors", async () => {
  const created = await request(endpoint + "create-project", ownerCookie, {
    title: "Compiled notebook gap proof",
  });
  expect(created.status).toBe(200);
  const { id: projectId } = z
    .object({ id: z.string() })
    .parse(await created.json());
  async function insert(kind: "sql" | "code", afterCellId?: string) {
    const response = await request(endpoint + "add-project-cell", ownerCookie, {
      projectId,
      kind,
      afterCellId,
    });
    expect(response.status).toBe(200);
    return z.object({ createdCellId: z.string() }).parse(await response.json())
      .createdCellId;
  }
  const first = await insert("sql");
  const last = await insert("sql", first);
  const python = await insert("code", first);

  const page = await request(`/project/${projectId}/latest`);
  expect(page.status).toBe(200);
  expect(htmlBakedBuildId(await page.text())).toEqual(
    process.env.AGENT_NATIVE_BUILD_ID ?? expect.any(String),
  );
  const response = await request(
    endpoint + "get-project?" + serializeActionQueryParams({ projectId }),
    ownerCookie,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    project: {
      cells: [
        { id: first, contents: { kind: "sql", resultVariable: "dataframe" } },
        {
          id: python,
          contents: { kind: "code", language: "python", label: null },
        },
        { id: last, contents: { kind: "sql", resultVariable: "dataframe_2" } },
      ],
    },
  });
});

it("the compiled notebook binds only an authorized thread and preserves its accepted revision", async () => {
  const created = await request(endpoint + "create-project", ownerCookie, {
    title: "Compiled review fixture",
  });
  expect(created.status).toBe(200);
  const { id: projectId } = z
    .object({ id: z.string() })
    .parse(await created.json());
  const shell = await request(`/project/${projectId}/latest`);
  expect(shell.status).toBe(200);
  expect(htmlBakedBuildId(await shell.text())).toEqual(
    process.env.AGENT_NATIVE_BUILD_ID ?? expect.any(String),
  );
  const read = async (
    name: string,
    input: Record<string, unknown>,
    cookie: string,
  ) =>
    request(endpoint + name + "?" + serializeActionQueryParams(input), cookie);
  const accepted = await read("get-project", { projectId }, ownerCookie);
  expect(accepted.status).toBe(200);
  const before = z
    .object({
      notebook: z.object({
        snapshot: z.object({
          head: z.object({ versionId: z.string(), revision: z.string() }),
        }),
        cells: z.array(z.unknown()),
      }),
    })
    .parse(await accepted.json());
  const opId = randomUUID();
  const input = { projectId, head: before.notebook.snapshot.head, opId };
  expect(
    (await request(endpoint + "create-notebook-thread", ownerCookie, input))
      .status,
  ).toBe(403);
  const mint = await request("/_agent-native/ui-capability", ownerCookie);
  expect(mint.status).toBe(200);
  const signedUi = `${ownerCookie}; ${cookies(mint)}`;
  const bound = await request(
    endpoint + "create-notebook-thread",
    signedUi,
    input,
  );
  expect(bound.status).toBe(200);
  const binding = z
    .object({
      bindingId: z.string(),
      threadId: z.string(),
      overlayRevision: z.literal("0"),
    })
    .parse(await bound.json());
  const retry = await request(
    endpoint + "create-notebook-thread",
    signedUi,
    input,
  );
  expect(await retry.json()).toMatchObject(binding);
  const review = await read(
    "get-notebook-pending-changes",
    { projectId, threadId: binding.threadId },
    ownerCookie,
  );
  expect(review.status).toBe(200);
  expect(await review.json()).toMatchObject({
    bindingId: binding.bindingId,
    changes: [],
    acceptedHead: input.head,
  });
  expect(
    (
      await read(
        "get-notebook-pending-changes",
        { projectId, threadId: binding.threadId },
        memberCookie,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await read(
        "get-notebook-pending-changes",
        { projectId, threadId: randomUUID() },
        ownerCookie,
      )
    ).status,
  ).toBe(404);
  expect(
    await (await read("get-project", { projectId }, ownerCookie)).json(),
  ).toMatchObject(before);
});
