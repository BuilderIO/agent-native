import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockGetOrgContext = vi.fn();
const mockGetRequiredSecret = vi.fn();
const mockWriteAppSecret = vi.fn();

vi.mock("./auth.js", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: (...args: any[]) => mockGetOrgContext(...args),
}));

vi.mock("../secrets/register.js", () => ({
  getRequiredSecret: (...args: any[]) => mockGetRequiredSecret(...args),
}));

vi.mock("../secrets/storage.js", () => ({
  writeAppSecret: (...args: any[]) => mockWriteAppSecret(...args),
}));

import {
  findUnsupportedScopedKeyNames,
  saveKeyValuesToScopedSecrets,
  ScopedKeyStorageError,
} from "./scoped-key-storage.js";

const event = {} as any;

describe("saveKeyValuesToScopedSecrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ email: "alice@example.com" });
    mockGetOrgContext.mockResolvedValue({
      orgId: "org_1",
      role: "owner",
    });
    mockGetRequiredSecret.mockReturnValue(undefined);
    mockWriteAppSecret.mockResolvedValue("sec_1");
  });

  it("saves arbitrary keys to the current user by default", async () => {
    const result = await saveKeyValuesToScopedSecrets(event, [
      { key: "S3_BUCKET", value: "clips" },
    ]);

    expect(result.saved).toEqual(["S3_BUCKET"]);
    expect(mockWriteAppSecret).toHaveBeenCalledWith({
      key: "S3_BUCKET",
      value: "clips",
      scope: "user",
      scopeId: "alice@example.com",
    });
  });

  it("saves workspace keys to the active org for owners and admins", async () => {
    await saveKeyValuesToScopedSecrets(
      event,
      [{ key: "S3_ENDPOINT", value: "https://r2.example.com" }],
      "workspace",
    );

    expect(mockWriteAppSecret).toHaveBeenCalledWith({
      key: "S3_ENDPOINT",
      value: "https://r2.example.com",
      scope: "workspace",
      scopeId: "org_1",
    });
  });

  it("rejects workspace writes from org members", async () => {
    mockGetOrgContext.mockResolvedValue({
      orgId: "org_1",
      role: "member",
    });

    await expect(
      saveKeyValuesToScopedSecrets(
        event,
        [{ key: "S3_BUCKET", value: "clips" }],
        "workspace",
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      message:
        "Only organization owners and admins can set workspace-scoped keys",
    });
    expect(mockWriteAppSecret).not.toHaveBeenCalled();
  });

  it("uses registered secret scope and validator when present", async () => {
    const validator = vi.fn(async () => true);
    mockGetRequiredSecret.mockReturnValue({
      key: "GROQ_API_KEY",
      label: "Groq",
      scope: "user",
      kind: "api-key",
      validator,
    });

    await saveKeyValuesToScopedSecrets(
      event,
      [{ key: "GROQ_API_KEY", value: "gsk_valid" }],
      "workspace",
    );

    expect(validator).toHaveBeenCalledWith("gsk_valid");
    expect(mockWriteAppSecret).toHaveBeenCalledWith({
      key: "GROQ_API_KEY",
      value: "gsk_valid",
      scope: "user",
      scopeId: "alice@example.com",
    });
  });

  it("rejects invalid key names before writing", async () => {
    await expect(
      saveKeyValuesToScopedSecrets(event, [
        { key: "bad key", value: "secret" },
      ]),
    ).rejects.toBeInstanceOf(ScopedKeyStorageError);
    expect(mockWriteAppSecret).not.toHaveBeenCalled();
  });
});

describe("findUnsupportedScopedKeyNames", () => {
  it("deduplicates key names that are not in the allowlist", () => {
    expect(
      findUnsupportedScopedKeyNames(
        [
          { key: "GOOGLE_CLIENT_ID", value: "id" },
          { key: "UNKNOWN_KEY", value: "secret" },
          { key: " UNKNOWN_KEY ", value: "secret-again" },
        ],
        ["GOOGLE_CLIENT_ID"],
      ),
    ).toEqual(["UNKNOWN_KEY"]);
  });
});
