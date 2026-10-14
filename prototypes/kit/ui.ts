// Shared helpers for every prototype: icons, $, menus (with submenus that flip at the window edge), and toasts.
// The build strips the types and inlines this as a classic script before the prototype's own, so these
// declarations are page globals the prototype calls directly.

declare const KIT_ICONS: Record<string, string>;
const ICONS = KIT_ICONS;
const ic = (n, cls = "") =>
  `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ""}</svg>`;
const $ = (s, r = document) => r.querySelector(s);

// Menus
let closeMenu = null;
// items: "-" | {label} | {search} | {field} | {t, icon, k, title (tooltip), run, toast, danger, disabled, toggle:bool (checkbox: stays open), radio:bool (one choice: closes), on:bool, sub:[items]}
function menuEl(items, depth) {
  const m = document.createElement("div");
  m.className = "menu";
  m.setAttribute("role", "menu");
  m.dataset.depth = depth;
  const hasCk = items.some((it) => it && (it.toggle || it.radio));
  m.innerHTML = items
    .map((it, i) =>
      it === "-"
        ? "<hr>"
        : it.label
          ? `<div class="lbl">${it.label}</div>`
          : it.search
            ? `<label class="search">${ic("search", "s14")}<input placeholder="${it.search}" aria-label="${it.search}"><span class="kbd" style="padding:0">${it.k || ""}</span></label>`
            : it.field
              ? `<div class="field-row"><input value="${it.field}" aria-label="Zoom level"></div>`
              : `<button role="${it.toggle ? "menuitemcheckbox" : it.radio ? "menuitemradio" : "menuitem"}" ${it.toggle || it.radio ? `aria-checked="${!!it.on}"` : ""} class="${it.danger ? "danger" : ""} ${it.desc ? "two" : ""}" ${it.title ? `title="${it.title}"` : ""} data-i="${i}" ${it.disabled ? "disabled" : ""} ${it.sub ? 'aria-haspopup="menu"' : ""}>${hasCk ? `<span class="ck">${it.on ? ic("check", "s14") : ""}</span>` : ""}${it.img ? `<img class="mi-img" src="${it.img}" alt="">` : it.icon ? ic(it.icon) : ""}${it.desc ? `<span class="tt"><span>${it.t}</span><small>${it.desc}</small></span>` : `<span>${it.t}</span>`}${it.sub ? `<span class="sub">${ic(it.subIcon || "chevron-right", "s14")}</span>` : it.k ? `<span class="kbd">${it.k}</span>` : ""}</button>`,
    )
    .join("");
  return m;
}
// Keep a menu inside the window: past the viewport height it scrolls instead of running off the edge.
function fitMenuHeight(m) {
  m.style.maxHeight = innerHeight - 16 + "px";
  m.style.overflowY = m.scrollHeight > innerHeight - 16 ? "auto" : "";
}
// A submenu opens beside its row: to the right of the parent menu when it fits, otherwise flipped to its left.
// Vertically it starts level with the row and slides up only as far as it must to stay on screen.
function placeSubmenu(sm, row, parent) {
  fitMenuHeight(sm);
  const w = sm.offsetWidth,
    h = sm.offsetHeight,
    gap = 2;
  const right = parent.right + gap,
    left = parent.left - gap - w;
  sm.style.left =
    (right + w <= innerWidth - 8 || left < 8
      ? Math.min(right, innerWidth - w - 8)
      : left) + "px";
  sm.style.top = Math.max(8, Math.min(row.top - 5, innerHeight - h - 8)) + "px";
}
function openMenu(
  anchor,
  items,
  {
    align = "left",
    above = false,
    aboveOf = null,
    offset = 4,
    minWidth = 0,
    at = null,
  } = {},
) {
  closeMenu?.();
  const r = anchor.getBoundingClientRect();
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  const stack = [];
  const close = () => {
    scrim.remove();
    stack.forEach((x) => x.remove());
    anchor.setAttribute("aria-expanded", "false");
    closeMenu = null;
    document.removeEventListener("keydown", esc);
  };
  // An item's keys fire it while its menu is open, like Detach token on ⌫.
  const esc = (e) => {
    if (e.key === "Escape") {
      close();
      anchor.focus();
      return;
    }
    const it = items.find((x) => x && x.keys?.includes(e.key) && !x.disabled);
    if (it) {
      e.preventDefault();
      close();
      anchor.focus();
      it.run();
    }
  };
  const mount = (list, depth, place) => {
    stack.splice(depth).forEach((x) => x.remove());
    const m = menuEl(list, depth);
    document.body.append(m);
    stack[depth] = m;
    place(m);
    m.addEventListener("mouseover", (e) => {
      const b = e.target.closest("[data-i]");
      if (!b || b.parentElement !== m) return;
      const it = list[+b.dataset.i];
      m.querySelectorAll("button.open").forEach(
        (x) => x !== b && x.classList.remove("open"),
      );
      if (it.sub) {
        b.classList.add("open");
        const br = b.getBoundingClientRect();
        mount(it.sub, depth + 1, (sm) =>
          placeSubmenu(sm, br, m.getBoundingClientRect()),
        );
      } else stack.splice(depth + 1).forEach((x) => x.remove());
    });
    m.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (!b) return;
      const it = list[+b.dataset.i];
      if (it.disabled || (it.sub && !it.run)) return;
      if (it.toggle) {
        it.on = !it.on;
        it.run?.(it.on);
        b.setAttribute("aria-checked", it.on);
        b.querySelector(".ck").innerHTML = it.on ? ic("check", "s14") : "";
        return;
      }
      close();
      it.run ? it.run() : toast(it.toast || it.t);
    });
    return m;
  };
  document.body.append(scrim);
  mount(items, 0, (m) => {
    if (minWidth) m.style.minWidth = minWidth + "px";
    fitMenuHeight(m);
    const mw = m.offsetWidth,
      mh = m.offsetHeight;
    if (at) {
      m.style.left = Math.min(at.x, innerWidth - mw - 8) + "px";
      m.style.top = Math.min(at.y, innerHeight - mh - 8) + "px";
      return;
    }
    // Menus above their control anchor by the bottom edge, so a height change (font load, async rows) can't detach them.
    if (aboveOf || above)
      m.style.bottom =
        innerHeight -
        (aboveOf ? aboveOf.getBoundingClientRect().top : r.top) +
        offset +
        "px";
    // Below the control when it fits; otherwise above it, or pinned to the bottom edge if neither side has room.
    else if (r.bottom + offset + mh <= innerHeight - 8)
      m.style.top = r.bottom + offset + "px";
    else if (r.top - offset - mh >= 8) m.style.top = r.top - offset - mh + "px";
    else m.style.top = Math.max(8, innerHeight - mh - 8) + "px";
    m.style.left =
      Math.max(
        8,
        Math.min(
          innerWidth - mw - 8,
          align === "right" ? r.right - mw : r.left,
        ),
      ) + "px";
  });
  anchor.setAttribute("aria-expanded", "true");
  document.addEventListener("keydown", esc);
  scrim.onclick = close;
  closeMenu = close;
}
function toast(t) {
  document.querySelector(".toast")?.remove();
  const d = document.createElement("div");
  d.className = "toast";
  d.textContent = t;
  d.setAttribute("role", "status");
  document.body.append(d);
  setTimeout(() => d.remove(), 2200);
}

// Copy text and confirm with a toast; the toast shows even where the clipboard is refused.
function copyText(text, msg) {
  (navigator.clipboard?.writeText(text) || Promise.reject()).then(
    () => toast(msg),
    () => toast("Couldn't copy."),
  );
}
