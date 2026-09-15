// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "commandPalette.search": "Search emails",
      "commandPalette.shortcuts": "Shortcuts",
      "commandPalette.shortcutsGlobal": "Global",
      "commandPalette.shortcutsList": "Message list",
      "commandPalette.shortcutsThread": "Conversation",
      "commandPalette.shortcutsCompose": "Compose",
      "commandPalette.backToCommands": "Back to commands",
      "commandPalette.backToMessageList": "Return to message list",
      "commandPalette.cycleTabs": "Cycle tabs",
      "commandPalette.extendSelection": "Extend selection",
      "commandPalette.moveSelection": "Move selection",
      "commandPalette.openMessage": "Open message",
      "commandPalette.nextPreviousConversation": "Next / previous conversation",
      "commandPalette.nextPreviousMessage": "Next / previous message",
      "commandPalette.selectAllConversations": "Select all conversations",
      "commandPalette.sendAndMarkDone": "Send and mark Done",
      "commandPalette.toggleMessageExpansion": "Expand / collapse message",
      "commandPalette.toggleReadState": "Toggle read state",
      "commandPalette.reportSpam": "Report spam",
      "commandPalette.reportSpamBlock": "Report spam & block sender",
      "commandPalette.muteThread": "Mute thread",
      "commandPalette.snooze": "Snooze email",
      "commandPalette.compose": "Compose new email",
      "commandPalette.reply": "Reply to thread",
      "commandPalette.goToInbox": "Go to Inbox",
      "commandPalette.goToStarred": "Go to Starred",
      "commandPalette.goToSent": "Go to Sent",
      "commandPalette.goToDrafts": "Go to Drafts",
      "commandPalette.goToTrash": "Go to Trash",
      "commandPalette.goToAllMail": "Go to All Mail",
      "commandPalette.goToArchive": "Go to Archive",
      "mail.actions.undo": "Undo",
      "mail.actions.archive": "Archive",
      "mail.actions.moveToTrash": "Move to Trash",
      "mail.actions.markRead": "Mark read",
      "mail.actions.markUnread": "Mark unread",
      "mail.selection.read": "Read",
      "mail.mobileActions.star": "Star",
      "mail.mobileActions.replyAll": "Reply All",
      "mail.mobileActions.reply": "Reply",
      "mail.compose.forward": "Forward",
      "mail.compose.send": "Send",
      "mail.sendLater.scheduleSend": "Schedule send",
      "mail.draftQueue.bcc": "Bcc",
      "mail.compose.cancel": "Cancel",
      "mail.mobileActions.close": "Close",
      "mail.thread.searchConversation": "Search in conversation...",
    })[key] ?? key,
}));

vi.mock("@agent-native/core/client/navigation", async () => {
  const React = await import("react");
  const Group = ({
    children,
    heading,
  }: {
    children: React.ReactNode;
    heading?: string;
  }) =>
    React.createElement(
      "div",
      null,
      heading && React.createElement("h3", null, heading),
      children,
    );
  const MenuContext = React.createContext<{
    onOpenChange: (open: boolean) => void;
  } | null>(null);
  const Item = ({
    children,
    onSelect,
    deferSelect = true,
  }: {
    children: React.ReactNode;
    onSelect: () => void;
    deferSelect?: boolean;
  }) => {
    const menu = React.useContext(MenuContext);
    return React.createElement(
      "button",
      {
        onClick: () => {
          onSelect();
          if (!deferSelect) menu?.onOpenChange(false);
        },
      },
      children,
    );
  };
  const Shortcut = ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", null, children);
  const Separator = () => React.createElement("hr");
  const CommandMenu = Object.assign(
    ({
      children,
      open,
      clearSearchOnEscape,
      onCloseAutoFocus,
      onOpenChange,
    }: {
      children: React.ReactNode;
      open: boolean;
      clearSearchOnEscape?: boolean;
      onCloseAutoFocus?: (event: Event) => void;
      onOpenChange: (open: boolean) => void;
    }) =>
      React.createElement(
        "div",
        {
          onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
            );
            const current = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (event.key === "ArrowDown" && items.length) {
              event.preventDefault();
              items[(current + 1) % items.length].focus();
            } else if (event.key === "ArrowUp" && items.length) {
              event.preventDefault();
              items[(current - 1 + items.length) % items.length].focus();
            } else if (event.key === "Enter" && current >= 0) {
              event.preventDefault();
              items[current].click();
            } else if (event.key === "Escape") {
              onOpenChange(false);
            }
          },
          "data-clear-search-on-escape": String(Boolean(clearSearchOnEscape)),
          "data-has-close-auto-focus": String(Boolean(onCloseAutoFocus)),
        },
        open
          ? React.createElement(
              MenuContext.Provider,
              { value: { onOpenChange } },
              children,
            )
          : null,
      ),
    { Group, Item, Shortcut, Separator },
  );

  return { CommandMenu };
});

vi.mock("next-themes", () => ({
  useTheme: () => ({
    resolvedTheme: "light",
    setTheme: vi.fn(),
    theme: "light",
  }),
}));

vi.mock("react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/hooks/use-emails", () => ({
  useSettings: () => ({ data: undefined }),
  useUpdateSettings: () => ({ mutate: vi.fn() }),
}));

import { CommandPalette } from "./CommandPalette";

