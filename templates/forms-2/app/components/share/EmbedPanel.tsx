import { useT } from "@agent-native/core/client/i18n";
import { IconCheck, IconCode, IconCopy } from "@tabler/icons-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { sonnerToast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { publicBaseUrl } from "@/lib/public-url";

import { copyText } from "./copy-text";
import {
  DEFAULT_EMBED_OPTIONS,
  EMBED_KINDS,
  embedCode,
  embedUrl,
  POPUP_POSITIONS,
  POPUP_TRIGGERS,
  type EmbedKind,
  type EmbedOptions,
} from "./embed-code";

function OptionRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-t border-t-border py-4 text-sm leading-[21px]">
      <span>{label}</span>
      {children}
    </div>
  );
}

function FlagRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <OptionRow label={label}>
      <Switch
        className="aria-[checked=false]:bg-[var(--forms-ink-off)]"
        aria-label={label}
        checked={checked}
        onCheckedChange={onChange}
      />
    </OptionRow>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const t = useT();
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-sm leading-[21px]">{label}</div>
      <div className="relative">
        <Input
          type="number"
          min={1}
          aria-label={label}
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isInteger(next) && next > 0) onChange(next);
          }}
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">
          {t("forms.share.pixels")}
        </span>
      </div>
    </div>
  );
}

