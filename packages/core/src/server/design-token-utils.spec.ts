import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchGitHubJsonResult,
  fetchGitHubRaw,
  parseOwnerRepo,
} from "./design-token-utils.js";

describe("design-token GitHub helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses common GitHub repository URL formats", () => {
    expect(parseOwnerRepo("builderio/agent-native")).toEqual({
      owner: "builderio",
      repo: "agent-native",
    });
    expect(parseOwnerRepo("builderio/agent-native.git")).toEqual({
      owner: "builderio",
      repo: "agent-native",
    });
    expect(
      parseOwnerRepo(
        "https://github.com/builderio/agent-native/tree/main?tab=readme",
      ),
    ).toEqual({ owner: "builderio", repo: "agent-native" });
    expect(parseOwnerRepo("git@github.com:builderio/agent-native.git")).toEqual(
      {
        owner: "builderio",
        repo: "agent-native",
      },
    );
    expect(
      parseOwnerRepo("ssh://git@github.com/builderio/agent-native.git"),
    ).toEqual({ owner: "builderio", repo: "agent-native" });
  });

  it("sends the GitHub token only when one is provided", async () => {
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify([{ name: "package.json" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await fetchGitHubJsonResult("builderio", "agent-native", "", {
      token: "github-secret",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      Authorization: "Bearer github-secret",
      Accept: "application/vnd.github.v3+json",
    });
  });

  it("returns classified GitHub JSON errors without throwing", async () => {
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
      fetchGitHubJsonResult("builderio", "private-app", ""),
    ).resolves.toMatchObject({
      ok: false,
      status: 404,
      message: "Not Found",
    });
  });

  it("uses the GitHub token when fetching raw file content", async () => {
    const fetchSpy = vi.fn(async () => {
      return new Response(":root { --brand: #123456; }", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      fetchGitHubRaw("builderio", "agent-native", "app.css", {
        token: "github-secret",
      }),
    ).resolves.toContain("--brand");

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      Authorization: "Bearer github-secret",
      Accept: "application/vnd.github.v3.raw",
    });
  });
});
