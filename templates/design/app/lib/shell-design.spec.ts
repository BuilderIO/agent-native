import { describe, expect, it } from "vitest";

import { buildShellDesign, SHELL_DESIGN_ID } from "./shell-design";

const build = () =>
  buildShellDesign({
    previewOrigin: "https://branch.builderio.xyz",
    routes: [{ path: "/" }, { path: "/projects" }],
    projectId: "proj-1",
    branchName: "my-branch",
  });

describe("buildShellDesign", () => {
  it("produces a design the editor can consume without a server", () => {
    const { design } = build();
    expect(design.id).toBe(SHELL_DESIGN_ID);
    expect(design.title).toBe("my-branch");
    expect(design.projectType).toBe("prototype");
  });

  it("grants the editor role so click-to-edit is available", () => {
    expect(build().design.accessRole).toBe("editor");
  });

  it("maps each route to a URL-backed file, as the server builder does", () => {
    const { design } = build();
    expect(design.files.map((f) => [f.filename, f.content])).toEqual([
      ["fusion-home.html", "https://branch.builderio.xyz/"],
      ["fusion-projects.html", "https://branch.builderio.xyz/projects"],
    ]);
    expect(design.files.every((f) => f.fileType === "html")).toBe(true);
  });

  it("carries frame geometry keyed by fileId", () => {
    const { design, screens } = build();
    const data = JSON.parse(design.data!);
    expect(Object.keys(data.canvasFrames)).toEqual(
      screens.map((s) => s.fileId),
    );
    expect(data.canvasFrames[screens[0]!.fileId]).toMatchObject({ x: 0, y: 0 });
    expect(data.canvasFrames[screens[1]!.fileId]!.x).toBeGreaterThan(0);
  });

  it("declares the fusion source type so the layer tree can populate", () => {
    // `inline` is the fallback, and it disables the runtime layer projection.
    expect(JSON.parse(build().design.data!).sourceType).toBe("fusion");
  });

  it("marks the linkage as builder-host and ready", () => {
    const data = JSON.parse(build().design.data!);
    expect(data.fusionApp).toMatchObject({
      source: "builder-host",
      projectId: "proj-1",
      branchName: "my-branch",
      previewUrl: "https://branch.builderio.xyz",
      status: "ready",
    });
  });

  it("omits optional linkage fields rather than writing empty strings", () => {
    const data = JSON.parse(build().design.data!);
    expect("builderOrgId" in data.fusionApp).toBe(false);
    expect("contentId" in data.fusionApp).toBe(false);
  });

  it("survives a host that sends no routes yet", () => {
    const { design } = buildShellDesign({
      previewOrigin: "https://branch.builderio.xyz",
      routes: [],
    });
    expect(design.files).toEqual([]);
    expect(JSON.parse(design.data!).canvasFrames).toEqual({});
  });
});
