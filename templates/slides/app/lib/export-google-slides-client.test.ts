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

const { buildDeckPptxBlobMock, retargetPptxForGoogleSlidesMock, trackMock } =
  vi.hoisted(() => ({
    buildDeckPptxBlobMock: vi.fn(),
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
  buildDeckPptxBlobMock.mockResolvedValue({
    blob: new Blob(["pptx"]),
    filename: "quarterly-review.pptx",
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pptx");
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (requestString(input).endsWith("/_agent-native/google-docs/status")) {
      return new Response(JSON.stringify({ connected: false }), {
        headers: { "Content-Type": "application/json" },
      });
    }
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
    const [statusUrl, statusInit] = vi.mocked(fetch).mock.calls[0];
    expect(requestString(statusUrl)).toBe(
      "http://localhost:3000/slides/_agent-native/google-docs/status",
    );
    expect(statusInit).toEqual({ credentials: "same-origin" });
  });

  it("uploads the browser-rendered PPTX for an editor-authored deck", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) =>
      requestString(input).endsWith("/_agent-native/google-docs/status")
        ? new Response(JSON.stringify({ connected: true }))
        : new Response(
            JSON.stringify({ url: "https://docs.google.com/d/new" }),
            {
              headers: { "Content-Type": "application/json" },
            },
          ),
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
    vi.mocked(fetch).mockImplementation((async (input: RequestInfo | URL) => {
      const url = requestString(input);
      return url.endsWith("/_agent-native/google-docs/status")
        ? new Response(JSON.stringify({ connected: true }))
        : url.endsWith("/api/exports/pptx")
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
    const guard =
      "Slide 3 contains freeform positioned objects. Export this deck from the Slides editor with Export > PowerPoint so browser-rendered geometry is preserved.";
    vi.mocked(fetch).mockImplementation((async (input: RequestInfo | URL) => {
      const url = requestString(input);
      return url.endsWith("/_agent-native/google-docs/status")
        ? new Response(JSON.stringify({ connected: true }))
        : new Response(JSON.stringify({ error: guard }), {
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
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("hands deck analytics to the upload route and marks the PPTX step", async () => {
    vi.mocked(fetch).mockImplementation((async (input: RequestInfo | URL) => {
      const url = requestString(input);
      return url.endsWith("/_agent-native/google-docs/status")
        ? new Response(JSON.stringify({ connected: true }))
        : url.endsWith("/api/exports/pptx")
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
    vi.mocked(fetch).mockImplementation(
      async () => new Response(JSON.stringify({ connected: true })),
    );
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
      app_name: "slides",
      template_name: "slides",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports a failed export when Google Drive is not connected", async () => {
    vi.mocked(fetch).mockImplementation(
      async () => new Response(JSON.stringify({ connected: false })),
    );

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
  });
});
