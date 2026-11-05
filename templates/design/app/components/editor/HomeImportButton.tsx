import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { IconUpload } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  MAX_BROWSER_FIG_BYTES,
  MAX_BROWSER_FIG_GB,
  MAX_BROWSER_FIG_MB,
  validateFigUploadFile,
} from "@/lib/design-file-upload";
import {
  FIGMA_IMPORT_FORMAT,
  importFormatsAccept,
  requestImportFile,
} from "@/lib/design-import-file-picker";
import {
  claimFigImportToast,
  discardPendingDesignImports,
  FIG_IMPORT_TOAST_ID,
  releaseFigImportToast,
  setPendingDesignImport,
  updateFigImportToast,
} from "@/lib/pending-import";

const HOME_IMPORT_FORMATS = [FIGMA_IMPORT_FORMAT];

export function HomeImportButton() {
  const t = useT();
  const formatters = useFormatters();
  const navigate = useNavigate();
  const create = useActionMutation("create-design");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    discardPendingDesignImports();
  }, []);
  const pickFile = () => {
    if (pending.current) return;
    requestImportFile({
      formats: HOME_IMPORT_FORMATS,
      allSupportedLabel: t("designEditor.import.allSupportedFiles"),
      openFallbackInput: () => fileInput.current?.click(),
      onFile: (file) => void importFile(file),
      onError: (error) =>
        toast.error(t("designEditor.import.errors.uploadFailed"), {
          description:
            error instanceof Error ? error.message : t("common.genericError"),
        }),
    });
  };
  const importFile = async (file: File | undefined) => {
    if (!file || pending.current) return;
    const validationError = validateFigUploadFile(file, {
      maxBytes: MAX_BROWSER_FIG_BYTES,
    });
    if (validationError) {
      toast.error(
        validationError === "too-large"
          ? t("designEditor.import.errors.figFileTooLarge", {
              max: formatters.formatNumber(MAX_BROWSER_FIG_MB),
            })
          : t("designEditor.import.errors.invalidFigFile"),
      );
      return;
    }
    pending.current = true;
    setBusy(true);
    const toastOwner = claimFigImportToast(true);
    updateFigImportToast(
      toastOwner,
      t("designEditor.import.figImportAnalyzing"),
      file.name,
    );
    try {
      const result = await create.mutateAsync({
        title: file.name.replace(/\.fig$/i, "") || t("home.untitledDesign"),
        projectType: "prototype",
        designSystemId: null,
        creationMethod: "import_figma",
      });
      if (!result.id) throw new Error(t("home.failedToCreateDesign"));
      setPendingDesignImport(result.id, { kind: "file", file });
      void navigate(`/design/${result.id}?panel=import`);
    } catch (cause) {
      releaseFigImportToast(toastOwner);
      toast.error(actionErrorMessage(cause) ?? t("home.failedToCreateDesign"), {
        id: FIG_IMPORT_TOAST_ID,
        description: undefined,
        action: {
          label: t("homeContext.retry"),
          onClick: () => void importFile(file),
        },
      });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept={importFormatsAccept(HOME_IMPORT_FORMATS)}
        hidden
        aria-label={t("home.figmaFile")}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          void importFile(file);
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            aria-label={t("home.import")}
            onClick={pickFile}
          >
            <IconUpload />
            <span className="design-home-import-label">{t("home.import")}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent className="grid gap-0.5">
          <span>{t("home.figmaFile")}</span>
          <span className="text-muted-foreground">
            {t("home.figmaFileMaxSize", {
              max: formatters.formatNumber(MAX_BROWSER_FIG_GB),
            })}
          </span>
        </TooltipContent>
      </Tooltip>
    </>
  );
}
