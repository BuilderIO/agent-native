import {
  defineAction,
  embedApp,
  MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
  type ActionMcpAppCsp,
  type ActionMcpAppCspBuilder,
} from "@agent-native/core";
import { z } from "zod";
import {
  listGrantedDispatchMcpAppOrigins,
  openGrantedDispatchMcpApp,
} from "../server/lib/mcp-gateway.js";

const deepLinkParam = z.union([z.string(), z.number(), z.boolean()]);
const openAppSchema = z
  .object({
    app: z
      .string()
      .describe(
        'Granted app id, e.g. mail or calendar. Use "dispatch" for Dispatch-owned pages such as /extensions.',
      ),
    view: z.string().optional().describe("Target view in the app, e.g. inbox."),
    path: z
      .string()
      .optional()
      .describe(
        'Optional route within the target app, e.g. /adhoc/q2 or /chart?panel=... . Dispatch extension routes such as /extensions/<id>/<slug> belong to app "dispatch".',
      ),
    params: z
      .record(z.string(), deepLinkParam)
      .optional()
      .describe("Optional record-focus or filter params."),
    embed: z
      .boolean()
      .optional()
      .describe(
        "Render the app or focused route/component inline in MCP Apps when supported.",
      ),
    chrome: z
      .enum(["full", "minimal"])
      .optional()
      .describe("Embed chrome preference for compatible app routes."),
  })
  .refine((input) => input.view?.trim() || input.path?.trim(), {
    message: "open_app requires either view or path",
    path: ["view"],
  });

type OpenAppArgs = z.infer<typeof openAppSchema>;

function normalizeOpenAppArgs(args: OpenAppArgs): OpenAppArgs {
  if (!args.params) return args;

  const params = { ...args.params };
  const embedded = params.embed;
  const chrome = params.chrome;
  let changed = false;

  let normalizedEmbed = args.embed;
  if (normalizedEmbed == null) {
    if (embedded === true || embedded === "true") {
      normalizedEmbed = true;
      changed = true;
    } else if (embedded === false || embedded === "false") {
      normalizedEmbed = false;
      changed = true;
    }
  }
  if (
    embedded === true ||
    embedded === false ||
    embedded === "true" ||
    embedded === "false"
  ) {
    delete params.embed;
    changed = true;
  }

  let normalizedChrome = args.chrome;
  if (normalizedChrome == null && (chrome === "full" || chrome === "minimal")) {
    normalizedChrome = chrome;
    changed = true;
  }
  if (chrome === "full" || chrome === "minimal") {
    delete params.chrome;
    changed = true;
  }

  if (!changed) return args;
  return {
    ...args,
    params: Object.keys(params).length ? params : undefined,
    ...(normalizedEmbed == null ? {} : { embed: normalizedEmbed }),
    ...(normalizedChrome == null ? {} : { chrome: normalizedChrome }),
  };
}

const localDevFrameSources = ["http://localhost:*", "http://127.0.0.1:*"];

const dispatchOpenAppCsp: ActionMcpAppCspBuilder = async (
  ctx,
): Promise<ActionMcpAppCsp> => {
  const appOrigins = (await listGrantedDispatchMcpAppOrigins()).filter(
    (origin) => !ctx.requestOrigin || origin !== ctx.requestOrigin,
  );
  const routeSources = [
    MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
    ...appOrigins,
    ...localDevFrameSources,
  ];
  return {
    connectDomains: ["https://esm.sh", ...routeSources],
    resourceDomains: ["https://esm.sh", ...routeSources],
    frameDomains: routeSources,
    baseUriDomains: routeSources,
  };
};

const openAppResource = embedApp({
  title: "Open app",
  description: "Render the requested granted app route inline.",
  iframeTitle: "Dispatch MCP app",
  openLabel: "Open app",
});

export default defineAction({
  description:
    'Build a deep link or embeddable app route/component route for an app available through Dispatch MCP. Use app "dispatch" for Dispatch extension/tool pages. No side effects; surface the returned Open link to the user.',
  schema: openAppSchema,
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async (args) => openGrantedDispatchMcpApp(normalizeOpenAppArgs(args)),
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const r = result as { url?: string; app?: string; view?: string };
    if (!r.url) return null;
    return {
      url: r.url,
      label: `Open ${r.app ?? "app"}`,
      view: r.view,
    };
  },
  mcpApp: {
    resource: {
      ...openAppResource,
      csp: dispatchOpenAppCsp,
    },
  },
});
