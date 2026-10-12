// The toolkit's Settings shell (SettingsShell + core-pages.ts) for every prototype. The build merges
// kit/settings.json (Account, Connections, Agent, Organization, and the toolkit's App pages) with the
// prototype's settings.json (its own App pages) into KIT_SETTINGS. A prototype calls kitSettingsInit()
// once with its app name and hooks; openSettings(page) and ⌘, open it.

declare const KIT_SETTINGS: {
  groups: [string, string, string | null][];
  pages: any[];
} | null;

interface KitSettingsOptions {
  app: string;
  mcpName: string;
  mcpUrl: string;
  initial?: string;
  labs?: {
    get: (lab: string) => boolean;
    set: (lab: string, on: boolean) => void;
  };
  onOpen?: () => void;
  topChats?: [string, string][];
}

let KIT_ST: Required<KitSettingsOptions>;
let SETTINGS: { groups: [string, string, string | null][]; pages: any[] };

function kitSettingsInit(options: KitSettingsOptions): void {
  if (!KIT_SETTINGS)
    throw new Error(
      "kitSettingsInit needs a settings.json in the prototype's folder",
    );
  const labState: Record<string, boolean> = {};
  KIT_ST = {
    initial: "S",
    labs: {
      get: (lab) => !!labState[lab],
      set: (lab, on) => {
        labState[lab] = on;
      },
    },
    onOpen: () => {},
    topChats: [
      ["Weekly signups summary", "412 calls"],
      ["Draft the launch email", "238 calls"],
      ["Turn the Q3 metrics into a deck", "96 calls"],
    ],
    ...options,
  } as Required<KitSettingsOptions>;
  // Shared pages say {app} and {mcpUrl} where they mean this prototype's app.
  const fill = (v: any): any =>
    typeof v === "string"
      ? v.replaceAll("{app}", KIT_ST.app).replaceAll("{mcpUrl}", KIT_ST.mcpUrl)
      : Array.isArray(v)
        ? v.map(fill)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]))
          : v;
  SETTINGS = fill(KIT_SETTINGS);
}

function stEl(): HTMLElement {
  let el = document.getElementById("settings");
  if (!el) {
    el = document.createElement("div");
    el.className = "settings";
    el.id = "settings";
    el.hidden = true;
    document.body.append(el);
  }
  return el;
}

