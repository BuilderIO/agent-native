import { useActionMutation } from "@agent-native/core/client/hooks";
import { normalizeWorkspaceAppId } from "@agent-native/core/shared";
import {
  IconArrowUpRight,
  IconCircleCheck,
  IconPlus,
  IconPlugConnected,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { cn } from "../lib/utils";
import { AppIcon } from "./app-icon";
import { AppListRow } from "./app-list-row";
import { AppOpenActions } from "./app-open-actions";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Spinner } from "./ui/spinner";

export interface CuratedWorkspaceTemplate {
  id?: string | null;
  templateId?: string | null;
  appId?: string | null;
  name: string;
  description?: string | null;
  source?: string | null;
  sourceDescription?: string | null;
  icon?: string | null;
  color?: string | null;
  integrationSetup?: string | null;
  setupNote?: string | null;
  installed?: boolean | null;
  installedAppId?: string | null;
  liveUrl?: string | null;
  productUrl?: string | null;
}

export type CuratedWorkspaceTemplatesResult =
  | CuratedWorkspaceTemplate[]
  | {
      templates: CuratedWorkspaceTemplate[];
    };

export interface WorkspaceTemplateLabels {
  appId: string;
  appIdDescription: string;
  cancel: string;
  integrationSetup: string;
  installed: string;
  remix: string;
  remixing: string;
  remixSuccess: string;
  remixError: string;
  appIdRequired: string;
  source: string;
  openApp: string;
  viewLiveApp: string;
}

const DEFAULT_LABELS: WorkspaceTemplateLabels = {
  appId: "App ID",
  appIdDescription: "Choose the URL-safe id for the new workspace app.",
  cancel: "Cancel",
  integrationSetup: "Integration setup",
  installed: "Installed",
  remix: "Add app",
  remixing: "Creating app…",
  remixSuccess: "Template app creation started.",
  remixError: "Could not add this app",
  appIdRequired: "App ID is required.",
  source: "Source",
  openApp: "Open app",
  viewLiveApp: "View the live app",
};

export interface WorkspaceTemplateCardProps {
  template: CuratedWorkspaceTemplate;
  defaultAppId?: string;
  labels?: Partial<WorkspaceTemplateLabels>;
  className?: string;
  catalog?: boolean;
  onRemixSuccess?: (
    result: unknown,
    template: CuratedWorkspaceTemplate,
  ) => void;
}

function templateIdFor(template: CuratedWorkspaceTemplate): string {
  return template.templateId || template.id || template.appId || template.name;
}

