import {
  focusAgentChat,
  navigateWithAgentChatViewTransition,
  useSendToAgentChat,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  AppSidebar,
  FeedbackButton,
  type AppSidebarItemDefinition,
} from "@agent-native/core/client/ui";
import {
  IconArrowUp,
  IconForms,
  IconMenu2,
  IconMessageCircle,
  IconPlus,
  IconSettings,
} from "@tabler/icons-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAgentPromptRun } from "@/hooks/use-agent-prompt-run";
import { useCreateForm } from "@/hooks/use-forms";
import { useIsMobile } from "@/hooks/use-mobile";

const SIDEBAR_COLLAPSE_KEY = "forms.sidebar.collapsed";

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const createForm = useCreateForm();
  const { send } = useSendToAgentChat();
  const promptRun = useAgentPromptRun({
    staleMessage: t("sidebar.formGenerationStale"),
  });
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (popoverOpen) {
      setPrompt("");
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [popoverOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // coercion-ok: storage failures are tolerated; fallback to in-memory preference
    }
  }, [collapsed]);

  function handleSubmitPrompt() {
    const trimmed = prompt.trim();
    if (!trimmed || promptRun.isActivePrompt(trimmed)) return;
    setPopoverOpen(false);
    const tabId = send({
      message: `Create a new form based on this description: ${trimmed}`,
      context:
        "Create the form using the create-form script with appropriate title, description, and fields. After creating, tell the user the form name and a summary of the fields.",
    });
    promptRun.trackRun(trimmed, tabId);
  }

  function handleSkip() {
    setPopoverOpen(false);
    createForm.mutate(
      { title: t("sidebar.untitledForm") },
      { onSuccess: (form) => navigate(`/forms/${form.id}`) },
    );
  }

  function navigateHomeChat(event: MouseEvent) {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    if (isMobile) setMobileOpen(false);
    focusAgentChat();
    navigateWithAgentChatViewTransition(navigate, "/ask");
  }

  const items: AppSidebarItemDefinition[] = [
    {
      to: "/ask",
      label: t("navigation.askForms"),
      icon: IconMessageCircle,
      active: location.pathname === "/ask" || location.pathname === "/home",
      onClick: navigateHomeChat,
    },
    {
      to: "/forms",
      label: t("navigation.allForms"),
      icon: IconForms,
      active: location.pathname.startsWith("/forms"),
      onClick: () => isMobile && setMobileOpen(false),
    },
  ];

  const secondaryItems: AppSidebarItemDefinition[] = [
    {
      to: "/settings",
      label: t("navigation.settings"),
      icon: IconSettings,
      active: location.pathname === "/settings",
      onClick: () => isMobile && setMobileOpen(false),
    },
  ];

  const newFormPopoverContent = (
    <PopoverContent
      side="right"
      align="start"
      sideOffset={8}
      className="forms-new-form-popover w-80 rounded-2xl p-0"
    >
      <div className="p-4 pb-3">
        <p className="text-sm font-semibold">{t("sidebar.newForm")}</p>
        <Textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleSubmitPrompt();
            }
          }}
          placeholder={t("sidebar.describeFormPlaceholder")}
          className="mt-2 w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground/50 border-none shadow-none"
          rows={3}
        />
        <div className="mt-3 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={handleSkip}
          >
            {t("sidebar.skipPrompt")}
          </Button>
          <span className="text-[11px] text-muted-foreground/50">
            {typeof navigator !== "undefined" &&
            /Mac|iPod|iPhone|iPad/.test(navigator.platform)
              ? "⌘"
              : "Ctrl"}{" "}
            {t("sidebar.submitShortcutSuffix")}
          </span>
          <Button
            variant="secondary"
            size="icon"
            className="size-10 rounded-lg transition-[background-color,box-shadow,transform] active:scale-[0.96] motion-reduce:active:scale-100"
            onClick={handleSubmitPrompt}
            disabled={!prompt.trim() || promptRun.isActivePrompt(prompt)}
            aria-label={t("sidebar.sendPrompt")}
          >
            <IconArrowUp size={14} />
          </Button>
        </div>
      </div>
    </PopoverContent>
  );

  const effectiveCollapsed = collapsed && !isMobile;

  const newFormItem = effectiveCollapsed ? (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t("sidebar.newForm")}
              className="flex size-9 items-center justify-center rounded-md text-primary hover:bg-accent/60 hover:text-primary"
            >
              <IconPlus className="size-4 shrink-0 text-primary" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{t("sidebar.newForm")}</TooltipContent>
      </Tooltip>
      {newFormPopoverContent}
    </Popover>
  ) : (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <div className="group flex items-center rounded text-primary hover:bg-accent/60 cursor-pointer">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-xs text-primary"
          >
            <IconPlus className="size-4 shrink-0 text-primary" />
            <span className="flex-1 truncate text-start text-primary">
              {t("sidebar.newForm")}
            </span>
          </button>
        </div>
      </PopoverTrigger>
      {newFormPopoverContent}
    </Popover>
  );

  const feedbackButton = (
    <FeedbackButton
      variant={effectiveCollapsed ? "icon" : "sidebar"}
      side="right"
    />
  );

  const orgSwitcher = <OrgSwitcher compact={effectiveCollapsed} />;

  const sidebarElement = (
    <AppSidebar
      collapsed={effectiveCollapsed}
      onCollapsedChange={setCollapsed}
      brandName={t("navigation.brand")}
      brandHref="/forms"
      items={items}
      secondaryItems={secondaryItems}
      feedback={feedbackButton}
      orgSwitcher={orgSwitcher}
      isMobile={isMobile}
      mobileOpen={mobileOpen}
    >
      {newFormItem}
    </AppSidebar>
  );

  return (
    <>
      <div className="fixed top-2.5 start-2.5 z-40 md:hidden">
        <Button
          variant="ghost"
          size="icon"
          className="size-10 rounded-lg active:scale-[0.96] transition-[background-color,box-shadow,transform]"
          onClick={() => setMobileOpen(true)}
          aria-label={t("sidebar.openSidebar")}
        >
          <IconMenu2 size={20} />
        </Button>
      </div>

      {mobileOpen && (
        <div
          // guard:allow-raw-color — backdrop overlay
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {sidebarElement}
    </>
  );
}
