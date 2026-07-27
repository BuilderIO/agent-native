import { DesignHtmlIntegrityError } from "@shared/html-integrity";
import { describe, expect, it } from "vitest";

import {
  classifyDesignSaveFailure,
  designSaveErrorMessage,
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
});
