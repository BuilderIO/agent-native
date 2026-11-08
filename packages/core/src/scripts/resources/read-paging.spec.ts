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
