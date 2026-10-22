// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const requestString = (value: unknown) =>
  typeof value === "string"
    ? value
    : value instanceof URL
      ? value.toString()
      : value instanceof Request
        ? value.url
        : (JSON.stringify(value) ?? "");

const {
  buildDeckPptxBlobMock,
  googleDocsStatusMock,
  retargetPptxForGoogleSlidesMock,
  trackMock,
} = vi.hoisted(() => ({
  buildDeckPptxBlobMock: vi.fn(),
  googleDocsStatusMock: vi.fn(),
  retargetPptxForGoogleSlidesMock: vi.fn(async (blob: Blob) => blob),
  trackMock: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/client/analytics", () => ({
  track: trackMock,
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => `/slides${path}`,
  appBasePath: () => "/slides",
}));

vi.mock("./export-pptx-client", () => ({
  buildDeckPptxBlob: buildDeckPptxBlobMock,
}));

vi.mock("./pptx-google-slides", () => ({
  retargetPptxForGoogleSlides: retargetPptxForGoogleSlidesMock,
}));

vi.mock("./google-docs-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./google-docs-client")>()),
  getGoogleDocsStatus: googleDocsStatusMock,
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

async function uploadedPptxText() {
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([url]) =>
      requestString(url).endsWith("/api/exports/google-slides"),
    );
  const form = (call?.[1] as RequestInit | undefined)?.body as FormData;
  return (form.get("file") as Blob).text();
}

