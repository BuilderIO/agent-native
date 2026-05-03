import {
  getH3App,
  markDefaultPluginProvided,
} from "./framework-request-handler.js";
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
 *   GET    /_agent-native/resources          — list resources
 *   POST   /_agent-native/resources          — create resource
 *   GET    /_agent-native/resources/tree     — get resource tree
 *   POST   /_agent-native/resources/upload   — upload file
 *   GET    /_agent-native/resources/:id      — get resource by ID
 *   PUT    /_agent-native/resources/:id      — update resource
 *   DELETE /_agent-native/resources/:id      — delete resource
 */
export function createResourcesPlugin(): NitroPluginDef {
  return async (nitroApp: any) => {
    markDefaultPluginProvided(nitroApp, "resources");
    // Mount specific sub-routes BEFORE the catch-all

    getH3App(nitroApp).use(
      "/_agent-native/resources/tree",
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return handleGetResourceTree(event);
      }),
    );

    getH3App(nitroApp).use(
      "/_agent-native/resources/upload",
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return handleUploadResource(event);
      }),
    );

    // Catch-all for /_agent-native/resources and /_agent-native/resources/:id
    getH3App(nitroApp).use(
      "/_agent-native/resources",
      defineEventHandler(async (event) => {
        const method = getMethod(event);
        // h3 strips the mount prefix, so event.path is "/" or "/:id"
        const raw = (event.path || "/").split("?")[0];
        const subPath = raw.replace(/^\//, "");

        // No sub-path: /_agent-native/resources — list or create
        if (!subPath || subPath === "") {
          if (method === "GET") return handleListResources(event);
          if (method === "POST") return handleCreateResource(event);
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }

        // Already handled by dedicated routes above
        if (subPath === "tree" || subPath === "upload") return;

        // /_agent-native/resources/:id — get, update, delete
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
