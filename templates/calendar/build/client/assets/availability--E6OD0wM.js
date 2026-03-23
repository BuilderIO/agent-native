import { r as n, j as e, w as I, t as O } from "./index-Coy-XKTg.js";
import { u as H, a as $, b as q, B as P } from "./ThemeToggle-BdGywd2Y.js";
import { I as y, L as N } from "./label-D00ruOVY.js";
import { X as K, S as Q } from "./x-BNH3awf2.js";
import { C as U, a as R, b as B, c as F, d as M } from "./card-Cl7QrxUz.js";
import { u as G, a as L } from "./index-qtsL5YWk.js";
import { C as V } from "./chevron-right-Cmt4MKwM.js";
import { C as J, L as W } from "./loader-circle-D21yW67Y.js";
import { A as Y } from "./AppLayout-Cz7nte3z.js";
function X() {
  return H({
    queryKey: ["availability"],
    queryFn: async () => {
      const a = await fetch("/api/availability");
      if (!a.ok) throw new Error("Failed to fetch availability");
      return a.json();
    },
  });
}
function Z() {
  const a = G();
  return $({
    mutationFn: async (l) => {
      const o = await fetch("/api/availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(l),
      });
      if (!o.ok) throw new Error("Failed to update availability");
      return o.json();
    },
    onSuccess: () => {
      a.invalidateQueries({ queryKey: ["availability"] });
    },
  });
}
function ee() {
  const { data: a, isLoading: l } = H({
      queryKey: ["env-status"],
      queryFn: async () => {
        const c = await fetch("/api/env-status");
        if (!c.ok) throw new Error("Failed to fetch env status");
        return c.json();
      },
      staleTime: 3e4,
    }),
    r = a?.find((c) => c.key === "DATABASE_URL")?.configured ?? !1;
  return { configured: r, isLocal: !r, isLoading: l };
}
const te = [
    [
      "path",
      {
        d: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z",
        key: "p7xjir",
      },
    ],
  ],
  se = q("cloud", te);
const ae = [
    ["ellipse", { cx: "12", cy: "5", rx: "9", ry: "3", key: "msslwz" }],
    ["path", { d: "M3 5V19A9 3 0 0 0 21 19V5", key: "1wlel7" }],
    ["path", { d: "M3 12A9 3 0 0 0 21 12", key: "mv7ke4" }],
  ],
  ne = q("database", ae),
  _ = [
    {
      id: "turso",
      name: "Turso",
      description: "SQLite at the edge",
      urlPrefix: "libsql://",
      needsAuthToken: !0,
      steps: [
        "Install CLI: curl -sSfL https://get.tur.so/install.sh | bash",
        "Login: turso auth login",
        "Create DB: turso db create my-app",
        "Get URL: turso db show my-app --url",
        "Get token: turso db tokens create my-app",
      ],
    },
    {
      id: "neon",
      name: "Neon",
      description: "Serverless Postgres",
      urlPrefix: "postgres://",
      needsAuthToken: !1,
      steps: [
        "Create project at neon.tech",
        "Copy connection string from dashboard",
      ],
    },
    {
      id: "supabase",
      name: "Supabase",
      description: "Open source Firebase alternative",
      urlPrefix: "postgres://",
      needsAuthToken: !1,
      steps: [
        "Create project at supabase.com",
        "Go to Settings > Database > Connection string",
        "Copy the URI connection string",
      ],
    },
    {
      id: "d1",
      name: "Cloudflare D1",
      description: "SQLite on Cloudflare's edge",
      urlPrefix: "d1://",
      needsAuthToken: !0,
      steps: [
        "Create D1 database in Cloudflare dashboard",
        "Copy database ID and API token",
      ],
    },
  ];
