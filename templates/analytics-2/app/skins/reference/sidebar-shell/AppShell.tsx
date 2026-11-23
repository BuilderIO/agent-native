import {
  shellAction,
  shellConditionState,
  type AppShellPartProps,
  type ShellModel,
  type ShellRegion,
} from "@agent-native/toolkit/app-shell/sidebar-shell";
import { IconChevronLeft, IconMenu2, IconSearch } from "@tabler/icons-react";
import { Link } from "react-router";

import { ContentSlot } from "./ContentSlot";
import { invoke, required, visible } from "./entry";
import { WorkspaceMenu } from "./menus";
import { RouteError } from "./RouteError";
import { Sidebar } from "./Sidebar";

function region(model: ShellModel, part: ShellRegion["subPart"]) {
  const matches = model.regions.filter(
    (item) => item.subPart === part && shellConditionState(item).visible,
  );
  if (matches.length !== 1)
    throw new Error(`Expected one shell region: ${part}`);
  const match = matches[0];
  if (!match) throw new Error(`Missing shell region: ${part}`);
  return match;
}

function FrameMessage({ model }: AppShellPartProps) {
  const message = region(model, "app-shell.skeleton");
  if (!message.state || message.state.status === "ready")
    throw new Error("Frame message requires a loading or error read state");
  const retry =
    message.state.status === "error" ? message.state.reloadEffectId : undefined;
  return (
    <div style={{ display: "flex", minHeight: "100vh", width: "100%" }}>
      <div
        role={retry ? "alert" : "status"}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: 480,
          margin: "auto",
          padding: 24,
          fontFamily: "inherit",
          fontSize: 14,
          lineHeight: "20px",
        }}
      >
        <strong style={{ fontSize: 16 }}>
          {message.state.status === "loading"
            ? message.state.label
            : message.title}
        </strong>
        {message.state.status === "error" && message.state.message ? (
          <span style={{ opacity: 0.75 }}>{message.state.message}</span>
        ) : null}
        {retry ? (
          <button
            type="button"
            onClick={() =>
              invoke({ kind: "action", effectId: retry }, model.effects)
            }
            style={{ width: "fit-content" }}
          >
            {message.state.status === "error"
              ? message.state.retryLabel
              : undefined}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function WriteErrorBanner({ model }: AppShellPartProps) {
  const banners = model.regions.filter(
    (item) =>
      item.subPart === "app-shell.banner" && shellConditionState(item).visible,
  );
  return banners.map((banner) => {
    const actions = visible(banner.actions ?? []);
    const retry = required(actions, "write-retry");
    const dismiss = required(actions, "write-dismiss");
    if (retry.effect?.kind !== "action")
      throw new Error("Write retry requires an action effect");
    const failed = shellAction(model.effects, retry.effect.effectId);
    if (failed.error === undefined)
      throw new Error("Write banner requires an action error");
    return (
      <div
        key={banner.id}
        role="alert"
        data-workspace-write-error={failed.actionName}
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          fontSize: 13,
          lineHeight: "18px",
          borderBottom: "1px solid rgba(120,120,120,0.25)",
        }}
      >
        <span>
          {banner.title}
          {failed.error}
        </span>
        <button
          type="button"
          onClick={() => invoke(retry.effect, model.effects)}
        >
          {retry.label}
        </button>
        <button
          type="button"
          onClick={() => invoke(dismiss.effect, model.effects)}
        >
          {dismiss.label}
        </button>
      </div>
    );
  });
}

export function AppShell({ model }: AppShellPartProps) {
  if (model.frame.key === "route-error") return <RouteError model={model} />;
  if (
    model.regions.some(
      (item) =>
        item.subPart === "app-shell.skeleton" &&
        shellConditionState(item).visible &&
        item.state &&
        item.state.status !== "ready",
    )
  )
    return <FrameMessage model={model} />;
  if (["asset", "redirect", "server"].includes(model.frame.key)) return null;
  const main = region(model, "app-shell.main");
  const content = <ContentSlot owner={main.content} />;
  if (model.frame.key === "published-app") return content;
  const sidebar = <Sidebar model={model.navigation} effects={model.effects} />;
  if (model.frame.key === "settings") {
    const topbar = region(model, "app-shell.topbar");
    const back = required(topbar.actions ?? [], "settings-back");
    if (back.effect?.kind !== "navigate")
      throw new Error("Settings back requires a destination");
    return (
      <div className="settings-shell" data-route-frame="settings">
        <header className="settings-topbar">
          <Link to={back.effect.to} className="settings-back">
            <IconChevronLeft size={16} aria-hidden="true" />
            {back.label}
          </Link>
        </header>
        <div className="settings-split">
          {sidebar}
          <div className="settings-scroll">
            <div className="settings-inner">{content}</div>
          </div>
        </div>
      </div>
    );
  }
  if (model.frame.key === "context")
    return (
      <div className="context-area">
        {sidebar}
        <div className="context-area-content">{content}</div>
      </div>
    );
  if (model.frame.key === "home") {
    const topbar = region(model, "app-shell.topbar");
    const opener = required(topbar.actions ?? [], "mobile-opener");
    const search = required(topbar.actions ?? [], "mobile-search");
    const workspace = required(topbar.actions ?? [], "mobile-workspace");
    const scrim = model.regions.find(
      (item) =>
        item.subPart === "app-shell.aside" && shellConditionState(item).visible,
    );
    const dismiss = scrim
      ? required(scrim.actions ?? [], "drawer-dismiss")
      : undefined;
    return (
      <>
        <div className="ws-root">
          <div className="ws-mobile-nav">
            <div className="ws-mobile-nav-left">
              <button
                type="button"
                className="ws-icon-button"
                aria-label={opener.accessibleLabel}
                onClick={() => invoke(opener.effect, model.effects)}
              >
                <IconMenu2 size={16} aria-hidden="true" />
              </button>
              <WorkspaceMenu entry={workspace} effects={model.effects} />
            </div>
            <div className="ws-mobile-nav-right">
              <button
                type="button"
                className="ws-icon-button"
                aria-label={search.accessibleLabel}
                title={search.tooltip}
                data-search-trigger="true"
                onClick={() => invoke(search.effect, model.effects)}
              >
                <IconSearch size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="ws-body">
            <div className="ws-main">
              {sidebar}
              {dismiss ? (
                <button
                  type="button"
                  className="ws-overlay"
                  aria-label={dismiss.accessibleLabel}
                  onClick={() => invoke(dismiss.effect, model.effects)}
                />
              ) : null}
              <main className="ws-content">
                <WriteErrorBanner model={model} />
                {content}
              </main>
            </div>
          </div>
        </div>
        {visible(
          model.regions.filter((item) => item.subPart === "app-shell.overlays"),
        ).map((item) => (
          <ContentSlot key={item.id} owner={item.content} />
        ))}
      </>
    );
  }
  if (
    [
      "project",
      "explore",
      "authentication",
      "onboarding",
      "link",
      "callback",
    ].includes(model.frame.key)
  )
    return (
      <div
        data-route-frame={model.frame.key}
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          width: "100%",
          height: "100%",
          minHeight: "100vh",
          overflow: "hidden",
        }}
      >
        {content}
      </div>
    );
  throw new Error(`Unsupported shell frame: ${model.frame.key}`);
}
