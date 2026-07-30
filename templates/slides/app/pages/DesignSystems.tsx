import { callAction, useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@agent-native/toolkit/app-shell";
import {
  IconAlertTriangle,
  IconPalette,
  IconPlus,
  IconRefresh,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DesignSystemCard } from "@/components/design-system/DesignSystemCard";
import { DesignSystemSetup } from "@/components/design-system/DesignSystemSetup";
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
import { Button } from "@/components/ui/button";
import { useDesignSystems } from "@/hooks/use-design-systems";
import { useWorkspaceDefaults } from "@/hooks/use-workspace-defaults";

import type { DesignSystemData } from "../../shared/api";
import { missingDesignSystemDataFields } from "../../shared/design-system-validation";

export default function DesignSystems() {
  const t = useT();
  const { designSystems, isLoading, error, refetch } = useDesignSystems();
  const {
    designSystem: workspaceDesignSystem,
    canManage: canManageWorkspaceDefaults,
    refetch: refetchWorkspaceDefaults,
  } = useWorkspaceDefaults();
  const [showSetup, setShowSetup] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [workspaceDefaultCandidate, setWorkspaceDefaultCandidate] = useState<
    (typeof designSystems)[number] | undefined
  >(undefined);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteMutation = useActionMutation("delete-design-system");

  const handleCardClick = (id: string) => {
    setEditingId(id);
    setShowSetup(true);
  };

  const handleSetDefault = async (id: string) => {
    try {
      await callAction("set-default-design-system", { id });
      refetch();
    } catch (err) {
      console.error("Failed to set default design system:", err);
    }
  };

  const applyWorkspaceDefault = async (ds: (typeof designSystems)[number]) => {
    try {
      // Private means unreadable to teammates, which would make the workspace
      // default silently do nothing for them. Share through the audited action.
      if (ds.visibility === "private") {
        await callAction("set-resource-visibility", {
          resourceType: "design-system",
          resourceId: ds.id,
          visibility: "org",
        });
        refetch();
      }
      await callAction("set-workspace-defaults", { designSystemId: ds.id });
      await refetchWorkspaceDefaults();
      toast.success(t("home.workspaceDefaultSet"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("home.workspaceDefaultFailed"),
      );
    }
  };

  const handleSetWorkspaceDefault = async (id: string, isDefault: boolean) => {
    if (isDefault) {
      const ds = designSystems.find((d) => d.id === id);
      if (!ds) return;
      // Only publishing a private design system to the whole workspace is
      // worth a confirmation; the default itself is one click to undo.
      if (ds.visibility === "private") {
        setWorkspaceDefaultCandidate(ds);
        return;
      }
      await applyWorkspaceDefault(ds);
      return;
    }
    try {
      await callAction("set-workspace-defaults", { designSystemId: null });
      await refetchWorkspaceDefaults();
      toast.success(t("home.workspaceDefaultCleared"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("home.workspaceDefaultFailed"),
      );
    }
  };

  const confirmWorkspaceDefault = () => {
    // Read but do not clear: AlertDialogAction closes the dialog, and clearing
    // here too would pre-empt Radix's cleanup and leave <body> at
    // `pointer-events: none`. `onOpenChange` clears the candidate.
    const ds = workspaceDefaultCandidate;
    if (!ds) return;
    void applyWorkspaceDefault(ds);
  };

  const handleComplete = () => {
    setShowSetup(false);
    setEditingId(null);
    refetch();
  };

  const handleClose = () => {
    setShowSetup(false);
    setEditingId(null);
  };

  const handleConfirmDelete = () => {
    if (deleteId === null) return;
    const id = deleteId;
    setDeleteId(null);
    deleteMutation.mutate({ id } as never, {
      onSuccess: () => refetch(),
      onError: (err: unknown) => {
        void refetch();
        toast.error(t("designSystems.deleteError"), {
          description: err instanceof Error ? err.message : undefined,
        });
      },
    });
  };

  const parseDesignData = (dataStr: string): DesignSystemData | null => {
    try {
      const parsed = JSON.parse(dataStr) as DesignSystemData;
      // DesignSystemCard reads colors.* / typography.* unconditionally, down
      // to nested fields like typography.headingFont. Rows written before
      // create/update validation existed can have `colors: {}` and still
      // pass a truthy check, so reuse the same nested-field validator the
      // actions use rather than only checking the top-level objects exist.
      if (missingDesignSystemDataFields(parsed).length > 0) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  useSetPageTitle(t("header.designSystems"));

  useSetHeaderActions(
    useMemo(
      () => (
        <Button
          size="sm"
          onClick={() => {
            setEditingId(null);
            setShowSetup(true);
          }}
          className="cursor-pointer"
        >
          <IconPlus className="w-3.5 h-3.5" />
          {t("designSystems.new")}
        </Button>
      ),
      [],
    ),
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {isLoading ? (
          <>
            <div className="flex items-center justify-between mb-6">
              <div className="h-5 w-40 rounded-md bg-muted animate-pulse" />
              <div className="h-3 w-16 rounded bg-muted animate-pulse" />
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,320px))] gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border bg-card overflow-hidden"
                >
                  <div className="aspect-video bg-muted/50 animate-pulse" />
                  <div className="p-4 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
                    <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : error ? (
          <div className="flex min-h-[360px] items-center justify-center">
            <div className="flex max-w-sm flex-col items-center gap-3 text-center">
              <IconAlertTriangle className="size-7 text-destructive/70" />
              <div>
                <h2 className="font-medium">{t("home.loadFailed")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("home.loadFailedDescription")}
                </p>
              </div>
              <Button variant="outline" onClick={() => void refetch()}>
                <IconRefresh className="size-4" />
                {t("home.retry")}
              </Button>
            </div>
          </div>
        ) : designSystems.length === 0 ? (
          <EmptyState
            onCreateNew={() => {
              setEditingId(null);
              setShowSetup(true);
            }}
          />
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,320px))] gap-4">
              {/* New design system card */}
              <button
                onClick={() => {
                  setEditingId(null);
                  setShowSetup(true);
                }}
                className="group relative rounded-xl border border-dashed border-border bg-card hover:border-foreground/15 overflow-hidden text-left cursor-pointer"
              >
                <div className="aspect-video flex items-center justify-center bg-muted/30">
                  <div className="w-12 h-12 rounded-xl bg-accent/50 flex items-center justify-center group-hover:bg-accent">
                    <IconPlus className="w-6 h-6 text-muted-foreground/70 group-hover:text-muted-foreground" />
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-medium text-sm text-muted-foreground group-hover:text-foreground/70">
                    {t("designSystems.new")}
                  </h3>
                  <div className="text-xs text-muted-foreground/70 mt-1">
                    {t("designSystems.setupBrand")}
                  </div>
                </div>
              </button>

              {/* Design system cards */}
              {designSystems.map((ds) => {
                const parsed = parseDesignData(ds.data);
                if (!parsed) return null;
                return (
                  <DesignSystemCard
                    key={ds.id}
                    id={ds.id}
                    title={ds.title}
                    data={parsed}
                    isDefault={ds.isDefault}
                    visibility={ds.visibility}
                    canManage={ds.canManage}
                    onClick={() => handleCardClick(ds.id)}
                    onSetDefault={() => handleSetDefault(ds.id)}
                    onDelete={() => setDeleteId(ds.id)}
                    isWorkspaceDefault={workspaceDesignSystem?.id === ds.id}
                    canSetWorkspaceDefault={canManageWorkspaceDefaults}
                    onSetWorkspaceDefault={(isDefault) =>
                      handleSetWorkspaceDefault(ds.id, isDefault)
                    }
                  />
                );
              })}
            </div>
          </>
        )}
      </main>

      <AlertDialog
        open={!!workspaceDefaultCandidate}
        onOpenChange={(open) =>
          !open && setWorkspaceDefaultCandidate(undefined)
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("home.workspaceDefaultConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("home.workspaceDefaultSystemShareBody", {
                title: workspaceDefaultCandidate?.title ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("home.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmWorkspaceDefault}>
              {t("home.workspaceDefaultConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("designSystems.deleteDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("designSystems.deleteDialogDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("designSystems.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("designSystems.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Setup/Edit Dialog */}
      <DesignSystemSetup
        open={showSetup}
        onClose={handleClose}
        onComplete={handleComplete}
        editingId={editingId ?? undefined}
      />
    </div>
  );
}

function EmptyState({ onCreateNew }: { onCreateNew: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#609FF8]/20 to-[#4080E0]/20 border border-[#609FF8]/20 flex items-center justify-center mb-6">
        <IconPalette className="w-7 h-7 text-[#609FF8]" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">
        {t("designSystems.emptyTitle")}
      </h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-8 leading-relaxed">
        {t("designSystems.emptyDescription")}
      </p>
      <Button onClick={onCreateNew} className="cursor-pointer">
        <IconPlus className="w-4 h-4" />
        {t("designSystems.new")}
      </Button>
    </div>
  );
}
