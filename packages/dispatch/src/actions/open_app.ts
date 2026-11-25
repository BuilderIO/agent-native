import {
  defineAction,
  embedApp,
  MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
  type ActionMcpAppCsp,
  type ActionMcpAppCspBuilder,
} from "@agent-native/core";
import { fail } from "@agent-native/core/action";
import { normalizeTrackingDimension } from "@agent-native/core/shared";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import {
  listGrantedDispatchMcpAppOrigins,
  openGrantedDispatchMcpApp,
} from "../server/lib/mcp-gateway.js";
import routeAppIntent from "./route-app-intent.js";

const deepLinkParam = z.union([z.string(), z.number(), z.boolean()]);
const openAppSchema = z.object({
  app: z
    .string()
    .optional()
    .describe(
      'Granted app id, e.g. mail or calendar. Use "dispatch" for Dispatch-owned pages such as /extensions. Leave it out and pass intent to let Dispatch pick the app.',
    ),
  intent: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .optional()
    .describe(
      "What the user wants to see, in their words (for example: my unread email from Dana). Used to pick the app when app is not given; app wins when both are set.",
    ),
  screen: z
    .string()
    .optional()
    .describe(
      "Declared manifest screen id to resolve with params, e.g. deck or thread.",
    ),
  view: z.string().optional().describe("Target view in the app, e.g. inbox."),
  path: z
    .string()
    .optional()
    .describe(
      'Optional route within the target app, e.g. /adhoc/q2 or /chart?panel=... . Omit both view and path to open the app\'s home. Dispatch extension routes such as /extensions/<id>/<slug> belong to app "dispatch".',
    ),
  params: z
    .record(z.string(), deepLinkParam)
    .optional()
    .describe("Optional record-focus or filter params."),
  focus: z
    .boolean()
    .optional()
    .describe(
      "Explicitly transfer foreground pane focus when another app was already committed during this turn.",
    ),
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

async function pickAppForIntent(
  intent: string,
  ctx: Parameters<typeof routeAppIntent.run>[1],
): Promise<string> {
  const routed = await routeAppIntent.run({ text: intent }, ctx);
  if (routed.status !== "ok") {
    fail(
      `open_app could not pick an app for that intent (${routed.reason}). Pass app explicitly; list_apps shows the choices.`,
      { errorCode: "app_not_resolved", statusCode: 422 },
    );
  }
  if (routed.app === "none") {
    fail(
      "That request needs no app on screen. Answer in chat, or pass app explicitly to open one.",
      { errorCode: "no_app_needed", statusCode: 422 },
    );
  }
  return routed.app;
}

export default defineAction({
  description:
    "Return a registered app route for the host to open beside the conversation to show a view or item such as mail, a draft, a calendar view, a chart, a dashboard, a document, or a record. Accepts an `app` id or a natural-language `intent` to select a matching granted app.",
  schema: openAppSchema,
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  opensAnotherAppEmbed: true,
  run: async (args, ctx) => {
    const { intent, ...normalizedArgs } = normalizeOpenAppArgs(args);
    let app = normalizedArgs.app?.trim();
    if (!app) {
      if (!intent) {
        fail("open_app needs an app, or an intent to pick one.", {
          errorCode: "app_required",
          statusCode: 400,
        });
      }
      app = await pickAppForIntent(intent, ctx);
    }
    const normalized = { ...normalizedArgs, app };
    const result =
      ctx?.caller === "tool"
        ? await openGrantedDispatchMcpApp(normalized, { prefetchEmbed: true })
        : await openGrantedDispatchMcpApp(
            normalized.embed == null && ctx?.caller === "mcp"
              ? { ...normalized, embed: true }
              : normalized,
          );
    const targetApp = normalizeTrackingDimension(result.app) ?? result.app;
    if (targetApp !== "dispatch") {
      track(
        "cross_app_used",
        {
          app_name: "dispatch",
          template_name: "dispatch",
          source_app: "dispatch",
          target_app: targetApp,
          output_type: "app_route",
        },
        ctx,
      );
    }
    // The gateway echoes only `embed: true`; the MCP server reads an explicit
    // `false` to open no panel.
    return normalized.embed === false ? { ...result, embed: false } : result;
  },
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
    compactCatalog: true,
    resource: {
      ...openAppResource,
      csp: dispatchOpenAppCsp,
    },
  },
});
