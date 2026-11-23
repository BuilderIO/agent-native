// @vitest-environment happy-dom
import { act, useEffect, useMemo, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, it, vi } from "vitest";

const { createThread, sendToAgent } = vi.hoisted(() => ({
  createThread: vi.fn(),
  sendToAgent: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  callAction: createThread,
}));
vi.mock("@agent-native/core/client/agent-chat", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/agent-chat")>()),
  sendToAgentChatAndConfirm: sendToAgent,
}));
vi.mock("../workspace/WorkspaceDataContext", async (original) => ({
  ...(await original<typeof import("../workspace/WorkspaceDataContext")>()),
  useWorkspaceData: () => ({
    shell: {
      workspace: { id: "org-1" },
      features: { canCreateThread: true },
    },
  }),
}));

vi.mock("@agent-native/toolkit/app/settings/shell", async (original) => {
  const actual =
    await original<typeof import("@agent-native/toolkit/app/settings/shell")>();
  return {
    ...actual,
    SkillsSettingsPage: ({
      onDescribe,
    }: NonNullable<ComponentProps<typeof actual.SkillsSettingsPage>>) => {
      const { route } = actual.useSettingsShell();
      const header = useMemo(
        () => ({ action: <button>Add skill</button> }),
        [],
      );
      actual.useSettingsPageHeader(header);
      useEffect(() => {
        expect(route.page).toBe("skills");
      }, [route.page]);
      return (
        <>
          <p>Personal skills</p>
          <button
            type="button"
            onClick={() =>
              void onDescribe?.({
                message: "Create a skill: Review a query",
                context: "Save as a personal skill",
              })
            }
          >
            Send skill description
          </button>
        </>
      );
    },
  };
});

import { resolveRoute } from "../../routes/routing/registry";
import { setThreadSubmissionSurfaceReady } from "../agent/search-submission";
import { resolveRoutePage } from "../workspace/pages";
import { SettingsShell } from "../workspace/SettingsShell";
import { SkillsSettingsPage } from "./SettingsShellBridgedPages";

it("lets a member open Skills from Settings and keeps the page's Add skill action", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings/profile"]}>
          <SettingsShell activeTab="profile" canManageWorkspace={false}>
            <Routes>
              <Route path="/settings/profile" element={<p>Profile</p>} />
              <Route path="/settings/skills" element={<SkillsSettingsPage />} />
            </Routes>
          </SettingsShell>
        </MemoryRouter>,
      );
    });
    const link = host.querySelector<HTMLAnchorElement>(
      'a[href="/settings/skills"]',
    );
    expect(link, "member Settings offers Skills").not.toBeNull();
    await act(async () => link!.click());
    expect(host.textContent).toContain("Personal skills");
    expect(
      [...host.querySelectorAll("button")].map((button) => button.textContent),
    ).toContain("Add skill");
    const route = resolveRoute("/settings/skills");
    expect(route.view).toBe("skills");
    expect(resolveRoutePage(route)).toBeDefined();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("submits the skill description in a new thread in the current workspace", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  createThread.mockResolvedValue({
    id: "new-thread",
    href: "/thread/new-thread",
  });
  sendToAgent.mockResolvedValue({ delivered: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function NewThread() {
    useEffect(() => {
      setThreadSubmissionSurfaceReady("new-thread", "org-1", true);
      return () =>
        setThreadSubmissionSurfaceReady("new-thread", "org-1", false);
    }, []);
    return <p>New thread opened</p>;
  }
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings/skills"]}>
          <Routes>
            <Route path="/settings/skills" element={<SkillsSettingsPage />} />
            <Route path="/thread/new-thread" element={<NewThread />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    const send = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Send skill description",
    );
    if (!send) throw new Error("The description composer is missing");
    await act(async () => send.click());
    expect(createThread).toHaveBeenCalledWith("create-thread", {});
    expect(host.textContent).toContain("New thread opened");
    expect(sendToAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Create a skill: Review a query",
        context: "Save as a personal skill",
        targetTabId: "new-thread",
        chatTarget: "local",
        submit: true,
      }),
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
