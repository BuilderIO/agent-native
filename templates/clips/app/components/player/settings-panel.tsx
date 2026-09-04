import {
  useActionMutation,
  useReconciledState,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconX } from "@tabler/icons-react";
import { useRef, useState } from "react";

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
  });
  const createCta = useActionMutation("create-cta", {
    onSuccess: () => onRefetch?.(),
  });
  const updateCta = useActionMutation("update-cta", {
    onSuccess: () => onRefetch?.(),
  });
  const deleteCta = useActionMutation("delete-cta", {
    onSuccess: () => onRefetch?.(),
  });

  const [openCtaId, setOpenCtaId] = useState("");

  function patch(fields: Record<string, unknown>) {
    update.mutate({ id: recording.id, ...fields } as any);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      {showHeader ? (
        <div className="flex h-10 items-center justify-between border-b border-border/70 px-3">
          <h2 className="text-sm font-medium">{t("playerSettings.title")}</h2>
          <ViewerIconButton variant="ghost" onClick={onClose}>
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
            <ViewerButton
              type="button"
              variant="ghost"
              onClick={() =>
                createCta.mutate({
                  recordingId: recording.id,
                  label: t("playerSettings.defaultCtaLabel"),
                  url: "https://example.com",
                  color: "hsl(var(--primary))",
                  placement: "throughout",
                } as any)
              }
            >
              {t("playerSettings.addCta")}
            </ViewerButton>
          </CardHeader>

          <CardContent className="px-3 pb-3 pt-0">
            {ctas.length === 0 ? (
              <p className="py-1 text-xs leading-5 text-muted-foreground">
                {t("playerSettings.noCtas")}
              </p>
            ) : (
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
                    onSave={(fields) => {
                      updateCta.mutate({ id: cta.id, ...fields } as any);
                      setOpenCtaId("");
                    }}
                    onDelete={() => {
                      deleteCta.mutate({ id: cta.id } as any);
                      setOpenCtaId("");
                    }}
                  />
                ))}
              </Accordion>
            )}
          </CardContent>
        </Card>
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
  const [color, setColor] = useReconciledState(cta.color, {
    active: editing.current,
  });
  const [placement, setPlacement] = useReconciledState(cta.placement, {
    active: editing.current,
  });

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
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("playerSettings.buttonLabelPlaceholder")}
        />
        <ViewerInput
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
        />
        <div className="flex gap-2">
          <ViewerInput
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-10 cursor-pointer p-1"
          />
          <Select
            value={placement}
            onValueChange={(v) => setPlacement(v as "end" | "throughout")}
          >
            <ViewerSelectTrigger className="flex-1">
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
            onClick={onDelete}
          >
            {t("playerSettings.delete")}
          </ViewerButton>
          <ViewerButton
            type="button"
            onClick={() => onSave({ label, url, color, placement })}
          >
            {t("common.save")}
          </ViewerButton>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
