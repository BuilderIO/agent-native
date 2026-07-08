/**
 * Full-page status-page editor: a config form on the left (basics, layout,
 * monitor selection + ordering) and a live preview on the right that reuses the
 * public `PublicStatusView`. Everything persists through the `save-status-page`
 * action (the single write); `get-status-page` supplies both the seed config and
 * the sanitized live preview (drafts included).
 */
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconExternalLink,
  IconLoader2,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PublicStatusView } from "@/components/monitoring/PublicStatusView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { MonitorSummary } from "../types";
import { hostFromUrl } from "../utils";
import { fmt, useStatusPagesT } from "./i18n";
import { isValidSlug, slugify } from "./slug";
import type {
  StatusPageAlignment,
  StatusPageDensity,
  StatusPageInput,
  StatusPagePreview,
} from "./types";

interface MonitorDraft {
  monitorId: string;
  displayName: string;
  showUrl: boolean;
}

interface Draft {
  title: string;
  slug: string;
  description: string;
  published: boolean;
  showUptimeBars: boolean;
  showOverallUptime: boolean;
  showResponseTime: boolean;
  density: StatusPageDensity;
  alignment: StatusPageAlignment;
  monitors: MonitorDraft[];
}

function emptyDraft(): Draft {
  return {
    title: "",
    slug: "",
    description: "",
    published: false,
    showUptimeBars: true,
    showOverallUptime: true,
    showResponseTime: false,
    density: "comfortable",
    alignment: "left",
    monitors: [],
  };
}

function statusPageOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export function StatusPageEditor({
  pageId,
  onBack,
  onCreated,
}: {
  pageId: string | null;
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useStatusPagesT();
  const isEdit = !!pageId;

  const { data, isLoading } = useActionQuery<StatusPagePreview>(
    "get-status-page",
    { id: pageId ?? "" },
    { enabled: isEdit, staleTime: 10_000 },
  );
  const { data: monitorList } = useActionQuery<MonitorSummary[]>(
    "list-monitors",
    undefined,
    { staleTime: 30_000 },
  );

  const save = useActionMutation<{ id: string; slug: string }, StatusPageInput>(
    "save-status-page",
  );

  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const slugTouched = useRef(false);
  const seededRef = useRef<string | null>(null);

  // Seed the draft once from the loaded page (edit) or reset for a new page.
  useEffect(() => {
    if (!isEdit) {
      if (seededRef.current !== "new") {
        setDraft(emptyDraft());
        slugTouched.current = false;
        seededRef.current = "new";
      }
      return;
    }
    const page = data?.page;
    if (page && seededRef.current !== page.id) {
      setDraft({
        title: page.title,
        slug: page.slug,
        description: page.description ?? "",
        published: page.published,
        showUptimeBars: page.showUptimeBars,
        showOverallUptime: page.showOverallUptime,
        showResponseTime: page.showResponseTime,
        density: page.density,
        alignment: page.alignment,
        monitors: page.monitors.map((ref) => ({
          monitorId: ref.monitorId,
          displayName: ref.displayName ?? "",
          showUrl: ref.showUrl,
        })),
      });
      slugTouched.current = true;
      seededRef.current = page.id;
    }
  }, [isEdit, data]);

  const monitors = useMemo(
    () => (Array.isArray(monitorList) ? monitorList : []),
    [monitorList],
  );
  const monitorById = useMemo(() => {
    const map = new Map<string, MonitorSummary>();
    for (const monitor of monitors) map.set(monitor.id, monitor);
    return map;
  }, [monitors]);
  const availableMonitors = useMemo(() => {
    const chosen = new Set(draft.monitors.map((m) => m.monitorId));
    return monitors.filter((monitor) => !chosen.has(monitor.id));
  }, [monitors, draft.monitors]);

  const patch = (next: Partial<Draft>) =>
    setDraft((prev) => ({ ...prev, ...next }));

  const onTitleChange = (value: string) => {
    setDraft((prev) => ({
      ...prev,
      title: value,
      slug: slugTouched.current ? prev.slug : slugify(value),
    }));
  };

  const onSlugChange = (value: string) => {
    slugTouched.current = true;
    patch({ slug: value.toLowerCase().replace(/[^a-z0-9-]/g, "") });
  };

  const addMonitor = (monitorId: string) => {
    if (!monitorId) return;
    setDraft((prev) =>
      prev.monitors.some((m) => m.monitorId === monitorId)
        ? prev
        : {
            ...prev,
            monitors: [
              ...prev.monitors,
              { monitorId, displayName: "", showUrl: false },
            ],
          },
    );
  };

  const updateMonitor = (index: number, next: Partial<MonitorDraft>) =>
    setDraft((prev) => ({
      ...prev,
      monitors: prev.monitors.map((m, i) =>
        i === index ? { ...m, ...next } : m,
      ),
    }));

  const removeMonitor = (index: number) =>
    setDraft((prev) => ({
      ...prev,
      monitors: prev.monitors.filter((_, i) => i !== index),
    }));

  const moveMonitor = (index: number, dir: -1 | 1) =>
    setDraft((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.monitors.length) return prev;
      const next = [...prev.monitors];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return { ...prev, monitors: next };
    });

  const slugForLink = draft.slug.trim();
  const publicUrl = slugForLink
    ? `${statusPageOrigin()}/status/${slugForLink}`
    : "";
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t.copyFailed);
    }
  };

  const submit = async () => {
    const title = draft.title.trim();
    if (!title) {
      toast.error(t.titleRequired);
      return;
    }
    const slug = draft.slug.trim();
    if (slug && !isValidSlug(slug)) {
      toast.error(t.slugInvalid);
      return;
    }
    const input: StatusPageInput = {
      id: pageId ?? undefined,
      title,
      slug: slug || undefined,
      description: draft.description.trim() || null,
      published: draft.published,
      showUptimeBars: draft.showUptimeBars,
      showOverallUptime: draft.showOverallUptime,
      showResponseTime: draft.showResponseTime,
      density: draft.density,
      alignment: draft.alignment,
      monitors: draft.monitors.map((m) => ({
        monitorId: m.monitorId,
        displayName: m.displayName.trim() || null,
        showUrl: m.showUrl,
      })),
    };
    try {
      const saved = await save.mutateAsync(input);
      toast.success(t.savedToast);
      if (!isEdit && saved?.id) onCreated(saved.id);
    } catch (err) {
      toast.error(
        fmt(t.saveFailed, {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  };

  if (isEdit && isLoading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const view = data?.view ?? null;

  return (
    <div className="space-y-5 pb-16">
      <Button
        variant="ghost"
        size="sm"
        className="-ms-2 w-fit text-muted-foreground"
        onClick={onBack}
      >
        <IconArrowLeft className="size-3.5" />
        {t.backToPages}
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">
            {isEdit ? t.editTitle : t.createTitle}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isEdit ? t.editSubtitle : t.createSubtitle}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={copyLink}
            disabled={!publicUrl}
          >
            {copied ? (
              <IconCheck className="size-3.5" />
            ) : (
              <IconCopy className="size-3.5" />
            )}
            {copied ? t.copied : t.copyLink}
          </Button>
          <Button
            variant="outline"
            size="sm"
            asChild
            disabled={!publicUrl || !draft.published}
          >
            <a
              href={publicUrl || "#"}
              target="_blank"
              rel="noreferrer noopener"
              aria-disabled={!publicUrl || !draft.published}
              className={cn(
                (!publicUrl || !draft.published) &&
                  "pointer-events-none opacity-50",
              )}
            >
              <IconExternalLink className="size-3.5" />
              {t.openPage}
            </a>
          </Button>
          <Button size="sm" onClick={submit} disabled={save.isPending}>
            {save.isPending ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : null}
            {save.isPending ? t.saving : t.save}
          </Button>
        </div>
      </div>

      {publicUrl ? (
        <p className="text-xs text-muted-foreground">
          {draft.published
            ? fmt(t.linkLive, { url: `/status/${slugForLink}` })
            : fmt(t.linkLiveHint, { url: `/status/${slugForLink}` })}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Config */}
        <div className="space-y-5 lg:col-span-3">
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                {t.sectionBasics}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="sp-title">{t.fieldTitle}</Label>
                <Input
                  id="sp-title"
                  value={draft.title}
                  placeholder={t.fieldTitlePlaceholder}
                  onChange={(e) => onTitleChange(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sp-slug">{t.fieldSlug}</Label>
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 text-xs text-muted-foreground">
                    /status/
                  </span>
                  <Input
                    id="sp-slug"
                    value={draft.slug}
                    placeholder="acme-status"
                    onChange={(e) => onSlugChange(e.target.value)}
                    className={cn(
                      draft.slug && !isValidSlug(draft.slug)
                        ? "border-destructive"
                        : undefined,
                    )}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.fieldSlugHint}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sp-desc">{t.fieldDescription}</Label>
                <Textarea
                  id="sp-desc"
                  value={draft.description}
                  placeholder={t.fieldDescriptionPlaceholder}
                  rows={2}
                  onChange={(e) => patch({ description: e.target.value })}
                />
              </div>
              <ToggleRow
                label={t.fieldPublished}
                hint={t.fieldPublishedHint}
                checked={draft.published}
                onChange={(v) => patch({ published: v })}
              />
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                {t.sectionLayout}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow
                label={t.fieldShowOverallUptime}
                checked={draft.showOverallUptime}
                onChange={(v) => patch({ showOverallUptime: v })}
              />
              <ToggleRow
                label={t.fieldShowUptimeBars}
                checked={draft.showUptimeBars}
                onChange={(v) => patch({ showUptimeBars: v })}
              />
              <ToggleRow
                label={t.fieldShowResponseTime}
                checked={draft.showResponseTime}
                onChange={(v) => patch({ showResponseTime: v })}
              />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t.fieldDensity}</Label>
                  <Select
                    value={draft.density}
                    onValueChange={(v) =>
                      patch({ density: v as StatusPageDensity })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="comfortable">
                        {t.densityComfortable}
                      </SelectItem>
                      <SelectItem value="compact">
                        {t.densityCompact}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t.fieldAlignment}</Label>
                  <Select
                    value={draft.alignment}
                    onValueChange={(v) =>
                      patch({ alignment: v as StatusPageAlignment })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">{t.alignmentLeft}</SelectItem>
                      <SelectItem value="center">
                        {t.alignmentCenter}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                {t.sectionMonitors}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {t.sectionMonitorsHint}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {draft.monitors.length === 0 ? (
                <p className="rounded-md border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
                  {t.noMonitorsSelected}
                </p>
              ) : (
                <div className="space-y-2">
                  {draft.monitors.map((ref, index) => {
                    const monitor = monitorById.get(ref.monitorId);
                    return (
                      <div
                        key={ref.monitorId}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-2"
                      >
                        <div className="flex shrink-0 flex-col">
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                            onClick={() => moveMonitor(index, -1)}
                            disabled={index === 0}
                            aria-label={t.moveUp}
                          >
                            <IconChevronUp className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                            onClick={() => moveMonitor(index, 1)}
                            disabled={index === draft.monitors.length - 1}
                            aria-label={t.moveDown}
                          >
                            <IconChevronDown className="size-3.5" />
                          </button>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium">
                            {monitor?.name ?? ref.monitorId}
                          </div>
                          {monitor ? (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {hostFromUrl(monitor.url)}
                            </div>
                          ) : null}
                        </div>
                        <Input
                          value={ref.displayName}
                          placeholder={t.displayNamePlaceholder}
                          onChange={(e) =>
                            updateMonitor(index, {
                              displayName: e.target.value,
                            })
                          }
                          className="h-8 w-full text-xs sm:w-44"
                        />
                        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Switch
                            checked={ref.showUrl}
                            onCheckedChange={(v) =>
                              updateMonitor(index, { showUrl: v })
                            }
                          />
                          {t.showUrl}
                        </label>
                        <button
                          type="button"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeMonitor(index)}
                          aria-label={t.remove}
                        >
                          <IconX className="size-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {monitors.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t.createMonitorsFirst}
                </p>
              ) : availableMonitors.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t.noMonitorsAvailable}
                </p>
              ) : (
                <Select value="" onValueChange={addMonitor}>
                  <SelectTrigger className="w-full">
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <IconPlus className="size-3.5" />
                      {t.addMonitor}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {availableMonitors.map((monitor) => (
                      <SelectItem key={monitor.id} value={monitor.id}>
                        {monitor.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Live preview */}
        <div className="lg:col-span-2">
          <div className="lg:sticky lg:top-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t.sectionPreview}
              </span>
              {!draft.published ? (
                <Badge variant="secondary" className="text-[10px]">
                  {t.draftBadge}
                </Badge>
              ) : null}
            </div>
            {view ? (
              <div className="max-h-[75vh] overflow-y-auto rounded-lg border border-border/50">
                <PublicStatusView page={view} />
              </div>
            ) : (
              <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border/60 px-4 text-center text-sm text-muted-foreground">
                {t.previewSaveFirst}
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              {view && !draft.published ? t.previewDraftNote : t.previewHint}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint ? (
          <div className="text-xs text-muted-foreground">{hint}</div>
        ) : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
