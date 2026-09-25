/**
 * Pins the assumption behind `isProviderCredentialFailure`.
 *
 * Core raises "no credential available" as an untyped `Error`, so the design
 * app recognizes it by message. That is only safe if something fails loudly
 * when core rewords it — so these tests drive the REAL
 * `createProviderApiRuntime` into both failure shapes rather than asserting
 * against a hand-copied string.
 */

import { readFileSync } from "node:fs";

import { createProviderApiRuntime } from "@agent-native/core/provider-api";
import { describe, expect, it } from "vitest";

import {
  isProviderCredentialFailure,
  rethrowFigmaProviderFailure,
} from "./figma-import-errors.js";

function runtimeWith(options: {
  credentialContext: unknown;
  resolveCredential?: () => null;
}) {
  return createProviderApiRuntime({
    appId: "design",
    providerIds: ["figma"],
    localCredentialSource: "design_local",
    getCredentialContext: () => options.credentialContext as never,
    resolveCredential: async () => options.resolveCredential?.() ?? null,
  });
}

async function captureExecuteError(runtime: {
  executeRequest: (args: never) => Promise<unknown>;
}): Promise<unknown> {
  try {
    await runtime.executeRequest({
      provider: "figma",
      method: "GET",
      path: "/files/abcDEF12345",
    } as never);
  } catch (error) {
    return error;
  }
  throw new Error("expected the provider request to fail");
}

describe("provider credential failures", () => {
  it("recognizes a missing request context from the real runtime", async () => {
    const error = await captureExecuteError(
      runtimeWith({ credentialContext: null }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(isProviderCredentialFailure(error)).toBe(true);
  });

  it("recognizes an unresolvable credential from the real runtime", async () => {
    const error = await captureExecuteError(
      runtimeWith({
        credentialContext: {
          userEmail: "designer@example.com",
          organizationId: "org-1",
        },
        resolveCredential: () => null,
      }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(isProviderCredentialFailure(error)).toBe(true);
  });

  it("recognizes the Design app's own missing-context refusal", () => {
    // Raised by the getCredentialContext callback in provider-api.ts, which
    // runs before core's equivalent check. Read the literal out of the source
    // rather than copying it, so rewording that message fails here.
    const source = readFileSync("server/lib/provider-api.ts", "utf8");
    const message = /throw new Error\(\s*"([^"]+)"/.exec(source)?.[1];

    expect(message).toBeTruthy();
    expect(isProviderCredentialFailure(new Error(message!))).toBe(true);
  });

  it("turns a recognized credential failure into a user-facing auth diagnosis", () => {
    expect(() =>
      rethrowFigmaProviderFailure(
        new Error("figma credential not configured. Tried: FIGMA_ACCESS_TOKEN"),
      ),
    ).toThrow(/No Figma access token is available/);

    try {
      rethrowFigmaProviderFailure(
        new Error("figma credential not configured. Tried: FIGMA_ACCESS_TOKEN"),
      );
    } catch (error) {
      expect((error as { errorCode?: string }).errorCode).toBe(
        "figma_auth_required",
      );
      expect((error as { statusCode?: number }).statusCode).toBe(401);
      // The credential key and any scope-gap wiring detail stay in the log.
      expect((error as Error).message).not.toMatch(/FIGMA_ACCESS_TOKEN/);
    }
  });

  it("leaves an unrelated failure alone so it still reports as a real bug", () => {
    const bug = new TypeError("cannot read properties of undefined");
    expect(isProviderCredentialFailure(bug)).toBe(false);
    expect(() => rethrowFigmaProviderFailure(bug)).toThrow(bug);
  });

  it("does not re-wrap a Figma diagnosis that already has its own code", () => {
    const already = Object.assign(new Error("Figma nodes request failed"), {
      errorCode: "figma_request_failed",
    });
    expect(isProviderCredentialFailure(already)).toBe(false);
    expect(() => rethrowFigmaProviderFailure(already)).toThrow(already);
  });
});
