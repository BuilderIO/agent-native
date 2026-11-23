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
import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
} from "@agent-native/core/private-blob";
import { configureAgentNativeEmbeddedEnvironment } from "@agent-native/core/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  answerModelRequest,
  createModelState,
} from "../e2e/local/fake-model.js";
import {
  readThreadTurnsOutput,
  startThreadReceipt,
} from "../shared/analytics-thread.js";
import { creationReceiptSchema } from "../shared/notebook-creation.js";
import {
  notebookPendingChangesSchema,
  notebookThreadBindingSchema,
} from "../shared/notebook-proposals.js";

const origin = "http://127.0.0.1:3000";
const modelOrigin = "http://127.0.0.1:4413";
const workspaceId = randomUUID();
const email = "ask-owner@example.test";
const loadBuild = createRequire(import.meta.url);
const nitroRuntime = globalThis as typeof globalThis & {
  __nitro__?: {
    default?: { hooks?: { callHook(name: "close"): Promise<void> } };
  };
};
const model = createModelState();
const fixtureCompletionOrigins: string[] = [];
const blobProvider = "compiled-ask-proof";
const blobs = new Map<string, Uint8Array>();
let app: { fetch(request: Request): Promise<Response> };
let directory: string | undefined;
let cookie = "";
let failNextUpload = false;

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

