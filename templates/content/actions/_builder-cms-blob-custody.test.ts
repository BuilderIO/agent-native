import { ActionContractError } from "@agent-native/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const blobs = vi.hoisted(() => {
  const stored = new Map<string, Uint8Array>();
  let nextId = 0;
  return {
    stored,
    put: vi.fn(async (input: { data: Uint8Array }) => {
      const id = `blob-${++nextId}`;
      stored.set(id, input.data);
      return {
        id,
        provider: "test",
        opaque: true as const,
        encrypted: true,
      };
    }),
    read: vi.fn(async (handle: { id: string }) => {
      const data = stored.get(handle.id);
      if (!data) throw new Error("missing");
      return { data, handle };
    }),
    delete: vi.fn(async (handle: { id: string }) => ({
      deleted: stored.delete(handle.id),
      provider: "test",
    })),
  };
});

vi.mock("@agent-native/core/private-blob", () => ({
  putPrivateBlob: blobs.put,
  readPrivateBlob: blobs.read,
  deletePrivateBlob: blobs.delete,
}));

import {
  BUILDER_EXECUTION_PAYLOAD_BLOB_KEY,
  deleteBuilderPrivatePayload,
  isBuilderPrivatePayloadBoundToSource,
  putBuilderPrivatePayload,
  readBuilderExecutionPayload,
  readBuilderPrivatePayload,
} from "./_builder-cms-blob-custody";

