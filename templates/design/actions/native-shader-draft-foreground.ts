import { createHash } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import {
  compareAndSetAppState,
  getCurrentRequestBrowserTabId,
  readAppState,
} from "@agent-native/core/application-state";
import {
  deleteAttachment,
  mintAttachmentRef,
  resolveAttachment,
} from "@agent-native/core/private-blob";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import {
  loadSelectedSourceWorkspaceFile,
  readLiveSourceFile,
  resolveSourceWorkspace,
} from "../server/source-workspace.js";
import { hashEffectDefinition } from "../shared/native-effect-trust.js";
import {
  authoredNodeCount,
  parseEffectsFromHtml,
  validateEffectDocument,
  type EffectDefinition,
} from "../shared/native-effects.js";
import {
  NATIVE_DRAFT_PENDING_MS,
  NATIVE_DRAFT_RUNNING_MS,
  nativeDraftForegroundKey,
  nativeDraftForegroundStateSchema,
  nativeDraftTerminalSchema,
  publicNativeDraftState,
  type NativeDraftForegroundState,
} from "../shared/native-shader-draft-foreground.js";
import {
  assertNativeLocalExportEditor,
  requireNativeLocalExportTabId,
} from "./_native-local-export-server.js";
import { resolveNativeRenderContextTarget } from "./_native-render-contexts.js";

const id = z.string().min(1).max(128);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const request = z
  .object({
    kind: z.literal("request"),
    designId: id,
    fileId: id,
    nodeId: id,
    instanceId: id,
    expectedVersionHash: z.string().min(1).max(256),
    baseExecutionHash: hash,
    targetTabId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,96}$/)
      .optional(),
    command: z.enum(["preview", "clear"]),
    draftDefinition: z.unknown().optional(),
    params: z.record(z.string().min(1).max(80), z.json()).optional(),
    seed: z.number().int().min(0).max(1_000_000).optional(),
    time: z.number().finite().min(0).max(3600).optional(),
  })
  .strict();
const control = z
  .object({
    kind: z.enum([
      "claim",
      "open",
      "finish",
      "get",
      "cancel",
      "cancel-complete",
    ]),
    designId: id,
    requestId: z.string().uuid(),
    targetTabId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,96}$/)
      .optional(),
    result: nativeDraftTerminalSchema.optional(),
  })
  .strict();
const schema = z.discriminatedUnion("kind", [request, control]);