describe("CommandPalette Search action", () => {
  afterEach(() => {
    cleanup();
    mocks.navigate.mockReset();
  });

  it("delegates Search emails to the existing search focus path", () => {
    const onSearch = vi.fn();

    render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        onCompose={vi.fn()}
        onSearch={onSearch}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search emails /" }));

    expect(onSearch).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("exposes compose Send only in compose context and hides mailbox actions", () => {
    const onSend = vi.fn();
    const onSendLater = vi.fn();
    const onSendAndMarkDone = vi.fn();
    const onSpam = vi.fn();
    const onBlockSender = vi.fn();
    const onMuteThread = vi.fn();
    const onSnooze = vi.fn();
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      onCompose: vi.fn(),
      onSearch: vi.fn(),
      onSend,
      onSendLater,
      onSendAndMarkDone,
      onSpam,
      onBlockSender,
      onMuteThread,
      onSnooze,
    };

    const { rerender } = render(<CommandPalette {...props} isComposeContext />);

    fireEvent.click(
      screen.getByRole("button", { name: "Send ⌘ Enter / Ctrl Enter" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Schedule send ⌘ Shift L / Ctrl Shift L",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Send and mark Done ⌘ Shift Enter / Ctrl Shift Enter",
      }),
    );
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSendLater).toHaveBeenCalledOnce();
    expect(onSendAndMarkDone).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Report spam" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Report spam & block sender" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Mute thread" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Snooze email H" })).toBeNull();

    rerender(<CommandPalette {...props} />);

    expect(
      screen.queryByRole("button", {
        name: "Send ⌘ Enter / Ctrl Enter",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Schedule send ⌘ Shift L / Ctrl Shift L",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Send and mark Done ⌘ Shift Enter / Ctrl Shift Enter",
      }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Report spam" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Report spam & block sender" }),
    ).toBeTruthy();
  });

  it("routes All Mail and Archive commands to their distinct destinations", () => {
    render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        onCompose={vi.fn()}
        onSearch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Go to All Mail G A" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to Archive G E" }));

    expect(mocks.navigate).toHaveBeenNthCalledWith(1, "/all");
    expect(mocks.navigate).toHaveBeenNthCalledWith(2, "/archive");
  });

  it("opts into command-query clearing and focus restoration on Escape", () => {
    const onCloseAutoFocus = vi.fn();
    const { container } = render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        onCloseAutoFocus={onCloseAutoFocus}
        onCompose={vi.fn()}
        onSearch={vi.fn()}
      />,
    );

    expect(
      container.querySelector('[data-clear-search-on-escape="true"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-has-close-auto-focus="true"]'),
    ).toBeTruthy();
  });

  it("opens a scoped shortcut reference with source-backed mappings", () => {
    render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        onCompose={vi.fn()}
        onSearch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));

    expect(screen.getByRole("heading", { name: "Global" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Message list" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Conversation" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Compose" })).toBeTruthy();
    expect(screen.getByText("C")).toBeTruthy();
    expect(screen.getByText("G #")).toBeTruthy();
    expect(screen.getByText("J / ↓ · K / ↑")).toBeTruthy();
    expect(screen.getByText("N / P")).toBeTruthy();
    expect(screen.getByText("⌘ Enter / Ctrl Enter")).toBeTruthy();

    const expectShortcut = (label: string, shortcut: string) => {
      const matchingLabels = screen.getAllByText(label);
      expect(matchingLabels.length).toBeGreaterThan(0);
      for (const matchingLabel of matchingLabels) {
        expect(matchingLabel.parentElement?.textContent).toContain(shortcut);
      }
    };
    expectShortcut("Next / previous conversation", "J / K");
    expectShortcut("Next / previous message", "N / P");
    expectShortcut("Expand / collapse message", "Enter / O");
    expectShortcut("Return to message list", "Esc");
    expectShortcut("Search in conversation...", "⌘ F / Ctrl F");
    expectShortcut("Toggle read state", "U");
    expectShortcut("Move to Trash", "D / #");
    expectShortcut("Extend selection", "Shift+J/K · Shift+↑/↓");
    expectShortcut("Select all conversations", "⌘ A / Ctrl A");
    expectShortcut("Reply All", "A");
    expectShortcut("Cycle tabs", "Tab / Shift+Tab");
    expectShortcut("Send and mark Done", "⌘ Shift Enter / Ctrl Shift Enter");
  });

  it("supports keyboard navigation and resets to commands after closing", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        onCompose={vi.fn()}
        onSearch={vi.fn()}
      />,
    );

    const composeCommand = screen.getByRole("button", {
      name: "Compose new email C",
    });
    composeCommand.focus();
    fireEvent.keyDown(composeCommand, { key: "ArrowDown" });
    const searchCommand = screen.getByRole("button", {
      name: "Search emails /",
    });
    expect(document.activeElement).toBe(searchCommand);
    fireEvent.keyDown(searchCommand, { key: "ArrowDown" });
    const shortcutCommand = screen.getByRole("button", { name: "Shortcuts" });
    expect(document.activeElement).toBe(shortcutCommand);
    fireEvent.keyDown(shortcutCommand, { key: "Enter" });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Back to commands" }),
    ).toBeTruthy();
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Back to commands" }),
      {
        key: "Escape",
      },
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(
      <CommandPalette
        open={false}
        onOpenChange={onOpenChange}
        onCompose={vi.fn()}
        onSearch={vi.fn()}
      />,
    );
    rerender(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        onCompose={vi.fn()}
        onSearch={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Shortcuts" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Back to commands" }),
    ).toBeNull();
  });
});