function request(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  return app.fetch(
    new Request(new URL(path, origin), {
      method,
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

function read(name: string, args: Record<string, unknown>) {
  return request(
    `/_agent-native/actions/${name}?${serializeActionQueryParams(args)}`,
  );
}

function write(name: string, args: Record<string, unknown>) {
  return request(`/_agent-native/actions/${name}`, args);
}

async function ok(response: Response) {
  const body = await response.text();
  expect(response.status, body).toBe(200);
  return JSON.parse(body) as unknown;
}

async function fakeAnthropic(request: Request) {
  const { origin: providerOrigin, pathname: path } = new URL(request.url);
  if (request.method === "GET" && path === "/v1/models") {
    return Response.json({
      data: [
        {
          id: "claude-sonnet-5-5",
          type: "model",
          display_name: "Sonnet 5.5",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
      has_more: false,
    });
  }
  if (request.method !== "POST" || path !== "/v1/messages") {
    throw new Error(
      `Unexpected compiled model request ${request.method} ${path}`,
    );
  }
  const input = z.record(z.string(), z.unknown()).parse(await request.json());
  if (
    Array.isArray(input.messages) &&
    JSON.stringify(input.messages).includes("Orders by channel for fixture 14")
  )
    fixtureCompletionOrigins.push(providerOrigin);
  const { promise, resolve } = Promise.withResolvers<Response>();
  const chunks: string[] = [];
  let options: ResponseInit = {};
  await answerModelRequest(
    input,
    {
      writeHead(status, headers) {
        options = { status, headers };
      },
      write(chunk) {
        chunks.push(chunk);
      },
      end(chunk) {
        if (chunk !== undefined) chunks.push(chunk);
        resolve(new Response(chunks.join(""), options));
      },
    },
    model,
  );
  return promise;
}

beforeAll(async () => {
  expect(
    loadBuild("../.output/nitro.json"),
    "Build with NITRO_PRESET=standard",
  ).toMatchObject({ preset: "standard" });
  directory = await mkdtemp(join(tmpdir(), "analytics-ask-build-"));
  const databaseUrl = `pglite:${join(directory, "database")}`;
  for (const [key, value] of Object.entries({
    DATABASE_URL: databaseUrl,
    APP_URL: origin,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    SECRETS_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    AUTH_SKIP_EMAIL_VERIFICATION: "1",
    AUTH_MAGIC_LINK: "0",
    AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT: "1",
    AGENT_NATIVE_DISABLE_INPROCESS_SWEEPS: "1",
    AGENT_NATIVE_CONFIG_RUNTIME_AUTH_ENABLED: "true",
    NODE_ENV: "production",
  }))
    vi.stubEnv(key, value);
  vi.stubGlobal("__AGENT_NATIVE_EMBEDDED_RUNTIME__", undefined);
  vi.stubGlobal("__nitro__", undefined);
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const outgoing = new Request(input, init);
      const url = new URL(outgoing.url);
      if (url.hostname === "api.anthropic.com" || url.origin === modelOrigin)
        return fakeAnthropic(outgoing);
      if (url.origin === origin) return app.fetch(outgoing);
      throw new Error(
        `Unexpected compiled network request ${url.origin}${url.pathname}`,
      );
    },
  );
  configureAgentNativeEmbeddedEnvironment({ databaseUrl });
  registerPrivateBlobProvider({
    id: blobProvider,
    name: "Compiled Ask proof storage",
    isConfigured: () => true,
    async put({ key, data }) {
      if (failNextUpload) {
        failNextUpload = false;
        throw new Error("Controlled private upload failure");
      }
      const id = key ?? randomUUID();
      blobs.set(id, Uint8Array.from(data));
      return {
        id,
        provider: blobProvider,
        opaque: true,
        encrypted: false,
      };
    },
    async read(handle) {
      const data = blobs.get(handle.id);
      if (!data) throw new Error("The private upload fixture is missing");
      return { data, handle };
    },
    async delete({ id }) {
      return { deleted: blobs.delete(id), provider: blobProvider };
    },
  });
  const migrations = ORG_MIGRATIONS.map(
    ({ name, ...entry }): MigrationEntry =>
      name === undefined ? entry : { ...entry, name },
  );
  await runMigrations(migrations, { table: "qa_ask_org_migrations" })(null);
  const db = createGetDb({ organizations, orgMembers })();
  await db.insert(organizations).values({
    id: workspaceId,
    name: "Ask proof",
    createdBy: email,
    createdAt: Date.now(),
  });
  await db.insert(orgMembers).values({
    id: randomUUID(),
    email,
    orgId: workspaceId,
    role: "owner",
    joinedAt: Date.now(),
  });
  await closeDbExec();
  ({ default: app } = loadBuild("../.output/server/index.mjs"));
  const credentials = { email, password: randomBytes(24).toString("hex") };
  expect(
    (await request("/_agent-native/auth/register", credentials)).status,
  ).toBe(200);
  const login = await request("/_agent-native/auth/login", credentials);
  expect(login.status).toBe(200);
  cookie = cookies(login);
  const capability = await request("/_agent-native/ui-capability");
  expect(capability.status).toBe(200);
  cookie = [cookie, cookies(capability)].join("; ");
}, 60_000);

afterAll(async () => {
  try {
    await nitroRuntime.__nitro__?.default?.hooks?.callHook("close");
    await closeDbExec();
    if (directory) await rm(directory, { recursive: true, force: true });
  } finally {
    unregisterPrivateBlobProvider(blobProvider);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

function prompt(text: string, attachmentIds: string[] = []) {
  return { text, attachmentIds, sourceIds: [], mentions: [], approval: "skip" };
}

async function enableFakeModel() {
  await ok(
    await request("/_agent-native/agent-engine/api-key", {
      provider: "anthropic",
      value: "local-fake-scoped-key",
      scope: "user",
      surface: "settings",
    }),
  );
  await expect
    .poll(async () => ok(await request("/_agent-native/agent-engine/status")))
    .toMatchObject({ chatEligible: true });
}

async function readTurns(threadId: string) {
  return readThreadTurnsOutput.parse(
    await ok(await read("get-analytics-thread-turns", { threadId })),
  ).turns;
}

it("rejects compiled Ask admission before provisioning when provider setup is required", async () => {
  const home = await request("/home");
  expect(home.status).toBe(200);
  expect(htmlBakedBuildId(await home.text())).toEqual(
    process.env.AGENT_NATIVE_BUILD_ID ?? expect.any(String),
  );
  expect(
    await ok(await request("/_agent-native/agent-engine/status")),
  ).toMatchObject({ chatEligible: false });
  const readThreads = async () =>
    ok(await request("/_agent-native/agent-chat/threads"));
  expect(await readThreads()).toMatchObject({ threads: [] });
  const setup = await write("start-analytics-thread", {
    intentId: randomUUID(),
    mode: "ask",
    trigger: { kind: "submit", prompt: prompt("Show monthly order totals") },
  });
  expect(setup.status).toBe(503);
  expect(await setup.text()).toContain("ai_provider_unavailable");
  expect(await readThreads()).toMatchObject({ threads: [] });
  expect(model.requests).toHaveLength(0);
});

it("resumes a failed upload and stores exactly two ordered turns with a compiled core tool receipt", async () => {
  const intentId = randomUUID();
  const filename = "orders.csv";
  const mimeType = "text/csv";
  const content = "region,orders\nNorth,42\n";
  const start = {
    intentId,
    mode: "ask",
    trigger: {
      kind: "attach",
      uploads: [
        {
          clientFileId: randomUUID(),
          name: filename,
          byteLength: Buffer.byteLength(content),
          mime: mimeType,
        },
      ],
    },
  };
  await enableFakeModel();
  const binding = startThreadReceipt.parse(
    await ok(await write("start-analytics-thread", start)),
  );
  expect(binding.phase).toBe("awaiting_upload");
  const { threadId, projectId, href } = binding;
  const [slot] = z
    .tuple([startThreadReceipt.shape.uploadSlots.element])
    .parse(binding.uploadSlots);
  const { uploadId } = slot;
  expect(slot.state).toBe("pending");
  expect((await request(href)).status).toBe(200);
  const upload = () =>
    write("upload-project-file", {
      projectId,
      filename,
      mimeType,
      dataBase64: Buffer.from(content).toString("base64"),
    });
  const record = (attachment: string | null) =>
    write("record-analytics-thread-upload", { threadId, uploadId, attachment });
  failNextUpload = true;
  const failed = await upload();
  expect(failed.status).toBe(503);
  await ok(await record(null));
  const recover = async () =>
    startThreadReceipt.parse(
      await ok(await write("start-analytics-thread", start)),
    );
  expect(await recover()).toEqual({
    ...binding,
    uploadSlots: [{ ...slot, state: "failed" }],
  });

  const firstQuestion = "[chart] Show the attached orders";
  const initial = {
    threadId,
    messageId: randomUUID(),
    prompt: prompt(firstQuestion, [uploadId]),
  };
  const attachPending = await write("submit-analytics-thread-turn", initial);
  expect(attachPending.status).toBe(409);
  expect(await attachPending.text()).toContain("attachments_pending");
  expect(await readTurns(threadId)).toEqual([]);
  expect(model.requests).toHaveLength(0);

  const uploaded = z
    .object({ file: z.object({ id: z.string() }) })
    .parse(await ok(await upload()));
  await ok(await record(uploaded.file.id));
  expect(await recover()).toEqual({
    ...binding,
    phase: "ready",
    uploadSlots: [{ ...slot, state: "ready" }],
  });
  const first = await ok(await write("submit-analytics-thread-turn", initial));
  expect(
    await ok(await write("submit-analytics-thread-turn", initial)),
  ).toEqual(first);
  const secondQuestion = "Total those verified orders";
  const followUp = {
    threadId,
    messageId: randomUUID(),
    prompt: prompt(secondQuestion),
  };
  await ok(await write("submit-analytics-thread-turn", followUp));
  await expect
    .poll(
      async () =>
        (await readTurns(threadId)).map(({ receipt }) => receipt.phase),
      {
        timeout: 20_000,
      },
    )
    .toEqual(["complete", "complete"]);
  const turns = await readTurns(threadId);
  expect(turns.map(({ receipt }) => receipt.messageId)).toEqual([
    initial.messageId,
    followUp.messageId,
  ]);
  expect(turns.map(({ receipt }) => receipt.sequence)).toEqual(["1", "2"]);
  expect(new Set(turns.map(({ receipt }) => receipt.runId)).size).toBe(2);
  expect(turns.map(({ receipt }) => receipt.runId)).toEqual([
    expect.any(String),
    expect.any(String),
  ]);
  expect(
    turns.map(({ toolReceipts }) =>
      toolReceipts.map(({ name, state }) => ({ name, state })),
    ),
  ).toEqual([[{ name: "list-data-connections", state: "complete" }], []]);
  const transcript = z
    .object({
      id: z.literal(threadId),
      threadData: z.string(),
      visibility: z.literal("private"),
    })
    .parse(
      await ok(await request(`/_agent-native/agent-chat/threads/${threadId}`)),
    );
  expect(transcript.threadData).toContain("list-data-connections");
  expect(transcript.threadData).toContain("Revenue peaked in April.");
  const messages = z
    .object({
      messages: z.array(
        z.object({
          message: z.object({
            role: z.string(),
            content: z.array(
              z.object({ type: z.string(), text: z.string().optional() }),
            ),
          }),
        }),
      ),
    })
    .parse(JSON.parse(transcript.threadData)).messages;
  expect(
    messages
      .filter(({ message }) => message.role === "user")
      .map(
        ({ message }) =>
          message.content.find(({ type }) => type === "text")?.text,
      ),
  ).toEqual([firstQuestion, secondQuestion]);
  expect(transcript.threadData).toContain(
    "Here is what I found for: Total those verified orders",
  );
  const stored = await ok(await read("get-thread-summary", { threadId }));
  expect(stored).toMatchObject({
    binding: { threadId, projectId, bindingId: binding.bindingId },
    listed: false,
  });
}, 65_000);

async function enableDeploymentFixture() {
  await ok(
    await request(
      "/_agent-native/agent-engine/api-key",
      { provider: "anthropic", scope: "user" },
      "DELETE",
    ),
  );
  for (const [key, value] of Object.entries({
    AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT: "local",
    AGENT_ENGINE: "anthropic",
    AGENT_ENGINE_PREFER_BYO_KEY: "true",
    AGENT_MODEL: "claude-sonnet-5-5",
    ANTHROPIC_API_KEY: "local-fake-provider-key",
    ANTHROPIC_BASE_URL: modelOrigin,
  }))
    vi.stubEnv(key, value);
  await expect
    .poll(async () => ok(await request("/_agent-native/agent-engine/status")))
    .toMatchObject({ chatEligible: true });
}

it("reads the fixture 14 charts from real compiled notebook execution on both turns", async () => {
  await enableDeploymentFixture();
  const intentId = randomUUID();
  const start = {
    intentId,
    mode: "ask",
    trigger: {
      kind: "submit",
      prompt: prompt("Orders by channel for fixture 14"),
    },
  };
  const receipt = startThreadReceipt.parse(
    await ok(await write("start-analytics-thread", start)),
  );
  expect(receipt.phase).toBe("submitted");
  expect(await ok(await write("start-analytics-thread", start))).toEqual(
    receipt,
  );
  const { threadId } = receipt;
  await expect
    .poll(
      async () =>
        (await readTurns(threadId)).map(({ receipt }) => receipt.phase),
      { timeout: 20_000 },
    )
    .toEqual(["complete"]);
  await ok(
    await write("submit-analytics-thread-turn", {
      threadId,
      messageId: randomUUID(),
      prompt: prompt("Total those channels"),
    }),
  );
  await expect
    .poll(
      async () =>
        (await readTurns(threadId)).map(({ receipt }) => receipt.phase),
      { timeout: 20_000 },
    )
    .toEqual(["complete", "complete"]);
  const projected = await readTurns(threadId);
  const rows = [];
  for (const { chartArtifacts, toolReceipts, answerBlocks } of projected) {
    expect(
      chartArtifacts,
      JSON.stringify({ toolReceipts, answerBlocks }),
    ).toHaveLength(1);
    const [{ resultId }] = z
      .tuple([z.object({ resultId: z.string() })])
      .parse(chartArtifacts);
    expect(toolReceipts.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "start-notebook-run",
        "get-notebook-result-page",
      ]),
    );
    const page = z
      .object({
        status: z.literal("ready"),
        rows: z.array(z.array(z.unknown())),
      })
      .parse(
        await ok(
          await read("get-notebook-result-page", {
            resultId,
            threadId,
            page: 1,
          }),
        ),
      );
    rows.push(page.rows);
  }
  expect(rows).toEqual([
    [
      ["web", 14042],
      ["sales", 14084],
    ],
    [[28126]],
  ]);
  expect(fixtureCompletionOrigins.length).toBeGreaterThan(0);
  expect([...new Set(fixtureCompletionOrigins)]).toEqual([modelOrigin]);
}, 65_000);

it("runs the fixture 13 candidate SQL via compiled Notebook Magic without accepting its three proposals", async () => {
  await enableDeploymentFixture();
  const created = creationReceiptSchema.parse(
    await ok(await write("create-project", { requestId: randomUUID() })),
  );
  const { projectId } = created;
  const { threadId } = notebookThreadBindingSchema.parse(
    await ok(
      await write("create-notebook-thread", {
        projectId,
        opId: randomUUID(),
        head: created.snapshot.snapshot.head,
      }),
    ),
  );
  const projectSchema = z.object({
    project: z.object({ cells: z.array(z.unknown()) }),
  });
  const accepted = projectSchema.parse(
    await ok(await read("get-project", { projectId })),
  );
  await ok(
    await request(
      "/_agent-native/application-state/navigation",
      { resourceKind: "project", resourceId: projectId },
      "PUT",
    ),
  );
  const response = await request("/_agent-native/agent-chat", {
    threadId,
    scope: { type: "workspace-app", id: `analytics-2:org:${workspaceId}` },
    history: [],
    message:
      "Use notebook tools. Insert a SQL cell using SELECT 13042 AS result, visualize that result in a chart, and add an independent text cell containing Magic scratch 13. Run the candidate SQL before asking for review. Do not confirm anything.",
  });
  const stream = await response.text();
  expect(response.status, stream).toBe(200);
  expect(stream).toContain(
    "The query, chart, and scratch cell are ready for your review.",
  );
  const pending = notebookPendingChangesSchema.parse(
    await ok(
      await read("get-notebook-pending-changes", { projectId, threadId }),
    ),
  );
  expect(pending.changes.map(({ status }) => status)).toEqual([
    "pending",
    "pending",
    "pending",
  ]);
  const [resultId] = z
    .tuple([z.string()])
    .parse(pending.changes.flatMap((change) => change.resultIds));
  expect(
    await ok(
      await read("get-notebook-result-page", { resultId, threadId, page: 1 }),
    ),
  ).toMatchObject({ status: "ready", rows: [[13042]] });
  expect(
    await ok(await read("get-notebook-result-page", { resultId, page: 1 })),
  ).toMatchObject({ status: "denied" });
  expect(
    projectSchema.parse(await ok(await read("get-project", { projectId }))),
  ).toEqual(accepted);
}, 65_000);
