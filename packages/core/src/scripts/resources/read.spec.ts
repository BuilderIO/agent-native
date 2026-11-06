import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensurePersonalDefaults: vi.fn(async () => undefined),
  getEnabledSkillLabsForUser: vi.fn(),
  resourceGetByPath: vi.fn(),
}));

vi.mock("../../resources/store.js", () => ({
  SHARED_OWNER: "__shared__",
  WORKSPACE_OWNER: "__workspace__",
  ensurePersonalDefaults: (...args: unknown[]) =>
    mocks.ensurePersonalDefaults(...args),
  resourceGetByPath: (...args: unknown[]) => mocks.resourceGetByPath(...args),
  sharedResourceOwner: (orgId?: string | null) =>
    orgId ? `__organization__:${orgId}` : "__shared__",
}));

vi.mock("../../server/agents-bundle.js", () => ({
  getEnabledSkillLabsForUser: (...args: unknown[]) =>
    mocks.getEnabledSkillLabsForUser(...args),
}));

import { ActionContractError } from "../../action.js";
import type { Resource } from "../../resources/store.js";
import { runWithRequestContext } from "../../server/request-context.js";
import resourceReadScript, {
  resolveResourceForRead,
  formatResourceTextRange,
  validateResourceTextRange,
} from "./read.js";

const owner = "alice@example.test";
const resources = new Map<
  string,
  { owner: string; path: string; content: string }
>();
let output: string[];

function addResource(resource: {
  owner: string;
  path: string;
  content: string;
}): void {
  resources.set(`${resource.owner}:${resource.path}`, resource);
}

