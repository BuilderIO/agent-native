import { generateKeyPairSync } from "node:crypto";

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "8.8.8.8", family: 4 }],
}));
const state = vi.hoisted(() => ({
  credentials: new Map<string, string>(),
  rejectToken: false,
  tokenIssuers: [] as string[],
  tokenScopes: [] as string[],
  metadataTokens: [] as string[],
  queryResponses: [] as Record<string, unknown>[],
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestContext: () => ({
    userEmail: "qa@example.invalid",
    orgId: "qa-auth-workspace",
  }),
}));
vi.mock("@agent-native/core/workspace-connections", () => ({
  resolveWorkspaceConnectionCredentialForApp: async ({
    connectionId,
    key,
  }: {
    connectionId: string;
    key: string;
  }) => ({
    available: state.credentials.has(`${connectionId}:${key}`),
    value: state.credentials.get(`${connectionId}:${key}`),
  }),
}));
import {
  requestMetadata,
  runtimeForConnection,
  validateSubmittedServiceAccount,
} from "./data-connection-provider";
function key(email: string) {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return JSON.stringify({
    client_email: email,
    private_key: privateKey,
    project_id: "qa-project",
  });
}
beforeEach(() => {
  state.credentials.clear();
  state.rejectToken = false;
  state.tokenIssuers = [];
  state.tokenScopes = [];
  state.metadataTokens = [];
  state.queryResponses = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        const fields = new URLSearchParams(String(init?.body));
        const jwt = fields.get("assertion");
        if (!jwt) throw new Error("Missing assertion");
        const payload = JSON.parse(
          Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"),
        ) as { iss: string; scope: string };
        state.tokenIssuers.push(payload.iss);
        state.tokenScopes.push(payload.scope);
        return new Response(
          JSON.stringify(
            state.rejectToken
              ? { error: "invalid_grant" }
              : { access_token: `QA-TOKEN-${payload.iss}`, expires_in: 3600 },
          ),
          {
            status: state.rejectToken ? 400 : 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.startsWith("https://bigquery.googleapis.com/")) {
        state.metadataTokens.push(
          new Headers(init?.headers).get("authorization") ?? "",
        );
        const response = url.includes("/queries")
          ? state.queryResponses.shift()
          : { kind: "bigquery#datasetList", datasets: [] };
        if (!response) throw new Error("Missing query response fixture");
        return new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(
        "Unexpected network request in isolated authentication fixture",
      );
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("selected warehouse authentication", () => {
  it("requests read-only Drive access only for connections that enable it, with isolated cached tokens", async () => {
    state.credentials.set(
      "connection-drive:ref",
      key("qa-drive@example.invalid"),
    );
    await requestMetadata(
      await runtimeForConnection("connection-drive", "ref"),
      "qa-project",
    );
    await requestMetadata(
      await runtimeForConnection("connection-drive", "ref", {
        driveAccess: true,
      }),
      "qa-project",
    );
    expect(state.tokenScopes).toHaveLength(2);
    expect(state.tokenScopes[0]?.split(" ")).not.toContain(
      "https://www.googleapis.com/auth/drive.readonly",
    );
    expect(state.tokenScopes[1]?.split(" ")).toContain(
      "https://www.googleapis.com/auth/drive.readonly",
    );
    await validateSubmittedServiceAccount(
      "qa-project",
      key("qa-drive-form@example.invalid"),
      { driveAccess: true },
    );
    expect(state.tokenScopes.at(-1)?.split(" ")).toContain(
      "https://www.googleapis.com/auth/drive.readonly",
    );
  });
});
