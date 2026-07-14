import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock dependencies ---

const mockResourceGet = vi.fn();
const mockResourceGetByPath = vi.fn();
const mockResourcePut = vi.fn();
const mockResourceDelete = vi.fn();
const mockResourceDeleteByPath = vi.fn();
const mockResourceList = vi.fn();
const mockResourceListAccessible = vi.fn();
const mockResourceMove = vi.fn();
const mockResourceEffectiveContext = vi.fn();
const mockEnsurePersonalDefaults = vi.fn();
const mockCanWriteLocalWorkspaceResourcePath = vi.fn();
const mockIsLocalWorkspaceResourceId = vi.fn();
const mockUploadFile = vi.fn();

vi.mock("./store.js", () => ({
  SHARED_OWNER: "__shared__",
  WORKSPACE_OWNER: "__workspace__",
  organizationIdFromResourceOwner: (owner: string) =>
    owner.startsWith("__organization__:")
      ? decodeURIComponent(owner.slice("__organization__:".length))
      : null,
  sharedResourceOwner: (orgId?: string | null) =>
    orgId ? `__organization__:${encodeURIComponent(orgId)}` : "__shared__",
  canWriteLocalWorkspaceResourcePath: (...args: any[]) =>
    mockCanWriteLocalWorkspaceResourcePath(...args),
  isLocalWorkspaceResourceId: (...args: any[]) =>
    mockIsLocalWorkspaceResourceId(...args),
  resourceGet: (...args: any[]) => mockResourceGet(...args),
  resourceGetByPath: (...args: any[]) => mockResourceGetByPath(...args),
  resourcePut: (...args: any[]) => mockResourcePut(...args),
  resourceDelete: (...args: any[]) => mockResourceDelete(...args),
  resourceDeleteByPath: (...args: any[]) => mockResourceDeleteByPath(...args),
  resourceList: (...args: any[]) => mockResourceList(...args),
  resourceListAccessible: (...args: any[]) =>
    mockResourceListAccessible(...args),
  resourceMove: (...args: any[]) => mockResourceMove(...args),
  resourceEffectiveContext: (...args: any[]) =>
    mockResourceEffectiveContext(...args),
  ensurePersonalDefaults: (...args: any[]) =>
    mockEnsurePersonalDefaults(...args),
}));

vi.mock("../server/auth.js", () => ({
  getSession: vi.fn().mockResolvedValue({ email: "test@test.com" }),
}));

const mockGetOrgContext = vi.fn().mockResolvedValue({
  email: "test@test.com",
  orgId: null,
  orgName: null,
  role: null,
});

vi.mock("../org/context.js", () => ({
  getOrgContext: (...args: any[]) => mockGetOrgContext(...args),
}));

vi.mock("../file-upload/index.js", () => ({
  uploadFile: (...args: any[]) => mockUploadFile(...args),
}));

let lastStatus = 200;

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  createError: (opts: any) => Object.assign(new Error(opts.message), opts),
  readBody: (event: any) => Promise.resolve(event._body),
  getQuery: (event: any) => event._query || {},
  getRouterParam: (event: any, key: string) => event._params?.[key],
  setResponseStatus: (_event: any, code: number) => {
    lastStatus = code;
  },
  setResponseHeader: vi.fn(),
  getMethod: (event: any) => event._method || "GET",
  readMultipartFormData: (event: any) =>
    Promise.resolve(event._multipart || null),
}));

import { getSession } from "../server/auth.js";
import {
  handleListResources,
  handleGetResourceTree,
  handleGetEffectiveResourceContext,
  handleGetResource,
  handleCreateResource,
  handleUpdateResource,
  handleDeleteResource,
  handleUploadResource,
} from "./handlers.js";

