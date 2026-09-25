import { installRouteChunkRecovery } from "./route-chunk-recovery.js";

declare global {
  interface Window {
    __routeChunkRecoveryE2E?: { ready?: boolean };
  }
}

installRouteChunkRecovery();

/**
 * Mirrors react-router's real loadRouteModule() catch block verbatim (see
 * node_modules/react-router/dist/*\/lib/dom/ssr/routeModules.js) rather than
 * pulling in the full framework-mode SSR/manifest pipeline just to reach the
 * same four lines. This is what installRouteChunkRecovery() is actually
 * built to react to - reproducing it directly keeps this test honest about
 * what it covers without being brittle to react-router's internals changing.
 */
async function loadRouteModuleLike(url: string): Promise<unknown> {
  try {
    return await import(/* @vite-ignore */ url);
  } catch (error) {
    console.error(`Error loading route module \`${url}\`, reloading page...`);
    console.error(error);
    window.location.reload();
    return new Promise(() => {});
  }
}

const root = document.getElementById("root")!;

function renderHome() {
  root.innerHTML = `<a id="gallery-link" href="/gallery">Gallery</a><div id="page">HOME</div>`;
  document
    .getElementById("gallery-link")!
    .addEventListener("click", (event) => {
      event.preventDefault();
      // Real React Router doesn't commit the URL until the module resolves -
      // that's exactly why a same-route reload lands back where you started.
      loadRouteModuleLike("/src/client/e2e-gallery.js").then(() => {
        history.pushState({}, "", "/gallery");
        renderGallery();
      });
    });
}

function renderGallery() {
  root.innerHTML = `<div id="page">GALLERY</div>`;
}

if (window.location.pathname === "/gallery") {
  loadRouteModuleLike("/src/client/e2e-gallery.js").then(renderGallery);
} else {
  renderHome();
}

window.__routeChunkRecoveryE2E = { ready: true };
