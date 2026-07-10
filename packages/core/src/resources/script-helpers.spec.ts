import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockResourceGetByPath = vi.fn();
const mockResourcePut = vi.fn();
const mockResourceDeleteByPath = vi.fn();
const mockResourceList = vi.fn();
const mockResourceListAccessible = vi.fn();
const mockResourceEffectiveContext = vi.fn();
const mockEnsurePersonalDefaults = vi.fn();

vi.mock("./store.js", () => ({
  SHARED_OWNER: "__shared__",
  WORKSPACE_OWNER: "__workspace__",
  sharedResourceOwner: () => "__shared__",
  resourceGetByPath: (...args: any[]) => mockResourceGetByPath(...args),
  resourcePut: (...args: any[]) => mockResourcePut(...args),
  resourceDeleteByPath: (...args: any[]) => mockResourceDeleteByPath(...args),
  resourceList: (...args: any[]) => mockResourceList(...args),
  resourceListAccessible: (...args: any[]) =>
    mockResourceListAccessible(...args),
  resourceEffectiveContext: (...args: any[]) =>
    mockResourceEffectiveContext(...args),
  ensurePersonalDefaults: (...args: any[]) =>
    mockEnsurePersonalDefaults(...args),
}));

import {
  readResource,
  writeResource,
  deleteResource,
  listResources,
  listAllResources,
  getEffectiveResourceContext,
} from "./script-helpers.js";

