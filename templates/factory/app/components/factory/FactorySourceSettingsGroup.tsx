import { SettingsGroup } from "@agent-native/core/client/settings";
import type { ReactNode } from "react";

export function FactorySourceSettingsGroup({
  title,
  description,
  optionalLabel,
  children,
}: {
  title: string;
  description?: string;
  optionalLabel: string;
  children: ReactNode;
}) {
  return (
    <section>
      <header className="mb-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <span className="text-xs font-normal text-muted-foreground">
            {optionalLabel}
          </span>
        </div>
        {description ? (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </header>
      <SettingsGroup variant="soft">{children}</SettingsGroup>
    </section>
  );
}
