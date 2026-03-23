import { r as a, j as e, w as H, t as M } from "./index-Coy-XKTg.js";
import {
  b as K,
  c as Q,
  B as p,
  u as W,
  a as $,
} from "./ThemeToggle-BdGywd2Y.js";
import { P as J, L as g, I as b } from "./label-D00ruOVY.js";
import { T as X } from "./textarea-myagfW9V.js";
import { C as I, a as F, b as A, c as G, d as O } from "./card-Cl7QrxUz.js";
import { u as Y, a as k } from "./index-qtsL5YWk.js";
import { C as z, L as V } from "./loader-circle-D21yW67Y.js";
import { C as U } from "./circle-BLBATaDJ.js";
import {
  E as R,
  u as Z,
  a as ee,
  b as te,
  A as se,
} from "./AppLayout-Cz7nte3z.js";
import { C as ae } from "./circle-check-qyZvhjng.js";
import { C as ne } from "./circle-x-DtBsj6Ko.js";
const re = [
    [
      "path",
      {
        d: "m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71",
        key: "yqzxt4",
      },
    ],
    [
      "path",
      {
        d: "m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71",
        key: "4qinb0",
      },
    ],
    ["line", { x1: "8", x2: "8", y1: "2", y2: "5", key: "1041cp" }],
    ["line", { x1: "2", x2: "5", y1: "8", y2: "8", key: "14m1p5" }],
    ["line", { x1: "16", x2: "16", y1: "19", y2: "22", key: "rzdirn" }],
    ["line", { x1: "19", x2: "22", y1: "16", y2: "16", key: "ox905f" }],
  ],
  oe = K("unlink", re);
var ie = "Separator",
  L = "horizontal",
  le = ["horizontal", "vertical"],
  _ = a.forwardRef((t, r) => {
    const { decorative: n, orientation: d = L, ...u } = t,
      m = ce(d) ? d : L,
      x = n
        ? { role: "none" }
        : {
            "aria-orientation": m === "vertical" ? m : void 0,
            role: "separator",
          };
    return e.jsx(J.div, { "data-orientation": m, ...x, ...u, ref: r });
  });
