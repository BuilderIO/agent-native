import { trackEvent } from "@agent-native/core/client/analytics";
import { appPath } from "@agent-native/core/client/api-path";
import { useOptionalLocale, useT } from "@agent-native/core/client/i18n";
import {
  useShareButtonController,
  type ShareButtonAgent,
  type ShareButtonController,
  type ShareButtonGroup,
  type ShareButtonOrgMember,
  type ShareButtonOrgMemberSearch,
  type ShareButtonShare,
  type ShareButtonSharesResponse,
  type ShareButtonRole,
  type ShareButtonVisibility,
} from "@agent-native/core/client/sharing/useShareButtonController";
import { useActionMutation } from "@agent-native/core/client/use-action";
import { useAvatarUrl } from "@agent-native/core/client/use-avatar";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import {
  buildAgentShareDeepLink,
  JoinedShareControl,
  ShareTabs,
  ShareTrigger,
  type AgentShareDestination,
} from "@agent-native/toolkit/sharing";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@agent-native/toolkit/ui/sheet";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { cn } from "@agent-native/toolkit/utils";
import * as Select from "@radix-ui/react-select";
import {
  IconLock,
  IconWorld,
  IconCheck,
  IconChevronDown,
  IconLink,
  IconLoader2,
  IconSearchOff,
  IconUsersGroup,
  IconUserPlus,
} from "@tabler/icons-react";
import {
  type ComponentPropsWithoutRef,
  useEffect,
  useImperativeHandle,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  Ref,
  UIEvent as ReactUIEvent,
} from "react";
import { toast } from "sonner";

import { AccessRequestsSection } from "./AccessRequestsSection.js";
import { ShareVisibilityConfirmDialog } from "./ShareVisibilityConfirmDialog.js";

export interface ShareButtonProps {
  resourceType: string;
  resourceId: string;
  resourceTitle?: string;
  /** @deprecated No longer affects rendering — trigger always says
   *  "Share". Kept for callsite compatibility. */
  variant?: "compact" | "label";
  /** @deprecated Share triggers are standardized as text-only buttons. */
  trigger?: "label" | "icon" | "label-icon";
  /** @deprecated No longer affects rendering — kept for callsite compatibility. */
  hideTriggerIcon?: boolean;
  triggerClassName?: string;
  panelTitle?: ReactNode;
  triggerContent?: ReactNode;
  onOpenChange?: (open: boolean) => void;
  actionRef?: Ref<ShareButtonActionHandle>;
  actionEvent?: string;
  onShareSuccess?: () => void;
  defaultOpen?: boolean;
  shareUrl?: string;
  /** Use a bottom sheet for the share surface below the small-screen breakpoint. */
  mobileSheet?: boolean;
  /**
   * The session can run only the basic share actions (list, share, unshare,
   * visibility), as a scoped MCP App widget session can. Omits the access
   * request review, the agent-context link and the people suggestions, which
   * need other routes, and the admin role and email note, which such a
   * session may not send; an email is still added by typing it.
   */
  basicSharingOnly?: boolean;
  /** Open the share surface without rendering a trigger button. */
  hideTrigger?: boolean;
  /** Override the label of the Send to menu's agent-link item. */
  agentShareLabel?: string;
  /** Destinations in the Send to menu beside Copy link. */
  sendTo?: ShareSendTo;
  /** Immediate human-link copy action beside the Share trigger. */
  quickCopy?: {
    label: string;
    copiedLabel: string;
    onCopy: () => Promise<boolean | void> | boolean | void;
    size?: "default" | "sm";
    className?: string;
  };
  /** Tooltip for the Copy link button: which link it copies. */
  shareUrlLabel?: string;
  /** @deprecated Copy link is a single button; use `shareUrlLabel`. */
  shareUrlDescription?: ReactNode;
  /** @deprecated Copy link always sits in the panel footer. */
  shareUrlPlacement?: "top" | "bottom";
  /** Show the Copy link button. Defaults to true when `shareUrl` is set. */
  showShareLinks?: boolean;
  /** @deprecated The Done action was removed; share popovers dismiss directly. */
  showDoneButton?: boolean;
  /** Shown in place of Copy link while the resource has no link yet. */
  shareUrlPlaceholder?: ReactNode;
  /** @deprecated No longer enforced — access is checked on the resource,
   *  not the URL shape, mirroring Google Slides. Kept for callsite
   *  compatibility; the prop is now a no-op. */
  shareUrlRequiresPublic?: boolean;
  /** @deprecated See `shareUrlRequiresPublic`. No longer rendered. */
  shareUrlUnavailableDescription?: ReactNode;
  visibilityCopy?: Partial<
    Record<Visibility, { label?: string; description?: string }>
  >;
  /**
   * What is specific to this resource, already translated, added to the
   * confirmation shown before it becomes visible to the organization.
   */
  visibilityConfirmDetail?: ReactNode;
  roleCopy?: Partial<Record<Role, { label?: string; description?: string }>>;
  allowedRoles?: readonly Role[];
  peopleAccessLabel?: ReactNode;
  generalAccessLabel?: ReactNode;
  accessNote?: ReactNode;
  shareFooterContent?: ReactNode;
  hideInSearchControl?: {
    checked: boolean;
    pending?: boolean;
    label?: string;
    description?: ReactNode;
    onCheckedChange: (checked: boolean) => void | Promise<void>;
  };
  shareTabs?: {
    shareLabel?: ReactNode;
    defaultValue?: string;
    tabs: Array<{
      value: string;
      label: ReactNode;
      content: ReactNode;
      disabled?: boolean;
    }>;
    onValueChange?: (value: string) => void;
  };
  popoverClassName?: string;
}

export interface ShareSendToItem {
  id: string;
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}

/**
 * The Send to menu. Each group renders only when the app supplies it; the
 * agent link is added on its own for agent-readable resources.
 */
export interface ShareSendTo {
  /** Open the resource in Claude, Claude Code, or Codex with a prompt. */
  openInAgent?: (destination: AgentShareDestination) => void;
  /** Resource-specific destinations, between the agents and the copy items. */
  items?: ShareSendToItem[];
  copyAgentPrompt?: () => unknown;
  openMcpSettings?: () => void;
}

export interface ShareButtonActionHandle {
  open: (tab?: string) => void;
}

type Visibility = ShareButtonVisibility;
type Role = ShareButtonRole;
type HideInSearchControl = NonNullable<ShareButtonProps["hideInSearchControl"]>;
type OrgMember = ShareButtonOrgMember;
type OrgMemberSearch = ShareButtonOrgMemberSearch;

type Share = ShareButtonShare;

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";
const SHARE_SECTION_LABEL = "text-xs font-medium text-muted-foreground";
const SHARE_POPOVER_SURFACE =
  "border border-border bg-popover text-popover-foreground";
const SHARE_NESTED_OVERLAY_ATTR = "data-agent-native-share-overlay";
const SHARE_NESTED_OVERLAY_Z = "z-[100020]";
const VIS_META: Record<
  Visibility,
  {
    labelKey: string;
    descriptionKey: string;
    defaultLabel: string;
    defaultDescription: string;
    Icon: typeof IconLock;
  }
