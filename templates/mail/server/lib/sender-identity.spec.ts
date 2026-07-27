import { describe, expect, it, vi } from "vitest";

import {
  formatSenderHeader,
  resolveGoogleSenderIdentity,
  usableDisplayName,
} from "./sender-identity";

describe("sender identity", () => {
  it("ignores email-as-display-name values", () => {
    expect(usableDisplayName("steve@builder.io", "steve@builder.io")).toBe(
      undefined,
    );
    expect(formatSenderHeader("steve@builder.io", "steve@builder.io")).toBe(
      "steve@builder.io",
    );
  });

  it("falls back from unusable Gmail send-as name to Google profile name", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        sendAs: [
          {
            sendAsEmail: "steve@builder.io",
            displayName: "steve@builder.io",
          },
        ],
      })
      .mockResolvedValueOnce({ name: "Steve Sewell" });
    const onResolvedDisplayName = vi.fn();

    await expect(
      resolveGoogleSenderIdentity({
        accessToken: "token",
        email: "steve@builder.io",
        fetcher,
        onResolvedDisplayName,
      }),
    ).resolves.toEqual({
      email: "steve@builder.io",
      displayName: "Steve Sewell",
      header: "Steve Sewell <steve@builder.io>",
    });
    expect(onResolvedDisplayName).toHaveBeenCalledWith("Steve Sewell");
  });

  it("uses a cached display name before falling back to profile", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ sendAs: [] });

    await expect(
      resolveGoogleSenderIdentity({
        accessToken: "token",
        email: "steve@builder.io",
        cachedName: "Steve Sewell",
        fetcher,
      }),
    ).resolves.toMatchObject({
      displayName: "Steve Sewell",
      header: "Steve Sewell <steve@builder.io>",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