describe("Builder private blob custody", () => {
  beforeEach(() => {
    blobs.stored.clear();
    vi.clearAllMocks();
  });

  it("round-trips through only the serialized opaque reference", async () => {
    const binding = { ownerEmail: "alice@example.com", sourceId: "source-1" };
    const reference = await putBuilderPrivatePayload({
      payload: { canonical: { data: { secret: "private" } } },
      binding,
      label: "snapshot",
      ownerEmail: binding.ownerEmail,
    });

    expect(reference).not.toContain("secret");
    await expect(
      readBuilderPrivatePayload({ reference, binding, label: "snapshot" }),
    ).resolves.toEqual({ canonical: { data: { secret: "private" } } });
  });

  it("fails closed for missing, malformed, drifted, and deleted blobs", async () => {
    const binding = { ownerEmail: "alice@example.com", sourceId: "source-1" };
    await expect(
      readBuilderPrivatePayload({
        reference: null,
        binding,
        label: "snapshot",
      }),
    ).rejects.toMatchObject({
      errorCode: "BUILDER_PRIVATE_PAYLOAD_UNAVAILABLE",
    } satisfies Partial<ActionContractError>);

    const reference = await putBuilderPrivatePayload({
      payload: { value: 1 },
      binding,
      label: "snapshot",
    });
    await expect(
      readBuilderPrivatePayload({
        reference,
        binding: { ...binding, sourceId: "source-2" },
        label: "snapshot",
      }),
    ).rejects.toMatchObject({
      errorCode: "BUILDER_PRIVATE_PAYLOAD_UNAVAILABLE",
    });

    await expect(deleteBuilderPrivatePayload(reference)).resolves.toBe(true);
    await expect(
      readBuilderPrivatePayload({ reference, binding, label: "snapshot" }),
    ).rejects.toMatchObject({
      errorCode: "BUILDER_PRIVATE_PAYLOAD_UNAVAILABLE",
    });
  });

  it("uses immutable keys for successive writes with the same binding", async () => {
    const binding = { sourceId: "source-1" };
    const first = await putBuilderPrivatePayload({
      payload: { value: 1 },
      binding,
      label: "snapshot",
    });
    const second = await putBuilderPrivatePayload({
      payload: { value: 2 },
      binding,
      label: "snapshot",
    });
    const keys = blobs.put.mock.calls.map(
      ([input]) => (input as { key?: string }).key,
    );
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).not.toBe(keys[0]);
    await expect(
      readBuilderPrivatePayload({
        reference: first,
        binding,
        label: "snapshot",
      }),
    ).resolves.toEqual({ value: 1 });
    await expect(
      readBuilderPrivatePayload({
        reference: second,
        binding,
        label: "snapshot",
      }),
    ).resolves.toEqual({ value: 2 });
  });

  it("only recognizes deletion refs bound to the exact owner and source", async () => {
    const reference = await putBuilderPrivatePayload({
      payload: { value: 1 },
      binding: { ownerEmail: "alice@example.com", sourceId: "source-1" },
      label: "snapshot",
    });

    expect(
      isBuilderPrivatePayloadBoundToSource(
        reference,
        "alice@example.com",
        "source-1",
      ),
    ).toBe(true);
    expect(
      isBuilderPrivatePayloadBoundToSource(
        reference,
        "mallory@example.com",
        "source-1",
      ),
    ).toBe(false);
    expect(
      isBuilderPrivatePayloadBoundToSource(
        reference,
        "alice@example.com",
        "source-2",
      ),
    ).toBe(false);
  });

  it("cleans only the newly written blob when readback fails", async () => {
    const binding = { sourceId: "source-1" };
    const first = await putBuilderPrivatePayload({
      payload: { value: 1 },
      binding,
      label: "snapshot",
    });
    blobs.read.mockRejectedValueOnce(new Error("readback unavailable"));
    await expect(
      putBuilderPrivatePayload({
        payload: { value: 2 },
        binding,
        label: "snapshot",
      }),
    ).rejects.toMatchObject({
      errorCode: "BUILDER_PRIVATE_PAYLOAD_UNAVAILABLE",
    });
    expect(blobs.delete).toHaveBeenCalledTimes(1);
    expect(blobs.stored.size).toBe(1);
    await expect(
      readBuilderPrivatePayload({
        reference: first,
        binding,
        label: "snapshot",
      }),
    ).resolves.toEqual({ value: 1 });
  });

  it("rejects bytes tampered with after storage", async () => {
    const binding = { sourceId: "source-1" };
    const reference = await putBuilderPrivatePayload({
      payload: { value: 1 },
      binding,
      label: "snapshot",
    });
    const { handle } = JSON.parse(reference);
    blobs.stored.set(handle.id, new TextEncoder().encode('{"value":2}'));
    await expect(
      readBuilderPrivatePayload({ reference, binding, label: "snapshot" }),
    ).rejects.toMatchObject({
      errorCode: "BUILDER_PRIVATE_PAYLOAD_UNAVAILABLE",
    });
  });

  it.each(["null", "[]", "1", "broken"])(
    "rejects malformed execution payload %s",
    async (payloadJson) => {
      await expect(
        readBuilderExecutionPayload({
          payloadJson,
          binding: {
            ownerEmail: "alice@example.com",
            sourceId: "source-1",
            changeSetId: "change-1",
            executionId: "execution-1",
            idempotencyKey: "operation-1",
          },
        }),
      ).rejects.toMatchObject({
        errorCode: "BUILDER_PRIVATE_PAYLOAD_UNAVAILABLE",
      });
    },
  );

  it.each([null, [], 1])(
    "rejects malformed execution blob payload %j",
    async (payload) => {
      const binding = {
        ownerEmail: "alice@example.com",
        sourceId: "source-1",
        changeSetId: "change-1",
        executionId: "execution-1",
        idempotencyKey: "operation-1",
      };
      const reference = await putBuilderPrivatePayload({
        payload,
        binding,
        label: "Builder prepared request and receipt",
      });
      await expect(
        readBuilderExecutionPayload({
          payloadJson: JSON.stringify({
            [BUILDER_EXECUTION_PAYLOAD_BLOB_KEY]: reference,
          }),
          binding,
        }),
      ).rejects.toMatchObject({
        errorCode: "BUILDER_PRIVATE_PAYLOAD_UNAVAILABLE",
      });
    },
  );
});
