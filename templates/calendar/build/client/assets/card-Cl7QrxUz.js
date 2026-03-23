import { r as s, j as d } from "./index-Coy-XKTg.js";
import "./index-qtsL5YWk.js";
import { c as t } from "./ThemeToggle-BdGywd2Y.js";
const o = s.forwardRef(({ className: a, ...e }, r) =>
  d.jsx("div", {
    ref: r,
    className: t("rounded-lg border bg-card text-card-foreground shadow-sm", a),
    ...e,
  }),
);
o.displayName = "Card";
const i = s.forwardRef(({ className: a, ...e }, r) =>
  d.jsx("div", {
    ref: r,
    className: t("flex flex-col space-y-1.5 p-6", a),
    ...e,
  }),
);
i.displayName = "CardHeader";
const c = s.forwardRef(({ className: a, ...e }, r) =>
  d.jsx("h3", {
    ref: r,
    className: t("text-2xl font-semibold leading-none tracking-tight", a),
    ...e,
  }),
);
c.displayName = "CardTitle";
const m = s.forwardRef(({ className: a, ...e }, r) =>
  d.jsx("p", {
    ref: r,
    className: t("text-sm text-muted-foreground", a),
    ...e,
  }),
);
m.displayName = "CardDescription";
const n = s.forwardRef(({ className: a, ...e }, r) =>
  d.jsx("div", { ref: r, className: t("p-6 pt-0", a), ...e }),
);
n.displayName = "CardContent";
const l = s.forwardRef(({ className: a, ...e }, r) =>
  d.jsx("div", { ref: r, className: t("flex items-center p-6 pt-0", a), ...e }),
);
l.displayName = "CardFooter";
export { o as C, i as a, c as b, m as c, n as d };
