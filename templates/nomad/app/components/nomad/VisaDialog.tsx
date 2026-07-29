import { useActionMutation } from "@agent-native/core/client/hooks";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import {
  countryFlag,
  countryName,
  isSchengen,
} from "../../../shared/countries";
import type { Visa } from "../../../shared/types";

/**
 * Add/edit a visa or permit with a hard expiry. For Schengen member states
 * the visa can cover the whole zone (the common case for C/D visas).
 */
export function VisaDialog({
  open,
  onOpenChange,
  visa,
  defaultCountryCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing visa to edit, or null to create. */
  visa: Visa | null;
  /** Country context the dialog was opened from. */
  defaultCountryCode?: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const upsert = useActionMutation("upsert-visa");
  const remove = useActionMutation("delete-visa");

  const contextCode = (
    visa?.countryCode ??
    defaultCountryCode ??
    ""
  ).toUpperCase();
  const schengenMember = contextCode ? isSchengen(contextCode) : false;

  const [label, setLabel] = useState("");
  const [wholeSchengen, setWholeSchengen] = useState(false);
  const [validFrom, setValidFrom] = useState("");
  const [expiresOn, setExpiresOn] = useState("");

  useEffect(() => {
    if (!open) return;
    setLabel(visa?.label ?? "");
    setWholeSchengen(visa ? visa.zone === "schengen" : schengenMember);
    setValidFrom(visa?.validFrom ?? "");
    setExpiresOn(visa?.expiresOn ?? "");
  }, [open, visa, schengenMember]);

  const canSave = label.trim().length > 0 && expiresOn.length === 10;

  function save() {
    upsert.mutate(
      {
        ...(visa ? { id: visa.id } : {}),
        label: label.trim(),
        ...(wholeSchengen
          ? { zone: "schengen" as const, countryCode: null }
          : { zone: null, countryCode: contextCode || null }),
        validFrom: validFrom || null,
        expiresOn,
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  }

  function destroy() {
    if (!visa) return;
    remove.mutate(
      { id: visa.id },
      {
        onSuccess: () => onOpenChange(false),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {visa ? t("nomad.visa.editTitle") : t("nomad.visa.addTitle")}
            {contextCode && !wholeSchengen
              ? ` — ${countryFlag(contextCode)} ${countryName(contextCode, locale)}`
              : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="visa-label">{t("nomad.visa.label")}</Label>
            <Input
              id="visa-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("nomad.visa.labelPlaceholder")}
            />
          </div>
          {(schengenMember || visa?.zone === "schengen") && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-popover p-3">
              <div className="text-sm">{t("nomad.visa.schengenScope")}</div>
              <Switch
                checked={wholeSchengen}
                onCheckedChange={setWholeSchengen}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="visa-valid-from">
                {t("nomad.visa.validFrom")}
              </Label>
              <Input
                id="visa-valid-from"
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="visa-expiry">{t("nomad.visa.expiresOn")}</Label>
              <Input
                id="visa-expiry"
                type="date"
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("nomad.visa.capHint")}
          </p>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {visa ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={remove.isPending}
              onClick={destroy}
            >
              {t("nomad.stay.delete")}
            </Button>
          ) : (
            <span />
          )}
          <Button disabled={!canSave || upsert.isPending} onClick={save}>
            {t("nomad.stay.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
