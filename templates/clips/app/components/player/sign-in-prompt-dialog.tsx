import { useT } from "@agent-native/core/client/i18n";
import { buildSignInReturnHref } from "@agent-native/core/client/ui";
import { resolveNativeAuthCopy } from "@agent-native/core/shared/auth-copy";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";

import { AccountGateHeader } from "./account-gate-header";

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
  /** Open the in-place signup flow instead of navigating away. */
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
  const copy = resolveNativeAuthCopy(
    typeof navigator === "undefined" ? undefined : navigator.language,
  );
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
          <AccountGateHeader
            actionLabel={t("signInPrompt.title", { intent: intentLabel })}
            returnLabel={t("signInPrompt.description")}
            welcomeLabel={copy.welcomeTitle}
          />
          <DialogFooter className="mt-7 gap-2 sm:justify-end">
            <Button variant="ghost" asChild>
              <a href={signInHref} onClick={() => onSignIn?.()}>
                {t("signInPrompt.signIn")}
              </a>
            </Button>
            {onCreateAccount ? (
              <Button
                type="button"
                onClick={() => {
                  onSignUp?.();
                  onCreateAccount();
                }}
              >
                {t("signInPrompt.createAccount")}
              </Button>
            ) : (
              <Button asChild>
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
