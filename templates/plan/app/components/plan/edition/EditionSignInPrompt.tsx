import { useT } from "@agent-native/core/client/i18n";
import { buildSignInReturnHref } from "@agent-native/core/client/ui";

import { Button } from "@/components/ui/button";

/**
 * A 401 is a signed-out viewer, not a broken read. Rendering the load-failure
 * message for one tells a reader the newspaper is down when all they need is
 * to sign in — and it hides the real failures behind the same words.
 */
export function isUnauthorizedError(error: unknown): boolean {
  return (error as { status?: unknown } | undefined)?.status === 401;
}

export function EditionSignInPrompt() {
  const t = useT();
  return (
    <div>
      <p className="max-w-[62ch] text-sm leading-[1.55] text-plan-text">
        {t("edition.signIn.prompt")}
      </p>
      <Button
        type="button"
        size="sm"
        className="mt-3"
        onClick={() => {
          window.location.href = buildSignInReturnHref({
            returnTo: `${window.location.pathname}${window.location.search}`,
          });
        }}
      >
        {t("guest.signIn")}
      </Button>
    </div>
  );
}
