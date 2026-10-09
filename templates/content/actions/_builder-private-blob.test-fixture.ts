import {
  PrivateBlobError,
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
  type PrivateBlobHandle,
  type PrivateBlobProvider,
} from "@agent-native/core/private-blob";

import { readBuilderExecutionPayload } from "./_builder-cms-blob-custody";

const PROVIDER_ID = "content-test-memory";

export function registerMemoryPrivateBlobProvider() {
  const blobs = new Map<string, Uint8Array>();
  let nextId = 0;
  const provider: PrivateBlobProvider = {
    id: PROVIDER_ID,
    name: "Content test memory",
    isConfigured: () => true,
    put: async (input) => {
      const id = `${PROVIDER_ID}:${++nextId}`;
      blobs.set(id, new Uint8Array(input.data));
      return { id, provider: PROVIDER_ID, opaque: true, encrypted: false };
    },
    read: async (handle: PrivateBlobHandle) => {
      const data = blobs.get(handle.id);
      if (!data) throw new PrivateBlobError("missing", "not_found");
      return { data, handle };
    },
    delete: async (handle: PrivateBlobHandle) => ({
      deleted: blobs.delete(handle.id),
      provider: PROVIDER_ID,
    }),
  };
  registerPrivateBlobProvider(provider);
  return {
    blobs,
    unregister: () => unregisterPrivateBlobProvider(PROVIDER_ID),
  };
}

export async function storedExecutionPayload(execution: {
  id: string;
  ownerEmail: string;
  sourceId: string;
  changeSetId: string;
  idempotencyKey: string;
  payloadJson: string;
}): Promise<any> {
  return readBuilderExecutionPayload({
    payloadJson: execution.payloadJson,
    binding: {
      ownerEmail: execution.ownerEmail,
      sourceId: execution.sourceId,
      changeSetId: execution.changeSetId,
      executionId: execution.id,
      idempotencyKey: execution.idempotencyKey,
    },
  });
}
