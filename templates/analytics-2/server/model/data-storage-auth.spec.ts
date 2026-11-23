import { generateKeyPairSync } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  credentials: new Map<string, string>(),
  status: undefined as string | undefined,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestContext: () => ({
    userEmail: "qa@example.invalid",
    orgId: "qa-storage-auth-workspace",
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
    ...(state.status === undefined ? {} : { status: state.status }),
  }),
}));

import { storageClientForConnection } from "./data-connection-provider";
import { WAREHOUSE_STORAGE_MAX_RESPONSE_BYTES } from "./data-storage";

function serviceAccount(
  email: string,
  overrides: Record<string, unknown> = {},
) {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return JSON.stringify({
    type: "service_account",
    client_email: email,
    private_key: privateKey,
    project_id: "qa-project",
    ...overrides,
  });
}

function claims(value: unknown): {
  iss?: string;
  scope?: string;
  sub?: string;
  aud?: string;
} {
  const authorization = new Headers(value as Record<string, string>).get(
    "authorization",
  );
  if (!authorization?.startsWith("Bearer "))
    throw new Error("The Storage client did not return a bearer token.");
  const payload = authorization.slice("Bearer ".length).split(".")[1];
  if (!payload) throw new Error("The bearer token is not a JWT.");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    iss?: string;
    scope?: string;
    sub?: string;
    aud?: string;
  };
}

beforeEach(() => {
  state.credentials.clear();
  state.status = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Storage client authentication", () => {
  it("signs a self-signed token with the selected vault credential and exactly the provider scopes", async () => {
    // If the SDK fell back to ADC or the environment, this path would be used
    // instead of the selected workspace connection credential.
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/nonexistent/qa-adc.json");
    const credential = serviceAccount("qa-storage-auth@example.invalid");
    state.credentials.set("connection-auth:ref", credential);
    const storage = await storageClientForConnection("connection-auth", "ref");
    try {
      const authClient = await storage.client.auth.getClient();
      const token = claims(
        await authClient.getRequestHeaders(
          "https://bigquerystorage.googleapis.com/google.cloud.bigquery.storage.v1.BigQueryRead/ReadRows",
        ),
      );
      expect(token.iss).toBe("qa-storage-auth@example.invalid");
      expect(token.scope).toBe(
        [
          "https://www.googleapis.com/auth/cloud-platform",
          "https://www.googleapis.com/auth/bigquery",
        ].join(" "),
      );
      expect(token.scope).not.toContain("drive");
      expect(storage.client.auth.jsonContent).toMatchObject({
        type: "service_account",
        client_email: "qa-storage-auth@example.invalid",
      });
    } finally {
      await storage.close();
    }
  });

  it("sets an explicit finite gRPC receive limit on the Storage client", async () => {
    state.credentials.set(
      "connection-grpc:ref",
      serviceAccount("qa-storage-grpc@example.invalid"),
    );
    const storage = await storageClientForConnection("connection-grpc", "ref");
    try {
      const options = (
        storage.client as unknown as { _opts?: Record<string, unknown> }
      )._opts;
      expect(options?.["grpc.max_receive_message_length"]).toBe(
        WAREHOUSE_STORAGE_MAX_RESPONSE_BYTES,
      );
      expect(
        Number(options?.["grpc.max_receive_message_length"]),
      ).toBeGreaterThanOrEqual(128 * 1024 * 1024);
    } finally {
      await storage.close();
    }
  });

  it("adds the existing Drive scope only when the connection already has Drive access enabled", async () => {
    state.credentials.set(
      "connection-drive:ref",
      serviceAccount("qa-storage-drive@example.invalid"),
    );
    const storage = await storageClientForConnection(
      "connection-drive",
      "ref",
      { driveAccess: true },
    );
    try {
      const authClient = await storage.client.auth.getClient();
      const token = claims(
        await authClient.getRequestHeaders(
          "https://bigquerystorage.googleapis.com/google.cloud.bigquery.storage.v1.BigQueryRead/ReadRows",
        ),
      );
      expect(token.scope).toBe(
        [
          "https://www.googleapis.com/auth/cloud-platform",
          "https://www.googleapis.com/auth/bigquery",
          "https://www.googleapis.com/auth/drive.readonly",
        ].join(" "),
      );
    } finally {
      await storage.close();
    }
  });

  it("forces the saved service-account identity even when the stored JSON claims another credential type", async () => {
    state.credentials.set(
      "connection-type:ref",
      serviceAccount("qa-storage-type@example.invalid", {
        type: "external_account",
        token_uri: "https://attacker.invalid/token",
      }),
    );
    const storage = await storageClientForConnection("connection-type", "ref");
    try {
      expect(storage.client.auth.jsonContent).toMatchObject({
        type: "service_account",
        client_email: "qa-storage-type@example.invalid",
      });
      expect(storage.client.auth.jsonContent).not.toHaveProperty("token_uri");
      const authClient = await storage.client.auth.getClient();
      const token = claims(
        await authClient.getRequestHeaders(
          "https://bigquerystorage.googleapis.com/google.cloud.bigquery.storage.v1.BigQueryRead/ReadRows",
        ),
      );
      expect(token.iss).toBe("qa-storage-type@example.invalid");
    } finally {
      await storage.close();
    }
  });

  it("refuses an unavailable vault credential without creating a client", async () => {
    await expect(
      storageClientForConnection("connection-missing", "ref"),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "data_connection_unavailable",
    });
  });

  it("maps resolver statuses without treating unreadable storage as a missing grant", async () => {
    const cases = [
      ["error", 503, "data_connection_credentials_unreadable"],
      ["missing_secret", 409, "data_connection_credentials_missing"],
      ["missing_context", 401, "data_connection_auth_required"],
      ["not_available", 403, "data_connection_unavailable"],
    ] as const;
    for (const [status, statusCode, errorCode] of cases) {
      state.status = status;
      await expect(
        storageClientForConnection("connection-status", "ref"),
      ).rejects.toMatchObject({ statusCode, errorCode });
    }
  });

  it("refuses a stored credential that is not a service-account key", async () => {
    state.credentials.set(
      "connection-bad:ref",
      JSON.stringify({ type: "authorized_user", client_id: "qa" }),
    );
    await expect(
      storageClientForConnection("connection-bad", "ref"),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_credentials_invalid",
    });
  });
});
