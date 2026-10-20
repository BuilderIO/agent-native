import { describe, expect, it } from "vitest";

import { sanitizePromptProvenanceCandidates } from "./journey-capture-provenance";

describe("sanitizePromptProvenanceCandidates", () => {
  it("preserves user message order and returns text only", () => {
    expect(
      sanitizePromptProvenanceCandidates([
        { role: "user", text: "First prompt", eventId: "event-one" },
        { role: "user", text: "Second prompt", nodeId: 42 },
      ]),
    ).toEqual({
      messages: [
        { role: "user", text: "First prompt" },
        { role: "user", text: "Second prompt" },
      ],
      truncation: {
        messages: false,
        messageCharacters: false,
        totalCharacters: false,
      },
    });
  });

  it("rejects malformed or non-user candidates instead of coercing them", () => {
    expect(() => sanitizePromptProvenanceCandidates({})).toThrow(
      "Prompt provenance candidates must be an array",
    );
    expect(() =>
      sanitizePromptProvenanceCandidates([
        { role: "assistant", text: "Not a user prompt" },
      ]),
    ).toThrow("Invalid prompt provenance candidate at index 0");
    expect(() =>
      sanitizePromptProvenanceCandidates([{ role: "user", text: 7 }]),
    ).toThrow("Invalid prompt provenance candidate at index 0");
  });

  it("redacts credential assignments and bearer values", () => {
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: "api_key=example-value\nAuthorization: Bearer sample-value\nBearer sample-token",
      },
    ]);

    expect(result.messages).toEqual([
      {
        role: "user",
        text: "api_key=[REDACTED]\nAuthorization: [REDACTED]\nBearer [REDACTED]",
      },
    ]);
    expect(result.messages[0]?.text).not.toContain("example-value");
    expect(result.messages[0]?.text).not.toContain("sample-value");
    expect(result.messages[0]?.text).not.toContain("sample-token");
  });

  it("redacts JSON-quoted credential property names", () => {
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: '{"api_key":"example-value","access_token":"another-value"}',
      },
    ]);

    expect(result.messages[0]?.text).toContain("[REDACTED]");
    expect(result.messages[0]?.text).not.toContain("example-value");
    expect(result.messages[0]?.text).not.toContain("another-value");
    expect(JSON.parse(result.messages[0]!.text)).toEqual({
      api_key: "[REDACTED]",
      access_token: "[REDACTED]",
    });
  });

  it("redacts complete multiword credential values and compound key assignments", () => {
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: "password: correct horse battery staple\nKeep this next line",
      },
      {
        role: "user",
        text: 'secret_key=secret-value\nprivateKey: another-secret\ngoogle_client_secret="quoted-secret"',
      },
      {
        role: "user",
        text: "api_key_hash=api-hash-value\nprivate_key_hash=private-hash-value\nprivateKeyValue=private-value\nsigningKeyId=signing-value",
      },
      {
        role: "user",
        text: "We need a secret token later, but this is ordinary prose.",
      },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "password: [REDACTED]\nKeep this next line",
      'secret_key=[REDACTED]\nprivateKey: [REDACTED]\ngoogle_client_secret="[REDACTED]"',
      "api_key_hash=[REDACTED]\nprivate_key_hash=[REDACTED]\nprivateKeyValue=[REDACTED]\nsigningKeyId=[REDACTED]",
      "We need a secret token later, but this is ordinary prose.",
    ]);
    expect(JSON.stringify(result)).not.toContain(
      "correct horse battery staple",
    );
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(JSON.stringify(result)).not.toContain("another-secret");
    expect(JSON.stringify(result)).not.toContain("quoted-secret");
    expect(JSON.stringify(result)).not.toContain("api-hash-value");
    expect(JSON.stringify(result)).not.toContain("private-hash-value");
    expect(JSON.stringify(result)).not.toContain("private-value");
    expect(JSON.stringify(result)).not.toContain("signing-value");
  });

  it("redacts credential assignments whose names have no word delimiters", () => {
    const result = sanitizePromptProvenanceCandidates([
      { role: "user", text: "dbpassword=fake-db-password-value" },
      { role: "user", text: "githubtoken: fake-github-token-value" },
      { role: "user", text: "clientsecret=fake-client-secret-value" },
      {
        role: "user",
        text: "awssecretaccesskey=fake-aws-secret-access-key-value",
      },
      { role: "user", text: "passwordless_mode=true" },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "dbpassword=[REDACTED]",
      "githubtoken: [REDACTED]",
      "clientsecret=[REDACTED]",
      "awssecretaccesskey=[REDACTED]",
      "passwordless_mode=true",
    ]);
    for (const value of [
      "fake-db-password-value",
      "fake-github-token-value",
      "fake-client-secret-value",
      "fake-aws-secret-access-key-value",
    ]) {
      expect(JSON.stringify(result)).not.toContain(value);
    }
  });

  it("redacts dash-prefixed JSON keys and credential values in argv arrays", () => {
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: '{"--password":"fake-json-flag-value","next":"visible"}',
      },
      { role: "user", text: '["--api-key", "fake-array-key-value"]' },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      '{"--password":"[REDACTED]","next":"visible"}',
      "[REDACTED]",
    ]);
    expect(JSON.stringify(result)).not.toContain("fake-json-flag-value");
    expect(JSON.stringify(result)).not.toContain("fake-array-key-value");
  });

  it("redacts bare JWTs, Slack webhooks, and JWT or OTP assignments", () => {
    const jwtPlaceholder = [
      "eyJ",
      "fakeheader",
      ".",
      "eyJfakepayload",
      ".",
      "fakesignature",
    ].join("");
    const webhookUrl =
      "https://hooks.slack.com/services/TFAKEWORKSPACE/BFAKECHANNEL/fake-webhook-token-123456";
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: `jwt=${jwtPlaceholder}\notp=fake-one-time-code\n${webhookUrl}`,
      },
      { role: "user", text: jwtPlaceholder },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "jwt=[REDACTED]\notp=[REDACTED]\n[REDACTED]",
      "[REDACTED]",
    ]);
    for (const value of [jwtPlaceholder, webhookUrl, "fake-one-time-code"]) {
      expect(JSON.stringify(result)).not.toContain(value);
    }
  });

  it("redacts Discord subdomain webhooks and OAuth callback values", () => {
    const discordWebhookUrl =
      "https://canary.discord.com/api/webhooks/fake-webhook-id/fake.discord.webhook.token-123456";
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: [
          discordWebhookUrl,
          "https://app.example/callback?code=fake-oauth-code&state=fake-oauth-state",
          "https://app.example/?code=fake-root-oauth-code&state=fake-root-oauth-state",
          "https://app.example/callback#code=fake-fragment-oauth-code&state=fake-fragment-oauth-state",
          "https://docs.example/reference?code=example-code&state=example-state",
          "https://docs.example/#section\npassword=fake-first-part fake-second-part fake-third-part",
          "Use code to explain the state machine.",
        ].join("\n"),
      },
    ]);
    const text = result.messages[0]?.text ?? "";

    expect(text).toBe(
      [
        "[REDACTED]",
        "https://app.example/callback?code=[REDACTED]&state=[REDACTED]",
        "https://app.example/?code=[REDACTED]&state=[REDACTED]",
        "https://app.example/callback#code=[REDACTED]&state=[REDACTED]",
        "https://docs.example/reference?code=example-code&state=example-state",
        "https://docs.example/#section\npassword=[REDACTED]",
        "Use code to explain the state machine.",
      ].join("\n"),
    );
    for (const value of [
      discordWebhookUrl,
      "fake-oauth-code",
      "fake-oauth-state",
      "fake-root-oauth-code",
      "fake-root-oauth-state",
      "fake-fragment-oauth-code",
      "fake-fragment-oauth-state",
      "fake-first-part",
      "fake-second-part",
      "fake-third-part",
    ]) {
      expect(text).not.toContain(value);
    }
  });

  it("redacts plain credential lines and past-tense credential phrasings", () => {
    const result = sanitizePromptProvenanceCandidates([
      { role: "user", text: "password fake-standalone-password-value" },
      { role: "user", text: "token placeholder" },
      {
        role: "user",
        text: "password fake-first-part fake-second-part fake-third-part",
      },
      {
        role: "user",
        text: "token value is fake-leak-aaa111",
      },
      {
        role: "user",
        text: "my API key uses fake-leak-bbb222 for billing",
      },
      {
        role: "user",
        text: "password should be fake-leak-ccc333",
      },
      {
        role: "user",
        text: "the API key was fake-past-tense-api-key-value",
      },
      {
        role: "user",
        text: "I changed my password yesterday; no value is included.",
      },
      { role: "user", text: "Pass rate is 40 percent this week." },
      { role: "user", text: "The secret can be used later." },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "password [REDACTED]",
      "token [REDACTED]",
      "password [REDACTED]",
      "token value is [REDACTED]",
      "my API key uses [REDACTED] for billing",
      "password should be [REDACTED]",
      "the API key was [REDACTED]",
      "I changed my password yesterday; no value is included.",
      "Pass rate is 40 percent this week.",
      "The secret can be used later.",
    ]);
    expect(JSON.stringify(result)).not.toContain(
      "fake-standalone-password-value",
    );
    expect(JSON.stringify(result)).not.toContain("placeholder");
    expect(JSON.stringify(result)).not.toContain("fake-first-part");
    expect(JSON.stringify(result)).not.toContain("fake-second-part");
    expect(JSON.stringify(result)).not.toContain("fake-third-part");
    expect(JSON.stringify(result)).not.toContain("fake-leak-aaa111");
    expect(JSON.stringify(result)).not.toContain("fake-leak-bbb222");
    expect(JSON.stringify(result)).not.toContain("fake-leak-ccc333");
    expect(JSON.stringify(result)).not.toContain(
      "fake-past-tense-api-key-value",
    );
  });

  it("preserves credential-like words in grammatical descriptions", () => {
    const result = sanitizePromptProvenanceCandidates([
      { role: "user", text: "Token refresh logic is broken on the server." },
      {
        role: "user",
        text: "The token for this API should be rotated before expiry.",
      },
      { role: "user", text: "Pass the test suite before merging." },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "Token refresh logic is broken on the server.",
      "The token for this API should be rotated before expiry.",
      "Pass the test suite before merging.",
    ]);
  });

  it("still redacts token-like values after prose-like credential phrases", () => {
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: "Token refresh logic is fake-leak-ddd444",
      },
      {
        role: "user",
        text: "The token for this API should be fake-leak-eee555",
      },
      {
        role: "user",
        text: "The secret can be used fake-leak-fff666",
      },
      {
        role: "user",
        text: "Pass the test suite fake-leak-ggg777",
      },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "Token [REDACTED]",
      "The token [REDACTED]",
      "The secret [REDACTED]",
      "Pass [REDACTED]",
    ]);
    for (const value of [
      "fake-leak-ddd444",
      "fake-leak-eee555",
      "fake-leak-fff666",
      "fake-leak-ggg777",
    ]) {
      expect(JSON.stringify(result)).not.toContain(value);
    }
  });

  it("redacts session ID and token key variants", () => {
    const result = sanitizePromptProvenanceCandidates([
      { role: "user", text: "SESSION_ID=fake-session-id-value" },
      { role: "user", text: "sessionId=fake-camel-session-id-value" },
      { role: "user", text: "sessionid=fake-compact-session-id-value" },
      { role: "user", text: "session_token=fake-session-token-value" },
      { role: "user", text: "sessionToken=fake-camel-session-token-value" },
      { role: "user", text: "sessiontoken=fake-compact-session-token-value" },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "SESSION_ID=[REDACTED]",
      "sessionId=[REDACTED]",
      "sessionid=[REDACTED]",
      "session_token=[REDACTED]",
      "sessionToken=[REDACTED]",
      "sessiontoken=[REDACTED]",
    ]);
    expect(JSON.stringify(result)).not.toContain("fake-session-id-value");
    expect(JSON.stringify(result)).not.toContain("fake-camel-session-id-value");
    expect(JSON.stringify(result)).not.toContain(
      "fake-compact-session-id-value",
    );
    expect(JSON.stringify(result)).not.toContain("fake-session-token-value");
    expect(JSON.stringify(result)).not.toContain(
      "fake-camel-session-token-value",
    );
    expect(JSON.stringify(result)).not.toContain(
      "fake-compact-session-token-value",
    );
  });

  it("redacts password aliases and signed URL query values while retaining useful URL context", () => {
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: [
          "DB_PASS=fake-db-pass-value",
          "pw=fake-short-credential-value",
          "pin=fake-pin-value",
          "pwd=fake-short-password-value",
          "passwords=fake-password-list-value",
          "tokens=fake-token-list-value",
          "https://cdn.example.test/media/image.png?sig=fake-sas-signature&sp=read&sv=fake-version",
          "https://cdn.example.test/media/video.mp4?X-Amz-Signature=fake-s3-signature&X-Amz-Date=fake-date",
        ].join("\n"),
      },
    ]);
    const text = result.messages[0]?.text ?? "";

    expect(text).toBe(
      [
        "DB_PASS=[REDACTED]",
        "pw=[REDACTED]",
        "pin=[REDACTED]",
        "pwd=[REDACTED]",
        "passwords=[REDACTED]",
        "tokens=[REDACTED]",
        "https://cdn.example.test/media/image.png?sig=[REDACTED]&sp=read&sv=fake-version",
        "https://cdn.example.test/media/video.mp4?X-Amz-Signature=[REDACTED]&X-Amz-Date=fake-date",
      ].join("\n"),
    );
    for (const value of [
      "fake-db-pass-value",
      "fake-short-credential-value",
      "fake-pin-value",
      "fake-short-password-value",
      "fake-password-list-value",
      "fake-token-list-value",
      "fake-sas-signature",
      "fake-s3-signature",
    ]) {
      expect(text).not.toContain(value);
    }
  });

  it("strips URL authority userinfo for database and HTTP schemes", () => {
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: "Connect to postgresql://alice:fake-db-password@db.example.test/analytics or https://service-user:fake-http-password@api.example.test/health.",
      },
    ]);
    const text = result.messages[0]?.text ?? "";

    expect(text).toBe(
      "Connect to postgresql://[REDACTED]@db.example.test/analytics or https://[REDACTED]@api.example.test/health.",
    );
    expect(text).not.toContain("alice");
    expect(text).not.toContain("fake-db-password");
    expect(text).not.toContain("service-user");
    expect(text).not.toContain("fake-http-password");
  });

  it("redacts space-separated credentials and preserves ordinary prose", () => {
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: "Run the tool with --password fake flag value --region test",
      },
      {
        role: "user",
        text: "My password is fake natural phrase value\nfollow-up text",
      },
      {
        role: "user",
        text: "export GITHUB_TOKEN fake exported token value",
      },
      {
        role: "user",
        text: "I changed my password yesterday; no value is included.",
      },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "[REDACTED]",
      "My password is [REDACTED]\nfollow-up text",
      "[REDACTED]",
      "I changed my password yesterday; no value is included.",
    ]);
    for (const value of [
      "fake flag value",
      "fake natural phrase value",
      "fake exported token value",
    ]) {
      expect(JSON.stringify(result)).not.toContain(value);
    }
  });

  it("redacts multiword credential assignment keys", () => {
    const result = sanitizePromptProvenanceCandidates([
      { role: "user", text: "API Key: fake-api-key-placeholder" },
      { role: "user", text: "Client Secret = fake-client-secret-placeholder" },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "API Key: [REDACTED]",
      "Client Secret = [REDACTED]",
    ]);
    expect(JSON.stringify(result)).not.toContain("fake-api-key-placeholder");
    expect(JSON.stringify(result)).not.toContain(
      "fake-client-secret-placeholder",
    );
  });

  it("redacts credential assignment keys wrapped in inline markup", () => {
    const result = sanitizePromptProvenanceCandidates([
      { role: "user", text: "`password`: fake-markup-password-value" },
      { role: "user", text: "**api_key**=fake-markup-api-key-value" },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "`password`: [REDACTED]",
      "**api_key**=[REDACTED]",
    ]);
    expect(JSON.stringify(result)).not.toContain("fake-markup-password-value");
    expect(JSON.stringify(result)).not.toContain("fake-markup-api-key-value");
  });

  it("redacts credential assignments after ordinary same-line labels", () => {
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: "Use this: api_key=fake-labeled-api-key-value",
      },
      {
        role: "user",
        text: 'Setup detail: password="fake-labeled-password-value" and keep this label',
      },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "Use this: api_key=[REDACTED]",
      'Setup detail: password="[REDACTED]" and keep this label',
    ]);
    expect(JSON.stringify(result)).not.toContain("fake-labeled-api-key-value");
    expect(JSON.stringify(result)).not.toContain("fake-labeled-password-value");
  });

  it("redacts provider-shaped API tokens without a key label", () => {
    const githubTokenPlaceholder = [
      "ghp",
      "FAKE_EXAMPLE_TOKEN_VALUE_1234567890",
    ].join("_");
    const awsKeyPlaceholder = ["AKIA", "FAKEEXAMPLE00000"].join("");
    const openAiTokenPlaceholder = [
      "sk",
      "proj",
      "fake_example_token_value_1234567890",
    ].join("-");
    const result = sanitizePromptProvenanceCandidates([
      { role: "user", text: githubTokenPlaceholder },
      { role: "user", text: awsKeyPlaceholder },
      { role: "user", text: openAiTokenPlaceholder },
      { role: "user", text: "The docs mention a github token prefix." },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "[REDACTED]",
      "[REDACTED]",
      "[REDACTED]",
      "The docs mention a github token prefix.",
    ]);
    for (const value of [
      githubTokenPlaceholder,
      awsKeyPlaceholder,
      openAiTokenPlaceholder,
    ]) {
      expect(JSON.stringify(result)).not.toContain(value);
    }
  });

  it("redacts complete authorization values, including unknown schemes", () => {
    const result = sanitizePromptProvenanceCandidates([
      { role: "user", text: "Authorization: Basic fake-basic-value" },
      {
        role: "user",
        text: 'Authorization: Digest username="fake;user", realm="fake-realm", nonce="fake-nonce"',
      },
      { role: "user", text: "Authorization: Token fake-token-value" },
      { role: "user", text: "Authorization: ApiKey fake-api-key-value" },
      {
        role: "user",
        text: "Authorization: AWS4-HMAC-SHA256 Credential=fake-credential, SignedHeaders=host, Signature=fake-signature",
      },
      {
        role: "user",
        text: '{"authorization":"Bearer fake-json-token","next":"visible"}',
      },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "Authorization: [REDACTED]",
      "Authorization: [REDACTED]",
      "Authorization: [REDACTED]",
      "Authorization: [REDACTED]",
      "Authorization: [REDACTED]",
      '{"authorization":"[REDACTED]","next":"visible"}',
    ]);
    for (const value of [
      "fake-basic-value",
      "fake;user",
      "fake-realm",
      "fake-nonce",
      "fake-token-value",
      "fake-api-key-value",
      "fake-credential",
      "fake-signature",
      "fake-json-token",
    ]) {
      expect(JSON.stringify(result)).not.toContain(value);
    }
    expect(JSON.parse(result.messages[5]!.text)).toEqual({
      authorization: "[REDACTED]",
      next: "visible",
    });
  });

  it("redacts full cookie headers and preserves JSON structure", () => {
    const result = sanitizePromptProvenanceCandidates([
      { role: "user", text: "Cookie: session=one; theme=dark; user=alice" },
      { role: "user", text: "Set-Cookie: session=two; HttpOnly; SameSite=Lax" },
      {
        role: "user",
        text: '{"cookie":"session=three; theme=light","next":"visible"}',
      },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "Cookie: [REDACTED]",
      "Set-Cookie: [REDACTED]",
      '{"cookie":"[REDACTED]","next":"visible"}',
    ]);
    for (const value of [
      "session=one",
      "theme=dark",
      "session=two",
      "HttpOnly",
      "session=three",
    ]) {
      expect(JSON.stringify(result)).not.toContain(value);
    }
    expect(JSON.parse(result.messages[2]!.text)).toEqual({
      cookie: "[REDACTED]",
      next: "visible",
    });
  });

  it("omits SQL and base64 payloads from extracted message text", () => {
    const query = "SELECT email, api_key FROM accounts WHERE id = 7;";
    const imageData = `data:image/png;base64,${"A".repeat(160)}`;
    const result = sanitizePromptProvenanceCandidates([
      { role: "user", text: `Query: ${query} Please keep the result private.` },
      { role: "user", text: `Attached image ${imageData}` },
      { role: "user", text: `Inline payload ${"B".repeat(160)}` },
      { role: "user", text: `URL-safe payload ${"A_b-".repeat(40)}` },
      { role: "user", text: `\`\`\`sql\n${query}\n\`\`\`` },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "[OMITTED_SQL]",
      "Attached image [OMITTED_BASE64]",
      "Inline payload [OMITTED_BASE64]",
      "URL-safe payload [OMITTED_BASE64]",
      "[OMITTED_SQL]",
    ]);
    expect(JSON.stringify(result)).not.toContain("accounts");
    expect(JSON.stringify(result)).not.toContain("A".repeat(128));
    expect(JSON.stringify(result)).not.toContain("B".repeat(128));
    expect(JSON.stringify(result)).not.toContain("A_b-".repeat(30));
  });

  it("omits inline SQL with no FROM clause and its surrounding message text", () => {
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: "Please inspect this statement: SELECT 'customer@example.com'; keep the result private.",
      },
      { role: "user", text: "SELECT 1" },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "[OMITTED_SQL]",
      "[OMITTED_SQL]",
    ]);
    expect(JSON.stringify(result)).not.toContain("customer@example.com");
    expect(JSON.stringify(result)).not.toContain("SELECT");
  });

  it("keeps natural language selection prompts and omits function SELECTs", () => {
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: "Please select one, then compare retention by plan.",
      },
      { role: "user", text: "SELECT decrypt(secret_column)" },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "Please select one, then compare retention by plan.",
      "[OMITTED_SQL]",
    ]);
    expect(JSON.stringify(result)).not.toContain("secret_column");
  });

  it("omits mid-sentence SQL while preserving ordinary selection instructions", () => {
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: "Can you check this: SELECT user_id, email FROM users WHERE plan = 'pro'?",
      },
      {
        role: "user",
        text: "Can you check this: SELECT email FROM users WHERE id = 7?",
      },
      {
        role: "user",
        text: "Can you check this: SELECT email FROM users? Keep the result private.",
      },
      { role: "user", text: 'Please check: SELECT email FROM "users"?' },
      { role: "user", text: "Please check: SELECT email FROM users AS u?" },
      { role: "user", text: "SELECT id FROM users" },
      {
        role: "user",
        text: "Can you select one from the list, then compare retention by plan?",
      },
      {
        role: "user",
        text: "Select one from list, then compare retention by plan.",
      },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "[OMITTED_SQL]",
      "[OMITTED_SQL]",
      "[OMITTED_SQL]",
      "[OMITTED_SQL]",
      "[OMITTED_SQL]",
      "[OMITTED_SQL]",
      "Can you select one from the list, then compare retention by plan?",
      "Select one from list, then compare retention by plan.",
    ]);
    expect(JSON.stringify(result)).not.toContain("user_id");
    expect(JSON.stringify(result)).not.toContain("pro");
    expect(JSON.stringify(result)).not.toContain("email FROM users");
  });

  it("reports message and per-message character truncation", () => {
    const result = sanitizePromptProvenanceCandidates([
      { role: "user", text: "ordinary ".repeat(250) },
      ...Array.from({ length: 12 }, (_, index) => ({
        role: "user" as const,
        text: `prompt-${index}`,
      })),
    ]);

    expect(result.messages).toHaveLength(12);
    expect(result.messages[0]?.text).toHaveLength(2_000);
    expect(result.truncation).toEqual({
      messages: true,
      messageCharacters: true,
      totalCharacters: false,
    });
  });

  it("reports total character truncation without exceeding the aggregate cap", () => {
    const result = sanitizePromptProvenanceCandidates([
      ...Array.from({ length: 5 }, () => ({
        role: "user" as const,
        text: `${"ordinary ".repeat(222)}or`,
      })),
    ]);

    expect(result.messages).toHaveLength(4);
    expect(
      result.messages.reduce(
        (total, message) => total + message.text.length,
        0,
      ),
    ).toBe(8_000);
    expect(result.truncation).toEqual({
      messages: false,
      messageCharacters: false,
      totalCharacters: true,
    });
  });

  it("does not split a surrogate pair at a character limit", () => {
    const prefix = `${"x ".repeat(999)}x`;
    const result = sanitizePromptProvenanceCandidates([
      { role: "user", text: `${prefix}😀x` },
    ]);

    expect(result.messages[0]?.text).toBe(`${prefix}😀`);
    expect(result.truncation.messageCharacters).toBe(true);
  });
});