describe("resource handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastStatus = 200;
    mockEnsurePersonalDefaults.mockResolvedValue(undefined);
    mockCanWriteLocalWorkspaceResourcePath.mockResolvedValue(false);
    mockIsLocalWorkspaceResourceId.mockReturnValue(false);
    mockUploadFile.mockResolvedValue(null);
    vi.mocked(getSession).mockResolvedValue({ email: "test@test.com" } as any);
    mockGetOrgContext.mockResolvedValue({
      email: "test@test.com",
      orgId: null,
      orgName: null,
      role: null,
    });
  });

  describe("handleListResources", () => {
    it("lists all accessible resources by default", async () => {
      mockResourceListAccessible.mockResolvedValue([
        { id: "1", path: "a.md", owner: "test@test.com" },
        { id: "2", path: "b.md", owner: "__shared__" },
        { id: "3", path: "context/brand.md", owner: "__workspace__" },
      ]);

      const event = { _query: {} };
      const result = await handleListResources(event);

      expect(mockEnsurePersonalDefaults).toHaveBeenCalledWith("test@test.com");
      expect(mockResourceListAccessible).toHaveBeenCalledWith(
        "test@test.com",
        undefined,
        { userEmail: "test@test.com", orgId: null },
      );
      expect(result.resources).toHaveLength(3);
    });

    it("lists only personal resources when scope=personal", async () => {
      mockResourceList.mockResolvedValue([]);

      const event = { _query: { scope: "personal" } };
      await handleListResources(event);

      expect(mockResourceList).toHaveBeenCalledWith("test@test.com", undefined);
    });

    it("lists only shared resources when scope=shared", async () => {
      mockResourceList.mockResolvedValue([]);

      const event = { _query: { scope: "shared" } };
      await handleListResources(event);

      expect(mockResourceList).toHaveBeenCalledWith("__shared__", undefined);
    });

    it("lists only workspace resources when scope=workspace", async () => {
      mockResourceList.mockResolvedValue([]);

      const event = { _query: { scope: "workspace" } };
      await handleListResources(event);

      expect(mockResourceList).toHaveBeenCalledWith(
        "__workspace__",
        undefined,
        {
          userEmail: "test@test.com",
          orgId: null,
        },
      );
    });

    it("passes prefix filter", async () => {
      mockResourceListAccessible.mockResolvedValue([]);

      const event = { _query: { prefix: "skills/" } };
      await handleListResources(event);

      expect(mockResourceListAccessible).toHaveBeenCalledWith(
        "test@test.com",
        "skills/",
        { userEmail: "test@test.com", orgId: null },
      );
    });

    it("includes agent scratch resources only when requested", async () => {
      mockResourceListAccessible.mockResolvedValue([]);

      const event = {
        _query: { includeAgentScratch: "true" },
      };
      await handleListResources(event);

      expect(mockResourceListAccessible).toHaveBeenCalledWith(
        "test@test.com",
        undefined,
        {
          includeAgentScratch: true,
          userEmail: "test@test.com",
          orgId: null,
        },
      );
    });
  });

  describe("handleGetEffectiveResourceContext", () => {
    it("returns the inheritance stack for a path", async () => {
      const context = {
        path: "instructions/guardrails.md",
        effectiveScope: "shared",
        layers: [
          { scope: "workspace", exists: true, effective: false },
          { scope: "shared", exists: true, effective: true },
          { scope: "personal", exists: false, effective: false },
        ],
      };
      mockResourceEffectiveContext.mockResolvedValue(context);

      const result = await handleGetEffectiveResourceContext({
        _query: { path: "instructions/guardrails.md" },
      });

      expect(mockEnsurePersonalDefaults).toHaveBeenCalledWith("test@test.com");
      expect(mockResourceEffectiveContext).toHaveBeenCalledWith(
        "test@test.com",
        "instructions/guardrails.md",
        { userEmail: "test@test.com", orgId: null },
      );
      expect(result).toEqual(context);
    });

    it("returns 400 when path is missing", async () => {
      const result = await handleGetEffectiveResourceContext({ _query: {} });

      expect(lastStatus).toBe(400);
      expect(result).toEqual({ error: "path is required" });
      expect(mockResourceEffectiveContext).not.toHaveBeenCalled();
    });
  });

  describe("handleGetResource", () => {
    it("returns resource when found", async () => {
      const resource = {
        id: "r1",
        path: "notes.md",
        owner: "test@test.com",
        content: "# Notes",
        mimeType: "text/markdown",
        size: 7,
        createdAt: 1000,
        updatedAt: 2000,
      };
      mockResourceGet.mockResolvedValue(resource);

      const event = { _params: { id: "r1" }, _query: {}, context: {} };
      const result = await handleGetResource(event);

      expect(result).toEqual(resource);
    });

    it("returns 400 when no ID provided", async () => {
      const event = { _params: {}, _query: {}, context: { params: {} } };
      const result = await handleGetResource(event);

      expect(lastStatus).toBe(400);
      expect(result).toEqual({ error: "Resource ID is required" });
    });

    it("returns 404 when resource not found", async () => {
      mockResourceGet.mockResolvedValue(null);

      const event = {
        _params: { id: "missing" },
        _query: {},
        context: {},
      };
      const result = await handleGetResource(event);

      expect(lastStatus).toBe(404);
      expect(result).toEqual({ error: "Resource not found" });
    });

    it("does not return another user's personal resource by id", async () => {
      mockResourceGet.mockResolvedValue({
        id: "r1",
        path: "private.md",
        owner: "other@test.com",
        content: "secret",
        mimeType: "text/markdown",
        size: 6,
        createdAt: 1000,
        updatedAt: 2000,
      });

      const event = { _params: { id: "r1" }, _query: {}, context: {} };
      const result = await handleGetResource(event);

      expect(lastStatus).toBe(404);
      expect(result).toEqual({ error: "Resource not found" });
    });

    it("returns inherited workspace resources by id", async () => {
      const resource = {
        id: "workspace_1",
        path: "context/brand.md",
        owner: "__workspace__",
        content: "# Brand",
        mimeType: "text/markdown",
        size: 7,
        createdAt: 1000,
        updatedAt: 2000,
      };
      mockResourceGet.mockResolvedValue(resource);

      const event = { _params: { id: "workspace_1" }, _query: {}, context: {} };
      const result = await handleGetResource(event);

      expect(result).toEqual(resource);
    });

    it("strips content from binary resources in JSON response", async () => {
      const resource = {
        id: "img1",
        path: "photo.jpg",
        owner: "test@test.com",
        content: "base64encodeddata...",
        mimeType: "image/jpeg",
        size: 1000,
        createdAt: 1000,
        updatedAt: 2000,
      };
      mockResourceGet.mockResolvedValue(resource);

      const event = { _params: { id: "img1" }, _query: {}, context: {} };
      const result = await handleGetResource(event);

      // Binary content should be stripped
      expect(result.content).toBe("");
      expect(result.id).toBe("img1");
      expect(result.mimeType).toBe("image/jpeg");
    });

    it("serves raw content when ?raw query param is set", async () => {
      const { setResponseHeader } = await import("h3");

      const resource = {
        id: "r1",
        path: "notes.md",
        owner: "test@test.com",
        content: "# Hello",
        mimeType: "text/markdown",
        size: 7,
        createdAt: 1000,
        updatedAt: 2000,
      };
      mockResourceGet.mockResolvedValue(resource);

      const event = {
        _params: { id: "r1" },
        _query: { raw: "" },
        context: {},
      };

      const result = await handleGetResource(event);

      expect(setResponseHeader).toHaveBeenCalledWith(
        event,
        "Content-Type",
        "text/markdown",
      );
      expect(result).toBeInstanceOf(Response);
    });
  });

  describe("handleCreateResource", () => {
    it("creates a resource and returns 201", async () => {
      const created = {
        id: "new-1",
        path: "doc.md",
        owner: "test@test.com",
        content: "# Doc",
        mimeType: "text/markdown",
        size: 5,
        createdAt: 1000,
        updatedAt: 1000,
      };
      mockResourcePut.mockResolvedValue(created);

      const event = {
        _body: { path: "doc.md", content: "# Doc" },
      };
      const result = await handleCreateResource(event);

      expect(lastStatus).toBe(201);
      expect(result).toEqual(created);
    });

    it("returns 400 when path is missing", async () => {
      const event = { _body: { content: "stuff" } };
      const result = await handleCreateResource(event);

      expect(lastStatus).toBe(400);
      expect(result).toEqual({ error: "path is required" });
    });

    it("returns 400 when path is not a string", async () => {
      const event = { _body: { path: 123, content: "stuff" } };
      const result = await handleCreateResource(event);

      expect(lastStatus).toBe(400);
      expect(result).toEqual({ error: "path is required" });
    });

    it("returns existing resource when ifNotExists is set and resource exists", async () => {
      const existing = {
        id: "old-1",
        path: "doc.md",
        content: "old content",
      };
      mockResourceGetByPath.mockResolvedValue(existing);

      const event = {
        _body: {
          path: "doc.md",
          content: "new content",
          ifNotExists: true,
        },
      };
      const result = await handleCreateResource(event);

      expect(result).toEqual(existing);
      expect(mockResourcePut).not.toHaveBeenCalled();
    });

    it("creates shared resource when shared flag is set", async () => {
      mockResourcePut.mockResolvedValue({ id: "s1" });

      const event = {
        _body: { path: "shared.md", content: "", shared: true },
      };
      await handleCreateResource(event);

      expect(mockResourcePut).toHaveBeenCalledWith(
        "__shared__",
        "shared.md",
        "",
        undefined,
      );
    });

    it("rejects unauthenticated shared resource creation", async () => {
      vi.mocked(getSession).mockResolvedValue(null as any);

      const event = {
        _body: { path: "shared.md", content: "", shared: true },
      };

      await expect(handleCreateResource(event)).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(mockResourcePut).not.toHaveBeenCalled();
    });

    it("rejects shared resource creation for non-admin org members", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "QA Org",
        role: "member",
      });

      const event = {
        _body: { path: "shared.md", content: "", shared: true },
      };

      await expect(handleCreateResource(event)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(mockResourcePut).not.toHaveBeenCalled();
    });

    it("allows shared resource creation for org admins", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "QA Org",
        role: "admin",
      });
      mockResourcePut.mockResolvedValue({ id: "s2" });

      const event = {
        _body: { path: "shared.md", content: "", shared: true },
      };
      await handleCreateResource(event);

      expect(mockResourcePut).toHaveBeenCalledWith(
        "__organization__:org-1",
        "shared.md",
        "",
        undefined,
      );
    });
  });

  describe("handleUpdateResource", () => {
    it("updates resource content", async () => {
      const existing = {
        id: "r1",
        path: "doc.md",
        owner: "test@test.com",
        content: "old",
        mimeType: "text/markdown",
      };
      mockResourceGet.mockResolvedValue(existing);
      mockResourcePut.mockResolvedValue({ ...existing, content: "new" });

      const event = {
        _params: { id: "r1" },
        _body: { content: "new" },
        context: {},
      };
      await handleUpdateResource(event);

      expect(mockResourcePut).toHaveBeenCalledWith(
        "test@test.com",
        "doc.md",
        "new",
        "text/markdown",
      );
    });

    it("returns 400 when no ID provided", async () => {
      const event = {
        _params: {},
        _body: {},
        context: { params: {} },
      };
      const result = await handleUpdateResource(event);

      expect(lastStatus).toBe(400);
      expect(result).toEqual({ error: "Resource ID is required" });
    });

    it("returns 404 when resource not found", async () => {
      mockResourceGet.mockResolvedValue(null);

      const event = {
        _params: { id: "missing" },
        _body: {},
        context: {},
      };
      const result = await handleUpdateResource(event);

      expect(lastStatus).toBe(404);
      expect(result).toEqual({ error: "Resource not found" });
    });

    it("moves resource when path changes", async () => {
      const existing = {
        id: "r1",
        path: "old.md",
        owner: "test@test.com",
        content: "content",
        mimeType: "text/markdown",
      };
      mockResourceGet.mockResolvedValue(existing);
      mockResourceMove.mockResolvedValue(true);
      mockResourcePut.mockResolvedValue({ ...existing, path: "new.md" });

      const event = {
        _params: { id: "r1" },
        _body: { path: "new.md" },
        context: {},
      };
      await handleUpdateResource(event);

      expect(mockResourceMove).toHaveBeenCalledWith("r1", "new.md");
    });

    it("updates local workspace resources", async () => {
      const existing = {
        id: "local-workspace-resource:agents",
        path: "AGENTS.md",
        owner: "__workspace__",
        content: "old",
        mimeType: "text/markdown",
      };
      mockIsLocalWorkspaceResourceId.mockReturnValue(true);
      mockResourceGet.mockResolvedValue(existing);
      mockResourcePut.mockResolvedValue({ ...existing, content: "new" });

      const event = {
        _params: { id: "local-workspace-resource:agents" },
        _body: { content: "new" },
        context: {},
      };
      await handleUpdateResource(event);

      expect(mockResourcePut).toHaveBeenCalledWith(
        "__workspace__",
        "AGENTS.md",
        "new",
        "text/markdown",
      );
    });

    it("keeps Dispatch workspace resources read-only", async () => {
      mockResourceGet.mockResolvedValue({
        id: "dispatch-workspace-resource:brand",
        path: "context/brand.md",
        owner: "__workspace__",
        content: "old",
        mimeType: "text/markdown",
      });

      const event = {
        _params: { id: "dispatch-workspace-resource:brand" },
        _body: { content: "new" },
        context: {},
      };
      const result = await handleUpdateResource(event);

      expect(lastStatus).toBe(403);
      expect(result).toEqual({
        error: "Workspace resources are managed from Dispatch",
      });
      expect(mockResourcePut).not.toHaveBeenCalled();
    });

    it("returns 404 when updating another user's personal resource", async () => {
      mockResourceGet.mockResolvedValue({
        id: "r1",
        path: "private.md",
        owner: "other@test.com",
        content: "secret",
        mimeType: "text/markdown",
      });

      const event = {
        _params: { id: "r1" },
        _body: { content: "new" },
        context: {},
      };
      const result = await handleUpdateResource(event);

      expect(lastStatus).toBe(404);
      expect(result).toEqual({ error: "Resource not found" });
      expect(mockResourcePut).not.toHaveBeenCalled();
    });
  });

  describe("handleDeleteResource", () => {
    it("deletes resource and returns ok", async () => {
      mockResourceGet.mockResolvedValue({
        id: "r1",
        path: "doc.md",
        owner: "test@test.com",
      });
      mockResourceDelete.mockResolvedValue(true);

      const event = { _params: { id: "r1" }, context: {} };
      const result = await handleDeleteResource(event);

      expect(result).toEqual({ ok: true });
    });

    it("deletes local workspace resources", async () => {
      mockIsLocalWorkspaceResourceId.mockReturnValue(true);
      mockResourceGet.mockResolvedValue({
        id: "local-workspace-resource:agents",
        path: "AGENTS.md",
        owner: "__workspace__",
      });
      mockResourceDelete.mockResolvedValue(true);

      const event = {
        _params: { id: "local-workspace-resource:agents" },
        context: {},
      };
      const result = await handleDeleteResource(event);

      expect(result).toEqual({ ok: true });
      expect(mockResourceDelete).toHaveBeenCalledWith(
        "local-workspace-resource:agents",
      );
    });

    it("keeps Dispatch workspace resources delete-protected", async () => {
      mockResourceGet.mockResolvedValue({
        id: "dispatch-workspace-resource:brand",
        path: "context/brand.md",
        owner: "__workspace__",
      });

      const event = {
        _params: { id: "dispatch-workspace-resource:brand" },
        context: {},
      };
      const result = await handleDeleteResource(event);

      expect(lastStatus).toBe(403);
      expect(result).toEqual({
        error: "Workspace resources are managed from Dispatch",
      });
      expect(mockResourceDelete).not.toHaveBeenCalled();
    });

    it("returns 400 when no ID provided", async () => {
      const event = { _params: {}, context: { params: {} } };
      const result = await handleDeleteResource(event);

      expect(lastStatus).toBe(400);
      expect(result).toEqual({ error: "Resource ID is required" });
    });

    it("returns 404 when resource not found", async () => {
      mockResourceGet.mockResolvedValue(null);

      const event = { _params: { id: "missing" }, context: {} };
      const result = await handleDeleteResource(event);

      expect(lastStatus).toBe(404);
      expect(result).toEqual({ error: "Resource not found" });
    });

    it("returns 404 when deleting another user's personal resource", async () => {
      mockResourceGet.mockResolvedValue({
        id: "r1",
        path: "private.md",
        owner: "other@test.com",
      });

      const event = { _params: { id: "r1" }, context: {} };
      const result = await handleDeleteResource(event);

      expect(lastStatus).toBe(404);
      expect(result).toEqual({ error: "Resource not found" });
      expect(mockResourceDelete).not.toHaveBeenCalled();
    });
  });

  describe("handleUploadResource", () => {
    it("stores text uploads in SQL", async () => {
      const resource = {
        id: "doc",
        path: "/note.md",
        owner: "test@test.com",
        content: "# Note",
        mimeType: "text/markdown",
        size: 6,
      };
      mockResourcePut.mockResolvedValue(resource);

      const result = await handleUploadResource({
        _multipart: [
          {
            name: "file",
            filename: "note.md",
            type: "text/markdown",
            data: Buffer.from("# Note"),
          },
        ],
      });

      expect(lastStatus).toBe(201);
      expect(mockUploadFile).not.toHaveBeenCalled();
      expect(mockResourcePut).toHaveBeenCalledWith(
        "test@test.com",
        "/note.md",
        "# Note",
        "text/markdown",
      );
      expect(result).toEqual(resource);
    });

    it("rejects binary uploads when file storage is not configured", async () => {
      const result = await handleUploadResource({
        _multipart: [
          {
            name: "file",
            filename: "photo.png",
            type: "image/png",
            data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          },
        ],
      });

      expect(lastStatus).toBe(503);
      expect(result).toMatchObject({ storageSetupRequired: true });
      expect(mockUploadFile).toHaveBeenCalled();
      expect(mockResourcePut).not.toHaveBeenCalled();
    });

    it("stores binary uploads as provider URLs", async () => {
      mockUploadFile.mockResolvedValue({
        url: "https://cdn.example.test/photo.png",
        provider: "test",
      });
      const resource = {
        id: "img",
        path: "/photo.png",
        owner: "test@test.com",
        content: "https://cdn.example.test/photo.png",
        mimeType: "image/png",
        size: 34,
      };
      mockResourcePut.mockResolvedValue(resource);

      const result = await handleUploadResource({
        _multipart: [
          {
            name: "file",
            filename: "photo.png",
            type: "image/png",
            data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          },
        ],
      });

      expect(lastStatus).toBe(201);
      expect(mockResourcePut).toHaveBeenCalledWith(
        "test@test.com",
        "/photo.png",
        "https://cdn.example.test/photo.png",
        "image/png",
      );
      expect(result).toMatchObject({
        id: "img",
        url: "https://cdn.example.test/photo.png",
        provider: "test",
      });
    });

    it("rejects unauthenticated shared uploads", async () => {
      vi.mocked(getSession).mockResolvedValue(null as any);

      const event = {
        _multipart: [
          {
            name: "file",
            filename: "shared.md",
            type: "text/markdown",
            data: Buffer.from("# Shared"),
          },
          { name: "shared", data: Buffer.from("true") },
        ],
      };

      await expect(handleUploadResource(event)).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(mockResourcePut).not.toHaveBeenCalled();
    });
  });

  describe("handleGetResourceTree", () => {
    it("builds a nested tree from flat resources", async () => {
      mockResourceListAccessible.mockResolvedValue([
        { id: "1", path: "README.md", owner: "test@test.com" },
        { id: "2", path: "skills/learn.md", owner: "test@test.com" },
        { id: "3", path: "skills/review.md", owner: "test@test.com" },
        { id: "4", path: "docs/api/auth.md", owner: "test@test.com" },
      ]);

      const event = { _query: {} };
      const result = await handleGetResourceTree(event);

      expect(result.tree).toBeDefined();
      expect(result.tree).toHaveLength(3); // README.md, skills/, docs/

      // Find the skills folder
      const skills = result.tree.find((n: any) => n.name === "skills");
      expect(skills).toBeDefined();
      expect(skills.type).toBe("folder");
      expect(skills.children).toHaveLength(2);

      // Find the docs folder
      const docs = result.tree.find((n: any) => n.name === "docs");
      expect(docs).toBeDefined();
      expect(docs.type).toBe("folder");
      expect(docs.children).toHaveLength(1);

      // Nested api folder
      const api = docs.children[0];
      expect(api.name).toBe("api");
      expect(api.type).toBe("folder");
      expect(api.children).toHaveLength(1);
      expect(api.children[0].name).toBe("auth.md");
      expect(api.children[0].type).toBe("file");
    });

    it("returns empty tree for no resources", async () => {
      mockResourceListAccessible.mockResolvedValue([]);

      const event = { _query: {} };
      const result = await handleGetResourceTree(event);

      expect(result.tree).toEqual([]);
    });

    it("passes includeAgentScratch through to tree lists", async () => {
      mockResourceList.mockResolvedValue([]);

      const event = {
        _query: { scope: "personal", includeAgentScratch: "true" },
      };
      await handleGetResourceTree(event);

      expect(mockResourceList).toHaveBeenCalledWith(
        "test@test.com",
        undefined,
        { includeAgentScratch: true },
      );
    });

    it("creates file nodes with resource metadata", async () => {
      const meta = {
        id: "r1",
        path: "notes.md",
        owner: "test@test.com",
        mimeType: "text/markdown",
        size: 42,
      };
      mockResourceListAccessible.mockResolvedValue([meta]);

      const event = { _query: {} };
      const result = await handleGetResourceTree(event);

      const file = result.tree[0];
      expect(file.type).toBe("file");
      expect(file.resource).toEqual(meta);
    });
  });
});
