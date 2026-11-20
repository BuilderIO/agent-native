import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { FormDetail } from "@shared/form-contract";
import { formTitleOf, isFormEmpty } from "@shared/form-model";
import {
  IconArrowLeft,
  IconHistory,
  IconInbox,
  IconLoader2,
  IconPalette,
  IconPlayerPlay,
  IconSettings,
  IconShare,
} from "@tabler/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { paths } from "@/components/shell/paths";
import { TopBar } from "@/components/shell/TopBar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { useEditorDocument } from "./use-editor-document";
import { VersionHistoryDialog } from "./VersionHistoryDialog";

export function statusPillLabel(
  form: Pick<FormDetail, "status">,
  hasChanges: boolean,
): "Draft" | "Changes" | null {
  if (form.status === "published") return hasChanges ? "Changes" : null;
  return "Draft";
}

/**
 * What the primary button says and whether it can be pressed. A published form
 * used to look exactly like a draft - same word, same look - so an author could
 * not tell whether the form they were looking at was live.
 */
export function publishAction(
  form: Pick<FormDetail, "status">,
  hasChanges: boolean,
): { label: "publish" | "publishChanges" | "published"; enabled: boolean } {
  if (form.status !== "published") return { label: "publish", enabled: true };
  if (hasChanges) return { label: "publishChanges", enabled: true };
  return { label: "published", enabled: false };
}

/**
 * An icon-only control with the tooltip that says what it does. The label is the
 * same text the control announces, so a sighted user and a screen reader hear it.
 */
function IconTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const iconLink =
  "flex size-7 items-center justify-center rounded-[7px] !px-0 text-muted-foreground hover:bg-accent";

export function EditorHeader({
  form,
  doc,
  previewing,
  onPreview,
  customizeOpen,
  onCustomize,
}: {
  form: FormDetail;
  doc: ReturnType<typeof useEditorDocument>;
  previewing: boolean;
  onPreview: (on: boolean) => void;
  customizeOpen: boolean;
  onCustomize: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const publish = useActionMutation("publish-form");
  const discard = useActionMutation("discard-form-draft");
  const restoreVersion = useActionMutation("restore-form-version");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  // A successful save used to say nothing: only Saving and the failure text were drawn, so
  // changing a question's attribute left an author unsure whether it was kept. The doc goes
  // back to idle when a save finishes, and that transition is the moment to say Saved.
  const [savedRecently, setSavedRecently] = useState(false);
  const wasSaving = useRef(false);
  useEffect(() => {
    if (doc.saveState === "saving") {
      wasSaving.current = true;
      return;
    }
    if (doc.saveState !== "idle" || !wasSaving.current) return;
    wasSaving.current = false;
    setSavedRecently(true);
    const timer = setTimeout(() => setSavedRecently(false), 2500);
    return () => clearTimeout(timer);
  }, [doc.saveState]);
  const [discardOpen, setDiscardOpen] = useState(false);
  const empty = isFormEmpty(doc.blocks);
  const pill = statusPillLabel(form, doc.hasChanges);
  const title = formTitleOf(doc.blocks) || t("forms.editor.untitled");

  function onPublish() {
    if (publish.isPending) return;
    setFailed(false);
    doc.cancel();
    const wasLive = form.status === "published";
    publish.mutate(
      { id: form.id, blocks: doc.latest.current },
      {
        onSuccess: () => {
          doc.markClean();
          if (!wasLive) void navigate(paths.formTab(form.id, "share"));
        },
        onError: () => {
          setFailed(true);
          void doc.flush();
        },
      },
    );
  }

  const pillClass =
    "flex h-5 items-center rounded-full bg-[hsl(var(--forms-badge))] px-[7px] text-xs font-medium text-[hsl(var(--forms-badge-foreground))]";

  return (
    <>
      <TopBar
        crumbs={[
          { label: form.workspaceName, to: paths.workspace(form.workspaceId) },
          { label: title },
        ]}
      >
        {failed ? (
          <span role="alert" className="text-sm text-destructive">
            {t("forms.editor.somethingWentWrong")}
          </span>
        ) : doc.saveState === "failed" ? (
          <span role="status" className="text-sm text-destructive">
            {t("forms.editor.saveFailed")}
          </span>
        ) : doc.saveState === "saving" ? (
          <span role="status" className="text-xs text-muted-foreground">
            {t("forms.editor.saving")}
          </span>
        ) : savedRecently ? (
          <span role="status" className="text-xs text-muted-foreground">
            {t("forms.editor.saved")}
          </span>
        ) : null}
        {pill === "Changes" ? (
          <button
            type="button"
            className={pillClass}
            onClick={() => setDiscardOpen(true)}
          >
            {t("forms.editor.statusChanges")}
          </button>
        ) : pill ? (
          <span className={pillClass}>{t("forms.editor.statusDraft")}</span>
        ) : null}
        <IconTip label={t("forms.organize.versionHistory")}>
          <button
            type="button"
            aria-label={t("forms.organize.versionHistory")}
            className={iconLink}
            onClick={() => setHistoryOpen(true)}
          >
            <IconHistory className="size-[17px]" />
          </button>
        </IconTip>
        <IconTip label={t("forms.editor.submissions")}>
          <Link
            to={paths.form(form.id)}
            aria-label={t("forms.editor.submissions")}
            className={iconLink}
          >
            <IconInbox className="size-[17px]" />
          </Link>
        </IconTip>
        <IconTip label={t("forms.editor.share")}>
          <Link
            to={paths.formTab(form.id, "share")}
            aria-label={t("forms.editor.share")}
            className={iconLink}
          >
            <IconShare className="size-[17px]" />
          </Link>
        </IconTip>
        <IconTip label={t("forms.editor.formSettings")}>
          <Link
            to={paths.formTab(form.id, "settings")}
            aria-label={t("forms.editor.formSettings")}
            className={iconLink}
          >
            <IconSettings className="size-[17px]" />
          </Link>
        </IconTip>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={customizeOpen}
          onClick={onCustomize}
        >
          <IconPalette /> {t("forms.editor.customize")}
        </Button>
        {previewing ? (
          <Button variant="ghost" size="sm" onClick={() => onPreview(false)}>
            <IconArrowLeft /> {t("forms.editor.backToEditor")}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={empty}
            onClick={() => onPreview(true)}
          >
            <IconPlayerPlay /> {t("forms.editor.preview")}
          </Button>
        )}
        <Button
          size="sm"
          disabled={
            empty ||
            publish.isPending ||
            !publishAction(form, doc.hasChanges).enabled
          }
          onClick={onPublish}
        >
          {publish.isPending ? <IconLoader2 className="animate-spin" /> : null}
          {t(`forms.editor.${publishAction(form, doc.hasChanges).label}`)}
        </Button>
      </TopBar>
      {historyOpen ? (
        <VersionHistoryDialog
          formId={form.id}
          onClose={() => setHistoryOpen(false)}
          onRestore={(versionId) =>
            restoreVersion.mutate(
              { formId: form.id, versionId },
              { onSuccess: (result) => doc.reset(result.blocks) },
            )
          }
        />
      ) : null}
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("forms.editor.discardTitle")}</DialogTitle>
            <DialogDescription>
              {t("forms.editor.discardBody")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDiscardOpen(false)}>
              {t("forms.editor.cancel")}
            </Button>
            <Button
              onClick={() => {
                setDiscardOpen(false);
                discard.mutate(
                  { id: form.id },
                  { onSuccess: (result) => doc.reset(result.blocks) },
                );
              }}
            >
              {t("forms.editor.discard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
