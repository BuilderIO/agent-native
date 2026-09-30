// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headerActions: { current: null as unknown },
  designSystems: { current: [] as never[] },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
  useActionMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app-shell", () => ({
  useSetHeaderActions: (actions: unknown) => {
    mocks.headerActions.current = actions;
  },
  useSetPageTitle: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/design-system/DesignSystemCard", () => ({
  DesignSystemCard: () => null,
}));
vi.mock("@/components/design-system/DesignSystemSetup", () => ({
  DesignSystemSetup: () => null,
}));
vi.mock("@/hooks/use-design-system-workflows", () => ({
  useDesignSystemWorkflows: () => true,
}));
vi.mock("@/hooks/use-design-systems", () => ({
  useDesignSystems: () => ({
    designSystems: mocks.designSystems.current,
    isLoading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-workspace-defaults", () => ({
  useWorkspaceDefaults: () => ({
    designSystem: null,
    canManage: false,
    refetch: vi.fn(),
  }),
}));

import DesignSystems from "./DesignSystems";

describe("Design Systems empty state", () => {
  beforeEach(() => {
    mocks.headerActions.current = null;
    mocks.designSystems.current = [];
  });

  afterEach(() => cleanup());

  it("keeps one create action when workflows are enabled and no systems exist", () => {
    render(<DesignSystems />);

    expect(mocks.headerActions.current).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "designSystems.new" }),
    ).toHaveLength(1);
  });
});
