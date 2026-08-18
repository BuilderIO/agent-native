// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { buildDeckPptxBlobMock } = vi.hoisted(() => ({
  buildDeckPptxBlobMock: vi.fn(),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: () => "/slides",
}));

vi.mock("./export-pptx-client", () => ({
  buildDeckPptxBlob: buildDeckPptxBlobMock,
}));

import {
  exportDeckToGoogleSlides,
  fetchDeckPptxFromServer,
} from "./export-google-slides-client";

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const serverPptxResponse = () =>
  new Response(new Blob(["PK-server-vector"], { type: PPTX_MIME }), {
    status: 200,
    headers: {
      "content-disposition": 'attachment; filename="quarterly-review.pptx"',
      "content-type": PPTX_MIME,
    },
  });

/** The file the Drive upload actually carried, as text. */
async function uploadedPptxText() {
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([url]) =>
      String(url).endsWith("/api/exports/google-slides"),
    );
  const form = (call?.[1] as RequestInit).body as FormData;
  return (form.get("file") as Blob).text();
}

beforeEach(() => {
  vi.clearAllMocks();
  buildDeckPptxBlobMock.mockResolvedValue({
    blob: new Blob(["pptx"]),
    filename: "quarterly-review.pptx",
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pptx");
  globalThis.fetch = vi.fn(async () => {
    return new Response(
      JSON.stringify({
        code: "google-not-connected",
        error: "No connected Google account.",
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exportDeckToGoogleSlides", () => {
  it("returns a connection requirement without downloading a fallback PPTX", async () => {
    await expect(
      exportDeckToGoogleSlides("Quarterly Review", [{ id: "slide-1" }]),
    ).resolves.toEqual({
      url: null,
      requiresConnection: true,
      reason: "No connected Google account.",
    });

    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "/slides/api/exports/google-slides",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uploads the browser-rendered PPTX for an editor-authored deck", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ url: "https://docs.google.com/d/new" }), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      exportDeckToGoogleSlides("Quarterly Review", [{ id: "slide-1" }]),
    ).resolves.toEqual({ url: "https://docs.google.com/d/new" });

    expect(buildDeckPptxBlobMock).toHaveBeenCalledTimes(1);
    expect(await uploadedPptxText()).toBe("pptx");
  });

  it("uploads the server-built PPTX when the caller supplies one", async () => {
    // dom-to-pptx rasterizes every custGeom shape, so a source-imported deck
    // must reach Drive as the server's vector build, not the browser's.
    vi.mocked(fetch).mockImplementation((async (url: string) =>
      url.endsWith("/api/exports/pptx")
        ? serverPptxResponse()
        : new Response(
            JSON.stringify({ url: "https://docs.google.com/d/new" }),
            {
              headers: { "Content-Type": "application/json" },
            },
          )) as unknown as typeof fetch);

    await expect(
      exportDeckToGoogleSlides(
        "Quarterly Review",
        [{ id: "slide-1" }],
        "16:9",
        () => fetchDeckPptxFromServer("deck-1", "Could not export PPTX."),
      ),
    ).resolves.toEqual({ url: "https://docs.google.com/d/new" });

    expect(buildDeckPptxBlobMock).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "/slides/api/exports/pptx",
      expect.objectContaining({ body: JSON.stringify({ deckId: "deck-1" }) }),
    );
    expect(await uploadedPptxText()).toBe("PK-server-vector");
  });

  it("propagates the server's positioned-object guard without uploading", async () => {
    const guard =
      "Slide 3 contains freeform positioned objects. Export this deck from the Slides editor with Export > PowerPoint so browser-rendered geometry is preserved.";
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: guard }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      exportDeckToGoogleSlides(
        "Quarterly Review",
        [{ id: "slide-1" }],
        "16:9",
        () => fetchDeckPptxFromServer("deck-1", "Could not export PPTX."),
      ),
    ).rejects.toThrow(guard);

    // No silent downgrade: neither the browser exporter nor Drive was reached.
    expect(buildDeckPptxBlobMock).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