function PreviewFrame({
  src,
  fixedHeight,
  dynamic,
}: {
  src: string;
  fixedHeight: number;
  dynamic: boolean;
}) {
  const t = useT();
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(fixedHeight);
  useEffect(() => {
    if (!dynamic || !frame) return;
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (event.source !== frame.contentWindow) return;
      if (
        typeof data === "object" &&
        data !== null &&
        "type" in data &&
        data.type === "forms:height" &&
        "height" in data &&
        typeof data.height === "number"
      )
        setHeight(data.height);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [dynamic, frame]);
  return (
    <iframe
      ref={setFrame}
      title={t("forms.share.previewFrame")}
      src={src}
      className="block w-full rounded-lg border-0 bg-background"
      style={{ height: dynamic ? height : fixedHeight }}
    />
  );
}

export function EmbedPanel({ formId }: { formId: string }) {
  const t = useT();
  const [kind, setKind] = useState<EmbedKind>("standard");
  const [options, setOptions] = useState(DEFAULT_EMBED_OPTIONS);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  // Origin plus this app's mount path: a bare origin drops `/forms-2` and the
  // embed, its script and the copied link all land on the site's 404 page.
  const [base, setBase] = useState("");
  useEffect(() => setBase(publicBaseUrl()), []);

  const set = (patch: Partial<EmbedOptions>) =>
    setOptions((previous) => ({ ...previous, ...patch }));
  const code = embedCode(base, formId, kind, options);
  const previewSrc = embedUrl(base, formId, kind, options, {
    withoutTracking: true,
  });

  function copy(text: string, what: "link" | "code") {
    void copyText(text).then((ok) => {
      if (!ok) return sonnerToast.error(t("forms.common.copyLinkFailed"));
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2000);
    });
  }

  const kindLabel = (value: EmbedKind) =>
    value === "standard"
      ? t("forms.share.kindStandard")
      : value === "popup"
        ? t("forms.share.kindPopup")
        : t("forms.share.kindFullPage");
  const triggerLabel = (value: (typeof POPUP_TRIGGERS)[number]) =>
    value === "click"
      ? t("forms.share.triggerClick")
      : value === "load"
        ? t("forms.share.triggerLoad")
        : t("forms.share.triggerDelay");
  const positionLabel = (value: (typeof POPUP_POSITIONS)[number]) =>
    value === "center"
      ? t("forms.share.positionCenter")
      : value === "bottomRight"
        ? t("forms.share.positionBottomRight")
        : t("forms.share.positionBottomLeft");

  return (
    <section className="mt-14 grid grid-cols-[minmax(0,400px)_minmax(0,1fr)] gap-10 pb-16 max-[900px]:grid-cols-1">
      <div>
        <h2 className="mb-4 text-2xl leading-[28px] font-bold">
          {t("forms.share.embedTitle")}
        </h2>
        <Select
          value={kind}
          onValueChange={(value) => {
            const next = EMBED_KINDS.find((candidate) => candidate === value);
            if (!next) return;
            setKind(next);
            setShowCode(false);
          }}
        >
          <SelectTrigger aria-label={t("forms.share.embedType")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EMBED_KINDS.map((value) => (
              <SelectItem key={value} value={value}>
                {kindLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          className="mt-3 h-9 w-full rounded-lg bg-[var(--forms-solid)] text-sm font-semibold text-[color:var(--forms-solid-text)] hover:opacity-85"
          onClick={() => setShowCode(true)}
        >
          <IconCode className="size-4" />
          {t("forms.share.getCode")}
        </Button>
        <Button
          variant="ghost"
          className="mt-3 w-full text-sm font-semibold text-muted-foreground"
          onClick={() => copy(embedUrl(base, formId, kind, options), "link")}
        >
          {copied === "link" ? (
            <IconCheck className="size-4" />
          ) : (
            <IconCopy className="size-4" />
          )}
          {copied === "link"
            ? t("forms.share.copied")
            : t("forms.share.copyEmbedLink")}
        </Button>

        <h3 className="mt-6 mb-3 border-t border-t-border pt-6 text-2xl leading-[28px] font-bold">
          {t("forms.share.options")}
        </h3>
        {kind === "standard" ? (
          <NumberField
            label={t("forms.share.height")}
            value={options.height}
            onChange={(height) => set({ height })}
          />
        ) : null}
        {kind === "popup" ? (
          <>
            <div className="mb-4">
              <div className="mb-1.5 text-sm leading-[21px]">
                {t("forms.share.openTrigger")}
              </div>
              <Select
                value={options.trigger}
                onValueChange={(value) => {
                  const trigger = POPUP_TRIGGERS.find(
                    (candidate) => candidate === value,
                  );
                  if (trigger) set({ trigger });
                }}
              >
                <SelectTrigger aria-label={t("forms.share.openTrigger")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POPUP_TRIGGERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {triggerLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="mb-4">
              <div className="mb-1.5 text-sm leading-[21px]">
                {t("forms.share.position")}
              </div>
              <Select
                value={options.position}
                onValueChange={(value) => {
                  const position = POPUP_POSITIONS.find(
                    (candidate) => candidate === value,
                  );
                  if (position) set({ position });
                }}
              >
                <SelectTrigger aria-label={t("forms.share.position")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POPUP_POSITIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {positionLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <NumberField
              label={t("forms.share.width")}
              value={options.width}
              onChange={(width) => set({ width })}
            />
          </>
        ) : null}
        {kind === "standard" ? (
          <FlagRow
            label={t("forms.share.dynamicHeight")}
            checked={options.dynamicHeight}
            onChange={(dynamicHeight) => set({ dynamicHeight })}
          />
        ) : null}
        {kind !== "fullPage" ? (
          <>
            <FlagRow
              label={t("forms.share.hideTitle")}
              checked={options.hideTitle}
              onChange={(hideTitle) => set({ hideTitle })}
            />
            <FlagRow
              label={t("forms.share.alignLeft")}
              checked={options.alignLeft}
              onChange={(alignLeft) => set({ alignLeft })}
            />
          </>
        ) : null}
        {kind !== "popup" ? (
          <FlagRow
            label={t("forms.share.transparentBackground")}
            checked={options.transparentBackground}
            onChange={(transparentBackground) => set({ transparentBackground })}
          />
        ) : (
          <FlagRow
            label={t("forms.share.overlay")}
            checked={options.overlay}
            onChange={(overlay) => set({ overlay })}
          />
        )}
        <FlagRow
          label={t("forms.share.trackEvents")}
          checked={options.trackEvents}
          onChange={(trackEvents) => set({ trackEvents })}
        />
      </div>

      <div className="min-w-0 rounded-xl bg-muted p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-2xl leading-[28px] font-bold text-muted-foreground">
            {showCode ? t("forms.share.codeTitle") : t("forms.share.preview")}
          </h3>
          {showCode ? (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copy(code, "code")}
              >
                {copied === "code" ? <IconCheck /> : <IconCopy />}
                {copied === "code"
                  ? t("forms.share.copied")
                  : t("forms.share.copyCode")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCode(false)}
              >
                {t("forms.share.backToPreview")}
              </Button>
            </div>
          ) : null}
        </div>
        {showCode ? (
          <pre className="max-h-[560px] overflow-auto rounded-lg bg-background p-4 font-mono text-[13px] leading-5 whitespace-pre-wrap break-all">
            {code}
          </pre>
        ) : (
          <PreviewFrame
            key={previewSrc}
            src={previewSrc}
            fixedHeight={kind === "standard" ? options.height : 560}
            dynamic={kind === "standard" && options.dynamicHeight}
          />
        )}
      </div>
    </section>
  );
}
