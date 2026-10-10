import { MAX_APPROVED_NATIVE_DEFINITION_HASHES } from "@shared/native-effect-trust";
import { describe, expect, it, vi } from "vitest";

import {
  postNativeApprovalState,
  readNativeApprovalHashes,
} from "./native-approval-bridge";

const hash = "a".repeat(64);

describe("native shader approval delivery", () => {
  it("accepts only action data for the exact Design file and a bounded hash shape", () => {
    const response = {
      designId: "design-1",
      fileId: "board-1",
      approvedDefinitionHashes: [hash],
    };
    expect(readNativeApprovalHashes(response, "design-1", "board-1")).toEqual({
      status: "ready",
      hashes: [hash],
    });
    expect(readNativeApprovalHashes(response, "design-2", "board-1")).toEqual({
      status: "unreadable",
    });
    expect(
      readNativeApprovalHashes(
        { ...response, approvedDefinitionHashes: ["unverified"] },
        "design-1",
        "board-1",
      ),
    ).toEqual({ status: "unreadable" });
    expect(
      readNativeApprovalHashes(
        {
          ...response,
          approvedDefinitionHashes: Array.from(
            { length: MAX_APPROVED_NATIVE_DEFINITION_HASHES + 1 },
            (_, index) => index.toString(16).padStart(64, "0"),
          ),
        },
        "design-1",
        "board-1",
      ),
    ).toEqual({ status: "unreadable" });
    expect(readNativeApprovalHashes(undefined, "design-1", "board-1")).toEqual({
      status: "pending",
    });
  });

  it("sends ready hashes and distinct unreadable status to the same-origin target", () => {
    const postMessage = vi.fn();
    postNativeApprovalState(
      { postMessage } as unknown as Window,
      "http://localhost:9310",
      { status: "ready", hashes: [hash] },
    );
    expect(postMessage).toHaveBeenCalledWith(
      { type: "native-shader-approvals", status: "ready", hashes: [hash] },
      "http://localhost:9310",
    );
    postNativeApprovalState(
      { postMessage } as unknown as Window,
      "http://localhost:9310",
      { status: "unreadable" },
    );
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: "native-shader-approvals", status: "unreadable" },
      "http://localhost:9310",
    );
  });
});
