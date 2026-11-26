import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  isMcpToolCallReplayRefusedError,
  isMcpTransportDisconnectError,
  McpToolCallReplayRefusedError,
} from "./errors.js";
import {
  isToolCallReplayable,
  McpClientManager,
  mcpToolCallWasNotSent,
} from "./manager.js";
import {
  capabilitiesAdvertiseSkills,
  computeSha256Digest,
  extractVerifiedSkillResource,
  MCP_SKILLS_EXTENSION_ID,
  McpSkillError,
  normalizeSha256Digest,
  parseSkillGetResult,
  parseSkillListResult,
  parseSkillUri,
  verifySkillResourceDigest,
} from "./skills.js";

const SERVER_URL = "http://93.184.216.34/mcp";

const managers: McpClientManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.stop()));
  vi.unstubAllGlobals();
});

const SKILL_MD = "---\nname: demo\ndescription: Demo skill\n---\n# Demo\n";
const REFERENCE_MD = "# Reference Guide\nCafé notes\n";
const BINARY_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]);
const BINARY_BASE64 = BINARY_BYTES.toString("base64");

function makeSkillManifest(overrides?: {
  skillMdText?: string;
  referenceText?: string;
  includeBinary?: boolean;
}) {
  const skillText = overrides?.skillMdText ?? SKILL_MD;
  const referenceText = overrides?.referenceText ?? REFERENCE_MD;
  const skillBytes = Buffer.from(skillText, "utf8");
  const refBytes = Buffer.from(referenceText, "utf8");
  const resources = [
    {
      uri: "skill://demo/SKILL.md",
      digest: computeSha256Digest(skillBytes),
      size: skillBytes.length,
    },
    {
      uri: "skill://demo/references/guide.md",
      digest: computeSha256Digest(refBytes),
      size: refBytes.length,
    },
    ...(overrides?.includeBinary
      ? [
          {
            uri: "skill://demo/assets/icon.png",
            digest: computeSha256Digest(BINARY_BYTES),
            size: BINARY_BYTES.length,
          },
        ]
      : []),
  ];
  return {
    uri: "skill://demo/SKILL.md",
    frontmatter: { name: "demo", description: "Demo skill" },
    resources,
  };
}

