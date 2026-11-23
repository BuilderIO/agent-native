import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeDbExec,
  getDbExec,
  runMigrations,
  sql,
} from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import {
  defineAppConfig,
  runWithRequestContext,
} from "@agent-native/core/server";
import { tableFromArrays, tableFromIPC, tableToIPC } from "apache-arrow";
import { and, eq } from "drizzle-orm";
import { H3 } from "h3";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

import controlAction from "../../actions/control-notebook-kernel.js";
import buildAction from "../../actions/get-notebook-kernel-build.js";
import streamAction from "../../actions/open-notebook-kernel-stream.js";
import {
  CONTRACT_VERSION,
  kernelCommandSchema,
  kernelEnvelopeSchema,
  kernelEventSchema,
  type KernelCommand,
} from "../../shared/kernel-contract.js";
import {
  kernelGenerationSchema,
  namespaceIdSchema,
  runIdSchema,
} from "../../shared/notebook-execution.js";
import { completeResultManifestSchema } from "../../shared/notebook-result-contract.js";
import { workspaceIdSchema } from "../../shared/notebook-snapshot-contract.js";
import { getDb, schema } from "../db/index.js";
import {
  analyticsMigrations,
  runAnalyticsMigrations,
} from "../db/migrations.js";
import {
  createKernelCommandSession,
  kernelCommandIntent,
  selectKernelHost,
  terminateKernelGeneration,
  verifyKernelStreamTicket,
} from "../execution/kernel-client.js";
import { executeVisualizationSql } from "../execution/visualization-kernel.js";
import streamAuthorization from "../routes/api/kernel-stream-authorization.get.js";
import {
  advanceKernelGeneration,
  commitKernelControl,
  kernelControlInputSchema,
  readKernelBinding,
  recordKernelHeartbeat,
  reserveKernelNamespace,
  type KernelActor,
  type NotebookKernelExecution,
} from "./kernel-namespaces.js";

const path = await mkdtemp(join(tmpdir(), "analytics-kernel-ledger-"));
const workspaceId = workspaceIdSchema.parse("kernel-workspace");
const owner = "kernel-owner@example.test";
const sameOrg = "kernel-reader@example.test";
const otherOrg = workspaceIdSchema.parse("other-kernel-workspace");
const actor: KernelActor = { workspaceId, principalId: owner, email: owner };
const at = new Date("2026-11-18T00:00:00Z");
const host = {
  hostId: "host-a-boot-1",
  serviceSha: "development",
  imageDigest: "development",
};
const prefix = "/hosts/kernel-fixture";
const origin = "http://127.0.0.1:8787" + prefix;
const hosts = JSON.stringify([
  {
    commandUrl: origin,
    eventUrl: origin,
    sha: host.serviceSha,
    digest: host.imageDigest,
  },
]);
const testRunId = runIdSchema.parse("notebook-kernel-run");

function asActor<T>(fn: () => T, email = owner, orgId = workspaceId) {
  return runWithRequestContext({ userEmail: email, orgId }, fn);
}

async function createProject(label: string) {
  await getDb().insert(schema.projects).values({
    id: label,
    ownerEmail: owner,
    orgId: workspaceId,
    workingVersionId: "kernel-fixture-lineage",
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
  });
}

async function reserve(projectId: string, pin = host) {
  await createProject(projectId);
  return getDb().transaction((tx) =>
    reserveKernelNamespace(
      {
        id: projectId + "-namespace",
        projectId,
        orgId: workspaceId,
        principalId: owner,
        scopeId: projectId,
        scopeKind: "draft",
        lineageId: "kernel-fixture-lineage",
      },
      pin,
      at,
      tx,
    ),
  );
}

function health(hostId = host.hostId, cordoned = false) {
  return Response.json({
    hostId,
    cordoned,
    protocolVersion: CONTRACT_VERSION,
    sha: host.serviceSha,
    digest: host.imageDigest,
    active: 0,
    queued: 0,
    resident: 0,
  });
}

