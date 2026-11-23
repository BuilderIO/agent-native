// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";

import { AgentNativeI18nProvider, useT } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}));

import enUS from "@/i18n/en-US";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: { ownerEmail: "owner@example.test", shares: [] },
  }),
}));

// oracle-change: Toolkit ShareButton.spec.tsx now owns owner, grant and copy behavior.
const dialog = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/toolkit/app/sharing", () => ({
  ShareButton: (props: unknown) => {
    dialog(props);
    return <div role="dialog">Share</div>;
  },
}));

import { ProjectCopyLink, ProjectSharePopover } from "./ProjectSharePopover";

it("report 599 opens the shared management dialog for the registered project", () => {
  const close = vi.fn();
  renderToStaticMarkup(
    <ProjectSharePopover projectId="prj_1" onClose={close} />,
  );
  expect(dialog).toHaveBeenCalledWith(
    expect.objectContaining({
      defaultOpen: true,
      hideTrigger: true,
      autoFocusInvite: true,
      allowedRoles: ["viewer", "editor", "admin"],
      resourceType: "analytics-project",
      resourceId: "prj_1",
    }),
  );
  const props = dialog.mock.calls[0]?.[0] as {
    onOpenChange: (open: boolean) => void;
  };
  props.onOpenChange(false);
  expect(close).toHaveBeenCalledOnce();
});

it("copies the published app by default and the project from the link options", async () => {
  const copy = vi.fn(async () => {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const clipboard = vi.spyOn(navigator, "clipboard", "get").mockReturnValue({
    writeText: copy,
  } as unknown as Clipboard);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <ProjectCopyLink projectId="prj_1" fromApp />
        </AgentNativeI18nProvider>,
      ),
    );
    const [button, options] = host.querySelectorAll("button");
    await act(async () => button?.click());
    expect(copy.mock.calls.at(0)).toEqual([
      new URL("/app/prj_1/latest", location.origin).href,
    ]);
    await act(async () =>
      options?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    const project = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((el) => el.textContent === "Copy link to entire project");
    expect(project).toBeDefined();
    await act(async () => project?.click());
    expect(copy.mock.calls.at(1)).toEqual([
      new URL("/project/prj_1/latest", location.origin).href,
    ]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    clipboard.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("titles the share panel, stages invites and names roles and general access like the reference app", () => {
  dialog.mockClear();
  renderToStaticMarkup(
    <AgentNativeI18nProvider
      catalog={{ messages: enUS }}
      persistPreference={false}
    >
      <ProjectSharePopover projectId="prj_2" title="Revenue" />
    </AgentNativeI18nProvider>,
  );
  expect(dialog).toHaveBeenCalledWith(
    expect.objectContaining({
      panelTitle: "Share Revenue",
      stagedInvites: true,
      invitePlaceholder: "Users...",
      visibilityCopy: { private: { label: "Invite only" } },
      roleCopy: {
        viewer: expect.objectContaining({ label: "Can explore" }),
        editor: expect.objectContaining({ label: "Can edit" }),
        admin: expect.objectContaining({ label: "Full access" }),
      },
    }),
  );
});

it("confirms Copy link in the panel with a project-link toast", () => {
  dialog.mockClear();
  toastSuccess.mockClear();
  renderToStaticMarkup(
    <AgentNativeI18nProvider
      catalog={{ messages: enUS }}
      persistPreference={false}
    >
      <ProjectSharePopover projectId="prj_3" title="Revenue" />
    </AgentNativeI18nProvider>,
  );
  const props = dialog.mock.calls[0]?.[0] as { onLinkCopied: () => void };
  props.onLinkCopied();
  expect(toastSuccess).toHaveBeenCalledWith(
    "Link to project copied to clipboard.",
  );
});

it("says No results when the invite suggestions are empty", () => {
  function Probe() {
    const t = useT();
    return <span>{t("agentChat.share.noMatches")}</span>;
  }
  expect(
    renderToStaticMarkup(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <Probe />
      </AgentNativeI18nProvider>,
    ),
  ).toContain("No results");
});

it("A2-SHARE-GENERAL-ACCESS-BLOCKED includes toolkit source in global.css to compile suggestion listbox geometry", () => {
  const css = fs.readFileSync(
    path.resolve(__dirname, "../../global.css"),
    "utf8",
  );
  expect(css).toContain(
    '@source "../node_modules/@agent-native/toolkit/dist";',
  );
});

it("row 440 provides the embedding options footer section inside the project share popover", () => {
  dialog.mockClear();
  renderToStaticMarkup(
    <AgentNativeI18nProvider
      catalog={{ messages: enUS }}
      persistPreference={false}
    >
      <ProjectSharePopover projectId="prj_embed" title="Revenue" published />
    </AgentNativeI18nProvider>,
  );
  const props = dialog.mock.calls[0]?.[0] as {
    shareFooterContent?: unknown;
  };
  expect(props.shareFooterContent).toBeDefined();
});
