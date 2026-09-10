import { beforeEach, describe, expect, it, vi } from "vitest";

const ssrfSafeFetch = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch,
}));

const { rehostRemoteMedia } = await import("./private-artifacts.js");

function context(putPrivateBlob = vi.fn(async () => blobHandle())) {
  return {
    appId: "design",
    ownerEmail: "owner@example.com",
    putPrivateBlob,
  } as never;
}

function blobHandle() {
  return {
    id: "private-svg",
    provider: "fixture",
    opaque: true as const,
    encrypted: true,
  };
}

describe("private connector artifacts", () => {
  beforeEach(() => ssrfSafeFetch.mockReset());

  it("sanitizes SVGs and strips signed query credentials from provenance", async () => {
    ssrfSafeFetch.mockResolvedValue(
      new Response(
        '<svg xmlns="http://www.w3.org/2000/svg"><!-- provider --><use href="#mark"/><path id="mark" d="M0 0h1v1z"/></svg>',
        { status: 200, headers: { "content-type": "image/svg+xml" } },
      ),
    );
    const putPrivateBlob = vi.fn(async () => blobHandle());
    const media = await rehostRemoteMedia({
      url: "https://signed.example.com/logo.svg?X-Amz-Credential=top-secret#fragment",
      filename: "logo.svg",
      kind: "image",
      context: context(putPrivateBlob),
    });

    expect(media.provenanceUrl).toBe("https://signed.example.com/logo.svg");
    expect(JSON.stringify(media)).not.toContain("top-secret");
    expect(
      new TextDecoder().decode(putPrivateBlob.mock.calls[0]?.[0].data),
    ).not.toContain("provider");
    expect(putPrivateBlob.mock.calls[0]?.[0].key).toMatch(
      /^creative-context\/[a-f0-9]{24}\/[a-f0-9]{64}$/,
    );
    expect(putPrivateBlob.mock.calls[0]?.[0].key).not.toContain(
      "owner@example.com",
    );
  });

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://tracker.example/pixel.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>.x{fill:url(https://tracker.example/a)}</style></svg>',
  ])("rejects active or external SVG content", async (svg) => {
    ssrfSafeFetch.mockResolvedValue(
      new Response(svg, {
        status: 200,
        headers: { "content-type": "image/svg+xml" },
      }),
    );
    const putPrivateBlob = vi.fn(async () => blobHandle());

    await expect(
      rehostRemoteMedia({
        url: "https://signed.example.com/logo.svg?token=do-not-store",
        filename: "logo.svg",
        kind: "image",
        context: context(putPrivateBlob),
      }),
    ).rejects.toThrow(/SVG contains (?:active content|an external reference)/i);
    expect(putPrivateBlob).not.toHaveBeenCalled();
  });

  it("never includes a signed media URL in fetch failures", async () => {
    ssrfSafeFetch.mockResolvedValue(new Response("denied", { status: 403 }));
    const request = rehostRemoteMedia({
      url: "https://signed.example.com/logo.svg?token=do-not-log",
      filename: "logo.svg",
      kind: "image",
      context: context(),
    });

    await expect(request).rejects.toThrow("Media fetch failed (403).");
    await expect(request).rejects.not.toThrow("do-not-log");
  });
});