function submittedCommand(init: RequestInit) {
  if (typeof init.body !== "string")
    throw new Error("Expected kernel JSON command body");
  return kernelCommandSchema.parse(JSON.parse(init.body));
}

function configure(execution?: NotebookKernelExecution) {
  defineAppConfig({
    analyticsKernel: {
      hosts,
      keyId: "fixture",
      ...(execution ? { execution } : {}),
    },
  });
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", `pglite:${join(path, "database")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  vi.stubEnv(
    "ANALYTICS_KERNEL_KEYS",
    JSON.stringify({ fixture: "fixture ".repeat(4) }),
  );
  await runMigrations(
    analyticsMigrations.filter((entry) => entry.version <= 15),
    {
      table: "analytics2_migrations",
    },
  )(undefined);
  const timestamp = at.toISOString();
  await getDbExec().execute(sql`
    INSERT INTO analytics2_projects (id, owner_email, org_id, working_version_id, created_at, updated_at)
    VALUES ('saved-before-kernel', ${sql.value(owner)}, ${sql.value(workspaceId)}, 'kernel-fixture-lineage', ${sql.value(timestamp)}, ${sql.value(timestamp)})
  `);
  await runAnalyticsMigrations(undefined);
  await runMigrations(
    ORG_MIGRATIONS.map(({ name, ...entry }) =>
      name === undefined ? entry : { ...entry, name },
    ),
    {
      table: "kernel_fixture_org_migrations",
    },
  )(undefined);
  await getDb()
    .insert(organizations)
    .values(
      [workspaceId, otherOrg].map((id) => ({
        id,
        name: id,
        createdBy: owner,
        createdAt: at.valueOf(),
      })),
    );
  await getDb()
    .insert(orgMembers)
    .values(
      [
        { orgId: workspaceId, email: owner, role: "owner" as const },
        { orgId: workspaceId, email: sameOrg, role: "member" as const },
        { orgId: otherOrg, email: owner, role: "owner" as const },
      ].map((row) => ({ ...row, id: randomUUID(), joinedAt: at.valueOf() })),
    );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  await rm(path, { recursive: true, force: true });
});

it("upgrades the v15 ledger while preserving its existing notebook and starts fresh on a separate database", async () => {
  const [existing] = await getDb()
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, "saved-before-kernel"),
        eq(schema.projects.orgId, workspaceId),
        eq(schema.projects.ownerEmail, owner),
      ),
    )
    .limit(1);
  expect(existing).toEqual({ id: "saved-before-kernel" });
  const versions = await getDbExec().execute(sql`
    SELECT version FROM analytics2_migrations_named
    WHERE name = 'analytics2-kernel-namespaces'
  `);
  expect(String(versions.rows[0]?.version)).toBe("22");
  await closeDbExec();
  vi.stubEnv("DATABASE_URL", `pglite:${join(path, "fresh")}`);
  try {
    await runAnalyticsMigrations(undefined);
    const namespace = await reserve("fresh-kernel-project");
    expect(namespace).toMatchObject({
      generation: 1n,
      hostId: host.hostId,
      status: "reserved",
    });
  } finally {
    await closeDbExec();
    vi.stubEnv("DATABASE_URL", `pglite:${join(path, "database")}`);
  }
});

