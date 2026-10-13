import { describe, expect, it } from "vitest";

import {
  createLocalhostBridgeAudience,
  issueLocalhostBridgeOperationCapability,
  LOCALHOST_BRIDGE_OPERATION_CAPABILITY_FIELD,
  verifyLocalhostBridgeOperationCapability,
} from "./visual-edit-bridge-capability.js";

describe("localhost bridge operation capabilities", () => {
  const bridgeToken = "test-bridge-token-that-is-not-a-real-secret";
  const audience = createLocalhostBridgeAudience("/tmp/design-project");

  it("binds the exact operation and canonical JSON body while excluding its transport field", () => {
    const issuedAt = 1_800_000_000_000;
    const issued = issueLocalhostBridgeOperationCapability({
      bridgeToken,
      audience,
      operation: "POST /write-file",
      body: {
        relPath: "app.tsx",
        content: "export const value = 1;",
        metadata: { z: 1, a: ["x", { b: true, a: false }] },
      },
      issuedAt,
    });
    expect(issued.expiresAt).toBe(issuedAt + 120_000);
    const body = {
      content: "export const value = 1;",
      relPath: "app.tsx",
      metadata: { a: ["x", { a: false, b: true }], z: 1 },
      [LOCALHOST_BRIDGE_OPERATION_CAPABILITY_FIELD]: issued.capability,
    };

    expect(
      verifyLocalhostBridgeOperationCapability({
        bridgeToken,
        audience,
        operation: "POST /write-file",
        body,
        capability: issued.capability,
        now: issuedAt + 1,
      }),
    ).toEqual({ nonce: issued.nonce, expiresAt: issued.expiresAt });
  });

  it("rejects a changed endpoint, body, key, or signature", () => {
    const issued = issueLocalhostBridgeOperationCapability({
      bridgeToken,
      audience,
      operation: "POST /write-file",
      body: { relPath: "app.tsx", content: "approved" },
      issuedAt: 1_800_000_000_000,
    });

    const verify = (options: {
      bridgeToken?: string;
      operation?: string;
      body?: Record<string, unknown>;
      capability?: string;
    }) =>
      verifyLocalhostBridgeOperationCapability({
        bridgeToken: options.bridgeToken ?? bridgeToken,
        audience,
        operation: options.operation ?? "POST /write-file",
        body: options.body ?? { relPath: "app.tsx", content: "approved" },
        capability: options.capability ?? issued.capability,
        now: 1_800_000_000_001,
      });

    expect(verify({ operation: "POST /apply-edit" })).toBeNull();
    expect(
      verify({ body: { relPath: "app.tsx", content: "forged" } }),
    ).toBeNull();
    expect(verify({ bridgeToken: "another-bridge-token" })).toBeNull();
    expect(
      verify({ capability: `${issued.capability.slice(0, -1)}x` }),
    ).toBeNull();
  });

  it("rejects expired and future-issued capabilities", () => {
    const issued = issueLocalhostBridgeOperationCapability({
      bridgeToken,
      audience,
      operation: "POST /read-file",
      body: { relPath: "app.tsx" },
      issuedAt: 1_800_000_000_000,
    });

    expect(
      verifyLocalhostBridgeOperationCapability({
        bridgeToken,
        audience,
        operation: "POST /read-file",
        body: { relPath: "app.tsx" },
        capability: issued.capability,
        now: issued.expiresAt,
      }),
    ).toBeNull();
    expect(
      verifyLocalhostBridgeOperationCapability({
        bridgeToken,
        audience,
        operation: "POST /read-file",
        body: { relPath: "app.tsx" },
        capability: issued.capability,
        now: 1_799_999_900_000,
      }),
    ).toBeNull();
  });

  it("rejects non-JSON bodies at issuance", () => {
    expect(() =>
      issueLocalhostBridgeOperationCapability({
        bridgeToken,
        audience,
        operation: "POST /write-file",
        body: { content: Number.POSITIVE_INFINITY },
      }),
    ).toThrow(/non-finite number/);
  });

  it("binds capabilities to a canonical, platform-independent bridge root", () => {
    const posixAudience = createLocalhostBridgeAudience("/tmp/project/../app");
    expect(posixAudience).toBe(createLocalhostBridgeAudience("/tmp/app/"));
    expect(createLocalhostBridgeAudience("C:\\Users\\example\\project")).toBe(
      createLocalhostBridgeAudience("C:/Users/example/project/"),
    );
    expect(posixAudience).not.toBe(createLocalhostBridgeAudience("/tmp/other"));
    expect(() => createLocalhostBridgeAudience("relative/project")).toThrow(
      /absolute/,
    );
  });

  it("rejects a capability when the verifying bridge audience differs", () => {
    const issued = issueLocalhostBridgeOperationCapability({
      bridgeToken,
      audience,
      operation: "POST /write-file",
      body: { relPath: "app.tsx", content: "approved" },
      issuedAt: 1_800_000_000_000,
    });

    expect(
      verifyLocalhostBridgeOperationCapability({
        bridgeToken,
        audience: createLocalhostBridgeAudience("/tmp/another-project"),
        operation: "POST /write-file",
        body: { relPath: "app.tsx", content: "approved" },
        capability: issued.capability,
        now: 1_800_000_000_001,
      }),
    ).toBeNull();
  });
});
