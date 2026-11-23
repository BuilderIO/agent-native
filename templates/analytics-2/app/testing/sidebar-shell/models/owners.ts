import type {
  ShellContentOwner,
  ShellModel,
  ShellRegion,
} from "@agent-native/toolkit/app-shell/sidebar-shell";

import { resolveRoute } from "../../../routes/routing/registry";

export const publishedFixture = {
  name: "frame-app-project-a-latest",
  path: "/app/project-a/latest",
};
export const creationFixtures = [
  {
    name: "new-project-dialog",
    key: "new-project",
    row: "shell.create.new-project",
  },
  {
    name: "new-project-error",
    key: "new-project",
    row: "shell.create.new-project",
  },
  {
    name: "new-project-pending-true",
    key: "new-project",
    row: "shell.create.new-project",
  },
  {
    name: "new-project-pending-false",
    key: "new-project",
    row: "shell.create.new-project",
  },
  {
    name: "import-project-empty",
    key: "import-project",
    row: "shell.create.import-project",
  },
  {
    name: "import-parse-error",
    key: "import-project",
    row: "shell.create.import-project",
  },
  {
    name: "import-selected",
    key: "import-project",
    row: "shell.create.import-project",
  },
  {
    name: "import-pending",
    key: "import-project",
    row: "shell.create.import-project",
  },
  {
    name: "import-failed",
    key: "import-project",
    row: "shell.create.import-project",
  },
] as const;

export function creationRegion(
  fixture: (typeof creationFixtures)[number],
): ShellRegion {
  return {
    id: fixture.row,
    part: "app-shell",
    subPart: "app-shell.overlays",
    containerId: "project-dialogs",
    order: 0,
    content: {
      owner: "custom",
      key: fixture.key,
      reason:
        "Project form fields, validation and submission stay with the owning dialog.",
    },
  };
}

export function publishedModel(): ShellModel {
  const content: ShellContentOwner = {
    owner: "page",
    key: "published-project",
  };
  return {
    frame: {
      key: resolveRoute(publishedFixture.path).frame,
      routeRuleId: "resolved-route-frame",
    },
    navigation: {
      entries: [],
      sections: [],
      presentation: {
        collapsed: { value: false },
        mobileOpen: { value: false },
        peekOpen: false,
        profile: "none",
        themeFamily: "original",
        visibility: "hidden",
        width: 0,
      },
    },
    regions: [
      {
        id: "shell.frame",
        part: "app-shell",
        subPart: "app-shell.main",
        containerId: "published-page",
        order: 0,
        content,
      },
    ],
    effects: [],
    shortcuts: [],
    preferences: [],
  };
}
