import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";
import { runWithRequestContext } from "../server/request-context.js";
import { withServerMintedFullAppEmbedStart } from "./build-server.js";

const mint = vi.hoisted(() => vi.fn());

vi.mock("../server/embed-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/embed-session.js")>()),
  createEmbedSessionTicket: mint,
  normalizeEmbedTargetPath: (raw: string) =>
    raw.startsWith("/") ? raw : new URL(raw).pathname + new URL(raw).search,
}));
vi.mock("../server/embed-route.js", () => ({
  buildEmbedStartPath: (ticket: string) =>
    `/_agent-native/embed/start?ticket=${ticket}`,
}));

const ORIGIN = "https://mail.agent-native.test";
const ANCHOR = 1_790_000_000_000;

function entry(link?: ActionEntry["link"]): ActionEntry {
  return {
    tool: { description: "Open" },
    run: async () => ({}),
    ...(link ? { link } : {}),
  } as ActionEntry;
}

function inRequest<T>(
  fn: () => Promise<T>,
  context: { userEmail?: string; orgId?: string; requestOrigin?: string } = {
    userEmail: "owner@example.com",
    requestOrigin: ORIGIN,
  },
) {
  return runWithRequestContext(context, fn) as Promise<T>;
}

describe("withServerMintedFullAppEmbedStart", () => {
  beforeEach(() => {
    mint.mockReset();
    mint.mockResolvedValue({ ticket: "full", expiresAt: 42 });
  });

  it("mints an unscoped session for the result's page and drops stale tickets", async () => {
    const result = await inRequest(() =>
      withServerMintedFullAppEmbedStart(
        {
          id: "t-1",
          url: "/inbox/t-1",
          startUrl: `${ORIGIN}/_agent-native/embed/start?ticket=stale`,
        },
        entry(),
        {},
        ANCHOR,
      ),
    );
    expect(mint).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      targetPath: "/inbox/t-1?__an_mcp_chat_bridge=1",
      scope: null,
      revocationAnchorCreatedAtMs: ANCHOR,
    });
    expect(result).toEqual({
      id: "t-1",
      url: "/inbox/t-1",
      startUrl: "[hidden embed URL]",
      embedStartUrl: `${ORIGIN}/_agent-native/embed/start?ticket=full`,
      embedTargetPath: "/inbox/t-1?__an_mcp_chat_bridge=1",
      embedExpiresAt: 42,
    });
  });

  it("carries the caller's organization", async () => {
    await inRequest(
      () =>
        withServerMintedFullAppEmbedStart(
          { url: "/inbox" },
          entry(),
          {},
          ANCHOR,
        ),
      { userEmail: "owner@example.com", orgId: "org-1", requestOrigin: ORIGIN },
    );
    expect(mint).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
    );
  });

  it.each([
    [{ deepLinkUrl: "/a", url: "/b", path: "/c" }, "/a"],
    [{ url: "/b", path: "/c" }, "/b"],
    [{ path: "/c" }, "/c"],
    [{ deepLinkUrl: "[hidden embed URL]", path: "/c" }, "/c"],
  ])("picks the open link's target from %j", async (record, target) => {
    await inRequest(() =>
      withServerMintedFullAppEmbedStart(record, entry(), {}, ANCHOR),
    );
    expect(mint).toHaveBeenCalledWith(
      expect.objectContaining({
        targetPath: `${target}?__an_mcp_chat_bridge=1`,
      }),
    );
  });

  it("falls back to the tool's link, called only then", async () => {
    const link = vi.fn(() => ({ url: "/linked", label: "Open" }));
    await inRequest(() =>
      withServerMintedFullAppEmbedStart(
        { id: "x" },
        entry(link),
        { a: 1 },
        ANCHOR,
      ),
    );
    expect(link).toHaveBeenCalledWith({
      args: { a: 1 },
      result: { id: "x", embed: false },
    });
    expect(mint).toHaveBeenCalledWith(
      expect.objectContaining({ targetPath: "/linked?__an_mcp_chat_bridge=1" }),
    );

    link.mockClear();
    await inRequest(() =>
      withServerMintedFullAppEmbedStart(
        { url: "/own" },
        entry(link),
        {},
        ANCHOR,
      ),
    );
    expect(link).not.toHaveBeenCalled();
  });

  it("opens nothing when the only link throws, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const record = { id: "x" };
      const result = await inRequest(() =>
        withServerMintedFullAppEmbedStart(
          record,
          entry(() => {
            throw new Error("broken link");
          }),
          {},
          ANCHOR,
        ),
      );
      expect(result).toBe(record);
      expect(mint).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("The tool's link threw"),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps a session the action minted itself", async () => {
    const record = { embedStartUrl: "https://other.test/start?ticket=own" };
    await expect(
      inRequest(() =>
        withServerMintedFullAppEmbedStart(record, entry(), {}, ANCHOR),
      ),
    ).resolves.toBe(record);
    expect(mint).not.toHaveBeenCalled();
  });

  it("drops every ticket from a result that opts out", async () => {
    await expect(
      inRequest(() =>
        withServerMintedFullAppEmbedStart(
          {
            embed: false,
            url: "/inbox",
            embedStartUrl: `${ORIGIN}/_agent-native/embed/start?ticket=own`,
            embedTargetPath: "/inbox",
            embedExpiresAt: 1,
          },
          entry(),
          {},
          ANCHOR,
        ),
      ),
    ).resolves.toEqual({ embed: false, url: "/inbox" });
    expect(mint).not.toHaveBeenCalled();
  });

  it.each([
    ["no caller", { requestOrigin: ORIGIN }],
    ["a blank caller", { userEmail: "  ", requestOrigin: ORIGIN }],
    ["no origin", { userEmail: "owner@example.com" }],
  ])("mints nothing with %s", async (_label, context) => {
    const record = { url: "/inbox" };
    await expect(
      inRequest(
        () => withServerMintedFullAppEmbedStart(record, entry(), {}, ANCHOR),
        context,
      ),
    ).resolves.toBe(record);
    expect(mint).not.toHaveBeenCalled();
  });

  it.each([null, "text", ["/inbox"]])(
    "returns a %j result as it is",
    async (value) => {
      await expect(
        inRequest(() =>
          withServerMintedFullAppEmbedStart(value, entry(), {}, ANCHOR),
        ),
      ).resolves.toBe(value);
      expect(mint).not.toHaveBeenCalled();
    },
  );

  it("mints nothing when no target is a page", async () => {
    const record = {
      url: `${ORIGIN}/_agent-native/embed/start?ticket=x`,
      path: 7,
    };
    await inRequest(() =>
      withServerMintedFullAppEmbedStart(record, entry(), {}, ANCHOR),
    );
    expect(mint).not.toHaveBeenCalled();
  });
});