describe("MCP Skills unit helpers (SEP-2640)", () => {
  it("parses canonical skill:// URIs and computes manifestUri", () => {
    expect(parseSkillUri("skill://an/SKILL.md")).toEqual({
      uri: "skill://an/SKILL.md",
      skillName: "an",
      relativePath: "SKILL.md",
      manifestUri: "skill://an/SKILL.md",
    });
    expect(parseSkillUri("skill://my-skill_1.0/references/guide.md")).toEqual({
      uri: "skill://my-skill_1.0/references/guide.md",
      skillName: "my-skill_1.0",
      relativePath: "references/guide.md",
      manifestUri: "skill://my-skill_1.0/SKILL.md",
    });
  });

  it.each([
    "file:///etc/passwd",
    "https://example.com/SKILL.md",
    "ui://app/SKILL.md",
    "skill://",
    "skill://an",
    "skill://an/",
    "skill://an//SKILL.md",
    "skill://an/references/",
    "skill://an/../other/SKILL.md",
    "skill://an/./SKILL.md",
    "skill://an/%2e%2e/secret.md",
    "skill://an/%2E/SKILL.md",
    "skill://an/%2fSKILL.md",
    "skill://an/%5cSKILL.md",
    "skill://an/%ZZ",
    "skill://an/SKILL.md?raw=1",
    "skill://an/SKILL.md#section",
    "skill://an:80/SKILL.md",
    "skill://user@an/SKILL.md",
    "skill://an\\SKILL.md",
    "skill://-bad/SKILL.md",
    "skill://.hidden/SKILL.md",
    "skill://an/SKILL.md\n",
  ])("rejects unsafe or non-canonical skill URI %s", (badUri) => {
    expect(() => parseSkillUri(badUri)).toThrow(McpSkillError);
    let caught: unknown;
    try {
      parseSkillUri(badUri);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(McpSkillError);
    expect((caught as McpSkillError).code).toBe("INVALID_SKILL_URI");
  });

  it("validates, normalizes, and verifies SHA-256 digests and sizes", () => {
    const bytes = Buffer.from(REFERENCE_MD, "utf8");
    const upperDigest = computeSha256Digest(bytes).toUpperCase();
    expect(normalizeSha256Digest(upperDigest)).toBe(computeSha256Digest(bytes));

    const verified = verifySkillResourceDigest(
      bytes,
      upperDigest,
      bytes.length,
    );
    expect(verified).toEqual({
      digest: computeSha256Digest(bytes),
      size: bytes.length,
    });

    expect(() => normalizeSha256Digest("md5:1234")).toThrow(McpSkillError);
    expect(() => normalizeSha256Digest("sha256:abcd")).toThrow(McpSkillError);
    expect(() =>
      verifySkillResourceDigest(Buffer.from("tampered", "utf8"), upperDigest),
    ).toThrow(McpSkillError);
    expect(() =>
      verifySkillResourceDigest(bytes, upperDigest, bytes.length + 1),
    ).toThrow(McpSkillError);
  });

  it("checks whether server capabilities advertise io.modelcontextprotocol/skills", () => {
    expect(
      capabilitiesAdvertiseSkills({
        extensions: { [MCP_SKILLS_EXTENSION_ID]: {} },
      }),
    ).toBe(true);
    expect(
      capabilitiesAdvertiseSkills({
        extensions: { [MCP_SKILLS_EXTENSION_ID]: { version: "1" } },
      }),
    ).toBe(true);
    expect(capabilitiesAdvertiseSkills({ extensions: {} })).toBe(false);
    expect(
      capabilitiesAdvertiseSkills({
        extensions: { [MCP_SKILLS_EXTENSION_ID]: null },
      }),
    ).toBe(false);
    expect(capabilitiesAdvertiseSkills(undefined)).toBe(false);
  });

  it("rejects cross-skill resource references and mismatched skills/get URIs", () => {
    const validDigest = computeSha256Digest(Buffer.from("x", "utf8"));
    expect(() =>
      parseSkillListResult(
        {
          skills: [
            {
              uri: "skill://evil/SKILL.md",
              frontmatter: { name: "evil" },
              resources: [
                { uri: "skill://victim/secret.md", digest: validDigest },
              ],
            },
          ],
        },
        "remote",
      ),
    ).toThrow(McpSkillError);

    expect(() =>
      parseSkillGetResult(
        {
          skill: {
            uri: "skill://other/SKILL.md",
            frontmatter: { name: "other" },
            resources: [],
          },
        },
        "skill://demo/SKILL.md",
        "remote",
      ),
    ).toThrow(McpSkillError);
  });

  it("extracts and verifies both text and base64 blob skill resources", () => {
    const textDigest = computeSha256Digest(Buffer.from(SKILL_MD, "utf8"));
    const textResult = extractVerifiedSkillResource(
      {
        contents: [
          {
            uri: "skill://demo/SKILL.md",
            mimeType: "text/markdown",
            text: SKILL_MD,
          },
        ],
      },
      "skill://demo/SKILL.md",
      textDigest,
      Buffer.byteLength(SKILL_MD, "utf8"),
      "remote",
    );
    expect(textResult).toEqual({
      uri: "skill://demo/SKILL.md",
      mimeType: "text/markdown",
      text: SKILL_MD,
      digest: textDigest,
      size: Buffer.byteLength(SKILL_MD, "utf8"),
    });

    const blobDigest = computeSha256Digest(BINARY_BYTES);
    const blobResult = extractVerifiedSkillResource(
      {
        contents: [
          {
            uri: "skill://demo/assets/icon.png",
            mimeType: "image/png",
            blob: BINARY_BASE64,
          },
        ],
      },
      "skill://demo/assets/icon.png",
      blobDigest,
      BINARY_BYTES.length,
      "remote",
    );
    expect(blobResult).toEqual({
      uri: "skill://demo/assets/icon.png",
      mimeType: "image/png",
      blob: BINARY_BASE64,
      digest: blobDigest,
      size: BINARY_BYTES.length,
    });

    expect(() =>
      extractVerifiedSkillResource(
        {
          contents: [
            {
              uri: "skill://demo/assets/icon.png",
              blob: "!!!not-base64!!!",
            },
          ],
        },
        "skill://demo/assets/icon.png",
        blobDigest,
        BINARY_BYTES.length,
        "remote",
      ),
    ).toThrow(McpSkillError);

    expect(() =>
      extractVerifiedSkillResource(
        { contents: [{ uri: "skill://demo/SKILL.md" }] },
        "skill://demo/SKILL.md",
        textDigest,
        undefined,
        "remote",
      ),
    ).toThrow(McpSkillError);
  });
});

describe("Non-replaying submit boundary helpers", () => {
  it("evaluates replay eligibility strictly from readOnlyHint and caller flags", () => {
    expect(isToolCallReplayable({ annotations: { readOnlyHint: true } })).toBe(
      true,
    );
    expect(isToolCallReplayable({ annotations: { readOnlyHint: false } })).toBe(
      false,
    );
    expect(isToolCallReplayable({ annotations: undefined })).toBe(false);
    expect(
      isToolCallReplayable({ annotations: { idempotentHint: true } }),
    ).toBe(false);

    expect(
      isToolCallReplayable(
        { annotations: { readOnlyHint: true } },
        { retryOnDisconnect: false },
      ),
    ).toBe(false);
    expect(
      isToolCallReplayable(
        { annotations: { readOnlyHint: true } },
        { allowReplay: false },
      ),
    ).toBe(false);
    expect(
      isToolCallReplayable(
        { annotations: { readOnlyHint: true } },
        { idempotent: false },
      ),
    ).toBe(false);

    expect(
      isToolCallReplayable(
        { annotations: { readOnlyHint: false } },
        { retryOnDisconnect: true },
      ),
    ).toBe(true);
    expect(
      isToolCallReplayable({ annotations: undefined }, { allowReplay: true }),
    ).toBe(true);
    expect(
      isToolCallReplayable(
        { annotations: undefined },
        { retryOnDisconnect: true, idempotent: false },
      ),
    ).toBe(false);
    expect(
      isToolCallReplayable(
        { annotations: undefined },
        { retryOnDisconnect: true, allowReplay: false },
      ),
    ).toBe(false);
  });

  it("classifies transport disconnects without misclassifying HTTP or JSON-RPC errors", () => {
    expect(isMcpTransportDisconnectError(new Error("socket hang up"))).toBe(
      true,
    );
    expect(
      isMcpTransportDisconnectError(
        Object.assign(new Error("reset"), { code: "ECONNRESET" }),
      ),
    ).toBe(true);
    expect(
      isMcpTransportDisconnectError(
        Object.assign(new Error("closed"), { code: -32000 }),
      ),
    ).toBe(true);
    expect(
      isMcpTransportDisconnectError(
        new Error("wrapped", {
          cause: Object.assign(new Error("pipe"), { code: "EPIPE" }),
        }),
      ),
    ).toBe(true);

    expect(
      isMcpTransportDisconnectError(
        Object.assign(new Error("unauthorized"), { status: 401 }),
      ),
    ).toBe(false);
    expect(
      isMcpTransportDisconnectError(
        Object.assign(new Error("Database not connected"), { code: -32603 }),
      ),
    ).toBe(false);
    expect(
      isMcpTransportDisconnectError(new Error("Database not connected")),
    ).toBe(false);

    const cyclic: { message: string; cause?: unknown } = {
      message: "plain failure",
    };
    cyclic.cause = cyclic;
    expect(isMcpTransportDisconnectError(cyclic)).toBe(false);
  });
});

interface SkillsHarnessOptions {
  advertiseSkills?: boolean;
  tamperResourceText?: string;
  includeBinary?: boolean;
  statefulLegacySession?: boolean;
  failNextMethod?: { method: string; remaining: number; status: number };
  onClientCapabilities?: (capabilities: unknown) => void;
  onRequest?: (method: string, params: unknown) => void;
}

function extractClientCapabilitiesFromRequestBody(body: {
  method?: string;
  params?: Record<string, unknown>;
}): unknown {
  if (body.method === "initialize") {
    return body.params?.capabilities;
  }
  if (body.method === "server/discover") {
    const meta = body.params?._meta;
    if (meta && typeof meta === "object") {
      const record = meta as Record<string, unknown>;
      return (
        record["io.modelcontextprotocol/clientCapabilities"] ??
        record.clientCapabilities
      );
    }
  }
  return undefined;
}

function mountSkillsServer(options: SkillsHarnessOptions = {}) {
  const advertiseSkills = options.advertiseSkills ?? true;
  const manifest = makeSkillManifest({ includeBinary: options.includeBinary });
  const receivedMethods: string[] = [];
  let sessionCounter = 0;
  let activeSessionId: string | undefined;

  const handler = createMcpHandler(
    () => {
      const server = new McpServer(
        { name: "skills-server", version: "1.0.0" },
        advertiseSkills
          ? {
              capabilities: {
                tools: {},
                resources: {},
                extensions: { [MCP_SKILLS_EXTENSION_ID]: {} },
              },
            }
          : { capabilities: { tools: {} } },
      );

      server.registerTool(
        "ping",
        {
          description: "Read-only ping",
          annotations: { readOnlyHint: true },
        },
        async () => ({ content: [{ type: "text", text: "pong" }] }),
      );

      if (advertiseSkills) {
        const skillParams = z.object({
          uri: z.string().optional(),
          cursor: z.string().optional(),
        });
        server.server.setRequestHandler(
          "skills/list",
          { params: skillParams },
          async () => ({
            resultType: "complete",
            ttlMs: 0,
            cacheScope: "private",
            skills: [manifest],
          }),
        );
        server.server.setRequestHandler(
          "skills/get",
          { params: skillParams },
          async (params) => {
            if (params.uri !== manifest.uri) {
              throw Object.assign(new Error("Skill not found"), {
                code: -32602,
              });
            }
            return {
              resultType: "complete",
              ttlMs: 0,
              cacheScope: "private",
              skill: manifest,
            };
          },
        );
        server.server.setRequestHandler("resources/list", async () => ({
          resources: [],
        }));
        server.server.setRequestHandler(
          "resources/read",
          async (request: { params?: { uri?: unknown } }) => {
            const uri = request.params?.uri;
            if (uri === "skill://demo/SKILL.md") {
              return {
                contents: [
                  {
                    uri,
                    mimeType: "text/markdown",
                    text: options.tamperResourceText ?? SKILL_MD,
                  },
                ],
              };
            }
            if (uri === "skill://demo/references/guide.md") {
              return {
                contents: [
                  {
                    uri,
                    mimeType: "text/markdown",
                    text: options.tamperResourceText ?? REFERENCE_MD,
                  },
                ],
              };
            }
            if (
              options.includeBinary &&
              uri === "skill://demo/assets/icon.png"
            ) {
              return {
                contents: [
                  {
                    uri,
                    mimeType: "image/png",
                    blob: BINARY_BASE64,
                  },
                ],
              };
            }
            throw Object.assign(new Error("Resource not found"), {
              code: -32602,
            });
          },
        );
      }

      return server;
    },
    { legacy: "stateless", responseMode: "auto" },
  );

  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      let method: string | undefined;
      if (request.method === "POST") {
        const body = (await request.clone().json()) as {
          id?: unknown;
          method?: string;
          params?: Record<string, unknown>;
        };
        method = body.method;
        if (typeof method === "string") {
          receivedMethods.push(method);
          options.onRequest?.(method, body.params);
        }
        const caps = extractClientCapabilitiesFromRequestBody(body);
        if (caps !== undefined) {
          options.onClientCapabilities?.(caps);
        }
        if (options.statefulLegacySession && method === "server/discover") {
          return Response.json(
            {
              jsonrpc: "2.0",
              id: body.id ?? null,
              error: { code: -32601, message: "Method not found" },
            },
            { status: 400 },
          );
        }
        if (
          options.failNextMethod &&
          method === options.failNextMethod.method &&
          options.failNextMethod.remaining > 0
        ) {
          options.failNextMethod.remaining -= 1;
          return Response.json(
            { error: "session expired" },
            { status: options.failNextMethod.status },
          );
        }
      }
      const response = await handler.fetch(request);
      if (
        options.statefulLegacySession &&
        request.method === "POST" &&
        method === "initialize" &&
        response.ok
      ) {
        const clonedHeaders = new Headers(response.headers);
        sessionCounter += 1;
        activeSessionId = `skills-session-${sessionCounter}`;
        clonedHeaders.set("mcp-session-id", activeSessionId);
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: clonedHeaders,
        });
      }
      return response;
    },
  );

  return { receivedMethods, manifest };
}

