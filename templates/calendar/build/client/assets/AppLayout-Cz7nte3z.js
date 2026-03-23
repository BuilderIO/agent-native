const __vite__mapDeps = (
  i,
  m = __vite__mapDeps,
  d = m.f ||
    (m.f = [
      "assets/index-BclDojxT.js",
      "assets/index-qtsL5YWk.js",
      "assets/index-Coy-XKTg.js",
      "assets/ErrorBoundary-0h_wKUpp.js",
      "assets/ThemeToggle-BdGywd2Y.js",
      "assets/PoweredByBadge-CvhtZowu.js",
    ]),
) => i.map((i) => d[i]);
import { r as h, y as E, j as e, z as _ } from "./index-Coy-XKTg.js";
import {
  b as x,
  u as v,
  a as q,
  H as k,
  c as p,
  T as A,
  v as g,
  E as y,
  w as L,
  x as O,
  y as D,
  A as U,
  s as b,
  C as F,
  D as P,
  G as T,
  F as $,
  B as w,
} from "./ThemeToggle-BdGywd2Y.js";
import { u as N } from "./index-qtsL5YWk.js";
const G = [["path", { d: "m6 9 6 6 6-6", key: "qrunsl" }]],
  z = x("chevron-down", G);
const R = [["path", { d: "m18 15-6-6-6 6", key: "153udz" }]],
  W = x("chevron-up", R);
const B = [
    ["path", { d: "M12 6v6l4 2", key: "mmk7yg" }],
    ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ],
  I = x("clock", B);
const K = [
    ["path", { d: "M15 3h6v6", key: "1q9fwt" }],
    ["path", { d: "M10 14 21 3", key: "gplh6r" }],
    [
      "path",
      {
        d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
        key: "a6xqqp",
      },
    ],
  ],
  Q = x("external-link", K);
const H = [
    ["path", { d: "M4 12h16", key: "1lakjw" }],
    ["path", { d: "M4 18h16", key: "19g7jn" }],
    ["path", { d: "M4 6h16", key: "1o0s65" }],
  ],
  V = x("menu", H);
const J = [
    [
      "path",
      {
        d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",
        key: "1i5ecw",
      },
    ],
    ["circle", { cx: "12", cy: "12", r: "3", key: "1v7zrd" }],
  ],
  X = x("settings", J);
const Y = [
    ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", key: "1yyitq" }],
    ["path", { d: "M16 3.128a4 4 0 0 1 0 7.744", key: "16gr8j" }],
    ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87", key: "kshegd" }],
    ["circle", { cx: "9", cy: "7", r: "4", key: "nufk8" }],
  ],
  Z = x("users", Y),
  ee = "modulepreload",
  te = function (s) {
    return "/" + s;
  },
  j = {},
  se = function (a, t, l) {
    let i = Promise.resolve();
    if (t && t.length > 0) {
      let d = function (o) {
        return Promise.all(
          o.map((m) =>
            Promise.resolve(m).then(
              (u) => ({ status: "fulfilled", value: u }),
              (u) => ({ status: "rejected", reason: u }),
            ),
          ),
        );
      };
      document.getElementsByTagName("link");
      const r = document.querySelector("meta[property=csp-nonce]"),
        n = r?.nonce || r?.getAttribute("nonce");
      i = d(
        t.map((o) => {
          if (((o = te(o)), o in j)) return;
          j[o] = !0;
          const m = o.endsWith(".css"),
            u = m ? '[rel="stylesheet"]' : "";
          if (document.querySelector(`link[href="${o}"]${u}`)) return;
          const f = document.createElement("link");
          if (
            ((f.rel = m ? "stylesheet" : ee),
            m || (f.as = "script"),
            (f.crossOrigin = ""),
            (f.href = o),
            n && f.setAttribute("nonce", n),
            document.head.appendChild(f),
            m)
          )
            return new Promise((S, M) => {
              (f.addEventListener("load", S),
                f.addEventListener("error", () =>
                  M(new Error(`Unable to preload CSS for ${o}`)),
                ));
            });
        }),
      );
    }
    function c(r) {
      const n = new Event("vite:preloadError", { cancelable: !0 });
      if (((n.payload = r), window.dispatchEvent(n), !n.defaultPrevented))
        throw r;
    }
    return i.then((r) => {
      for (const n of r || []) n.status === "rejected" && c(n.reason);
      return a().catch(c);
    });
  };
