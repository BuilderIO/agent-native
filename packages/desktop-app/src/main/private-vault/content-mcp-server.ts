import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const MCP_PATH = "/mcp";
const MAXIMUM_MCP_REQUEST_BYTES = 2 * 1024 * 1024;
const MAXIMUM_MCP_RESULT_BYTES = 2 * 1024 * 1024;

const ACTIONS = {
  "view-screen":
    "Read the local Private Content navigation state without document text.",
  "list-documents": "List private encrypted Content documents.",
  "search-documents": "Search private encrypted Content locally.",
  "get-document": "Read one private encrypted Content document.",
  "pull-document": "Read one private document as markdown or plain text.",
  "create-document": "Create one private encrypted Content document.",
  "update-document": "Update fields on one private encrypted document.",
  "edit-document": "Apply surgical text edits to one private document.",
  "move-document": "Move one private document in the document tree.",
  "delete-document": "Delete one private document from the active manifest.",
  "list-document-versions": "List encrypted history for one private document.",
  "restore-document-version":
    "Restore one encrypted private document version as a new revision.",
} as const;

const UNSUPPORTED_ACTIONS = {
  "add-comment": "Comments are not encrypted in Private Vault beta.",
  "list-comments": "Comments are not encrypted in Private Vault beta.",
  "update-comment": "Comments are not encrypted in Private Vault beta.",
  "delete-comment": "Comments are not encrypted in Private Vault beta.",
  "create-content-database":
    "Content databases are not encrypted in Private Vault beta.",
  "create-inline-content-database":
    "Content databases are not encrypted in Private Vault beta.",
  "get-content-database":
    "Content databases are not encrypted in Private Vault beta.",
  "list-content-databases":
    "Content databases are not encrypted in Private Vault beta.",
  "add-database-item":
    "Content databases are not encrypted in Private Vault beta.",
  "submit-content-database-form":
    "Content databases are not encrypted in Private Vault beta.",
  "get-public-document":
    "Public publishing is incompatible with Private Vault beta.",
  "export-document":
    "Document export is unavailable until the encrypted export ceremony is complete.",
  "import-content-source":
    "Imports require the explicit Private Vault migration ceremony.",
  "export-content-source":
    "Source export is unavailable until the encrypted export ceremony is complete.",
  "pull-notion-page":
    "Notion and other integrations are not encrypted in Private Vault beta.",
  "push-notion-page":
    "Notion and other integrations are not encrypted in Private Vault beta.",
  "pull-builder-doc":
    "Builder and other source integrations are not encrypted in Private Vault beta.",
  "push-builder-doc":
    "Builder and other source integrations are not encrypted in Private Vault beta.",
  "attach-content-database-source":
    "Source federation is not encrypted in Private Vault beta.",
  "transcribe-media": "Media is not encrypted in Private Vault beta.",
  "create-extension": "Extensions cannot access Private Vault beta.",
  "update-extension": "Extensions cannot access Private Vault beta.",
  "delete-extension": "Extensions cannot access Private Vault beta.",
} as const;

const PRIVATE_CONTENT_CAPABILITIES = Object.freeze({
  version: 1,
  surface: "signed-desktop-only",
  fallback: "none",
  supported: Object.freeze(Object.keys(ACTIONS).sort()),
  unavailable: Object.freeze({
    collaboration: "Comments and realtime collaboration are not encrypted.",
    databases: "Databases, properties, forms, and views are not encrypted.",
    extensions: "Extensions cannot access the private vault.",
    integrations: "Notion, Builder, and provider integrations are unavailable.",
    media: "Media upload, transcription, and derived assets are unavailable.",
    publishing: "Private documents cannot be made public or token-shared.",
    sourceFederation:
      "Imports, source sync, and source federation are unavailable.",
  }),
});

type ActionName = keyof typeof ACTIONS;

interface RunContext {
  readonly runId: string;
  readonly subjectAgentId: string;
}

export interface PrivateVaultContentMcpRegistration {
  readonly url: string;
  readonly bearerToken: string;
}

