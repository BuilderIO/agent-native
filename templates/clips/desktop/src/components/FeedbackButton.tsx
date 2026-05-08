import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { IconCheck, IconMessage2 } from "@tabler/icons-react";

const DEFAULT_FEEDBACK_URL =
  "https://forms.agent-native.com/f/agent-native-feedback/_16ewV";
const DEFAULT_PLACEHOLDER = "Tell us what's on your mind...";
const DEFAULT_SUBMIT_TEXT = "Send feedback";
const DEFAULT_SUCCESS_MESSAGE = "Thanks for the feedback!";

interface ParsedTarget {
  endpoint: string;
  slug: string;
}

interface FormSchema {
  formId: string;
  fieldId: string;
}

interface FeedbackButtonProps {
  submitterEmail?: string | null;
}

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
const feedbackTarget = parseTarget(DEFAULT_FEEDBACK_URL);

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

export function FeedbackButton({ submitterEmail }: FeedbackButtonProps) {
  const target = feedbackTarget;
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const openedAtRef = useRef(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    openedAtRef.current = Date.now();
    setValue("");
    setHoneypot("");
    setSubmitting(false);
    setSubmitted(false);
    setError(null);
    setSchema(null);
    if (target) {
      loadSchema(target)
        .then((s) => setSchema(s))
        .catch((err) => {
          console.error("[clips-feedback] schema load failed", err);
          setError("Couldn't load feedback form");
        });
    } else {
      setError("Invalid feedback URL");
    }
    const focusTimer = setTimeout(() => textareaRef.current?.focus(), 30);
    return () => {
      clearTimeout(focusTimer);
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [open, target]);

  const submit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      if (!target || submitting) return;
      const trimmed = value.trim();
      if (!trimmed) {
        setError("Please write something first");
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        const resolvedSchema = schema ?? (await loadSchema(target));
        if (!schema) setSchema(resolvedSchema);
        const res = await fetch(
          `${target.endpoint}/api/submit/${encodeURIComponent(resolvedSchema.formId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              data: { [resolvedSchema.fieldId]: trimmed },
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
    [target, schema, value, honeypot, submitting, submitterEmail],
  );

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="icon-button header-feedback"
          aria-label="Feedback"
          title="Feedback"
        >
          <IconMessage2 size={15} stroke={2} />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Content
        side="bottom"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="feedback-popover-content"
      >
        {submitted ? (
          <div className="feedback-success">
            <div className="feedback-success-icon" aria-hidden>
              <IconCheck size={20} stroke={2.5} />
            </div>
            <div className="feedback-success-title">
              {DEFAULT_SUCCESS_MESSAGE}
            </div>
          </div>
        ) : (
          <form className="feedback-form" onSubmit={submit}>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
              }}
              placeholder={DEFAULT_PLACEHOLDER}
              rows={5}
              maxLength={10000}
              className="feedback-textarea"
            />
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              className="feedback-honeypot"
            />
            <div className="feedback-form-footer">
              <div
                className={error ? "feedback-hint is-error" : "feedback-hint"}
              >
                {error ??
                  `${/Mac|iPhone|iPad/.test(navigator.userAgent) ? "Cmd" : "Ctrl"}+Enter to send`}
              </div>
              <button
                type="submit"
                className="feedback-submit"
                disabled={submitting || !value.trim()}
              >
                {submitting ? "Sending..." : DEFAULT_SUBMIT_TEXT}
              </button>
            </div>
          </form>
        )}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Root>
  );
}
