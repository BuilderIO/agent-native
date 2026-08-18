import { appBasePath } from "@agent-native/core/client/api-path";
import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  BUG_REPORT_AGENT_ACCESS_TTL_SECONDS,
  BUG_REPORT_POPUP_RESPONSE_HEADERS,
  bugReportSubmissionTargetOrigins,
  createBugReportSubmissionMessage,
  type BugReportAgentLink,
} from "@shared/bug-report";
import {
  IconArrowLeft,
  IconCheck,
  IconCopy,
  IconExternalLink,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";

import { Button } from "@/components/ui/button";
import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enMessages.bugReportRoute.donePageTitle }];
}

export function headers() {
  return BUG_REPORT_POPUP_RESPONSE_HEADERS;
}

function absoluteAppUrl(path: string) {
  if (typeof window === "undefined") return path;
  return new URL(`${appBasePath()}${path}`, window.location.origin).toString();
}

export default function BugReportDoneRoute() {
  const t = useT();
  const location = useLocation();
  const [copied, setCopied] = useState(false);
  const params = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const recordingId = params.get("recordingId")?.trim() || null;
  const returnUrl = params.get("returnUrl")?.trim() || null;

  const recordingUrl = recordingId
    ? absoluteAppUrl(`/r/${encodeURIComponent(recordingId)}`)
    : null;
  const embedUrl = recordingId
    ? absoluteAppUrl(`/embed/${encodeURIComponent(recordingId)}`)
    : null;
  useEffect(() => {
    if (!recordingId || !recordingUrl) return;
    let cancelled = false;
    void (async () => {
      let agentLink: BugReportAgentLink | null = null;
      try {
        agentLink = (await callAction(
          "create-recording-agent-link" as any,
          {
            recordingId,
            ttlSeconds: BUG_REPORT_AGENT_ACCESS_TTL_SECONDS,
          } as any,
        )) as BugReportAgentLink;
      } catch {
        agentLink = null;
      }
      if (cancelled) return;

      const message = createBugReportSubmissionMessage({
        recordingId,
        recordingUrl,
        embedUrl: embedUrl ?? recordingUrl,
        agentLink,
      });

      for (const origin of bugReportSubmissionTargetOrigins(
        window.location.origin,
        returnUrl,
      )) {
        window.opener?.postMessage(message, origin);
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(message, origin);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [embedUrl, recordingId, recordingUrl, returnUrl]);

  const copyRecordingUrl = async () => {
    if (!recordingUrl) return;
    await navigator.clipboard.writeText(recordingUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 py-5 sm:px-6">
        <section className="rounded-lg border bg-card p-5 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-emerald-600 text-white">
            <IconCheck size={24} />
          </div>
          <h1 className="mt-4 text-xl font-semibold">
            {recordingId
              ? t("bugReportRoute.doneTitle")
              : t("bugReportRoute.missingRecording")}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {t("bugReportRoute.doneDescription")}
          </p>

          {recordingUrl ? (
            <div className="mt-5 grid gap-2">
              <Button asChild className="h-11">
                <Link to={`/r/${recordingId}`}>
                  <IconExternalLink size={18} />
                  {t("bugReportRoute.openRecording")}
                </Link>
              </Button>
              <Button
                variant="outline"
                className="h-10"
                onClick={copyRecordingUrl}
              >
                <IconCopy size={17} />
                {copied
                  ? t("bugReportRoute.copied")
                  : t("bugReportRoute.copyLink")}
              </Button>
              {returnUrl ? (
                <Button variant="ghost" className="h-10" asChild>
                  <a href={returnUrl}>
                    <IconArrowLeft size={17} />
                    {t("bugReportRoute.returnToProduct")}
                  </a>
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
