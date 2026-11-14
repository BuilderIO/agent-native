import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSetting = vi.fn();
const mockGetSettingEntry = vi.fn();
const mockGetSettings = vi.fn();
const mockMutateSetting = vi.fn();
const mockPutSetting = vi.fn();
const mockDeleteSetting = vi.fn();
const mockDeleteSettingIfValue = vi.fn();

vi.mock("./store.js", () => ({
  getSetting: (...args: any[]) => mockGetSetting(...args),
  getSettingEntry: (...args: any[]) => mockGetSettingEntry(...args),
  getSettings: (...args: any[]) => mockGetSettings(...args),
  mutateSetting: (...args: any[]) => mockMutateSetting(...args),
  putSetting: (...args: any[]) => mockPutSetting(...args),
  publishSettingChange: vi.fn(),
  invalidateSettingRequestCache: vi.fn(),
  deleteSetting: (...args: any[]) => mockDeleteSetting(...args),
  deleteSettingIfValue: (...args: any[]) => mockDeleteSettingIfValue(...args),
}));

import { getUserSettingEntry, mutateUserSetting } from "./user-settings.js";

const NORMALIZED = "u:alice@test.com:pref";
const LEGACY = "u:Alice@Test.com:pref";

describe("settings presence: getUserSettingEntry forwarding", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns a canonical array and never falls back to the legacy key", async () => {
    mockGetSettingEntry.mockResolvedValueOnce({ found: true, value: [1, 2] });

    const entry = await getUserSettingEntry("Alice@Test.com", "pref");

    expect(entry).toEqual({ found: true, value: [1, 2] });
    expect(mockGetSettingEntry).toHaveBeenCalledTimes(1);
    expect(mockGetSettingEntry).toHaveBeenCalledWith(NORMALIZED);
  });

  it("returns a canonical scalar and never falls back to the legacy key", async () => {
    mockGetSettingEntry.mockResolvedValueOnce({ found: true, value: 9 });

    expect(await getUserSettingEntry("Alice@Test.com", "pref")).toEqual({
      found: true,
      value: 9,
    });
    expect(mockGetSettingEntry).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a canonical JSON null from absent and does not fall back", async () => {
    mockGetSettingEntry.mockResolvedValueOnce({ found: true, value: null });

    expect(await getUserSettingEntry("Alice@Test.com", "pref")).toEqual({
      found: true,
      value: null,
    });
    expect(mockGetSettingEntry).toHaveBeenCalledTimes(1);
  });

  it("falls back to the legacy entry when the canonical row is absent", async () => {
    mockGetSettingEntry
      .mockResolvedValueOnce({ found: false })
      .mockResolvedValueOnce({ found: true, value: { value: 1 } });

    const entry = await getUserSettingEntry("Alice@Test.com", "pref");

    expect(entry).toEqual({ found: true, value: { value: 1 } });
    expect(mockGetSettingEntry).toHaveBeenNthCalledWith(1, NORMALIZED);
    expect(mockGetSettingEntry).toHaveBeenNthCalledWith(2, LEGACY);
  });

  it("returns absent for a mixed-case email when both keys are absent", async () => {
    mockGetSettingEntry.mockResolvedValue({ found: false });

    expect(await getUserSettingEntry("Alice@Test.com", "pref")).toEqual({
      found: false,
    });
    expect(mockGetSettingEntry).toHaveBeenNthCalledWith(1, NORMALIZED);
    expect(mockGetSettingEntry).toHaveBeenNthCalledWith(2, LEGACY);
  });

  it("forwards bypassCache to BOTH lookups", async () => {
    mockGetSettingEntry
      .mockResolvedValueOnce({ found: false })
      .mockResolvedValueOnce({ found: true, value: { value: 2 } });

    await getUserSettingEntry("Alice@Test.com", "pref", { bypassCache: true });

    expect(mockGetSettingEntry).toHaveBeenNthCalledWith(1, NORMALIZED, {
      bypassCache: true,
    });
    expect(mockGetSettingEntry).toHaveBeenNthCalledWith(2, LEGACY, {
      bypassCache: true,
    });
  });

  it("forwards the transaction to BOTH lookups", async () => {
    const transaction = { execute: vi.fn() } as any;
    mockGetSettingEntry
      .mockResolvedValueOnce({ found: false })
      .mockResolvedValueOnce({ found: true, value: { value: 3 } });

    await getUserSettingEntry("Alice@Test.com", "pref", { transaction });

    expect(mockGetSettingEntry).toHaveBeenNthCalledWith(1, NORMALIZED, {
      transaction,
    });
    expect(mockGetSettingEntry).toHaveBeenNthCalledWith(2, LEGACY, {
      transaction,
    });
  });
});

