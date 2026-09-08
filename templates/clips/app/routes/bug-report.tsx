import {
  BUG_REPORT_POPUP_RESPONSE_HEADERS,
  isBugReportSubmissionMessage,
  parseBugReportContext,
  type BugReportContext,
} from "@shared/bug-report";
import { useEffect, useMemo, useRef } from "react";
import { useLocation, useOutlet } from "react-router";

import { BugReportForm } from "@/components/bug-report/bug-report-form";
import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enMessages.bugReportRoute.pageTitle }];
}

export function headers() {
  return BUG_REPORT_POPUP_RESPONSE_HEADERS;
}

function originFor(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export default function BugReportRoute() {
  const location = useLocation();
  const outlet = useOutlet();
  const initialContext = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return parseBugReportContext(params, { allowLoose: true });
  }, [location.search]);

  const recorderWindowRef = useRef<Window | null>(null);
  const hostOrigin = originFor(
    initialContext?.returnUrl ?? initialContext?.sourceUrl ?? null,
  );

  useEffect(() => {
    if (!hostOrigin) return;
    const relaySubmission = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (
        recorderWindowRef.current &&
        event.source !== recorderWindowRef.current
      ) {
        return;
      }
      if (!isBugReportSubmissionMessage(event.data)) return;
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(event.data, hostOrigin);
      }
    };
    window.addEventListener("message", relaySubmission);
    return () => window.removeEventListener("message", relaySubmission);
  }, [hostOrigin]);

  if (outlet) return outlet;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-4 py-5 sm:px-6">
        <section className="rounded-lg border bg-card p-4 shadow-sm sm:p-5">
          <BugReportForm
            initialContext={initialContext}
            onRecorderOpened={(recorderWindow) => {
              recorderWindowRef.current = recorderWindow;
            }}
          />
        </section>
      </div>
    </main>
  );
}
