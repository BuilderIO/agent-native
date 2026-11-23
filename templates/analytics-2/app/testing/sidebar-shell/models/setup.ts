import type {
  NavigationEntry,
  ShellModel,
} from "@agent-native/toolkit/app-shell/sidebar-shell";

import type contextSetupAction from "../../../../actions/get-workspace-context-setup";

export type ContextSetupState = Awaited<
  ReturnType<typeof contextSetupAction.run>
>;
type ContextSetupStepKey = ContextSetupState["completedSteps"][number];
const steps: readonly [ContextSetupStepKey, string, string][] = [
  ["connect", "Connect", "database"],
  ["endorse", "Endorse", "certificate"],
  ["improve", "Improve", "book"],
  ["reference", "Reference", "branch"],
  ["extend", "Extend", "plug"],
  ["govern", "Govern", "sitemap"],
];
export const setupFixtures = Array.from({ length: 7 }, (_, count) => ({
  name: `setup-${count}`,
  state: {
    progressPercent: (count * 100) / 6,
    completedSteps: steps.slice(0, count).map(([key]) => key),
  } satisfies ContextSetupState,
}));

export function setupModel(
  state: ContextSetupState,
  onNavigate: () => void = () => {},
): ShellModel {
  const completed = new Set(state.completedSteps);
  const firstIncomplete = steps.find(([key]) => !completed.has(key))?.[0];
  const entry = (
    id: string,
    containerId: string,
    order: number,
    label: string,
    key: string,
  ): NavigationEntry => ({
    id,
    part: "sidebar",
    subPart: "sidebar.item",
    containerId,
    order,
    kind: "destination",
    label,
    icon: { kind: "symbol", key },
    effect: { kind: "navigate", to: "/context-studio/setup" },
    trailingActions: [
      {
        id: "shell.nav.close",
        part: "app-shell",
        subPart: "app-shell.nav",
        containerId: "setup-navigation",
        order: 0,
        kind: "action",
        effect: { kind: "action", effectId: "close-navigation" },
      },
    ],
  });
  return {
    frame: { key: "home", routeRuleId: "setup-children" },
    navigation: {
      entries: [
        entry(
          "sidebar.nav.context",
          "context-setup-header",
          0,
          "Context Studio",
          "stack",
        ),
        ...steps.map(
          ([key, label, icon], order): NavigationEntry => ({
            ...entry(
              `sidebar.context-setup.${key}`,
              "context-setup-steps",
              order,
              label,
              icon,
            ),
            metadata: {
              completed: completed.has(key),
              current: key === firstIncomplete,
            },
          }),
        ),
      ],
      sections: [],
      presentation: {
        collapsed: { value: false },
        mobileOpen: { value: true },
        peekOpen: false,
        profile: "setup-children",
        themeFamily: "original",
        visibility: "visible",
        width: 265,
      },
    },
    regions: [
      {
        id: "sidebar.context-setup",
        part: "sidebar",
        subPart: "sidebar.slot",
        containerId: "sidebar-primary",
        order: 2,
        content: {
          owner: "custom",
          key: "context-setup",
          reason:
            "Setup card progress illustration and checklist container remain app-owned.",
        },
      },
    ],
    effects: [
      {
        id: "close-navigation",
        kind: "action",
        actionName: "close-navigation",
        run: onNavigate,
      },
    ],
    shortcuts: [],
    preferences: [],
  };
}
