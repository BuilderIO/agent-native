import type {
  InputRequiredResult,
  ServerContext,
} from "@modelcontextprotocol/server";

import {
  actionCallReadOnly,
  actionChangeResource,
} from "../action-call-classification.js";
import {
  ActionOutputContractError,
  failedCallEmitsChange,
  isActionOutputContractError,
  invocationEffect,
  ranCallEmitsChange,
  type ActionExecutionOutcome,
} from "../action.js";
import { agentErrorDetails } from "../agent/action-error-details.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { extractAgentImagesFromActionResult } from "../agent/tool-result-images.js";
import { writeActionChangeMarker } from "../server/action-change-marker-write.js";
import { captureError } from "../server/capture-error.js";
import {
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import { describeMcpError } from "./analytics.js";
import {
  actionApprovalError,
  buildLinkArtifacts,
  conciseMcpAppToolText,
  conciseToolResultText,
  getMcpDirectoryWidgetResourceUri,
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
  mcpResponseStructuredContent,
  mcpResultHasContent,
  metadataObject,
  modelVisibleToolResponse,
  openAiToolResultMeta,
  PRESERVE_MCP_OBJECT_RESULT,
  resolveMcpAppResourceSafely,
  returnsQueryPayload,
  textPagingInputs,
  upstreamStatusText,
  withheldWriteResponse,
  withoutMcpAppEmbedTicket,
  withServerMintedMcpAppEmbedStart,
} from "./build-server.js";
import { mcpCallAttribution } from "./call-attribution.js";
import {
  describeThrownForLog,
  isEmbedStartUrl,
  redactEmbedText,
} from "./embed-redaction.js";
import {
  embedCredentialSources,
  type EmbedCredentialGuard,
  mcpActionErrorCode,
  redactEmbedCredentials,
  returnedResult,
  runMcpActionCallUnredacted,
  toJsonData,
  UnreadableResultError,
  type McpActionApprovalState,
  type McpActionCallContext,
} from "./execute-action-call.js";
import { mcpResponseOutputCheck } from "./output-contract.js";

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
  /** False for an action whose input schema the request leaves out. */
  isAdvertisable: (name: string) => boolean;
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
    isAdvertisable,
    visibleActions,
    fullCatalogRequested,
    directoryCatalog,
    requestMeta,
    effectiveIdentity,
    actionCallContext,
    acceptedContent,
    requestMcpActionApproval,
  } = scope;

  const writeChangeMarker = async (
    entry: ActionEntry,
    name: string,
    args: unknown,
    result: unknown,
  ) => {
    try {
      await writeActionChangeMarker({
        actionName: name,
        ...actionChangeResource(entry, args, result),
        owner: getRequestUserEmail() ?? undefined,
        orgId: getRequestOrgId() ?? undefined,
      });
    } catch (error) {
      console.warn(
        `Could not write the action-change marker after an MCP tool call: ${describeThrownForLog(error)}`,
      );
    }
  };
  // What a call that ran has done, read when its result is checked; one
  // that may have written reports a committed effect.
  const ranCallEffect = (
    entry: ActionEntry,
    execution: ActionExecutionOutcome,
    args: unknown,
  ) =>
    invocationEffect(entry, execution, {
      readOnly: actionCallReadOnly(entry, args),
    }).effect === "none"
      ? "none"
      : "committed";

  return async (
    call: { name: string; args: any; request: any; ctx: ServerContext },
    fail: (failure: DirectActionCallFailure) => void,
  ) => {
    const { name, args, request, ctx } = call;
    const callableActions = fullCatalogRequested ? actions : advertisedActions;

    // A directory profile may project results arbitrarily, so the derived
    // contract is advertised and enforced on app catalogs only. It compiles
    // before the action runs. A host may hold an error result to the same
    // schema, so a contracted tool's errors carry no structuredContent.
    const outputContract = directoryCatalog
      ? undefined
      : callableActions[name]?.mcpOutputContract;

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
        content: [{ type: "text" as const, text: `Error: ${text}` }],
        isError: true,
      };
    };
    // An error from before the action ran has no result to check it against,
    // so the response and analytics alike only hide a start URL in it. A
    // thrown value is the thrower's data, and any read of it may throw too.
    const actionError = (err: any) => {
      try {
        const errorCode = mcpActionErrorCode(err);
        const { errorType, errorMessage } = describeMcpError(err);
        const message = redactEmbedText(errorText(err));
        // A directory profile decides what its catalog shows, and it
        // projects only the message.
        const details = directoryCatalog ? undefined : agentErrorDetails(err);
        const detailsLine = details && redactEmbedText(details.line);
        return {
          ...toolCallError(
            {
              errorType: redactEmbedText(errorType),
              errorMessage: redactEmbedText(errorMessage),
            },
            `${message}${errorCode !== undefined ? ` (errorCode: ${redactEmbedText(errorCode)})` : ""}${detailsLine ? `\n${detailsLine}` : ""}`,
          ),
          // Some clients hand the model structuredContent in place of the
          // text, so it repeats the message rather than carrying details
          // alone. Details the embed check hid in the text stay out of it.
          ...(details && detailsLine === details.line && !outputContract
            ? {
                structuredContent: {
                  error: {
                    message,
                    errorCode: err.errorCode,
                    details: details.details,
                    ...(details.omittedKeys
                      ? {
                          omittedKeys: details.omittedKeys,
                          omittedKeyCount: details.omittedKeyCount,
                        }
                      : {}),
                  },
                },
              }
            : {}),
        };
      } catch {
        return toolCallError({
          errorType: "error_unreadable",
          errorMessage: "The call failed, and its error could not be read.",
        });
      }
    };

    let checkOutput: ReturnType<typeof mcpResponseOutputCheck> | undefined;
    try {
      checkOutput = outputContract
        ? mcpResponseOutputCheck(outputContract)
        : undefined;
    } catch (err) {
      return actionError(err);
    }

    const outcome = await runMcpActionCallUnredacted(actionCallContext, {
      name,
      args,
      // A tool the request leaves out is unknown here, as it is to tools/list.
      callable: isAdvertisable(name) ? callableActions : {},
      actionRunContext: mcpCallAttribution({
        request,
        envelope: ctx.mcpReq.envelope,
        oauthClientId: effectiveIdentity?.oauthClientId,
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

    if (outcome.status === "threw") {
      // Once a write entered its handler, in the call or one nested in it,
      // other sessions refresh however the call then failed.
      if (
        outcome.stage === "action" &&
        failedCallEmitsChange(outcome.entry, outcome.error, outcome.execution)
      ) {
        await writeChangeMarker(
          outcome.entry,
          name,
          outcome.execution.record?.args ?? args,
          undefined,
        );
      }
      return actionError(outcome.error);
    }
    if (outcome.status === "approval-required") {
      try {
        return await requestMcpActionApproval(outcome.approval, name, ctx);
      } catch (err: any) {
        return actionError(err);
      }
    }

    // The action has run, so from here on a write reports its success even
    // when its result cannot be shown, rather than invite a retry, and a read
    // fails. An opted-in action instead fails with its typed output error,
    // which says whether its changes were applied. A write is told by its
    // effect, what ran in the call: `changeEvents: false` only drops the
    // marker.
    const { entry, execution } = outcome;
    // Links and the change marker follow the arguments the call ran with,
    // defaults applied, each reading its own copy.
    const callArgs = () =>
      // coercion-ok: a call that omits `arguments` passes no arguments, which is an empty object.
      (execution.record?.args ?? args ?? {}) as Record<string, unknown>;
    const effect = ranCallEffect(entry, execution, callArgs());
    const isWrite = effect !== "none";
    const emitsChange = ranCallEmitsChange(entry, execution, callArgs(), false);
    // Set as the call learns them, so a failure below never reads the
    // action's value again. What it returned is classified before anything
    // can fail, and the response normalizes only the parts read there.
    const returned = returnedResult(outcome.result);
    const { upstream } = returned;
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
    // The only `_meta` that may carry an embed credential; see
    // `EMBED_HANDOFF_META_KEYS`. A withheld write still sends it.
    let handoffMeta: Record<string, unknown> = {};
    const markChange = () =>
      writeChangeMarker(entry, name, callArgs(), returned.result);
    try {
      if (returned.unread) throw new UnreadableResultError();
      // Plain JSON from here on, so a getter or `toJSON` cannot hand the
      // model anything the checks below did not read. An opted-in action's
      // result must be JSON as it is, so a cycle in it fails its contract.
      const rawResult = toJsonData(returned.result, !outputContract);
      // Field by field, so a field named `toJSON` is a value that must be
      // JSON, not a method of the object holding the fields.
      const fields =
        returned.fields &&
        Object.fromEntries(
          Object.entries(returned.fields).map(([key, field]) => [
            key,
            toJsonData(field, !outputContract),
          ]),
        );
      stage = "respond";
      produced(rawResult, returned.text, fields);
      // An unknown status is not taken for success: it mounts no widget and
      // is flagged, and a write still records its change.
      const mcpResultIsError = upstream !== "succeeded";
      const resultForClient = returned.text ?? rawResult;
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
      const trustedCredentialIssuedAtMs =
        effectiveIdentity?.mcpCredentialIssuedAtMs;
      let directoryWidget: Awaited<
        ReturnType<typeof mcpDirectoryWidgetCapabilityForTool>
      >;
      if (
        !mcpResultIsError &&
        mcpAppResourceCandidate &&
        getRequestContext()?.requestOrigin &&
        hasVerifiedMcpUserIdentity(effectiveIdentity) &&
        typeof trustedCredentialIssuedAtMs === "number" &&
        Number.isSafeInteger(trustedCredentialIssuedAtMs)
      ) {
        try {
          directoryWidget = await mcpDirectoryWidgetCapabilityForTool(
            config,
            directoryCatalog
              ? mcpAppResourceCandidate
              : {
                  ...mcpAppResourceCandidate,
                  uri: getMcpDirectoryWidgetResourceUri(
                    config.appId ?? config.name,
                  ),
                },
            name,
            callArgs(),
            projectedRawResult,
            visibleActions,
            effectiveIdentity,
          );
        } catch (error) {
          if (directoryCatalog) throw error;
          console.warn(
            `[mcp] ${name} returned no scoped widget capability; using a full-app link: ${describeThrownForLog(error)}`,
          );
        }
      }
      const requiresEmbedSession =
        directoryCatalog ||
        entry.mcpApp?.resource?.requiresEmbedSession === true;
      const missingWidgetCapability =
        requiresEmbedSession &&
        entry.mcpApp?.resource !== undefined &&
        directoryWidget === undefined;
      const suppressDirectoryWidget =
        directoryCatalog && !hasVerifiedMcpUserIdentity(effectiveIdentity);
      // The host mounts a widget for this tool from its descriptor, with or
      // without a ticket in the result, so a withheld ticket must be visible.
      if (
        directoryCatalog &&
        mcpAppResourceCandidate &&
        missingWidgetCapability &&
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
        entry.mcpApp?.resource !== undefined &&
        (!directoryWidget || suppressDirectoryWidget)
          ? withoutMcpAppEmbedTicket(projectedRawResult)
          : mcpAppResourceCandidate
            ? await withServerMintedMcpAppEmbedStart(
                projectedRawResult,
                requestMeta,
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
        (!requiresEmbedSession ||
          (directoryWidget &&
            typeof metadataObject(actionResultForClient).embedStartUrl ===
              "string")) &&
        !mcpResultIsError &&
        embedHasContent
          ? mcpAppResourceCandidate
          : null;
      const embedProducedNothing =
        !!mcpAppResourceCandidate &&
        !missingWidgetCapability &&
        !mcpResultIsError &&
        !embedHasContent;
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
        ...(directoryWidget && mcpAppResource
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
      const useFullAppLink =
        (!directoryCatalog || !getRequestContext()?.requestOrigin) &&
        requiresEmbedSession &&
        !!entry.mcpApp?.resource &&
        !mcpAppResource;
      const linkEntry: ActionEntry = useFullAppLink
        ? {
            ...entry,
            link: ({ args, result }) => {
              const record = metadataObject(result);
              const linked = entry.link?.({
                args,
                result: { ...record, embed: false },
              });
              if (linked?.url && !isEmbedStartUrl(linked.url)) return linked;
              const url = [record.deepLinkUrl, record.url, record.path].find(
                (value): value is string =>
                  typeof value === "string" &&
                  value.trim().length > 0 &&
                  !isEmbedStartUrl(value),
              );
              return {
                url: url ?? `${requestMeta?.basePath ?? ""}/`,
                label: `Open ${config.title ?? config.appId ?? config.name}`,
              };
            },
          }
        : entry;
      const { block, _meta } = buildLinkArtifacts(
        linkEntry,
        callArgs(),
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
      // from the unredacted result. An opted-in action's contract may require
      // a field that held an embed URL, so it keeps that field, masked.
      const visible = redactEmbedCredentials(actionResultForClient, guard, {
        maskUrlFields: outputContract !== undefined,
      });
      const textResultForClient =
        returned.text !== undefined ? projectedResultForClient : visible;
      const wantsStructuredResult =
        (returnsQueryPayload(entry) ||
          entry.mcpApp?.structuredContent === true ||
          (!mcpResultIsError && entry.mcpApp?.resource !== undefined)) &&
        visible &&
        typeof visible === "object";
      const contracted = () =>
        mcpResponseStructuredContent(visible, responseMeta, {
          contracted: true,
        });
      const structuredContent = outputContract
        ? checkOutput && !mcpResultIsError && !embedProducedNothing
          ? checkOutput(contracted, { actionName: name, effect })
          : contracted()
        : mcpAppResource
          ? mcpAppStructuredContent(visible, responseMeta)
          : isAppOnlyVisibility &&
              visible &&
              typeof visible === "object" &&
              !Array.isArray(visible)
            ? (visible as Record<string, unknown>)
            : wantsStructuredResult
              ? mcpResponseStructuredContent(visible, responseMeta)
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
              : upstream === "unknown"
                ? `${upstreamStatusText(name, upstream)} ${text}`
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
      if (emitsChange && upstream !== "failed") await markChange();
      return response;
    } catch (caught: any) {
      // One diagnostic goes to the response and analytics alike: the whole
      // error, checked against everything the call built, or a fixed
      // sentence when it cannot be. Any read of the original error may
      // throw, so it is read only inside that check, and goes nowhere else.
      // An opted-in action's is its typed output error, which keeps the
      // call's effect.
      let failedAt: typeof stage | "check" = stage;
      const describe = (error: any): DirectActionCallFailure => {
        const errorCode = mcpActionErrorCode(error);
        return {
          errorType: describeMcpError(error).errorType,
          errorMessage: `${errorText(error)}${errorCode !== undefined ? ` (errorCode: ${errorCode})` : ""}`,
        };
      };
      let checked: DirectActionCallFailure | undefined;
      try {
        if (caught instanceof UnreadableResultError) failedAt = "check";
        if (
          guardSoFar &&
          failedAt === "respond" &&
          (!outputContract || isActionOutputContractError(caught))
        ) {
          // Each string on its own: in an object, the walker drops a field
          // that names the route rather than hide it.
          const described = describe(caught);
          checked = {
            errorType: redactEmbedCredentials(described.errorType, guardSoFar),
            errorMessage: redactEmbedCredentials(
              described.errorMessage,
              guardSoFar,
            ),
          };
        }
      } catch {
        // coercion-ok: `checked` stays undefined, which reads as unchecked below.
      }
      const issue =
        failedAt === "normalize" ? "not_serializable" : "transform_failed";
      if (outputContract && !checked) {
        console.warn(
          `[mcp] Building the contracted result of "${name}" failed after it ran (${issue})`,
        );
      }
      const diagnostic =
        checked ??
        (outputContract
          ? describe(
              new ActionOutputContractError({
                actionName: name,
                effect,
                contract: "mcp",
                issues: [`(root): ${issue}`],
              }),
            )
          : failedAt === "normalize"
            ? {
                errorType: "result_not_json",
                errorMessage:
                  "The action result is not JSON data, so it could not be shown.",
              }
            : {
                errorType: "result_unchecked",
                errorMessage: new UnreadableResultError().message,
              });
      // A checked error, or a typed output error, reaches analytics as it is.
      // A fixed sentence says nothing of the error, and a write reported as
      // completed reaches analytics as a success, so each is captured, with
      // the stage that failed.
      const completed = !outputContract && isWrite && upstream === "succeeded";
      if (completed || (!checked && !outputContract)) {
        captureError(new Error(diagnostic.errorMessage), {
          tags: {
            source: "mcp",
            action: name,
            failureClass: "tool-response-error",
            stage: failedAt,
          },
        });
      }
      // A missed refresh would hide a committed change; a spurious one is
      // harmless, so only a reported failure skips the marker.
      if (emitsChange && upstream !== "failed") await markChange();
      if (outputContract || !isWrite) return toolCallError(diagnostic);
      if (upstream !== "succeeded") fail(diagnostic);
      return withheldWriteResponse(
        name,
        handoffMeta,
        upstream,
        checked?.errorMessage,
      );
    }
  };
}