beforeEach(() => {
  vi.clearAllMocks();
  googleDocsStatusMock.mockResolvedValue({
    ok: true,
    status: 200,
    data: { connected: false },
    unreadable: false,
  });
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
  it("checks the connection before building or uploading a PPTX", async () => {
    await expect(
      exportDeckToGoogleSlides("Quarterly Review", [{ id: "slide-1" }]),
    ).resolves.toEqual({
      url: null,
      requiresConnection: true,
      reason: "No connected Google account.",
    });

    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(buildDeckPptxBlobMock).not.toHaveBeenCalled();
    expect(googleDocsStatusMock).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uploads the browser-rendered PPTX for an editor-authored deck", async () => {
    googleDocsStatusMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { connected: true },
      unreadable: false,
    });
    vi.mocked(fetch).mockImplementation(
      async (input: RequestInfo | URL) =>
        new Response(JSON.stringify({ url: "https://docs.google.com/d/new" }), {
          headers: { "Content-Type": "application/json" },
        }),
    );

    await expect(
      exportDeckToGoogleSlides("Quarterly Review", [{ id: "slide-1" }]),
    ).resolves.toEqual({ url: "https://docs.google.com/d/new" });

    expect(buildDeckPptxBlobMock).toHaveBeenCalledWith(
      "Quarterly Review",
      [{ id: "slide-1" }],
      undefined,
      { target: "google-slides" },
    );
    expect(await uploadedPptxText()).toBe("pptx");
  });

  it("uploads the server-built PPTX when the caller supplies one", async () => {
    googleDocsStatusMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { connected: true },
      unreadable: false,
    });
    vi.mocked(fetch).mockImplementation((async (input: RequestInfo | URL) => {
      const url = requestString(input);
      return url.endsWith("/api/exports/pptx")
        ? serverPptxResponse()
        : new Response(
            JSON.stringify({ url: "https://docs.google.com/d/new" }),
            {
              headers: { "Content-Type": "application/json" },
            },
          );
    }) as unknown as typeof fetch);

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
    expect(retargetPptxForGoogleSlidesMock).toHaveBeenCalledTimes(1);
    expect(await uploadedPptxText()).toBe("PK-server-vector");
  });

  it("propagates the server's positioned-object guard without uploading", async () => {
    googleDocsStatusMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { connected: true },
      unreadable: false,
    });
    const guard =
      "Slide 3 contains freeform positioned objects. Export this deck from the Slides editor with Export > PowerPoint so browser-rendered geometry is preserved.";
    vi.mocked(fetch).mockImplementation((async () => {
      return new Response(JSON.stringify({ error: guard }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch);

    await expect(
      exportDeckToGoogleSlides(
        "Quarterly Review",
        [{ id: "slide-1" }],
        "16:9",
        () => fetchDeckPptxFromServer("deck-1", "Could not export PPTX."),
      ),
    ).rejects.toThrow(guard);

    expect(buildDeckPptxBlobMock).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("hands deck analytics to the upload route and marks the PPTX step", async () => {
    googleDocsStatusMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { connected: true },
      unreadable: false,
    });
    vi.mocked(fetch).mockImplementation((async (input: RequestInfo | URL) => {
      const url = requestString(input);
      return url.endsWith("/api/exports/pptx")
        ? serverPptxResponse()
        : new Response(
            JSON.stringify({ url: "https://docs.google.com/d/new" }),
          );
    }) as unknown as typeof fetch);

    await exportDeckToGoogleSlides(
      "Quarterly Review",
      [{ id: "slide-1" }, { id: "slide-2" }],
      "16:9",
      () =>
        fetchDeckPptxFromServer(
          "deck-1",
          "Could not export PPTX.",
          "google_slides",
        ),
      { deckId: "deck-1", generationAttemptId: "attempt-1" },
    );

    expect(fetch).toHaveBeenCalledWith(
      "/slides/api/exports/pptx",
      expect.objectContaining({
        body: JSON.stringify({
          deckId: "deck-1",
          exportPurpose: "google_slides",
        }),
      }),
    );
    const uploadCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) =>
        requestString(url).endsWith("/api/exports/google-slides"),
      );
    const form = (uploadCall?.[1] as RequestInit).body as FormData;
    expect(form.get("deckId")).toBe("deck-1");
    expect(form.get("renderLocation")).toBe("server");
    expect(form.get("slideCount")).toBeNull();
    expect(form.get("generationAttemptId")).toBeNull();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("reports one failed export when the PPTX never reaches the upload route", async () => {
    googleDocsStatusMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { connected: true },
      unreadable: false,
    });
    buildDeckPptxBlobMock.mockRejectedValue(new Error("render failed"));

    await expect(
      exportDeckToGoogleSlides(
        "Quarterly Review",
        [{ id: "slide-1" }],
        undefined,
        undefined,
        { deckId: "deck-1" },
      ),
    ).rejects.toThrow("render failed");

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith("deck_exported", {
      output_id: "deck-1",
      output_type: "deck",
      export_format: "google_slides",
      render_location: "browser",
      status: "failed",
      error_type: "export_error",
      slide_count: 1,
      app_name: "slides-2",
      template_name: "slides-2",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a failed export when Google Drive is not connected", async () => {
    const result = await exportDeckToGoogleSlides(
      "Quarterly Review",
      [{ id: "slide-1" }],
      undefined,
      undefined,
      { deckId: "deck-1" },
    );

    expect(result).toMatchObject({ requiresConnection: true });
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      "deck_exported",
      expect.objectContaining({
        export_format: "google_slides",
        status: "failed",
        error_type: "google_not_connected",
      }),
    );
  });

  it("leaves an ambiguous upload rejection to the route's own event", async () => {
    googleDocsStatusMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { connected: true },
      unreadable: false,
    });
    vi.mocked(fetch).mockImplementation((async (input: RequestInfo | URL) => {
      if (requestString(input).includes("/api/exports/google-slides")) {
        throw new TypeError("Failed to fetch");
      }
      return new Response(JSON.stringify({ connected: true }));
    }) as typeof fetch);
    buildDeckPptxBlobMock.mockResolvedValue({
      blob: new Blob(["pptx"]),
      filename: "deck.pptx",
    });

    await expect(
      exportDeckToGoogleSlides(
        "Quarterly Review",
        [{ id: "slide-1" }],
        undefined,
        undefined,
        { deckId: "deck-1" },
      ),
    ).rejects.toThrow("Failed to fetch");

    expect(trackMock).not.toHaveBeenCalled();
  });

  it("reports a failed export when the connection check itself fails", async () => {
    googleDocsStatusMock.mockRejectedValue(new TypeError("Failed to fetch"));
    vi.mocked(fetch).mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(
      exportDeckToGoogleSlides(
        "Quarterly Review",
        [{ id: "slide-1" }],
        undefined,
        undefined,
        { deckId: "deck-1" },
      ),
    ).rejects.toThrow();

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      "deck_exported",
      expect.objectContaining({
        status: "failed",
        error_type: "connection_check_failed",
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
