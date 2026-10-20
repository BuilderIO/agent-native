import { fail } from "@agent-native/core/action";
import {
  compareAndSetAppState,
  getCurrentRequestBrowserTabId,
  readAppState,
} from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

import {
  NATIVE_RENDER_CONTEXT_LEDGER_KEY,
  NATIVE_RENDER_CONTEXT_LIMIT,
  NATIVE_RENDER_CONTEXT_TTL_MS,
  nativeRenderContextLedgerSchema,
  nativeRenderContextSchema,
  type NativeRenderContext,
} from "../shared/native-local-export.js";
import {
  classifyNativeLocalExportNavigation,
  markNativeLocalExportDocumentReplaced,
} from "./_native-local-export-server.js";

function readLedger(raw: Record<string, unknown> | null): {
  schemaVersion: 1;
  contexts: NativeRenderContext[];
} {
  if (raw === null) return { schemaVersion: 1, contexts: [] };
  const parsed = nativeRenderContextLedgerSchema.safeParse(raw);
  if (!parsed.success)
    fail("Native editor context state is unreadable.", {
      errorCode: "native_export_context_unreadable",
      statusCode: 422,
    });
  return parsed.data;
}

async function navigationMatches(
  designId: string,
  tabId: string,
): Promise<boolean> {
  const navigation = await readAppState(`navigation:${tabId}`);
  const state = classifyNativeLocalExportNavigation(navigation, designId);
  if (state === "unreadable")
    fail("Native editor navigation state is unreadable.", {
      errorCode: "native_export_context_unreadable",
      statusCode: 422,
    });
  return state === "matching";
}

export async function registerNativeRenderContext(
  designId: string,
  documentId: string,
): Promise<NativeRenderContext> {
  const tabId = getCurrentRequestBrowserTabId();
  const parsedTabId = nativeRenderContextSchema.shape.tabId.safeParse(tabId);
  if (!parsedTabId.success)
    fail("Native export context requires the current browser tab.", {
      errorCode: "native_export_local_client_required",
      statusCode: 409,
    });
  await assertAccess("design", designId, "viewer");
  const navigation = await readAppState(`navigation:${parsedTabId.data}`);
  const state = classifyNativeLocalExportNavigation(navigation, designId);
  if (state === "unreadable")
    fail("Native editor navigation state is unreadable.", {
      errorCode: "native_export_context_unreadable",
      statusCode: 422,
    });
  if (state !== "matching")
    fail("Open this Design in the current browser tab before registration.", {
      errorCode: "native_export_local_client_required",
      statusCode: 409,
    });

  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await readAppState(NATIVE_RENDER_CONTEXT_LEDGER_KEY);
    const ledger = readLedger(raw);
    const now = Date.now();
    const context: NativeRenderContext = {
      tabId: parsedTabId.data,
      designId,
      expiresAt: now + NATIVE_RENDER_CONTEXT_TTL_MS,
    };
    const contexts = [
      context,
      ...ledger.contexts.filter(
        (entry) => entry.expiresAt > now && entry.tabId !== context.tabId,
      ),
    ];
    if (contexts.length > NATIVE_RENDER_CONTEXT_LIMIT)
      fail("The local Design editor context limit is full.", {
        errorCode: "native_export_context_capacity",
        statusCode: 409,
      });
    const next = { schemaVersion: 1 as const, contexts };
    if (
      await compareAndSetAppState(NATIVE_RENDER_CONTEXT_LEDGER_KEY, raw, next)
    ) {
      await markNativeLocalExportDocumentReplaced(
        designId,
        parsedTabId.data,
        documentId,
      );
      return context;
    }
  }
  fail("Native editor context changed concurrently. Retry.", {
    errorCode: "native_export_context_conflict",
    statusCode: 409,
  });
}

export async function listNativeRenderContexts(
  designId: string,
): Promise<NativeRenderContext[]> {
  await assertAccess("design", designId, "viewer");
  const ledger = readLedger(
    await readAppState(NATIVE_RENDER_CONTEXT_LEDGER_KEY),
  );
  const now = Date.now();
  const candidates = ledger.contexts.filter(
    (entry) => entry.designId === designId && entry.expiresAt > now,
  );
  const active = await Promise.all(
    candidates.map(async (entry) =>
      (await navigationMatches(designId, entry.tabId)) ? entry : null,
    ),
  );
  return active.filter((entry): entry is NativeRenderContext => entry !== null);
}

export async function resolveNativeRenderContextTarget(
  designId: string,
  targetTabId: string,
): Promise<string> {
  const parsedTabId =
    nativeRenderContextSchema.shape.tabId.safeParse(targetTabId);
  if (!parsedTabId.success)
    fail("Native editor tab ID is invalid.", {
      errorCode: "native_export_context_not_found",
      statusCode: 404,
    });
  const active = await listNativeRenderContexts(designId);
  if (!active.some((entry) => entry.tabId === targetTabId))
    fail("No live matching Design editor context was found.", {
      errorCode: "native_export_context_not_found",
      statusCode: 404,
    });
  return targetTabId;
}
