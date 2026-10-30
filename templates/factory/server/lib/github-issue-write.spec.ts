import { describe, expect, it, vi } from "vitest";

import { GitHubRequestError } from "../triage/github-client.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import type { GitHubClient } from "./factory-pull-request.js";
import {
  GITHUB_LABELS_MAX,
  GITHUB_LABEL_MAX_CHARS,
  addLabelsToIssue,
  issueAuditTarget,
  issueWriteAuditSummary,
  parseIssueRepository,
  removeLabelFromIssue,
} from "./github-issue-write.js";

function fakeGitHub(overrides: Record<string, unknown> = {}) {
  return {
    addIssueLabels: vi.fn(
      async (_repo: unknown, _number: number, labels: readonly string[]) => [
        "existing",
        ...labels,
      ],
    ),
    removeIssueLabel: vi.fn(async () => ({ removed: true, labels: ["keep"] })),
    ...overrides,
  };
}
const asClient = (github: ReturnType<typeof fakeGitHub>) =>
  github as unknown as GitHubClient;

const target = {
  repo: "acme/web",
  number: 12,
  configuredRepository: "acme/web",
};

/** What GitHub answered when the request left: a status and the first part of its body. */
const answered = (status: number, body = "", rateLimited = false) =>
  new GitHubRequestError(
    `GitHub API request failed: HTTP ${status}${body ? ` - ${body}` : ""}`,
    true,
    status,
    rateLimited,
  );

describe("the repository of a GitHub write", () => {
  it.each([
    ["a URL", "https://github.com/acme/web"],
    ["a host and path", "github.com/acme/web"],
    ["an ssh address", "git@github.com:acme/web.git"],
    ["a path with an extra segment", "acme/web/issues"],
    ["a name that climbs", "acme/.."],
    ["a name with a query", "acme/web?x=1"],
    ["a bare name", "web"],
    ["an empty string", "  "],
  ])(
    "refuses %s, so the request path is never built from it",
    (_label, repo) => {
      expect(() => parseIssueRepository(repo)).toThrowError(
        expect.objectContaining({ errorCode: "github_repository_invalid" }),
      );
    },
  );

  it("takes owner/name, trimmed", () => {
    expect(parseIssueRepository(" acme/web ")).toEqual({
      owner: "acme",
      repo: "web",
    });
  });
});

