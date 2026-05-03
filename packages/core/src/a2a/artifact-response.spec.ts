import { describe, expect, it } from "vitest";
import { appendA2AArtifactLinks } from "./artifact-response.js";

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
