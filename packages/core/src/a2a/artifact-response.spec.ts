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

  it("appends a verified Content row URL from a form submission", () => {
    const text = appendA2AArtifactLinks(
      "Filed the design ask.",
      [
        {
          tool: "submit-content-database-form",
          result: JSON.stringify({
            createdItemId: "item_123",
            createdDocumentId: "request_123",
            urlPath: "/page/request_123",
            verification: { found: true },
          }),
        },
      ],
      { baseUrl: "https://content.agent.test/" },
    );

    expect(text).toContain(
      "- Document: https://content.agent.test/page/request_123 (ID: request_123)",
    );
  });

  it("appends the focused Analytics URL returned by save-monitor", () => {
    const text = appendA2AArtifactLinks(
      "The uptime monitor was created.",
      [
        {
          tool: "save-monitor",
          result: JSON.stringify({
            id: "monitor_123",
            name: "clips.agent-native.com",
            monitorAppUrl:
              "https://analytics.agent-native.com/monitoring?view=uptime&monitor=monitor_123",
          }),
        },
      ],
      { baseUrl: "https://analytics.agent-native.com" },
    );

    expect(text).toContain(
      '- Monitor "clips.agent-native.com": https://analytics.agent-native.com/monitoring?view=uptime&monitor=monitor_123 (ID: monitor_123)',
    );
  });

  it("appends the direct public URL returned for an anonymous published form", () => {
    const text = appendA2AArtifactLinks(
      "The feedback form is live.",
      [
        {
          tool: "create-form",
          result: JSON.stringify({
            id: "form_123",
            title: "Product feedback",
            status: "published",
            settings: { anonymous: true },
            publicUrl:
              "https://forms.agent-native.com/f/product-feedback-a1b2c3",
          }),
        },
      ],
      { baseUrl: "https://forms.agent-native.com" },
    );

    expect(text).toContain(
      '- Anonymous form "Product feedback": https://forms.agent-native.com/f/product-feedback-a1b2c3 (ID: form_123)',
    );
  });

  it("recognizes add-database-item as a recoverable Content row artifact", () => {
    const text = buildA2ARecoverableArtifactMessage(
      [
        {
          tool: "add-database-item",
          result: JSON.stringify({
            createdItemId: "item_456",
            createdDocumentId: "request_456",
            items: [
              {
                id: "item_456",
                document: { id: "request_456", title: "Homepage refresh" },
              },
            ],
          }),
        },
      ],
      { baseUrl: "https://content.agent.test/" },
    );

    expect(text).toContain(
      '- Document "Homepage refresh": https://content.agent.test/page/request_456 (ID: request_456)',
    );
  });

  it("ignores a mismatched Content submission URL and uses the canonical page route", () => {
    const text = appendA2AArtifactLinks(
      "Filed it.",
      [
        {
          tool: "submit-content-database-form",
          result: JSON.stringify({
            createdDocumentId: "request_real",
            url: "https://content.agent.test/page/request_other",
          }),
        },
      ],
      { baseUrl: "https://content.agent.test/" },
    );

    expect(text).toContain(
      "https://content.agent.test/page/request_real (ID: request_real)",
    );
    expect(text).not.toContain("request_other");
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

  it("allows a Content URL proven by a nested get-content-document read result", () => {
    const text = appendA2AArtifactLinks(
      "Document: https://content.agent-native.com/page/doc_read",
      [
        {
          tool: "get-content-document",
          result: JSON.stringify({
            document: { id: "doc_read", title: "Design asks" },
            url: "https://content.agent-native.com/page/doc_read",
          }),
        },
      ],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toBe(
      "Document: https://content.agent-native.com/page/doc_read",
    );
  });

  it("rejects an off-origin URL from a get-document read result", () => {
    const text = appendA2AArtifactLinks(
      "Found the document.",
      [
        {
          tool: "get-document",
          result: JSON.stringify({
            id: "doc_read",
            url: "https://untrusted.example.com/page/doc_read",
          }),
        },
      ],
      { baseUrl: "https://content.agent-native.com" },
    );

    expect(text).toContain("https://content.agent-native.com/page/doc_read");
    expect(text).not.toContain("https://untrusted.example.com/page/doc_read");
  });

  it("rejects an off-origin URL from a nested get-content-document read result", () => {
    const text = appendA2AArtifactLinks(
      "Found the document.",
      [
        {
          tool: "get-content-document",
          result: JSON.stringify({
            document: { id: "doc_read", title: "Design asks" },
            url: "https://untrusted.example.com/page/doc_read",
          }),
        },
      ],
      { baseUrl: "https://content.agent-native.com" },
    );

    expect(text).toContain("https://content.agent-native.com/page/doc_read");
    expect(text).not.toContain("https://untrusted.example.com/page/doc_read");
  });

  it("allows database and row page URLs returned by get-content-database", () => {
    const text = appendA2AArtifactLinks(
      [
        "Database: https://content.agent-native.com/page/database_doc",
        "Row: https://content.agent-native.com/page/request_doc",
      ].join("\n"),
      [
        {
          tool: "get-content-database",
          result: JSON.stringify({
            database: {
              id: "database_123",
              documentId: "database_doc",
              title: "Design asks",
            },
            items: [
              {
                id: "item_123",
                document: { id: "request_doc", title: "Homepage refresh" },
              },
            ],
          }),
        },
      ],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toContain(
      "Database: https://content.agent-native.com/page/database_doc",
    );
    expect(text).toContain(
      "Row: https://content.agent-native.com/page/request_doc",
    );
    expect(text).not.toContain("could not verify");
  });

  it("rejects off-origin database and row URL candidates", () => {
    const text = appendA2AArtifactLinks(
      "Found the design asks database.",
      [
        {
          tool: "get-content-database",
          result: JSON.stringify({
            url: "https://untrusted.example.com/page/database_doc",
            database: {
              id: "database_123",
              documentId: "database_doc",
              title: "Design asks",
            },
            items: [
              {
                id: "item_123",
                url: "https://untrusted.example.com/page/request_doc",
                document: { id: "request_doc", title: "Homepage refresh" },
              },
            ],
          }),
        },
      ],
      { baseUrl: "https://content.agent-native.com" },
    );

    expect(text).toContain(
      "https://content.agent-native.com/page/database_doc",
    );
    expect(text).toContain("https://content.agent-native.com/page/request_doc");
    expect(text).not.toContain("https://untrusted.example.com/page/");
  });

  it("does not treat an unavailable get-content-database result as document proof", () => {
    const text = appendA2AArtifactLinks(
      "Database: https://content.agent-native.com/page/database_missing",
      [
        {
          tool: "get-content-database",
          result: JSON.stringify({
            available: false,
            reason: "not_found",
            databaseId: "database_123",
            documentId: "database_missing",
          }),
        },
      ],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toContain("could not verify the document URL");
    expect(text).not.toContain("database_missing");
  });

  it("allows a canonical document URL paired with its ID by a generic read action", () => {
    const text = appendA2AArtifactLinks(
      "Document: https://content.agent-native.com/page/doc_read",
      [
        {
          tool: "read-content-resource",
          result: JSON.stringify({
            documentId: "doc_read",
            url: "https://content.agent-native.com/page/doc_read",
          }),
        },
      ],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toBe(
      "Document: https://content.agent-native.com/page/doc_read",
    );
  });

  it("does not let a generic read result prove a document URL on another origin", () => {
    const text = appendA2AArtifactLinks(
      "Document: https://content.agent-native.com/page/doc_read",
      [
        {
          tool: "read-content-resource",
          result: JSON.stringify({
            documentId: "doc_read",
            url: "https://untrusted.example.com/page/doc_read",
          }),
        },
      ],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toContain("could not verify the document URL");
    expect(text).not.toContain(
      "https://content.agent-native.com/page/doc_read",
    );
  });

  it("does not let a generic read result prove a mismatched document URL", () => {
    const text = appendA2AArtifactLinks(
      "Document: https://content.agent-native.com/page/doc_fake",
      [
        {
          tool: "read-content-resource",
          result: JSON.stringify({
            documentId: "doc_real",
            url: "https://content.agent-native.com/page/doc_fake",
          }),
        },
      ],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toContain("could not verify the document URL");
    expect(text).not.toContain("doc_fake");
  });

  it("does not let a generic write result prove a document URL", () => {
    const text = appendA2AArtifactLinks(
      "Document: https://content.agent-native.com/page/doc_fake",
      [
        {
          tool: "publish-unrelated-resource",
          result: JSON.stringify({
            documentId: "doc_fake",
            url: "https://content.agent-native.com/page/doc_fake",
          }),
        },
      ],
      { baseUrl: "https://dispatch.agent-native.com" },
    );

    expect(text).toContain("could not verify the document URL");
    expect(text).not.toContain("doc_fake");
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

  it("appends a verified image artifact from generate-image", () => {
    const text = appendA2AArtifactLinks(
      "Generated the hero image.",
      [
        {
          tool: "generate-image",
          result: JSON.stringify({
            id: "asset_123",
            runId: "run_123",
          }),
        },
      ],
      { baseUrl: "https://assets.agent.test" },
    );

    expect(text).toContain(
      "- Image: https://assets.agent.test/image/asset_123 (ID: asset_123, Run: run_123)",
    );
  });

  it("treats image batch results as recoverable artifacts", () => {
    const text = buildA2ARecoverableArtifactMessage(
      [
        {
          tool: "generate-image-batch",
          result: JSON.stringify({
            images: [
              { ok: true, id: "asset_one", runId: "run_one" },
              { ok: false, error: "blocked" },
              { ok: true, assetId: "asset_two" },
            ],
          }),
        },
      ],
      { baseUrl: "https://assets.agent.test/" },
    );

    expect(text).toContain(
      "- Image: https://assets.agent.test/image/asset_one (ID: asset_one, Run: run_one)",
    );
    expect(text).toContain(
      "- Image: https://assets.agent.test/image/asset_two (ID: asset_two)",
    );
    expect(text).not.toContain("blocked");
  });

  it("blocks unverified production image URLs from other apps", () => {
    const text = appendA2AArtifactLinks(
      "Image ready: https://assets.agent-native.com/image/asset_fake",
      [],
      { baseUrl: "https://slides.agent-native.com" },
    );

    expect(text).toContain("could not verify the image URL");
    expect(text).not.toContain("asset_fake");
  });

  it("allows image URLs proven by a downstream call-agent artifact block", () => {
    const text = appendA2AArtifactLinks(
      "Image: https://assets.agent-native.com/image/asset_real",
      [
        {
          tool: "call-agent",
          result: [
            "Artifacts:",
            "- Image: https://assets.agent-native.com/image/asset_real (ID: asset_real, Run: run_real)",
          ].join("\n"),
        },
      ],
      { baseUrl: "https://slides.agent-native.com" },
    );

    expect(text).toBe(
      "Image: https://assets.agent-native.com/image/asset_real",
    );
  });
});
