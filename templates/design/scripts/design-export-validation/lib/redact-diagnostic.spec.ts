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

  it("redacts credential assignments nested inside quoted diagnostic values", () => {
    expect(
      redactExportDiagnostic('message="login failed password=FAKE_PASSWORD"'),
    ).toBe('message="login failed password=[redacted]"');
  });

  it("redacts escaped quoted credentials nested inside diagnostic values", () => {
    expect(
      redactExportDiagnostic(
        String.raw`message="login failed password=\"FAKE PASSWORD\""`,
      ),
    ).toBe(String.raw`message="login failed password=\"[redacted]\""`);
  });

  it("preserves mixed nested quote styles around redacted credentials", () => {
    expect(
      redactExportDiagnostic(
        'message="login failed password=\'FAKE SINGLE\' api_key=\\"FAKE DOUBLE\\""',
      ),
    ).toBe(
      'message="login failed password=\'[redacted]\' api_key=\\"[redacted]\\""',
    );
  });

  it("classifies secret key spellings without matching ordinary keyboard fields", () => {
    expect(
      redactExportDiagnostic(
        "secret_key=FAKE_SECRET SECRET_KEY=FAKE_SECRET secretKey=FAKE_SECRET x_secret_key=FAKE_SECRET keyboard=music",
      ),
    ).toBe(
      "secret_key=[redacted] SECRET_KEY=[redacted] secretKey=[redacted] x_secret_key=[redacted] keyboard=music",
    );
  });

  it("fails closed for deeply nested quoted diagnostics", () => {
    let value = "password=FAKE_DEEP_SECRET";
    for (let depth = 0; depth < 12; depth += 1) {
      value = `message=${JSON.stringify(value)}`;
    }

    expect(redactExportDiagnostic(value)).not.toContain("FAKE_DEEP_SECRET");
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

describe("redactExportDiagnostic nested credential regressions", () => {
  it("redacts credentials nested in bare assignment values and object values", () => {
    expect(redactExportDiagnostic("message=password=FAKE_PASSWORD")).toBe(
      "message=password=[redacted]",
    );
    expect(redactExportDiagnostic('payload={"password":"FAKE_PASSWORD"}')).toBe(
      'payload={"password":"[redacted]"}',
    );
    expect(
      redactExportDiagnostic(
        'payload={"password":"FAKE_PASSWORD","title":"Welcome"}',
      ),
    ).toBe('payload={"password":"[redacted]","title":"Welcome"}');
  });

  it("redacts JSON-escaped credential keys nested in quoted values", () => {
    expect(
      redactExportDiagnostic(
        String.raw`config="{\"password\":\"FAKE_SECRET\"}"`,
      ),
    ).toBe(String.raw`config="{\"password\":\"[redacted]\"}"`);
  });

  it("redacts credential keys nested through two JSON escape layers", () => {
    const nestedCredential = String.raw`config="{\\\"password\\\":\\\"FAKE_SECRET\\\"}"`;
    expect(redactExportDiagnostic(nestedCredential)).toBe(
      String.raw`config="{\\\"password\\\":\\\"[redacted]\\\"}"`,
    );

    const nestedWithHarmlessField = String.raw`config="{\\\"password\\\":\\\"FAKE_SECRET\\\",\\\"title\\\":\\\"Welcome\\\"}"`;
    expect(redactExportDiagnostic(nestedWithHarmlessField)).toBe(
      String.raw`config="{\\\"password\\\":\\\"[redacted]\\\",\\\"title\\\":\\\"Welcome\\\"}"`,
    );
  });

  it("redacts credentials through four JSON.stringify layers and preserves ordinary properties", () => {
    const credentialObject = {
      password: "FAKE_SECRET",
      keyboard: "music",
      userId: "demo-user",
    };
    const redactedObject = {
      ...credentialObject,
      password: "[redacted]",
    };
    let encodedCredential = JSON.stringify(credentialObject);
    let encodedRedacted = JSON.stringify(redactedObject);

    for (let layer = 1; layer <= 4; layer += 1) {
      if (layer > 1) {
        encodedCredential = JSON.stringify(encodedCredential);
        encodedRedacted = JSON.stringify(encodedRedacted);
      }

      expect(redactExportDiagnostic(`config=${encodedCredential}`)).toBe(
        `config=${encodedRedacted}`,
      );
    }
  });

  it("redacts signing and encryption key spellings while preserving ordinary keys", () => {
    expect(
      redactExportDiagnostic(
        "signing_key=FAKE_SIGNING_SECRET signingKey=FAKE_SIGNING_SECRET x_signing_key=FAKE_SIGNING_SECRET encryption_key=FAKE_ENCRYPTION_SECRET encryptionKey=FAKE_ENCRYPTION_SECRET x_encryption_key=FAKE_ENCRYPTION_SECRET keyboard=music document_key=home",
      ),
    ).toBe(
      "signing_key=[redacted] signingKey=[redacted] x_signing_key=[redacted] encryption_key=[redacted] encryptionKey=[redacted] x_encryption_key=[redacted] keyboard=music document_key=home",
    );
  });

  it("fails closed for object and array values assigned to sensitive keys", () => {
    expect(
      redactExportDiagnostic('private_key={"kty":"RSA","d":"FAKE_PRIVATE"}'),
    ).toBe("private_key=[redacted]");
    expect(redactExportDiagnostic("password=[FAKE_ONE,FAKE_TWO]")).toBe(
      "password=[redacted]",
    );
    expect(
      redactExportDiagnostic(
        'payload={"password":"FAKE_PASSWORD","title":"Welcome"}',
      ),
    ).toBe('payload={"password":"[redacted]","title":"Welcome"}');
  });
});

describe("redactExportDiagnostic truncated values", () => {
  it("fails closed for truncated sensitive quotes and preserves nested credentials", () => {
    expect(redactExportDiagnostic('password="FAKE_PASSWORD')).toBe(
      "password=[redacted]",
    );
    expect(redactExportDiagnostic(String.raw`password=\"FAKE_PASSWORD`)).toBe(
      "password=[redacted]",
    );
    expect(redactExportDiagnostic(String.raw`password=\\\"FAKE_PASSWORD`)).toBe(
      "password=[redacted]",
    );
    expect(
      redactExportDiagnostic('message="login failed password=FAKE_PASSWORD'),
    ).toBe('message="login failed password=[redacted]');
    expect(redactExportDiagnostic("password=")).toBe("password=");
    expect(redactExportDiagnostic("password=   ")).toBe("password=   ");
  });
});
