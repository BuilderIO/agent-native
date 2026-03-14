import { useState } from "react";
import { getIdToken } from "@/lib/auth";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { requestUserInfo } from "@/lib/user-info";

const APP_NAME = "analytics";

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [userInfo, setUserInfo] = useState<{ name?: string; email?: string }>(
    {},
  );

  async function handleOpen(v: boolean) {
    setOpen(v);
    if (v) {
      const info = await requestUserInfo();
      setUserInfo({
        name: info.name,
        email: info.email || undefined,
      });
    } else {
      setTimeout(() => {
        setSent(false);
        setMessage("");
      }, 200);
    }
  }

  async function handleSubmit() {
    if (!message.trim()) return;
    setSending(true);
    try {
      const token = await getIdToken();
      await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          message: message.trim(),
          url: window.location.pathname,
          app: APP_NAME,
          name: userInfo.name,
          email: userInfo.email,
        }),
      });
      setSent(true);
      setTimeout(() => {
        setOpen(false);
      }, 1200);
    } catch (err) {
      console.error("Failed to send feedback:", err);
    } finally {
      setSending(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium bg-foreground text-background hover:opacity-90 transition-all cursor-pointer">
          Feedback
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" side="top" align="start">
        <div className="relative">
          {sent && (
            <div className="absolute inset-0 flex items-center justify-center bg-popover z-10 animate-in fade-in duration-200">
              <p className="text-sm text-green-500">
                Thanks for your feedback!
              </p>
            </div>
          )}
          <div className={sent ? "invisible" : ""}>
            <p className="text-sm font-medium mb-2">Send Feedback</p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's on your mind?"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              rows={3}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                  handleSubmit();
              }}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-muted-foreground">
                Cmd+Enter to send
              </span>
              <button
                onClick={handleSubmit}
                disabled={!message.trim() || sending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
