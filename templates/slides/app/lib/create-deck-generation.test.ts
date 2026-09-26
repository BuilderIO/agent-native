import { describe, expect, it, vi } from "vitest";

const mockCallAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mockCallAction(...args),
  deleteClientAppState: vi.fn().mockResolvedValue(undefined),
  getBrowserTabId: () => "test-tab",
}));

vi.mock("react-dom", () => ({
  flushSync: (callback: () => void) => callback(),
}));

import {
  describeUploadedFilesForAgent,
  getUploadedImageAgentOptions,
  isSourceImprovementRequest,
  requestedSlideCount,
  startDeckGeneration,
} from "./create-deck-generation";

describe("describeUploadedFilesForAgent", () => {
  it("uses supplied source context and blocks guessed file paths without uploads", () => {
    const context = describeUploadedFilesForAgent([], "deck-id");

    expect(context).toContain("No uploaded files are attached to this run");
    expect(context).toContain("Use source text already present");
    expect(context).toContain("Never invent a local file path");
    expect(context).toContain(
      "ask the user to upload the file or paste its contents",
    );
  });
});

describe("getUploadedImageAgentOptions", () => {
  it("does not forward oversized inline image data", () => {
    const oversizedDataUrl = `data:image/png;base64,${"a".repeat(1_000_000)}`;
    expect(
      getUploadedImageAgentOptions([
        {
          path: "/uploads/large.png",
          url: "https://cdn.example.test/large.png",
          originalName: "large.png",
          filename: "large.png",
          type: "image/png",
          size: 750_000,
          dataUrl: oversizedDataUrl,
        },
      ]),
    ).toEqual({
      referenceImagePaths: ["https://cdn.example.test/large.png"],
    });
  });

  it("caps the aggregate inline image payload while retaining every URL", () => {
    const dataUrls = Array.from(
      { length: 4 },
      (_, index) =>
        `data:image/png;base64,${String.fromCharCode(97 + index).repeat(800_000)}`,
    );
    const options = getUploadedImageAgentOptions(
      dataUrls.map((dataUrl, index) => ({
        path: `/uploads/image-${index}.png`,
        url: `https://cdn.example.test/image-${index}.png`,
        originalName: `image-${index}.png`,
        filename: `image-${index}.png`,
        type: "image/png",
        size: 600_000,
        dataUrl,
      })),
    );

    expect(options.referenceImagePaths).toHaveLength(4);
    expect(options.images).toHaveLength(3);
    expect(options.images).toEqual(dataUrls.slice(0, 3));
  });
});

