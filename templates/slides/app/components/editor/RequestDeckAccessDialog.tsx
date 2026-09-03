import { useT } from "@agent-native/core/client/i18n";
import { IconLogin2 } from "@tabler/icons-react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export interface RequestDeckAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signInHref: string;
  email: string;
  onEmailChange: (email: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isSubmitting: boolean;
  error?: string | null;
}

export function RequestDeckAccessDialog({
  open,
  onOpenChange,
  signInHref,
  email,
  onEmailChange,
  onSubmit,
  isSubmitting,
  error,
}: RequestDeckAccessDialogProps) {
  const t = useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("deckEditor.requestAccessDialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("deckEditor.requestAccessDialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Button asChild className="w-full gap-2">
            <a href={signInHref}>
              <IconLogin2 className="size-4" aria-hidden="true" />
              {t("deckEditor.requestAccessSignIn")}
            </a>
          </Button>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            <span>{t("deckEditor.requestAccessOr")}</span>
            <Separator className="flex-1" />
          </div>

          <form className="grid gap-3" onSubmit={onSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="private-deck-request-email">
                {t("deckEditor.requestAccessEmailLabel")}
              </Label>
              <Input
                id="private-deck-request-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                placeholder={t("deckEditor.requestAccessEmailPlaceholder")}
                aria-invalid={Boolean(error)}
              />
              <p className="text-xs text-muted-foreground">
                {t("deckEditor.requestAccessEmailHint")}
              </p>
            </div>

            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting
                ? t("deckEditor.requestingAccess")
                : t("deckEditor.requestAccessWithEmail")}
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
