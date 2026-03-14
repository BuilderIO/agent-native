import { useState, useCallback } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { MessageSquare } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { requestUserInfo } from "@agent-native/core/client";

export function FeedbackButton({
  variant = "icon",
}: {
  variant?: "icon" | "prominent";
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );

  const handleSubmit = useCallback(async () => {
    if (!message.trim() || status === "sending") return;
    setStatus("sending");

    const user = await requestUserInfo();

    // Fire and forget — don't block on the webhook
    authFetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message.trim(), user }),
    }).catch(() => {});

    setStatus("sent");
    setTimeout(() => {
      setOpen(false);
      setStatus("idle");
      setMessage("");
    }, 1800);
  }, [message, status]);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setStatus("idle");
      setMessage("");
    }
  }, []);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {variant === "prominent" ? (
          <button className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-md text-sm font-medium bg-foreground text-background hover:opacity-90 transition-opacity">
            <MessageSquare size={15} />
            <span>Feedback</span>
          </button>
        ) : (
          <button
            className="p-1.5 rounded-md text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            title="Send feedback"
          >
            <MessageSquare size={16} />
          </button>
        )}
      </PopoverTrigger>

      <PopoverContent side="top" align="start" className="w-72 p-3">
        {status === "sent" ? (
          <p className="text-sm text-center py-3 text-muted-foreground">
            Thanks for the feedback!
          </p>
        ) : (
          <div className="space-y-2.5">
            <p className="text-sm font-medium">Send feedback</p>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's on your mind?"
              rows={4}
              className="resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  handleSubmit();
                }
              }}
            />
            {status === "error" && (
              <p className="text-xs text-destructive">
                Failed to send — please try again.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!message.trim() || status === "sending"}
                onClick={handleSubmit}
              >
                {status === "sending" ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
