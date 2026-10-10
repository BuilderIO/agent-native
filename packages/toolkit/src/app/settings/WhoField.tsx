import type { AgentEngineKeyScope } from "@agent-native/core/client/agent-engine-key";
import { useT } from "@agent-native/core/client/i18n";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@agent-native/toolkit/ui/radio-group";
import { IconLock } from "@tabler/icons-react";

const K = "agentChat.settingsModel.";

/**
 * "Who can use it" for a credential save: Personal or Organization. Owners
 * and admins choose (`choice`); everyone else sees where it saves, locked.
 * Pair it with `useCredentialSaveScope`, which defaults owners and admins to
 * the organization.
 */
export function WhoField({
  id,
  choice,
  scope,
  disabled,
  onChange,
  hint,
}: {
  id: string;
  choice: boolean;
  scope: AgentEngineKeyScope;
  disabled?: boolean;
  onChange: (scope: AgentEngineKeyScope) => void;
  hint?: string | null;
}) {
  const t = useT();
  return (
    <div className="grid gap-2">
      <span id={id} className="text-sm font-medium leading-none">
        {t(`${K}who`)}
      </span>
      {choice ? (
        <RadioGroup
          aria-labelledby={id}
          value={scope}
          onValueChange={(value) => onChange(value as AgentEngineKeyScope)}
          className="flex flex-wrap gap-5"
          disabled={disabled}
        >
          {(["user", "org"] as const).map((value) => (
            <div key={value} className="flex items-center gap-2">
              <RadioGroupItem id={`${id}-${value}`} value={value} />
              <Label htmlFor={`${id}-${value}`} className="font-normal">
                {value === "org" ? t(`${K}organization`) : t(`${K}personal`)}
              </Label>
            </div>
          ))}
        </RadioGroup>
      ) : (
        <div
          aria-labelledby={id}
          className="flex h-9 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground"
        >
          <IconLock className="size-4 shrink-0" aria-hidden />
          <span>
            {scope === "org" ? t(`${K}organization`) : t(`${K}personal`)}
          </span>
        </div>
      )}
      {hint ? (
        <p className="text-xs leading-5 text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
