// The Changes drawer, shared by every prototype. The build strips the types and inlines this
// as a classic script, so these declarations become page globals: no imports or exports.
// A prototype calls kitChangesInit(button) once, and the button toggles the drawer.

interface KitChange {
  date: string;
  text: string;
}

declare const KIT_CHANGES: KitChange[];

// Keyed by title, so prototypes opened from local files on one origin keep separate marks.
const KIT_SEEN_KEY = `kit-changes-seen:${document.title}`;

// Storage can be missing or throw (private windows, previews), so "never seen" is the fallback, not an error.
function kitChangesSeen(): string {
  try {
    return localStorage.getItem(KIT_SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function kitChangesInit(button: HTMLElement): void {
  button.classList.add("kit-changes-btn");
  const latest = KIT_CHANGES[0]?.date ?? "";
  if (latest > kitChangesSeen()) button.dataset.new = "";
  button.addEventListener("click", () => kitChangesToggle(button));
}

function kitChangesDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function kitChangesEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function kitChangesToggle(button: HTMLElement): void {
  const open = document.querySelector(".kit-changes");
  button.setAttribute("aria-pressed", String(!open));
  if (open) {
    open.remove();
    return;
  }
  const seen = kitChangesSeen();
  const days = new Map<string, KitChange[]>();
  for (const change of KIT_CHANGES)
    days.set(change.date, [...(days.get(change.date) ?? []), change]);
  const drawer = document.createElement("aside");
  drawer.className = "kit-changes";
  drawer.setAttribute("aria-label", "Changes");
  drawer.innerHTML = `<div class="kit-changes-h">Changes<button type="button" aria-label="Close changes"><svg class="i" viewBox="0 0 24 24"><path d="M18 6l-12 12M6 6l12 12"/></svg></button></div><div class="kit-changes-b">${[
    ...days,
  ]
    .map(
      ([date, list]) =>
        `<section><h4>${kitChangesDate(date)}</h4><ul>${list.map((c) => `<li class="${date > seen ? "new" : ""}">${kitChangesEscape(c.text)}</li>`).join("")}</ul></section>`,
    )
    .join("")}</div>`;
  drawer
    .querySelector("button")
    ?.addEventListener("click", () => kitChangesToggle(button));
  document.body.append(drawer);
  // Remembering the mark is a convenience; without storage every entry just stays marked new.
  try {
    localStorage.setItem(KIT_SEEN_KEY, KIT_CHANGES[0]?.date ?? "");
  } catch {
    // Storage unavailable.
  }
  delete button.dataset.new;
}
