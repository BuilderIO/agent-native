import { r as d, j as e, x as q, w as I, t as R } from "./index-Coy-XKTg.js";
import { a as z } from "./index-qtsL5YWk.js";
import { T as H, P as L } from "./PoweredByBadge-CvhtZowu.js";
import {
  t as M,
  v as Y,
  w as W,
  x as _,
  y as K,
  z as V,
  A as $,
  B as p,
  C as G,
  s as m,
  D as Q,
  E as J,
  F as U,
  G as X,
  c as B,
  u as T,
  T as Z,
  H as ee,
} from "./ThemeToggle-BdGywd2Y.js";
import { e as te, C as se } from "./eachDayOfInterval-DejQry_-.js";
import { C as ne } from "./chevron-right-Cmt4MKwM.js";
import { p as N } from "./parseISO-D3GgQGwC.js";
import { L as C, I as D } from "./label-D00ruOVY.js";
import { T as ae } from "./textarea-myagfW9V.js";
import { C as re } from "./circle-check-qyZvhjng.js";
import { b as ie, c as oe } from "./use-bookings-Cb3kpCQ6.js";
function le(t, a) {
  return M(t, a?.in).getDay();
}
function E(t, a) {
  return +M(t) < +M(a);
}
const ce = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
  de = {
    0: "sunday",
    1: "monday",
    2: "tuesday",
    3: "wednesday",
    4: "thursday",
    5: "friday",
    6: "saturday",
  };
