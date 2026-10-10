import { fail } from "@agent-native/core/action";
import {
  compareAndSetAppState,
  getCurrentRequestBrowserTabId,
  readAppState,
} from "@agent-native/core/application-state";
import { parse as parseHtml } from "parse5";

import {
  loadSelectedSourceWorkspaceFile,
  readLiveSourceFile,
  resolveSourceWorkspace,
} from "../server/source-workspace.js";
import {
  nativeLocalExportStateKey,
  nativeLocalExportStateSchema,
  type NativeLocalExportCrop,
  type NativeLocalExportState,
} from "../shared/native-local-export.js";

type SourceElement = {
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: SourceElement[];
  content?: { childNodes?: SourceElement[] };
};

export function countNativeLocalExportCropNodes(
  html: string,
  nodeId: string,
): number {
  const stack = [parseHtml(html) as SourceElement];
  let matches = 0;
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (
      node.attrs?.some(
        (attribute) =>
          attribute.name === "data-agent-native-node-id" &&
          attribute.value === nodeId,
      )
    )
      matches += 1;
    stack.push(...(node.childNodes ?? []), ...(node.content?.childNodes ?? []));
  }
  return matches;
}

export function requireNativeLocalExportTabId(): string {
  const tabId = getCurrentRequestBrowserTabId();
  if (!tabId)
    fail("Native local export requires the current Design browser tab.", {
      errorCode: "native_export_local_client_required",
      statusCode: 409,
    });
  return tabId;
}

export function classifyNativeLocalExportNavigation(
  navigation: Record<string, unknown> | null,
  designId: string,
): "matching" | "missing" | "left" | "unreadable" {
  if (navigation === null) return "missing";
  if (
    typeof navigation.view !== "string" ||
    (navigation.view === "editor" && typeof navigation.designId !== "string")
  )
    return "unreadable";
  return navigation.view === "editor" && navigation.designId === designId
    ? "matching"
    : "left";
}

export async function assertNativeLocalExportEditor(
  designId: string,
): Promise<void> {
  const tabId = requireNativeLocalExportTabId();
  const navigation = await readAppState(`navigation:${tabId}`);
  const state = classifyNativeLocalExportNavigation(navigation, designId);
  if (state === "unreadable")
    fail("The Design editor navigation state is unreadable.", {
      errorCode: "native_export_context_unreadable",
      statusCode: 422,
    });
  if (state !== "matching")
    fail("Open this Design in the current browser tab before local export.", {
      errorCode: "native_export_local_client_required",
      statusCode: 409,
    });
}

export async function readNativeLocalExportState(
  designId: string,
  tabId: string,
): Promise<NativeLocalExportState | null> {
  const raw = await readAppState(nativeLocalExportStateKey(designId, tabId));
  if (raw === null) return null;
  const parsed = nativeLocalExportStateSchema.safeParse(raw);
  if (!parsed.success)
    fail("The local export request state is unreadable.", {
      errorCode: "native_export_request_unreadable",
      statusCode: 422,
    });
  return parsed.data;
}

export async function readNativeLocalExportVersion(
  designId: string,
  fileId: string,
  crop?: NativeLocalExportCrop,
): Promise<{ versionHash: string; cropNodeCount: number | null }> {
  const workspace = await resolveSourceWorkspace(designId, {
    includeContent: false,
    includeBoard: true,
  });
  if (workspace.sourceType !== "inline")
    fail("Native local export requires inline Design source.", {
      errorCode: "native_export_source_unsupported",
      statusCode: 422,
    });
  const file = workspace.files.find((candidate) => candidate.id === fileId);
  if (!file || file.fileType !== "html")
    fail("Selected Design HTML file was not found.", {
      errorCode: "native_export_screen_not_found",
      statusCode: 404,
    });
  const stored = await loadSelectedSourceWorkspaceFile(file);
  if (!stored)
    fail("Selected Design source changed during export preparation.", {
      errorCode: "native_export_source_conflict",
      statusCode: 409,
    });
  const live = await readLiveSourceFile(stored);
  return {
    versionHash: live.versionHash,
    cropNodeCount: crop
      ? countNativeLocalExportCropNodes(live.content, crop.nodeId)
      : null,
  };
}

export async function expireNativeLocalExportState(
  current: NativeLocalExportState,
): Promise<NativeLocalExportState> {
  if (
    current.expiresAt > Date.now() ||
    current.status === "download-initiated" ||
    current.status === "failed" ||
    current.status === "canceled" ||
    current.status === "expired"
  )
    return current;
  const expired: NativeLocalExportState = {
    ...current,
    status: "expired",
    failure: {
      code: "client-unavailable",
      message:
        "The local editor did not finish this export before its lease expired.",
    },
  };
  const key = nativeLocalExportStateKey(current.designId, current.tabId);
  if (await compareAndSetAppState(key, current, expired)) return expired;
  const latest = await readNativeLocalExportState(
    current.designId,
    current.tabId,
  );
  if (!latest)
    fail("The local export request disappeared during its state transition.", {
      errorCode: "native_export_request_conflict",
      statusCode: 409,
    });
  return latest;
}

export async function markNativeLocalExportDocumentReplaced(
  designId: string,
  tabId: string,
  documentId: string,
): Promise<void> {
  const key = nativeLocalExportStateKey(designId, tabId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await readNativeLocalExportState(designId, tabId);
    if (!raw) return;
    const current = await expireNativeLocalExportState(raw);
    if (
      (current.status !== "running" && current.status !== "cancel-requested") ||
      !current.ownerDocumentId ||
      current.ownerDocumentId === documentId
    )
      return;
    const failed: NativeLocalExportState = {
      ...current,
      status: "failed",
      failure: {
        code: "client-unavailable",
        message: "The editor page reloaded before local export finished.",
      },
    };
    if (await compareAndSetAppState(key, current, failed)) return;
  }
  fail("The local export changed while recovering its editor page.", {
    errorCode: "native_export_request_conflict",
    statusCode: 409,
  });
}

export async function markNativeLocalExportEditorLeft(
  current: NativeLocalExportState,
): Promise<NativeLocalExportState> {
  if (
    current.status !== "pending" &&
    current.status !== "running" &&
    current.status !== "cancel-requested"
  )
    return current;
  const navigation = await readAppState(`navigation:${current.tabId}`);
  const state = classifyNativeLocalExportNavigation(
    navigation,
    current.designId,
  );
  if (state === "matching") return current;
  const expired: NativeLocalExportState = {
    ...current,
    status: "expired",
    failure: {
      code:
        state === "missing"
          ? "client-unavailable"
          : state === "unreadable"
            ? "navigation-unreadable"
            : "editor-left",
      message:
        state === "missing"
          ? "The browser tab stopped reporting its Design editor context."
          : state === "unreadable"
            ? "The browser tab's Design navigation state is unreadable."
            : "The browser tab left this Design editor before local export finished.",
    },
  };
  const key = nativeLocalExportStateKey(current.designId, current.tabId);
  if (await compareAndSetAppState(key, current, expired)) return expired;
  const latest = await readNativeLocalExportState(
    current.designId,
    current.tabId,
  );
  if (!latest)
    fail("The local export request disappeared during its state transition.", {
      errorCode: "native_export_request_conflict",
      statusCode: 409,
    });
  return latest;
}
