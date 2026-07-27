import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  defaultHarnessTimeoutMs,
  defaultLeaseTtlMs,
  parseHostedAcceptanceCliArgs,
  runHostedAcceptance,
} from "./run-hosted-acceptance.ts";

const origin = "https://calendar.acceptance.example.test";
const tombstone = Buffer.from("AQ==", "base64");

function providers() {
  return {
    neon: {
      async createBranch() {
        return "trusted-acceptance-branch";
      },
      async getConnectionUri() {
        return "postgresql://secret@example.test/db";
      },
      async deleteAndVerify() {
        return true;
      },
      async listByPrefixAndExpiry() {
        return [];
      },
    },
    openrouter: {
      async create() {
        return { plaintext: "sk-secret", hash: "opaque-hash" };
      },
      async disableByHash() {
        return true;
      },
      async listByPrefixAndExpiry() {
        return [];
      },
    },
    netlify: {
      async assertSiteReady() {},
      async ownsLease() {
        return true;
      },
      async setRuntime() {},
      async removeRuntime() {
        return true;
      },
      async deployTombstoneAndVerify() {
        return { deployId: "tombstone" };
      },
      async readLeaseMarker() {
        return undefined;
      },
    },
  };
}

describe("trusted in-process hosted acceptance runner", () => {
  it("reserves explicit margin beyond the maximum poll and token-expiry windows", () => {
    assert.equal(defaultHarnessTimeoutMs, 12 * 60_000);
    assert(
      defaultHarnessTimeoutMs > 60 * 5_000 + 300_000,
      "default deadline must leave setup and network margin",
    );
    assert.equal(defaultLeaseTtlMs, 30 * 60_000);
    assert(
      defaultLeaseTtlMs - defaultHarnessTimeoutMs >= 15 * 60_000,
      "lease must retain a bounded cleanup reserve after harness timeout",
    );
  });

  it("accepts only the six non-secret CLI file flags", () => {
    const parsed = parseHostedAcceptanceCliArgs([
      "--plan",
      "plan.json",
      "--profile",
      "profile.json",
      "--deploy-manifest",
      "manifest.json",
      "--journal",
      "journal.json",
      "--receipt",
      "receipt.json",
      "--deploy-result",
      "deploy.json",
    ]);
    assert.equal(parsed.planFile, "plan.json");
    assert.throws(
      () => parseHostedAcceptanceCliArgs(["--plan", "plan.json"]),
      /usage/,
    );
    assert.throws(
      () =>
        parseHostedAcceptanceCliArgs([
          ...Object.entries(parsed).flatMap(([key, value]) => [
            `--${key}`,
            value,
          ]),
        ]),
      /usage/,
    );
  });

  it("rejects a tampered staged directory artifact before browser or provider use", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hosted-acceptance-digest-"));
    const artifact = join(dir, "directory-artifact");
    await mkdir(artifact);
    await writeFile(join(artifact, "acceptance-directory.ts"), "tampered");
    const profile = {
      version: 1,
      workspace: "calendar-content",
      enabled: true,
      leasePrefix: "trusted-acceptance-",
      runtime: {
        maxInferenceUsd: 0.01,
        tombstone: {
          sha256: createHash("sha256").update(tombstone).digest("hex"),
          zipBase64: tombstone.toString("base64"),
        },
        members: [
          {
            id: "calendar",
            origin,
            neonProjectId: "project",
            neonDatabaseName: "main",
            neonRoleName: "owner",
            netlifyAccountId: "account",
            netlifySiteId: "site",
            needsInference: false,
          },
        ],
      },
      members: [{ id: "calendar", origin, artifactDirectory: "calendar" }],
      directoryFixture: {
        origin: "https://directory.acceptance.example.test",
        netlifyAccountId: "directory-account",
        netlifySiteId: "directory-site",
        orgDomain: "agent-native.acceptance.invalid",
        members: [
          { id: "calendar", name: "Calendar", url: origin, a2aUrl: origin },
        ],
        withdrawnMemberId: "calendar",
        artifactDirectory: "directory",
        artifactSha256: "a".repeat(64),
      },
    };
    const profileText = JSON.stringify(profile);
    const plan = {
      version: 1,
      workspace: "calendar-content",
      profileSha256: createHash("sha256").update(profileText).digest("hex"),
      tokenExpiryMs: 300000,
      members: [
        {
          id: "calendar",
          origin,
          mcpUrl: `${origin}/mcp`,
          wrongAudienceResource: "https://foreign.example.test/mcp",
          harness: { kind: "mcp-read-only-tool", tool: "list_apps" },
        },
      ],
    };
    const files = {
      planFile: join(dir, "plan.json"),
      profileFile: join(dir, "profile.json"),
      deployManifestFile: join(dir, "manifest.json"),
      journalFile: join(dir, "journal.json"),
      receiptFile: join(dir, "receipt.json"),
      deployResultFile: join(dir, "deploy.json"),
    };
    await Promise.all([
      writeFile(files.planFile, JSON.stringify(plan)),
      writeFile(files.profileFile, profileText),
      writeFile(
        files.deployManifestFile,
        JSON.stringify({
          version: 1,
          members: [
            {
              id: "calendar",
              siteId: "site",
              artifactDirectory: "calendar",
              publishDirectory: "calendar/publish",
            },
          ],
          directoryFixture: {
            siteId: "directory-site",
            artifact,
            sha256: "a".repeat(64),
          },
        }),
      ),
    ]);
    await assert.rejects(
      runHostedAcceptance(files, {
        providers: providers(),
        fetchFn: async () => Response.json({}),
        browserFactory: {
          async create() {
            throw new Error("browser must not launch");
          },
        },
        createLoopbackCallback: async () => {
          throw new Error("callback must not launch");
        },
      }),
      /sha256 contract failed/,
    );
  });

  it("uses injected deploy, browser, OAuth, expiry, and cleanup seams without serializing secrets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hosted-acceptance-"));
    const profile = {
      version: 1,
      workspace: "calendar-content",
      enabled: true,
      leasePrefix: "trusted-acceptance-",
      runtime: {
        maxInferenceUsd: 0.01,
        tombstone: {
          sha256: createHash("sha256").update(tombstone).digest("hex"),
          zipBase64: tombstone.toString("base64"),
        },
        members: [
          {
            id: "calendar",
            origin,
            neonProjectId: "project",
            neonDatabaseName: "main",
            neonRoleName: "owner",
            netlifyAccountId: "account",
            netlifySiteId: "site",
            needsInference: false,
          },
          {
            id: "content",
            origin: "https://content.acceptance.example.test",
            neonProjectId: "content-project",
            neonDatabaseName: "main",
            neonRoleName: "owner",
            netlifyAccountId: "account",
            netlifySiteId: "content-site",
            needsInference: false,
          },
        ],
      },
      members: [
        { id: "calendar", origin, artifactDirectory: "calendar" },
        {
          id: "content",
          origin: "https://content.acceptance.example.test",
          artifactDirectory: "content",
        },
      ],
    };
    const profileText = JSON.stringify(profile);
    const plan = {
      version: 1,
      workspace: "calendar-content",
      profileSha256: createHash("sha256").update(profileText).digest("hex"),
      tokenExpiryMs: 300000,
      members: [
        {
          id: "calendar",
          origin,
          mcpUrl: `${origin}/mcp`,
          wrongAudienceResource: "https://foreign.example.test/mcp",
          harness: { kind: "mcp-read-only-tool", tool: "list_apps" },
        },
      ],
    };
    const manifest = {
      version: 1,
      members: [
        {
          id: "calendar",
          siteId: "site",
          artifactDirectory: "calendar",
          publishDirectory: "calendar/publish",
        },
        {
          id: "content",
          siteId: "content-site",
          artifactDirectory: "content",
          publishDirectory: "content/publish",
        },
      ],
    };
    const files = {
      planFile: join(dir, "plan.json"),
      profileFile: join(dir, "profile.json"),
      deployManifestFile: join(dir, "manifest.json"),
      journalFile: join(dir, "journal.json"),
      receiptFile: join(dir, "receipt.json"),
      deployResultFile: join(dir, "deploy.json"),
    };
    await Promise.all([
      writeFile(files.planFile, JSON.stringify(plan)),
      writeFile(files.profileFile, profileText),
      writeFile(files.deployManifestFile, JSON.stringify(manifest)),
    ]);
    let callbackResolve: ((url: string) => void) | undefined;
    let expired = false;
    let tokenExchanges = 0;
    let profileMarker = "";
    const deployed: string[] = [];
    const receipt = await runHostedAcceptance(files, {
      providers: providers(),
      async deploy(input) {
        deployed.push(input.siteId);
        return { deployId: "deploy" };
      },
      browserFactory: {
        async create(browserOrigin) {
          let signedInEmail = "";
          return {
            close: async () => {},
            adapter: {
              origin: browserOrigin,
              async postJson(_path, body) {
                if (!body.password.endsWith("-wrong"))
                  signedInEmail = body.email;
                return { status: body.password.endsWith("-wrong") ? 401 : 200 };
              },
              async getJson() {
                return { email: signedInEmail };
              },
              async authorize(url) {
                callbackResolve?.(
                  `http://127.0.0.1:4319/oauth/callback?code=private-code&state=${new URL(url).searchParams.get("state")}`,
                );
              },
              async authorizeExpectRejected() {
                return { status: 400 };
              },
            },
          };
        },
      },
      async createLoopbackCallback() {
        return {
          redirectUri: "http://127.0.0.1:4319/oauth/callback",
          waitForCallback: async () =>
            new Promise<string>((resolve) => {
              callbackResolve = resolve;
            }),
          close: async () => {},
        };
      },
      async sleep(ms) {
        expired = true;
        assert(ms > 0 && ms <= 301000);
      },
      async fetchFn(url, init) {
        if (url.endsWith("oauth-protected-resource"))
          return Response.json({
            authorization_servers: [origin],
            resource: `${origin}/mcp`,
          });
        if (url.endsWith("oauth-authorization-server"))
          return Response.json({
            authorization_endpoint: `${origin}/oauth/authorize`,
            token_endpoint: `${origin}/oauth/token`,
            registration_endpoint: `${origin}/oauth/register`,
          });
        if (url.endsWith("oauth/register"))
          return Response.json({ client_id: "client" });
        if (url.includes("/oauth/authorize?") && init?.redirect === "manual") {
          const authorization = new URL(url);
          const callback = new URL(
            authorization.searchParams.get("redirect_uri")!,
          );
          callback.searchParams.set("error", "login_required");
          callback.searchParams.set(
            "state",
            authorization.searchParams.get("state")!,
          );
          return new Response(null, {
            status: 302,
            headers: { Location: callback.toString() },
          });
        }
        if (url.endsWith("oauth/token")) {
          tokenExchanges += 1;
          if (tokenExchanges === 1)
            return Response.json({ access_token: "private-access-token" });
          if (tokenExchanges === 3)
            return Response.json({ access_token: "second-private-token" });
          return new Response(null, { status: 400 });
        }
        if (expired) return new Response(null, { status: 401 });
        if (init?.body) {
          const request = JSON.parse(String(init.body)) as {
            params?: { name?: string; arguments?: { name?: string } };
          };
          if (request.params?.name === "update-user-profile") {
            profileMarker = request.params.arguments?.name ?? "";
            return Response.json({
              result: { name: profileMarker },
            });
          }
          if (request.params?.name === "get-user-profile") {
            const secondTenant =
              new Headers(init.headers).get("authorization") ===
              "Bearer second-private-token";
            return Response.json({
              result: {
                name: secondTenant ? "Second tenant" : profileMarker,
              },
            });
          }
        }
        return Response.json({ result: { apps: [] } });
      },
    });
    assert.equal(receipt.result, "passed");
    assert.deepEqual(deployed.sort(), ["content-site", "site"]);
    const output = `${await readFile(files.receiptFile, "utf8")}${await readFile(files.deployResultFile, "utf8")}`;
    assert(!output.includes("private-access-token"));
    assert(!output.includes("postgresql://secret"));
    assert.match(output, /deploy/);

    let browserClosed = 0;
    let factoryClosed = false;
    let callbackClosed = false;
    await assert.rejects(
      runHostedAcceptance(files, {
        providers: providers(),
        harnessTimeoutMs: 5,
        async deploy() {
          return { deployId: "deploy-timeout" };
        },
        browserFactory: {
          async create(browserOrigin) {
            let email = "";
            return {
              async close() {
                browserClosed += 1;
              },
              adapter: {
                origin: browserOrigin,
                async postJson(_path, body) {
                  if (!body.password.endsWith("-wrong")) email = body.email;
                  return {
                    status: body.password.endsWith("-wrong") ? 401 : 200,
                  };
                },
                async getJson() {
                  return { email };
                },
                async authorize() {
                  return new Promise<void>(() => undefined);
                },
                async authorizeExpectRejected() {
                  return { status: 400 };
                },
              },
            };
          },
          async close() {
            factoryClosed = true;
          },
        },
        async createLoopbackCallback() {
          return {
            redirectUri: "http://127.0.0.1:4319/oauth/callback",
            waitForCallback: async () => new Promise<string>(() => undefined),
            async close() {
              callbackClosed = true;
            },
          };
        },
        async fetchFn(url) {
          if (url.endsWith("oauth-protected-resource"))
            return Response.json({
              authorization_servers: [origin],
              resource: `${origin}/mcp`,
            });
          if (url.endsWith("oauth-authorization-server"))
            return Response.json({
              authorization_endpoint: `${origin}/oauth/authorize`,
              token_endpoint: `${origin}/oauth/token`,
              registration_endpoint: `${origin}/oauth/register`,
            });
          if (url.endsWith("oauth/register"))
            return Response.json({ client_id: "client" });
          throw new Error(`unexpected timeout-test request: ${url}`);
        },
      }),
      /timed out/,
    );
    const timeoutReceipt = JSON.parse(
      await readFile(files.receiptFile, "utf8"),
    ) as { lease?: { state?: string } };
    assert.equal(timeoutReceipt.lease?.state, "revoked");
    assert.equal(factoryClosed, true);
    assert.equal(callbackClosed, true);
    assert(browserClosed >= 2);
  });
});
