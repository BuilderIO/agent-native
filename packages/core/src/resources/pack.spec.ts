import { describe, expect, it } from "vitest";

import {
  buildResourcePack,
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
});

describe("redactResourceContent", () => {
  it("redacts standalone API-key shaped strings and labeled credentials", () => {
    const result = redactResourceContent(
      "AGENTS.md",
      [
        "key sk-ant-TESTKEYVALUE123456",
        'token: "nonsensitive-looking-secret-value"',
        "Authorization: Bearer abc.def-ghi",
      ].join("\n"),
    );
    expect(result.redacted).toBe(true);
    expect(result.content).toContain("[REDACTED]");
    expect(result.content).not.toContain("sk-ant-TESTKEYVALUE123456");
    expect(result.content).not.toContain("nonsensitive-looking-secret-value");
    expect(result.content).not.toContain("abc.def-ghi");
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
});
