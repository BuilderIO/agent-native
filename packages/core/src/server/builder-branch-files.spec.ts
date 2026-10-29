import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAuthorization: vi.fn(),
  ssrfSafeFetch: vi.fn(),
  readBuilderGitBundle: vi.fn(),
}));

vi.mock("./builder-api-auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./builder-api-auth.js")>()),
  resolveBuilderRequestAuthorization: mocks.resolveAuthorization,
}));
vi.mock("./builder-browser.js", () => ({
  getBuilderApiHost: () => "https://api.builder.example",
}));
vi.mock("../extensions/url-safety.js", () => ({
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));
vi.mock("./builder-branch-git.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./builder-branch-git.js")>()),
  readBuilderGitBundle: mocks.readBuilderGitBundle,
}));

import { ActionContractError } from "../action.js";
import {
  BuilderBranchFilesError,
  readBuilderBranchBackupStatus,
  readBuilderBranchFiles,
} from "./builder-branch-files.js";
import { BuilderGitBundleError } from "./builder-branch-git.js";

const TOKEN = "oauth-token-test";
const PUBLIC_KEY = "public-key-test";
const PROJECT_ID = "project-123";
const OWNER_ID = "space-456";
const BRANCH_NAME = "feature/community-app";
const APP_PATH = "apps/example-app";
const COMMIT = "a".repeat(40);
const BACKUP_AT = Date.now();
const BUNDLE = Buffer.from("test git bundle bytes");
const MD5 = createHash("md5").update(BUNDLE).digest("base64");
const FILE_PATH = `${OWNER_ID}/${PROJECT_ID}/${BRANCH_NAME}/git.bundle`;
const SIGNED_URL = `https://storage.googleapis.com/builder-projects-git-backups/${FILE_PATH}?X-Goog-Signature=fake-signature`;
const EXPIRES_AT = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const GIT_FILES = {
  commitSha: COMMIT,
  files: [
    {
      path: `${APP_PATH}/src/index.ts`,
      mode: "100644",
      content: new TextEncoder().encode("export const verified = true;\n"),
    },
  ],
};

const oauthAuthorization = {
  token: TOKEN,
  authorization: `Bearer ${TOKEN}`,
  source: "oauth",
};
const legacyAuthorization = {
  token: "legacy-private-key-test",
  authorization: "Bearer legacy-private-key-test",
  source: "legacy",
  legacyPublicKey: PUBLIC_KEY,
};

function backup(overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_ID,
    ownerId: OWNER_ID,
    branchName: BRANCH_NAME,
    at: BACKUP_AT,
    size: BUNDLE.byteLength,
    lastCommitHash: COMMIT,
    partial: false,
    status: "completed",
    contentMd5: MD5,
    forced: undefined,
    changedSubmodules: [],
    ...overrides,
  };
}

function status(
  overrides: {
    branch?: Record<string, unknown>;
    check?: Record<string, unknown>;
  } = {},
) {
  const currentBackup = backup(
    overrides.check?.backup as Record<string, unknown>,
  );
  return {
    status: "ok",
    branch: {
      projectId: PROJECT_ID,
      name: BRANCH_NAME,
      ownerId: OWNER_ID,
      agentState: "idle",
      hasUnpushedChanges: false,
      lastCommitHash: `code:${COMMIT}`,
      lastActivityAt: BACKUP_AT - 1,
      deleted: false,
      state: "active",
      ...overrides.branch,
    },
    backupStatuses: {
      code: {
        state: "valid",
        outcome: "valid",
        ...overrides.check,
        backup: currentBackup,
      },
    },
  };
}

function download(overrides: Record<string, unknown> = {}) {
  return {
    signedUrl: SIGNED_URL,
    filePath: FILE_PATH,
    partial: false,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

function jsonResponse(body: unknown, statusCode = 200): Response {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { "Content-Type": "application/json" },
  });
}

function streamResponse(parts: Array<Uint8Array | Error>): Response {
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const part = parts[index++];
        if (part === undefined) controller.close();
        else if (part instanceof Error) controller.error(part);
        else controller.enqueue(part);
      },
    }),
  );
}

const input = {
  projectId: PROJECT_ID,
  branchName: BRANCH_NAME,
  appPath: APP_PATH,
};

