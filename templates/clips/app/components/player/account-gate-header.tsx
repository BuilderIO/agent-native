import type { ReactNode } from "react";

import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AccountGateHeaderProps {
  actionLabel: ReactNode;
  returnLabel: ReactNode;
  welcomeLabel: ReactNode;
}

/**
 * Shared hierarchy for every public-share account prompt. Keeping the intent
 * in the description slot lets each gate change its copy without changing the
 * visual rhythm or the accessible dialog title.
 */
export function AccountGateHeader({
  actionLabel,
  returnLabel,
  welcomeLabel,
}: AccountGateHeaderProps) {
  return (
    <DialogHeader className="space-y-2 text-start">
      <DialogTitle className="text-2xl tracking-tight">
        {welcomeLabel}
      </DialogTitle>
      <DialogDescription className="max-w-none text-pretty text-base leading-6">
        {actionLabel}
      </DialogDescription>
      <p className="text-sm leading-5 text-muted-foreground">{returnLabel}</p>
    </DialogHeader>
  );
}
