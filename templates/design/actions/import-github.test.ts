import { afterEach, describe, expect, it, vi } from "vitest";
import importGithub from "./import-github";

const originalGitHubToken = process.env.GITHUB_TOKEN;

describe("import-github", () => {
  afterEach(() => {
    if (originalGitHubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalGitHubToken;
    vi.unstubAllGlobals();
  });

  it("uses a saved GITHUB_TOKEN for private repository imports", async () => {
    process.env.GITHUB_TOKEN = "github-secret";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/contents/")) {
        return new Response(
          JSON.stringify([
            { name: "tailwind.config.ts", type: "file", size: 100 },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/contents/tailwind.config.ts")) {
        return new Response(
          'export default { theme: { colors: { brand: "#123456" } } }',
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await importGithub.run({
      repoUrl: "git@github.com:builderio/private-app.git",
    });

    expect(result.repoUrl).toBe("https://github.com/builderio/private-app");
    expect(result.colors).toMatchObject({ brand: "#123456" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.github.com/repos/builderio/private-app/contents/",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer github-secret",
        }),
      }),
    );
  });

  it("explains how to configure private repository access", async () => {
    delete process.env.GITHUB_TOKEN;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await expect(
      importGithub.run({ repoUrl: "builderio/private-app" }),
    ).rejects.toThrow(/GITHUB_TOKEN.*Contents: Read-only/);
  });
});
