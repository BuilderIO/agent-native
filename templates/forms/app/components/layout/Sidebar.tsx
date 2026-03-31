import { useState, useRef, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ArrowUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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

const statusDots: Record<string, string> = {
  draft: "bg-amber-500",
  published: "bg-emerald-500",
  closed: "bg-muted-foreground/50",
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
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-muted-foreground"
            onClick={handleSkip}
          >
            Skip prompt
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7"
            onClick={handleSubmitPrompt}
            disabled={!prompt.trim()}
            aria-label="Send prompt"
          >
            <ArrowUp size={14} />
          </Button>
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
                  "flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-sm",
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