describe("McpClientManager Skills over MCP contract (real MCP SDK)", () => {
  it("advertises io.modelcontextprotocol/skills only when enableSkills is opted in", async () => {
    const seenCapabilities: unknown[] = [];
    mountSkillsServer({
      onClientCapabilities: (caps) => seenCapabilities.push(caps),
    });

    const defaultManager = new McpClientManager({
      servers: { docs: { type: "http", url: SERVER_URL } },
    });
    managers.push(defaultManager);
    await defaultManager.start();

    const optedInManager = new McpClientManager(
      { servers: { docs: { type: "http", url: SERVER_URL } } },
      { enableSkills: true },
    );
    managers.push(optedInManager);
    await optedInManager.start();

    expect(defaultManager.serverSupportsSkills("docs")).toBe(true);
    expect(optedInManager.serverSupportsSkills("docs")).toBe(true);
    expect(
      capabilitiesAdvertiseSkills(defaultManager.getServerCapabilities("docs")),
    ).toBe(true);
    expect(seenCapabilities).toHaveLength(2);
    expect(capabilitiesAdvertiseSkills(seenCapabilities[0])).toBe(false);
    expect(capabilitiesAdvertiseSkills(seenCapabilities[1])).toBe(true);
  });

  it("discovers skills and verifies SHA-256 digests when reading text and binary resources", async () => {
    mountSkillsServer({ includeBinary: true });

    const manager = new McpClientManager(
      { servers: { docs: { type: "http", url: SERVER_URL } } },
      { enableSkills: true },
    );
    managers.push(manager);
    await manager.start();

    const listed = await manager.listSkills("docs");
    expect(listed.skills).toHaveLength(1);
    expect(listed.skills[0]?.uri).toBe("skill://demo/SKILL.md");

    const got = await manager.getSkill("docs", "skill://demo/SKILL.md");
    expect(got.skill).toEqual(listed.skills[0]);

    const skillDoc = await manager.readSkillResource(
      "docs",
      "skill://demo/SKILL.md",
    );
    expect(skillDoc.text).toBe(SKILL_MD);
    expect(skillDoc.digest).toBe(
      computeSha256Digest(Buffer.from(SKILL_MD, "utf8")),
    );

    const guide = await manager.readSkillResource(
      "docs",
      "skill://demo/references/guide.md",
    );
    expect(guide.text).toBe(REFERENCE_MD);
    expect(guide.size).toBe(Buffer.byteLength(REFERENCE_MD, "utf8"));

    const icon = await manager.readSkillResource(
      "docs",
      "skill://demo/assets/icon.png",
    );
    expect(icon.blob).toBe(BINARY_BASE64);
    expect(icon.size).toBe(BINARY_BYTES.length);
  });

  it("rejects tampered skill content on SHA-256 mismatch and undeclared manifest resources", async () => {
    const { receivedMethods } = mountSkillsServer({
      tamperResourceText: "tampered payload",
    });

    const manager = new McpClientManager(
      { servers: { docs: { type: "http", url: SERVER_URL } } },
      { enableSkills: true },
    );
    managers.push(manager);
    await manager.start();

    await expect(
      manager.readSkillResource("docs", "skill://demo/SKILL.md"),
    ).rejects.toMatchObject({
      name: "McpSkillError",
      code: "DIGEST_MISMATCH",
    });

    const readsBefore = receivedMethods.filter(
      (method) => method === "resources/read",
    ).length;
    await expect(
      manager.readSkillResource("docs", "skill://demo/undeclared.md"),
    ).rejects.toMatchObject({
      name: "McpSkillError",
      code: "RESOURCE_NOT_IN_MANIFEST",
    });
    const readsAfter = receivedMethods.filter(
      (method) => method === "resources/read",
    ).length;
    expect(readsAfter).toBe(readsBefore);
  });

  it("supports caller-supplied expectedDigest and rejects servers without skills capability", async () => {
    const { receivedMethods } = mountSkillsServer({ advertiseSkills: false });

    const manager = new McpClientManager(
      { servers: { plain: { type: "http", url: SERVER_URL } } },
      { enableSkills: true },
    );
    managers.push(manager);
    await manager.start();

    expect(manager.serverSupportsSkills("plain")).toBe(false);
    await expect(manager.listSkills("plain")).rejects.toMatchObject({
      name: "McpSkillError",
      code: "SKILLS_UNSUPPORTED",
    });
    await expect(
      manager.getSkill("plain", "skill://demo/SKILL.md"),
    ).rejects.toMatchObject({
      name: "McpSkillError",
      code: "SKILLS_UNSUPPORTED",
    });
    await expect(
      manager.readSkillResource("plain", "skill://demo/SKILL.md", {
        expectedDigest: computeSha256Digest(Buffer.from(SKILL_MD, "utf8")),
      }),
    ).rejects.toMatchObject({
      name: "McpSkillError",
      code: "SKILLS_UNSUPPORTED",
    });
    expect(receivedMethods).not.toContain("skills/list");
    expect(receivedMethods).not.toContain("skills/get");
  });

  it("reconnects and retries read-only skills/list after an expired HTTP session", async () => {
    const { receivedMethods } = mountSkillsServer({
      statefulLegacySession: true,
      failNextMethod: { method: "skills/list", remaining: 1, status: 404 },
    });

    const manager = new McpClientManager(
      { servers: { docs: { type: "http", url: SERVER_URL } } },
      { enableSkills: true },
    );
    managers.push(manager);
    await manager.start();

    const listed = await manager.listSkills("docs");
    expect(listed.skills).toHaveLength(1);
    expect(
      receivedMethods.filter((method) => method === "skills/list"),
    ).toHaveLength(2);
  });

  it("supports expectedDigest fast-path, cursor forwarding, and unknown server queries", async () => {
    const seenParams: Array<{ method: string; params: unknown }> = [];
    mountSkillsServer({
      onRequest: (method, params) => {
        seenParams.push({ method, params });
      },
    });

    const manager = new McpClientManager(
      { servers: { docs: { type: "http", url: SERVER_URL } } },
      { enableSkills: true },
    );
    managers.push(manager);
    await manager.start();

    expect(manager.serverSupportsSkills("missing")).toBe(false);
    expect(manager.getServerCapabilities("missing")).toBeUndefined();

    await manager.listSkills("docs", { cursor: "page-2" });
    expect(
      seenParams.find((entry) => entry.method === "skills/list")?.params,
    ).toMatchObject({ cursor: "page-2" });

    const digest = computeSha256Digest(Buffer.from(REFERENCE_MD, "utf8"));
    const read = await manager.readSkillResource(
      "docs",
      "skill://demo/references/guide.md",
      { expectedDigest: digest, expectedSize: Buffer.byteLength(REFERENCE_MD) },
    );
    expect(read.text).toBe(REFERENCE_MD);
    expect(seenParams.some((entry) => entry.method === "skills/get")).toBe(
      false,
    );

    await expect(
      manager.readSkillResource("docs", "skill://demo/SKILL.md", {
        expectedDigest: "not-a-digest",
      }),
    ).rejects.toMatchObject({
      name: "McpSkillError",
      code: "INVALID_DIGEST",
    });

    await expect(
      manager.readSkillResource("docs", "skill://demo/references/guide.md", {
        skillUri: "file:///bad",
      }),
    ).rejects.toMatchObject({
      name: "McpSkillError",
      code: "INVALID_SKILL_URI",
    });
  });
});

