import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CredentialUse } from "../credentials/use-ledger.js";

const mocks = vi.hoisted(() => ({
  resolveCredentialDetailed: vi.fn(),
  getRegisteredProviderApiRuntimeOptions: vi.fn(),
  resolveProviderApiCredentialUses: vi.fn(),
}));

vi.mock("../credentials/index.js", () => ({
  resolveCredentialDetailed: mocks.resolveCredentialDetailed,
}));
vi.mock("../provider-api/index.js", () => ({
  getRegisteredProviderApiRuntimeOptions:
    mocks.getRegisteredProviderApiRuntimeOptions,
  resolveProviderApiCredentialUses: mocks.resolveProviderApiCredentialUses,
}));

import {
  isOrgShareableRun,
  parseCredentialUses,
  viewerReadsSameCredentials,
  viewerResolvesOnlyOrgCredentials,
} from "./shared-runs.js";

const ORG = "org_1";
const VIEWER = { userEmail: "viewer@example.com", orgId: ORG };

const githubRequest: CredentialUse = {
  kind: "provider-request",
  provider: "github",
};
const orgToken: CredentialUse = {
  kind: "stored",
  key: "GITHUB_TOKEN",
  scope: "org",
  scopeId: ORG,
};
const orgTokenAuth: CredentialUse = {
  kind: "provider-auth",
  provider: "github",
  key: "GITHUB_TOKEN",
  source: "app_local",
  scope: "org",
  scopeId: ORG,
  connectionId: null,
  accountId: null,
};

function shareable(
  uses: CredentialUse[],
  bridgeToolsUsed: string[] = ["provider-api-request"],
) {
  return isOrgShareableRun({ uses, bridgeToolsUsed, orgId: ORG });
}

beforeEach(() => {
  mocks.resolveCredentialDetailed.mockReset();
  mocks.getRegisteredProviderApiRuntimeOptions.mockReset();
  mocks.resolveProviderApiCredentialUses.mockReset();
});

describe("isOrgShareableRun", () => {
  it("shares a run that read only the org's own stored credentials", () => {
    expect(shareable([githubRequest, orgToken, orgTokenAuth])).toBe(true);
    expect(
      shareable(
        [{ ...orgToken, scope: "workspace" }],
        ["provider-api-request"],
      ),
    ).toBe(true);
    expect(shareable([], [])).toBe(true);
  });

  it("treats a credential nobody has set as reading nothing", () => {
    expect(
      shareable([
        { kind: "stored", key: "HUBSPOT_TOKEN", scope: null, scopeId: null },
      ]),
    ).toBe(true);
  });

  it("never shares a run that read a person's own key", () => {
    expect(
      shareable([
        { ...orgToken, scope: "user", scopeId: VIEWER.userEmail },
        { ...orgTokenAuth, scope: "user", scopeId: VIEWER.userEmail },
      ]),
    ).toBe(false);
    expect(
      shareable([
        {
          ...orgToken,
          scope: "workspace",
          scopeId: `solo:${VIEWER.userEmail}`,
        },
      ]),
    ).toBe(false);
  });

  it("never shares another org's credential", () => {
    expect(shareable([{ ...orgToken, scopeId: "org_2" }])).toBe(false);
  });

  it("never shares a provider credential that didn't come from the org's stored settings", () => {
    expect(shareable([orgTokenAuth])).toBe(false);
    expect(
      shareable([
        orgToken,
        { ...orgTokenAuth, source: "workspace_connection" },
      ]),
    ).toBe(false);
    expect(
      shareable([orgToken, { ...orgTokenAuth, key: "github_oauth" }]),
    ).toBe(false);
    expect(shareable([orgToken, { ...orgTokenAuth, accountId: "acct" }])).toBe(
      false,
    );
    expect(
      shareable([orgToken, { ...orgTokenAuth, connectionId: "conn" }]),
    ).toBe(false);
  });

  it("keeps runs on connections, custom providers, caller auth, failed lookups or refused writes per viewer", () => {
    for (const kind of [
      "provider-connection",
      "custom-provider",
      "caller-auth",
      "provider-unresolved",
      "provider-effect",
    ] as const) {
      expect(shareable([githubRequest, { kind, provider: "github" }])).toBe(
        false,
      );
    }
    expect(shareable([{ kind: "unreadable", key: "GITHUB_TOKEN" }])).toBe(
      false,
    );
  });

  it("keeps runs that call app actions, web requests or files per viewer", () => {
    expect(shareable([], ["extension-data-get"])).toBe(false);
    expect(shareable([], ["provider-api-request", "web-request"])).toBe(false);
    expect(shareable([], ["workspace-files"])).toBe(false);
  });
});

