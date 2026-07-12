import { useT } from "@agent-native/core/client";
import type {
  PlanLegacyWireframeBlock,
  PlanWireframeRegion,
} from "@shared/plan-content";
import { type ReactNode } from "react";
import rough from "roughjs";

import { cn } from "@/lib/utils";

/**
 * LEGACY region-based wireframe renderer — FALLBACK ONLY.
 *
 * New generation never emits region geometry (it emits a declarative kit tree;
 * see `Wireframe.tsx`). This module keeps rendering old / imported plans that
 * still carry `{ viewport, template, regions[] }` data so we never lose them.
 * Do NOT delete it; do NOT lossily migrate old plans to empty kit trees.
 *
 * It uses per-box rough.js (the old approach). The new kit-tree renderer uses a
 * single Screen-level wobble filter instead.
 */

const roughGenerator = rough.generator();

export function LegacyRegionWireframe({
  data,
  compact,
  canvasSize,
}: {
  data: PlanLegacyWireframeBlock["data"];
  compact?: boolean;
  canvasSize?: number;
}) {
  const isPhone = data.viewport === "phone";
  const isTemplate = Boolean(data.template);
  return (
    <div
      className={cn(
        "plan-sketch relative overflow-hidden bg-plan-wireframe text-plan-sketch-line",
        isTemplate && "plan-template-wireframe",
        isPhone ? "mx-auto w-[260px] rounded-[34px]" : "w-full rounded-[16px]",
        compact && "max-w-[380px]",
      )}
      style={{
        height: canvasSize ?? (isPhone ? 460 : compact ? 300 : 360),
      }}
    >
      {isPhone && (
        <div className="absolute left-1/2 top-3 h-1.5 w-10 -translate-x-1/2 rounded-full bg-plan-muted-line" />
      )}
      <RoughBox id={`wireframe-${data.viewport ?? "desktop"}`} />
      {data.template ? (
        <SemanticWireframeTemplate template={data.template} />
      ) : (
        data.regions.map((region) => (
          <RoughRegion key={region.id} region={region} />
        ))
      )}
    </div>
  );
}

function SemanticWireframeTemplate({
  template,
}: {
  template: NonNullable<PlanLegacyWireframeBlock["data"]["template"]>;
}) {
  if (template === "context-xray-app") return <ContextXRayAppTemplate />;
  if (template === "context-xray-expanded")
    return <ContextXRayExpandedTemplate />;
  if (template === "context-xray-map") return <ContextXRayMapTemplate />;
  if (template === "context-xray-chat-cleanup")
    return <ContextXRayChatCleanupTemplate />;
  return <ContextXRayDefaultTemplate />;
}

function TemplateBox({
  id,
  children,
  className,
  emphasis,
}: {
  id: string;
  children?: ReactNode;
  className?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "plan-template-box",
        emphasis && "plan-template-box-emphasis",
        className,
      )}
    >
      <RoughBox id={id} emphasis={emphasis} />
      <div className="plan-template-box-content">{children}</div>
    </div>
  );
}

function TemplateButton({
  id,
  children,
  className,
  emphasis,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  emphasis?: boolean;
}) {
  return (
    <TemplateBox
      id={id}
      className={cn("plan-template-button", className)}
      emphasis={emphasis}
    >
      <span>{children}</span>
    </TemplateBox>
  );
}

function TemplateLines({
  count = 3,
  widths = ["72%", "52%", "34%"],
  className,
}: {
  count?: number;
  widths?: string[];
  className?: string;
}) {
  return (
    <span className={cn("plan-template-lines", className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <i
          key={index}
          style={{ width: widths[index] ?? widths[widths.length - 1] }}
        />
      ))}
    </span>
  );
}

function TemplatePill({
  children,
  active,
}: {
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <span className={cn("plan-template-pill", active && "is-active")}>
      {children}
    </span>
  );
}

function TemplateProgress({ value = 0.32 }: { value?: number }) {
  return (
    <span className="plan-template-progress" aria-hidden="true">
      <i style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  );
}

