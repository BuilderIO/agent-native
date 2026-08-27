import { describe, expect, it, vi } from "vitest";

const mockCallAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mockCallAction(...args),
  deleteClientAppState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("react-dom", () => ({
  flushSync: (callback: () => void) => callback(),
}));

import { startDeckGeneration } from "./create-deck-generation";

describe("startDeckGeneration", () => {
  it("keeps an attached PDF as reference material even when pasted text mentions preserving slides", async () => {
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
    expect(mockCallAction).not.toHaveBeenCalledWith(
      "import-file",
      expect.anything(),
      expect.anything(),
    );
    expect(agentSubmit).toHaveBeenCalledOnce();
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
        prompt: "Use the attached image as visual source material",
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
  });
});
