import type {
  InputRequiredResult,
  ServerContext,
} from "@modelcontextprotocol/server";

import {
  actionCallEmitsChange,
  actionChangeResource,
} from "../action-call-classification.js";
import type { ActionEntry } from "../agent/production-agent.js";
import {
  describeToolResultImages,
  extractAgentImagesFromActionResult,
} from "../agent/tool-result-images.js";
import { isMcpActionResult } from "../mcp-client/app-result.js";
import { writeActionChangeMarker } from "../server/action-change-marker-write.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import { describeMcpError } from "./analytics.js";
import {
  actionApprovalError,
  buildLinkArtifacts,
  conciseMcpAppToolText,
  conciseToolResultText,
  hasVerifiedMcpUserIdentity,
  MCP_ACTION_APPROVAL_INPUT_KEY,
  type MCPActionEntry,
  type MCPCallerIdentity,
  type MCPConfig,
  type MCPRequestMeta,
  mcpAppEmbedOpenLinkMeta,
  mcpAppStructuredContent,
  mcpAppWidgetsEnabledForIdentity,
  mcpDirectoryWidgetCapabilityForTool,
  mcpDirectoryWidgetSourceMeta,
  mcpResultHasContent,
  metadataObject,
  openAiToolResultMeta,
  PRESERVE_MCP_OBJECT_RESULT,
  resolveMcpAppResourceSafely,
  returnsQueryPayload,
  withoutMcpAppEmbedTicket,
  withServerMintedMcpAppEmbedStart,
} from "./build-server.js";
import { mcpCallAttribution } from "./call-attribution.js";
import {
  isReportedProxyError,
  mcpActionErrorCode,
  runMcpActionCallUnredacted,
  type McpActionApprovalState,
  type McpActionCallContext,
} from "./execute-action-call.js";

/**
 * The direct `tools/call` adapter's action branch, and the only caller of
 * `runMcpActionCallUnredacted`. It turns the raw outcome into the wire result
 * MCP clients have always received, inside this module, so what it exports
 * runs an action call and returns that wire result: never a raw result, and
 * never the unredacted call itself. `guard:mcp-unredacted-call-boundary`
 * holds this module to that export and build-server.ts to being its only
 * importer.
 */

/** The per-request server state the action branch reads. */
export interface DirectActionCallScope {
  config: MCPConfig;
  actions: Record<string, ActionEntry>;
  advertisedActions: Record<string, ActionEntry>;
  visibleActions: Record<string, ActionEntry>;
  fullCatalogRequested: boolean;
  directoryCatalog: boolean;
  requestMeta: MCPRequestMeta | undefined;
  effectiveIdentity: MCPCallerIdentity | undefined;
  actionCallContext: McpActionCallContext;
  acceptedContent: (typeof import("@modelcontextprotocol/server"))["acceptedContent"];
  requestMcpActionApproval: (
    approvalState: McpActionApprovalState,
    name: string,
    ctx: ServerContext,
  ) => Promise<InputRequiredResult>;
}

/** The analytics record of a call that failed. */
export interface DirectActionCallFailure {
  errorType: string;
  errorMessage: string;
}