describe("startDeckGeneration", () => {
  it("extracts an explicit target slide count for continuation", () => {
    expect(requestedSlideCount("Create a dark 6-slide presentation")).toBe(6);
    expect(requestedSlideCount("Create exactly 8 slides about launches")).toBe(
      8,
    );
    expect(requestedSlideCount("Create a deck about launches")).toBeUndefined();
  });

  it("correlates the generating route with its submitted chat run", async () => {
    mockCallAction.mockReset();
    mockCallAction.mockResolvedValue(undefined);
    const deck = {
      id: "deck-correlated-run",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const navigate = vi.fn();
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create a deck",
        files: [],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate,
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    const route = new URL(
      String(navigate.mock.calls[0]?.[0] ?? ""),
      "https://slides.test",
    );
    const routeSubmitId = route.searchParams.get("generationSubmitId");
    expect(route.searchParams.get("generating")).toBe("1");
    expect(routeSubmitId).toBeTruthy();
    expect(agentSubmit.mock.calls[0]?.[2]?.submitMessageId).toBe(routeSubmitId);
  });

  it("treats an implicit improvement prompt as source-preserving", () => {
    expect(
      isSourceImprovementRequest("Make this prettier", [
        {
          path: "/uploads/source.pptx",
          originalName: "source.pptx",
          filename: "source.pptx",
          type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          size: 1024,
        },
      ]),
    ).toBe(true);
  });

  it("treats slide-for-slide restyling requests as source-preserving", () => {
    expect(
      isSourceImprovementRequest(
        'Please turn this into a deck with our styling. Copy it slide for slide (though note I realized a couple slides are out of order) - a couple of the "after" slides are not right after their "before" slides.',
        [
          {
            path: "/uploads/source.pdf",
            originalName: "source.pdf",
            filename: "source.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
      ),
    ).toBe(true);
  });

  it("treats create-from-source requests that preserve order as source-preserving", () => {
    expect(
      isSourceImprovementRequest(
        "Create a slide deck from this PDF, preserving the same order",
        [
          {
            path: "/uploads/source.pdf",
            originalName: "source.pdf",
            filename: "source.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
      ),
    ).toBe(true);
  });

  it("defaults a plain source conversion to source-preserving", () => {
    expect(
      isSourceImprovementRequest(
        "Create deck: turn this into a deck using our branding",
        [
          {
            path: "/uploads/source.pdf",
            originalName: "source.pdf",
            filename: "source.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
      ),
    ).toBe(true);

    expect(
      isSourceImprovementRequest("Make this into a deck", [
        {
          path: "/uploads/source.pdf",
          originalName: "source.pdf",
          filename: "source.pdf",
          type: "application/pdf",
          size: 1024,
        },
      ]),
    ).toBe(true);
  });

  it("keeps an ordinary attached PDF as agent reference material", async () => {
    mockCallAction.mockImplementation(async (name: string) =>
      name === "import-file"
        ? {
            format: "pdf",
            pageCount: 2,
            textPageCount: 2,
            pages: [{ pageNum: 1, text: "REFERENCE_PAGE_ONE" }],
            styleDigest: {
              pageCount: 2,
              pageWidthPt: 960,
              pageHeightPt: 540,
              orientation: "landscape",
              aspectRatio: 1.778,
              backgroundColors: [],
              typeScale: [],
              paragraphAlignments: [],
              textMarginsPt: null,
              pagesWithImages: 0,
            },
          }
        : undefined,
    );
    const deck = {
      id: "deck-1",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt:
          "Create this as a focused deck, more like the attached deck. Here's the outline. Preserve the useful before and after examples, but ignore the numbers because they do not mean slides.",
        files: [
          {
            path: "/uploads/reference.pdf",
            originalName: "reference.pdf",
            filename: "ZiVAULRxvgAN1alyiLem.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
        attachments: [
          {
            type: "file",
            name: "reference.pdf",
            contentType: "application/pdf",
            displayOnly: true,
          },
          {
            type: "file",
            name: "pasted-text-1.txt",
            contentType: "text/plain",
            displayOnly: true,
            text: "outline",
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    expect(deck.slides).toEqual([]);
    expect(mockCallAction).toHaveBeenCalledWith(
      "import-file",
      expect.objectContaining({
        filePath: "/uploads/reference.pdf",
        format: "pdf",
      }),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(mockCallAction).not.toHaveBeenCalledWith(
      "import-file",
      expect.objectContaining({ importIntoDeck: true }),
      expect.anything(),
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "## Attached Reference Documents",
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain("REFERENCE_PAGE_ONE");
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "Measured visual language",
    );
    expect(agentSubmit).toHaveBeenCalledOnce();
    expect(agentSubmit.mock.calls[0]?.[0]).toBe(
      "Create this as a focused deck, more like the attached deck. Here's the outline. Preserve the useful before and after examples, but ignore the numbers because they do not mean slides.",
    );
    expect(agentSubmit.mock.calls[0]?.[0]).not.toContain("Create deck:");
    expect(agentSubmit.mock.calls[0]?.[1]).toContain("import-from-url");
    expect(agentSubmit.mock.calls[0]?.[2]?.attachments).toEqual([
      {
        type: "file",
        name: "reference.pdf",
        contentType: "application/pdf",
        displayOnly: true,
      },
      {
        type: "file",
        name: "pasted-text-1.txt",
        contentType: "text/plain",
        displayOnly: true,
        text: "outline",
      },
    ]);
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "Attachments are context for the agent by default",
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "do not import or append their slides",
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "write presenter-only text into each slide's `notes` field",
    );
    expect(mockCallAction).toHaveBeenCalledWith(
      "patch-deck",
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            fields: expect.objectContaining({
              generationContext: expect.objectContaining({
                originalPrompt:
                  "Create this as a focused deck, more like the attached deck. Here's the outline. Preserve the useful before and after examples, but ignore the numbers because they do not mean slides.",
                files: [
                  expect.objectContaining({ path: "/uploads/reference.pdf" }),
                ],
              }),
            }),
          }),
        ],
      }),
    );
  });

  it("lets a selected reference deck control styling without a design system", async () => {
    mockCallAction.mockImplementation(async (name: string) =>
      name === "get-deck-reference-context"
        ? { agentContext: "REFERENCE_STYLE_CONTEXT" }
        : undefined,
    );
    const deck = {
      id: "deck-reference-style",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create an about us deck",
        files: [],
        referenceSelection: { referenceDeckId: "reference-deck-1" },
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    const context = agentSubmit.mock.calls[0]?.[1] as string;
    expect(context).toContain("REFERENCE_STYLE_CONTEXT");
    expect(context).toContain("Follow its measured visual language");
    expect(context).not.toContain("Before generating a bare or on-brand deck");
    expect(context).not.toContain("use a light warm-neutral canvas");
  });

  it("keeps a reference-import file out of source-preserving mode", async () => {
    mockCallAction.mockClear();
    mockCallAction.mockResolvedValue(undefined);
    const deck = {
      id: "deck-reference-file",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create an about us deck",
        files: [
          {
            path: "/uploads/reference.pdf",
            originalName: "reference.pdf",
            filename: "reference.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
        referenceSelection: {
          referenceDeckId: "reference-deck-1",
          referenceFilePaths: ["/uploads/reference.pdf"],
          importedReferenceFilePath: "/uploads/reference.pdf",
        },
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    expect(mockCallAction).not.toHaveBeenCalledWith(
      "import-file",
      expect.anything(),
      expect.anything(),
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "Attachments are context for the agent by default",
    );
    expect(agentSubmit.mock.calls[0]?.[1]).not.toContain(
      "Source-preserving improvement mode",
    );
  });

  it("hydrates reference-import documents that were not imported into the deck", async () => {
    mockCallAction.mockReset();
    mockCallAction.mockImplementation(async (name: string) =>
      name === "import-file"
        ? {
            format: "pdf",
            pageCount: 1,
            textPageCount: 1,
            pages: [{ pageNum: 1, text: "SECOND_REFERENCE_TEXT" }],
          }
        : undefined,
    );
    const deck = {
      id: "deck-multiple-reference-files",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create a polished about us deck",
        files: [
          {
            path: "/uploads/reference.pptx",
            originalName: "reference.pptx",
            filename: "reference.pptx",
            type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            size: 1024,
          },
          {
            path: "/uploads/reference.pdf",
            originalName: "reference.pdf",
            filename: "reference.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
        referenceSelection: {
          referenceDeckId: "reference-deck-1",
          referenceFilePaths: [
            "/uploads/reference.pptx",
            "/uploads/reference.pdf",
          ],
          importedReferenceFilePath: "/uploads/reference.pptx",
        },
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    expect(mockCallAction).not.toHaveBeenCalledWith(
      "import-file",
      expect.objectContaining({ filePath: "/uploads/reference.pptx" }),
      expect.anything(),
    );
    expect(mockCallAction).toHaveBeenCalledWith(
      "import-file",
      expect.objectContaining({ filePath: "/uploads/reference.pdf" }),
      expect.anything(),
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain("SECOND_REFERENCE_TEXT");
    expect(agentSubmit.mock.calls[0]?.[1]).not.toContain(
      "Source-preserving improvement mode",
    );
  });

  it("passes hosted URLs and inline image bytes through to agentSubmit", async () => {
    const deck = {
      id: "deck-image-1",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();
    const inlineImage = "data:image/png;base64,aW1hZ2U=";

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Make this into a deck",
        files: [
          {
            path: "/uploads/hosted.png",
            url: "https://cdn.example.test/hosted.png",
            originalName: "hosted.png",
            filename: "hosted.png",
            type: "image/png",
            size: 1024,
            dataUrl: inlineImage,
          },
          {
            path: "/uploads/inline.jpg",
            originalName: "inline.jpg",
            filename: "inline.jpg",
            type: "image/jpeg",
            size: 1024,
            dataUrl: "data:image/jpeg;base64,amBlZw==",
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    expect(agentSubmit.mock.calls[0]?.[2]).toMatchObject({
      referenceImagePaths: ["https://cdn.example.test/hosted.png"],
      images: [inlineImage, "data:image/jpeg;base64,amBlZw=="],
    });
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "inspect the complete visual source",
    );
  });

  it("cleans up when generation context persistence fails", async () => {
    mockCallAction.mockRejectedValueOnce(new Error("context failed"));
    const deck = {
      id: "deck-context-failure",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const deleteDeck = vi.fn();
    const onSetupFailure = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create a deck",
        files: [],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck,
        navigate: vi.fn(),
        agentSubmit: vi.fn(),
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
        onSetupFailure,
      }),
    ).resolves.toBe("failed");

    expect(deleteDeck).toHaveBeenCalledWith(deck.id);
    expect(onSetupFailure).toHaveBeenCalledWith(
      "Create a deck",
      [],
      expect.objectContaining({ message: "context failed" }),
    );
  });

  it("imports an attached source PDF for a slide-for-slide restyling request", async () => {
    const deck = {
      id: "deck-source-1",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();
    mockCallAction.mockResolvedValue({
      imported: true,
      deckId: "deck-source-1",
      slideCount: 4,
    });

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt:
          'Please turn this into a deck with our styling. Copy it slide for slide (though note I realized a couple slides are out of order) - a couple of the "after" slides are not right after their "before" slides.',
        files: [
          {
            path: "/uploads/source.pdf",
            originalName: "source.pdf",
            filename: "source.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    expect(mockCallAction).toHaveBeenCalledWith(
      "import-file",
      {
        filePath: "/uploads/source.pdf",
        format: "pdf",
        deckId: "deck-source-1",
        importIntoDeck: true,
      },
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "Source-preserving improvement mode",
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "Do not use the new-deck add-slide workflow",
    );
  });

  it("lets a hydrated PDF reference, not the generic fallback, steer styling", async () => {
    mockCallAction.mockReset();
    mockCallAction.mockImplementation(async (name: string) =>
      name === "import-file"
        ? {
            format: "pdf",
            pageCount: 1,
            textPageCount: 1,
            pages: [{ pageNum: 1, text: "Investor update" }],
            styleDigest: {
              pageCount: 1,
              pageWidthPt: 960,
              pageHeightPt: 540,
              orientation: "landscape",
              aspectRatio: 1.778,
              backgroundColors: [{ color: "#0b1020", pageCount: 1 }],
              typeScale: [
                {
                  fontSizePt: 56,
                  fontFamily: "GT Super",
                  bold: true,
                  color: "#f7f5ef",
                  runCount: 4,
                  sample: "Investor update",
                },
              ],
              paragraphAlignments: [{ alignment: "left", blockCount: 6 }],
              textMarginsPt: { left: 72, right: 72, top: 56, bottom: 56 },
              pagesWithImages: 1,
            },
          }
        : undefined,
    );
    const deck = {
      id: "deck-styled-reference",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create a deck styled like the attached presentation",
        files: [
          {
            path: "/uploads/styled.pdf",
            originalName: "styled.pdf",
            filename: "styled.pdf",
            type: "application/pdf",
            size: 4096,
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    const context = agentSubmit.mock.calls[0]?.[1] as string;
    expect(context).toContain("56pt GT Super bold #f7f5ef");
    expect(context).toContain("#0b1020");
    expect(context).toContain("Follow its measured visual language");
    expect(context).not.toContain("use a light warm-neutral canvas");
    expect(context).not.toContain("Before generating a bare or on-brand deck");
    expect(context).not.toContain(
      "When no reference deck or hydrated design system is available, choose a subject-appropriate editorial direction",
    );
  });

  it("keeps the styling fallback for a reference that carries no design", async () => {
    mockCallAction.mockReset();
    mockCallAction.mockImplementation(async (name: string) =>
      name === "import-file"
        ? {
            format: "docx",
            sections: [
              { heading: "Overview", textPreview: "Why this matters" },
            ],
            textLength: 400,
          }
        : undefined,
    );
    const deck = {
      id: "deck-docx-reference",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Turn this brief into a deck",
        files: [
          {
            path: "/uploads/brief.docx",
            originalName: "brief.docx",
            filename: "brief.docx",
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: 2048,
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    const context = agentSubmit.mock.calls[0]?.[1] as string;
    expect(context).toContain("Overview: Why this matters");
    expect(context).toContain("Before generating a bare or on-brand deck");
    expect(context).toContain(
      "When no reference deck or hydrated design system is available, choose a subject-appropriate editorial direction",
    );
  });

  it("keeps the generic fallback when no reference is attached", async () => {
    mockCallAction.mockReset();
    mockCallAction.mockResolvedValue(undefined);
    const deck = {
      id: "deck-no-reference",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create a deck about our roadmap",
        files: [],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    const context = agentSubmit.mock.calls[0]?.[1] as string;
    expect(context).toContain(
      "If no workspace default exists, establish one deliberate deck-level visual contract",
    );
    expect(context).toContain(
      "When no reference deck or hydrated design system is available, choose a subject-appropriate editorial direction",
    );
  });

  it("blocks generation when an attached reference cannot be read", async () => {
    mockCallAction.mockReset();
    mockCallAction.mockImplementation(async (name: string) => {
      if (name === "import-file") {
        throw new Error(
          "Access denied: uploaded file reference is not valid for this user or organization",
        );
      }
      return undefined;
    });
    const deck = {
      id: "deck-unreadable-reference",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();
    const deleteDeck = vi.fn();
    const onSetupFailure = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create a deck that matches the attached reference exactly",
        files: [
          {
            path: "/uploads/reference.pdf",
            originalName: "reference.pdf",
            filename: "reference.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck,
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
        onSetupFailure,
      }),
    ).resolves.toBe("failed");

    expect(agentSubmit).not.toHaveBeenCalled();
    expect(deleteDeck).toHaveBeenCalledWith(deck.id);
    const failure = onSetupFailure.mock.calls[0]?.[2] as Error;
    expect(failure.message).toContain("reference.pdf");
    expect(failure.message).toContain("Access denied");
    expect(failure.message).toContain("Generation was stopped");
  });

  it("blocks generation when an attached reference yields no readable content", async () => {
    mockCallAction.mockReset();
    mockCallAction.mockImplementation(async (name: string) =>
      name === "import-file"
        ? { format: "pdf", pageCount: 3, textPageCount: 0, pages: [] }
        : undefined,
    );
    const deck = {
      id: "deck-empty-reference",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();
    const onSetupFailure = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Use the attached PDF as the visual reference",
        files: [
          {
            path: "/uploads/scanned.pdf",
            originalName: "scanned.pdf",
            filename: "scanned.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
        onSetupFailure,
      }),
    ).resolves.toBe("failed");

    expect(agentSubmit).not.toHaveBeenCalled();
    expect((onSetupFailure.mock.calls[0]?.[2] as Error).message).toContain(
      "scanned.pdf",
    );
  });

  it("passes lightweight attachment chips into the generation", async () => {
    const deck = {
      id: "deck-retry-1",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create a deck",
        files: [],
        attachments: [
          {
            type: "file",
            name: "reference.pdf",
            contentType: "application/pdf",
            displayOnly: true,
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    expect(agentSubmit.mock.calls[0]?.[2]?.attachments).toEqual([
      {
        type: "file",
        name: "reference.pdf",
        contentType: "application/pdf",
        displayOnly: true,
      },
    ]);
  });
});
