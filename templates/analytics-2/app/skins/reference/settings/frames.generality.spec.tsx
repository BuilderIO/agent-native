// @vitest-environment happy-dom

import type {
  SettingsRowDefinition,
  SettingsSectionDefinition,
} from "@agent-native/toolkit/app/settings";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dataConnections } from "@/components/data/WorkspaceDataConnections.fixtures";
import {
  assetLabels,
  STATUSES,
} from "@/components/settings/AnalyticsAssetLabelsSettings.fixtures";
import {
  invitation,
  users,
} from "@/components/settings/AnalyticsUsersPage.fixtures";
import {
  roleRequest,
  roleRequests,
} from "@/components/settings/RoleRequests.fixtures";
import { LABEL_COLORS } from "@/lib/model/label-colors";
import { AppSettingsSections } from "@/skins/app-settings-sections";

import { PANEL_HOOKS, type PanelHook } from "../testing/all-panels.hooks";
import { resetAllPanels } from "../testing/all-panels.mocks";
import { click, mount, settle, type, type Mounted } from "../testing/mount";
import { partControl, rowControl, tagged } from "../testing/skins";

vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  ...(await import("../testing/all-panels.mocks")).allPanelsHooksMock,
}));
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  ...(await import("../testing/i18n")).i18nMock,
}));
vi.mock("@agent-native/core/client/org", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/org")>()),
  ...(await import("@/components/settings/AnalyticsUsersPage.fixtures"))
    .orgMock,
}));
vi.mock(
  "@agent-native/core/client/resources/use-resources",
  async (original) => ({
    ...(await original<
      typeof import("@agent-native/core/client/resources/use-resources")
    >()),
    ...(
      await import("@/components/settings/AnalyticsNotificationsPage.fixtures")
    ).resourcesMock,
  }),
);
vi.mock(
  "@/components/data/useDataConnectionActions",
  async () =>
    (await import("@/components/data/WorkspaceDataConnections.fixtures"))
      .dataConnectionActionsMock,
);
vi.mock("react-router", async (original) => ({
  ...(await original<typeof import("react-router")>()),
  useNavigate: () => dataConnections.navigate,
}));
vi.mock(
  "sonner",
  async () =>
    (await import("@/components/settings/AnalyticsUsersPage.fixtures"))
      .toastMock,
);

type Frame = PanelHook["frame"];

const writes = vi.fn();

function ExtraCustomRow({ tags }: { tags: Readonly<Record<string, string>> }) {
  return <output {...tags}>extra custom row</output>;
}

const EXTRA_COLLECTION = "settings.test.extra-collection";

/** One synthetic row of each kind a frame draws itself, shaped like the frame's own rows. */
function extraRow(frame: Frame, kind: string): SettingsRowDefinition {
  switch (kind) {
    case "toggle":
      return {
        id: "settings.test.extra-toggle",
        kind: "toggle",
        label: "Extra toggle",
        description: "A switch no panel has.",
        binding: { value: true, set: (value) => writes("toggle", value) },
      };
    case "action":
      return {
        id: "settings.test.extra-action",
        kind: "action",
        label: "Extra action",
        ...(frame === "stack"
          ? { description: "What the extra action is for." }
          : {}),
        action: {
          id: "run",
          label: "Extra action",
          ...(frame === "stack" ? { intent: "primary" as const } : {}),
          trigger: { kind: "invoke", run: () => writes("action") },
        },
      };
    case "textarea":
      return {
        id: "settings.test.extra-textarea",
        kind: "textarea",
        label: "Extra text",
        description: (
          <>
            What the extra text is for.{" "}
            <a className="underline" href="/extra">
              More
            </a>
          </>
        ),
        mode: "view",
        editLabel: "Edit",
        saveLabel: "Save",
        binding: {
          value: "Extra text, as saved.",
          set: (value) => writes("textarea", value),
        },
      };
    case "link":
      return {
        id: "settings.test.extra-link",
        kind: "link",
        label: "Extra link",
        href: "/extra",
      };
    case "info":
      return {
        id: "settings.test.extra-info",
        kind: "info",
        label: "Extra info",
        value: "An extra fact.",
      };
    case "custom":
      return {
        id: "settings.test.extra-custom",
        kind: "custom",
        label: "Extra custom",
        component: ExtraCustomRow,
        reason: "a synthetic slot for this spec",
      };
    default:
      return extraCollection(frame);
  }
}

