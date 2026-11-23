// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  describe: undefined as undefined | ((m: unknown) => Promise<void>),
  queued: [] as unknown[][],
}));

vi.mock("@/components/workspace/WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: {
      features: { canCreateThread: true },
      workspace: { id: "workspace-qa" },
    },
  }),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(async () => ({
    id: "thread-1",
    href: "/threads/thread-1",
  })),
}));
vi.mock("@/components/agent/search-submission", () => ({
  queueThreadSubmission: (...args: unknown[]) => {
    hoisted.queued.push(args);
    return Promise.resolve({ delivered: true });
  },
}));
vi.mock("@agent-native/toolkit/app/settings/shell", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/toolkit/app/settings/shell")
  >()),
  SkillsSettingsPage: (props: {
    onDescribe?: (m: unknown) => Promise<void>;
  }) => {
    hoisted.describe = props.onDescribe;
    return <p>skills</p>;
  },
}));

import { SkillsSettingsPage } from "./SettingsShellBridgedPages";

describe("Settings > Skills describe request", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    hoisted.describe = undefined;
    hoisted.queued.length = 0;
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  it("queues a skill request that saves through write-resource", async () => {
    act(() =>
      root.render(
        <MemoryRouter>
          <SkillsSettingsPage />
        </MemoryRouter>,
      ),
    );
    expect(hoisted.describe).toBeTypeOf("function");
    await act(async () => {
      await hoisted.describe?.({
        message: "Create a skill: weekly revenue",
        context:
          'Write the skill as a personal resource at path "skills/<name>/SKILL.md" using the `resources` tool with `action: "write"`',
      });
    });
    expect(hoisted.queued).toHaveLength(1);
    const [threadId, workspaceId, request] = hoisted.queued[0] as [
      string,
      string,
      { message: string; context: string },
    ];
    expect(threadId).toBe("thread-1");
    expect(workspaceId).toBe("workspace-qa");
    expect(request.message).toBe("Create a skill: weekly revenue");
    expect(request.context).toContain("`write-resource`");
    expect(request.context).not.toContain("`resources` tool");
  });
});
