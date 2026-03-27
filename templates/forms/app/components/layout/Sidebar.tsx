import { useState, useRef, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { FileText, Plus, Sparkles, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemeToggle } from "@/components/ThemeToggle";
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
  const [showPrompt, setShowPrompt] = useState(false);
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (showPrompt) {
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [showPrompt]);

  function handleNewForm() {
    setPrompt("");
    setShowPrompt(true);
  }

  function handleSkip() {
    setShowPrompt(false);
    createForm.mutate(
      { title: "Untitled Form" },
      { onSuccess: (form) => navigate(`/forms/${form.id}`) },
    );
  }

  function handleSubmitPrompt() {
    if (!prompt.trim()) return;
    setShowPrompt(false);
    send({
      message: `Create a new form based on this description: ${prompt.trim()}`,
      context:
        "Create the form using the create-form script with appropriate title, description, and fields. After creating, tell the user the form name and a summary of the fields.",
    });
  }

  return (
    <div className="flex h-screen w-60 flex-col border-r border-border bg-muted/30">
      {/* Header */}
      <div className="flex items-center border-b border-border px-3 py-2">
        <Link
          to="/forms"
          className="text-sm font-semibold text-foreground hover:text-foreground/80"
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
          <button
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            onClick={handleNewForm}
          >
            <Plus size={14} className="shrink-0" />
            <span>New form</span>
          </button>
        </div>
      </ScrollArea>

      {/* Agent prompt overlay */}
      {showPrompt && (
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles size={13} className="text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              Describe your form
            </span>
            <button
              className="ml-auto text-muted-foreground hover:text-foreground"
              onClick={() => setShowPrompt(false)}
            >
              <X size={13} />
            </button>
          </div>
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
            placeholder='e.g. "Customer feedback survey with rating and comments"'
            className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            rows={3}
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={handleSkip}
            >
              Skip
            </button>
            <button
              className="text-xs font-medium bg-primary text-primary-foreground rounded-md px-3 py-1 hover:bg-primary/90 disabled:opacity-50"
              onClick={handleSubmitPrompt}
              disabled={!prompt.trim()}
            >
              Create
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-end border-t border-border px-3 py-2">
        <ThemeToggle />
      </div>
    </div>
  );
}
