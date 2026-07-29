import { useLocale, useT } from "@agent-native/core/client/i18n";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import type { FeatureCollection, Geometry } from "geojson";
import { useMemo, useState, type ReactNode } from "react";
import { feature } from "topojson-client";
import worldTopology from "world-atlas/countries-110m.json";

import { severityColor } from "@/lib/nomad";

import { ISO_ALPHA2_BY_NUMERIC, countryName } from "../../../shared/countries";
import type { Severity } from "../../../shared/types";

export interface MapRuleSummary {
  name: string;
  usedDays: number;
  limitDays: number;
  severity: Severity;
}

export interface MapCountryStatus {
  code: string;
  severity: Severity;
  here: boolean;
  usedDays: number;
  limitDays: number;
  ruleName: string | null;
  /** Every applicable rule, primary first — the tooltip shows them all. */
  rules: MapRuleSummary[];
}

interface CountryShape {
  code: string;
  d: string;
  centroid: [number, number];
}

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 500;

/**
 * Real, clickable world map (Natural Earth 110m via world-atlas). Every
 * country resolves to its ISO alpha-2 code, so any country can be selected —
 * tracked ones get traffic-light fills and a status marker.
 */
let shapesCache: CountryShape[] | null = null;

function countryShapes(): CountryShape[] {
  if (shapesCache) return shapesCache;
  const topology = worldTopology as unknown as Parameters<typeof feature>[0];
  const countriesObject = (
    topology as unknown as {
      objects: { countries: Parameters<typeof feature>[1] };
    }
  ).objects.countries;
  const collection = feature(
    topology,
    countriesObject,
  ) as unknown as FeatureCollection<Geometry, { name?: string }>;

  const projection = geoNaturalEarth1().fitSize(
    [VIEW_WIDTH, VIEW_HEIGHT],
    collection,
  );
  const path = geoPath(projection);

  shapesCache = collection.features.flatMap((f) => {
    const numericId = String(f.id ?? "").padStart(3, "0");
    const code = ISO_ALPHA2_BY_NUMERIC[numericId];
    // Skip Antarctica and unassigned territories — not selectable countries.
    if (!code || numericId === "010") return [];
    const d = path(f);
    if (!d) return [];
    return [{ code, d, centroid: path.centroid(f) }];
  });
  return shapesCache;
}