/** A collection with what each frame's own collections have: a list, a table, or a catalogue with its form. */
function extraCollection(frame: Frame): SettingsRowDefinition {
  const keep = {
    id: "keep",
    label: "Keep",
    intent: "primary" as const,
    trigger: {
      kind: "invoke" as const,
      run: () => writes("keep", "extra-1"),
    },
  };
  const plainDrop = {
    id: "drop",
    label: "Drop",
    trigger: {
      kind: "invoke" as const,
      run: () => writes("drop", "extra-1"),
    },
  };
  const drop = { ...plainDrop, accessibleLabel: "Drop Extra item" };
  if (frame === "catalog") {
    return {
      id: EXTRA_COLLECTION,
      kind: "collection",
      label: "Extra collection",
      description: "A catalogue no panel has.",
      emptyLabel: "Nothing extra.",
      items: {
        status: "ready",
        value: [
          {
            key: "extra-1",
            title: "Extra item",
            leading: <span className="ws-label-dot" aria-hidden="true" />,
            actions: [drop],
          },
        ],
      },
      add: {
        kind: "fields",
        label: "New extra",
        submitLabel: "Add",
        fields: [
          { kind: "text", id: "name", label: "New extra", required: true },
          {
            kind: "color",
            id: "color",
            label: "Color",
            initialValue: LABEL_COLORS[1],
            options: LABEL_COLORS.map((color) => ({
              value: color,
              label: `Use ${color}`,
            })),
          },
        ],
        submit: (values) => writes("add", values.name, values.color),
      },
    };
  }
  if (frame === "panel") {
    return {
      id: EXTRA_COLLECTION,
      kind: "collection",
      label: "Extra collection",
      emptyLabel: "Nothing extra.",
      columns: [
        { id: "name", label: "Name", sort: "none" },
        { id: "kind", label: "Kind", sort: "descending" },
        { id: "owner", label: "Owner", sort: "none" },
      ],
      onSort: (column) => writes("sort", column),
      items: {
        status: "ready",
        value: [
          {
            key: "extra-1",
            title: "Extra item",
            badges: ["New"],
            cells: { kind: "Extra", owner: "Nobody" },
            actions: [keep, drop],
          },
        ],
      },
    };
  }
  return {
    id: EXTRA_COLLECTION,
    kind: "collection",
    label: "Extra collection",
    emptyLabel: "Nothing extra.",
    footer: "One extra item.",
    items: {
      status: "ready",
      value: [
        {
          key: "extra-1",
          title: "Extra item",
          description: "Its second line",
          actions: [keep, plainDrop],
        },
      ],
    },
  };
}

/** The kinds each frame has markup for; any other kind goes to the house renderer. */
const SUPPORTED: Record<Frame, readonly string[]> = {
  group: ["toggle", "action", "textarea", "custom"],
  stack: ["collection", "action", "info", "custom"],
  catalog: ["collection", "custom"],
  panel: ["collection", "action", "link", "custom"],
};

/** A real row of the same kind to compare each extra row with, and who has to be looking for it to show. */
const LIKE: Record<
  Frame,
  Record<
    string,
    { row: string; viewer?: "admin" | "member"; prepare?: () => void }
  >
> = {
  group: {
    toggle: { row: "settings.notifications.desktop-notifications" },
    action: { row: "settings.general.workspace-name" },
    textarea: { row: "settings.preferences.personal-preferences" },
  },
  stack: {
    collection: { row: "settings.users.role-requests" },
    action: {
      row: "settings.profile.request-admin-access",
      viewer: "member",
      // With a request pending the real row has one more line, saying so.
      prepare: () => {
        roleRequests.requests = [];
      },
    },
    info: { row: "settings.profile.workspace-access", viewer: "admin" },
  },
  catalog: {
    collection: { row: "settings.asset-statuses.statuses", viewer: "admin" },
  },
  panel: {
    collection: { row: "settings.data-sources.connections" },
    link: { row: "settings.data-sources.data-browser" },
  },
};

/**
 * Every real section a frame draws, with its rows in reverse order, and the
 * extra rows appended to the last section.
 */
function Reordered({
  frame,
  extras,
}: {
  frame: Frame;
  extras: readonly SettingsRowDefinition[];
}) {
  // The list of hooks is fixed, so they run in the same order on every render.
  const sections: SettingsSectionDefinition[] = PANEL_HOOKS.filter(
    (hook) => hook.frame === frame,
  ).flatMap((hook) => hook.useSections());
  const changed = sections.map((section, index) => ({
    ...section,
    rows: [
      ...[...section.rows].reverse(),
      ...(index === sections.length - 1 ? extras : []),
    ],
  }));
  return <AppSettingsSections sections={changed} hints={{ frame }} />;
}

