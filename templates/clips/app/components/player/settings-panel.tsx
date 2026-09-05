import {
  actionErrorMessage,
  useActionMutation,
  useReconciledState,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconX } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";

import { SPEED_OPTIONS } from "./player-controls";
import {
  ViewerButton,
  ViewerIconButton,
  ViewerInput,
  ViewerSelectTrigger,
  ViewerSwitch,
} from "./viewer-controls";

export interface SettingsPanelProps {
  recording: {
    id: string;
    enableComments: boolean;
    enableReactions: boolean;
    enableDownloads: boolean;
    defaultSpeed: string;
    animatedThumbnailEnabled: boolean;
  };
  ctas: {
    id: string;
    label: string;
    url: string;
    color: string;
    placement: "end" | "throughout";
  }[];
  onClose: () => void;
  onRefetch?: () => void;
  showHeader?: boolean;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const t = useT();
  const { recording, ctas, onClose, onRefetch, showHeader = true } = props;

  const update = useActionMutation("update-recording", {
    onSuccess: () => onRefetch?.(),
    onError: (error) =>
      toast.error(
        actionErrorMessage(error) ?? t("recordingPage.tryAgainMoment"),
      ),
  });
  const createCta = useActionMutation("create-cta", {
    onSuccess: () => {
      setCreatingCta(false);
      onRefetch?.();
    },
    onError: (error) =>
      toast.error(
        actionErrorMessage(error) ?? t("recordingPage.tryAgainMoment"),
      ),
  });
  const updateCta = useActionMutation("update-cta", {
    onSuccess: () => {
      setOpenCtaId("");
      onRefetch?.();
    },
    onError: (error) =>
      toast.error(
        actionErrorMessage(error) ?? t("recordingPage.tryAgainMoment"),
      ),
  });
  const deleteCta = useActionMutation("delete-cta", {
    onSuccess: () => {
      setOpenCtaId("");
      onRefetch?.();
    },
    onError: (error) =>
      toast.error(
        actionErrorMessage(error) ?? t("recordingPage.tryAgainMoment"),
      ),
  });

  const [openCtaId, setOpenCtaId] = useState("");
  const [creatingCta, setCreatingCta] = useState(false);

