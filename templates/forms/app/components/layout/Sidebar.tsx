import { useState, useRef, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ArrowUp, FileText, Plus } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useForms, useCreateForm } from "@/hooks/use-forms";
import { useSendToAgentChat } from "@agent-native/core/client";
import { cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  draft: "text-amber-500",
  published: "text-emerald-500",
  closed: "text-muted-foreground/50",
};

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: forms = [] } = useForms();
  const createForm = useCreateForm();
  const { send } = useSendToAgentChat();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (popoverOpen) {
      setPrompt("");
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [popoverOpen]);

  function handleSkip() {
    setPopoverOpen(false);
    createForm.mutate(
      { title: "Untitled Form" },
      { onSuccess: (form) => navigate(`/forms/${form.id}`) },
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
      <button className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground">
        <Plus size={14} className="shrink-0" />
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
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmitPrompt();
            }
          }}
          placeholder="Describe your form..."
          className="mt-2 w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground/50 focus:outline-none"
          rows={4}
        />
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
        <div />
        <div className="flex items-center gap-3">
          <button
            className="text-xs text-blue-400 hover:text-blue-300"
            onClick={handleSkip}
          >
            Skip prompt
          </button>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted hover:bg-accent disabled:opacity-30"
            onClick={handleSubmitPrompt}
            disabled={!prompt.trim()}
            aria-label="Send prompt"
          >
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </PopoverContent>
  );

  return (
    <div className="flex h-screen w-60 flex-col border-r border-border bg-muted/30">
      {/* Header */}
      <div className="flex h-12 items-center border-b border-border px-4">
        <Link
          to="/forms"
          className="text-base font-semibold tracking-tight text-foreground hover:text-foreground/80"
        >
          Forms
        </Link>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-2">
          {forms.map((form) => {
            const isActive =
              location.pathname === `/forms/${form.id}` ||
              location.pathname === `/forms/${form.id}/responses`;
            return (
              <Link
                key={form.id}
                to={`/forms/${form.id}`}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <FileText
                  size={14}
                  className={cn(
                    "shrink-0",
                    isActive
                      ? "text-accent-foreground"
                      : statusColors[form.status],
                  )}
                />
                <span className="truncate">
                  {form.title || "Untitled Form"}
                </span>
              </Link>
            );
          })}

          {/* New form button — under the list */}
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            {newFormButton}
            {newFormPopover}
          </Popover>
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="flex items-center justify-end border-t border-border px-3 py-2">
        <ThemeToggle />
      </div>
    </div>
  );
}
