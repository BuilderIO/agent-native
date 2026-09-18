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

export interface RequestAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signInHref: string;
  email: string;
  onEmailChange: (email: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isSubmitting: boolean;
  error?: string | null;
}

export function RequestAccessDialog({
  open,
  onOpenChange,
  signInHref,
  email,
  onEmailChange,
  onSubmit,
  isSubmitting,
  error,
}: RequestAccessDialogProps) {
  const t = useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("sharePage.requestAccessDialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("sharePage.requestAccessDialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Button asChild className="w-full gap-2">
            <a href={signInHref}>
              <IconLogin2
                className="size-4 rtl:-scale-x-100"
                aria-hidden="true"
              />
              {t("sharePage.requestAccessSignIn")}
            </a>
          </Button>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            <span>{t("sharePage.requestAccessOr")}</span>
            <Separator className="flex-1" />
          </div>

          <form className="grid gap-3" onSubmit={onSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="private-clip-request-email">
                {t("sharePage.requestAccessEmailLabel")}
              </Label>
              <Input
                id="private-clip-request-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                placeholder={t("sharePage.requestAccessEmailPlaceholder")}
                aria-invalid={Boolean(error)}
              />
              <p className="text-xs text-muted-foreground">
                {t("sharePage.requestAccessEmailHint")}
              </p>
            </div>

            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting
                ? t("sharePage.requestingAccess")
                : t("sharePage.requestAccessWithEmail")}
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
