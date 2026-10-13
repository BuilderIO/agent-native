import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const resolveMock = vi.hoisted(() => vi.fn());
const targetAccessMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (entry: unknown) => entry,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "caller@example.com",
  getRequestOrgId: () => "caller-org",
}));
vi.mock("nanoid", () => ({ nanoid: () => "copy-id" }));
vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: { assetTemplates: "asset_templates" },
}));
vi.mock("../server/lib/json.js", () => ({
  nowIso: () => "now",
  parseJson: (value: string) => JSON.parse(value),
  stringifyJson: JSON.stringify,
}));
vi.mock("./_helpers.js", () => ({ serializeTemplate: (row: unknown) => row }));
vi.mock("./_template-access.js", () => ({
  resolveTemplateAccess: resolveMock,
  assertTemplateTargetLibraryAccess: targetAccessMock,
}));
vi.mock("./_template-input.js", () => ({ templateHasPins: () => [] }));

import action from "./duplicate-template.js";

describe("duplicate-template", () => {
  beforeEach(() => vi.clearAllMocks());

  it("copies into a brand kit with the caller as owner", async () => {
    resolveMock.mockResolvedValue({
      resource: {
        id: "template-1",
        libraryId: null,
        title: "Global",
        settings: "{}",
        ownerEmail: "other@example.com",
        orgId: "other-org",
      },
    });
    const values = vi.fn(async () => undefined);
    getDbMock.mockReturnValue({ insert: vi.fn(() => ({ values })) });

    const result = await action.run({ id: "template-1", libraryId: "kit-1" });
    expect(targetAccessMock).toHaveBeenCalledWith("kit-1");
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: "kit-1",
        ownerEmail: "caller@example.com",
        orgId: "caller-org",
        visibility: "private",
      }),
    );
    expect(result).toMatchObject({
      ownerEmail: "caller@example.com",
      orgId: "caller-org",
    });
  });
});