function viewer(): string {
  const email = getRequestUserEmail()?.trim().toLowerCase();
  if (!email)
    fail("Sign in to preview a native shader draft.", {
      errorCode: "native_draft_auth_required",
      statusCode: 401,
    });
  return email;
}
async function source(designId: string, fileId: string) {
  const workspace = await resolveSourceWorkspace(designId, {
    includeContent: false,
    includeBoard: true,
  });
  if (workspace.sourceType !== "inline")
    fail("Native draft preview requires inline Design source.", {
      errorCode: "native_draft_source_unsupported",
      statusCode: 422,
    });
  if (!workspace.canEdit)
    fail("Shader draft preview requires Design editor access.", {
      errorCode: "native_draft_edit_forbidden",
      statusCode: 403,
    });
  const file = workspace.files.find((item) => item.id === fileId);
  if (!file || file.fileType !== "html")
    fail("Selected Design HTML file was not found.", {
      errorCode: "native_draft_file_not_found",
      statusCode: 404,
    });
  const stored = await loadSelectedSourceWorkspaceFile(file);
  if (!stored)
    fail("Selected Design source is unreadable.", {
      errorCode: "native_draft_source_unreadable",
      statusCode: 422,
    });
  return { workspace, live: await readLiveSourceFile(stored) };
}
async function readState(
  designId: string,
  tabId: string,
): Promise<NativeDraftForegroundState | null> {
  const raw = await readAppState(nativeDraftForegroundKey(designId, tabId));
  if (raw === null) return null;
  const parsed = nativeDraftForegroundStateSchema.safeParse(raw);
  if (!parsed.success)
    fail("Native draft request state is unreadable.", {
      errorCode: "native_draft_state_unreadable",
      statusCode: 422,
    });
  return parsed.data;
}
async function disposeDraft(state: NativeDraftForegroundState) {
  if (!state.draftRef) return;
  const removed = await deleteAttachment(state.draftRef, {
    ownerEmail: viewer(),
  });
  if (removed.status !== "ok" && removed.status !== "notFound")
    fail("Native draft attachment cleanup failed.", {
      errorCode: "native_draft_cleanup_failed",
      statusCode: 503,
    });
}
async function transition(
  state: NativeDraftForegroundState,
  next: NativeDraftForegroundState,
) {
  if (
    !(await compareAndSetAppState(
      nativeDraftForegroundKey(state.designId, state.tabId),
      state,
      next,
    ))
  )
    fail("Native draft request changed concurrently.", {
      errorCode: "native_draft_conflict",
      statusCode: 409,
    });
  return publicNativeDraftState(next);
}
export default defineAction({
  description:
    "Request a short-lived GPU preview of an existing native shader instance in an open Design editor, then read bounded located diagnostics. WGSL is held in a private attachment, never application state. Apply source changes with edit-native-shader and its expected version hash; clear reverts ephemeral preview pixels.",
  requiresAuth: true,
  maxBodyBytes: 300_000,
  schema,
  http: { method: "POST" },
  run: async (input) => {
    const ownerEmail = viewer();
    if (input.kind === "request") {
      const tabId = input.targetTabId
        ? await resolveNativeRenderContextTarget(
            input.designId,
            input.targetTabId,
          )
        : requireNativeLocalExportTabId();
      if (!input.targetTabId)
        await assertNativeLocalExportEditor(input.designId);
      const { live } = await source(input.designId, input.fileId);
      if (live.versionHash !== input.expectedVersionHash)
        fail("Design source changed before shader preview.", {
          errorCode: "native_draft_source_stale",
          statusCode: 409,
        });
      const parsed = parseEffectsFromHtml(live.content);
      if (parsed.errors.length || !parsed.document)
        fail("Native effect manifest is unreadable.", {
          errorCode: "native_draft_manifest_unreadable",
          statusCode: 422,
        });
      const instance = parsed.document.instances.find(
        (item) => item.id === input.instanceId && item.nodeId === input.nodeId,
      );
      if (
        !instance ||
        !instance.enabled ||
        authoredNodeCount(live.content, input.nodeId) !== 1
      )
        fail("Native draft target is missing or ambiguous.", {
          errorCode: "native_draft_target_unavailable",
          statusCode: 422,
        });
      const base = parsed.document.definitions.find(
        (item) =>
          item.id === instance.definitionId &&
          item.version === instance.definitionVersion,
      );
      if (
        !base ||
        (await hashEffectDefinition(base)) !== input.baseExecutionHash
      )
        fail("Mounted shader source changed.", {
          errorCode: "native_draft_base_stale",
          statusCode: 409,
        });
      const current = await readState(input.designId, tabId);
      if (
        current &&
        ["pending", "running", "cancel-requested"].includes(current.status) &&
        current.expiresAt > Date.now()
      )
        fail("A draft preview is already running in this editor tab.", {
          errorCode: "native_draft_busy",
          statusCode: 409,
        });
      let draftRef: string | undefined;
      let draftExecutionHash: string | undefined;
      let draftPayloadHash: string | undefined;
      if (input.command === "preview") {
        if (
          !input.draftDefinition ||
          input.seed === undefined ||
          input.time === undefined
        )
          fail("Draft definition, seed, and time are required.", {
            errorCode: "native_draft_invalid",
            statusCode: 422,
          });
        const checked = validateEffectDocument({
          schemaVersion: 2,
          definitions: [input.draftDefinition as EffectDefinition],
          instances: [
            {
              ...instance,
              definitionVersion: (input.draftDefinition as EffectDefinition)
                .version,
              params: { ...instance.params, ...input.params },
              seed: input.seed,
            },
          ],
        });
        if (!checked.valid || !checked.document)
          fail("Draft definition or parameters are invalid.", {
            errorCode: "native_draft_invalid",
            statusCode: 422,
          });
        const draft = checked.document.definitions[0];
        if (draft.id !== base.id || draft.version <= base.version)
          fail("Draft must be a newer version of the mounted definition.", {
            errorCode: "native_draft_version_invalid",
            statusCode: 422,
          });
        draftExecutionHash = await hashEffectDefinition(draft);
        const payload = JSON.stringify({
          definition: draft,
          params: checked.document.instances[0].params,
          seed: input.seed,
          time: input.time,
        });
        if (new TextEncoder().encode(payload).byteLength > 262_144)
          fail("Draft source exceeds the private preview limit.", {
            errorCode: "native_draft_too_large",
            statusCode: 413,
          });
        draftPayloadHash = createHash("sha256").update(payload).digest("hex");
        const minted = await mintAttachmentRef({
          data: new TextEncoder().encode(payload),
          filename: "native-shader-draft.json",
          mimeType: "application/json",
          ownerEmail,
        });
        if (minted.status !== "ok")
          fail("Private shader draft storage is unavailable.", {
            errorCode: "native_draft_storage_unavailable",
            statusCode: 503,
          });
        draftRef = minted.ref;
      } else if (
        input.draftDefinition !== undefined ||
        input.params !== undefined
      )
        fail("Clear does not accept draft source.", {
          errorCode: "native_draft_invalid",
          statusCode: 422,
        });
      const now = Date.now();
      const next: NativeDraftForegroundState = {
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        designId: input.designId,
        fileId: input.fileId,
        nodeId: input.nodeId,
        instanceId: input.instanceId,
        tabId,
        expectedVersionHash: input.expectedVersionHash,
        baseExecutionHash: input.baseExecutionHash,
        draftExecutionHash,
        draftPayloadHash,
        command: input.command,
        draftRef,
        seed: input.seed,
        time: input.time,
        status: "pending",
        issuedAt: now,
        expiresAt: now + NATIVE_DRAFT_PENDING_MS,
      };
      if (
        !(await compareAndSetAppState(
          nativeDraftForegroundKey(input.designId, tabId),
          current,
          next,
        ))
      ) {
        if (draftRef) await deleteAttachment(draftRef, { ownerEmail });
        fail("Draft request changed concurrently.", {
          errorCode: "native_draft_conflict",
          statusCode: 409,
        });
      }
      if (current?.draftRef) await disposeDraft(current);
      return publicNativeDraftState(next);
    }
    const tabId = input.targetTabId ?? requireNativeLocalExportTabId();
    const current = await readState(input.designId, tabId);
    if (!current || current.requestId !== input.requestId)
      fail("Native draft request was not found.", {
        errorCode: "native_draft_not_found",
        statusCode: 404,
      });
    if (input.kind !== "get" && input.kind !== "cancel") {
      if (tabId !== getCurrentRequestBrowserTabId())
        fail("Draft preview must run in its registered editor tab.", {
          errorCode: "native_draft_wrong_tab",
          statusCode: 403,
        });
      await assertNativeLocalExportEditor(input.designId);
    }
    const { live } = await source(input.designId, current.fileId);
    if (
      Date.now() >= current.expiresAt &&
      ["pending", "running", "cancel-requested"].includes(current.status)
    ) {
      const expired: NativeDraftForegroundState = {
        ...current,
        status: "expired",
        failure: {
          code: "lease-expired",
          message: "native-draft-lease-expired",
        },
      };
      const result = await transition(current, expired);
      await disposeDraft(current);
      return result;
    }
    if (input.kind === "get") return publicNativeDraftState(current);
    if (input.kind === "cancel") {
      if (!["pending", "running"].includes(current.status))
        return publicNativeDraftState(current);
      const next: NativeDraftForegroundState = {
        ...current,
        status: current.status === "running" ? "cancel-requested" : "canceled",
      };
      const result = await transition(current, next);
      if (next.status === "canceled") await disposeDraft(current);
      return result;
    }
    if (input.kind === "cancel-complete") {
      if (current.status !== "cancel-requested")
        fail("Draft cancellation is not awaiting editor cleanup.", {
          errorCode: "native_draft_cancel_conflict",
          statusCode: 409,
        });
      const result = await transition(current, {
        ...current,
        status: "canceled",
      });
      await disposeDraft(current);
      return result;
    }
    if (Date.now() >= current.expiresAt)
      fail("Native draft request expired.", {
        errorCode: "native_draft_expired",
        statusCode: 409,
      });
    if (input.kind === "claim") {
      if (current.status !== "pending")
        fail("Native draft request is not pending.", {
          errorCode: "native_draft_not_pending",
          statusCode: 409,
        });
      const next: NativeDraftForegroundState = {
        ...current,
        status: "running",
        expiresAt: Date.now() + NATIVE_DRAFT_RUNNING_MS,
      };
      return transition(current, next);
    }
    if (current.status !== "running")
      fail("Native draft request is not running.", {
        errorCode: "native_draft_not_running",
        statusCode: 409,
      });
    if (live.versionHash !== current.expectedVersionHash)
      fail("Native draft source changed during preview.", {
        errorCode: "native_draft_source_stale",
        statusCode: 409,
      });
    if (input.kind === "open") {
      if (!current.draftRef)
        return { state: publicNativeDraftState(current), payload: null };
      const opened = await resolveAttachment(current.draftRef, { ownerEmail });
      if (opened.status !== "ok")
        fail("Private shader draft attachment is unavailable.", {
          errorCode: "native_draft_attachment_unavailable",
          statusCode: 422,
        });
      if (
        opened.file.mimeType !== "application/json" ||
        opened.file.data.byteLength > 262_144 ||
        createHash("sha256").update(opened.file.data).digest("hex") !==
          current.draftPayloadHash
      )
        fail("Private shader draft attachment changed.", {
          errorCode: "native_draft_attachment_mismatch",
          statusCode: 409,
        });
      let payload: {
        definition: EffectDefinition;
        params: Record<string, unknown>;
        seed: number;
        time: number;
      };
      try {
        payload = JSON.parse(opened.file.data.toString("utf8"));
      } catch {
        fail("Private shader draft attachment is unreadable.", {
          errorCode: "native_draft_attachment_unreadable",
          statusCode: 422,
        });
      }
      const executionHash = await hashEffectDefinition(payload.definition);
      if (executionHash !== current.draftExecutionHash)
        fail("Private shader draft hash changed.", {
          errorCode: "native_draft_attachment_mismatch",
          statusCode: 409,
        });
      return { state: publicNativeDraftState(current), payload };
    }
    if (!input.result)
      fail("Terminal GPU preview result is required.", {
        errorCode: "native_draft_result_required",
        statusCode: 422,
      });
    if (
      input.result.status === "ready" &&
      current.command === "preview" &&
      input.result.executionHash !== current.draftExecutionHash
    )
      fail("GPU preview result has a different executable hash.", {
        errorCode: "native_draft_result_mismatch",
        statusCode: 422,
      });
    const next: NativeDraftForegroundState = {
      ...current,
      status: input.result.status === "error" ? "failed" : "completed",
      result: input.result,
    };
    const result = await transition(current, next);
    await disposeDraft(current);
    return result;
  },
});
