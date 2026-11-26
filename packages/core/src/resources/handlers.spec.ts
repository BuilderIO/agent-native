import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResourceGet = vi.fn();
const mockResourceGetByPath = vi.fn();
const mockResourcePut = vi.fn();
const mockResourcePutIfAbsent = vi.fn();
const mockResourcePutIfCurrent = vi.fn();
const mockResourcePutIfSnapshot = vi.fn();
const mockResourceDelete = vi.fn();
const mockResourceDeleteIfCurrent = vi.fn();
const mockResourceDeleteByPath = vi.fn();
const mockResourceList = vi.fn();
const mockResourceListAccessible = vi.fn();
const mockResourceListOrganization = vi.fn();
const mockResourceMove = vi.fn();
const mockResourceMoveIfCurrent = vi.fn();
const mockResourceStoredPathsTaken = vi.fn();
const mockIsSameLocalWorkspaceFile = vi.fn();
const mockResourceEffectiveContext = vi.fn();
const mockEnsurePersonalDefaults = vi.fn();
const mockCanWriteLocalWorkspaceResourcePath = vi.fn();
const mockIsLocalWorkspaceResourceId = vi.fn();
const mockIsLegacyOrganizationWorkspaceFile = vi.fn();
const mockUploadFile = vi.fn();
const mockCanUpdateAutomationResource = vi.fn();

vi.mock("./store.js", () => ({
  ResourcePathTakenError: class ResourcePathTakenError extends Error {},
  SHARED_OWNER: "__shared__",
  WORKSPACE_OWNER: "__workspace__",
  organizationIdFromResourceOwner: (owner: string) =>
    owner.startsWith("__organization__:")
      ? decodeURIComponent(owner.slice("__organization__:".length))
      : null,
  sharedResourceOwner: (orgId?: string | null) =>
    orgId ? `__organization__:${encodeURIComponent(orgId)}` : "__shared__",
  organizationIdFromWorkspaceResourceOwner: (owner: string) =>
    owner.startsWith("__workspace__:__organization__:")
      ? decodeURIComponent(
          owner.slice("__workspace__:__organization__:".length),
        )
      : null,
  isWorkspaceResourceOwner: (owner: string) =>
    owner === "__workspace__" || owner.startsWith("__workspace__:"),
  canWriteLocalWorkspaceResourcePath: (...args: any[]) =>
    mockCanWriteLocalWorkspaceResourcePath(...args),
  isLocalWorkspaceResourceId: (...args: any[]) =>
    mockIsLocalWorkspaceResourceId(...args),
  isSameLocalWorkspaceFile: (...args: unknown[]) =>
    mockIsSameLocalWorkspaceFile(...args),
  isLegacyOrganizationWorkspaceFile: (...args: any[]) =>
    mockIsLegacyOrganizationWorkspaceFile(...args),
  isLegacySharedResourceVisibleToOrganization: () => true,
  resourceGet: (...args: any[]) => mockResourceGet(...args),
  resourceGetByPath: (...args: any[]) => mockResourceGetByPath(...args),
  resourcePut: (...args: any[]) => mockResourcePut(...args),
  resourcePutIfAbsent: (...args: any[]) => mockResourcePutIfAbsent(...args),
  resourcePutIfCurrent: (...args: any[]) => mockResourcePutIfCurrent(...args),
  resourcePutIfSnapshot: (...args: unknown[]) =>
    mockResourcePutIfSnapshot(...args),
  resourceDelete: (...args: any[]) => mockResourceDelete(...args),
  resourceDeleteIfCurrent: (...args: any[]) =>
    mockResourceDeleteIfCurrent(...args),
  resourceDeleteByPath: (...args: any[]) => mockResourceDeleteByPath(...args),
  resourceList: (...args: any[]) => mockResourceList(...args),
  resourceListAccessible: (...args: any[]) =>
    mockResourceListAccessible(...args),
  resourceListOrganization: (...args: any[]) =>
    mockResourceListOrganization(...args),
  resourceMove: (...args: any[]) => mockResourceMove(...args),
  resourceMoveIfCurrent: (...args: unknown[]) =>
    mockResourceMoveIfCurrent(...args),
  resourceStoredPathsTaken: (...args: unknown[]) =>
    mockResourceStoredPathsTaken(...args),
  resourceStoredSpellings: async () => [],
  resourceEffectiveContext: (...args: any[]) =>
    mockResourceEffectiveContext(...args),
  ensurePersonalDefaults: (...args: any[]) =>
    mockEnsurePersonalDefaults(...args),
}));

vi.mock("../server/auth.js", () => ({
  getSession: vi.fn().mockResolvedValue({ email: "test@test.com" }),
}));

vi.mock("../automations/service.js", () => ({
  canUpdateAutomationResource: (...args: any[]) =>
    mockCanUpdateAutomationResource(...args),
}));

const mockGetOrgContext = vi.fn().mockResolvedValue({
  email: "test@test.com",
  orgId: null,
  orgName: null,
  role: null,
});

const orglessAdminRef = vi.hoisted(() => ({ value: true }));
vi.mock("../org/orgless-access.js", () => ({
  canManageDeploymentWithoutOrg: () => orglessAdminRef.value,
}));

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
  getHeader: (event: any, name: string) => {
    const headers = event?._headers ?? {};
    const target = String(name).toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === target) return value;
    }
    return undefined;
  },
  setResponseHeader: vi.fn(),
  getMethod: (event: any) => event._method || "GET",
  readMultipartFormData: (event: any) =>
    Promise.resolve(event._multipart || null),
}));

const mockExportResourcePackRun = vi.fn();
const mockImportResourcePackRun = vi.fn();

vi.mock("./actions/export-resource-pack.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./actions/export-resource-pack.js")>();
  return {
    ...actual,
    default: { run: (...args: any[]) => mockExportResourcePackRun(...args) },
  };
});

vi.mock("./actions/import-resource-pack.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./actions/import-resource-pack.js")>();
  return {
    ...actual,
    default: { run: (...args: any[]) => mockImportResourcePackRun(...args) },
  };
});

import { saveRevisionOf } from "../save-conflict/index.js";
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
  handleExportResourcePack,
  handleImportResourcePack,
} from "./handlers.js";

/** Makes the exact stored-path check report these paths as taken. */
function holdPaths(...held: string[]) {
  mockResourceStoredPathsTaken.mockImplementation(
    async (_owner: string, paths: string[]) =>
      new Set(paths.filter((path) => held.includes(path))),
  );
}

/** A resource as the routes send it, with the revision of its content. */
function withRevision<R extends { content: string }>(resource: R) {
  return {
    ...resource,
    revision: saveRevisionOf({ content: resource.content }),
  };
}

function localSkill(name: string) {
  return {
    id: `local-workspace-resource:skills/${name}/SKILL.md`,
    path: `skills/${name}/SKILL.md`,
    owner: "__workspace__",
    content: name,
    mimeType: "text/markdown",
  };
}

