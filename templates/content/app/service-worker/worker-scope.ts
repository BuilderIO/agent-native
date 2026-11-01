import type { ShellFetchEvent, ShellStaticRoute } from "./shell-worker-core";

// The app's TypeScript program uses the DOM library, which has no service
// worker globals, so the worker entries describe the few they use.

export interface ShellExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

export interface ShellInstallEvent extends ShellExtendableEvent {
  /** Static routing; absent outside Chromium. */
  addRoutes?(routes: ShellStaticRoute[]): Promise<void>;
}

export interface ShellMessageEvent extends ShellExtendableEvent {
  readonly data: unknown;
  /** The page that sent the message. */
  readonly source: { readonly id: string } | null;
}

export interface ShellRegistration {
  /** Absent in Safari before 15.4. */
  readonly navigationPreload?: NavigationPreloadManager;
  unregister(): Promise<boolean>;
}

export interface ShellWorkerScope {
  readonly location: { readonly origin: string };
  readonly caches: CacheStorage;
  readonly registration: ShellRegistration;
  readonly clients: {
    claim(): Promise<void>;
    matchAll(options: {
      type: "window";
      includeUncontrolled: boolean;
    }): Promise<readonly { readonly id: string }[]>;
  };
  readonly navigator: { readonly languages: readonly string[] };
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  skipWaiting(): Promise<void>;
  addEventListener(
    type: "install",
    listener: (event: ShellInstallEvent) => void,
  ): void;
  addEventListener(
    type: "activate",
    listener: (event: ShellExtendableEvent) => void,
  ): void;
  addEventListener(
    type: "fetch",
    listener: (event: ShellFetchEvent & Event) => void,
  ): void;
  addEventListener(
    type: "message",
    listener: (event: ShellMessageEvent) => void,
  ): void;
}

export function workerScope(): ShellWorkerScope {
  return self as unknown as ShellWorkerScope;
}
