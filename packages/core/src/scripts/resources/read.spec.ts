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
  });

  it("blocks a direct read of a disabled Lab-gated skill", async () => {
    const path = "skills/reports/SKILL.md";
    const content =
      "---\nname: reports\nrequires-lab: reports.preview\n---\n# Reports";
    addResource({ owner, path, content });

    await expect(
      runWithRequestContext({ userEmail: owner }, () =>
        resourceReadScript(["--path", path, "--scope", "personal"]),
      ),
    ).rejects.toThrow('requires the "reports.preview" Lab');
    expect(output).toEqual([]);
  });

  it("checks the skill manifest before reading a directory skill subfile", async () => {
    const path = "skills/reports/references/guide.md";
    const content = "Private gated skill reference.";
    addResource({ owner: "__shared__", path, content });
    addResource({
      owner: "__shared__",
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
  });

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
});