interface ReplayHarnessState {
  readCalls: number;
  writeCalls: number;
  unknownCalls: number;
  readOnlyFlagForFlipper: boolean;
  flipperCalls: number;
  onToolCallFetch?: (
    toolName: string,
    callIndex: number,
    requestId: unknown,
  ) => Response | "throw-disconnect" | undefined;
  failReconnect?: boolean;
}

function mountReplayServer(state: ReplayHarnessState) {
  let sessionCounter = 0;
  let activeSessionId: string | undefined;
  let toolCallFetchCount = 0;

  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: "ops", version: "1.0.0" });
      server.registerTool(
        "read_items",
        {
          description: "List items",
          annotations: { readOnlyHint: true },
        },
        async () => {
          state.readCalls += 1;
          return {
            content: [{ type: "text", text: `read:${state.readCalls}` }],
          };
        },
      );
      server.registerTool(
        "charge_card",
        {
          description: "Charge customer",
          annotations: { readOnlyHint: false },
        },
        async () => {
          state.writeCalls += 1;
          return {
            content: [{ type: "text", text: `charged:${state.writeCalls}` }],
          };
        },
      );
      server.registerTool(
        "unannotated_action",
        {
          description: "Action without readOnlyHint",
        },
        async () => {
          state.unknownCalls += 1;
          return {
            content: [{ type: "text", text: `unknown:${state.unknownCalls}` }],
          };
        },
      );
      server.registerTool(
        "flipping_tool",
        {
          description: "Tool whose metadata flips after reconnect",
          annotations: { readOnlyHint: state.readOnlyFlagForFlipper },
        },
        async () => {
          state.flipperCalls += 1;
          return {
            content: [{ type: "text", text: `flip:${state.flipperCalls}` }],
          };
        },
      );
      return server;
    },
    { legacy: "stateless", responseMode: "auto" },
  );

  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      let method: string | undefined;
      if (request.method === "POST") {
        const body = (await request.clone().json()) as {
          id?: unknown;
          method?: string;
          params?: { name?: string };
        };
        method = body.method;
        if (
          state.failReconnect &&
          (method === "initialize" || method === "server/discover")
        ) {
          return Response.json({ error: "server down" }, { status: 503 });
        }
        if (method === "server/discover") {
          return Response.json(
            {
              jsonrpc: "2.0",
              id: body.id ?? null,
              error: { code: -32601, message: "Method not found" },
            },
            { status: 400 },
          );
        }
        if (method === "tools/call") {
          toolCallFetchCount += 1;
          const toolName = body.params?.name ?? "";
          const action = state.onToolCallFetch?.(
            toolName,
            toolCallFetchCount,
            body.id,
          );
          if (action === "throw-disconnect") {
            throw Object.assign(new Error("socket hang up"), {
              code: "ECONNRESET",
            });
          }
          if (action) return action;
        }
      }
      const response = await handler.fetch(request);
      if (request.method === "POST" && method === "initialize" && response.ok) {
        const clonedHeaders = new Headers(response.headers);
        sessionCounter += 1;
        activeSessionId = `ops-session-${sessionCounter}`;
        clonedHeaders.set("mcp-session-id", activeSessionId);
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: clonedHeaders,
        });
      }
      return response;
    },
  );
}