function ne() {
  return v({
    queryKey: ["google-status"],
    queryFn: async () => {
      const s = await fetch("/api/google/status");
      if (!s.ok) throw new Error("Failed to fetch Google auth status");
      return s.json();
    },
  });
}
function re(s = !1) {
  const a = N(),
    t = v({
      queryKey: ["google-auth-url"],
      queryFn: async () => {
        const { getCallbackOrigin: l } = await se(
            async () => {
              const { getCallbackOrigin: c } =
                await import("./index-BclDojxT.js");
              return { getCallbackOrigin: c };
            },
            __vite__mapDeps([0, 1, 2, 3, 4, 5]),
          ),
          i = await fetch(
            `/api/google/auth-url?redirect_uri=${encodeURIComponent(l() + "/api/google/callback")}`,
          );
        if (!i.ok) {
          const c = await i.json().catch(() => ({}));
          throw new Error(c.message || c.error || "Failed to get auth URL");
        }
        return i.json();
      },
      enabled: s,
      retry: !1,
    });
  return (
    h.useEffect(() => {
      !s && t.isError && a.resetQueries({ queryKey: ["google-auth-url"] });
    }, [s, t.isError, a]),
    t
  );
}
function me() {
  const s = N();
  return q({
    mutationFn: async (a) => {
      const t = await fetch("/api/google/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: a }),
      });
      if (!t.ok) throw new Error("Failed to disconnect Google");
      return t.json();
    },
    onSuccess: () => {
      s.invalidateQueries({ queryKey: ["google-status"] });
    },
  });
}
const oe = [
  { path: "/", label: "Calendar", icon: k },
  { path: "/availability", label: "Availability", icon: I },
  { path: "/bookings", label: "Bookings", icon: Z },
  { path: "/settings", label: "Settings", icon: X },
];
function ae({ selectedDate: s, onDateSelect: a }) {
  const [t, l] = h.useState(() => g(s));
  h.useEffect(() => {
    y(t, s) || l(g(s));
  }, [s]);
  const i = h.useMemo(() => {
      const r = g(t),
        n = L(t),
        d = O(r),
        o = D(n),
        m = [];
      let u = d;
      for (; u <= o; ) (m.push(u), (u = U(u, 1)));
      return m;
    }, [t]),
    c = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  return e.jsxs("div", {
    className: "px-3 py-3",
    children: [
      e.jsxs("div", {
        className: "mb-2 flex items-center justify-between",
        children: [
          e.jsx("span", {
            className: "text-xs font-medium text-foreground",
            children: b(t, "MMMM yyyy"),
          }),
          e.jsxs("div", {
            className: "flex items-center gap-0.5",
            children: [
              e.jsx("button", {
                type: "button",
                onClick: () => l(F(t, 1)),
                className:
                  "flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground",
                children: e.jsx(W, { className: "h-3 w-3" }),
              }),
              e.jsx("button", {
                type: "button",
                onClick: () => l(P(t, 1)),
                className:
                  "flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground",
                children: e.jsx(z, { className: "h-3 w-3" }),
              }),
            ],
          }),
        ],
      }),
      e.jsx("div", {
        className: "mb-0.5 grid grid-cols-7",
        children: c.map((r) =>
          e.jsx(
            "div",
            {
              className:
                "flex h-6 items-center justify-center text-[10px] font-medium text-muted-foreground",
              children: r,
            },
            r,
          ),
        ),
      }),
      e.jsx("div", {
        className: "grid grid-cols-7",
        children: i.map((r) => {
          const n = y(r, t),
            d = T(r),
            o = $(r, s);
          return e.jsx(
            "button",
            {
              type: "button",
              onClick: () => a(r),
              className: p(
                "flex h-6 w-full items-center justify-center rounded-full text-[11px] transition-colors",
                !n && "text-muted-foreground/40",
                n && !d && !o && "text-foreground/80 hover:bg-accent",
                d && !o && "bg-primary font-semibold text-primary-foreground",
                o && !d && "ring-1 ring-primary font-semibold text-primary",
                o &&
                  d &&
                  "bg-primary font-semibold text-primary-foreground ring-1 ring-primary ring-offset-1 ring-offset-card",
              ),
              children: b(r, "d"),
            },
            r.toISOString(),
          );
        }),
      }),
    ],
  });
}
function ce() {
  const [s, a] = h.useState(!1),
    t = re(s);
  return (
    h.useEffect(() => {
      t.data?.url && (window.open(t.data.url, "_blank"), a(!1));
    }, [t.data]),
    e.jsx("div", {
      className: "border-t border-border p-3",
      children: e.jsxs("div", {
        className: "rounded-lg bg-primary/10 p-3",
        children: [
          e.jsx("p", {
            className: "mb-1 text-xs font-semibold text-foreground",
            children: "Connect Google Calendar",
          }),
          e.jsx("p", {
            className:
              "mb-2.5 text-[11px] leading-relaxed text-muted-foreground",
            children: "Sync your events and manage everything in one place.",
          }),
          e.jsxs(w, {
            size: "sm",
            className: "w-full gap-1.5 text-xs font-semibold",
            onClick: () => a(!0),
            disabled: t.isLoading || t.isFetching,
            children: [
              e.jsx(Q, { className: "h-3 w-3" }),
              t.isLoading ? "Connecting..." : "Connect",
            ],
          }),
        ],
      }),
    })
  );
}
function ie({ open: s, onClose: a }) {
  const t = E(),
    { selectedDate: l, setSelectedDate: i } = le(),
    c = ne(),
    r = c.data?.connected ?? !1;
  return e.jsxs(e.Fragment, {
    children: [
      s &&
        e.jsx("div", {
          className:
            "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden",
          onClick: a,
        }),
      e.jsxs("aside", {
        className: p(
          "fixed left-0 top-0 z-50 flex h-full w-56 flex-col border-r border-border bg-card transition-transform duration-200 lg:static lg:translate-x-0",
          s ? "translate-x-0" : "-translate-x-full",
        ),
        children: [
          e.jsxs("div", {
            className:
              "flex h-14 items-center gap-2.5 border-b border-border px-4",
            children: [
              e.jsx("div", {
                className:
                  "flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20",
                children: e.jsx(k, { className: "h-4 w-4 text-primary" }),
              }),
              e.jsx("span", {
                className: "text-base font-semibold tracking-tight",
                children: "Calendar",
              }),
            ],
          }),
          e.jsx(ae, { selectedDate: l, onDateSelect: i }),
          e.jsx("nav", {
            className: "flex-1 space-y-0.5 border-t border-border p-2.5",
            children: oe.map((n) => {
              const d =
                n.path === "/"
                  ? t.pathname === "/"
                  : t.pathname.startsWith(n.path);
              return e.jsxs(
                _,
                {
                  to: n.path,
                  onClick: a,
                  className: p(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    d
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  ),
                  children: [e.jsx(n.icon, { className: "h-4 w-4" }), n.label],
                },
                n.path,
              );
            }),
          }),
          !c.isLoading && !r && e.jsx(ce, {}),
          r &&
            c.data?.accounts?.length > 0 &&
            e.jsx("div", {
              className: "border-t border-border px-3 py-3",
              children: c.data.accounts.map((n) =>
                e.jsxs(
                  "div",
                  {
                    className: "flex items-center gap-2",
                    children: [
                      e.jsx("div", {
                        className: "h-2 w-2 rounded-full bg-foreground/40",
                      }),
                      e.jsx("p", {
                        className: "truncate text-xs text-muted-foreground",
                        children: n.email,
                      }),
                    ],
                  },
                  n.email,
                ),
              ),
            }),
          e.jsx("div", {
            className: "border-t border-border px-3 py-2 flex items-center",
            children: e.jsx(A, {}),
          }),
        ],
      }),
    ],
  });
}
const C = h.createContext({
  selectedDate: new Date(),
  setSelectedDate: () => {},
});
function le() {
  return h.useContext(C);
}
function fe({ children: s }) {
  const [a, t] = h.useState(!1),
    [l, i] = h.useState(new Date());
  return e.jsx(C.Provider, {
    value: { selectedDate: l, setSelectedDate: i },
    children: e.jsxs("div", {
      className: "flex h-screen overflow-hidden bg-background",
      children: [
        e.jsx(ie, { open: a, onClose: () => t(!1) }),
        e.jsxs("div", {
          className: "flex flex-1 flex-col overflow-hidden",
          children: [
            e.jsxs("div", {
              className:
                "flex h-12 items-center border-b border-border px-3 lg:hidden",
              children: [
                e.jsx(w, {
                  variant: "ghost",
                  size: "icon",
                  className: "h-8 w-8",
                  onClick: () => t(!0),
                  children: e.jsx(V, { className: "h-4 w-4" }),
                }),
                e.jsx("span", {
                  className: "ml-2 text-sm font-semibold",
                  children: "Calendar",
                }),
              ],
            }),
            e.jsx("main", { className: "flex-1 overflow-hidden", children: s }),
          ],
        }),
      ],
    }),
  });
}
export {
  fe as A,
  I as C,
  Q as E,
  me as a,
  re as b,
  W as c,
  le as d,
  z as e,
  ne as u,
};
