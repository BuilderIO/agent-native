import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ trackDesignRelay: vi.fn() }));

vi.mock("./design-relay-tracking", () => ({
  trackDesignRelay: mocks.trackDesignRelay,
}));

import {
  browserDesignExportErrorType,
  trackBrowserDesignExported,
} from "./design-export-tracking";

describe("trackBrowserDesignExported", () => {
  beforeEach(() => {
    mocks.trackDesignRelay.mockReset();
  });

  it("records one design_exported with the browser export contract", () => {
    trackBrowserDesignExported("pdf_all_screens", {
      designId: "design-1",
      signedIn: false,
      status: "failed",
      errorType: "blob_failed",
      screenCount: 3,
    });

    expect(mocks.trackDesignRelay).toHaveBeenCalledTimes(1);
    expect(mocks.trackDesignRelay).toHaveBeenCalledWith(
      "design_exported",
      {
        output_id: "design-1",
        output_type: "design",
        export_format: "pdf_all_screens",
        render_location: "browser",
        status: "failed",
        error_type: "blob_failed",
        screen_count: 3,
      },
      { signedIn: false },
    );
  });

  it("omits the design id and optional facts the client does not have", () => {
    trackBrowserDesignExported("png", { status: "completed" });

    expect(mocks.trackDesignRelay.mock.calls[0]![1]).toEqual({
      output_type: "design",
      export_format: "png",
      render_location: "browser",
      status: "completed",
    });
  });

  it("never throws when the relay throws", () => {
    mocks.trackDesignRelay.mockImplementation(() => {
      throw new Error("relay down");
    });

    expect(() =>
      trackBrowserDesignExported("svg", { status: "completed" }),
    ).not.toThrow();
  });
});

describe("browserDesignExportErrorType", () => {
  it("uses the export error's enum code", () => {
    expect(browserDesignExportErrorType({ code: "write-failed" })).toBe(
      "write_failed",
    );
    expect(browserDesignExportErrorType({ code: "export_too_large" })).toBe(
      "export_too_large",
    );
  });

  it("reports an abort as cancelled", () => {
    expect(
      browserDesignExportErrorType(
        Object.assign(new Error("x"), { name: "AbortError" }),
      ),
    ).toBe("cancelled");
  });

  it("never forwards free-form text", () => {
    expect(
      browserDesignExportErrorType({ code: "Failed for user@example.com" }),
    ).toBe("export_error");
    expect(browserDesignExportErrorType(new Error("boom"))).toBe(
      "export_error",
    );
    expect(browserDesignExportErrorType(null)).toBe("export_error");
  });

  it("never throws on a hostile error", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("getter");
        },
      },
    );
    expect(browserDesignExportErrorType(hostile)).toBe("export_error");
  });
});
