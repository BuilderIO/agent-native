import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./google-auth.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./google-auth.js")>();
  return {
    ...original,
    getClientForConnectedAccount: vi.fn(async () => ({
      accessToken: "local-only-token",
    })),
    invalidateHistoryCacheForAccount: vi.fn(),
    invalidateListCacheForOwner: vi.fn(),
  };
});

const OWNER = "owner@example.test";
const ACCOUNT = "inbox@example.test";

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

describe("inbox sync with a local provider", () => {
  afterEach(async () => {
    const { closeDbExec } = await import("@agent-native/core/db");
    await closeDbExec();
    Reflect.deleteProperty(globalThis as object, "__agentNativePgliteClients");
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessLocks",
    );
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessExitCleanupRegistered",
    );
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("reads a bounded inbox slice and partitions mixed mail", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory");
    const pageSizes: number[] = [];
    const batchSizes: number[] = [];
    const queries: string[] = [];
    const server = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        response.setHeader("content-type", "application/json");
        if (url.pathname.endsWith("/profile")) {
          response.end(JSON.stringify({ historyId: "100" }));
        } else if (url.pathname.endsWith("/history")) {
          response.end(JSON.stringify({ historyId: "100", history: [] }));
        } else if (url.pathname.endsWith("/labels")) {
          response.end(JSON.stringify({ labels: [] }));
        } else if (url.pathname.endsWith("/threads")) {
          const pageSize = Number(url.searchParams.get("maxResults"));
          const offset = Number(url.searchParams.get("pageToken") ?? 0);
          queries.push(url.searchParams.get("q") ?? "");
          pageSizes.push(pageSize);
          const size = offset === 0 ? pageSize - 1 : pageSize;
          const end = Math.min(3000, offset + size);
          response.end(
            JSON.stringify({
              threads: [
                ...(offset === 0 ? [{ id: "a0" }] : []),
                ...Array.from({ length: end - offset }, (_, index) => ({
                  id: `t${offset + index}`,
                })),
              ],
              nextPageToken: end < 3000 ? String(end) : undefined,
            }),
          );
        } else if (url.pathname === "/batch/gmail/v1") {
          const body = await bodyOf(request);
          const ids = [
            ...body.matchAll(/GET \/gmail\/v1\/users\/me\/threads\/([ta]\d+)/g),
          ]
            .map((match) => match[0].split("/").pop())
            .filter((id): id is string => id !== undefined);
          batchSizes.push(ids.length);
          const parts = ids.map((id, index) => {
            const ordinal = Number(id.slice(1));
            const labels =
              ordinal % 4 === 0
                ? ["CATEGORY_PERSONAL"]
                : ordinal % 4 === 1
                  ? ["CATEGORY_UPDATES"]
                  : ordinal % 4 === 2
                    ? ["Label_github"]
                    : ["Label_pitch"];
            const payload = {
              id,
              historyId: "100",
              messages: [
                {
                  id: `${id}-m`,
                  internalDate: String(2_000_000 - ordinal),
                  labelIds: [
                    ...(id.startsWith("t") ? ["INBOX"] : []),
                    ...labels,
                  ],
                  payload: {
                    headers: [
                      { name: "From", value: "sender@example.test" },
                      { name: "To", value: OWNER },
                      { name: "Subject", value: "Synthetic" },
                    ],
                  },
                },
              ],
            };
            return `--local-response\r\nContent-Type: application/http\r\nContent-ID: <response-part-${index}>\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n`;
          });
          response.setHeader(
            "content-type",
            "multipart/mixed; boundary=local-response",
          );
          response.end(`${parts.join("")}--local-response--\r\n`);
        } else {
          response.writeHead(404);
          response.end(JSON.stringify({ error: "Unexpected request" }));
        }
      })().catch(() => {
        response.writeHead(500);
        response.end();
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("No local address");
      const nativeFetch = globalThis.fetch;
      vi.stubGlobal("fetch", (input: string, init: RequestInit) => {
        const source = new URL(input);
        if (source.hostname !== "gmail.googleapis.com")
          throw new Error("Unexpected provider host");
        return nativeFetch(
          `http://127.0.0.1:${address.port}${source.pathname}${source.search}`,
          init,
        );
      });
      const [{ default: initializeMailDb }, api, store, sync, tabs] =
        await Promise.all([
          import("../plugins/db.js"),
          import("./google-api.js"),
          import("./inbox-store.js"),
          import("./inbox-sync.js"),
          import("./inbox-tabs-server.js"),
        ]);
      await initializeMailDb({});
      await api.registerGmailAccountToken("local-only-token", OWNER, ACCOUNT);
      await sync.syncInboxAccount(OWNER, ACCOUNT, {
        connectedAccountEmails: [ACCOUNT],
        budgetMs: 10_000,
      });
      await sync.syncInboxAccount(OWNER, ACCOUNT, {
        connectedAccountEmails: [ACCOUNT],
        budgetMs: 10_000,
      });
      await sync.syncInboxAccount(OWNER, ACCOUNT, {
        connectedAccountEmails: [ACCOUNT],
        budgetMs: 10_000,
      });
      const rows = await store.readInboxThreads(OWNER, {
        accountEmails: [ACCOUNT],
      });
      expect(pageSizes).toEqual([50, 24]);
      expect(queries).toEqual(["in:inbox", "in:inbox"]);
      expect(batchSizes).toEqual([50, 24]);
      expect(rows).toHaveLength(73);
      expect(
        rows.every((row) => row.inInbox && row.labelIds.includes("INBOX")),
      ).toBe(true);
      const labels = new Map([
        ["Label_github", "github"],
        ["Label_pitch", "pitch"],
      ]);
      const items = rows.map((row) => store.inboxRowToItem(row, labels));
      const resolved = tabs.resolveInboxTabs(
        {
          pinnedLabels: ["github"],
          savedFilters: [
            { id: "pitches", name: "Pitches", query: "label:pitch" },
          ],
          labelAliases: {},
          combineInbox: false,
          showAllTab: false,
        },
        new Map(),
      );
      const partition = tabs.partitionInboxItems(items, resolved);
      expect(partition.get("important")).toHaveLength(19);
      expect(partition.get("other")).toHaveLength(18);
      expect(partition.get("github")).toHaveLength(18);
      expect(partition.get("pitches")).toHaveLength(18);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
