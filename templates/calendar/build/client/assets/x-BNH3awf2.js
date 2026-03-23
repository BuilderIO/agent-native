import { r as o, j as n } from "./index-Coy-XKTg.js";
import {
  g as C,
  k as M,
  P as y,
  j as T,
  o as H,
  f as A,
  c as x,
  b as L,
} from "./ThemeToggle-BdGywd2Y.js";
import "./index-qtsL5YWk.js";
function U(e) {
  const t = o.useRef({ value: e, previous: e });
  return o.useMemo(
    () => (
      t.current.value !== e &&
        ((t.current.previous = t.current.value), (t.current.value = e)),
      t.current.previous
    ),
    [e],
  );
}
var b = "Switch",
  [q] = A(b),
  [z, O] = q(b),
  P = o.forwardRef((e, t) => {
    const {
        __scopeSwitch: r,
        name: a,
        checked: s,
        defaultChecked: m,
        required: d,
        disabled: c,
        value: u = "on",
        onCheckedChange: v,
        form: i,
        ...w
      } = e,
      [l, p] = o.useState(null),
      k = C(t, (h) => p(h)),
      S = o.useRef(!1),
      g = l ? i || !!l.closest("form") : !0,
      [f, B] = M({ prop: s, defaultProp: m ?? !1, onChange: v, caller: b });
    return n.jsxs(z, {
      scope: r,
      checked: f,
      disabled: c,
      children: [
        n.jsx(y.button, {
          type: "button",
          role: "switch",
          "aria-checked": f,
          "aria-required": d,
          "data-state": _(f),
          "data-disabled": c ? "" : void 0,
          disabled: c,
          value: u,
          ...w,
          ref: k,
          onClick: T(e.onClick, (h) => {
            (B((I) => !I),
              g &&
                ((S.current = h.isPropagationStopped()),
                S.current || h.stopPropagation()));
          }),
        }),
        g &&
          n.jsx(N, {
            control: l,
            bubbles: !S.current,
            name: a,
            value: u,
            checked: f,
            required: d,
            disabled: c,
            form: i,
            style: { transform: "translateX(-100%)" },
          }),
      ],
    });
  });
P.displayName = b;
var R = "SwitchThumb",
  E = o.forwardRef((e, t) => {
    const { __scopeSwitch: r, ...a } = e,
      s = O(R, r);
    return n.jsx(y.span, {
      "data-state": _(s.checked),
      "data-disabled": s.disabled ? "" : void 0,
      ...a,
      ref: t,
    });
  });
E.displayName = R;
var X = "SwitchBubbleInput",
  N = o.forwardRef(
    (
      { __scopeSwitch: e, control: t, checked: r, bubbles: a = !0, ...s },
      m,
    ) => {
      const d = o.useRef(null),
        c = C(d, m),
        u = U(r),
        v = H(t);
      return (
        o.useEffect(() => {
          const i = d.current;
          if (!i) return;
          const w = window.HTMLInputElement.prototype,
            p = Object.getOwnPropertyDescriptor(w, "checked").set;
          if (u !== r && p) {
            const k = new Event("click", { bubbles: a });
            (p.call(i, r), i.dispatchEvent(k));
          }
        }, [u, r, a]),
        n.jsx("input", {
          type: "checkbox",
          "aria-hidden": !0,
          defaultChecked: r,
          ...s,
          tabIndex: -1,
          ref: c,
          style: {
            ...s.style,
            ...v,
            position: "absolute",
            pointerEvents: "none",
            opacity: 0,
            margin: 0,
          },
        })
      );
    },
  );
N.displayName = X;
function _(e) {
  return e ? "checked" : "unchecked";
}
var j = P,
  D = E;
const F = o.forwardRef(({ className: e, ...t }, r) =>
  n.jsx(j, {
    className: x(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      e,
    ),
    ...t,
    ref: r,
    children: n.jsx(D, {
      className: x(
        "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
      ),
    }),
  }),
);
F.displayName = j.displayName;
const W = [
    ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
    ["path", { d: "m6 6 12 12", key: "d8bk6v" }],
  ],
  K = L("x", W);
export { F as S, K as X };
