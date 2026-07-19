import {
  IPC,
  type DesktopPrivateContentCreateRequest,
  type DesktopPrivateContentRestoreVersionRequest,
  type DesktopPrivateContentResult,
  type DesktopPrivateContentUpdateRequest,
} from "@shared/ipc-channels";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";

import type { PrivateVaultContentRuntime } from "../private-vault/content-private-runtime.js";

const UNAVAILABLE = "Private Content is locked or unavailable.";
const opaqueIdSchema = z.string().regex(/^[0-9a-f]{32}$/);
const revisionIdSchema = z.string().regex(/^[0-9a-f]{64}$/);
const createSchema = z
  .object({
    title: z.string().max(16_384),
    content: z
      .string()
      .max(1024 * 1024)
      .optional(),
    description: z.string().max(131_072).nullable().optional(),
    parentId: opaqueIdSchema.nullable().optional(),
    icon: z.string().max(256).nullable().optional(),
  })
  .strict();
const updateSchema = createSchema
  .partial()
  .extend({
    id: opaqueIdSchema,
    position: z.number().int().nonnegative().optional(),
    isFavorite: z.boolean().optional(),
    hideFromSearch: z.boolean().optional(),
  })
  .strict();
const applicationStateSchema = z.discriminatedUnion("view", [
  z.object({ view: z.literal("list") }).strict(),
  z.object({ view: z.literal("editor"), documentId: opaqueIdSchema }).strict(),
]);

type RuntimeSurface = Pick<
  PrivateVaultContentRuntime,
  | "ensureStarted"
  | "stop"
  | "health"
  | "listAgentGrants"
  | "listVaultMembers"
  | "revokeAgentGrant"
  | "setApplicationState"
> & {
  documents(): {
    listDocuments(vaultId: string): Promise<unknown>;
    getDocument(vaultId: string, objectId: string): Promise<unknown>;
    searchDocuments(
      vaultId: string,
      query: string,
      limit?: number,
    ): Promise<unknown>;
    createDocument(
      vaultId: string,
      input: DesktopPrivateContentCreateRequest,
    ): Promise<unknown>;
    updateDocument(
      vaultId: string,
      objectId: string,
      input: Omit<DesktopPrivateContentUpdateRequest, "id">,
    ): Promise<unknown>;
    deleteDocument(vaultId: string, objectId: string): Promise<unknown>;
    listDocumentVersions(vaultId: string, objectId: string): Promise<unknown>;
    restoreDocumentVersion(
      vaultId: string,
      objectId: string,
      revisionId: string,
    ): Promise<unknown>;
  };
};

function exactNoArguments(arguments_: unknown[]) {
  if (arguments_.length !== 0) throw new Error();
}

function activeVault(runtime: RuntimeSurface): string {
  const vaultId = runtime.health()?.vaultId;
  return opaqueIdSchema.parse(vaultId);
}

async function result<T>(
  run: () => Promise<T>,
): Promise<DesktopPrivateContentResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }
}

