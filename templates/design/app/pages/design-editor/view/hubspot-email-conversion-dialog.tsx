import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { HubspotEmailConversion } from "../domains/use-hubspot-html-export";

export function HubspotEmailConversionDialog({
  conversion,
  onClose,
  onConvert,
  t,
}: {
  conversion: HubspotEmailConversion | null;
  onClose: () => void;
  onConvert: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <Dialog
      open={conversion !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("designEditor.hubspotConversion.title")}</DialogTitle>
          <DialogDescription>
            {t("designEditor.hubspotConversion.description", {
              name: conversion?.title ?? "",
            })}
          </DialogDescription>
        </DialogHeader>
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm text-muted-foreground">
          {conversion?.reason}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("designEditor.hubspotConversion.cancel")}
          </Button>
          <Button onClick={onConvert}>
            {t("designEditor.hubspotConversion.convert")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