> = {
  private: {
    labelKey: "agentChat.share.onlyPeopleInvited",
    descriptionKey: "agentChat.share.privateDescription",
    defaultLabel: "Only people invited",
    defaultDescription: "Only people with access can view",
    Icon: IconLock,
  },
  org: {
    labelKey: "agentChat.share.anyoneInOrganization",
    descriptionKey: "agentChat.share.organizationDescription",
    defaultLabel: "Anyone in your organization",
    defaultDescription: "Anyone in your organization can view",
    Icon: IconUsersGroup,
  },
  public: {
    labelKey: "agentChat.share.anyoneWithLink",
    descriptionKey: "agentChat.share.publicDescription",
    defaultLabel: "Anyone with the link",
    defaultDescription: "Anyone with the link can view",
    Icon: IconWorld,
  },
};

type ShareTranslate = ReturnType<typeof useT>;

function visibilityMeta(
  visibility: Visibility,
  t: ShareTranslate,
  copy?: ShareButtonProps["visibilityCopy"],
  organizationName?: string | null,
): { label: string; description: string; Icon: typeof IconLock } {
  const base = VIS_META[visibility];
  const override = copy?.[visibility];
  return {
    Icon: base.Icon,
    label:
      override?.label ??
      (visibility === "org" && organizationName
        ? t("agentChat.share.anyoneAtOrganization", {
            defaultValue: "Anyone at {{organization}}",
            organization: organizationName,
          })
        : t(base.labelKey, {
            defaultValue: base.defaultLabel,
          })),
    description:
      override?.description ??
      t(base.descriptionKey, {
        defaultValue: base.defaultDescription,
      }),
  };
}

// A scoped host session cannot grant the admin role, so it is not offered.
const BASIC_SHARING_ROLES: readonly Role[] = ["viewer", "commenter", "editor"];

function allowedRolesFor(
  props: Pick<ShareButtonProps, "allowedRoles" | "basicSharingOnly">,
): readonly Role[] | undefined {
  return (
    props.allowedRoles ??
    (props.basicSharingOnly ? BASIC_SHARING_ROLES : undefined)
  );
}

function roleOptions(
  t: ShareTranslate,
): Array<{ value: Role; label: string; description?: string }> {
  return [
    {
      value: "viewer",
      label: t("agentChat.share.canView", { defaultValue: "Can view" }),
    },
    {
      value: "commenter",
      label: t("agentChat.share.canComment", { defaultValue: "Can comment" }),
    },
    {
      value: "editor",
      label: t("agentChat.share.canEdit", { defaultValue: "Can edit" }),
    },
    {
      value: "admin",
      label: t("agentChat.share.canManageAccess", {
        defaultValue: "Can manage access",
      }),
    },
  ];
}

function roleMeta(
  role: Role,
  t: ShareTranslate,
  copy?: ShareButtonProps["roleCopy"],
): { value: Role; label: string; description?: string } {
  const options = roleOptions(t);
  const base = options.find((option) => option.value === role) ?? options[0];
  const override = copy?.[role];
  return {
    ...base,
    label: override?.label ?? base.label,
    description: override?.description ?? base.description,
  };
}

type SharePopoverInteractOutsideEvent = Parameters<
  NonNullable<
    ComponentPropsWithoutRef<typeof PopoverContent>["onInteractOutside"]
  >
>[0];

function isShareNestedOverlayTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(`[${SHARE_NESTED_OVERLAY_ATTR}]`) !== null
  );
}

function handleSharePopoverInteractOutside(
  event: SharePopoverInteractOutsideEvent,
) {
  const originalTarget = event.detail.originalEvent.target;
  if (isShareNestedOverlayTarget(originalTarget)) {
    event.preventDefault();
  }
}

export function ShareButton(props: ShareButtonProps) {
  const t = useT();
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  useEffect(() => {
    if (!props.mobileSheet) return;
    const media = window.matchMedia("(max-width: 639px)");
    const update = () => setIsSmallScreen(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [props.mobileSheet]);
  const controller = useShareButtonController({
    resourceType: props.resourceType,
    resourceId: props.resourceId,
    defaultOpen: props.defaultOpen,
    onOpenChange: props.onOpenChange,
    onShareSuccess: props.onShareSuccess,
    shareTabs: props.shareTabs,
    shareUrl: props.shareUrl,
    allowedRoles: allowedRolesFor(props),
    hideInSearchControl: props.hideInSearchControl,
  });
  useImperativeHandle(
    props.actionRef,
    () => ({
      open: (tab) => {
        controller.handleOpenChange(true);
        if (tab) controller.handleShareTabChange(tab);
      },
    }),
    [controller.handleOpenChange, controller.handleShareTabChange],
  );
  useEffect(() => {
    const actionEvent = props.actionEvent;
    if (!actionEvent) return;
    const openFromAction = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: unknown }>).detail.tab;
      controller.handleOpenChange(true);
      if (typeof tab === "string") controller.handleShareTabChange(tab);
    };
    window.addEventListener(actionEvent, openFromAction);
    return () => window.removeEventListener(actionEvent, openFromAction);
  }, [
    props.actionEvent,
    controller.handleOpenChange,
    controller.handleShareTabChange,
  ]);
  const triggerLabel = t("agentChat.share.share", { defaultValue: "Share" });
  const trigger = (
    <ShareTrigger
      label={
        props.quickCopy ? (
          <span className="flex items-center gap-2">
            <IconUserPlus aria-hidden="true" />
            <span>{props.triggerContent ?? triggerLabel}</span>
          </span>
        ) : (
          (props.triggerContent ?? triggerLabel)
        )
      }
      className={props.triggerClassName}
      aria-label={triggerLabel}
      title={triggerLabel}
      intent={props.quickCopy ? "primary" : undefined}
      emphasis={props.quickCopy ? "solid" : undefined}
    />
  );
  if (isSmallScreen) {
    return (
      <Sheet open={controller.open} onOpenChange={controller.handleOpenChange}>
        {props.hideTrigger ? null : props.quickCopy ? (
          <JoinedShareControl
            trigger={<SheetTrigger asChild>{trigger}</SheetTrigger>}
            copyLabel={props.quickCopy.label}
            copiedLabel={props.quickCopy.copiedLabel}
            onCopy={props.quickCopy.onCopy}
            size={props.quickCopy.size}
            className={props.quickCopy.className}
          />
        ) : (
          <SheetTrigger asChild>{trigger}</SheetTrigger>
        )}
        <SheetContent
          data-agent-native-share-overlay=""
          side="bottom"
          showClose={false}
          overlayClassName="z-[1999]"
          className="z-[2000] max-h-[90dvh] overflow-y-auto rounded-t-2xl p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={handleSharePopoverInteractOutside}
        >
          <SheetTitle className="sr-only">{triggerLabel}</SheetTitle>
          <div
            aria-hidden="true"
            className="mx-auto mb-4 h-1 w-9 rounded-full bg-muted-foreground/40"
          />
          <SharePanel {...props} controller={controller} />
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Popover open={controller.open} onOpenChange={controller.handleOpenChange}>
      {props.hideTrigger ? (
        <PopoverAnchor asChild>
          <span aria-hidden="true" className="fixed end-4 top-16 size-px" />
        </PopoverAnchor>
      ) : props.quickCopy ? (
        <PopoverAnchor asChild>
          <JoinedShareControl
            trigger={<PopoverTrigger asChild>{trigger}</PopoverTrigger>}
            copyLabel={props.quickCopy.label}
            copiedLabel={props.quickCopy.copiedLabel}
            onCopy={props.quickCopy.onCopy}
            size={props.quickCopy.size}
            className={props.quickCopy.className}
          />
        </PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      )}
      <PopoverContent
        align="end"
        sideOffset={6}
        data-agent-native-share-overlay=""
        className={cn(
          "z-[2000] w-[384px] max-w-[calc(100vw-1rem)] rounded-lg p-4 shadow-lg",
          SHARE_POPOVER_SURFACE,
          props.popoverClassName,
        )}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={handleSharePopoverInteractOutside}
      >
        <SharePanel {...props} controller={controller} />
      </PopoverContent>
    </Popover>
  );
}

