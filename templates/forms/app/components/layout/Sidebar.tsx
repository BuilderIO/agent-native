import {
  useSendToAgentChat,
  DevDatabaseLink,
  FeedbackButton,
  appPath,
  focusAgentChat,
  navigateWithAgentChatViewTransition,
  useT,
} from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  IconUsers,
  IconArrowUp,
  IconPlus,
  IconMenu2,
  IconX,
  IconMessageCircle,
  IconSettings,
} from "@tabler/icons-react";
import { useState, useRef, useEffect, type MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAgentPromptRun } from "@/hooks/use-agent-prompt-run";
import { useForms, useCreateForm } from "@/hooks/use-forms";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const statusDots: Record<string, string> = {
  draft: "bg-amber-500",
  published: "bg-emerald-500",
  closed: "bg-muted-foreground/50",
};

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const { data: formsData, isLoading: formsLoading } = useForms();
  const forms = Array.isArray(formsData) ? formsData : [];
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

  useEffect(() => {
    if (popoverOpen) {
      setPrompt("");
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [popoverOpen]);

  function handleSkip() {
    setPopoverOpen(false);
    const tempId = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    navigate(`/forms/${tempId}`);
    createForm.mutate(
      { title: t("sidebar.untitledForm") },
      { onSuccess: (form) => navigate(`/forms/${form.id}`, { replace: true }) },
    );
  }

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

  function navigateHomeChat(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (isMobile) setMobileOpen(false);
    focusAgentChat();
    navigateWithAgentChatViewTransition(navigate, "/");
  }

  function toggleLogoView() {
    if (isMobile) setMobileOpen(false);
    focusAgentChat();
    navigateWithAgentChatViewTransition(navigate, "/");
  }

  const newFormButton = (
    <PopoverTrigger asChild>
      <button className="cursor-pointer flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground min-h-[44px]">
        <IconPlus size={14} className="shrink-0" />
        <span>{t("sidebar.newForm")}</span>
      </button>
    </PopoverTrigger>
  );

  const newFormPopover = (
    <PopoverContent
      side="right"
      align="start"
      sideOffset={8}
      className="w-80 p-0 rounded-xl"
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
          rows={4}
        />
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
        <div />
        <div className="flex items-center gap-3">
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-muted-foreground"
            onClick={handleSkip}
          >
            {t("sidebar.skipPrompt")}
          </Button>
          <span className="text-[11px] text-muted-foreground/70">
            {/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"}
            {t("sidebar.submitShortcutSuffix")}
          </span>
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7"
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

  const sidebarContent = (
    <div
      className={cn(
        "flex h-screen w-60 min-w-0 shrink-0 flex-col overflow-hidden border-e border-border bg-muted/30",
        isMobile && "w-full",
      )}
    >
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <TooltipProvider delayDuration={700}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("sidebar.openAskFullScreen")}
                className="flex min-w-0 items-center gap-2 rounded-md text-base font-semibold tracking-tight text-foreground transition-colors hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={toggleLogoView}
              >
                <img
                  src={appPath("/agent-native-icon-light.svg")}
                  alt=""
                  aria-hidden="true"
                  className="block h-4 w-auto shrink-0 dark:hidden"
                />
                <img
                  src={appPath("/agent-native-icon-dark.svg")}
                  alt=""
                  aria-hidden="true"
                  className="hidden h-4 w-auto shrink-0 dark:block"
                />
                <span className="truncate">{t("navigation.brand")}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t("sidebar.openAskFullScreen")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMobileOpen(false)}
          >
            <IconX size={18} />
          </Button>
        )}
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div
          className={cn(
            "min-w-0 max-w-full overflow-hidden py-2",
            isMobile ? "w-full" : "w-60",
          )}
        >
          <Link
            to="/"
            onClick={navigateHomeChat}
            className={cn(
              "flex w-full min-w-0 max-w-full items-center gap-2.5 overflow-hidden rounded-md px-3 py-2 text-sm min-h-[44px]",
              location.pathname === "/"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <IconMessageCircle size={14} className="shrink-0" />
            <span className="min-w-0 flex-1 basis-0 truncate">
              {t("navigation.askForms")}
            </span>
          </Link>

          {formsLoading && forms.length === 0
            ? Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 min-h-[44px]"
                >
                  <Skeleton className="h-1.5 w-1.5 shrink-0 rounded-full" />
                  <Skeleton
                    className="h-3.5"
                    style={{ width: `${50 + ((i * 17) % 40)}%` }}
                  />
                </div>
              ))
            : null}
          {forms.map((form) => {
            const isActive =
              location.pathname === `/forms/${form.id}` ||
              location.pathname === `/forms/${form.id}/responses`;
            return (
              <Link
                key={form.id}
                to={`/forms/${form.id}`}
                onClick={() => isMobile && setMobileOpen(false)}
                className={cn(
                  "flex w-full min-w-0 max-w-full items-center gap-2.5 overflow-hidden rounded-md px-3 py-2 text-sm min-h-[44px]",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
                title={form.title || t("sidebar.untitledForm")}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    isActive ? "bg-accent-foreground" : statusDots[form.status],
                  )}
                />
                <span className="min-w-0 flex-1 basis-0 truncate">
                  {form.title || t("sidebar.untitledForm")}
                </span>
              </Link>
            );
          })}

          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            {newFormButton}
            {newFormPopover}
          </Popover>
        </div>
      </ScrollArea>

      {/* Pinned nav + footer */}
      <div className="shrink-0 border-t border-border px-3 py-1.5">
        <Link
          to="/settings"
          onClick={() => isMobile && setMobileOpen(false)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm min-h-[44px]",
            location.pathname === "/settings"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          <IconSettings size={14} className="shrink-0" />
          <span>{t("navigation.settings")}</span>
        </Link>
        <Link
          to="/team"
          onClick={() => isMobile && setMobileOpen(false)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm min-h-[44px]",
            location.pathname === "/team"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          <IconUsers size={14} className="shrink-0" />
          <span>{t("navigation.team")}</span>
        </Link>
      </div>

      {/* Tools */}
      <div className="shrink-0 border-t border-border px-1.5 py-1.5">
        <ExtensionsSidebarSection />
      </div>

      {/* Footer */}
      <div className="shrink-0 space-y-2 border-t border-border px-3 py-2">
        <OrgSwitcher />
        <DevDatabaseLink />
        <div className="flex items-center gap-2">
          <FeedbackButton className="min-w-0 flex-1" />
          <ThemeToggle className="h-9 w-9 shrink-0" />
        </div>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          className="fixed top-2 start-2 z-40 h-10 w-10 md:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label={t("sidebar.openSidebar")}
        >
          <IconMenu2 size={20} />
        </Button>
        {mobileOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setMobileOpen(false)}
            />
            <div className="fixed inset-y-0 start-0 z-50 w-72 max-w-[85vw]">
              {sidebarContent}
            </div>
          </>
        )}
      </>
    );
  }

  return sidebarContent;
}
