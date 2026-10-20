import { describe, expect, it, vi } from "vitest";

import { loadPinnedCommunitySourceAttachments } from "./community-source.js";

const SOURCE = {
  id: "community-fixture",
  repo: "BuilderIO/agent-native",
  ref: "main",
  templatePath: "templates/community/qr",
  files: [
    {
      path: "README.md",
      blobSha: "f2ba8f84ab5c1bce84a7b441cb1959cfc7093b7f",
    },
  ],
};

describe("pinned community source attachments", () => {
  it("loads HTTPS files at the pinned source ref and verifies Git blob ids", async () => {
    const fetchSource = vi.fn(async () => new Response("abc", { status: 200 }));

    await expect(
      loadPinnedCommunitySourceAttachments(
        SOURCE,
        "community-qr",
        fetchSource as any,
      ),
    ).resolves.toEqual([
      {
        type: "upload",
        contentType: "text/plain",
        name: "community-qr/README.md",
        text: "abc",
        dataUrl: "",
        id: "community-fixture:README.md",
      },
    ]);

    expect(fetchSource).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/BuilderIO/agent-native/" +
        `${SOURCE.ref}/templates/community/qr/README.md`,
      expect.objectContaining({
        headers: { Accept: "text/plain" },
        signal: expect.any(AbortSignal),
      }),
      expect.objectContaining({
        followRedirects: false,
        maxRedirects: 0,
        httpsOnly: true,
      }),
    );
    expect(fetchSource.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchSource.mock.calls[0]?.[1]?.signal.aborted).toBe(false);
  });

  it("rejects content that does not match the pinned Git blob id", async () => {
    const fetchSource = vi.fn(
      async () => new Response("changed", { status: 200 }),
    );

    await expect(
      loadPinnedCommunitySourceAttachments(
        SOURCE,
        "community-qr",
        fetchSource as any,
      ),
    ).rejects.toThrow("failed its Git blob check");
  });

  it("rejects source refs outside main", async () => {
    await expect(
      loadPinnedCommunitySourceAttachments(
        { ...SOURCE, ref: "untrusted-branch" },
        "community-qr",
        vi.fn() as any,
      ),
    ).rejects.toThrow("no valid pinned file set");
  });

  it("rejects redirects and non-success responses without accepting source", async () => {
    const fetchSource = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://example.test/file" },
        }),
    );

    await expect(
      loadPinnedCommunitySourceAttachments(
        SOURCE,
        "community-qr",
        fetchSource as any,
      ),
    ).rejects.toThrow("could not be loaded (302)");
  });

  it("reports transport failures separately from pinned content failures", async () => {
    const fetchSource = vi.fn(async () => {
      throw new TypeError("network unavailable");
    });

    await expect(
      loadPinnedCommunitySourceAttachments(
        SOURCE,
        "community-qr",
        fetchSource as any,
      ),
    ).rejects.toThrow("network request failed");
  });
});