export function createContentPrivateRuntimeIpcHandlers(input: {
  runtimeForEvent(event: IpcMainInvokeEvent): RuntimeSurface | null;
}) {
  const runtime = (event: IpcMainInvokeEvent) => {
    const value = input.runtimeForEvent(event);
    if (!value) throw new Error();
    return value;
  };
  return {
    start: (event: IpcMainInvokeEvent, ...arguments_: unknown[]) =>
      result(async () => {
        exactNoArguments(arguments_);
        const value = runtime(event);
        await value.ensureStarted();
        return value.health();
      }),
    stop: (event: IpcMainInvokeEvent, ...arguments_: unknown[]) =>
      result(async () => {
        exactNoArguments(arguments_);
        await runtime(event).stop();
        return null;
      }),
    health: (event: IpcMainInvokeEvent, ...arguments_: unknown[]) =>
      result(async () => {
        exactNoArguments(arguments_);
        return runtime(event).health();
      }),
    list: (event: IpcMainInvokeEvent, ...arguments_: unknown[]) =>
      result(async () => {
        exactNoArguments(arguments_);
        const value = runtime(event);
        return value.documents().listDocuments(activeVault(value));
      }),
    get: (event: IpcMainInvokeEvent, ...arguments_: unknown[]) =>
      result(async () => {
        if (arguments_.length !== 1) throw new Error();
        const id = opaqueIdSchema.parse(arguments_[0]);
        const value = runtime(event);
        return value.documents().getDocument(activeVault(value), id);
      }),
    search: (event: IpcMainInvokeEvent, ...arguments_: unknown[]) =>
      result(async () => {
        if (arguments_.length !== 1) throw new Error();
        const parsed = z
          .object({
            query: z.string().max(16_384),
            limit: z.number().int().min(1).max(200).optional(),
          })
          .strict()
          .parse(arguments_[0]);
        const value = runtime(event);
        return value
          .documents()
          .searchDocuments(activeVault(value), parsed.query, parsed.limit);
      }),
    create: (event: IpcMainInvokeEvent, ...arguments_: unknown[]) =>
      result(async () => {
        if (arguments_.length !== 1) throw new Error();
        const parsed = createSchema.parse(arguments_[0]);
        const value = runtime(event);
        return value.documents().createDocument(activeVault(value), parsed);
      }),
    update: (event: IpcMainInvokeEvent, ...arguments_: unknown[]) =>
      result(async () => {
        if (arguments_.length !== 1) throw new Error();
        const { id, ...update } = updateSchema.parse(arguments_[0]);
        const value = runtime(event);
        return value.documents().updateDocument(activeVault(value), id, update);
      }),
    delete: (event: IpcMainInvokeEvent, ...arguments_: unknown[]) =>
      result(async () => {
        if (arguments_.length !== 1) throw new Error();
        const id = opaqueIdSchema.parse(arguments_[0]);
        const value = runtime(event);
        return value.documents().deleteDocument(activeVault(value), id);
      }),
    listVersions: (event: IpcMainInvokeEvent, ...arguments_: unknown[]) =>
      result(async () => {
        if (arguments_.length !== 1) throw new Error();
        const id = opaqueIdSchema.parse(arguments_[0]);
        const value = runtime(event);
        return value.documents().listDocumentVersions(activeVault(value), id);
      }),
    restoreVersion: (event: IpcMainInvokeEvent, ...arguments_: unknown[]) =>
      result(async () => {
        if (arguments_.length !== 1) throw new Error();
        const parsed = z
          .object({ id: opaqueIdSchema, revisionId: revisionIdSchema })
          .strict()
          .parse(
            arguments_[0],
          ) satisfies DesktopPrivateContentRestoreVersionRequest;
        const value = runtime(event);
        return value
          .documents()
          .restoreDocumentVersion(
            activeVault(value),
            parsed.id,
            parsed.revisionId,
          );
      }),
    listGrants: (event: IpcMainInvokeEvent, ...arguments_: unknown[]) =>
      result(async () => {
        exactNoArguments(arguments_);
        return runtime(event).listAgentGrants();
      }),
    listMembers: (event: IpcMainInvokeEvent, ...arguments_: unknown[]) =>
      result(async () => {
        exactNoArguments(arguments_);
        return runtime(event).listVaultMembers();
      }),
    revokeGrant: (event: IpcMainInvokeEvent, ...arguments_: unknown[]) =>
      result(async () => {
        if (arguments_.length !== 1) throw new Error();
        const grantRef = revisionIdSchema.parse(arguments_[0]);
        return runtime(event).revokeAgentGrant(grantRef);
      }),
    setApplicationState: (
      event: IpcMainInvokeEvent,
      ...arguments_: unknown[]
    ) =>
      result(async () => {
        if (arguments_.length !== 1) throw new Error();
        const state = applicationStateSchema.parse(arguments_[0]);
        runtime(event).setApplicationState(state);
        return null;
      }),
  };
}

export function registerContentPrivateRuntimeIpc(input: {
  runtimeForEvent(event: IpcMainInvokeEvent): RuntimeSurface | null;
}) {
  const handlers = createContentPrivateRuntimeIpcHandlers(input);
  ipcMain.handle(IPC.CONTENT_PRIVATE_RUNTIME_START, handlers.start);
  ipcMain.handle(IPC.CONTENT_PRIVATE_RUNTIME_STOP, handlers.stop);
  ipcMain.handle(IPC.CONTENT_PRIVATE_RUNTIME_HEALTH, handlers.health);
  ipcMain.handle(IPC.CONTENT_PRIVATE_RUNTIME_LIST, handlers.list);
  ipcMain.handle(IPC.CONTENT_PRIVATE_RUNTIME_GET, handlers.get);
  ipcMain.handle(IPC.CONTENT_PRIVATE_RUNTIME_SEARCH, handlers.search);
  ipcMain.handle(IPC.CONTENT_PRIVATE_RUNTIME_CREATE, handlers.create);
  ipcMain.handle(IPC.CONTENT_PRIVATE_RUNTIME_UPDATE, handlers.update);
  ipcMain.handle(IPC.CONTENT_PRIVATE_RUNTIME_DELETE, handlers.delete);
  ipcMain.handle(
    IPC.CONTENT_PRIVATE_RUNTIME_LIST_VERSIONS,
    handlers.listVersions,
  );
  ipcMain.handle(
    IPC.CONTENT_PRIVATE_RUNTIME_RESTORE_VERSION,
    handlers.restoreVersion,
  );
  ipcMain.handle(IPC.CONTENT_PRIVATE_RUNTIME_LIST_GRANTS, handlers.listGrants);
  ipcMain.handle(
    IPC.CONTENT_PRIVATE_RUNTIME_LIST_MEMBERS,
    handlers.listMembers,
  );
  ipcMain.handle(
    IPC.CONTENT_PRIVATE_RUNTIME_REVOKE_GRANT,
    handlers.revokeGrant,
  );
  ipcMain.handle(
    IPC.CONTENT_PRIVATE_RUNTIME_SET_APPLICATION_STATE,
    handlers.setApplicationState,
  );
}
