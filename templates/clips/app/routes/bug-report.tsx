import { appBasePath, useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import {
  bugReportContextToSearchParams,
  parseBugReportContext,
  type BugReportContext,
  type BugReportSeverity,
} from "@shared/bug-report";
import {
  IconArrowRight,
  IconBug,
  IconExternalLink,
  IconShieldCheck,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useOutlet } from "react-router";

import enMessages from "@/i18n/en-US";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: enMessages.bugReportRoute.pageTitle }];
}

function openRecorder(url: string) {
  const opened = window.open(
    url,
    "agent-native-clips-bug-report",
    "popup,width=1120,height=820",
  );
  if (!opened) {
    window.location.href = url;
    return;
  }
  opened.focus();
}

export default function BugReportRoute() {
  const t = useT();
  const location = useLocation();
  const outlet = useOutlet();
  const initialContext = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return parseBugReportContext(params, { allowLoose: true });
  }, [location.search]);

  const [title, setTitle] = useState(initialContext?.title ?? "");
  const [description, setDescription] = useState(
    initialContext?.description ?? "",
  );
  const [reporterEmail, setReporterEmail] = useState(
    initialContext?.reporterEmail ?? "",
  );
  const [severity, setSeverity] = useState<BugReportSeverity>(
    initialContext?.severity ?? "normal",
  );
  const [referrer, setReferrer] = useState<string | null>(null);

  useEffect(() => {
    setReferrer(document.referrer || null);
  }, []);

  const sourceUrl = initialContext?.sourceUrl ?? referrer;
  const pageTitle = initialContext?.pageTitle ?? null;
  const sourceLabel =
    pageTitle || sourceUrl || t("bugReportRoute.sourceUnknown");

  if (outlet) return outlet;

  const startRecording = () => {
    const context: BugReportContext = {
      projectId: initialContext?.projectId ?? null,
      title: title.trim() || initialContext?.title || null,
      description: description.trim() || initialContext?.description || null,
      severity,
      sourceUrl,
      pageTitle,
      appVersion: initialContext?.appVersion ?? null,
      environment: initialContext?.environment ?? null,
      reporterEmail:
        reporterEmail.trim() || initialContext?.reporterEmail || null,
      reporterName: initialContext?.reporterName ?? null,
      reporterId: initialContext?.reporterId ?? null,
      metadata: initialContext?.metadata ?? null,
      returnUrl: initialContext?.returnUrl ?? sourceUrl,
    };
    const params = bugReportContextToSearchParams(context);
    params.set("intent", "bug-report");
    params.set("mode", "screen");
    params.set("surface", "browser");
    openRecorder(`${appBasePath()}/record?${params.toString()}`);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-4 py-5 sm:px-6">
        <section className="rounded-lg border bg-card p-4 shadow-sm sm:p-5">
          <div className="mb-5 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <IconBug size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {t("bugReportRoute.eyebrow")}
              </p>
              <h1 className="mt-1 text-xl font-semibold leading-tight">
                {t("bugReportRoute.title")}
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t("bugReportRoute.description")}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bug-title">
                {t("bugReportRoute.issueTitleLabel")}
              </Label>
              <Input
                id="bug-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("bugReportRoute.issueTitlePlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bug-details">
                {t("bugReportRoute.detailsLabel")}
              </Label>
              <Textarea
                id="bug-details"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("bugReportRoute.detailsPlaceholder")}
                className="min-h-24 resize-none"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
              <div className="space-y-2">
                <Label htmlFor="bug-email">
                  {t("bugReportRoute.emailLabel")}
                </Label>
                <Input
                  id="bug-email"
                  type="email"
                  value={reporterEmail}
                  onChange={(event) => setReporterEmail(event.target.value)}
                  placeholder={t("bugReportRoute.emailPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("bugReportRoute.severityLabel")}</Label>
                <Select
                  value={severity}
                  onValueChange={(value) =>
                    setSeverity(value as BugReportSeverity)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">
                      {t("bugReportRoute.severityLow")}
                    </SelectItem>
                    <SelectItem value="normal">
                      {t("bugReportRoute.severityNormal")}
                    </SelectItem>
                    <SelectItem value="high">
                      {t("bugReportRoute.severityHigh")}
                    </SelectItem>
                    <SelectItem value="urgent">
                      {t("bugReportRoute.severityUrgent")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">
                {t("bugReportRoute.sourceLabel")}
              </p>
              <p
                className={cn(
                  "mt-1 truncate text-sm",
                  !sourceUrl && "text-muted-foreground",
                )}
              >
                {sourceLabel}
              </p>
            </div>

            <Button className="h-11 w-full" onClick={startRecording}>
              <IconExternalLink size={18} />
              {t("bugReportRoute.startRecording")}
              <IconArrowRight size={18} className="ms-auto" />
            </Button>
          </div>

          <div className="mt-5 flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
            <IconShieldCheck size={16} className="mt-0.5 shrink-0" />
            <p>{t("bugReportRoute.privacyNote")}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
