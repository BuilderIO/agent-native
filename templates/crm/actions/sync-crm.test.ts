import { describe, expect, it, vi } from "vitest";

const mirror = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock("../server/crm/crm-mirror.js", () => ({
  MAX_SYNC_PAGE_SIZE: 50,
  MAX_SYNC_PAGES: 5,
  syncCrmMirror: mirror.sync,
}));
vi.mock("../server/crm/adapter.js", () => ({
  createConnectedCrmAdapter: vi.fn(),
  isConnectedCrmProvider: (provider: string) =>
    provider === "hubspot" || provider === "salesforce",
}));
vi.mock("../server/db/index.js", () => ({ getDb: vi.fn(), schema: {} }));

import syncCrm from "./sync-crm.js";

describe("sync-crm input contract", () => {
  it("requires one bounded cohort selector", () => {
    expect(
      syncCrm.schema.safeParse({
        connectionId: "crm",
        objectType: "contacts",
        scope: {},
      }).success,
    ).toBe(false);
  });

  it("caps each remote page and this invocation's page count", () => {
    expect(
      syncCrm.schema.safeParse({
        connectionId: "crm",
        objectType: "contacts",
        scope: { recordIds: ["contact-1"] },
        pageSize: 51,
      }).success,
    ).toBe(false);
    expect(
      syncCrm.schema.safeParse({
        connectionId: "crm",
        objectType: "contacts",
        scope: { recordIds: ["contact-1"] },
        maxPages: 6,
      }).success,
    ).toBe(false);
  });
});