function re({
  title: a = "Share Publicly",
  description: l = "To share content publicly, connect a cloud database.",
  onClose: o,
}) {
  const [r, c] = n.useState(null),
    [u, z] = n.useState(""),
    [h, A] = n.useState(""),
    [d, m] = n.useState("idle"),
    [w, b] = n.useState(""),
    p = n.useRef(!1),
    i = _.find((s) => s.id === r),
    E = n.useCallback(async () => {
      if (!p.current) {
        if (((p.current = !0), !u.trim())) {
          (b("Database URL is required"), m("error"), (p.current = !1));
          return;
        }
        try {
          (m("saving"), b(""));
          const s = [{ key: "DATABASE_URL", value: u.trim() }];
          h.trim() && s.push({ key: "DATABASE_AUTH_TOKEN", value: h.trim() });
          const f = await fetch("/api/env-vars", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vars: s }),
          });
          if (!f.ok) {
            const g = await f.json().catch(() => ({}));
            throw new Error(g.error || "Failed to save credentials");
          }
          m("polling");
          let T = !1;
          for (let g = 0; g < 30; g++) {
            await new Promise((D) => setTimeout(D, 1e3));
            try {
              const t = await (await fetch("/api/db-health")).json();
              if (t.ok && t.local === !1) {
                T = !0;
                break;
              }
            } catch {}
          }
          if (!T)
            throw new Error(
              "Database connection failed after 30 attempts. Check your credentials.",
            );
          (m("success"),
            setTimeout(() => {
              window.location.reload();
            }, 1500));
        } catch (s) {
          (b(s instanceof Error ? s.message : "Connection failed"), m("error"));
        } finally {
          p.current = !1;
        }
      }
    }, [u, h]),
    v = d === "saving" || d === "polling";
  return e.jsxs("div", {
    className:
      "w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950",
    children: [
      e.jsxs("div", {
        className: "mb-4 flex items-start justify-between",
        children: [
          e.jsxs("div", {
            className: "flex items-center gap-2",
            children: [
              e.jsx(se, { className: "h-5 w-5 text-blue-500" }),
              e.jsx("h3", {
                className:
                  "text-lg font-semibold text-zinc-900 dark:text-zinc-100",
                children: a,
              }),
            ],
          }),
          o &&
            e.jsx("button", {
              onClick: o,
              className:
                "rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300",
              children: e.jsx(K, { className: "h-4 w-4" }),
            }),
        ],
      }),
      e.jsx("p", {
        className: "mb-5 text-sm text-zinc-500 dark:text-zinc-400",
        children: l,
      }),
      e.jsx("div", {
        className: "mb-5 grid grid-cols-2 gap-2",
        children: _.map((s) =>
          e.jsxs(
            "button",
            {
              onClick: () => c(s.id),
              className: `flex flex-col items-start rounded-lg border px-3 py-2.5 text-left transition-colors ${r === s.id ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"}`,
              children: [
                e.jsx("span", {
                  className: `text-sm font-medium ${r === s.id ? "text-blue-700 dark:text-blue-300" : "text-zinc-900 dark:text-zinc-100"}`,
                  children: s.name,
                }),
                e.jsx("span", {
                  className: "mt-0.5 text-xs text-zinc-500 dark:text-zinc-400",
                  children: s.description,
                }),
              ],
            },
            s.id,
          ),
        ),
      }),
      i &&
        e.jsxs("div", {
          className:
            "mb-5 rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900",
          children: [
            e.jsx("p", {
              className:
                "mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400",
              children: "Setup steps",
            }),
            e.jsx("ol", {
              className: "space-y-1",
              children: i.steps.map((s, f) =>
                e.jsxs(
                  "li",
                  {
                    className:
                      "flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-300",
                    children: [
                      e.jsx(V, {
                        className: "mt-0.5 h-3 w-3 shrink-0 text-zinc-400",
                      }),
                      e.jsx("span", { className: "font-mono", children: s }),
                    ],
                  },
                  f,
                ),
              ),
            }),
          ],
        }),
      e.jsxs("div", {
        className: "space-y-3",
        children: [
          e.jsxs("div", {
            children: [
              e.jsx("label", {
                className:
                  "mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300",
                children: "DATABASE_URL",
              }),
              e.jsx("input", {
                type: "text",
                placeholder: i?.urlPrefix
                  ? `${i.urlPrefix}...`
                  : "libsql://... or postgres://...",
                value: u,
                onChange: (s) => z(s.target.value),
                disabled: v,
                className:
                  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500",
              }),
            ],
          }),
          (!i || i.needsAuthToken) &&
            e.jsxs("div", {
              children: [
                e.jsxs("label", {
                  className:
                    "mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300",
                  children: [
                    "DATABASE_AUTH_TOKEN",
                    i &&
                      !i.needsAuthToken &&
                      e.jsx("span", {
                        className: "ml-1 text-zinc-400",
                        children: "(optional)",
                      }),
                  ],
                }),
                e.jsx("input", {
                  type: "password",
                  placeholder: "Auth token",
                  value: h,
                  onChange: (s) => A(s.target.value),
                  disabled: v,
                  className:
                    "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500",
                }),
              ],
            }),
        ],
      }),
      d === "error" &&
        w &&
        e.jsx("p", {
          className: "mt-3 text-xs text-red-600 dark:text-red-400",
          children: w,
        }),
      d === "success" &&
        e.jsxs("div", {
          className:
            "mt-3 flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400",
          children: [
            e.jsx(J, { className: "h-3.5 w-3.5" }),
            e.jsx("span", { children: "Connected successfully. Reloading..." }),
          ],
        }),
      e.jsx("button", {
        onClick: E,
        disabled: v || !u.trim() || d === "success",
        className:
          "mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50",
        children: v
          ? e.jsxs(e.Fragment, {
              children: [
                e.jsx(W, { className: "h-4 w-4 animate-spin" }),
                e.jsx("span", {
                  children:
                    d === "saving"
                      ? "Saving credentials..."
                      : "Testing connection...",
                }),
              ],
            })
          : e.jsxs(e.Fragment, {
              children: [
                e.jsx(ne, { className: "h-4 w-4" }),
                e.jsx("span", { children: "Test & Connect" }),
              ],
            }),
      }),
    ],
  });
}
const ie = [
    { key: "monday", label: "Monday" },
    { key: "tuesday", label: "Tuesday" },
    { key: "wednesday", label: "Wednesday" },
    { key: "thursday", label: "Thursday" },
    { key: "friday", label: "Friday" },
    { key: "saturday", label: "Saturday" },
    { key: "sunday", label: "Sunday" },
  ],
  j = { enabled: !1, slots: [{ start: "09:00", end: "17:00" }] };
