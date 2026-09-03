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
  /** The participation action that triggered the account prompt. */
  intent: "comment" | "react";
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
  onSignUp?: () => void;
}

export function SignInPromptDialog({
  open,
  onOpenChange,
  intent,
  returnTo,
  onSignIn,
  onSignUp,
}: SignInPromptDialogProps) {
  const t = useT();
  const intentLabel = t(
    intent === "comment"
      ? "signInPrompt.commentIntent"
      : "signInPrompt.reactIntent",
  );
  const signInHref = buildSignInReturnHref({ returnTo });
  const signUpHref = buildSignUpReturnHref(returnTo);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t("signInPrompt.title", { intent: intentLabel })}
          </DialogTitle>
          <DialogDescription>{t("signInPrompt.description")}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="ghost" asChild>
            <a href={signInHref} onClick={() => onSignIn?.()}>
              {t("signInPrompt.signIn")}
            </a>
          </Button>
          <Button asChild>
            <a href={signUpHref} onClick={() => onSignUp?.()}>
              {t("signInPrompt.createAccount")}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function buildSignUpReturnHref(returnTo?: string): string {
  const signInHref = buildSignInReturnHref({ returnTo });
  return `${signInHref}${signInHref.includes("?") ? "&" : "?"}tab=signup`;
}
