import {
  ActionButton,
  Avatar as DesignSystemAvatar,
  Dialog as DesignSystemDialog,
  IconButton,
  Picker,
  Status,
  TextArea,
} from "@agent-native/toolkit/design-system";
import { ShareCopyRow } from "@agent-native/toolkit/sharing";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@agent-native/toolkit/ui";
import {
  IconCheck,
  IconCode,
  IconCopy,
  IconChevronDown,
  IconLink,
  IconLock,
  IconMail,
  IconTrash,
  IconUsersGroup,
  IconWorld,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

import { cn } from "../utils.js";
import {
  useShareDialogController,
  type ResourceShare,
  type ShareDialogController,
  type ShareDialogPerson,
  type ShareDialogTab,
  type ShareVisibility,
} from "./useShareDialogController.js";

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  resourceType: string;
  resourceId: string;
  resourceTitle?: string;
  /**
   * When provided, enables the "Link" tab with a copy-link field.
   * Pass the user-facing share URL (e.g. `https://…/share/<id>`).
   */
  shareUrl?: string;
  /**
   * When provided, enables the "Embed" tab with a default iframe snippet.
   * For richer per-resource controls (autoplay, start time, responsive /
   * fixed size), pass `embedTabContent` instead (or in addition) — it
   * replaces the default embed body.
   */
  embedUrl?: string;
  /** Advanced: fully custom Embed tab body. Requires `embedUrl` to enable the tab. */
  embedTabContent?: ReactNode;
  /** Extra content appended to the bottom of the Link tab (e.g. download buttons). */
  linkTabExtras?: ReactNode;
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors active:!scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0";
const BUTTON_OUTLINE_SM = cn(
  BUTTON_BASE,
  "!h-9 !px-3 border border-input bg-background hover:bg-accent hover:text-accent-foreground",
);
const BUTTON_GHOST_ICON = cn(
  BUTTON_BASE,
  "!h-8 !w-8 !p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
);

const VIS_ICONS: Record<ShareVisibility, typeof IconLock> = {
  private: IconLock,
  org: IconUsersGroup,
  public: IconWorld,
};

const TAB_ICONS: Record<ShareDialogTab, typeof IconLink> = {
  link: IconLink,
  invite: IconMail,
  embed: IconCode,
};

/**
 * Framework share dialog. Drop into any template via
 * `<ShareDialog open onClose resourceType resourceId />`. Passing `shareUrl`
 * lights up a Link tab with a copy field; passing `embedUrl` lights up an
 * Embed tab. With neither prop, renders a single Invite + general-access
 * panel (Google-Docs-lite).
 */
export function ShareDialog({
  open,
  onClose,
  resourceType,
  resourceId,
  resourceTitle,
  shareUrl,
  embedUrl,
  embedTabContent,
  linkTabExtras,
}: ShareDialogProps) {
  const controller = useShareDialogController({
    open,
    onClose,
    resourceType,
    resourceId,
    resourceTitle,
    shareUrl,
    embedUrl,
  });
  if (!open) return null;

  return (
    <DesignSystemDialog
      open={controller.open}
      onOpenChange={controller.onOpenChange}
      title={
        <span
          className={cn(
            controller.tabsEnabled
              ? "sr-only"
              : "truncate !text-base !leading-normal !tracking-normal !text-inherit",
          )}
          title={controller.title}
        >
          {controller.title}
        </span>
      }
      closeLabel={controller.labels.close}
      size="large"
      className="!top-4 !z-[2010] !block !max-h-none !w-[calc(100vw-2rem)] !max-w-lg !translate-y-0 !gap-0 !overflow-visible !rounded-xl !border-border !bg-popover !p-0 !text-popover-foreground !shadow-2xl sm:!top-1/2 sm:!-translate-y-1/2"
      aria-label={controller.title}
    >
      {!controller.tabsEnabled && controller.ownerLabel ? (
        <div className="px-5 pt-0 pb-3">
          <div className="truncate text-xs text-muted-foreground">
            {controller.ownerLabel}
          </div>
        </div>
      ) : null}

      {controller.tabsEnabled ? (
        <div
          role="tablist"
          aria-label={controller.labels.shareOptions}
          className="mx-5 mt-1 flex gap-1 border-b border-border"
        >
          {controller.tabs.map((tab) => {
            const Icon = TAB_ICONS[tab.value];
            return (
              <TabTrigger
                key={tab.value}
                active={controller.activeTab === tab.value}
                onClick={() => controller.setActiveTab(tab.value)}
                icon={<Icon size={14} strokeWidth={1.75} />}
                label={tab.label}
              />
            );
          })}
        </div>
      ) : null}

      <div className="px-5 py-4">
        {controller.tabsEnabled && controller.activeTab === "link" ? (
          <LinkTab controller={controller} extras={linkTabExtras} />
        ) : null}
        {!controller.tabsEnabled || controller.activeTab === "invite" ? (
          <InviteTab
            controller={controller}
            showVisibility={!controller.tabsEnabled}
          />
        ) : null}
        {controller.tabsEnabled && controller.activeTab === "embed"
          ? (embedTabContent ?? <DefaultEmbedBody controller={controller} />)
          : null}
      </div>
    </DesignSystemDialog>
  );
}

function TabTrigger({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <ActionButton
      type="button"
      emphasis="ghost"
      aria-pressed={active}
      onPress={onClick}
      className={cn(
        "inline-flex !h-auto items-center gap-1.5 !rounded-none border-b-2 !px-3 !py-2 text-sm font-medium transition-colors hover:!bg-transparent active:!scale-100 focus-visible:!ring-0 focus-visible:!ring-offset-0 [&_svg]:!size-auto",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </ActionButton>
  );
}

function LinkTab({
  controller,
  extras,
}: {
  controller: ShareDialogController;
  extras?: ReactNode;
}) {
  const Icon = VIS_ICONS[controller.visibility.value];
  return (
    <div className="space-y-3">
      <ShareCopyRow
        label={controller.labels.shareLink}
        value={controller.shareUrl!}
        copyLabel={controller.labels.copy}
        copiedLabel="Copied"
        onCopy={(value) => controller.copy("share-link", value)}
        className="mb-4"
      />
      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          {controller.labels.generalAccess}
        </div>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <Icon size={16} strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <VisibilitySelect controller={controller} />
            <div className="sr-only text-xs text-muted-foreground">
              {controller.visibility.description}
            </div>
          </div>
        </div>
      </div>
      {extras}
    </div>
  );
}

function InviteTab({
  controller,
  showVisibility,
}: {
  controller: ShareDialogController;
  showVisibility: boolean;
}) {
  const Icon = VIS_ICONS[controller.visibility.value];
  const [advancedOpen, setAdvancedOpen] = useState(false);
  return (
    <div className="space-y-3">
      <Collapsible
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        className="overflow-hidden rounded-md border border-border"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-h-10 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <span className="truncate">
              {controller.labels.peopleWithAccess}
            </span>
            <IconChevronDown
              aria-hidden
              size={16}
              strokeWidth={1.8}
              className={cn(
                "shrink-0 text-muted-foreground transition-transform",
                advancedOpen && "rotate-180",
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border px-3 py-3">
          <div className="space-y-4">
            {controller.canManage ? (
              <div className="space-y-2">
                <div className="flex items-stretch gap-2">
                  <input
                    type="email"
                    placeholder={controller.labels.addPeopleByEmail}
                    value={controller.invite.email}
                    onChange={(event) =>
                      controller.invite.setEmail(event.currentTarget.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") controller.invite.submit();
                    }}
                    autoComplete="off"
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                  />
                  <RoleSelect controller={controller} />
                </div>
                {controller.invite.showNotifyPeople ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={controller.invite.notifyPeople}
                        onChange={(event) =>
                          controller.invite.setNotifyPeople(
                            event.currentTarget.checked,
                          )
                        }
                        className="h-4 w-4 rounded border-input accent-primary"
                      />
                      {controller.labels.notifyPeople}
                    </label>
                    {controller.invite.notifyPeople ? (
                      <ActionButton
                        type="button"
                        emphasis="ghost"
                        aria-expanded={controller.invite.messageOpen}
                        onPress={() =>
                          controller.invite.setMessageOpen(
                            !controller.invite.messageOpen,
                          )
                        }
                        className="!h-auto !rounded-sm !px-1 !py-0.5 text-xs font-medium !text-foreground underline decoration-border underline-offset-2 hover:!bg-accent hover:!text-accent-foreground active:!scale-100"
                      >
                        {controller.invite.messageOpen
                          ? controller.labels.hideMessage
                          : controller.labels.addMessage}
                      </ActionButton>
                    ) : null}
                  </div>
                ) : null}
                {controller.invite.showNotifyPeople &&
                controller.invite.notifyPeople &&
                controller.invite.messageOpen ? (
                  <TextArea
                    aria-label={controller.labels.addMessage}
                    placeholder={controller.labels.messagePlaceholder}
                    value={controller.invite.message}
                    onChange={(value) => controller.invite.setMessage(value)}
                    maxLength={500}
                    rows={3}
                    className="min-h-20 resize-y text-sm"
                  />
                ) : null}
              </div>
            ) : null}

            <div>
              <div className="mb-2 text-sm font-semibold">
                {controller.labels.peopleWithAccess}
              </div>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {controller.people.map((person) => (
                  <PersonRow
                    key={person.key}
                    person={person}
                    canManage={controller.canManage}
                    removeLabel={controller.labels.remove}
                    onRemove={controller.removeShare}
                  />
                ))}
                {!controller.people.length ? (
                  <li className="px-1 py-1.5 text-sm text-muted-foreground">
                    {controller.labels.noAccess}
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {showVisibility ? (
        <div>
          <div className="mb-2 text-sm font-semibold">
            {controller.labels.generalAccess}
          </div>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
              <Icon size={16} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <VisibilitySelect controller={controller} />
              <div className="sr-only text-xs text-muted-foreground">
                {controller.visibility.description}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PersonRow({
  person,
  canManage,
  removeLabel,
  onRemove,
}: {
  person: ShareDialogPerson;
  canManage: boolean;
  removeLabel: string;
  onRemove: (share: ResourceShare) => void;
}) {
  return (
    <li className="flex items-center gap-3 px-1 py-1.5 text-sm">
      <DesignSystemAvatar
        name={person.label}
        fallback={
          person.principalType === "org" ? (
            <IconUsersGroup size={14} strokeWidth={1.75} />
          ) : (
            person.avatarText
          )
        }
        size="compact"
        className="inline-flex h-7 w-7 shrink-0 text-[11px] font-semibold"
      />
      <span className="flex-1 min-w-0 truncate">{person.label}</span>
      <Status
        tone="neutral"
        size="compact"
        className="border-0 bg-transparent px-0 text-xs text-muted-foreground"
      >
        {person.roleLabel}
      </Status>
      {canManage && person.share ? (
        <IconButton
          intent="danger"
          emphasis="ghost"
          size="compact"
          icon={<IconTrash size={14} />}
          label={removeLabel}
          aria-label={removeLabel}
          onPress={() => onRemove(person.share!)}
          className={cn(BUTTON_GHOST_ICON, "[&_svg]:!size-auto")}
        />
      ) : null}
    </li>
  );
}

function DefaultEmbedBody({
  controller,
}: {
  controller: ShareDialogController;
}) {
  return (
    <div className="space-y-3">
      <ShareCopyRow
        label={controller.labels.embedUrl}
        value={controller.embedUrl!}
        copyLabel={controller.labels.copy}
        copiedLabel="Copied"
        onCopy={(value) => controller.copy("embed-url", value)}
      />
      <CopyField
        field="embed-code"
        label={controller.labels.embedCode}
        value={controller.embedCode!}
        controller={controller}
        multiline
      />
    </div>
  );
}

function CopyField({
  field,
  label,
  value,
  controller,
  multiline,
}: {
  field: string;
  label: string;
  value: string;
  controller: ShareDialogController;
  multiline?: boolean;
}) {
  const copied = controller.copiedField === field;
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <div className="flex items-stretch gap-2">
        {multiline ? (
          <TextArea
            readOnly
            value={value}
            onChange={() => undefined}
            aria-label={label}
            className="flex-1 h-20 text-xs font-mono"
          />
        ) : null}
        <IconButton
          emphasis="outline"
          size="compact"
          icon={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          label={controller.labels.copy}
          onPress={() => void controller.copy(field, value)}
          aria-label={controller.labels.copy}
          className={cn(BUTTON_OUTLINE_SM, "!w-9 !px-0 [&_svg]:!size-auto")}
        />
      </div>
    </div>
  );
}

function RoleSelect({ controller }: { controller: ShareDialogController }) {
  return (
    <Picker
      mode="select"
      options={controller.invite.roleOptions}
      value={controller.invite.role}
      onChange={(value) => {
        if (
          value === "viewer" ||
          value === "commenter" ||
          value === "editor" ||
          value === "admin"
        ) {
          controller.invite.setRole(value);
        }
      }}
      aria-label={controller.labels.role}
      className="w-auto"
    />
  );
}

function VisibilitySelect({
  controller,
}: {
  controller: ShareDialogController;
}) {
  return (
    <Picker
      mode="select"
      options={controller.visibility.options}
      value={controller.visibility.value}
      onChange={(value) => {
        if (value === "private" || value === "org" || value === "public") {
          controller.visibility.set(value);
        }
      }}
      disabled={controller.visibility.disabled}
      aria-label={controller.labels.generalAccess}
      className="-ms-1 w-auto"
    />
  );
}
