import { appBasePath, useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  IconArrowLeft,
  IconCheck,
  IconCopy,
  IconExternalLink,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";

import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enMessages.bugReportRoute.donePageTitle }];
}

function absoluteAppUrl(path: string) {
  if (typeof window === "undefined") return path;
  return new URL(`${appBasePath()}${path}`, window.location.origin).toString();
}

function targetOrigin(returnUrl: string | null) {
  if (!returnUrl) return "*";
  try {
    return new URL(returnUrl).origin;
  } catch {
    return "*";
  }
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
  const agentContextUrl = recordingId
    ? absoluteAppUrl(
        `/api/agent-context.json?id=${encodeURIComponent(recordingId)}`,
      )
    : null;

  useEffect(() => {
    if (!recordingId || !recordingUrl) return;
    const message = {
      type: "agent-native.clips.bug-report.submitted",
      recordingId,
      recordingUrl,
      embedUrl,
      agentContextUrl,
    };
    const origin = targetOrigin(returnUrl);
    window.opener?.postMessage(message, origin);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, origin);
    }
  }, [agentContextUrl, embedUrl, recordingId, recordingUrl, returnUrl]);

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
