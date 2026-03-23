import { v as r, q as e, w as c, x as o } from "./index-BMHtNQid.js";
import {
  u as i,
  F as l,
  B as d,
  P as m,
  A as u,
} from "./AppLayout-D6MCaqV6.js";
import "./createLucideIcon-rfCLSgWW.js";
function x() {
  const t = r(),
    s = i(),
    a = async () => {
      const n = await s.mutateAsync({});
      t(`/${n.id}`);
    };
  return e.jsx("div", {
    className: "flex-1 flex items-center justify-center bg-background",
    children: e.jsxs("div", {
      className: "text-center max-w-md px-6",
      children: [
        e.jsx("div", {
          className:
            "inline-flex items-center justify-center w-14 h-14 rounded-xl bg-muted mb-6",
          children: e.jsx(l, { size: 24, className: "text-muted-foreground" }),
        }),
        e.jsx("h2", {
          className: "text-lg font-semibold text-foreground mb-2",
          children: "No page selected",
        }),
        e.jsx("p", {
          className: "text-sm text-muted-foreground leading-relaxed mb-6",
          children:
            "Select a page from the sidebar or create a new one to get started.",
        }),
        e.jsxs(d, {
          onClick: a,
          size: "sm",
          children: [e.jsx(m, { size: 14, className: "mr-1.5" }), "New page"],
        }),
      ],
    }),
  });
}
function j() {
  return [{ title: "Documents" }];
}
const g = o(function () {
    return e.jsx("div", {
      className: "flex items-center justify-center h-screen w-full",
      children: e.jsx("div", {
        className:
          "animate-spin rounded-full h-8 w-8 border-b-2 border-foreground",
      }),
    });
  }),
  b = c(function () {
    return e.jsx(u, { activeDocumentId: null, children: e.jsx(x, {}) });
  });
export { g as HydrateFallback, b as default, j as meta };
