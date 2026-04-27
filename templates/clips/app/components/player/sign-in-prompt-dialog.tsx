import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface SignInPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Verb describing what they were trying to do, e.g. "comment" or "react". */
  intent: string;
  /**
   * Same-origin path to return the viewer to after sign-in. Defaults to the
   * current URL so anonymous viewers on a public share page land back where
   * they were. The dialog routes through `/auth-return?to=<returnTo>`, which
   * is auth-gated — the framework's login HTML fires there, and after sign-in
   * /auth-return forwards to `returnTo`.
   */
  returnTo?: string;
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
}: SignInPromptDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign in to {intent}</DialogTitle>
          <DialogDescription>
            Create an account or sign in to {intent} on this clip. We'll bring
            you right back here when you're done.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button
            onClick={() => {
              window.location.href = buildSignInHref(returnTo);
            }}
          >
            Sign in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
