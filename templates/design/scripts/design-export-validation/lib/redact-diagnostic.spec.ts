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

  it("redacts prefixed credential names without changing ordinary fields", () => {
    expect(
      redactExportDiagnostic(
        'previewToken=PREVIEW_TOKEN_PLACEHOLDER csrf_token=CSRF_TOKEN_PLACEHOLDER x_api_key=X_API_KEY_PLACEHOLDER "previewToken":"QUOTED_PREVIEW_TOKEN_PLACEHOLDER" "csrf_token":"QUOTED_CSRF_TOKEN_PLACEHOLDER" "x_api_key":"QUOTED_X_API_KEY_PLACEHOLDER" tokenCount=3 title=Welcome',
      ),
    ).toBe(
      'previewToken=[redacted] csrf_token=[redacted] x_api_key=[redacted] "previewToken":"[redacted]" "csrf_token":"[redacted]" "x_api_key":"[redacted]" tokenCount=3 title=Welcome',
    );
  });

  it("redacts password and authorization values including quoted spaces", () => {
    expect(
      redactExportDiagnostic(
        "password=\"PASSWORD WITH SPACES PLACEHOLDER\" authorization='Bearer AUTHORIZATION WITH SPACES PLACEHOLDER' authorization=Bearer AUTHORIZATION_TOKEN_PLACEHOLDER passwordCount=3 title=Welcome",
      ),
    ).toBe(
      "password=\"[redacted]\" authorization='[redacted]' authorization=[redacted] passwordCount=3 title=Welcome",
    );
  });
  it("consumes complete escaped and compound credential values", () => {
    expect(
      redactExportDiagnostic(
        String.raw`client_secret="FAKE \"QUOTED\" VALUE" access_token=Bearer FAKE_TOKEN db_password='FAKE PASSWORD' adminPassword=FAKE_PASSWORD private_key="FAKE KEY" access_key=FAKE_KEY password="FAKE \"QUOTED\" PASSWORD" document_key=home passwordCount=3`,
      ),
    ).toBe(
      `client_secret="[redacted]" access_token=[redacted] db_password='[redacted]' adminPassword=[redacted] private_key="[redacted]" access_key=[redacted] password="[redacted]" document_key=home passwordCount=3`,
    );
  });
});
