import { describe, expect, it } from "vitest";

import {
  authorizeProtectedDeliveryAdapter,
  getProtectedExecutionContext,
  markProtectedDisclosure,
  PROTECTED_DELIVERY_CAPABILITY,
  ProtectedTransientValue,
  protectedExecutionReceiptSchema,
  runWithProtectedExecutionContext,
} from "./protected-execution-context.js";

function receipt(actionName: string) {
  return protectedExecutionReceiptSchema.parse({
    version: 1,
    actionName,
    resourceType: "fixture",
    placement: "enrolled_broker",
    status: "executed",
  });
}

const deliveryAuthorization = authorizeProtectedDeliveryAdapter({
  adapterId: "test-adapter",
  capabilities: [PROTECTED_DELIVERY_CAPABILITY],
});

describe("protected execution context", () => {
  it("rejects unknown fields and malformed opaque identifiers", () => {
    expect(
      protectedExecutionReceiptSchema.safeParse({
        ...receipt("valid-action"),
        plaintext: "not admitted",
      }).success,
    ).toBe(false);
    expect(
      protectedExecutionReceiptSchema.safeParse({
        ...receipt("valid-action"),
        operationId: "short",
      }).success,
    ).toBe(false);
    expect(
      protectedExecutionReceiptSchema.safeParse({
        ...receipt("valid-action"),
        status: "queued",
      }).success,
    ).toBe(false);
  });

  it("freezes the canonical receipt inside an active context", () => {
    runWithProtectedExecutionContext(receipt("frozen-action"), () => {
      const active = getProtectedExecutionContext();
      expect(Object.isFrozen(active?.receipt)).toBe(true);
      expect(() => {
        (active?.receipt as { operationId?: string }).operationId =
          "object:mutation-canary";
      }).toThrow();
    });
  });

  it("marks disclosure only inside the active request scope", async () => {
    expect(getProtectedExecutionContext()).toBeUndefined();
    expect(markProtectedDisclosure()).toBe(false);

    await runWithProtectedExecutionContext(
      receipt("scoped-action"),
      async () => {
        expect(getProtectedExecutionContext()).toMatchObject({
          receipt: { actionName: "scoped-action" },
          disclosed: false,
        });
        await Promise.resolve();
        expect(markProtectedDisclosure()).toBe(true);
        expect(getProtectedExecutionContext()?.disclosed).toBe(true);
      },
    );

    expect(getProtectedExecutionContext()).toBeUndefined();
  });

  it("isolates concurrent request scopes", async () => {
    const observations = await Promise.all(
      ["left-action", "right-action"].map((actionName, index) =>
        runWithProtectedExecutionContext(receipt(actionName), async () => {
          await new Promise((resolve) =>
            setTimeout(resolve, index === 0 ? 5 : 0),
          );
          const before = getProtectedExecutionContext();
          if (index === 0) markProtectedDisclosure();
          await Promise.resolve();
          const after = getProtectedExecutionContext();
          return {
            actionName: before?.receipt.actionName,
            disclosed: after?.disclosed,
          };
        }),
      ),
    );

    expect(observations).toEqual([
      { actionName: "left-action", disclosed: true },
      { actionName: "right-action", disclosed: false },
    ]);
    expect(getProtectedExecutionContext()).toBeUndefined();
  });

  it("delivers plaintext only inside a disclosed async context", async () => {
    const transient = new ProtectedTransientValue(
      { plaintext: "PRIVATE-DELIVERY-CANARY" },
      receipt("delivery-action"),
    );

    const observed = await transient.deliver(
      deliveryAuthorization,
      async (value) => {
        expect(getProtectedExecutionContext()).toMatchObject({
          receipt: { actionName: "delivery-action" },
          disclosed: true,
        });
        await Promise.resolve();
        expect(getProtectedExecutionContext()?.disclosed).toBe(true);
        return value.plaintext;
      },
    );

    expect(observed).toBe("PRIVATE-DELIVERY-CANARY");
    expect(getProtectedExecutionContext()).toBeUndefined();
  });

  it("isolates concurrent protected deliveries", async () => {
    const deliveries = ["left-delivery", "right-delivery"].map(
      (actionName) =>
        new ProtectedTransientValue(actionName, receipt(actionName)),
    );

    const observations = await Promise.all(
      deliveries.map((transient, index) =>
        transient.deliver(deliveryAuthorization, async (value) => {
          await new Promise((resolve) =>
            setTimeout(resolve, index === 0 ? 5 : 0),
          );
          return {
            value,
            actionName: getProtectedExecutionContext()?.receipt.actionName,
            disclosed: getProtectedExecutionContext()?.disclosed,
          };
        }),
      ),
    );

    expect(observations).toEqual([
      {
        value: "left-delivery",
        actionName: "left-delivery",
        disclosed: true,
      },
      {
        value: "right-delivery",
        actionName: "right-delivery",
        disclosed: true,
      },
    ]);
    expect(getProtectedExecutionContext()).toBeUndefined();
  });
});
