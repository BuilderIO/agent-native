import { beforeEach, describe, expect, it, vi } from "vitest";

const credential = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("./credentials", () => ({
  resolveCredential: async () => credential.value,
}));
vi.mock("./credentials-context", () => ({
  credentialCacheScope: () => "org:test",
  requireRequestCredentialContext: () => ({}),
  scopedCredentialCacheKey: (key: string) => key,
}));

import { getGoogleServiceAccountToken } from "./google-analytics";

describe("getGoogleServiceAccountToken", () => {
  beforeEach(() => {
    credential.value = null;
  });

  it("names a saved key that can't be signed with, without echoing it", async () => {
    credential.value = JSON.stringify({
      client_email: "collector@example-project.iam.gserviceaccount.com",
      private_key:
        "-----BEGIN PRIVATE KEY-----\nnot*a*real*key\n-----END PRIVATE KEY-----\n",
    });
    const error = await getGoogleServiceAccountToken(
      "https://www.googleapis.com/auth/webmasters.readonly",
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      errorCode: "google_credentials_unreadable",
      statusCode: 422,
    });
    expect((error as Error).message).toMatch(
      /^Couldn't read the saved service account key/,
    );
    expect((error as Error).message).not.toContain("not*a*real*key");
  });

  it("does not quote a key that isn't JSON", async () => {
    credential.value = "{not json, private stuff";
    const error = await getGoogleServiceAccountToken().catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ errorCode: "google_credentials_unreadable" });
    expect((error as Error).message).not.toContain("private stuff");
  });

  it.each([undefined, null, 42, "", "   "])(
    "rejects an unreadable client email %s before token exchange",
    async (client_email) => {
      credential.value = JSON.stringify({
        client_email,
        private_key: "placeholder-private-key",
      });
      await expect(getGoogleServiceAccountToken()).rejects.toMatchObject({
        errorCode: "google_credentials_unreadable",
        statusCode: 422,
      });
    },
  );

  it("still reports a missing key as not configured", async () => {
    await expect(getGoogleServiceAccountToken()).rejects.toMatchObject({
      errorCode: "google_credentials_missing",
      statusCode: 424,
    });
  });
});

it.each([null, [], 42, "text"])(
  "rejects a non-object credential %s",
  async (value) => {
    credential.value = JSON.stringify(value);
    await expect(getGoogleServiceAccountToken()).rejects.toMatchObject({
      errorCode: "google_credentials_unreadable",
      statusCode: 422,
    });
  },
);
