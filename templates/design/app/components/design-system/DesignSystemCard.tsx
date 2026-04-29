import { IconPalette, IconStar, IconStarFilled } from "@tabler/icons-react";
import type { DesignSystemData } from "../../../shared/api";

interface DesignSystemCardProps {
  id: string;
  title: string;
  data: DesignSystemData;
  isDefault: boolean;
  onClick: () => void;
  onSetDefault: () => void;
}

export function DesignSystemCard({
  id,
  title,
  data,
  isDefault,
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

  return (
    <div
      className="group relative rounded-xl border border-border bg-card hover:border-border overflow-hidden cursor-pointer"
      onClick={onClick}
    >
      <div
        className="aspect-video p-5 flex flex-col justify-between"
        style={{ background: data.colors.background }}
      >
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
            Body text in {data.typography.bodyFont}
          </div>
        </div>
      </div>

      <div className="p-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconPalette className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
            <h3 className="font-medium text-sm text-foreground truncate">
              {title}
            </h3>
          </div>
          <div className="text-xs text-muted-foreground/70 mt-1 flex items-center gap-2">
            <span>{data.typography.headingFont}</span>
            {data.typography.headingFont !== data.typography.bodyFont && (
              <>
                <span className="text-muted-foreground/40">|</span>
                <span>{data.typography.bodyFont}</span>
              </>
            )}
          </div>
          {isDefault && (
            <span className="inline-block mt-2 text-[10px] font-medium uppercase tracking-wider text-[#609FF8] bg-[#609FF8]/10 px-2 py-0.5 rounded">
              Default
            </span>
          )}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onSetDefault();
          }}
          className="shrink-0 p-1 rounded hover:bg-accent cursor-pointer"
          title={isDefault ? "Default design system" : "Set as default"}
        >
          {isDefault ? (
            <IconStarFilled className="w-4 h-4 text-[#609FF8]" />
          ) : (
            <IconStar className="w-4 h-4 text-muted-foreground/60 group-hover:text-muted-foreground" />
          )}
        </button>
      </div>
    </div>
  );
}
