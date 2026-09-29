import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  buildResourcePack,
  canonicalJson,
  checksumResourcePackResources,
  redactResourceContent,
  sha256Hex,
  verifyResourcePack,
} from "./pack.js";

describe("buildResourcePack / verifyResourcePack", () => {
  it("round-trips a pack and is order-independent for checksums", () => {
    const first = buildResourcePack(
      [
        { path: "memory/MEMORY.md", scope: "personal", content: "# Memory\n" },
        { path: "AGENTS.md", scope: "organization", content: "# Team\n" },
      ],
      { exportedAt: 1_700_000_000_000, source: { scope: "personal" } },
    );
    const second = buildResourcePack(
      [
        { path: "AGENTS.md", scope: "organization", content: "# Team\n" },
        { path: "memory/MEMORY.md", scope: "personal", content: "# Memory\n" },
      ],
      { exportedAt: 9_999, source: { appId: "other", scope: "workspace" } },
    );

    expect(first.checksum).toBe(second.checksum);
    expect(first.resources.map((resource) => resource.path)).toEqual([
      "AGENTS.md",
      "memory/MEMORY.md",
    ]);
    expect(first.resources[0]?.sha256).toBe(sha256Hex("# Team\n"));
    expect(verifyResourcePack(first)).toEqual({ ok: true, pack: first });
    expect(verifyResourcePack({ ...second, checksum: first.checksum })).toEqual(
      {
        ok: true,
        pack: { ...second, checksum: first.checksum },
      },
    );
  });

  it("pins the canonical checksum for a known resource set", () => {
    const pack = buildResourcePack(
      [{ path: "LEARNINGS.md", scope: "personal", content: "keep\n" }],
      { exportedAt: 1, source: { scope: "personal" } },
    );
    const resources = [
      {
        content: "keep\n",
        path: "LEARNINGS.md",
        scope: "personal" as const,
        sha256: sha256Hex("keep\n"),
      },
    ];
    expect(pack.checksum).toBe(checksumResourcePackResources(resources));
    expect(pack.checksum).toBe(
      sha256Hex(
        JSON.stringify([
          {
            content: "keep\n",
            path: "LEARNINGS.md",
            scope: "personal",
            sha256: sha256Hex("keep\n"),
          },
        ]),
      ),
    );
  });

  it("sorts canonical keys and paths by Unicode code unit order", () => {
    expect(canonicalJson({ é: 1, z: 2, a: 3 })).toBe('{"a":3,"z":2,"é":1}');
    const pack = buildResourcePack(
      [
        { path: "é.md", scope: "personal", content: "accented" },
        { path: "z.md", scope: "personal", content: "z" },
        { path: "a.md", scope: "personal", content: "a" },
      ],
      { exportedAt: 1, source: { scope: "personal" } },
    );

    expect(pack.resources.map((resource) => resource.path)).toEqual([
      "a.md",
      "z.md",
      "é.md",
    ]);
    expect(checksumResourcePackResources([...pack.resources].reverse())).toBe(
      pack.checksum,
    );
  });

  it("fails closed on checksum mismatch, invalid shape, and unsupported version", () => {
    const pack = buildResourcePack(
      [{ path: "AGENTS.md", scope: "personal", content: "hello" }],
      { exportedAt: 1, source: { scope: "personal" } },
    );
    expect(verifyResourcePack({ ...pack, checksum: "a".repeat(64) })).toEqual({
      ok: false,
      error: "checksum_mismatch",
    });
    expect(
      verifyResourcePack({
        ...pack,
        resources: [
          {
            ...pack.resources[0]!,
            content: "tampered",
            sha256: pack.resources[0]!.sha256,
          },
        ],
      }),
    ).toEqual({ ok: false, error: "checksum_mismatch" });
    expect(verifyResourcePack({ ...pack, version: 2 })).toEqual({
      ok: false,
      error: "unsupported_version",
    });
    expect(verifyResourcePack(null)).toEqual({ ok: false, error: "invalid" });
    expect(verifyResourcePack({ version: 1 })).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("rejects duplicate paths even when their source scopes differ", () => {
    const pack = buildResourcePack(
      [
        { path: "AGENTS.md", scope: "personal", content: "personal" },
        { path: "AGENTS.md", scope: "organization", content: "organization" },
      ],
      { exportedAt: 1, source: { scope: "personal" } },
    );

    expect(verifyResourcePack(pack)).toEqual({ ok: false, error: "invalid" });
  });
});

describe("redactResourceContent", () => {
  it("redacts standalone API-key shaped strings and labeled credentials", () => {
    const slackBot = `xoxb-${"b".repeat(20)}`;
    const slackUser = `xoxp-${"p".repeat(20)}`;
    const slackRefresh = `xoxe-${"e".repeat(20)}`;
    const slackApp = `xapp-${"a".repeat(20)}`;
    const githubFineGrained = `github_pat_${"g".repeat(30)}`;
    const npm = `npm_${"n".repeat(36)}`;
    const hubspot = `pat-na1-${"h".repeat(24)}`;
    const result = redactResourceContent(
      "AGENTS.md",
      [
        "key sk-ant-TESTKEYVALUE123456",
        'token: "nonsensitive-looking-secret-value"',
        "Authorization: Bearer abc.def-ghi",
        slackBot,
        slackUser,
        slackRefresh,
        slackApp,
        githubFineGrained,
        npm,
        hubspot,
        "xoxb-short github_pat_short npm_short keep-this-visible",
      ].join("\n"),
    );
    expect(result.redacted).toBe(true);
    expect(result.content).toContain("[REDACTED]");
    expect(result.content).not.toContain("sk-ant-TESTKEYVALUE123456");
    expect(result.content).not.toContain("nonsensitive-looking-secret-value");
    expect(result.content).not.toContain("abc.def-ghi");
    for (const token of [
      slackBot,
      slackUser,
      slackRefresh,
      slackApp,
      githubFineGrained,
      npm,
      hubspot,
    ]) {
      expect(result.content).not.toContain(token);
    }
    expect(result.content).toContain("xoxb-short");
    expect(result.content).toContain("github_pat_short");
    expect(result.content).toContain("npm_short");
    expect(result.content).toContain("keep-this-visible");
  });

  it("drops MCP env and headers fields while keeping name and url", () => {
    const result = redactResourceContent(
      "mcp-servers/linear.json",
      JSON.stringify({
        name: "Linear",
        url: "https://mcp.linear.app/mcp",
        env: { LINEAR_API_KEY: "lin_api_placeholder" },
        headers: { Authorization: "Bearer lin_api_placeholder" },
      }),
    );
    expect(result.redacted).toBe(true);
    const parsed = JSON.parse(result.content) as {
      name: string;
      url: string;
      env?: unknown;
      headers?: unknown;
    };
    expect(parsed).toEqual({
      name: "Linear",
      url: "https://mcp.linear.app/mcp",
    });
    expect(parsed.env).toBeUndefined();
    expect(parsed.headers).toBeUndefined();
  });

  it("leaves ordinary markdown unchanged", () => {
    const result = redactResourceContent(
      "memory/MEMORY.md",
      "# Memory\n\nPrefer short answers.\n",
    );
    expect(result).toEqual({
      content: "# Memory\n\nPrefer short answers.\n",
      redacted: false,
    });
  });

  it("redacts spaced secrets through the closing quote and the whole unquoted value", () => {
    const doubleQuoted = "super secret value";
    const singleQuoted = "single quoted secret phrase";
    const unquoted = "unquoted secret phrase";
    const escaped = "inside escaped quote";
    const source = [
      `token: "${doubleQuoted}"`,
      `password: '${singleQuoted}'`,
      `api_key: ${unquoted}`,
      `api-key=${unquoted}`,
      `secret: "say \\"${escaped}\\" please"`,
      `refresh_token: 'it\\'s ${singleQuoted}'`,
      "keep-this-visible",
    ].join("\n");

    const result = redactResourceContent("AGENTS.md", source);
    const pack = buildResourcePack(
      [{ path: "AGENTS.md", scope: "personal", content: result.content }],
      { exportedAt: 1, source: { scope: "personal" } },
    );
    const serialized = JSON.stringify(pack);

    expect(result.redacted).toBe(true);
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("keep-this-visible");
    for (const secret of [doubleQuoted, singleQuoted, unquoted, escaped]) {
      expect(result.content).not.toContain(secret);
      expect(serialized).not.toContain(secret);
    }
  });

  it("keeps redacted JSON parseable by preserving the quoting", () => {
    const secret = "json secret value";
    const source = JSON.stringify({ token: secret, keep: "visible" });

    const result = redactResourceContent("config.json", source);

    expect(result.redacted).toBe(true);
    expect(result.content).not.toContain(secret);
    // Stripping the quotes along with the value would leave `"token": [REDACTED]`,
    // which no longer parses.
    const reparsed = JSON.parse(result.content) as Record<string, string>;
    expect(reparsed.token).toBe("[REDACTED]");
    expect(reparsed.keep).toBe("visible");
  });

  it("preserves single quotes when redacting a single-quoted value", () => {
    const secret = "single quoted secret phrase";

    const result = redactResourceContent("AGENTS.md", `password: '${secret}'`);

    expect(result.content).toBe("password: '[REDACTED]'");
  });

  it("redacts underscore-separated environment credential names", () => {
    const sendgrid = "SG.secret-value-should-not-export";
    const clientSecret = "super-secret-client-value";
    const github = "github-plain-token-value";
    const aws = "aws-secret-access-value";
    const source = [
      `SENDGRID_API_KEY=${sendgrid}`,
      `CLIENT_SECRET="${clientSecret}"`,
      `GITHUB_TOKEN=${github}`,
      `AWS_SECRET_ACCESS_KEY=${aws}`,
      "MAX_RETRIES=3",
      "keep-this-visible",
    ].join("\n");

    const result = redactResourceContent("AGENTS.md", source);
    const pack = buildResourcePack(
      [{ path: "AGENTS.md", scope: "personal", content: result.content }],
      { exportedAt: 1, source: { scope: "personal" } },
    );
    const serialized = JSON.stringify(pack);

    expect(result.redacted).toBe(true);
    expect(result.content).toContain('CLIENT_SECRET="[REDACTED]"');
    expect(result.content).toContain("SENDGRID_API_KEY=[REDACTED]");
    expect(result.content).toContain("GITHUB_TOKEN=[REDACTED]");
    expect(result.content).toContain("AWS_SECRET_ACCESS_KEY=[REDACTED]");
    expect(result.content).toContain("MAX_RETRIES=3");
    expect(serialized).toContain("keep-this-visible");
    for (const secret of [sendgrid, clientSecret, github, aws]) {
      expect(result.content).not.toContain(secret);
      expect(serialized).not.toContain(secret);
    }
  });

  it("keeps redacted underscore-separated JSON credentials parseable", () => {
    const sendgrid = "SG.secret-value-should-not-export";
    const source = JSON.stringify({
      SENDGRID_API_KEY: sendgrid,
      keep: "visible",
    });

    const result = redactResourceContent("config.json", source);

    expect(result.redacted).toBe(true);
    expect(result.content).not.toContain(sendgrid);
    const reparsed = JSON.parse(result.content) as Record<string, string>;
    expect(reparsed.SENDGRID_API_KEY).toBe("[REDACTED]");
    expect(reparsed.keep).toBe("visible");
  });

  it("redacts camel-case credential keys without matching ordinary words", () => {
    const clientSecret = "fake-client-secret-value";
    const oauthSecret = "fake-oauth-secret-value";
    const result = redactResourceContent(
      "config.json",
      JSON.stringify({
        clientSecret,
        oauthClientSecret: oauthSecret,
        secretary: "visible",
      }),
    );

    expect(result.redacted).toBe(true);
    const reparsed = JSON.parse(result.content) as Record<string, string>;
    expect(reparsed.clientSecret).toBe("[REDACTED]");
    expect(reparsed.oauthClientSecret).toBe("[REDACTED]");
    expect(reparsed.secretary).toBe("visible");
    expect(result.content).not.toContain(clientSecret);
    expect(result.content).not.toContain(oauthSecret);
  });

  it("redacts an unlabeled SendGrid API token", () => {
    const token = `SG.${"a".repeat(22)}.${"b".repeat(43)}`;

    const result = redactResourceContent("notes.md", `copied key: ${token}`);

    expect(result.redacted).toBe(true);
    expect(result.content).not.toContain(token);
    expect(result.content).toContain("copied key: [REDACTED]");
  });

  it("redacts JWT-labeled values from the serialized pack", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.fake-signature-material";
    const result = redactResourceContent("settings.yaml", `jwt: ${jwt}\n`);
    const pack = buildResourcePack(
      [{ path: "settings.yaml", scope: "personal", content: result.content }],
      { exportedAt: 1, source: { scope: "personal" } },
    );

    expect(result.redacted).toBe(true);
    expect(result.content).toBe("jwt: [REDACTED]\n");
    expect(JSON.stringify(pack)).not.toContain(jwt);
  });

  it("redacts YAML literal and folded block scalar contents without breaking YAML", () => {
    const token = "literal-block-secret-line";
    const jwt = "folded-block-jwt-part.one.two";
    const source = [
      "credentials:",
      "  token: |2-",
      `    ${token}`,
      "  jwt: >+",
      `    ${jwt}`,
      "  keep: visible",
    ].join("\n");

    const result = redactResourceContent("settings.yaml", source);
    const pack = buildResourcePack(
      [{ path: "settings.yaml", scope: "personal", content: result.content }],
      { exportedAt: 1, source: { scope: "personal" } },
    );

    expect(result.redacted).toBe(true);
    expect(parse(result.content)).toEqual({
      credentials: {
        token: "[REDACTED]",
        jwt: "[REDACTED]\n",
        keep: "visible",
      },
    });
    expect(JSON.stringify(pack)).not.toContain(token);
    expect(JSON.stringify(pack)).not.toContain(jwt);
  });

  it("keeps escaped quotes inside a redacted JSON value", () => {
    const source = JSON.stringify({
      password: 'before " quote',
      keep: "visible",
    });

    const result = redactResourceContent("config.json", source);

    expect(result.redacted).toBe(true);
    expect(JSON.parse(result.content)).toEqual({
      password: "[REDACTED]",
      keep: "visible",
    });
  });

  it("keeps numeric, boolean, and null JSON credentials parseable", () => {
    const source =
      '{"password":12345,"retries":8,"token":true,"secret":null,"keep":"visible"}';

    const result = redactResourceContent("config.json", source);

    expect(result.redacted).toBe(true);
    expect(result.content).not.toContain("12345");
    const reparsed = JSON.parse(result.content) as {
      password: string;
      retries: number;
      token: string;
      secret: string;
      keep: string;
    };
    expect(reparsed.password).toBe("[REDACTED]");
    expect(reparsed.retries).toBe(8);
    expect(reparsed.token).toBe("[REDACTED]");
    expect(reparsed.secret).toBe("[REDACTED]");
    expect(reparsed.keep).toBe("visible");
  });

  it("redacts an unquoted numeric env password without adding quotes", () => {
    const result = redactResourceContent("AGENTS.md", "password=12345");

    expect(result.content).toBe("password=[REDACTED]");
    expect(result.content).not.toContain("12345");
  });

  it("redacts private-key labels, PEM blocks, and credential-bearing DSNs", () => {
    const privateKey = "ssh-private-key-material-7f3a";
    const pemMaterial = "MIIE-PRIVATE-KEY-MATERIAL-7f3a";
    const dbPassword = "db-password-7f3a9c";
    const inlinePassword = "inline-db-password-7f3a9c";
    const publicKey = "public-key-material-should-remain";
    const pem = [
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      pemMaterial,
      "-----END OPENSSH PRIVATE KEY-----",
    ].join("\n");
    const databaseUrl = new URL("postgresql://db.internal:5432/app");
    databaseUrl.username = "app";
    databaseUrl.password = dbPassword;
    const inlineDatabaseUrl = new URL("postgres://db.internal/app");
    inlineDatabaseUrl.username = "app";
    inlineDatabaseUrl.password = inlinePassword;
    const source = [
      `SSH_PRIVATE_KEY=${privateKey}`,
      `PRIVATE_KEY="${privateKey}-quoted"`,
      pem,
      `DATABASE_URL=${databaseUrl.toString()}`,
      `see ${inlineDatabaseUrl.toString()}`,
      `PUBLIC_KEY=${publicKey}`,
      "-----BEGIN PUBLIC KEY-----",
      publicKey,
      "-----END PUBLIC KEY-----",
      "keep-this-visible",
    ].join("\n");

    const result = redactResourceContent("AGENTS.md", source);
    const pack = buildResourcePack(
      [{ path: "AGENTS.md", scope: "personal", content: result.content }],
      { exportedAt: 1, source: { scope: "personal" } },
    );
    const serialized = JSON.stringify(pack);

    expect(result.redacted).toBe(true);
    expect(result.content).toContain("SSH_PRIVATE_KEY=[REDACTED]");
    expect(result.content).toContain('PRIVATE_KEY="[REDACTED]"');
    expect(result.content).toContain("DATABASE_URL=[REDACTED]");
    expect(result.content).toContain("postgres://[REDACTED]@db.internal/app");
    expect(result.content).toContain(`PUBLIC_KEY=${publicKey}`);
    expect(result.content).toContain("-----BEGIN PUBLIC KEY-----");
    expect(serialized).toContain("keep-this-visible");
    for (const secret of [
      privateKey,
      `${privateKey}-quoted`,
      pemMaterial,
      dbPassword,
      inlinePassword,
    ]) {
      expect(result.content).not.toContain(secret);
      expect(serialized).not.toContain(secret);
    }
  });
});
