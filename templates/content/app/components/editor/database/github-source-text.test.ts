import { describe, expect, it } from "vitest";

import {
  fileLinkFolder,
  githubErrorNeedsConnection,
  githubExampleText,
  githubLinkErrorText,
  githubListWithMore,
  githubProblemStopsUpdates,
  githubRelativeTime,
  githubUrlProblem,
} from "./github-source-text";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const FOLDER_URL = "https://github.com/acme/handbook/tree/main/docs/guides";

function actionError(errorCode: string) {
  return Object.assign(new Error("From the server"), { errorCode });
}

describe("Link-time errors", () => {
  it.each([
    [
      "GITHUB_REPOSITORY_NOT_FOUND",
      "Can’t open “handbook”. Check the spelling, or make sure your GitHub account can see it.",
    ],
    [
      "GITHUB_FORBIDDEN",
      "Your GitHub account can’t open “handbook”. Ask its owner for access.",
    ],
    [
      "GITHUB_BRANCH_NOT_FOUND",
      "There’s no branch called “main” in handbook. Check the link.",
    ],
    [
      "GITHUB_FOLDER_NOT_FOUND",
      "There’s no folder called “docs/guides” in handbook. Check the link.",
    ],
    [
      "GITHUB_TOO_LARGE",
      "This folder has more than 2,000 files. Pick a smaller folder inside it.",
    ],
    [
      "GITHUB_RATE_LIMITED",
      "Couldn’t reach GitHub just now. Try again in a minute.",
    ],
    [
      "COLLECTION_NOT_EMPTY",
      "This collection has pages now, so a GitHub folder can’t fill it.",
    ],
  ])("says %s in terms of the link typed", (errorCode, said) => {
    expect(githubLinkErrorText(actionError(errorCode), FOLDER_URL)).toBe(said);
  });

  it("keeps the server's own words for an error it doesn't know", () => {
    expect(githubLinkErrorText(new Error("Something else"), FOLDER_URL)).toBe(
      "Something else",
    );
  });

  it("knows which errors mean GitHub needs connecting", () => {
    expect(githubErrorNeedsConnection(actionError("connection_required"))).toBe(
      true,
    );
    expect(githubErrorNeedsConnection(actionError("GITHUB_CONNECTION"))).toBe(
      true,
    );
    expect(githubErrorNeedsConnection(actionError("GITHUB_FORBIDDEN"))).toBe(
      false,
    );
    expect(githubErrorNeedsConnection(null)).toBe(false);
  });

  it("treats only problems someone must fix as stopping updates", () => {
    expect(githubProblemStopsUpdates("folder_not_found")).toBe(true);
    expect(githubProblemStopsUpdates("connection")).toBe(true);
    expect(githubProblemStopsUpdates("rate_limited")).toBe(false);
    expect(githubProblemStopsUpdates("storage_unavailable")).toBe(false);
  });
});

describe("A link before it's sent", () => {
  it("offers the folder a file link points into", () => {
    expect(
      githubUrlProblem(
        "https://github.com/acme/handbook/blob/main/docs/guides/faq.md",
      ),
    ).toEqual({
      text: "That’s a link to one file.",
      folderUrl: FOLDER_URL,
      folder: "guides",
    });
  });

  it("names the repository for a file at its root", () => {
    expect(
      fileLinkFolder("github.com/acme/handbook/blob/main/README.md"),
    ).toEqual({
      url: "https://github.com/acme/handbook/tree/main",
      name: "handbook",
    });
  });

  it("explains a link that isn't to GitHub, with nothing to offer", () => {
    expect(githubUrlProblem("https://example.com/docs")).toEqual({
      text: "That isn’t a GitHub folder link. On GitHub, open the folder and copy the address from your browser.",
      folderUrl: null,
      folder: null,
    });
  });

  it("has nothing to say about a folder link", () => {
    expect(githubUrlProblem(FOLDER_URL)).toBe(null);
  });
});

describe("Numbers, times and examples", () => {
  it("lists a few names and counts the rest", () => {
    expect(githubListWithMore(["FAQ", "Guide"], 2)).toBe("FAQ and Guide");
    expect(githubListWithMore(["FAQ", "Guide", "Style", "Tone"], 9)).toBe(
      "FAQ, Guide, Style, and 6 more",
    );
  });

  it.each([
    [NOW - 20_000, "just now"],
    [NOW - 60_000, "1 minute ago"],
    [NOW - 3 * 60 * 60_000, "3 hours ago"],
    [NOW - 24 * 60 * 60_000, "yesterday"],
  ])("says %d as %s", (at, said) => {
    expect(githubRelativeTime(new Date(at).toISOString(), NOW)).toBe(said);
  });

  it("says nothing for a time it can't read", () => {
    expect(githubRelativeTime("not a date", NOW)).toBe("");
  });

  it("shows frontmatter examples as a writer reads them", () => {
    expect(githubExampleText("checkbox", "true")).toBe("Yes");
    expect(githubExampleText("checkbox", "false")).toBe("No");
    expect(githubExampleText("date", "2026-09-15")).toBe("Sep 15, 2026");
    expect(githubExampleText("text", "Hello")).toBe("Hello");
  });
});