describe("McpClientManager non-replaying submit boundary (real MCP SDK)", () => {
  it("never replays a mutating or unannotated tool on expired HTTP session, but reconnects for future calls", async () => {
    let expireNext = true;
    const state: ReplayHarnessState = {
      readCalls: 0,
      writeCalls: 0,
      unknownCalls: 0,
      readOnlyFlagForFlipper: true,
      flipperCalls: 0,
      onToolCallFetch: () => {
        if (!expireNext) return undefined;
        expireNext = false;
        return Response.json({ error: "session expired" }, { status: 404 });
      },
    };
    mountReplayServer(state);

    const manager = new McpClientManager({
      servers: { ops: { type: "http", url: SERVER_URL } },
    });
    managers.push(manager);
    await manager.start();

    let mutatingError: unknown;
    try {
      await manager.callTool("mcp__ops__charge_card", {});
    } catch (error) {
      mutatingError = error;
    }

    expect(isMcpToolCallReplayRefusedError(mutatingError)).toBe(true);
    expect(mutatingError).toBeInstanceOf(McpToolCallReplayRefusedError);
    expect(mutatingError).toMatchObject({
      code: "MCP_TOOL_CALL_REPLAY_REFUSED",
      serverId: "ops",
      toolName: "charge_card",
      reason: "session_expired",
      reconnected: true,
      status: 404,
    });
    expect(mcpToolCallWasNotSent(mutatingError)).toBe(false);
    expect(state.writeCalls).toBe(0);

    await expect(
      manager.callTool("mcp__ops__charge_card", {}),
    ).resolves.toMatchObject({
      content: [{ type: "text", text: "charged:1" }],
    });
    expect(state.writeCalls).toBe(1);

    expireNext = true;
    await expect(
      manager.callTool("mcp__ops__unannotated_action", {}),
    ).rejects.toMatchObject({
      code: "MCP_TOOL_CALL_REPLAY_REFUSED",
      toolName: "unannotated_action",
      reason: "session_expired",
      reconnected: true,
    });
    expect(state.unknownCalls).toBe(0);
  });

  it("auto-replays read-only tools on disconnect unless caller forbids replay", async () => {
    let failCount = 1;
    const state: ReplayHarnessState = {
      readCalls: 0,
      writeCalls: 0,
      unknownCalls: 0,
      readOnlyFlagForFlipper: true,
      flipperCalls: 0,
      onToolCallFetch: () => {
        if (failCount <= 0) return undefined;
        failCount -= 1;
        return "throw-disconnect";
      },
    };
    mountReplayServer(state);

    const manager = new McpClientManager({
      servers: { ops: { type: "http", url: SERVER_URL } },
    });
    managers.push(manager);
    await manager.start();

    await expect(
      manager.callTool("mcp__ops__read_items", {}),
    ).resolves.toMatchObject({
      content: [{ type: "text", text: "read:1" }],
    });
    expect(state.readCalls).toBe(1);

    failCount = 1;
    await expect(
      manager.callTool("mcp__ops__read_items", {}, { allowReplay: false }),
    ).rejects.toMatchObject({
      code: "MCP_TOOL_CALL_REPLAY_REFUSED",
      toolName: "read_items",
      reason: "transport_disconnect",
      reconnected: true,
    });
    expect(state.readCalls).toBe(1);

    failCount = 1;
    await expect(
      manager.callTool("mcp__ops__read_items", {}, { idempotent: false }),
    ).rejects.toMatchObject({
      code: "MCP_TOOL_CALL_REPLAY_REFUSED",
      toolName: "read_items",
      reason: "transport_disconnect",
      reconnected: true,
    });
    expect(state.readCalls).toBe(1);
  });

  it("replays a mutating tool only when caller explicitly sets retryOnDisconnect: true", async () => {
    let failOnce = true;
    const state: ReplayHarnessState = {
      readCalls: 0,
      writeCalls: 0,
      unknownCalls: 0,
      readOnlyFlagForFlipper: true,
      flipperCalls: 0,
      onToolCallFetch: () => {
        if (!failOnce) return undefined;
        failOnce = false;
        return Response.json({ error: "session expired" }, { status: 404 });
      },
    };
    mountReplayServer(state);

    const manager = new McpClientManager({
      servers: { ops: { type: "http", url: SERVER_URL } },
    });
    managers.push(manager);
    await manager.start();

    await expect(
      manager.callTool(
        "mcp__ops__charge_card",
        {},
        { retryOnDisconnect: true },
      ),
    ).resolves.toMatchObject({
      content: [{ type: "text", text: "charged:1" }],
    });
    expect(state.writeCalls).toBe(1);

    failOnce = true;
    await expect(
      manager.callTool(
        "mcp__ops__charge_card",
        {},
        { retryOnDisconnect: true, idempotent: false },
      ),
    ).rejects.toMatchObject({
      code: "MCP_TOOL_CALL_REPLAY_REFUSED",
      reason: "session_expired",
      reconnected: true,
    });
    expect(state.writeCalls).toBe(1);
  });

  it("refuses replay if tool metadata loses readOnlyHint across reconnect", async () => {
    let expiredOnce = false;
    const state: ReplayHarnessState = {
      readCalls: 0,
      writeCalls: 0,
      unknownCalls: 0,
      readOnlyFlagForFlipper: true,
      flipperCalls: 0,
      onToolCallFetch: () => {
        if (expiredOnce) return undefined;
        expiredOnce = true;
        state.readOnlyFlagForFlipper = false;
        return Response.json({ error: "session expired" }, { status: 404 });
      },
    };
    mountReplayServer(state);

    const manager = new McpClientManager({
      servers: { ops: { type: "http", url: SERVER_URL } },
    });
    managers.push(manager);
    await manager.start();

    await expect(
      manager.callTool("mcp__ops__flipping_tool", {}),
    ).rejects.toMatchObject({
      code: "MCP_TOOL_CALL_REPLAY_REFUSED",
      toolName: "flipping_tool",
      reason: "session_expired",
      reconnected: true,
    });
    expect(state.flipperCalls).toBe(0);
  });

  it("reports reconnected: false when reconnect fails after a non-replayable disconnect", async () => {
    const state: ReplayHarnessState = {
      readCalls: 0,
      writeCalls: 0,
      unknownCalls: 0,
      readOnlyFlagForFlipper: true,
      flipperCalls: 0,
      onToolCallFetch: () => {
        state.failReconnect = true;
        return "throw-disconnect";
      },
    };
    mountReplayServer(state);

    const manager = new McpClientManager({
      servers: { ops: { type: "http", url: SERVER_URL } },
    });
    managers.push(manager);
    await manager.start();

    let caught: unknown;
    try {
      await manager.callTool("mcp__ops__charge_card", {});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(McpToolCallReplayRefusedError);
    expect(caught).toMatchObject({
      code: "MCP_TOOL_CALL_REPLAY_REFUSED",
      reason: "transport_disconnect",
      reconnected: false,
    });
    expect(
      (caught as McpToolCallReplayRefusedError).reconnectError,
    ).toBeTruthy();
  });

  it("handles mixed concurrent read-only and mutating calls on session expiry without replaying the mutation", async () => {
    let expirationsRemaining = 2;
    const state: ReplayHarnessState = {
      readCalls: 0,
      writeCalls: 0,
      unknownCalls: 0,
      readOnlyFlagForFlipper: true,
      flipperCalls: 0,
      onToolCallFetch: () => {
        if (expirationsRemaining <= 0) return undefined;
        expirationsRemaining -= 1;
        return Response.json({ error: "session expired" }, { status: 404 });
      },
    };
    mountReplayServer(state);

    const manager = new McpClientManager({
      servers: { ops: { type: "http", url: SERVER_URL } },
    });
    managers.push(manager);
    await manager.start();

    const [readOutcome, writeOutcome] = await Promise.allSettled([
      manager.callTool("mcp__ops__read_items", {}),
      manager.callTool("mcp__ops__charge_card", {}),
    ]);

    expect(readOutcome.status).toBe("fulfilled");
    expect(writeOutcome.status).toBe("rejected");
    expect(
      writeOutcome.status === "rejected" ? writeOutcome.reason : undefined,
    ).toMatchObject({
      code: "MCP_TOOL_CALL_REPLAY_REFUSED",
      toolName: "charge_card",
      reason: "session_expired",
      reconnected: true,
    });
    expect(state.readCalls).toBe(1);
    expect(state.writeCalls).toBe(0);
  });

  it("does not reconnect or wrap non-disconnect JSON-RPC server errors", async () => {
    const state: ReplayHarnessState = {
      readCalls: 0,
      writeCalls: 0,
      unknownCalls: 0,
      readOnlyFlagForFlipper: true,
      flipperCalls: 0,
      onToolCallFetch: (_toolName, _callIndex, requestId) =>
        Response.json({
          jsonrpc: "2.0",
          id: requestId ?? null,
          error: { code: -32603, message: "Database not connected" },
        }),
    };
    mountReplayServer(state);

    const manager = new McpClientManager({
      servers: { ops: { type: "http", url: SERVER_URL } },
    });
    managers.push(manager);
    await manager.start();

    let caught: unknown;
    try {
      await manager.callTool("mcp__ops__charge_card", {});
    } catch (error) {
      caught = error;
    }

    expect(isMcpToolCallReplayRefusedError(caught)).toBe(false);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("Database not connected");
  });
});
