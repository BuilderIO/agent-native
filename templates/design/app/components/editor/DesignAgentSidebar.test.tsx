// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  surface: null as Record<string, any> | null,
  picker: null as Record<string, any> | null,
  search: "",
  queryClient: {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    setQueryData: vi.fn(),
  },
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  AgentSidebar: (props: Record<string, any>) => {
    mocks.surface = props;
    return null;
  },
  AgentChatSurface: (props: Record<string, any>) => {
    mocks.surface = props;
    return null;
  },
  markAgentChatHomeHandoff: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  useActionQuery: (_name: string, args: { id?: string }) => ({
    data: args.id ? { data: "{}", designSystemId: null } : undefined,
  }),
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : undefined,
  getBrowserTabId: () => "test-tab",
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));
vi.mock("react-router", () => ({
  useParams: () => ({}),
  useLocation: () => ({ search: mocks.search }),
  useNavigate: () => vi.fn(),
}));
vi.mock("./DesignContextPicker", () => ({
  DesignContextPicker: (props: Record<string, any>) => {
    mocks.picker = props;
    return null;
  },
}));

import ChatRoute from "@/routes/chat";

import { DesignAgentSidebar } from "./DesignAgentSidebar";

let root: Root;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.surface = null;
  mocks.picker = null;
  mocks.search = "";
  vi.clearAllMocks();
  mocks.callAction.mockImplementation(async (name) =>
    name === "get-design-system"
      ? {
          title: "Chosen system",
          data: '{"colors":{"primary":"#123456"}}',
          agentContext: "Real tokens",
        }
      : name === "read-composer-source"
        ? { id: "ref", title: "Read reference", context: "Revalidated source" }
        : {},
  );
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
});

describe("Design chat context hosts", () => {
  it("binds unscoped context to the active chat without leaking it across thread changes", async () => {
    await act(async () => root.render(<ChatRoute />));
    expect(mocks.surface?.composerContextThreadId).toBe("");
    await act(async () => mocks.surface?.onActiveThreadChange("thread-a"));
    expect(mocks.surface?.composerContextThreadId).toBe("thread-a");
    await act(async () =>
      mocks.picker?.controller.changeSystem("thread-system"),
    );
    await act(async () =>
      mocks.picker?.controller.attach(
        { source: "design", id: "thread-ref", title: "Thread reference" },
        {
          id: "thread-ref",
          title: "Thread reference",
          context: "Thread A body",
        },
      ),
    );
    expect(mocks.surface?.composerContextItems).toHaveLength(2);
    await act(async () => mocks.surface?.onActiveThreadChange("thread-b"));
    expect(mocks.surface?.composerContextThreadId).toBe("thread-b");
    expect(mocks.surface?.composerContextItems).toEqual([]);
    await act(async () => mocks.surface?.onActiveThreadChange("thread-a"));
    expect(mocks.surface?.composerContextThreadId).toBe("thread-a");
    expect(mocks.surface?.composerContextItems).toContainEqual(
      expect.objectContaining({ key: "design-system", context: "Real tokens" }),
    );
    expect(mocks.surface?.composerContextItems).toContainEqual(
      expect.objectContaining({ context: "Revalidated source" }),
    );
    expect(mocks.callAction).toHaveBeenCalledWith(
      "read-composer-source",
      { source: "design", operation: "read", id: "thread-ref" },
      { method: "GET" },
    );
  });
  it.each(["sidebar", "page"])(
    "wires the unscoped %s without changing project or workspace defaults",
    async (surface) => {
      await act(async () =>
        root.render(
          surface === "sidebar" ? (
            <DesignAgentSidebar
              {...({} as ComponentProps<typeof DesignAgentSidebar>)}
            />
          ) : (
            <ChatRoute />
          ),
        ),
      );
      expect(
        mocks.surface?.composerContextMenuItems.map(
          (item: { id: string }) => item.id,
        ),
      ).toEqual(["design", "slides"]);
      await act(async () =>
        mocks.picker?.controller.changeSystem("chosen-system"),
      );
      expect(mocks.surface?.composerContextItems).toContainEqual(
        expect.objectContaining({
          key: "design-system",
          context: "Real tokens",
          status: "ready",
        }),
      );
      await act(async () =>
        mocks.picker?.controller.attach(
          { source: "design", id: "ref", title: "Reference" },
          { id: "ref", title: "Reference", context: "Verified source" },
        ),
      );
      expect(
        await mocks.surface?.onBeforeComposerSubmit(
          mocks.surface?.composerContextItems,
        ),
      ).toBe(true);
      expect(
        mocks.callAction.mock.calls.every(
          ([name]) => name === "get-design-system",
        ),
      ).toBe(true);
      await act(async () =>
        mocks.surface?.onRemoveComposerContextItem("design-system"),
      );
      expect(
        mocks.surface?.composerContextItems.some(
          (item: { key: string }) => item.key === "design-system",
        ),
      ).toBe(false);
    },
  );

  it("clears unscoped context on project navigation and never leaks project refs back to global chat", async () => {
    const render = async (id?: string) =>
      act(async () =>
        root.render(
          <DesignAgentSidebar
            {...({
              scope: id ? { type: "design", id } : null,
            } as ComponentProps<typeof DesignAgentSidebar>)}
          />,
        ),
      );
    await render();
    await act(async () =>
      mocks.picker?.controller.changeSystem("local-system"),
    );
    await act(async () =>
      mocks.picker?.controller.attach(
        { source: "design", id: "local", title: "Local" },
        { id: "local", title: "Local", context: "Local body" },
      ),
    );
    await render("project-a");
    expect(mocks.surface?.composerContextThreadId).toBeUndefined();
    expect(mocks.surface?.composerContextItems).toEqual([]);
    await act(async () =>
      mocks.picker?.controller.attach(
        { source: "design", id: "project-ref", title: "Project" },
        { id: "project-ref", title: "Project", context: "Project body" },
      ),
    );
    await mocks.surface?.onBeforeComposerSubmit(
      mocks.surface?.composerContextItems,
    );
    expect(mocks.callAction).toHaveBeenCalledWith(
      "update-design",
      expect.objectContaining({ id: "project-a" }),
    );
    await render("project-b");
    expect(mocks.surface?.composerContextItems).toEqual([]);
    await render();
    expect(mocks.surface?.composerContextItems).toHaveLength(2);
    expect(
      mocks.surface?.composerContextItems.some(
        (item: { context: string }) => item.context === "Project body",
      ),
    ).toBe(false);
  });
});
