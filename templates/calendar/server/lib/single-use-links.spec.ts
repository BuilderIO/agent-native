import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", async () => {
  const schema =
    await vi.importActual<typeof import("../db/schema.js")>("../db/schema.js");
  return { getDb: getDbMock, schema };
});

vi.mock("@agent-native/core/server", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/core/server")
  >("@agent-native/core/server");
  return {
    ...actual,
    getAppProductionUrl: () => "https://calendar.example.test",
    withConfiguredAppBasePath: (url: string) => url,
  };
});

import * as dbModule from "../db/index.js";
import {
  buildSingleUseLinkUrl,
  consumeSingleUseLink,
  createSingleUseLink,
  deleteSingleUseLinksFor,
  getSingleUseLinkStatus,
  listSingleUseLinks,
  readSingleUseToken,
  releaseSingleUseLink,
  revokeSingleUseLink,
} from "./single-use-links.js";

const owner = "owner@example.test";

const SINGLE_USE_TOKENS_DDL = `
  CREATE TABLE IF NOT EXISTS booking_link_single_use_tokens (
    token TEXT PRIMARY KEY,
    booking_link_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    used_at TEXT,
    booking_id TEXT,
    revoked_at TEXT
  );
`;

describe("single-use links", () => {
  let client: PGlite;

  beforeEach(async () => {
    client = await PGlite.create("memory://");
    getDbMock.mockReset();
    getDbMock.mockReturnValue(drizzle(client, { schema: dbModule.schema }));
    await client.exec(SINGLE_USE_TOKENS_DDL);
  });

  afterEach(async () => {
    await client.close();
  });

  const consume = (
    token: string,
    bookingId: string,
    bookingLinkId = "link-1",
  ) =>
    dbModule.getDb().transaction((tx) =>
      consumeSingleUseLink(tx, {
        bookingLinkId,
        token,
        bookingId,
        usedAt: "2026-11-22T15:00:00.000Z",
      }),
    );

  it("mints an available token for a booking link", async () => {
    const created = await createSingleUseLink({
      bookingLinkId: "link-1",
      createdBy: owner,
    });

    expect(created).toMatchObject({
      bookingLinkId: "link-1",
      status: "available",
      createdBy: owner,
      usedAt: null,
      bookingId: null,
      revokedAt: null,
    });
    expect(readSingleUseToken(created.token)).toBe(created.token);
    expect(await getSingleUseLinkStatus("link-1", created.token)).toBe(
      "available",
    );
  });

  it("books once: the first consume wins and records its booking", async () => {
    const { token } = await createSingleUseLink({
      bookingLinkId: "link-1",
      createdBy: owner,
    });

    expect(await consume(token, "booking-1")).toBe(true);
    expect(await consume(token, "booking-2")).toBe(false);

    const [link] = await listSingleUseLinks("link-1");
    expect(link).toMatchObject({
      token,
      status: "used",
      bookingId: "booking-1",
      usedAt: "2026-11-22T15:00:00.000Z",
    });
  });

  it("lets exactly one of two racing bookings spend a token", async () => {
    const { token } = await createSingleUseLink({
      bookingLinkId: "link-1",
      createdBy: owner,
    });

    const results = await Promise.all([
      consume(token, "booking-1"),
      consume(token, "booking-2"),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("doesn't let a token book on another booking link", async () => {
    const { token } = await createSingleUseLink({
      bookingLinkId: "link-1",
      createdBy: owner,
    });

    expect(await getSingleUseLinkStatus("link-2", token)).toBe("missing");
    expect(await consume(token, "booking-1", "link-2")).toBe(false);
    expect(await getSingleUseLinkStatus("link-1", token)).toBe("available");
  });

  it("revokes an unused token, which then can't book", async () => {
    const { token } = await createSingleUseLink({
      bookingLinkId: "link-1",
      createdBy: owner,
    });

    const revoked = await revokeSingleUseLink("link-1", token);

    expect(revoked).toMatchObject({ status: "revoked" });
    expect(revoked?.revokedAt).toEqual(expect.any(String));
    expect(await consume(token, "booking-1")).toBe(false);
  });

  it("leaves a used token used when asked to revoke it", async () => {
    const { token } = await createSingleUseLink({
      bookingLinkId: "link-1",
      createdBy: owner,
    });
    await consume(token, "booking-1");

    const result = await revokeSingleUseLink("link-1", token);

    expect(result).toMatchObject({ status: "used", revokedAt: null });
  });

  it("returns null when revoking a token the link never issued", async () => {
    const { token } = await createSingleUseLink({
      bookingLinkId: "link-1",
      createdBy: owner,
    });

    expect(await revokeSingleUseLink("link-2", token)).toBeNull();
    expect(await revokeSingleUseLink("link-1", "unknown-token-1")).toBeNull();
  });

  it("gives a token back when its booking never went through", async () => {
    const { token } = await createSingleUseLink({
      bookingLinkId: "link-1",
      createdBy: owner,
    });
    await consume(token, "booking-1");

    await releaseSingleUseLink(dbModule.getDb(), "booking-1");

    expect(await getSingleUseLinkStatus("link-1", token)).toBe("available");
    expect(await consume(token, "booking-2")).toBe(true);
  });

  it("lists a link's tokens newest first and deletes them with the link", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-22T10:00:00.000Z"));
      const first = await createSingleUseLink({
        bookingLinkId: "link-1",
        createdBy: owner,
      });
      vi.setSystemTime(new Date("2026-11-22T11:00:00.000Z"));
      const second = await createSingleUseLink({
        bookingLinkId: "link-1",
        createdBy: owner,
      });
      await createSingleUseLink({ bookingLinkId: "link-2", createdBy: owner });

      expect(
        (await listSingleUseLinks("link-1")).map((link) => link.token),
      ).toEqual([second.token, first.token]);

      await deleteSingleUseLinksFor("link-1");

      expect(await listSingleUseLinks("link-1")).toEqual([]);
      expect(await listSingleUseLinks("link-2")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [undefined, undefined],
    [42, undefined],
    ["", undefined],
    ["short", undefined],
    ["has spaces in it", undefined],
    ["a".repeat(65), undefined],
    ["  V1StGXR8_Z5jdHi6B-myT  ", "V1StGXR8_Z5jdHi6B-myT"],
  ])("reads the query token %j as %j", (value, expected) => {
    expect(readSingleUseToken(value)).toBe(expected);
  });

  it("builds the public URL with the token as ?once=", () => {
    expect(
      buildSingleUseLinkUrl({ username: "owner", slug: "intro", token: "t-1" }),
    ).toBe("https://calendar.example.test/book/owner/intro?once=t-1");
    expect(
      buildSingleUseLinkUrl({ username: "", slug: "intro", token: "t-1" }),
    ).toBe("https://calendar.example.test/book/intro?once=t-1");
  });
});
