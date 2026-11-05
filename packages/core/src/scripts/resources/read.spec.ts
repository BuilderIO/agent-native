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

import { createResourceScriptEntries } from "../../server/agent-chat/script-entries.js";
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

describe("resource action paging", () => {
  const path = "notes/paged.txt";

  beforeEach(() => {
    vi.clearAllMocks();
    resources.clear();
    mocks.resourceGetByPath.mockImplementation(
      async (resourceOwner: string, resourcePath: string) =>
        resources.get(`${resourceOwner}:${resourcePath}`) ?? null,
    );
  });

  it.each([40_000, 20_000, 128, 90])(
    "reconstructs Unicode within a %i-character action cap",
    async (cap) => {
      const content =
        cap >= 20_000
          ? "a".repeat(19_930) + "😀b".repeat(8_000) + "end"
          : "😀a".repeat(180) + "end";
      addResource({ owner, path, content });
      const action = (await createResourceScriptEntries()).resources;
      expect(action).toBeDefined();
      let offset = 0;
      let rebuilt = "";
      for (let i = 0; i < content.length; i++) {
        const out = await runWithRequestContext({ userEmail: owner }, () =>
          action.run(
            {
              action: "read",
              path,
              scope: "personal",
              offset: String(offset),
              maxResultChars: "100000",
            },
            { caller: "tool", maxResultChars: cap },
          ),
        );
        expect(out.length).toBeLessThanOrEqual(cap);
        expect(Buffer.from(out, "utf8").toString("utf8")).toBe(out);
        const match = out.match(
          /^\[chars (\d+)-(\d+) of (\d+); (?:partial - read again with offset=(\d+) for the rest|end of resource)\]\n/,
        );
        expect(match).not.toBeNull();
        if (!match) throw new Error(`Missing page header: ${out}`);
        const end = Number(match[2]);
        expect(Number(match[1])).toBe(offset);
        expect(Number(match[3])).toBe(content.length);
        const body = out.slice(match[0].length);
        expect(body).toBe(content.slice(offset, end));
        expect(end).toBeGreaterThan(offset);
        rebuilt += body;
        if (match[4] === undefined) {
          expect(end).toBe(content.length);
          break;
        }
        expect(Number(match[4])).toBe(end);
        offset = end;
      }
      expect(rebuilt).toBe(content);
    },
  );

  it("fails rather than splitting a codepoint or returning a misleading header", async () => {
    addResource({ owner, path, content: "😀more" });
    const action = (await createResourceScriptEntries()).resources;
    const header =
      "[chars 0-2 of 6; partial - read again with offset=2 for the rest]\n";
    for (const cap of [2, header.length + 1]) {
      await expect(
        runWithRequestContext({ userEmail: owner }, () =>
          action.run(
            { action: "read", path, scope: "personal", length: "1" },
            { caller: "tool", maxResultChars: cap },
          ),
        ),
      ).rejects.toThrow(/result.*(cap|limit)/i);
    }
    expect(
      await runWithRequestContext({ userEmail: owner }, () =>
        action.run(
          { action: "read", path, scope: "personal", length: "1" },
          { caller: "tool", maxResultChars: header.length + 2 },
        ),
      ),
    ).toBe(header + "😀");
  });
});

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

  describe("paging", () => {
    const path = "notes/big.txt";
    const content =
      "START\n" +
      "line\n".repeat(30000) +
      "MIDDLE\n" +
      "line\n".repeat(30000) +
      "TAIL\n";

    async function page(...extra: string[]): Promise<string> {
      output.length = 0;
      await runWithRequestContext({ userEmail: owner }, () =>
        resourceReadScript(["--path", path, "--scope", "personal", ...extra]),
      );
      return output.join("");
    }

    it("returns small resources unchanged", async () => {
      addResource({ owner, path, content: "small" });
      expect(await page()).toBe("small");
    });

    it("reconstructs Unicode across page edges after UTF-8 encoding", async () => {
      const unicode =
        "a".repeat(39_999) +
        "\u{1f600}" +
        "b".repeat(39_997) +
        "\u{1f680}" +
        "tail";
      addResource({ owner, path, content: unicode });
      let offset = 0;
      let rebuilt = "";
      const offsets: number[] = [];
      for (let i = 0; i < 3; i++) {
        const out = Buffer.from(
          await page("--offset", String(offset), "--length", "50000"),
          "utf8",
        ).toString("utf8");
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
        offsets.push(offset);
      }
      expect(offsets).toEqual([39_999, 79_998]);
      expect(rebuilt).toBe(unicode);
    });

    it("advances over an entire surrogate pair when length is one", async () => {
      addResource({ owner, path, content: "x\u{1f600}y" });
      expect(await page("--length", "1")).toBe(
        "[chars 0-1 of 4; partial - read again with offset=1 for the rest]\nx",
      );
      expect(await page("--offset", "1", "--length", "1")).toBe(
        "[chars 1-3 of 4; partial - read again with offset=3 for the rest]\n\u{1f600}",
      );
      expect(await page("--offset", "3", "--length", "1")).toBe(
        "[chars 3-4 of 4; end of resource]\ny",
      );

      addResource({ owner, path, content: "\u{1f600}z" });
      expect(await page("--length", "1")).toBe(
        "[chars 0-2 of 3; partial - read again with offset=2 for the rest]\n\u{1f600}",
      );
    });

    it("rejects an explicit offset inside a surrogate pair", async () => {
      addResource({ owner, path, content: "x\u{1f600}y" });
      await expect(page("--offset", "2")).rejects.toThrow(
        "--offset 2 falls inside a surrogate pair",
      );
      expect(output).toEqual([]);
    });

    it("rejects an offset past the end", async () => {
      addResource({ owner, path, content });
      await expect(page("--offset", String(content.length))).rejects.toThrow(
        "past the end",
      );
    });
  });
});