function ContextXRayMeter({ compact }: { compact?: boolean }) {
  const t = useT();
  return (
    <TemplateBox id={compact ? "xray-meter-compact" : "xray-meter"}>
      <div className="plan-template-meter">
        <div className="plan-template-meter-copy">
          <strong>2.0k used</strong>
          {!compact && <span>{t("plansPage.wireframe.usageFree")}</span>}
        </div>
        <TemplateProgress value={0.18} />
      </div>
    </TemplateBox>
  );
}

function ContextXRayToggle() {
  return (
    <div className="plan-template-toggle">
      <TemplatePill active>List</TemplatePill>
      <TemplatePill>Map</TemplatePill>
    </div>
  );
}

function ContextXRaySegmentRow({ compact }: { compact?: boolean }) {
  return (
    <TemplateBox id="segment-row" className="plan-template-segment-row">
      <div>
        <div className="plan-template-row-heading">
          <strong>Conversation</strong>
          {!compact && <span>2.0k</span>}
        </div>
        <TemplateLines count={compact ? 1 : 2} widths={["76%", "48%"]} />
      </div>
      {!compact && <TemplatePill>Protected</TemplatePill>}
      <TemplateButton id="segment-pin">Pin</TemplateButton>
    </TemplateBox>
  );
}

function ContextXRayDefaultTemplate() {
  const t = useT();
  return (
    <div className="plan-template-layer plan-template-popover">
      <div className="plan-template-popover-header">
        <TemplateBox id="default-title" emphasis>
          <strong>{t("plansPage.wireframe.contextXray")}</strong>
        </TemplateBox>
        <div className="plan-template-header-meta">
          <span>{t("plansPage.wireframe.pinnedZero")}</span>
          <span>{t("plansPage.wireframe.evictedZero")}</span>
        </div>
      </div>
      <ContextXRayMeter />
      <ContextXRayToggle />
      <TemplateBox id="conversation-group" className="plan-template-group">
        <div className="plan-template-group-title">
          <span>Conversation</span>
          <span>2.0k</span>
        </div>
        <ContextXRaySegmentRow compact />
      </TemplateBox>
    </div>
  );
}

function ContextXRayExpandedTemplate() {
  const t = useT();
  return (
    <div className="plan-template-layer plan-template-popover plan-template-expanded">
      <div className="plan-template-popover-header">
        <TemplateBox id="expanded-title" emphasis>
          <strong>Conversation</strong>
        </TemplateBox>
        <TemplateBox id="expanded-usage">
          <strong>2.0k protected</strong>
        </TemplateBox>
      </div>
      <TemplateBox id="expanded-user" className="plan-template-message-row">
        <strong>{t("plansPage.wireframe.userMessage")}</strong>
        <TemplateLines count={2} widths={["80%", "58%"]} />
      </TemplateBox>
      <TemplateBox id="expanded-tool" className="plan-template-message-row">
        <strong>{t("plansPage.wireframe.toolResult")}</strong>
        <TemplateLines count={2} widths={["76%", "54%"]} />
      </TemplateBox>
      <div className="plan-template-action-row">
        <TemplatePill>Protected</TemplatePill>
        <TemplateButton id="expanded-pin" emphasis>
          {t("plansPage.wireframe.pinEvict")}
        </TemplateButton>
      </div>
    </div>
  );
}

function ContextXRayMapTemplate() {
  const t = useT();
  return (
    <div className="plan-template-layer plan-template-popover plan-template-map">
      <div className="plan-template-popover-header">
        <TemplateBox id="map-title" emphasis>
          <strong>{t("plansPage.wireframe.contextXray")}</strong>
        </TemplateBox>
        <span>Map</span>
      </div>
      <TemplateBox id="token-map" className="plan-template-map-area">
        <div className="plan-template-row-heading">
          <strong>{t("plansPage.wireframe.tokenMap")}</strong>
          <span>2.0k selected</span>
        </div>
        <div className="plan-template-treemap">
          <i className="is-large" />
          <i />
          <i />
          <i className="is-muted" />
          <i />
        </div>
      </TemplateBox>
      <div className="plan-template-map-footer">
        <TemplateBox id="map-legend">Legend</TemplateBox>
        <TemplateBox id="map-selected">
          {t("plansPage.wireframe.selectedTokens")}
        </TemplateBox>
      </div>
    </div>
  );
}