function queueSuccessfulApiReadbacks(
  options: {
    before?: unknown;
    after?: unknown;
    afterFailure?: Error;
    downloadBody?: unknown;
  } = {},
) {
  vi.mocked(fetch)
    .mockResolvedValueOnce(jsonResponse(options.downloadBody ?? download()))
    .mockResolvedValueOnce(jsonResponse(options.before ?? status()));
  if (options.afterFailure) {
    vi.mocked(fetch).mockRejectedValueOnce(options.afterFailure);
  } else {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(options.after ?? status()),
    );
  }
  mocks.ssrfSafeFetch.mockResolvedValueOnce(new Response(BUNDLE));
  mocks.readBuilderGitBundle.mockResolvedValueOnce(GIT_FILES);
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => {
      throw new Error("expected readback to fail");
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(BuilderBranchFilesError);
  expect(error).toMatchObject({ code });
  return error as Error;
}

describe("readBuilderBranchFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAuthorization.mockResolvedValue(oauthAuthorization);
    mocks.ssrfSafeFetch.mockReset();
    mocks.readBuilderGitBundle.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("verifies a current project branch bundle and reads only the requested app", async () => {
    queueSuccessfulApiReadbacks();

    await expect(readBuilderBranchFiles(input)).resolves.toEqual({
      projectId: PROJECT_ID,
      branchName: BRANCH_NAME,
      ...GIT_FILES,
    });

    expect(mocks.resolveAuthorization).toHaveBeenCalledWith({
      requiredScope: "builder:projects:read",
      legacyCredentialKeys: [],
    });
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(3);
    const [urlCall, beforeCall, afterCall] = calls;
    const url = new URL(String(urlCall?.[0]));
    expect(url.origin + url.pathname).toBe(
      "https://api.builder.example/projects/branch/bundle-download-url",
    );
    expect(JSON.parse(String(urlCall?.[1]?.body))).toEqual({
      projectId: PROJECT_ID,
      branchName: BRANCH_NAME,
    });
    for (const [requestUrl, init] of [beforeCall, afterCall]) {
      const statusUrl = new URL(String(requestUrl));
      expect(statusUrl.origin + statusUrl.pathname).toBe(
        "https://api.builder.example/projects/branch/status",
      );
      expect(statusUrl.searchParams.get("projectId")).toBe(PROJECT_ID);
      expect(statusUrl.searchParams.get("branchName")).toBe(BRANCH_NAME);
      // The Builder service contract registers branch/status as GET.
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
    }
    expect(urlCall?.[1]).toMatchObject({
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(mocks.ssrfSafeFetch).toHaveBeenCalledTimes(1);
    const [bundleUrl, bundleInit] = mocks.ssrfSafeFetch.mock.calls[0]!;
    expect(bundleUrl).toBe(SIGNED_URL);
    expect(bundleInit).not.toHaveProperty("headers.Authorization");
    expect(bundleInit).not.toHaveProperty("headers.authorization");
    expect(mocks.readBuilderGitBundle).toHaveBeenCalledWith({
      bundle: BUNDLE,
      commitSha: COMMIT,
      appPath: APP_PATH,
    });
  });

  it("rejects legacy authorization even when the public key is available", async () => {
    mocks.resolveAuthorization.mockResolvedValue(legacyAuthorization);
    await expectCode(readBuilderBranchFiles(input), "not_connected");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects missing authorization and scopes only project reads", async () => {
    mocks.resolveAuthorization.mockResolvedValueOnce(null);
    await expectCode(readBuilderBranchFiles(input), "not_connected");
    expect(fetch).not.toHaveBeenCalled();

    expect(mocks.resolveAuthorization).toHaveBeenLastCalledWith({
      requiredScope: "builder:projects:read",
      legacyCredentialKeys: [],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps a missing Builder read scope to a connection action", async () => {
    mocks.resolveAuthorization.mockRejectedValueOnce(
      new ActionContractError("Builder authorization must be renewed.", {
        errorCode: "builder_oauth_reauthorization_required",
      }),
    );

    const error = await expectCode(
      readBuilderBranchFiles(input),
      "not_connected",
    );
    expect(error.message).not.toContain("authorization must be renewed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("distinguishes an unreadable authorization store from a missing connection", async () => {
    mocks.resolveAuthorization.mockRejectedValueOnce(
      new Error("store unavailable"),
    );
    await expectCode(readBuilderBranchFiles(input), "unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid project ID", { ...input, projectId: "../project" }],
    ["invalid branch path", { ...input, branchName: "feature/../main" }],
    ["invalid app path", { ...input, appPath: "apps/../other" }],
  ])("rejects %s before authorization", async (_label, value) => {
    await expectCode(readBuilderBranchFiles(value), "invalid_request");
    expect(mocks.resolveAuthorization).not.toHaveBeenCalled();
  });

  it("rejects a nominally valid backup without an explicit primary code hash", async () => {
    for (const snapshot of ["", "b".repeat(40), `other:${COMMIT}`]) {
      queueSuccessfulApiReadbacks({
        before: status({ branch: { lastCommitHash: snapshot } }),
      });
      await expectCode(readBuilderBranchFiles(input), "unverified");
      vi.clearAllMocks();
      mocks.resolveAuthorization.mockResolvedValue(oauthAuthorization);
      mocks.ssrfSafeFetch.mockReset();
      mocks.readBuilderGitBundle.mockReset();
      vi.stubGlobal("fetch", vi.fn());
    }
  });

  it.each([
    ["status_shape", { status: "ok" }],
    ["status_binding", status({ branch: { name: "feature/other" } })],
    [
      "status_binding",
      status({
        branch: { name: "feature/other", lastCommitHash: "malformed" },
      }),
    ],
    [
      "status_currentness",
      status({ branch: { lastActivityAt: BACKUP_AT + 1 } }),
    ],
  ] as const)(
    "labels %s failures with a fixed stage",
    async (stage, before) => {
      queueSuccessfulApiReadbacks({ before });

      await expect(
        expectCode(readBuilderBranchFiles(input), "unverified"),
      ).resolves.toMatchObject({ readbackStage: stage });
    },
  );

  it.each([
    ["stale backup", { check: { state: "stale", outcome: "hash-mismatch" } }],
    [
      "forced offline backup",
      { check: { backup: { forced: "offline-full" } } },
    ],
    ["partial backup", { check: { backup: { partial: true } } }],
    ["incomplete backup", { check: { backup: { status: "initiated" } } }],
    [
      "submodule changes",
      { check: { backup: { changedSubmodules: ["vendor/lib"] } } },
    ],
    ["changed branch identity", { branch: { name: "feature/other" } }],
    ["changed project identity", { branch: { projectId: "other-project" } }],
    ["changed backup owner", { check: { backup: { ownerId: "other-space" } } }],
  ])("rejects %s", async (_label, overrides) => {
    queueSuccessfulApiReadbacks({ before: status(overrides) });
    await expectCode(readBuilderBranchFiles(input), "unverified");
    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["true", true],
    ["missing", undefined],
  ])(
    "rejects %s hasUnpushedChanges before bundle download",
    async (_label, value) => {
      queueSuccessfulApiReadbacks({
        before: status({ branch: { hasUnpushedChanges: value } }),
      });
      await expectCode(readBuilderBranchFiles(input), "unverified");
      expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["foreign signed URL origin", "https://evil.example/bundle"],
    ["expired signed URL", SIGNED_URL],
    ["wrong storage path", SIGNED_URL.replace("project-123", "other-project")],
    ["mismatched filePath", SIGNED_URL],
  ])("rejects %s before downloading", async (label, signedUrl) => {
    const body = download({
      signedUrl,
      filePath:
        label === "mismatched filePath" ? "other/path/git.bundle" : FILE_PATH,
      expiresAt:
        label === "expired signed URL"
          ? new Date(Date.now() - 60_000).toISOString()
          : EXPIRES_AT,
    });
    queueSuccessfulApiReadbacks({ downloadBody: body });
    await expectCode(readBuilderBranchFiles(input), "unverified");
    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
  });

  it("rejects a bundle whose downloaded bytes do not match its recorded MD5", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(download()))
      .mockResolvedValueOnce(jsonResponse(status()))
      .mockResolvedValueOnce(jsonResponse(status()));
    mocks.ssrfSafeFetch.mockResolvedValueOnce(new Response("different bytes"));

    await expect(
      expectCode(readBuilderBranchFiles(input), "integrity_failed"),
    ).resolves.toMatchObject({ readbackStage: "bundle_digest" });
    expect(mocks.readBuilderGitBundle).not.toHaveBeenCalled();
  });

  it("distinguishes a missing app subtree while preserving integrity failure", async () => {
    queueSuccessfulApiReadbacks();
    mocks.readBuilderGitBundle.mockReset();
    mocks.readBuilderGitBundle.mockRejectedValueOnce(
      new BuilderGitBundleError("target_missing"),
    );

    await expect(
      expectCode(readBuilderBranchFiles(input), "integrity_failed"),
    ).resolves.toMatchObject({ readbackStage: "target_subtree_missing" });
  });

  it.each([401, 403, 500])(
    "maps Builder API %i failures without leaking bodies",
    async (code) => {
      vi.mocked(fetch).mockResolvedValueOnce(
        jsonResponse({ error: "sensitive response detail" }, code),
      );
      const error = await expectCode(
        readBuilderBranchFiles(input),
        code === 401 || code === 403 ? "forbidden" : "unavailable",
      );
      expect(error.message).not.toContain("sensitive response detail");
    },
  );

  it("does not expose transport errors or response contents", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(
      new Error("token in network detail"),
    );
    const apiError = await expectCode(
      readBuilderBranchFiles(input),
      "unavailable",
    );
    expect(apiError.message).not.toContain("token in network detail");

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("sensitive malformed response"),
    );
    const parseError = await expectCode(
      readBuilderBranchFiles(input),
      "unavailable",
    );
    expect(parseError.message).not.toContain("sensitive malformed response");
  });

  it("rejects truncated and oversized API and bundle streams", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      streamResponse([
        new TextEncoder().encode("{"),
        new Error("truncated with secret"),
      ]),
    );
    const truncated = await expectCode(
      readBuilderBranchFiles(input),
      "unavailable",
    );
    expect(truncated.message).not.toContain("truncated with secret");

    vi.mocked(fetch).mockResolvedValueOnce(
      streamResponse([new Uint8Array(512 * 1024 + 1)]),
    );
    await expectCode(readBuilderBranchFiles(input), "integrity_failed");

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(download()))
      .mockResolvedValueOnce(jsonResponse(status()));
    mocks.ssrfSafeFetch.mockResolvedValueOnce(
      new Response(new Uint8Array(32 * 1024 * 1024 + 1)),
    );
    await expectCode(readBuilderBranchFiles(input), "integrity_failed");
  });

  it("rejects branch mutation between the two status reads", async () => {
    queueSuccessfulApiReadbacks({
      after: status({ branch: { lastCommitHash: `code:${"b".repeat(40)}` } }),
    });
    await expectCode(readBuilderBranchFiles(input), "unverified");
  });

  it.each([
    [
      "post_read_status_request",
      { afterFailure: new Error("private transport detail") },
      "unavailable",
    ],
    ["post_read_status_shape", { after: { status: "ok" } }, "unverified"],
    [
      "post_read_status_binding",
      { after: status({ branch: { name: "feature/other" } }) },
      "unverified",
    ],
    [
      "post_read_status_currentness",
      { after: status({ branch: { lastCommitHash: "malformed" } }) },
      "unverified",
    ],
  ] as const)(
    "labels second status %s failures",
    async (stage, options, code) => {
      queueSuccessfulApiReadbacks(options);

      await expect(
        expectCode(readBuilderBranchFiles(input), code),
      ).resolves.toMatchObject({ readbackStage: stage });
    },
  );

  it("rejects a changed owner when both status snapshots are internally valid", async () => {
    const changedOwner = "another-space";
    const after = status();
    after.branch.ownerId = changedOwner;
    after.backupStatuses.code.backup.ownerId = changedOwner;
    queueSuccessfulApiReadbacks({
      after,
    });
    await expect(
      expectCode(readBuilderBranchFiles(input), "unverified"),
    ).resolves.toMatchObject({ readbackStage: "post_read_currentness" });
  });

  it("accepts a workspace app ID ending in a hyphen", async () => {
    const appPath = "apps/example-app-";
    queueSuccessfulApiReadbacks();

    await expect(
      readBuilderBranchFiles({ ...input, appPath }),
    ).resolves.toMatchObject({
      projectId: PROJECT_ID,
      branchName: BRANCH_NAME,
    });
    expect(mocks.readBuilderGitBundle).toHaveBeenCalledWith({
      bundle: BUNDLE,
      commitSha: COMMIT,
      appPath,
    });
  });

  it.each([
    [
      "bundle digest",
      { check: { backup: { contentMd5: "BBBBBBBBBBBBBBBBBBBBBB==" } } },
    ],
    ["backup timestamp", { check: { backup: { at: Date.now() + 10_000 } } }],
  ])(
    "rejects changed %s between the two status reads",
    async (_label, delta) => {
      queueSuccessfulApiReadbacks({ after: status(delta) });
      await expectCode(readBuilderBranchFiles(input), "unverified");
    },
  );

  it.each([
    ["true", true],
    ["missing", undefined],
  ])(
    "rejects %s hasUnpushedChanges after bundle download",
    async (_label, value) => {
      queueSuccessfulApiReadbacks({
        after: status({ branch: { hasUnpushedChanges: value } }),
      });
      await expectCode(readBuilderBranchFiles(input), "unverified");
    },
  );

  it("rejects a failed or truncated signed bundle response without leaking details", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(download()))
      .mockResolvedValueOnce(jsonResponse(status()));
    mocks.ssrfSafeFetch.mockResolvedValueOnce(
      jsonResponse({ error: "private storage detail" }, 403),
    );
    const rejected = await expectCode(
      readBuilderBranchFiles(input),
      "unavailable",
    );
    expect(rejected.message).not.toContain("private storage detail");

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(download()))
      .mockResolvedValueOnce(jsonResponse(status()));
    mocks.ssrfSafeFetch.mockResolvedValueOnce(
      streamResponse([BUNDLE, new Error("truncated signed URL response")]),
    );
    const truncated = await expectCode(
      readBuilderBranchFiles(input),
      "unavailable",
    );
    expect(truncated.message).not.toContain("truncated signed URL response");
    expect(truncated).toMatchObject({ readbackStage: "bundle_read" });
  });

  it("fails closed when bundle extraction fails without exposing internal errors", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(download()))
      .mockResolvedValueOnce(jsonResponse(status()));
    mocks.ssrfSafeFetch.mockResolvedValueOnce(new Response(BUNDLE));
    mocks.readBuilderGitBundle.mockRejectedValueOnce(
      new Error("private file contents and signed URL"),
    );

    const error = await expectCode(
      readBuilderBranchFiles(input),
      "integrity_failed",
    );
    expect(error.message).not.toContain("private file contents");
    expect(error.message).not.toContain("signed URL");
  });

  it("preserves an unavailable Git reader as a retryable readback failure", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(download()))
      .mockResolvedValueOnce(jsonResponse(status()));
    mocks.ssrfSafeFetch.mockResolvedValueOnce(new Response(BUNDLE));
    mocks.readBuilderGitBundle.mockRejectedValueOnce(
      new BuilderGitBundleError("unavailable"),
    );

    const error = await expectCode(
      readBuilderBranchFiles(input),
      "unavailable",
    );
    expect(error.message).not.toContain("unavailable");
  });
});

