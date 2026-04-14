import { type ReactNode } from "react";
import { IconExternalLink } from "@tabler/icons-react";
import { SettingsSection } from "./SettingsSection.js";
import { useBuilderStatus } from "./useBuilderStatus.js";

interface ComingSoonSectionProps {
  icon: ReactNode;
  title: string;
  description: string;
  docsUrl?: string;
  docsLabel?: string;
  /** Manual setup hint shown alongside docs link */
  manualHint?: string;
}

export function ComingSoonSection({
  icon,
  title,
  description,
  docsUrl,
  docsLabel = "Read the docs",
  manualHint,
}: ComingSoonSectionProps) {
  const { status: builder } = useBuilderStatus();

  return (
    <SettingsSection
      icon={icon}
      title={title}
      subtitle={description}
      badge="Coming soon"
    >
      <div className="space-y-2.5">
        {/* Builder path — disabled */}
        <div className="rounded-md border border-border px-2.5 py-2 opacity-50">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-medium text-foreground">
              Use Builder
            </div>
            <span className="rounded-full bg-accent/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              Coming soon
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            One-click setup via Builder — available soon.
          </p>
        </div>

        {/* Manual path */}
        <div className="rounded-md border border-border px-2.5 py-2">
          <div className="text-[11px] font-medium text-foreground mb-1">
            Set up manually
          </div>
          {manualHint && (
            <p className="text-[10px] text-muted-foreground mb-1.5">
              {manualHint}
            </p>
          )}
          {docsUrl && (
            <a
              href={docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {docsLabel}
              <IconExternalLink size={10} />
            </a>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
