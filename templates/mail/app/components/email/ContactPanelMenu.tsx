import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import {
  useSlotExtensions,
  useSlotInstallActions,
  useSlotInstalls,
} from "@agent-native/toolkit/app/extensions";
import type { ContactPanelWidgetId } from "@shared/contact-panel-widgets";
import { IconChevronLeft, IconPlus } from "@tabler/icons-react";
import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useContactPanelWidgets } from "@/hooks/use-contact-panel";

export const CONTACT_PANEL_SLOT_ID = "mail.contact-sidebar.bottom";

const BUILT_IN_LABELS: Record<ContactPanelWidgetId, string> = {
  meetings: "mail.contactPanel.meetings",
  notes: "mail.contactPanel.notes",
  attachments: "mail.contactPanel.attachments",
  recent: "mail.contactPanel.recent",
};

const EXAMPLE_IDEAS = [
  "mail.contactPanel.exampleDeals",
  "mail.contactPanel.exampleLinks",
];

function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pt-2.5 pb-1 text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">
      {children}
    </p>
  );
}

function SwitchRow({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1.5">
      <label
        htmlFor={id}
        className="min-w-0 flex-1 cursor-pointer truncate text-[12px] text-foreground/85"
      >
        {label}
      </label>
      <Switch
        id={id}
        size="sm"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

function YourWidgets({
  open,
  onBuild,
}: {
  open: boolean;
  onBuild: () => void;
}) {
  const t = useT();
  const available = useSlotExtensions(CONTACT_PANEL_SLOT_ID, {
    enabled: open,
  });
  const installs = useSlotInstalls(CONTACT_PANEL_SLOT_ID);
  const slotActions = useSlotInstallActions(CONTACT_PANEL_SLOT_ID);
  const installed = new Set(
    (installs.data ?? []).map((install) => install.extensionId),
  );
  const failed = available.isError || installs.isError;

  return (
    <>
      <MenuHeading>{t("mail.contactPanel.yourWidgets")}</MenuHeading>
      {available.isPending || installs.isPending ? (
        <div aria-hidden="true" className="space-y-2 px-3 py-1.5">
          <Skeleton className="h-3 w-2/3" />
        </div>
      ) : failed ? (
        <div
          className="flex items-center justify-between gap-2 px-3 py-1.5"
          role="alert"
        >
          <p className="text-[11px] text-muted-foreground/70">
            {t("extensions.widgetsLoadError")}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto shrink-0 px-2 py-1 text-[11px]"
            disabled={available.isFetching || installs.isFetching}
            onClick={() => {
              if (available.isError) void available.refetch();
              if (installs.isError) void installs.refetch();
            }}
          >
            {t("mail.error.tryAgain")}
          </Button>
        </div>
      ) : (
        available.data.map((extension) => (
          <SwitchRow
            key={extension.extensionId}
            label={extension.name}
            checked={installed.has(extension.extensionId)}
            onCheckedChange={(on) =>
              void (on
                ? slotActions.install(extension)
                : slotActions.uninstall(extension.extensionId))
            }
          />
        ))
      )}
      <button
        type="button"
        onClick={onBuild}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <IconPlus className="h-3.5 w-3.5 shrink-0" />
        <span>{t("mail.contactPanel.buildYourOwn")}</span>
      </button>
    </>
  );
}

function BuildYourOwn({
  onBack,
  onStart,
}: {
  onBack: () => void;
  onStart: (message: string) => void;
}) {
  const t = useT();
  return (
    <div className="pb-1">
      <div className="flex items-center gap-1.5 px-2 pt-2 pb-1">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("mail.contactPanel.back")}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 hover:bg-accent hover:text-foreground"
        >
          <IconChevronLeft className="h-3.5 w-3.5 rtl:-scale-x-100" />
        </button>
        <p className="text-[12px] font-medium text-foreground">
          {t("mail.contactPanel.buildYourOwnTitle")}
        </p>
      </div>
      <div className="space-y-1.5 px-3 pb-2 text-[11px] leading-snug text-muted-foreground/80">
        <p>{t("mail.contactPanel.widgetSees")}</p>
        <p>{t("mail.contactPanel.widgetDoes")}</p>
      </div>
      <div className="border-t border-border/40 py-1">
        {EXAMPLE_IDEAS.map((ideaKey) => (
          <button
            key={ideaKey}
            type="button"
            onClick={() =>
              onStart(
                t("mail.contactPanel.examplePrompt", {
                  slotId: CONTACT_PANEL_SLOT_ID,
                  idea: t(ideaKey),
                }),
              )
            }
            className="block w-full px-3 py-1.5 text-start text-[12px] text-foreground/85 hover:bg-accent"
          >
            {t(ideaKey)}
          </button>
        ))}
        <button
          type="button"
          onClick={() =>
            onStart(
              t("extensions.createWidgetPrompt", {
                slotId: CONTACT_PANEL_SLOT_ID,
              }),
            )
          }
          className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <IconPlus className="h-3.5 w-3.5 shrink-0" />
          <span>{t("extensions.buildNewWidget")}</span>
        </button>
      </div>
    </div>
  );
}

export function ContactPanelMenu({
  open,
  onOpenChange,
  connections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connections: ReactNode;
}) {
  const t = useT();
  const [view, setView] = useState<"menu" | "build">("menu");
  const { widgets, loaded, setWidget } = useContactPanelWidgets();

  const changeOpen = (next: boolean) => {
    if (!next) setView("menu");
    onOpenChange(next);
  };

  const startWidget = (message: string) => {
    changeOpen(false);
    sendToAgentChat({ message, submit: false, openSidebar: true });
  };

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 py-1.5 text-[11px] text-muted-foreground/70 hover:text-muted-foreground"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-dashed border-border/50">
            <IconPlus className="h-3 w-3" />
          </span>
          <span>{t("mail.contactPanel.addToPanel")}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="max-h-[min(32rem,var(--radix-popover-content-available-height))] w-72 overflow-y-auto p-0"
      >
        {view === "build" ? (
          <BuildYourOwn onBack={() => setView("menu")} onStart={startWidget} />
        ) : (
          <div className="pb-1">
            <MenuHeading>{t("mail.contactPanel.builtIn")}</MenuHeading>
            {(Object.keys(BUILT_IN_LABELS) as ContactPanelWidgetId[]).map(
              (id) => (
                <SwitchRow
                  key={id}
                  label={t(BUILT_IN_LABELS[id])}
                  checked={widgets[id]}
                  disabled={!loaded}
                  onCheckedChange={(on) => setWidget(id, on)}
                />
              ),
            )}
            <div className="mt-1 border-t border-border/40" />
            <MenuHeading>{t("mail.contactPanel.connections")}</MenuHeading>
            <div className="px-3">{connections}</div>
            <div className="mt-1 border-t border-border/40" />
            <YourWidgets open={open} onBuild={() => setView("build")} />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
