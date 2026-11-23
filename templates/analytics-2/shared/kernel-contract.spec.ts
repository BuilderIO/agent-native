import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CONTRACT_VERSION,
  kernelAcknowledgementSchema,
  kernelCommandSchema,
  kernelEnvelopeSchema,
  kernelEventSchema,
  type KernelAcknowledgement,
  type KernelCommand,
  type KernelEnvelope,
  type KernelEvent,
} from "./kernel-contract.js";
import { kernelOutputSchema } from "./notebook-kernel-output.js";

export const kernelEnvelopeFixture: KernelEnvelope = kernelEnvelopeSchema.parse(
  {
    protocolVersion: CONTRACT_VERSION,
    namespaceId: "namespace-sample",
    generation: "4",
    commandId: "command-sample",
    runId: "run-sample",
    attemptId: "attempt-sample",
    resumeCursor: "9007199254740993",
  },
);

export const kernelCommandFixture: KernelCommand = {
  ...kernelEnvelopeFixture,
  command: { operation: "execute-python", source: "print(42)", inputs: [] },
};

export const kernelAcknowledgementFixture: KernelAcknowledgement = {
  ...kernelEnvelopeFixture,
  acknowledgement: { status: "accepted" },
};

export const kernelEventFixture: KernelEvent = kernelEventSchema.parse({
  ...kernelEnvelopeFixture,
  sequence: "9007199254740994",
  event: { type: "stream", channel: "stdout", text: "42\n" },
});

describe("kernel wire contract", () => {
  it("round-trips a command, its acknowledgement and resumed stream output", () => {
    expect(
      kernelCommandSchema.parse(
        JSON.parse(JSON.stringify(kernelCommandFixture)),
      ),
    ).toStrictEqual(kernelCommandFixture);
    expect(
      kernelAcknowledgementSchema.parse(
        JSON.parse(JSON.stringify(kernelAcknowledgementFixture)),
      ),
    ).toStrictEqual(kernelAcknowledgementFixture);
    expect(
      kernelEventSchema.parse(JSON.parse(JSON.stringify(kernelEventFixture))),
    ).toStrictEqual(kernelEventFixture);
  });

  describe.each([
    [
      "wire",
      (details: object) =>
        kernelEventSchema.safeParse({
          ...kernelEventFixture,
          event: { ...details, type: "error", reason: "execution_failed" },
        }),
      (details: object) => ({
        ...kernelEventFixture,
        event: { ...details, type: "error", reason: "execution_failed" },
      }),
    ],
    [
      "stored output",
      (details: object) =>
        kernelOutputSchema.safeParse({ ...details, kind: "error" }),
      (details: object) => ({ ...details, kind: "error" }),
    ],
  ] as const)("%s errors", (_name, parse, expected) => {
    const legacy = { trace: "Legacy failure", line: null };

    it("preserves legacy output and optional exception details", () => {
      const structured = {
        trace: "ValueError: failed",
        line: 2,
        exceptionName: "ValueError",
        exceptionMessage: "failed",
      };
      for (const details of [legacy, structured]) {
        const result = parse(details);
        expect(result).toStrictEqual({
          success: true,
          data: expected(details),
        });
      }
    });

    it("bounds exception names and messages by their UTF-8 size", () => {
      const limit = {
        ...legacy,
        exceptionName: "é".repeat(64),
        exceptionMessage: "é".repeat(4096),
      };
      expect(parse(limit).success).toBe(true);
      expect(
        parse({ ...limit, exceptionName: limit.exceptionName + "a" }).success,
      ).toBe(false);
      expect(
        parse({ ...limit, exceptionMessage: limit.exceptionMessage + "a" })
          .success,
      ).toBe(false);
    });
  });

  it("requires a generation and explicit resume cursor on the supported wire version", () => {
    expect(
      kernelCommandSchema.safeParse({
        ...kernelCommandFixture,
        generation: undefined,
      }).success,
    ).toBe(false);
    expect(
      kernelEventSchema.safeParse({
        ...kernelEventFixture,
        resumeCursor: undefined,
      }).success,
    ).toBe(false);
    expect(
      kernelCommandSchema.safeParse({
        ...kernelCommandFixture,
        protocolVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      kernelEnvelopeSchema.safeParse({
        ...kernelEnvelopeFixture,
        generation: "4e1",
      }).success,
    ).toBe(false);
  });

  it("requires bounded typed parameters separately from Dataframe SQL source", () => {
    const unbound = {
      ...kernelEnvelopeFixture,
      command: {
        operation: "execute-dataframe-sql",
        source: "select $1",
        inputs: [],
      },
    };
    expect(kernelCommandSchema.safeParse(unbound).success).toBe(false);
    const param = { type: "NUMERIC", value: "42.25" };
    const bound = {
      ...unbound,
      command: { ...unbound.command, params: [param] },
    };
    expect(kernelCommandSchema.parse(bound)).toEqual(bound);
    expect(
      kernelCommandSchema.safeParse({
        ...bound,
        command: {
          ...bound.command,
          params: Array.from({ length: 129 }, () => param),
        },
      }).success,
    ).toBe(false);
    expect(
      kernelCommandSchema.safeParse({
        ...bound,
        command: {
          ...bound.command,
          params: [{ type: "STRING", value: "é".repeat(2049) }],
        },
      }).success,
    ).toBe(false);
  });

  it("keeps command and attempt identities and conflict reasons distinct", () => {
    expectTypeOf<KernelEnvelope["commandId"]>().not.toExtend<
      KernelEnvelope["attemptId"]
    >();
    expect(
      kernelAcknowledgementSchema.safeParse({
        ...kernelAcknowledgementFixture,
        acknowledgement: { status: "stale", reason: "command_id_reused" },
      }).success,
    ).toBe(false);
    expect(
      kernelAcknowledgementSchema.safeParse({
        ...kernelAcknowledgementFixture,
        acknowledgement: { status: "rejected", reason: "unknown" },
      }).success,
    ).toBe(false);
  });
});
