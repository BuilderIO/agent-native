import type {
  InputRequiredResult,
  ServerContext,
} from "@modelcontextprotocol/server";

import {
  actionCallEmitsChange,
  actionCallIsReadOnly,
  actionChangeResource,
} from "../action-call-classification.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { extractAgentImagesFromActionResult } from "../agent/tool-result-images.js";
import { isMcpActionResult } from "../mcp-client/app-result.js";
import { writeActionChangeMarker } from "../server/action-change-marker-write.js";
import { captureError } from "../server/capture-error.js";
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
  mcpAppOnlyEmbedStartMeta,
  mcpAppStructuredContent,
  mcpAppWidgetsEnabledForIdentity,
  mcpDirectoryWidgetCapabilityForTool,
  mcpDirectoryWidgetSourceMeta,
  mcpResultHasContent,
  metadataObject,
  modelVisibleToolResponse,
  openAiToolResultMeta,
  PRESERVE_MCP_OBJECT_RESULT,
  resolveMcpAppResourceSafely,
  returnsQueryPayload,
  textPagingInputs,
  withheldWriteResponse,
  withoutMcpAppEmbedTicket,
  withServerMintedMcpAppEmbedStart,
} from "./build-server.js";
import { mcpCallAttribution } from "./call-attribution.js";
import {
  embedCredentialSources,
  type EmbedCredentialGuard,
  isReportedProxyError,
  mcpActionErrorCode,
  redactEmbedCredentials,
  redactEmbedText,
  runMcpActionCallUnredacted,
  toJsonData,
  UnreadableResultError,
  upstreamStatus,
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

    const errorText = (err: any) => {
      const projectedError =
        directoryCatalog && config.directoryProfile?.projectResult
          ? config.directoryProfile.projectResult(name, err.message)
          : err.message;
      return String(
        typeof projectedError === "string" ? projectedError : err.message,
      );
    };
    const toolCallError = (
      failure: DirectActionCallFailure,
      text = failure.errorMessage,
    ) => {
      fail(failure);
      return {
        content: [{ type: "text", text: `Error: ${text}` }],
        isError: true,
      };
    };
    // An error from before the action ran has no result to check it against.
    const actionError = (err: any) => {
      const errorCode = mcpActionErrorCode(err);
      return toolCallError(
        describeMcpError(err),
        `${redactEmbedText(errorText(err))}${errorCode !== undefined ? ` (errorCode: ${redactEmbedText(errorCode)})` : ""}`,
      );
    };
    if (outcome.status === "threw") return actionError(outcome.error);
    if (outcome.status === "approval-required") {
      try {
        return await requestMcpActionApproval(outcome.approval, name, ctx);
      } catch (err: any) {
        return actionError(err);
      }
    }

    // The action has run, so from here on a write reports its success even
    // when its result cannot be shown, rather than invite a retry, and a read
    // fails. A write is told by its effect: `changeEvents: false` only drops
    // the marker.
    const { entry } = outcome;
    const isWrite = !actionCallIsReadOnly(entry, args, false);
    const emitsChange = actionCallEmitsChange(entry, args, false);
    // Set as the call learns them, so a failure below never reads the
    // action's value again. The upstream status is read before anything can
    // fail; the JSON copy may settle it if unknown or find a failure, never
    // clear one.
    let upstream = upstreamStatus(outcome.result);
    let stage: "normalize" | "respond" = "normalize";
    let guardSoFar: EmbedCredentialGuard | undefined;
    // Each value the call builds joins the guard before the next step that
    // can fail, so a failure is checked against all of them; one that cannot
    // join leaves no guard.
    const addSources = embedCredentialSources();
    const produced = (...values: unknown[]) => {
      guardSoFar = undefined;
      return (guardSoFar = addSources(...values));
    };
    let changed: { result: unknown } | undefined;
    // The only `_meta` that may carry an embed credential; see
    // `EMBED_HANDOFF_META_KEYS`. A withheld write still sends it.
    let handoffMeta: Record<string, unknown> = {};
    const markChange = async () => {
      try {
        await writeActionChangeMarker({
          actionName: name,
          ...(changed ? actionChangeResource(entry, args, changed.result) : {}),
          owner: getRequestUserEmail() ?? undefined,
          orgId: getRequestOrgId() ?? undefined,
        });
      } catch (error) {
        console.warn(
          "Could not write the action-change marker after an MCP tool call",
          error,
        );
      }
    };
    try {
      // Plain JSON from here on, a proxy's `raw` included, so a getter or
      // `toJSON` cannot hand the model anything the checks below did not
      // read.
      const result = toJsonData(outcome.result, true);
      stage = "respond";
      produced(result);
      const mcpResult = isMcpActionResult(result) ? result : null;
      if (upstream !== "failed") {
        upstream = isReportedProxyError(mcpResult) ? "failed" : "succeeded";
      }
      const mcpResultIsError = upstream === "failed";
      const rawResult = mcpResult ? mcpResult.raw : result;
      changed = { result: rawResult };
      const resultForClient = mcpResult ? mcpResult.text : result;
      const projectDirectoryResult = directoryCatalog
        ? config.directoryProfile?.projectResult
        : undefined;
      const project = (value: unknown) => {
        if (!projectDirectoryResult) return value;
        const projected = projectDirectoryResult(name, value);
        produced(projected);
        return projected;
      };
      const projectedRawResult = project(rawResult);
      const projectedResultForClient = project(resultForClient);
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
        produced(directoryLinkUrl);
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
      produced(rawResultForClient);
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
        notes: imageNotes,
      } = extractAgentImagesFromActionResult(rawResultForClient);
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
      const mcpAppOpenLinkMeta = mcpAppResource
        ? mcpAppEmbedOpenLinkMeta(
            actionResultForClient,
            mcpAppResource,
            requestMeta,
          )
        : {};
      const toolUiMeta = metadataObject((entry.tool as any)._meta?.ui);
      const toolVisibility = toolUiMeta.visibility;
      const isAppOnlyVisibility =
        Array.isArray(toolVisibility) &&
        toolVisibility.length > 0 &&
        toolVisibility.every((v) => v === "app");
      // Built before the first redaction, which throws on a result it
      // cannot read.
      handoffMeta = {
        ...(directoryCatalog && mcpAppResource
          ? mcpDirectoryWidgetSourceMeta(name, mcpAppOpenLinkMeta)
          : {}),
        ...mcpAppOpenLinkMeta,
        ...(isAppOnlyVisibility
          ? mcpAppOnlyEmbedStartMeta(actionResultForClient)
          : {}),
        ...(mcpAppResource
          ? openAiToolResultMeta(mcpAppResource, directoryCatalog)
          : {}),
      };
      // The link is built from the result as the action returned it, and
      // checked with the rest of the response.
      const { block, _meta } = buildLinkArtifacts(
        entry,
        (args as Record<string, any>) ?? {},
        actionResultForClient,
        requestMeta,
      );
      const responseMeta: Record<string, unknown> = {
        ...(_meta ?? {}),
        ...handoffMeta,
      };
      const guard = produced(block?.text, responseMeta);
      // Text and `structuredContent` read `visible`, the result without its
      // images, redacted against the whole call. Images are checked whole
      // with the rest of the response. Only the embed start in `_meta` comes
      // from the unredacted result.
      const visible = redactEmbedCredentials(actionResultForClient, guard);
      const textResultForClient = mcpResult
        ? projectedResultForClient
        : visible;
      const structuredResult =
        (returnsQueryPayload(entry) ||
          entry.mcpApp?.structuredContent === true) &&
        visible &&
        typeof visible === "object"
          ? Array.isArray(visible)
            ? { items: visible }
            : visible
          : undefined;
      const structuredContent = mcpAppResource
        ? mcpAppStructuredContent(visible, responseMeta)
        : isAppOnlyVisibility &&
            visible &&
            typeof visible === "object" &&
            !Array.isArray(visible)
          ? (visible as Record<string, unknown>)
          : structuredResult
            ? mcpAppStructuredContent(structuredResult, responseMeta)
            : undefined;
      const paging = textPagingInputs(
        entry.tool.parameters,
        entry.readOnly === true,
      );
      const text = mcpAppResource
        ? conciseMcpAppToolText(
            name,
            textResultForClient,
            structuredContent!,
            paging,
          )
        : conciseToolResultText(name, textResultForClient, {
            paging,
            preserveObjectResult:
              returnsQueryPayload(entry) ||
              (entry as MCPActionEntry)[PRESERVE_MCP_OBJECT_RESULT] === true,
          });
      // `isError` is the one signal a host honors to skip mounting an empty
      // widget, so a write that produced nothing carries it too, but says it
      // ran and records its change, so it is not retried.
      const content: any[] = [
        {
          type: "text",
          text:
            embedProducedNothing && isWrite
              ? `${name} completed; its change was saved, but it produced no widget content.`
              : text,
        },
      ];
      if (block) content.push(block);
      const assembled = {
        content,
        ...(mcpResultIsError || embedProducedNothing ? { isError: true } : {}),
        ...(structuredContent ? { structuredContent } : {}),
        ...(Object.keys(responseMeta).length > 0
          ? { _meta: responseMeta }
          : {}),
      };
      const response = modelVisibleToolResponse(assembled, guard, handoffMeta, {
        images: resultImages,
        notes: imageNotes,
      });
      if (emitsChange && !mcpResultIsError) await markChange();
      return response;
    } catch (err: any) {
      // One diagnostic goes to the response and analytics alike: the whole
      // error, checked against everything the call built, or a fixed
      // sentence when it cannot be. The original error goes nowhere.
      const failedAt = err instanceof UnreadableResultError ? "check" : stage;
      let checked: DirectActionCallFailure | undefined;
      try {
        if (guardSoFar && failedAt === "respond") {
          // Each string on its own: in an object, the walker drops a field
          // that names the route rather than hide it.
          const errorCode = mcpActionErrorCode(err);
          checked = {
            errorType: redactEmbedCredentials(
              describeMcpError(err).errorType,
              guardSoFar,
            ),
            errorMessage: redactEmbedCredentials(
              `${errorText(err)}${errorCode !== undefined ? ` (errorCode: ${errorCode})` : ""}`,
              guardSoFar,
            ),
          };
        }
      } catch {
        // coercion-ok: `checked` stays undefined, which reads as unchecked below.
      }
      const diagnostic =
        checked ??
        (failedAt === "normalize"
          ? {
              errorType: "result_not_json",
              errorMessage:
                "The action result is not JSON data, so it could not be shown.",
            }
          : {
              errorType: "result_unchecked",
              errorMessage: new UnreadableResultError().message,
            });
      // A checked error reaches analytics as it is; a fixed sentence does
      // not, so only that is captured, with the stage that failed.
      if (!checked) {
        captureError(new Error(diagnostic.errorMessage), {
          tags: {
            source: "mcp",
            action: name,
            failureClass: "unchecked-tool-error",
            stage: failedAt,
          },
        });
      }
      if (!isWrite) return toolCallError(diagnostic);
      if (upstream !== "succeeded") fail(diagnostic);
      // A missed refresh would hide a committed change; a spurious one is
      // harmless, so only a reported failure skips the marker.
      if (emitsChange && upstream !== "failed") await markChange();
      return withheldWriteResponse(
        name,
        handoffMeta,
        upstream,
        checked?.errorMessage,
      );
    }
  };
}
