const MCP_APP_IMPORT =
  "https://esm.sh/@modelcontextprotocol/ext-apps@1.7.2/app-with-deps";
const MAIL_ORIGIN = "https://mail.agent-native.com";

export const mailMcpAppResourceMeta = {
  csp: {
    connectDomains: [MAIL_ORIGIN, "https://esm.sh"],
    resourceDomains: [MAIL_ORIGIN, "https://esm.sh"],
  },
  prefersBorder: true,
};

function attr(value: string | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function mailDraftMcpAppHtml({
  actionName,
  requestOrigin,
}: {
  actionName: string;
  requestOrigin?: string;
}): string {
  const origin = requestOrigin || MAIL_ORIGIN;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: Canvas; color: CanvasText; }
    body { margin: 0; }
    .shell { display: grid; gap: 12px; padding: 14px; }
    .top { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
    h1 { margin: 0; font-size: 15px; line-height: 1.25; font-weight: 700; }
    .muted { color: color-mix(in srgb, CanvasText 58%, Canvas); font-size: 12px; line-height: 1.45; }
    .grid { display: grid; gap: 8px; grid-template-columns: 1fr 1fr; }
    label { display: grid; gap: 4px; color: color-mix(in srgb, CanvasText 68%, Canvas); font-size: 11px; font-weight: 650; letter-spacing: .02em; text-transform: uppercase; }
    input, textarea { box-sizing: border-box; width: 100%; border: 1px solid color-mix(in srgb, CanvasText 16%, Canvas); border-radius: 7px; background: color-mix(in srgb, Canvas 96%, CanvasText); color: CanvasText; font: inherit; font-size: 13px; padding: 8px 9px; outline: none; }
    textarea { min-height: 150px; resize: vertical; line-height: 1.45; }
    input:focus, textarea:focus { border-color: #2563eb; box-shadow: 0 0 0 3px color-mix(in srgb, #2563eb 18%, transparent); }
    .wide { grid-column: 1 / -1; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    button { border: 1px solid color-mix(in srgb, CanvasText 14%, Canvas); border-radius: 7px; background: Canvas; color: CanvasText; font: inherit; font-size: 12px; font-weight: 700; min-height: 32px; padding: 0 10px; cursor: pointer; }
    button.primary { border-color: #2563eb; background: #2563eb; color: white; }
    button:disabled { opacity: .55; cursor: default; }
    .status { min-height: 18px; font-size: 12px; color: color-mix(in srgb, CanvasText 58%, Canvas); }
    .empty { border: 1px dashed color-mix(in srgb, CanvasText 22%, Canvas); border-radius: 8px; padding: 16px; }
    @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } .top, .actions { align-items: stretch; flex-direction: column; } button { width: 100%; } }
  </style>
</head>
<body data-action="${attr(actionName)}" data-origin="${attr(origin)}">
  <main id="app" class="shell">
    <div class="empty muted">Loading draft</div>
  </main>
  <script type="module">
    import { App } from "${MCP_APP_IMPORT}";

    const actionName = document.body.dataset.action;
    const origin = document.body.dataset.origin || "${MAIL_ORIGIN}";
    const root = document.getElementById("app");
    const app = new App({ name: "Agent Native Mail Draft", version: "1.0.0" }, {});
    let toolInput = {};
    let state = {};
    let openUrl = "";

    function esc(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function parseJsonText(text) {
      try { return JSON.parse(text); } catch { return { message: text || "" }; }
    }

    function parseToolResult(params) {
      if (!params) return {};
      if (params.structuredContent && typeof params.structuredContent === "object") {
        return params.structuredContent;
      }
      const parts = Array.isArray(params.content) ? params.content : [];
      const textPart = parts.find((part) => part && part.type === "text" && typeof part.text === "string");
      return parseJsonText(textPart ? textPart.text : "");
    }

    function absolutize(url) {
      if (!url) return "";
      try { return new URL(url, origin).toString(); } catch { return ""; }
    }

    function openLinkFrom(params, data) {
      const metaUrl = params && params._meta && params._meta["agent-native/openLink"]
        ? params._meta["agent-native/openLink"].webUrl
        : "";
      return absolutize(metaUrl || data.deepLink || "");
    }

    function normalizeDraft(data) {
      const draft = data && typeof data === "object" && data.draft ? data.draft : data;
      return {
        id: draft.id || toolInput.id || "",
        to: draft.to || toolInput.to || "",
        cc: draft.cc || toolInput.cc || "",
        bcc: draft.bcc || toolInput.bcc || "",
        subject: draft.subject || toolInput.subject || "",
        body: draft.body || toolInput.body || "",
        mode: draft.mode || toolInput.mode || "compose",
        accountEmail: draft.accountEmail || toolInput.accountEmail || ""
      };
    }

    function render(status) {
      if (!state.id) {
        root.innerHTML = '<div class="empty muted">Draft data was not available.</div>';
        return;
      }
      root.innerHTML =
        '<section class="top">' +
          '<div><h1>' + esc(state.subject || "Untitled draft") + '</h1>' +
          '<div class="muted">' + esc(state.mode || "compose") + (state.accountEmail ? " from " + esc(state.accountEmail) : "") + '</div></div>' +
          '<div class="actions">' +
            '<button type="button" data-open' + (openUrl ? "" : " disabled") + '>Open in Mail</button>' +
            '<button class="primary" type="button" data-save>Update draft</button>' +
          '</div>' +
        '</section>' +
        '<form class="grid">' +
          '<label>To<input name="to" value="' + esc(state.to) + '"></label>' +
          '<label>Subject<input name="subject" value="' + esc(state.subject) + '"></label>' +
          '<label>CC<input name="cc" value="' + esc(state.cc) + '"></label>' +
          '<label>BCC<input name="bcc" value="' + esc(state.bcc) + '"></label>' +
          '<label class="wide">Body<textarea name="body">' + esc(state.body) + '</textarea></label>' +
        '</form>' +
        '<div class="status" data-status>' + esc(status || "") + '</div>';
      root.querySelector("[data-open]")?.addEventListener("click", () => {
        if (openUrl) void app.openLink({ url: openUrl });
      });
      root.querySelector("[data-save]")?.addEventListener("click", updateDraft);
    }

    async function updateDraft() {
      const form = root.querySelector("form");
      const status = root.querySelector("[data-status]");
      const button = root.querySelector("[data-save]");
      if (!form || !state.id) return;
      button.disabled = true;
      status.textContent = "Updating";
      const payload = {
        action: "update",
        id: state.id,
        to: form.elements.to.value,
        cc: form.elements.cc.value,
        bcc: form.elements.bcc.value,
        subject: form.elements.subject.value,
        body: form.elements.body.value,
        mode: state.mode,
        accountEmail: state.accountEmail
      };
      try {
        const result = await app.callServerTool({ name: actionName, arguments: payload });
        const data = parseToolResult(result);
        state = normalizeDraft(data);
        openUrl = openLinkFrom(result, data) || openUrl;
        render("Updated");
      } catch (err) {
        status.textContent = err && err.message ? err.message : "Update failed";
        button.disabled = false;
      }
    }

    app.ontoolinput = (params) => {
      toolInput = params.arguments || {};
      if (!state.id) {
        state = normalizeDraft(toolInput);
        render();
      }
    };
    app.ontoolresult = (params) => {
      const data = parseToolResult(params);
      state = normalizeDraft(data);
      openUrl = openLinkFrom(params, data);
      render(data.message || "");
    };
    await app.connect();
  </script>
</body>
</html>`;
}
