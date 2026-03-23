import { r as o, j as e, w as z, t as O } from "./index-Coy-XKTg.js";
import {
  P as h,
  j as y,
  r as X,
  f as J,
  k as Q,
  i as U,
  c as d,
  q as W,
  s as N,
  B as Y,
} from "./ThemeToggle-BdGywd2Y.js";
import { R as Z, I as ee, c as I, u as te } from "./index-CA2Tg6N_.js";
import { a as R } from "./index-qtsL5YWk.js";
import { u as ae, a as se } from "./use-bookings-Cb3kpCQ6.js";
import { C as re } from "./circle-x-DtBsj6Ko.js";
import { p as T } from "./parseISO-D3GgQGwC.js";
import { A as oe } from "./AppLayout-Cz7nte3z.js";
var j = "Tabs",
  [ne] = J(j, [I]),
  k = I(),
  [ie, C] = ne(j),
  F = o.forwardRef((t, a) => {
    const {
        __scopeTabs: s,
        value: n,
        onValueChange: i,
        defaultValue: c,
        orientation: r = "horizontal",
        dir: f,
        activationMode: v = "automatic",
        ...g
      } = t,
      u = te(f),
      [l, x] = Q({ prop: n, onChange: i, defaultProp: c ?? "", caller: j });
    return e.jsx(ie, {
      scope: s,
      baseId: U(),
      value: l,
      onValueChange: x,
      orientation: r,
      dir: u,
      activationMode: v,
      children: e.jsx(h.div, { dir: u, "data-orientation": r, ...g, ref: a }),
    });
  });
F.displayName = j;
var A = "TabsList",
  B = o.forwardRef((t, a) => {
    const { __scopeTabs: s, loop: n = !0, ...i } = t,
      c = C(A, s),
      r = k(s);
    return e.jsx(Z, {
      asChild: !0,
      ...r,
      orientation: c.orientation,
      dir: c.dir,
      loop: n,
      children: e.jsx(h.div, {
        role: "tablist",
        "aria-orientation": c.orientation,
        ...i,
        ref: a,
      }),
    });
  });
B.displayName = A;
var _ = "TabsTrigger",
  E = o.forwardRef((t, a) => {
    const { __scopeTabs: s, value: n, disabled: i = !1, ...c } = t,
      r = C(_, s),
      f = k(s),
      v = S(r.baseId, n),
      g = V(r.baseId, n),
      u = n === r.value;
    return e.jsx(ee, {
      asChild: !0,
      ...f,
      focusable: !i,
      active: u,
      children: e.jsx(h.button, {
        type: "button",
        role: "tab",
        "aria-selected": u,
        "aria-controls": g,
        "data-state": u ? "active" : "inactive",
        "data-disabled": i ? "" : void 0,
        disabled: i,
        id: v,
        ...c,
        ref: a,
        onMouseDown: y(t.onMouseDown, (l) => {
          !i && l.button === 0 && l.ctrlKey === !1
            ? r.onValueChange(n)
            : l.preventDefault();
        }),
        onKeyDown: y(t.onKeyDown, (l) => {
          [" ", "Enter"].includes(l.key) && r.onValueChange(n);
        }),
        onFocus: y(t.onFocus, () => {
          const l = r.activationMode !== "manual";
          !u && !i && l && r.onValueChange(n);
        }),
      }),
    });
  });
E.displayName = _;
var M = "TabsContent",
  P = o.forwardRef((t, a) => {
    const { __scopeTabs: s, value: n, forceMount: i, children: c, ...r } = t,
      f = C(M, s),
      v = S(f.baseId, n),
      g = V(f.baseId, n),
      u = n === f.value,
      l = o.useRef(u);
    return (
      o.useEffect(() => {
        const x = requestAnimationFrame(() => (l.current = !1));
        return () => cancelAnimationFrame(x);
      }, []),
      e.jsx(X, {
        present: i || u,
        children: ({ present: x }) =>
          e.jsx(h.div, {
            "data-state": u ? "active" : "inactive",
            "data-orientation": f.orientation,
            role: "tabpanel",
            "aria-labelledby": v,
            hidden: !x,
            id: g,
            tabIndex: 0,
            ...r,
            ref: a,
            style: { ...t.style, animationDuration: l.current ? "0s" : void 0 },
            children: x && c,
          }),
      })
    );
  });
P.displayName = M;
function S(t, a) {
  return `${t}-trigger-${a}`;
}
function V(t, a) {
  return `${t}-content-${a}`;
}
var le = F,
  D = B,
  H = E,
  $ = P;
const de = le,
  L = o.forwardRef(({ className: t, ...a }, s) =>
    e.jsx(D, {
      ref: s,
      className: d(
        "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
        t,
      ),
      ...a,
    }),
  );
