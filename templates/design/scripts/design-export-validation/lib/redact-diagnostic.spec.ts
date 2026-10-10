import { describe, expect, it } from "vitest";

import { redactExportDiagnostic } from "./redact-diagnostic.js";

describe("redactExportDiagnostic", () => {
  it("removes URLs and redacts compound and common secret assignments", () => {
    const value =
      "request https://example.test/path?access_token=url-secret access_token=ACCESS_TOKEN_PLACEHOLDER refresh_token=REFRESH_TOKEN_PLACEHOLDER client_secret=CLIENT_SECRET_PLACEHOLDER api_key=API_KEY_PLACEHOLDER token=TOKEN_PLACEHOLDER secret=SECRET_PLACEHOLDER signature=SIGNATURE_PLACEHOLDER";

    expect(redactExportDiagnostic(value)).toBe(
      "request [URL] access_token=[redacted] refresh_token=[redacted] client_secret=[redacted] api_key=[redacted] token=[redacted] secret=[redacted] signature=[redacted]",
    );
  });

  it("keeps ordinary text and unrelated values", () => {
    expect(
      redactExportDiagnostic(
        "Export completed for document=home title=Welcome",
      ),
    ).toBe("Export completed for document=home title=Welcome");
  });

  it("redacts quoted diagnostic fields and API key spellings", () => {
    expect(
      redactExportDiagnostic(
        '{"access_token":"ACCESS_TOKEN_PLACEHOLDER","api key":"API_KEY_PLACEHOLDER","apiKey":"CAMEL_API_KEY_PLACEHOLDER"}',
      ),
    ).toBe(
      '{"access_token":"[redacted]","api key":"[redacted]","apiKey":"[redacted]"}',
    );
  });
});
