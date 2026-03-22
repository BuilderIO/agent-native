import { useEffect, useRef, useCallback, useState } from "react";

export interface TurnstileProps {
  /** Turnstile site key. Falls back to VITE_TURNSTILE_SITE_KEY env var. */
  siteKey?: string;
  /** Called with the verification token when Turnstile completes. */
  onVerify: (token: string) => void;
  /** Called when the token expires. */
  onExpire?: () => void;
  /**
   * Turnstile appearance mode:
   * - "managed" (default): invisible unless a challenge is needed
   * - "invisible": fully invisible, never shows UI
   */
  mode?: "managed" | "invisible";
  /** Additional className for the container div. */
  className?: string;
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: Record<string, unknown>,
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    __turnstileOnLoad?: () => void;
  }
}

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__turnstileOnLoad";

let scriptLoadPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (scriptLoadPromise) return scriptLoadPromise;
  if (window.turnstile) return Promise.resolve();

  scriptLoadPromise = new Promise<void>((resolve) => {
    window.__turnstileOnLoad = () => {
      resolve();
      delete window.__turnstileOnLoad;
    };
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

/**
 * Cloudflare Turnstile captcha widget.
 *
 * Renders nothing if no site key is available (graceful opt-in).
 * In "managed" mode (default), the widget is invisible unless
 * Turnstile determines a challenge is needed.
 */
export function Turnstile({
  siteKey,
  onVerify,
  onExpire,
  mode = "managed",
  className,
}: TurnstileProps) {
  const resolvedKey =
    siteKey ||
    (typeof import.meta !== "undefined"
      ? (import.meta as any).env?.VITE_TURNSTILE_SITE_KEY
      : undefined);

  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  const onVerifyRef = useRef(onVerify);
  onVerifyRef.current = onVerify;
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!resolvedKey) return;
    loadTurnstileScript().then(() => setReady(true));
  }, [resolvedKey]);

  const renderWidget = useCallback(() => {
    if (
      !ready ||
      !resolvedKey ||
      !containerRef.current ||
      !window.turnstile ||
      widgetIdRef.current
    )
      return;

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: resolvedKey,
      appearance: mode === "invisible" ? "interaction-only" : "managed",
      callback: (token: string) => onVerifyRef.current(token),
      "expired-callback": () => onExpireRef.current?.(),
    });
  }, [ready, resolvedKey, mode]);

  useEffect(() => {
    renderWidget();
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [renderWidget]);

  // Render nothing if no site key — captcha is opt-in
  if (!resolvedKey) return null;

  return <div ref={containerRef} className={className} />;
}