describe("parseCredentialUses", () => {
  it("reads back a stored record", () => {
    const uses = [githubRequest, orgToken, orgTokenAuth];
    expect(parseCredentialUses(JSON.stringify(uses))).toEqual(uses);
    expect(parseCredentialUses("[]")).toEqual([]);
  });

  it("rejects a record it can't fully read, so its run is never served", () => {
    expect(parseCredentialUses(null)).toBeNull();
    expect(parseCredentialUses("not json")).toBeNull();
    expect(parseCredentialUses("{}")).toBeNull();
    expect(parseCredentialUses("[{}]")).toBeNull();
    expect(
      parseCredentialUses(JSON.stringify([orgToken, { kind: "new-kind" }])),
    ).toBeNull();
    expect(
      parseCredentialUses(JSON.stringify([{ ...orgToken, scope: 1 }])),
    ).toBeNull();
    expect(
      parseCredentialUses(
        JSON.stringify([{ ...orgTokenAuth, connectionId: undefined }]),
      ),
    ).toBeNull();
  });
});

describe("viewerReadsSameCredentials", () => {
  function orgSecret() {
    mocks.resolveCredentialDetailed.mockResolvedValue({
      value: "secret",
      scope: "org",
      scopeId: ORG,
    });
  }

  function providerRuntime() {
    mocks.getRegisteredProviderApiRuntimeOptions.mockReturnValue({
      appId: "analytics",
    });
  }

  it("serves a viewer whose own run reads the same org credential", async () => {
    orgSecret();

    await expect(
      viewerReadsSameCredentials({
        uses: [orgToken],
        viewer: VIEWER,
        appId: "analytics",
      }),
    ).resolves.toBe(true);
    expect(mocks.resolveCredentialDetailed).toHaveBeenCalledWith(
      "GITHUB_TOKEN",
      VIEWER,
    );
  });

  it("refuses a viewer whose own run would use their personal key", async () => {
    mocks.resolveCredentialDetailed.mockResolvedValue({
      value: "personal",
      scope: "user",
      scopeId: VIEWER.userEmail,
    });

    await expect(
      viewerReadsSameCredentials({
        uses: [orgToken],
        viewer: VIEWER,
        appId: "analytics",
      }),
    ).resolves.toBe(false);
  });

  it("refuses a viewer who holds a key the org lacks", async () => {
    mocks.resolveCredentialDetailed.mockResolvedValue({
      value: "personal",
      scope: "user",
      scopeId: VIEWER.userEmail,
    });

    await expect(
      viewerReadsSameCredentials({
        uses: [
          { kind: "stored", key: "HUBSPOT_TOKEN", scope: null, scopeId: null },
        ],
        viewer: VIEWER,
        appId: "analytics",
      }),
    ).resolves.toBe(false);
  });

  it("serves a viewer whose provider lookups land on the same org key", async () => {
    orgSecret();
    providerRuntime();
    mocks.resolveProviderApiCredentialUses.mockResolvedValue([
      githubRequest,
      orgToken,
      orgTokenAuth,
    ]);

    await expect(
      viewerReadsSameCredentials({
        uses: [githubRequest, orgToken, orgTokenAuth],
        viewer: VIEWER,
        appId: "analytics",
      }),
    ).resolves.toBe(true);
    expect(mocks.resolveProviderApiCredentialUses).toHaveBeenCalledWith(
      "github",
      { appId: "analytics" },
      {},
    );
  });

  it("refuses a viewer whose provider lookups would use their own connection", async () => {
    orgSecret();
    providerRuntime();
    mocks.resolveProviderApiCredentialUses.mockResolvedValue([
      githubRequest,
      {
        ...orgTokenAuth,
        key: "github",
        source: "workspace_connection",
        scope: "user",
        scopeId: VIEWER.userEmail,
        connectionId: "conn_1",
      },
    ]);

    await expect(
      viewerReadsSameCredentials({
        uses: [githubRequest, orgToken, orgTokenAuth],
        viewer: VIEWER,
        appId: "analytics",
      }),
    ).resolves.toBe(false);
  });

  it("refuses a viewer whose provider lookups read anything the shared run didn't", async () => {
    orgSecret();
    providerRuntime();
    mocks.resolveProviderApiCredentialUses.mockResolvedValue([
      githubRequest,
      orgTokenAuth,
      {
        ...orgTokenAuth,
        key: "GITHUB_ORG",
        scope: "user",
        scopeId: VIEWER.userEmail,
      },
    ]);

    await expect(
      viewerReadsSameCredentials({
        uses: [githubRequest, orgToken, orgTokenAuth],
        viewer: VIEWER,
        appId: "analytics",
      }),
    ).resolves.toBe(false);
  });

  it("checks every provider the shared run called, even one that read nothing", async () => {
    providerRuntime();
    mocks.resolveProviderApiCredentialUses.mockResolvedValue([
      { kind: "provider-request", provider: "posthog" },
      {
        ...orgTokenAuth,
        provider: "posthog",
        key: "POSTHOG_API_KEY",
        scope: "user",
        scopeId: VIEWER.userEmail,
      },
    ]);

    await expect(
      viewerReadsSameCredentials({
        uses: [{ kind: "provider-request", provider: "posthog" }],
        viewer: VIEWER,
        appId: "analytics",
      }),
    ).resolves.toBe(false);
  });

  it("serves a viewer whose replay of one provider lands on the org key another provider's lookup recorded", async () => {
    orgSecret();
    providerRuntime();
    const ga4Request: CredentialUse = {
      kind: "provider-request",
      provider: "ga4",
    };
    const serviceAccount: CredentialUse = {
      ...orgToken,
      key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    };
    const serviceAccountAuth: CredentialUse = {
      ...orgTokenAuth,
      provider: "gcloud",
      key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    };
    mocks.resolveProviderApiCredentialUses.mockResolvedValue([
      ga4Request,
      serviceAccountAuth,
    ]);

    await expect(
      viewerReadsSameCredentials({
        uses: [ga4Request, serviceAccount, serviceAccountAuth],
        viewer: VIEWER,
        appId: "analytics",
      }),
    ).resolves.toBe(true);
    expect(mocks.resolveProviderApiCredentialUses).toHaveBeenCalledTimes(1);
    expect(mocks.resolveProviderApiCredentialUses).toHaveBeenCalledWith(
      "ga4",
      { appId: "analytics" },
      {},
    );

    mocks.resolveProviderApiCredentialUses.mockResolvedValue([
      ga4Request,
      { ...serviceAccountAuth, scope: "user", scopeId: VIEWER.userEmail },
    ]);
    await expect(
      viewerReadsSameCredentials({
        uses: [ga4Request, serviceAccount, serviceAccountAuth],
        viewer: VIEWER,
        appId: "analytics",
      }),
    ).resolves.toBe(false);
  });

  it("gives up and refuses a viewer whose check outlasts its signal", async () => {
    orgSecret();
    providerRuntime();
    mocks.resolveProviderApiCredentialUses.mockReturnValue(
      new Promise(() => {}),
    );
    const signal = AbortSignal.timeout(20);

    await expect(
      viewerReadsSameCredentials({
        uses: [githubRequest, orgToken, orgTokenAuth],
        viewer: VIEWER,
        appId: "analytics",
        signal,
      }),
    ).resolves.toBe(false);
    expect(mocks.resolveProviderApiCredentialUses).toHaveBeenCalledWith(
      "github",
      { appId: "analytics" },
      { signal },
    );
  });

  it("refuses when a credential can't be read or the app has no provider runtime", async () => {
    mocks.resolveCredentialDetailed.mockRejectedValue(new Error("store down"));
    await expect(
      viewerReadsSameCredentials({
        uses: [orgToken],
        viewer: VIEWER,
        appId: "analytics",
      }),
    ).resolves.toBe(false);

    orgSecret();
    mocks.getRegisteredProviderApiRuntimeOptions.mockReturnValue(undefined);
    await expect(
      viewerReadsSameCredentials({
        uses: [githubRequest, orgToken, orgTokenAuth],
        viewer: VIEWER,
        appId: "analytics",
      }),
    ).resolves.toBe(false);

    providerRuntime();
    mocks.resolveProviderApiCredentialUses.mockRejectedValue(
      new Error("token endpoint down"),
    );
    await expect(
      viewerReadsSameCredentials({
        uses: [githubRequest, orgToken, orgTokenAuth],
        viewer: VIEWER,
        appId: "analytics",
      }),
    ).resolves.toBe(false);
  });
});

