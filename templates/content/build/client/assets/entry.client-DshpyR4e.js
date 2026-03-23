import {
  r as E,
  m as x,
  s as g,
  E as v,
  N as S,
  R as u,
  i as _,
  a as l,
  b as y,
  u as D,
  F as b,
  c as M,
  d as C,
  e as k,
  f as P,
  g as F,
  h as L,
  j as H,
  k as I,
  l as T,
  n as z,
  o as O,
  p as N,
  q,
} from "./index-BMHtNQid.js";
var h = {},
  p;
function j() {
  if (p) return h;
  p = 1;
  var t = E();
  return ((h.createRoot = t.createRoot), (h.hydrateRoot = t.hydrateRoot), h);
}
var A = j();
[...S];
new TextEncoder();
(class extends u.Component {
  constructor(t) {
    (super(t), (this.state = { error: null, location: t.location }));
  }
  static getDerivedStateFromError(t) {
    return { error: t };
  }
  static getDerivedStateFromProps(t, o) {
    return o.location !== t.location
      ? { error: null, location: t.location }
      : { error: o.error, location: o.location };
  }
  render() {
    return this.state.error
      ? u.createElement(B, { error: this.state.error, renderAppShell: !0 })
      : this.props.children;
  }
});
function w({ renderAppShell: t, title: o, children: n }) {
  return t
    ? u.createElement(
        "html",
        { lang: "en" },
        u.createElement(
          "head",
          null,
          u.createElement("meta", { charSet: "utf-8" }),
          u.createElement("meta", {
            name: "viewport",
            content: "width=device-width,initial-scale=1,viewport-fit=cover",
          }),
          u.createElement("title", null, o),
        ),
        u.createElement(
          "body",
          null,
          u.createElement(
            "main",
            { style: { fontFamily: "system-ui, sans-serif", padding: "2rem" } },
            n,
          ),
        ),
      )
    : n;
}
function B({ error: t, renderAppShell: o }) {
  console.error(t);
  let n = u.createElement("script", {
    dangerouslySetInnerHTML: {
      __html: `
        console.log(
          "💿 Hey developer 👋. You can provide a way better UX than this when your app throws errors. Check out https://reactrouter.com/how-to/error-boundary for more information."
        );
      `,
    },
  });
  if (_(t))
    return u.createElement(
      w,
      { renderAppShell: o, title: "Unhandled Thrown Response!" },
      u.createElement(
        "h1",
        { style: { fontSize: "24px" } },
        t.status,
        " ",
        t.statusText,
      ),
      n,
    );
  let i;
  if (t instanceof Error) i = t;
  else {
    let r =
      t == null
        ? "Unknown Error"
        : typeof t == "object" && "toString" in t
          ? t.toString()
          : JSON.stringify(t);
    i = new Error(r);
  }
  return u.createElement(
    w,
    { renderAppShell: o, title: "Application Error!" },
    u.createElement("h1", { style: { fontSize: "24px" } }, "Application Error"),
    u.createElement(
      "pre",
      {
        style: {
          padding: "2rem",
          background: "hsla(10, 50%, 50%, 0.1)",
          color: "red",
          overflow: "auto",
        },
      },
      i.stack,
    ),
    n,
  );
}
function U(t) {
  if (!t) return null;
  let o = Object.entries(t),
    n = {};
  for (let [i, r] of o)
    if (r && r.__type === "RouteErrorResponse")
      n[i] = new v(r.status, r.statusText, r.data, r.internal === !0);
    else if (r && r.__type === "Error") {
      if (r.__subType) {
        let a = window[r.__subType];
        if (typeof a == "function")
          try {
            let s = new a(r.message);
            ((s.stack = r.stack), (n[i] = s));
          } catch {}
      }
      if (n[i] == null) {
        let a = new Error(r.message);
        ((a.stack = r.stack), (n[i] = a));
      }
    } else n[i] = r;
  return n;
}
function W({
  state: t,
  routes: o,
  getRouteInfo: n,
  location: i,
  basename: r,
  isSpaMode: a,
}) {
  let s = { ...t, loaderData: { ...t.loaderData } },
    c = x(o, i, r);
  if (c)
    for (let R of c) {
      let m = R.route.id,
        d = n(m);
      g(m, d.clientLoader, d.hasLoader, a) &&
      (d.hasHydrateFallback || !d.hasLoader)
        ? delete s.loaderData[m]
        : d.hasLoader || (s.loaderData[m] = null);
    }
  return s;
}
function Y(t) {
  return l.createElement(C, { flushSync: k.flushSync, ...t });
}
var e = null,
  f = null;
