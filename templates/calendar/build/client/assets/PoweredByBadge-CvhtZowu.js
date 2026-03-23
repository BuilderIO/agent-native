import { r, j as t } from "./index-Coy-XKTg.js";
const _ = {},
  w = "cf-turnstile-script",
  x =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__turnstileOnLoad";
let a = null;
function y() {
  return (
    a ||
    (window.turnstile
      ? Promise.resolve()
      : ((a = new Promise((n) => {
          window.__turnstileOnLoad = () => {
            (n(), delete window.__turnstileOnLoad);
          };
          const e = document.createElement("script");
          ((e.id = w),
            (e.src = x),
            (e.async = !0),
            (e.defer = !0),
            document.head.appendChild(e));
        })),
        a))
  );
}
function I({
  siteKey: n,
  onVerify: e,
  onExpire: l,
  mode: c = "managed",
  className: g,
}) {
  const o =
      n || (typeof import.meta < "u" ? _?.VITE_TURNSTILE_SITE_KEY : void 0),
    s = r.useRef(null),
    i = r.useRef(null),
    [d, b] = r.useState(!1),
    u = r.useRef(e);
  u.current = e;
  const p = r.useRef(l);
  ((p.current = l),
    r.useEffect(() => {
      o && y().then(() => b(!0));
    }, [o]));
  const f = r.useCallback(() => {
    !d ||
      !o ||
      !s.current ||
      !window.turnstile ||
      i.current ||
      (i.current = window.turnstile.render(s.current, {
        sitekey: o,
        appearance: c === "invisible" ? "interaction-only" : "managed",
        callback: (h) => u.current(h),
        "expired-callback": () => p.current?.(),
      }));
  }, [d, o, c]);
  return (
    r.useEffect(
      () => (
        f(),
        () => {
          i.current &&
            window.turnstile &&
            (window.turnstile.remove(i.current), (i.current = null));
        }
      ),
      [f],
    ),
    o ? t.jsx("div", { ref: s, className: g }) : null
  );
}
const k = {},
  v = (n) => ({
    position: "fixed",
    bottom: 16,
    ...(n === "bottom-right" ? { right: 16 } : { left: 16 }),
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    borderRadius: 8,
    fontSize: 12,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontWeight: 500,
    lineHeight: 1,
    color: "rgba(150, 150, 150, 0.9)",
    background: "rgba(0, 0, 0, 0.05)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    border: "1px solid rgba(0, 0, 0, 0.06)",
    textDecoration: "none",
    transition: "opacity 0.2s, color 0.2s",
    opacity: 0.7,
  }),
  m = "(prefers-color-scheme: dark)";
function j({ position: n = "bottom-right" }) {
  return typeof import.meta < "u" && k?.VITE_HIDE_BRANDING === "true"
    ? null
    : t.jsxs(t.Fragment, {
        children: [
          t.jsx("style", {
            children: `
        @media ${m} {
          .an-powered-badge {
            background: rgba(255, 255, 255, 0.06) !important;
            border-color: rgba(255, 255, 255, 0.08) !important;
            color: rgba(180, 180, 180, 0.9) !important;
          }
        }
        .an-powered-badge:hover {
          opacity: 1 !important;
          color: rgba(100, 100, 100, 1) !important;
        }
        @media ${m} {
          .an-powered-badge:hover {
            color: rgba(220, 220, 220, 1) !important;
          }
        }
      `,
          }),
          t.jsxs("a", {
            href: "https://agent-native.com",
            target: "_blank",
            rel: "noopener noreferrer",
            className: "an-powered-badge",
            style: v(n),
            children: [
              t.jsxs("svg", {
                width: "14",
                height: "14",
                viewBox: "0 0 24 24",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: "2",
                strokeLinecap: "round",
                strokeLinejoin: "round",
                children: [
                  t.jsx("path", { d: "M12 2L2 7l10 5 10-5-10-5z" }),
                  t.jsx("path", { d: "M2 17l10 5 10-5" }),
                  t.jsx("path", { d: "M2 12l10 5 10-5" }),
                ],
              }),
              "Built with Agent Native",
            ],
          }),
        ],
      });
}
export { j as P, I as T };
