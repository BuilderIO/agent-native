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

import { saveRevisionOf } from "../../save-conflict/index.js";
import { runWithRequestContext } from "../../server/request-context.js";
import resourceReadScript from "./read.js";

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

describe("resource-read paging", () => {
  const path = "notes/big.txt";
  const content =
    "START\n" +
    "line\n".repeat(30000) +
    "MIDDLE\n" +
    "line\n".repeat(30000) +
    "TAIL\n";

  beforeEach(() => {
    vi.clearAllMocks();
    resources.clear();
    output = [];
    mocks.getEnabledSkillLabsForUser.mockResolvedValue(new Set());
    mocks.resourceGetByPath.mockImplementation(
      async (resourceOwner: string, path: string) =>
        resources.get(`${resourceOwner}:${path}`) ?? null,
    );
    vi.spyOn(process.stdout, "write").mockImplementation(
      (chunk: string | Uint8Array) => {
        output.push(String(chunk));
        return true;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function page(...extra: string[]): Promise<string> {
    output.length = 0;
    await runWithRequestContext({ userEmail: owner }, () =>
      resourceReadScript(["--path", path, "--scope", "personal", ...extra]),
    );
    return output.join("");
  }

  it("pages a large resource to the end without losing text", async () => {
    addResource({ owner, path, content });
    let offset = 0;
    let rebuilt = "";
    for (let i = 0; i < 20; i++) {
      const out = await page(...(offset ? ["--offset", String(offset)] : []));
      const nl = out.indexOf("\n");
      const header = out.slice(0, nl);
      const body = out.slice(nl + 1);
      expect(body.length).toBeLessThanOrEqual(40_000);
      rebuilt += body;
      const next = header.match(/offset=(\d+)/);
      if (!next) {
        expect(header).toContain("end of resource");
        break;
      }
      offset = Number(next[1]);
    }
    expect(rebuilt).toBe(content);
  });
});

describe("resource-read revision line", () => {
  const path = "notes/todo.md";

  beforeEach(() => {
    vi.clearAllMocks();
    resources.clear();
    output = [];
    mocks.getEnabledSkillLabsForUser.mockResolvedValue(new Set());
    mocks.resourceGetByPath.mockImplementation(
      async (resourceOwner: string, path: string) =>
        resources.get(`${resourceOwner}:${path}`) ?? null,
    );
    vi.spyOn(process.stdout, "write").mockImplementation(
      (chunk: string | Uint8Array) => {
        output.push(String(chunk));
        return true;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function read(
    args: string[],
    options: { maxResultChars?: number; withRevision?: boolean },
  ): Promise<string> {
    output.length = 0;
    await runWithRequestContext({ userEmail: owner }, () =>
      resourceReadScript(["--path", path, ...args], options),
    );
    return output.join("");
  }

  it("starts an agent's read with the revision and scope to write back", async () => {
    addResource({ owner, path, content: "# Todo" });

    const out = await read([], { withRevision: true });

    expect(out).toBe(
      `[revision ${saveRevisionOf({ content: "# Todo" })}, scope personal]\n# Todo`,
    );
  });

  it("names the scope the file was found in", async () => {
    addResource({ owner: "__shared__", path, content: "team" });

    const out = await read([], { withRevision: true });

    expect(out.split("\n")[0]).toBe(
      `[revision ${saveRevisionOf({ content: "team" })}, scope shared]`,
    );
  });

  it("leaves the line out of other reads", async () => {
    addResource({ owner, path, content: "# Todo" });

    expect(await read([], {})).toBe("# Todo");
  });

  it("counts the line against the result limit", async () => {
    const content = "x".repeat(500);
    addResource({ owner, path, content });
    const line = `[revision ${saveRevisionOf({ content })}, scope personal]\n`;

    const out = await read([], {
      withRevision: true,
      maxResultChars: line.length + 200,
    });

    expect(out.startsWith(line)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(line.length + 200);
    expect(out.slice(line.length)).toMatch(/^\[chars 0-\d+ of 500; partial/);
  });

  it("asks a later page to match the first page's revision", async () => {
    addResource({ owner, path, content: "x".repeat(50_000) });

    const first = await read([], { withRevision: true });
    const later = await read(["--offset", "40000"], { withRevision: true });

    expect(first).not.toContain("first page's");
    expect(later.split("\n")[1]).toBe(
      "[chars 40000-50000 of 50000; end of resource; if the revision isn't your first page's, the file changed: read again from offset=0]",
    );
  });

  it("refuses a limit too small for the line", async () => {
    addResource({ owner, path, content: "# Todo" });

    await expect(
      read([], { withRevision: true, maxResultChars: 10 }),
    ).rejects.toThrow("too small for the revision line");
  });
});
