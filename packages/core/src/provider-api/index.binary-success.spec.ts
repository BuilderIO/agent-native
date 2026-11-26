import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createProviderApiRequestAction } from "./actions/provider-api.js";
import { createProviderApiRuntime } from "./index.js";
import { resetProviderQuotaStateForTests } from "./quota-governor.js";

const writeWorkspaceFile = vi.hoisted(() => vi.fn());

vi.mock("../extensions/url-safety.js", () => ({
  createSsrfSafeDispatcher: async () => ({ dispatch: vi.fn() }),
  isBlockedExtensionUrlWithDns: async () => false,
}));

vi.mock("../workspace-files/store.js", () => ({
  SAVE_TO_FILE_MAX_BYTES: 20 * 1024 * 1024,
  isScratchWorkspacePath: (path: string) => path.startsWith("scratch/"),
  toWorkspaceFileCard: (meta: unknown) => ({ meta }),
  writeWorkspaceFile,
}));

beforeEach(() => {
  resetProviderQuotaStateForTests();
  vi.stubEnv("AGENT_NATIVE_PROVIDER_API_PERSIST_COOLDOWNS", "0");
  writeWorkspaceFile.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it.each(
  [false, true].flatMap((paginated) => [
    {
      paginated,
      status: 200,
      type: "application/zip",
      body: new TextEncoder().encode("synthetic-binary-payload"),
    },
    {
      paginated,
      status: 201,
      type: "text/plain",
      body: new Uint8Array([0xff, 0x00]),
    },
  ]),
)(
  "rejects invalid HTTP $status provider saves with a typed error (paginated: $paginated)",
  async ({ paginated, status, type, body }) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(body, { status, headers: { "content-type": type } }),
    );
    const runtime = createProviderApiRuntime({
      appId: "test-app",
      providerIds: ["hubspot"],
      getCredentialContext: () => ({
        userEmail: "ada@example.com",
        orgId: "org-1",
      }),
    });
    const result = createProviderApiRequestAction(runtime).run({
      provider: "hubspot",
      path: "/records",
      auth: "none",
      saveToFile: "scratch/response.txt",
      ...(paginated
        ? { fetchAllPages: { cursorPath: "next", cursorParam: "cursor" } }
        : {}),
    });
    await expect(result).rejects.toMatchObject({
      name: "ActionContractError",
      errorCode: "provider_response_invalid",
      statusCode: 502,
      message: expect.stringContaining(`HTTP ${status}`),
    });
    const error = await result.catch((caught: unknown) => caught);
    expect(String(error)).not.toContain("synthetic-");
    expect(JSON.stringify(error)).not.toContain("synthetic-");
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
  },
);
