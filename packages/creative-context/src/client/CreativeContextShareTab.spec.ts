import { describe, expect, it, vi } from "vitest";

import {
  normalizeCreativeContextResources,
  requiresBroaderPublication,
  submitCreativeContextResources,
} from "./CreativeContextShareTab.js";

describe("CreativeContextShareTab bulk submission", () => {
  const assets = [
    {
      appId: "assets",
      resourceType: "asset",
      resourceId: "asset-1",
      title: "One",
    },
    {
      appId: "assets",
      resourceType: "asset",
      resourceId: "asset-2",
      title: "Two",
    },
  ];

  it("submits every exact resource and reports partial failures", async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("capture failed"));
    await expect(
      submitCreativeContextResources({
        contextId: "context-1",
        resources: assets,
        rank: "normal",
        mutateAsync,
      }),
    ).resolves.toEqual({ submitted: 1, failed: 1 });
    expect(mutateAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        nativeResource: expect.objectContaining({ resourceId: "asset-1" }),
      }),
    );
    expect(mutateAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        nativeResource: expect.objectContaining({ resourceId: "asset-2" }),
      }),
    );
  });

  it("deduplicates bounded resource input and requires broader publication confirmation", () => {
    expect(
      normalizeCreativeContextResources(undefined, [...assets, assets[0]!]),
    ).toHaveLength(2);
    expect(
      requiresBroaderPublication(
        { ...assets[0]!, visibility: "private" },
        {
          id: "context-1",
          name: "Shared",
          kind: "default",
          memberCount: 0,
          approvalPolicy: "open",
          visibility: "org",
        },
      ),
    ).toBe(true);
  });
});
