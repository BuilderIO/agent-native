import { describe, expect, it } from "vitest";
import {
  appendA2AArtifactLinks,
  buildA2ARecoverableArtifactMessage,
} from "./artifact-response.js";

describe("appendA2AArtifactLinks", () => {
  it("appends a document URL from a successful create-document result", () => {
    const text = appendA2AArtifactLinks(
      "Created the brief.",
      [
        {
          tool: "create-document",
          result: JSON.stringify({ id: "doc_123", title: "Launch Brief" }),
        },
      ],
      { baseUrl: "https://content.agent.test/" },
    );

    expect(text).toContain(
      "https://content.agent.test/page/doc_123 (ID: doc_123)",
    );
  });

  it("does not duplicate a document path that is already in the response", () => {
    const text = appendA2AArtifactLinks(
      "Created it: https://content.agent.test/page/doc_123",
      [
        {
          tool: "create-document",
          result: JSON.stringify({ id: "doc_123", title: "Launch Brief" }),
        },
      ],
      { baseUrl: "https://content.agent.test" },
    );

    expect(text).not.toContain("Artifacts:");
  });

  it("appends a deck URL from a successful create-deck result", () => {
    const text = appendA2AArtifactLinks(
      "Created the deck.",
      [
        {
          tool: "create-deck",
          result: JSON.stringify({ id: "deck_123", title: "Roadmap" }),
        },
      ],
      { baseUrl: "https://slides.agent.test/" },
    );

    expect(text).toContain(
      "- Deck: https://slides.agent.test/deck/deck_123 (ID: deck_123)",
    );
  });

  it("treats add-slide with a positive slide count as a recoverable deck artifact", () => {
    const text = buildA2ARecoverableArtifactMessage(
      [
        {
          tool: "add-slide",
          result: JSON.stringify({ deckId: "deck_123", slideCount: 3 }),
        },
      ],
      { baseUrl: "https://slides.agent.test/" },
    );

    expect(text).toContain(
      "- Deck: https://slides.agent.test/deck/deck_123 (ID: deck_123)",
    );
  });

  it("prefers canonical URLs returned by successful artifact actions", () => {
    const text = appendA2AArtifactLinks(
      "Created the deck.",
      [
        {
          tool: "create-deck",
          result: JSON.stringify({
            id: "deck_123",
            title: "Roadmap",
            url: "https://workspace.example.test/slides/deck/deck_123",
          }),
        },
      ],
      { baseUrl: "https://slides.agent.test/" },
    );

    expect(text).toContain(
      "- Deck: https://workspace.example.test/slides/deck/deck_123 (ID: deck_123)",
    );
  });

  it("does not duplicate a deck path that is already in the response", () => {
    const text = appendA2AArtifactLinks(
      "Created it: https://slides.agent.test/deck/deck_123",
      [
        {
          tool: "create-deck",
          result: JSON.stringify({ id: "deck_123", title: "Roadmap" }),
        },
      ],
      { baseUrl: "https://slides.agent.test" },
    );

    expect(text).not.toContain("Artifacts:");
  });

  it("blocks hallucinated deck URLs with no successful deck action", () => {
    const text = appendA2AArtifactLinks(
      "Done: https://slides.agent.test/deck/deck_404",
      [],
      { baseUrl: "https://slides.agent.test" },
    );

    expect(text).toContain("could not verify the deck URL");
    expect(text).not.toContain("deck_404");
    expect(text).not.toContain("https://slides.agent.test/deck/");
  });

  it("does not validate deck-shaped URLs on another host", () => {
    const text = appendA2AArtifactLinks(
      "The Slides agent returned https://slides.agent.test/deck/deck_123",
      [],
      { baseUrl: "https://dispatch.agent.test" },
    );

    expect(text).toBe(
      "The Slides agent returned https://slides.agent.test/deck/deck_123",
    );
  });

  it("appends a design URL only after generate-design saved files", () => {
    const text = appendA2AArtifactLinks(
      "The prototype is ready.",
      [
        {
          tool: "create-design",
          result: JSON.stringify({ id: "design_123", title: "Prototype" }),
        },
        {
          tool: "generate-design",
          result: JSON.stringify({
            designId: "design_123",
            savedFiles: [{ id: "file_1", filename: "index.html" }],
            fileCount: 1,
          }),
        },
      ],
      { baseUrl: "https://design.agent.test" },
    );

    expect(text).toContain(
      "https://design.agent.test/design/design_123 (ID: design_123, 1 file)",
    );
  });

  it("blocks shell-only design responses from being reported as completed artifacts", () => {
    const text = appendA2AArtifactLinks(
      "Here is your design: https://design.agent.test/design/design_123",
      [
        {
          tool: "create-design",
          result: JSON.stringify({ id: "design_123", title: "Prototype" }),
        },
      ],
      { baseUrl: "https://design.agent.test" },
    );

    expect(text).toContain("not ready yet");
    expect(text).toContain("no renderable files were saved");
    expect(text).not.toContain("https://design.agent.test/design/design_123");
  });

  it("blocks hallucinated design URLs with no successful design action", () => {
    const text = appendA2AArtifactLinks(
      "Done: https://design.agent.test/design/DSyLeIdyBc9p_drm40Tfp",
      [],
      { baseUrl: "https://design.agent.test" },
    );

    expect(text).toContain("could not verify the design URL");
    expect(text).not.toContain("DSyLeIdyBc9p_drm40Tfp");
    expect(text).not.toContain("https://design.agent.test/design/");
  });

  it("blocks design URLs when create-design failed before returning JSON", () => {
    const text = appendA2AArtifactLinks(
      "Here is the prototype: https://design.agent.test/design/design_404",
      [
        {
          tool: "create-design",
          result: "Error: no authenticated user",
        },
      ],
      { baseUrl: "https://design.agent.test" },
    );

    expect(text).toContain("could not verify the design URL");
    expect(text).not.toContain("https://design.agent.test/design/design_404");
  });

  it("does not validate artifact-shaped URLs on another host", () => {
    const text = appendA2AArtifactLinks(
      "The Design agent returned https://design.agent.test/design/design_123",
      [],
      { baseUrl: "https://dispatch.agent.test" },
    );

    expect(text).toBe(
      "The Design agent returned https://design.agent.test/design/design_123",
    );
  });

  it("blocks unverified production Design URLs even when the caller is another app", () => {
    const text = appendA2AArtifactLinks(
      "The Design agent returned https://design.agent-native.com/design/us1sfMEZNWUQZHDldxoFA",
      [],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toContain("could not verify the design URL");
    expect(text).toContain("saved app data");
    expect(text).not.toContain("us1sfMEZNWUQZHDldxoFA");
    expect(text).not.toContain("https://design.agent-native.com/design/");
  });

  it("allows verified production Slides URLs when a successful deck action returned the same artifact", () => {
    const text = appendA2AArtifactLinks(
      "Deck ready: https://slides.agent-native.com/deck/deck_123",
      [
        {
          tool: "create-deck",
          result: JSON.stringify({
            id: "deck_123",
            slideCount: 1,
            url: "https://slides.agent-native.com/deck/deck_123",
          }),
        },
      ],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toBe(
      "Deck ready: https://slides.agent-native.com/deck/deck_123",
    );
  });

  it("allows verified production Content URLs when a successful document action returned the same artifact", () => {
    const text = appendA2AArtifactLinks(
      "Document ready: https://content.agent-native.com/page/doc_123",
      [
        {
          tool: "create-document",
          result: JSON.stringify({
            id: "doc_123",
            title: "Launch Brief",
            url: "https://content.agent-native.com/page/doc_123",
          }),
        },
      ],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toBe(
      "Document ready: https://content.agent-native.com/page/doc_123",
    );
  });

  it("blocks generic shell-only design success even when the model omitted the id", () => {
    const text = appendA2AArtifactLinks(
      "Done.",
      [
        {
          tool: "create-design",
          result: JSON.stringify({ id: "design_123", title: "Prototype" }),
        },
      ],
      { baseUrl: "https://design.agent.test" },
    );

    expect(text).toContain("not ready yet");
    expect(text).toContain("design_123");
  });

  it("accepts create-file as a renderable design artifact after a shell", () => {
    const text = appendA2AArtifactLinks(
      "Saved the HTML.",
      [
        {
          tool: "create-design",
          result: JSON.stringify({ id: "design_123", title: "Prototype" }),
        },
        {
          tool: "create-file",
          result: JSON.stringify({
            id: "file_1",
            designId: "design_123",
            filename: "index.html",
            fileType: "html",
            renderable: true,
          }),
        },
      ],
      { baseUrl: "https://design.agent.test" },
    );

    expect(text).toContain("https://design.agent.test/design/design_123");
  });

  it("accepts get-design as proof when it returns a renderable file", () => {
    const text = appendA2AArtifactLinks(
      "Opened it: https://design.agent.test/design/design_123",
      [
        {
          tool: "get-design",
          result: JSON.stringify({
            id: "design_123",
            title: "Prototype",
            files: [
              {
                id: "file_1",
                filename: "index.html",
                fileType: "html",
                content: "<!doctype html><html></html>",
              },
            ],
          }),
        },
      ],
      { baseUrl: "https://design.agent.test" },
    );

    expect(text).toBe("Opened it: https://design.agent.test/design/design_123");
  });

  it("can parse JSON returned after shell logging", () => {
    const text = appendA2AArtifactLinks(
      "",
      [
        {
          tool: "create-document",
          result:
            'Created document "Notes" (doc_123)\n{"id":"doc_123","title":"Notes"}',
        },
      ],
      { baseUrl: "https://content.agent.test" },
    );

    expect(text).toContain("https://content.agent.test/page/doc_123");
  });
});
