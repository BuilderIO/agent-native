import { useEffect, useRef, useCallback, useState } from "react";

export interface TurnstileProps {
  siteKey?: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  mode?: "managed" | "invisible";
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

export function Turnstile({
  siteKey,
  onVerify,
  onExpire,
  mode = "managed",
  className,
}: TurnstileProps) {
  const resolvedKey =
    siteKey ||
    (import.meta.env as Record<string, string | undefined>)
      ?.VITE_TURNSTILE_SITE_KEY;

  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  const onVerifyRef = useRef(onVerify);
  onVerifyRef.current = onVerify;
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!resolvedKey) return;
    void loadTurnstileScript().then(() => setReady(true));
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

  if (!resolvedKey) return null;

  return <div ref={containerRef} className={className} />;
}