describe("viewerResolvesOnlyOrgCredentials", () => {
  function providerRuntime() {
    mocks.getRegisteredProviderApiRuntimeOptions.mockReturnValue({
      appId: "analytics",
    });
  }

  it("accepts a viewer whose credentials are all the org's now, even ones the shared run found unset", async () => {
    mocks.resolveCredentialDetailed.mockResolvedValue({
      value: "secret",
      scope: "org",
      scopeId: ORG,
    });

    await expect(
      viewerResolvesOnlyOrgCredentials({
        uses: [
          { kind: "stored", key: "GITHUB_TOKEN", scope: null, scopeId: null },
        ],
        viewer: VIEWER,
        appId: "analytics",
      }),
    ).resolves.toBe(true);
  });

  it("refuses a viewer with their own key", async () => {
    mocks.resolveCredentialDetailed.mockResolvedValue({
      value: "personal",
      scope: "user",
      scopeId: VIEWER.userEmail,
    });

    await expect(
      viewerResolvesOnlyOrgCredentials({
        uses: [orgToken],
        viewer: VIEWER,
        appId: "analytics",
      }),
    ).resolves.toBe(false);
  });

  it("checks provider lookups against the viewer's own stored credentials", async () => {
    mocks.resolveCredentialDetailed.mockResolvedValue({
      value: "secret",
      scope: "org",
      scopeId: ORG,
    });
    providerRuntime();
    mocks.resolveProviderApiCredentialUses.mockResolvedValue([
      githubRequest,
      orgTokenAuth,
    ]);
    const check = {
      uses: [githubRequest, orgToken, orgTokenAuth],
      viewer: VIEWER,
      appId: "analytics",
    };

    await expect(viewerResolvesOnlyOrgCredentials(check)).resolves.toBe(true);

    mocks.resolveProviderApiCredentialUses.mockResolvedValue([
      githubRequest,
      {
        ...orgTokenAuth,
        key: "github",
        source: "workspace_connection",
        scope: "user",
        scopeId: VIEWER.userEmail,
        connectionId: "conn_1",
      },
    ]);
    await expect(viewerResolvesOnlyOrgCredentials(check)).resolves.toBe(false);
  });
});
