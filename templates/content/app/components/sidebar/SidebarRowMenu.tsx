import { writeClipboardText } from "@agent-native/core/client/clipboard";
import { useT } from "@agent-native/core/client/i18n";
import type { Document } from "@shared/api";
import { IconDots } from "@tabler/icons-react";
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { useHref } from "react-router";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  sidebarWriteCommandReason,
  type SidebarCommandId,
} from "./sidebar-commands";
import CommandDialog from "./SidebarCommandDialog";

export function SidebarRowMenu({
  document,
  sourceOwned = false,
  onFavorite,
  onDelete,
  onAddContext,
  children,
}: {
  document: Document;
  sourceOwned?: boolean;
  onFavorite?: () => void;
  onDelete?: () => void;
  onAddContext?: () => void;
  children: (trigger: ReactNode) => ReactElement;
}) {
  const t = useT();
  const href = useHref(`/page/${document.id}`);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [command, setCommand] = useState<SidebarCommandId | null>(null);
  const reason = sourceOwned
    ? "sourceUnsupported"
    : sidebarWriteCommandReason(document);
  const title = document.title || t("sidebar.untitled");
  const rememberFocus = (target: EventTarget | null) => {
    originRef.current =
      target instanceof HTMLElement
        ? target.closest<HTMLElement>("a,button,[tabindex]")
        : triggerRef.current;
  };
  const returnFocus = () => {
    const target = originRef.current?.isConnected
      ? originRef.current
      : triggerRef.current;
    target?.focus();
  };
  const restoreMenuFocus = (event: Event) => {
    event.preventDefault();
    if (!command) returnFocus();
  };
  async function copyLink() {
    const copied = await writeClipboardText(
      new URL(href, window.location.origin).href,
    );
    if (copied) {
      toast.success(t("sidebarCommands.copied"));
    } else {
      toast.error(t("sidebarCommands.copyFailed"));
    }
  }

  const commands: Array<{
    id: string;
    label: string;
    run?: () => void;
    href?: string;
    reason?: string;
    destructive?: boolean;
  }> = [
    { id: "open-new-tab", label: t("sidebarCommands.newTab"), href },
    {
      id: "preview",
      label: t("sidebarCommands.preview"),
      run: () => setCommand("preview"),
    },
    {
      id: "copy-link",
      label: t("sidebarCommands.copyLink"),
      run: () => void copyLink(),
    },
    ...(onFavorite
      ? [
          {
            id: document.isFavorite ? "unpin" : "pin",
            label: t(
              document.isFavorite
                ? "sidebar.unpinFromSidebar"
                : "sidebar.pinToSidebar",
            ),
            run: onFavorite,
          },
        ]
      : []),
    {
      id: "rename",
      label: t("sidebarCommands.rename"),
      reason: reason ? t(`sidebarCommands.${reason}`) : undefined,
      run: () => setCommand("rename"),
    },
    {
      id: "move",
      label: t("sidebarCommands.move"),
      reason: reason ? t(`sidebarCommands.${reason}`) : undefined,
      run: () => setCommand("move"),
    },
    {
      id: "duplicate",
      label: t("database.duplicate"),
      reason: reason ? t(`sidebarCommands.${reason}`) : undefined,
      run: () => setCommand("duplicate"),
    },
    ...(onAddContext
      ? [
          {
            id: "add-context",
            label: t("creativeContext.addToContext" /* i18n-key-ignore */),
            run: onAddContext,
          },
        ]
      : []),
    ...(onDelete
      ? [
          {
            id: "delete",
            label: t("database.delete"),
            run: onDelete,
            destructive: true,
          },
        ]
      : []),
  ];

  function items(kind: "context" | "dropdown") {
    const Item = kind === "context" ? ContextMenuItem : DropdownMenuItem;
    return commands.map((entry) =>
      entry.href ? (
        <Item key={entry.id} asChild>
          <a href={entry.href} target="_blank" rel="noopener noreferrer">
            {entry.label}
          </a>
        </Item>
      ) : (
        <Item
          key={entry.id}
          aria-disabled={Boolean(entry.reason)}
          className={entry.destructive ? "text-destructive" : undefined}
          onSelect={() => {
            if (entry.reason) {
              toast.error(entry.reason);
              return;
            }
            entry.run?.();
          }}
        >
          <span className="grid gap-0.5">
            <span>{entry.label}</span>
            {entry.reason && (
              <span className="text-xs text-muted-foreground">
                {entry.reason}
              </span>
            )}
          </span>
        </Item>
      ),
    );
  }

  const trigger = (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className="flex size-6 items-center justify-center rounded text-current hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("sidebar.moreActionsFor", { label: title })}
          onPointerDown={(event) => {
            event.stopPropagation();
            rememberFocus(event.currentTarget);
          }}
          onClick={(event) => {
            event.stopPropagation();
            rememberFocus(event.currentTarget);
          }}
        >
          <IconDots size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-64"
        onCloseAutoFocus={restoreMenuFocus}
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuGroup>{items("dropdown")}</DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          asChild
          onContextMenuCapture={(event) => rememberFocus(event.target)}
          onKeyDown={(event) => {
            if (
              event.key === "ContextMenu" ||
              (event.shiftKey && event.key === "F10")
            ) {
              event.preventDefault();
              event.stopPropagation();
              rememberFocus(event.target);
              setMenuOpen(true);
            }
          }}
        >
          {children(trigger)}
        </ContextMenuTrigger>
        <ContextMenuContent
          className="w-64"
          onCloseAutoFocus={restoreMenuFocus}
          onClick={(event) => event.stopPropagation()}
        >
          <ContextMenuGroup>{items("context")}</ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
      {command && (
        <CommandDialog
          document={document}
          command={command}
          onClose={() => setCommand(null)}
          returnFocus={returnFocus}
        />
      )}
    </>
  );
}
