import { IconPalette, IconStar, IconStarFilled } from "@tabler/icons-react";
import { ShareButton, VisibilityBadge } from "@agent-native/core/client";
import type { DesignSystemData } from "../../../shared/api";

interface DesignSystemCardProps {
  id: string;
  title: string;
  data: DesignSystemData;
  isDefault: boolean;
  visibility?: "private" | "org" | "public" | null;
  onClick: () => void;
  onSetDefault: () => void;
}

function firstFontName(stack: string): string {
  return (stack.split(",")[0] ?? stack).replace(/['"]/g, "").trim();
}

export function DesignSystemCard({
  id,
  title,
  data,
  isDefault,
  visibility,
  onClick,
  onSetDefault,
}: DesignSystemCardProps) {
  const swatchColors = [
    { label: "Primary", color: data.colors.primary },
    { label: "Secondary", color: data.colors.secondary },
    { label: "Accent", color: data.colors.accent },
    { label: "Background", color: data.colors.background },
    { label: "Text", color: data.colors.text },
  ];

  const headingFamily = firstFontName(data.typography.headingFont);
  const bodyFamily = firstFontName(data.typography.bodyFont);

  return (
    <div
      className="group relative rounded-xl border border-border bg-card hover:border-foreground/20 overflow-hidden cursor-pointer"
      onClick={onClick}
    >
      {/* Preview area */}
      <div
        className="relative aspect-video p-5 flex flex-col justify-between"
        style={{ background: data.colors.background }}
      >
        {/* Color swatches */}
        <div className="flex items-center gap-2">
          {swatchColors.map((s) => (
            <div
              key={s.label}
              className="w-6 h-6 rounded-full border border-border shrink-0"
              style={{ background: s.color }}
              title={s.label}
            />
          ))}
        </div>

        {/* Action overlay (top-right of preview) */}
        <div
          className="absolute top-3 right-3 z-10 flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onSetDefault}
            className="h-9 w-9 inline-flex items-center justify-center rounded-md bg-background/80 backdrop-blur-sm border border-border/40 hover:bg-background cursor-pointer"
            title={isDefault ? "Default design system" : "Set as default"}
          >
            {isDefault ? (
              <IconStarFilled className="w-4 h-4 text-[#609FF8]" />
            ) : (
              <IconStar className="w-4 h-4 text-muted-foreground group-hover:text-foreground/70" />
            )}
          </button>
          <ShareButton
            resourceType="design-system"
            resourceId={id}
            resourceTitle={title}
          />
        </div>

        {/* Typography preview */}
        <div className="mt-auto">
          <div
            style={{
              fontFamily: `'${data.typography.headingFont}', sans-serif`,
              fontWeight: data.typography.headingWeight,
              fontSize: "18px",
              color: data.colors.text,
              lineHeight: 1.2,
            }}
          >
            Heading
          </div>
          <div
            style={{
              fontFamily: `'${data.typography.bodyFont}', sans-serif`,
              fontWeight: data.typography.bodyWeight,
              fontSize: "12px",
              color: data.colors.textMuted,
              marginTop: "4px",
            }}
          >
            Body text in {bodyFamily}
          </div>
        </div>
      </div>

      {/* Info area */}
      <div className="p-4 space-y-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <IconPalette className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <h3
            className="font-medium text-sm text-foreground truncate"
            title={title}
          >
            {title}
          </h3>
          {isDefault && (
            <span className="ml-auto shrink-0 text-[10px] font-medium uppercase text-[#609FF8] bg-[#609FF8]/10 px-1.5 py-0.5 rounded">
              Default
            </span>
          )}
        </div>
        <div
          className="text-xs text-muted-foreground truncate"
          title={
            headingFamily === bodyFamily
              ? data.typography.headingFont
              : `${data.typography.headingFont} | ${data.typography.bodyFont}`
          }
        >
          {headingFamily}
          {headingFamily !== bodyFamily && ` · ${bodyFamily}`}
        </div>
        <VisibilityBadge visibility={visibility} className="text-[11px]" />
      </div>
    </div>
  );
}
