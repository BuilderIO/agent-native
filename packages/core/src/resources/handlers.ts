import {
  defineEventHandler,
  readBody,
  getQuery,
  getRouterParam,
  setResponseStatus,
  getMethod,
  readMultipartFormData,
} from "h3";
import {
  resourceGet,
  resourceGetByPath,
  resourcePut,
  resourceDelete,
  resourceDeleteByPath,
  resourceList,
  resourceListAccessible,
  resourceMove,
  SHARED_OWNER,
  type Resource,
  type ResourceMeta,
} from "./store.js";
import { getSession } from "../server/auth.js";

// ---------------------------------------------------------------------------
// Owner resolution
// ---------------------------------------------------------------------------

async function resolveOwner(event: any, shared?: boolean): Promise<string> {
  if (shared) return SHARED_OWNER;
  const session = await getSession(event);
  return session?.email || "local@localhost";
}

async function resolveEmail(event: any): Promise<string> {
  const session = await getSession(event);
  return session?.email || "local@localhost";
}

// ---------------------------------------------------------------------------
// Tree building
// ---------------------------------------------------------------------------

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: TreeNode[];
  resource?: ResourceMeta;
}

function buildTree(resources: ResourceMeta[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const res of resources) {
    const parts = res.path.split("/").filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const currentPath = "/" + parts.slice(0, i + 1).join("/");

      if (isLast) {
        current.push({
          name: part,
          path: currentPath,
          type: "file",
          resource: res,
        });
      } else {
        let folder = current.find(
          (n) => n.name === part && n.type === "folder",
        );
        if (!folder) {
          folder = {
            name: part,
            path: currentPath,
            type: "folder",
            children: [],
          };
          current.push(folder);
        }
        current = folder.children!;
      }
    }
  }

  return root;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** GET /api/resources — list resources */
export async function handleListResources(event: any) {
  const query = getQuery(event);
  const prefix = (query.prefix as string) || undefined;
  const scope = (query.scope as string) || "all";
  const email = await resolveEmail(event);

  let resources: ResourceMeta[];

  if (scope === "personal") {
    resources = await resourceList(email, prefix);
  } else if (scope === "shared") {
    resources = await resourceList(SHARED_OWNER, prefix);
  } else {
    // "all" — personal + shared
    resources = await resourceListAccessible(email, prefix);
  }

  return { resources };
}

/** GET /api/resources/tree — build nested tree */
export async function handleGetResourceTree(event: any) {
  const query = getQuery(event);
  const scope = (query.scope as string) || "all";
  const email = await resolveEmail(event);

  let resources: ResourceMeta[];

  if (scope === "personal") {
    resources = await resourceList(email);
  } else if (scope === "shared") {
    resources = await resourceList(SHARED_OWNER);
  } else {
    resources = await resourceListAccessible(email);
  }

  const tree = buildTree(resources);
  return { tree };
}

/** GET /api/resources/:id — get single resource with content */
export async function handleGetResource(event: any) {
  const id = getRouterParam(event, "id") || event.context.params?.id;
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Resource ID is required" };
  }

  const resource = await resourceGet(id);
  if (!resource) {
    setResponseStatus(event, 404);
    return { error: "Resource not found" };
  }

  return resource;
}

/** POST /api/resources — create a resource */
export async function handleCreateResource(event: any) {
  const body = await readBody(event);

  if (!body?.path || typeof body.path !== "string") {
    setResponseStatus(event, 400);
    return { error: "path is required" };
  }

  const owner = await resolveOwner(event, body.shared);

  // If ifNotExists is set, skip if the resource already exists
  if (body.ifNotExists) {
    const existing = await resourceGetByPath(owner, body.path);
    if (existing) {
      return existing;
    }
  }

  const resource = await resourcePut(
    owner,
    body.path,
    body.content ?? "",
    body.mimeType,
  );

  setResponseStatus(event, 201);
  return resource;
}

/** PUT /api/resources/:id — update an existing resource */
export async function handleUpdateResource(event: any) {
  const id = getRouterParam(event, "id") || event.context.params?.id;
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Resource ID is required" };
  }

  const existing = await resourceGet(id);
  if (!existing) {
    setResponseStatus(event, 404);
    return { error: "Resource not found" };
  }

  const body = await readBody(event);

  // If path changed, move it
  if (body.path && body.path !== existing.path) {
    await resourceMove(id, body.path);
  }

  // Update content/mimeType by re-putting
  const resource = await resourcePut(
    existing.owner,
    body.path ?? existing.path,
    body.content ?? existing.content,
    body.mimeType ?? existing.mimeType,
  );

  return resource;
}

/** DELETE /api/resources/:id — delete a resource */
export async function handleDeleteResource(event: any) {
  const id = getRouterParam(event, "id") || event.context.params?.id;
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Resource ID is required" };
  }

  const deleted = await resourceDelete(id);
  if (!deleted) {
    setResponseStatus(event, 404);
    return { error: "Resource not found" };
  }

  return { ok: true };
}

/** POST /api/resources/upload — upload a file as a resource */
export async function handleUploadResource(event: any) {
  const parts = await readMultipartFormData(event);

  if (!parts || parts.length === 0) {
    setResponseStatus(event, 400);
    return { error: "No file uploaded" };
  }

  const filePart = parts.find((p) => p.name === "file");
  const pathPart = parts.find((p) => p.name === "path");
  const sharedPart = parts.find((p) => p.name === "shared");

  if (!filePart || !filePart.data) {
    setResponseStatus(event, 400);
    return { error: "No file data found" };
  }

  const fileName = filePart.filename || "upload";
  const path = pathPart?.data?.toString() || `/${fileName}`;
  const shared = sharedPart?.data?.toString() === "true";
  const mimeType = filePart.type || "application/octet-stream";

  // Encode binary files as base64, keep text as-is
  const isText =
    mimeType.startsWith("text/") || mimeType === "application/json";
  const content = isText
    ? filePart.data.toString("utf-8")
    : filePart.data.toString("base64");

  const owner = await resolveOwner(event, shared);
  const resource = await resourcePut(owner, path, content, mimeType);

  setResponseStatus(event, 201);
  return resource;
}
