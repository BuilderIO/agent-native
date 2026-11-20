import { useT } from "@agent-native/core/client/i18n";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { publicFormUrl, useFormOutlet } from "@/components/forms/form-data";
import { EmbedPanel } from "@/components/share/EmbedPanel";
import { PageColumn } from "@/components/shell/PageColumn";
import { Button } from "@/components/ui/button";
import { sonnerToast } from "@/components/ui/sonner";
import { FIELD_SURFACE } from "@/lib/field-surface";
import { cn } from "@/lib/utils";

export default function ShareRoute() {
  const t = useT();
  const form = useFormOutlet();
  const [url, setUrl] = useState(publicFormUrl(form.id));
  useEffect(() => setUrl(publicFormUrl(form.id)), [form.id]);
  const [copied, setCopied] = useState(false);
  const live = form.status === "published";

  function copy() {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => sonnerToast.error(t("forms.common.copyLinkFailed")));
  }

  return (
    <PageColumn className="mt-8">
      <div className="max-w-[500px]">
        <div className="mb-2.5 text-lg leading-[20.7px] font-bold">
          {t("forms.routes.shareTitle")}
        </div>
        <div className="mb-5 max-w-[500px] text-sm leading-[21px]">
          {live ? t("forms.routes.shareLive") : t("forms.routes.shareNotLive")}
        </div>
        <div>
          <div className="flex max-w-[500px] items-center gap-2.5">
            <div className={cn("h-9 min-w-0 flex-1", FIELD_SURFACE)}>
              <input
                readOnly
                aria-label={t("forms.routes.shareTitle")}
                value={url}
                className="h-9 w-full bg-transparent px-2.5 text-base leading-[18.4px] outline-none"
              />
            </div>
            <Button
              className="h-9 rounded-lg bg-[var(--forms-solid)] px-[13.5px] text-[15px] leading-[22.5px] font-normal text-[color:var(--forms-solid-text)] hover:opacity-85"
              disabled={!live}
              onClick={copy}
            >
              <i className="flex">{copied ? <IconCheck /> : <IconCopy />}</i>
              <span className="font-semibold">
                {copied ? t("forms.routes.copied") : t("forms.routes.copy")}
              </span>
            </Button>
          </div>
        </div>
      </div>
      {live ? <EmbedPanel formId={form.id} /> : null}
    </PageColumn>
  );
}
