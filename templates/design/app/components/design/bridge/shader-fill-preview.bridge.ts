/** Re-scan saved GLSL shader annotations after the editor updates an iframe. */
(function () {
  interface AnShadersGlobal {
    version: number;
    scan: () => void;
  }

  window.addEventListener("message", function (e: MessageEvent) {
    if (e.source !== window.parent) return;
    if (e.data?.type !== "glsl-shader-rescan") return;
    const api = (window as unknown as { __anShaders?: AnShadersGlobal })
      .__anShaders;
    if (api && api.version >= 1) api.scan();
  });
})();
