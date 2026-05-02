import { useState, useRef, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  IconUsers,
  IconArrowUp,
  IconPlus,
  IconMenu2,
  IconX,
} from "@tabler/icons-react";
import { OrgSwitcher } from "@agent-native/core/client/org";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useForms, useCreateForm } from "@/hooks/use-forms";
import { useSendToAgentChat, FeedbackButton } from "@agent-native/core/client";
import { ToolsSidebarSection } from "@agent-native/core/client/tools";
import { Textarea } from "@/components/ui/textarea";
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
  const { data: formsData, isLoading: formsLoading } = useForms();
  const forms = Array.isArray(formsData) ? formsData : [];
  const createForm = useCreateForm();
  const { send } = useSendToAgentChat();
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
      { title: "Untitled Form" },
      { onSuccess: (form) => navigate(`/forms/${form.id}`, { replace: true }) },
    );
  }

  function handleSubmitPrompt() {
    if (!prompt.trim()) return;
    setPopoverOpen(false);
    send({
      message: `Create a new form based on this description: ${prompt.trim()}`,
      context:
        "Create the form using the create-form script with appropriate title, description, and fields. After creating, tell the user the form name and a summary of the fields.",
    });
  }

  const newFormButton = (
    <PopoverTrigger asChild>
      <button className="cursor-pointer flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground min-h-[44px]">
        <IconPlus size={14} className="shrink-0" />
        <span>New form</span>
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
        <p className="text-sm font-semibold">New form</p>
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
          placeholder="Describe your form..."
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
            Skip prompt
          </Button>
          <span className="text-[11px] text-muted-foreground/70">
            {/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"}
            +Enter to submit
          </span>
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7"
            onClick={handleSubmitPrompt}
            disabled={!prompt.trim()}
            aria-label="Send prompt"
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
        "flex h-screen w-60 flex-col border-r border-border bg-muted/30",
        isMobile && "w-full",
      )}
    >
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <Link
          to="/forms"
          className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground hover:text-foreground/80"
          onClick={() => isMobile && setMobileOpen(false)}
        >
          <img
            src="/agent-native-icon-light.svg"
            alt=""
            aria-hidden="true"
            className="block h-4 w-auto shrink-0 dark:hidden"
          />
          <img
            src="/agent-native-icon-dark.svg"
            alt=""
            aria-hidden="true"
            className="hidden h-4 w-auto shrink-0 dark:block"
          />
          Forms
        </Link>
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

      <ScrollArea className="flex-1">
        <div className="py-2">
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
                  "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm min-h-[44px]",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    isActive ? "bg-accent-foreground" : statusDots[form.status],
                  )}
                />
                <span className="truncate">
                  {form.title || "Untitled Form"}
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
      <div className="px-3 pt-2">
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
          <span>Team</span>
        </Link>
      </div>

      {/* Tools */}
      <div className="px-3 pt-2">
        <ToolsSidebarSection />
      </div>

      {/* Footer */}
      <div className="border-t border-border px-3 py-2 space-y-2 mt-2">
        <FeedbackButton />
        <OrgSwitcher />
        <div className="flex items-center justify-end">
          <ThemeToggle />
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
          className="fixed top-2 left-2 z-40 h-10 w-10 md:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label="Open sidebar"
        >
          <IconMenu2 size={20} />
        </Button>
        {mobileOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setMobileOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw]">
              {sidebarContent}
            </div>
          </>
        )}
      </>
    );
  }

  return sidebarContent;
}
