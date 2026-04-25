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
   * Where to send the viewer to sign in. The framework's login page reloads
   * the URL after success, so this should be an auth-gated path that's a
   * sensible landing spot — `/library` works for any signed-in user.
   */
  signInHref?: string;
}

export function SignInPromptDialog({
  open,
  onOpenChange,
  intent,
  signInHref = "/library",
}: SignInPromptDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign in to {intent}</DialogTitle>
          <DialogDescription>
            Create an account or sign in to {intent} on this clip. You'll be
            able to come back here once you're signed in.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button
            onClick={() => {
              window.location.href = signInHref;
            }}
          >
            Sign in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