describe("how a failed GitHub write is told", () => {
  const write = (github: ReturnType<typeof fakeGitHub>) =>
    addLabelsToIssue(asClient(github), { ...target, labels: ["triage"] });
  const failing = (error: unknown) =>
    fakeGitHub({
      addIssueLabels: vi.fn(async () => {
        throw error;
      }),
    });

  it("says GitHub is not connected when no request could be signed, and nothing was written", async () => {
    await expect(
      write(
        failing(
          new GitHubRequestError(
            "GITHUB_TOKEN is not configured for this workspace",
            false,
          ),
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "github_not_connected",
      sideEffect: "none",
      statusCode: 412,
    });
  });

  it("is github_access_denied when the connection lacks write access (403), the code every GitHub step uses for a refused credential", async () => {
    await expect(
      write(
        failing(
          answered(
            403,
            '{"message":"Resource not accessible by personal access token"}',
          ),
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "github_access_denied",
      sideEffect: "none",
      retryable: false,
      statusCode: 403,
    });
    await expect(write(failing(answered(401)))).rejects.toMatchObject({
      errorCode: "github_access_denied",
    });
  });

  it("is a rate limit GitHub rejected, safe to try again, never an unknown outcome", async () => {
    await expect(
      write(failing(answered(403, "secondary rate limit", true))),
    ).rejects.toMatchObject({
      errorCode: "github_rate_limited",
      retryable: true,
      sideEffect: "none",
    });
  });

  it("is github_not_found for a 404, without echoing GitHub's body", async () => {
    const error = await write(
      failing(answered(404, '{"message":"Not Found","secret":"leak-me"}')),
    ).catch((caught: Error) => caught);

    expect(error).toMatchObject({
      errorCode: "github_not_found",
      sideEffect: "none",
    });
    expect((error as Error).message).not.toContain("leak-me");
  });

  it.each([400, 410, 422])(
    "is github_write_rejected for a %s: GitHub said no and nothing was written",
    async (status) => {
      await expect(write(failing(answered(status)))).rejects.toMatchObject({
        errorCode: "github_write_rejected",
        sideEffect: "none",
        retryable: false,
      });
    },
  );

  it.each([
    ["a 500", answered(500)],
    ["a 503", answered(503)],
    ["a 408", answered(408)],
    [
      "a dropped connection",
      new GitHubRequestError("fetch failed", true, null),
    ],
    [
      "an answer that cannot be read",
      new Error("GitHub label response was not an array"),
    ],
  ])(
    "is github_labels_outcome_unknown for %s, which may have been written and is never retried",
    async (_label, error) => {
      const github = failing(error);

      await expect(write(github)).rejects.toMatchObject({
        errorCode: "github_labels_outcome_unknown",
        sideEffect: "maybe",
        retryable: false,
      });
      expect(github.addIssueLabels).toHaveBeenCalledTimes(1);
    },
  );
});

describe("addLabelsToIssue", () => {
  it("adds the labels once each, and the receipt reference is derived from where and what", async () => {
    const github = fakeGitHub();

    const result = await addLabelsToIssue(asClient(github), {
      ...target,
      labels: [" triage ", "Bug", "bug", "area/ui"],
    });

    expect(github.addIssueLabels).toHaveBeenCalledWith(
      { owner: "acme", repo: "web" },
      12,
      ["triage", "Bug", "area/ui"],
    );
    expect(result).toEqual({
      ok: true,
      labels: ["existing", "triage", "Bug", "area/ui"],
      // Sorted and in lower case, so the same labels in any order and spelling are the same reference.
      externalRef: "acme/web#12+area/ui,bug,triage",
    });
    const again = await addLabelsToIssue(asClient(github), {
      ...target,
      labels: ["area/ui", "triage", "bug"],
    });
    expect(again.externalRef).toBe(result.externalRef);
  });

  it("keeps its reference under the receipt's 500 characters at its largest", async () => {
    const github = fakeGitHub();
    const labels = Array.from({ length: GITHUB_LABELS_MAX }, (_, index) =>
      `${index}`.padEnd(GITHUB_LABEL_MAX_CHARS, "x"),
    );

    const repo = `${"o".repeat(39)}/${"r".repeat(100)}`;

    const result = await addLabelsToIssue(asClient(github), {
      repo,
      number: 2_147_483_647,
      labels,
      configuredRepository: repo,
    });

    expect(result.externalRef.length).toBeLessThan(500);
  });

  it.each([
    ["no labels", []],
    ["not a list", "bug"],
    ["a label that is not text", ["bug", 3]],
    ["an empty label", ["bug", "  "]],
    [
      `a label over ${GITHUB_LABEL_MAX_CHARS} characters`,
      ["x".repeat(GITHUB_LABEL_MAX_CHARS + 1)],
    ],
    ["a comma in a label", ["bug,ui"]],
    ["a control character in a label", ["bug\nui"]],
    ["an invisible character in a label", ["bug​ui"]],
    ["a label of only dots", [".."]],
    [
      `more than ${GITHUB_LABELS_MAX} labels`,
      Array.from({ length: GITHUB_LABELS_MAX + 1 }, (_, index) => `l${index}`),
    ],
  ])("refuses %s, and nothing reaches GitHub", async (_label, labels) => {
    const github = fakeGitHub();

    await expect(
      addLabelsToIssue(asClient(github), { ...target, labels }),
    ).rejects.toMatchObject({
      errorCode: "github_label_invalid",
      sideEffect: "none",
    });
    expect(github.addIssueLabels).not.toHaveBeenCalled();
  });

  it("accepts the most it allows, and the full length of a name", async () => {
    const github = fakeGitHub();
    const labels = Array.from({ length: GITHUB_LABELS_MAX }, (_, index) =>
      `${index}`.padEnd(GITHUB_LABEL_MAX_CHARS, "x"),
    );

    await expect(
      addLabelsToIssue(asClient(github), { ...target, labels }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("does not call a write confirmed when GitHub's answer lacks a label that was asked for", async () => {
    const github = fakeGitHub({
      addIssueLabels: vi.fn(async () => ["existing"]),
    });

    await expect(
      addLabelsToIssue(asClient(github), { ...target, labels: ["triage"] }),
    ).rejects.toMatchObject({
      errorCode: "github_labels_outcome_unknown",
      sideEffect: "maybe",
    });
  });

  it("matches the answer without regard to case, as GitHub reads names", async () => {
    const github = fakeGitHub({ addIssueLabels: vi.fn(async () => ["Bug"]) });

    await expect(
      addLabelsToIssue(asClient(github), { ...target, labels: ["bug"] }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("tells a failure by what GitHub answered, with its own unknown code", async () => {
    const github = fakeGitHub({
      addIssueLabels: vi.fn(async () => {
        throw answered(502);
      }),
    });

    await expect(
      addLabelsToIssue(asClient(github), { ...target, labels: ["triage"] }),
    ).rejects.toMatchObject({
      errorCode: "github_labels_outcome_unknown",
      sideEffect: "maybe",
    });
  });
});

describe("removeLabelFromIssue", () => {
  it("removes one label and says it did", async () => {
    const github = fakeGitHub();

    const result = await removeLabelFromIssue(asClient(github), {
      ...target,
      label: " triage ",
    });

    expect(github.removeIssueLabel).toHaveBeenCalledWith(
      { owner: "acme", repo: "web" },
      12,
      "triage",
    );
    expect(result).toEqual({
      ok: true,
      alreadyAbsent: false,
      externalRef: "acme/web#12-triage",
    });
  });

  it("is a success with alreadyAbsent when the item never had the label", async () => {
    const github = fakeGitHub({
      removeIssueLabel: vi.fn(async () => ({ removed: false, labels: null })),
    });

    await expect(
      removeLabelFromIssue(asClient(github), { ...target, label: "triage" }),
    ).resolves.toEqual({
      ok: true,
      alreadyAbsent: true,
      externalRef: "acme/web#12-triage",
    });
  });

  it("does not call a removal confirmed when the label is still in GitHub's answer", async () => {
    const github = fakeGitHub({
      removeIssueLabel: vi.fn(async () => ({
        removed: true,
        labels: ["Triage"],
      })),
    });

    await expect(
      removeLabelFromIssue(asClient(github), { ...target, label: "triage" }),
    ).rejects.toMatchObject({
      errorCode: "github_labels_outcome_unknown",
      sideEffect: "maybe",
    });
  });

  it.each([
    ["a label with a comma", "a,b"],
    ["a label of only dots", ".."],
    ["an empty label", " "],
  ])("refuses %s and never reaches GitHub", async (_label, label) => {
    const github = fakeGitHub();

    await expect(
      removeLabelFromIssue(asClient(github), { ...target, label }),
    ).rejects.toMatchObject({ errorCode: "github_label_invalid" });
    expect(github.removeIssueLabel).not.toHaveBeenCalled();
  });

  it("fails a missing issue as not found, which is not the same as a label the item lacked", async () => {
    const github = fakeGitHub({
      removeIssueLabel: vi.fn(async () => {
        throw answered(404, '{"message":"Not Found"}');
      }),
    });

    await expect(
      removeLabelFromIssue(asClient(github), { ...target, label: "triage" }),
    ).rejects.toMatchObject({ errorCode: "github_not_found" });
  });
});

describe("the audit row of a GitHub write", () => {
  it("is `POST github <path>`, as chat's provider request is audited, with no labels in it", () => {
    expect(
      issueWriteAuditSummary(
        { repo: "acme/web", number: 12, labels: ["secret-label"] } as never,
        "POST",
        "success",
      ),
    ).toBe("POST github /repos/acme/web/issues/12/labels");
  });

  it("names the label a removal is for, since it is part of the path", () => {
    expect(
      issueWriteAuditSummary(
        { repo: "acme/web", number: 12, label: "area/ui" },
        "DELETE",
        "success",
      ),
    ).toBe("DELETE github /repos/acme/web/issues/12/labels/area%2Fui");
  });

  it("says when the write failed", () => {
    expect(
      issueWriteAuditSummary({ repo: "acme/web", number: 12 }, "POST", "error"),
    ).toBe("POST github /repos/acme/web/issues/12/labels (failed)");
  });

  it("copies nothing from a repository or number it cannot read", () => {
    const line = issueWriteAuditSummary(
      { repo: "https://evil.test/x?token=abc", number: "12; drop" },
      "POST",
      "error",
    );

    expect(line).not.toContain("evil");
    expect(line).not.toContain("drop");
    expect(
      issueAuditTarget({ repo: "https://evil.test/x", number: 1 }),
    ).toEqual({ type: "github-issue", visibility: "org" });
    expect(issueAuditTarget({ repo: "acme/web", number: 12 })).toEqual({
      type: "github-issue",
      id: "acme/web#12",
      visibility: "org",
    });
  });
});

describe("the factory's repository, the rule the merge gate applies", () => {
  const adds = (configuredRepository: string | null, repo = "acme/web") => {
    const github = fakeGitHub();
    return {
      github,
      run: () =>
        addLabelsToIssue(asClient(github), {
          repo,
          number: 12,
          labels: ["triage"],
          configuredRepository,
        }),
    };
  };
  const removes = (configuredRepository: string | null, repo = "acme/web") => {
    const github = fakeGitHub();
    return {
      github,
      run: () =>
        removeLabelFromIssue(asClient(github), {
          repo,
          number: 12,
          label: "triage",
          configuredRepository,
        }),
    };
  };

  it.each([
    ["another repository", "acme/other"],
    ["another owner", "someone/web"],
  ])(
    "refuses %s before any request leaves, for both label writes",
    async (_label, configured) => {
      for (const { github, run } of [adds(configured), removes(configured)]) {
        await expect(run()).rejects.toMatchObject({
          errorCode: "repository_not_allowed",
          sideEffect: "none",
          statusCode: 409,
          retryable: false,
          message: expect.stringContaining(`(${configured})`),
        });
        expect(github.addIssueLabels).not.toHaveBeenCalled();
        expect(github.removeIssueLabel).not.toHaveBeenCalled();
      }
    },
  );

  it("refuses when the factory has no repository set, as the merge gate does, for both label writes", async () => {
    for (const { github, run } of [adds(null), removes(null)]) {
      await expect(run()).rejects.toMatchObject({
        errorCode: "repository_not_allowed",
        sideEffect: "none",
        message: expect.stringContaining("no repository configured"),
      });
      expect(github.addIssueLabels).not.toHaveBeenCalled();
      expect(github.removeIssueLabel).not.toHaveBeenCalled();
    }
  });

  it("refuses an empty setting the same way, never as if it matched", async () => {
    const { github, run } = adds("  ");

    await expect(run()).rejects.toMatchObject({
      errorCode: "repository_not_allowed",
    });
    expect(github.addIssueLabels).not.toHaveBeenCalled();
  });

  it("writes in the factory's own repository, however the setting is spelled", async () => {
    for (const configured of [
      "acme/web",
      " acme/web ",
      "https://github.com/acme/web",
    ]) {
      const added = adds(configured);
      await expect(added.run()).resolves.toMatchObject({ ok: true });
      expect(added.github.addIssueLabels).toHaveBeenCalledTimes(1);
      const removed = removes(configured);
      await expect(removed.run()).resolves.toMatchObject({ ok: true });
      expect(removed.github.removeIssueLabel).toHaveBeenCalledTimes(1);
    }
  });

  it("is checked before the labels, so a repository that is not the factory's is told first", async () => {
    const github = fakeGitHub();

    await expect(
      addLabelsToIssue(asClient(github), {
        repo: "acme/other",
        number: 12,
        labels: [],
        configuredRepository: "acme/web",
      }),
    ).rejects.toMatchObject({ errorCode: "repository_not_allowed" });
  });

  it("still refuses a URL for the repository first, because nothing can be compared to it", async () => {
    const { github, run } = adds("acme/web", "https://github.com/acme/web");

    await expect(run()).rejects.toMatchObject({
      errorCode: "github_repository_invalid",
    });
    expect(github.addIssueLabels).not.toHaveBeenCalled();
  });
});

describe("the catalog's account of these writes", () => {
  it("states the label limits the code enforces", () => {
    const def = OPERATION_CATALOG.get("github.addLabels");

    expect(def?.description).toContain(`1 to ${GITHUB_LABELS_MAX} labels`);
    expect(def?.description).toContain(`${GITHUB_LABEL_MAX_CHARS} characters`);
  });

  it("says both label writes stay in the factory's own repository", () => {
    for (const id of ["github.addLabels", "github.removeLabel"]) {
      expect(OPERATION_CATALOG.get(id)?.description).toContain(
        "factory's own repository",
      );
    }
  });

  it("has no step that comments on an issue, which the repo's automated-findings policy keeps out of GitHub", () => {
    expect(OPERATION_CATALOG.get("github.commentIssue")).toBeUndefined();
    expect(
      OPERATION_CATALOG.list().filter(
        (def) => def.provider === "github" && /comment/i.test(def.id),
      ),
    ).toEqual([]);
  });
});