/** Element names and class lists, without text, ids or other attributes. */
function shape(element: Element): string {
  const classes = [...element.classList].sort().join(".");
  const children = [...element.children].map(shape);
  return (
    element.tagName.toLowerCase() +
    (classes ? `.${classes}` : "") +
    (children.length > 0 ? `(${children.join(",")})` : "")
  );
}

/** A row's shape with one item standing for all of them, since the number of items is data. */
function rowShape(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  const items = copy.querySelectorAll('[data-part="settings.collection.item"]');
  [...items].slice(1).forEach((item) => item.remove());
  return shape(copy);
}

/** The element a row is drawn as: its row element, or its control where the frame draws the control alone. */
function rowElement(root: ParentNode, rid: string): Element {
  const found =
    root.querySelector(`[data-rid="${rid}"][data-part="settings.row"]`) ??
    root.querySelector(`[data-rid="${rid}"][data-part="settings.row.control"]`);
  if (!found) throw new Error(`row ${rid} is not drawn`);
  return found;
}

function arrange() {
  resetAllPanels();
  writes.mockReset();
  assetLabels.statuses = STATUSES.slice(0, 1);
  users.invitations = [invitation("invite-1", "invited@example.test")];
  roleRequests.requests = [
    roleRequest("role-request-1", "ada@example.test"),
    roleRequest("role-request-3", "old@example.test", "approved"),
  ];
}