function ContextXRayChatCleanupTemplate() {
  const t = useT();
  return (
    <div className="plan-template-layer plan-template-chat-cleanup">
      <TemplateBox id="chat-messages" className="plan-template-chat-thread">
        <div className="plan-template-message-bubble">
          <strong>{t("plansPage.wireframe.chatMessages")}</strong>
          <TemplateLines count={3} widths={["74%", "58%", "38%"]} />
        </div>
        <div className="plan-template-message-bubble is-reply">
          <TemplateLines count={3} widths={["82%", "62%", "42%"]} />
        </div>
      </TemplateBox>
      <TemplateBox id="thinking-status" className="plan-template-status">
        {t("plansPage.wireframe.thinkingStatus")}
      </TemplateBox>
      <TemplateBox id="composer" className="plan-template-composer">
        <span>Composer</span>
        <TemplateLines count={1} widths={["70%"]} />
      </TemplateBox>
    </div>
  );
}

function ContextXRayAppTemplate() {
  const t = useT();
  return (
    <div className="plan-template-layer plan-template-app-context">
      <TemplateBox id="app-shell" className="plan-template-app-shell">
        <div className="plan-template-app-topbar">
          <span>{t("plansPage.wireframe.appShell")}</span>
          <TemplateLines count={1} widths={["68%"]} />
        </div>
        <div className="plan-template-app-grid">
          <TemplateBox id="app-chat-thread" className="plan-template-app-chat">
            <strong>{t("plansPage.wireframe.chatThread")}</strong>
            <div className="plan-template-message-bubble">
              <TemplateLines count={3} widths={["72%", "55%", "34%"]} />
            </div>
            <div className="plan-template-message-bubble is-reply">
              <TemplateLines count={2} widths={["64%", "44%"]} />
            </div>
          </TemplateBox>
          <div className="plan-template-sidebar">
            <TemplateBox
              id="app-sidebar-title"
              className="plan-template-sidebar-title"
            >
              {t("plansPage.wireframe.agentSidebar")}
            </TemplateBox>
            <TemplateBox
              id="app-xray-popover"
              className="plan-template-sidebar-popover"
              emphasis
            >
              <strong>{t("plansPage.wireframe.contextXrayPopover")}</strong>
              <ContextXRayMeter compact />
              <ContextXRayToggle />
              <ContextXRaySegmentRow compact />
            </TemplateBox>
            <TemplateButton id="app-xray-trigger" emphasis>
              {t("plansPage.wireframe.xray")}
            </TemplateButton>
          </div>
          <TemplateBox id="app-thinking" className="plan-template-app-status">
            {t("plansPage.wireframe.thinkingStatus")}
          </TemplateBox>
          <TemplateBox id="app-composer" className="plan-template-app-composer">
            <span>Composer</span>
            <TemplateLines count={1} widths={["74%"]} />
          </TemplateBox>
        </div>
      </TemplateBox>
    </div>
  );
}

function RoughRegion({ region }: { region: PlanWireframeRegion }) {
  const isButton = region.kind === "button";
  const isPopover =
    /\bpopover\b/i.test(region.id) || /\bpopover\b/i.test(region.label ?? "");
  const isCompactRegion = region.height < 14;
  const hasLabel = Boolean(region.label);
  const scaffoldLineCount =
    region.kind === "list"
      ? hasLabel
        ? region.height < 10
          ? 1
          : region.height < 18
            ? 2
            : 3
        : region.height < 12
          ? 2
          : 3
      : 3;
  const showScaffold =
    !isButton &&
    ((region.kind === "list" && (!hasLabel || region.height >= 10)) ||
      region.kind === "input" ||
      (!hasLabel &&
        (region.kind === "content" ||
          region.kind === "header" ||
          region.kind === "nav" ||
          region.kind === "toolbar")));
  return (
    <div
      className={cn(
        "plan-sketch-region absolute",
        hasLabel && "plan-region-has-label",
        isPopover && "plan-region-popover",
        region.kind === "header" && "plan-region-header",
        region.kind === "nav" && "plan-region-nav",
        region.kind === "list" && "plan-region-list",
        region.kind === "toolbar" && "plan-region-toolbar",
        region.kind === "content" && "plan-region-content",
        isButton && "plan-region-button",
        isButton && region.emphasis && "plan-region-button-emphasis",
        region.kind === "input" && "plan-region-input",
        region.emphasis && !isButton && "text-primary",
      )}
      style={{
        left: `${region.x}%`,
        top: `${region.y}%`,
        width: `${region.width}%`,
        height: `${region.height}%`,
      }}
    >
      <RoughBox id={region.id} emphasis={region.emphasis} />
      {isButton && region.label ? (
        <span
          className={cn(
            "plan-sketch-label absolute z-10 max-w-[calc(100%-1rem)] truncate text-[13px] font-semibold leading-none",
            "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-2",
          )}
        >
          {region.label}
        </span>
      ) : (
        <div
          className={cn(
            "plan-region-inner",
            !hasLabel && "plan-region-inner-unlabeled",
            region.kind === "nav" && "plan-region-inner-nav",
            region.kind === "toolbar" && "plan-region-inner-toolbar",
          )}
        >
          {region.label && (
            <span className="plan-sketch-label max-w-full truncate text-[13px] font-semibold leading-none">
              {region.label}
            </span>
          )}
          {showScaffold && (
            <RegionScaffold
              kind={region.kind}
              hasLabel={hasLabel}
              compact={isCompactRegion}
              lineCount={scaffoldLineCount}
            />
          )}
        </div>
      )}
    </div>
  );
}