function J() {
  if (
    !e &&
    window.__reactRouterContext &&
    window.__reactRouterManifest &&
    window.__reactRouterRouteModules
  ) {
    if (window.__reactRouterManifest.sri === !0) {
      const t = document.querySelector("script[rr-importmap]");
      if (t?.textContent)
        try {
          window.__reactRouterManifest.sri = JSON.parse(
            t.textContent,
          ).integrity;
        } catch (o) {
          console.error("Failed to parse import map", o);
        }
    }
    e = {
      context: window.__reactRouterContext,
      manifest: window.__reactRouterManifest,
      routeModules: window.__reactRouterRouteModules,
      stateDecodingPromise: void 0,
      router: void 0,
      routerInitialized: !1,
    };
  }
}
function V({ getContext: t, unstable_instrumentations: o }) {
  if ((J(), !e))
    throw new Error(
      "You must be using the SSR features of React Router in order to skip passing a `router` prop to `<RouterProvider>`",
    );
  let n = e;
  if (!e.stateDecodingPromise) {
    let s = e.context.stream;
    (y(s, "No stream found for single fetch decoding"),
      (e.context.stream = void 0),
      (e.stateDecodingPromise = P(s, window)
        .then((c) => {
          ((e.context.state = c.value), (n.stateDecodingPromise.value = !0));
        })
        .catch((c) => {
          n.stateDecodingPromise.error = c;
        })));
  }
  if (e.stateDecodingPromise.error) throw e.stateDecodingPromise.error;
  if (!e.stateDecodingPromise.value) throw e.stateDecodingPromise;
  let i = F(
      e.manifest.routes,
      e.routeModules,
      e.context.state,
      e.context.ssr,
      e.context.isSpaMode,
    ),
    r;
  if (e.context.isSpaMode) {
    let { loaderData: s } = e.context.state;
    e.manifest.routes.root?.hasLoader &&
      s &&
      "root" in s &&
      (r = { loaderData: { root: s.root } });
  } else
    ((r = W({
      state: e.context.state,
      routes: i,
      getRouteInfo: (s) => ({
        clientLoader: e.routeModules[s]?.clientLoader,
        hasLoader: e.manifest.routes[s]?.hasLoader === !0,
        hasHydrateFallback: e.routeModules[s]?.HydrateFallback != null,
      }),
      location: window.location,
      basename: window.__reactRouterContext?.basename,
      isSpaMode: e.context.isSpaMode,
    })),
      r && r.errors && (r.errors = U(r.errors)));
  window.history.state &&
    window.history.state.masked &&
    window.history.replaceState(
      { ...window.history.state, masked: void 0 },
      "",
    );
  let a = L({
    routes: i,
    history: T(),
    basename: e.context.basename,
    getContext: t,
    hydrationData: r,
    hydrationRouteProperties: N,
    unstable_instrumentations: o,
    mapRouteProperties: O,
    future: { middleware: e.context.future.v8_middleware },
    dataStrategy: I(
      () => a,
      e.manifest,
      e.routeModules,
      e.context.ssr,
      e.context.basename,
      e.context.future.unstable_trailingSlashAwareDataRequests,
    ),
    patchRoutesOnNavigation: H(
      () => a,
      e.manifest,
      e.routeModules,
      e.context.ssr,
      e.context.routeDiscovery,
      e.context.isSpaMode,
      e.context.basename,
    ),
  });
  return (
    (e.router = a),
    a.state.initialized && ((e.routerInitialized = !0), a.initialize()),
    (a.createRoutesForHMR = z),
    (window.__reactRouterDataRouter = a),
    a
  );
}
function X(t) {
  f ||
    (f = V({
      getContext: t.getContext,
      unstable_instrumentations: t.unstable_instrumentations,
    }));
  let [o, n] = l.useState(void 0);
  (l.useEffect(() => {}, []), l.useEffect(() => {}, [o]));
  let [i, r] = l.useState(f.state.location);
  return (
    l.useLayoutEffect(() => {
      e &&
        e.router &&
        !e.routerInitialized &&
        ((e.routerInitialized = !0), e.router.initialize());
    }, []),
    l.useLayoutEffect(() => {
      if (e && e.router)
        return e.router.subscribe((a) => {
          a.location !== i && r(a.location);
        });
    }, [i]),
    y(e, "ssrInfo unavailable for HydratedRouter"),
    D(
      f,
      e.manifest,
      e.routeModules,
      e.context.ssr,
      e.context.routeDiscovery,
      e.context.isSpaMode,
    ),
    l.createElement(
      l.Fragment,
      null,
      l.createElement(
        b.Provider,
        {
          value: {
            manifest: e.manifest,
            routeModules: e.routeModules,
            future: e.context.future,
            criticalCss: o,
            ssr: e.context.ssr,
            isSpaMode: e.context.isSpaMode,
            routeDiscovery: e.context.routeDiscovery,
          },
        },
        l.createElement(
          M,
          { location: i },
          l.createElement(Y, {
            router: f,
            unstable_useTransitions: t.unstable_useTransitions,
            onError: t.onError,
          }),
        ),
      ),
      l.createElement(l.Fragment, null),
    )
  );
}
A.hydrateRoot(document, q.jsx(X, {}));
