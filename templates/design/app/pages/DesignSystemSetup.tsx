import { BuilderDsiGate } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import type { StartDesignSystemAuthoringInput } from "@agent-native/core/shared/design-system-authoring";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@agent-native/toolkit/app-shell";
import {
  DesignSystemCreationView,
  designSystemCreationLabels,
  useDesignSystemCreation,
  type DesignSystemCreationOptions,
} from "@agent-native/toolkit/design-system-creation";
import { IconArrowLeft } from "@tabler/icons-react";
import { useEffect, type ComponentProps } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  creationComponents,
  useDesignSystemCreationActions,
} from "@/lib/design-system-creation";
import { uploadDesignSystemSourceFile } from "@/lib/design-system-source-upload";

export interface DesignSystemSetupProps {
  open?: boolean;
  onReturnToPrompt?: () => void;
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
  /** @deprecated Workspace opening belongs to onCreated. */
  onContinueInChat?: () => void;
  onBackChange?: (handler: (() => void) | null) => void;
  onCreate?: DesignSystemCreationOptions["onCreate"];
  onCreated?: DesignSystemCreationOptions["onCreated"];
  onAddSources?: DesignSystemCreationOptions["onAddSources"];
  onSourcesAdded?: DesignSystemCreationOptions["onSourcesAdded"];
  addingToSystemId?: string;
  initialDraft?: DesignSystemCreationOptions["initialDraft"];
  onDraftChange?: DesignSystemCreationOptions["onDraftChange"];
  originDraft?: StartDesignSystemAuthoringInput["originDraft"];
}

function SetupPageChrome({ title }: { title: string }) {
  useSetPageTitle(title);
  useSetHeaderActions(null);
  return null;
}

export default function DesignSystemSetup(props: DesignSystemSetupProps = {}) {
  const { onBackChange } = props;
  const t = useT();
  const navigate = useNavigate();
  const labels = designSystemCreationLabels(t);
  const actions = useDesignSystemCreationActions(props.originDraft);
  const controller = useDesignSystemCreation({
    ...props,
    labels,
    onCreate: props.onCreate ?? actions.onCreate,
    onAddSources: props.onAddSources ?? actions.onAddSources,
    onCancel:
      props.onReturnToPrompt ??
      (() => {
        void navigate("/design-systems");
      }),
    uploadFile: (file, options) =>
      uploadDesignSystemSourceFile(file, {
        ...options,
        failureMessage: labels.uploadFailed,
      }),
  });
  const title =
    controller.step === "sources"
      ? (labels.sourcesTitle ?? labels.references)
      : labels.title;
  useEffect(() => {
    onBackChange?.(controller.back);
    return () => onBackChange?.(null);
  }, [onBackChange, controller.back]);

  const content = (
    <BuilderDsiGate>
      <DesignSystemCreationView
        controller={controller}
        components={creationComponents}
        showBack={props.open === undefined && !props.onBackChange}
      />
    </BuilderDsiGate>
  );
  if (props.open !== undefined)
    return (
      <Dialog
        open={props.open}
        onOpenChange={(open) => {
          if (!open) controller.cancel();
        }}
      >
        <DialogContent
          data-design-context-picker
          aria-describedby={undefined}
          className="flex flex-col overflow-hidden sm:max-w-xl"
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onCloseAutoFocus={props.onCloseAutoFocus}
        >
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("composerContext.back")}
                disabled={controller.submitting || controller.completed}
                onClick={controller.back}
              >
                <IconArrowLeft />
              </Button>
              <DialogTitle>{title}</DialogTitle>
            </div>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
    );
  return (
    <div
      className={
        props.onReturnToPrompt
          ? "flex min-h-0 flex-1 flex-col overflow-hidden"
          : "mx-auto flex max-h-dvh max-w-xl flex-col px-4 py-6"
      }
    >
      <SetupPageChrome title={title} />
      {!props.onReturnToPrompt && (
        <h1 className="mb-5 text-lg font-semibold md:hidden">{title}</h1>
      )}
      {content}
    </div>
  );
}
