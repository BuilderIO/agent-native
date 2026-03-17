import { useState, useEffect, useRef } from "react";
import {
  X,
  Minus,
  Maximize2,
  Send,
  Bold,
  Italic,
  Link,
  Paperclip,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSendEmail } from "@/hooks/use-emails";
import { sendToAgentChat } from "@agent-native/core";
import { toast } from "sonner";
import type { ComposeState } from "@shared/types";
import { RecipientInput } from "./RecipientInput";

interface ComposeModalProps {
  composeState: ComposeState;
  onUpdate: (partial: Partial<ComposeState>) => void;
  onClose: () => void;
  onFlush: () => Promise<unknown> | undefined;
}

export function ComposeModal({
  composeState,
  onUpdate,
  onClose,
  onFlush,
}: ComposeModalProps) {
  const [minimized, setMinimized] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);

  const sendEmail = useSendEmail();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const { to, cc, bcc, subject, body, mode } = composeState;

  // Focus body when reply/forward opens
  useEffect(() => {
    if (mode !== "compose") {
      setTimeout(() => bodyRef.current?.focus(), 100);
    }
  }, [mode]);

  const handleSend = async () => {
    if (!to.trim()) {
      toast.error("Please add at least one recipient");
      return;
    }

    sendEmail.mutate(
      {
        to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject,
        body,
        replyToId: composeState.replyToId,
      },
      {
        onSuccess: () => {
          toast.success("Email sent!");
          onClose();
        },
        onError: () => toast.error("Failed to send email"),
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const handleGenerate = async () => {
    if (!generatePrompt.trim()) return;

    // Flush current state to file so agent can read it
    await onFlush();

    const context = [
      to && `To: ${to}`,
      cc && `Cc: ${cc}`,
      subject && `Subject: ${subject}`,
      body && `Current draft:\n${body}`,
    ]
      .filter(Boolean)
      .join("\n");

    sendToAgentChat({
      message: generatePrompt.trim(),
      context: `The user is composing an email. The current draft is saved in application-state/compose.json. You can read and update it directly.\n\n${context || "(empty draft)"}`,
      submit: true,
    });

    setGeneratePrompt("");
    setGenerateOpen(false);
  };

  const title =
    mode === "reply" ? "Reply" : mode === "forward" ? "Forward" : "New message";

  return (
    <div
      className={cn(
        "compose-window fixed bottom-0 right-4 z-50 flex w-[540px] flex-col rounded-t-xl bg-card transition-all duration-200",
        minimized ? "h-11" : "h-[520px]",
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Window title bar */}
      <div className="flex h-11 shrink-0 items-center justify-between rounded-t-xl px-4">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setMinimized(!minimized)}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {!minimized && (
        <>
          {/* Header fields */}
          <div className="border-b border-border">
            <div className="flex items-center border-b border-border px-4">
              <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">
                To
              </span>
              <RecipientInput
                value={to}
                onChange={(val) => onUpdate({ to: val })}
                autoFocus={mode === "compose"}
              />
              <button
                onClick={() => {
                  const next = !showCcBcc;
                  setShowCcBcc(next);
                  if (next) {
                    if (cc === undefined) onUpdate({ cc: "" });
                    if (bcc === undefined) onUpdate({ bcc: "" });
                  }
                }}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", showCcBcc && "rotate-180")} />
              </button>
            </div>

            {showCcBcc && (
              <>
                <div className="flex items-center border-b border-border px-4">
                  <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">
                    Cc
                  </span>
                  <RecipientInput
                    value={cc ?? ""}
                    onChange={(val) => onUpdate({ cc: val })}
                  />
                </div>
                <div className="flex items-center border-b border-border px-4">
                  <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">
                    Bcc
                  </span>
                  <RecipientInput
                    value={bcc ?? ""}
                    onChange={(val) => onUpdate({ bcc: val })}
                  />
                </div>
              </>
            )}

            <div className="flex items-center px-4">
              <input
                type="text"
                value={subject}
                onChange={(e) => onUpdate({ subject: e.target.value })}
                placeholder="Subject"
                className="flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {/* Body */}
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => onUpdate({ body: e.target.value })}
            placeholder="Write your message..."
            className="flex-1 resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
          />

          {/* Toolbar */}
          <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2">
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Bold className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Bold</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Italic className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Italic</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Link className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Insert link</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Paperclip className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Attach file</TooltipContent>
              </Tooltip>

              <div className="mx-1 h-4 w-px bg-border" />

              <Popover open={generateOpen} onOpenChange={setGenerateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs"
                  >
                    Generate
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="w-80 p-3">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      What should the agent write?
                    </label>
                    <textarea
                      ref={promptRef}
                      value={generatePrompt}
                      onChange={(e) => setGeneratePrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleGenerate();
                        }
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setGenerateOpen(false);
                        }
                      }}
                      placeholder="e.g. Write a polite follow-up..."
                      className="min-h-[60px] w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                      autoFocus
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">
                        <kbd className="kbd-hint">↵</kbd> to submit
                      </span>
                      <Button
                        size="sm"
                        onClick={handleGenerate}
                        disabled={!generatePrompt.trim()}
                        className="h-7 gap-1.5 px-3 text-xs"
                      >
                        Generate
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden sm:block">
                <kbd className="kbd-hint">⌘</kbd>{" "}
                <kbd className="kbd-hint">↵</kbd> to send
              </span>
              <Button
                size="sm"
                onClick={handleSend}
                disabled={sendEmail.isPending || !to.trim()}
                className="gap-1.5"
              >
                <Send className="h-3.5 w-3.5" />
                Send
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
