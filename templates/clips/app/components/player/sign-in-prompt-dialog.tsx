import { useT } from "@agent-native/core/client/i18n";
import { buildSignInReturnHref } from "@agent-native/core/client/ui";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface SignInPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Verb describing what they were trying to do, e.g. "comment" or "react". */
  intent: string;
  /**
   * Same-origin path to return the viewer to after sign-in. Defaults to the
   * current URL so anonymous viewers on a public share page land back where
   * they were.
   */
  returnTo?: string;
  /**
   * Fired when the viewer activates the "Sign in" button, before navigation.
   * Used by the public share page to emit the signin funnel event. Must not
   * change navigation behavior.
   */
  onSignIn?: () => void;
}

export function SignInPromptDialog({
  open,
  onOpenChange,
  intent,
  returnTo,
  onSignIn,
}: SignInPromptDialogProps) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("signInPrompt.title", { intent })}</DialogTitle>
          <DialogDescription>
            {t("signInPrompt.description", { intent })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("signInPrompt.notNow")}
          </Button>
          <Button asChild>
            <a
              href={buildSignInReturnHref({ returnTo })}
              onClick={() => onSignIn?.()}
            >
              {t("signInPrompt.signIn")}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
