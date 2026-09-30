// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  promptComposerProps: null as Record<string, unknown> | null,
  send: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@agent-native/toolkit/app/chat/composer/index", () => ({
  PromptComposer: (props: Record<string, unknown>) => {
    mocks.promptComposerProps = props;
    return <div data-testid="prompt-composer" />;
  },
}));

vi.mock("@agent-native/toolkit/app/chat", () => ({
  useSendToAgentChat: () => ({ send: mocks.send, isGenerating: false }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/SqlEditor", () => ({
  SqlEditor: (props: Record<string, unknown>) => <textarea {...props} />,
}));

vi.mock("@/components/ui/button", () => {
  const Button = ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  );
  return { Button };
});

vi.mock("@/components/ui/dialog", () => {
  const Box = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  return {
    Dialog: Box,
    DialogContent: Box,
    DialogHeader: Box,
    DialogTitle: Box,
  };
});

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock("@/components/ui/popover", () => {
  const Box = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  return {
    Popover: Box,
    PopoverContent: Box,
    PopoverTrigger: Box,
  };
});

vi.mock("@/components/ui/select", () => {
  const Box = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  return {
    Select: Box,
    SelectContent: Box,
    SelectItem: Box,
    SelectTrigger: Box,
    SelectValue: Box,
  };
});

vi.mock("@/components/ui/tabs", () => {
  const Box = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  return {
    Tabs: Box,
    TabsContent: Box,
    TabsList: Box,
    TabsTrigger: Box,
  };
});

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: Record<string, unknown>) => <textarea {...props} />,
}));

vi.mock("@/components/ui/toggle-group", () => {
  const Box = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  return { ToggleGroup: Box, ToggleGroupItem: Box };
});

import { AddPanelPopover } from "./PanelEditorDialog";

describe("AddPanelPopover", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.promptComposerProps = null;
    mocks.send.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("does not autofocus the composer before the model menu can open", async () => {
    await act(async () => {
      root.render(
        <AddPanelPopover
          onSave={vi.fn()}
          dashboardId="dashboard-1"
          existingPanelTitles={[]}
        >
          <button type="button">Add panel</button>
        </AddPanelPopover>,
      );
    });

    expect(mocks.promptComposerProps).not.toBeNull();
    expect(mocks.promptComposerProps).not.toHaveProperty("autoFocus");
  });

  it("sends described panels with the typed mutation contract", async () => {
    await act(async () => {
      root.render(
        <AddPanelPopover
          onSave={vi.fn()}
          dashboardId="dashboard-1"
          existingPanelTitles={[]}
        >
          <button type="button">Add panel</button>
        </AddPanelPopover>,
      );
    });

    const onSubmit = mocks.promptComposerProps?.onSubmit as
      | ((text: string) => void)
      | undefined;
    await act(async () => onSubmit?.("Add a metric panel"));

    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Add a metric panel",
        submit: true,
        context: expect.stringContaining("structured operation"),
      }),
    );
    expect(mocks.send.mock.calls[0][0].context).toContain(
      "JSON integer from 1 to 6",
    );
    expect(mocks.send.mock.calls[0][0].context).toContain(
      'config:{timeScope:"dashboard"}',
    );
    expect(mocks.send.mock.calls[0][0].context).toContain(
      "dashboard's matching date filter",
    );
  });
});
