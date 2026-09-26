import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAppApiPath = vi.hoisted(() =>
  vi.fn((path: string) => `/clips${path}`),
);

vi.mock("@agent-native/core/client/api-path", () => ({
  appApiPath: (...args: [string]) => mockAppApiPath(...args),
}));

import { organizationLogoUrl } from "./organization-logo.js";

beforeEach(() => {
  mockAppApiPath.mockClear();
});

describe("organizationLogoUrl", () => {
  it("routes opaque handles and legacy S3 keys through Clips", () => {
    expect(organizationLogoUrl("clips-org-logo:v1:opaque", "org 1")).toBe(
      "/clips/api/media/organization-logo/org%201",
    );
    expect(
      organizationLogoUrl(
        "https://old-storage.example/clips/logo-abc123/1722720000000-abcd1234.png",
        "org 1",
      ),
    ).toBe("/clips/api/media/organization-logo/org%201");
    expect(mockAppApiPath).toHaveBeenCalledTimes(2);
  });

  it("preserves already-public legacy URLs and missing values", () => {
    expect(organizationLogoUrl("https://cdn.example/image.png", "org-1")).toBe(
      "https://cdn.example/image.png",
    );
    expect(organizationLogoUrl("  ", "org-1")).toBeNull();
    expect(mockAppApiPath).not.toHaveBeenCalled();
  });
});
