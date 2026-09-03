/**
 * Lets the tray's React surfaces render in a plain browser tab (`pnpm
 * vite:dev`, http://localhost:1420) so layout and copy can be reviewed without
 * a Rust build.
 *
 * Outside Tauri there is no IPC: `getCurrentWindow()` reads
 * `window.__TAURI_INTERNALS__.metadata` and throws during the first effect,
 * which blanks the whole app. This installs the smallest stub that keeps React
 * mounted.
 *
 * Every `invoke` REJECTS rather than returning invented data. A settings row
 * that cannot read its value should show its default and say so, not a
 * fabricated state that looks real in a screenshot — so what you see here is
 * the surface's genuine "backend unavailable" rendering. Anything needing true
 * device state (permission grants, Whisper catalog, Rewind) has to be checked
 * in the real app.
 *
 * Dev-only: `main.tsx` calls this behind `import.meta.env.DEV`, so it is absent
 * from any production bundle.
 */

type TauriInternals = {
  metadata: {
    currentWindow: { label: string };
    currentWebview: { label: string; windowLabel: string };
  };
  invoke: (cmd: string, args?: unknown) => Promise<never>;
  transformCallback: (cb: (payload: unknown) => void) => number;
  convertFileSrc: (path: string) => string;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
  }
}

export function installBrowserPreview(): void {
  if (window.__TAURI_INTERNALS__) return;

  let callbackId = 0;
  const callbacks = new Map<number, (payload: unknown) => void>();

  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    invoke: (cmd) =>
      Promise.reject(
        new Error(`Tauri command "${cmd}" is unavailable in browser preview`),
      ),
    transformCallback: (cb) => {
      const id = ++callbackId;
      callbacks.set(id, cb);
      return id;
    },
    convertFileSrc: (path) => path,
  };

  console.info(
    "[clips-tray] browser preview: Tauri commands will reject. Add a route " +
      "hash to jump straight to a surface, e.g. #settings or #settings/advanced.",
  );
}
