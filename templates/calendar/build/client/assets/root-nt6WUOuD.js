import {
  j as i,
  w as H,
  M as I,
  L as B,
  S as R,
  v as N,
  r as W,
  O as _,
} from "./index-Coy-XKTg.js";
import {
  e as L,
  b as z,
  c as $,
  d as J,
  S as F,
  M as U,
  n as u,
  m as w,
  f as h,
  h as D,
  Q as G,
  i as M,
  j as V,
  o as q,
  r as x,
  k as X,
  l as C,
  p as S,
  s as Y,
  z as Z,
  $ as ee,
  q as te,
  J as se,
  u as re,
} from "./index-qtsL5YWk.js";
import { u as ae } from "./ErrorBoundary-0h_wKUpp.js";
import { E as ve } from "./ErrorBoundary-0h_wKUpp.js";
function j(e) {
  return {
    onFetch: (t, s) => {
      const r = t.options,
        a = t.fetchOptions?.meta?.fetchMore?.direction,
        n = t.state.data?.pages || [],
        l = t.state.data?.pageParams || [];
      let d = { pages: [], pageParams: [] },
        y = 0;
      const g = async () => {
        let m = !1;
        const E = (o) => {
            J(
              o,
              () => t.signal,
              () => (m = !0),
            );
          },
          k = L(t.options, t.fetchOptions),
          v = async (o, c, f) => {
            if (m) return Promise.reject();
            if (c == null && o.pages.length) return Promise.resolve(o);
            const T = (() => {
                const O = {
                  client: t.client,
                  queryKey: t.queryKey,
                  pageParam: c,
                  direction: f ? "backward" : "forward",
                  meta: t.options.meta,
                };
                return (E(O), O);
              })(),
              K = await k(T),
              { maxPages: Q } = t.options,
              P = f ? z : $;
            return {
              pages: P(o.pages, K, Q),
              pageParams: P(o.pageParams, c, Q),
            };
          };
        if (a && n.length) {
          const o = a === "backward",
            c = o ? ie : A,
            f = { pages: n, pageParams: l },
            b = c(r, f);
          d = await v(f, b, o);
        } else {
          const o = e ?? n.length;
          do {
            const c = y === 0 ? (l[0] ?? r.initialPageParam) : A(r, d);
            if (y > 0 && c == null) break;
            ((d = await v(d, c)), y++);
          } while (y < o);
        }
        return d;
      };
      t.options.persister
        ? (t.fetchFn = () =>
            t.options.persister?.(
              g,
              {
                client: t.client,
                queryKey: t.queryKey,
                meta: t.options.meta,
                signal: t.signal,
              },
              s,
            ))
        : (t.fetchFn = g);
    },
  };
}
function A(e, { pages: t, pageParams: s }) {
  const r = t.length - 1;
  return t.length > 0 ? e.getNextPageParam(t[r], t, s[r], s) : void 0;
}
function ie(e, { pages: t, pageParams: s }) {
  return t.length > 0 ? e.getPreviousPageParam?.(t[0], t, s[0], s) : void 0;
}
var ne = class extends F {
  constructor(e = {}) {
    (super(),
      (this.config = e),
      (this.#e = new Set()),
      (this.#t = new Map()),
      (this.#s = 0));
  }
  #e;
  #t;
  #s;
  build(e, t, s) {
    const r = new U({
      client: e,
      mutationCache: this,
      mutationId: ++this.#s,
      options: e.defaultMutationOptions(t),
      state: s,
    });
    return (this.add(r), r);
  }
  add(e) {
    this.#e.add(e);
    const t = p(e);
    if (typeof t == "string") {
      const s = this.#t.get(t);
      s ? s.push(e) : this.#t.set(t, [e]);
    }
    this.notify({ type: "added", mutation: e });
  }
  remove(e) {
    if (this.#e.delete(e)) {
      const t = p(e);
      if (typeof t == "string") {
        const s = this.#t.get(t);
        if (s)
          if (s.length > 1) {
            const r = s.indexOf(e);
            r !== -1 && s.splice(r, 1);
          } else s[0] === e && this.#t.delete(t);
      }
    }
    this.notify({ type: "removed", mutation: e });
  }
  canRun(e) {
    const t = p(e);
    if (typeof t == "string") {
      const r = this.#t.get(t)?.find((a) => a.state.status === "pending");
      return !r || r === e;
    } else return !0;
  }
  runNext(e) {
    const t = p(e);
    return typeof t == "string"
      ? (this.#t
          .get(t)
          ?.find((r) => r !== e && r.state.isPaused)
          ?.continue() ?? Promise.resolve())
      : Promise.resolve();
  }
  clear() {
    u.batch(() => {
      (this.#e.forEach((e) => {
        this.notify({ type: "removed", mutation: e });
      }),
        this.#e.clear(),
        this.#t.clear());
    });
  }
  getAll() {
    return Array.from(this.#e);
  }
  find(e) {
    const t = { exact: !0, ...e };
    return this.getAll().find((s) => w(t, s));
  }
  findAll(e = {}) {
    return this.getAll().filter((t) => w(e, t));
  }
  notify(e) {
    u.batch(() => {
      this.listeners.forEach((t) => {
        t(e);
      });
    });
  }
  resumePausedMutations() {
    const e = this.getAll().filter((t) => t.state.isPaused);
    return u.batch(() => Promise.all(e.map((t) => t.continue().catch(h))));
  }
};
function p(e) {
  return e.options.scope?.id;
}
var ue = class extends F {
    constructor(e = {}) {
      (super(), (this.config = e), (this.#e = new Map()));
    }
    #e;
    build(e, t, s) {
      const r = t.queryKey,
        a = t.queryHash ?? D(r, t);
      let n = this.get(a);
      return (
        n ||
          ((n = new G({
            client: e,
            queryKey: r,
            queryHash: a,
            options: e.defaultQueryOptions(t),
            state: s,
            defaultOptions: e.getQueryDefaults(r),
          })),
          this.add(n)),
        n
      );
    }
    add(e) {
      this.#e.has(e.queryHash) ||
        (this.#e.set(e.queryHash, e), this.notify({ type: "added", query: e }));
    }
    remove(e) {
      const t = this.#e.get(e.queryHash);
      t &&
        (e.destroy(),
        t === e && this.#e.delete(e.queryHash),
        this.notify({ type: "removed", query: e }));
    }
    clear() {
      u.batch(() => {
        this.getAll().forEach((e) => {
          this.remove(e);
        });
      });
    }
    get(e) {
      return this.#e.get(e);
    }
    getAll() {
      return [...this.#e.values()];
    }
    find(e) {
      const t = { exact: !0, ...e };
      return this.getAll().find((s) => M(t, s));
    }
    findAll(e = {}) {
      const t = this.getAll();
      return Object.keys(e).length > 0 ? t.filter((s) => M(e, s)) : t;
    }
    notify(e) {
      u.batch(() => {
        this.listeners.forEach((t) => {
          t(e);
        });
      });
    }
    onFocus() {
      u.batch(() => {
        this.getAll().forEach((e) => {
          e.onFocus();
        });
      });
    }
    onOnline() {
      u.batch(() => {
        this.getAll().forEach((e) => {
          e.onOnline();
        });
      });
    }
  },
  oe = class {
    #e;
    #t;
    #s;
    #a;
    #i;
    #r;
    #n;
    #u;
    constructor(e = {}) {
      ((this.#e = e.queryCache || new ue()),
        (this.#t = e.mutationCache || new ne()),
        (this.#s = e.defaultOptions || {}),
        (this.#a = new Map()),
        (this.#i = new Map()),
        (this.#r = 0));
    }
    mount() {
      (this.#r++,
        this.#r === 1 &&
          ((this.#n = V.subscribe(async (e) => {
            e && (await this.resumePausedMutations(), this.#e.onFocus());
          })),
          (this.#u = q.subscribe(async (e) => {
            e && (await this.resumePausedMutations(), this.#e.onOnline());
          }))));
    }
    unmount() {
      (this.#r--,
        this.#r === 0 &&
          (this.#n?.(), (this.#n = void 0), this.#u?.(), (this.#u = void 0)));
    }
    isFetching(e) {
      return this.#e.findAll({ ...e, fetchStatus: "fetching" }).length;
    }
    isMutating(e) {
      return this.#t.findAll({ ...e, status: "pending" }).length;
    }
    getQueryData(e) {
      const t = this.defaultQueryOptions({ queryKey: e });
      return this.#e.get(t.queryHash)?.state.data;
    }
    ensureQueryData(e) {
      const t = this.defaultQueryOptions(e),
        s = this.#e.build(this, t),
        r = s.state.data;
      return r === void 0
        ? this.fetchQuery(e)
        : (e.revalidateIfStale &&
            s.isStaleByTime(x(t.staleTime, s)) &&
            this.prefetchQuery(t),
          Promise.resolve(r));
    }
    getQueriesData(e) {
      return this.#e.findAll(e).map(({ queryKey: t, state: s }) => {
        const r = s.data;
        return [t, r];
      });
    }
    setQueryData(e, t, s) {
      const r = this.defaultQueryOptions({ queryKey: e }),
        n = this.#e.get(r.queryHash)?.state.data,
        l = X(t, n);
      if (l !== void 0)
        return this.#e.build(this, r).setData(l, { ...s, manual: !0 });
    }
    setQueriesData(e, t, s) {
      return u.batch(() =>
        this.#e
          .findAll(e)
          .map(({ queryKey: r }) => [r, this.setQueryData(r, t, s)]),
      );
    }
    getQueryState(e) {
      const t = this.defaultQueryOptions({ queryKey: e });
      return this.#e.get(t.queryHash)?.state;
    }
    removeQueries(e) {
      const t = this.#e;
      u.batch(() => {
        t.findAll(e).forEach((s) => {
          t.remove(s);
        });
      });
    }
    resetQueries(e, t) {
      const s = this.#e;
      return u.batch(
        () => (
          s.findAll(e).forEach((r) => {
            r.reset();
          }),
          this.refetchQueries({ type: "active", ...e }, t)
        ),
      );
    }
    cancelQueries(e, t = {}) {
      const s = { revert: !0, ...t },
        r = u.batch(() => this.#e.findAll(e).map((a) => a.cancel(s)));
      return Promise.all(r).then(h).catch(h);
    }
    invalidateQueries(e, t = {}) {
      return u.batch(
        () => (
          this.#e.findAll(e).forEach((s) => {
            s.invalidate();
          }),
          e?.refetchType === "none"
            ? Promise.resolve()
            : this.refetchQueries(
                { ...e, type: e?.refetchType ?? e?.type ?? "active" },
                t,
              )
        ),
      );
    }
    refetchQueries(e, t = {}) {
      const s = { ...t, cancelRefetch: t.cancelRefetch ?? !0 },
        r = u.batch(() =>
          this.#e
            .findAll(e)
            .filter((a) => !a.isDisabled() && !a.isStatic())
            .map((a) => {
              let n = a.fetch(void 0, s);
              return (
                s.throwOnError || (n = n.catch(h)),
                a.state.fetchStatus === "paused" ? Promise.resolve() : n
              );
            }),
        );
      return Promise.all(r).then(h);
    }
    fetchQuery(e) {
      const t = this.defaultQueryOptions(e);
      t.retry === void 0 && (t.retry = !1);
      const s = this.#e.build(this, t);
      return s.isStaleByTime(x(t.staleTime, s))
        ? s.fetch(t)
        : Promise.resolve(s.state.data);
    }
    prefetchQuery(e) {
      return this.fetchQuery(e).then(h).catch(h);
    }
    fetchInfiniteQuery(e) {
      return ((e.behavior = j(e.pages)), this.fetchQuery(e));
    }
    prefetchInfiniteQuery(e) {
      return this.fetchInfiniteQuery(e).then(h).catch(h);
    }
    ensureInfiniteQueryData(e) {
      return ((e.behavior = j(e.pages)), this.ensureQueryData(e));
    }
    resumePausedMutations() {
      return q.isOnline() ? this.#t.resumePausedMutations() : Promise.resolve();
    }
    getQueryCache() {
      return this.#e;
    }
    getMutationCache() {
      return this.#t;
    }
    getDefaultOptions() {
      return this.#s;
    }
    setDefaultOptions(e) {
      this.#s = e;
    }
    setQueryDefaults(e, t) {
      this.#a.set(C(e), { queryKey: e, defaultOptions: t });
    }
    getQueryDefaults(e) {
      const t = [...this.#a.values()],
        s = {};
      return (
        t.forEach((r) => {
          S(e, r.queryKey) && Object.assign(s, r.defaultOptions);
        }),
        s
      );
    }
    setMutationDefaults(e, t) {
      this.#i.set(C(e), { mutationKey: e, defaultOptions: t });
    }
    getMutationDefaults(e) {
      const t = [...this.#i.values()],
        s = {};
      return (
        t.forEach((r) => {
          S(e, r.mutationKey) && Object.assign(s, r.defaultOptions);
        }),
        s
      );
    }
    defaultQueryOptions(e) {
      if (e._defaulted) return e;
      const t = {
        ...this.#s.queries,
        ...this.getQueryDefaults(e.queryKey),
        ...e,
        _defaulted: !0,
      };
      return (
        t.queryHash || (t.queryHash = D(t.queryKey, t)),
        t.refetchOnReconnect === void 0 &&
          (t.refetchOnReconnect = t.networkMode !== "always"),
        t.throwOnError === void 0 && (t.throwOnError = !!t.suspense),
        !t.networkMode && t.persister && (t.networkMode = "offlineFirst"),
        t.queryFn === Y && (t.enabled = !1),
        t
      );
    }
    defaultMutationOptions(e) {
      return e?._defaulted
        ? e
        : {
            ...this.#s.mutations,
            ...(e?.mutationKey && this.getMutationDefaults(e.mutationKey)),
            ...e,
            _defaulted: !0,
          };
    }
    clear() {
      (this.#e.clear(), this.#t.clear());
    }
  };
const he = ({ ...e }) => {
  const { theme: t = "system" } = Z();
  return i.jsx(ee, {
    theme: t,
    className: "toaster group",
    toastOptions: {
      classNames: {
        toast:
          "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
        description: "group-[.toast]:text-muted-foreground",
        actionButton:
          "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
        cancelButton:
          "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
      },
    },
    ...e,
  });
};
function ye({ children: e }) {
  return i.jsxs("html", {
    lang: "en",
    suppressHydrationWarning: !0,
    children: [
      i.jsxs("head", {
        children: [
          i.jsx("meta", { charSet: "utf-8" }),
          i.jsx("meta", {
            name: "viewport",
            content: "width=device-width, initial-scale=1",
          }),
          i.jsx("link", {
            rel: "icon",
            type: "image/svg+xml",
            href: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📅</text></svg>",
          }),
          i.jsx(I, {}),
          i.jsx(B, {}),
        ],
      }),
      i.jsxs("body", { children: [e, i.jsx(R, {}), i.jsx(N, {})] }),
    ],
  });
}
function ce() {
  const e = re();
  return (
    ae({
      queryClient: e,
      queryKeys: [
        "events",
        "bookings",
        "availability",
        "settings",
        "google-status",
      ],
    }),
    null
  );
}
const pe = H(function () {
  const [t] = W.useState(() => new oe());
  return i.jsx(te, {
    client: t,
    children: i.jsxs(se, {
      attribute: "class",
      defaultTheme: "system",
      enableSystem: !0,
      disableTransitionOnChange: !0,
      children: [i.jsx(ce, {}), i.jsx(he, {}), i.jsx(_, {})],
    }),
  });
});
export { ve as ErrorBoundary, ye as Layout, pe as default };