function me({ selectedDate: t, onSelect: a, availability: o }) {
  const [r, n] = d.useState(new Date()),
    i = Y(r),
    u = W(r),
    x = _(i),
    h = K(u),
    y = te({ start: x, end: h }),
    f = V(new Date()),
    l = $(f, o.maxAdvanceDays);
  function k(s) {
    if (E(s, f) || E(l, s)) return !0;
    const b = de[le(s)];
    return !o.weeklySchedule[b]?.enabled;
  }
  return e.jsxs("div", {
    className: "w-full max-w-sm",
    children: [
      e.jsxs("div", {
        className: "flex items-center justify-between mb-4",
        children: [
          e.jsx(p, {
            variant: "ghost",
            size: "icon",
            onClick: () => n((s) => G(s, 1)),
            children: e.jsx(se, { className: "h-4 w-4" }),
          }),
          e.jsx("span", {
            className: "text-sm font-medium",
            children: m(r, "MMMM yyyy"),
          }),
          e.jsx(p, {
            variant: "ghost",
            size: "icon",
            onClick: () => n((s) => Q(s, 1)),
            children: e.jsx(ne, { className: "h-4 w-4" }),
          }),
        ],
      }),
      e.jsx("div", {
        className: "grid grid-cols-7 mb-1",
        children: ce.map((s) =>
          e.jsx(
            "div",
            {
              className:
                "py-1 text-center text-xs font-medium text-muted-foreground",
              children: s,
            },
            s,
          ),
        ),
      }),
      e.jsx("div", {
        className: "grid grid-cols-7 gap-1",
        children: y.map((s) => {
          const b = J(s, r),
            g = k(s),
            v = t && U(s, t),
            S = X(s);
          return e.jsx(
            "button",
            {
              onClick: () => !g && a(s),
              disabled: g,
              className: B(
                "flex h-10 w-full items-center justify-center rounded-md text-sm transition-colors",
                !b && "opacity-0 pointer-events-none",
                b && !g && "hover:bg-accent cursor-pointer",
                g && "opacity-30 cursor-not-allowed",
                v && "bg-primary text-primary-foreground hover:bg-primary/90",
                S && !v && "border border-primary/50",
              ),
              children: m(s, "d"),
            },
            s.toISOString(),
          );
        }),
      }),
    ],
  });
}
function ue({ className: t, ...a }) {
  return e.jsx("div", {
    className: B("animate-pulse rounded-md bg-muted", t),
    ...a,
  });
}
function xe({ slots: t, selectedSlot: a, onSelect: o, loading: r }) {
  return r
    ? e.jsx("div", {
        className: "grid grid-cols-3 gap-2",
        children: Array.from({ length: 6 }).map((n, i) =>
          e.jsx(ue, { className: "h-10 rounded-md" }, i),
        ),
      })
    : t.length === 0
      ? e.jsx("p", {
          className: "text-sm text-muted-foreground text-center py-4",
          children: "No available slots for this date.",
        })
      : e.jsx("div", {
          className: "grid grid-cols-3 gap-2",
          children: t.map((n) => {
            const i = a === n.start;
            return e.jsx(
              p,
              {
                variant: i ? "default" : "outline",
                onClick: () => o(n.start),
                children: m(N(n.start), "h:mm a"),
              },
              n.start,
            );
          }),
        });
}
function he({ onSubmit: t, loading: a }) {
  const [o, r] = d.useState(""),
    [n, i] = d.useState(""),
    [u, x] = d.useState(""),
    [h, y] = d.useState();
  function f(l) {
    (l.preventDefault(),
      !(!o.trim() || !n.trim()) &&
        t({
          name: o.trim(),
          email: n.trim(),
          notes: u.trim() || void 0,
          captchaToken: h,
        }));
  }
  return e.jsxs("form", {
    onSubmit: f,
    className: "space-y-4",
    children: [
      e.jsxs("div", {
        className: "space-y-2",
        children: [
          e.jsx(C, { htmlFor: "booking-name", children: "Name" }),
          e.jsx(D, {
            id: "booking-name",
            value: o,
            onChange: (l) => r(l.target.value),
            placeholder: "Your name",
            required: !0,
          }),
        ],
      }),
      e.jsxs("div", {
        className: "space-y-2",
        children: [
          e.jsx(C, { htmlFor: "booking-email", children: "Email" }),
          e.jsx(D, {
            id: "booking-email",
            type: "email",
            value: n,
            onChange: (l) => i(l.target.value),
            placeholder: "you@example.com",
            required: !0,
          }),
        ],
      }),
      e.jsxs("div", {
        className: "space-y-2",
        children: [
          e.jsx(C, { htmlFor: "booking-notes", children: "Notes (optional)" }),
          e.jsx(ae, {
            id: "booking-notes",
            value: u,
            onChange: (l) => x(l.target.value),
            placeholder: "Anything you'd like to share",
            rows: 3,
          }),
        ],
      }),
      e.jsx(H, { onVerify: y }),
      e.jsx(p, {
        type: "submit",
        className: "w-full",
        disabled: a,
        children: a ? "Booking..." : "Confirm Booking",
      }),
    ],
  });
}
function fe({ booking: t, onReset: a }) {
  return e.jsxs("div", {
    className: "flex flex-col items-center text-center space-y-6 py-8",
    children: [
      e.jsx(re, {
        className: "h-16 w-16 text-emerald-600 dark:text-emerald-400",
      }),
      e.jsxs("div", {
        className: "space-y-2",
        children: [
          e.jsx("h2", {
            className: "text-2xl font-semibold",
            children: "Booking Confirmed",
          }),
          e.jsx("p", {
            className: "text-muted-foreground",
            children:
              "You're all set! A confirmation has been sent to your email.",
          }),
        ],
      }),
      e.jsxs("div", {
        className:
          "w-full max-w-sm rounded-lg border border-border bg-card p-4 text-left space-y-2",
        children: [
          e.jsxs("div", {
            children: [
              e.jsx("span", {
                className: "text-xs text-muted-foreground",
                children: "Event",
              }),
              e.jsx("p", { className: "font-medium", children: t.eventTitle }),
            ],
          }),
          e.jsxs("div", {
            children: [
              e.jsx("span", {
                className: "text-xs text-muted-foreground",
                children: "Date",
              }),
              e.jsx("p", {
                className: "font-medium",
                children: m(N(t.start), "EEEE, MMMM d, yyyy"),
              }),
            ],
          }),
          e.jsxs("div", {
            children: [
              e.jsx("span", {
                className: "text-xs text-muted-foreground",
                children: "Time",
              }),
              e.jsxs("p", {
                className: "font-medium",
                children: [
                  m(N(t.start), "h:mm a"),
                  " -",
                  " ",
                  m(N(t.end), "h:mm a"),
                ],
              }),
            ],
          }),
          e.jsxs("div", {
            children: [
              e.jsx("span", {
                className: "text-xs text-muted-foreground",
                children: "Name",
              }),
              e.jsx("p", { className: "font-medium", children: t.name }),
            ],
          }),
        ],
      }),
      e.jsx(p, { variant: "outline", onClick: a, children: "Book Another" }),
    ],
  });
}
function ge() {
  return T({
    queryKey: ["public-settings"],
    queryFn: async () => {
      const t = await fetch("/api/public/settings");
      if (!t.ok) throw new Error("Failed to fetch settings");
      return t.json();
    },
  });
}
function je() {
  return T({
    queryKey: ["public-availability"],
    queryFn: async () => {
      const t = await fetch("/api/public/availability");
      if (!t.ok) throw new Error("Failed to fetch availability");
      return t.json();
    },
  });
}
function pe() {
  const { slug: t } = q(),
    { data: a } = ge(),
    { data: o } = je(),
    [r, n] = d.useState("date"),
    [i, u] = d.useState(null),
    [x, h] = d.useState(null),
    [y, f] = d.useState(null),
    l = i ? m(i, "yyyy-MM-dd") : "",
    k = o?.slotDurationMinutes ?? a?.defaultEventDuration ?? 30,
    { data: s = [], isLoading: b } = ie(l, k),
    g = oe();
  function v(c) {
    (u(c), h(null), n("time"));
  }
  function S(c) {
    (h(c), n("info"));
  }
  function P(c) {
    if (!x || !t) return;
    const j = s.find((w) => w.start === x);
    j &&
      g.mutate(
        {
          name: c.name,
          email: c.email,
          notes: c.notes,
          captchaToken: c.captchaToken,
          start: j.start,
          end: j.end,
          slug: t,
        },
        {
          onSuccess: (w) => {
            (f(w), n("confirmed"));
          },
          onError: () => z.error("Failed to create booking"),
        },
      );
  }
  function F() {
    (n("date"), u(null), h(null), f(null));
  }
  const A = a?.bookingPageTitle || "Book a Meeting",
    O = a?.bookingPageDescription || "Pick a time that works for you.";
  return e.jsxs("div", {
    className:
      "min-h-screen bg-background flex items-center justify-center p-4 relative",
    children: [
      e.jsx("div", {
        className: "absolute top-4 right-4",
        children: e.jsx(Z, {}),
      }),
      e.jsxs("div", {
        className: "w-full max-w-lg",
        children: [
          e.jsxs("div", {
            className: "mb-8 text-center",
            children: [
              e.jsx("div", {
                className:
                  "mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10",
                children: e.jsx(ee, { className: "h-6 w-6 text-primary" }),
              }),
              e.jsx("h1", { className: "text-2xl font-semibold", children: A }),
              e.jsx("p", {
                className: "mt-1 text-sm text-muted-foreground",
                children: O,
              }),
            ],
          }),
          e.jsxs("div", {
            className: "rounded-xl border border-border bg-card p-6",
            children: [
              r !== "confirmed" &&
                e.jsx("div", {
                  className: "mb-6 flex items-center justify-center gap-2",
                  children: ["date", "time", "info"].map((c, j) =>
                    e.jsxs(
                      "div",
                      {
                        className: "flex items-center gap-2",
                        children: [
                          e.jsx("div", {
                            className: `flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${r === c ? "bg-primary text-primary-foreground" : ["date", "time", "info"].indexOf(r) > j ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`,
                            children: j + 1,
                          }),
                          j < 2 &&
                            e.jsx("div", { className: "h-px w-8 bg-border" }),
                        ],
                      },
                      c,
                    ),
                  ),
                }),
              r === "date" &&
                o &&
                e.jsxs("div", {
                  children: [
                    e.jsx("h3", {
                      className: "mb-4 text-sm font-medium text-center",
                      children: "Select a Date",
                    }),
                    e.jsx("div", {
                      className: "flex justify-center",
                      children: e.jsx(me, {
                        selectedDate: i,
                        onSelect: v,
                        availability: o,
                      }),
                    }),
                  ],
                }),
              r === "time" &&
                e.jsxs("div", {
                  children: [
                    e.jsxs("div", {
                      className: "mb-4 flex items-center justify-between",
                      children: [
                        e.jsx("h3", {
                          className: "text-sm font-medium",
                          children: "Select a Time",
                        }),
                        e.jsx(p, {
                          variant: "link",
                          size: "sm",
                          onClick: () => n("date"),
                          children: "Change date",
                        }),
                      ],
                    }),
                    i &&
                      e.jsx("p", {
                        className: "mb-4 text-sm text-muted-foreground",
                        children: m(i, "EEEE, MMMM d, yyyy"),
                      }),
                    e.jsx(xe, {
                      slots: s,
                      selectedSlot: x,
                      onSelect: S,
                      loading: b,
                    }),
                  ],
                }),
              r === "info" &&
                e.jsxs("div", {
                  children: [
                    e.jsxs("div", {
                      className: "mb-4 flex items-center justify-between",
                      children: [
                        e.jsx("h3", {
                          className: "text-sm font-medium",
                          children: "Your Information",
                        }),
                        e.jsx(p, {
                          variant: "link",
                          size: "sm",
                          onClick: () => n("time"),
                          children: "Change time",
                        }),
                      ],
                    }),
                    e.jsx(he, { onSubmit: P, loading: g.isPending }),
                  ],
                }),
              r === "confirmed" && y && e.jsx(fe, { booking: y, onReset: F }),
            ],
          }),
        ],
      }),
      e.jsx(L, {}),
    ],
  });
}
function Be() {
  return [{ title: "Book a Meeting" }];
}
const Te = R(function () {
    return e.jsx("div", {
      className: "flex items-center justify-center h-screen w-full",
      children: e.jsx("div", {
        className:
          "animate-spin rounded-full h-8 w-8 border-b-2 border-foreground",
      }),
    });
  }),
  Pe = I(function () {
    return e.jsx(pe, {});
  });
export { Te as HydrateFallback, Pe as default, Be as meta };
