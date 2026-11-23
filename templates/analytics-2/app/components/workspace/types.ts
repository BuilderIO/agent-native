import type { ComponentType, ReactNode } from "react";

import type { ResolvedRoute } from "@/routes/routing/registry";

/** Props every route page receives from the workspace integration. */
export interface RoutePageProps {
  route: ResolvedRoute;
}

export type RoutePageComponent = ComponentType<RoutePageProps>;

/** One registered route page. */
export interface RoutePageEntry {
  component: RoutePageComponent;
  fallback?: ReactNode;
}

export type RoutePageRegistry = Record<string, RoutePageEntry>;

export type WorkspaceWriteAction = "create-thread";

export interface WorkspaceWriteError {
  action: WorkspaceWriteAction;
  message: string;
}
