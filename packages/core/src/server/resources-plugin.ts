import { defineEventHandler, setResponseStatus, getMethod } from "h3";

import {
  handleListResources,
  handleGetResourceTree,
  handleGetEffectiveResourceContext,
  handleGetResource,
  handleCreateResource,
  handleUpdateResource,
  handleDeleteResource,
  handleUploadResource,
} from "../resources/handlers.js";
import {
  getH3App,
  markDefaultPluginProvided,
} from "./framework-request-handler.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export function createResourcesPlugin(): NitroPluginDef {
  return async (nitroApp: any) => {
    markDefaultPluginProvided(nitroApp, "resources");

    getH3App(nitroApp).use(
      "/_agent-native/resources/effective",
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return handleGetEffectiveResourceContext(event);
      }),
    );

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

    getH3App(nitroApp).use(
      "/_agent-native/resources",
      defineEventHandler(async (event) => {
        const method = getMethod(event);
        const raw = (event.path || "/").split("?")[0];
        const subPath = raw.replace(/^\//, "");

        if (!subPath || subPath === "") {
          if (method === "GET") return handleListResources(event);
          if (method === "POST") return handleCreateResource(event);
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }

        if (
          subPath === "effective" ||
          subPath === "tree" ||
          subPath === "upload"
        )
          return;

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

export const defaultResourcesPlugin: NitroPluginDef = createResourcesPlugin();
