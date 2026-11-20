(function () {
  var script = document.currentScript;
  var origin = new URL(
    script
      ? script.src
      : document.querySelector('script[src$="/forms-embed.js"]').src,
  ).origin;

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.origin !== origin || !data || data.type !== "forms:height")
      return;
    var frames = document.querySelectorAll(
      "iframe[data-forms-embed], iframe[data-forms-popup-frame]",
    );
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow !== event.source) continue;
      var limit = frames[i].hasAttribute("data-forms-popup-frame")
        ? window.innerHeight * 0.9
        : Infinity;
      frames[i].style.height = Math.min(data.height, limit) + "px";
      frames[i].setAttribute("height", String(Math.min(data.height, limit)));
    }
  });

  function openPopup(trigger) {
    var formId = trigger.getAttribute("data-forms-popup");
    var query = trigger.getAttribute("data-forms-query");
    var width = Number(trigger.getAttribute("data-forms-width")) || 376;
    var position = trigger.getAttribute("data-forms-position") || "center";
    var overlay = trigger.getAttribute("data-forms-overlay") === "1";

    var layer = document.createElement("div");
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-modal", "true");
    layer.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;display:flex;" +
      (position === "center"
        ? "align-items:center;justify-content:center;"
        : "align-items:flex-end;justify-content:" +
          (position === "bottomLeft" ? "flex-start" : "flex-end") +
          ";") +
      (overlay ? "background:rgba(0,0,0,0.5);" : "pointer-events:none;");

    var box = document.createElement("div");
    box.style.cssText =
      "position:relative;pointer-events:auto;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.25);margin:16px;" +
      "width:" +
      width +
      "px;max-width:calc(100vw - 32px);max-height:90vh;overflow:hidden;";

    var frame = document.createElement("iframe");
    frame.setAttribute("data-forms-popup-frame", "");
    frame.title = "Form";
    frame.src =
      origin +
      "/embed/" +
      encodeURIComponent(formId) +
      (query ? "?" + query : "");
    frame.style.cssText = "display:block;width:100%;height:400px;border:0;";

    var close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    close.style.cssText =
      "position:absolute;top:4px;right:8px;z-index:1;border:0;background:transparent;font-size:24px;line-height:1;cursor:pointer;";

    function dismiss() {
      document.removeEventListener("keydown", onKey);
      layer.remove();
    }
    function onKey(event) {
      if (event.key === "Escape") dismiss();
    }
    close.addEventListener("click", dismiss);
    layer.addEventListener("click", function (event) {
      if (event.target === layer) dismiss();
    });
    document.addEventListener("keydown", onKey);

    box.appendChild(close);
    box.appendChild(frame);
    layer.appendChild(box);
    document.body.appendChild(layer);
  }

  function bind() {
    var triggers = document.querySelectorAll("[data-forms-popup]");
    for (var i = 0; i < triggers.length; i++) {
      var trigger = triggers[i];
      if (trigger.hasAttribute("data-forms-bound")) continue;
      trigger.setAttribute("data-forms-bound", "");
      var mode = trigger.getAttribute("data-forms-open") || "click";
      if (mode === "click")
        trigger.addEventListener("click", openPopup.bind(null, trigger));
      else
        setTimeout(openPopup.bind(null, trigger), mode === "delay" ? 5000 : 0);
    }
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
