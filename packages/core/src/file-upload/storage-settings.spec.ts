import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, string>());
const roleRef = vi.hoisted(() => ({ role: "owner" as string | null }));
const unreadable = vi.hoisted(() => new Set<string>());
const readErrorRef = vi.hoisted(() => ({ error: null as Error | null }));
const { AppSecretDecryptionError } = vi.hoisted(() => ({
  AppSecretDecryptionError: class extends Error {
    readonly errorCode = "app_secret_unreadable";

    constructor() {
      super("A saved connection could not be decrypted.");
      this.name = "AppSecretDecryptionError";
    }
  },
}));
const { CredentialStoreUnavailableError } = vi.hoisted(() => ({
  CredentialStoreUnavailableError: class extends Error {
    constructor() {
      super("Could not read saved connections.");
      this.name = "CredentialStoreUnavailableError";
    }
  },
}));

vi.mock("../secrets/errors.js", () => ({ AppSecretDecryptionError }));
vi.mock("../server/credential-provider.js", () => ({
  CredentialStoreUnavailableError,
}));
const providersRef = vi.hoisted(() => ({
  list: [] as Array<{
    id: string;
    name: string;
    publicBaseUrlOptional?: boolean;
  }>,
  active: null as { id: string; name: string } | null,
  activeError: null as Error | null,
}));
const builderRef = vi.hoisted(() => ({
  result: false as boolean | Error,
}));
const readinessRef = vi.hoisted(() => ({
  result: {
    selectedOrg: "selected" as const,
    provider: "builder" as const,
    readiness: "ready" as const,
    builderAuthorized: "yes" as const,
  },
}));

vi.mock("../secrets/storage.js", () => ({
  readAppSecrets: vi.fn(
    async (args: { keys: string[]; scope: string; scopeId: string }) => {
      if (readErrorRef.error) throw readErrorRef.error;
      const out = new Map<string, { value: string }>();
      for (const key of args.keys) {
        const value = store.get(`${args.scope}:${args.scopeId}:${key}`);
        if (value !== undefined && unreadable.has(key)) {
          throw new AppSecretDecryptionError();
        }
        if (value !== undefined) out.set(key, { value });
      }
      return out;
    },
  ),
  readAppSecret: vi.fn(
    async (args: { key: string; scope: string; scopeId: string }) => {
      if (readErrorRef.error) throw readErrorRef.error;
      const value = store.get(`${args.scope}:${args.scopeId}:${args.key}`);
      if (value !== undefined && unreadable.has(args.key)) {
        throw new AppSecretDecryptionError();
      }
      return value === undefined ? null : { value };
    },
  ),
  writeAppSecret: vi.fn(
    async (args: {
      key: string;
      value: string;
      scope: string;
      scopeId: string;
    }) => {
      store.set(`${args.scope}:${args.scopeId}:${args.key}`, args.value);
      unreadable.delete(args.key);
      return "id";
    },
  ),
  deleteAppSecret: vi.fn(
    async (ref: { key: string; scope: string; scopeId: string }) =>
      store.delete(`${ref.scope}:${ref.scopeId}:${ref.key}`),
  ),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({
    execute: async () => ({
      rows: roleRef.role ? [{ role: roleRef.role }] : [],
    }),
  }),
}));

vi.mock("./registry.js", () => ({
  listFileUploadProviders: () => providersRef.list,
  getActiveFileUploadProviderForRequest: async () => {
    if (providersRef.activeError) throw providersRef.activeError;
    return providersRef.active;
  },
}));

vi.mock("../server/builder-api-auth.js", () => ({
  canAuthorizeBuilderApiRequest: async () => {
    if (builderRef.result instanceof Error) throw builderRef.result;
    return builderRef.result;
  },
}));

vi.mock("../server/builder-oauth.js", () => ({
  BUILDER_ASSETS_WRITE_SCOPE: "builder:assets:write",
}));

vi.mock("./storage-readiness.js", () => ({
  getPrivateStorageReadinessForUser: async () => readinessRef.result,
}));

import {
  clearFileStorage,
  getFileStorageStatus,
  inferFileStorageProvider,
  saveFileStorage,
} from "./storage-settings.js";

const ORG = "org-example";
const ctx = { userEmail: "owner@example.com", orgId: ORG };
const key = (name: string, scopeId = ORG) => `workspace:${scopeId}:${name}`;

const complete = {
  endpoint: "https://s3.us-west-2.amazonaws.com/",
  bucket: "uploads-example",
  accessKeyId: "access-example",
  secretAccessKey: "secret-example",
  publicBaseUrl: "https://cdn.example.com",
};

