import Ajv, { type ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";

import type { ActionRunContext } from "../../action.js";
import type { ActionEntry } from "../../agent/production-agent.js";
import { assertRegisteredActionAccess } from "../../authorization/action-access-runtime.js";
import { isMcpToolAllowedForRequest } from "../../mcp-client/visibility.js";
import { ForbiddenError } from "../../sharing/access.js";
import { getRequestOrgId, getRequestUserEmail } from "../request-context.js";

/**
 * The agent loop a request runs on: interactive chat (production or dev), an
 * A2A task, or an MCP `ask_app` call.
 */
export type AgentChatAdditionalActionsSurface = "chat" | "a2a" | "mcp";

/** Surfaces an app must opt into before its additional actions reach them. */
export type AgentChatAdditionalActionsExternalSurface = Exclude<
  AgentChatAdditionalActionsSurface,
  "chat"
>;

export interface AgentChatAdditionalActionsDetails {
  surface: AgentChatAdditionalActionsSurface;
  /** The H3 event. Absent for `mcp`, which runs outside a chat handler. */
  event?: any;
  ownerEmail: string;
  orgId: string | null;
}

export type ResolveAgentChatAdditionalActions = (
  details: AgentChatAdditionalActionsDetails,
) => Record<string, ActionEntry> | Promise<Record<string, ActionEntry>>;

export interface AppAdditionalActionsConfig {
  resolver: ResolveAgentChatAdditionalActions | undefined;
  /** Surfaces besides chat the app opted into. */
  externalSurfaces: readonly AgentChatAdditionalActionsExternalSurface[];
  /**
   * True for every name any surface can dispatch to a framework, template, or
   * dev implementation, including names the current surface leaves out.
   */
  isReservedName: (name: string) => boolean;
}

const EXTERNAL_SURFACES: readonly AgentChatAdditionalActionsExternalSurface[] =
  ["a2a", "mcp"];

// The shape every model provider accepts for a tool name.
const ACTION_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TITLE_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 2_000;
const MAX_SCHEMA_JSON_CHARS = 64_000;
const MAX_SCHEMA_DEPTH = 24;
// C0/C1 controls other than tab and newline, zero-width characters, and bidi
// overrides: invisible in logs and tool lists, but read by the model.
const HIDDEN_TEXT_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;

const strictAjv = new Ajv({
  strict: false,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
const strictAjv2020 = new Ajv2020({
  strict: false,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});

const reportedSkips = new Set<string>();

export function normalizeAdditionalActionSurfaces(
  surfaces: readonly string[] | undefined,
): AgentChatAdditionalActionsExternalSurface[] {
  if (surfaces === undefined) return [];
  if (!Array.isArray(surfaces)) {
    throw new TypeError("additionalActionSurfaces must be an array");
  }
  const normalized = new Set<AgentChatAdditionalActionsExternalSurface>();
  for (const surface of surfaces) {
    if (
      !EXTERNAL_SURFACES.includes(
        surface as AgentChatAdditionalActionsExternalSurface,
      )
    ) {
      throw new TypeError(
        `additionalActionSurfaces contains "${String(surface)}"; expected "a2a" or "mcp". Interactive chat always receives additional actions.`,
      );
    }
    normalized.add(surface as AgentChatAdditionalActionsExternalSurface);
  }
  return [...normalized];
}

/**
 * Runs the app's `resolveAdditionalActions` once for one request and returns
 * the entries that may join that request's registry.
 *
 * Everything the app returns is untrusted: it may carry names, descriptions,
 * and schemas a user registered. An entry is dropped (and reported once) when
 * its name is malformed or reserved, when it is an `mcp__` name this caller
 * cannot see, or when its tool definition is unusable. Each kept entry is bound
 * to the caller it was resolved for and its `run` is wrapped so every call,
 * from any dispatcher, rechecks that caller, enforces the entry's `access`
 * policy, and validates the arguments against its schema without coercion.
 */
export async function resolveAppAdditionalActions(
  config: AppAdditionalActionsConfig,
  details: {
    surface: AgentChatAdditionalActionsSurface;
    event?: any;
    ownerEmail: string | null | undefined;
    orgId: string | null | undefined;
  },
  registered: Record<string, ActionEntry>,
): Promise<Record<string, ActionEntry>> {
  const { resolver } = config;
  const { ownerEmail, surface } = details;
  if (!resolver || !ownerEmail) return {};
  if (surface !== "chat" && !config.externalSurfaces.includes(surface)) {
    return {};
  }
  const principal = { ownerEmail, orgId: details.orgId ?? null };
  const entries = await resolver({
    surface,
    event: details.event,
    ...principal,
  });
  if (!isPlainRecord(entries)) {
    throw new TypeError(
      "resolveAdditionalActions must return an object of action entries",
    );
  }
  const added: Record<string, ActionEntry> = {};
  for (const [name, entry] of Object.entries(entries)) {
    const rejection =
      rejectActionName(name, config, registered) ?? rejectActionEntry(entry);
    if (rejection) {
      reportSkip(name, rejection);
      continue;
    }
    const prepared = prepareActionEntry(name, entry as ActionEntry, principal);
    if (typeof prepared === "string") {
      reportSkip(name, prepared);
      continue;
    }
    added[name] = prepared;
  }
  return added;
}

function rejectActionName(
  name: string,
  config: AppAdditionalActionsConfig,
  registered: Record<string, ActionEntry>,
): string | null {
  if (!ACTION_NAME_PATTERN.test(name)) {
    return "is not a valid action name (letters, digits, '_' and '-', at most 64 characters)";
  }
  if (Object.hasOwn(registered, name) || config.isReservedName(name)) {
    return "is a registered action name";
  }
  if (name.startsWith("mcp__") && !isMcpToolAllowedForRequest(name)) {
    return "is an MCP tool name this caller cannot use";
  }
  return null;
}

function rejectActionEntry(entry: unknown): string | null {
  if (!isPlainRecord(entry)) return "is not an action entry";
  if (typeof entry.run !== "function") return "has no run function";
  if (!isPlainRecord(entry.tool)) return "has no tool definition";
  if (typeof entry.tool.description !== "string") {
    return "has no tool description";
  }
  return null;
}

function prepareActionEntry(
  name: string,
  entry: ActionEntry,
  principal: { ownerEmail: string; orgId: string | null },
): ActionEntry | string {
  const description = cleanText(entry.tool.description, MAX_DESCRIPTION_CHARS);
  if (!description) return "has an empty tool description";
  const title =
    typeof entry.tool.title === "string"
      ? cleanText(entry.tool.title, MAX_TITLE_CHARS)
      : undefined;
  const parameters = entry.tool.parameters;
  let validate: ValidateFunction;
  if (parameters === undefined) {
    validate = strictAjv.compile({ type: "object" });
  } else {
    const rejection = rejectParameterSchema(parameters);
    if (rejection) return rejection;
    try {
      validate = compileStrict(parameters);
    } catch (error) {
      return `has a tool schema that does not compile: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const { title: _untrustedTitle, ...tool } = entry.tool;
  const run = entry.run;
  const access = entry.access;
  return {
    ...entry,
    tool: { ...tool, ...(title ? { title } : {}), description },
    run: async (args: unknown, ctx?: ActionRunContext) => {
      const caller = assertBoundCaller(name, principal, ctx);
      const input = args === undefined ? {} : args;
      if (!validate(input)) {
        throw new TypeError(
          `Invalid arguments for ${name}: ${strictAjv.errorsText(validate.errors, { dataVar: "input", separator: "; " })}`,
        );
      }
      if (access) {
        await assertRegisteredActionAccess(access, input, {
          ...ctx,
          caller: ctx?.caller ?? "tool",
          userEmail: caller.userEmail,
          orgId: caller.orgId,
        });
      }
      return run(input, ctx);
    },
  };
}

/**
 * The entry was resolved for one caller. Whatever dispatcher reaches it — the
 * agent loop, tool orchestration, run-code, a sub-agent — must be running for
 * that same caller, so an entry that escapes its request still cannot act for
 * anyone else.
 */
function assertBoundCaller(
  name: string,
  principal: { ownerEmail: string; orgId: string | null },
  ctx: ActionRunContext | undefined,
): { userEmail: string; orgId: string | null } {
  const userEmail = ctx?.userEmail ?? getRequestUserEmail();
  const orgId =
    ctx && Object.hasOwn(ctx, "orgId")
      ? (ctx.orgId ?? null)
      : (getRequestOrgId() ?? null);
  if (
    !userEmail ||
    userEmail.trim().toLowerCase() !==
      principal.ownerEmail.trim().toLowerCase() ||
    orgId !== principal.orgId ||
    (name.startsWith("mcp__") && !isMcpToolAllowedForRequest(name))
  ) {
    throw new ForbiddenError(`${name} is not available to this caller.`);
  }
  return { userEmail, orgId };
}

function rejectParameterSchema(parameters: unknown): string | null {
  if (!isPlainRecord(parameters))
    return "has a tool schema that is not an object";
  if (parameters.type !== "object") {
    return 'has a tool schema whose root type is not "object"';
  }
  if (
    parameters.properties !== undefined &&
    !isPlainRecord(parameters.properties)
  ) {
    return "has a tool schema whose properties are not an object";
  }
  let json: string;
  try {
    json = JSON.stringify(parameters);
  } catch {
    return "has a tool schema that is not JSON";
  }
  if (json.length > MAX_SCHEMA_JSON_CHARS) {
    return `has a tool schema larger than ${MAX_SCHEMA_JSON_CHARS} characters`;
  }
  if (schemaDepth(parameters) > MAX_SCHEMA_DEPTH) {
    return `has a tool schema nested deeper than ${MAX_SCHEMA_DEPTH} levels`;
  }
  return null;
}

function compileStrict(schema: object): ValidateFunction {
  const declared = (schema as { $schema?: unknown }).$schema;
  const dialect =
    typeof declared === "string" ? declared.replace(/#$/, "") : undefined;
  return dialect === "https://json-schema.org/draft/2020-12/schema"
    ? strictAjv2020.compile(schema)
    : strictAjv.compile(schema);
}

function schemaDepth(value: unknown, depth = 0): number {
  if (depth > MAX_SCHEMA_DEPTH) return depth;
  if (!value || typeof value !== "object") return depth;
  let max = depth;
  for (const child of Object.values(value)) {
    max = Math.max(max, schemaDepth(child, depth + 1));
    if (max > MAX_SCHEMA_DEPTH) break;
  }
  return max;
}

function cleanText(value: string, maxChars: number): string {
  const cleaned = value.replace(HIDDEN_TEXT_PATTERN, "").trim();
  return cleaned.length > maxChars
    ? `${cleaned.slice(0, maxChars - 1)}…`
    : cleaned;
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function reportSkip(name: string, reason: string): void {
  const key = `${name}\u0000${reason}`;
  if (reportedSkips.has(key)) return;
  reportedSkips.add(key);
  console.warn(
    `[agent-chat] resolveAdditionalActions returned ${JSON.stringify(name.slice(0, 80))}, which ${reason}; ignoring the app entry.`,
  );
}
