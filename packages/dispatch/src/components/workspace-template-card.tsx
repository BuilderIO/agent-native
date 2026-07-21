import { useActionMutation } from "@agent-native/core/client/hooks";
import {
  IconArrowUpRight,
  IconCircleCheck,
  IconCopy,
  IconExternalLink,
  IconFileText,
  IconPlugConnected,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { cn } from "../lib/utils";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
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
  viewLiveApp: string;
}

const DEFAULT_LABELS: WorkspaceTemplateLabels = {
  appId: "App ID",
  appIdDescription: "Choose the URL-safe id for the new workspace app.",
  cancel: "Cancel",
  integrationSetup: "Integration setup",
  installed: "Installed",
  remix: "Remix into workspace",
  remixing: "Remixing…",
  remixSuccess: "Template remixed into your workspace.",
  remixError: "Could not remix this template",
  appIdRequired: "App ID is required.",
  source: "Source",
  viewLiveApp: "View the live app",
};

export interface WorkspaceTemplateCardProps {
  template: CuratedWorkspaceTemplate;
  defaultAppId?: string;
  labels?: Partial<WorkspaceTemplateLabels>;
  className?: string;
  onRemixSuccess?: (
    result: unknown,
    template: CuratedWorkspaceTemplate,
  ) => void;
}

function slugifyAppId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "new-app"
  );
}

function templateIdFor(template: CuratedWorkspaceTemplate): string {
  return template.templateId || template.id || template.appId || template.name;
}

function defaultAppIdFor(
  template: CuratedWorkspaceTemplate,
  defaultAppId?: string,
): string {
  if (defaultAppId) return slugifyAppId(defaultAppId);
  const sourceId = slugifyAppId(template.appId || template.name);
  return `${sourceId}-remix`;
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
      toast.success(labels.remixSuccess);
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
    const trimmedAppId = appId.trim();
    if (!trimmedAppId) {
      toast.error(labels.appIdRequired);
      return;
    }

    remix.mutate({
      templateId: templateIdFor(template),
      appId: trimmedAppId,
    });
  }

  return (
    <Card
      className={cn(
        "flex h-full flex-col border-border/60 bg-card/40 shadow-none transition-[background-color,border-color] hover:border-foreground/20 hover:bg-accent/15",
        className,
      )}
    >
      <CardHeader className="gap-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/40 text-muted-foreground">
              <IconFileText size={16} />
            </span>
            <div className="min-w-0">
              <CardTitle className="truncate text-sm font-semibold">
                {template.name}
              </CardTitle>
              {template.source || template.sourceDescription ? (
                <CardDescription className="mt-1 truncate text-xs">
                  <span className="font-medium text-foreground/70">
                    {labels.source}:
                  </span>{" "}
                  {template.sourceDescription || template.source}
                </CardDescription>
              ) : null}
            </div>
          </div>
          {isInstalled ? (
            <Badge
              variant="outline"
              className="shrink-0 gap-1 border-primary/30 bg-primary/5 text-primary"
            >
              <IconCircleCheck size={13} />
              {labels.installed}
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 p-4 pt-0">
        {template.description ? (
          <p className="line-clamp-3 text-[13px] leading-5 text-muted-foreground">
            {template.description}
          </p>
        ) : null}

        {setupNote ? (
          <Alert className="border-border/60 bg-muted/25 px-3 py-2 [&>svg]:left-3 [&>svg]:top-2.5">
            <IconPlugConnected size={15} />
            <AlertDescription className="text-xs leading-5">
              <span className="font-medium text-foreground/80">
                {labels.integrationSetup}:
              </span>{" "}
              {setupNote}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>

      <CardFooter className="flex flex-wrap justify-between gap-2 p-4 pt-0">
        {liveUrl ? (
          <Button variant="link" size="sm" className="h-8 px-0" asChild>
            <a href={liveUrl} target="_blank" rel="noreferrer">
              {labels.viewLiveApp}
              <IconExternalLink />
            </a>
          </Button>
        ) : (
          <span />
        )}

        <Dialog
          open={open}
          onOpenChange={(nextOpen) => {
            if (!remix.isPending) setOpen(nextOpen);
          }}
        >
          <DialogTrigger asChild>
            <Button type="button" size="sm">
              <IconCopy />
              {labels.remix}
            </Button>
          </DialogTrigger>
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
                  disabled={remix.isPending}
                />
              </div>
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
      </CardFooter>
    </Card>
  );
}

export interface WorkspaceTemplatesSectionProps {
  templates: CuratedWorkspaceTemplatesResult;
  title?: ReactNode;
  defaultAppId?: string;
  labels?: Partial<WorkspaceTemplateLabels>;
  className?: string;
  cardClassName?: string;
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
  onRemixSuccess,
}: WorkspaceTemplatesSectionProps) {
  const templates = getTemplateItems(result);

  if (templates.length === 0) return null;

  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {title ? <div className="text-sm font-semibold">{title}</div> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {templates.map((template) => (
          <WorkspaceTemplateCard
            key={templateIdFor(template)}
            template={template}
            defaultAppId={defaultAppId}
            labels={labels}
            className={cardClassName}
            onRemixSuccess={onRemixSuccess}
          />
        ))}
      </div>
    </section>
  );
}