describe("resource-read Lab gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resources.clear();
    output = [];
    mocks.getEnabledSkillLabsForUser.mockResolvedValue(new Set());
    mocks.resourceGetByPath.mockImplementation(
      async (resourceOwner: string, path: string) =>
        resources.get(`${resourceOwner}:${path}`) ?? null,
    );
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      output.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(["test-org", null])(
    "resolves default precedence with org %s without writing output",
    async (orgId) => {
      const path = "notes/test.md";
      const owners = [
        owner,
        ...(orgId ? [`__organization__:${orgId}`] : []),
        "__shared__",
        "__workspace__",
      ];
      for (const resourceOwner of owners)
        addResource({ owner: resourceOwner, path, content: resourceOwner });
      for (const expectedOwner of owners) {
        const resource = await runWithRequestContext(
          { userEmail: owner, orgId },
          () => resolveResourceForRead(path),
        );
        expect(resource).toMatchObject({
          owner: expectedOwner,
          content: expectedOwner,
        });
        resources.delete(`${expectedOwner}:${path}`);
      }
      expect(mocks.ensurePersonalDefaults).toHaveBeenCalledWith(owner);
      expect(output).toEqual([]);
    },
  );

  it("waits for personal defaults before selecting an existing shared fallback", async () => {
    const path = "LEARNINGS.md";
    addResource({ owner: "__shared__", path, content: "Shared fallback" });
    mocks.ensurePersonalDefaults.mockImplementationOnce(async () => {
      await Promise.resolve();
      addResource({ owner, path, content: "Initialized personal defaults" });
    });
    expect(
      await runWithRequestContext({ userEmail: owner }, () =>
        resolveResourceForRead(path),
      ),
    ).toMatchObject({ owner, content: "Initialized personal defaults" });
  });

  it.each([
    ["personal", owner],
    ["shared", "__organization__:test-org"],
    ["workspace", "__workspace__"],
  ])("keeps explicit %s scope isolated", async (scope, expectedOwner) => {
    const path = "notes/test.md";
    for (const resourceOwner of [
      owner,
      "__organization__:test-org",
      "__workspace__",
    ])
      addResource({ owner: resourceOwner, path, content: resourceOwner });
    const resolve = () =>
      runWithRequestContext({ userEmail: owner, orgId: "test-org" }, () =>
        resolveResourceForRead(path, scope),
      );
    expect(await resolve()).toMatchObject({ owner: expectedOwner });
    resources.delete(`${expectedOwner}:${path}`);
    expect(await resolve()).toBeNull();
    expect(mocks.ensurePersonalDefaults).toHaveBeenCalledTimes(
      scope === "personal" ? 2 : 0,
    );
  });

  it("falls back from an organization miss to legacy shared in explicit shared scope", async () => {
    const path = "notes/legacy.md";
    for (const resourceOwner of [owner, "__shared__", "__workspace__"])
      addResource({ owner: resourceOwner, path, content: resourceOwner });
    expect(
      await runWithRequestContext({ userEmail: owner, orgId: "test-org" }, () =>
        resolveResourceForRead(path, "shared"),
      ),
    ).toMatchObject({ owner: "__shared__", content: "__shared__" });
    expect(mocks.ensurePersonalDefaults).not.toHaveBeenCalled();
  });

  it.each(["all", "unsupported"])(
    "retains successful default fallback for CLI scope %s",
    async (scope) => {
      const path = "notes/fallback.md";
      const owners = [owner, "__shared__", "__workspace__"];
      for (const resourceOwner of owners)
        addResource({ owner: resourceOwner, path, content: resourceOwner });
      for (const expectedOwner of owners) {
        output = [];
        await runWithRequestContext({ userEmail: owner }, () =>
          resourceReadScript(["--path", path, "--scope", scope]),
        );
        expect(output).toEqual([expectedOwner]);
        resources.delete(`${expectedOwner}:${path}`);
      }
    },
  );

  it("requires identity while retaining ambient CLI identity and request precedence", async () => {
    vi.stubEnv("AGENT_USER_EMAIL", "");
    await expect(
      runWithRequestContext({}, () => resolveResourceForRead("notes/test.md")),
    ).rejects.toThrow("requires an authenticated user");
    expect(mocks.resourceGetByPath).not.toHaveBeenCalled();
    vi.stubEnv("AGENT_USER_EMAIL", "ambient@example.test");
    addResource({
      owner: "ambient@example.test",
      path: "notes/test.md",
      content: "ambient",
    });
    addResource({ owner, path: "notes/test.md", content: "request" });
    expect(
      await resolveResourceForRead("notes/test.md", "personal"),
    ).toMatchObject({ content: "ambient" });
    expect(
      await runWithRequestContext({ userEmail: owner }, () =>
        resolveResourceForRead("notes/test.md", "personal"),
      ),
    ).toMatchObject({ content: "request" });
  });

  it("keeps standalone raw stdout, including whitespace and empty content", async () => {
    for (const content of [" \r\n---\nname: raw\n---\n😀\t ", ""]) {
      output = [];
      addResource({ owner, path: "notes/raw.md", content });
      await runWithRequestContext({ userEmail: owner }, () =>
        resourceReadScript(["--path", "notes/raw.md"]),
      );
      expect(output).toEqual([content]);
    }
  });

  it.each([
    [undefined, ""],
    ["personal", " (scope: personal)"],
    ["shared", " (scope: shared)"],
    ["workspace", " (scope: workspace)"],
    ["unsupported", ""],
  ])("retains missing diagnostics for %s", async (scope, scopeLabel) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runWithRequestContext({ userEmail: owner }, () =>
      resourceReadScript([
        "--path",
        "missing.md",
        ...(scope ? ["--scope", scope] : []),
      ]),
    );
    expect(log).toHaveBeenCalledWith(
      `Resource not found: missing.md${scopeLabel}. ${scope === "workspace" ? "Workspace resources are managed from Dispatch." : "You can create it with resource-write."}`,
    );
  });

  it("keeps help independent of identity and missing-path failures", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await resourceReadScript(["--help"]);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        "Usage: pnpm action resource-read --path <path> [options]",
      ),
    );
    expect(mocks.resourceGetByPath).not.toHaveBeenCalled();
    await expect(resourceReadScript([])).rejects.toThrow("--path is required");
  });

  it.each([
    "skills/reports/SKILL.md",
    "skills/reports.md",
    "/skills/restricted.md",
  ])("blocks a direct read of disabled Lab-gated %s", async (path) => {
    const content =
      "---\nname: reports\nrequires-lab: reports.preview\n---\n# Reports";
    addResource({ owner, path, content });

    await expect(
      runWithRequestContext({ userEmail: owner }, () =>
        resourceReadScript(["--path", path, "--scope", "personal"]),
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        constructor: ActionContractError,
        errorCode: "skill_lab_required",
        statusCode: 403,
      }),
    );
    expect(output).toEqual([]);
  });

  it.each(["__shared__", "__workspace__"])(
    "checks the %s manifest before reading a shared directory skill subfile",
    async (manifestOwner) => {
      const path = "skills/reports/references/guide.md";
      const content = "Private gated skill reference.";
      addResource({ owner: "__shared__", path, content });
      addResource({
        owner: manifestOwner,
        path: "skills/reports/SKILL.md",
        content:
          "---\nname: reports\nrequires-lab: reports.preview\n---\n# Reports",
      });

      await expect(
        runWithRequestContext({ userEmail: owner }, () =>
          resourceReadScript(["--path", path, "--scope", "shared"]),
        ),
      ).rejects.toThrow('requires the "reports.preview" Lab');
      expect(output).toEqual([]);

      mocks.getEnabledSkillLabsForUser.mockResolvedValue(
        new Set(["reports.preview"]),
      );
      output = [];

      await runWithRequestContext({ userEmail: owner }, () =>
        resourceReadScript(["--path", path, "--scope", "shared"]),
      );

      expect(output.join("")).toBe(content);
      expect(mocks.getEnabledSkillLabsForUser).toHaveBeenCalledWith(
        ["reports.preview"],
        owner,
      );
    },
  );

  it.each([null, "---\nname: reports\n---\nUngated manifest"])(
    "allows a skill subfile with ungated or missing manifest %j",
    async (manifest) => {
      const path = "skills/reports/references/public.md";
      addResource({ owner, path, content: "Public reference" });
      if (manifest !== null)
        addResource({
          owner,
          path: "skills/reports/SKILL.md",
          content: manifest,
        });
      await runWithRequestContext({ userEmail: owner }, () =>
        resourceReadScript(["--path", path]),
      );
      expect(output).toEqual(["Public reference"]);
      expect(mocks.getEnabledSkillLabsForUser).not.toHaveBeenCalled();
    },
  );

  it("fails closed without returning content when Lab state is unreadable", async () => {
    const path = "skills/reports/SKILL.md";
    const content =
      "---\nname: reports\nrequires-lab: reports.preview\n---\n# Reports";
    addResource({ owner, path, content });
    mocks.getEnabledSkillLabsForUser.mockRejectedValue(
      new Error("settings unavailable"),
    );

    await expect(
      runWithRequestContext({ userEmail: owner }, () =>
        resourceReadScript(["--path", path, "--scope", "personal"]),
      ),
    ).rejects.toThrow("Lab settings are unavailable");
    expect(output).toEqual([]);
  });

  it.each([".agents/skills/", ".agent/skills/"])(
    "checks the canonical manifest for a local %s alias",
    async (prefix) => {
      const path = `${prefix}reports/references/guide.md`;
      mocks.resourceGetByPath.mockImplementation(async (_owner, requested) => {
        if (requested === path)
          return {
            owner: "__workspace__",
            path: "skills/reports/references/guide.md",
            content: "Restricted reference",
          };
        if (requested === "skills/reports/SKILL.md")
          return {
            owner: "__workspace__",
            path: requested,
            content: "---\nrequires-lab: reports.preview\n---\nManifest",
          };
        return null;
      });
      await expect(
        runWithRequestContext({ userEmail: owner }, () =>
          resourceReadScript(["--path", path, "--scope", "workspace"]),
        ),
      ).rejects.toThrow('requires the "reports.preview" Lab');
      expect(output).toEqual([]);
    },
  );
});

