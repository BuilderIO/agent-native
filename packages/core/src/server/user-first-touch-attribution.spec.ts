import { describe, expect, it, vi } from "vitest";

vi.mock("../db/client.js", () => ({ getDbExec: () => ({ execute: vi.fn() }) }));

const { persistUserFirstTouchAttribution, userFirstTouchColumnValues } =
  await import("./user-first-touch-attribution.js");

describe("user first-touch attribution", () => {
  it("maps only the marketing parameters onto bounded user columns", () => {
    expect(
      userFirstTouchColumnValues({
        referral_source: "external",
        utm_source: " google ",
        utm_medium: "cpc",
        gclid: "g".repeat(300),
        landing_referrer: "www.google.com",
        first_touch_path: "/pricing",
        utm_content: "",
      }),
    ).toEqual([
      ["first_touch_utm_source", "google"],
      ["first_touch_utm_medium", "cpc"],
      ["first_touch_gclid", "g".repeat(120)],
      ["first_touch_referrer", "www.google.com"],
    ]);
  });

  it("writes first touch once, never overwriting an existing value", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });

    await expect(
      persistUserFirstTouchAttribution(
        "user_1",
        { utm_source: "bing", msclkid: "click-1" },
        { execute },
      ),
    ).resolves.toBe(true);

    expect(execute).toHaveBeenCalledWith({
      sql: 'UPDATE "user" SET "first_touch_utm_source" = COALESCE("first_touch_utm_source", ?), "first_touch_msclkid" = COALESCE("first_touch_msclkid", ?) WHERE id = ?',
      args: ["bing", "click-1", "user_1"],
    });
  });

  it("skips the write when the signup carried no marketing parameters", async () => {
    const execute = vi.fn();

    await expect(
      persistUserFirstTouchAttribution(
        "user_1",
        { referral_source: "direct" },
        { execute },
      ),
    ).resolves.toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("surfaces a failed write instead of reporting success", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("column missing"));

    await expect(
      persistUserFirstTouchAttribution(
        "user_1",
        { utm_source: "bing" },
        { execute },
      ),
    ).rejects.toThrow("column missing");
  });
});