L.displayName = D.displayName;
const p = o.forwardRef(({ className: t, ...a }, s) =>
  e.jsx(H, {
    ref: s,
    className: d(
      "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      t,
    ),
    ...a,
  }),
);
p.displayName = H.displayName;
const ce = o.forwardRef(({ className: t, ...a }, s) =>
  e.jsx($, {
    ref: s,
    className: d(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      t,
    ),
    ...a,
  }),
);
ce.displayName = $.displayName;
const G = o.forwardRef(({ className: t, ...a }, s) =>
  e.jsx("div", {
    className: "relative w-full overflow-auto",
    children: e.jsx("table", {
      ref: s,
      className: d("w-full caption-bottom text-sm", t),
      ...a,
    }),
  }),
);
G.displayName = "Table";
const K = o.forwardRef(({ className: t, ...a }, s) =>
  e.jsx("thead", { ref: s, className: d("[&_tr]:border-b", t), ...a }),
);
K.displayName = "TableHeader";
const q = o.forwardRef(({ className: t, ...a }, s) =>
  e.jsx("tbody", {
    ref: s,
    className: d("[&_tr:last-child]:border-0", t),
    ...a,
  }),
);
q.displayName = "TableBody";
const ue = o.forwardRef(({ className: t, ...a }, s) =>
  e.jsx("tfoot", {
    ref: s,
    className: d("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", t),
    ...a,
  }),
);
ue.displayName = "TableFooter";
const w = o.forwardRef(({ className: t, ...a }, s) =>
  e.jsx("tr", {
    ref: s,
    className: d(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      t,
    ),
    ...a,
  }),
);
w.displayName = "TableRow";
const m = o.forwardRef(({ className: t, ...a }, s) =>
  e.jsx("th", {
    ref: s,
    className: d(
      "h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
      t,
    ),
    ...a,
  }),
);
m.displayName = "TableHead";
const b = o.forwardRef(({ className: t, ...a }, s) =>
  e.jsx("td", {
    ref: s,
    className: d("p-4 align-middle [&:has([role=checkbox])]:pr-0", t),
    ...a,
  }),
);
b.displayName = "TableCell";
const fe = o.forwardRef(({ className: t, ...a }, s) =>
  e.jsx("caption", {
    ref: s,
    className: d("mt-4 text-sm text-muted-foreground", t),
    ...a,
  }),
);
fe.displayName = "TableCaption";
const me = W(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
function be({ className: t, variant: a, ...s }) {
  return e.jsx("div", { className: d(me({ variant: a }), t), ...s });
}
function xe() {
  const { data: t = [] } = ae(),
    a = se(),
    [s, n] = o.useState("all"),
    i = t.filter((r) => (s === "all" ? !0 : r.status === s));
  function c(r) {
    a.mutate(r.id, {
      onSuccess: () => R.success("Booking cancelled"),
      onError: () => R.error("Failed to cancel booking"),
    });
  }
  return e.jsxs("div", {
    className: "space-y-6",
    children: [
      e.jsx("div", {
        className: "flex items-center justify-between",
        children: e.jsxs("div", {
          children: [
            e.jsx("h1", {
              className: "text-2xl font-semibold",
              children: "Bookings",
            }),
            e.jsx("p", {
              className: "text-sm text-muted-foreground mt-1",
              children: "Manage your scheduled bookings.",
            }),
          ],
        }),
      }),
      e.jsx(de, {
        value: s,
        onValueChange: (r) => n(r),
        children: e.jsxs(L, {
          children: [
            e.jsxs(p, { value: "all", children: ["All (", t.length, ")"] }),
            e.jsxs(p, {
              value: "confirmed",
              children: [
                "Confirmed (",
                t.filter((r) => r.status === "confirmed").length,
                ")",
              ],
            }),
            e.jsxs(p, {
              value: "cancelled",
              children: [
                "Cancelled (",
                t.filter((r) => r.status === "cancelled").length,
                ")",
              ],
            }),
          ],
        }),
      }),
      i.length === 0
        ? e.jsx("div", {
            className:
              "flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12",
            children: e.jsx("p", {
              className: "text-sm text-muted-foreground",
              children: "No bookings found.",
            }),
          })
        : e.jsx("div", {
            className: "rounded-lg border border-border",
            children: e.jsxs(G, {
              children: [
                e.jsx(K, {
                  children: e.jsxs(w, {
                    children: [
                      e.jsx(m, { children: "Name" }),
                      e.jsx(m, { children: "Email" }),
                      e.jsx(m, { children: "Event" }),
                      e.jsx(m, { children: "Date & Time" }),
                      e.jsx(m, { children: "Status" }),
                      e.jsx(m, { className: "w-[80px]" }),
                    ],
                  }),
                }),
                e.jsx(q, {
                  children: i.map((r) =>
                    e.jsxs(
                      w,
                      {
                        children: [
                          e.jsx(b, {
                            className: "font-medium",
                            children: r.name,
                          }),
                          e.jsx(b, {
                            className: "text-muted-foreground",
                            children: r.email,
                          }),
                          e.jsx(b, { children: r.eventTitle }),
                          e.jsxs(b, {
                            className: "text-muted-foreground",
                            children: [
                              e.jsx("div", {
                                children: N(T(r.start), "MMM d, yyyy"),
                              }),
                              e.jsxs("div", {
                                className: "text-xs",
                                children: [
                                  N(T(r.start), "h:mm a"),
                                  " -",
                                  " ",
                                  N(T(r.end), "h:mm a"),
                                ],
                              }),
                            ],
                          }),
                          e.jsx(b, {
                            children: e.jsx(be, {
                              variant:
                                r.status === "confirmed"
                                  ? "default"
                                  : "secondary",
                              children: r.status,
                            }),
                          }),
                          e.jsx(b, {
                            children:
                              r.status === "confirmed" &&
                              e.jsx(Y, {
                                variant: "ghost",
                                size: "icon",
                                onClick: () => c(r),
                                disabled: a.isPending,
                                title: "Cancel booking",
                                children: e.jsx(re, {
                                  className: "h-4 w-4 text-destructive",
                                }),
                              }),
                          }),
                        ],
                      },
                      r.id,
                    ),
                  ),
                }),
              ],
            }),
          }),
    ],
  });
}
function we() {
  return [{ title: "Bookings — Calendar" }];
}
const Ce = O(function () {
    return e.jsx("div", {
      className: "flex items-center justify-center h-screen w-full",
      children: e.jsx("div", {
        className:
          "animate-spin rounded-full h-8 w-8 border-b-2 border-foreground",
      }),
    });
  }),
  Re = z(function () {
    return e.jsx(oe, { children: e.jsx(xe, {}) });
  });
export { Ce as HydrateFallback, Re as default, we as meta };
