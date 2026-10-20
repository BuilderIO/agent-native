import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mockExecute }),
}));

import { resetAppConfigForTests } from "../app-config/index.js";
import {
  enforceSignupAdmission,
  INVITE_ONLY_SIGNUP_CODE,
  isSignupAdmitted,
} from "./signup-admission.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  resetAppConfigForTests();
  process.env = { ...originalEnv, AUTH_SIGNUP: "invited" };
  mockExecute.mockReset();
});

describe("invite-only signup admission", () => {
  it("allows a pending invitation regardless of email case", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ 1: 1 }] });

    await expect(
      enforceSignupAdmission({ email: "Jane@Company.test" }),
    ).resolves.toBeUndefined();
    expect(mockExecute.mock.calls[0]?.[0]).toMatchObject({
      args: ["jane@company.test"],
    });
  });

  it("allows verified users from an allowed org domain through the shared create hook", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ 1: 1 }] });

    await expect(
      enforceSignupAdmission({
        email: "social@company.test",
        emailVerified: true,
      }),
    ).resolves.toBeUndefined();
    expect(mockExecute.mock.calls[1]?.[0]).toMatchObject({
      args: ["company.test"],
    });
  });

  it("allows configured bootstrap admins without querying org tables", async () => {
    process.env.AUTH_BOOTSTRAP_ADMINS = "Admin@Company.test";

    await expect(
      isSignupAdmitted({ email: "admin@company.test" }),
    ).resolves.toBe(true);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("rejects unverified domain matches and unknown social signups with a typed error", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      enforceSignupAdmission({
        email: "unknown@company.test",
        emailVerified: false,
      }),
    ).rejects.toMatchObject({ message: INVITE_ONLY_SIGNUP_CODE });
  });
});