describe("resources script-helpers", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.clearAllMocks();
    mockEnsurePersonalDefaults.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("owner resolution", () => {
    it("uses AGENT_USER_EMAIL when set", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourceGetByPath.mockResolvedValue(null);

      await readResource("file.md");
      expect(mockResourceGetByPath).toHaveBeenCalledWith(
        "alice@test.com",
        "file.md",
      );
    });

    it("throws when no AGENT_USER_EMAIL and no request context", async () => {
      delete process.env.AGENT_USER_EMAIL;

      await expect(readResource("file.md")).rejects.toThrow(
        "Resource access requires an authenticated request context or AGENT_USER_EMAIL env var",
      );
      expect(mockResourceGetByPath).not.toHaveBeenCalled();
    });

    it("uses __shared__ owner when shared option is true", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourceGetByPath.mockResolvedValue(null);

      await readResource("file.md", { shared: true });
      expect(mockResourceGetByPath).toHaveBeenCalledWith(
        "__shared__",
        "file.md",
      );
    });

    it("uses __workspace__ owner when scope is workspace", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourceGetByPath.mockResolvedValue(null);

      await readResource("context/brand.md", { scope: "workspace" });
      expect(mockResourceGetByPath).toHaveBeenCalledWith(
        "__workspace__",
        "context/brand.md",
      );
    });
  });

  describe("readResource", () => {
    it("returns content when resource exists", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourceGetByPath.mockResolvedValue({
        content: "# Hello",
        path: "README.md",
      });

      const result = await readResource("README.md");
      expect(result).toBe("# Hello");
    });

    it("returns null when resource does not exist", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourceGetByPath.mockResolvedValue(null);

      const result = await readResource("nonexist.md");
      expect(result).toBeNull();
    });
  });

  describe("writeResource", () => {
    it("writes content to the correct owner and path", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourcePut.mockResolvedValue({});

      await writeResource("notes.md", "# Notes");
      expect(mockResourcePut).toHaveBeenCalledWith(
        "alice@test.com",
        "notes.md",
        "# Notes",
        undefined,
      );
    });

    it("passes mimeType option", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourcePut.mockResolvedValue({});

      await writeResource("data.json", '{"a":1}', {
        mimeType: "application/json",
      });
      expect(mockResourcePut).toHaveBeenCalledWith(
        "alice@test.com",
        "data.json",
        '{"a":1}',
        "application/json",
      );
    });

    it("writes to shared owner when shared is true", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourcePut.mockResolvedValue({});

      await writeResource("shared.md", "content", { shared: true });
      expect(mockResourcePut).toHaveBeenCalledWith(
        "__shared__",
        "shared.md",
        "content",
        undefined,
      );
    });

    it("passes agent scratch metadata when provided", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourcePut.mockResolvedValue({});

      await writeResource("scratch/plan.md", "notes", {
        visibility: "agent_scratch",
        createdBy: "agent",
        threadId: "thread-1",
      });

      expect(mockResourcePut).toHaveBeenCalledWith(
        "alice@test.com",
        "scratch/plan.md",
        "notes",
        undefined,
        {
          visibility: "agent_scratch",
          createdBy: "agent",
          threadId: "thread-1",
          runId: undefined,
          expiresAt: undefined,
          metadata: undefined,
        },
      );
    });
  });

  describe("deleteResource", () => {
    it("deletes a resource by path", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourceDeleteByPath.mockResolvedValue(true);

      const result = await deleteResource("old.md");
      expect(result).toBe(true);
      expect(mockResourceDeleteByPath).toHaveBeenCalledWith(
        "alice@test.com",
        "old.md",
      );
    });

    it("returns false when resource does not exist", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourceDeleteByPath.mockResolvedValue(false);

      const result = await deleteResource("nope.md");
      expect(result).toBe(false);
    });
  });

  describe("listResources", () => {
    it("lists resources for the current user", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourceList.mockResolvedValue([{ path: "a.md" }, { path: "b.md" }]);

      const result = await listResources();
      expect(mockResourceList).toHaveBeenCalledWith(
        "alice@test.com",
        undefined,
      );
      expect(result).toHaveLength(2);
    });

    it("filters by prefix", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourceList.mockResolvedValue([]);

      await listResources("skills/");
      expect(mockResourceList).toHaveBeenCalledWith(
        "alice@test.com",
        "skills/",
      );
    });

    it("lists shared resources when shared is true", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourceList.mockResolvedValue([]);

      await listResources(undefined, { shared: true });
      expect(mockResourceList).toHaveBeenCalledWith("__shared__", undefined);
    });

    it("lists workspace resources when scope is workspace", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourceList.mockResolvedValue([]);

      await listResources(undefined, { scope: "workspace" });
      expect(mockResourceList).toHaveBeenCalledWith("__workspace__", undefined);
    });

    it("can include agent scratch resources", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourceList.mockResolvedValue([]);

      await listResources(undefined, { includeAgentScratch: true });
      expect(mockResourceList).toHaveBeenCalledWith(
        "alice@test.com",
        undefined,
        { includeAgentScratch: true },
      );
    });
  });

  describe("listAllResources", () => {
    it("lists all inherited and accessible resources", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourceListAccessible.mockResolvedValue([
        { path: "mine.md", owner: "alice@test.com" },
        { path: "shared.md", owner: "__shared__" },
        { path: "context/brand.md", owner: "__workspace__" },
      ]);

      const result = await listAllResources();
      expect(mockResourceListAccessible).toHaveBeenCalledWith(
        "alice@test.com",
        undefined,
      );
      expect(result).toHaveLength(3);
    });

    it("filters by prefix", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourceListAccessible.mockResolvedValue([]);

      await listAllResources("skills/");
      expect(mockResourceListAccessible).toHaveBeenCalledWith(
        "alice@test.com",
        "skills/",
      );
    });

    it("can include all agent scratch resources", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourceListAccessible.mockResolvedValue([]);

      await listAllResources(undefined, { includeAgentScratch: true });
      expect(mockResourceListAccessible).toHaveBeenCalledWith(
        "alice@test.com",
        undefined,
        { includeAgentScratch: true },
      );
    });

    it("throws when no AGENT_USER_EMAIL and no request context", async () => {
      delete process.env.AGENT_USER_EMAIL;

      await expect(listAllResources()).rejects.toThrow(
        "Resource access requires an authenticated request context or AGENT_USER_EMAIL env var",
      );
      expect(mockResourceListAccessible).not.toHaveBeenCalled();
    });
  });

  describe("getEffectiveResourceContext", () => {
    it("returns the workspace to personal inheritance stack for the current user", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      const context = {
        path: "instructions/guardrails.md",
        effectiveScope: "shared",
        layers: [],
      };
      mockResourceEffectiveContext.mockResolvedValue(context);

      const result = await getEffectiveResourceContext(
        "instructions/guardrails.md",
      );

      expect(mockEnsurePersonalDefaults).toHaveBeenCalledWith("alice@test.com");
      expect(mockResourceEffectiveContext).toHaveBeenCalledWith(
        "alice@test.com",
        "instructions/guardrails.md",
      );
      expect(result).toBe(context);
    });
  });
});
