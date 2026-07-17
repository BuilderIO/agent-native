import { E2EE_SIZE_LIMITS } from "@agent-native/core/e2ee";
import { describe, expect, it } from "vitest";

import {
  BROKER_RESULT_FRAME_MAX_BYTES,
  BROKER_RESULT_METADATA_MAX_BYTES,
  BrokerResultFrameError,
  decodeBrokerResultFrame,
  decodeBrokerResultMetadata,
  encodeBrokerResultFrame,
  encodeBrokerResultMetadata,
} from "./result-frame.js";

const encoder = new TextEncoder();
const metadata = {
  jobId: "job-transport-0001",
  state: "completed" as const,
  version: 1 as const,
};

function frameWithMetadata(metadata: string, ciphertext = new Uint8Array()) {
  const encoded = encoder.encode(metadata);
  const frame = new Uint8Array(4 + encoded.byteLength + ciphertext.byteLength);
  new DataView(frame.buffer).setUint32(0, encoded.byteLength, false);
  frame.set(encoded, 4);
  frame.set(ciphertext, 4 + encoded.byteLength);
  return frame;
}

describe("broker result frame codec", () => {
  it("encodes u32be length, canonical metadata, and exact ciphertext", () => {
    const ciphertext = Uint8Array.of(9, 8, 7, 6);
    const frame = encodeBrokerResultFrame(metadata, ciphertext);
    const metadataLength = new DataView(frame.buffer).getUint32(0, false);
    const metadataText = new TextDecoder().decode(
      frame.subarray(4, 4 + metadataLength),
    );
    expect(metadataText).toBe(
      '{"ciphertextLength":4,"jobId":"job-transport-0001","state":"completed","version":1}',
    );
    expect(decodeBrokerResultFrame(frame)).toEqual({
      metadata: {
        ciphertextLength: 4,
        jobId: "job-transport-0001",
        state: "completed",
        version: 1,
      },
      ciphertext,
    });
  });

  it.each([
    ["underflow", new Uint8Array(3)],
    [
      "metadata overflow",
      (() => {
        const frame = new Uint8Array(4);
        new DataView(frame.buffer).setUint32(
          0,
          BROKER_RESULT_METADATA_MAX_BYTES + 1,
          false,
        );
        return frame;
      })(),
    ],
    [
      "declared metadata beyond frame",
      (() => {
        const frame = new Uint8Array(5);
        new DataView(frame.buffer).setUint32(0, 2, false);
        return frame;
      })(),
    ],
  ])("rejects %s", (_name, frame) => {
    expect(() => decodeBrokerResultFrame(frame)).toThrow(
      BrokerResultFrameError,
    );
  });

  it("rejects metadata tampering, noncanonical JSON, and invalid UTF-8", () => {
    expect(() =>
      decodeBrokerResultFrame(frameWithMetadata('{ "ciphertextLength":0 }')),
    ).toThrow(BrokerResultFrameError);
    expect(() =>
      decodeBrokerResultFrame(
        frameWithMetadata('{"ciphertextLength":0,"ciphertextLength":0}'),
      ),
    ).toThrow(BrokerResultFrameError);
    expect(() => decodeBrokerResultMetadata(Uint8Array.of(0xff))).toThrow(
      BrokerResultFrameError,
    );
  });

  it("rejects ciphertext underflow, overflow, and trailing bytes", () => {
    expect(() =>
      decodeBrokerResultFrame(
        frameWithMetadata('{"ciphertextLength":2}', Uint8Array.of(1)),
      ),
    ).toThrow(BrokerResultFrameError);
    expect(() =>
      decodeBrokerResultFrame(
        frameWithMetadata('{"ciphertextLength":1}', Uint8Array.of(1, 2)),
      ),
    ).toThrow(BrokerResultFrameError);

    const valid = encodeBrokerResultFrame(metadata, Uint8Array.of(1));
    const trailing = new Uint8Array(valid.byteLength + 1);
    trailing.set(valid);
    expect(() => decodeBrokerResultFrame(trailing)).toThrow(
      BrokerResultFrameError,
    );
  });

  it("enforces metadata, ciphertext, and total bounds", () => {
    expect(BROKER_RESULT_FRAME_MAX_BYTES).toBe(
      4 +
        BROKER_RESULT_METADATA_MAX_BYTES +
        E2EE_SIZE_LIMITS.resultPayloadBytes,
    );
    expect(() =>
      encodeBrokerResultMetadata({
        ciphertextLength: 0,
        padding: "x".repeat(BROKER_RESULT_METADATA_MAX_BYTES),
      } as never),
    ).toThrow(BrokerResultFrameError);
    expect(() =>
      encodeBrokerResultFrame(
        metadata,
        new Uint8Array(E2EE_SIZE_LIMITS.resultPayloadBytes + 1),
      ),
    ).toThrow(BrokerResultFrameError);
  });

  it("rejects unknown or protected-looking metadata fields", () => {
    expect(() =>
      encodeBrokerResultMetadata({
        ...metadata,
        ciphertextLength: 0,
        title: "must remain encrypted",
      } as never),
    ).toThrow(BrokerResultFrameError);
    expect(() =>
      decodeBrokerResultFrame(
        frameWithMetadata(
          '{"ciphertextLength":0,"jobId":"job-transport-0001","state":"completed","title":"must remain encrypted","version":1}',
        ),
      ),
    ).toThrow(BrokerResultFrameError);
  });
});
