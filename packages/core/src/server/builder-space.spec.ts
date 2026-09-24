import { describe, expect, it, vi } from "vitest";

import {
  clearBuilderSpaceCache,
  getCachedBuilderSpaces,
  listBuilderSpaces,
  parseSpacesFromSettings,
} from "./builder-space";

describe("Builder space resolution", () => {
  it("does not expose secret-like settings keys as space ids", () => {
    expect(
      parseSpacesFromSettings({
        data: {
          settings: {
            name: "Alice Space",
            key: "public-looking-secret",
            apiKey: "api-key-secret",
          },
        },
      }),
    ).toEqual([{ id: "Alice Space", name: "Alice Space" }]);
  });

  it("uses whitelisted non-secret ids when present", () => {
    expect(
      parseSpacesFromSettings({
        data: {
          settings: {
            name: "Alice Space",
            spaceId: "space-123",
            key: "ignored",
          },
        },
      }),
    ).toEqual([{ id: "space-123", name: "Alice Space" }]);
  });

  it("caches by the full private key hash instead of a shared suffix", async () => {
    clearBuilderSpaceCache();
    process.env.BUILDER_ADMIN_API_HOST = "https://builder-admin.test";
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: { settings: { name: "Space", id: "space-id" } },
        }),
        { status: 200 },
      );
    });

    await listBuilderSpaces("bpk-first-shared-tail", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await listBuilderSpaces("bpk-second-shared-tail", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(getCachedBuilderSpaces("bpk-first-shared-tail")).toEqual([
      { id: "space-id", name: "Space" },
    ]);
    delete process.env.BUILDER_ADMIN_API_HOST;
    clearBuilderSpaceCache();
  });
});
