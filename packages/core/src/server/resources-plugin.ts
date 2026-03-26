import { defineEventHandler, setResponseStatus, getMethod } from "h3";
import {
  handleListResources,
  handleGetResourceTree,
  handleGetResource,
  handleCreateResource,
  handleUpdateResource,
  handleDeleteResource,
  handleUploadResource,
} from "../resources/handlers.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

/**
 * Creates a Nitro plugin that mounts all resource CRUD routes.
 *
 * Routes:
 *   GET    /api/resources          — list resources
 *   POST   /api/resources          — create resource
 *   GET    /api/resources/tree     — get resource tree
 *   POST   /api/resources/upload   — upload file
 *   GET    /api/resources/:id      — get resource by ID
 *   PUT    /api/resources/:id      — update resource
 *   DELETE /api/resources/:id      — delete resource
 */
export function createResourcesPlugin(): NitroPluginDef {
  return async (nitroApp: any) => {
    // Mount specific sub-routes BEFORE the catch-all

    nitroApp.h3App.use(
      "/api/resources/tree",
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return handleGetResourceTree(event);
      }),
    );

    nitroApp.h3App.use(
      "/api/resources/upload",
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return handleUploadResource(event);
      }),
    );

    // Catch-all for /api/resources and /api/resources/:id
    nitroApp.h3App.use(
      "/api/resources",
      defineEventHandler(async (event) => {
        const method = getMethod(event);
        const url = event.path || event.node?.req?.url || "";

        // Strip the base path to get the sub-path
        const subPath = url.replace(/^\/api\/resources\/?/, "").split("?")[0];

        // No sub-path: /api/resources — list or create
        if (!subPath || subPath === "") {
          if (method === "GET") return handleListResources(event);
          if (method === "POST") return handleCreateResource(event);
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }

        // Already handled by dedicated routes above
        if (subPath === "tree" || subPath === "upload") return;

        // /api/resources/:id — get, update, delete
        event.context.params = { ...event.context.params, id: subPath };

        if (method === "GET") return handleGetResource(event);
        if (method === "PUT") return handleUpdateResource(event);
        if (method === "DELETE") return handleDeleteResource(event);

        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }),
    );
  };
}

/**
 * Default resources plugin — mount with no configuration needed.
 *
 * Usage in templates:
 * ```ts
 * // server/plugins/resources.ts
 * import { defaultResourcesPlugin } from "@agent-native/core/server";
 * export default defaultResourcesPlugin;
 * ```
 */
export const defaultResourcesPlugin: NitroPluginDef = createResourcesPlugin();
