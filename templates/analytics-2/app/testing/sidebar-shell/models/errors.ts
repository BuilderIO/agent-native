import type {
  NavigationEntry,
  ShellModel,
} from "@agent-native/toolkit/app-shell/sidebar-shell";
import { useEffect } from "react";
import { isRouteErrorResponse } from "react-router";

export const errorFixtures = [
  {
    name: "error-404",
    error: { status: 404, statusText: "Not Found", data: "", internal: false },
  },
  {
    name: "error-503",
    error: {
      status: 503,
      statusText: "Synthetic unavailable",
      data: "",
      internal: false,
    },
  },
  { name: "error-generic", error: "failure" },
  {
    name: "error-development",
    error: Object.assign(new Error("Synthetic runtime error"), {
      stack: "Error: Synthetic runtime error\n    at synthetic-frame",
    }),
  },
] as const;

export function routeErrorModel(
  error: unknown,
  development: boolean,
): ShellModel {
  let status: number | null = null;
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";
  let stack: string | undefined;
  if (isRouteErrorResponse(error)) {
    status = error.status;
    if (status === 404) {
      title = "Page not found";
      message = "This page doesn't exist. It may have been moved or deleted.";
    } else {
      title = `${status} Error`;
      message = error.statusText || message;
    }
  } else if (development && error instanceof Error) {
    message = error.message;
    stack = error.stack;
  }
  const entry = (containerId: string, label: string): NavigationEntry => ({
    id: `shell.error.${containerId}`,
    part: "app-shell",
    subPart: "app-shell.skeleton",
    containerId,
    order: 0,
    kind: "status",
    label,
  });
  return {
    frame: { key: "route-error", routeRuleId: "resolved-route-error" },
    navigation: {
      entries: [],
      sections: [],
      presentation: {
        collapsed: { value: false },
        mobileOpen: { value: false },
        peekOpen: false,
        profile: "none",
        themeFamily: "original",
        visibility: "hidden",
        width: 0,
      },
    },
    regions: [
      {
        id: "shell.error",
        part: "app-shell",
        subPart: "app-shell.skeleton",
        containerId: "route-error",
        order: 0,
        content: { owner: "model", key: "route-error" },
        title,
        state: { status: "error", message },
        actions: [
          ...(status ? [entry("error-status", String(status))] : []),
          {
            ...entry("error-home", "Go home"),
            kind: "destination",
            effect: { kind: "navigate", to: "/home" },
          },
          ...(stack ? [entry("error-stack", stack)] : []),
        ],
      },
      {
        id: "shell.error.report",
        part: "app-shell",
        subPart: "app-shell.overlays",
        containerId: "route-error",
        order: 1,
        content: { owner: "kit", key: "error-report-actions" },
      },
    ],
    shortcuts: [],
    preferences: [],
    effects: [],
  };
}

export function useRouteErrorModel(
  error: unknown,
  development: boolean,
): ShellModel {
  useEffect(() => {
    const root = document.documentElement;
    if (root.classList.contains("dark") || root.classList.contains("light"))
      return;
    const stored = localStorage.getItem("theme");
    if (stored === "dark") root.classList.add("dark");
    else if (stored === "light") root.classList.add("light");
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches)
      root.classList.add("dark");
  }, []);
  return routeErrorModel(error, development);
}
