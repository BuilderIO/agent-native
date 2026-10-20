import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGitHubAccessToken } from "../github-oauth";
import {
  assertGitHubBranch,
  createGitHubExportPullRequest,
  getGitHubPullRequestState,
  listGitHubFolderFiles,
  readGitHubFile,
} from "./github";
import { gitBlobSha } from "./plan";

vi.mock("../github-oauth", () => ({
  getGitHubAccessToken: vi.fn(),
}));

const CTX = { userEmail: "analyst@example.test", orgId: null };
const LINK = {
  owner: "acme",
  repo: "dash",
  branch: "main",
  path: "dashboards",
};

interface Recorded {
  method: string;
  pathname: string;
  search: string;
  authorization: string | null;
  body: unknown;
}

const requests: Recorded[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(respond: (req: Recorded) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const req: Recorded = {
        method: init?.method ?? "GET",
        pathname: url.pathname,
        search: url.search,
        authorization: new Headers(init?.headers).get("authorization"),
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      requests.push(req);
      return respond(req);
    }),
  );
}

beforeEach(() => {
  requests.length = 0;
  vi.mocked(getGitHubAccessToken).mockResolvedValue({
    token: "test-token",
    scopes: [],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listGitHubFolderFiles", () => {
  it("treats a missing folder as empty and encodes each path segment", async () => {
    stubFetch(() => json({ message: "Not Found" }, 404));

    await expect(
      listGitHubFolderFiles(CTX, { ...LINK, path: "team dashboards/sql" }),
    ).resolves.toEqual([]);
    expect(requests).toEqual([
      {
        method: "GET",
        pathname: "/repos/acme/dash/contents/team%20dashboards/sql",
        search: "?ref=main",
        authorization: "Bearer test-token",
        body: undefined,
      },
    ]);
  });

  it("throws when GitHub returns something other than a listing", async () => {
    stubFetch(() =>
      json({
        type: "file",
        name: "a.json",
        path: "dashboards/a.json",
        sha: "x",
      }),
    );

    await expect(listGitHubFolderFiles(CTX, LINK)).rejects.toThrow(
      /unexpected response/,
    );
  });

  it("keeps only top-level json files", async () => {
    stubFetch(() =>
      json([
        {
          type: "file",
          name: "a.json",
          path: "dashboards/a.json",
          sha: "sha-a",
        },
        {
          type: "file",
          name: "README.md",
          path: "dashboards/README.md",
          sha: "sha-readme",
        },
        {
          type: "dir",
          name: "nested.json",
          path: "dashboards/nested.json",
          sha: "sha-dir",
        },
        {
          type: "file",
          name: "b.json",
          path: "dashboards/b.json",
          sha: "sha-b",
        },
      ]),
    );

    await expect(listGitHubFolderFiles(CTX, LINK)).resolves.toEqual([
      { path: "dashboards/a.json", sha: "sha-a" },
      { path: "dashboards/b.json", sha: "sha-b" },
    ]);
  });

  it("refuses a listing at the entry cap because GitHub may have truncated it", async () => {
    stubFetch(() =>
      json(
        Array.from({ length: 1000 }, (_, index) => ({
          type: "file",
          name: `d${index}.json`,
          path: `dashboards/d${index}.json`,
          sha: `sha-${index}`,
        })),
      ),
    );

    await expect(listGitHubFolderFiles(CTX, LINK)).rejects.toThrow(
      /may be truncated/,
    );
  });

  it("throws on a server error instead of reporting an empty folder", async () => {
    stubFetch(() => json({ message: "Server Error" }, 500));

    await expect(listGitHubFolderFiles(CTX, LINK)).rejects.toThrow(
      "GitHub folder listing failed: HTTP 500",
    );
  });

  it("refuses to run without a GitHub connection", async () => {
    vi.mocked(getGitHubAccessToken).mockResolvedValueOnce({ scopes: [] });
    stubFetch(() => json([]));

    await expect(listGitHubFolderFiles(CTX, LINK)).rejects.toThrow(
      "GitHub is not connected. Connect GitHub under Settings before syncing this folder.",
    );
    expect(requests).toEqual([]);
  });
});

describe("readGitHubFile", () => {
  it("decodes base64 as utf8 across GitHub's line wrapping", async () => {
    const content = `${JSON.stringify({ id: "rev-é", title: "Résumé ✓" }, null, 2)}\n`;
    const wrapped =
      Buffer.from(content, "utf8")
        .toString("base64")
        .replace(/.{60}/g, "$&\n") + "\n";
    stubFetch(() =>
      json({
        type: "file",
        encoding: "base64",
        content: wrapped,
        sha: gitBlobSha(content),
      }),
    );

    await expect(
      readGitHubFile(CTX, LINK, "dashboards/a.json"),
    ).resolves.toEqual({
      sha: gitBlobSha(content),
      content,
    });
    expect(requests[0].pathname).toBe(
      "/repos/acme/dash/contents/dashboards/a.json",
    );
  });

  it("throws when the decoded bytes do not match the blob sha", async () => {
    stubFetch(() =>
      json({
        type: "file",
        encoding: "base64",
        content: Buffer.from("changed\n").toString("base64"),
        sha: gitBlobSha("original\n"),
      }),
    );

    await expect(
      readGitHubFile(CTX, LINK, "dashboards/a.json"),
    ).rejects.toThrow(/does not match its blob sha/);
  });

  it("rejects content that is not base64", async () => {
    stubFetch(() =>
      json({ type: "file", encoding: "none", content: "", sha: "x" }),
    );

    await expect(
      readGitHubFile(CTX, LINK, "dashboards/a.json"),
    ).rejects.toThrow(/unexpected response/);
  });
});

describe("getGitHubPullRequestState", () => {
  it.each([
    ["open", { state: "open", merged: false }, "open"],
    ["merged", { state: "closed", merged: true }, "merged"],
    ["closed without merge", { state: "closed", merged: false }, "closed"],
  ] as const)("reports a %s pull request", async (_label, pr, expected) => {
    stubFetch(() => json(pr));

    await expect(
      getGitHubPullRequestState(CTX, "acme", "dash", 42),
    ).resolves.toBe(expected);
    expect(requests[0].pathname).toBe("/repos/acme/dash/pulls/42");
  });

  it("throws when the lookup fails instead of reporting a state", async () => {
    stubFetch(() => json({ message: "Not Found" }, 404));

    await expect(
      getGitHubPullRequestState(CTX, "acme", "dash", 42),
    ).rejects.toThrow("GitHub pull request #42 lookup failed: HTTP 404");
  });
});

describe("assertGitHubBranch", () => {
  it("resolves for an existing branch and names the branch and repo when it is missing", async () => {
    stubFetch(() => json({ ref: "refs/heads/main", object: { sha: "c1" } }));
    await expect(
      assertGitHubBranch(CTX, "acme", "dash", "main"),
    ).resolves.toBeUndefined();

    stubFetch(() => json({ message: "Not Found" }, 404));
    await expect(
      assertGitHubBranch(CTX, "acme", "dash", "mian"),
    ).rejects.toThrow('GitHub branch "mian" was not found in acme/dash');
  });
});

describe("createGitHubExportPullRequest", () => {
  const FILE_A = { path: "dashboards/a.json", content: '{"id":"a"}\n' };
  const FILE_B = { path: "dashboards/b.json", content: '{"id":"b"}\n' };
  const INPUT = {
    link: LINK,
    branch: "dashboards/sync-1",
    title: "Export dashboards",
    body: "Exports changed dashboards",
    commitMessage: "Export dashboards",
    files: [FILE_A, FILE_B],
  };

  // Happy-path GitHub. `failAt` makes one call return 500 so a test can name
  // the step that fails.
  function exportRoute(failAt?: { method: string; suffix: string }) {
    return (req: Recorded): Response => {
      if (
        failAt &&
        req.method === failAt.method &&
        req.pathname.endsWith(failAt.suffix)
      ) {
        return json({ message: "boom" }, 500);
      }
      if (
        req.method === "GET" &&
        req.pathname === "/repos/acme/dash/git/ref/heads/main"
      ) {
        return json({ ref: "refs/heads/main", object: { sha: "base-commit" } });
      }
      if (
        req.method === "GET" &&
        req.pathname === "/repos/acme/dash/git/commits/base-commit"
      ) {
        return json({ sha: "base-commit", tree: { sha: "base-tree" } });
      }
      if (
        req.method === "POST" &&
        req.pathname === "/repos/acme/dash/git/blobs"
      ) {
        const { content } = req.body as { content: string };
        return json({ sha: gitBlobSha(content) }, 201);
      }
      if (
        req.method === "POST" &&
        req.pathname === "/repos/acme/dash/git/trees"
      ) {
        return json({ sha: "new-tree" }, 201);
      }
      if (
        req.method === "POST" &&
        req.pathname === "/repos/acme/dash/git/commits"
      ) {
        return json({ sha: "new-commit" }, 201);
      }
      if (
        req.method === "POST" &&
        req.pathname === "/repos/acme/dash/git/refs"
      ) {
        return json(
          {
            ref: "refs/heads/dashboards/sync-1",
            object: { sha: "new-commit" },
          },
          201,
        );
      }
      if (req.method === "POST" && req.pathname === "/repos/acme/dash/pulls") {
        return json(
          { number: 42, html_url: "https://github.com/acme/dash/pull/42" },
          201,
        );
      }
      throw new Error(`unexpected ${req.method} ${req.pathname}`);
    };
  }

  it("commits every file on a new branch and opens a PR", async () => {
    stubFetch(exportRoute());

    await expect(createGitHubExportPullRequest(CTX, INPUT)).resolves.toEqual({
      prNumber: 42,
      prUrl: "https://github.com/acme/dash/pull/42",
      blobShas: {
        [FILE_A.path]: gitBlobSha(FILE_A.content),
        [FILE_B.path]: gitBlobSha(FILE_B.content),
      },
    });

    const find = (method: string, suffix: string) =>
      requests.find(
        (req) => req.method === method && req.pathname.endsWith(suffix),
      );
    expect(find("POST", "/git/trees")?.body).toEqual({
      base_tree: "base-tree",
      tree: [
        {
          path: FILE_A.path,
          mode: "100644",
          type: "blob",
          sha: gitBlobSha(FILE_A.content),
        },
        {
          path: FILE_B.path,
          mode: "100644",
          type: "blob",
          sha: gitBlobSha(FILE_B.content),
        },
      ],
    });
    expect(find("POST", "/git/commits")?.body).toEqual({
      message: "Export dashboards",
      tree: "new-tree",
      parents: ["base-commit"],
    });
    expect(find("POST", "/git/refs")?.body).toEqual({
      ref: "refs/heads/dashboards/sync-1",
      sha: "new-commit",
    });
    expect(find("POST", "/pulls")?.body).toEqual({
      title: "Export dashboards",
      body: "Exports changed dashboards",
      head: "dashboards/sync-1",
      base: "main",
    });
  });

  it("throws when GitHub stores a blob under a different sha", async () => {
    const happy = exportRoute();
    stubFetch((req) =>
      req.method === "POST" && req.pathname.endsWith("/git/blobs")
        ? json({ sha: "0".repeat(40) }, 201)
        : happy(req),
    );

    await expect(createGitHubExportPullRequest(CTX, INPUT)).rejects.toThrow(
      /stored "dashboards\/a.json" as/,
    );
    expect(requests.some((req) => req.pathname.endsWith("/git/trees"))).toBe(
      false,
    );
  });

  it.each([
    ["read base branch", { method: "GET", suffix: "/git/ref/heads/main" }],
    ["read base commit", { method: "GET", suffix: "/git/commits/base-commit" }],
    ["create blob", { method: "POST", suffix: "/git/blobs" }],
    ["create tree", { method: "POST", suffix: "/git/trees" }],
    ["create commit", { method: "POST", suffix: "/git/commits" }],
    ["create branch", { method: "POST", suffix: "/git/refs" }],
    ["open pull request", { method: "POST", suffix: "/pulls" }],
  ])(
    "throws naming the %s step when GitHub fails there",
    async (step, failAt) => {
      stubFetch(exportRoute(failAt));

      await expect(createGitHubExportPullRequest(CTX, INPUT)).rejects.toThrow(
        `GitHub ${step} failed: HTTP 500`,
      );
    },
  );

  it("refuses an export with no files before calling GitHub", async () => {
    stubFetch(exportRoute());

    await expect(
      createGitHubExportPullRequest(CTX, { ...INPUT, files: [] }),
    ).rejects.toThrow("GitHub export has no files to commit");
    expect(requests).toEqual([]);
  });
});
