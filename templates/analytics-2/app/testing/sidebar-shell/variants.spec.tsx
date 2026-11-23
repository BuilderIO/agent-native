// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { ImportProjectDialog } from "../../components/projects/ImportProjectDialog";
import { NewProjectDialog } from "../../components/projects/NewProjectDialog";
import { WorkspaceShell } from "../../components/shell/WorkspaceShell";
import { resolveRoutePage } from "../../components/workspace/pages";
import { resolveRoute } from "../../routes/routing/registry";
import {
  shellProps,
  workspaceRows,
  workspaceMenuRows,
  accountRows,
  themeRows,
  moreRows,
} from "./fixtures";
import {
  init,
  dispose,
  mount,
  capture,
  button,
  click,
  key,
  input,
  settle,
} from "./harness";
afterEach(dispose);
it.each([1, 2, 3])(
  "captures workspace count %i, current selection closes, search threshold and logout label",
  async (count) => {
    init();
    const p = shellProps();
    const workspaces = p.workspaceMenu?.workspaces;
    if (!workspaces) throw new Error("Missing fixture workspaces");
    p.workspaceMenu = {
      workspaces: workspaces.slice(0, count),
    };
    await mount(<WorkspaceShell {...p} />);
    await click(
      button(
        "Test workspace",
        document.querySelector(".ws-sidebar") as HTMLElement,
      ),
    );
    capture(`workspace-count-${count}`, workspaceMenuRows, {
      count,
      handlers: "absent",
    });
    expect(document.querySelector(".ws-workspace-search")).toBeNull();
    await click(
      document.querySelector(".ws-workspace-row.is-active") as HTMLElement,
    );
    expect(document.querySelector(".ws-popover")).toBeNull();
  },
);
it.each(["email", "empty", "image"])(
  "captures existing user avatar/name %s",
  async (variant) => {
    init();
    const p = shellProps();
    p.user = {
      id: "person-a",
      name: variant === "image" ? "Test Person" : "",
      email: variant === "empty" ? "" : "person@example.test",
      ...(variant === "image" ? { avatarUrl: "/fixture-avatar.svg" } : {}),
    };
    await mount(<WorkspaceShell {...p} />);
    capture(
      `account-identity-${variant}`,
      ["sidebar.footer", "sidebar.account.open"],
      { variant, user: p.user },
    );
  },
);
it.each(["light", "dark", "system"])(
  "captures all menu surfaces in mobile theme %s",
  async (theme) => {
    init({ width: 700, dark: theme === "system", storage: { theme } });
    await mount(<WorkspaceShell {...shellProps()} />);
    await click(button("Open navigation"));
    for (const [label, id, rows] of [
      ["Test Person account menu", "account", accountRows],
      ["More", "more", moreRows],
      [
        "Create new",
        "create",
        [
          "sidebar.create.menu.project",
          "sidebar.create.menu.thread",
          "sidebar.create.menu.upload-project",
        ],
      ],
    ] as const) {
      await click(button(label));
      if (id === "account") await click(button("Theme"));
      capture(
        `mobile-${theme}-${id}`,
        [...workspaceRows, ...rows, ...(id === "account" ? themeRows : [])],
        { width: 700, theme, systemDark: theme === "system", menu: id },
      );
      await key(document.querySelector(".ws-popover") as HTMLElement, "Escape");
    }
  },
);
it.each([false, true])(
  "freezes new project pending=%s including trim and Escape behavior",
  async (pending) => {
    init();
    const create = vi.fn(),
      cancel = vi.fn();
    await mount(
      <NewProjectDialog
        pending={pending}
        error={pending ? null : "Synthetic form error"}
        onCreate={create}
        onCancel={cancel}
      />,
    );
    capture(`new-project-pending-${pending}`, ["shell.create.new-project"], {
      pending,
      error: pending ? null : "Synthetic form error",
      host: "NewProjectDialog",
    });
    const form = document.querySelector("form") as HTMLElement;
    if (!pending) {
      await input(
        document.querySelector("input") as HTMLInputElement,
        "  Test title  ",
      );
      await input(
        document.querySelector("textarea") as HTMLTextAreaElement,
        "  Test description  ",
      );
    }
    await act(async () =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(create.mock.calls).toEqual(
      pending
        ? []
        : [[{ title: "Test title", description: "Test description" }]],
    );
    await key(document.body, "Escape");
    expect(cancel).toHaveBeenCalledTimes(1);
  },
);
it("captures file parse failure, selected notebook, pending import and failed import without a service", async () => {
  init();
  let rejectImport: ((error: Error) => void) | undefined;
  const onImport = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectImport = reject;
      }),
  );
  await mount(<ImportProjectDialog onClose={() => {}} onImport={onImport} />);
  const file = document.querySelector('input[type="file"]') as HTMLInputElement;
  async function pick(name: string, contents: string) {
    const value = new File([contents], name, { type: "application/json" });
    Object.defineProperty(file, "files", {
      configurable: true,
      value: [value],
    });
    await act(async () =>
      file.dispatchEvent(new Event("change", { bubbles: true })),
    );
    await settle();
  }
  await pick("invalid.ipynb", "not json");
  capture("import-parse-error", ["shell.create.import-project"], {
    file: "invalid.ipynb",
    result: "parse-error",
  });
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  await pick(
    "test.ipynb",
    JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
      cells: [
        { cell_type: "markdown", source: ["# Test notebook"], metadata: {} },
      ],
    }),
  );
  capture("import-selected", ["shell.create.import-project"], {
    file: "test.ipynb",
    cells: 1,
  });
  expect(button("Import").disabled).toBe(false);
  await click(button("Import"));
  capture("import-pending", ["shell.create.import-project"], { pending: true });
  expect(button("Import").disabled).toBe(true);
  await act(async () => rejectImport?.(new Error("Synthetic import failure")));
  await settle();
  capture("import-failed", ["shell.create.import-project"], {
    pending: false,
    error: "Synthetic import failure",
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Synthetic import failure",
  );
});
it("records advertised targets separately from successful routing and no active state on entity rows", async () => {
  init();
  await mount(<WorkspaceShell {...shellProps()} />);
  await click(button("More"));
  const links = [
    ...document.querySelectorAll<HTMLAnchorElement>("a[href]"),
  ].map((a) => ({
    href: a.getAttribute("href") as string,
    class: a.className,
    current: a.getAttribute("aria-current"),
  }));
  const destinations = links.map((a) => {
    const route = resolveRoute(a.href, {
      authenticated: true,
      isAdmin: true,
      foldersEnabled: true,
      tasksEnabled: true,
      development: true,
    });
    return {
      ...a,
      frame: route.frame,
      routeId: route.id,
      pageRegistered: !!resolveRoutePage(route),
    };
  });
  capture(
    "advertised-targets",
    [...workspaceRows, ...moreRows],
    { routingFlags: "all enabled" },
    { destinations },
  );
  expect(
    document.querySelectorAll(
      ".ws-section-row[aria-current],.ws-section-row.is-active",
    ),
  ).toHaveLength(0);
});
// oracle-change: shortcut guard assertions moved to the application-mounted frames spec with the listener.
