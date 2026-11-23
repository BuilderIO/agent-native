// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import { init, dispose, mount, capture } from "./harness";
const m = vi.hoisted(() => ({ error: undefined as unknown }));
vi.mock("react-router", async (original) => ({
  ...(await original<typeof import("react-router")>()),
  useRouteError: () => m.error,
}));
vi.mock("@agent-native/core/client/analytics", () => ({
  configureTracking: () => {},
}));
vi.mock("../../components/onboarding/AnalyticsFirstRun", () => ({
  AnalyticsFirstRun: () => null,
}));
vi.mock("../../components/ui/toolkit-provider", () => ({
  AppToolkitProvider: () => null,
}));
vi.mock("../../components/workspace/WorkspaceApplication", () => ({
  WorkspaceApplication: () => null,
}));
vi.mock("../../hooks/use-navigation-state", () => ({
  useNavigationState: () => {},
}));
import { ErrorBoundary } from "../../root";
afterEach(dispose);
it.each(["404", "503", "generic", "development"])(
  "freezes route error %s with recovery",
  async (kind) => {
    init();
    m.error =
      kind === "404"
        ? { status: 404, statusText: "Not Found", data: "", internal: false }
        : kind === "503"
          ? {
              status: 503,
              statusText: "Synthetic unavailable",
              data: "",
              internal: false,
            }
          : kind === "generic"
            ? "failure"
            : Object.assign(new Error("Synthetic runtime error"), {
                stack: "Error: Synthetic runtime error\n    at synthetic-frame",
              });
    await mount(<ErrorBoundary />, "/missing");
    capture(`error-${kind}`, ["shell.error"], {
      kind,
      host: "ErrorBoundary",
      providers: "not mounted",
    });
    expect(document.querySelector('a[href="/home"]')?.textContent).toBe(
      "Go home",
    );
    expect(document.querySelector(".ws-sidebar")).toBeNull();
  },
);
