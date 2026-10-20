import type {
  AgentLoopFinalResponseGuardContext,
  AgentLoopFinalResponseGuardResult,
} from "@agent-native/core/server";

const DOMAIN_OPERATION_PATTERN =
  /\b(create|add|make|build|update|edit|delete|remove|list|show|open|save|publish|submit|send|export|import)\b/i;

const EXPLICIT_EXTEND_APP_PATTERN =
  /\b(extend (this |the )?app|add (a |the )?(feature|capability|page|route|screen|action|ui)|scaffold|implement (a |the )?(feature|app)|wire up|build (this |the )?app|new action|create (a |an )?action|agent-native|defineAction)\b/i;

const SOURCE_HANDOFF_PATTERN =
  /\b(actions\/|app\/|server\/|drizzle\/|schema\.ts|\.tsx|source code|source files?|edit the (file|code)|I'll (create|add|update|modify|write)|I will (create|add|update|modify|write)|let me (create|add|update|modify|write)|pnpm action)\b/i;

const APP_ACTION_PREFIXES = [
  "create-",
  "update-",
  "delete-",
  "list-",
  "get-",
  "add-",
  "remove-",
  "export-",
  "import-",
  "patch-",
  "search-",
  "preview-",
  "navigate",
  "view-screen",
] as const;

const RETRY_MESSAGE =
  "The user asked to operate on app data or domain objects. Before editing source or proposing a code change, call tool-search with a specific query for their request, then call the matching registered app action if one exists. Only extend source when no registered action can complete the request.";

function latestUserText(
  messages: AgentLoopFinalResponseGuardContext["messages"],
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) continue;
    return content
      .filter(
        (part): part is { type: "text"; text: string } =>
          !!part &&
          typeof part === "object" &&
          (part as { type?: string }).type === "text" &&
          typeof (part as { text?: string }).text === "string",
      )
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

function looksLikeDomainOperationRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || EXPLICIT_EXTEND_APP_PATTERN.test(trimmed)) return false;
  return DOMAIN_OPERATION_PATTERN.test(trimmed);
}

function calledToolSearch(
  toolCalls: AgentLoopFinalResponseGuardContext["toolCalls"],
): boolean {
  return toolCalls.some((call) => call.name === "tool-search");
}

function calledAppFacingTool(
  toolCalls: AgentLoopFinalResponseGuardContext["toolCalls"],
): boolean {
  return toolCalls.some((call) => {
    if (APP_ACTION_PREFIXES.some((prefix) => call.name.startsWith(prefix))) {
      return true;
    }
    if (call.name !== "bash") return false;
    const command = String(
      (call.input as { command?: string } | undefined)?.command ?? "",
    );
    return /\bpnpm action\b/.test(command);
  });
}

function usedSourceEditTools(
  toolCalls: AgentLoopFinalResponseGuardContext["toolCalls"],
): boolean {
  return toolCalls.some((call) =>
    ["bash", "read", "edit", "write", "grep"].includes(call.name),
  );
}

function proposesSourceHandoff(text: string): boolean {
  return SOURCE_HANDOFF_PATTERN.test(text);
}

export function appOperationFinalResponseGuard(
  context: AgentLoopFinalResponseGuardContext,
): AgentLoopFinalResponseGuardResult | null {
  if (context.executionMode === "plan") return null;

  const requestText = context.requestText ?? latestUserText(context.messages);
  if (!looksLikeDomainOperationRequest(requestText)) return null;
  if (calledToolSearch(context.toolCalls)) return null;
  if (calledAppFacingTool(context.toolCalls)) return null;

  if (
    !proposesSourceHandoff(context.text) &&
    !usedSourceEditTools(context.toolCalls)
  ) {
    return null;
  }

  return {
    retryMessage: RETRY_MESSAGE,
    expandToolSurface: true,
    maxRetries: 1,
  };
}