describe("resource handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastStatus = 200;
    mockEnsurePersonalDefaults.mockResolvedValue(undefined);
    mockResourceGet.mockResolvedValue(null);
    mockResourceGetByPath.mockReset().mockResolvedValue(null);
    mockResourceStoredPathsTaken.mockReset().mockResolvedValue(new Set());
    mockIsSameLocalWorkspaceFile.mockReset().mockResolvedValue(false);
    mockResourcePutIfAbsent.mockResolvedValue(null);
    mockResourcePutIfCurrent.mockReset().mockResolvedValue(null);
    mockResourcePutIfSnapshot.mockReset().mockResolvedValue(null);
    mockResourceDeleteIfCurrent.mockResolvedValue(true);
    mockResourceMoveIfCurrent.mockReset();
    mockCanWriteLocalWorkspaceResourcePath.mockResolvedValue(false);
    mockIsLocalWorkspaceResourceId.mockReturnValue(false);
    mockIsLegacyOrganizationWorkspaceFile.mockReturnValue(false);
    mockUploadFile.mockResolvedValue(null);
    mockCanUpdateAutomationResource.mockResolvedValue(false);
    mockExportResourcePackRun.mockReset();
    mockImportResourcePackRun.mockReset();
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

      expect(mockResourceListOrganization).toHaveBeenCalledWith(
        null,
        undefined,
        undefined,
      );
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

      expect(result).toEqual(withRevision(resource));
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

      expect(result).toEqual(withRevision(resource));
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

      expect(result.content).toBe("");
      expect(result.id).toBe("img1");
      expect(result.mimeType).toBe("image/jpeg");
      expect(result).not.toHaveProperty("revision");
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
      expect(setResponseHeader).toHaveBeenCalledWith(
        event,
        "Cache-Control",
        "private, no-store",
      );
      expect(setResponseHeader).toHaveBeenCalledWith(
        event,
        "X-Content-Type-Options",
        "nosniff",
      );
      expect(result).toBeInstanceOf(Response);
    });

    it("serves a raw HTML resource as a sandboxed document", async () => {
      const { setResponseHeader } = await import("h3");
      mockResourceGet.mockResolvedValue({
        id: "r-html",
        path: "page.html",
        owner: "test@test.com",
        content: "<script>window.ran = 1</script>",
        mimeType: "text/html",
        size: 36,
        createdAt: 1000,
        updatedAt: 2000,
      });
      const event = {
        _params: { id: "r-html" },
        _query: { raw: "" },
        context: {},
      };

      await handleGetResource(event);

      const csp = vi
        .mocked(setResponseHeader)
        .mock.calls.find(
          ([target, name]) =>
            target === event && name === "Content-Security-Policy",
        )?.[2];
      expect(String(csp).split(";")[0]).toBe("sandbox");
      expect(String(csp)).toContain("default-src 'none'");
    });

    it("does not expose legacy webhook tokens to read-only members", async () => {
      mockResourceGet.mockResolvedValue({
        id: "legacy-webhook",
        path: "jobs/legacy-webhook.md",
        owner: "__shared__",
        content: `---
triggerType: webhook
webhookToken: ${"a".repeat(43)}
---

Legacy webhook.`,
        mimeType: "text/markdown",
      });

      const result = await handleGetResource({
        _params: { id: "legacy-webhook" },
        _query: {},
        context: {},
      });

      expect(lastStatus).toBe(404);
      expect(result).toEqual({ error: "Resource not found" });
      expect(mockCanUpdateAutomationResource).toHaveBeenCalled();
    });

    it("downloads empty content with a sanitized attachment filename", async () => {
      const { setResponseHeader } = await import("h3");

      mockResourceGet.mockResolvedValue({
        id: "r1",
        path: 'exports/quarterly\n"résumé".csv',
        owner: "test@test.com",
        content: "",
        mimeType: "text/csv",
        size: 0,
        createdAt: 1000,
        updatedAt: 2000,
      });

      const event = {
        _params: { id: "r1" },
        _query: { download: "1" },
        context: {},
      };

      const result = await handleGetResource(event);

      expect(setResponseHeader).toHaveBeenCalledWith(
        event,
        "Content-Disposition",
        "attachment; filename=\"quarterly__r_sum__.csv\"; filename*=UTF-8''quarterly_%22r%C3%A9sum%C3%A9%22.csv",
      );
      expect(setResponseHeader).toHaveBeenCalledWith(
        event,
        "Content-Length",
        "0",
      );
      expect(setResponseHeader).toHaveBeenCalledWith(
        event,
        "Cache-Control",
        "private, no-store",
      );
      expect(setResponseHeader).toHaveBeenCalledWith(
        event,
        "X-Content-Type-Options",
        "nosniff",
      );
      expect(result).toBeInstanceOf(Response);
      await expect((result as Response).text()).resolves.toBe("");
    });

    it("does not treat other download values as raw resource requests", async () => {
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
        _query: { download: "0" },
        context: {},
      };

      await expect(handleGetResource(event)).resolves.toEqual(
        withRevision(resource),
      );
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
      expect(result).toEqual(withRevision(created));
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

      expect(result).toEqual(withRevision(existing));
      expect(mockResourcePut).not.toHaveBeenCalled();
    });

    it("creates with ifNotExists only where no file is", async () => {
      const created = {
        id: "new-1",
        path: "AGENTS.md",
        owner: "test@test.com",
        content: "mine",
      };
      mockResourcePutIfAbsent.mockResolvedValueOnce(created);

      const result = await handleCreateResource({
        _body: {
          path: "AGENTS.md",
          content: "mine",
          mimeType: "text/markdown",
          ifNotExists: true,
        },
      });

      expect(lastStatus).toBe(201);
      expect(result).toEqual(withRevision(created));
      expect(mockResourcePutIfAbsent).toHaveBeenCalledExactlyOnceWith(
        "test@test.com",
        "AGENTS.md",
        "mine",
        "text/markdown",
        undefined,
      );
      expect(mockResourcePut).not.toHaveBeenCalled();
    });

    it("returns the other create's file when two ifNotExists creates race", async () => {
      const theirs = {
        id: "theirs",
        path: "AGENTS.md",
        owner: "test@test.com",
        content: "theirs",
      };
      mockResourceGetByPath
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(theirs);

      const result = await handleCreateResource({
        _body: { path: "AGENTS.md", content: "mine", ifNotExists: true },
      });

      expect(lastStatus).toBe(200);
      expect(result).toEqual(withRevision(theirs));
      expect(mockResourcePut).not.toHaveBeenCalled();
    });

    it("returns an organization's shared file from before organizations instead of copying over it", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "QA Org",
        role: "owner",
      });
      const legacy = {
        id: "legacy-agents",
        path: "AGENTS.md",
        owner: "__shared__",
        content: "the team's instructions",
      };
      mockResourceGetByPath.mockImplementation(async (owner, path, options) =>
        owner === "__shared__" &&
        path === "AGENTS.md" &&
        options?.orgId === "org-1"
          ? legacy
          : null,
      );

      const result = await handleCreateResource({
        _body: {
          path: "AGENTS.md",
          content: "default instructions",
          shared: true,
          ifNotExists: true,
        },
      });

      expect(result).toEqual(withRevision(legacy));
      expect(mockResourcePutIfAbsent).not.toHaveBeenCalled();
      expect(mockResourcePut).not.toHaveBeenCalled();
    });

    it("refuses an ifNotExists create when the file keeps appearing and going", async () => {
      const result = await handleCreateResource({
        _body: { path: "AGENTS.md", content: "mine", ifNotExists: true },
      });

      expect(lastStatus).toBe(409);
      expect(result).toEqual({
        error: "The file kept changing while it was created",
      });
      expect(mockResourcePutIfAbsent).toHaveBeenCalledTimes(3);
      expect(mockResourcePut).not.toHaveBeenCalled();
    });

    it("creates an uploaded skill at the next path when the requested one exists", async () => {
      mockResourceGetByPath.mockResolvedValue({
        id: "existing-skill",
        content: "---\nname: different-skill\n---\nDifferent skill",
        updatedAt: 1000,
      });
      const created = {
        id: "new-skill",
        path: "skills/review-feedback-2/SKILL.md",
        owner: "test@test.com",
        content: "new content",
      };
      mockResourcePutIfAbsent
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(created);

      const result = await handleCreateResource({
        _body: {
          path: "skills/review-feedback/SKILL.md",
          content: "new content",
          mimeType: "text/markdown",
          uniqueSkillPath: true,
        },
      });

      expect(lastStatus).toBe(201);
      expect(result).toEqual(withRevision(created));
      expect(mockResourcePutIfAbsent).toHaveBeenNthCalledWith(
        1,
        "test@test.com",
        "skills/review-feedback/SKILL.md",
        "new content",
        "text/markdown",
        undefined,
      );
      expect(mockResourcePutIfAbsent).toHaveBeenNthCalledWith(
        2,
        "test@test.com",
        "skills/review-feedback-2/SKILL.md",
        "new content",
        "text/markdown",
        undefined,
      );
    });

    it("updates an existing uploaded skill when its declared name matches", async () => {
      const existing = {
        id: "existing-skill",
        owner: "test@test.com",
        path: "skills/review-feedback/SKILL.md",
        content: "---\nname: review-feedback\n---\nOld",
        updatedAt: 123,
      };
      const updated = {
        ...existing,
        content: "---\nname: review-feedback\n---\nNew",
      };
      mockResourceGetByPath.mockResolvedValue(existing);
      mockResourcePutIfCurrent.mockResolvedValue(updated);

      const result = await handleCreateResource({
        _body: {
          path: existing.path,
          content: updated.content,
          mimeType: "text/markdown",
          uniqueSkillPath: true,
        },
      });

      expect(lastStatus).toBe(200);
      expect(result).toEqual(withRevision(updated));
      expect(mockResourcePutIfCurrent).toHaveBeenCalledExactlyOnceWith({
        owner: "test@test.com",
        path: existing.path,
        content: updated.content,
        expectedId: existing.id,
        expectedUpdatedAt: existing.updatedAt,
        expectedContent: existing.content,
        mimeType: "text/markdown",
      });
      expect(mockResourcePutIfAbsent).toHaveBeenCalledExactlyOnceWith(
        "test@test.com",
        existing.path,
        updated.content,
        "text/markdown",
        undefined,
      );
    });

    it("updates a name-less uploaded skill using its path-derived name", async () => {
      const existing = {
        id: "existing-skill",
        owner: "test@test.com",
        path: "skills/uploaded-skill/SKILL.md",
        content: "# Old uploaded skill",
        updatedAt: 123,
      };
      const updated = { ...existing, content: "# New uploaded skill" };
      mockResourceGetByPath.mockResolvedValue(existing);
      mockResourcePutIfCurrent.mockResolvedValue(updated);

      const result = await handleCreateResource({
        _body: {
          path: existing.path,
          content: updated.content,
          mimeType: "text/markdown",
          uniqueSkillPath: true,
        },
      });

      expect(lastStatus).toBe(200);
      expect(result).toEqual(withRevision(updated));
      expect(mockResourcePutIfCurrent).toHaveBeenCalledExactlyOnceWith({
        owner: "test@test.com",
        path: existing.path,
        content: updated.content,
        expectedId: existing.id,
        expectedUpdatedAt: existing.updatedAt,
        expectedContent: existing.content,
        mimeType: "text/markdown",
      });
    });

    it("preserves an explicitly named skill on a name-less path collision", async () => {
      const existing = {
        id: "existing-skill",
        owner: "test@test.com",
        path: "skills/create-skill/SKILL.md",
        content: "---\nname: create-skill\n---\nExisting named skill",
        updatedAt: 123,
      };
      const created = {
        id: "new-skill",
        owner: "test@test.com",
        path: "skills/create-skill-2/SKILL.md",
        content: "# New nameless skill",
      };
      mockResourceGetByPath.mockResolvedValue(existing);
      mockResourcePutIfAbsent
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(created);

      const result = await handleCreateResource({
        _body: {
          path: "skills/create-skill/SKILL.md",
          content: created.content,
          mimeType: "text/markdown",
          uniqueSkillPath: true,
        },
      });

      expect(lastStatus).toBe(201);
      expect(result).toEqual(withRevision(created));
      expect(mockResourcePutIfCurrent).not.toHaveBeenCalled();
      expect(mockResourcePutIfAbsent).toHaveBeenNthCalledWith(
        2,
        "test@test.com",
        created.path,
        created.content,
        "text/markdown",
        undefined,
      );
    });

    it("preserves a name-less skill on a declared-name path collision", async () => {
      const existing = {
        id: "existing-skill",
        owner: "test@test.com",
        path: "skills/create-skill/SKILL.md",
        content: "# Existing name-less skill",
        updatedAt: 123,
      };
      const content = "---\nname: create-skill\n---\nNew named skill";
      const created = {
        id: "new-skill",
        owner: "test@test.com",
        path: "skills/create-skill-2/SKILL.md",
        content,
      };
      mockResourceGetByPath.mockResolvedValue(existing);
      mockResourcePutIfAbsent
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(created);

      const result = await handleCreateResource({
        _body: {
          path: existing.path,
          content,
          mimeType: "text/markdown",
          uniqueSkillPath: true,
        },
      });

      expect(lastStatus).toBe(201);
      expect(result).toEqual(withRevision(created));
      expect(mockResourcePutIfCurrent).not.toHaveBeenCalled();
      expect(mockResourcePutIfAbsent).toHaveBeenNthCalledWith(
        2,
        "test@test.com",
        created.path,
        content,
        "text/markdown",
        undefined,
      );
    });

    it("retries a same-name upload after a concurrent update wins", async () => {
      const existing = {
        id: "existing-skill",
        owner: "test@test.com",
        path: "skills/review-feedback/SKILL.md",
        content: "---\nname: review-feedback\n---\nOld",
        updatedAt: 123,
      };
      const concurrentlyUpdated = {
        ...existing,
        content: "---\nname: review-feedback\n---\nIntervening",
        updatedAt: 124,
      };
      const updated = {
        ...existing,
        content: "---\nname: review-feedback\n---\nNew",
      };
      mockResourcePutIfAbsent.mockResolvedValue(null);
      mockResourceGetByPath
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(concurrentlyUpdated);
      mockResourcePutIfCurrent
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(updated);

      const result = await handleCreateResource({
        _body: {
          path: existing.path,
          content: updated.content,
          mimeType: "text/markdown",
          uniqueSkillPath: true,
        },
      });

      expect(lastStatus).toBe(200);
      expect(result).toEqual(withRevision(updated));
      expect(mockResourcePutIfAbsent).toHaveBeenCalledTimes(2);
      expect(mockResourcePutIfCurrent).toHaveBeenCalledTimes(2);
      expect(mockResourcePutIfCurrent).toHaveBeenLastCalledWith({
        owner: "test@test.com",
        path: existing.path,
        content: updated.content,
        expectedId: existing.id,
        expectedUpdatedAt: concurrentlyUpdated.updatedAt,
        expectedContent: concurrentlyUpdated.content,
        mimeType: "text/markdown",
      });
    });

    it("preserves upload metadata when updating an existing named skill", async () => {
      const existing = {
        id: "existing-skill",
        owner: "test@test.com",
        path: "skills/review-feedback/SKILL.md",
        content: "---\nname: review-feedback\n---\nOld",
        updatedAt: 123,
      };
      const updated = {
        ...existing,
        content: "---\nname: review-feedback\n---\nNew",
      };
      const metadata = { source: "upload" };
      mockResourceGetByPath.mockResolvedValue(existing);
      mockResourcePutIfCurrent.mockResolvedValue(updated);

      await handleCreateResource({
        _body: {
          path: existing.path,
          content: updated.content,
          metadata,
          uniqueSkillPath: true,
        },
      });

      expect(mockResourcePutIfCurrent).toHaveBeenCalledWith(
        expect.objectContaining({ metadata }),
      );
    });

    it("keeps different declared names at the same slug in separate paths", async () => {
      const existing = {
        id: "existing-skill",
        owner: "test@test.com",
        path: "skills/release-notes/SKILL.md",
        content: "---\nname: release-notes\n---\nExisting",
      };
      const created = {
        id: "new-skill",
        owner: "test@test.com",
        path: "skills/release-notes-2/SKILL.md",
        content: "---\nname: Release Notes\n---\nNew",
      };
      mockResourceGetByPath.mockResolvedValue(existing);
      mockResourcePutIfAbsent
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(created);

      const result = await handleCreateResource({
        _body: {
          path: "skills/release-notes/SKILL.md",
          content: created.content,
          mimeType: "text/markdown",
          uniqueSkillPath: true,
        },
      });

      expect(lastStatus).toBe(201);
      expect(result).toEqual(withRevision(created));
      expect(mockResourcePutIfCurrent).not.toHaveBeenCalled();
      expect(mockResourcePutIfAbsent).toHaveBeenNthCalledWith(
        2,
        "test@test.com",
        created.path,
        created.content,
        "text/markdown",
        undefined,
      );
    });

    it.each(["skills/review-feedback.md", "skills/Review-feedback/SKILL.md"])(
      "rejects a non-canonical unique skill path: %s",
      async (path) => {
        const result = await handleCreateResource({
          _body: { path, content: "new content", uniqueSkillPath: true },
        });

        expect(lastStatus).toBe(400);
        expect(result).toEqual({
          error: "uniqueSkillPath requires skills/<name>/SKILL.md",
        });
        expect(mockResourcePutIfAbsent).not.toHaveBeenCalled();
      },
    );

    it("avoids shadowing a legacy shared skill during organization upload", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "QA Org",
        role: "owner",
      });
      mockResourceGetByPath.mockImplementation(async (owner, path, options) =>
        owner === "__shared__" &&
        path === "skills/review-feedback/SKILL.md" &&
        options?.orgId === "org-1"
          ? { id: "legacy-skill" }
          : null,
      );
      const created = {
        id: "new-skill",
        path: "skills/review-feedback-2/SKILL.md",
        owner: "__organization__:org-1",
        content: "new content",
      };
      mockResourcePutIfAbsent.mockResolvedValueOnce(created);

      const result = await handleCreateResource({
        _body: {
          path: "skills/review-feedback/SKILL.md",
          content: "new content",
          mimeType: "text/markdown",
          shared: true,
          uniqueSkillPath: true,
        },
      });

      expect(lastStatus).toBe(201);
      expect(result).toEqual(withRevision(created));
      expect(mockResourceGetByPath).toHaveBeenNthCalledWith(
        1,
        "__shared__",
        "skills/review-feedback/SKILL.md",
        { orgId: "org-1" },
      );
      expect(mockResourcePutIfAbsent).toHaveBeenCalledExactlyOnceWith(
        "__organization__:org-1",
        "skills/review-feedback-2/SKILL.md",
        "new content",
        "text/markdown",
        undefined,
      );
    });

    it("updates an existing organization skill when a legacy shared path collides", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "QA Org",
        role: "owner",
      });
      const path = "skills/review-feedback/SKILL.md";
      const legacy = {
        id: "legacy-skill",
        owner: "__shared__",
        path,
        content: "---\nname: review-feedback\n---\nLegacy",
        updatedAt: 1000,
      };
      const existing = {
        id: "org-skill",
        owner: "__organization__:org-1",
        path,
        content: "---\nname: review-feedback\n---\nOld org version",
        updatedAt: 1000,
      };
      const updated = {
        ...existing,
        content: "---\nname: review-feedback\n---\nNew org version",
      };
      mockResourceGetByPath
        .mockResolvedValueOnce(legacy)
        .mockResolvedValue(existing);
      mockResourcePutIfCurrent.mockResolvedValue(updated);

      const result = await handleCreateResource({
        _body: {
          path,
          content: updated.content,
          mimeType: "text/markdown",
          shared: true,
          uniqueSkillPath: true,
        },
      });

      expect(lastStatus).toBe(200);
      expect(result).toEqual(withRevision(updated));
      expect(mockResourcePutIfAbsent).not.toHaveBeenCalled();
      expect(mockResourcePutIfCurrent).toHaveBeenCalledExactlyOnceWith({
        owner: "__organization__:org-1",
        path,
        content: updated.content,
        expectedId: existing.id,
        expectedUpdatedAt: existing.updatedAt,
        expectedContent: existing.content,
        mimeType: "text/markdown",
      });
    });

    it("skips personal skill paths with a different name for organization uploads", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "QA Org",
        role: "owner",
      });
      const requestedPath = "skills/release-notes/SKILL.md";
      const personalByPath = new Map([
        [
          requestedPath,
          {
            id: "personal-release-notes",
            owner: "test@test.com",
            path: requestedPath,
            content: "---\nname: Release Notes Archive\n---\nPersonal",
          },
        ],
        [
          "skills/release-notes-2/SKILL.md",
          {
            id: "personal-other-release-notes",
            owner: "test@test.com",
            path: "skills/release-notes-2/SKILL.md",
            content: "---\nname: Other Release Notes\n---\nPersonal",
          },
        ],
      ]);
      mockResourceGetByPath.mockImplementation(async (owner, path, options) => {
        if (owner === "__shared__") return null;
        if (owner === "test@test.com") return personalByPath.get(path) ?? null;
        if (
          owner === "__organization__:org-1" &&
          path === requestedPath &&
          options?.orgId === "org-1"
        ) {
          return {
            id: "hidden-organization-skill",
            owner,
            path,
            content: "---\nname: Release Notes\n---\nOld org skill",
            updatedAt: 1000,
          };
        }
        return null;
      });
      const content = "---\nname: Release Notes\n---\nNew org skill";
      const created = {
        id: "organization-release-notes",
        owner: "__organization__:org-1",
        path: "skills/release-notes-3/SKILL.md",
        content,
      };
      mockResourcePutIfAbsent.mockResolvedValueOnce(created);

      const result = await handleCreateResource({
        _body: {
          path: requestedPath,
          content,
          mimeType: "text/markdown",
          shared: true,
          uniqueSkillPath: true,
        },
      });

      expect(lastStatus).toBe(201);
      expect(result).toEqual(withRevision(created));
      expect(mockResourceGetByPath).toHaveBeenCalledWith(
        "test@test.com",
        requestedPath,
        { orgId: "org-1" },
      );
      expect(mockResourceGetByPath).toHaveBeenCalledWith(
        "test@test.com",
        "skills/release-notes-2/SKILL.md",
        { orgId: "org-1" },
      );
      expect(mockResourcePutIfAbsent).toHaveBeenCalledExactlyOnceWith(
        "__organization__:org-1",
        created.path,
        content,
        "text/markdown",
        undefined,
      );
      expect(mockResourcePutIfCurrent).not.toHaveBeenCalled();
    });

    it("keeps the canonical path when a personal skill has the same name", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "QA Org",
        role: "owner",
      });
      const path = "skills/release-notes/SKILL.md";
      mockResourceGetByPath.mockImplementation(async (owner, candidatePath) =>
        owner === "test@test.com" && candidatePath === path
          ? {
              id: "personal-release-notes",
              owner,
              path,
              content: "---\nname: Release Notes\n---\nPersonal",
            }
          : null,
      );
      const content = "---\nname: Release Notes\n---\nOrganization";
      const created = {
        id: "organization-release-notes",
        owner: "__organization__:org-1",
        path,
        content,
      };
      mockResourcePutIfAbsent.mockResolvedValueOnce(created);

      await handleCreateResource({
        _body: {
          path,
          content,
          shared: true,
          uniqueSkillPath: true,
        },
      });

      expect(mockResourcePutIfAbsent).toHaveBeenCalledExactlyOnceWith(
        "__organization__:org-1",
        path,
        content,
        undefined,
        undefined,
      );
    });

    it("does not shadow a named personal skill with a path-derived organization upload", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "QA Org",
        role: "owner",
      });
      const path = "skills/create-skill/SKILL.md";
      const personal = {
        id: "personal-create-skill",
        owner: "test@test.com",
        path,
        content: "---\nname: create-skill\n---\nPersonal skill",
      };
      mockResourceGetByPath.mockImplementation(async (owner, candidatePath) =>
        owner === "test@test.com" && candidatePath === path ? personal : null,
      );
      const content = "# Organization skill without a declared name";
      const created = {
        id: "organization-create-skill",
        owner: "__organization__:org-1",
        path: "skills/create-skill-2/SKILL.md",
        content,
      };
      mockResourcePutIfAbsent.mockResolvedValueOnce(created);

      const result = await handleCreateResource({
        _body: {
          path,
          content,
          shared: true,
          uniqueSkillPath: true,
        },
      });

      expect(lastStatus).toBe(201);
      expect(result).toEqual(withRevision(created));
      expect(mockResourcePutIfAbsent).toHaveBeenCalledExactlyOnceWith(
        "__organization__:org-1",
        created.path,
        content,
        undefined,
        undefined,
      );
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

    it("rejects shared resource creation without an organization unless the caller manages the deployment", async () => {
      orglessAdminRef.value = false;
      try {
        const event = {
          _body: { path: "AGENTS.md", content: "x", shared: true },
        };

        await expect(handleCreateResource(event)).rejects.toMatchObject({
          statusCode: 403,
        });
        expect(mockResourcePut).not.toHaveBeenCalled();
      } finally {
        orglessAdminRef.value = true;
      }
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

    describe("with the revision the content was edited from", () => {
      const doc = {
        id: "r1",
        path: "doc.md",
        owner: "test@test.com",
        content: "old",
        mimeType: "text/markdown",
        updatedAt: 1000,
      };

      it("writes only over the version it read and returns the new revision", async () => {
        mockResourceGet.mockResolvedValue(doc);
        const written = { ...doc, content: "new", updatedAt: 2000 };
        mockResourcePutIfSnapshot.mockResolvedValue({
          before: doc,
          resource: written,
        });

        const result = await handleUpdateResource({
          _params: { id: "r1" },
          _body: {
            content: "new",
            expectedRevision: withRevision(doc).revision,
          },
          context: {},
        });

        expect(result).toEqual(withRevision(written));
        expect(mockResourcePutIfSnapshot).toHaveBeenCalledWith({
          previous: doc,
          owner: "test@test.com",
          path: "doc.md",
          content: "new",
          mimeType: "text/markdown",
        });
        expect(mockResourcePut).not.toHaveBeenCalled();
      });

      it("refuses content saved over someone else's newer save, with what's there now", async () => {
        mockResourceGet.mockResolvedValue({ ...doc, content: "theirs" });

        const result = await handleUpdateResource({
          _params: { id: "r1" },
          _body: {
            content: "mine",
            expectedRevision: withRevision(doc).revision,
          },
          context: {},
        });

        expect(lastStatus).toBe(409);
        expect(result).toMatchObject({
          errorCode: "save_conflict",
          details: {
            current: { content: "theirs" },
            currentRevision: withRevision({ content: "theirs" }).revision,
          },
        });
        expect(mockResourceMove).not.toHaveBeenCalled();
        expect(mockResourcePutIfSnapshot).not.toHaveBeenCalled();
        expect(mockResourcePut).not.toHaveBeenCalled();
      });

      it("refuses a checked content save that also renames", async () => {
        mockResourceGet.mockResolvedValue(doc);

        const result = await handleUpdateResource({
          _params: { id: "r1" },
          _body: {
            content: "mine",
            path: "renamed.md",
            expectedRevision: withRevision(doc).revision,
          },
          context: {},
        });

        expect(lastStatus).toBe(400);
        expect(result).toMatchObject({ error: expect.any(String) });
        expect(mockResourceMove).not.toHaveBeenCalled();
        expect(mockResourcePutIfSnapshot).not.toHaveBeenCalled();
        expect(mockResourcePut).not.toHaveBeenCalled();
      });

      it("catches a save that lands between its check and its write", async () => {
        mockResourceGet
          .mockResolvedValueOnce(doc)
          .mockResolvedValueOnce(doc)
          .mockResolvedValue({ ...doc, content: "theirs", updatedAt: 1500 });
        mockResourcePutIfSnapshot.mockResolvedValue(null);

        const result = await handleUpdateResource({
          _params: { id: "r1" },
          _body: {
            content: "mine",
            expectedRevision: withRevision(doc).revision,
          },
          context: {},
        });

        expect(lastStatus).toBe(409);
        expect(result).toMatchObject({
          errorCode: "save_conflict",
          details: { current: { content: "theirs" } },
        });
        expect(mockResourcePutIfSnapshot).toHaveBeenCalledTimes(1);
        expect(mockResourcePut).not.toHaveBeenCalled();
      });

      it("treats a repeat of a save that already landed as done", async () => {
        const saved = { ...doc, content: "new", updatedAt: 2000 };
        mockResourceGet.mockResolvedValue(saved);

        const result = await handleUpdateResource({
          _params: { id: "r1" },
          _body: {
            content: "new",
            expectedRevision: withRevision(doc).revision,
          },
          context: {},
        });

        expect(lastStatus).toBe(200);
        expect(result).toEqual(withRevision(saved));
        expect(mockResourcePutIfSnapshot).not.toHaveBeenCalled();
        expect(mockResourcePut).not.toHaveBeenCalled();
      });

      it("treats a repeat that names the same type as done", async () => {
        const saved = { ...doc, content: "new", updatedAt: 2000 };
        mockResourceGet.mockResolvedValue(saved);

        const result = await handleUpdateResource({
          _params: { id: "r1" },
          _body: {
            content: "new",
            mimeType: "text/markdown",
            expectedRevision: withRevision(doc).revision,
          },
          context: {},
        });

        expect(lastStatus).toBe(200);
        expect(result).toEqual(withRevision(saved));
        expect(mockResourcePutIfSnapshot).not.toHaveBeenCalled();
      });

      it("treats a repeat that sends the same metadata as done", async () => {
        const saved = {
          ...doc,
          content: "new",
          metadata: '{"pinned":true}',
          updatedAt: 2000,
        };
        mockResourceGet.mockResolvedValue(saved);

        const result = await handleUpdateResource({
          _params: { id: "r1" },
          _body: {
            content: "new",
            metadata: { pinned: true },
            expectedRevision: withRevision(doc).revision,
          },
          context: {},
        });

        expect(lastStatus).toBe(200);
        expect(result).toEqual(withRevision(saved));
        expect(mockResourcePutIfSnapshot).not.toHaveBeenCalled();
      });

      it("refuses a repeat whose metadata isn't what's there", async () => {
        mockResourceGet.mockResolvedValue({
          ...doc,
          content: "new",
          metadata: '{"pinned":false}',
          updatedAt: 2000,
        });

        const result = await handleUpdateResource({
          _params: { id: "r1" },
          _body: {
            content: "new",
            metadata: { pinned: true },
            expectedRevision: withRevision(doc).revision,
          },
          context: {},
        });

        expect(lastStatus).toBe(409);
        expect(result).toMatchObject({ errorCode: "save_conflict" });
        expect(mockResourcePutIfSnapshot).not.toHaveBeenCalled();
      });

      it("treats a repeat with empty metadata and MIME type as done", async () => {
        const saved = {
          ...doc,
          content: "new",
          metadata: null,
          updatedAt: 2000,
        };
        mockResourceGet.mockResolvedValue(saved);

        const result = await handleUpdateResource({
          _params: { id: "r1" },
          _body: {
            content: "new",
            mimeType: "",
            metadata: "",
            expectedRevision: withRevision(doc).revision,
          },
          context: {},
        });

        expect(lastStatus).toBe(200);
        expect(result).toEqual(withRevision(saved));
        expect(mockResourcePutIfSnapshot).not.toHaveBeenCalled();
      });

      it("treats the same save landing between its check and its write as done", async () => {
        const saved = { ...doc, content: "new", updatedAt: 2000 };
        mockResourceGet.mockResolvedValueOnce(doc).mockResolvedValue(saved);

        const result = await handleUpdateResource({
          _params: { id: "r1" },
          _body: {
            content: "new",
            mimeType: "text/markdown",
            expectedRevision: withRevision(doc).revision,
          },
          context: {},
        });

        expect(lastStatus).toBe(200);
        expect(result).toEqual(withRevision(saved));
        expect(mockResourcePutIfSnapshot).not.toHaveBeenCalled();
      });

      describe("on a shared resource copied into the organization", () => {
        const shared = { ...doc, id: "s1", owner: "__shared__" };
        const copy = {
          ...doc,
          id: "copy",
          owner: "__organization__:org-1",
          content: "mine",
        };

        beforeEach(() => {
          mockGetOrgContext.mockResolvedValue({
            email: "test@test.com",
            orgId: "org-1",
            orgName: "QA Org",
            role: "admin",
          });
          mockResourcePutIfAbsent.mockResolvedValue(copy);
        });

        const save = () =>
          handleUpdateResource({
            _params: { id: "s1" },
            _body: {
              content: "mine",
              expectedRevision: withRevision(shared).revision,
            },
            context: {},
          });

        it("keeps the copy when the shared version is still the one read", async () => {
          mockResourceGet.mockResolvedValue(shared);

          const result = await save();

          expect(lastStatus).toBe(200);
          expect(result).toEqual(withRevision(copy));
          expect(mockResourceDeleteIfCurrent).not.toHaveBeenCalled();
        });

        it("takes the copy back when someone saved the shared version meanwhile", async () => {
          mockResourceGet
            .mockResolvedValueOnce(shared)
            .mockResolvedValue({ ...shared, content: "theirs" });

          const result = await save();

          expect(lastStatus).toBe(409);
          expect(result).toMatchObject({
            errorCode: "save_conflict",
            details: {
              current: { content: "theirs" },
              currentRevision: withRevision({ content: "theirs" }).revision,
            },
          });
          expect(mockResourceDeleteIfCurrent).toHaveBeenCalledExactlyOnceWith(
            copy,
          );
        });

        it("takes back a copy made with empty metadata as a read sees it", async () => {
          mockResourcePutIfAbsent.mockResolvedValue({ ...copy, metadata: "" });
          mockResourceGet
            .mockResolvedValueOnce(shared)
            .mockResolvedValue({ ...shared, content: "theirs" });

          const result = await handleUpdateResource({
            _params: { id: "s1" },
            _body: {
              content: "mine",
              metadata: "",
              expectedRevision: withRevision(shared).revision,
            },
            context: {},
          });

          expect(lastStatus).toBe(409);
          expect(result).toMatchObject({
            errorCode: "save_conflict",
            details: { current: { content: "theirs" } },
          });
          expect(mockResourceDeleteIfCurrent).toHaveBeenCalledExactlyOnceWith({
            ...copy,
            metadata: null,
          });
        });

        it("takes the copy back when a legacy source changes before it is removed", async () => {
          const legacy = {
            ...shared,
            metadata: '{"source":"workspace-files"}',
          };
          mockIsLegacyOrganizationWorkspaceFile.mockReturnValue(true);
          mockResourceGet
            .mockResolvedValueOnce(legacy)
            .mockResolvedValueOnce(legacy)
            .mockResolvedValue({ ...legacy, content: "theirs" });
          mockResourceDeleteIfCurrent.mockResolvedValueOnce(false);

          const result = await save();

          expect(lastStatus).toBe(409);
          expect(result).toMatchObject({
            errorCode: "save_conflict",
            details: { current: { content: "theirs" } },
          });
          expect(mockResourceDeleteIfCurrent).toHaveBeenNthCalledWith(
            1,
            legacy,
          );
          expect(mockResourceDeleteIfCurrent).toHaveBeenNthCalledWith(2, copy);
        });

        it("treats a save as done when a copy made meanwhile holds it", async () => {
          mockResourceGet.mockResolvedValue(shared);
          mockResourcePutIfAbsent.mockResolvedValue(null);
          mockResourceGetByPath
            .mockResolvedValueOnce(null)
            .mockResolvedValue(copy);

          const result = await save();

          expect(lastStatus).toBe(200);
          expect(result).toEqual(withRevision(copy));
          expect(mockResourceGetByPath).toHaveBeenLastCalledWith(
            "__organization__:org-1",
            shared.path,
            { orgId: "org-1" },
          );
        });

        it("refuses with the copy when one made meanwhile holds other content", async () => {
          const other = { ...copy, content: "other" };
          mockResourceGet.mockResolvedValue(shared);
          mockResourcePutIfAbsent.mockResolvedValue(null);
          mockResourceGetByPath
            .mockResolvedValueOnce(null)
            .mockResolvedValue(other);

          const result = await save();

          expect(lastStatus).toBe(409);
          expect(result).toMatchObject({
            errorCode: "save_conflict",
            details: {
              current: { content: "other" },
              currentRevision: withRevision(other).revision,
            },
          });
        });

        describe("once the copy exists", () => {
          const copied = { ...copy, content: "old" };
          const byId = (copyNow: typeof copy) => (id: string) =>
            Promise.resolve(id === "s1" ? shared : copyNow);

          it("saves to the copy, over the version of it read", async () => {
            mockResourceGet.mockImplementation(byId(copied));
            mockResourceGetByPath.mockResolvedValue(copied);
            const written = { ...copied, content: "mine", updatedAt: 2000 };
            mockResourcePutIfSnapshot.mockResolvedValue({
              before: copied,
              resource: written,
            });

            const result = await save();

            expect(lastStatus).toBe(200);
            expect(result).toEqual(withRevision(written));
            expect(mockResourceGetByPath).toHaveBeenCalledWith(
              "__organization__:org-1",
              shared.path,
              { orgId: "org-1" },
            );
            expect(mockResourcePutIfSnapshot).toHaveBeenCalledWith({
              previous: copied,
              owner: "__organization__:org-1",
              path: "doc.md",
              content: "mine",
              mimeType: "text/markdown",
            });
            expect(mockResourcePutIfAbsent).not.toHaveBeenCalled();
          });

          it("treats a resent save the copy already holds as done", async () => {
            mockResourceGet.mockImplementation(byId(copy));
            mockResourceGetByPath.mockResolvedValue(copy);

            const result = await save();

            expect(lastStatus).toBe(200);
            expect(result).toEqual(withRevision(copy));
            expect(mockResourcePutIfSnapshot).not.toHaveBeenCalled();
            expect(mockResourcePutIfAbsent).not.toHaveBeenCalled();
          });

          it("refuses with the copy when it holds other content", async () => {
            const other = { ...copy, content: "other" };
            mockResourceGet.mockImplementation(byId(other));
            mockResourceGetByPath.mockResolvedValue(other);

            const result = await save();

            expect(lastStatus).toBe(409);
            expect(result).toMatchObject({
              errorCode: "save_conflict",
              details: {
                current: { content: "other" },
                currentRevision: withRevision(other).revision,
              },
            });
            expect(mockResourcePutIfSnapshot).not.toHaveBeenCalled();
            expect(mockResourcePutIfAbsent).not.toHaveBeenCalled();
          });
        });

        it("keeps the copy when the shared version was deleted meanwhile", async () => {
          mockResourceGet.mockResolvedValueOnce(shared).mockResolvedValue(null);

          const result = await save();

          expect(lastStatus).toBe(200);
          expect(result).toEqual(withRevision(copy));
          expect(mockResourceDeleteIfCurrent).not.toHaveBeenCalled();
        });

        it("keeps the copy when a legacy source is deleted before it is removed", async () => {
          const legacy = {
            ...shared,
            metadata: '{"source":"workspace-files"}',
          };
          mockIsLegacyOrganizationWorkspaceFile.mockReturnValue(true);
          mockResourceGet
            .mockResolvedValueOnce(legacy)
            .mockResolvedValueOnce(legacy)
            .mockResolvedValue(null);
          mockResourceDeleteIfCurrent.mockResolvedValueOnce(false);

          const result = await save();

          expect(lastStatus).toBe(200);
          expect(result).toEqual(withRevision(copy));
          expect(mockResourceDeleteIfCurrent).toHaveBeenCalledExactlyOnceWith(
            legacy,
          );
        });

        it("refuses with the copy when someone wrote it before it could be taken back", async () => {
          mockResourceGet
            .mockResolvedValueOnce(shared)
            .mockResolvedValueOnce({ ...shared, content: "theirs" })
            .mockResolvedValue({ ...copy, content: "written to the copy" });
          mockResourceDeleteIfCurrent.mockResolvedValueOnce(false);

          const result = await save();

          expect(lastStatus).toBe(409);
          expect(result).toMatchObject({
            errorCode: "save_conflict",
            details: { current: { content: "written to the copy" } },
          });
          expect(mockResourceGet).toHaveBeenLastCalledWith(
            "copy",
            expect.anything(),
          );
        });
      });

      it("renames without checking the content", async () => {
        mockResourceGet.mockResolvedValue({ ...doc, content: "theirs" });
        mockResourceMove.mockResolvedValue(true);
        mockResourcePut.mockResolvedValue({
          ...doc,
          path: "renamed.md",
          content: "theirs",
        });

        await handleUpdateResource({
          _params: { id: "r1" },
          _body: {
            path: "renamed.md",
            expectedRevision: withRevision(doc).revision,
          },
          context: {},
        });

        expect(lastStatus).toBe(200);
        expect(mockResourceMove).toHaveBeenCalledWith("r1", "renamed.md");
      });

      it("rejects a revision that isn't a string", async () => {
        mockResourceGet.mockResolvedValue(doc);

        const result = await handleUpdateResource({
          _params: { id: "r1" },
          _body: { content: "new", expectedRevision: 7 },
          context: {},
        });

        expect(lastStatus).toBe(400);
        expect(result).toMatchObject({ error: expect.any(String) });
        expect(mockResourcePutIfSnapshot).not.toHaveBeenCalled();
        expect(mockResourcePut).not.toHaveBeenCalled();
      });
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

    it("refuses a rename onto a taken path and suggests a free one", async () => {
      mockResourceGet.mockResolvedValue({
        id: "r1",
        path: "notes/draft.md",
        owner: "test@test.com",
        content: "content",
        mimeType: "text/markdown",
      });
      holdPaths("notes/todo.md", "notes/todo-2.md");

      const result = await handleUpdateResource({
        _params: { id: "r1" },
        _body: { path: "notes/todo.md" },
        context: {},
      });

      expect(lastStatus).toBe(409);
      expect(result).toEqual({
        error:
          'A resource named "notes/todo.md" already exists. Pick another name, such as "notes/todo-3.md", which is free.',
        errorCode: "name_taken",
        details: { name: "notes/todo.md", suggestion: "notes/todo-3.md" },
      });
      expect(mockResourceStoredPathsTaken).toHaveBeenCalledWith(
        "test@test.com",
        ["notes/todo.md"],
        { localFiles: false },
      );
      expect(mockResourceMove).not.toHaveBeenCalled();
      expect(mockResourcePut).not.toHaveBeenCalled();
    });

    it("refuses without a suggestion when every numbered path it checks is taken", async () => {
      mockResourceGet.mockResolvedValue({
        id: "r1",
        path: "notes/draft.md",
        owner: "test@test.com",
        content: "content",
        mimeType: "text/markdown",
      });
      mockResourceStoredPathsTaken.mockImplementation(
        async (_owner: string, paths: string[]) => new Set(paths),
      );

      const result = await handleUpdateResource({
        _params: { id: "r1" },
        _body: { path: "notes/todo.md" },
        context: {},
      });

      expect(lastStatus).toBe(409);
      expect(result).toEqual({
        error:
          'A resource named "notes/todo.md" already exists. Rename or delete that one first.',
      });
      expect(mockResourceMove).not.toHaveBeenCalled();
    });

    it("suggests a skill's next folder rather than renaming its SKILL.md", async () => {
      mockResourceGet.mockResolvedValue({
        id: "r1",
        path: "skills/draft/SKILL.md",
        owner: "test@test.com",
        content: "content",
        mimeType: "text/markdown",
      });
      holdPaths("skills/review/SKILL.md");

      const result = await handleUpdateResource({
        _params: { id: "r1" },
        _body: { path: "skills/review/SKILL.md" },
        context: {},
      });

      expect(lastStatus).toBe(409);
      expect(result).toMatchObject({
        errorCode: "name_taken",
        details: {
          name: "skills/review/SKILL.md",
          suggestion: "skills/review-2/SKILL.md",
        },
      });
    });

    it("refuses a rename when another write takes the path during the move", async () => {
      mockResourceGet.mockResolvedValue({
        id: "r1",
        path: "old.md",
        owner: "test@test.com",
        content: "content",
        mimeType: "text/markdown",
      });
      mockResourceMove.mockRejectedValueOnce(
        Object.assign(
          new Error('duplicate key value violates unique constraint "x"'),
          { code: "23505" },
        ),
      );

      const result = await handleUpdateResource({
        _params: { id: "r1" },
        _body: { path: "new.md" },
        context: {},
      });

      expect(lastStatus).toBe(409);
      expect(result).toMatchObject({
        errorCode: "name_taken",
        details: { name: "new.md", suggestion: "new-2.md" },
      });
      expect(mockResourcePut).not.toHaveBeenCalled();
    });

    it("still fails a move that breaks for another reason", async () => {
      mockResourceGet.mockResolvedValue({
        id: "r1",
        path: "old.md",
        owner: "test@test.com",
        content: "content",
        mimeType: "text/markdown",
      });
      mockResourceMove.mockRejectedValueOnce(new Error("connection reset"));

      await expect(
        handleUpdateResource({
          _params: { id: "r1" },
          _body: { path: "new.md" },
          context: {},
        }),
      ).rejects.toThrow("connection reset");
      expect(mockResourcePut).not.toHaveBeenCalled();
    });

    it("refuses to move a local workspace file onto one that exists, instead of replacing it", async () => {
      mockIsLocalWorkspaceResourceId.mockReturnValue(true);
      mockCanWriteLocalWorkspaceResourcePath.mockResolvedValue(true);
      mockResourceGet.mockResolvedValue(localSkill("draft"));
      holdPaths("skills/review/SKILL.md");

      const result = await handleUpdateResource({
        _params: { id: "local-workspace-resource:skills/draft/SKILL.md" },
        _body: { path: "skills/review/SKILL.md" },
        context: {},
      });

      expect(lastStatus).toBe(409);
      expect(result).toMatchObject({
        errorCode: "name_taken",
        details: { suggestion: "skills/review-2/SKILL.md" },
      });
      expect(mockResourceStoredPathsTaken).toHaveBeenCalledWith(
        "__workspace__",
        ["skills/review/SKILL.md"],
        { localFiles: true },
      );
      expect(mockResourcePut).not.toHaveBeenCalled();
      expect(mockResourceDelete).not.toHaveBeenCalled();
    });

    it("suggests the first free local name, past one it can't read", async () => {
      mockIsLocalWorkspaceResourceId.mockReturnValue(true);
      mockCanWriteLocalWorkspaceResourcePath.mockResolvedValue(true);
      mockResourceGet.mockResolvedValue(localSkill("draft"));
      mockResourceStoredPathsTaken.mockImplementation(
        async (_owner: string, paths: string[]) => {
          if (
            paths.includes("skills/review-2/SKILL.md") ||
            paths.includes("skills/review-4/SKILL.md")
          ) {
            throw new Error("EISDIR: illegal operation on a directory");
          }
          return new Set(
            paths.filter((path) => path === "skills/review/SKILL.md"),
          );
        },
      );

      const result = await handleUpdateResource({
        _params: { id: "local-workspace-resource:skills/draft/SKILL.md" },
        _body: { path: "skills/review/SKILL.md" },
        context: {},
      });

      expect(lastStatus).toBe(409);
      expect(result).toMatchObject({
        errorCode: "name_taken",
        details: { suggestion: "skills/review-3/SKILL.md" },
      });
      expect(mockResourcePut).not.toHaveBeenCalled();
    });

    it("offers no numbered name for a local control file, which can't be written", async () => {
      mockIsLocalWorkspaceResourceId.mockReturnValue(true);
      mockCanWriteLocalWorkspaceResourcePath.mockResolvedValue(true);
      mockResourceGet.mockResolvedValue(localSkill("draft"));
      holdPaths("AGENTS.md");

      const result = await handleUpdateResource({
        _params: { id: "local-workspace-resource:skills/draft/SKILL.md" },
        _body: { path: "AGENTS.md" },
        context: {},
      });

      expect(lastStatus).toBe(409);
      expect(result).toEqual({
        error:
          'A resource named "AGENTS.md" already exists. Rename or delete that one first.',
      });
      expect(mockResourcePut).not.toHaveBeenCalled();
      expect(mockResourceDelete).not.toHaveBeenCalled();
    });

    it("keeps a local file that a case-insensitive disk finds at its new letter case", async () => {
      mockIsLocalWorkspaceResourceId.mockReturnValue(true);
      mockCanWriteLocalWorkspaceResourcePath.mockResolvedValue(true);
      mockResourceGet.mockResolvedValue(localSkill("review"));
      holdPaths("skills/Review/SKILL.md");
      mockIsSameLocalWorkspaceFile.mockResolvedValue(true);

      const result = await handleUpdateResource({
        _params: { id: "local-workspace-resource:skills/review/SKILL.md" },
        _body: { path: "skills/Review/SKILL.md" },
        context: {},
      });

      expect(lastStatus).toBe(409);
      expect(result).toEqual({
        error:
          '"skills/Review/SKILL.md" names this same file, so it can\'t be renamed to it. To change only its letter case, rename it to another name first.',
      });
      expect(mockIsSameLocalWorkspaceFile).toHaveBeenCalledWith({
        path: "skills/review/SKILL.md",
        otherPath: "skills/Review/SKILL.md",
      });
      expect(mockResourcePut).not.toHaveBeenCalled();
      expect(mockResourceDelete).not.toHaveBeenCalled();
    });

    it("moves a local file to a free path, then deletes the old one", async () => {
      mockIsLocalWorkspaceResourceId.mockReturnValue(true);
      mockCanWriteLocalWorkspaceResourcePath.mockResolvedValue(true);
      mockResourceGet.mockResolvedValue(localSkill("draft"));
      const moved = {
        ...localSkill("review"),
        content: "# draft",
      };
      mockResourcePutIfSnapshot.mockResolvedValue({
        before: null,
        resource: moved,
      });

      const result = await handleUpdateResource({
        _params: { id: "local-workspace-resource:skills/draft/SKILL.md" },
        _body: { path: "skills/review/SKILL.md" },
        context: {},
      });

      expect(result).toEqual(withRevision(moved));
      expect(mockResourcePutIfSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          previous: null,
          owner: "__workspace__",
          path: "skills/review/SKILL.md",
        }),
      );
      expect(mockResourcePut).not.toHaveBeenCalled();
      expect(mockResourceDeleteIfCurrent).toHaveBeenCalledWith(
        localSkill("draft"),
      );
      // Only the file it copied: a copy in the other skill root wasn't read.
      expect(mockResourceDelete).not.toHaveBeenCalled();
    });

    it("keeps a local file that changed during its rename, and takes the copy back", async () => {
      mockIsLocalWorkspaceResourceId.mockReturnValue(true);
      mockCanWriteLocalWorkspaceResourcePath.mockResolvedValue(true);
      mockResourceGet.mockResolvedValue(localSkill("draft"));
      const moved = { ...localSkill("review"), content: "draft" };
      mockResourcePutIfSnapshot.mockResolvedValue({
        before: null,
        resource: moved,
      });
      // Another write changed the old file after it was read.
      mockResourceDeleteIfCurrent
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const result = await handleUpdateResource({
        _params: { id: "local-workspace-resource:skills/draft/SKILL.md" },
        _body: { path: "skills/review/SKILL.md" },
        context: {},
      });

      expect(lastStatus).toBe(409);
      expect(result).toEqual({
        error: "Resource changed before it could be renamed",
      });
      expect(mockResourceDeleteIfCurrent).toHaveBeenNthCalledWith(
        1,
        localSkill("draft"),
      );
      expect(mockResourceDeleteIfCurrent).toHaveBeenNthCalledWith(2, moved);
      expect(mockResourceDelete).not.toHaveBeenCalled();
    });

    it("takes the copy back when the old local file can't be deleted", async () => {
      mockIsLocalWorkspaceResourceId.mockReturnValue(true);
      mockCanWriteLocalWorkspaceResourcePath.mockResolvedValue(true);
      mockResourceGet.mockResolvedValue(localSkill("draft"));
      const moved = { ...localSkill("review"), content: "draft" };
      mockResourcePutIfSnapshot.mockResolvedValue({
        before: null,
        resource: moved,
      });
      mockResourceDeleteIfCurrent
        .mockRejectedValueOnce(new Error("EACCES: permission denied"))
        .mockResolvedValueOnce(true);

      await expect(
        handleUpdateResource({
          _params: { id: "local-workspace-resource:skills/draft/SKILL.md" },
          _body: { path: "skills/review/SKILL.md" },
          context: {},
        }),
      ).rejects.toThrow("EACCES: permission denied");
      expect(mockResourceDeleteIfCurrent).toHaveBeenNthCalledWith(2, moved);
    });

    it("refuses a local rename when another write takes the path first", async () => {
      mockIsLocalWorkspaceResourceId.mockReturnValue(true);
      mockCanWriteLocalWorkspaceResourcePath.mockResolvedValue(true);
      mockResourceGet.mockResolvedValue(localSkill("draft"));
      // Free when checked, then created by another write before this one.
      mockResourcePutIfSnapshot.mockResolvedValue(null);

      const result = await handleUpdateResource({
        _params: { id: "local-workspace-resource:skills/draft/SKILL.md" },
        _body: { path: "skills/review/SKILL.md" },
        context: {},
      });

      expect(lastStatus).toBe(409);
      expect(result).toMatchObject({ errorCode: "name_taken" });
      expect(mockResourceDelete).not.toHaveBeenCalled();
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

    it("resolves the organization before reading a legacy shared resource", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "QA Org",
        role: "admin",
      });
      mockResourceGet.mockResolvedValue({
        id: "legacy-org-resource",
        path: "analysis.md",
        owner: "__shared__",
        content: "old",
        mimeType: "text/markdown",
        updatedAt: 1,
        createdBy: "agent",
        visibility: "agent_scratch",
        threadId: "thread-1",
        runId: "run-1",
        expiresAt: 123,
        metadata: JSON.stringify({
          source: "workspace-files",
          scope: "org",
          scopeId: "org-1",
        }),
      });
      mockIsLegacyOrganizationWorkspaceFile.mockReturnValue(true);
      mockResourceGetByPath.mockResolvedValue(null);
      mockResourcePutIfAbsent.mockResolvedValue({ id: "org-override" });

      await handleUpdateResource({
        _params: { id: "legacy-org-resource" },
        _body: { content: "new", path: "renamed.md" },
        context: {},
      });

      expect(mockResourceGet).toHaveBeenCalledWith("legacy-org-resource", {
        userEmail: "test@test.com",
        orgId: "org-1",
      });
      expect(mockResourcePutIfAbsent).toHaveBeenCalledWith(
        "__organization__:org-1",
        "renamed.md",
        "new",
        "text/markdown",
        {
          createdBy: "agent",
          visibility: "agent_scratch",
          threadId: "thread-1",
          runId: "run-1",
          expiresAt: 123,
          metadata: JSON.stringify({
            source: "workspace-files",
            scope: "org",
            scopeId: "org-1",
          }),
        },
      );
      expect(mockResourceDeleteIfCurrent).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "__shared__",
          path: "analysis.md",
          id: "legacy-org-resource",
          updatedAt: 1,
          content: "old",
          metadata: JSON.stringify({
            source: "workspace-files",
            scope: "org",
            scopeId: "org-1",
          }),
        }),
      );
    });

    it("rejects a legacy rename onto an existing organization resource", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "QA Org",
        role: "admin",
      });
      mockResourceGet.mockResolvedValue({
        id: "legacy-org-resource",
        path: "analysis.md",
        owner: "__shared__",
        content: "old",
        mimeType: "text/markdown",
      });
      mockIsLegacyOrganizationWorkspaceFile.mockReturnValue(true);
      mockResourcePutIfAbsent.mockResolvedValue(null);

      const result = await handleUpdateResource({
        _params: { id: "legacy-org-resource" },
        _body: { content: "new", path: "renamed.md" },
        context: {},
      });

      expect(lastStatus).toBe(409);
      expect(result).toEqual({
        error:
          'A resource named "renamed.md" already exists. Pick another name, such as "renamed-2.md", which is free.',
        errorCode: "name_taken",
        details: { name: "renamed.md", suggestion: "renamed-2.md" },
      });
      expect(mockResourceStoredPathsTaken).toHaveBeenCalledWith(
        "__organization__:org-1",
        expect.arrayContaining(["renamed-2.md"]),
        { localFiles: false },
      );
      expect(mockResourcePut).not.toHaveBeenCalled();
      expect(mockResourcePutIfAbsent).toHaveBeenCalledWith(
        "__organization__:org-1",
        "renamed.md",
        "new",
        "text/markdown",
        expect.any(Object),
      );
      expect(mockResourceDelete).not.toHaveBeenCalled();
    });

    it("rejects a legacy update when an organization resource already shares its path", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "QA Org",
        role: "admin",
      });
      mockResourceGet.mockResolvedValue({
        id: "legacy-org-resource",
        path: "analysis.md",
        owner: "__shared__",
        content: "old",
        mimeType: "text/markdown",
      });
      mockIsLegacyOrganizationWorkspaceFile.mockReturnValue(true);
      mockResourcePutIfAbsent.mockResolvedValue(null);

      const result = await handleUpdateResource({
        _params: { id: "legacy-org-resource" },
        _body: { content: "new" },
        context: {},
      });

      expect(lastStatus).toBe(409);
      expect(result).toEqual({
        error: 'A resource already exists at path "analysis.md"',
      });
      expect(mockResourcePut).not.toHaveBeenCalled();
      expect(mockResourcePutIfAbsent).toHaveBeenCalled();
      expect(mockResourceDelete).not.toHaveBeenCalled();
    });
  });

  describe("handleDeleteResource", () => {
    it("moves a removed skill into Trash and restores it by id", async () => {
      const skill = {
        id: "skill-1",
        path: "skills/review/SKILL.md",
        owner: "test@test.com",
        content: "Review the current task",
      };
      const trashed = {
        ...skill,
        path: `trash/skills/${skill.id}/${skill.path}`,
      };
      mockResourceGet.mockResolvedValue(skill);
      mockResourceMoveIfCurrent.mockResolvedValue(trashed);

      const event = { _params: { id: skill.id }, context: {} };
      await expect(
        handleDeleteResource({ ...event, _query: { trashSkill: "true" } }),
      ).resolves.toEqual({ ok: true });
      expect(mockResourceMoveIfCurrent).toHaveBeenLastCalledWith(
        skill,
        trashed.path,
      );
      expect(mockResourceDeleteIfCurrent).not.toHaveBeenCalled();

      mockResourceGet.mockResolvedValue(trashed);
      mockResourceMoveIfCurrent.mockResolvedValue(skill);
      await expect(
        handleUpdateResource({ ...event, _body: { restoreSkill: true } }),
      ).resolves.toEqual(withRevision(skill));
      expect(mockResourceMoveIfCurrent).toHaveBeenLastCalledWith(
        trashed,
        skill.path,
      );
    });

    it("deletes resource and returns ok", async () => {
      mockResourceGet.mockResolvedValue({
        id: "r1",
        path: "doc.md",
        owner: "test@test.com",
        content: "content",
        updatedAt: 1,
        metadata: null,
      });

      const event = { _params: { id: "r1" }, context: {} };
      const result = await handleDeleteResource(event);

      expect(result).toEqual({ ok: true });
      expect(mockResourceDeleteIfCurrent).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "test@test.com",
          path: "doc.md",
          id: "r1",
          updatedAt: 1,
          content: "content",
          metadata: null,
        }),
      );
    });

    it("returns a conflict when the resource changed before deletion", async () => {
      mockResourceGet.mockResolvedValue({
        id: "r1",
        path: "doc.md",
        owner: "test@test.com",
        content: "content",
        updatedAt: 1,
        metadata: null,
      });
      mockResourceDeleteIfCurrent.mockResolvedValue(false);

      const result = await handleDeleteResource({
        _params: { id: "r1" },
        context: {},
      });

      expect(lastStatus).toBe(409);
      expect(result).toEqual({
        error: "Resource changed before it could be deleted",
      });
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

    it("removes a shadowed legacy organization row when deleting its override", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "QA Org",
        role: "admin",
      });
      mockResourceGet.mockResolvedValue({
        id: "org-resource",
        path: "analysis.md",
        owner: "__organization__:org-1",
        content: "organization",
        updatedAt: 2,
        metadata: null,
      });
      mockResourceGetByPath.mockResolvedValue({
        id: "legacy-org-resource",
        path: "analysis.md",
        owner: "__shared__",
        content: "legacy",
        updatedAt: 1,
        metadata: JSON.stringify({
          source: "workspace-files",
          scope: "org",
          scopeId: "org-1",
        }),
      });
      mockIsLegacyOrganizationWorkspaceFile.mockReturnValue(true);

      await handleDeleteResource({
        _params: { id: "org-resource" },
        context: {},
      });

      expect(mockResourceDeleteIfCurrent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          owner: "__organization__:org-1",
          path: "analysis.md",
          id: "org-resource",
          updatedAt: 2,
          content: "organization",
          metadata: null,
        }),
      );
      expect(mockResourceDeleteIfCurrent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          owner: "__shared__",
          path: "analysis.md",
          id: "legacy-org-resource",
          updatedAt: 1,
          content: "legacy",
          metadata: JSON.stringify({
            source: "workspace-files",
            scope: "org",
            scopeId: "org-1",
          }),
        }),
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

    it("resolves the organization before reading a legacy shared resource", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "QA Org",
        role: "admin",
      });
      mockResourceGet.mockResolvedValue({
        id: "legacy-org-resource",
        path: "analysis.md",
        owner: "__shared__",
        content: "legacy",
        updatedAt: 1,
        metadata: JSON.stringify({
          source: "workspace-files",
          scope: "org",
          scopeId: "org-1",
        }),
      });
      mockIsLegacyOrganizationWorkspaceFile.mockReturnValue(true);
      await handleDeleteResource({
        _params: { id: "legacy-org-resource" },
        context: {},
      });

      expect(mockResourceGet).toHaveBeenCalledWith("legacy-org-resource", {
        userEmail: "test@test.com",
        orgId: "org-1",
      });
      expect(mockResourceDeleteIfCurrent).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "__shared__",
          path: "analysis.md",
          id: "legacy-org-resource",
          updatedAt: 1,
          content: "legacy",
          metadata: JSON.stringify({
            source: "workspace-files",
            scope: "org",
            scopeId: "org-1",
          }),
        }),
      );
    });
  });

  describe("handleUploadResource", () => {
    it("stores text uploads in SQL", async () => {
      const resource = {
        id: "doc",
        path: "café/note.md",
        owner: "test@test.com",
        content: "# Note",
        mimeType: "text/markdown",
        size: 6,
      };
      mockResourcePutIfAbsent.mockResolvedValue(resource);

      const result = await handleUploadResource({
        _multipart: [
          {
            name: "file",
            filename: "note.md",
            type: "text/markdown",
            data: Buffer.from("# Note"),
          },
          { name: "path", data: new TextEncoder().encode("café/note.md") },
        ],
      });

      expect(lastStatus).toBe(201);
      expect(mockUploadFile).not.toHaveBeenCalled();
      expect(mockResourcePut).not.toHaveBeenCalled();
      expect(mockResourcePutIfAbsent).toHaveBeenCalledWith(
        "test@test.com",
        "café/note.md",
        "# Note",
        "text/markdown",
      );
      expect(result).toEqual(withRevision(resource));
    });

    function textUpload(path: string, content: string) {
      return {
        _multipart: [
          {
            name: "file",
            filename: path.slice(path.lastIndexOf("/") + 1),
            type: "text/markdown",
            data: Buffer.from(content),
          },
          { name: "path", data: new TextEncoder().encode(path) },
        ],
      };
    }

    function storedAt(path: string, content: string, owner = "test@test.com") {
      return {
        id: `id:${path}`,
        path,
        owner,
        content,
        mimeType: "text/markdown",
        size: content.length,
      };
    }

    it("uploads under the next free name instead of replacing a taken one", async () => {
      mockResourceGetByPath.mockImplementation(
        async (_owner: string, path: string) =>
          path === "notes.md" ? storedAt("notes.md", "# Theirs") : null,
      );
      mockResourcePutIfAbsent.mockImplementation(
        async (_owner: string, path: string, content: string) =>
          path === "notes.md" ? null : storedAt(path, content),
      );

      const result = await handleUploadResource(
        textUpload("notes.md", "# Mine"),
      );

      expect(lastStatus).toBe(201);
      expect(mockResourcePut).not.toHaveBeenCalled();
      expect(mockResourcePutIfAbsent).toHaveBeenLastCalledWith(
        "test@test.com",
        "notes-2.md",
        "# Mine",
        "text/markdown",
      );
      expect(result).toMatchObject({ path: "notes-2.md", content: "# Mine" });
    });

    it("takes the name after the one another upload claimed first", async () => {
      const stored = new Map([["notes.md", storedAt("notes.md", "# A")]]);
      mockResourceGetByPath.mockImplementation(
        async (_owner: string, path: string) => stored.get(path) ?? null,
      );
      mockResourceStoredPathsTaken.mockImplementation(
        async (_owner: string, paths: string[]) =>
          new Set(paths.filter((path) => stored.has(path))),
      );
      mockResourcePutIfAbsent.mockImplementation(
        async (_owner: string, path: string, content: string) => {
          if (path === "notes-2.md" && !stored.has(path)) {
            stored.set(path, storedAt(path, "# B"));
          }
          if (stored.has(path)) return null;
          const created = storedAt(path, content);
          stored.set(path, created);
          return created;
        },
      );

      const result = await handleUploadResource(textUpload("notes.md", "# C"));

      expect(lastStatus).toBe(201);
      expect(result).toMatchObject({ path: "notes-3.md", content: "# C" });
      expect(stored.get("notes-2.md")).toMatchObject({ content: "# B" });
    });

    it("counts a resent upload already stored under a numbered name as done", async () => {
      const earlier = storedAt("notes-3.md", "# C");
      const stored = new Map([
        ["notes.md", storedAt("notes.md", "# A")],
        ["notes-2.md", storedAt("notes-2.md", "# B")],
        ["notes-3.md", earlier],
      ]);
      mockResourceGetByPath.mockImplementation(
        async (_owner: string, path: string) => stored.get(path) ?? null,
      );
      mockResourceStoredPathsTaken.mockImplementation(
        async (
          _owner: string,
          paths: string[],
          options?: { holding?: { content: string; mimeType: string } },
        ) =>
          new Set(
            paths.filter((path) => {
              const resource = stored.get(path);
              return (
                resource !== undefined &&
                (!options?.holding ||
                  (resource.content === options.holding.content &&
                    resource.mimeType === options.holding.mimeType))
              );
            }),
          ),
      );
      mockResourcePutIfAbsent.mockResolvedValue(null);

      const result = await handleUploadResource(textUpload("notes.md", "# C"));

      expect(lastStatus).toBe(200);
      expect(result).toEqual(withRevision(earlier));
      expect(mockResourcePutIfAbsent).toHaveBeenCalledTimes(1);
      expect(mockResourceStoredPathsTaken).toHaveBeenCalledWith(
        "test@test.com",
        ["notes-2.md", "notes-3.md"],
        { holding: { content: "# C", mimeType: "text/markdown" } },
      );
    });

    it("counts a resent text upload that's already there as done", async () => {
      const existing = storedAt("notes.md", "# Mine");
      mockResourceGetByPath.mockResolvedValue(existing);

      const result = await handleUploadResource(
        textUpload("notes.md", "# Mine"),
      );

      expect(lastStatus).toBe(200);
      expect(mockResourcePutIfAbsent).toHaveBeenCalledTimes(1);
      expect(result).toEqual(withRevision(existing));
    });

    it("counts a shared file from before organizations as taken", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "Test",
        role: "admin",
      });
      mockResourceGetByPath.mockImplementation(
        async (owner: string, path: string) =>
          owner === "__shared__" && path === "shared.md"
            ? storedAt("shared.md", "# Old", "__shared__")
            : null,
      );
      mockResourceStoredPathsTaken.mockImplementation(
        async (owner: string, paths: string[]) =>
          new Set(
            owner === "__shared__"
              ? paths.filter((path) => path === "shared.md")
              : [],
          ),
      );
      mockResourcePutIfAbsent.mockImplementation(
        async (owner: string, path: string, content: string) =>
          storedAt(path, content, owner),
      );

      const result = await handleUploadResource({
        _multipart: [
          ...textUpload("shared.md", "# New")._multipart,
          { name: "shared", data: new TextEncoder().encode("true") },
        ],
      });

      expect(lastStatus).toBe(201);
      expect(mockResourcePutIfAbsent).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        owner: "__organization__:org-1",
        path: "shared-2.md",
      });
    });

    it("skips numbered names that shared files from before organizations hold", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "Test",
        role: "admin",
      });
      const legacyPaths = new Set(["shared.md", "shared-2.md"]);
      mockResourceGetByPath.mockImplementation(
        async (owner: string, path: string) =>
          owner === "__shared__" && legacyPaths.has(path)
            ? storedAt(path, "# Old", "__shared__")
            : null,
      );
      mockResourceStoredPathsTaken.mockImplementation(
        async (owner: string, paths: string[]) =>
          new Set(
            owner === "__shared__"
              ? paths.filter((path) => legacyPaths.has(path))
              : [],
          ),
      );
      mockResourcePutIfAbsent.mockImplementation(
        async (owner: string, path: string, content: string) =>
          storedAt(path, content, owner),
      );

      const result = await handleUploadResource({
        _multipart: [
          ...textUpload("shared.md", "# New")._multipart,
          { name: "shared", data: new TextEncoder().encode("true") },
        ],
      });

      expect(lastStatus).toBe(201);
      expect(result).toMatchObject({
        owner: "__organization__:org-1",
        path: "shared-3.md",
      });
      expect(mockResourceStoredPathsTaken).toHaveBeenCalledWith(
        "__shared__",
        expect.any(Array),
        { orgId: "org-1" },
      );
    });

    it("refuses with a free name when the upload keeps losing its name", async () => {
      mockResourceGetByPath.mockImplementation(
        async (_owner: string, path: string) => storedAt(path, "# Theirs"),
      );

      const result = await handleUploadResource(
        textUpload("notes.md", "# Mine"),
      );

      expect(lastStatus).toBe(409);
      expect(result).toMatchObject({
        errorCode: "name_taken",
        details: { name: "notes.md", suggestion: "notes-2.md" },
      });
      expect(mockResourcePut).not.toHaveBeenCalled();
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
      expect(mockResourcePutIfAbsent).not.toHaveBeenCalled();
    });

    it("stores binary uploads as provider URLs", async () => {
      mockUploadFile.mockResolvedValue({
        url: "https://cdn.example.test/photo.png",
        provider: "test",
      });
      const resource = {
        id: "img",
        path: "photo.png",
        owner: "test@test.com",
        content: "https://cdn.example.test/photo.png",
        mimeType: "image/png",
        size: 34,
      };
      mockResourcePutIfAbsent.mockResolvedValue(resource);

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
      expect(mockResourcePutIfAbsent).toHaveBeenCalledWith(
        "test@test.com",
        "photo.png",
        "https://cdn.example.test/photo.png",
        "image/png",
      );
      expect(result).toMatchObject({
        id: "img",
        url: "https://cdn.example.test/photo.png",
        provider: "test",
      });
    });

    it("stores shared uploads in the organization scope", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "Test",
        role: "admin",
      });
      mockResourcePutIfAbsent.mockResolvedValue({ id: "shared" });

      await handleUploadResource({
        _multipart: [
          {
            name: "file",
            filename: "shared.md",
            type: "text/markdown",
            data: new TextEncoder().encode("# Shared"),
          },
          { name: "shared", data: new TextEncoder().encode("true") },
        ],
      });

      expect(mockResourcePutIfAbsent).toHaveBeenCalledWith(
        "__organization__:org-1",
        "shared.md",
        "# Shared",
        "text/markdown",
      );
    });

    it("rejects unauthenticated shared uploads", async () => {
      vi.mocked(getSession).mockResolvedValue(null as any);

      await expect(
        handleUploadResource({
          _multipart: [
            {
              name: "file",
              filename: "shared.md",
              type: "text/markdown",
              data: Buffer.from("# Shared"),
            },
            { name: "shared", data: new TextEncoder().encode("true") },
          ],
        }),
      ).rejects.toMatchObject({ statusCode: 401 });
      expect(mockResourcePut).not.toHaveBeenCalled();
    });

    it("rejects shared uploads from a caller with no organization", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: null,
        orgName: null,
        role: null,
      });

      await expect(
        handleUploadResource({
          _multipart: [
            {
              name: "file",
              filename: "shared.md",
              type: "text/markdown",
              data: Buffer.from("# Shared"),
            },
            { name: "shared", data: new TextEncoder().encode("true") },
          ],
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockResourcePut).not.toHaveBeenCalled();
    });

    it("rejects shared uploads from non-admin organization members", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "Test",
        role: "member",
      });

      const event = {
        _multipart: [
          {
            name: "file",
            filename: "shared.md",
            type: "text/markdown",
            data: Buffer.from("# Shared"),
          },
          { name: "shared", data: new TextEncoder().encode("true") },
        ],
      };

      await expect(handleUploadResource(event)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(mockResourcePut).not.toHaveBeenCalled();
    });
  });

  describe("handleGetResourceTree", () => {
    it("marks inherited defaults in the tree and the opened resource", async () => {
      const inherited = {
        id: "default-skill",
        owner: "__shared__",
        path: "skills/learn-shared/SKILL.md",
        mimeType: "text/markdown",
        metadata: null,
      };
      const legacy = {
        ...inherited,
        id: "legacy-skill",
        path: "skills/legacy/SKILL.md",
        metadata: JSON.stringify({
          source: "workspace-files",
          scope: "org",
          scopeId: "org-1",
        }),
      };
      const override = {
        ...inherited,
        id: "org-skill",
        owner: "__organization__:org-1",
        path: "skills/org/SKILL.md",
      };
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "Test org",
        role: "admin",
      });
      mockIsLegacyOrganizationWorkspaceFile.mockImplementation(
        (resource) => resource.id === legacy.id,
      );
      mockResourceListOrganization.mockResolvedValue([
        inherited,
        legacy,
        override,
      ]);
      mockResourceGet.mockImplementation(async (id) => {
        const resource = [inherited, legacy, override].find(
          (entry) => entry.id === id,
        );
        return resource ? { ...resource, content: "Skill contents" } : null;
      });

      const { tree } = await handleGetResourceTree({
        _query: { scope: "shared" },
      });

      expect(
        tree[0]?.children?.map((folder) => folder.children?.[0]?.resource),
      ).toEqual([
        { ...inherited, inheritedFromAppDefault: true },
        legacy,
        override,
      ]);
      await expect(
        handleGetResource({ _params: { id: inherited.id }, context: {} }),
      ).resolves.toMatchObject({ inheritedFromAppDefault: true });
    });

    it("reads a tree without writing defaults when requested", async () => {
      mockResourceList.mockResolvedValue([]);
      await handleGetResourceTree({
        _query: { scope: "personal", seedDefaults: "false" },
      });
      expect(mockResourceList).toHaveBeenCalledWith("test@test.com");
      expect(mockEnsurePersonalDefaults).not.toHaveBeenCalled();
    });

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
      expect(result.tree).toHaveLength(3);

      const skills = result.tree.find((n: any) => n.name === "skills");
      expect(skills).toBeDefined();
      expect(skills.type).toBe("folder");
      expect(skills.children).toHaveLength(2);

      const docs = result.tree.find((n: any) => n.name === "docs");
      expect(docs).toBeDefined();
      expect(docs.type).toBe("folder");
      expect(docs.children).toHaveLength(1);

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

    it("passes the resolved organization to tree enrichment reads", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "test@test.com",
        orgId: "org-1",
        orgName: "QA Org",
        role: "member",
      });
      mockResourceListAccessible.mockResolvedValue([
        { id: "r1", path: "agents/custom.md", owner: "__shared__" },
      ]);

      await handleGetResourceTree({ _query: {} });

      expect(mockResourceGet).toHaveBeenCalledWith("r1", { orgId: "org-1" });
    });
  });

  describe("handleExportResourcePack", () => {
    it("delegates to export-resource-pack with the caller identity", async () => {
      mockExportResourcePackRun.mockResolvedValue({
        pack: { version: 1, resources: [] },
      });

      const result = await handleExportResourcePack({
        _query: { scope: "personal", prefix: "memory/" },
      });

      expect(mockExportResourcePackRun).toHaveBeenCalledWith(
        { scope: "personal", prefix: "memory/" },
        { userEmail: "test@test.com", orgId: null, caller: "http" },
      );
      expect(result).toEqual({ pack: { version: 1, resources: [] } });
    });

    it("maps a typed pack failure onto the HTTP response", async () => {
      mockExportResourcePackRun.mockRejectedValue({
        actionContractError: true,
        errorCode: "too_large",
        statusCode: 400,
        message: "Resource pack exceeds the export cap.",
        details: { fileCount: 201 },
      });

      const result = await handleExportResourcePack({ _query: {} });

      expect(lastStatus).toBe(400);
      expect(result).toEqual({
        error: "Resource pack exceeds the export cap.",
        errorCode: "too_large",
        details: { fileCount: 201 },
      });
    });
  });

  describe("handleImportResourcePack", () => {
    it("delegates to import-resource-pack", async () => {
      mockImportResourcePackRun.mockResolvedValue({
        imported: 1,
        skipped: 0,
        redacted: 0,
        errors: [],
      });

      const result = await handleImportResourcePack({
        _body: { pack: { version: 1 }, onConflict: "overwrite" },
      });

      expect(mockImportResourcePackRun).toHaveBeenCalledWith(
        {
          pack: { version: 1 },
          targetScope: "personal",
          onConflict: "overwrite",
        },
        { userEmail: "test@test.com", orgId: null, caller: "http" },
      );
      expect(result).toEqual({
        imported: 1,
        skipped: 0,
        redacted: 0,
        errors: [],
      });
    });

    it("rejects an oversized body before running the import action", async () => {
      const { RESOURCE_PACK_MAX_BODY_BYTES } = await import("./pack.js");

      await expect(
        handleImportResourcePack({
          _headers: {
            "content-length": String(RESOURCE_PACK_MAX_BODY_BYTES + 1),
          },
          _body: { pack: { version: 1, resources: [] } },
        }),
      ).rejects.toMatchObject({ statusCode: 413 });

      expect(lastStatus).toBe(413);
      expect(mockImportResourcePackRun).not.toHaveBeenCalled();
    });

    it("returns a validation error for malformed JSON", async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{"));
          controller.close();
        },
      });

      const result = await handleImportResourcePack({ req: { body } });

      expect(lastStatus).toBe(400);
      expect(result).toEqual({
        error: "Invalid resource pack import request.",
        errorCode: "invalid_action_request_body",
      });
      expect(mockImportResourcePackRun).not.toHaveBeenCalled();
    });

    it("rejects an invalid target scope before running the import action", async () => {
      const result = await handleImportResourcePack({
        _body: { pack: {}, targetScope: "other" },
      });

      expect(lastStatus).toBe(400);
      expect(result).toEqual({
        error: "Invalid resource pack import request.",
        errorCode: "invalid_action_request_body",
      });
      expect(mockImportResourcePackRun).not.toHaveBeenCalled();
    });
  });
});
