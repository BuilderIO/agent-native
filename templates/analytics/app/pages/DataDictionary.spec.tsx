// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entries: [] as Array<Record<string, unknown>>,
  mutateAsync: vi.fn(async () => ({ success: true })),
  useActionQuery: vi.fn((name: string) => ({
    data:
      name === "list-data-dictionary"
        ? {
            results: mocks.entries,
            searched: mocks.entries.length,
            of: mocks.entries.length,
            truncated: false,
            nextPage: null,
          }
        : undefined,
    isLoading: false,
  })),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: mocks.useActionQuery,
  useActionMutation: () => ({
    mutateAsync: mocks.mutateAsync,
    isPending: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key === "dataDictionary.deprecated" ? "deprecated" : key,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrgRole: () => ({ canManageOrg: false }),
}));

vi.mock("@agent-native/toolkit/app/chat", () => ({
  useSendToAgentChat: () => ({ send: vi.fn() }),
}));

vi.mock("@/components/layout/HeaderActions", () => ({
  useSetHeaderActions: vi.fn(),
}));

vi.mock("@/components/ui/alert-dialog", () => {
  const Container = ({ open, children }: any) =>
    open ? <div>{children}</div> : null;
  const Button = ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  );

  return {
    AlertDialog: Container,
    AlertDialogAction: Button,
    AlertDialogCancel: Button,
    AlertDialogContent: Container,
    AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
    AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
    AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
  };
});

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: any) => (
    <span data-badge className={className}>
      {children}
    </span>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/card", () => {
  const Container = ({ children, ...props }: any) => (
    <div {...props}>{children}</div>
  );

  return {
    Card: Container,
    CardContent: Container,
    CardDescription: ({ children }: any) => <p>{children}</p>,
    CardHeader: Container,
    CardTitle: ({ children }: any) => <h3>{children}</h3>,
  };
});

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));

vi.mock("@/components/ui/dialog", () => {
  const Container = ({ open, children }: any) =>
    open ? <div role="dialog">{children}</div> : null;
  const Content = ({ children }: any) => <div>{children}</div>;

  return {
    Dialog: Container,
    DialogContent: Content,
    DialogDescription: ({ children }: any) => <p>{children}</p>,
    DialogFooter: Content,
    DialogHeader: Content,
    DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  };
});

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: (props: any) => <div {...props} />,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => <textarea {...props} />,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@tabler/icons-react", () => {
  const Icon = ({ className }: any) => <span className={className} />;
  return {
    IconBook2: Icon,
    IconExternalLink: Icon,
    IconPencil: Icon,
    IconPlus: Icon,
    IconSearch: Icon,
    IconTrash: Icon,
    IconUpload: Icon,
  };
});

const { default: DataDictionary } = await import("./DataDictionary");

describe("DataDictionary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.entries = [
      {
        id: "index-model-deprecated",
        metric: "Legacy model",
        definition: "A retired model.",
        status: "deprecated",
        sourceIndex: true,
        aiGenerated: true,
      },
      {
        id: "index-model-active",
        metric: "Current model",
        definition: "A current model.",
        status: "active",
        sourceIndex: true,
        aiGenerated: true,
      },
    ];
    mocks.mutateAsync.mockClear();
    mocks.useActionQuery.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("labels deprecated generated entries in the dictionary", async () => {
    await act(async () => {
      root.render(<DataDictionary />);
    });

    const badges = [...container.querySelectorAll("[data-badge]")].map(
      (badge) => badge.textContent?.trim(),
    );
    expect(badges).toContain("deprecated");
    expect(badges).not.toContain("active");
  });

  it("passes the deprecated lifecycle through the edit save", async () => {
    await act(async () => {
      root.render(<DataDictionary />);
    });

    await act(async () => {
      container.querySelector("button")?.click();
    });

    const saveButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "dataDictionary.saveEntry",
    );
    await act(async () => {
      saveButton?.click();
    });

    expect(mocks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "index-model-deprecated",
        status: "deprecated",
      }),
    );
  });
});
