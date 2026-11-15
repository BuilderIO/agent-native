import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./store.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./store.js")>();
  return {
    ...original,
    deleteSetting: vi.fn(),
    deleteSettingsByPrefix: vi.fn(),
    getSetting: vi.fn(),
    getSettingEntry: vi.fn(),
    listSettingsByPrefix: vi.fn(),
    mutateSetting: vi.fn(),
    putSetting: vi.fn(),
  };
});

import {
  deleteAllOrgSettings,
  deleteOrgSetting,
  mutateOrgSetting,
  putOrgSetting,
} from "./org-settings.js";
import {
  deleteSetting,
  deleteSettingsByPrefix,
  mutateSetting,
  putSetting,
} from "./store.js";

describe("org-settings writes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("stamps the organization scope on each write", async () => {
    vi.mocked(deleteSetting).mockResolvedValue(true);
    vi.mocked(deleteSettingsByPrefix).mockResolvedValue(2);
    vi.mocked(mutateSetting).mockResolvedValue({ enabled: true });

    await putOrgSetting("org-a", "feature", { enabled: true });
    await mutateOrgSetting("org-a", "feature", () => ({ enabled: true }));
    await deleteOrgSetting("org-a", "feature");
    await deleteAllOrgSettings("org-a");

    expect(putSetting).toHaveBeenCalledWith(
      "o:org-a:feature",
      {
        enabled: true,
      },
      { orgId: "org-a" },
    );
    expect(mutateSetting).toHaveBeenCalledWith(
      "o:org-a:feature",
      expect.any(Function),
      { orgId: "org-a" },
    );
    expect(deleteSetting).toHaveBeenCalledWith("o:org-a:feature", {
      orgId: "org-a",
    });
    expect(deleteSettingsByPrefix).toHaveBeenCalledWith("o:org-a:", {
      orgId: "org-a",
    });
  });

  it("rejects contradictory scope options", async () => {
    // @ts-expect-error Runtime callers may bypass the TypeScript contract.
    await expect(
      putOrgSetting(
        "org-a",
        "feature",
        { enabled: true },
        {
          global: true,
        },
      ),
    ).rejects.toMatchObject({ code: "SETTINGS_SCOPE_CONFLICT" });

    expect(putSetting).not.toHaveBeenCalled();
  });
});