describe("file storage settings", () => {
  beforeEach(() => {
    store.clear();
    unreadable.clear();
    readErrorRef.error = null;
    roleRef.role = "owner";
    providersRef.list = [{ id: "s3", name: "S3-compatible object storage" }];
    providersRef.active = null;
    providersRef.activeError = null;
    builderRef.result = false;
    readinessRef.result = {
      selectedOrg: "selected",
      provider: "builder",
      readiness: "ready",
      builderAuthorized: "yes",
    };
  });

  it("saves every value at workspace scope and reports saved keys without secrets", async () => {
    const status = await saveFileStorage(ctx, complete);

    expect(store.get(key("S3_ENDPOINT"))).toBe(
      "https://s3.us-west-2.amazonaws.com",
    );
    expect(store.get(key("S3_SECRET_ACCESS_KEY"))).toBe("secret-example");
    expect(status).toMatchObject({
      canManage: true,
      configured: true,
      provider: "aws-s3",
      bucket: "uploads-example",
      publicUrlRequired: true,
      saved: { accessKeyId: true, secretAccessKey: true, region: false },
    });
    expect(JSON.stringify(status)).not.toContain("secret-example");
    expect(JSON.stringify(status)).not.toContain("access-example");
  });

  it("keeps saved keys when a later save omits them", async () => {
    await saveFileStorage(ctx, complete);
    const status = await saveFileStorage(ctx, {
      endpoint: complete.endpoint,
      bucket: "renamed-bucket",
      publicBaseUrl: complete.publicBaseUrl,
    });

    expect(store.get(key("S3_ACCESS_KEY_ID"))).toBe("access-example");
    expect(status).toMatchObject({
      configured: true,
      bucket: "renamed-bucket",
    });
  });

  it("isolates unreadable keys, blocks partial saves, and allows replacement", async () => {
    await saveFileStorage(ctx, complete);
    unreadable.add("S3_SECRET_ACCESS_KEY");

    const status = await getFileStorageStatus(ctx);
    expect(status).toMatchObject({
      configured: false,
      configurationUnavailable: true,
      unreadableFields: ["secretAccessKey"],
      saved: { secretAccessKey: true },
    });
    await expect(
      saveFileStorage(ctx, { bucket: "changed-bucket" }),
    ).rejects.toMatchObject({
      statusCode: 503,
      errorCode: "credential_store_unavailable",
      details: { unreadableFields: ["secretAccessKey"] },
    });
    expect(store.get(key("S3_BUCKET"))).toBe(complete.bucket);

    const repaired = await saveFileStorage(ctx, {
      secretAccessKey: "replacement-secret",
    });
    expect(repaired).toMatchObject({
      configured: true,
      configurationUnavailable: false,
      unreadableFields: [],
    });
    expect(store.get(key("S3_SECRET_ACCESS_KEY"))).toBe("replacement-secret");
  });

  it("does not fall back to a legacy value when the current S3 value is unreadable", async () => {
    await saveFileStorage(ctx, complete);
    store.set(key("R2_SECRET_ACCESS_KEY"), "legacy-secret");
    unreadable.add("S3_SECRET_ACCESS_KEY");

    const status = await getFileStorageStatus(ctx);

    expect(status).toMatchObject({
      configured: false,
      configurationUnavailable: true,
      unreadableFields: ["secretAccessKey"],
    });
  });

  it("preserves unreadable optional values during unrelated saves and can clear them explicitly", async () => {
    await saveFileStorage(ctx, { ...complete, region: "us-west-2" });
    unreadable.add("S3_REGION");

    const partial = await saveFileStorage(ctx, { bucket: "changed-bucket" });
    expect(store.get(key("S3_REGION"))).toBe("us-west-2");
    expect(partial.unreadableFields).toContain("region");
    expect(partial.configured).toBe(true);

    const cleared = await saveFileStorage(ctx, { region: "" });
    expect(store.has(key("S3_REGION"))).toBe(false);
    expect(cleared.unreadableFields).not.toContain("region");
  });

  it("propagates storage query failures instead of treating them as unreadable secrets", async () => {
    const error = new Error("database unavailable");
    readErrorRef.error = error;

    await expect(getFileStorageStatus(ctx)).rejects.toBe(error);
  });

  it("reports an unavailable active-provider check without claiming no provider is configured", async () => {
    providersRef.activeError = new CredentialStoreUnavailableError();

    const status = await getFileStorageStatus(ctx);

    expect(status).toMatchObject({
      configurationUnavailable: true,
      activeProvider: null,
      activeProviderUnavailable: true,
    });
  });

  it("propagates unrelated active-provider errors", async () => {
    const error = new Error("provider configuration bug");
    providersRef.activeError = error;

    await expect(getFileStorageStatus(ctx)).rejects.toBe(error);
  });

  it("requires the keys on first setup", async () => {
    await expect(
      saveFileStorage(ctx, {
        endpoint: complete.endpoint,
        bucket: complete.bucket,
        publicBaseUrl: complete.publicBaseUrl,
      }),
    ).rejects.toMatchObject({
      errorCode: "invalid_file_storage",
      details: { missing: ["accessKeyId", "secretAccessKey"] },
    });
    expect(store.size).toBe(0);
  });

  it("requires a public URL unless the registered provider serves without one", async () => {
    const { publicBaseUrl: _omit, ...withoutPublicUrl } = complete;
    await expect(saveFileStorage(ctx, withoutPublicUrl)).rejects.toMatchObject({
      details: { missing: ["publicBaseUrl"] },
    });

    providersRef.list = [
      { id: "s3", name: "S3-compatible storage", publicBaseUrlOptional: true },
    ];
    const status = await saveFileStorage(ctx, withoutPublicUrl);
    expect(status).toMatchObject({
      configured: true,
      publicUrlRequired: false,
    });
  });

  it("removes an optional value saved as an empty string", async () => {
    await saveFileStorage(ctx, { ...complete, region: "us-west-2" });
    await saveFileStorage(ctx, { region: "" });

    expect(store.has(key("S3_REGION"))).toBe(false);
  });

  it("rejects endpoints that are not http URLs", async () => {
    await expect(
      saveFileStorage(ctx, {
        ...complete,
        endpoint: "ftp://files.example.com",
      }),
    ).rejects.toMatchObject({ details: { field: "endpoint" } });
  });

  it("refuses members with a clear error and shows them no saved values", async () => {
    await saveFileStorage(ctx, complete);
    roleRef.role = "member";
    const member = { userEmail: "member@example.com", orgId: ORG };

    await expect(clearFileStorage(member)).rejects.toMatchObject({
      statusCode: 403,
      message: "Only organization owners and admins can change file storage.",
    });
    await expect(saveFileStorage(member, complete)).rejects.toMatchObject({
      statusCode: 403,
    });
    const status = await getFileStorageStatus(member);
    expect(status).toMatchObject({
      canManage: false,
      configured: true,
      bucket: null,
      endpoint: null,
      saved: { accessKeyId: false },
    });
    expect(store.get(key("S3_BUCKET"))).toBe("uploads-example");
  });

  it("clears every S3 and legacy R2 key at workspace scope", async () => {
    await saveFileStorage(ctx, complete);
    store.set(key("R2_BUCKET"), "legacy-bucket");
    store.set(`user:${ctx.userEmail}:S3_BUCKET`, "personal-bucket");
    builderRef.result = true;

    const result = await clearFileStorage(ctx);

    expect(result.removedKeys).toEqual(
      expect.arrayContaining([
        "S3_BUCKET",
        "R2_BUCKET",
        "S3_SECRET_ACCESS_KEY",
      ]),
    );
    expect([...store.keys()]).toEqual([`user:${ctx.userEmail}:S3_BUCKET`]);
    expect(result.status).toMatchObject({
      configured: false,
      builderUploadConfigured: true,
      saved: { bucket: false },
    });
  });

  it("uses a solo scope without an organization", async () => {
    await saveFileStorage({ userEmail: "solo@example.com" }, complete);
    expect(store.get(key("S3_BUCKET", "solo:solo@example.com"))).toBe(
      "uploads-example",
    );
  });

  it("reports an unknown Builder.io fallback as null, not false", async () => {
    builderRef.result = new Error("credential store down");
    const status = await getFileStorageStatus(ctx);
    expect(status.builderUploadConfigured).toBeNull();
  });

  it("includes finite private-storage readiness without exposing credentials", async () => {
    const status = await getFileStorageStatus(ctx);

    expect(status.privateStorageReadiness).toEqual({
      selectedOrg: "selected",
      provider: "builder",
      readiness: "ready",
      builderAuthorized: "yes",
    });
    expect(JSON.stringify(status)).not.toContain("owner@example.com");
  });

  it("infers the provider preset from the endpoint", () => {
    expect(
      inferFileStorageProvider("https://abc.r2.cloudflarestorage.com"),
    ).toBe("cloudflare-r2");
    expect(
      inferFileStorageProvider("https://proj.supabase.co/storage/v1/s3"),
    ).toBe("supabase");
    expect(inferFileStorageProvider("https://minio.example.com")).toBe("other");
    expect(inferFileStorageProvider(null)).toBeNull();
  });
});
