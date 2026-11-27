import { defineAction } from "@agent-native/core/action";
import { decide } from "@agent-native/core/decisions";
import type { DecisionInputPart } from "@agent-native/core/decisions";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { classifyDataIntent } from "../lib/data-intent.js";
import { matchDispatchAppCandidates } from "../lib/dispatch-app-identity.js";
import { listGrantedDispatchMcpApps } from "../server/lib/mcp-gateway.js";
import { listPointers, matchPointer } from "../server/lib/pointers-store.js";

const QUESTION = "app";
const NONE = "none";
// Bump when the question or choice wording changes so cached answers to the
// old wording are not replayed.
const CACHE_KEY = "dispatch.route-app-intent.v5";

type RouteAppIntentResult =
  | {
      status: "ok";
      app: string;
      confidence: number;
      explicit?: true;
      screen?: "home";
      params?: Record<string, string>;
      provider: string;
      model: string;
      cached: boolean;
      latencyMs: number;
      /** Set when the request named a saved pointer: open this object. */
      pointer?: boolean;
      objectId?: string;
      url?: string;
    }
  | {
      status: "not_configured" | "failed";
      reason: string;
      latencyMs?: number;
    };

async function listPointersOrNone(ownerEmail: string) {
  try {
    return await listPointers(ownerEmail, getRequestOrgId());
  } catch (error) {
    console.warn("[route-app-intent] pointer read failed", error);
    return [];
  }
}