function defaultAppIdFor(
  template: CuratedWorkspaceTemplate,
  defaultAppId?: string,
): string {
  if (defaultAppId) return normalizeWorkspaceAppId(defaultAppId) || "new-app";
  const sourceId =
    normalizeWorkspaceAppId(template.appId || template.name) || "new-app";
  return `${sourceId}-app`;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function mergeLabels(
  labels?: Partial<WorkspaceTemplateLabels>,
): WorkspaceTemplateLabels {
  return { ...DEFAULT_LABELS, ...labels };
}

export function WorkspaceTemplateCard({
  template,
  defaultAppId,
  labels: labelOverrides,
  className,
  catalog = false,
  onRemixSuccess,
}: WorkspaceTemplateCardProps) {
  const labels = useMemo(() => mergeLabels(labelOverrides), [labelOverrides]);
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState(() =>
    defaultAppIdFor(template, defaultAppId),
  );
  const isInstalled = Boolean(template.installed || template.installedAppId);
  const liveUrl = template.liveUrl || template.productUrl;
  const setupNote = template.integrationSetup || template.setupNote;
  const remix = useActionMutation("remix-workspace-template", {
    onSuccess: (result) => {
      const mode = (result as { mode?: string } | null)?.mode;
      const message = (result as { message?: string } | null)?.message;
      if (mode === "builder") {
        toast.success(labels.remixSuccess);
      } else if (mode === "builder-unavailable") {
        toast.error(message || labels.remixError);
      } else if (mode === "coming-soon") {
        toast.info(message || labels.remixSuccess);
      } else {
        toast.success(labels.remixSuccess);
      }
      setOpen(false);
      onRemixSuccess?.(result, template);
    },
    onError: (error) =>
      toast.error(`${labels.remixError}: ${stringifyError(error)}`),
  });

  useEffect(() => {
    if (open) {
      setAppId(defaultAppIdFor(template, defaultAppId));
    }
  }, [defaultAppId, open, template]);

  function submitRemix() {
    const normalizedAppId = normalizeWorkspaceAppId(appId);
    if (!normalizedAppId) {
      toast.error(labels.appIdRequired);
      return;
    }
    setAppId(normalizedAppId);

    remix.mutate({
      templateId: templateIdFor(template),
      appId: normalizedAppId,
    });
  }

  return (
    <AppListRow className={cn("items-center", className)}>
      <AppIcon
        id={template.id || template.templateId || template.name}
        name={template.name}
        icon={template.icon || undefined}
        color={template.color || undefined}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {template.name}
          </h3>
          {isInstalled ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-primary">
              <IconCircleCheck size={13} />
              {labels.installed}
            </span>
          ) : null}
        </div>
        {template.description ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {template.description}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {catalog ? (
          <>
            {liveUrl ? (
              <AppOpenActions
                name={template.name}
                href={liveUrl}
                target="_blank"
                rel="noreferrer"
                labels={{ openApp: labels.openApp }}
              />
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(true)}
            >
              <IconPlus />
              {labels.remix}
            </Button>
          </>
        ) : liveUrl ? (
          <Button variant="ghost" size="sm" className="shrink-0" asChild>
            <a href={liveUrl} target="_blank" rel="noreferrer">
              {labels.viewLiveApp}
              <IconArrowUpRight />
            </a>
          </Button>
        ) : null}

        <Dialog
          open={open}
          onOpenChange={(nextOpen) => {
            if (!remix.isPending) setOpen(nextOpen);
          }}
        >
          {!catalog ? (
            <DialogTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <IconPlus />
                {labels.remix}
              </Button>
            </DialogTrigger>
          ) : null}
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{template.name}</DialogTitle>
              <DialogDescription>{labels.appIdDescription}</DialogDescription>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                submitRemix();
              }}
            >
              <div className="flex flex-col gap-2">
                <Label
                  htmlFor={`workspace-template-app-id-${templateIdFor(template)}`}
                >
                  {labels.appId}
                </Label>
                <Input
                  id={`workspace-template-app-id-${templateIdFor(template)}`}
                  value={appId}
                  autoComplete="off"
                  onChange={(event) => setAppId(event.target.value)}
                  onBlur={() => setAppId(normalizeWorkspaceAppId(appId))}
                  disabled={remix.isPending}
                />
              </div>
              {setupNote ? (
                <div className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
                  <IconPlugConnected className="mt-0.5 shrink-0" size={15} />
                  <span>
                    <span className="font-medium text-foreground">
                      {labels.integrationSetup}:
                    </span>{" "}
                    {setupNote}
                  </span>
                </div>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={remix.isPending}
                >
                  {labels.cancel}
                </Button>
                <Button type="submit" disabled={remix.isPending}>
                  {remix.isPending ? <Spinner /> : <IconArrowUpRight />}
                  {remix.isPending ? labels.remixing : labels.remix}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </AppListRow>
  );
}

export interface WorkspaceTemplatesSectionProps {
  templates: CuratedWorkspaceTemplatesResult;
  title?: ReactNode;
  defaultAppId?: string;
  labels?: Partial<WorkspaceTemplateLabels>;
  className?: string;
  cardClassName?: string;
  listClassName?: string;
  catalog?: boolean;
  onRemixSuccess?: (
    result: unknown,
    template: CuratedWorkspaceTemplate,
  ) => void;
}

function getTemplateItems(
  result: CuratedWorkspaceTemplatesResult,
): CuratedWorkspaceTemplate[] {
  return Array.isArray(result) ? result : result.templates;
}

export function WorkspaceTemplatesSection({
  templates: result,
  title,
  defaultAppId,
  labels,
  className,
  cardClassName,
  listClassName,
  catalog = false,
  onRemixSuccess,
}: WorkspaceTemplatesSectionProps) {
  const templates = getTemplateItems(result);

  if (templates.length === 0) return null;

  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {title ? <div className="text-sm font-semibold">{title}</div> : null}
      <div className={cn("overflow-hidden rounded-2xl bg-card", listClassName)}>
        {templates.map((template) => (
          <WorkspaceTemplateCard
            key={templateIdFor(template)}
            template={template}
            defaultAppId={defaultAppId}
            labels={labels}
            catalog={catalog}
            className={cardClassName}
            onRemixSuccess={onRemixSuccess}
          />
        ))}
      </div>
    </section>
  );
}