_.displayName = ie;
function ce(t) {
  return le.includes(t);
}
var B = _;
const q = a.forwardRef(
  (
    { className: t, orientation: r = "horizontal", decorative: n = !0, ...d },
    u,
  ) =>
    e.jsx(B, {
      ref: u,
      decorative: n,
      orientation: r,
      className: Q(
        "shrink-0 bg-border",
        r === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        t,
      ),
      ...d,
    }),
);
q.displayName = B.displayName;
const T = [
  {
    title: "Enable the Google Calendar API",
    description:
      "Open Google Cloud Console and click 'Enable' on the Calendar API.",
    url: "https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com",
    linkText: "Enable Calendar API",
  },
  {
    title: "Configure OAuth consent screen",
    description:
      'Set the app name to anything (e.g. "My Calendar"), choose "External" user type, and add your email as a test user.',
    url: "https://console.cloud.google.com/auth/branding",
    linkText: "Configure consent screen",
  },
  {
    title: "Create OAuth credentials",
    description:
      'Click "Create OAuth client", choose "Web application", and add this redirect URI:',
    url: "https://console.cloud.google.com/apis/credentials/oauthclient",
    linkText: "Create credentials",
    showRedirectUri: !0,
  },
  {
    title: "Paste your credentials",
    description: "Copy the Client ID and Client Secret from the previous step.",
    showInputs: !0,
  },
];
function de() {
  const [t, r] = a.useState(0),
    [n, d] = a.useState(""),
    [u, m] = a.useState(""),
    [c, x] = a.useState(!1),
    [h, f] = a.useState(!1),
    [j, y] = a.useState(null),
    [v, w] = a.useState([]),
    C = `${window.location.origin}/api/google/callback`,
    N = a.useCallback(async () => {
      try {
        const s = await fetch("/api/env-status");
        if (s.ok) {
          const o = await s.json();
          (w(o),
            o.every((P) => P.configured) &&
              o.length > 0 &&
              (f(!0), r(T.length - 1)));
        }
      } catch {}
    }, []);
  a.useEffect(() => {
    N();
  }, [N]);
  const S = v.length > 0 && v.every((s) => s.configured);
  async function D() {
    if (!(!n.trim() || !u.trim())) {
      (x(!0), y(null));
      try {
        const s = await fetch("/api/env-vars", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vars: [
              { key: "GOOGLE_CLIENT_ID", value: n.trim() },
              { key: "GOOGLE_CLIENT_SECRET", value: u.trim() },
            ],
          }),
        });
        if (!s.ok) {
          const o = await s.json().catch(() => ({}));
          throw new Error(o.error || "Failed to save credentials");
        }
        (f(!0), d(""), m(""), await N());
      } catch (s) {
        y(s instanceof Error ? s.message : "Failed to save");
      } finally {
        x(!1);
      }
    }
  }
  function l() {
    navigator.clipboard.writeText(C);
  }
  return e.jsx("div", {
    className: "space-y-4",
    children: T.map((s, o) => {
      const E = o === t,
        P = o < t || (o === T.length - 1 && h);
      return e.jsx(
        "div",
        {
          role: "button",
          tabIndex: 0,
          className: `w-full text-left rounded-lg border p-4 transition-colors cursor-pointer ${E ? "border-primary/40 bg-primary/5" : P ? "border-border bg-accent" : "border-border/50 opacity-50"}`,
          onClick: () => !h && r(o),
          onKeyDown: (i) => {
            (i.key === "Enter" || i.key === " ") &&
              (i.preventDefault(), !h && r(o));
          },
          children: e.jsxs("div", {
            className: "flex items-start gap-3",
            children: [
              e.jsx("div", {
                className: "mt-0.5 shrink-0",
                children: P
                  ? e.jsx(z, {
                      className:
                        "h-4 w-4 text-emerald-600 dark:text-emerald-400",
                    })
                  : E
                    ? e.jsx(U, {
                        className: "h-4 w-4 text-primary fill-primary",
                      })
                    : e.jsx(U, { className: "h-4 w-4 text-muted-foreground" }),
              }),
              e.jsxs("div", {
                className: "flex-1 min-w-0",
                children: [
                  e.jsxs("p", {
                    className: "text-sm font-medium",
                    children: [
                      e.jsxs("span", {
                        className: "text-muted-foreground mr-1.5",
                        children: [o + 1, "."],
                      }),
                      s.title,
                    ],
                  }),
                  E &&
                    e.jsxs("div", {
                      className: "mt-2 space-y-3",
                      children: [
                        e.jsx("p", {
                          className:
                            "text-xs text-muted-foreground leading-relaxed",
                          children: s.description,
                        }),
                        s.showRedirectUri &&
                          e.jsxs("div", {
                            className: "flex items-center gap-2",
                            children: [
                              e.jsx("code", {
                                className:
                                  "flex-1 rounded bg-muted px-2 py-1.5 text-xs font-mono break-all",
                                children: C,
                              }),
                              e.jsx(p, {
                                variant: "outline",
                                size: "sm",
                                className: "shrink-0 text-xs h-7",
                                onClick: (i) => {
                                  (i.stopPropagation(), l());
                                },
                                children: "Copy",
                              }),
                            ],
                          }),
                        s.url &&
                          e.jsxs(p, {
                            variant: "outline",
                            size: "sm",
                            className: "gap-1.5 text-xs h-7",
                            onClick: (i) => {
                              (i.stopPropagation(),
                                window.open(s.url, "_blank"),
                                o < T.length - 1 && r(o + 1));
                            },
                            children: [
                              e.jsx(R, { className: "h-3 w-3" }),
                              s.linkText,
                            ],
                          }),
                        s.showInputs &&
                          !S &&
                          e.jsxs("div", {
                            className: "space-y-3",
                            onClick: (i) => i.stopPropagation(),
                            children: [
                              e.jsxs("div", {
                                className: "space-y-1.5",
                                children: [
                                  e.jsx(g, {
                                    htmlFor: "client-id",
                                    className: "text-xs text-muted-foreground",
                                    children: "Client ID",
                                  }),
                                  e.jsx(b, {
                                    id: "client-id",
                                    value: n,
                                    onChange: (i) => d(i.target.value),
                                    placeholder:
                                      "123456789.apps.googleusercontent.com",
                                    className: "text-xs h-8 font-mono",
                                  }),
                                ],
                              }),
                              e.jsxs("div", {
                                className: "space-y-1.5",
                                children: [
                                  e.jsx(g, {
                                    htmlFor: "client-secret",
                                    className: "text-xs text-muted-foreground",
                                    children: "Client Secret",
                                  }),
                                  e.jsx(b, {
                                    id: "client-secret",
                                    type: "password",
                                    value: u,
                                    onChange: (i) => m(i.target.value),
                                    placeholder: "GOCSPX-...",
                                    className: "text-xs h-8 font-mono",
                                  }),
                                ],
                              }),
                              j &&
                                e.jsx("p", {
                                  className: "text-xs text-destructive",
                                  children: j,
                                }),
                              e.jsxs(p, {
                                size: "sm",
                                className: "h-7 text-xs",
                                onClick: (i) => {
                                  (i.stopPropagation(), D());
                                },
                                disabled: c || !n.trim() || !u.trim(),
                                children: [
                                  c &&
                                    e.jsx(V, {
                                      className: "mr-1.5 h-3 w-3 animate-spin",
                                    }),
                                  c ? "Saving..." : "Save credentials",
                                ],
                              }),
                            ],
                          }),
                        s.showInputs &&
                          S &&
                          e.jsxs("div", {
                            className:
                              "flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400",
                            children: [
                              e.jsx(z, { className: "h-3.5 w-3.5" }),
                              "Credentials configured. You can now connect your Google Calendar above.",
                            ],
                          }),
                      ],
                    }),
                ],
              }),
            ],
          }),
        },
        o,
      );
    }),
  });
}
function ue() {
  return W({
    queryKey: ["settings"],
    queryFn: async () => {
      const t = await fetch("/api/settings");
      if (!t.ok) throw new Error("Failed to fetch settings");
      return t.json();
    },
  });
}
function me() {
  const t = Y();
  return $({
    mutationFn: async (r) => {
      const n = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(r),
      });
      if (!n.ok) throw new Error("Failed to update settings");
      return n.json();
    },
    onSuccess: () => {
      t.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}
function xe() {
  const { data: t } = ue(),
    r = me(),
    n = Z(),
    d = ee(),
    [u, m] = a.useState(!1),
    c = te(u),
    [x, h] = a.useState(""),
    [f, j] = a.useState(""),
    [y, v] = a.useState(""),
    [w, C] = a.useState(30);
  a.useEffect(() => {
    t &&
      (h(t.timezone),
      j(t.bookingPageTitle),
      v(t.bookingPageDescription),
      C(t.defaultEventDuration));
  }, [t]);
  function N() {
    r.mutate(
      {
        timezone: x,
        bookingPageTitle: f,
        bookingPageDescription: y,
        defaultEventDuration: w,
      },
      {
        onSuccess: () => k.success("Settings saved"),
        onError: () => k.error("Failed to save settings"),
      },
    );
  }
  function S() {
    m(!0);
  }
  (a.useEffect(() => {
    c.data?.url && (window.open(c.data.url, "_blank"), m(!1));
  }, [c.data]),
    a.useEffect(() => {
      c.error && (k.error(c.error.message), m(!1));
    }, [c.error]));
  async function D() {
    const l = n.data?.accounts ?? [];
    try {
      for (const s of l) await d.mutateAsync(s.email);
      k.success("Google Calendar disconnected");
    } catch {
      k.error("Failed to disconnect");
    }
  }
  return e.jsxs("div", {
    className: "mx-auto max-w-2xl space-y-6",
    children: [
      e.jsxs("div", {
        children: [
          e.jsx("h1", {
            className: "text-2xl font-semibold",
            children: "Settings",
          }),
          e.jsx("p", {
            className: "text-sm text-muted-foreground mt-1",
            children: "Configure your calendar and integrations.",
          }),
        ],
      }),
      e.jsxs(I, {
        children: [
          e.jsxs(F, {
            children: [
              e.jsx(A, { className: "text-lg", children: "Google Calendar" }),
              e.jsx(G, {
                children: "Connect your Google Calendar to sync events.",
              }),
            ],
          }),
          e.jsx(O, {
            children: e.jsxs("div", {
              className: "flex items-center justify-between",
              children: [
                e.jsx("div", {
                  className: "flex items-center gap-3",
                  children: n.data?.connected
                    ? e.jsxs(e.Fragment, {
                        children: [
                          e.jsx(ae, {
                            className:
                              "h-5 w-5 text-emerald-600 dark:text-emerald-400",
                          }),
                          e.jsxs("div", {
                            children: [
                              e.jsx("p", {
                                className: "text-sm font-medium",
                                children: "Connected",
                              }),
                              n.data.accounts?.length > 0 &&
                                e.jsx("p", {
                                  className: "text-xs text-muted-foreground",
                                  children: n.data.accounts
                                    .map((l) => l.email)
                                    .join(", "),
                                }),
                            ],
                          }),
                        ],
                      })
                    : e.jsxs(e.Fragment, {
                        children: [
                          e.jsx(ne, {
                            className: "h-5 w-5 text-muted-foreground",
                          }),
                          e.jsx("p", {
                            className: "text-sm text-muted-foreground",
                            children: "Not connected",
                          }),
                        ],
                      }),
                }),
                n.data?.connected
                  ? e.jsxs(p, {
                      variant: "outline",
                      size: "sm",
                      onClick: D,
                      disabled: d.isPending,
                      children: [
                        e.jsx(oe, { className: "mr-1.5 h-3.5 w-3.5" }),
                        "Disconnect",
                      ],
                    })
                  : e.jsxs(p, {
                      size: "sm",
                      onClick: S,
                      children: [
                        e.jsx(R, { className: "mr-1.5 h-3.5 w-3.5" }),
                        "Connect",
                      ],
                    }),
              ],
            }),
          }),
        ],
      }),
      !n.data?.connected &&
        e.jsxs(I, {
          children: [
            e.jsxs(F, {
              children: [
                e.jsx(A, {
                  className: "text-lg",
                  children: "Setup Google Calendar",
                }),
                e.jsx(G, {
                  children:
                    "Follow these steps to connect your Google account. Takes about 3 minutes.",
                }),
              ],
            }),
            e.jsx(O, { children: e.jsx(de, {}) }),
          ],
        }),
      e.jsx(q, {}),
      e.jsxs(I, {
        children: [
          e.jsxs(F, {
            children: [
              e.jsx(A, { className: "text-lg", children: "General" }),
              e.jsx(G, { children: "Calendar and booking page settings." }),
            ],
          }),
          e.jsxs(O, {
            className: "space-y-4",
            children: [
              e.jsxs("div", {
                className: "space-y-2",
                children: [
                  e.jsx(g, { htmlFor: "timezone", children: "Timezone" }),
                  e.jsx(b, {
                    id: "timezone",
                    value: x,
                    onChange: (l) => h(l.target.value),
                    placeholder: "America/New_York",
                  }),
                ],
              }),
              e.jsxs("div", {
                className: "space-y-2",
                children: [
                  e.jsx(g, {
                    htmlFor: "booking-title",
                    children: "Booking Page Title",
                  }),
                  e.jsx(b, {
                    id: "booking-title",
                    value: f,
                    onChange: (l) => j(l.target.value),
                    placeholder: "Book a Meeting",
                  }),
                ],
              }),
              e.jsxs("div", {
                className: "space-y-2",
                children: [
                  e.jsx(g, {
                    htmlFor: "booking-desc",
                    children: "Booking Page Description",
                  }),
                  e.jsx(X, {
                    id: "booking-desc",
                    value: y,
                    onChange: (l) => v(l.target.value),
                    placeholder: "Pick a time that works for you.",
                    rows: 2,
                  }),
                ],
              }),
              e.jsxs("div", {
                className: "space-y-2",
                children: [
                  e.jsx(g, {
                    htmlFor: "default-duration",
                    children: "Default Event Duration (minutes)",
                  }),
                  e.jsx(b, {
                    id: "default-duration",
                    type: "number",
                    value: w,
                    onChange: (l) => C(Number(l.target.value)),
                    min: 5,
                    max: 480,
                  }),
                ],
              }),
              e.jsx(p, {
                onClick: N,
                disabled: r.isPending,
                children: r.isPending ? "Saving..." : "Save Settings",
              }),
            ],
          }),
        ],
      }),
    ],
  });
}
function we() {
  return [{ title: "Settings — Calendar" }];
}
const Se = M(function () {
    return e.jsx("div", {
      className: "flex items-center justify-center h-screen w-full",
      children: e.jsx("div", {
        className:
          "animate-spin rounded-full h-8 w-8 border-b-2 border-foreground",
      }),
    });
  }),
  Ee = H(function () {
    return e.jsx(se, { children: e.jsx(xe, {}) });
  });
export { Se as HydrateFallback, Ee as default, we as meta };
