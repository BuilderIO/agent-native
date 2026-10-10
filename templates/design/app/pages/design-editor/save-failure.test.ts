import { DesignHtmlIntegrityError } from "@shared/html-integrity";
import { describe, expect, it, vi } from "vitest";

import {
  classifyDesignSaveFailure,
  designSaveErrorMessage,
  isDesignSaveSuccessConflict,
  patchProofStatusAfterPersistedSave,
  reportDesignSaveFailure,
} from "./save-failure";

describe("Design save failure classification", () => {
  it("uses reconnect language only for genuine offline/network failures", () => {
    expect(
      classifyDesignSaveFailure(new TypeError("Failed to fetch"), true),
    ).toBe("offline");
    expect(classifyDesignSaveFailure(new Error("anything"), false)).toBe(
      "offline",
    );
  });

  it("treats the action client's rethrown fetch failure as offline", () => {
    expect(
      classifyDesignSaveFailure(
        new Error("Action update-design failed: Failed to fetch"),
        true,
      ),
    ).toBe("offline");
    expect(
      classifyDesignSaveFailure(
        Object.assign(
          new Error("Action update-design failed: failed to fetch upstream"),
          { status: 502 },
        ),
        true,
      ),
    ).toBe("other");
  });

  it("shows the server error instead of the reconnect warning when a save is rejected online", () => {
    const report = {
      warnChangesWillRetry: vi.fn(),
      showConflict: vi.fn(),
      showError: vi.fn(),
    };
    reportDesignSaveFailure(
      Object.assign(new Error("Action update-design failed: Internal error"), {
        status: 500,
      }),
      true,
      report,
    );
    expect(report.warnChangesWillRetry).not.toHaveBeenCalled();
    expect(report.showConflict).not.toHaveBeenCalled();
    expect(report.showError).toHaveBeenCalledWith(
      "Action update-design failed: Internal error",
    );
  });

  it("reports a rejected stale save as a conflict, not the raw server text", () => {
    const report = {
      warnChangesWillRetry: vi.fn(),
      showConflict: vi.fn(),
      showError: vi.fn(),
    };
    reportDesignSaveFailure(
      Object.assign(
        new Error(
          "File changed since it was read. Re-read the file and retry.",
        ),
        { status: 409 },
      ),
      true,
      report,
    );
    expect(report.showConflict).toHaveBeenCalledTimes(1);
    expect(report.showError).not.toHaveBeenCalled();
    expect(report.warnChangesWillRetry).not.toHaveBeenCalled();
  });

  it("warns that changes will save when reconnected only for a network failure", () => {
    const report = {
      warnChangesWillRetry: vi.fn(),
      showConflict: vi.fn(),
      showError: vi.fn(),
    };
    reportDesignSaveFailure(
      new Error("Action update-design failed: Failed to fetch"),
      true,
      report,
    );
    reportDesignSaveFailure(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
      true,
      report,
    );
    expect(report.warnChangesWillRetry).toHaveBeenCalledTimes(1);
    expect(report.showConflict).not.toHaveBeenCalled();
    expect(report.showError).not.toHaveBeenCalled();
  });

  it("silences intentional HMR/navigation aborts", () => {
    expect(
      classifyDesignSaveFailure(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
        true,
      ),
    ).toBe("intentional-abort");
  });

  it("distinguishes source conflicts and HTML-integrity rejection from connectivity", () => {
    expect(
      classifyDesignSaveFailure(
        Object.assign(new Error("File changed since it was read"), {
          status: 409,
        }),
        true,
      ),
    ).toBe("conflict");
    expect(
      classifyDesignSaveFailure(
        new DesignHtmlIntegrityError("managed-marker-orphaned"),
        true,
      ),
    ).toBe("invalid-html");
  });

  it("does not call arbitrary storage/server failures reconnects", () => {
    expect(
      classifyDesignSaveFailure(new Error("IndexedDB unavailable"), true),
    ).toBe("other");
    expect(classifyDesignSaveFailure(new Error("Internal error"), true)).toBe(
      "other",
    );
  });

  it("strips the transport-safe HTML error code from user-facing detail", () => {
    expect(
      designSaveErrorMessage(
        new DesignHtmlIntegrityError("managed-marker-orphaned"),
      ),
    ).toBe(
      "The edit was not applied because it would make the design HTML invalid.",
    );
  });

  it("treats a 200 stale-mirror skip as a conflict", () => {
    expect(isDesignSaveSuccessConflict(false)).toBe(true);
    expect(isDesignSaveSuccessConflict(true)).toBe(false);
    expect(patchProofStatusAfterPersistedSave(false)).toBe("failed");
    expect(patchProofStatusAfterPersistedSave(true)).toBe("applied");
  });
});
