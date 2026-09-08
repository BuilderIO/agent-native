import { useT } from "@agent-native/core/client/i18n";
import {
  DateRangePicker,
  dateRangeToInterval,
  type DateRange,
} from "@agent-native/toolkit/dashboard";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  callAppAction,
  type LocalTransactionalEmailCatalog,
} from "../client/transactional-emails";
import { ActionQueryError } from "./action-query-error";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Skeleton } from "./ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

interface SendLogEntry {
  id: string;
  templateId: string | null;
  app: string | null;
  recipient: string;
  sender: string;
  subject: string;
  status: string;
  error: string | null;
  provider: string;
  responseStatus: number | null;
  createdAt: number;
}

/** One page of `list-email-log`, fetched at `PAGE_SIZE + 1` to detect "has more". */
const PAGE_SIZE = 50;

function useDebounced(value: string, delayMs = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function SendLogDetailDialog({
  entry,
  open,
  onOpenChange,
}: {
  entry: SendLogEntry | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const t = useT();
  if (!entry) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{entry.subject}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <div className="text-muted-foreground">
            {t("dispatch.transactionalEmail.recipient")}
          </div>
          <div className="font-mono">{entry.recipient}</div>
          <div className="text-muted-foreground">
            {t("dispatch.transactionalEmail.sender")}
          </div>
          <div className="font-mono">{entry.sender}</div>
          <div className="text-muted-foreground">
            {t("dispatch.transactionalEmail.sendLogTemplate")}
          </div>
          <div className="font-mono">{entry.templateId ?? "—"}</div>
          <div className="text-muted-foreground">
            {t("dispatch.transactionalEmail.sendLogProvider")}
          </div>
          <div>{entry.provider}</div>
          <div className="text-muted-foreground">
            {t("dispatch.transactionalEmail.sendLogResponseStatus")}
          </div>
          <div>{entry.responseStatus ?? "—"}</div>
          {entry.error ? (
            <>
              <div className="text-muted-foreground">
                {t("dispatch.transactionalEmail.sendLogError")}
              </div>
              <div className="text-destructive">{entry.error}</div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SendLogSection({
  apps,
}: {
  apps: { id: string; name: string; path: string }[];
}) {
  const t = useT();
  const [appId, setAppId] = useState<string | undefined>(apps[0]?.id);
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [templateId, setTemplateId] = useState("all");
  const [excludeTemplateIds, setExcludeTemplateIds] = useState<string[]>([]);
  const [to, setTo] = useState("");
  const [excludeTo, setExcludeTo] = useState("");
  const [from, setFrom] = useState("");
  const [excludeFrom, setExcludeFrom] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [provider, setProvider] = useState<string>("all");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<SendLogEntry | null>(null);

  const debouncedTo = useDebounced(to);
  const debouncedExcludeTo = useDebounced(excludeTo);
  const debouncedFrom = useDebounced(from);
  const debouncedExcludeFrom = useDebounced(excludeFrom);
  const selectedApp = apps.find((app) => app.id === appId) ?? apps[0];

  useEffect(() => {
    setTemplateId("all");
    setExcludeTemplateIds([]);
  }, [selectedApp?.path]);

  useEffect(() => {
    setOffset(0);
  }, [
    appId,
    dateRange,
    templateId,
    excludeTemplateIds,
    debouncedTo,
    debouncedExcludeTo,
    debouncedFrom,
    debouncedExcludeFrom,
    status,
    provider,
  ]);

  const catalogQuery = useQuery({
    queryKey: ["send-log-email-catalog", selectedApp?.path],
    queryFn: () =>
      callAppAction<LocalTransactionalEmailCatalog>(
        selectedApp!.path,
        "list-transactional-emails",
        { windowDays: 30 },
        "GET",
      ),
    enabled: Boolean(selectedApp),
    staleTime: Infinity,
  });

  const templates = catalogQuery.data?.emails ?? [];

  const query = useQuery({
    queryKey: [
      "list-email-log",
      selectedApp?.path,
      dateRange,
      templateId,
      excludeTemplateIds.join(","),
      debouncedTo,
      debouncedExcludeTo,
      debouncedFrom,
      debouncedExcludeFrom,
      status,
      provider,
      offset,
    ],
    queryFn: () =>
      callAppAction<{ entries: SendLogEntry[] }>(
        selectedApp!.path,
        "list-email-log",
        {
          sinceMs: Date.now() - dateRangeToInterval(dateRange) * 86_400_000,
          ...(templateId !== "all" ? { templateId } : {}),
          ...(excludeTemplateIds.length > 0
            ? { excludeTemplateIds: excludeTemplateIds.join(",") }
            : {}),
          ...(debouncedTo ? { to: debouncedTo } : {}),
          ...(debouncedExcludeTo ? { excludeTo: debouncedExcludeTo } : {}),
          ...(debouncedFrom ? { from: debouncedFrom } : {}),
          ...(debouncedExcludeFrom
            ? { excludeFrom: debouncedExcludeFrom }
            : {}),
          ...(status !== "all" ? { status } : {}),
          ...(provider !== "all" ? { provider } : {}),
          limit: PAGE_SIZE + 1,
          offset,
        },
        "GET",
      ),
    enabled: Boolean(selectedApp),
  });

  const entries = (query.data?.entries ?? []).slice(0, PAGE_SIZE);
  const hasMore = (query.data?.entries.length ?? 0) > PAGE_SIZE;

  if (apps.length === 0) return null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={selectedApp?.id} onValueChange={setAppId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t("dispatch.transactionalEmail.app")} />
          </SelectTrigger>
          <SelectContent>
            {apps.map((app) => (
              <SelectItem key={app.id} value={app.id}>
                {app.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
        <Select value={templateId} onValueChange={setTemplateId}>
          <SelectTrigger
            aria-label={t("dispatch.transactionalEmail.sendLogTemplate")}
            className="w-64"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("dispatch.transactionalEmail.sendLogAllTemplates")}
            </SelectItem>
            {templates.map((email) => (
              <SelectItem key={email.id} value={email.id}>
                {email.name} · {email.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              aria-label={t(
                "dispatch.transactionalEmail.sendLogExcludeTemplates",
              )}
              disabled={catalogQuery.isLoading || templates.length === 0}
              className="w-40 justify-start"
            >
              {excludeTemplateIds.length > 0
                ? t(
                    "dispatch.transactionalEmail.sendLogExcludedTemplatesCount",
                    { count: excludeTemplateIds.length },
                  )
                : t("dispatch.transactionalEmail.sendLogExcludeTemplates")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-2">
            <div className="max-h-64 overflow-y-auto">
              {templates.map((email) => (
                <label
                  key={email.id}
                  className="flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 hover:bg-accent"
                >
                  <Checkbox
                    checked={excludeTemplateIds.includes(email.id)}
                    onCheckedChange={(checked) =>
                      setExcludeTemplateIds((current) =>
                        checked === true
                          ? [...current, email.id]
                          : current.filter((id) => id !== email.id),
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{email.name}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {email.id}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Input
          placeholder={t("dispatch.transactionalEmail.sendLogToFilter")}
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="w-44"
        />
        <Input
          placeholder={t("dispatch.transactionalEmail.sendLogExcludeToFilter")}
          value={excludeTo}
          onChange={(event) => setExcludeTo(event.target.value)}
          className="w-40"
        />
        <Input
          placeholder={t("dispatch.transactionalEmail.sendLogFromFilter")}
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className="w-44"
        />
        <Input
          placeholder={t(
            "dispatch.transactionalEmail.sendLogExcludeFromFilter",
          )}
          value={excludeFrom}
          onChange={(event) => setExcludeFrom(event.target.value)}
          className="w-40"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("dispatch.transactionalEmail.sendLogAllStatuses")}
            </SelectItem>
            <SelectItem value="sent">
              {t("dispatch.transactionalEmail.sendLogSent")}
            </SelectItem>
            <SelectItem value="failed">
              {t("dispatch.transactionalEmail.sendLogFailed")}
            </SelectItem>
          </SelectContent>
        </Select>
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("dispatch.transactionalEmail.sendLogAllProviders")}
            </SelectItem>
            <SelectItem value="resend">Resend</SelectItem>
            <SelectItem value="sendgrid">SendGrid</SelectItem>
            <SelectItem value="dev">Dev</SelectItem>
          </SelectContent>
        </Select>
        {(templateId !== "all" ||
          excludeTemplateIds.length > 0 ||
          to ||
          excludeTo ||
          from ||
          excludeFrom ||
          status !== "all" ||
          provider !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTemplateId("all");
              setExcludeTemplateIds([]);
              setTo("");
              setExcludeTo("");
              setFrom("");
              setExcludeFrom("");
              setStatus("all");
              setProvider("all");
            }}
          >
            {t("dispatch.transactionalEmail.sendLogClearFilters")}
          </Button>
        )}
      </div>

      {query.isError ? (
        <ActionQueryError
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : query.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {t("dispatch.transactionalEmail.sendLogEmpty")}
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("dispatch.transactionalEmail.sendLogTimestamp")}
                </TableHead>
                <TableHead>
                  {t("dispatch.transactionalEmail.recipient")}
                </TableHead>
                <TableHead>{t("dispatch.transactionalEmail.sender")}</TableHead>
                <TableHead>
                  {t("dispatch.transactionalEmail.sendLogTemplate")}
                </TableHead>
                <TableHead>{t("dispatch.transactionalEmail.status")}</TableHead>
                <TableHead>
                  {t("dispatch.transactionalEmail.sendLogProvider")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow
                  key={entry.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(entry)}
                >
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs">{entry.recipient}</TableCell>
                  <TableCell className="text-xs">{entry.sender}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {entry.templateId ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        entry.status === "failed" ? "destructive" : "secondary"
                      }
                    >
                      {entry.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{entry.provider}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() =>
                setOffset((current) => Math.max(0, current - PAGE_SIZE))
              }
            >
              {t("dispatch.transactionalEmail.sendLogPrevious")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore}
              onClick={() => setOffset((current) => current + PAGE_SIZE)}
            >
              {t("dispatch.transactionalEmail.sendLogNext")}
            </Button>
          </div>
        </>
      )}

      <SendLogDetailDialog
        entry={selected}
        open={selected !== null}
        onOpenChange={(next) => {
          if (!next) setSelected(null);
        }}
      />
    </div>
  );
}
