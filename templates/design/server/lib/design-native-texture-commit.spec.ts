import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ transaction: mocks.transaction }),
}));
vi.mock("@agent-native/core/file-upload/actions/upload-image", () => ({
  UPLOAD_RECEIPT_PREFIX: "file-upload-receipt:",
}));

import { commitDesignNativeTextureRegistration } from "./design-native-texture-commit";

type Row = {
  id: string;
  provider_url: string;
  mime_type: string;
  sha256: string;
  uploader_email: string;
  byte_length: number;
};
const input = {
  id: "asset-1",
  designId: "design-1",
  fileId: "file-1",
  idempotencyKey: "once",
  uploaderEmail: "editor@example.test",
  ownerEmail: "owner@example.test",
  orgId: "org-1",
  receiptKey: "design-native-texture:one",
  providerUrl: "https://owned.example.test/image.png",
  mimeType: "image/png",
  byteLength: 100,
  sha256: "a".repeat(64),
};
const receipt = () => ({
  status: "staged",
  url: input.providerUrl,
  provider: "owned-provider",
  filename: "image.png",
  ownerEmail: input.uploaderEmail,
  expiresAt: Date.now() + 86_400_000,
});

function fakeDatabase(
  options: {
    existing?: Row;
    failOnUpdate?: boolean;
    missingReceipt?: boolean;
  } = {},
) {
  let asset = options.existing;
  let object: Row | undefined;
  let bound = false;
  let storedReceipt: Record<string, unknown> | null = options.missingReceipt
    ? null
    : receipt();
  mocks.transaction.mockImplementation(
    async (
      run: (tx: {
        execute: (query: {
          sql: string;
          args: unknown[];
        }) => Promise<{ rows: Record<string, unknown>[] }>;
      }) => Promise<unknown>,
    ) => {
      let nextAsset = asset;
      let nextObject = object;
      let nextBound = bound;
      let nextReceipt = storedReceipt;
      const result = await run({
        execute: async ({ sql, args }) => {
          if (sql.startsWith("SELECT value FROM application_state"))
            return {
              rows: nextReceipt ? [{ value: JSON.stringify(nextReceipt) }] : [],
            };
          if (sql.startsWith("INSERT INTO design_native_texture_assets")) {
            nextAsset ??= {
              id: String(args[0]),
              provider_url: String(args[7]),
              mime_type: String(args[8]),
              sha256: String(args[10]),
              uploader_email: String(args[4]),
              byte_length: Number(args[9]),
            };
            return { rows: [] };
          }
          if (sql.startsWith("SELECT id, provider_url"))
            return { rows: nextAsset ? [nextAsset] : [] };
          if (sql.startsWith("INSERT INTO design_native_texture_objects")) {
            nextObject ??= {
              id: String(args[0]),
              provider_url: String(args[1]),
              uploader_email: String(args[2]),
              mime_type: String(args[3]),
              byte_length: Number(args[4]),
              sha256: String(args[5]),
            };
            return { rows: [] };
          }
          if (sql.startsWith("SELECT id FROM design_native_texture_objects"))
            return {
              rows:
                nextObject &&
                nextObject.id === args[0] &&
                nextObject.provider_url === args[1] &&
                nextObject.uploader_email === args[2] &&
                nextObject.mime_type === args[3] &&
                nextObject.byte_length === args[4] &&
                nextObject.sha256 === args[5]
                  ? [{ id: nextObject.id }]
                  : [],
            };
          if (sql.startsWith("INSERT INTO design_native_texture_bindings")) {
            nextBound = true;
            return { rows: [] };
          }
          if (sql.startsWith("UPDATE application_state")) {
            if (options.failOnUpdate)
              throw new Error("simulated crash before transaction commit");
            nextReceipt = JSON.parse(String(args[0])) as Record<
              string,
              unknown
            >;
            return { rows: [{ key: args[3] }] };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      });
      asset = nextAsset;
      object = nextObject;
      bound = nextBound;
      storedReceipt = nextReceipt;
      return result;
    },
  );
  return {
    state: () => ({ asset, object, bound, receipt: storedReceipt }),
    expire: () => {
      if (storedReceipt?.status === "staged") {
        storedReceipt = null;
        return "provider-object-deleted";
      }
      if (storedReceipt?.status === "committed") {
        storedReceipt = null;
        return "receipt-only-released";
      }
      return "no-receipt";
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("native texture durable receipt commit", () => {
  it("survives worker death after SQL commit and 24-hour receipt expiry without deleting bytes", async () => {
    const db = fakeDatabase();
    expect(await commitDesignNativeTextureRegistration(input)).toEqual({
      id: "asset-1",
      sameProviderObject: true,
    });
    expect(db.state().receipt?.status).toBe("committed");
    expect(db.state().asset?.provider_url).toBe(input.providerUrl);
    expect(db.state().object?.sha256).toBe(input.sha256);
    expect(db.state().bound).toBe(true);
    expect(db.expire()).toBe("receipt-only-released");
    expect(db.state().asset?.provider_url).toBe(input.providerUrl);
  });

  it("reconciles a concurrent same-key retry after the first transaction committed", async () => {
    const db = fakeDatabase();
    const first = await commitDesignNativeTextureRegistration(input);
    const second = await commitDesignNativeTextureRegistration({
      ...input,
      id: "unused-second-id",
    });
    expect(second).toEqual(first);
    expect(db.state().asset?.id).toBe("asset-1");
    expect(db.state().receipt?.status).toBe("committed");
  });

  it("rolls back both metadata and receipt when the worker fails inside the SQL transaction", async () => {
    const db = fakeDatabase({ failOnUpdate: true });
    await expect(commitDesignNativeTextureRegistration(input)).rejects.toThrow(
      "simulated crash",
    );
    expect(db.state().asset).toBeUndefined();
    expect(db.state().object).toBeUndefined();
    expect(db.state().bound).toBe(false);
    expect(db.state().receipt?.status).toBe("staged");
    expect(db.expire()).toBe("provider-object-deleted");
  });

  it("leaves a concurrent loser staged for provider deletion while preserving the winner", async () => {
    const existing = {
      id: "winner",
      provider_url: "https://owned.example.test/winner.png",
      mime_type: "image/png",
      sha256: input.sha256,
      uploader_email: input.uploaderEmail,
      byte_length: input.byteLength,
    };
    const db = fakeDatabase({ existing });
    expect(await commitDesignNativeTextureRegistration(input)).toEqual({
      id: "winner",
      sameProviderObject: false,
    });
    expect(db.state().receipt?.status).toBe("staged");
    expect(db.expire()).toBe("provider-object-deleted");
    expect(db.state().asset).toEqual(existing);
  });

  it("refuses a missing or mismatched staged receipt before inserting metadata", async () => {
    const db = fakeDatabase({ missingReceipt: true });
    await expect(
      commitDesignNativeTextureRegistration(input),
    ).rejects.toMatchObject({ code: "receipt-unavailable" });
    expect(db.state().asset).toBeUndefined();
  });
});
