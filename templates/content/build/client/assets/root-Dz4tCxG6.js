import {
  i as Ye,
  q as n,
  a,
  e as ze,
  w as Ge,
  M as Je,
  L as Ze,
  S as et,
  t as tt,
  O as st,
} from "./index-BMHtNQid.js";
import {
  e as rt,
  a as nt,
  b as ot,
  c as at,
  S as we,
  M as it,
  n as P,
  m as ue,
  d as O,
  h as Te,
  Q as ct,
  f as de,
  g as ut,
  o as le,
  r as fe,
  i as dt,
  j as pe,
  p as he,
  s as lt,
  u as xe,
  B as ft,
  P as N,
  k as pt,
  l as ht,
  q as C,
  t as Y,
  v as mt,
  V as Ee,
  R as yt,
  w as vt,
  x as gt,
  y as wt,
  z as Tt,
  A as xt,
  C as F,
  D as Et,
  E as bt,
  F as Pt,
  J as St,
  G as Ct,
  T as Rt,
} from "./createLucideIcon-rfCLSgWW.js";
import { $ as Ot } from "./index-B1GyCeXj.js";
function me(e) {
  return {
    onFetch: (t, s) => {
      const r = t.options,
        o = t.fetchOptions?.meta?.fetchMore?.direction,
        i = t.state.data?.pages || [],
        f = t.state.data?.pageParams || [];
      let h = { pages: [], pageParams: [] },
        v = 0;
      const u = async () => {
        let E = !1;
        const b = (y) => {
            at(
              y,
              () => t.signal,
              () => (E = !0),
            );
          },
          D = rt(t.options, t.fetchOptions),
          S = async (y, l, c) => {
            if (E) return Promise.reject();
            if (l == null && y.pages.length) return Promise.resolve(y);
            const p = (() => {
                const g = {
                  client: t.client,
                  queryKey: t.queryKey,
                  pageParam: l,
                  direction: c ? "backward" : "forward",
                  meta: t.options.meta,
                };
                return (b(g), g);
              })(),
              m = await D(p),
              { maxPages: T } = t.options,
              x = c ? nt : ot;
            return {
              pages: x(y.pages, m, T),
              pageParams: x(y.pageParams, l, T),
            };
          };
        if (o && i.length) {
          const y = o === "backward",
            l = y ? At : ye,
            c = { pages: i, pageParams: f },
            w = l(r, c);
          h = await S(c, w, y);
        } else {
          const y = e ?? i.length;
          do {
            const l = v === 0 ? (f[0] ?? r.initialPageParam) : ye(r, h);
            if (v > 0 && l == null) break;
            ((h = await S(h, l)), v++);
          } while (v < y);
        }
        return h;
      };
      t.options.persister
        ? (t.fetchFn = () =>
            t.options.persister?.(
              u,
              {
                client: t.client,
                queryKey: t.queryKey,
                meta: t.options.meta,
                signal: t.signal,
              },
              s,
            ))
        : (t.fetchFn = u);
    },
  };
}
function ye(e, { pages: t, pageParams: s }) {
  const r = t.length - 1;
  return t.length > 0 ? e.getNextPageParam(t[r], t, s[r], s) : void 0;
}
function At(e, { pages: t, pageParams: s }) {
  return t.length > 0 ? e.getPreviousPageParam?.(t[0], t, s[0], s) : void 0;
}
var Dt = class extends we {
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
    const r = new it({
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
    const t = $(e);
    if (typeof t == "string") {
      const s = this.#t.get(t);
      s ? s.push(e) : this.#t.set(t, [e]);
    }
    this.notify({ type: "added", mutation: e });
  }
  remove(e) {
    if (this.#e.delete(e)) {
      const t = $(e);
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
    const t = $(e);
    if (typeof t == "string") {
      const r = this.#t.get(t)?.find((o) => o.state.status === "pending");
      return !r || r === e;
    } else return !0;
  }
  runNext(e) {
    const t = $(e);
    return typeof t == "string"
      ? (this.#t
          .get(t)
          ?.find((r) => r !== e && r.state.isPaused)
          ?.continue() ?? Promise.resolve())
      : Promise.resolve();
  }
  clear() {
    P.batch(() => {
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
    return this.getAll().find((s) => ue(t, s));
  }
  findAll(e = {}) {
    return this.getAll().filter((t) => ue(e, t));
  }
  notify(e) {
    P.batch(() => {
      this.listeners.forEach((t) => {
        t(e);
      });
    });
  }
  resumePausedMutations() {
    const e = this.getAll().filter((t) => t.state.isPaused);
    return P.batch(() => Promise.all(e.map((t) => t.continue().catch(O))));
  }
};
function $(e) {
  return e.options.scope?.id;
}
var Mt = class extends we {
    constructor(e = {}) {
      (super(), (this.config = e), (this.#e = new Map()));
    }
    #e;
    build(e, t, s) {
      const r = t.queryKey,
        o = t.queryHash ?? Te(r, t);
      let i = this.get(o);
      return (
        i ||
          ((i = new ct({
            client: e,
            queryKey: r,
            queryHash: o,
            options: e.defaultQueryOptions(t),
            state: s,
            defaultOptions: e.getQueryDefaults(r),
          })),
          this.add(i)),
        i
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
      P.batch(() => {
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
      return this.getAll().find((s) => de(t, s));
    }
    findAll(e = {}) {
      const t = this.getAll();
      return Object.keys(e).length > 0 ? t.filter((s) => de(e, s)) : t;
    }
    notify(e) {
      P.batch(() => {
        this.listeners.forEach((t) => {
          t(e);
        });
      });
    }
    onFocus() {
      P.batch(() => {
        this.getAll().forEach((e) => {
          e.onFocus();
        });
      });
    }
    onOnline() {
      P.batch(() => {
        this.getAll().forEach((e) => {
          e.onOnline();
        });
      });
    }
  },
  Nt = class {
    #e;
    #t;
    #s;
    #n;
    #o;
    #r;
    #a;
    #i;
    constructor(e = {}) {
      ((this.#e = e.queryCache || new Mt()),
        (this.#t = e.mutationCache || new Dt()),
        (this.#s = e.defaultOptions || {}),
        (this.#n = new Map()),
        (this.#o = new Map()),
        (this.#r = 0));
    }
    mount() {
      (this.#r++,
        this.#r === 1 &&
          ((this.#a = ut.subscribe(async (e) => {
            e && (await this.resumePausedMutations(), this.#e.onFocus());
          })),
          (this.#i = le.subscribe(async (e) => {
            e && (await this.resumePausedMutations(), this.#e.onOnline());
          }))));
    }
    unmount() {
      (this.#r--,
        this.#r === 0 &&
          (this.#a?.(), (this.#a = void 0), this.#i?.(), (this.#i = void 0)));
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
            s.isStaleByTime(fe(t.staleTime, s)) &&
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
        i = this.#e.get(r.queryHash)?.state.data,
        f = dt(t, i);
      if (f !== void 0)
        return this.#e.build(this, r).setData(f, { ...s, manual: !0 });
    }
    setQueriesData(e, t, s) {
      return P.batch(() =>
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
      P.batch(() => {
        t.findAll(e).forEach((s) => {
          t.remove(s);
        });
      });
    }
    resetQueries(e, t) {
      const s = this.#e;
      return P.batch(
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
        r = P.batch(() => this.#e.findAll(e).map((o) => o.cancel(s)));
      return Promise.all(r).then(O).catch(O);
    }
    invalidateQueries(e, t = {}) {
      return P.batch(
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
        r = P.batch(() =>
          this.#e
            .findAll(e)
            .filter((o) => !o.isDisabled() && !o.isStatic())
            .map((o) => {
              let i = o.fetch(void 0, s);
              return (
                s.throwOnError || (i = i.catch(O)),
                o.state.fetchStatus === "paused" ? Promise.resolve() : i
              );
            }),
        );
      return Promise.all(r).then(O);
    }
    fetchQuery(e) {
      const t = this.defaultQueryOptions(e);
      t.retry === void 0 && (t.retry = !1);
      const s = this.#e.build(this, t);
      return s.isStaleByTime(fe(t.staleTime, s))
        ? s.fetch(t)
        : Promise.resolve(s.state.data);
    }
    prefetchQuery(e) {
      return this.fetchQuery(e).then(O).catch(O);
    }
    fetchInfiniteQuery(e) {
      return ((e.behavior = me(e.pages)), this.fetchQuery(e));
    }
    prefetchInfiniteQuery(e) {
      return this.fetchInfiniteQuery(e).then(O).catch(O);
    }
    ensureInfiniteQueryData(e) {
      return ((e.behavior = me(e.pages)), this.ensureQueryData(e));
    }
    resumePausedMutations() {
      return le.isOnline()
        ? this.#t.resumePausedMutations()
        : Promise.resolve();
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
      this.#n.set(pe(e), { queryKey: e, defaultOptions: t });
    }
    getQueryDefaults(e) {
      const t = [...this.#n.values()],
        s = {};
      return (
        t.forEach((r) => {
          he(e, r.queryKey) && Object.assign(s, r.defaultOptions);
        }),
        s
      );
    }
    setMutationDefaults(e, t) {
      this.#o.set(pe(e), { mutationKey: e, defaultOptions: t });
    }
    getMutationDefaults(e) {
      const t = [...this.#o.values()],
        s = {};
      return (
        t.forEach((r) => {
          he(e, r.mutationKey) && Object.assign(s, r.defaultOptions);
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
        t.queryHash || (t.queryHash = Te(t.queryKey, t)),
        t.refetchOnReconnect === void 0 &&
          (t.refetchOnReconnect = t.networkMode !== "always"),
        t.throwOnError === void 0 && (t.throwOnError = !!t.suspense),
        !t.networkMode && t.persister && (t.networkMode = "offlineFirst"),
        t.queryFn === lt && (t.enabled = !1),
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
function ms({ error: e }) {
  let t = "Oops!",
    s = "An unexpected error occurred.",
    r;
  return (
    Ye(e) &&
      ((t = e.status === 404 ? "404" : "Error"),
      (s =
        e.status === 404
          ? "The requested page could not be found."
          : e.statusText || s)),
    n.jsx("main", {
      className: "flex items-center justify-center min-h-screen p-4",
      children: n.jsxs("div", {
        className: "text-center",
        children: [
          n.jsx("h1", { className: "text-4xl font-bold mb-2", children: t }),
          n.jsx("p", { className: "text-muted-foreground", children: s }),
          r,
        ],
      }),
    })
  );
}
const Ft = 1,
  jt = 1e6;
let J = 0;
function It() {
  return ((J = (J + 1) % Number.MAX_SAFE_INTEGER), J.toString());
}
const Z = new Map(),
  ve = (e) => {
    if (Z.has(e)) return;
    const t = setTimeout(() => {
      (Z.delete(e), k({ type: "REMOVE_TOAST", toastId: e }));
    }, jt);
    Z.set(e, t);
  },
  _t = (e, t) => {
    switch (t.type) {
      case "ADD_TOAST":
        return { ...e, toasts: [t.toast, ...e.toasts].slice(0, Ft) };
      case "UPDATE_TOAST":
        return {
          ...e,
          toasts: e.toasts.map((s) =>
            s.id === t.toast.id ? { ...s, ...t.toast } : s,
          ),
        };
      case "DISMISS_TOAST": {
        const { toastId: s } = t;
        return (
          s
            ? ve(s)
            : e.toasts.forEach((r) => {
                ve(r.id);
              }),
          {
            ...e,
            toasts: e.toasts.map((r) =>
              r.id === s || s === void 0 ? { ...r, open: !1 } : r,
            ),
          }
        );
      }
      case "REMOVE_TOAST":
        return t.toastId === void 0
          ? { ...e, toasts: [] }
          : { ...e, toasts: e.toasts.filter((s) => s.id !== t.toastId) };
    }
  },
  U = [];
let X = { toasts: [] };
function k(e) {
  ((X = _t(X, e)),
    U.forEach((t) => {
      t(X);
    }));
}
function Qt({ ...e }) {
  const t = It(),
    s = (o) => k({ type: "UPDATE_TOAST", toast: { ...o, id: t } }),
    r = () => k({ type: "DISMISS_TOAST", toastId: t });
  return (
    k({
      type: "ADD_TOAST",
      toast: {
        ...e,
        id: t,
        open: !0,
        onOpenChange: (o) => {
          o || r();
        },
      },
    }),
    { id: t, dismiss: r, update: s }
  );
}
function kt() {
  const [e, t] = a.useState(X);
  return (
    a.useEffect(
      () => (
        U.push(t),
        () => {
          const s = U.indexOf(t);
          s > -1 && U.splice(s, 1);
        }
      ),
      [e],
    ),
    {
      ...e,
      toast: Qt,
      dismiss: (s) => k({ type: "DISMISS_TOAST", toastId: s }),
    }
  );
}
var ne = "ToastProvider",
  [oe, Lt, Kt] = mt("Toast"),
  [be] = vt("Toast", [Kt]),
  [qt, z] = be(ne),
  Pe = (e) => {
    const {
        __scopeToast: t,
        label: s = "Notification",
        duration: r = 5e3,
        swipeDirection: o = "right",
        swipeThreshold: i = 50,
        children: f,
      } = e,
      [h, v] = a.useState(null),
      [u, E] = a.useState(0),
      b = a.useRef(!1),
      D = a.useRef(!1);
    return (
      s.trim() ||
        console.error(
          `Invalid prop \`label\` supplied to \`${ne}\`. Expected non-empty \`string\`.`,
        ),
      n.jsx(oe.Provider, {
        scope: t,
        children: n.jsx(qt, {
          scope: t,
          label: s,
          duration: r,
          swipeDirection: o,
          swipeThreshold: i,
          toastCount: u,
          viewport: h,
          onViewportChange: v,
          onToastAdd: a.useCallback(() => E((S) => S + 1), []),
          onToastRemove: a.useCallback(() => E((S) => S - 1), []),
          isFocusedToastEscapeKeyDownRef: b,
          isClosePausedRef: D,
          children: f,
        }),
      })
    );
  };
Pe.displayName = ne;
var Se = "ToastViewport",
  Vt = ["F8"],
  te = "toast.viewportPause",
  se = "toast.viewportResume",
  Ce = a.forwardRef((e, t) => {
    const {
        __scopeToast: s,
        hotkey: r = Vt,
        label: o = "Notifications ({hotkey})",
        ...i
      } = e,
      f = z(Se, s),
      h = Lt(s),
      v = a.useRef(null),
      u = a.useRef(null),
      E = a.useRef(null),
      b = a.useRef(null),
      D = xe(t, b, f.onViewportChange),
      S = r.join("+").replace(/Key/g, "").replace(/Digit/g, ""),
      y = f.toastCount > 0;
    (a.useEffect(() => {
      const c = (w) => {
        r.length !== 0 &&
          r.every((m) => w[m] || w.code === m) &&
          b.current?.focus();
      };
      return (
        document.addEventListener("keydown", c),
        () => document.removeEventListener("keydown", c)
      );
    }, [r]),
      a.useEffect(() => {
        const c = v.current,
          w = b.current;
        if (y && c && w) {
          const p = () => {
              if (!f.isClosePausedRef.current) {
                const g = new CustomEvent(te);
                (w.dispatchEvent(g), (f.isClosePausedRef.current = !0));
              }
            },
            m = () => {
              if (f.isClosePausedRef.current) {
                const g = new CustomEvent(se);
                (w.dispatchEvent(g), (f.isClosePausedRef.current = !1));
              }
            },
            T = (g) => {
              !c.contains(g.relatedTarget) && m();
            },
            x = () => {
              c.contains(document.activeElement) || m();
            };
          return (
            c.addEventListener("focusin", p),
            c.addEventListener("focusout", T),
            c.addEventListener("pointermove", p),
            c.addEventListener("pointerleave", x),
            window.addEventListener("blur", p),
            window.addEventListener("focus", m),
            () => {
              (c.removeEventListener("focusin", p),
                c.removeEventListener("focusout", T),
                c.removeEventListener("pointermove", p),
                c.removeEventListener("pointerleave", x),
                window.removeEventListener("blur", p),
                window.removeEventListener("focus", m));
            }
          );
        }
      }, [y, f.isClosePausedRef]));
    const l = a.useCallback(
      ({ tabbingDirection: c }) => {
        const p = h().map((m) => {
          const T = m.ref.current,
            x = [T, ...ts(T)];
          return c === "forwards" ? x : x.reverse();
        });
        return (c === "forwards" ? p.reverse() : p).flat();
      },
      [h],
    );
    return (
      a.useEffect(() => {
        const c = b.current;
        if (c) {
          const w = (p) => {
            const m = p.altKey || p.ctrlKey || p.metaKey;
            if (p.key === "Tab" && !m) {
              const x = document.activeElement,
                g = p.shiftKey;
              if (p.target === c && g) {
                u.current?.focus();
                return;
              }
              const I = l({ tabbingDirection: g ? "backwards" : "forwards" }),
                q = I.findIndex((M) => M === x);
              ee(I.slice(q + 1))
                ? p.preventDefault()
                : g
                  ? u.current?.focus()
                  : E.current?.focus();
            }
          };
          return (
            c.addEventListener("keydown", w),
            () => c.removeEventListener("keydown", w)
          );
        }
      }, [h, l]),
      n.jsxs(ft, {
        ref: v,
        role: "region",
        "aria-label": o.replace("{hotkey}", S),
        tabIndex: -1,
        style: { pointerEvents: y ? void 0 : "none" },
        children: [
          y &&
            n.jsx(re, {
              ref: u,
              onFocusFromOutsideViewport: () => {
                const c = l({ tabbingDirection: "forwards" });
                ee(c);
              },
            }),
          n.jsx(oe.Slot, {
            scope: s,
            children: n.jsx(N.ol, { tabIndex: -1, ...i, ref: D }),
          }),
          y &&
            n.jsx(re, {
              ref: E,
              onFocusFromOutsideViewport: () => {
                const c = l({ tabbingDirection: "backwards" });
                ee(c);
              },
            }),
        ],
      })
    );
  });
Ce.displayName = Se;
var Re = "ToastFocusProxy",
  re = a.forwardRef((e, t) => {
    const { __scopeToast: s, onFocusFromOutsideViewport: r, ...o } = e,
      i = z(Re, s);
    return n.jsx(Ee, {
      tabIndex: 0,
      ...o,
      ref: t,
      style: { position: "fixed" },
      onFocus: (f) => {
        const h = f.relatedTarget;
        !i.viewport?.contains(h) && r();
      },
    });
  });
re.displayName = Re;
var L = "Toast",
  Ht = "toast.swipeStart",
  Wt = "toast.swipeMove",
  $t = "toast.swipeCancel",
  Bt = "toast.swipeEnd",
  Oe = a.forwardRef((e, t) => {
    const { forceMount: s, open: r, defaultOpen: o, onOpenChange: i, ...f } = e,
      [h, v] = pt({ prop: r, defaultProp: o ?? !0, onChange: i, caller: L });
    return n.jsx(ht, {
      present: s || h,
      children: n.jsx(Yt, {
        open: h,
        ...f,
        ref: t,
        onClose: () => v(!1),
        onPause: Y(e.onPause),
        onResume: Y(e.onResume),
        onSwipeStart: C(e.onSwipeStart, (u) => {
          u.currentTarget.setAttribute("data-swipe", "start");
        }),
        onSwipeMove: C(e.onSwipeMove, (u) => {
          const { x: E, y: b } = u.detail.delta;
          (u.currentTarget.setAttribute("data-swipe", "move"),
            u.currentTarget.style.setProperty(
              "--radix-toast-swipe-move-x",
              `${E}px`,
            ),
            u.currentTarget.style.setProperty(
              "--radix-toast-swipe-move-y",
              `${b}px`,
            ));
        }),
        onSwipeCancel: C(e.onSwipeCancel, (u) => {
          (u.currentTarget.setAttribute("data-swipe", "cancel"),
            u.currentTarget.style.removeProperty("--radix-toast-swipe-move-x"),
            u.currentTarget.style.removeProperty("--radix-toast-swipe-move-y"),
            u.currentTarget.style.removeProperty("--radix-toast-swipe-end-x"),
            u.currentTarget.style.removeProperty("--radix-toast-swipe-end-y"));
        }),
        onSwipeEnd: C(e.onSwipeEnd, (u) => {
          const { x: E, y: b } = u.detail.delta;
          (u.currentTarget.setAttribute("data-swipe", "end"),
            u.currentTarget.style.removeProperty("--radix-toast-swipe-move-x"),
            u.currentTarget.style.removeProperty("--radix-toast-swipe-move-y"),
            u.currentTarget.style.setProperty(
              "--radix-toast-swipe-end-x",
              `${E}px`,
            ),
            u.currentTarget.style.setProperty(
              "--radix-toast-swipe-end-y",
              `${b}px`,
            ),
            v(!1));
        }),
      }),
    });
  });
Oe.displayName = L;
var [Ut, Xt] = be(L, { onClose() {} }),
  Yt = a.forwardRef((e, t) => {
    const {
        __scopeToast: s,
        type: r = "foreground",
        duration: o,
        open: i,
        onClose: f,
        onEscapeKeyDown: h,
        onPause: v,
        onResume: u,
        onSwipeStart: E,
        onSwipeMove: b,
        onSwipeCancel: D,
        onSwipeEnd: S,
        ...y
      } = e,
      l = z(L, s),
      [c, w] = a.useState(null),
      p = xe(t, (d) => w(d)),
      m = a.useRef(null),
      T = a.useRef(null),
      x = o || l.duration,
      g = a.useRef(0),
      j = a.useRef(x),
      K = a.useRef(0),
      { onToastAdd: I, onToastRemove: q } = l,
      M = Y(() => {
        (c?.contains(document.activeElement) && l.viewport?.focus(), f());
      }),
      V = a.useCallback(
        (d) => {
          !d ||
            d === 1 / 0 ||
            (window.clearTimeout(K.current),
            (g.current = new Date().getTime()),
            (K.current = window.setTimeout(M, d)));
        },
        [M],
      );
    (a.useEffect(() => {
      const d = l.viewport;
      if (d) {
        const R = () => {
            (V(j.current), u?.());
          },
          A = () => {
            const _ = new Date().getTime() - g.current;
            ((j.current = j.current - _),
              window.clearTimeout(K.current),
              v?.());
          };
        return (
          d.addEventListener(te, A),
          d.addEventListener(se, R),
          () => {
            (d.removeEventListener(te, A), d.removeEventListener(se, R));
          }
        );
      }
    }, [l.viewport, x, v, u, V]),
      a.useEffect(() => {
        i && !l.isClosePausedRef.current && V(x);
      }, [i, x, l.isClosePausedRef, V]),
      a.useEffect(() => (I(), () => q()), [I, q]));
    const ie = a.useMemo(() => (c ? Ie(c) : null), [c]);
    return l.viewport
      ? n.jsxs(n.Fragment, {
          children: [
            ie &&
              n.jsx(zt, {
                __scopeToast: s,
                role: "status",
                "aria-live": r === "foreground" ? "assertive" : "polite",
                children: ie,
              }),
            n.jsx(Ut, {
              scope: s,
              onClose: M,
              children: ze.createPortal(
                n.jsx(oe.ItemSlot, {
                  scope: s,
                  children: n.jsx(yt, {
                    asChild: !0,
                    onEscapeKeyDown: C(h, () => {
                      (l.isFocusedToastEscapeKeyDownRef.current || M(),
                        (l.isFocusedToastEscapeKeyDownRef.current = !1));
                    }),
                    children: n.jsx(N.li, {
                      tabIndex: 0,
                      "data-state": i ? "open" : "closed",
                      "data-swipe-direction": l.swipeDirection,
                      ...y,
                      ref: p,
                      style: {
                        userSelect: "none",
                        touchAction: "none",
                        ...e.style,
                      },
                      onKeyDown: C(e.onKeyDown, (d) => {
                        d.key === "Escape" &&
                          (h?.(d.nativeEvent),
                          d.nativeEvent.defaultPrevented ||
                            ((l.isFocusedToastEscapeKeyDownRef.current = !0),
                            M()));
                      }),
                      onPointerDown: C(e.onPointerDown, (d) => {
                        d.button === 0 &&
                          (m.current = { x: d.clientX, y: d.clientY });
                      }),
                      onPointerMove: C(e.onPointerMove, (d) => {
                        if (!m.current) return;
                        const R = d.clientX - m.current.x,
                          A = d.clientY - m.current.y,
                          _ = !!T.current,
                          Q = ["left", "right"].includes(l.swipeDirection),
                          H = ["left", "up"].includes(l.swipeDirection)
                            ? Math.min
                            : Math.max,
                          Ue = Q ? H(0, R) : 0,
                          Xe = Q ? 0 : H(0, A),
                          G = d.pointerType === "touch" ? 10 : 2,
                          W = { x: Ue, y: Xe },
                          ce = { originalEvent: d, delta: W };
                        _
                          ? ((T.current = W), B(Wt, b, ce, { discrete: !1 }))
                          : ge(W, l.swipeDirection, G)
                            ? ((T.current = W),
                              B(Ht, E, ce, { discrete: !1 }),
                              d.target.setPointerCapture(d.pointerId))
                            : (Math.abs(R) > G || Math.abs(A) > G) &&
                              (m.current = null);
                      }),
                      onPointerUp: C(e.onPointerUp, (d) => {
                        const R = T.current,
                          A = d.target;
                        if (
                          (A.hasPointerCapture(d.pointerId) &&
                            A.releasePointerCapture(d.pointerId),
                          (T.current = null),
                          (m.current = null),
                          R)
                        ) {
                          const _ = d.currentTarget,
                            Q = { originalEvent: d, delta: R };
                          (ge(R, l.swipeDirection, l.swipeThreshold)
                            ? B(Bt, S, Q, { discrete: !0 })
                            : B($t, D, Q, { discrete: !0 }),
                            _.addEventListener(
                              "click",
                              (H) => H.preventDefault(),
                              { once: !0 },
                            ));
                        }
                      }),
                    }),
                  }),
                }),
                l.viewport,
              ),
            }),
          ],
        })
      : null;
  }),
  zt = (e) => {
    const { __scopeToast: t, children: s, ...r } = e,
      o = z(L, t),
      [i, f] = a.useState(!1),
      [h, v] = a.useState(!1);
    return (
      Zt(() => f(!0)),
      a.useEffect(() => {
        const u = window.setTimeout(() => v(!0), 1e3);
        return () => window.clearTimeout(u);
      }, []),
      h
        ? null
        : n.jsx(gt, {
            asChild: !0,
            children: n.jsx(Ee, {
              ...r,
              children:
                i && n.jsxs(n.Fragment, { children: [o.label, " ", s] }),
            }),
          })
    );
  },
  Gt = "ToastTitle",
  Ae = a.forwardRef((e, t) => {
    const { __scopeToast: s, ...r } = e;
    return n.jsx(N.div, { ...r, ref: t });
  });
Ae.displayName = Gt;
var Jt = "ToastDescription",
  De = a.forwardRef((e, t) => {
    const { __scopeToast: s, ...r } = e;
    return n.jsx(N.div, { ...r, ref: t });
  });
De.displayName = Jt;
var Me = "ToastAction",
  Ne = a.forwardRef((e, t) => {
    const { altText: s, ...r } = e;
    return s.trim()
      ? n.jsx(je, {
          altText: s,
          asChild: !0,
          children: n.jsx(ae, { ...r, ref: t }),
        })
      : (console.error(
          `Invalid prop \`altText\` supplied to \`${Me}\`. Expected non-empty \`string\`.`,
        ),
        null);
  });
Ne.displayName = Me;
var Fe = "ToastClose",
  ae = a.forwardRef((e, t) => {
    const { __scopeToast: s, ...r } = e,
      o = Xt(Fe, s);
    return n.jsx(je, {
      asChild: !0,
      children: n.jsx(N.button, {
        type: "button",
        ...r,
        ref: t,
        onClick: C(e.onClick, o.onClose),
      }),
    });
  });
ae.displayName = Fe;
var je = a.forwardRef((e, t) => {
  const { __scopeToast: s, altText: r, ...o } = e;
  return n.jsx(N.div, {
    "data-radix-toast-announce-exclude": "",
    "data-radix-toast-announce-alt": r || void 0,
    ...o,
    ref: t,
  });
});
function Ie(e) {
  const t = [];
  return (
    Array.from(e.childNodes).forEach((r) => {
      if (
        (r.nodeType === r.TEXT_NODE && r.textContent && t.push(r.textContent),
        es(r))
      ) {
        const o = r.ariaHidden || r.hidden || r.style.display === "none",
          i = r.dataset.radixToastAnnounceExclude === "";
        if (!o)
          if (i) {
            const f = r.dataset.radixToastAnnounceAlt;
            f && t.push(f);
          } else t.push(...Ie(r));
      }
    }),
    t
  );
}
function B(e, t, s, { discrete: r }) {
  const o = s.originalEvent.currentTarget,
    i = new CustomEvent(e, { bubbles: !0, cancelable: !0, detail: s });
  (t && o.addEventListener(e, t, { once: !0 }),
    r ? wt(o, i) : o.dispatchEvent(i));
}
var ge = (e, t, s = 0) => {
  const r = Math.abs(e.x),
    o = Math.abs(e.y),
    i = r > o;
  return t === "left" || t === "right" ? i && r > s : !i && o > s;
};
function Zt(e = () => {}) {
  const t = Y(e);
  Tt(() => {
    let s = 0,
      r = 0;
    return (
      (s = window.requestAnimationFrame(
        () => (r = window.requestAnimationFrame(t)),
      )),
      () => {
        (window.cancelAnimationFrame(s), window.cancelAnimationFrame(r));
      }
    );
  }, [t]);
}
function es(e) {
  return e.nodeType === e.ELEMENT_NODE;
}
function ts(e) {
  const t = [],
    s = document.createTreeWalker(e, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (r) => {
        const o = r.tagName === "INPUT" && r.type === "hidden";
        return r.disabled || r.hidden || o
          ? NodeFilter.FILTER_SKIP
          : r.tabIndex >= 0
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
      },
    });
  for (; s.nextNode(); ) t.push(s.currentNode);
  return t;
}
function ee(e) {
  const t = document.activeElement;
  return e.some((s) =>
    s === t ? !0 : (s.focus(), document.activeElement !== t),
  );
}
var ss = Pe,
  _e = Ce,
  Qe = Oe,
  ke = Ae,
  Le = De,
  Ke = Ne,
  qe = ae;
const rs = [
    ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
    ["path", { d: "m6 6 12 12", key: "d8bk6v" }],
  ],
  ns = xt("x", rs),
  os = ss,
  Ve = a.forwardRef(({ className: e, ...t }, s) =>
    n.jsx(_e, {
      ref: s,
      className: F(
        "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
        e,
      ),
      ...t,
    }),
  );
Ve.displayName = _e.displayName;
const as = Et(
    "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full",
    {
      variants: {
        variant: {
          default: "border bg-background text-foreground",
          destructive:
            "destructive group border-destructive bg-destructive text-destructive-foreground",
        },
      },
      defaultVariants: { variant: "default" },
    },
  ),
  He = a.forwardRef(({ className: e, variant: t, ...s }, r) =>
    n.jsx(Qe, { ref: r, className: F(as({ variant: t }), e), ...s }),
  );
He.displayName = Qe.displayName;
const is = a.forwardRef(({ className: e, ...t }, s) =>
  n.jsx(Ke, {
    ref: s,
    className: F(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-muted/40 group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground group-[.destructive]:focus:ring-destructive",
      e,
    ),
    ...t,
  }),
);
is.displayName = Ke.displayName;
const We = a.forwardRef(({ className: e, ...t }, s) =>
  n.jsx(qe, {
    ref: s,
    className: F(
      "absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600",
      e,
    ),
    "toast-close": "",
    ...t,
    children: n.jsx(ns, { className: "h-4 w-4" }),
  }),
);
We.displayName = qe.displayName;
const $e = a.forwardRef(({ className: e, ...t }, s) =>
  n.jsx(ke, { ref: s, className: F("text-sm font-semibold", e), ...t }),
);
$e.displayName = ke.displayName;
const Be = a.forwardRef(({ className: e, ...t }, s) =>
  n.jsx(Le, { ref: s, className: F("text-sm opacity-90", e), ...t }),
);
Be.displayName = Le.displayName;
function cs() {
  const { toasts: e } = kt();
  return n.jsxs(os, {
    children: [
      e.map(function ({ id: t, title: s, description: r, action: o, ...i }) {
        return n.jsxs(
          He,
          {
            ...i,
            children: [
              n.jsxs("div", {
                className: "grid gap-1",
                children: [
                  s && n.jsx($e, { children: s }),
                  r && n.jsx(Be, { children: r }),
                ],
              }),
              o,
              n.jsx(We, {}),
            ],
          },
          t,
        );
      }),
      n.jsx(Ve, {}),
    ],
  });
}
const us = ({ ...e }) => {
  const { theme: t = "system" } = bt();
  return n.jsx(Ot, {
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
function ds() {
  const e = Pt();
  a.useEffect(() => {
    const t = new EventSource("/api/events");
    return (
      (t.onmessage = () => {
        (e.invalidateQueries({ queryKey: ["documents"] }),
          e.invalidateQueries({ queryKey: ["document"] }));
      }),
      (t.onerror = (s) => {
        console.error("[FileWatcher] SSE connection error", s);
      }),
      () => {
        t.close();
      }
    );
  }, [e]);
}
function ys({ children: e }) {
  return n.jsxs("html", {
    lang: "en",
    suppressHydrationWarning: !0,
    children: [
      n.jsxs("head", {
        children: [
          n.jsx("meta", { charSet: "utf-8" }),
          n.jsx("meta", {
            name: "viewport",
            content: "width=device-width, initial-scale=1",
          }),
          n.jsx(Je, {}),
          n.jsx(Ze, {}),
        ],
      }),
      n.jsxs("body", { children: [e, n.jsx(et, {}), n.jsx(tt, {})] }),
    ],
  });
}
function ls() {
  return (ds(), null);
}
const vs = Ge(function () {
  const [t] = a.useState(() => new Nt());
  return n.jsx(St, {
    attribute: "class",
    defaultTheme: "dark",
    enableSystem: !1,
    children: n.jsxs(Ct, {
      client: t,
      children: [
        n.jsx(ls, {}),
        n.jsxs(Rt, { children: [n.jsx(cs, {}), n.jsx(us, {}), n.jsx(st, {})] }),
      ],
    }),
  });
});
export { ms as ErrorBoundary, ys as Layout, vs as default };
