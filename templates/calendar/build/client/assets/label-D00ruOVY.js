import { r as o, j as i } from "./index-Coy-XKTg.js";
import "./index-qtsL5YWk.js";
import { c as s, p as c, q as b } from "./ThemeToggle-BdGywd2Y.js";
const x = o.forwardRef(({ className: t, type: r, ...e }, a) =>
  i.jsx("input", {
    type: r,
    className: s(
      "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
      t,
    ),
    ref: a,
    ...e,
  }),
);
x.displayName = "Input";
var g = [
    "a",
    "button",
    "div",
    "form",
    "h2",
    "h3",
    "img",
    "input",
    "label",
    "li",
    "nav",
    "ol",
    "p",
    "select",
    "span",
    "svg",
    "ul",
  ],
  v = g.reduce((t, r) => {
    const e = c(`Primitive.${r}`),
      a = o.forwardRef((d, f) => {
        const { asChild: u, ...m } = d,
          p = u ? e : r;
        return (
          typeof window < "u" && (window[Symbol.for("radix-ui")] = !0),
          i.jsx(p, { ...m, ref: f })
        );
      });
    return ((a.displayName = `Primitive.${r}`), { ...t, [r]: a });
  }, {}),
  w = "Label",
  l = o.forwardRef((t, r) =>
    i.jsx(v.label, {
      ...t,
      ref: r,
      onMouseDown: (e) => {
        e.target.closest("button, input, select, textarea") ||
          (t.onMouseDown?.(e),
          !e.defaultPrevented && e.detail > 1 && e.preventDefault());
      },
    }),
  );
l.displayName = w;
var n = l;
const y = b(
    "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
  ),
  N = o.forwardRef(({ className: t, ...r }, e) =>
    i.jsx(n, { ref: e, className: s(y(), t), ...r }),
  );
N.displayName = n.displayName;
export { x as I, N as L, v as P };
