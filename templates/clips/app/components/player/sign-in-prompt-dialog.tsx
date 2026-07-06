import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";

export interface SignInPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Verb describing what they were trying to do, e.g. "comment" or "react". */
  intent: string;
  /**
   * Same-origin path to return the viewer to after sign-in. Defaults to the
   * current URL so anonymous viewers on a public share page land back where
   * they were. The dialog routes through
   * `/_agent-native/sign-in?return=<returnTo>` — the framework's login flow
   * fires there and forwards to `returnTo` once the viewer is signed in.
   */
  returnTo?: string;
  /**
   * Fired when the viewer activates the "Sign in" button, before navigation.
   * Used by the public share page to emit the signin funnel event. Must not
   * change navigation behavior.
   */
  onSignIn?: () => void;
}

function buildSignInHref(returnTo: string | undefined): string {
  if (typeof window === "undefined") return "/_agent-native/sign-in";
  const target = returnTo ?? window.location.pathname + window.location.search;
  return `/_agent-native/sign-in?return=${encodeURIComponent(target)}`;
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
          <Button
            onClick={() => {
              onSignIn?.();
              window.location.href = buildSignInHref(returnTo);
            }}
          >
            {t("signInPrompt.signIn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
