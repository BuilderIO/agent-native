import { describe, expect, it } from "vitest";

import { designNativeTextureAssets } from "./schema";

describe("native texture metadata raw-DB scope", () => {
  it("has Design-owner and organization columns while binary reads use live Design access", () => {
    expect(designNativeTextureAssets.ownerEmail.name).toBe("owner_email");
    expect(designNativeTextureAssets.orgId.name).toBe("org_id");
    expect(designNativeTextureAssets.visibility.name).toBe("visibility");
    expect(designNativeTextureAssets.providerUrl.name).toBe("provider_url");
  });
});
