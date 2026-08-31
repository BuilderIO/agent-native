import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconDots, IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { CreateTemplateDialog } from "@/components/library/CreateTemplateDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { assetContentUrl } from "@/lib/asset-urls";

function pinnedAssetIds(template: any): string[] {
  const references = Array.isArray(template.settings?.presetReferences)
    ? template.settings.presetReferences
    : [];
  return references
    .flatMap((reference: any) =>
      Array.isArray(reference?.assetIds) ? reference.assetIds : [],
    )
    .filter((id: unknown): id is string => typeof id === "string")
    .slice(0, 3);
}

function TemplateCard({
  template,
  onDelete,
  onDuplicateIntoBrandKit,
}: {
  template: any;
  onDelete: () => void;
  onDuplicateIntoBrandKit: () => void;
}) {
  const t = useT();
  const duplicate = useActionMutation("duplicate-template");
  const includeLogo = Boolean(
    template.includeLogo ?? template.settings?.includeLogo,
  );
  const referenceIds = pinnedAssetIds(template);
  return (
    <article className="flex min-h-36 flex-col rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div className="flex items-start justify-between gap-3">
        <h3 className="truncate text-sm font-semibold">{template.title}</h3>
        <Badge variant="outline">{template.aspectRatio}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge variant={template.libraryId ? "outline" : "secondary"}>
          {template.libraryTitle ||
            (template.libraryId
              ? t("navigation.library")
              : t("templates.global"))}
        </Badge>
        <Badge variant="outline">{template.imageSize}</Badge>
        {includeLogo ? (
          <Badge variant="secondary">{t("brandKitDetail.logo")}</Badge>
        ) : null}
      </div>
      {template.description ? (
        <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">
          {template.description}
        </p>
      ) : null}
      {referenceIds.length ? (
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-md border border-border bg-muted p-1">
          {referenceIds.map((assetId) => (
            <img
              key={assetId}
              alt=""
              className="aspect-square w-full rounded-sm object-cover"
              loading="lazy"
              src={assetContentUrl(assetId, { variant: "thumb" })}
            />
          ))}
        </div>
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/templates/${template.id}`}>{t("templates.edit")}</Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${t("templates.edit")} ${template.title}`}
            >
              <IconDots />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                duplicate.mutate(
                  { id: template.id },
                  {
                    onSuccess: () => toast.success(t("templates.created")),
                    onError: (error: Error) => toast.error(error.message),
                  },
                )
              }
            >
              {t("templates.duplicate")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicateIntoBrandKit}>
              {t("templates.duplicateIntoBrandKit")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onSelect={onDelete}>
              <IconTrash />
              {t("templates.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}

export default function TemplatesIndexRoute() {
  const t = useT();
  const navigate = useNavigate();
  const [scope, setScope] = useState("all");
  const { data: librariesData } = useActionQuery("list-libraries", {
    compact: true,
  }) as any;
  const selectedLibraryId = scope.startsWith("library:")
    ? scope.slice("library:".length)
    : undefined;
  const { data, isLoading, error } = useActionQuery("list-templates", {
    scope:
      scope === "global" ? "global" : selectedLibraryId ? "library" : "all",
    libraryId: selectedLibraryId,
  }) as any;
  const remove = useActionMutation("delete-template");
  const duplicate = useActionMutation("duplicate-template");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTemplate, setDeleteTemplate] = useState<any>(null);
  const [duplicateTemplate, setDuplicateTemplate] = useState<any>(null);
  const [duplicateLibraryId, setDuplicateLibraryId] = useState("");
  const templates = Array.isArray(data?.templates) ? data.templates : [];
  const filtered = useMemo(
    () =>
      templates.filter((template: any) =>
        `${template.title} ${template.description ?? ""} ${template.category ?? ""}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
      ),
    [search, templates],
  );
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("templates.all")}</SelectItem>
            <SelectItem value="global">{t("templates.globalOnly")}</SelectItem>
            {(librariesData?.libraries ?? []).map((library: any) => (
              <SelectItem key={library.id} value={`library:${library.id}`}>
                {library.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative min-w-48 flex-1">
          <IconSearch className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="ps-9"
            placeholder={t("templates.search")}
          />
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <IconPlus />
          {t("templates.new")}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t("templates.unavailableTitle")}</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : String(error)}
          </AlertDescription>
        </Alert>
      ) : null}
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="min-h-36 rounded-lg" />
          ))}
        </div>
      ) : null}
      {!isLoading && !error && filtered.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((template: any) => (
            <TemplateCard
              key={template.id}
              template={template}
              onDelete={() => setDeleteTemplate(template)}
              onDuplicateIntoBrandKit={() => {
                setDuplicateLibraryId("");
                setDuplicateTemplate(template);
              }}
            />
          ))}
        </div>
      ) : null}
      {!isLoading && !error && !filtered.length ? (
        <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          <div>
            {templates.length
              ? t("templates.noMatches")
              : t("templates.noTemplates")}
          </div>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            onClick={() =>
              templates.length ? setSearch("") : setCreateOpen(true)
            }
          >
            {templates.length
              ? t("templates.clearFilters")
              : t("templates.new")}
          </Button>
        </div>
      ) : null}
      <CreateTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(template) => {
          if (template?.id) navigate(`/templates/${template.id}`);
        }}
      />
      <AlertDialog
        open={Boolean(duplicateTemplate)}
        onOpenChange={(open) => !open && setDuplicateTemplate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("templates.duplicateIntoBrandKit")}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <Select
            value={duplicateLibraryId}
            onValueChange={setDuplicateLibraryId}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("templates.brandKit")} />
            </SelectTrigger>
            <SelectContent>
              {(librariesData?.libraries ?? []).map((library: any) => (
                <SelectItem key={library.id} value={library.id}>
                  {library.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("brandKitDetail.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!duplicateLibraryId || duplicate.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!duplicateTemplate || !duplicateLibraryId) return;
                duplicate.mutate(
                  { id: duplicateTemplate.id, libraryId: duplicateLibraryId },
                  {
                    onSuccess: (result: any) => {
                      setDuplicateTemplate(null);
                      toast.success(t("templates.created"));
                      if (result?.id) navigate(`/templates/${result.id}`);
                    },
                    onError: (error: Error) => toast.error(error.message),
                  },
                );
              }}
            >
              {t("templates.duplicate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(deleteTemplate)}
        onOpenChange={(open) => !open && setDeleteTemplate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("templates.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("templates.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("brandKitDetail.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                if (!deleteTemplate) return;
                remove.mutate(
                  { id: deleteTemplate.id },
                  {
                    onSuccess: () => {
                      setDeleteTemplate(null);
                      toast.success(t("templates.deleted"));
                    },
                    onError: (deleteError: Error) =>
                      toast.error(
                        deleteError.message === "template-in-use"
                          ? t("templates.deleteInUse")
                          : deleteError.message || t("templates.deleteFailed"),
                      ),
                  },
                );
              }}
            >
              {t("templates.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
