import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../shared/optional-peer.js");
  vi.resetModules();
});

describe("CLI Sentry telemetry", () => {
  it("reports the missing optional peer once without rejecting the command path", async () => {
    vi.resetModules();
    let loads = 0;
    class MissingPeerError extends Error {
      readonly code = "ERR_AGENT_NATIVE_OPTIONAL_PEER";
      readonly packageName = "@sentry/node";
    }
    vi.doMock("../shared/optional-peer.js", () => ({
      OptionalPeerDependencyError: MissingPeerError,
      loadOptionalPeer: async () => {
        loads++;
        throw new MissingPeerError(
          "This feature requires optional peer @sentry/node. Install it with `pnpm add @sentry/node`.",
        );
      },
    }));

    const stderr = { write: vi.fn(() => true) };
    const { captureSentryException } = await import("./sentry-telemetry.js");
    expect(loads).toBe(0);

    await expect(
      captureSentryException(new Error("command failed"), undefined, stderr),
    ).resolves.toBeUndefined();
    await captureSentryException(
      new Error("another command failed"),
      undefined,
      stderr,
    );

    expect(loads).toBe(1);
    expect(stderr.write).toHaveBeenCalledTimes(1);
    expect(stderr.write.mock.calls[0]?.[0]).toContain(
      "requires optional peer @sentry/node",
    );
  });
});
