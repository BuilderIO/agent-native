import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { IconMessage2, IconCheck } from "@tabler/icons-react";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";

import { DEFAULT_LOCALE, type LocaleCode } from "../localization/shared.js";
import { getFeedbackClientContext } from "./feedback-context.js";
import { useOptionalLocale } from "./i18n.js";
import { useSession } from "./use-session.js";
import { cn } from "./utils.js";

const DEFAULT_FEEDBACK_URL =
  "https://forms.agent-native.com/f/agent-native-feedback/_16ewV";

function isSyntheticAgentNativeAnonymousEmail(
  value: string | null | undefined,
): boolean {
  return /^anon-[^\s@]+@agent-native\.com$/i.test(value ?? "");
}

interface ParsedTarget {
  endpoint: string;
  slug: string;
}

interface FormSchema {
  formId: string;
  fieldId: string;
}

const FEEDBACK_COPY: Record<
  LocaleCode,
  {
    label: string;
    placeholder: string;
    submit: string;
    submitting: string;
    success: string;
    loadError: string;
    invalidUrl: string;
    emptyError: string;
    sendError: string;
    keyboardHint: string;
  }
> = {
  "en-US": {
    label: "Feedback",
    placeholder: "What's working, what's broken, or what would you change?",
    submit: "Send feedback",
    submitting: "Sending...",
    success: "Thanks for the feedback!",
    loadError: "Couldn't load feedback form",
    invalidUrl: "Invalid feedback URL",
    emptyError: "Please write something first",
    sendError: "Couldn't send feedback",
    keyboardHint: "{{shortcut}}+Enter to send",
  },
  "zh-CN": {
    label: "反馈",
    placeholder: "哪些地方好用、哪里坏了，或你想改什么？",
    submit: "发送反馈",
    submitting: "正在发送...",
    success: "感谢你的反馈！",
    loadError: "无法加载反馈表单",
    invalidUrl: "反馈 URL 无效",
    emptyError: "请先写点内容",
    sendError: "无法发送反馈",
    keyboardHint: "{{shortcut}}+Enter 发送",
  },
  "zh-TW": {
    label: "意見回饋",
    placeholder: "哪些地方好用、哪裡壞了，或你想改什麼？",
    submit: "送出意見回饋",
    submitting: "正在送出...",
    success: "感謝你的意見回饋。",
    loadError: "無法載入意見回饋表單",
    invalidUrl: "意見回饋 URL 無效",
    emptyError: "請先輸入內容",
    sendError: "無法送出意見回饋",
    keyboardHint: "{{shortcut}}+Enter 送出",
  },
  "es-ES": {
    label: "Comentarios",
    placeholder: "¿Qué funciona, qué falla o qué cambiarías?",
    submit: "Enviar comentarios",
    submitting: "Enviando...",
    success: "Gracias por tus comentarios.",
    loadError: "No se pudo cargar el formulario",
    invalidUrl: "URL de comentarios no válida",
    emptyError: "Escribe algo primero",
    sendError: "No se pudieron enviar los comentarios",
    keyboardHint: "{{shortcut}}+Enter para enviar",
  },
  "fr-FR": {
    label: "Retour",
    placeholder: "Qu'est-ce qui marche, casse ou devrait changer ?",
    submit: "Envoyer",
    submitting: "Envoi...",
    success: "Merci pour votre retour.",
    loadError: "Impossible de charger le formulaire",
    invalidUrl: "URL de retour invalide",
    emptyError: "Écrivez quelque chose d'abord",
    sendError: "Impossible d'envoyer le retour",
    keyboardHint: "{{shortcut}}+Entrée pour envoyer",
  },
  "de-DE": {
    label: "Feedback",
    placeholder: "Was funktioniert, was ist kaputt, was würdest du ändern?",
    submit: "Feedback senden",
    submitting: "Wird gesendet...",
    success: "Danke für dein Feedback!",
    loadError: "Feedback-Formular konnte nicht geladen werden",
    invalidUrl: "Ungültige Feedback-URL",
    emptyError: "Bitte zuerst etwas schreiben",
    sendError: "Feedback konnte nicht gesendet werden",
    keyboardHint: "{{shortcut}}+Enter zum Senden",
  },
  "ja-JP": {
    label: "フィードバック",
    placeholder: "良い点、問題点、変更したい点を教えてください。",
    submit: "送信",
    submitting: "送信中...",
    success: "フィードバックありがとうございます。",
    loadError: "フォームを読み込めませんでした",
    invalidUrl: "フィードバック URL が無効です",
    emptyError: "先に内容を入力してください",
    sendError: "送信できませんでした",
    keyboardHint: "{{shortcut}}+Enter で送信",
  },
  "ko-KR": {
    label: "피드백",
    placeholder: "잘 되는 점, 깨진 점, 바꾸고 싶은 점을 알려주세요.",
    submit: "피드백 보내기",
    submitting: "보내는 중...",
    success: "피드백 감사합니다.",
    loadError: "피드백 양식을 불러올 수 없습니다",
    invalidUrl: "피드백 URL이 올바르지 않습니다",
    emptyError: "먼저 내용을 입력해 주세요",
    sendError: "피드백을 보낼 수 없습니다",
    keyboardHint: "{{shortcut}}+Enter로 보내기",
  },
  "pt-BR": {
    label: "Feedback",
    placeholder: "O que funciona, quebrou ou você mudaria?",
    submit: "Enviar feedback",
    submitting: "Enviando...",
    success: "Obrigado pelo feedback!",
    loadError: "Não foi possível carregar o formulário",
    invalidUrl: "URL de feedback inválida",
    emptyError: "Escreva algo primeiro",
    sendError: "Não foi possível enviar o feedback",
    keyboardHint: "{{shortcut}}+Enter para enviar",
  },
  "hi-IN": {
    label: "फ़ीडबैक",
    placeholder: "क्या काम कर रहा है, क्या टूटा है, या आप क्या बदलना चाहेंगे?",
    submit: "फ़ीडबैक भेजें",
    submitting: "भेजा जा रहा है...",
    success: "फ़ीडबैक के लिए धन्यवाद!",
    loadError: "फ़ीडबैक फ़ॉर्म लोड नहीं हुआ",
    invalidUrl: "फ़ीडबैक URL अमान्य है",
    emptyError: "पहले कुछ लिखें",
    sendError: "फ़ीडबैक भेजा नहीं जा सका",
    keyboardHint: "भेजने के लिए {{shortcut}}+Enter",
  },
  "ar-SA": {
    label: "ملاحظات",
    placeholder: "ما الذي يعمل، وما المعطل، وما الذي تريد تغييره؟",
    submit: "إرسال الملاحظات",
    submitting: "جار الإرسال...",
    success: "شكرا لملاحظاتك!",
    loadError: "تعذر تحميل نموذج الملاحظات",
    invalidUrl: "رابط الملاحظات غير صالح",
    emptyError: "اكتب شيئا أولا",
    sendError: "تعذر إرسال الملاحظات",
    keyboardHint: "{{shortcut}}+Enter للإرسال",
  },
};

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
  /** Optional text to prefill when the popover opens. */
  initialValue?: string;
  /** Current chat session/thread id, when the host already knows it. */
  chatSessionId?: string | null;
  /** Chat localStorage namespace, when the host uses per-app chat storage. */
  chatStorageKey?: string | null;
  /** Controlled popover open state for hosts that trigger feedback from a menu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional custom trigger element. */
  trigger?: ReactNode;
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
  label,
  url = DEFAULT_FEEDBACK_URL,
  className,
  side,
  align = "end",
  placeholder,
  initialValue,
  chatSessionId,
  chatStorageKey,
  open: controlledOpen,
  onOpenChange,
  trigger: customTrigger,
}: FeedbackButtonProps) {
  const target = parseTarget(url);
  const { session } = useSession();
  const localeContext = useOptionalLocale();
  const locale = localeContext?.locale ?? DEFAULT_LOCALE;
  const copy = FEEDBACK_COPY[locale] ?? FEEDBACK_COPY[DEFAULT_LOCALE];
  const resolvedLabel = label ?? copy.label;

  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange],
  );
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
    setValue(initialValue ?? "");
    setHoneypot("");
    setSubmitting(false);
    setSubmitted(false);
    setError(null);
    setSchema(null);
    if (target) {
      loadSchema(target)
        .then((s) => setSchema(s))
        .catch((err) => {
          console.error("[FeedbackButton] schema load failed", err);
          setError(copy.loadError);
        });
    } else {
      setError(copy.invalidUrl);
    }
    const t = setTimeout(() => textareaRef.current?.focus(), 30);
    return () => {
      clearTimeout(t);
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [copy.invalidUrl, copy.loadError, initialValue, open, url]);

  const submit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      if (!target || submitting) return;
      const trimmed = value.trim();
      if (!trimmed) {
        setError(copy.emptyError);
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        const resolvedSchema = schema ?? (await loadSchema(target));
        if (!schema) setSchema(resolvedSchema);
        const submitterEmail = isSyntheticAgentNativeAnonymousEmail(
          session?.email,
        )
          ? null
          : session?.email;
        const feedbackContext = getFeedbackClientContext({
          chatSessionId,
          storageKey: chatStorageKey,
        });
        const res = await fetch(
          `${target.endpoint}/api/submit/${encodeURIComponent(resolvedSchema.formId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              data: { [resolvedSchema.fieldId]: trimmed },
              _t: openedAtRef.current,
              _hp: honeypot,
              _meta: {
                ...(submitterEmail ? { submitterEmail } : {}),
                ...feedbackContext,
              },
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
        setError(err instanceof Error ? err.message : copy.sendError);
      }
    },
    [
      target,
      schema,
      value,
      honeypot,
      submitting,
      session?.email,
      chatSessionId,
      chatStorageKey,
      setOpen,
      copy.emptyError,
      copy.sendError,
    ],
  );

  let trigger;
  if (customTrigger) {
    trigger = (
      <PopoverPrimitive.Trigger asChild>
        {customTrigger}
      </PopoverPrimitive.Trigger>
    );
  } else if (variant === "icon") {
    trigger = (
      <TooltipPrimitive.Provider delayDuration={200}>
        <TooltipPrimitive.Root>
          <TooltipPrimitive.Trigger asChild>
            <PopoverPrimitive.Trigger asChild>
              <button
                type="button"
                aria-label={resolvedLabel}
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
              className="z-[100040] overflow-hidden rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-foreground shadow-md animate-in fade-in-0 zoom-in-95"
            >
              {resolvedLabel}
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
          aria-label={resolvedLabel}
          className={cn(
            "flex h-8 items-center gap-2 rounded-md border border-border bg-transparent px-3 text-sm text-muted-foreground transition hover:border-foreground/40 hover:text-foreground",
            className,
          )}
        >
          <IconMessage2 size={14} stroke={1.5} />
          <span>{resolvedLabel}</span>
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
          <span>{resolvedLabel}</span>
        </button>
      </PopoverPrimitive.Trigger>
    );
  }

  const resolvedSide = side ?? (variant === "sidebar" ? "top" : "bottom");
  const resolvedPlaceholder = placeholder ?? copy.placeholder;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      {trigger}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={resolvedSide}
          align={align}
          sideOffset={8}
          collisionPadding={16}
          className="z-[100040] overflow-hidden rounded-lg border border-border bg-popover shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
          style={surfaceStyle}
        >
          {submitted ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                <IconCheck size={20} stroke={2.5} />
              </div>
              <div className="text-sm font-medium text-foreground">
                {copy.success}
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
                    copy.keyboardHint.replace(
                      "{{shortcut}}",
                      /Mac|iPhone|iPad/.test(navigator.userAgent)
                        ? "⌘"
                        : "Ctrl",
                    )}
                </div>
                <button
                  type="submit"
                  disabled={submitting || !value.trim()}
                  className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {submitting ? copy.submitting : copy.submit}
                </button>
              </div>
            </form>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
