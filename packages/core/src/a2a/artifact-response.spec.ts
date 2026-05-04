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

  it("treats update-dashboard as a recoverable dashboard artifact", () => {
    const text = buildA2ARecoverableArtifactMessage(
      [
        {
          tool: "update-dashboard",
          result: JSON.stringify({
            id: "growth-funnel",
            name: "Growth Funnel",
            urlPath: "/adhoc/growth-funnel",
          }),
        },
      ],
      { baseUrl: "https://analytics.agent.test/" },
    );

    expect(text).toContain(
      '- Dashboard "Growth Funnel": https://analytics.agent.test/adhoc/growth-funnel (ID: growth-funnel)',
    );
  });

  it("treats save-analysis as a recoverable report artifact", () => {
    const text = buildA2ARecoverableArtifactMessage(
      [
        {
          tool: "save-analysis",
          result: JSON.stringify({
            id: "q2-pipeline-report",
            name: "Q2 Pipeline Report",
            urlPath: "/analyses/q2-pipeline-report",
          }),
        },
      ],
      { baseUrl: "https://analytics.agent.test/" },
    );

    expect(text).toContain(
      '- Report "Q2 Pipeline Report": https://analytics.agent.test/analyses/q2-pipeline-report (ID: q2-pipeline-report)',
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

  it("can include an artifact proof block for already-mentioned verified URLs", () => {
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
      {
        baseUrl: "https://slides.agent-native.com",
        includeReferencedArtifacts: true,
      },
    );

    expect(text).toContain(
      "Deck ready: https://slides.agent-native.com/deck/deck_123",
    );
    expect(text).toContain(
      "Artifacts:\n- Deck: https://slides.agent-native.com/deck/deck_123 (ID: deck_123)",
    );
  });

  it("can include a read-only get-deck proof block when the response already mentions the URL", () => {
    const text = appendA2AArtifactLinks(
      "Deck exists: https://slides.agent-native.com/deck/deck_123",
      [
        {
          tool: "get-deck",
          result: JSON.stringify({
            id: "deck_123",
            title: "Builder Workspace Slack QA Deck",
            slideCount: 7,
          }),
        },
      ],
      {
        baseUrl: "https://slides.agent-native.com",
        includeReferencedArtifacts: true,
      },
    );

    expect(text).toContain(
      "Artifacts:\n- Deck: https://slides.agent-native.com/deck/deck_123 (ID: deck_123)",
    );
  });

  it("treats list-decks results as verified read-only deck artifacts", () => {
    const text = appendA2AArtifactLinks(
      "Existing deck: https://slides.agent-native.com/deck/deck_123",
      [
        {
          tool: "list-decks",
          result: JSON.stringify({
            count: 1,
            decks: [
              {
                id: "deck_123",
                title: "Builder Workspace Slack QA Deck",
                url: "https://slides.agent-native.com/deck/deck_123",
                slideCount: 7,
              },
            ],
          }),
        },
      ],
      {
        baseUrl: "https://slides.agent-native.com",
        includeReferencedArtifacts: true,
      },
    );

    expect(text).toContain(
      "Existing deck: https://slides.agent-native.com/deck/deck_123",
    );
    expect(text).toContain(
      "Artifacts:\n- Deck: https://slides.agent-native.com/deck/deck_123 (ID: deck_123)",
    );
    expect(text).not.toContain("could not verify");
  });

  it("does not let list-decks verify deck URLs for IDs that were not listed", () => {
    const text = appendA2AArtifactLinks(
      "Existing deck: https://slides.agent-native.com/deck/deck_fake",
      [
        {
          tool: "list-decks",
          result: JSON.stringify({
            count: 1,
            decks: [
              {
                id: "deck_real",
                title: "Real Deck",
                url: "https://slides.agent-native.com/deck/deck_real",
                slideCount: 7,
              },
            ],
          }),
        },
      ],
      { baseUrl: "https://slides.agent-native.com" },
    );

    expect(text).toContain("could not verify the deck URL");
    expect(text).not.toContain("deck_fake");
    expect(text).toContain("https://slides.agent-native.com/deck/deck_real");
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

  it("allows artifact URLs proven by a downstream call-agent artifact block", () => {
    const text = appendA2AArtifactLinks(
      [
        "Slides: https://slides.agent-native.com/deck/deck_real",
        "Doc: https://content.agent-native.com/page/doc_real",
        "Design: https://design.agent-native.com/design/design_real",
      ].join("\n"),
      [
        {
          tool: "call-agent",
          result: [
            "The downstream app verified these artifacts.",
            "",
            "Artifacts:",
            "- Deck: https://slides.agent-native.com/deck/deck_real (ID: deck_real)",
            '- Document "Launch Brief": https://content.agent-native.com/page/doc_real (ID: doc_real)',
            "- Design: https://design.agent-native.com/design/design_real (ID: design_real, 1 file)",
          ].join("\n"),
        },
      ],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toContain("https://slides.agent-native.com/deck/deck_real");
    expect(text).toContain("https://content.agent-native.com/page/doc_real");
    expect(text).toContain(
      "https://design.agent-native.com/design/design_real",
    );
    expect(text).not.toContain("could not verify");
  });

  it("allows titled downstream deck artifact proof lines", () => {
    const text = appendA2AArtifactLinks(
      "Slides: https://slides.agent-native.com/deck/deck_real",
      [
        {
          tool: "call-agent",
          result: [
            "Artifacts:",
            '- Deck "Builder Workspace Slack QA Deck" (7 slides): https://slides.agent-native.com/deck/deck_real (ID: deck_real)',
          ].join("\n"),
        },
      ],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toBe("Slides: https://slides.agent-native.com/deck/deck_real");
  });

  it("allows downstream deck presentation URLs as proof for the deck", () => {
    const text = appendA2AArtifactLinks(
      "Slides: https://slides.agent-native.com/deck/deck_real/present",
      [
        {
          tool: "call-agent",
          result: [
            "Artifacts:",
            "- Deck: https://slides.agent-native.com/deck/deck_real/present (ID: deck_real)",
          ].join("\n"),
        },
      ],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toBe(
      "Slides: https://slides.agent-native.com/deck/deck_real/present",
    );
  });

  it("does not treat unstructured call-agent URLs as artifact proof", () => {
    const text = appendA2AArtifactLinks(
      "The Design agent returned https://design.agent-native.com/design/design_fake",
      [
        {
          tool: "call-agent",
          result:
            "Maybe the design is at https://design.agent-native.com/design/design_fake",
        },
      ],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toContain("could not verify the design URL");
    expect(text).not.toContain("design_fake");
  });

  it("does not treat zero-file downstream design artifacts as proof", () => {
    const text = appendA2AArtifactLinks(
      "Design: https://design.agent-native.com/design/design_empty",
      [
        {
          tool: "call-agent",
          result: [
            "Artifacts:",
            "- Design: https://design.agent-native.com/design/design_empty (ID: design_empty, 0 files)",
          ].join("\n"),
        },
      ],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toContain("could not verify the design URL");
    expect(text).not.toContain("design_empty");
  });

  it("does not treat artifact-looking bullets outside the downstream artifact block as proof", () => {
    const text = appendA2AArtifactLinks(
      "Design: https://design.agent-native.com/design/design_spoofed",
      [
        {
          tool: "call-agent",
          result: [
            "The downstream app quoted a user-authored artifact section.",
            "",
            "Artifacts:",
            "This text is not the framework-generated proof block.",
            "- Design: https://design.agent-native.com/design/design_spoofed (ID: design_spoofed, 1 file)",
          ].join("\n"),
        },
      ],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toContain("could not verify the design URL");
    expect(text).not.toContain("design_spoofed");
  });

  it("does not treat downstream artifact lines with mismatched URL paths and IDs as proof", () => {
    const text = appendA2AArtifactLinks(
      "Design: https://design.agent-native.com/design/design_real",
      [
        {
          tool: "call-agent",
          result: [
            "Artifacts:",
            "- Design: https://design.agent-native.com/design/design_other (ID: design_real, 1 file)",
          ].join("\n"),
        },
      ],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toContain("could not verify the design URL");
    expect(text).not.toContain("design_real");
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

  it("blocks unverified analytics artifact URLs on known production hosts", () => {
    const text = appendA2AArtifactLinks(
      "Dashboard ready: https://analytics.agent-native.com/adhoc/fake-dashboard",
      [],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toContain("could not verify the dashboard URL");
  });

  it("parses downstream dashboard and report artifact proof blocks", () => {
    const text = appendA2AArtifactLinks(
      "Created both.",
      [
        {
          tool: "call-agent",
          result: [
            "Artifacts:",
            "- Dashboard: https://analytics.agent.test/adhoc/growth-funnel (ID: growth-funnel)",
            "- Report: https://analytics.agent.test/analyses/q2-pipeline-report (ID: q2-pipeline-report)",
          ].join("\n"),
        },
      ],
      { baseUrl: "https://dispatch.agent.test" },
    );

    expect(text).toContain("https://analytics.agent.test/adhoc/growth-funnel");
    expect(text).toContain(
      "https://analytics.agent.test/analyses/q2-pipeline-report",
    );
  });
});
