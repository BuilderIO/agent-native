import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  orgId: "org-a" as string | undefined,
  store: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => mocks.orgId,
  getRequestUserEmail: () => "admin@example.test",
}));
vi.mock("@agent-native/core/settings", () => ({
  getSetting: async (key: string) => mocks.store.get(key) ?? null,
  putSetting: async (key: string, value: Record<string, unknown>) => {
    mocks.store.set(key, value);
  },
  getOrgSetting: async (orgId: string, key: string) =>
    mocks.store.get(`o:${orgId}:${key}`) ?? null,
  putOrgSetting: async (
    orgId: string,
    key: string,
    value: Record<string, unknown>,
  ) => {
    mocks.store.set(`o:${orgId}:${key}`, value);
  },
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(),
  assertAccess: vi.fn(),
}));
vi.mock("@agent-native/core/workspace-connections", () => ({
  listWorkspaceConnectionProviderCatalogForApp: vi.fn(),
}));
vi.mock("../db/index.js", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("../jobs/sync-sources.js", () => ({ nextBrainSourceSyncAt: vi.fn() }));
vi.mock("./audiences.js", () => ({ listAccessibleAudienceIds: vi.fn() }));
vi.mock("./brain.js", () => ({
  parseJson: vi.fn(),
  readBrainSettings: vi.fn(),
}));
vi.mock("./jev-classifier.js", () => ({ probeJevCredential: vi.fn() }));
vi.mock("./privacy-readiness.js", () => ({ brainPrivacyReadiness: vi.fn() }));
vi.mock("./search-index-contracts.js", () => ({
  BRAIN_SEARCH_INDEX_VERSION: 1,
  BRAIN_SENSITIVITY_POLICY_VERSION: 1,
}));
vi.mock("./search-index.js", () => ({ readEmbeddingReadiness: vi.fn() }));
vi.mock("./search.js", () => ({ redactSensitiveText: vi.fn() }));
vi.mock("./source-access.js", () => ({ personalGoogleSourceFilter: vi.fn() }));

import {
  readBrainEvalSnapshot,
  writeBrainEvalSnapshot,
} from "./brain-health.js";

const result = { ok: true, passed: 3, total: 4, score: 0.75 } as never;

describe("brain eval snapshot", () => {
  beforeEach(() => {
    mocks.store.clear();
    mocks.orgId = "org-a";
  });

  it("keeps one organization's last eval out of another's health view", async () => {
    await writeBrainEvalSnapshot(result);

    expect(await readBrainEvalSnapshot()).toMatchObject({ passed: 3 });
    mocks.orgId = "org-b";
    expect(await readBrainEvalSnapshot()).toBeNull();
  });

  it("does not read the deployment-wide row when an organization is active", async () => {
    mocks.orgId = undefined;
    await writeBrainEvalSnapshot(result);
    mocks.orgId = "org-a";

    expect(await readBrainEvalSnapshot()).toBeNull();
  });
});