const mcpHosts = () => [
  [
    "Claude",
    [
      "Open Customize → Connectors in Claude.",
      "Click the + button → Add custom connector.",
      `Paste the MCP URL above, name it ${KIT_ST.app}, click Connect.`,
      "On the consent page, click Authorize to approve mcp:read, mcp:write, mcp:apps.",
    ],
    null,
    "Open Claude → Connectors",
  ],
  [
    "ChatGPT",
    [
      "In ChatGPT web, open Settings → Apps → Advanced settings and enable developer mode if your workspace requires it.",
      "Choose Create app, paste the MCP URL above, select OAuth, and scan the tools.",
      "Sign in with your Agent-Native account, approve the requested scopes, and enable the app in a chat.",
    ],
    null,
    "Open ChatGPT",
  ],
  [
    "Cursor",
    [
      "Open Cursor → Settings → MCP.",
      "Click Add MCP Server, paste the MCP URL above, save.",
      "When prompted, sign in with your Agent-Native account and approve the MCP scopes.",
    ],
    null,
    null,
  ],
  [
    "Claude Code",
    ["In your terminal, run:"],
    `claude mcp add --transport http ${KIT_ST.mcpName} ${KIT_ST.mcpUrl}`,
    "Copy command",
  ],
  [
    "Codex",
    ["In your terminal, run:"],
    `npx @agent-native/core@latest connect ${KIT_ST.mcpUrl.replace(/\/mcp$/, "")}`,
    "Copy command",
  ],
  [
    "Grok",
    [
      "Open grok.com/connectors and choose New Connector → Custom.",
      "Paste the MCP URL above and complete the requested authentication.",
      "Enable the connector in a chat after Grok discovers the tools.",
    ],
    null,
    "Open Grok → Connectors",
  ],
  [
    "Other",
    [
      "Any MCP-compatible client with remote-OAuth support: paste the MCP URL above. For clients without OAuth, paste this .mcp.json snippet and generate a static bearer below:",
    ],
    `{ "mcpServers": { "${KIT_ST.mcpName}": { "type": "http", "url": "${KIT_ST.mcpUrl}" } } }`,
    "Copy config",
  ],
];
const ST = {
  page: "profile",
  q: "",
  host: "Claude",
  usageTab: "Overview",
  seen: false,
  prev: null,
};
const stVisible = (p) => (p.lab ? KIT_ST.labs.get(p.lab) : true);
const stPages = () => SETTINGS.pages.filter(stVisible);
const stPage = (id) => SETTINGS.pages.find((p) => p.id === id);
const stGroupLabel = (g) => SETTINGS.groups.find((x) => x[0] === g)[1];
function openSettings(page = "profile", flash) {
  closeMenu?.();
  KIT_ST.onOpen?.();
  ST.page = stVisible(stPage(page) || {}) ? page : "profile";
  ST.q = "";
  stEl().hidden = false;
  renderSettings();
  if (flash)
    requestAnimationFrame(() => {
      const r = $(`#settings [data-key="${CSS.escape(flash)}"]`);
      if (r) {
        r.scrollIntoView({ block: "center" });
        r.classList.add("flash");
      }
    });
}
function closeSettings() {
  stEl().hidden = true;
}
function stIndex() {
  const hits = [];
  stPages().forEach((p) => {
    hits.push({
      page: p.id,
      label: p.l,
      where: stGroupLabel(p.g),
      icon: p.icon,
    });
    p.sections.forEach((sec) =>
      (sec.rows || []).forEach((r) =>
        hits.push({
          page: p.id,
          label: r.l,
          where: `${stGroupLabel(p.g)} › ${p.l}`,
          icon: p.icon,
          key: r.l,
        }),
      ),
    );
  });
  return hits;
}
function stControl(r) {
  const c = r.c;
  if (c.sw !== undefined) {
    const on = c.lab
      ? !!KIT_ST.labs.get(c.lab)
      : (ST[`sw:${ST.page}:${r.l}`] ?? c.sw);
    return `<button class="st-sw" role="switch" aria-checked="${on}" data-st-sw="${r.l}" data-lab="${c.lab || ""}" aria-label="${r.l}"></button>`;
  }
  if (c.sel !== undefined)
    return `<button class="st-sel" data-st-sel="${r.l}"><span>${ST[`sel:${ST.page}:${r.l}`] || c.sel}</span>${ic("chevron-down", "s14")}</button>`;
  if (c.btn)
    return `<button class="st-btn ${c.v || ""}" data-st-toast="${c.btn}">${c.btn}${c.ext ? ic("external-link", "s14") : ""}</button>`;
  if (c.input !== undefined)
    return `<input class="st-in ${c.num ? "num" : ""}" value="${c.val || ""}" placeholder="${c.input}" aria-label="${r.l}">`;
  if (c.copy)
    return `<span class="st-copy"><input class="st-in" readonly value="${c.copy}" aria-label="${r.l}"><button class="st-btn" data-st-copy="${c.copy}">Copy</button></span>`;
  if (c.link)
    return `<button class="st-link" ${c.to ? `data-st-go="${c.to}"` : `data-st-toast="${r.l}: ${c.link}"`}>${c.link}${ic("chevron-right", "s14")}</button>`;
  if (c.photo)
    return `<span class="st-av st-photo">${KIT_ST.initial}</span><button class="st-btn" data-st-toast="Choose a photo">Change</button>`;
  if (c.text !== undefined) return `<span class="muted">${c.text}</span>`;
  return "";
}
function stRow(r) {
  const lead = r.c.icon
    ? `<span class="ico">${ic(r.c.icon, "s16")}</span>`
    : "";
  return `<div class="st-row" data-key="${r.l}">${lead}<span class="lt"><b>${r.l}${r.c.badge ? `<span class="badge">${r.c.badge}</span>` : ""}${r.c.new ? `<span class="st-new" title="Proposed in this redesign; not in the code">New</span>` : ""}</b>${r.d ? `<small>${r.d}</small>` : ""}</span><span class="rt">${stControl(r)}</span></div>`;
}
function stSection(sec) {
  const head = sec.h
    ? `<div class="st-sec-h">${sec.h}${sec.badge ? `<span class="badge">${sec.badge}</span>` : ""}</div>`
    : "";
  let body = "";
  if (sec.rows)
    body = `<div class="st-card">${sec.rows.map(stRow).join("")}</div>`;
  else if (sec.empty)
    body = `<div class="st-card"><div class="st-empty"><b>${sec.empty.t}</b>${sec.empty.d ? `<small>${sec.empty.d}</small>` : ""}${sec.empty.btn ? `<button class="st-btn" data-st-toast="${sec.empty.btn}">${sec.empty.btn}</button>` : ""}</div></div>`;
  else if (sec.intro)
    body = `<p class="st-intro" style="margin:0">${sec.intro}</p>`;
  else if (sec.foot)
    return `<p class="st-foot">${sec.to ? sec.foot.replace(/(Integrations|MCP server|Model)\.?$/, (m) => `<button data-st-go="${sec.to}">${m.replace(".", "")}</button>.`) : sec.foot}</p>`;
  else if (sec.link)
    body = `<button class="st-link" data-st-toast="Opens the privacy page">${sec.link}${ic("external-link", "s14")}</button>`;
  else if (sec.search)
    body = `<label class="st-search" style="margin:0;max-width:320px">${ic("search", "s14")}<input type="search" placeholder="${sec.search}" aria-label="${sec.search}"></label>`;
  else if (sec.tiles)
    body = `<div class="st-tiles">${sec.tiles.map(([n, d]) => `<button class="st-tile" data-st-toast="Opens ${n}"><span class="tn"><b>${n}</b><small>${d}</small></span>${ic("plus", "s16")}</button>`).join("")}</div>${sec.more ? `<button class="st-more" data-st-toast="${sec.more}">${sec.more}</button>` : ""}`;
  else if (sec.hosts) {
    const h = mcpHosts().find((x) => x[0] === ST.host);
    body = `<p class="st-intro" style="margin:0">${sec.d}</p><div class="st-hosts" role="tablist">${mcpHosts()
      .map(
        ([n]) =>
          `<button role="tab" aria-pressed="${n === ST.host}" data-st-host="${n}">${n}</button>`,
      )
      .join(
        "",
      )}</div><ol class="st-steps">${h[1].map((x) => `<li>${x}</li>`).join("")}</ol>${h[2] ? `<div class="st-cmd"><code>${h[2]}</code><button class="icon-btn xs" data-st-copy='${h[2]}' aria-label="Copy">${ic("copy", "s14")}</button></div>` : ""}${h[3] && !h[2] ? `<button class="st-btn" style="margin-top:12px" data-st-toast="${h[3]}">${h[3]}${ic("external-link", "s14")}</button>` : ""}`;
  } else if (sec.area)
    body = `${sec.d ? `<p class="st-intro" style="margin:0 0 8px">${sec.d}</p>` : ""}<textarea class="st-area" placeholder="${sec.area}"></textarea><div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="st-btn" data-st-toast="Saved">Save</button></div>`;
  else if (sec.people)
    body = `<div class="st-card">${sec.people.map(([n, e, role, c, me]) => `<div class="st-row"><span class="st-av" style="background:${c}">${n[0].toUpperCase()}</span><span class="lt"><b>${n}${me === true ? `<span class="badge">You</span>` : me === "invited" ? `<span class="badge">Invited</span>` : ""}</b>${e ? `<small>${e}</small>` : ""}</span><span class="rt">${role === "Owner" ? `<span class="muted">Owner</span>` : me === "invited" ? `<span class="muted">${role}</span>` : `<button class="st-sel" style="min-width:112px" data-st-sel="role:${n}" data-opts="Member,Admin"><span>${ST["sel:role:" + n] || role}</span>${ic("chevron-down", "s14")}</button><button class="icon-btn" aria-label="More" data-st-toast="Remove member">${ic("dots")}</button>`}</span></div>`).join("")}</div>`;
  else if (sec.filters)
    body = `<div class="st-filters">${sec.filters.map(([v, opts]) => `<button class="st-sel" data-st-sel="f:${v}" data-opts="${opts.join(",")}"><span>${ST["sel:f:" + v] || v}</span>${ic("chevron-down", "s14")}</button>`).join("")}</div>`;
  else if (sec.changelog)
    body = `<div class="st-log">${[...new Set(sec.changelog.map((x) => x[0]))]
      .map(
        (date) =>
          `<h4>${date}</h4>${sec.changelog
            .filter((x) => x[0] === date)
            .map(
              ([, type, items]) =>
                `<h5>${type}</h5><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`,
            )
            .join("")}`,
      )
      .join(
        "",
      )}<button class="st-more" data-st-toast="Shows every update">View all updates</button></div>`;
  else if (sec.usage) {
    const bars = [30, 45, 38, 60, 52, 70, 42, 65, 80, 58, 74, 90, 66, 84]
      .map((h) => `<span style="height:${h}%"></span>`)
      .join("");
    body = `<div class="st-tabs" role="tablist">${["Overview", "Activity"].map((t) => `<button role="tab" aria-selected="${ST.usageTab === t}" data-st-usage="${t}">${t}</button>`).join("")}</div>
      <div class="st-filters">${[
        ["Last 30 days", "Last 7 days,Last 30 days,Last 90 days"],
        ["All apps", "All apps,Design,Content,Slides"],
        ["Everyone", "Everyone,Just you"],
      ]
        .map(
          ([v, o]) =>
            `<button class="st-sel" style="min-width:0" data-st-sel="u:${v}" data-opts="${o}"><span>${ST["sel:u:" + v] || v}</span>${ic("chevron-down", "s14")}</button>`,
        )
        .join("")}</div>
      ${
        ST.usageTab === "Overview"
          ? `<div class="st-metrics">${[
              ["Estimated spend", "$42.10"],
              ["Calls", "1,284"],
              ["Tokens", "3.2M"],
              ["Active people", "3"],
            ]
              .map(
                ([l, v]) =>
                  `<div class="st-metric"><small>${l}</small><b>${v}</b></div>`,
              )
              .join("")}</div>
      <div class="st-sec"><div class="st-sec-h">Usage history<span class="grow"></span></div><div class="st-card"><div class="st-chart">${bars}</div></div></div>
      <div class="st-sec"><div class="st-sec-h">Top chats</div><div class="st-card">${KIT_ST.topChats.map(([t, n]) => `<div class="st-row"><span class="lt"><b>${t}</b></span><span class="rt muted">${n}</span></div>`).join("")}</div></div>`
          : `<div class="st-sec"><div class="st-sec-h">Tool calls</div><div class="st-card"><div class="st-chart">${bars}</div></div></div><div class="st-sec"><div class="st-sec-h">Model calls</div><div class="st-card"><div class="st-chart">${bars}</div></div></div>`
      }`;
  }
  return `<section class="st-sec">${head}${body}</section>`;
}
function renderSettings() {
  const el = stEl(),
    p = stPage(ST.page);
  if (p.id === "whats-new") ST.seen = true;
  const q = ST.q.trim().toLowerCase();
  const nav = q
    ? (() => {
        const hits = stIndex()
          .filter((h) => h.label.toLowerCase().includes(q))
          .slice(0, 12);
        return hits.length
          ? `<div role="listbox" aria-label="Search results" style="margin-top:8px">${hits.map((h, i) => `<button class="st-hit" role="option" aria-selected="${i === 0}" data-st-go="${h.page}" ${h.key ? `data-st-flash="${h.key}"` : ""}>${ic(h.icon, "s16")}<span>${h.label}<small>${h.where}</small></span></button>`).join("")}</div>`
          : `<p class="muted" style="padding:8px">No matching settings</p>`;
      })()
    : SETTINGS.groups
        .map(([g, label]) => {
          const items = stPages().filter((x) => x.g === g);
          return items.length
            ? `<div class="st-glabel">${label}</div>${items.map((x) => `<button class="st-item" data-st-go="${x.id}" aria-current="${x.id === ST.page ? "page" : "false"}">${ic(x.icon)}<span>${x.l}</span>${x.dot && !ST.seen ? `<span class="dot" aria-label="New"></span>` : ""}</button>`).join("")}`
            : "";
        })
        .join("");
  el.innerHTML = `<nav class="st-rail" aria-label="Settings">
      <button class="st-back" id="st-back">${ic("arrow-left", "s16")}Back to ${KIT_ST.app}</button>
      <label class="st-search">${ic("search", "s14")}<input id="st-q" type="search" placeholder="Search settings" aria-label="Search settings" value="${ST.q.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" autocomplete="off">${ST.q ? `<button class="icon-btn xs" id="st-clear" aria-label="Clear search">${ic("x", "s12")}</button>` : `<span class="kbd">/</span>`}</label>
      ${nav}
    </nav>
    <main class="st-main"><button class="icon-btn st-agent" title="Agent" data-st-toast="Opens the agent panel">${ic("sparkles")}</button>
      <div class="st-col"><header class="st-head"><span>${p.l}</span>${p.badge ? `<span class="badge" ${p.badge === KIT_ST.app ? `title="Updates to ${KIT_ST.app}. Each app has its own changelog."` : ""}>${p.badge}</span>` : ""}<span class="grow"></span>${p.act ? `<button class="st-btn" data-st-toast="${p.act}">${p.act}</button>` : ""}</header>
      ${p.sections.map(stSection).join("")}</div></main>`;
  if (ST.focusQ) {
    ST.focusQ = false;
    const i = $("#st-q");
    i.focus();
    i.setSelectionRange(i.value.length, i.value.length);
  }
}
document.addEventListener("click", (e) => {
  if (!e.target.closest?.("#settings")) return;
  const t = e.target;
  if (t.closest("#st-back")) return closeSettings();
  if (t.closest("#st-clear")) {
    ST.q = "";
    ST.focusQ = true;
    return renderSettings();
  }
  const go = t.closest("[data-st-go]");
  if (go) {
    const flash = go.dataset.stFlash;
    ST.page = go.dataset.stGo;
    ST.q = "";
    renderSettings();
    $("#settings .st-main").scrollTop = 0;
    if (flash)
      requestAnimationFrame(() => {
        const r = $(`#settings [data-key="${CSS.escape(flash)}"]`);
        if (r) {
          r.scrollIntoView({ block: "center" });
          r.classList.add("flash");
        }
      });
    return;
  }
  const sw = t.closest("[data-st-sw]");
  if (sw) {
    const on = sw.getAttribute("aria-checked") !== "true",
      lab = sw.dataset.lab;
    if (lab) KIT_ST.labs.set(lab, on);
    else ST[`sw:${ST.page}:${sw.dataset.stSw}`] = on;
    return renderSettings();
  }
  const sel = t.closest("[data-st-sel]");
  if (sel) {
    const key = sel.dataset.stSel,
      row = stPage(ST.page)
        .sections.flatMap((s) => s.rows || [])
        .find((r) => r.l === key);
    const opts = sel.dataset.opts ? sel.dataset.opts.split(",") : row.c.opts,
      cur = sel.querySelector("span").textContent;
    return openMenu(
      sel,
      opts.map((o) => ({
        t: o,
        radio: true,
        on: o === cur,
        run: () => {
          ST[row ? `sel:${ST.page}:${key}` : "sel:" + key] = o;
          renderSettings();
        },
      })),
      { align: "right" },
    );
  }
  const host = t.closest("[data-st-host]");
  if (host) {
    ST.host = host.dataset.stHost;
    return renderSettings();
  }
  const ut = t.closest("[data-st-usage]");
  if (ut) {
    ST.usageTab = ut.dataset.stUsage;
    return renderSettings();
  }
  const cp = t.closest("[data-st-copy]");
  if (cp) return copyText(cp.dataset.stCopy, "Copied");
  const ts = t.closest("[data-st-toast]");
  if (ts) return toast(ts.dataset.stToast);
});
document.addEventListener("input", (e) => {
  if (e.target.id === "st-q") {
    ST.q = e.target.value;
    ST.focusQ = true;
    renderSettings();
  }
});
document.addEventListener(
  "keydown",
  (e) => {
    const open = !stEl().hidden;
    if ((e.metaKey || e.ctrlKey) && e.key === ",") {
      e.preventDefault();
      if (!open) openSettings("profile");
      return;
    }
    if (!open) return;
    if (e.target.id === "st-q") {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        ST.q = "";
        ST.focusQ = true;
        renderSettings();
      }
      if (e.key === "Enter") {
        const h = $("#settings .st-hit");
        if (h) h.click();
      }
      return;
    }
    if (e.key === "/" && !e.target.closest?.("input, textarea")) {
      e.preventDefault();
      $("#st-q").focus();
    }
  },
  true,
);
