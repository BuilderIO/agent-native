import { useActionMutation, useLocale, useT } from "@agent-native/core/client";
import { IconEPassport } from "@tabler/icons-react";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { countryFlag, countryName } from "../../../shared/countries";
import { CountryPicker } from "./CountryPicker";

/**
 * Header chip showing the passport the user travels on. The agent uses it to
 * reason about visa-free access; tap to change.
 */
export function PassportChip({
  citizenshipCountry,
}: {
  citizenshipCountry: string | null;
}) {
  const t = useT();
  const { locale } = useLocale();
  const updateProfile = useActionMutation("update-profile");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="nomad-chip hidden cursor-pointer items-center gap-1.5 px-3 py-1.5 text-xs transition-colors hover:border-ring lg:flex"
      >
        <IconEPassport className="size-3.5 text-muted-foreground" />
        {t("nomad.cockpit.passport")}
        <b className="text-foreground">
          {citizenshipCountry
            ? `${countryFlag(citizenshipCountry)} ${countryName(citizenshipCountry, locale)}`
            : "—"}
        </b>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("nomad.cockpit.passportTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {t("nomad.cockpit.passportHint")}
          </p>
          <CountryPicker
            selected={citizenshipCountry ? [citizenshipCountry] : []}
            onToggle={(code) => {
              updateProfile.mutate(
                {
                  citizenshipCountry: citizenshipCountry === code ? null : code,
                },
                { onSuccess: () => setOpen(false) },
              );
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