function SharePanel(
  props: ShareButtonProps & {
    controller: ShareButtonController;
  },
) {
  const t = useT();
  const { controller } = props;
  const {
    activeShareTab,
    handleShareTabChange,
    data,
    visibility,
    canManage,
    shareError,
    handleHideInSearch,
  } = controller;

  const loadFailed = controller.sharesQuery.isError && data === undefined;
  const isLoading = !loadFailed && data === undefined;
  const peopleAccessLabel =
    props.peopleAccessLabel ??
    t("agentChat.share.peopleWithAccess", {
      defaultValue: "People with access",
    });
  const generalAccessLabel =
    props.generalAccessLabel ??
    t("agentChat.share.generalAccess", { defaultValue: "General access" });
  const accessRequests =
    canManage && !props.basicSharingOnly ? (
      <AccessRequestsSection
        resourceType={props.resourceType}
        resourceId={props.resourceId}
      />
    ) : null;
  const footer = (
    <ShareFooter
      {...props}
      agentReadable={
        !props.basicSharingOnly && !loadFailed && data?.agentReadable === true
      }
      agentRead={loadFailed ? undefined : data?.agentRead}
    />
  );
  const extraTabs = props.shareTabs?.tabs ?? [];
  const hasTabs = extraTabs.length > 0;
  const shareTabLabel =
    props.shareTabs?.shareLabel ??
    t("agentChat.share.shareLink", { defaultValue: "Share link" });

  const sharePanel = loadFailed ? (
    <div className="flex flex-col gap-4">
      <div
        role="alert"
        className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
      >
        <span className="text-xs text-muted-foreground">
          {t("agentChat.share.loadFailed", {
            defaultValue: "Couldn't load sharing settings.",
          })}
        </span>
        <button
          type="button"
          onClick={() => controller.sharesQuery.refetch()}
          disabled={controller.sharesQuery.isFetching}
          className={cn(
            BUTTON_BASE,
            "h-7 px-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {t("agentChat.common.retry")}
        </button>
      </div>
      {footer}
    </div>
  ) : isLoading ? (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-9 w-full" />
      <div className="flex flex-col gap-1.5">
        <div className={SHARE_SECTION_LABEL}>{peopleAccessLabel}</div>
        <ShareRowSkeleton />
        <ShareRowSkeleton />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className={SHARE_SECTION_LABEL}>{generalAccessLabel}</div>
        <ShareRowSkeleton />
      </div>
    </div>
  ) : (
    <div className="flex flex-col gap-4">
      <SharePeopleInvite
        controller={controller}
        basicSharingOnly={props.basicSharingOnly}
        roleCopy={props.roleCopy}
        allowedRoles={allowedRolesFor(props)}
      />

      {accessRequests}

      <section className="flex flex-col gap-1.5">
        <div className={SHARE_SECTION_LABEL}>{peopleAccessLabel}</div>
        <SharePeopleList
          controller={controller}
          roleCopy={props.roleCopy}
          allowedRoles={allowedRolesFor(props)}
        />
      </section>

      {shareError && !canManage ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {shareError}
        </div>
      ) : null}

      <section className="flex flex-col gap-1.5">
        <div className={SHARE_SECTION_LABEL}>{generalAccessLabel}</div>
        <ShareGeneralAccessRow
          controller={controller}
          visibilityCopy={props.visibilityCopy}
          confirmDetail={props.visibilityConfirmDetail}
        >
          {visibility === "org" && props.hideInSearchControl ? (
            <AdvancedAccessPopover
              control={props.hideInSearchControl}
              canManage={canManage}
              onToggle={handleHideInSearch}
            />
          ) : null}
        </ShareGeneralAccessRow>
      </section>

      {props.accessNote ? (
        <div className="rounded-md border border-border bg-muted/35 p-3 text-xs text-muted-foreground">
          {props.accessNote}
        </div>
      ) : null}

      {footer}

      {props.shareFooterContent}
    </div>
  );

  const panelTitle = props.panelTitle ? (
    <h2 className="text-sm font-semibold leading-normal tracking-normal">
      {props.panelTitle}
    </h2>
  ) : null;

  if (!hasTabs) {
    return props.panelTitle ? (
      <div className="flex flex-col gap-3">
        {panelTitle}
        {sharePanel}
      </div>
    ) : (
      sharePanel
    );
  }

  const tabs = [
    {
      value: "share",
      label: shareTabLabel,
      content: sharePanel,
      disabled: false,
    },
    ...extraTabs,
  ];
  const activeTab = tabs.some((tab) => tab.value === activeShareTab)
    ? activeShareTab
    : "share";
  return (
    <div className="flex flex-col gap-3">
      {panelTitle}
      <ShareTabs
        value={activeTab}
        onValueChange={handleShareTabChange}
        listLabel={t("agentChat.share.shareOptions", {
          defaultValue: "Share options",
        })}
        tabs={tabs}
      />
    </div>
  );
}

function ShareRowSkeleton() {
  return (
    <div className="flex min-h-10 items-center gap-2.5 px-1 py-1">
      <Skeleton className="size-7 shrink-0 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-3 w-40" />
      </div>
      <Skeleton className="h-3.5 w-14" />
    </div>
  );
}

/** Copy link on the left, the Send to menu on the right. */
function ShareFooter(
  props: ShareButtonProps & {
    agentReadable: boolean;
    agentRead: ShareButtonSharesResponse["agentRead"];
  },
) {
  const t = useT();
  const sendTo = useAgentReadSendTo(props, props.agentRead);
  const showLink = props.showShareLinks ?? true;
  const copyLink =
    showLink && props.shareUrl ? (
      <CopyLinkButton
        value={props.shareUrl}
        title={props.shareUrlLabel}
        resourceType={props.resourceType}
        resourceId={props.resourceId}
      />
    ) : showLink && props.shareUrlPlaceholder ? (
      <span className="min-w-0 text-xs text-muted-foreground">
        {props.shareUrlPlaceholder}
      </span>
    ) : null;
  const hasSendTo =
    Boolean(sendTo?.openInAgent) ||
    Boolean(sendTo?.items?.length) ||
    Boolean(sendTo?.copyAgentPrompt) ||
    Boolean(sendTo?.openMcpSettings) ||
    props.agentReadable;
  if (!copyLink && !hasSendTo) return null;
  return (
    <div className="flex items-center justify-between gap-2">
      {copyLink ?? <span />}
      {hasSendTo ? (
        <ShareSendToMenu
          resourceType={props.resourceType}
          resourceId={props.resourceId}
          sendTo={sendTo}
          agentReadable={props.agentReadable}
          agentLinkLabel={
            props.agentShareLabel ??
            t("agentChat.share.copyAgentLink", {
              defaultValue: "Copy agent link",
            })
          }
        />
      ) : null}
    </div>
  );
}

/**
 * Open in Claude, Claude Code and Codex, and Copy agent prompt, for any
 * resource whose type names the MCP tool that reads it. An app that passes
 * its own agent destinations keeps them.
 */
function useAgentReadSendTo(
  props: ShareButtonProps,
  agentRead: ShareButtonSharesResponse["agentRead"],
): ShareSendTo | undefined {
  const t = useT();
  const locale = useOptionalLocale()?.locale;
  if (props.basicSharingOnly) return undefined;
  const sendTo = props.sendTo;
  if (!agentRead || sendTo?.openInAgent || sendTo?.copyAgentPrompt) {
    return sendTo;
  }
  const prompt = () => {
    const origin = window.location.origin;
    return t("agentChat.share.agentReadPrompt", {
      defaultValue:
        'Read this {{label}}: {{url}}\n\nUse an available MCP connection for {{mcpUrl}} to call {{actions}} with {{idParam}} "{{id}}". Use my account\'s existing permissions.\n\nIf that connection is missing or signed out, ask me to connect it and sign in: {{connectUrl}}. After I confirm, retry the read. If the read is denied, tell me.',
      label: agentRead.label,
      url: props.shareUrl ?? window.location.href,
      mcpUrl: new URL(appPath("/mcp"), origin).href,
      connectUrl: new URL(appPath("/mcp/connect"), origin).href,
      actions: new Intl.ListFormat(locale, { type: "disjunction" }).format(
        agentRead.actions,
      ),
      idParam: agentRead.idParam,
      id: props.resourceId,
    });
  };
  return {
    ...sendTo,
    openInAgent: (destination) => {
      trackEvent("agent_share_opened", {
        resource_type: props.resourceType,
        resource_id: props.resourceId,
        destination,
      });
      window.location.assign(buildAgentShareDeepLink(destination, prompt()));
    },
    copyAgentPrompt: async () => {
      if (!(await writeClipboardText(prompt()))) {
        toast.error(
          t("agentChat.share.copyAgentPromptFailed", {
            defaultValue: "Couldn't copy the agent prompt.",
          }),
        );
        return false;
      }
      trackEvent("share_link_copied", {
        resource_type: props.resourceType,
        resource_id: props.resourceId,
        link_type: "agent_prompt",
      });
      toast.success(
        t("agentChat.share.copiedAgentPrompt", {
          defaultValue: "Copied agent prompt",
        }),
      );
      return true;
    },
  };
}

function CopyLinkButton({
  value,
  title,
  resourceType,
  resourceId,
}: {
  value: string;
  title?: string | undefined;
  resourceType: string;
  resourceId: string;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );
  const copy = async () => {
    const ok = await writeClipboardText(value);
    if (!ok) {
      toast.error(
        t("agentChat.share.copyLinkFailed", {
          defaultValue: "Couldn't copy the link.",
        }),
      );
      return;
    }
    trackEvent("share_link_copied", {
      resource_type: resourceType,
      resource_id: resourceId,
      link_type: "share",
    });
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1600);
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      title={title}
      onClick={() => void copy()}
    >
      {copied ? (
        <IconCheck aria-hidden="true" />
      ) : (
        <IconLink aria-hidden="true" />
      )}
      {copied
        ? t("agentChat.share.copied", { defaultValue: "Copied" })
        : t("agentChat.share.copyLink", { defaultValue: "Copy link" })}
    </Button>
  );
}