describe("readBuilderBranchBackupStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAuthorization.mockResolvedValue(oauthAuthorization);
    mocks.ssrfSafeFetch.mockReset();
    mocks.readBuilderGitBundle.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads and returns only bound backup status metadata without downloading the bundle", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(status({ check: { backup: { partial: true } } })),
    );

    const result = await readBuilderBranchBackupStatus(input);

    expect(result).toEqual({
      branchState: "active",
      backupPartial: true,
      backupValid: true,
      backupComplete: true,
      backupCurrent: true,
      agentIdle: true,
      hasUnpushedChanges: false,
      verificationPerformed: false,
    });
    expect(mocks.resolveAuthorization).toHaveBeenCalledWith({
      requiredScope: "builder:projects:read",
      legacyCredentialKeys: [],
    });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe("/projects/branch/status");
    expect(options?.method).toBe("GET");
    expect(options?.redirect).toBe("error");
    expect(JSON.stringify(result)).not.toMatch(
      /signedUrl|contentMd5|lastCommitHash|ownerId|size|git\.bundle/i,
    );
    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
    expect(mocks.readBuilderGitBundle).not.toHaveBeenCalled();
  });

  it.each([
    ["branch name", { branchName: "other-branch" }],
    ["project", { projectId: "other-project" }],
    ["owner", { ownerId: "other-owner" }],
  ])(
    "fails when the returned backup has a mismatched %s",
    async (_name, binding) => {
      vi.mocked(fetch).mockResolvedValueOnce(
        jsonResponse(status({ check: { backup: binding } })),
      );

      await expectCode(readBuilderBranchBackupStatus(input), "unverified").then(
        (error) =>
          expect(error).toMatchObject({ readbackStage: "status_binding" }),
      );
    },
  );

  it("checks identity binding before parsing commit currentness", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        status({
          branch: { projectId: "other-project", lastCommitHash: "malformed" },
        }),
      ),
    );

    await expectCode(readBuilderBranchBackupStatus(input), "unverified").then(
      (error) =>
        expect(error).toMatchObject({ readbackStage: "status_binding" }),
    );
  });

  it("fails when the status response omits backup metadata", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ status: "ok", branch: status().branch }),
    );

    await expectCode(readBuilderBranchBackupStatus(input), "unverified").then(
      (error) => expect(error).toMatchObject({ readbackStage: "status_shape" }),
    );
  });

  it("preserves missing and malformed partial metadata as fixed markers", async () => {
    const malformedValue = "provider-fixture-private-detail";
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(status({ check: { backup: { partial: undefined } } })),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          status({ check: { backup: { partial: malformedValue } } }),
        ),
      );

    const missing = await readBuilderBranchBackupStatus(input);
    const malformed = await readBuilderBranchBackupStatus(input);

    expect(missing.backupPartial).toBe("missing");
    expect(malformed.backupPartial).toBe("invalid");
    expect(JSON.stringify([missing, malformed])).not.toContain(malformedValue);
  });

  it("fails with a typed shape error for an unknown provider status", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(status({ check: { state: "future-state" } })),
    );

    await expectCode(readBuilderBranchBackupStatus(input), "unverified").then(
      (error) => expect(error).toMatchObject({ readbackStage: "status_shape" }),
    );
  });

  it("rejects impossible backup state and outcome combinations", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(status({ check: { state: "valid", outcome: "no-backup" } })),
    );

    await expectCode(readBuilderBranchBackupStatus(input), "unverified").then(
      (error) => expect(error).toMatchObject({ readbackStage: "status_shape" }),
    );
  });

  it("reports a known invalid backup state without implying verification", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(status({ check: { state: "invalid", outcome: "error" } })),
    );

    await expect(readBuilderBranchBackupStatus(input)).resolves.toMatchObject({
      backupPartial: false,
      backupValid: false,
      backupComplete: true,
      verificationPerformed: false,
    });
  });

  it.each([
    ["stale hash mismatch", "stale", "hash-mismatch"],
    ["forced backup", "forced-backup", "forced-offline-full-backup"],
    ["submodule change", "submodule-changes", "submodule-changes"],
  ])("reports %s as nonvalid metadata", async (_label, state, outcome) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        status({ check: { state, outcome, backup: { partial: true } } }),
      ),
    );

    await expect(readBuilderBranchBackupStatus(input)).resolves.toMatchObject({
      backupPartial: true,
      backupValid: false,
      backupComplete: true,
      verificationPerformed: false,
    });
  });

  it("fails explicitly when an invalid provider status has no backup object", async () => {
    const value = status();
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        ...value,
        backupStatuses: {
          code: { state: "invalid", outcome: "no-backup" },
        },
      }),
    );

    await expectCode(readBuilderBranchBackupStatus(input), "unverified").then(
      (error) => expect(error).toMatchObject({ readbackStage: "status_shape" }),
    );
  });

  it("reports backup currentness and branch activity without verifying files", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        status({
          branch: { agentState: "running", hasUnpushedChanges: true },
          check: { backup: { at: BACKUP_AT - 10 } },
        }),
      ),
    );

    await expect(readBuilderBranchBackupStatus(input)).resolves.toMatchObject({
      backupCurrent: false,
      agentIdle: false,
      hasUnpushedChanges: true,
      verificationPerformed: false,
    });
  });

  it("preserves archived branch state in the bounded projection", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(status({ branch: { state: "archived" } })),
    );

    await expect(readBuilderBranchBackupStatus(input)).resolves.toMatchObject({
      branchState: "archived",
      verificationPerformed: false,
    });
  });

  it("preserves missing branch state as unknown instead of assuming active", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(status({ branch: { state: undefined } })),
    );

    await expect(readBuilderBranchBackupStatus(input)).resolves.toMatchObject({
      branchState: "unknown",
      verificationPerformed: false,
    });
  });

  it("fails when branch state contradicts the deleted flag", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(status({ branch: { state: "archived", deleted: true } })),
    );

    await expectCode(readBuilderBranchBackupStatus(input), "unverified").then(
      (error) =>
        expect(error).toMatchObject({ readbackStage: "status_binding" }),
    );
  });

  it("rejects legacy Builder credentials", async () => {
    mocks.resolveAuthorization.mockResolvedValueOnce(legacyAuthorization);

    await expectCode(readBuilderBranchBackupStatus(input), "not_connected");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails loudly when Builder status is unavailable", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("private detail"));

    await expectCode(readBuilderBranchBackupStatus(input), "unavailable").then(
      (error) =>
        expect(error).toMatchObject({ readbackStage: "status_request" }),
    );
  });
});
