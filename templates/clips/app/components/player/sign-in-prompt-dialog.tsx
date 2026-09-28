import { useT } from "@agent-native/core/client/i18n";
import { buildSignInReturnHref } from "@agent-native/core/client/ui";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

export interface SignInPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent: "comment" | "react";
  returnTo?: string;
  onSignIn?: () => void;
  onSignUp?: () => void;
  onCreateAccount?: () => void;
}

export function SignInPromptDialog({
  open,
  onOpenChange,
  intent,
  returnTo,
  onSignIn,
  onSignUp,
  onCreateAccount,
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
      <DialogContent className="w-[calc(100%-2rem)] gap-0 p-0 sm:max-w-md">
        <div className="px-6 pb-7 pt-8 sm:px-8 sm:pb-8">
          <DialogTitle className="text-2xl tracking-tight">
            {t("signInPrompt.title", { intent: intentLabel })}
          </DialogTitle>
          <DialogFooter className="mt-7 gap-2 sm:justify-end">
            <Button variant="ghost" size="lg" asChild>
              <a href={signInHref} onClick={() => onSignIn?.()}>
                {t("signInPrompt.signIn")}
              </a>
            </Button>
            {onCreateAccount ? (
              <Button
                type="button"
                size="lg"
                onClick={() => {
                  onSignUp?.();
                  onCreateAccount();
                }}
              >
                {t("signInPrompt.createAccount")}
              </Button>
            ) : (
              <Button size="lg" asChild>
                <a href={signUpHref} onClick={() => onSignUp?.()}>
                  {t("signInPrompt.createAccount")}
                </a>
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function buildSignUpReturnHref(returnTo?: string): string {
  const signInHref = buildSignInReturnHref({ returnTo });
  return `${signInHref}${signInHref.includes("?") ? "&" : "?"}tab=signup`;
}