export default defineAction({
  description:
    'Pick which granted workspace app should be on screen for a chat request, or "none" for a chat-only answer. Choices come from the apps granted to this Dispatch, so a new app routes without code changes. A matching saved pointer (remember-pointer) can identify an object to open.',
  schema: z.object({
    text: z.string().trim().min(1).max(4000).describe("The user's request."),
    openApp: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe("Id of the app currently on screen, if any."),
    openPath: z.string().max(2000).optional(),
    selection: z.string().max(4000).optional(),
    previousTurn: z
      .union([z.string().max(4000), z.record(z.string(), z.unknown())])
      .optional()
      .describe(
        "The previous turn (text or a small object), so follow-ups keep their app.",
      ),
  }),
  outputSchema: z.union([
    z.object({
      status: z.literal("ok"),
      app: z.string(),
      confidence: z.number().min(0).max(1),
      explicit: z.literal(true).optional(),
      screen: z.literal("home").optional(),
      params: z.record(z.string(), z.string()).optional(),
      provider: z.string(),
      model: z.string(),
      cached: z.boolean(),
      latencyMs: z.number(),
      pointer: z.boolean().optional(),
      objectId: z.string().optional(),
      url: z.string().optional(),
    }),
    z.object({
      status: z.enum(["not_configured", "failed"]),
      reason: z.string(),
      latencyMs: z.number().optional(),
    }),
  ]),
  readOnly: true,
  parallelSafe: true,
  agentTool: false,
  // Desktop clients call it over MCP; the in-app agent never sees it.
  mcpTool: true,
  run: async ({
    text,
    openApp,
    openPath,
    selection,
    previousTurn,
  }): Promise<RouteAppIntentResult> => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail)
      return { status: "failed", reason: "no_authenticated_user" };

    const [apps, pointers] = await Promise.all([
      listGrantedDispatchMcpApps(),
      listPointersOrNone(ownerEmail),
    ]);
    const grantedPointers = pointers.filter((pointer) =>
      apps.some((app) => app.id === pointer.appId),
    );
    const choices = [
      ...apps.map((app) => ({
        value: app.id,
        description: app.description
          ? `${app.name}: ${app.description}`
          : app.name,
      })),
      {
        value: NONE,
        description:
          "No app: a general question or chat answer that needs no app on screen.",
      },
    ];
    if (choices.length === 1) {
      return { status: "failed", reason: "no_granted_apps" };
    }

    const explicitName = /^(?:open|show|switch to|go to)\s+(.+?)[.!]?$/i
      .exec(text)?.[1]
      ?.trim()
      .toLowerCase();
    if (explicitName) {
      const candidates = matchDispatchAppCandidates(apps, explicitName);
      const explicitApp = candidates.length === 1 ? candidates[0] : null;
      if (explicitApp) {
        return {
          status: "ok",
          app: explicitApp.id,
          confidence: 1,
          explicit: true,
          screen: "home",
          provider: "registration",
          model: "exact-app-match",
          cached: false,
          latencyMs: 0,
        };
      }
    }

    const intentApp = classifyDataIntent(text);
    const intentCandidates = intentApp
      ? matchDispatchAppCandidates(apps, intentApp)
      : [];
    const intentCandidate = intentCandidates.at(0);
    if (intentCandidates.length === 1 && intentCandidate) {
      return {
        status: "ok",
        app: intentCandidate.id,
        confidence: 1,
        provider: "routing",
        model: "data-intent",
        cached: false,
        latencyMs: 0,
      };
    }

    const hit = matchPointer(text, grantedPointers);
    if (hit && !openApp) {
      return {
        status: "ok",
        app: hit.appId,
        confidence: 1,
        provider: "pointer",
        model: "alias-match",
        cached: false,
        latencyMs: 0,
        pointer: true,
        ...(explicitName === hit.alias.toLowerCase() ? { explicit: true } : {}),
        ...(hit.objectId ? { objectId: hit.objectId } : {}),
        ...(hit.url ? { url: hit.url } : {}),
      };
    }

    const input: DecisionInputPart[] = [
      { type: "text", text: `Request: ${text}` },
    ];
    input.push({
      type: "json",
      value: {
        connectedWorkspaceApps: apps.map(
          ({ id, name, description, aliases }) => ({
            id,
            name,
            description,
            ...(aliases?.length ? { aliases } : {}),
          }),
        ),
      },
    });
    if (openApp) {
      input.push({ type: "text", text: `App currently on screen: ${openApp}` });
    }
    const routePath = openPath?.split(/[?#]/, 1)[0];
    if (routePath !== undefined || selection !== undefined) {
      input.push({ type: "json", value: { openPath: routePath, selection } });
    }
    if (grantedPointers.length > 0) {
      input.push({
        type: "json",
        value: {
          savedPointers: grantedPointers.map(({ alias, appId }) => ({
            alias,
            appId,
          })),
        },
      });
    }
    if (previousTurn !== undefined) {
      input.push({ type: "json", value: { previousTurn } });
    }

    const started = Date.now();
    const result = await decide({
      ownerEmail,
      input,
      questions: [
        {
          type: "choice",
          name: QUESTION,
          instructions:
            "Which app should be on screen to handle this request? Pick the app whose data or screen the request is about, not an app associated with a service mentioned in that data. Consider the current app for every request, not only follow-ups: keep it when the request concerns its data, and switch only when the user clearly requests another app's data or screen. Notifications or emails about a service are mail data; requests for that service's actual records are different. A saved pointer alias can refer to an object, but a coincidental mention does not override the requested data or current app. Pick none only when no app's data is involved.",
          choices,
        },
      ],
      options: { cacheKey: CACHE_KEY },
    });
    const latencyMs = Date.now() - started;

    if (result.status !== "ok") {
      console.info("[route-app-intent]", {
        status: result.status,
        reason: result.reason,
        latencyMs,
      });
      return { status: result.status, reason: result.reason, latencyMs };
    }

    const answer = result.answers[QUESTION] as
      | (typeof result.answers)[string]
      | undefined;
    const app =
      answer?.type === "choice" &&
      choices.some((choice) => choice.value === answer.choice)
        ? answer.choice
        : null;
    console.info("[route-app-intent]", {
      status: app ? "ok" : "failed",
      app,
      provider: result.provider,
      model: result.model,
      cached: result.cached === true,
      latencyMs,
    });
    if (!app) {
      return {
        status: "failed",
        reason: answer?.type === "refusal" ? "refusal" : "invalid_response",
        latencyMs,
      };
    }
    return {
      status: "ok",
      app,
      confidence:
        answer?.type === "choice" &&
        typeof answer.confidence === "number" &&
        Number.isFinite(answer.confidence)
          ? Math.max(0, Math.min(1, answer.confidence))
          : 0,
      provider: result.provider,
      model: result.model,
      cached: result.cached === true,
      latencyMs,
      ...(hit && app === hit.appId
        ? {
            pointer: true,
            ...(hit.objectId ? { objectId: hit.objectId } : {}),
            ...(hit.url ? { url: hit.url } : {}),
          }
        : {}),
    };
  },
});
