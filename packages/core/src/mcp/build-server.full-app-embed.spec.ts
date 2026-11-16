import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";
import { runWithRequestContext } from "../server/request-context.js";
import { withServerMintedFullAppEmbedStart } from "./build-server.js";

const mint = vi.hoisted(() => vi.fn());
const ticketOwner = vi.hoisted(() => vi.fn());

vi.mock("../server/embed-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/embed-session.js")>()),
  createEmbedSessionTicket: mint,
  embedSessionTicketBelongsTo: ticketOwner,
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
    ticketOwner.mockReset();
    ticketOwner.mockImplementation(
      async (ticket: string, owner: string) =>
        ticket === "own" && owner === "owner@example.com",
    );
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
      scope: "full-app",
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
    [{ deepLinkUrl: "//evil.example/inbox", path: "/c" }, "/c"],
    [{ deepLinkUrl: "/\\evil.example/inbox", path: "/c" }, "/c"],
    [{ deepLinkUrl: "https://evil.example/inbox", url: "/b" }, "/b"],
    [{ url: `${ORIGIN}/inbox/full` }, "/inbox/full"],
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

  it.each([
    ["this app, for the caller", "/_agent-native/embed/start?ticket=own", true],
    [
      "another app on this origin",
      `${ORIGIN}/calendar/_agent-native/embed/start?ticket=theirs`,
      false,
    ],
  ])("keeps a session minted by %s", async (_label, url, checkedHere) => {
    const record = { embedStartUrl: url };
    const opener = checkedHere
      ? entry()
      : ({ ...entry(), opensAnotherAppEmbed: true } as ActionEntry);
    await expect(
      inRequest(() =>
        withServerMintedFullAppEmbedStart(record, opener, {}, ANCHOR),
      ),
    ).resolves.toBe(record);
    expect(ticketOwner).toHaveBeenCalledTimes(checkedHere ? 1 : 0);
    expect(mint).not.toHaveBeenCalled();
  });

  it("drops another app's same-origin ticket from an action that does not open apps", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await inRequest(() =>
        withServerMintedFullAppEmbedStart(
          {
            url: "/inbox",
            embedStartUrl: `${ORIGIN}/calendar/_agent-native/embed/start?ticket=theirs`,
          },
          entry(),
          {},
          ANCHOR,
        ),
      );
      expect(JSON.stringify(result)).not.toContain("ticket=theirs");
      expect(ticketOwner).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    `${ORIGIN}/_agent-native/embed/start?ticket=someone-elses`,
    `${ORIGIN}/_agent-native/embed/start`,
    "https://other.test/_agent-native/embed/start?ticket=own",
    `${ORIGIN}/inbox?ticket=own`,
    "//other.test/_agent-native/embed/start?ticket=own",
    "/\\other.test/_agent-native/embed/start?ticket=own",
  ])("replaces a start URL this server did not issue: %s", async (url) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await inRequest(() =>
        withServerMintedFullAppEmbedStart(
          { url: "/inbox", embedStartUrl: url },
          entry(),
          {},
          ANCHOR,
        ),
      );
      expect(result).toMatchObject({
        embedStartUrl: `${ORIGIN}/_agent-native/embed/start?ticket=full`,
      });
      expect(JSON.stringify(result)).not.toMatch(/ticket=(own|someone)/);
    } finally {
      warn.mockRestore();
    }
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
    ).resolves.toEqual(record);
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

  it("drops a start URL it did not issue even when it opens no page", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(
        inRequest(() =>
          withServerMintedFullAppEmbedStart(
            {
              title: "Inbox",
              embedStartUrl: `${ORIGIN}/_agent-native/embed/start?ticket=someone-elses`,
              embedTargetPath: "/inbox",
              embedExpiresAt: 1,
            },
            entry(),
            {},
            ANCHOR,
          ),
        ),
      ).resolves.toEqual({ title: "Inbox" });
      expect(mint).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps a start URL another app minted on its own origin only for an action that opens one", async () => {
    const url =
      "https://mail.other.test/_agent-native/embed/start?ticket=theirs";
    const opener = { ...entry(), opensAnotherAppEmbed: true } as ActionEntry;
    const record = { url: "https://mail.other.test/inbox", embedStartUrl: url };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(
        inRequest(() =>
          withServerMintedFullAppEmbedStart(record, opener, {}, ANCHOR),
        ),
      ).resolves.toBe(record);
      expect(ticketOwner).not.toHaveBeenCalled();
      const plain = await inRequest(() =>
        withServerMintedFullAppEmbedStart(record, entry(), {}, ANCHOR),
      );
      expect(JSON.stringify(plain)).not.toContain("ticket=theirs");
    } finally {
      warn.mockRestore();
    }
  });
});
