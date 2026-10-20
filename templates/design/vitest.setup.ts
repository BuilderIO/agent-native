import { vi } from "vitest";

// Canvas unit tests don't mount the app's QueryClientProvider. Keep those
// tests independent of approval loading; the hook has focused coverage itself.
vi.mock("@/components/design/use-native-shader-approvals", () => {
  const sync = () => {};
  return { useNativeShaderApprovals: () => sync };
});
