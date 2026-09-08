import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureEmbedAuthFetchInterceptor = vi.hoisted(() => vi.fn());
const installRouteChunkRecovery = vi.hoisted(() => vi.fn());

vi.mock("./embed-auth.js", () => ({ ensureEmbedAuthFetchInterceptor }));
vi.mock("./route-chunk-recovery.js", () => ({ installRouteChunkRecovery }));

import { appBasePath } from "./api-path.js";
import { initializeAgentNativeClient } from "./client-bootstrap.js";

describe("client bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("installs shared client runtime safeguards", () => {
    initializeAgentNativeClient();

    expect(ensureEmbedAuthFetchInterceptor).toHaveBeenCalledOnce();
    expect(installRouteChunkRecovery).toHaveBeenCalledOnce();
  });

  it("runs from the appBasePath bootstrap used by every client entry", () => {
    appBasePath();

    expect(ensureEmbedAuthFetchInterceptor).toHaveBeenCalledOnce();
    expect(installRouteChunkRecovery).toHaveBeenCalledOnce();
  });
});