export function WorldMap({
  statuses,
  onSelect,
  quickActions,
  overlay,
}: {
  statuses: MapCountryStatus[];
  onSelect: (code: string) => void;
  /**
   * When provided, clicking a country opens an in-map quick-action popover
   * with this content instead of immediately calling onSelect.
   */
  quickActions?: (code: string, close: () => void) => ReactNode;
  overlay?: ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [hoverCode, setHoverCode] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [selected, setSelected] = useState<{
    code: string;
    x: number;
    y: number;
  } | null>(null);

  const shapes = useMemo(() => countryShapes(), []);
  const statusByCode = useMemo(
    () => new Map(statuses.map((s) => [s.code.toUpperCase(), s])),
    [statuses],
  );

  const hoverStatus = hoverCode ? statusByCode.get(hoverCode) : undefined;

  return (
    <div
      className="nomad-panel nomad-glow nomad-map-bg nomad-grid-lines relative min-h-[320px] flex-1 overflow-hidden"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setPointer({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
    >
      <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2 text-xs">
        <LegendChip
          color="hsl(var(--safe))"
          label={t("nomad.cockpit.legendSafe")}
        />
        <LegendChip
          color="hsl(var(--warn))"
          label={t("nomad.cockpit.legendClose")}
        />
        <LegendChip
          color="hsl(var(--danger))"
          label={t("nomad.cockpit.legendOver")}
        />
      </div>
      <div className="nomad-chip absolute right-4 top-4 z-10 hidden px-3 py-1.5 text-xs text-muted-foreground lg:block">
        {t("nomad.cockpit.mapLabel")}
      </div>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={t("nomad.cockpit.mapLabel")}
      >
        {shapes.map((shape) => {
          const status = statusByCode.get(shape.code);
          const hovered = hoverCode === shape.code;
          return (
            <path
              key={shape.code}
              d={shape.d}
              data-country={shape.code}
              className="cursor-pointer transition-[fill-opacity]"
              fill={
                status
                  ? severityColor(status.severity)
                  : "hsl(var(--muted-foreground))"
              }
              fillOpacity={
                status ? (hovered ? 0.45 : 0.28) : hovered ? 0.3 : 0.14
              }
              stroke={
                status
                  ? severityColor(status.severity)
                  : "hsl(var(--muted-foreground) / 0.3)"
              }
              strokeOpacity={status ? 0.7 : 1}
              strokeWidth={hovered ? 1.2 : 0.6}
              onClick={() => {
                if (quickActions) {
                  setSelected((prev) =>
                    prev?.code === shape.code
                      ? null
                      : { code: shape.code, x: pointer.x, y: pointer.y },
                  );
                } else {
                  onSelect(shape.code);
                }
              }}
              onMouseEnter={() => setHoverCode(shape.code)}
              onMouseLeave={() =>
                setHoverCode((prev) => (prev === shape.code ? null : prev))
              }
            />
          );
        })}
        {shapes.map((shape) => {
          const status = statusByCode.get(shape.code);
          if (!status) return null;
          const [cx, cy] = shape.centroid;
          const color = severityColor(status.severity);
          return (
            <g key={`marker-${shape.code}`} className="pointer-events-none">
              <circle cx={cx} cy={cy} r={11} fill={color} opacity={0.18} />
              <circle
                cx={cx}
                cy={cy}
                r={5}
                fill={color}
                className={status.here ? "nomad-pulse" : undefined}
              />
              {status.here && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={9.5}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.2}
                  opacity={0.6}
                />
              )}
            </g>
          );
        })}
      </svg>

      {hoverCode && !selected && (
        <div
          className="nomad-panel pointer-events-none absolute z-20 px-3 py-2 text-xs"
          style={{
            left: Math.min(pointer.x + 14, 9999),
            top: pointer.y + 8,
            transform: pointer.x > 500 ? "translateX(-110%)" : undefined,
          }}
        >
          <div className="font-semibold">{countryName(hoverCode, locale)}</div>
          {hoverStatus && hoverStatus.rules.length > 0 ? (
            <div className="mt-1 space-y-0.5">
              {hoverStatus.rules.slice(0, 3).map((r) => (
                <div key={r.name} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: severityColor(r.severity) }}
                  />
                  <span className="text-muted-foreground">
                    {r.usedDays}/{r.limitDays} · {r.name}
                  </span>
                </div>
              ))}
              {hoverStatus.rules.length > 3 && (
                <div className="text-muted-foreground">
                  {t("nomad.cockpit.moreRules", {
                    count: hoverStatus.rules.length - 3,
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="text-muted-foreground">
              {t("nomad.cockpit.untracked")}
            </div>
          )}
        </div>
      )}

      {selected && quickActions && (
        <>
          <button
            type="button"
            aria-label={t("nomad.cockpit.dismiss")}
            className="absolute inset-0 z-20 cursor-default"
            onClick={() => setSelected(null)}
          />
          <div
            className="nomad-panel nomad-glow absolute z-30 w-[240px] p-3"
            style={{
              left: Math.max(8, Math.min(selected.x + 12, 9999)),
              top: Math.max(8, selected.y - 8),
              transform: selected.x > 560 ? "translateX(-110%)" : undefined,
            }}
          >
            {quickActions(selected.code, () => setSelected(null))}
          </div>
        </>
      )}

      {overlay}
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="nomad-chip flex items-center gap-1.5 bg-card/80 px-2.5 py-1">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