describe("settings presence: guarded legacy migration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("validates a present legacy entry before the updater and migrates it", async () => {
    const legacyValue = { value: 1 };
    mockGetSettingEntry.mockResolvedValueOnce({
      found: true,
      value: legacyValue,
    });
    mockMutateSetting.mockImplementation(
      async (_key: string, callback: (value: unknown) => unknown) =>
        callback(null),
    );
    const validator = vi.fn();
    const updater = vi.fn(() => legacyValue);

    await expect(
      mutateUserSetting("Alice@Test.com", "pref", updater, {
        validateStoredValue: validator,
      }),
    ).resolves.toEqual(legacyValue);

    expect(validator).toHaveBeenCalledWith(legacyValue);
    expect(updater).toHaveBeenCalledWith(legacyValue);
    expect(mockDeleteSettingIfValue).toHaveBeenCalledWith(LEGACY, legacyValue, {
      validateStoredValue: validator,
    });
  });

  it("rejects a present legacy JSON null through the async guard before updater or cleanup", async () => {
    mockGetSettingEntry.mockResolvedValueOnce({ found: true, value: null });
    mockMutateSetting.mockImplementation(
      async (_key: string, callback: (value: unknown) => unknown) =>
        callback(null),
    );
    const validator = vi.fn(async (value: unknown) => {
      await Promise.resolve();
      if (value === null) throw new Error("reject legacy null");
    });
    const updater = vi.fn(() => ({ value: 1 }));

    await expect(
      mutateUserSetting("Alice@Test.com", "pref", updater, {
        validateStoredValue: validator,
      }),
    ).rejects.toThrow("reject legacy null");

    expect(updater).not.toHaveBeenCalled();
    expect(mockDeleteSettingIfValue).not.toHaveBeenCalled();
  });

  it("leaves a newer legacy row when a guarded migration loses the cleanup compare", async () => {
    const captured = { value: "captured" };
    const newer = { value: "newer" };
    mockGetSettingEntry.mockResolvedValueOnce({ found: true, value: captured });
    mockGetSetting.mockResolvedValueOnce(newer);
    mockDeleteSettingIfValue.mockResolvedValue(false);
    mockMutateSetting.mockImplementation(
      async (_key: string, callback: (value: unknown) => unknown) =>
        callback(null),
    );
    const validator = vi.fn();
    const updater = vi.fn(() => captured);

    await expect(
      mutateUserSetting("Alice@Test.com", "pref", updater, {
        validateStoredValue: validator,
      }),
    ).resolves.toEqual(captured);

    expect(validator).toHaveBeenCalledWith(captured);
    expect(mockDeleteSettingIfValue).toHaveBeenCalledTimes(1);
    expect(mockDeleteSettingIfValue).toHaveBeenCalledWith(LEGACY, captured, {
      validateStoredValue: validator,
    });
    expect(updater).toHaveBeenCalledWith(captured);
  });

  it("never removes a newer canonical writer when a guarded migration's cleanup loses twice", async () => {
    const captured = { value: "captured" };
    mockGetSettingEntry.mockResolvedValueOnce({ found: true, value: captured });
    mockGetSetting.mockResolvedValueOnce(null);
    mockDeleteSettingIfValue.mockResolvedValue(false);
    mockMutateSetting.mockImplementation(
      async (_key: string, callback: (value: unknown) => unknown) =>
        callback(null),
    );

    await expect(
      mutateUserSetting("Alice@Test.com", "pref", () => captured, {
        validateStoredValue: vi.fn(),
      }),
    ).resolves.toEqual(captured);

    expect(mockDeleteSettingIfValue).toHaveBeenNthCalledWith(
      1,
      LEGACY,
      captured,
      expect.anything(),
    );
    expect(mockDeleteSettingIfValue).toHaveBeenNthCalledWith(
      2,
      NORMALIZED,
      captured,
      expect.anything(),
    );
  });

  it("throws only when its own exact canonical write is removed after the legacy row vanished", async () => {
    const captured = { value: "captured" };
    mockGetSettingEntry.mockResolvedValueOnce({ found: true, value: captured });
    mockGetSetting.mockResolvedValueOnce(null);
    mockDeleteSettingIfValue.mockImplementation(
      async (key: string) => key === NORMALIZED,
    );
    mockMutateSetting.mockImplementation(
      async (_key: string, callback: (value: unknown) => unknown) =>
        callback(null),
    );

    await expect(
      mutateUserSetting("Alice@Test.com", "pref", () => captured, {
        validateStoredValue: vi.fn(),
      }),
    ).rejects.toThrow("deleted while migrating");

    expect(mockDeleteSettingIfValue).toHaveBeenNthCalledWith(
      2,
      NORMALIZED,
      captured,
      expect.anything(),
    );
  });

  it("resets migration tracking when a CAS retry sees canonical current", async () => {
    const legacyValue = { value: "legacy" };
    const canonicalValue = { value: "canonical" };
    mockGetSettingEntry.mockResolvedValue({ found: true, value: legacyValue });
    const validator = vi.fn();
    const updater = vi.fn(
      (current: Record<string, unknown> | null) => current ?? legacyValue,
    );
    mockMutateSetting.mockImplementation(
      async (
        _key: string,
        callback: (value: unknown) => unknown,
        opts?: { validateStoredValue?: (value: unknown) => void },
      ) => {
        const first = await callback(null);
        expect(first).toEqual(legacyValue);
        opts?.validateStoredValue?.(canonicalValue);
        return callback(canonicalValue);
      },
    );

    const result = await mutateUserSetting("Alice@Test.com", "pref", updater, {
      validateStoredValue: validator,
    });

    expect(result).toEqual(canonicalValue);
    expect(updater).toHaveBeenNthCalledWith(1, legacyValue);
    expect(updater).toHaveBeenNthCalledWith(2, canonicalValue);
    expect(mockDeleteSettingIfValue).not.toHaveBeenCalled();
  });
});
