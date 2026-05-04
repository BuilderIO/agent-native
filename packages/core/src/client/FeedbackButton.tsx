import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type CSSProperties,
  type FormEvent,
} from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { IconMessage2, IconCheck } from "@tabler/icons-react";
import { cn } from "./utils.js";
import { useSession } from "./use-session.js";

const DEFAULT_FEEDBACK_URL =
  "https://forms.agent-native.com/f/agent-native-feedback/_16ewV";

interface ParsedTarget {
  endpoint: string;
  slug: string;
}

interface FormSchema {
  formId: string;
  fieldId: string;
}

const DEFAULT_PLACEHOLDER = "Tell us what's on your mind…";
const DEFAULT_SUBMIT_TEXT = "Send feedback";
const DEFAULT_SUCCESS_MESSAGE = "Thanks for the feedback!";

function parseTarget(url: string): ParsedTarget | null {
  try {
    const u = new URL(url);
    const idx = u.pathname.indexOf("/f/");
    if (idx === -1) return null;
    const slug = u.pathname.slice(idx + 3).replace(/\/$/, "");
    if (!slug) return null;
    return { endpoint: u.origin, slug };
  } catch {
    return null;
  }
}

const schemaCache = new Map<string, Promise<FormSchema>>();

async function loadSchema(target: ParsedTarget): Promise<FormSchema> {
  const key = `${target.endpoint}|${target.slug}`;
  let pending = schemaCache.get(key);
  if (pending) return pending;
  pending = (async () => {
    const res = await fetch(
      `${target.endpoint}/api/forms/public/${encodeURIComponent(target.slug)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`form fetch ${res.status}`);
    const body = (await res.json()) as {
      id: string;
      fields: Array<{ id: string; type: string }>;
    };
    const field =
      body.fields.find((f) => f.type === "textarea") ??
      body.fields.find((f) => f.type === "text") ??
      body.fields[0];
    if (!field) throw new Error("form has no fields");
    return { formId: body.id, fieldId: field.id };
  })();
  pending.catch(() => schemaCache.delete(key));
  schemaCache.set(key, pending);
  return pending;
}

export interface FeedbackButtonProps {
  /**
   * "sidebar" renders a full-width row with icon + label (for app left sidebars).
   * "icon" renders a small icon-only button (for dense toolbars, e.g. the agent panel header).
   * "outlined" renders an outlined pill button with icon + label (for top-nav bars, e.g. docs).
   */
  variant?: "sidebar" | "icon" | "outlined";
  label?: string;
  url?: string;
  className?: string;
  /** Which side the popover opens on. Defaults match the variant. */
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  /** Placeholder text for the textarea. */
  placeholder?: string;
}

const surfaceStyle: CSSProperties = {
  width: "min(380px, calc(100vw - 32px))",
};

const honeypotStyle: CSSProperties = {
  position: "absolute",
  left: "-10000px",
  top: "auto",
  width: "1px",
  height: "1px",
  overflow: "hidden",
};

export function FeedbackButton({
  variant = "sidebar",
  label = "Feedback",
  url = DEFAULT_FEEDBACK_URL,
  className,
  side,
  align = "end",
  placeholder,
}: FeedbackButtonProps) {
  const target = parseTarget(url);
  const { session } = useSession();

  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const openedAtRef = useRef<number>(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset transient state and kick off schema load on each open.
  useEffect(() => {
    if (!open) return;
    openedAtRef.current = Date.now();
    setValue("");
    setHoneypot("");
    setSubmitting(false);
    setSubmitted(false);
    setError(null);
    if (target) {
      loadSchema(target)
        .then((s) => setSchema(s))
        .catch((err) => {
          console.error("[FeedbackButton] schema load failed", err);
          setError("Couldn't load feedback form");
        });
    } else {
      setError("Invalid feedback URL");
    }
    const t = setTimeout(() => textareaRef.current?.focus(), 30);
    return () => {
      clearTimeout(t);
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [open, url]);

  const submit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      if (!target || !schema || submitting) return;
      const trimmed = value.trim();
      if (!trimmed) {
        setError("Please write something first");
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        const submitterEmail = session?.email;
        const res = await fetch(
          `${target.endpoint}/api/submit/${encodeURIComponent(schema.formId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              data: { [schema.fieldId]: trimmed },
              _t: openedAtRef.current,
              _hp: honeypot,
              ...(submitterEmail ? { _meta: { submitterEmail } } : {}),
            }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error || `submit failed (${res.status})`);
        }
        setSubmitted(true);
        closeTimerRef.current = setTimeout(() => setOpen(false), 1400);
      } catch (err) {
        setSubmitting(false);
        setError(err instanceof Error ? err.message : "Couldn't send feedback");
      }
    },
    [target, schema, value, honeypot, submitting, session?.email],
  );

  let trigger;
  if (variant === "icon") {
    trigger = (
      <TooltipPrimitive.Provider delayDuration={200}>
        <TooltipPrimitive.Root>
          <TooltipPrimitive.Trigger asChild>
            <PopoverPrimitive.Trigger asChild>
              <button
                type="button"
                aria-label={label}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50",
                  className,
                )}
              >
                <IconMessage2 size={14} />
              </button>
            </PopoverPrimitive.Trigger>
          </TooltipPrimitive.Trigger>
          <TooltipPrimitive.Portal>
            <TooltipPrimitive.Content
              sideOffset={6}
              className="z-[230] overflow-hidden rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-foreground shadow-md animate-in fade-in-0 zoom-in-95"
            >
              {label}
            </TooltipPrimitive.Content>
          </TooltipPrimitive.Portal>
        </TooltipPrimitive.Root>
      </TooltipPrimitive.Provider>
    );
  } else if (variant === "outlined") {
    trigger = (
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "flex h-8 items-center gap-2 rounded-md border border-border bg-transparent px-3 text-sm text-muted-foreground transition hover:border-foreground/40 hover:text-foreground",
            className,
          )}
        >
          <IconMessage2 size={14} stroke={1.5} />
          <span>{label}</span>
        </button>
      </PopoverPrimitive.Trigger>
    );
  } else {
    trigger = (
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
            className,
          )}
        >
          <IconMessage2 className="h-4 w-4" />
          <span>{label}</span>
        </button>
      </PopoverPrimitive.Trigger>
    );
  }

  const resolvedSide = side ?? (variant === "sidebar" ? "top" : "bottom");
  const resolvedPlaceholder = placeholder ?? DEFAULT_PLACEHOLDER;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      {trigger}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={resolvedSide}
          align={align}
          sideOffset={8}
          collisionPadding={16}
          className="z-[300] overflow-hidden rounded-lg border border-border bg-popover shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
          style={surfaceStyle}
        >
          {submitted ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                <IconCheck size={20} stroke={2.5} />
              </div>
              <div className="text-sm font-medium text-foreground">
                {DEFAULT_SUCCESS_MESSAGE}
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3 p-3">
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
                }}
                placeholder={resolvedPlaceholder}
                rows={5}
                maxLength={10000}
                className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                style={honeypotStyle}
              />
              <div className="flex items-center justify-between gap-3">
                <div
                  className={cn(
                    "text-[11px]",
                    error ? "text-destructive" : "text-muted-foreground/75",
                  )}
                >
                  {error ??
                    `${/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"}+Enter to send`}
                </div>
                <button
                  type="submit"
                  disabled={submitting || !value.trim()}
                  className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {submitting ? "Sending…" : DEFAULT_SUBMIT_TEXT}
                </button>
              </div>
            </form>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
