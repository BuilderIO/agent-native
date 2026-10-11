import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { redactExportDiagnostic } from "./redact-diagnostic.js";

describe("redactExportDiagnostic", () => {
  it("removes URLs and redacts compound and common secret assignments", () => {
    const value =
      "request https://example.test/path?access_token=url-secret access_token=ACCESS_TOKEN_PLACEHOLDER refresh_token=REFRESH_TOKEN_PLACEHOLDER client_secret=CLIENT_SECRET_PLACEHOLDER api_key=API_KEY_PLACEHOLDER token=TOKEN_PLACEHOLDER secret=SECRET_PLACEHOLDER signature=SIGNATURE_PLACEHOLDER";

    expect(redactExportDiagnostic(value)).toBe(
      "request [URL] access_token=[redacted]",
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
    ).toBe("previewToken=[redacted]");
  });

  it("redacts password and authorization values including quoted spaces", () => {
    expect(
      redactExportDiagnostic(
        "password=\"PASSWORD WITH SPACES PLACEHOLDER\" authorization='Bearer AUTHORIZATION WITH SPACES PLACEHOLDER' authorization=Bearer AUTHORIZATION_TOKEN_PLACEHOLDER passwordCount=3 title=Welcome",
      ),
    ).toBe(
      "password=\"[redacted]\" authorization='[redacted]' authorization=[redacted]",
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
    ).toBe("secret_key=[redacted]");
    expect(redactExportDiagnostic("keyboard=music document_key=home")).toBe(
      "keyboard=music document_key=home",
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
    ).toBe(`client_secret="[redacted]" access_token=[redacted]`);
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
    ).toBe("signing_key=[redacted]");
    expect(redactExportDiagnostic("keyboard=music document_key=home")).toBe(
      "keyboard=music document_key=home",
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

describe("redactExportDiagnostic credential aliases and escaped quotes", () => {
  it("redacts an entire credential value containing escaped quotes", () => {
    const input = String.raw`config="{\"password\":\"FAKE \\\"Q\\\" SECRET\"}"`;
    expect(redactExportDiagnostic(input)).toBe(
      String.raw`config="{\"password\":\"[redacted]\"}"`,
    );
  });

  it("redacts common credential aliases while preserving ordinary fields", () => {
    const input =
      "apikey=FAKE_API passwd=FAKE_PASS pwd=FAKE_PWD cookie=FAKE_COOKIE\nset-cookie: session=FAKE_SESSION; HttpOnly keyboard=music\nkeyboard=music document_key=home";
    expect(redactExportDiagnostic(input)).toBe(
      "apikey=[redacted]\nset-cookie: [redacted]\nkeyboard=music document_key=home",
    );
  });

  it("fails closed for bare cookie pairs while preserving quoted JSON fields", () => {
    expect(
      redactExportDiagnostic(
        "Cookie=session=FAKE_COOKIE;csrf=FAKE_CSRF\nkeyboard=music",
      ),
    ).toBe("Cookie=[redacted]\nkeyboard=music");
    expect(
      redactExportDiagnostic(
        '"Cookie":"session=FAKE_COOKIE;csrf=FAKE_CSRF","title":"Welcome","keyboard":"music"',
      ),
    ).toBe('"Cookie":"[redacted]","title":"Welcome","keyboard":"music"');
    expect(
      redactExportDiagnostic(
        String.raw`Cookie="{\"session\":\"FAKE_COOKIE\",\"csrf\":\"FAKE_CSRF\"}" title=Welcome keyboard=music`,
      ),
    ).toBe(String.raw`Cookie="[redacted]" title=Welcome keyboard=music`);
  });
});

describe("redactExportDiagnostic encoded field boundaries", () => {
  it("preserves adjacent JSON fields when credentials end in backslashes at multiple depths", () => {
    for (const trailingBackslashes of [0, 1, 2, 3]) {
      const credential = `FAKE \"Q\" SECRET${"\\".repeat(trailingBackslashes)}`;
      const value = {
        password: credential,
        title: "Welcome",
        keyboard: "music",
      };
      const safe = { ...value, password: "[redacted]" };
      let encoded = JSON.stringify(value);
      let expected = JSON.stringify(safe);
      for (let layer = 0; layer <= 4; layer += 1) {
        expect(
          redactExportDiagnostic(`config=${encoded}`),
          `layer ${layer}, trailing ${trailingBackslashes}`,
        ).toBe(`config=${expected}`);
        encoded = JSON.stringify(encoded);
        expected = JSON.stringify(expected);
      }
    }
  });

  it("redacts every pair on a Set-Cookie header line and preserves following lines", () => {
    expect(
      redactExportDiagnostic(
        "Set-Cookie: session=FAKE_SESSION; Path=/; HttpOnly; SameSite=Lax, refresh=FAKE_REFRESH; Secure\nkeyboard=music\ndocument_key=home",
      ),
    ).toBe("Set-Cookie: [redacted]\nkeyboard=music\ndocument_key=home");
  });

  it("redacts credentials embedded in non-HTTP connection URLs", () => {
    expect(
      redactExportDiagnostic(
        "DATABASE_URL=postgresql://app:fake-password@db.internal:5432/app redis://:fake-password@cache:6379 postgresql://db.internal:5432/app",
      ),
    ).toBe(
      "DATABASE_URL=postgresql://[redacted]@db.internal:5432/app redis://[redacted]@cache:6379 postgresql://db.internal:5432/app",
    );
  });

  it("redacts bare credential tails through the line ending", () => {
    expect(
      redactExportDiagnostic(
        "password=SEC RETTAIL end\npassword=SEC&RETTAIL\npassword=SEC tail=RETTAIL\ntitle=Welcome\npassword=SEC tail=RETTAIL\r\nkeyboard=music",
      ),
    ).toBe(
      "password=[redacted]\npassword=[redacted]\npassword=[redacted]\ntitle=Welcome\npassword=[redacted]\r\nkeyboard=music",
    );
  });

  it("redacts an assignment-shaped secret tail through the line ending", () => {
    expect(redactExportDiagnostic("password=SEC tail=RETTAIL")).toBe(
      "password=[redacted]",
    );
  });

  it("redacts common credential aliases and access-key identifiers", () => {
    const input = [
      "apikey=FAKE_API",
      "passwd=FAKE_PASSWD",
      "pwd=FAKE_PWD",
      "cookie=FAKE_COOKIE",
      "pw=FAKE_PW",
      "pass=FAKE_PASS",
      "passphrase=FAKE_PASSPHRASE",
      "credentials=FAKE_CREDENTIALS",
      "AWS_ACCESS_KEY_ID=FAKE_AWS_ID",
      "accessKeyId=FAKE_ACCESS_ID",
      "secret_key=FAKE_SECRET_KEY",
      "signing_key=FAKE_SIGNING_KEY",
      "encryption_key=FAKE_ENCRYPTION_KEY",
      "keyboard=music document_key=home",
    ].join("\n");

    expect(redactExportDiagnostic(input)).toBe(
      [
        "apikey=[redacted]",
        "passwd=[redacted]",
        "pwd=[redacted]",
        "cookie=[redacted]",
        "pw=[redacted]",
        "pass=[redacted]",
        "passphrase=[redacted]",
        "credentials=[redacted]",
        "AWS_ACCESS_KEY_ID=[redacted]",
        "accessKeyId=[redacted]",
        "secret_key=[redacted]",
        "signing_key=[redacted]",
        "encryption_key=[redacted]",
        "keyboard=music document_key=home",
      ].join("\n"),
    );
  });
});

describe("redactExportDiagnostic value boundaries", () => {
  it("redacts a multiline PEM block and preserves fields after its footer", () => {
    const input = [
      "private_key=-----BEGIN PRIVATE KEY-----",
      "FAKE_PEM_PAYLOAD_LINE",
      "-----END PRIVATE KEY-----",
      "keyboard=music",
    ].join("\n");

    expect(redactExportDiagnostic(input)).toBe(
      "private_key=[redacted]\nkeyboard=music",
    );
  });

  it("preserves JSON siblings after redacting a numeric password", () => {
    expect(
      redactExportDiagnostic(
        'payload={"password":123,"user":"alice","keyboard":"music"}',
      ),
    ).toBe('payload={"password":[redacted],"user":"alice","keyboard":"music"}');
  });

  it("redacts URL userinfo containing path and at-sign delimiters", () => {
    expect(redactExportDiagnostic("postgresql://user:pa/ss@host/db")).toBe(
      "postgresql://[redacted]@host/db",
    );
    expect(redactExportDiagnostic("postgresql://user:p@ss@host/db")).toBe(
      "postgresql://[redacted]@host/db",
    );
    const questionMarkPassword = ["postgresql://user:pa", "?ss@host/db"].join(
      "",
    );
    expect(redactExportDiagnostic(questionMarkPassword)).toBe(
      "postgresql://[redacted]@host/db",
    );
    const hashPassword = ["postgresql://user:pa", "#ss@host/db"].join("");
    expect(redactExportDiagnostic(hashPassword)).toBe(
      "postgresql://[redacted]@host/db",
    );
    expect(
      redactExportDiagnostic("postgresql://user:p@ss@host/db, status=failed"),
    ).toBe("postgresql://[redacted]@host/db, status=failed");
    expect(redactExportDiagnostic("postgresql://host/db")).toBe(
      "postgresql://host/db",
    );
  });

  it("redacts credentials with alternate assignment delimiters or malformed values", () => {
    expect(redactExportDiagnostic('{"password"=>"FAKE_SECRET"}')).toBe(
      '{"password"=>"[redacted]"}',
    );
    expect(redactExportDiagnostic("password=<FAKE_SECRET>")).toBe(
      "password=[redacted]",
    );
  });

  it("classifies singular credential aliases but keeps ordinary fields", () => {
    expect(redactExportDiagnostic("db_credential=FAKE_CREDENTIAL")).toBe(
      "db_credential=[redacted]",
    );
    expect(redactExportDiagnostic("X-Amz-Credential=FAKE/abc")).toBe(
      "X-Amz-Credential=[redacted]",
    );
    expect(redactExportDiagnostic("keyboard=music document_key=home")).toBe(
      "keyboard=music document_key=home",
    );
  });
});

describe("redactExportDiagnostic compound-key and complexity regressions", () => {
  it("redacts lowercase compound credential suffixes but not longer field names", () => {
    const input = [
      "dbpassword=FAKE_PASSWORD",
      "githubtoken=FAKE_TOKEN",
      "accesstoken=FAKE_TOKEN",
      "clientsecret=FAKE_SECRET",
      "mypassword=FAKE_PASSWORD",
      "passwordCount=3",
    ].join("\n");

    expect(redactExportDiagnostic(input)).toBe(
      [
        "dbpassword=[redacted]",
        "githubtoken=[redacted]",
        "accesstoken=[redacted]",
        "clientsecret=[redacted]",
        "mypassword=[redacted]",
        "passwordCount=3",
      ].join("\n"),
    );
  });

  it("scans separator-heavy nonassignments within a bounded time", () => {
    const input = `${Array.from({ length: 28 }, () => "a").join("_")}!`;
    const moduleUrl = new URL("./redact-diagnostic.ts", import.meta.url).href;
    const childSource = `
      const { redactExportDiagnostic } = await import(${JSON.stringify(moduleUrl)});
      const input = ${JSON.stringify(input)};
      if (redactExportDiagnostic(input) !== input) process.exitCode = 1;
    `;
    const child = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", childSource],
      { encoding: "utf8", timeout: 3_000 },
    );

    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
  });
});