function resource(
  content: string,
  overrides: Partial<Resource> = {},
): Resource {
  return {
    id: "range-test",
    path: "notes/test.md",
    owner: "reader@example.test",
    content,
    mimeType: "text/markdown",
    size: Buffer.byteLength(content),
    createdAt: 0,
    updatedAt: 0,
    createdBy: "user",
    visibility: "workspace",
    threadId: null,
    runId: null,
    expiresAt: null,
    metadata: null,
    ...overrides,
  };
}

// oracle-change: User-approved UTF-16 windows and whole stored representations replace code-point ranges and rejection.
// Small exhaustive reference: enumerate every legal output, including terminal discontinuities.
function oracle(
  content: string,
  offset: number,
  limit: number,
  allowance: number,
): string | null {
  let start = Math.min(offset, content.length);
  if (
    /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(content.slice(start - 1, start + 1))
  )
    start--;
  let window = content.slice(start, start + limit);
  const end = start + window.length;
  if (/[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(content.slice(end - 1, end + 1))) {
    window =
      window.length === 1
        ? content.slice(start, start + 2)
        : window.slice(0, -1);
  }
  let best: string | null = null;
  for (
    let count = start === content.length ? 0 : 1;
    count <= window.length;
    count++
  ) {
    const body = window.slice(0, count);
    const next = start + count;
    if (
      /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(content.slice(next - 1, next + 1))
    )
      continue;
    const number = (n: number) => n.toLocaleString("en-US");
    const ending =
      next === content.length
        ? "end of resource"
        : `${number(content.length)} total; next offset ${number(next)}`;
    const output = `${body}\n\n${next === content.length ? "" : "..."}[Returned ${number(count)} characters; ${ending}]`;
    if (output.length <= allowance) best = output;
  }
  return best;
}

describe("Resource range controls", () => {
  it("opts in only with both numeric safe integers on reads", () => {
    expect(validateResourceTextRange({ action: "read" })).toBeNull();
    expect(
      validateResourceTextRange({
        action: "read",
        offset: 0,
        limit: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual({ offset: 0, limit: Number.MAX_SAFE_INTEGER });
  });

  it.each([
    { offset: 0 },
    { limit: 1 },
    { offset: undefined, limit: undefined },
    ...[
      null,
      false,
      true,
      "0",
      "",
      0.5,
      -1,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ].map((offset) => ({ offset, limit: 1 })),
    ...[
      null,
      false,
      true,
      "1",
      "",
      0,
      0.5,
      -1,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ].map((limit) => ({ offset: 0, limit })),
    ...["list", "effective", "write", "promote", "delete"].map((action) => ({
      action,
      offset: 0,
      limit: 1,
    })),
  ])("rejects invalid controls %j", (controls) => {
    expect(() =>
      Reflect.apply(validateResourceTextRange, undefined, [
        { action: "read", ...controls },
      ]),
    ).toThrow(
      expect.objectContaining({
        constructor: ActionContractError,
        errorCode: "invalid_resource_range",
        statusCode: 400,
      }),
    );
  });
});

describe("Resource text ranges", () => {
  it.each([
    "",
    "abcdefghij",
    "A😀B𐐀C",
    "\uffffx😀",
    "\ud800x\udc00",
    "\ud800\udc00x",
    "\udbff\udc00x",
    "\ud800\udfffx",
    "\ud800\ue000x",
    "e\u0301👩‍👩‍👧‍👦",
    " \t\r\n---\nname: test\n---\n",
    '{"literal":true}\n\n...[Returned 2 characters; end of resource]',
  ])("matches exhaustive maximal fitting for %j", (content) => {
    const total = content.length;
    for (let offset = 0; offset <= total + 1; offset++) {
      for (const limit of [1, 2, 9, Number.MAX_SAFE_INTEGER]) {
        for (const allowance of [
          0, 41, 42, 43, 44, 45, 46, 47, 52, 53, 54, 55, 56, 60, 62, 63, 80,
          120, 200,
        ]) {
          const expected = oracle(content, offset, limit, allowance);
          const run = () =>
            formatResourceTextRange(
              resource(content),
              { offset, limit },
              allowance,
            );
          if (expected === null) {
            expect(run).toThrow(
              expect.objectContaining({
                constructor: ActionContractError,
                errorCode: "resource_range_budget_too_small",
                statusCode: 400,
              }),
            );
          } else {
            expect(run()).toBe(expected);
          }
        }
      }
    }
  });

  it("fits terminal output before searching smaller partial outputs", () => {
    const doc = resource("abcdefghij");
    const output = "abcdefghij\n\n[Returned 10 characters; end of resource]";
    expect(output.length).toBe(53);
    expect(
      formatResourceTextRange(doc, { offset: 0, limit: 10 }, output.length),
    ).toBe(output);
    expect(() =>
      formatResourceTextRange(doc, { offset: 0, limit: 10 }, output.length - 1),
    ).toThrow(
      expect.objectContaining({
        constructor: ActionContractError,
        errorCode: "resource_range_budget_too_small",
        statusCode: 400,
      }),
    );
  });

  it.each([
    [
      "\ud800x",
      1,
      "\ud800\n\n...[Returned 1 characters; 2 total; next offset 1]",
    ],
    [
      "A\ud800x",
      2,
      "A\ud800\n\n...[Returned 2 characters; 3 total; next offset 2]",
    ],
    ["😀x", 1, "😀\n\n...[Returned 2 characters; 3 total; next offset 2]"],
  ])(
    "adjusts the requested window only for actual pairs in %j",
    (content, limit, expected) => {
      expect(
        formatResourceTextRange(resource(content), { offset: 0, limit }, 100),
      ).toBe(expected);
    },
  );

  it.each([9, 10, 99, 100, 999, 1000, 9999, 10000])(
    "fits exact digit/comma transitions at %i",
    (offset) => {
      const content = "a".repeat(offset) + "😀".repeat(12);
      for (const limit of [1, 9, 10, Number.MAX_SAFE_INTEGER]) {
        for (let allowance = 50; allowance <= 100; allowance++) {
          const expected = oracle(content, offset, limit, allowance);
          const run = () =>
            formatResourceTextRange(
              resource(content),
              { offset, limit },
              allowance,
            );
          if (expected === null) expect(run).toThrow(ActionContractError);
          else expect(run()).toBe(expected);
        }
      }
    },
  );

  it.each([999, 1000, 9999, 10000, 1_000_000])(
    "reports delivered count %i with stable separators",
    (count) => {
      const content = "a".repeat(count + 1);
      const page = (n: number) =>
        `${"a".repeat(n)}\n\n...[Returned ${n.toLocaleString("en-US")} characters; ${(count + 1).toLocaleString("en-US")} total; next offset ${n.toLocaleString("en-US")}]`;
      const expected = page(count);
      expect(
        formatResourceTextRange(
          resource(content),
          { offset: 0, limit: count },
          expected.length,
        ),
      ).toBe(expected);
      expect(
        formatResourceTextRange(
          resource(content),
          { offset: 0, limit: count },
          expected.length - 1,
        ),
      ).toBe(page(count - 1));
    },
  );

  it("clamps offsets at and past EOF, including safe-integer extremes", () => {
    for (const offset of [4, 5, Number.MAX_SAFE_INTEGER]) {
      expect(
        formatResourceTextRange(
          resource("A😀B"),
          { offset, limit: Number.MAX_SAFE_INTEGER },
          500,
        ),
      ).toBe("\n\n[Returned 0 characters; end of resource]");
    }
  });

  it("requires room for an entire final astral point or empty terminal footer", () => {
    const output = "😀\n\n[Returned 2 characters; end of resource]";
    expect(
      formatResourceTextRange(
        resource("😀"),
        { offset: 0, limit: 1 },
        output.length,
      ),
    ).toBe(output);
    expect(() =>
      formatResourceTextRange(
        resource("😀"),
        { offset: 0, limit: 1 },
        output.length - 1,
      ),
    ).toThrow(ActionContractError);
    const empty = "\n\n[Returned 0 characters; end of resource]";
    expect(
      formatResourceTextRange(
        resource(""),
        { offset: 0, limit: 1 },
        empty.length,
      ),
    ).toBe(empty);
    expect(() =>
      formatResourceTextRange(
        resource(""),
        { offset: 0, limit: 1 },
        empty.length - 1,
      ),
    ).toThrow(ActionContractError);
  });

  it.each(
    [
      "text/plain",
      "TEXT/PLAIN",
      "Text/Plain; charset=UTF-8",
      "application/json",
      "APPLICATION/JSON",
      "Application/JSON",
    ].flatMap((mimeType) => [50, 1000].map((length) => ({ mimeType, length }))),
  )("ranges inline $mimeType ($length characters)", ({ mimeType, length }) => {
    const doc = Object.freeze(
      resource(JSON.stringify("x".repeat(length - 2)), { mimeType }),
    );
    expect(formatResourceTextRange(doc, { offset: 0, limit: 20 }, 150)).toBe(
      `"${"x".repeat(19)}\n\n...[Returned 20 characters; ${length === 50 ? "50" : "1,000"} total; next offset 20]`,
    );
  });

  it.each(["text/plain", "text/markdown", "text/xml", "application/json"])(
    "preserves literal URL text for %s",
    (mimeType) => {
      expect(
        formatResourceTextRange(
          resource("https://example.test/file", { mimeType }),
          { offset: 8, limit: 7 },
          500,
        ),
      ).toBe("example\n\n...[Returned 7 characters; 25 total; next offset 15]");
    },
  );

  it.each([
    { mimeType: "image/png", offset: 1 },
    { mimeType: "ImAgE/PnG", offset: Number.MAX_SAFE_INTEGER },
  ])("returns the exact stored image URL for %j", ({ mimeType, offset }) => {
    const content = "https://EXAMPLE.test/😀%2f.png";
    expect(
      formatResourceTextRange(
        resource(content, { mimeType }),
        { offset, limit: 1 },
        content.length,
      ),
    ).toBe(content);
  });

  it("rejects an image URL one UTF-16 unit over the allowance", () => {
    const content = "https://example.test/😀.png";
    expect(() =>
      formatResourceTextRange(
        resource(content, { mimeType: "image/png" }),
        { offset: 0, limit: 1 },
        content.length - 1,
      ),
    ).toThrow(
      expect.objectContaining({
        constructor: ActionContractError,
        errorCode: "resource_range_budget_too_small",
        statusCode: 400,
      }),
    );
  });

  it.each([
    ["application/pdf", "https://example.test/report.pdf"],
    ["application/json; charset=utf-8", "https://example.test/data.json"],
    ["Application/JSON; charset=UTF-8", "https://example.test/data.json"],
    ["application/yaml", "key: stored value\n"],
    ["application/xml", "<root>😀</root>"],
    ["application/octet-stream", "opaque-reference:123"],
  ])(
    "returns whole stored %s without trusting metadata",
    (mimeType, content) => {
      const doc = resource(content, {
        mimeType,
        metadata: JSON.stringify({ source: "local-workspace-resource" }),
      });
      expect(
        formatResourceTextRange(
          doc,
          { offset: Number.MAX_SAFE_INTEGER, limit: 1 },
          content.length,
        ),
      ).toBe(content);
      expect(() =>
        formatResourceTextRange(
          doc,
          { offset: 1, limit: 1 },
          content.length - 1,
        ),
      ).toThrow(
        expect.objectContaining({
          constructor: ActionContractError,
          errorCode: "resource_range_budget_too_small",
          statusCode: 400,
        }),
      );
    },
  );

  it.each(["application/yaml", "application/xml"])(
    "accepts native local text identity for %s",
    (mimeType) => {
      expect(
        formatResourceTextRange(
          resource("x", { mimeType, id: "local-workspace-resource:fixture" }),
          { offset: 0, limit: 1 },
          100,
        ),
      ).toBe("x\n\n[Returned 1 characters; end of resource]");
    },
  );
});