  function patch(fields: Record<string, unknown>) {
    update.mutate({ id: recording.id, ...fields } as any);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      {showHeader ? (
        <div className="flex h-10 items-center justify-between border-b border-border/70 px-3">
          <h2 className="text-sm font-medium">{t("playerSettings.title")}</h2>
          <ViewerIconButton
            variant="ghost"
            aria-label={t("common.cancel")}
            onClick={onClose}
          >
            <IconX />
          </ViewerIconButton>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <Card className="border border-border/70 bg-card shadow-none">
          <CardHeader className="space-y-0 p-3 pb-1.5">
            <CardTitle className="text-sm leading-none">
              {t("playerSettings.viewerOptions")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-0">
            <ToggleRow
              id="viewer-comments"
              label={t("playerSettings.comments")}
              checked={recording.enableComments}
              onChange={(v) => patch({ enableComments: v })}
            />
            <ToggleRow
              id="viewer-reactions"
              label={t("playerSettings.reactions")}
              checked={recording.enableReactions}
              onChange={(v) => patch({ enableReactions: v })}
            />
            <ToggleRow
              id="viewer-downloads"
              label={t("playerSettings.allowDownloads")}
              checked={recording.enableDownloads}
              onChange={(v) => patch({ enableDownloads: v })}
            />
            <ToggleRow
              id="viewer-animated-thumbnail"
              label={t("playerSettings.animatedThumbnail")}
              checked={recording.animatedThumbnailEnabled}
              onChange={(v) => patch({ animatedThumbnailEnabled: v })}
            />
            <div className="flex min-h-8 items-center gap-3 py-1">
              <Label
                htmlFor="recording-default-speed"
                className="min-w-0 flex-1 text-sm font-normal"
              >
                {t("playerSettings.defaultPlaybackSpeed")}
              </Label>
              <Select
                value={recording.defaultSpeed}
                onValueChange={(v) => patch({ defaultSpeed: v })}
              >
                <ViewerSelectTrigger
                  id="recording-default-speed"
                  className="h-8 w-16 px-2 text-sm"
                >
                  <SelectValue />
                </ViewerSelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {SPEED_OPTIONS.map((s) => (
                      <SelectItem key={s} value={String(s)}>
                        {s}x
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border/70 bg-card shadow-none">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 p-3 pb-1.5">
            <CardTitle className="text-sm leading-none">
              {t("playerSettings.callToAction")}
            </CardTitle>
            {ctas.length === 0 ? (
              <ViewerButton
                type="button"
                variant="ghost"
                disabled={creatingCta}
                onClick={() => setCreatingCta(true)}
              >
                {t("playerSettings.addCta")}
              </ViewerButton>
            ) : null}
          </CardHeader>

          <CardContent className="px-3 pb-3 pt-0">
            {creatingCta ? (
              <CtaDraftEditor
                t={t}
                pending={createCta.isPending}
                onCancel={() => setCreatingCta(false)}
                onSave={({ label, url, placement }) =>
                  createCta.mutate({
                    recordingId: recording.id,
                    label,
                    url,
                    placement,
                  } as any)
                }
              />
            ) : null}
            {!creatingCta && ctas.length === 0 ? (
              <p className="py-1 text-xs leading-5 text-muted-foreground">
                {t("playerSettings.noCtas")}
              </p>
            ) : null}
            {ctas.length > 0 ? (
              <Accordion
                type="single"
                collapsible
                value={openCtaId}
                onValueChange={setOpenCtaId}
              >
                {ctas.map((cta) => (
                  <CtaEditor
                    key={cta.id}
                    cta={cta}
                    t={t}
                    pending={updateCta.isPending}
                    deletePending={deleteCta.isPending}
                    onSave={(fields) => {
                      updateCta.mutate({ id: cta.id, ...fields } as any);
                    }}
                    onDelete={() => {
                      deleteCta.mutate({ id: cta.id } as any);
                    }}
                  />
                ))}
              </Accordion>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CtaDraftEditor({
  t,
  pending,
  onCancel,
  onSave,
}: {
  t: ReturnType<typeof useT>;
  pending: boolean;
  onCancel: () => void;
  onSave: (fields: {
    label: string;
    url: string;
    placement: "end" | "throughout";
  }) => void;
}) {
  const [label, setLabel] = useState(t("playerSettings.defaultCtaLabel"));
  const [url, setUrl] = useState("");
  const [placement, setPlacement] = useState<"end" | "throughout">(
    "throughout",
  );
  const canSave = label.trim().length > 0 && isPublicHttpUrl(url);
  const invalidUrl = url.length > 0 && !isPublicHttpUrl(url);
  const urlErrorId = "new-cta-url-error";

  return (
    <div className="grid gap-2 rounded-md border border-border/70 p-2.5">
      <ViewerInput
        autoFocus
        value={label}
        aria-label={t("playerSettings.buttonLabelPlaceholder")}
        onChange={(event) => setLabel(event.target.value)}
        placeholder={t("playerSettings.buttonLabelPlaceholder")}
      />
      <ViewerInput
        type="url"
        value={url}
        aria-label={t("shareDialog.link")}
        aria-invalid={invalidUrl}
        aria-describedby={invalidUrl ? urlErrorId : undefined}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://…"
      />
      {invalidUrl ? (
        <p id={urlErrorId} className="text-xs text-destructive">
          {t("playerSettings.validWebUrl")}
        </p>
      ) : null}
      <Select
        value={placement}
        onValueChange={(value) => setPlacement(value as "end" | "throughout")}
      >
        <ViewerSelectTrigger aria-label={t("playerSettings.callToAction")}>
          <SelectValue />
        </ViewerSelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="throughout">
              {t("playerSettings.placementThroughout")}
            </SelectItem>
            <SelectItem value="end">
              {t("playerSettings.placementEnd")}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <div className="flex items-center justify-end gap-2 pt-1">
        <ViewerButton type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </ViewerButton>
        <ViewerButton
          type="button"
          disabled={!canSave || pending}
          onClick={() =>
            onSave({ label: label.trim(), url: url.trim(), placement })
          }
        >
          {pending ? t("common.saving") : t("common.save")}
        </ViewerButton>
      </div>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 py-1">
      <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
        {label}
      </Label>
      <ViewerSwitch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function CtaEditor({
  cta,
  t,
  pending,
  deletePending,
  onSave,
  onDelete,
}: {
  cta: {
    id: string;
    label: string;
    url: string;
    color: string;
    placement: "end" | "throughout";
  };
  t: ReturnType<typeof useT>;
  pending: boolean;
  deletePending: boolean;
  onSave: (fields: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  // Re-adopt the server/agent CTA fields whenever the user isn't actively
  // editing this card, so an agent edit to the CTA shows up live. `editing`
  // flips true while focus is anywhere inside the card.
  const editing = useRef(false);
  const [label, setLabel] = useReconciledState(cta.label, {
    active: editing.current,
  });
  const [url, setUrl] = useReconciledState(cta.url, {
    active: editing.current,
  });
  const [placement, setPlacement] = useReconciledState(cta.placement, {
    active: editing.current,
  });
  const canSave = label.trim().length > 0 && isPublicHttpUrl(url);
  const invalidUrl = url.length > 0 && !isPublicHttpUrl(url);
  const urlErrorId = `cta-${cta.id}-url-error`;

  return (
    <AccordionItem
      value={cta.id}
      className="border-0"
      onFocusCapture={() => {
        editing.current = true;
      }}
      onBlurCapture={(e) => {
        // Only clear when focus leaves the card entirely.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          editing.current = false;
        }
      }}
    >
      <AccordionTrigger className="py-2 text-left hover:no-underline">
        <span className="flex min-w-0 flex-1 items-baseline gap-2 pe-3">
          <span className="truncate text-sm font-medium">{cta.label}</span>
          <span className="shrink-0 text-xs font-normal text-muted-foreground">
            {cta.placement === "throughout"
              ? t("playerSettings.placementThroughout")
              : t("playerSettings.placementEnd")}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="grid gap-2 pb-2">
        <ViewerInput
          value={label}
          aria-label={t("playerSettings.buttonLabelPlaceholder")}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("playerSettings.buttonLabelPlaceholder")}
        />
        <ViewerInput
          type="url"
          value={url}
          aria-label={t("shareDialog.link")}
          aria-invalid={invalidUrl}
          aria-describedby={invalidUrl ? urlErrorId : undefined}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
        />
        {invalidUrl ? (
          <p id={urlErrorId} className="text-xs text-destructive">
            {t("playerSettings.validWebUrl")}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Select
            value={placement}
            onValueChange={(v) => setPlacement(v as "end" | "throughout")}
          >
            <ViewerSelectTrigger
              aria-label={t("playerSettings.callToAction")}
              className="flex-1"
            >
              <SelectValue />
            </ViewerSelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="throughout">
                  {t("playerSettings.placementThroughout")}
                </SelectItem>
                <SelectItem value="end">
                  {t("playerSettings.placementEnd")}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <ViewerButton
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={deletePending || pending}
            onClick={onDelete}
          >
            {t("playerSettings.delete")}
          </ViewerButton>
          <ViewerButton
            type="button"
            disabled={!canSave || pending || deletePending}
            onClick={() =>
              onSave({
                label: label.trim(),
                url: url.trim(),
                placement,
              })
            }
          >
            {pending ? t("common.saving") : t("common.save")}
          </ViewerButton>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    // coercion-ok: invalid draft input is intentionally represented as false
    // so the Save action stays disabled until it becomes a web URL.
    return false;
  }
}