function RegionScaffold({
  kind,
  hasLabel,
  compact,
  lineCount = 3,
}: {
  kind: PlanWireframeRegion["kind"];
  hasLabel?: boolean;
  compact?: boolean;
  lineCount?: number;
}) {
  if (kind === "input") {
    return (
      <span
        className={cn(
          "plan-region-scaffold plan-region-scaffold-input",
          hasLabel && "plan-region-scaffold-with-label",
          compact && "plan-region-scaffold-compact",
        )}
      >
        <i />
      </span>
    );
  }
  if (kind === "list") {
    return (
      <span
        className={cn(
          "plan-region-scaffold plan-region-scaffold-lines",
          hasLabel && "plan-region-scaffold-with-label",
          compact && "plan-region-scaffold-compact",
        )}
      >
        {Array.from({ length: lineCount }).map((_, index) => (
          <i key={index} />
        ))}
      </span>
    );
  }
  if (kind === "nav") {
    return (
      <span className="plan-region-scaffold plan-region-scaffold-nav">
        <i />
        <i />
        <i />
        <i />
      </span>
    );
  }
  if (kind === "toolbar") {
    return (
      <span className="plan-region-scaffold plan-region-scaffold-toolbar">
        <i />
        <i />
        <i />
      </span>
    );
  }
  if (kind === "content" || kind === "header") {
    return (
      <span className="plan-region-scaffold plan-region-scaffold-lines">
        <i />
        <i />
        <i />
      </span>
    );
  }
  return null;
}

/**
 * Single SVG sketchy rounded-rect using the rough.js generator with a stable
 * seed derived from `id`. Legacy per-box "wobble". The new kit-tree renderer
 * uses one Screen-level filter instead.
 */
export function RoughBox({ id, emphasis }: { id: string; emphasis?: boolean }) {
  const paths = roughGenerator.toPaths(
    roughGenerator.path(roundedRectPath(), {
      seed: roughSeed(id),
      stroke: "currentColor",
      strokeWidth: emphasis ? 1.45 : 1.15,
      roughness: 0.28,
      bowing: 0.2,
      maxRandomnessOffset: 0.38,
      disableMultiStroke: false,
      fixedDecimalPlaceDigits: 1,
    }),
  );
  return (
    <svg
      aria-hidden="true"
      className="plan-rough-svg pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {paths.map((path, index) => (
        <path
          key={index}
          d={path.d}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={path.strokeWidth}
          vectorEffect="non-scaling-stroke"
          opacity={index === 0 ? 0.92 : 0.72}
        />
      ))}
    </svg>
  );
}

function roundedRectPath() {
  return [
    "M 5 2.5",
    "H 95",
    "Q 98 2.5 98 5.5",
    "V 94.5",
    "Q 98 97.5 95 97.5",
    "H 5",
    "Q 2 97.5 2 94.5",
    "V 5.5",
    "Q 2 2.5 5 2.5",
    "Z",
  ].join(" ");
}

function roughSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 2147483646) + 1;
}
