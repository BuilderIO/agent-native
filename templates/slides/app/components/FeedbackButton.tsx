import { useState } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { requestUserInfo } from "@agent-native/core/client";

const APP_NAME = "deck-generator";

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    if (!message.trim()) return;

    setSending(true);
    const userInfo = await requestUserInfo();

    // Fire and forget — don't wait for the server
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message.trim(),
        path: window.location.pathname,
        app: APP_NAME,
        userName: userInfo.name,
        userEmail: userInfo.email,
      }),
    }).catch((err) => console.error("Failed to send feedback:", err));

    setSending(false);
    setSent(true);
    // Close the popover after showing the thanks message
    setTimeout(() => setOpen(false), 1500);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        // Reset state after popover close animation finishes
        if (!v) {
          setTimeout(() => {
            setSent(false);
            setMessage("");
          }, 200);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button className="px-3 py-1.5 rounded-lg bg-white text-black text-xs font-medium hover:bg-white/90 transition-all cursor-pointer">
          Feedback
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" side="bottom" align="end">
        {sent ? (
          <p className="text-sm text-green-500 text-center py-4">
            Thanks for your feedback!
          </p>
        ) : (
          <>
            <p className="text-sm font-medium mb-2 text-white/90">
              Send Feedback
            </p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's on your mind?"
              className="w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-[#609FF8] resize-none"
              rows={3}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                  handleSubmit();
              }}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-white/30">
                Cmd+Enter to send
              </span>
              <button
                onClick={handleSubmit}
                disabled={!message.trim() || sending}
                className="rounded-md bg-[#609FF8] px-3 py-1.5 text-xs font-medium text-black hover:bg-[#7AB2FA] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