describe("reference frames are written against row kinds", () => {
  let mounted: Mounted | undefined;

  beforeEach(arrange);
  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = "";
  });

  const show = (frame: Frame, kinds: readonly string[] = SUPPORTED[frame]) => {
    mounted = mount(
      <QueryClientProvider client={new QueryClient()}>
        <Reordered
          frame={frame}
          extras={kinds.map((kind) => extraRow(frame, kind))}
        />
      </QueryClientProvider>,
    );
    return mounted.container;
  };

  describe.each(Object.keys(SUPPORTED) as Frame[])("the %s frame", (frame) => {
    it("draws no row with the house renderer", () => {
      const container = show(frame);
      expect(container.querySelector('[data-skin="house"]')).toBeNull();
    });

    it.each(Object.entries(LIKE[frame]))(
      "draws an extra %s row with the markup of a real one",
      (kind, like) => {
        // The shell answers one question for both panels that ask who is looking.
        assetLabels.isAdmin = like.viewer !== "member";
        like.prepare?.();
        const container = show(frame);
        const extra = rowElement(container, `settings.test.extra-${kind}`);
        const model = rowElement(container, like.row);
        expect(rowShape(extra)).toBe(rowShape(model));
      },
    );

    it("mounts an extra custom row with its tags on the slot's own root", () => {
      const container = show(frame);
      const slot = tagged(
        container,
        "settings.test.extra-custom",
        "settings.custom-row",
      );
      expect(slot.tagName).toBe("OUTPUT");
      expect(slot.textContent).toBe("extra custom row");
    });

    it("hands a kind it has no markup for to the house renderer", () => {
      const unsupported = ["toggle", "link", "info", "collection"].find(
        (kind) => !SUPPORTED[frame].includes(kind),
      )!;
      const container = show(frame, [unsupported]);
      const row = tagged(
        container,
        `settings.test.extra-${unsupported}`,
        "settings.row",
      );
      expect(row.closest('[data-skin="house"]')).not.toBeNull();
    });
  });

  const drawn = (container: ParentNode) => [
    ...new Set(
      [
        ...container.querySelectorAll(
          '[data-part="settings.row"], [data-part="settings.row.control"], [data-part="settings.custom-row"]',
        ),
      ].map((element) => element.getAttribute("data-rid")),
    ),
  ];

  it("group: rows keep working in reverse order, and the extra rows write", async () => {
    const container = show("group");
    expect(drawn(container)).toEqual([
      "settings.preferences.personal-preferences",
      "settings.notifications.desktop-notifications",
      "settings.general.workspace-name",
      "settings.test.extra-toggle",
      "settings.test.extra-action",
      "settings.test.extra-textarea",
      "settings.test.extra-custom",
    ]);
    // A view row with no editing state of its model's keeps its own.
    click(rowControl(container, "settings.test.extra-textarea"));
    type(
      rowControl(
        container,
        "settings.test.extra-textarea",
      ) as HTMLTextAreaElement,
      "Extra text, edited.",
    );
    click(
      partControl(
        container,
        "settings.test.extra-textarea.save",
        "settings.row.action",
      ),
    );
    await settle();
    expect(writes).toHaveBeenLastCalledWith("textarea", "Extra text, edited.");
    click(rowControl(container, "settings.test.extra-toggle"));
    expect(writes).toHaveBeenLastCalledWith("toggle", false);
    click(rowControl(container, "settings.test.extra-action"));
    await settle();
    expect(writes).toHaveBeenLastCalledWith("action");
    click(rowControl(container, "settings.general.workspace-name"));
    await settle();
    tagged(
      document,
      "settings.general.workspace-name.dialog",
      "settings.dialog",
    );
  });

  it("stack: rows are drawn in the order given, and the extra rows run", async () => {
    assetLabels.isAdmin = false;
    const container = show("stack");
    expect(drawn(container)).toEqual([
      "settings.profile.request-admin-access",
      "settings.users.role-requests",
      "settings.users.invite-links",
      EXTRA_COLLECTION,
      "settings.test.extra-action",
      "settings.test.extra-info",
      "settings.test.extra-custom",
    ]);
    click(
      partControl(
        container,
        `${EXTRA_COLLECTION}.item.drop`,
        "settings.collection.action",
        "extra-1",
      ),
    );
    await settle();
    expect(writes).toHaveBeenLastCalledWith("drop", "extra-1");
    click(rowControl(container, "settings.test.extra-action"));
    await settle();
    expect(writes).toHaveBeenLastCalledWith("action");
  });

  it("catalog: an extra catalogue lists, removes and adds through its own form", async () => {
    const container = show("catalog");
    expect(drawn(container)).toEqual([
      "settings.asset-statuses.statuses",
      EXTRA_COLLECTION,
      "settings.test.extra-custom",
    ]);
    const drop = partControl(
      container,
      `${EXTRA_COLLECTION}.item.drop`,
      "settings.collection.action",
      "extra-1",
    );
    expect(drop.getAttribute("aria-label")).toBe("Drop Extra item");
    click(drop);
    await settle();
    expect(writes).toHaveBeenLastCalledWith("drop", "extra-1");
    const name = partControl(
      container,
      `${EXTRA_COLLECTION}.add.name`,
      "settings.collection.field",
    ) as HTMLInputElement;
    type(name, "Another");
    click(
      partControl(
        container,
        `${EXTRA_COLLECTION}.add.submit`,
        "settings.dialog.action",
      ),
    );
    await settle();
    // The color field starts on the value its definition gives it.
    expect(writes).toHaveBeenLastCalledWith("add", "Another", LABEL_COLORS[1]);
  });

  it("panel: placement follows the hint, not the order, and an extra table sorts and runs its actions", async () => {
    const container = show("panel");
    const add = partControl(
      container,
      "settings.data-sources.connections.add",
      "settings.collection.add",
    );
    const browser = rowControl(container, "settings.data-sources.data-browser");
    expect(add.parentElement?.tagName).toBe("HEADER");
    expect(browser.parentElement?.tagName).toBe("FOOTER");
    const extraAction = rowControl(container, "settings.test.extra-action");
    const extraLink = rowControl(container, "settings.test.extra-link");
    expect(extraAction.parentElement?.tagName).toBe("SECTION");
    expect(extraLink.parentElement?.tagName).toBe("SECTION");
    click(extraAction);
    await settle();
    expect(writes).toHaveBeenLastCalledWith("action");
    click(extraLink);
    expect(dataConnections.navigate).toHaveBeenLastCalledWith("/extra");
    click(
      partControl(
        container,
        `${EXTRA_COLLECTION}.sort.kind`,
        "settings.collection.sort",
      ),
    );
    expect(writes).toHaveBeenLastCalledWith("sort", "kind");
    click(
      partControl(
        container,
        `${EXTRA_COLLECTION}.item.options`,
        "settings.collection.action",
        "extra-1",
      ),
    );
    click(
      partControl(
        container,
        `${EXTRA_COLLECTION}.item.keep`,
        "settings.collection.action",
        "extra-1",
      ),
    );
    await settle();
    expect(writes).toHaveBeenLastCalledWith("keep", "extra-1");
  });
});