function le() {
  const { data: a } = X(),
    l = Z(),
    [o, r] = n.useState({
      monday: { ...j, enabled: !0 },
      tuesday: { ...j, enabled: !0 },
      wednesday: { ...j, enabled: !0 },
      thursday: { ...j, enabled: !0 },
      friday: { ...j, enabled: !0 },
      saturday: { ...j },
      sunday: { ...j },
    }),
    [c, u] = n.useState(15),
    [z, h] = n.useState(1),
    [A, d] = n.useState(60),
    [m, w] = n.useState(30),
    [b, p] = n.useState("meeting"),
    [i, E] = n.useState("America/New_York"),
    { isLocal: v } = ee(),
    [s, f] = n.useState(!1);
  n.useEffect(() => {
    a &&
      (r(a.weeklySchedule),
      u(a.bufferMinutes),
      h(a.minNoticeHours),
      d(a.maxAdvanceDays),
      w(a.slotDurationMinutes),
      p(a.bookingPageSlug),
      E(a.timezone));
  }, [a]);
  function T(t, S) {
    r((x) => ({ ...x, [t]: { ...x[t], ...S } }));
  }
  function g(t, S, x) {
    r((k) => ({
      ...k,
      [t]: { ...k[t], slots: [{ ...k[t].slots[0], [S]: x }] },
    }));
  }
  function D() {
    l.mutate(
      {
        timezone: i,
        weeklySchedule: o,
        bufferMinutes: c,
        minNoticeHours: z,
        maxAdvanceDays: A,
        slotDurationMinutes: m,
        bookingPageSlug: b,
      },
      {
        onSuccess: () => L.success("Availability saved"),
        onError: () => L.error("Failed to save availability"),
      },
    );
  }
  return e.jsxs("div", {
    className: "mx-auto max-w-2xl space-y-6",
    children: [
      e.jsxs("div", {
        children: [
          e.jsx("h1", {
            className: "text-2xl font-semibold",
            children: "Availability",
          }),
          e.jsx("p", {
            className: "text-sm text-muted-foreground mt-1",
            children: "Set your available hours for bookings.",
          }),
        ],
      }),
      e.jsxs(U, {
        children: [
          e.jsxs(R, {
            children: [
              e.jsx(B, { className: "text-lg", children: "Weekly Schedule" }),
              e.jsx(F, { children: "Toggle days and set available hours." }),
            ],
          }),
          e.jsx(M, {
            className: "space-y-4",
            children: ie.map(({ key: t, label: S }) => {
              const x = o[t],
                k = x.slots[0] ?? { start: "09:00", end: "17:00" };
              return e.jsxs(
                "div",
                {
                  className:
                    "flex flex-wrap items-center gap-4 rounded-lg border border-border px-4 py-3",
                  children: [
                    e.jsxs("div", {
                      className: "flex items-center gap-3 w-40",
                      children: [
                        e.jsx(Q, {
                          checked: x.enabled,
                          onCheckedChange: (C) => T(t, { enabled: C }),
                        }),
                        e.jsx("span", {
                          className: "text-sm font-medium",
                          children: S,
                        }),
                      ],
                    }),
                    x.enabled
                      ? e.jsxs("div", {
                          className: "flex items-center gap-2",
                          children: [
                            e.jsx(y, {
                              type: "time",
                              value: k.start,
                              onChange: (C) => g(t, "start", C.target.value),
                              className: "w-32",
                            }),
                            e.jsx("span", {
                              className: "text-muted-foreground",
                              children: "to",
                            }),
                            e.jsx(y, {
                              type: "time",
                              value: k.end,
                              onChange: (C) => g(t, "end", C.target.value),
                              className: "w-32",
                            }),
                          ],
                        })
                      : e.jsx("span", {
                          className: "text-sm text-muted-foreground",
                          children: "Unavailable",
                        }),
                  ],
                },
                t,
              );
            }),
          }),
        ],
      }),
      e.jsxs(U, {
        children: [
          e.jsxs(R, {
            children: [
              e.jsx(B, { className: "text-lg", children: "Booking Rules" }),
              e.jsx(F, {
                children:
                  "Configure buffer time, notice periods, and slot settings.",
              }),
            ],
          }),
          e.jsxs(M, {
            className: "space-y-4",
            children: [
              e.jsxs("div", {
                className: "grid grid-cols-2 gap-4",
                children: [
                  e.jsxs("div", {
                    className: "space-y-2",
                    children: [
                      e.jsx(N, { children: "Buffer between events (min)" }),
                      e.jsx(y, {
                        type: "number",
                        value: c,
                        onChange: (t) => u(Number(t.target.value)),
                        min: 0,
                      }),
                    ],
                  }),
                  e.jsxs("div", {
                    className: "space-y-2",
                    children: [
                      e.jsx(N, { children: "Minimum notice (hours)" }),
                      e.jsx(y, {
                        type: "number",
                        value: z,
                        onChange: (t) => h(Number(t.target.value)),
                        min: 0,
                      }),
                    ],
                  }),
                  e.jsxs("div", {
                    className: "space-y-2",
                    children: [
                      e.jsx(N, { children: "Max advance booking (days)" }),
                      e.jsx(y, {
                        type: "number",
                        value: A,
                        onChange: (t) => d(Number(t.target.value)),
                        min: 1,
                      }),
                    ],
                  }),
                  e.jsxs("div", {
                    className: "space-y-2",
                    children: [
                      e.jsx(N, { children: "Slot duration (minutes)" }),
                      e.jsx(y, {
                        type: "number",
                        value: m,
                        onChange: (t) => w(Number(t.target.value)),
                        min: 5,
                      }),
                    ],
                  }),
                ],
              }),
              e.jsxs("div", {
                className: "space-y-2",
                children: [
                  e.jsx(N, { children: "Booking page slug" }),
                  e.jsxs("div", {
                    className: "flex items-center gap-2",
                    children: [
                      e.jsx("span", {
                        className: "text-sm text-muted-foreground",
                        children: "/book/",
                      }),
                      e.jsx(y, {
                        value: b,
                        onChange: (t) => p(t.target.value),
                        placeholder: "meeting",
                      }),
                    ],
                  }),
                ],
              }),
              e.jsxs("div", {
                className: "space-y-2",
                children: [
                  e.jsx(N, { children: "Share booking link" }),
                  e.jsx(P, {
                    variant: "outline",
                    size: "sm",
                    onClick: () => {
                      if (v) {
                        f(!0);
                        return;
                      }
                      const t = `${window.location.origin}/book/${b}`;
                      (navigator.clipboard.writeText(t),
                        L.success("Booking link copied to clipboard"));
                    },
                    children: "Copy Booking Link",
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      e.jsx(P, {
        onClick: D,
        disabled: l.isPending,
        className: "w-full",
        children: l.isPending ? "Saving..." : "Save Availability",
      }),
      s &&
        e.jsx("div", {
          className:
            "fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm",
          children: e.jsx(re, {
            title: "Share Booking Link",
            description:
              "To share your booking page publicly, connect a cloud database so bookings can be received from anywhere.",
            onClose: () => f(!1),
          }),
        }),
    ],
  });
}
function fe() {
  return [{ title: "Availability — Calendar" }];
}
const ge = O(function () {
    return e.jsx("div", {
      className: "flex items-center justify-center h-screen w-full",
      children: e.jsx("div", {
        className:
          "animate-spin rounded-full h-8 w-8 border-b-2 border-foreground",
      }),
    });
  }),
  ye = I(function () {
    return e.jsx(Y, { children: e.jsx(le, {}) });
  });
export { ge as HydrateFallback, ye as default, fe as meta };