export class PrivateVaultContentMcpBridge {
  readonly #contextsByTokenHash = new Map<string, RunContext>();
  readonly #tokenHashesByRun = new Map<string, Set<string>>();
  readonly #requestContext = new AsyncLocalStorage<RunContext>();
  readonly #token: () => string;
  readonly #runAction: (input: {
    actionName: ActionName;
    args: unknown;
    subjectAgentId: string;
  }) => Promise<unknown>;
  #httpServer?: HttpServer;
  #url?: string;

  constructor(input: {
    runAction(input: {
      actionName: ActionName;
      args: unknown;
      subjectAgentId: string;
    }): Promise<unknown>;
    token?: () => string;
  }) {
    this.#runAction = input.runAction;
    this.#token = input.token ?? (() => randomBytes(32).toString("base64url"));
  }

  async start(): Promise<string> {
    if (this.#url) return this.#url;
    const server = createServer((request, response) => {
      void this.#handleRequest(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo;
    this.#httpServer = server;
    this.#url = `http://127.0.0.1:${address.port}${MCP_PATH}`;
    return this.#url;
  }

  registerRun(
    runId: string,
    subjectAgentId: string,
  ): PrivateVaultContentMcpRegistration {
    if (!this.#url || !runId.trim() || !lowerHex(subjectAgentId, 16))
      throw new Error("Private Content agent bridge unavailable");
    this.#removeRun(runId);
    const bearerToken = this.#token();
    if (!/^[A-Za-z0-9_-]{32,}$/.test(bearerToken))
      throw new Error("Private Content agent bridge unavailable");
    const tokenHash = hash(bearerToken);
    this.#contextsByTokenHash.set(tokenHash, { runId, subjectAgentId });
    this.#tokenHashesByRun.set(runId, new Set([tokenHash]));
    return Object.freeze({ url: this.#url, bearerToken });
  }

  revokeRun(runId: string): void {
    this.#removeRun(runId);
  }

  async close(): Promise<void> {
    this.#contextsByTokenHash.clear();
    this.#tokenHashesByRun.clear();
    const server = this.#httpServer;
    this.#httpServer = undefined;
    this.#url = undefined;
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  #removeRun(runId: string): void {
    for (const tokenHash of this.#tokenHashesByRun.get(runId) ?? [])
      this.#contextsByTokenHash.delete(tokenHash);
    this.#tokenHashesByRun.delete(runId);
  }

  async #handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const contentLength = Number(request.headers["content-length"]);
    if (
      request.url !== MCP_PATH ||
      request.socket.remoteAddress !== "127.0.0.1" ||
      request.method !== "POST"
    ) {
      response.writeHead(404).end();
      return;
    }
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength <= 0 ||
      contentLength > MAXIMUM_MCP_REQUEST_BYTES
    ) {
      response.writeHead(413).end();
      return;
    }
    const token = bearer(request.headers.authorization);
    const context = token
      ? this.#contextsByTokenHash.get(hash(token))
      : undefined;
    if (!context) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const mcp = new McpServer({
      name: "agent-native-private-content",
      version: "1.0.0",
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    this.#registerTools(mcp);
    try {
      await mcp.connect(transport);
      response.once("close", () => {
        void transport.close().catch(() => undefined);
        void mcp.close().catch(() => undefined);
      });
      await this.#requestContext.run(context, () =>
        transport.handleRequest(request, response),
      );
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  }

  #registerTools(mcp: McpServer): void {
    for (const [actionName, description] of Object.entries(ACTIONS) as Array<
      [ActionName, string]
    >) {
      mcp.registerTool(
        actionName,
        {
          description: `${description} Pass the normal Content action arguments inside args.`,
          inputSchema: {
            args: z.record(z.string().max(256), z.unknown()).default({}),
          },
          annotations: {
            readOnlyHint: [
              "view-screen",
              "list-documents",
              "search-documents",
              "get-document",
              "pull-document",
              "list-document-versions",
            ].includes(actionName),
            openWorldHint: false,
          },
        },
        async ({ args }) => {
          const context = this.#requestContext.getStore();
          if (!context) throw new Error("Private Content action unavailable");
          const result = await this.#runAction({
            actionName,
            args,
            subjectAgentId: context.subjectAgentId,
          });
          const text = JSON.stringify(result);
          if (Buffer.byteLength(text) > MAXIMUM_MCP_RESULT_BYTES)
            throw new Error("Private Content action unavailable");
          return { content: [{ type: "text" as const, text }] };
        },
      );
    }
    mcp.registerTool(
      "private-content-capabilities",
      {
        description:
          "List the exact signed-Desktop Private Vault beta capabilities and fail-closed gaps without reading content.",
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(PRIVATE_CONTENT_CAPABILITIES),
          },
        ],
      }),
    );
    for (const [actionName, reason] of Object.entries(UNSUPPORTED_ACTIONS)) {
      mcp.registerTool(
        actionName,
        {
          description: `${reason} This Private Vault tool always fails closed and never queues work.`,
          inputSchema: {
            args: z.record(z.string().max(256), z.unknown()).default({}),
          },
          annotations: { readOnlyHint: true, openWorldHint: false },
        },
        async () => ({
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `${reason} Use Standard Cloud only if the user explicitly chooses to move or disclose the content; Private Vault never falls back automatically.`,
            },
          ],
        }),
      );
    }
  }
}

function lowerHex(value: string, bytes: number): boolean {
  return value.length === bytes * 2 && /^[0-9a-f]+$/.test(value);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bearer(value: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(value ?? "");
  return match?.[1] ?? null;
}
