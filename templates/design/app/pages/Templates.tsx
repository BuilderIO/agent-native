import {
  askUserQuestion,
  buildSignInReturnHref,
  useActionMutation,
  useActionQuery,
  useSession,
  useT,
} from "@agent-native/core/client";
import {
  IconAd,
  IconArrowRight,
  IconFileDescription,
  IconMailOpened,
  IconPresentation,
  IconRocket,
  IconSpeakerphone,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { useMemo } from "react";
import { useNavigate } from "react-router";

import { useSetPageTitle } from "@/components/layout/HeaderActions";
import { Button } from "@/components/ui/button";
import {
  buildTemplateHtml,
  buildTemplateTweaks,
  DESIGN_TEMPLATES,
  getDefaultDesignSystem,
  type DesignSystemSummary,
  type DesignTemplate,
  type DesignTemplateKind,
} from "@/lib/design-templates";
import {
  clearPendingGeneration,
  writePendingGeneration,
} from "@/lib/pending-generation";

const iconByKind: Record<DesignTemplateKind, typeof IconFileDescription> = {
  "one-sheet": IconFileDescription,
  "social-ads": IconAd,
  "launch-page": IconRocket,
  "event-invite": IconMailOpened,
  "sales-deck": IconPresentation,
  "case-study": IconSpeakerphone,
};

type DesignListItem = {
  id: string;
  title: string;
  description?: string;
  projectType: "prototype" | "other";
  designSystemId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

function isAuthUnavailableError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 401 || status === 403;
}

export default function Templates() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createMutation = useActionMutation("create-design");
  const generateMutation = useActionMutation("generate-design");
  const { session, isLoading: sessionLoading } = useSession();

  const { data: designSystemsData } = useActionQuery<{
    count: number;
    designSystems: DesignSystemSummary[];
  }>("list-design-systems");

  const defaultDesignSystem = getDefaultDesignSystem(
    designSystemsData?.designSystems,
  );

  const previewHtmlById = useMemo(() => {
    return new Map(
      DESIGN_TEMPLATES.map((template) => [
        template.id,
        buildTemplateHtml(template, defaultDesignSystem),
      ]),
    );
  }, [defaultDesignSystem]);

  useSetPageTitle(t("navigation.templates"));

  const handleUseTemplate = async (template: DesignTemplate) => {
    if (sessionLoading) return;
    if (!session) {
      window.location.href = buildSignInReturnHref();
      return;
    }

    // One quick decision before generating: which format/viewport to target.
    // Skippable — fall back to the template's default sizing if dismissed.
    let format: unknown = null;
    try {
      format = await askUserQuestion({
        question: t("templatesPage.formatQuestion", {
          title: template.title.toLowerCase(),
        }),
        header: t("templatesPage.formatHeader"),
        options: [
          {
            label: t("templatesPage.desktop"),
            value: "desktop, 1280px wide",
            recommended: true,
          },
          { label: t("templatesPage.mobile"), value: "mobile, 390px wide" },
          { label: t("templatesPage.tablet"), value: "tablet, 1024px wide" },
          {
            label: t("templatesPage.socialSquare"),
            value: "social square, 1080×1080",
          },
        ],
        allowFreeText: false,
      });
    } catch (error) {
      if (!isAuthUnavailableError(error)) throw error;
      window.location.href = buildSignInReturnHref();
      return;
    }
    const formatDirective =
      typeof format === "string" && format
        ? `\n\nTarget format: ${format}.`
        : "";
    const prompt = `${template.prompt}${formatDirective}`;

    const id = nanoid();
    const now = new Date().toISOString();
    const html = buildTemplateHtml(template, defaultDesignSystem);
    const designSystemId = defaultDesignSystem?.id ?? null;
    const design: DesignListItem = {
      id,
      title: template.title,
      description: template.description,
      projectType: "prototype",
      designSystemId,
      createdAt: now,
      updatedAt: now,
    };

    writePendingGeneration(id, {
      title: template.title,
      prompt,
      source: template.title,
      autoGenerate: false,
    });

    for (const queryArgs of [undefined, { includePreview: "true" }]) {
      queryClient.setQueryData(
        ["action", "list-designs", queryArgs],
        (old: any) => ({
          count: (old?.count ?? 0) + 1,
          designs: [design, ...(old?.designs ?? [])],
        }),
      );
    }
    queryClient.setQueryData(["action", "get-design", { id }], {
      ...design,
      files: [],
    });

    void (async () => {
      await createMutation.mutateAsync({
        id,
        title: template.title,
        description: template.description,
        projectType: "prototype",
        designSystemId: designSystemId ?? undefined,
      } as any);

      await generateMutation.mutateAsync({
        designId: id,
        prompt,
        files: [
          {
            filename: template.filename,
            content: html,
            fileType: "html",
          },
        ],
        designSystemId: designSystemId ?? undefined,
        projectType: "prototype",
        tweaks: buildTemplateTweaks(defaultDesignSystem),
      } as any);

      queryClient.invalidateQueries({ queryKey: ["action", "get-design"] });
      queryClient.invalidateQueries({ queryKey: ["action", "list-designs"] });
    })().catch(() => {
      clearPendingGeneration(id);
      queryClient.invalidateQueries({ queryKey: ["action", "get-design"] });
      queryClient.invalidateQueries({ queryKey: ["action", "list-designs"] });
    });

    navigate(`/design/${id}`);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {t("templatesPage.title")}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t("templatesPage.description")}
            </p>
          </div>
          {defaultDesignSystem ? (
            <div className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
              {t("templatesPage.brand", { title: defaultDesignSystem.title })}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DESIGN_TEMPLATES.map((template) => {
            const Icon = iconByKind[template.kind];
            return (
              <article
                key={template.id}
                className="group overflow-hidden rounded-lg border border-border bg-card"
              >
                <div className="relative aspect-[4/3] overflow-hidden border-b border-border bg-muted">
                  <TemplatePreview
                    title={template.title}
                    html={previewHtmlById.get(template.id) ?? template.html}
                  />
                  <div className="absolute start-3 top-3 flex h-8 w-8 items-center justify-center rounded-md border border-white/70 bg-white/90 text-slate-900 shadow-sm dark:border-white/10 dark:bg-black/45 dark:text-white">
                    <Icon className="h-4 w-4" />
                  </div>
                </div>

                <div className="p-4">
                  <h3 className="mb-1 text-sm font-medium text-foreground/90">
                    {template.title}
                  </h3>
                  <div className="mb-2 inline-flex rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {template.format}
                  </div>
                  <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">
                    {template.description}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleUseTemplate(template)}
                    className="w-full cursor-pointer"
                  >
                    {t("templatesPage.useTemplate")}
                    <IconArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function TemplatePreview({ title, html }: { title: string; html: string }) {
  return (
    <iframe
      title={`${title} preview`}
      srcDoc={html}
      sandbox=""
      tabIndex={-1}
      className="pointer-events-none absolute left-0 top-0 h-[460%] w-[460%] origin-top-left scale-[0.2174] border-0 bg-white"
    />
  );
}