it("reports the validated kernel build pins only to workspace administrators", async () => {
  configure();
  const fetch = vi.fn(async (address: string) => {
    expect(address).toBe(`${origin}/healthz`);
    return health();
  });
  vi.stubGlobal("fetch", fetch);
  await expect(asActor(() => buildAction.run({}))).resolves.toMatchObject({
    protocolVersion: CONTRACT_VERSION,
    builds: [{ sha: host.serviceSha, digest: host.imageDigest }],
    developmentAttested: true,
  });
  await expect(asActor(() => buildAction.run({}), sameOrg)).resolves.toEqual({
    status: "denied",
    reason: "access_denied",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValueOnce(
    Response.json({
      ...(await health().json()),
      digest: `sha256:${"a".repeat(64)}`,
    }),
  );
  await expect(asActor(() => buildAction.run({}))).resolves.not.toHaveProperty(
    "developmentAttested",
  );
});

it("matches the Python wire fixture intent and complete Arrow manifest", async () => {
  const raw = await readFile(
    new URL(
      "../../../../services/analytics-kernel/tests/fixtures/wire-v2.json",
      import.meta.url,
    ),
    "utf8",
  );
  const fixture = JSON.parse(raw);
  const command = kernelCommandSchema.parse(fixture.command);
  expect(kernelCommandIntent(command)).toBe(fixture.intentHash);
});

it("runs a visualization through the kernel command and Arrow transfer boundary", async () => {
  const projectId = "kernel-visualization";
  await createProject(projectId);
  configure();
  const manifest = completeResultManifestSchema.parse({
    status: "complete",
    rowCount: "2",
    fields: [
      { fieldId: "amount", name: "amount", type: "integer", nullable: false },
    ],
    result: {
      resultId: "source-arrow",
      snapshot: {
        workspaceId,
        projectId,
        head: { versionId: "kernel-fixture-lineage", revision: "1" },
        eventSeq: "1",
      },
      producer: {
        namespaceId: "draft",
        runId: "source-run",
        attemptId: "source-attempt",
        outputGeneration: "1",
        cellId: "sql",
        exportId: "result",
      },
      dependencyFingerprint: "source-dependencies",
      inputRevision: "1",
      kernelGeneration: null,
      sourceGeneration: null,
    },
  });
  const source = 'SELECT to_json(sum("0")) AS payload FROM input';
  let transform: ReturnType<typeof kernelEnvelopeSchema.parse> | undefined;
  const fetch = vi.fn(async (address: string, init: RequestInit) => {
    switch (new URL(address).pathname) {
      case `${prefix}/healthz`:
        return health();
      case `${prefix}/v1/artifacts/source-arrow`: {
        expect(init.method).toBe("PUT");
        if (!Buffer.isBuffer(init.body))
          throw new Error("Expected source Arrow");
        expect(Array.from(tableFromIPC(init.body).getChildAt(0) ?? [])).toEqual(
          [42, 42],
        );
        return new Response(null, { status: 204 });
      }
      case `${prefix}/v1/commands`: {
        const body = submittedCommand(init);
        const { command, ...envelope } = body;
        if (command.operation !== "open") {
          expect(command).toEqual({
            operation: "execute-dataframe-sql",
            source,
            inputs: [{ name: "input", manifest }],
            params: [],
          });
          transform = envelope;
        }
        return Response.json({
          ...envelope,
          acknowledgement: { status: "accepted" },
        });
      }
      case `${prefix}/v1/events`: {
        if (!transform) throw new Error("Expected an admitted transform");
        const events = [
          { sequence: "1", event: { type: "result", artifactId: "aggregate" } },
          {
            sequence: "2",
            event: { type: "terminal", outcome: { status: "complete" } },
          },
        ];
        return new Response(
          events
            .map(
              (event) =>
                `id: ${event.sequence}\ndata: ${JSON.stringify({ ...transform, ...event })}\n\n`,
            )
            .join(""),
        );
      }
      case `${prefix}/v1/artifacts/aggregate`:
        return new Response(
          Buffer.from(tableToIPC(tableFromArrays({ payload: ["84"] }))),
          {
            headers: { "Content-Type": "application/vnd.apache.arrow.stream" },
          },
        );
      default:
        throw new Error("Unexpected kernel request");
    }
  });
  vi.stubGlobal("fetch", fetch);
  await expect(
    executeVisualizationSql({
      actor: { orgId: workspaceId, ownerEmail: owner, caller: "frontend" },
      manifest,
      versionId: manifest.result.snapshot.head.versionId,
      released: false,
      source,
      readInput: async function* () {
        yield tableToIPC(tableFromArrays({ amount: new Int32Array([42, 42]) }));
      },
      authorize: async () => true,
    }),
  ).resolves.toEqual([84]);
});

it("keeps one scoped host pin, denies another principal and fences late heartbeat after host replacement", async () => {
  const original = await reserve("kernel-pin-race");
  const replacement = { ...host, hostId: "host-a-boot-2" };
  const sameScope = await getDb().transaction((tx) =>
    reserveKernelNamespace(
      {
        id: "another-generated-id",
        projectId: original.projectId,
        orgId: original.orgId,
        principalId: original.principalId,
        scopeId: original.scopeId,
        scopeKind: original.scopeKind,
        lineageId: original.lineageId,
      },
      replacement,
      at,
      tx,
    ),
  );
  expect(sameScope).toEqual(original);
  await expect(
    readKernelBinding({ ...actor, principalId: sameOrg }, original.id, "1"),
  ).resolves.toBeNull();
  await expect(
    readKernelBinding({ ...actor, workspaceId: otherOrg }, original.id, "1"),
  ).resolves.toBeNull();
  const binding = await readKernelBinding(actor, original.id, "1");
  if (!binding) throw new Error("Expected the original host binding");

  configure();
  const fetch = vi.fn(async () => health(replacement.hostId));
  vi.stubGlobal("fetch", fetch);
  const command = commandFor(original.id);
  const worker = createKernelCommandSession(actor, command, async () => true);
  await expect(worker.submit()).rejects.toMatchObject({
    code: "host_unavailable",
  });
  expect(fetch).toHaveBeenCalledTimes(1);

  const next = await getDb().transaction((tx) =>
    advanceKernelGeneration(
      binding,
      { status: "reserved", host: replacement, lineageId: original.lineageId },
      at,
      tx,
    ),
  );
  expect(next).toMatchObject({
    generation: 2n,
    hostId: replacement.hostId,
    status: "reserved",
  });
  await expect(recordKernelHeartbeat(binding, "ready", at)).resolves.toBe(
    false,
  );
  await expect(worker.submit()).rejects.toMatchObject({
    code: "stale_generation",
  });
  await expect(
    readKernelBinding(actor, original.id, "2"),
  ).resolves.toMatchObject({ hostId: replacement.hostId });
  fetch.mockImplementationOnce(async () => health(replacement.hostId, true));
  await expect(selectKernelHost()).rejects.toMatchObject({
    code: "host_unavailable",
  });
});

it("replays a fenced restart receipt, then terminates only the prior generation", async () => {
  const namespace = await reserve("kernel-control-replay");
  const prior = await readKernelBinding(actor, namespace.id, "1");
  if (!prior) throw new Error("Expected prior generation binding");
  const close = kernelCommandSchema.parse({
    ...commandFor(namespace.id),
    command: { operation: "close" },
  });
  const input = kernelControlInputSchema.parse({
    scope: { kind: "draft", projectId: namespace.projectId },
    requestId: randomUUID(),
    expectedGeneration: "1",
    operation: "restart-and-run-all",
  });
  type Transaction = Parameters<
    Parameters<ReturnType<typeof getDb>["transaction"]>[0]
  >[0];
  const apply = vi.fn(async (binding: typeof namespace, tx: Transaction) => {
    const advanced = await advanceKernelGeneration(
      binding,
      { status: "reserved", host, lineageId: binding.lineageId },
      at,
      tx,
    );
    if (!advanced) throw new Error("Expected generation advance");
    return {
      requestId: input.requestId,
      generation: kernelGenerationSchema.parse(String(advanced.generation)),
      state: "queued" as const,
      runId: testRunId,
      cursor: "9",
    };
  });
  configure({
    authorizeStream: async () => ({ status: "absent", reason: "not_found" }),
    control: (caller, command) =>
      getDb().transaction((tx) =>
        commitKernelControl(caller, namespace.id, command, at, tx, (binding) =>
          apply(binding, tx),
        ),
      ),
  });
  const fetch = vi.fn(async (address: string, init: RequestInit) => {
    if (new URL(address).pathname === prefix + "/healthz") return health();
    expect(new URL(address).pathname).toBe(prefix + "/v1/commands");
    const command = submittedCommand(init);
    expect(command).toEqual(close);
    const { command: _operation, ...envelope } = command;
    return Response.json({
      ...envelope,
      acknowledgement: { status: "accepted" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  const terminate = () =>
    terminateKernelGeneration(actor, prior, close, async () => true);
  await expect(terminate()).rejects.toMatchObject({ code: "access_denied" });
  expect(fetch).not.toHaveBeenCalled();
  const first = await asActor(() => controlAction.run(input));
  expect(first).toMatchObject({
    generation: "2",
    state: "queued",
    runId: testRunId,
  });
  await expect(terminate()).resolves.toMatchObject({
    generation: "1",
    acknowledgement: { status: "accepted" },
  });
  await expect(asActor(() => controlAction.run(input))).resolves.toEqual(first);
  await expect(
    asActor(() => controlAction.run({ ...input, operation: "stop" })),
  ).rejects.toMatchObject({
    statusCode: 409,
    errorCode: "kernel_intent_reused",
  });
  await expect(
    asActor(() => controlAction.run({ ...input, requestId: randomUUID() })),
  ).rejects.toMatchObject({
    statusCode: 409,
    errorCode: "kernel_generation_conflict",
  });
  await expect(
    asActor(() => controlAction.run(input), sameOrg),
  ).resolves.toEqual({ status: "absent", reason: "not_found" });
  expect(apply).toHaveBeenCalledTimes(1);
});

it("mints a run-scoped browser-only ticket and rechecks revoked access before any new stream", async () => {
  const namespace = await reserve("kernel-stream-revocation");
  let sourceGranted = true;
  const authorizeStream: NotebookKernelExecution["authorizeStream"] = async (
    caller,
    input,
  ) =>
    sourceGranted && caller.email === owner && input.runId === testRunId
      ? {
          status: "allowed",
          namespaceId: namespaceIdSchema.parse(namespace.id),
          generation: kernelGenerationSchema.parse("1"),
          cursor: input.after ?? "0",
        }
      : { status: "denied", reason: "access_denied" };
  configure({
    authorizeStream,
    control: async () => ({ status: "denied", reason: "access_denied" }),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => health()),
  );
  expect(streamAction).toMatchObject({
    uiOnly: true,
    mcpTool: false,
    agentTool: false,
    persistInBrowser: false,
  });
  const input = { runId: testRunId, after: "9007199254740993" };
  const open = () => streamAction.run(input, { caller: "frontend" });
  await expect(
    asActor(() => streamAction.run(input, { caller: "tool" })),
  ).rejects.toMatchObject({ errorCode: "ui_only_action" });
  const ticket = await asActor(open);
  expect(ticket).toMatchObject({
    streamUrl: origin + "/v1/events",
    cursor: input.after,
  });
  if (!("token" in ticket)) throw new Error("Expected scoped stream ticket");
  const claims = verifyKernelStreamTicket(ticket.token);
  expect(claims).toMatchObject({
    workspaceId,
    sub: owner,
    runId: testRunId,
    namespaceId: namespace.id,
    generation: "1",
    hostId: host.hostId,
    operation: "events",
  });
  expect(claims.exp - claims.iat).toBe(60);
  expect(() =>
    verifyKernelStreamTicket(ticket.token, claims.exp * 1000),
  ).toThrow("access_denied");
  const callback = new H3().get(
    "/api/kernel-stream-authorization",
    streamAuthorization,
  );
  const connect = () =>
    callback.request("/api/kernel-stream-authorization", {
      headers: { Authorization: `Bearer ${ticket.token}` },
    });
  const authorized = await connect();
  expect(authorized.status).toBe(204);
  expect(authorized.headers.get("Cache-Control")).toBe("no-store");
  await expect(asActor(open, owner, otherOrg)).resolves.toEqual({
    status: "absent",
    reason: "not_found",
  });
  sourceGranted = false;
  await expect(connect()).resolves.toMatchObject({ status: 403 });
  await expect(asActor(open)).resolves.toEqual({
    status: "denied",
    reason: "access_denied",
  });
});

function commandFor(namespaceId: string) {
  return kernelCommandSchema.parse({
    protocolVersion: CONTRACT_VERSION,
    namespaceId,
    generation: "1",
    runId: testRunId,
    attemptId: "first-claim",
    commandId: "stable-command",
    resumeCursor: null,
    command: {
      operation: "execute-python",
      source: "print('résumé')",
      inputs: [],
    },
  });
}

it("recovers an original command with a new attempt without replaying Python and rejects stale claim events", async () => {
  const namespace = await reserve("kernel-inspect-claim");
  configure();
  const original = commandFor(namespace.id);
  const inspect = kernelCommandSchema.parse({
    ...original,
    attemptId: "recovered-claim",
    command: { operation: "inspect" },
  });
  const terminal = kernelEventSchema.parse({
    ...kernelEnvelopeSchema.parse({
      protocolVersion: original.protocolVersion,
      namespaceId: original.namespaceId,
      generation: original.generation,
      runId: original.runId,
      attemptId: original.attemptId,
      commandId: original.commandId,
      resumeCursor: original.resumeCursor,
    }),
    sequence: "2",
    event: { type: "terminal", outcome: { status: "complete" } },
  });
  let allow = true;
  const authorize = vi.fn(
    async (_caller: KernelActor, command: KernelCommand) =>
      allow && command.attemptId === inspect.attemptId,
  );
  const fetch = vi.fn(async (address: string, init: RequestInit) => {
    switch (new URL(address).pathname) {
      case `${prefix}/healthz`:
        return health();
      case `${prefix}/v1/commands`: {
        const body = submittedCommand(init);
        const auth = new Headers(init.headers).get("Authorization");
        const jwt = auth?.slice(7).split(".")[1];
        if (!jwt) throw new Error("Expected worker token");
        const claims = JSON.parse(Buffer.from(jwt, "base64url").toString());
        expect(claims).toMatchObject({
          commandId: original.commandId,
          attemptId: inspect.attemptId,
          operation: "inspect",
          intentHash: kernelCommandIntent(original),
        });
        expect(body.command.operation).toBe("inspect");
        const { command: _command, ...envelope } = body;
        return Response.json({
          ...envelope,
          acknowledgement: { status: "accepted" },
        });
      }
      case `${prefix}/v1/events`:
        expect(new Headers(init.headers).get("Last-Event-ID")).toBe("1");
        return new Response(`id: 2\ndata: ${JSON.stringify(terminal)}\n\n`);
      default:
        throw new Error("Unexpected kernel request");
    }
  });
  vi.stubGlobal("fetch", fetch);

  await expect(
    createKernelCommandSession(actor, original, authorize).submit(),
  ).rejects.toMatchObject({ code: "access_denied" });
  const recovered = createKernelCommandSession(
    actor,
    inspect,
    authorize,
    original,
  );
  await expect(recovered.submit()).resolves.toMatchObject({
    acknowledgement: { status: "accepted" },
    attemptId: "recovered-claim",
  });
  const events = recovered.events("1");
  await expect(events.next()).resolves.toEqual({
    done: false,
    value: terminal,
  });
  await events.return(undefined);
  allow = false;
  await expect(recovered.events("1").next()).rejects.toMatchObject({
    code: "access_denied",
  });
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith("/v1/commands")),
  ).toHaveLength(1);
});
