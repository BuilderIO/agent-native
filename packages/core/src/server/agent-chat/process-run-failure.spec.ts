import { describe, expect, it, vi } from "vitest";

import { finalizeClaimedAgentChatProcessRunFailure } from "./process-run-failure.js";

function deps() {
  return {
    readBackgroundRunClaim: vi.fn(async () => ({
      dispatchMode: "background-processing" as const,
      status: "running" as const,
    })),
    recordRunDiagnostic: vi.fn(async () => {}),
    finalizeClaimedBackgroundRunFailure: vi.fn(async () => true),
  };
}

describe("claimed agent chat process-run failure diagnostics", () => {
  it("records the error name and bounded error code", async () => {
    const d = deps();
    const error = Object.assign(new Error("setup exploded"), {
      code: "missing_execution_fence",
    });

    await expect(
      finalizeClaimedAgentChatProcessRunFailure("run-1", error, d),
    ).resolves.toBe(true);

    expect(d.recordRunDiagnostic).toHaveBeenCalledWith(
      "run-1",
      "route_threw",
      "errorName=Error errorCode=missing_execution_fence failure=setup exploded",
      {
        format: "route_failure_v1",
        errorName: "Error",
        errorCode: "missing_execution_fence",
      },
    );
  });

  it("uses an error cause code when the top-level error has no code", async () => {
    const d = deps();
    const cause = Object.assign(new Error("database unavailable"), {
      code: "pool_timeout",
    });

    await expect(
      finalizeClaimedAgentChatProcessRunFailure(
        "run-2",
        new Error("setup exploded", { cause }),
        d,
      ),
    ).resolves.toBe(true);

    expect(d.recordRunDiagnostic).toHaveBeenCalledWith(
      "run-2",
      "route_threw",
      "errorName=Error errorCode=pool_timeout causeName=Error failure=setup exploded",
      {
        format: "route_failure_v1",
        errorName: "Error",
        errorCode: "pool_timeout",
        causeName: "Error",
      },
    );
  });

  it("extracts only bounded HTTP status and code from dispatch failures", async () => {
    const d = deps();

    await expect(
      finalizeClaimedAgentChatProcessRunFailure(
        "run-3",
        new Error("Background worker returned HTTP 503 code=dispatch_timeout"),
        d,
      ),
    ).resolves.toBe(true);

    expect(d.recordRunDiagnostic).toHaveBeenCalledWith(
      "run-3",
      "route_threw",
      "errorName=Error httpStatus=503 errorCode=dispatch_timeout failure=Background worker returned HTTP 503 code=dispatch_timeout",
      {
        format: "route_failure_v1",
        errorName: "Error",
        errorCode: "dispatch_timeout",
        httpStatus: "503",
      },
    );
  });

  it("omits malformed error codes", async () => {
    const d = deps();
    const error = Object.assign(new Error("setup exploded"), {
      code: "private failure detail",
    });

    await expect(
      finalizeClaimedAgentChatProcessRunFailure("run-4", error, d),
    ).resolves.toBe(true);

    expect(d.recordRunDiagnostic).toHaveBeenCalledWith(
      "run-4",
      "route_threw",
      "errorName=Error failure=setup exploded",
      { format: "route_failure_v1", errorName: "Error" },
    );
  });

  it("records non-error values without inventing an error name", async () => {
    const d = deps();

    await expect(
      finalizeClaimedAgentChatProcessRunFailure("run-5", null, d),
    ).resolves.toBe(true);

    expect(d.recordRunDiagnostic).toHaveBeenCalledWith(
      "run-5",
      "route_threw",
      "errorName=NonError failure=null",
      { format: "route_failure_v1", errorName: "NonError" },
    );
  });

  it("does not label an error with an unsafe name as a non-error", async () => {
    const d = deps();
    const error = Object.assign(new Error("setup exploded"), {
      name: "Private Error",
    });

    await expect(
      finalizeClaimedAgentChatProcessRunFailure("run-12", error, d),
    ).resolves.toBe(true);

    expect(d.recordRunDiagnostic).toHaveBeenCalledWith(
      "run-12",
      "route_threw",
      "errorName=unknown failure=setup exploded",
      { format: "route_failure_v1", errorName: "unknown" },
    );
  });

  it("omits non-string error codes", async () => {
    const d = deps();
    const error = Object.assign(new Error("setup exploded"), { code: 503 });

    await expect(
      finalizeClaimedAgentChatProcessRunFailure("run-6", error, d),
    ).resolves.toBe(true);

    expect(d.recordRunDiagnostic).toHaveBeenCalledWith(
      "run-6",
      "route_threw",
      "errorName=Error failure=setup exploded",
      { format: "route_failure_v1", errorName: "Error" },
    );
  });

  it("accepts HTTP status without a code and rejects partial message matches", async () => {
    const d = deps();

    await finalizeClaimedAgentChatProcessRunFailure(
      "run-7",
      new Error("Background worker returned HTTP 503"),
      d,
    );
    await finalizeClaimedAgentChatProcessRunFailure(
      "run-8",
      new Error(
        "prefix Background worker returned HTTP 503 code=dispatch_timeout",
      ),
      d,
    );
    await finalizeClaimedAgentChatProcessRunFailure(
      "run-9",
      new Error(
        "Background worker returned HTTP 503 code=dispatch_timeout extra",
      ),
      d,
    );

    expect(d.recordRunDiagnostic).toHaveBeenNthCalledWith(
      1,
      "run-7",
      "route_threw",
      "errorName=Error httpStatus=503 failure=Background worker returned HTTP 503",
      {
        format: "route_failure_v1",
        errorName: "Error",
        httpStatus: "503",
      },
    );
    expect(d.recordRunDiagnostic).toHaveBeenNthCalledWith(
      2,
      "run-8",
      "route_threw",
      "errorName=Error failure=prefix Background worker returned HTTP 503 code=dispatch_timeout",
      { format: "route_failure_v1", errorName: "Error" },
    );
    expect(d.recordRunDiagnostic).toHaveBeenNthCalledWith(
      3,
      "run-9",
      "route_threw",
      "errorName=Error failure=Background worker returned HTTP 503 code=dispatch_timeout extra",
      { format: "route_failure_v1", errorName: "Error" },
    );
  });

  it("keeps unreadable error metadata from interrupting failure finalization", async () => {
    const d = deps();
    const error = new Error("setup exploded");
    Object.defineProperty(error, "cause", {
      get() {
        throw new Error("private getter detail");
      },
    });

    await expect(
      finalizeClaimedAgentChatProcessRunFailure("run-10", error, d),
    ).resolves.toBe(true);

    expect(d.recordRunDiagnostic).toHaveBeenCalledWith(
      "run-10",
      "route_threw",
      "errorMetadata=unreadable failure=setup exploded",
      { format: "route_failure_v1", errorMetadata: "unreadable" },
    );
    expect(d.finalizeClaimedBackgroundRunFailure).toHaveBeenCalled();
  });

  it("marks unreadable failure messages in diagnostics", async () => {
    const d = deps();
    const error = new Error();
    Object.defineProperty(error, "message", {
      get() {
        throw new Error("private getter detail");
      },
    });

    await expect(
      finalizeClaimedAgentChatProcessRunFailure("run-11", error, d),
    ).resolves.toBe(true);

    expect(d.recordRunDiagnostic).toHaveBeenCalledWith(
      "run-11",
      "route_threw",
      "errorMetadata=unreadable errorName=Error failure=unreadable thrown value",
      {
        format: "route_failure_v1",
        errorMetadata: "unreadable",
        errorName: "Error",
      },
    );
    expect(d.finalizeClaimedBackgroundRunFailure).toHaveBeenCalled();
  });
});
