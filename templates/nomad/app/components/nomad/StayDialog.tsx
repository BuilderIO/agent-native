import { useActionMutation, useT } from "@agent-native/core/client";
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

import type { Stay } from "../../../shared/types";
import { CountryPicker } from "./CountryPicker";

/**
 * Add/edit a presence-ledger stay. Editing a pending inbox-detected stay also
 * offers one-tap confirmation.
 */
export function StayDialog({
  open,
  onOpenChange,
  stay,
  defaultCountryCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing stay to edit, or null to create. */
  stay: Stay | null;
  defaultCountryCode?: string;
}) {
  const t = useT();
  const upsert = useActionMutation("upsert-stay");
  const remove = useActionMutation("delete-stay");

  const [countryCode, setCountryCode] = useState("");
  const [city, setCity] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [exitDate, setExitDate] = useState("");

  useEffect(() => {
    if (!open) return;
    setCountryCode(stay?.countryCode ?? defaultCountryCode ?? "");
    setCity(stay?.city ?? "");
    setEntryDate(stay?.entryDate ?? "");
    setExitDate(stay?.exitDate ?? "");
  }, [open, stay, defaultCountryCode]);

  const canSave = countryCode.length === 2 && entryDate.length === 10;

  function save(extra?: { status: "confirmed" }) {
    upsert.mutate(
      {
        ...(stay ? { id: stay.id } : {}),
        countryCode,
        city: city || null,
        entryDate,
        exitDate: exitDate || null,
        ...extra,
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  }

  function destroy() {
    if (!stay) return;
    remove.mutate(
      { id: stay.id },
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
            {stay ? t("nomad.stay.editTitle") : t("nomad.stay.addTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>{t("nomad.stay.country")}</Label>
            <CountryPicker
              selected={countryCode ? [countryCode] : []}
              onToggle={(code) =>
                setCountryCode((prev) => (prev === code ? "" : code))
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="stay-city">{t("nomad.stay.city")}</Label>
            <Input
              id="stay-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder={t("nomad.stay.cityPlaceholder")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="stay-entry">{t("nomad.stay.entryDate")}</Label>
              <Input
                id="stay-entry"
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="stay-exit">{t("nomad.stay.exitDate")}</Label>
              <Input
                id="stay-exit"
                type="date"
                value={exitDate}
                onChange={(e) => setExitDate(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("nomad.stay.openStayHint")}
          </p>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {stay ? (
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
          <div className="flex gap-2">
            {stay?.status === "pending" && (
              <Button
                variant="outline"
                disabled={!canSave || upsert.isPending}
                onClick={() => save({ status: "confirmed" })}
              >
                {t("nomad.cockpit.confirm")}
              </Button>
            )}
            <Button
              disabled={!canSave || upsert.isPending}
              onClick={() => save()}
            >
              {t("nomad.stay.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