type AgentLinkState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "ready"; url: string }
  | { status: "error" };

/**
 * Every way to hand this resource to something else: external agents, the
 * app's own destinations, then the copyable agent prompt and link.
 */
function ShareSendToMenu({
  resourceType,
  resourceId,
  sendTo,
  agentReadable,
  agentLinkLabel,
}: {
  resourceType: string;
  resourceId: string;
  sendTo: ShareSendTo | undefined;
  agentReadable: boolean;
  agentLinkLabel: string;
}) {
  const t = useT();
  const createAgentLink = useActionMutation<
    { contextUrl?: string },
    { resourceType: string; resourceId: string }
  >("create-agent-resource-link");
  const [agentLink, setAgentLink] = useState<AgentLinkState>({
    status: "idle",
  });
  const loadAgentLink = () => {
    setAgentLink({ status: "pending" });
    createAgentLink.mutate(
      { resourceType, resourceId },
      {
        onSuccess: (result) =>
          setAgentLink(
            result.contextUrl
              ? { status: "ready", url: result.contextUrl }
              : { status: "error" },
          ),
        onError: () => setAgentLink({ status: "error" }),
      },
    );
  };
  const copyAgentLink = async (url: string) => {
    if (!(await writeClipboardText(url))) {
      toast.error(
        t("agentChat.share.copyAgentLinkFailed", {
          defaultValue: "Couldn't copy the agent link.",
        }),
      );
      return;
    }
    trackEvent("share_link_copied", {
      resource_type: resourceType,
      resource_id: resourceId,
      link_type: "agent_context",
    });
    toast.success(
      t("agentChat.share.copiedAgentLink", {
        defaultValue: "Copied agent link",
      }),
    );
  };
  const agentDestinations: Array<{
    destination: AgentShareDestination;
    label: string;
  }> = sendTo?.openInAgent
    ? [
        {
          destination: "claude",
          label: t("agentChat.share.openInClaude", {
            defaultValue: "Open in Claude",
          }),
        },
        {
          destination: "claude-code",
          label: t("agentChat.share.openInClaudeCode", {
            defaultValue: "Open in Claude Code",
          }),
        },
        {
          destination: "codex",
          label: t("agentChat.share.openInCodex", {
            defaultValue: "Open in Codex",
          }),
        },
      ]
    : [];
  const appItems = sendTo?.items ?? [];
  const hasCopyGroup =
    Boolean(sendTo?.copyAgentPrompt) ||
    agentReadable ||
    Boolean(sendTo?.openMcpSettings);
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && agentReadable && agentLink.status === "idle") {
          loadAgentLink();
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {t("agentChat.share.sendTo", { defaultValue: "Send to" })}
          <IconChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        data-agent-native-share-overlay=""
        className={cn(SHARE_NESTED_OVERLAY_Z, "min-w-48 p-1")}
      >
        {agentDestinations.map(({ destination, label }) => (
          <DropdownMenuItem
            key={destination}
            onSelect={() => sendTo?.openInAgent?.(destination)}
          >
            {label}
          </DropdownMenuItem>
        ))}
        {agentDestinations.length > 0 && appItems.length > 0 ? (
          <DropdownMenuSeparator />
        ) : null}
        {appItems.map((item) => (
          <DropdownMenuItem
            key={item.id}
            disabled={item.disabled ?? false}
            onSelect={item.onSelect}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
        {(agentDestinations.length > 0 || appItems.length > 0) &&
        hasCopyGroup ? (
          <DropdownMenuSeparator />
        ) : null}
        {sendTo?.copyAgentPrompt ? (
          <DropdownMenuItem onSelect={() => void sendTo.copyAgentPrompt?.()}>
            {t("agentChat.share.copyAgentPrompt", {
              defaultValue: "Copy agent prompt",
            })}
          </DropdownMenuItem>
        ) : null}
        {agentReadable ? (
          <DropdownMenuItem
            disabled={agentLink.status === "pending"}
            onSelect={(event) => {
              if (agentLink.status === "ready") {
                void copyAgentLink(agentLink.url);
                return;
              }
              event.preventDefault();
              if (agentLink.status !== "pending") loadAgentLink();
            }}
          >
            {agentLink.status === "pending"
              ? t("agentChat.share.preparingAgentLink", {
                  defaultValue: "Preparing agent link...",
                })
              : agentLink.status === "error"
                ? t("agentChat.share.retryAgentLinkItem", {
                    defaultValue: "Retry agent link",
                  })
                : agentLinkLabel}
          </DropdownMenuItem>
        ) : null}
        {sendTo?.openMcpSettings ? (
          <DropdownMenuItem onSelect={() => sendTo.openMcpSettings?.()}>
            {t("agentChat.share.mcpServerSettings", {
              defaultValue: "MCP server settings",
            })}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface SharePeopleControlProps {
  controller: ShareButtonController;
  roleCopy?: ShareButtonProps["roleCopy"] | undefined;
  allowedRoles?: readonly ShareButtonRole[] | undefined;
}

/**
 * The add-people field (member and group suggestions, role, notify and
 * message) of the share panel. Renders nothing unless the user can manage
 * access. Apps that compose their own sharing surface reuse it with
 * `useShareButtonController`, next to `ShareGeneralAccessRow` and
 * `SharePeopleList`.
 */
export function SharePeopleInvite({
  controller,
  basicSharingOnly,
  roleCopy,
  allowedRoles,
}: SharePeopleControlProps & { basicSharingOnly?: boolean | undefined }) {
  const t = useT();
  const {
    inviteEmail,
    setInviteEmail: onInviteEmailChange,
    policy,
    canManage,
    role,
    setRole,
    notifyPeople,
    setNotifyPeople,
    shareMessage,
    setShareMessage,
    messageOpen,
    setMessageOpen,
    shareError,
    setShareError,
    suggestionsOpen,
    setSuggestionsOpen,
    memberSearch,
    memberSuggestions,
    groupSuggestions,
    agentSuggestions,
    selectGroup,
    selectedAgent,
    selectAgent,
    handleAdd,
    data,
  } = controller;
  const hasInviteEmail = inviteEmail.trim().length > 0;
  const orgHasAgents = (data?.agents?.length ?? 0) > 0;
  return (
    <>
      {canManage ? (
        <div className="space-y-2">
          <div className="flex items-stretch gap-1.5">
            <MemberAutocomplete
              value={inviteEmail}
              open={suggestionsOpen && !basicSharingOnly}
              onOpenChange={(open) => {
                if (!basicSharingOnly) setSuggestionsOpen(open);
              }}
              onValueChange={(next) => {
                onInviteEmailChange(next);
                if (shareError) setShareError(null);
              }}
              onSelectSuggestion={(suggestion) => {
                if (suggestion.principalType === "group") {
                  selectGroup(suggestion);
                } else if (suggestion.principalType === "agent") {
                  selectAgent(suggestion);
                } else {
                  onInviteEmailChange(suggestion.email);
                }
                setSuggestionsOpen(false);
                if (shareError) setShareError(null);
              }}
              onSubmit={handleAdd}
              placeholder={
                orgHasAgents
                  ? t("agentChat.share.addPeopleOrAgents", {
                      defaultValue: "Add people or agents",
                    })
                  : policy.requireOrgMemberForUserShares
                    ? t("agentChat.share.addPeopleOrganization", {
                        defaultValue: "Add people from your organization",
                      })
                    : t("agentChat.share.addPeopleEmail", {
                        defaultValue: policy.supportsGroupShares
                          ? "Add people or groups"
                          : "Add people by email",
                      })
              }
              suggestions={[
                ...memberSuggestions.map((member) => ({
                  ...member,
                  principalType: "user" as const,
                })),
                ...(policy.supportsGroupShares
                  ? groupSuggestions.map((group) => ({
                      ...group,
                      principalType: "group" as const,
                    }))
                  : []),
                ...agentSuggestions.map((agent) => ({
                  ...agent,
                  principalType: "agent" as const,
                })),
              ]}
              search={memberSearch}
              agentsUnavailable={data?.agentsUnavailable === true}
              trailing={
                <RoleSelect
                  value={role}
                  onChange={setRole}
                  roleCopy={roleCopy}
                  allowedRoles={allowedRoles}
                />
              }
            />
            <Button
              type="button"
              onClick={handleAdd}
              disabled={!hasInviteEmail}
              className="shrink-0"
            >
              {t("agentChat.share.invite", { defaultValue: "Invite" })}
            </Button>
          </div>
          {shareError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {shareError}
            </div>
          ) : null}
          {hasInviteEmail && !selectedAgent ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={notifyPeople}
                  onChange={(e) => setNotifyPeople(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                {t("agentChat.share.notifyPeople", {
                  defaultValue: "Notify people",
                })}
              </label>
              {notifyPeople && !basicSharingOnly ? (
                <button
                  type="button"
                  aria-expanded={messageOpen}
                  onClick={() => setMessageOpen(!messageOpen)}
                  className="rounded-sm px-1 py-0.5 font-medium text-foreground underline decoration-border underline-offset-2 transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {messageOpen
                    ? t("agentChat.share.hideMessage", {
                        defaultValue: "Hide message",
                      })
                    : t("agentChat.share.addMessage", {
                        defaultValue: "Add a message",
                      })}
                </button>
              ) : null}
            </div>
          ) : null}
          {hasInviteEmail &&
          !selectedAgent &&
          notifyPeople &&
          messageOpen &&
          !basicSharingOnly ? (
            <div className="rounded-md border border-border/70 bg-muted/20 p-2.5">
              <textarea
                aria-label={t("agentChat.share.message", {
                  defaultValue: "Message",
                })}
                placeholder={t("agentChat.share.messagePlaceholder", {
                  defaultValue: "Add a short note (optional)",
                })}
                value={shareMessage}
                onChange={(event) => setShareMessage(event.target.value)}
                maxLength={500}
                rows={3}
                className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * The owner and the people who have access, with role pickers and remove
 * buttons for managers.
 */
export function SharePeopleList({
  controller,
  roleCopy,
  allowedRoles,
}: SharePeopleControlProps) {
  const t = useT();
  const {
    data,
    canManage,
    inFlight,
    knownMembers,
    shares,
    handleChangeRole,
    handleRemove,
  } = controller;
  const ownerName = data?.ownerEmail
    ? data.ownerDisplayName?.trim() ||
      displayName(data.ownerEmail, knownMembers, t)
    : "";
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {data?.ownerEmail ? (
        <SharePrincipalRow
          avatar={
            <Avatar
              email={data.ownerEmail}
              image={memberImage(data.ownerEmail, knownMembers)}
              label={ownerName}
            />
          }
          name={ownerName}
          detail={ownerName === data.ownerEmail ? undefined : data.ownerEmail}
          marker={
            data.role === "owner"
              ? t("agentChat.share.you", { defaultValue: "you" })
              : undefined
          }
          trailing={
            <span className="px-2 text-xs text-muted-foreground">
              {t("agentChat.share.owner", { defaultValue: "Owner" })}
            </span>
          }
        />
      ) : null}
      {shares.map((s) => {
        const label = principalLabel(s, knownMembers, t);
        const busy = inFlight.has(keyOf(s));
        return (
          <SharePrincipalRow
            key={keyOf(s)}
            busy={busy}
            avatar={
              <Avatar
                email={
                  s.principalType === "user" && !s.agent
                    ? s.principalId
                    : undefined
                }
                image={
                  s.principalType === "user" && !s.agent
                    ? memberImage(s.principalId, knownMembers)
                    : undefined
                }
                label={label}
                org={s.principalType === "org"}
                group={s.principalType === "group"}
                agent={s.agent}
              />
            }
            name={label}
            badge={
              s.agent
                ? t("agentChat.share.agentBadge", { defaultValue: "Agent" })
                : undefined
            }
            detail={
              s.principalType === "group"
                ? t("agentChat.share.userGroup", {
                    defaultValue: "User group",
                  })
                : s.principalType === "user" &&
                    !s.agent &&
                    s.principalId.includes("@") &&
                    label !== s.principalId
                  ? s.principalId
                  : undefined
            }
            trailing={
              canManage ? (
                <RoleSelect
                  value={s.role}
                  onChange={(r) => handleChangeRole(s, r)}
                  onRemove={() => handleRemove(s)}
                  disabled={busy}
                  plain
                  roleCopy={roleCopy}
                  allowedRoles={allowedRoles}
                />
              ) : (
                <span className="px-2 text-xs text-muted-foreground">
                  {roleMeta(s.role, t, roleCopy).label}
                </span>
              )
            }
          />
        );
      })}
      {!shares.length && !data?.ownerEmail ? (
        <li className="px-1 py-1 text-sm text-muted-foreground">
          {t("agentChat.share.noAccess", {
            defaultValue: "No one has access yet.",
          })}
        </li>
      ) : null}
    </ul>
  );
}

function SharePrincipalRow({
  avatar,
  name,
  marker,
  badge,
  detail,
  trailing,
  busy,
}: {
  avatar: ReactNode;
  name: string;
  marker?: string | undefined;
  badge?: string | undefined;
  detail?: string | undefined;
  trailing: ReactNode;
  busy?: boolean | undefined;
}) {
  return (
    <li
      className={cn(
        "flex min-h-10 items-center gap-2.5 py-1 ps-1 text-sm",
        busy && "opacity-60",
      )}
    >
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-foreground">{name}</span>
          {marker ? (
            <span className="shrink-0 text-muted-foreground">{marker}</span>
          ) : null}
          {badge ? (
            <Badge
              variant="outline"
              size="sm"
              className="shrink-0 rounded-md text-muted-foreground"
            >
              {badge}
            </Badge>
          ) : null}
        </div>
        {detail ? (
          <div className="truncate text-xs text-muted-foreground">{detail}</div>
        ) : null}
      </div>
      {trailing}
    </li>
  );
}

function AdvancedAccessPopover({
  control,
  canManage,
  onToggle,
}: {
  control: HideInSearchControl;
  canManage: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!canManage}
          className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("agentChat.share.advanced", { defaultValue: "Advanced" })}
          <IconChevronDown size={12} strokeWidth={1.8} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        data-agent-native-share-overlay=""
        onOpenAutoFocus={(event) => event.preventDefault()}
        className={cn(
          SHARE_NESTED_OVERLAY_Z,
          "w-72 p-3 shadow-lg",
          SHARE_POPOVER_SURFACE,
        )}
      >
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium text-foreground">
              {t("agentChat.share.advancedAccess", {
                defaultValue: "Advanced access",
              })}
            </div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("agentChat.share.advancedDescription", {
                defaultValue:
                  "Control how organization access appears in search.",
              })}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={control.checked}
            disabled={!canManage || control.pending}
            onClick={onToggle}
            className={cn(
              "flex w-full items-start gap-3 rounded-md border border-border/70 bg-card px-3 py-2.5 text-start transition-colors hover:bg-accent/45 disabled:cursor-not-allowed disabled:opacity-60",
              control.checked && "border-border bg-accent/35 text-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border bg-muted-foreground/25 transition-colors",
                control.checked && "border-primary/70 bg-primary",
              )}
            >
              <span
                className={cn(
                  "ml-0.5 size-4 rounded-full bg-popover shadow-sm transition-transform",
                  control.checked && "translate-x-4",
                )}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <IconSearchOff size={14} strokeWidth={1.8} />
                {control.label ??
                  t("agentChat.share.hideInSearch", {
                    defaultValue: "Hide in search",
                  })}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                {control.description ??
                  t("agentChat.share.linkCanStillOpen", {
                    defaultValue: "People with the link can still open this.",
                  })}
              </span>
            </span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface MemberAutocompleteProps {
  value: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: string) => void;
  onSelectSuggestion: (suggestion: ShareSuggestion) => void;
  onSubmit: () => void;
  placeholder: string;
  suggestions: ShareSuggestion[];
  search: OrgMemberSearch;
  /** The org's agents could not be read, so none are suggested. */
  agentsUnavailable?: boolean;
  /** Rendered inside the field, after the input. */
  trailing?: ReactNode;
}

type ShareSuggestion =
  | (OrgMember & { principalType: "user" })
  | (ShareButtonGroup & { principalType: "group" })
  | (ShareButtonAgent & { principalType: "agent" });

function suggestionKey(suggestion: ShareSuggestion): string {
  return suggestion.principalType === "group"
    ? `group:${suggestion.id}`
    : `${suggestion.principalType}:${suggestion.email}`;
}

function MemberAutocomplete({
  value,
  open,
  onOpenChange,
  onValueChange,
  onSelectSuggestion,
  onSubmit,
  placeholder,
  suggestions,
  search,
  agentsUnavailable,
  trailing,
}: MemberAutocompleteProps) {
  const t = useT();
  const rawListboxId = useId();
  const listboxId = rawListboxId.replace(/:/g, "");
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeSuggestion =
    activeIndex >= 0 && activeIndex < suggestions.length
      ? suggestions[activeIndex]
      : null;
  const listOpen =
    open &&
    (suggestions.length > 0 ||
      search.isLoading ||
      Boolean(search.error) ||
      value.trim().length > 0);

  useEffect(() => {
    setActiveIndex(-1);
  }, [value]);

  useEffect(() => {
    if (activeIndex >= suggestions.length) {
      setActiveIndex(suggestions.length > 0 ? suggestions.length - 1 : -1);
    }
  }, [activeIndex, suggestions.length]);

  useEffect(() => {
    if (activeIndex < 0) return;
    document
      .getElementById(optionId(listboxId, activeIndex))
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listboxId]);

  const chooseSuggestion = (suggestion: ShareSuggestion) => {
    onSelectSuggestion(suggestion);
    onOpenChange(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onOpenChange(true);
      if (suggestions.length === 0) return;
      setActiveIndex((prev) => {
        if (prev >= suggestions.length - 1) {
          if (search.hasMore && !search.isLoadingMore) search.loadMore();
          return suggestions.length - 1;
        }
        return prev + 1;
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onOpenChange(true);
      if (suggestions.length === 0) return;
      setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
      return;
    }

    if (event.key === "Enter") {
      if (open && activeSuggestion) {
        event.preventDefault();
        chooseSuggestion(activeSuggestion);
        return;
      }
      if (value.trim()) {
        event.preventDefault();
        onSubmit();
      }
      return;
    }

    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      setActiveIndex(-1);
    }
  };

  const handleScroll = (event: ReactUIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    if (
      search.hasMore &&
      !search.isLoadingMore &&
      target.scrollTop + target.clientHeight >= target.scrollHeight - 24
    ) {
      search.loadMore();
    }
  };

  return (
    <Popover open={listOpen} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <div className="flex h-9 min-w-0 flex-1 items-center overflow-hidden rounded-md border border-input bg-card focus-within:ring-1 focus-within:ring-ring">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={listOpen}
            aria-controls={listOpen ? listboxId : undefined}
            aria-activedescendant={
              activeIndex >= 0 ? optionId(listboxId, activeIndex) : undefined
            }
            placeholder={placeholder}
            value={value}
            onChange={(event) => {
              onValueChange(event.target.value);
              onOpenChange(true);
            }}
            onFocus={() => onOpenChange(true)}
            onBlur={() => {
              setTimeout(() => {
                if (document.activeElement !== inputRef.current) {
                  onOpenChange(false);
                }
              }, 0);
            }}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {search.isLoading ? (
            <IconLoader2
              aria-hidden
              size={14}
              strokeWidth={1.8}
              className="me-2 shrink-0 animate-spin text-muted-foreground"
            />
          ) : null}
          {trailing}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        data-agent-native-share-overlay=""
        onOpenAutoFocus={(event) => event.preventDefault()}
        className={cn(
          SHARE_NESTED_OVERLAY_Z,
          "w-[var(--radix-popper-anchor-width)] min-w-[18rem] rounded-md p-1 shadow-lg",
          SHARE_POPOVER_SURFACE,
        )}
      >
        <div
          id={listboxId}
          role="listbox"
          className="max-h-56 overflow-y-auto overflow-x-hidden"
          onScroll={handleScroll}
        >
          {suggestions.map((suggestion, index) => {
            const active = index === activeIndex;
            return (
              <div
                key={suggestionKey(suggestion)}
                id={optionId(listboxId, index)}
                role="option"
                aria-selected={active}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => chooseSuggestion(suggestion)}
                className={cn(
                  "flex cursor-pointer select-none flex-col rounded-sm px-2 py-1.5 text-sm outline-none",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <span className="flex items-center gap-2 truncate font-medium">
                  {suggestion.principalType === "group" ? (
                    <IconUsersGroup
                      aria-hidden
                      size={14}
                      strokeWidth={1.8}
                      className="shrink-0 text-muted-foreground"
                    />
                  ) : suggestion.principalType === "agent" ? (
                    <Avatar label={suggestion.name} agent className="size-6" />
                  ) : (
                    <Avatar
                      email={suggestion.email}
                      image={suggestion.image}
                      label={suggestion.name?.trim() || suggestion.email}
                      className="size-6"
                    />
                  )}
                  <span className="truncate">
                    {suggestion.principalType === "user"
                      ? suggestion.name?.trim() || suggestion.email
                      : suggestion.name}
                  </span>
                </span>
                {suggestion.principalType === "group" ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {t("agentChat.share.userGroup", {
                      defaultValue: "User group",
                    })}
                  </span>
                ) : suggestion.principalType === "agent" ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {t("agentChat.share.agentBadge", {
                      defaultValue: "Agent",
                    })}
                  </span>
                ) : suggestion.name?.trim() ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {suggestion.email}
                  </span>
                ) : null}
              </div>
            );
          })}

          {search.isLoading && suggestions.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">
              {t("agentChat.share.searching", {
                defaultValue: "Searching...",
              })}
            </div>
          ) : null}

          {search.error ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">
              {t("agentChat.share.loadPeopleFailed", {
                defaultValue: "Could not load people.",
              })}
            </div>
          ) : null}

          {agentsUnavailable ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">
              {t("agentChat.share.loadAgentsFailed", {
                defaultValue: "Could not load agents.",
              })}
            </div>
          ) : null}

          {!search.isLoading && !search.error && suggestions.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">
              {t("agentChat.share.noMatches", {
                defaultValue: "No matches.",
              })}
            </div>
          ) : null}

          {search.isLoadingMore ? (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <IconLoader2
                aria-hidden
                size={14}
                strokeWidth={1.8}
                className="animate-spin"
              />
              {t("agentChat.share.loading", { defaultValue: "Loading..." })}
            </div>
          ) : null}

          {search.hasMore && !search.isLoadingMore ? (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={search.loadMore}
              className="mt-1 flex w-full items-center justify-center rounded-sm px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {t("agentChat.share.loadMore", { defaultValue: "Load more" })}
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function optionId(baseId: string, index: number): string {
  return `${baseId}-option-${index}`;
}

const selectContentClass = `${SHARE_NESTED_OVERLAY_Z} min-w-[12rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0`;
const selectItemClass =
  "relative flex w-full cursor-pointer select-none items-start gap-2 rounded-sm py-1.5 ps-8 pe-3 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

interface ShadSelectItemProps {
  value: string;
  label: string;
  description?: string;
}

function SelectItems({ items }: { items: ShadSelectItemProps[] }) {
  return (
    <>
      {items.map((it) => (
        <Select.Item
          key={it.value}
          value={it.value}
          className={selectItemClass}
        >
          <span className="absolute start-2 top-1.5 flex h-4 w-4 items-center justify-center">
            <Select.ItemIndicator>
              <IconCheck size={14} />
            </Select.ItemIndicator>
          </span>
          <span className="flex flex-col">
            <Select.ItemText>{it.label}</Select.ItemText>
            {it.description ? (
              <span className="text-xs text-muted-foreground">
                {it.description}
              </span>
            ) : null}
          </span>
        </Select.Item>
      ))}
    </>
  );
}

const REMOVE_ACCESS_VALUE = "__remove";

function RoleSelect(props: {
  value: Role;
  onChange: (v: Role) => void;
  /** Adds Remove access below the roles. */
  onRemove?: () => void;
  disabled?: boolean;
  plain?: boolean;
  roleCopy?: ShareButtonProps["roleCopy"];
  allowedRoles?: ShareButtonProps["allowedRoles"];
}) {
  const t = useT();
  const allOptions = roleOptions(t);
  const current = roleMeta(props.value, t, props.roleCopy);
  const allowedRoles =
    props.allowedRoles ?? allOptions.map((item) => item.value);
  const options = allOptions
    .filter(
      (option) =>
        option.value === props.value || allowedRoles.includes(option.value),
    )
    .map((option) => roleMeta(option.value, t, props.roleCopy));
  return (
    <Select.Root
      value={props.value}
      onValueChange={(v) => {
        if (v === REMOVE_ACCESS_VALUE) props.onRemove?.();
        else props.onChange(v as Role);
      }}
      disabled={props.disabled}
    >
      <Select.Trigger
        className={
          props.plain
            ? cn(
                BUTTON_BASE,
                "h-7 gap-1 px-2 bg-transparent text-xs font-normal text-muted-foreground hover:bg-accent hover:text-accent-foreground [&_svg]:size-3.5",
              )
            : cn(
                BUTTON_BASE,
                "h-full gap-1 rounded-none bg-transparent px-2 text-xs font-normal text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-inset focus-visible:ring-offset-0 [&_svg]:size-3.5",
              )
        }
        aria-label={t("agentChat.share.role", { defaultValue: "Role" })}
      >
        <Select.Value>{current.label}</Select.Value>
        <Select.Icon>
          <IconChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          data-agent-native-share-overlay=""
          className={selectContentClass}
          position="popper"
          sideOffset={4}
        >
          <Select.Viewport>
            <SelectItems items={options} />
            {props.onRemove ? (
              <>
                <Select.Separator className="-mx-1 my-1 h-px bg-border" />
                <SelectItems
                  items={[
                    {
                      value: REMOVE_ACCESS_VALUE,
                      label: t("agentChat.share.removeAccess", {
                        defaultValue: "Remove access",
                      }),
                    },
                  ]}
                />
              </>
            ) : null}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export interface ShareGeneralAccessRowProps {
  controller: Pick<
    ShareButtonController,
    | "visibility"
    | "canManage"
    | "policy"
    | "handleVisibility"
    | "visibilityTransition"
  >;
  visibilityCopy?: ShareButtonProps["visibilityCopy"];
  /** Show the description in the trigger instead of the label. */
  sentenceTrigger?: boolean;
  /** Resource-specific text added to the organization confirmation. */
  confirmDetail?: ReactNode;
  /** Opens the access menu from elsewhere in the panel; leave unset otherwise. */
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  /** Shown beside the access control, such as an advanced-access popover. */
  children?: ReactNode;
}

/**
 * The "general access" control of the share panel: the visibility picker and
 * the confirmation shown before a resource opens to the organization. Apps
 * that compose their own sharing surface (Clips) reuse it with
 * `useShareButtonController` so the confirmation stays the same everywhere.
 */
export function ShareGeneralAccessRow({
  controller,
  visibilityCopy,
  sentenceTrigger,
  confirmDetail,
  menuOpen,
  onMenuOpenChange,
  children,
}: ShareGeneralAccessRowProps) {
  const t = useT();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const organizationName = controller.visibilityTransition.organizationName;
  const meta = visibilityMeta(
    controller.visibility,
    t,
    visibilityCopy,
    organizationName,
  );
  return (
    <div className="flex min-h-10 items-center gap-2.5 py-1 ps-1">
      <span
        aria-hidden
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <meta.Icon size={14} strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <VisibilitySelect
          value={controller.visibility}
          onChange={controller.handleVisibility}
          disabled={
            !controller.canManage || controller.visibilityTransition.submitting
          }
          sentenceTrigger={sentenceTrigger}
          visibilityCopy={visibilityCopy}
          organizationName={organizationName}
          allowPublic={controller.policy.allowPublic}
          triggerRef={triggerRef}
          open={menuOpen}
          onOpenChange={onMenuOpenChange}
        />
        {!sentenceTrigger ? (
          <span className="sr-only">{meta.description}</span>
        ) : null}
        {children ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {children}
          </div>
        ) : null}
      </div>
      {controller.visibility !== "private" && !sentenceTrigger ? (
        <span className="shrink-0 px-2 text-xs text-muted-foreground">
          {t("agentChat.share.canView", { defaultValue: "Can view" })}
        </span>
      ) : null}
      <ShareVisibilityConfirmDialog
        transition={controller.visibilityTransition}
        detail={confirmDetail}
        returnFocusRef={triggerRef}
      />
    </div>
  );
}

function VisibilitySelect(props: {
  value: Visibility;
  onChange: (v: Visibility) => void;
  disabled?: boolean;
  sentenceTrigger?: boolean;
  visibilityCopy?: ShareButtonProps["visibilityCopy"];
  organizationName?: string | null;
  allowPrivate?: boolean;
  allowPublic?: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const allowPrivate = props.allowPrivate !== false;
  const allowPublic = props.allowPublic !== false;
  const metaFor = (visibility: Visibility) =>
    visibilityMeta(visibility, t, props.visibilityCopy, props.organizationName);
  const current = metaFor(props.value);
  const options = (Object.keys(VIS_META) as Visibility[]).filter((k) => {
    if (k === props.value) return true;
    if (k === "private" && !allowPrivate) return false;
    if (k === "public" && !allowPublic) return false;
    return true;
  });
  return (
    <Select.Root
      value={props.value}
      onValueChange={(v) => props.onChange(v as Visibility)}
      disabled={props.disabled}
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <Select.Trigger
        ref={props.triggerRef}
        className={cn(
          BUTTON_BASE,
          "h-7 max-w-full px-1.5 -ms-1.5 bg-transparent font-normal text-foreground hover:bg-accent hover:text-accent-foreground",
          props.sentenceTrigger && "w-full justify-between text-sm font-normal",
        )}
        aria-label={t("agentChat.share.generalAccess", {
          defaultValue: "General access",
        })}
      >
        <span className="truncate">
          <Select.Value>
            {props.sentenceTrigger ? current.description : current.label}
          </Select.Value>
        </span>
        <Select.Icon>
          <IconChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          data-agent-native-share-overlay=""
          className={selectContentClass}
          position="popper"
          sideOffset={4}
          // Runs after the item has selected. Enter may open a confirmation
          // that takes focus; its keypress must not land on the button there.
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        >
          <Select.Viewport>
            <SelectItems
              items={options.map((k) => ({
                value: k,
                label: metaFor(k).label,
              }))}
            />
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function Avatar({
  email,
  image,
  label,
  org,
  group,
  agent,
  className,
}: {
  email?: string | undefined;
  image?: string | null | undefined;
  label: string;
  org?: boolean | undefined;
  group?: boolean | undefined;
  /** Agents get a square avatar so they read apart from people. */
  agent?: boolean | undefined;
  className?: string | undefined;
}) {
  const profileImage = image?.trim();
  const avatarUrl = useAvatarUrl(profileImage ? undefined : email);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center overflow-hidden bg-muted text-xs font-semibold text-muted-foreground",
        agent ? "rounded-md" : "rounded-full",
        className,
      )}
    >
      {org || group ? (
        <IconUsersGroup size={12} strokeWidth={1.75} />
      ) : profileImage || avatarUrl ? (
        <img
          src={profileImage || avatarUrl || undefined}
          alt=""
          className="size-full object-cover"
        />
      ) : (
        initials(label)
      )}
    </span>
  );
}

function keyOf(s: Share): string {
  return `${s.principalType}:${s.principalId}`;
}

function initials(s: string): string {
  const name = s.split("@")[0] ?? s;
  return (name[0] ?? "?").toUpperCase();
}

function principalLabel(
  share: Share,
  members: OrgMember[],
  t: ShareTranslate,
): string {
  const serverLabel = share.displayName?.trim();
  if (serverLabel) return serverLabel;
  if (share.principalType === "org")
    return t("agentChat.share.organization", {
      defaultValue: "Organization",
    });
  if (share.principalType === "group")
    return (
      serverLabel ||
      t("agentChat.share.userGroup", { defaultValue: "User group" })
    );
  return displayName(share.principalId, members, t);
}

function displayName(
  emailOrId: string,
  members: OrgMember[],
  t: ShareTranslate,
): string {
  const normalized = emailOrId.trim().toLowerCase();
  const match = members.find((m) => m.email.toLowerCase() === normalized);
  if (match?.name && match.name.trim()) return match.name;
  return normalized.includes("@")
    ? emailOrId
    : t("agentChat.share.unknownPerson", {
        defaultValue: "Unknown person",
      });
}

function memberImage(email: string, members: OrgMember[]): string | undefined {
  const normalized = email.trim().toLowerCase();
  const match = members.find(
    (member) => member.email.trim().toLowerCase() === normalized,
  );
  return match?.image?.trim() || undefined;
}
