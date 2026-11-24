import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getDb: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));

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

vi.mock("@agent-native/core/server/request-context", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/core/server/request-context")
  >("@agent-native/core/server/request-context");
  return { ...actual, getRequestUserEmail: mocks.getRequestUserEmail };
});

vi.mock("@agent-native/core/sharing", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/core/sharing")
  >("@agent-native/core/sharing");
  return {
    ...actual,
    assertAccess: mocks.assertAccess,
    registerShareableResource: vi.fn(),
  };
});

vi.mock("../server/db/index.js", async () => {
  const schema = await vi.importActual<typeof import("../server/db/schema.js")>(
    "../server/db/schema.js",
  );
  return { getDb: mocks.getDb, schema };
});

vi.mock("../server/handlers/booking-usernames.js", () => ({
  ensureBookingUsername: vi.fn(async () => "owner"),
}));

import { schema } from "../server/db/index.js";
import { singleUseLinkOutputSchema } from "../server/lib/single-use-links.js";
import createSingleUseLink from "./create-single-use-link.js";
import listSingleUseLinks from "./list-single-use-links.js";
import revokeSingleUseLink from "./revoke-single-use-link.js";

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

describe("single-use link actions", () => {
  let client: PGlite;

  beforeEach(async () => {
    vi.clearAllMocks();
    client = await PGlite.create("memory://");
    mocks.getDb.mockReturnValue(drizzle(client, { schema }));
    mocks.getRequestUserEmail.mockReturnValue(owner);
    mocks.assertAccess.mockResolvedValue({ role: "owner", resource: {} });
    await client.exec(`
      CREATE TABLE booking_links (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT,
        duration INTEGER NOT NULL DEFAULT 30,
        durations TEXT,
        hosts TEXT,
        custom_fields TEXT,
        conferencing TEXT,
        color TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        reminder_minutes INTEGER NOT NULL DEFAULT 1440,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      );
      INSERT INTO booking_links (id, slug, title, is_active, created_at, updated_at, owner_email)
      VALUES
        ('link-1', 'intro', 'Intro', true, '2026-11-01', '2026-11-01', 'owner@example.test'),
        ('link-off', 'paused', 'Paused', false, '2026-11-01', '2026-11-01', 'owner@example.test');
    `);
    await client.exec(SINGLE_USE_TOKENS_DDL);
  });

  afterEach(async () => {
    await client.close();
  });

  it("makes a single-use URL for an active link the caller can edit", async () => {
    const created = await createSingleUseLink.run({ bookingLinkId: "link-1" });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "booking-link",
      "link-1",
      "editor",
    );
    expect(singleUseLinkOutputSchema.parse(created)).toEqual(created);
    expect(created).toMatchObject({
      bookingLinkId: "link-1",
      status: "available",
      createdBy: owner,
      url: `https://calendar.example.test/book/owner/intro?once=${created.token}`,
    });
  });

  it("refuses a paused link", async () => {
    await expect(
      createSingleUseLink.run({ bookingLinkId: "link-off" }),
    ).rejects.toMatchObject({ errorCode: "booking_link_inactive" });
  });

  it("refuses a caller without edit access", async () => {
    mocks.assertAccess.mockRejectedValue(new Error("Requires editor role"));

    await expect(
      createSingleUseLink.run({ bookingLinkId: "link-1" }),
    ).rejects.toThrow("Requires editor role");
    await expect(
      listSingleUseLinks.run({ bookingLinkId: "link-1" }),
    ).rejects.toThrow("Requires editor role");
  });

  it("lists, revokes, and refuses to revoke a used URL", async () => {
    const first = await createSingleUseLink.run({ bookingLinkId: "link-1" });
    const second = await createSingleUseLink.run({ bookingLinkId: "link-1" });
    await client.query(
      `UPDATE booking_link_single_use_tokens SET used_at = '2026-11-22', booking_id = 'booking-1' WHERE token = $1`,
      [second.token],
    );

    const revoked = await revokeSingleUseLink.run({
      bookingLinkId: "link-1",
      token: first.token,
    });
    expect(singleUseLinkOutputSchema.parse(revoked)).toEqual(revoked);
    expect(revoked).toMatchObject({ token: first.token, status: "revoked" });

    await expect(
      revokeSingleUseLink.run({ bookingLinkId: "link-1", token: second.token }),
    ).rejects.toMatchObject({ errorCode: "single_use_link_used" });
    await expect(
      revokeSingleUseLink.run({
        bookingLinkId: "link-1",
        token: "nope-nope-1",
      }),
    ).rejects.toMatchObject({ errorCode: "single_use_link_not_found" });

    const listed = await listSingleUseLinks.run({ bookingLinkId: "link-1" });
    expect(
      listed.links.map((link) => singleUseLinkOutputSchema.parse(link)),
    ).toEqual(listed.links);
    expect(
      Object.fromEntries(listed.links.map((link) => [link.token, link.status])),
    ).toEqual({ [first.token]: "revoked", [second.token]: "used" });
    expect(listed.links.every((link) => link.url.endsWith(link.token))).toBe(
      true,
    );
  });
});
