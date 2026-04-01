import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockResourceGetByPath = vi.fn();
const mockResourcePut = vi.fn();
const mockResourceDeleteByPath = vi.fn();
const mockResourceList = vi.fn();
const mockResourceListAccessible = vi.fn();

vi.mock("./store.js", () => ({
  SHARED_OWNER: "__shared__",
  resourceGetByPath: (...args: any[]) => mockResourceGetByPath(...args),
  resourcePut: (...args: any[]) => mockResourcePut(...args),
  resourceDeleteByPath: (...args: any[]) => mockResourceDeleteByPath(...args),
  resourceList: (...args: any[]) => mockResourceList(...args),
  resourceListAccessible: (...args: any[]) =>
    mockResourceListAccessible(...args),
}));

import {
  readResource,
  writeResource,
  deleteResource,
  listResources,
  listAllResources,
} from "./script-helpers.js";

describe("resources script-helpers", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.clearAllMocks();
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

    it("defaults to local@localhost when no AGENT_USER_EMAIL", async () => {
      delete process.env.AGENT_USER_EMAIL;
      mockResourceGetByPath.mockResolvedValue(null);

      await readResource("file.md");
      expect(mockResourceGetByPath).toHaveBeenCalledWith(
        "local@localhost",
        "file.md",
      );
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
  });

  describe("readResource", () => {
    it("returns content when resource exists", async () => {
      delete process.env.AGENT_USER_EMAIL;
      mockResourceGetByPath.mockResolvedValue({
        content: "# Hello",
        path: "README.md",
      });

      const result = await readResource("README.md");
      expect(result).toBe("# Hello");
    });

    it("returns null when resource does not exist", async () => {
      delete process.env.AGENT_USER_EMAIL;
      mockResourceGetByPath.mockResolvedValue(null);

      const result = await readResource("nonexist.md");
      expect(result).toBeNull();
    });
  });

  describe("writeResource", () => {
    it("writes content to the correct owner and path", async () => {
      delete process.env.AGENT_USER_EMAIL;
      mockResourcePut.mockResolvedValue({});

      await writeResource("notes.md", "# Notes");
      expect(mockResourcePut).toHaveBeenCalledWith(
        "local@localhost",
        "notes.md",
        "# Notes",
        undefined,
      );
    });

    it("passes mimeType option", async () => {
      delete process.env.AGENT_USER_EMAIL;
      mockResourcePut.mockResolvedValue({});

      await writeResource("data.json", '{"a":1}', {
        mimeType: "application/json",
      });
      expect(mockResourcePut).toHaveBeenCalledWith(
        "local@localhost",
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
  });

  describe("deleteResource", () => {
    it("deletes a resource by path", async () => {
      delete process.env.AGENT_USER_EMAIL;
      mockResourceDeleteByPath.mockResolvedValue(true);

      const result = await deleteResource("old.md");
      expect(result).toBe(true);
      expect(mockResourceDeleteByPath).toHaveBeenCalledWith(
        "local@localhost",
        "old.md",
      );
    });

    it("returns false when resource does not exist", async () => {
      delete process.env.AGENT_USER_EMAIL;
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
      delete process.env.AGENT_USER_EMAIL;
      mockResourceList.mockResolvedValue([]);

      await listResources("skills/");
      expect(mockResourceList).toHaveBeenCalledWith(
        "local@localhost",
        "skills/",
      );
    });

    it("lists shared resources when shared is true", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourceList.mockResolvedValue([]);

      await listResources(undefined, { shared: true });
      expect(mockResourceList).toHaveBeenCalledWith("__shared__", undefined);
    });
  });

  describe("listAllResources", () => {
    it("lists both personal and shared resources", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      mockResourceListAccessible.mockResolvedValue([
        { path: "mine.md", owner: "alice@test.com" },
        { path: "shared.md", owner: "__shared__" },
      ]);

      const result = await listAllResources();
      expect(mockResourceListAccessible).toHaveBeenCalledWith(
        "alice@test.com",
        undefined,
      );
      expect(result).toHaveLength(2);
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

    it("defaults to local@localhost when no AGENT_USER_EMAIL", async () => {
      delete process.env.AGENT_USER_EMAIL;
      mockResourceListAccessible.mockResolvedValue([]);

      await listAllResources();
      expect(mockResourceListAccessible).toHaveBeenCalledWith(
        "local@localhost",
        undefined,
      );
    });
  });
});