export function createDirectActionCall(scope: DirectActionCallScope) {
  const {
    config,
    actions,
    advertisedActions,
    visibleActions,
    fullCatalogRequested,
    directoryCatalog,
    requestMeta,
    effectiveIdentity,
    actionCallContext,
    acceptedContent,
    requestMcpActionApproval,
  } = scope;

  return async (
    call: { name: string; args: any; request: any; ctx: ServerContext },
    fail: (failure: DirectActionCallFailure) => void,
  ) => {
    const { name, args, request, ctx } = call;
    const callableActions = fullCatalogRequested ? actions : advertisedActions;
    const outcome = await runMcpActionCallUnredacted(actionCallContext, {
      name,
      args,
      callable: callableActions,
      actionRunContext: (clientAccepted) =>
        mcpCallAttribution({
          request,
          envelope: ctx.mcpReq.envelope,
          oauthClientId: effectiveIdentity?.oauthClientId,
          clientAccepted,
        }),
      approval: {
        state: () =>
          ctx.mcpReq.requestState<McpActionApprovalState>() ?? undefined,
        decision: () =>
          (
            acceptedContent(
              ctx.mcpReq.inputResponses,
              MCP_ACTION_APPROVAL_INPUT_KEY,
            ) as Record<string, unknown> | undefined
          )?.decision,
      },
    });
    if (outcome.status === "unknown-tool") {
      fail({
        errorType: "unknown_tool",
        errorMessage: outcome.message,
      });
      return {
        content: [{ type: "text", text: outcome.message }],
        isError: true,
      };
    }
    if (outcome.status === "forbidden-scope") {
      fail({
        errorType: "forbidden_scope",
        errorMessage: outcome.message,
      });
      return {
        content: [{ type: "text", text: `Forbidden: ${outcome.message}` }],
        isError: true,
      };
    }
    if (outcome.status === "approval-denied") {
      return actionApprovalError(outcome.message);
    }

    const toolCallError = (err: any) => {
      const errorCode = mcpActionErrorCode(err);
      fail(describeMcpError(err));
      const projectedError =
        directoryCatalog && config.directoryProfile?.projectResult
          ? config.directoryProfile.projectResult(name, err.message)
          : err.message;
      return {
        content: [
          {
            type: "text",
            text: `Error: ${typeof projectedError === "string" ? projectedError : err.message}${errorCode !== undefined ? ` (errorCode: ${errorCode})` : ""}`,
          },
        ],
        isError: true,
      };
    };
    if (outcome.status === "threw") return toolCallError(outcome.error);

    try {
      if (outcome.status === "approval-required") {
        return await requestMcpActionApproval(outcome.approval, name, ctx);
      }

      const { entry, result } = outcome;
      const mcpResult = isMcpActionResult(result) ? result : null;
      const rawResult = mcpResult ? mcpResult.raw : result;
      const resultForClient = mcpResult ? mcpResult.text : result;
      const projectDirectoryResult = directoryCatalog
        ? config.directoryProfile?.projectResult
        : undefined;
      const projectedRawResult = projectDirectoryResult
        ? projectDirectoryResult(name, rawResult)
        : rawResult;
      const projectedResultForClient = projectDirectoryResult
        ? projectDirectoryResult(name, resultForClient)
        : resultForClient;
      // Read after projection: a directory projector may rewrite the
      // proxied value it is handed, including its error flag.
      const mcpResultIsError = isReportedProxyError(mcpResult);
      const mcpAppResourceCandidate =
        requestMeta?.inlineMcpApps &&
        mcpAppWidgetsEnabledForIdentity(config, effectiveIdentity)
          ? await resolveMcpAppResourceSafely(config, name, entry, requestMeta)
          : null;
      let directoryLinkUrl: string | undefined;
      if (config.catalogMode === "directory" && entry.link) {
        const linked = entry.link({
          args: (args as Record<string, any>) ?? {},
          result: rawResult,
        });
        directoryLinkUrl = linked?.url ?? undefined;
      }
      const trustedCredentialIssuedAtMs =
        effectiveIdentity?.mcpCredentialIssuedAtMs;
      const directoryWidget =
        directoryCatalog &&
        mcpAppResourceCandidate &&
        typeof trustedCredentialIssuedAtMs === "number" &&
        Number.isSafeInteger(trustedCredentialIssuedAtMs)
          ? await mcpDirectoryWidgetCapabilityForTool(
              config,
              mcpAppResourceCandidate,
              name,
              (args as Record<string, unknown>) ?? {},
              projectedRawResult,
              visibleActions,
              effectiveIdentity,
            )
          : undefined;
      const missingDirectoryWidgetCapability =
        directoryCatalog &&
        config.directoryProfile !== undefined &&
        mcpAppResourceCandidate !== null &&
        directoryWidget === undefined;
      const suppressDirectoryWidget =
        directoryCatalog && !hasVerifiedMcpUserIdentity(effectiveIdentity);
      // The host mounts a widget for this tool from its descriptor, with or
      // without a ticket in the result, so a withheld ticket must be visible.
      if (
        missingDirectoryWidgetCapability &&
        !suppressDirectoryWidget &&
        !mcpResultIsError
      ) {
        console.warn(
          `[mcp:directory] ${name} returned no widget session ticket: ${
            typeof trustedCredentialIssuedAtMs === "number"
              ? "the result has no widget target or scoped actions"
              : "the credential carries no issue time"
          }.`,
        );
      }
      const rawResultForClient =
        missingDirectoryWidgetCapability || suppressDirectoryWidget
          ? withoutMcpAppEmbedTicket(projectedRawResult)
          : mcpAppResourceCandidate
            ? await withServerMintedMcpAppEmbedStart(
                projectedRawResult,
                requestMeta,
                directoryLinkUrl,
                directoryWidget,
              )
            : projectedRawResult;
      if (
        directoryWidget &&
        typeof metadataObject(rawResultForClient).embedStartUrl !== "string"
      ) {
        console.error(
          `[mcp:directory] ${name} built a widget capability but issued no session ticket.`,
        );
      }
      const {
        value: actionResultForClient,
        images: resultImages,
        notes: resultImageNotes,
      } = extractAgentImagesFromActionResult(rawResultForClient);
      const textResultForClient = mcpResult
        ? projectedResultForClient
        : actionResultForClient;
      const embedHasContent =
        resultImages.length > 0 || mcpResultHasContent(actionResultForClient);
      const mcpAppResource =
        mcpAppResourceCandidate &&
        !missingDirectoryWidgetCapability &&
        !mcpResultIsError &&
        embedHasContent
          ? mcpAppResourceCandidate
          : null;
      const embedProducedNothing =
        !!mcpAppResourceCandidate && !mcpResultIsError && !embedHasContent;
      const { block, _meta } = buildLinkArtifacts(
        entry,
        (args as Record<string, any>) ?? {},
        actionResultForClient,
        requestMeta,
      );
      const mcpAppOpenLinkMeta = mcpAppResource
        ? mcpAppEmbedOpenLinkMeta(
            actionResultForClient,
            mcpAppResource,
            requestMeta,
          )
        : {};
      const responseMeta: Record<string, unknown> = {
        ...(_meta ?? {}),
        ...(directoryCatalog && mcpAppResource
          ? mcpDirectoryWidgetSourceMeta(name, mcpAppOpenLinkMeta)
          : {}),
        ...mcpAppOpenLinkMeta,
        ...(mcpAppResource
          ? openAiToolResultMeta(mcpAppResource, directoryCatalog)
          : {}),
      };
      const toolUiMeta = metadataObject((entry.tool as any)._meta?.ui);
      const toolVisibility = toolUiMeta.visibility;
      const isAppOnlyVisibility =
        Array.isArray(toolVisibility) &&
        toolVisibility.length > 0 &&
        toolVisibility.every((v) => v === "app");
      const structuredResult =
        (returnsQueryPayload(entry) ||
          entry.mcpApp?.structuredContent === true) &&
        actionResultForClient &&
        typeof actionResultForClient === "object"
          ? Array.isArray(actionResultForClient)
            ? { items: actionResultForClient }
            : actionResultForClient
          : undefined;
      const structuredContent = mcpAppResource
        ? mcpAppStructuredContent(actionResultForClient, responseMeta)
        : isAppOnlyVisibility &&
            actionResultForClient &&
            typeof actionResultForClient === "object" &&
            !Array.isArray(actionResultForClient)
          ? (actionResultForClient as Record<string, unknown>)
          : structuredResult
            ? mcpAppStructuredContent(structuredResult, responseMeta)
            : undefined;
      const text = mcpAppResource
        ? conciseMcpAppToolText(name, textResultForClient, structuredContent!)
        : conciseToolResultText(name, textResultForClient, {
            preserveObjectResult:
              returnsQueryPayload(entry) ||
              (entry as MCPActionEntry)[PRESERVE_MCP_OBJECT_RESULT] === true,
          });
      const imageNotes = [
        ...describeToolResultImages(resultImages),
        ...resultImageNotes,
      ];
      const content: any[] = [
        {
          type: "text",
          text:
            imageNotes.length > 0
              ? `${text}\n\n${imageNotes.join("\n")}`
              : text,
        },
      ];
      for (const image of resultImages) {
        if (!image.data || !image.mediaType) continue;
        content.push({
          type: "image",
          data: image.data,
          mimeType: image.mediaType,
        });
      }
      if (block) content.push(block);
      const response = {
        content,
        ...(mcpResultIsError || embedProducedNothing ? { isError: true } : {}),
        ...(structuredContent ? { structuredContent } : {}),
        ...(Object.keys(responseMeta).length > 0
          ? { _meta: responseMeta }
          : {}),
      };
      if (
        response.isError !== true &&
        actionCallEmitsChange(entry, args, false)
      ) {
        try {
          await writeActionChangeMarker({
            actionName: name,
            ...actionChangeResource(entry, args, rawResult),
            owner: getRequestUserEmail() ?? undefined,
            orgId: getRequestOrgId() ?? undefined,
          });
        } catch (error) {
          console.warn(
            "Could not write the action-change marker after an MCP tool call",
            error,
          );
        }
      }
      return response;
    } catch (err: any) {
      return toolCallError(err);
    }
  };
}
