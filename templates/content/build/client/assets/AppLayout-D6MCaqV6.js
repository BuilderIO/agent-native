import { a as s, q as i, C as _n, v as Pn } from "./index-BMHtNQid.js";
import {
  S as Bt,
  Y as Et,
  Z as z,
  _ as Re,
  r as ce,
  d as Me,
  $ as Ze,
  a0 as Rt,
  a1 as Tn,
  a2 as ge,
  g as Nn,
  a3 as In,
  a4 as Mt,
  n as Ae,
  j as _t,
  a5 as jn,
  a6 as st,
  F as de,
  A as $,
  u as F,
  P as O,
  l as Y,
  q as C,
  w as De,
  t as L,
  z as An,
  C as j,
  a7 as at,
  D as Dn,
  E as On,
  a8 as kn,
  a9 as Fn,
  aa as Ln,
  ab as Je,
  v as Wt,
  k as Gt,
  x as Un,
  ac as Ht,
  ad as Kn,
  ae as zn,
  af as $n,
  y as Bn,
  ag as Wn,
  ah as Gn,
  ai as Hn,
} from "./createLucideIcon-rfCLSgWW.js";
var Vn = class extends Bt {
  constructor(e, t) {
    (super(),
      (this.options = t),
      (this.#r = e),
      (this.#i = null),
      (this.#a = Et()),
      this.bindMethods(),
      this.setOptions(t));
  }
  #r;
  #e = void 0;
  #n = void 0;
  #t = void 0;
  #o;
  #s;
  #a;
  #i;
  #m;
  #f;
  #h;
  #l;
  #u;
  #c;
  #p = new Set();
  bindMethods() {
    this.refetch = this.refetch.bind(this);
  }
  onSubscribe() {
    this.listeners.size === 1 &&
      (this.#e.addObserver(this),
      Pt(this.#e, this.options) ? this.#d() : this.updateResult(),
      this.#y());
  }
  onUnsubscribe() {
    this.hasListeners() || this.destroy();
  }
  shouldFetchOnReconnect() {
    return et(this.#e, this.options, this.options.refetchOnReconnect);
  }
  shouldFetchOnWindowFocus() {
    return et(this.#e, this.options, this.options.refetchOnWindowFocus);
  }
  destroy() {
    ((this.listeners = new Set()),
      this.#x(),
      this.#w(),
      this.#e.removeObserver(this));
  }
  setOptions(e) {
    const t = this.options,
      r = this.#e;
    if (
      ((this.options = this.#r.defaultQueryOptions(e)),
      this.options.enabled !== void 0 &&
        typeof this.options.enabled != "boolean" &&
        typeof this.options.enabled != "function" &&
        typeof z(this.options.enabled, this.#e) != "boolean")
    )
      throw new Error(
        "Expected enabled to be a boolean or a callback that returns a boolean",
      );
    (this.#S(),
      this.#e.setOptions(this.options),
      t._defaulted &&
        !Re(this.options, t) &&
        this.#r.getQueryCache().notify({
          type: "observerOptionsUpdated",
          query: this.#e,
          observer: this,
        }));
    const n = this.hasListeners();
    (n && Tt(this.#e, r, this.options, t) && this.#d(),
      this.updateResult(),
      n &&
        (this.#e !== r ||
          z(this.options.enabled, this.#e) !== z(t.enabled, this.#e) ||
          ce(this.options.staleTime, this.#e) !== ce(t.staleTime, this.#e)) &&
        this.#v());
    const o = this.#g();
    n &&
      (this.#e !== r ||
        z(this.options.enabled, this.#e) !== z(t.enabled, this.#e) ||
        o !== this.#c) &&
      this.#b(o);
  }
  getOptimisticResult(e) {
    const t = this.#r.getQueryCache().build(this.#r, e),
      r = this.createResult(t, e);
    return (
      Xn(this, r) &&
        ((this.#t = r), (this.#s = this.options), (this.#o = this.#e.state)),
      r
    );
  }
  getCurrentResult() {
    return this.#t;
  }
  trackResult(e, t) {
    return new Proxy(e, {
      get: (r, n) => (
        this.trackProp(n),
        t?.(n),
        n === "promise" &&
          (this.trackProp("data"),
          !this.options.experimental_prefetchInRender &&
            this.#a.status === "pending" &&
            this.#a.reject(
              new Error(
                "experimental_prefetchInRender feature flag is not enabled",
              ),
            )),
        Reflect.get(r, n)
      ),
    });
  }
  trackProp(e) {
    this.#p.add(e);
  }
  getCurrentQuery() {
    return this.#e;
  }
  refetch({ ...e } = {}) {
    return this.fetch({ ...e });
  }
  fetchOptimistic(e) {
    const t = this.#r.defaultQueryOptions(e),
      r = this.#r.getQueryCache().build(this.#r, t);
    return r.fetch().then(() => this.createResult(r, t));
  }
  fetch(e) {
    return this.#d({ ...e, cancelRefetch: e.cancelRefetch ?? !0 }).then(
      () => (this.updateResult(), this.#t),
    );
  }
  #d(e) {
    this.#S();
    let t = this.#e.fetch(this.options, e);
    return (e?.throwOnError || (t = t.catch(Me)), t);
  }
  #v() {
    this.#x();
    const e = ce(this.options.staleTime, this.#e);
    if (Ze || this.#t.isStale || !Rt(e)) return;
    const r = Tn(this.#t.dataUpdatedAt, e) + 1;
    this.#l = ge.setTimeout(() => {
      this.#t.isStale || this.updateResult();
    }, r);
  }
  #g() {
    return (
      (typeof this.options.refetchInterval == "function"
        ? this.options.refetchInterval(this.#e)
        : this.options.refetchInterval) ?? !1
    );
  }
  #b(e) {
    (this.#w(),
      (this.#c = e),
      !(
        Ze ||
        z(this.options.enabled, this.#e) === !1 ||
        !Rt(this.#c) ||
        this.#c === 0
      ) &&
        (this.#u = ge.setInterval(() => {
          (this.options.refetchIntervalInBackground || Nn.isFocused()) &&
            this.#d();
        }, this.#c)));
  }
  #y() {
    (this.#v(), this.#b(this.#g()));
  }
  #x() {
    this.#l && (ge.clearTimeout(this.#l), (this.#l = void 0));
  }
  #w() {
    this.#u && (ge.clearInterval(this.#u), (this.#u = void 0));
  }
  createResult(e, t) {
    const r = this.#e,
      n = this.options,
      o = this.#t,
      a = this.#o,
      l = this.#s,
      p = e !== r ? e.state : this.#n,
      { state: f } = e;
    let u = { ...f },
      d = !1,
      h;
    if (t._optimisticResults) {
      const R = this.hasListeners(),
        M = !R && Pt(e, t),
        T = R && Tt(e, r, t, n);
      ((M || T) && (u = { ...u, ...In(f.data, e.options) }),
        t._optimisticResults === "isRestoring" && (u.fetchStatus = "idle"));
    }
    let { error: g, errorUpdatedAt: y, status: v } = u;
    h = u.data;
    let m = !1;
    if (t.placeholderData !== void 0 && h === void 0 && v === "pending") {
      let R;
      (o?.isPlaceholderData && t.placeholderData === l?.placeholderData
        ? ((R = o.data), (m = !0))
        : (R =
            typeof t.placeholderData == "function"
              ? t.placeholderData(this.#h?.state.data, this.#h)
              : t.placeholderData),
        R !== void 0 && ((v = "success"), (h = Mt(o?.data, R, t)), (d = !0)));
    }
    if (t.select && h !== void 0 && !m)
      if (o && h === a?.data && t.select === this.#m) h = this.#f;
      else
        try {
          ((this.#m = t.select),
            (h = t.select(h)),
            (h = Mt(o?.data, h, t)),
            (this.#f = h),
            (this.#i = null));
        } catch (R) {
          this.#i = R;
        }
    this.#i && ((g = this.#i), (h = this.#f), (y = Date.now()), (v = "error"));
    const b = u.fetchStatus === "fetching",
      E = v === "pending",
      x = v === "error",
      w = E && b,
      _ = h !== void 0,
      P = {
        status: v,
        fetchStatus: u.fetchStatus,
        isPending: E,
        isSuccess: v === "success",
        isError: x,
        isInitialLoading: w,
        isLoading: w,
        data: h,
        dataUpdatedAt: u.dataUpdatedAt,
        error: g,
        errorUpdatedAt: y,
        failureCount: u.fetchFailureCount,
        failureReason: u.fetchFailureReason,
        errorUpdateCount: u.errorUpdateCount,
        isFetched: u.dataUpdateCount > 0 || u.errorUpdateCount > 0,
        isFetchedAfterMount:
          u.dataUpdateCount > p.dataUpdateCount ||
          u.errorUpdateCount > p.errorUpdateCount,
        isFetching: b,
        isRefetching: b && !E,
        isLoadingError: x && !_,
        isPaused: u.fetchStatus === "paused",
        isPlaceholderData: d,
        isRefetchError: x && _,
        isStale: it(e, t),
        refetch: this.refetch,
        promise: this.#a,
        isEnabled: z(t.enabled, e) !== !1,
      };
    if (this.options.experimental_prefetchInRender) {
      const R = P.data !== void 0,
        M = P.status === "error" && !R,
        T = (G) => {
          M ? G.reject(P.error) : R && G.resolve(P.data);
        },
        I = () => {
          const G = (this.#a = P.promise = Et());
          T(G);
        },
        D = this.#a;
      switch (D.status) {
        case "pending":
          e.queryHash === r.queryHash && T(D);
          break;
        case "fulfilled":
          (M || P.data !== D.value) && I();
          break;
        case "rejected":
          (!M || P.error !== D.reason) && I();
          break;
      }
    }
    return P;
  }
  updateResult() {
    const e = this.#t,
      t = this.createResult(this.#e, this.options);
    if (
      ((this.#o = this.#e.state),
      (this.#s = this.options),
      this.#o.data !== void 0 && (this.#h = this.#e),
      Re(t, e))
    )
      return;
    this.#t = t;
    const r = () => {
      if (!e) return !0;
      const { notifyOnChangeProps: n } = this.options,
        o = typeof n == "function" ? n() : n;
      if (o === "all" || (!o && !this.#p.size)) return !0;
      const a = new Set(o ?? this.#p);
      return (
        this.options.throwOnError && a.add("error"),
        Object.keys(this.#t).some((l) => {
          const c = l;
          return this.#t[c] !== e[c] && a.has(c);
        })
      );
    };
    this.#C({ listeners: r() });
  }
  #S() {
    const e = this.#r.getQueryCache().build(this.#r, this.options);
    if (e === this.#e) return;
    const t = this.#e;
    ((this.#e = e),
      (this.#n = e.state),
      this.hasListeners() && (t?.removeObserver(this), e.addObserver(this)));
  }
  onQueryUpdate() {
    (this.updateResult(), this.hasListeners() && this.#y());
  }
  #C(e) {
    Ae.batch(() => {
      (e.listeners &&
        this.listeners.forEach((t) => {
          t(this.#t);
        }),
        this.#r
          .getQueryCache()
          .notify({ query: this.#e, type: "observerResultsUpdated" }));
    });
  }
};
function Yn(e, t) {
  return (
    z(t.enabled, e) !== !1 &&
    e.state.data === void 0 &&
    !(e.state.status === "error" && t.retryOnMount === !1)
  );
}
function Pt(e, t) {
  return Yn(e, t) || (e.state.data !== void 0 && et(e, t, t.refetchOnMount));
}
function et(e, t, r) {
  if (z(t.enabled, e) !== !1 && ce(t.staleTime, e) !== "static") {
    const n = typeof r == "function" ? r(e) : r;
    return n === "always" || (n !== !1 && it(e, t));
  }
  return !1;
}
function Tt(e, t, r, n) {
  return (
    (e !== t || z(n.enabled, e) === !1) &&
    (!r.suspense || e.state.status !== "error") &&
    it(e, r)
  );
}
function it(e, t) {
  return z(t.enabled, e) !== !1 && e.isStaleByTime(ce(t.staleTime, e));
}
function Xn(e, t) {
  return !Re(e.getCurrentResult(), t);
}
var Qn = class extends Bt {
    #r;
    #e = void 0;
    #n;
    #t;
    constructor(t, r) {
      (super(),
        (this.#r = t),
        this.setOptions(r),
        this.bindMethods(),
        this.#o());
    }
    bindMethods() {
      ((this.mutate = this.mutate.bind(this)),
        (this.reset = this.reset.bind(this)));
    }
    setOptions(t) {
      const r = this.options;
      ((this.options = this.#r.defaultMutationOptions(t)),
        Re(this.options, r) ||
          this.#r.getMutationCache().notify({
            type: "observerOptionsUpdated",
            mutation: this.#n,
            observer: this,
          }),
        r?.mutationKey &&
        this.options.mutationKey &&
        _t(r.mutationKey) !== _t(this.options.mutationKey)
          ? this.reset()
          : this.#n?.state.status === "pending" &&
            this.#n.setOptions(this.options));
    }
    onUnsubscribe() {
      this.hasListeners() || this.#n?.removeObserver(this);
    }
    onMutationUpdate(t) {
      (this.#o(), this.#s(t));
    }
    getCurrentResult() {
      return this.#e;
    }
    reset() {
      (this.#n?.removeObserver(this), (this.#n = void 0), this.#o(), this.#s());
    }
    mutate(t, r) {
      return (
        (this.#t = r),
        this.#n?.removeObserver(this),
        (this.#n = this.#r.getMutationCache().build(this.#r, this.options)),
        this.#n.addObserver(this),
        this.#n.execute(t)
      );
    }
    #o() {
      const t = this.#n?.state ?? jn();
      this.#e = {
        ...t,
        isPending: t.status === "pending",
        isSuccess: t.status === "success",
        isError: t.status === "error",
        isIdle: t.status === "idle",
        mutate: this.mutate,
        reset: this.reset,
      };
    }
    #s(t) {
      Ae.batch(() => {
        if (this.#t && this.hasListeners()) {
          const r = this.#e.variables,
            n = this.#e.context,
            o = {
              client: this.#r,
              meta: this.options.meta,
              mutationKey: this.options.mutationKey,
            };
          if (t?.type === "success") {
            try {
              this.#t.onSuccess?.(t.data, r, n, o);
            } catch (a) {
              Promise.reject(a);
            }
            try {
              this.#t.onSettled?.(t.data, null, r, n, o);
            } catch (a) {
              Promise.reject(a);
            }
          } else if (t?.type === "error") {
            try {
              this.#t.onError?.(t.error, r, n, o);
            } catch (a) {
              Promise.reject(a);
            }
            try {
              this.#t.onSettled?.(void 0, t.error, r, n, o);
            } catch (a) {
              Promise.reject(a);
            }
          }
        }
        this.listeners.forEach((r) => {
          r(this.#e);
        });
      });
    }
  },
  Vt = s.createContext(!1),
  qn = () => s.useContext(Vt);
Vt.Provider;
function Zn() {
  let e = !1;
  return {
    clearReset: () => {
      e = !1;
    },
    reset: () => {
      e = !0;
    },
    isReset: () => e,
  };
}
var Jn = s.createContext(Zn()),
  eo = () => s.useContext(Jn),
  to = (e, t, r) => {
    const n =
      r?.state.error && typeof e.throwOnError == "function"
        ? st(e.throwOnError, [r.state.error, r])
        : e.throwOnError;
    (e.suspense || e.experimental_prefetchInRender || n) &&
      (t.isReset() || (e.retryOnMount = !1));
  },
  ro = (e) => {
    s.useEffect(() => {
      e.clearReset();
    }, [e]);
  },
  no = ({
    result: e,
    errorResetBoundary: t,
    throwOnError: r,
    query: n,
    suspense: o,
  }) =>
    e.isError &&
    !t.isReset() &&
    !e.isFetching &&
    n &&
    ((o && e.data === void 0) || st(r, [e.error, n])),
  oo = (e) => {
    if (e.suspense) {
      const r = (o) => (o === "static" ? o : Math.max(o ?? 1e3, 1e3)),
        n = e.staleTime;
      ((e.staleTime = typeof n == "function" ? (...o) => r(n(...o)) : r(n)),
        typeof e.gcTime == "number" && (e.gcTime = Math.max(e.gcTime, 1e3)));
    }
  },
  so = (e, t) => e.isLoading && e.isFetching && !t,
  ao = (e, t) => e?.suspense && t.isPending,
  Nt = (e, t, r) =>
    t.fetchOptimistic(e).catch(() => {
      r.clearReset();
    });
function io(e, t, r) {
  const n = qn(),
    o = eo(),
    a = de(),
    l = a.defaultQueryOptions(e);
  a.getDefaultOptions().queries?._experimental_beforeQuery?.(l);
  const c = a.getQueryCache().get(l.queryHash);
  ((l._optimisticResults = n ? "isRestoring" : "optimistic"),
    oo(l),
    to(l, o, c),
    ro(o));
  const p = !a.getQueryCache().get(l.queryHash),
    [f] = s.useState(() => new t(a, l)),
    u = f.getOptimisticResult(l),
    d = !n && e.subscribed !== !1;
  if (
    (s.useSyncExternalStore(
      s.useCallback(
        (h) => {
          const g = d ? f.subscribe(Ae.batchCalls(h)) : Me;
          return (f.updateResult(), g);
        },
        [f, d],
      ),
      () => f.getCurrentResult(),
      () => f.getCurrentResult(),
    ),
    s.useEffect(() => {
      f.setOptions(l);
    }, [l, f]),
    ao(l, u))
  )
    throw Nt(l, f, o);
  if (
    no({
      result: u,
      errorResetBoundary: o,
      throwOnError: l.throwOnError,
      query: c,
      suspense: l.suspense,
    })
  )
    throw u.error;
  return (
    a.getDefaultOptions().queries?._experimental_afterQuery?.(l, u),
    l.experimental_prefetchInRender &&
      !Ze &&
      so(u, n) &&
      (p ? Nt(l, f, o) : c?.promise)?.catch(Me).finally(() => {
        f.updateResult();
      }),
    l.notifyOnChangeProps ? u : f.trackResult(u)
  );
}
function Yt(e, t) {
  return io(e, Vn);
}
function ct(e, t) {
  const r = de(),
    [n] = s.useState(() => new Qn(r, e));
  s.useEffect(() => {
    n.setOptions(e);
  }, [n, e]);
  const o = s.useSyncExternalStore(
      s.useCallback((l) => n.subscribe(Ae.batchCalls(l)), [n]),
      () => n.getCurrentResult(),
      () => n.getCurrentResult(),
    ),
    a = s.useCallback(
      (l, c) => {
        n.mutate(l, c).catch(Me);
      },
      [n],
    );
  if (o.error && st(n.options.throwOnError, [o.error])) throw o.error;
  return { ...o, mutate: a, mutateAsync: o.mutate };
}
const co = [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]],
  lo = $("check", co);
const uo = [["path", { d: "m9 18 6-6-6-6", key: "mthhwq" }]],
  Xt = $("chevron-right", uo);
const fo = [["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }]],
  ho = $("circle", fo);
const po = [
    ["circle", { cx: "12", cy: "12", r: "1", key: "41hilf" }],
    ["circle", { cx: "19", cy: "12", r: "1", key: "1wjl8i" }],
    ["circle", { cx: "5", cy: "12", r: "1", key: "1pcz8c" }],
  ],
  mo = $("ellipsis", po);
const vo = [
    [
      "path",
      {
        d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",
        key: "1rqfz7",
      },
    ],
    ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
    ["path", { d: "M10 9H8", key: "b1mrlr" }],
    ["path", { d: "M16 13H8", key: "t4e002" }],
    ["path", { d: "M16 17H8", key: "z1uh3a" }],
  ],
  tt = $("file-text", vo);
const go = [
    [
      "path",
      {
        d: "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401",
        key: "kfwtm",
      },
    ],
  ],
  bo = $("moon", go);
const yo = [
    ["path", { d: "M5 12h14", key: "1ays0h" }],
    ["path", { d: "M12 5v14", key: "s699le" }],
  ],
  _e = $("plus", yo);
const xo = [
    ["path", { d: "m21 21-4.34-4.34", key: "14j7rj" }],
    ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }],
  ],
  wo = $("search", xo);
const So = [
    [
      "path",
      {
        d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
        key: "r04s7s",
      },
    ],
  ],
  Qt = $("star", So);
const Co = [
    ["circle", { cx: "12", cy: "12", r: "4", key: "4exip2" }],
    ["path", { d: "M12 2v2", key: "tus03m" }],
    ["path", { d: "M12 20v2", key: "1lh1kg" }],
    ["path", { d: "m4.93 4.93 1.41 1.41", key: "149t6j" }],
    ["path", { d: "m17.66 17.66 1.41 1.41", key: "ptbguv" }],
    ["path", { d: "M2 12h2", key: "1t8f8n" }],
    ["path", { d: "M20 12h2", key: "1q8mjw" }],
    ["path", { d: "m6.34 17.66-1.41 1.41", key: "1m8zz5" }],
    ["path", { d: "m19.07 4.93-1.41 1.41", key: "1shlcs" }],
  ],
  Eo = $("sun", Co);
const Ro = [
    ["path", { d: "M10 11v6", key: "nco0om" }],
    ["path", { d: "M14 11v6", key: "outv1u" }],
    ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", key: "miytrc" }],
    ["path", { d: "M3 6h18", key: "d0wm0j" }],
    ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", key: "e791ji" }],
  ],
  Mo = $("trash-2", Ro);
var _o = s.createContext(void 0);
function lt(e) {
  const t = s.useContext(_o);
  return e || t || "ltr";
}
function Po(e, [t, r]) {
  return Math.min(r, Math.max(t, e));
}
function To(e, t) {
  return s.useReducer((r, n) => t[r][n] ?? r, e);
}
var ut = "ScrollArea",
  [qt] = De(ut),
  [No, K] = qt(ut),
  Zt = s.forwardRef((e, t) => {
    const {
        __scopeScrollArea: r,
        type: n = "hover",
        dir: o,
        scrollHideDelay: a = 600,
        ...l
      } = e,
      [c, p] = s.useState(null),
      [f, u] = s.useState(null),
      [d, h] = s.useState(null),
      [g, y] = s.useState(null),
      [v, m] = s.useState(null),
      [b, E] = s.useState(0),
      [x, w] = s.useState(0),
      [_, N] = s.useState(!1),
      [P, R] = s.useState(!1),
      M = F(t, (I) => p(I)),
      T = lt(o);
    return i.jsx(No, {
      scope: r,
      type: n,
      dir: T,
      scrollHideDelay: a,
      scrollArea: c,
      viewport: f,
      onViewportChange: u,
      content: d,
      onContentChange: h,
      scrollbarX: g,
      onScrollbarXChange: y,
      scrollbarXEnabled: _,
      onScrollbarXEnabledChange: N,
      scrollbarY: v,
      onScrollbarYChange: m,
      scrollbarYEnabled: P,
      onScrollbarYEnabledChange: R,
      onCornerWidthChange: E,
      onCornerHeightChange: w,
      children: i.jsx(O.div, {
        dir: T,
        ...l,
        ref: M,
        style: {
          position: "relative",
          "--radix-scroll-area-corner-width": b + "px",
          "--radix-scroll-area-corner-height": x + "px",
          ...e.style,
        },
      }),
    });
  });
Zt.displayName = ut;
var Jt = "ScrollAreaViewport",
  er = s.forwardRef((e, t) => {
    const { __scopeScrollArea: r, children: n, nonce: o, ...a } = e,
      l = K(Jt, r),
      c = s.useRef(null),
      p = F(t, c, l.onViewportChange);
    return i.jsxs(i.Fragment, {
      children: [
        i.jsx("style", {
          dangerouslySetInnerHTML: {
            __html:
              "[data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none}",
          },
          nonce: o,
        }),
        i.jsx(O.div, {
          "data-radix-scroll-area-viewport": "",
          ...a,
          ref: p,
          style: {
            overflowX: l.scrollbarXEnabled ? "scroll" : "hidden",
            overflowY: l.scrollbarYEnabled ? "scroll" : "hidden",
            ...e.style,
          },
          children: i.jsx("div", {
            ref: l.onContentChange,
            style: { minWidth: "100%", display: "table" },
            children: n,
          }),
        }),
      ],
    });
  });
er.displayName = Jt;
var W = "ScrollAreaScrollbar",
  dt = s.forwardRef((e, t) => {
    const { forceMount: r, ...n } = e,
      o = K(W, e.__scopeScrollArea),
      { onScrollbarXEnabledChange: a, onScrollbarYEnabledChange: l } = o,
      c = e.orientation === "horizontal";
    return (
      s.useEffect(
        () => (
          c ? a(!0) : l(!0),
          () => {
            c ? a(!1) : l(!1);
          }
        ),
        [c, a, l],
      ),
      o.type === "hover"
        ? i.jsx(Io, { ...n, ref: t, forceMount: r })
        : o.type === "scroll"
          ? i.jsx(jo, { ...n, ref: t, forceMount: r })
          : o.type === "auto"
            ? i.jsx(tr, { ...n, ref: t, forceMount: r })
            : o.type === "always"
              ? i.jsx(ft, { ...n, ref: t })
              : null
    );
  });
dt.displayName = W;
var Io = s.forwardRef((e, t) => {
    const { forceMount: r, ...n } = e,
      o = K(W, e.__scopeScrollArea),
      [a, l] = s.useState(!1);
    return (
      s.useEffect(() => {
        const c = o.scrollArea;
        let p = 0;
        if (c) {
          const f = () => {
              (window.clearTimeout(p), l(!0));
            },
            u = () => {
              p = window.setTimeout(() => l(!1), o.scrollHideDelay);
            };
          return (
            c.addEventListener("pointerenter", f),
            c.addEventListener("pointerleave", u),
            () => {
              (window.clearTimeout(p),
                c.removeEventListener("pointerenter", f),
                c.removeEventListener("pointerleave", u));
            }
          );
        }
      }, [o.scrollArea, o.scrollHideDelay]),
      i.jsx(Y, {
        present: r || a,
        children: i.jsx(tr, {
          "data-state": a ? "visible" : "hidden",
          ...n,
          ref: t,
        }),
      })
    );
  }),
  jo = s.forwardRef((e, t) => {
    const { forceMount: r, ...n } = e,
      o = K(W, e.__scopeScrollArea),
      a = e.orientation === "horizontal",
      l = ke(() => p("SCROLL_END"), 100),
      [c, p] = To("hidden", {
        hidden: { SCROLL: "scrolling" },
        scrolling: { SCROLL_END: "idle", POINTER_ENTER: "interacting" },
        interacting: { SCROLL: "interacting", POINTER_LEAVE: "idle" },
        idle: {
          HIDE: "hidden",
          SCROLL: "scrolling",
          POINTER_ENTER: "interacting",
        },
      });
    return (
      s.useEffect(() => {
        if (c === "idle") {
          const f = window.setTimeout(() => p("HIDE"), o.scrollHideDelay);
          return () => window.clearTimeout(f);
        }
      }, [c, o.scrollHideDelay, p]),
      s.useEffect(() => {
        const f = o.viewport,
          u = a ? "scrollLeft" : "scrollTop";
        if (f) {
          let d = f[u];
          const h = () => {
            const g = f[u];
            (d !== g && (p("SCROLL"), l()), (d = g));
          };
          return (
            f.addEventListener("scroll", h),
            () => f.removeEventListener("scroll", h)
          );
        }
      }, [o.viewport, a, p, l]),
      i.jsx(Y, {
        present: r || c !== "hidden",
        children: i.jsx(ft, {
          "data-state": c === "hidden" ? "hidden" : "visible",
          ...n,
          ref: t,
          onPointerEnter: C(e.onPointerEnter, () => p("POINTER_ENTER")),
          onPointerLeave: C(e.onPointerLeave, () => p("POINTER_LEAVE")),
        }),
      })
    );
  }),
  tr = s.forwardRef((e, t) => {
    const r = K(W, e.__scopeScrollArea),
      { forceMount: n, ...o } = e,
      [a, l] = s.useState(!1),
      c = e.orientation === "horizontal",
      p = ke(() => {
        if (r.viewport) {
          const f = r.viewport.offsetWidth < r.viewport.scrollWidth,
            u = r.viewport.offsetHeight < r.viewport.scrollHeight;
          l(c ? f : u);
        }
      }, 10);
    return (
      oe(r.viewport, p),
      oe(r.content, p),
      i.jsx(Y, {
        present: n || a,
        children: i.jsx(ft, {
          "data-state": a ? "visible" : "hidden",
          ...o,
          ref: t,
        }),
      })
    );
  }),
  ft = s.forwardRef((e, t) => {
    const { orientation: r = "vertical", ...n } = e,
      o = K(W, e.__scopeScrollArea),
      a = s.useRef(null),
      l = s.useRef(0),
      [c, p] = s.useState({
        content: 0,
        viewport: 0,
        scrollbar: { size: 0, paddingStart: 0, paddingEnd: 0 },
      }),
      f = ar(c.viewport, c.content),
      u = {
        ...n,
        sizes: c,
        onSizesChange: p,
        hasThumb: f > 0 && f < 1,
        onThumbChange: (h) => (a.current = h),
        onThumbPointerUp: () => (l.current = 0),
        onThumbPointerDown: (h) => (l.current = h),
      };
    function d(h, g) {
      return Lo(h, l.current, c, g);
    }
    return r === "horizontal"
      ? i.jsx(Ao, {
          ...u,
          ref: t,
          onThumbPositionChange: () => {
            if (o.viewport && a.current) {
              const h = o.viewport.scrollLeft,
                g = It(h, c, o.dir);
              a.current.style.transform = `translate3d(${g}px, 0, 0)`;
            }
          },
          onWheelScroll: (h) => {
            o.viewport && (o.viewport.scrollLeft = h);
          },
          onDragScroll: (h) => {
            o.viewport && (o.viewport.scrollLeft = d(h, o.dir));
          },
        })
      : r === "vertical"
        ? i.jsx(Do, {
            ...u,
            ref: t,
            onThumbPositionChange: () => {
              if (o.viewport && a.current) {
                const h = o.viewport.scrollTop,
                  g = It(h, c);
                a.current.style.transform = `translate3d(0, ${g}px, 0)`;
              }
            },
            onWheelScroll: (h) => {
              o.viewport && (o.viewport.scrollTop = h);
            },
            onDragScroll: (h) => {
              o.viewport && (o.viewport.scrollTop = d(h));
            },
          })
        : null;
  }),
  Ao = s.forwardRef((e, t) => {
    const { sizes: r, onSizesChange: n, ...o } = e,
      a = K(W, e.__scopeScrollArea),
      [l, c] = s.useState(),
      p = s.useRef(null),
      f = F(t, p, a.onScrollbarXChange);
    return (
      s.useEffect(() => {
        p.current && c(getComputedStyle(p.current));
      }, [p]),
      i.jsx(nr, {
        "data-orientation": "horizontal",
        ...o,
        ref: f,
        sizes: r,
        style: {
          bottom: 0,
          left: a.dir === "rtl" ? "var(--radix-scroll-area-corner-width)" : 0,
          right: a.dir === "ltr" ? "var(--radix-scroll-area-corner-width)" : 0,
          "--radix-scroll-area-thumb-width": Oe(r) + "px",
          ...e.style,
        },
        onThumbPointerDown: (u) => e.onThumbPointerDown(u.x),
        onDragScroll: (u) => e.onDragScroll(u.x),
        onWheelScroll: (u, d) => {
          if (a.viewport) {
            const h = a.viewport.scrollLeft + u.deltaX;
            (e.onWheelScroll(h), cr(h, d) && u.preventDefault());
          }
        },
        onResize: () => {
          p.current &&
            a.viewport &&
            l &&
            n({
              content: a.viewport.scrollWidth,
              viewport: a.viewport.offsetWidth,
              scrollbar: {
                size: p.current.clientWidth,
                paddingStart: Te(l.paddingLeft),
                paddingEnd: Te(l.paddingRight),
              },
            });
        },
      })
    );
  }),
  Do = s.forwardRef((e, t) => {
    const { sizes: r, onSizesChange: n, ...o } = e,
      a = K(W, e.__scopeScrollArea),
      [l, c] = s.useState(),
      p = s.useRef(null),
      f = F(t, p, a.onScrollbarYChange);
    return (
      s.useEffect(() => {
        p.current && c(getComputedStyle(p.current));
      }, [p]),
      i.jsx(nr, {
        "data-orientation": "vertical",
        ...o,
        ref: f,
        sizes: r,
        style: {
          top: 0,
          right: a.dir === "ltr" ? 0 : void 0,
          left: a.dir === "rtl" ? 0 : void 0,
          bottom: "var(--radix-scroll-area-corner-height)",
          "--radix-scroll-area-thumb-height": Oe(r) + "px",
          ...e.style,
        },
        onThumbPointerDown: (u) => e.onThumbPointerDown(u.y),
        onDragScroll: (u) => e.onDragScroll(u.y),
        onWheelScroll: (u, d) => {
          if (a.viewport) {
            const h = a.viewport.scrollTop + u.deltaY;
            (e.onWheelScroll(h), cr(h, d) && u.preventDefault());
          }
        },
        onResize: () => {
          p.current &&
            a.viewport &&
            l &&
            n({
              content: a.viewport.scrollHeight,
              viewport: a.viewport.offsetHeight,
              scrollbar: {
                size: p.current.clientHeight,
                paddingStart: Te(l.paddingTop),
                paddingEnd: Te(l.paddingBottom),
              },
            });
        },
      })
    );
  }),
  [Oo, rr] = qt(W),
  nr = s.forwardRef((e, t) => {
    const {
        __scopeScrollArea: r,
        sizes: n,
        hasThumb: o,
        onThumbChange: a,
        onThumbPointerUp: l,
        onThumbPointerDown: c,
        onThumbPositionChange: p,
        onDragScroll: f,
        onWheelScroll: u,
        onResize: d,
        ...h
      } = e,
      g = K(W, r),
      [y, v] = s.useState(null),
      m = F(t, (M) => v(M)),
      b = s.useRef(null),
      E = s.useRef(""),
      x = g.viewport,
      w = n.content - n.viewport,
      _ = L(u),
      N = L(p),
      P = ke(d, 10);
    function R(M) {
      if (b.current) {
        const T = M.clientX - b.current.left,
          I = M.clientY - b.current.top;
        f({ x: T, y: I });
      }
    }
    return (
      s.useEffect(() => {
        const M = (T) => {
          const I = T.target;
          y?.contains(I) && _(T, w);
        };
        return (
          document.addEventListener("wheel", M, { passive: !1 }),
          () => document.removeEventListener("wheel", M, { passive: !1 })
        );
      }, [x, y, w, _]),
      s.useEffect(N, [n, N]),
      oe(y, P),
      oe(g.content, P),
      i.jsx(Oo, {
        scope: r,
        scrollbar: y,
        hasThumb: o,
        onThumbChange: L(a),
        onThumbPointerUp: L(l),
        onThumbPositionChange: N,
        onThumbPointerDown: L(c),
        children: i.jsx(O.div, {
          ...h,
          ref: m,
          style: { position: "absolute", ...h.style },
          onPointerDown: C(e.onPointerDown, (M) => {
            M.button === 0 &&
              (M.target.setPointerCapture(M.pointerId),
              (b.current = y.getBoundingClientRect()),
              (E.current = document.body.style.webkitUserSelect),
              (document.body.style.webkitUserSelect = "none"),
              g.viewport && (g.viewport.style.scrollBehavior = "auto"),
              R(M));
          }),
          onPointerMove: C(e.onPointerMove, R),
          onPointerUp: C(e.onPointerUp, (M) => {
            const T = M.target;
            (T.hasPointerCapture(M.pointerId) &&
              T.releasePointerCapture(M.pointerId),
              (document.body.style.webkitUserSelect = E.current),
              g.viewport && (g.viewport.style.scrollBehavior = ""),
              (b.current = null));
          }),
        }),
      })
    );
  }),
  Pe = "ScrollAreaThumb",
  or = s.forwardRef((e, t) => {
    const { forceMount: r, ...n } = e,
      o = rr(Pe, e.__scopeScrollArea);
    return i.jsx(Y, {
      present: r || o.hasThumb,
      children: i.jsx(ko, { ref: t, ...n }),
    });
  }),
  ko = s.forwardRef((e, t) => {
    const { __scopeScrollArea: r, style: n, ...o } = e,
      a = K(Pe, r),
      l = rr(Pe, r),
      { onThumbPositionChange: c } = l,
      p = F(t, (d) => l.onThumbChange(d)),
      f = s.useRef(void 0),
      u = ke(() => {
        f.current && (f.current(), (f.current = void 0));
      }, 100);
    return (
      s.useEffect(() => {
        const d = a.viewport;
        if (d) {
          const h = () => {
            if ((u(), !f.current)) {
              const g = Uo(d, c);
              ((f.current = g), c());
            }
          };
          return (
            c(),
            d.addEventListener("scroll", h),
            () => d.removeEventListener("scroll", h)
          );
        }
      }, [a.viewport, u, c]),
      i.jsx(O.div, {
        "data-state": l.hasThumb ? "visible" : "hidden",
        ...o,
        ref: p,
        style: {
          width: "var(--radix-scroll-area-thumb-width)",
          height: "var(--radix-scroll-area-thumb-height)",
          ...n,
        },
        onPointerDownCapture: C(e.onPointerDownCapture, (d) => {
          const g = d.target.getBoundingClientRect(),
            y = d.clientX - g.left,
            v = d.clientY - g.top;
          l.onThumbPointerDown({ x: y, y: v });
        }),
        onPointerUp: C(e.onPointerUp, l.onThumbPointerUp),
      })
    );
  });
or.displayName = Pe;
var ht = "ScrollAreaCorner",
  sr = s.forwardRef((e, t) => {
    const r = K(ht, e.__scopeScrollArea),
      n = !!(r.scrollbarX && r.scrollbarY);
    return r.type !== "scroll" && n ? i.jsx(Fo, { ...e, ref: t }) : null;
  });
sr.displayName = ht;
var Fo = s.forwardRef((e, t) => {
  const { __scopeScrollArea: r, ...n } = e,
    o = K(ht, r),
    [a, l] = s.useState(0),
    [c, p] = s.useState(0),
    f = !!(a && c);
  return (
    oe(o.scrollbarX, () => {
      const u = o.scrollbarX?.offsetHeight || 0;
      (o.onCornerHeightChange(u), p(u));
    }),
    oe(o.scrollbarY, () => {
      const u = o.scrollbarY?.offsetWidth || 0;
      (o.onCornerWidthChange(u), l(u));
    }),
    f
      ? i.jsx(O.div, {
          ...n,
          ref: t,
          style: {
            width: a,
            height: c,
            position: "absolute",
            right: o.dir === "ltr" ? 0 : void 0,
            left: o.dir === "rtl" ? 0 : void 0,
            bottom: 0,
            ...e.style,
          },
        })
      : null
  );
});
function Te(e) {
  return e ? parseInt(e, 10) : 0;
}
function ar(e, t) {
  const r = e / t;
  return isNaN(r) ? 0 : r;
}
function Oe(e) {
  const t = ar(e.viewport, e.content),
    r = e.scrollbar.paddingStart + e.scrollbar.paddingEnd,
    n = (e.scrollbar.size - r) * t;
  return Math.max(n, 18);
}
function Lo(e, t, r, n = "ltr") {
  const o = Oe(r),
    a = o / 2,
    l = t || a,
    c = o - l,
    p = r.scrollbar.paddingStart + l,
    f = r.scrollbar.size - r.scrollbar.paddingEnd - c,
    u = r.content - r.viewport,
    d = n === "ltr" ? [0, u] : [u * -1, 0];
  return ir([p, f], d)(e);
}
function It(e, t, r = "ltr") {
  const n = Oe(t),
    o = t.scrollbar.paddingStart + t.scrollbar.paddingEnd,
    a = t.scrollbar.size - o,
    l = t.content - t.viewport,
    c = a - n,
    p = r === "ltr" ? [0, l] : [l * -1, 0],
    f = Po(e, p);
  return ir([0, l], [0, c])(f);
}
function ir(e, t) {
  return (r) => {
    if (e[0] === e[1] || t[0] === t[1]) return t[0];
    const n = (t[1] - t[0]) / (e[1] - e[0]);
    return t[0] + n * (r - e[0]);
  };
}
function cr(e, t) {
  return e > 0 && e < t;
}
var Uo = (e, t = () => {}) => {
  let r = { left: e.scrollLeft, top: e.scrollTop },
    n = 0;
  return (
    (function o() {
      const a = { left: e.scrollLeft, top: e.scrollTop },
        l = r.left !== a.left,
        c = r.top !== a.top;
      ((l || c) && t(), (r = a), (n = window.requestAnimationFrame(o)));
    })(),
    () => window.cancelAnimationFrame(n)
  );
};
function ke(e, t) {
  const r = L(e),
    n = s.useRef(0);
  return (
    s.useEffect(() => () => window.clearTimeout(n.current), []),
    s.useCallback(() => {
      (window.clearTimeout(n.current), (n.current = window.setTimeout(r, t)));
    }, [r, t])
  );
}
function oe(e, t) {
  const r = L(t);
  An(() => {
    let n = 0;
    if (e) {
      const o = new ResizeObserver(() => {
        (cancelAnimationFrame(n), (n = window.requestAnimationFrame(r)));
      });
      return (
        o.observe(e),
        () => {
          (window.cancelAnimationFrame(n), o.unobserve(e));
        }
      );
    }
  }, [e, r]);
}
var lr = Zt,
  Ko = er,
  zo = sr;
const ur = s.forwardRef(({ className: e, children: t, ...r }, n) =>
  i.jsxs(lr, {
    ref: n,
    className: j("relative overflow-hidden", e),
    ...r,
    children: [
      i.jsx(Ko, {
        className: "h-full w-full rounded-[inherit] [&>div]:!block",
        children: t,
      }),
      i.jsx(dr, {}),
      i.jsx(zo, {}),
    ],
  }),
);
ur.displayName = lr.displayName;
const dr = s.forwardRef(
  ({ className: e, orientation: t = "vertical", ...r }, n) =>
    i.jsx(dt, {
      ref: n,
      orientation: t,
      className: j(
        "flex touch-none select-none transition-colors",
        t === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent p-[1px]",
        t === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent p-[1px]",
        e,
      ),
      ...r,
      children: i.jsx(or, {
        className: "relative flex-1 rounded-full bg-border",
      }),
    }),
);
dr.displayName = dt.displayName;
var $o = Symbol.for("react.lazy"),
  Ne = _n[" use ".trim().toString()];
function Bo(e) {
  return typeof e == "object" && e !== null && "then" in e;
}
function fr(e) {
  return (
    e != null &&
    typeof e == "object" &&
    "$$typeof" in e &&
    e.$$typeof === $o &&
    "_payload" in e &&
    Bo(e._payload)
  );
}
function Wo(e) {
  const t = Ho(e),
    r = s.forwardRef((n, o) => {
      let { children: a, ...l } = n;
      fr(a) && typeof Ne == "function" && (a = Ne(a._payload));
      const c = s.Children.toArray(a),
        p = c.find(Yo);
      if (p) {
        const f = p.props.children,
          u = c.map((d) =>
            d === p
              ? s.Children.count(f) > 1
                ? s.Children.only(null)
                : s.isValidElement(f)
                  ? f.props.children
                  : null
              : d,
          );
        return i.jsx(t, {
          ...l,
          ref: o,
          children: s.isValidElement(f) ? s.cloneElement(f, void 0, u) : null,
        });
      }
      return i.jsx(t, { ...l, ref: o, children: a });
    });
  return ((r.displayName = `${e}.Slot`), r);
}
var Go = Wo("Slot");
function Ho(e) {
  const t = s.forwardRef((r, n) => {
    let { children: o, ...a } = r;
    if (
      (fr(o) && typeof Ne == "function" && (o = Ne(o._payload)),
      s.isValidElement(o))
    ) {
      const l = Qo(o),
        c = Xo(a, o.props);
      return (
        o.type !== s.Fragment && (c.ref = n ? at(n, l) : l),
        s.cloneElement(o, c)
      );
    }
    return s.Children.count(o) > 1 ? s.Children.only(null) : null;
  });
  return ((t.displayName = `${e}.SlotClone`), t);
}
var Vo = Symbol("radix.slottable");
function Yo(e) {
  return (
    s.isValidElement(e) &&
    typeof e.type == "function" &&
    "__radixId" in e.type &&
    e.type.__radixId === Vo
  );
}
function Xo(e, t) {
  const r = { ...t };
  for (const n in t) {
    const o = e[n],
      a = t[n];
    /^on[A-Z]/.test(n)
      ? o && a
        ? (r[n] = (...c) => {
            const p = a(...c);
            return (o(...c), p);
          })
        : o && (r[n] = o)
      : n === "style"
        ? (r[n] = { ...o, ...a })
        : n === "className" && (r[n] = [o, a].filter(Boolean).join(" "));
  }
  return { ...e, ...r };
}
function Qo(e) {
  let t = Object.getOwnPropertyDescriptor(e.props, "ref")?.get,
    r = t && "isReactWarning" in t && t.isReactWarning;
  return r
    ? e.ref
    : ((t = Object.getOwnPropertyDescriptor(e, "ref")?.get),
      (r = t && "isReactWarning" in t && t.isReactWarning),
      r ? e.props.ref : e.props.ref || e.ref);
}
const qo = Dn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    {
      variants: {
        variant: {
          default: "bg-primary text-primary-foreground hover:bg-primary/90",
          destructive:
            "bg-destructive text-destructive-foreground hover:bg-destructive/90",
          outline:
            "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
          secondary:
            "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          ghost: "hover:bg-accent hover:text-accent-foreground",
          link: "text-primary underline-offset-4 hover:underline",
        },
        size: {
          default: "h-10 px-4 py-2",
          sm: "h-9 rounded-md px-3",
          lg: "h-11 rounded-md px-8",
          icon: "h-10 w-10",
        },
      },
      defaultVariants: { variant: "default", size: "default" },
    },
  ),
  pt = s.forwardRef(
    ({ className: e, variant: t, size: r, asChild: n = !1, ...o }, a) => {
      const l = n ? Go : "button";
      return i.jsx(l, {
        className: j(qo({ variant: t, size: r, className: e })),
        ref: a,
        ...o,
      });
    },
  );
pt.displayName = "Button";
function Zo({ className: e }) {
  const { theme: t, setTheme: r } = On();
  return i.jsxs(kn, {
    children: [
      i.jsx(Fn, {
        asChild: !0,
        children: i.jsx(pt, {
          variant: "ghost",
          size: "icon",
          onClick: () => r(t === "dark" ? "light" : "dark"),
          className: j("text-sidebar-muted hover:text-sidebar-foreground", e),
          children:
            t === "dark" ? i.jsx(Eo, { size: 14 }) : i.jsx(bo, { size: 14 }),
        }),
      }),
      i.jsx(Ln, { children: "Toggle theme" }),
    ],
  });
}
var We = 0;
function Jo() {
  s.useEffect(() => {
    const e = document.querySelectorAll("[data-radix-focus-guard]");
    return (
      document.body.insertAdjacentElement("afterbegin", e[0] ?? jt()),
      document.body.insertAdjacentElement("beforeend", e[1] ?? jt()),
      We++,
      () => {
        (We === 1 &&
          document
            .querySelectorAll("[data-radix-focus-guard]")
            .forEach((t) => t.remove()),
          We--);
      }
    );
  }, []);
}
function jt() {
  const e = document.createElement("span");
  return (
    e.setAttribute("data-radix-focus-guard", ""),
    (e.tabIndex = 0),
    (e.style.outline = "none"),
    (e.style.opacity = "0"),
    (e.style.position = "fixed"),
    (e.style.pointerEvents = "none"),
    e
  );
}
var Ge = "focusScope.autoFocusOnMount",
  He = "focusScope.autoFocusOnUnmount",
  At = { bubbles: !1, cancelable: !0 },
  es = "FocusScope",
  hr = s.forwardRef((e, t) => {
    const {
        loop: r = !1,
        trapped: n = !1,
        onMountAutoFocus: o,
        onUnmountAutoFocus: a,
        ...l
      } = e,
      [c, p] = s.useState(null),
      f = L(o),
      u = L(a),
      d = s.useRef(null),
      h = F(t, (v) => p(v)),
      g = s.useRef({
        paused: !1,
        pause() {
          this.paused = !0;
        },
        resume() {
          this.paused = !1;
        },
      }).current;
    (s.useEffect(() => {
      if (n) {
        let v = function (x) {
            if (g.paused || !c) return;
            const w = x.target;
            c.contains(w) ? (d.current = w) : V(d.current, { select: !0 });
          },
          m = function (x) {
            if (g.paused || !c) return;
            const w = x.relatedTarget;
            w !== null && (c.contains(w) || V(d.current, { select: !0 }));
          },
          b = function (x) {
            if (document.activeElement === document.body)
              for (const _ of x) _.removedNodes.length > 0 && V(c);
          };
        (document.addEventListener("focusin", v),
          document.addEventListener("focusout", m));
        const E = new MutationObserver(b);
        return (
          c && E.observe(c, { childList: !0, subtree: !0 }),
          () => {
            (document.removeEventListener("focusin", v),
              document.removeEventListener("focusout", m),
              E.disconnect());
          }
        );
      }
    }, [n, c, g.paused]),
      s.useEffect(() => {
        if (c) {
          Ot.add(g);
          const v = document.activeElement;
          if (!c.contains(v)) {
            const b = new CustomEvent(Ge, At);
            (c.addEventListener(Ge, f),
              c.dispatchEvent(b),
              b.defaultPrevented ||
                (ts(as(pr(c)), { select: !0 }),
                document.activeElement === v && V(c)));
          }
          return () => {
            (c.removeEventListener(Ge, f),
              setTimeout(() => {
                const b = new CustomEvent(He, At);
                (c.addEventListener(He, u),
                  c.dispatchEvent(b),
                  b.defaultPrevented || V(v ?? document.body, { select: !0 }),
                  c.removeEventListener(He, u),
                  Ot.remove(g));
              }, 0));
          };
        }
      }, [c, f, u, g]));
    const y = s.useCallback(
      (v) => {
        if ((!r && !n) || g.paused) return;
        const m = v.key === "Tab" && !v.altKey && !v.ctrlKey && !v.metaKey,
          b = document.activeElement;
        if (m && b) {
          const E = v.currentTarget,
            [x, w] = rs(E);
          x && w
            ? !v.shiftKey && b === w
              ? (v.preventDefault(), r && V(x, { select: !0 }))
              : v.shiftKey &&
                b === x &&
                (v.preventDefault(), r && V(w, { select: !0 }))
            : b === E && v.preventDefault();
        }
      },
      [r, n, g.paused],
    );
    return i.jsx(O.div, { tabIndex: -1, ...l, ref: h, onKeyDown: y });
  });
hr.displayName = es;
function ts(e, { select: t = !1 } = {}) {
  const r = document.activeElement;
  for (const n of e)
    if ((V(n, { select: t }), document.activeElement !== r)) return;
}
function rs(e) {
  const t = pr(e),
    r = Dt(t, e),
    n = Dt(t.reverse(), e);
  return [r, n];
}
function pr(e) {
  const t = [],
    r = document.createTreeWalker(e, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => {
        const o = n.tagName === "INPUT" && n.type === "hidden";
        return n.disabled || n.hidden || o
          ? NodeFilter.FILTER_SKIP
          : n.tabIndex >= 0
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
      },
    });
  for (; r.nextNode(); ) t.push(r.currentNode);
  return t;
}
function Dt(e, t) {
  for (const r of e) if (!ns(r, { upTo: t })) return r;
}
function ns(e, { upTo: t }) {
  if (getComputedStyle(e).visibility === "hidden") return !0;
  for (; e; ) {
    if (t !== void 0 && e === t) return !1;
    if (getComputedStyle(e).display === "none") return !0;
    e = e.parentElement;
  }
  return !1;
}
function os(e) {
  return e instanceof HTMLInputElement && "select" in e;
}
function V(e, { select: t = !1 } = {}) {
  if (e && e.focus) {
    const r = document.activeElement;
    (e.focus({ preventScroll: !0 }), e !== r && os(e) && t && e.select());
  }
}
var Ot = ss();
function ss() {
  let e = [];
  return {
    add(t) {
      const r = e[0];
      (t !== r && r?.pause(), (e = kt(e, t)), e.unshift(t));
    },
    remove(t) {
      ((e = kt(e, t)), e[0]?.resume());
    },
  };
}
function kt(e, t) {
  const r = [...e],
    n = r.indexOf(t);
  return (n !== -1 && r.splice(n, 1), r);
}
function as(e) {
  return e.filter((t) => t.tagName !== "A");
}
var Ve = "rovingFocusGroup.onEntryFocus",
  is = { bubbles: !1, cancelable: !0 },
  fe = "RovingFocusGroup",
  [rt, mr, cs] = Wt(fe),
  [ls, vr] = De(fe, [cs]),
  [us, ds] = ls(fe),
  gr = s.forwardRef((e, t) =>
    i.jsx(rt.Provider, {
      scope: e.__scopeRovingFocusGroup,
      children: i.jsx(rt.Slot, {
        scope: e.__scopeRovingFocusGroup,
        children: i.jsx(fs, { ...e, ref: t }),
      }),
    }),
  );
gr.displayName = fe;
var fs = s.forwardRef((e, t) => {
    const {
        __scopeRovingFocusGroup: r,
        orientation: n,
        loop: o = !1,
        dir: a,
        currentTabStopId: l,
        defaultCurrentTabStopId: c,
        onCurrentTabStopIdChange: p,
        onEntryFocus: f,
        preventScrollOnEntryFocus: u = !1,
        ...d
      } = e,
      h = s.useRef(null),
      g = F(t, h),
      y = lt(a),
      [v, m] = Gt({ prop: l, defaultProp: c ?? null, onChange: p, caller: fe }),
      [b, E] = s.useState(!1),
      x = L(f),
      w = mr(r),
      _ = s.useRef(!1),
      [N, P] = s.useState(0);
    return (
      s.useEffect(() => {
        const R = h.current;
        if (R)
          return (
            R.addEventListener(Ve, x),
            () => R.removeEventListener(Ve, x)
          );
      }, [x]),
      i.jsx(us, {
        scope: r,
        orientation: n,
        dir: y,
        loop: o,
        currentTabStopId: v,
        onItemFocus: s.useCallback((R) => m(R), [m]),
        onItemShiftTab: s.useCallback(() => E(!0), []),
        onFocusableItemAdd: s.useCallback(() => P((R) => R + 1), []),
        onFocusableItemRemove: s.useCallback(() => P((R) => R - 1), []),
        children: i.jsx(O.div, {
          tabIndex: b || N === 0 ? -1 : 0,
          "data-orientation": n,
          ...d,
          ref: g,
          style: { outline: "none", ...e.style },
          onMouseDown: C(e.onMouseDown, () => {
            _.current = !0;
          }),
          onFocus: C(e.onFocus, (R) => {
            const M = !_.current;
            if (R.target === R.currentTarget && M && !b) {
              const T = new CustomEvent(Ve, is);
              if ((R.currentTarget.dispatchEvent(T), !T.defaultPrevented)) {
                const I = w().filter((H) => H.focusable),
                  D = I.find((H) => H.active),
                  G = I.find((H) => H.id === v),
                  ze = [D, G, ...I].filter(Boolean).map((H) => H.ref.current);
                xr(ze, u);
              }
            }
            _.current = !1;
          }),
          onBlur: C(e.onBlur, () => E(!1)),
        }),
      })
    );
  }),
  br = "RovingFocusGroupItem",
  yr = s.forwardRef((e, t) => {
    const {
        __scopeRovingFocusGroup: r,
        focusable: n = !0,
        active: o = !1,
        tabStopId: a,
        children: l,
        ...c
      } = e,
      p = Je(),
      f = a || p,
      u = ds(br, r),
      d = u.currentTabStopId === f,
      h = mr(r),
      {
        onFocusableItemAdd: g,
        onFocusableItemRemove: y,
        currentTabStopId: v,
      } = u;
    return (
      s.useEffect(() => {
        if (n) return (g(), () => y());
      }, [n, g, y]),
      i.jsx(rt.ItemSlot, {
        scope: r,
        id: f,
        focusable: n,
        active: o,
        children: i.jsx(O.span, {
          tabIndex: d ? 0 : -1,
          "data-orientation": u.orientation,
          ...c,
          ref: t,
          onMouseDown: C(e.onMouseDown, (m) => {
            n ? u.onItemFocus(f) : m.preventDefault();
          }),
          onFocus: C(e.onFocus, () => u.onItemFocus(f)),
          onKeyDown: C(e.onKeyDown, (m) => {
            if (m.key === "Tab" && m.shiftKey) {
              u.onItemShiftTab();
              return;
            }
            if (m.target !== m.currentTarget) return;
            const b = ms(m, u.orientation, u.dir);
            if (b !== void 0) {
              if (m.metaKey || m.ctrlKey || m.altKey || m.shiftKey) return;
              m.preventDefault();
              let x = h()
                .filter((w) => w.focusable)
                .map((w) => w.ref.current);
              if (b === "last") x.reverse();
              else if (b === "prev" || b === "next") {
                b === "prev" && x.reverse();
                const w = x.indexOf(m.currentTarget);
                x = u.loop ? vs(x, w + 1) : x.slice(w + 1);
              }
              setTimeout(() => xr(x));
            }
          }),
          children:
            typeof l == "function"
              ? l({ isCurrentTabStop: d, hasTabStop: v != null })
              : l,
        }),
      })
    );
  });
yr.displayName = br;
var hs = {
  ArrowLeft: "prev",
  ArrowUp: "prev",
  ArrowRight: "next",
  ArrowDown: "next",
  PageUp: "first",
  Home: "first",
  PageDown: "last",
  End: "last",
};
function ps(e, t) {
  return t !== "rtl"
    ? e
    : e === "ArrowLeft"
      ? "ArrowRight"
      : e === "ArrowRight"
        ? "ArrowLeft"
        : e;
}
function ms(e, t, r) {
  const n = ps(e.key, r);
  if (
    !(t === "vertical" && ["ArrowLeft", "ArrowRight"].includes(n)) &&
    !(t === "horizontal" && ["ArrowUp", "ArrowDown"].includes(n))
  )
    return hs[n];
}
function xr(e, t = !1) {
  const r = document.activeElement;
  for (const n of e)
    if (
      n === r ||
      (n.focus({ preventScroll: t }), document.activeElement !== r)
    )
      return;
}
function vs(e, t) {
  return e.map((r, n) => e[(t + n) % e.length]);
}
var gs = gr,
  bs = yr,
  ys = function (e) {
    if (typeof document > "u") return null;
    var t = Array.isArray(e) ? e[0] : e;
    return t.ownerDocument.body;
  },
  ee = new WeakMap(),
  be = new WeakMap(),
  ye = {},
  Ye = 0,
  wr = function (e) {
    return e && (e.host || wr(e.parentNode));
  },
  xs = function (e, t) {
    return t
      .map(function (r) {
        if (e.contains(r)) return r;
        var n = wr(r);
        return n && e.contains(n)
          ? n
          : (console.error(
              "aria-hidden",
              r,
              "in not contained inside",
              e,
              ". Doing nothing",
            ),
            null);
      })
      .filter(function (r) {
        return !!r;
      });
  },
  ws = function (e, t, r, n) {
    var o = xs(t, Array.isArray(e) ? e : [e]);
    ye[r] || (ye[r] = new WeakMap());
    var a = ye[r],
      l = [],
      c = new Set(),
      p = new Set(o),
      f = function (d) {
        !d || c.has(d) || (c.add(d), f(d.parentNode));
      };
    o.forEach(f);
    var u = function (d) {
      !d ||
        p.has(d) ||
        Array.prototype.forEach.call(d.children, function (h) {
          if (c.has(h)) u(h);
          else
            try {
              var g = h.getAttribute(n),
                y = g !== null && g !== "false",
                v = (ee.get(h) || 0) + 1,
                m = (a.get(h) || 0) + 1;
              (ee.set(h, v),
                a.set(h, m),
                l.push(h),
                v === 1 && y && be.set(h, !0),
                m === 1 && h.setAttribute(r, "true"),
                y || h.setAttribute(n, "true"));
            } catch (b) {
              console.error("aria-hidden: cannot operate on ", h, b);
            }
        });
    };
    return (
      u(t),
      c.clear(),
      Ye++,
      function () {
        (l.forEach(function (d) {
          var h = ee.get(d) - 1,
            g = a.get(d) - 1;
          (ee.set(d, h),
            a.set(d, g),
            h || (be.has(d) || d.removeAttribute(n), be.delete(d)),
            g || d.removeAttribute(r));
        }),
          Ye--,
          Ye ||
            ((ee = new WeakMap()),
            (ee = new WeakMap()),
            (be = new WeakMap()),
            (ye = {})));
      }
    );
  },
  Ss = function (e, t, r) {
    r === void 0 && (r = "data-aria-hidden");
    var n = Array.from(Array.isArray(e) ? e : [e]),
      o = ys(e);
    return o
      ? (n.push.apply(n, Array.from(o.querySelectorAll("[aria-live], script"))),
        ws(n, o, r, "aria-hidden"))
      : function () {
          return null;
        };
  },
  B = function () {
    return (
      (B =
        Object.assign ||
        function (t) {
          for (var r, n = 1, o = arguments.length; n < o; n++) {
            r = arguments[n];
            for (var a in r)
              Object.prototype.hasOwnProperty.call(r, a) && (t[a] = r[a]);
          }
          return t;
        }),
      B.apply(this, arguments)
    );
  };
function Sr(e, t) {
  var r = {};
  for (var n in e)
    Object.prototype.hasOwnProperty.call(e, n) &&
      t.indexOf(n) < 0 &&
      (r[n] = e[n]);
  if (e != null && typeof Object.getOwnPropertySymbols == "function")
    for (var o = 0, n = Object.getOwnPropertySymbols(e); o < n.length; o++)
      t.indexOf(n[o]) < 0 &&
        Object.prototype.propertyIsEnumerable.call(e, n[o]) &&
        (r[n[o]] = e[n[o]]);
  return r;
}
function Cs(e, t, r) {
  if (r || arguments.length === 2)
    for (var n = 0, o = t.length, a; n < o; n++)
      (a || !(n in t)) &&
        (a || (a = Array.prototype.slice.call(t, 0, n)), (a[n] = t[n]));
  return e.concat(a || Array.prototype.slice.call(t));
}
var Se = "right-scroll-bar-position",
  Ce = "width-before-scroll-bar",
  Es = "with-scroll-bars-hidden",
  Rs = "--removed-body-scroll-bar-size";
function Xe(e, t) {
  return (typeof e == "function" ? e(t) : e && (e.current = t), e);
}
function Ms(e, t) {
  var r = s.useState(function () {
    return {
      value: e,
      callback: t,
      facade: {
        get current() {
          return r.value;
        },
        set current(n) {
          var o = r.value;
          o !== n && ((r.value = n), r.callback(n, o));
        },
      },
    };
  })[0];
  return ((r.callback = t), r.facade);
}
var _s = typeof window < "u" ? s.useLayoutEffect : s.useEffect,
  Ft = new WeakMap();
function Ps(e, t) {
  var r = Ms(null, function (n) {
    return e.forEach(function (o) {
      return Xe(o, n);
    });
  });
  return (
    _s(
      function () {
        var n = Ft.get(r);
        if (n) {
          var o = new Set(n),
            a = new Set(e),
            l = r.current;
          (o.forEach(function (c) {
            a.has(c) || Xe(c, null);
          }),
            a.forEach(function (c) {
              o.has(c) || Xe(c, l);
            }));
        }
        Ft.set(r, e);
      },
      [e],
    ),
    r
  );
}
function Ts(e) {
  return e;
}
function Ns(e, t) {
  t === void 0 && (t = Ts);
  var r = [],
    n = !1,
    o = {
      read: function () {
        if (n)
          throw new Error(
            "Sidecar: could not `read` from an `assigned` medium. `read` could be used only with `useMedium`.",
          );
        return r.length ? r[r.length - 1] : e;
      },
      useMedium: function (a) {
        var l = t(a, n);
        return (
          r.push(l),
          function () {
            r = r.filter(function (c) {
              return c !== l;
            });
          }
        );
      },
      assignSyncMedium: function (a) {
        for (n = !0; r.length; ) {
          var l = r;
          ((r = []), l.forEach(a));
        }
        r = {
          push: function (c) {
            return a(c);
          },
          filter: function () {
            return r;
          },
        };
      },
      assignMedium: function (a) {
        n = !0;
        var l = [];
        if (r.length) {
          var c = r;
          ((r = []), c.forEach(a), (l = r));
        }
        var p = function () {
            var u = l;
            ((l = []), u.forEach(a));
          },
          f = function () {
            return Promise.resolve().then(p);
          };
        (f(),
          (r = {
            push: function (u) {
              (l.push(u), f());
            },
            filter: function (u) {
              return ((l = l.filter(u)), r);
            },
          }));
      },
    };
  return o;
}
function Is(e) {
  e === void 0 && (e = {});
  var t = Ns(null);
  return ((t.options = B({ async: !0, ssr: !1 }, e)), t);
}
var Cr = function (e) {
  var t = e.sideCar,
    r = Sr(e, ["sideCar"]);
  if (!t)
    throw new Error(
      "Sidecar: please provide `sideCar` property to import the right car",
    );
  var n = t.read();
  if (!n) throw new Error("Sidecar medium not found");
  return s.createElement(n, B({}, r));
};
Cr.isSideCarExport = !0;
function js(e, t) {
  return (e.useMedium(t), Cr);
}
var Er = Is(),
  Qe = function () {},
  Fe = s.forwardRef(function (e, t) {
    var r = s.useRef(null),
      n = s.useState({
        onScrollCapture: Qe,
        onWheelCapture: Qe,
        onTouchMoveCapture: Qe,
      }),
      o = n[0],
      a = n[1],
      l = e.forwardProps,
      c = e.children,
      p = e.className,
      f = e.removeScrollBar,
      u = e.enabled,
      d = e.shards,
      h = e.sideCar,
      g = e.noRelative,
      y = e.noIsolation,
      v = e.inert,
      m = e.allowPinchZoom,
      b = e.as,
      E = b === void 0 ? "div" : b,
      x = e.gapMode,
      w = Sr(e, [
        "forwardProps",
        "children",
        "className",
        "removeScrollBar",
        "enabled",
        "shards",
        "sideCar",
        "noRelative",
        "noIsolation",
        "inert",
        "allowPinchZoom",
        "as",
        "gapMode",
      ]),
      _ = h,
      N = Ps([r, t]),
      P = B(B({}, w), o);
    return s.createElement(
      s.Fragment,
      null,
      u &&
        s.createElement(_, {
          sideCar: Er,
          removeScrollBar: f,
          shards: d,
          noRelative: g,
          noIsolation: y,
          inert: v,
          setCallbacks: a,
          allowPinchZoom: !!m,
          lockRef: r,
          gapMode: x,
        }),
      l
        ? s.cloneElement(s.Children.only(c), B(B({}, P), { ref: N }))
        : s.createElement(E, B({}, P, { className: p, ref: N }), c),
    );
  });
Fe.defaultProps = { enabled: !0, removeScrollBar: !0, inert: !1 };
Fe.classNames = { fullWidth: Ce, zeroRight: Se };
var As = function () {
  if (typeof __webpack_nonce__ < "u") return __webpack_nonce__;
};
function Ds() {
  if (!document) return null;
  var e = document.createElement("style");
  e.type = "text/css";
  var t = As();
  return (t && e.setAttribute("nonce", t), e);
}
function Os(e, t) {
  e.styleSheet
    ? (e.styleSheet.cssText = t)
    : e.appendChild(document.createTextNode(t));
}
function ks(e) {
  var t = document.head || document.getElementsByTagName("head")[0];
  t.appendChild(e);
}
var Fs = function () {
    var e = 0,
      t = null;
    return {
      add: function (r) {
        (e == 0 && (t = Ds()) && (Os(t, r), ks(t)), e++);
      },
      remove: function () {
        (e--,
          !e && t && (t.parentNode && t.parentNode.removeChild(t), (t = null)));
      },
    };
  },
  Ls = function () {
    var e = Fs();
    return function (t, r) {
      s.useEffect(
        function () {
          return (
            e.add(t),
            function () {
              e.remove();
            }
          );
        },
        [t && r],
      );
    };
  },
  Rr = function () {
    var e = Ls(),
      t = function (r) {
        var n = r.styles,
          o = r.dynamic;
        return (e(n, o), null);
      };
    return t;
  },
  Us = { left: 0, top: 0, right: 0, gap: 0 },
  qe = function (e) {
    return parseInt(e || "", 10) || 0;
  },
  Ks = function (e) {
    var t = window.getComputedStyle(document.body),
      r = t[e === "padding" ? "paddingLeft" : "marginLeft"],
      n = t[e === "padding" ? "paddingTop" : "marginTop"],
      o = t[e === "padding" ? "paddingRight" : "marginRight"];
    return [qe(r), qe(n), qe(o)];
  },
  zs = function (e) {
    if ((e === void 0 && (e = "margin"), typeof window > "u")) return Us;
    var t = Ks(e),
      r = document.documentElement.clientWidth,
      n = window.innerWidth;
    return {
      left: t[0],
      top: t[1],
      right: t[2],
      gap: Math.max(0, n - r + t[2] - t[0]),
    };
  },
  $s = Rr(),
  ne = "data-scroll-locked",
  Bs = function (e, t, r, n) {
    var o = e.left,
      a = e.top,
      l = e.right,
      c = e.gap;
    return (
      r === void 0 && (r = "margin"),
      `
  .`
        .concat(
          Es,
          ` {
   overflow: hidden `,
        )
        .concat(
          n,
          `;
   padding-right: `,
        )
        .concat(c, "px ")
        .concat(
          n,
          `;
  }
  body[`,
        )
        .concat(
          ne,
          `] {
    overflow: hidden `,
        )
        .concat(
          n,
          `;
    overscroll-behavior: contain;
    `,
        )
        .concat(
          [
            t && "position: relative ".concat(n, ";"),
            r === "margin" &&
              `
    padding-left: `
                .concat(
                  o,
                  `px;
    padding-top: `,
                )
                .concat(
                  a,
                  `px;
    padding-right: `,
                )
                .concat(
                  l,
                  `px;
    margin-left:0;
    margin-top:0;
    margin-right: `,
                )
                .concat(c, "px ")
                .concat(
                  n,
                  `;
    `,
                ),
            r === "padding" &&
              "padding-right: ".concat(c, "px ").concat(n, ";"),
          ]
            .filter(Boolean)
            .join(""),
          `
  }
  
  .`,
        )
        .concat(
          Se,
          ` {
    right: `,
        )
        .concat(c, "px ")
        .concat(
          n,
          `;
  }
  
  .`,
        )
        .concat(
          Ce,
          ` {
    margin-right: `,
        )
        .concat(c, "px ")
        .concat(
          n,
          `;
  }
  
  .`,
        )
        .concat(Se, " .")
        .concat(
          Se,
          ` {
    right: 0 `,
        )
        .concat(
          n,
          `;
  }
  
  .`,
        )
        .concat(Ce, " .")
        .concat(
          Ce,
          ` {
    margin-right: 0 `,
        )
        .concat(
          n,
          `;
  }
  
  body[`,
        )
        .concat(
          ne,
          `] {
    `,
        )
        .concat(Rs, ": ")
        .concat(
          c,
          `px;
  }
`,
        )
    );
  },
  Lt = function () {
    var e = parseInt(document.body.getAttribute(ne) || "0", 10);
    return isFinite(e) ? e : 0;
  },
  Ws = function () {
    s.useEffect(function () {
      return (
        document.body.setAttribute(ne, (Lt() + 1).toString()),
        function () {
          var e = Lt() - 1;
          e <= 0
            ? document.body.removeAttribute(ne)
            : document.body.setAttribute(ne, e.toString());
        }
      );
    }, []);
  },
  Gs = function (e) {
    var t = e.noRelative,
      r = e.noImportant,
      n = e.gapMode,
      o = n === void 0 ? "margin" : n;
    Ws();
    var a = s.useMemo(
      function () {
        return zs(o);
      },
      [o],
    );
    return s.createElement($s, { styles: Bs(a, !t, o, r ? "" : "!important") });
  },
  nt = !1;
if (typeof window < "u")
  try {
    var xe = Object.defineProperty({}, "passive", {
      get: function () {
        return ((nt = !0), !0);
      },
    });
    (window.addEventListener("test", xe, xe),
      window.removeEventListener("test", xe, xe));
  } catch {
    nt = !1;
  }
var te = nt ? { passive: !1 } : !1,
  Hs = function (e) {
    return e.tagName === "TEXTAREA";
  },
  Mr = function (e, t) {
    if (!(e instanceof Element)) return !1;
    var r = window.getComputedStyle(e);
    return (
      r[t] !== "hidden" &&
      !(r.overflowY === r.overflowX && !Hs(e) && r[t] === "visible")
    );
  },
  Vs = function (e) {
    return Mr(e, "overflowY");
  },
  Ys = function (e) {
    return Mr(e, "overflowX");
  },
  Ut = function (e, t) {
    var r = t.ownerDocument,
      n = t;
    do {
      typeof ShadowRoot < "u" && n instanceof ShadowRoot && (n = n.host);
      var o = _r(e, n);
      if (o) {
        var a = Pr(e, n),
          l = a[1],
          c = a[2];
        if (l > c) return !0;
      }
      n = n.parentNode;
    } while (n && n !== r.body);
    return !1;
  },
  Xs = function (e) {
    var t = e.scrollTop,
      r = e.scrollHeight,
      n = e.clientHeight;
    return [t, r, n];
  },
  Qs = function (e) {
    var t = e.scrollLeft,
      r = e.scrollWidth,
      n = e.clientWidth;
    return [t, r, n];
  },
  _r = function (e, t) {
    return e === "v" ? Vs(t) : Ys(t);
  },
  Pr = function (e, t) {
    return e === "v" ? Xs(t) : Qs(t);
  },
  qs = function (e, t) {
    return e === "h" && t === "rtl" ? -1 : 1;
  },
  Zs = function (e, t, r, n, o) {
    var a = qs(e, window.getComputedStyle(t).direction),
      l = a * n,
      c = r.target,
      p = t.contains(c),
      f = !1,
      u = l > 0,
      d = 0,
      h = 0;
    do {
      if (!c) break;
      var g = Pr(e, c),
        y = g[0],
        v = g[1],
        m = g[2],
        b = v - m - a * y;
      (y || b) && _r(e, c) && ((d += b), (h += y));
      var E = c.parentNode;
      c = E && E.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? E.host : E;
    } while ((!p && c !== document.body) || (p && (t.contains(c) || t === c)));
    return (((u && Math.abs(d) < 1) || (!u && Math.abs(h) < 1)) && (f = !0), f);
  },
  we = function (e) {
    return "changedTouches" in e
      ? [e.changedTouches[0].clientX, e.changedTouches[0].clientY]
      : [0, 0];
  },
  Kt = function (e) {
    return [e.deltaX, e.deltaY];
  },
  zt = function (e) {
    return e && "current" in e ? e.current : e;
  },
  Js = function (e, t) {
    return e[0] === t[0] && e[1] === t[1];
  },
  ea = function (e) {
    return `
  .block-interactivity-`
      .concat(
        e,
        ` {pointer-events: none;}
  .allow-interactivity-`,
      )
      .concat(
        e,
        ` {pointer-events: all;}
`,
      );
  },
  ta = 0,
  re = [];
function ra(e) {
  var t = s.useRef([]),
    r = s.useRef([0, 0]),
    n = s.useRef(),
    o = s.useState(ta++)[0],
    a = s.useState(Rr)[0],
    l = s.useRef(e);
  (s.useEffect(
    function () {
      l.current = e;
    },
    [e],
  ),
    s.useEffect(
      function () {
        if (e.inert) {
          document.body.classList.add("block-interactivity-".concat(o));
          var v = Cs([e.lockRef.current], (e.shards || []).map(zt), !0).filter(
            Boolean,
          );
          return (
            v.forEach(function (m) {
              return m.classList.add("allow-interactivity-".concat(o));
            }),
            function () {
              (document.body.classList.remove("block-interactivity-".concat(o)),
                v.forEach(function (m) {
                  return m.classList.remove("allow-interactivity-".concat(o));
                }));
            }
          );
        }
      },
      [e.inert, e.lockRef.current, e.shards],
    ));
  var c = s.useCallback(function (v, m) {
      if (
        ("touches" in v && v.touches.length === 2) ||
        (v.type === "wheel" && v.ctrlKey)
      )
        return !l.current.allowPinchZoom;
      var b = we(v),
        E = r.current,
        x = "deltaX" in v ? v.deltaX : E[0] - b[0],
        w = "deltaY" in v ? v.deltaY : E[1] - b[1],
        _,
        N = v.target,
        P = Math.abs(x) > Math.abs(w) ? "h" : "v";
      if ("touches" in v && P === "h" && N.type === "range") return !1;
      var R = window.getSelection(),
        M = R && R.anchorNode,
        T = M ? M === N || M.contains(N) : !1;
      if (T) return !1;
      var I = Ut(P, N);
      if (!I) return !0;
      if ((I ? (_ = P) : ((_ = P === "v" ? "h" : "v"), (I = Ut(P, N))), !I))
        return !1;
      if (
        (!n.current && "changedTouches" in v && (x || w) && (n.current = _), !_)
      )
        return !0;
      var D = n.current || _;
      return Zs(D, m, v, D === "h" ? x : w);
    }, []),
    p = s.useCallback(function (v) {
      var m = v;
      if (!(!re.length || re[re.length - 1] !== a)) {
        var b = "deltaY" in m ? Kt(m) : we(m),
          E = t.current.filter(function (_) {
            return (
              _.name === m.type &&
              (_.target === m.target || m.target === _.shadowParent) &&
              Js(_.delta, b)
            );
          })[0];
        if (E && E.should) {
          m.cancelable && m.preventDefault();
          return;
        }
        if (!E) {
          var x = (l.current.shards || [])
              .map(zt)
              .filter(Boolean)
              .filter(function (_) {
                return _.contains(m.target);
              }),
            w = x.length > 0 ? c(m, x[0]) : !l.current.noIsolation;
          w && m.cancelable && m.preventDefault();
        }
      }
    }, []),
    f = s.useCallback(function (v, m, b, E) {
      var x = { name: v, delta: m, target: b, should: E, shadowParent: na(b) };
      (t.current.push(x),
        setTimeout(function () {
          t.current = t.current.filter(function (w) {
            return w !== x;
          });
        }, 1));
    }, []),
    u = s.useCallback(function (v) {
      ((r.current = we(v)), (n.current = void 0));
    }, []),
    d = s.useCallback(function (v) {
      f(v.type, Kt(v), v.target, c(v, e.lockRef.current));
    }, []),
    h = s.useCallback(function (v) {
      f(v.type, we(v), v.target, c(v, e.lockRef.current));
    }, []);
  s.useEffect(function () {
    return (
      re.push(a),
      e.setCallbacks({
        onScrollCapture: d,
        onWheelCapture: d,
        onTouchMoveCapture: h,
      }),
      document.addEventListener("wheel", p, te),
      document.addEventListener("touchmove", p, te),
      document.addEventListener("touchstart", u, te),
      function () {
        ((re = re.filter(function (v) {
          return v !== a;
        })),
          document.removeEventListener("wheel", p, te),
          document.removeEventListener("touchmove", p, te),
          document.removeEventListener("touchstart", u, te));
      }
    );
  }, []);
  var g = e.removeScrollBar,
    y = e.inert;
  return s.createElement(
    s.Fragment,
    null,
    y ? s.createElement(a, { styles: ea(o) }) : null,
    g
      ? s.createElement(Gs, { noRelative: e.noRelative, gapMode: e.gapMode })
      : null,
  );
}
function na(e) {
  for (var t = null; e !== null; )
    (e instanceof ShadowRoot && ((t = e.host), (e = e.host)),
      (e = e.parentNode));
  return t;
}
const oa = js(Er, ra);
var Tr = s.forwardRef(function (e, t) {
  return s.createElement(Fe, B({}, e, { ref: t, sideCar: oa }));
});
Tr.classNames = Fe.classNames;
var ot = ["Enter", " "],
  sa = ["ArrowDown", "PageUp", "Home"],
  Nr = ["ArrowUp", "PageDown", "End"],
  aa = [...sa, ...Nr],
  ia = { ltr: [...ot, "ArrowRight"], rtl: [...ot, "ArrowLeft"] },
  ca = { ltr: ["ArrowLeft"], rtl: ["ArrowRight"] },
  he = "Menu",
  [le, la, ua] = Wt(he),
  [Q, Ir] = De(he, [ua, Ht, vr]),
  Le = Ht(),
  jr = vr(),
  [da, q] = Q(he),
  [fa, pe] = Q(he),
  Ar = (e) => {
    const {
        __scopeMenu: t,
        open: r = !1,
        children: n,
        dir: o,
        onOpenChange: a,
        modal: l = !0,
      } = e,
      c = Le(t),
      [p, f] = s.useState(null),
      u = s.useRef(!1),
      d = L(a),
      h = lt(o);
    return (
      s.useEffect(() => {
        const g = () => {
            ((u.current = !0),
              document.addEventListener("pointerdown", y, {
                capture: !0,
                once: !0,
              }),
              document.addEventListener("pointermove", y, {
                capture: !0,
                once: !0,
              }));
          },
          y = () => (u.current = !1);
        return (
          document.addEventListener("keydown", g, { capture: !0 }),
          () => {
            (document.removeEventListener("keydown", g, { capture: !0 }),
              document.removeEventListener("pointerdown", y, { capture: !0 }),
              document.removeEventListener("pointermove", y, { capture: !0 }));
          }
        );
      }, []),
      i.jsx(Gn, {
        ...c,
        children: i.jsx(da, {
          scope: t,
          open: r,
          onOpenChange: d,
          content: p,
          onContentChange: f,
          children: i.jsx(fa, {
            scope: t,
            onClose: s.useCallback(() => d(!1), [d]),
            isUsingKeyboardRef: u,
            dir: h,
            modal: l,
            children: n,
          }),
        }),
      })
    );
  };
Ar.displayName = he;
var ha = "MenuAnchor",
  mt = s.forwardRef((e, t) => {
    const { __scopeMenu: r, ...n } = e,
      o = Le(r);
    return i.jsx(Kn, { ...o, ...n, ref: t });
  });
mt.displayName = ha;
var vt = "MenuPortal",
  [pa, Dr] = Q(vt, { forceMount: void 0 }),
  Or = (e) => {
    const { __scopeMenu: t, forceMount: r, children: n, container: o } = e,
      a = q(vt, t);
    return i.jsx(pa, {
      scope: t,
      forceMount: r,
      children: i.jsx(Y, {
        present: r || a.open,
        children: i.jsx(Un, { asChild: !0, container: o, children: n }),
      }),
    });
  };
Or.displayName = vt;
var U = "MenuContent",
  [ma, gt] = Q(U),
  kr = s.forwardRef((e, t) => {
    const r = Dr(U, e.__scopeMenu),
      { forceMount: n = r.forceMount, ...o } = e,
      a = q(U, e.__scopeMenu),
      l = pe(U, e.__scopeMenu);
    return i.jsx(le.Provider, {
      scope: e.__scopeMenu,
      children: i.jsx(Y, {
        present: n || a.open,
        children: i.jsx(le.Slot, {
          scope: e.__scopeMenu,
          children: l.modal
            ? i.jsx(va, { ...o, ref: t })
            : i.jsx(ga, { ...o, ref: t }),
        }),
      }),
    });
  }),
  va = s.forwardRef((e, t) => {
    const r = q(U, e.__scopeMenu),
      n = s.useRef(null),
      o = F(t, n);
    return (
      s.useEffect(() => {
        const a = n.current;
        if (a) return Ss(a);
      }, []),
      i.jsx(bt, {
        ...e,
        ref: o,
        trapFocus: r.open,
        disableOutsidePointerEvents: r.open,
        disableOutsideScroll: !0,
        onFocusOutside: C(e.onFocusOutside, (a) => a.preventDefault(), {
          checkForDefaultPrevented: !1,
        }),
        onDismiss: () => r.onOpenChange(!1),
      })
    );
  }),
  ga = s.forwardRef((e, t) => {
    const r = q(U, e.__scopeMenu);
    return i.jsx(bt, {
      ...e,
      ref: t,
      trapFocus: !1,
      disableOutsidePointerEvents: !1,
      disableOutsideScroll: !1,
      onDismiss: () => r.onOpenChange(!1),
    });
  }),
  ba = Wn("MenuContent.ScrollLock"),
  bt = s.forwardRef((e, t) => {
    const {
        __scopeMenu: r,
        loop: n = !1,
        trapFocus: o,
        onOpenAutoFocus: a,
        onCloseAutoFocus: l,
        disableOutsidePointerEvents: c,
        onEntryFocus: p,
        onEscapeKeyDown: f,
        onPointerDownOutside: u,
        onFocusOutside: d,
        onInteractOutside: h,
        onDismiss: g,
        disableOutsideScroll: y,
        ...v
      } = e,
      m = q(U, r),
      b = pe(U, r),
      E = Le(r),
      x = jr(r),
      w = la(r),
      [_, N] = s.useState(null),
      P = s.useRef(null),
      R = F(t, P, m.onContentChange),
      M = s.useRef(0),
      T = s.useRef(""),
      I = s.useRef(0),
      D = s.useRef(null),
      G = s.useRef("right"),
      ve = s.useRef(0),
      ze = y ? Tr : s.Fragment,
      H = y ? { as: ba, allowPinchZoom: !0 } : void 0,
      Mn = (S) => {
        const J = T.current + S,
          X = w().filter((k) => !k.disabled),
          se = document.activeElement,
          $e = X.find((k) => k.ref.current === se)?.textValue,
          Be = X.map((k) => k.textValue),
          St = Na(Be, J, $e),
          ae = X.find((k) => k.textValue === St)?.ref.current;
        ((function k(Ct) {
          ((T.current = Ct),
            window.clearTimeout(M.current),
            Ct !== "" && (M.current = window.setTimeout(() => k(""), 1e3)));
        })(J),
          ae && setTimeout(() => ae.focus()));
      };
    (s.useEffect(() => () => window.clearTimeout(M.current), []), Jo());
    const Z = s.useCallback(
      (S) => G.current === D.current?.side && ja(S, D.current?.area),
      [],
    );
    return i.jsx(ma, {
      scope: r,
      searchRef: T,
      onItemEnter: s.useCallback(
        (S) => {
          Z(S) && S.preventDefault();
        },
        [Z],
      ),
      onItemLeave: s.useCallback(
        (S) => {
          Z(S) || (P.current?.focus(), N(null));
        },
        [Z],
      ),
      onTriggerLeave: s.useCallback(
        (S) => {
          Z(S) && S.preventDefault();
        },
        [Z],
      ),
      pointerGraceTimerRef: I,
      onPointerGraceIntentChange: s.useCallback((S) => {
        D.current = S;
      }, []),
      children: i.jsx(ze, {
        ...H,
        children: i.jsx(hr, {
          asChild: !0,
          trapped: o,
          onMountAutoFocus: C(a, (S) => {
            (S.preventDefault(), P.current?.focus({ preventScroll: !0 }));
          }),
          onUnmountAutoFocus: l,
          children: i.jsx(zn, {
            asChild: !0,
            disableOutsidePointerEvents: c,
            onEscapeKeyDown: f,
            onPointerDownOutside: u,
            onFocusOutside: d,
            onInteractOutside: h,
            onDismiss: g,
            children: i.jsx(gs, {
              asChild: !0,
              ...x,
              dir: b.dir,
              orientation: "vertical",
              loop: n,
              currentTabStopId: _,
              onCurrentTabStopIdChange: N,
              onEntryFocus: C(p, (S) => {
                b.isUsingKeyboardRef.current || S.preventDefault();
              }),
              preventScrollOnEntryFocus: !0,
              children: i.jsx($n, {
                role: "menu",
                "aria-orientation": "vertical",
                "data-state": Zr(m.open),
                "data-radix-menu-content": "",
                dir: b.dir,
                ...E,
                ...v,
                ref: R,
                style: { outline: "none", ...v.style },
                onKeyDown: C(v.onKeyDown, (S) => {
                  const X =
                      S.target.closest("[data-radix-menu-content]") ===
                      S.currentTarget,
                    se = S.ctrlKey || S.altKey || S.metaKey,
                    $e = S.key.length === 1;
                  X &&
                    (S.key === "Tab" && S.preventDefault(),
                    !se && $e && Mn(S.key));
                  const Be = P.current;
                  if (S.target !== Be || !aa.includes(S.key)) return;
                  S.preventDefault();
                  const ae = w()
                    .filter((k) => !k.disabled)
                    .map((k) => k.ref.current);
                  (Nr.includes(S.key) && ae.reverse(), Pa(ae));
                }),
                onBlur: C(e.onBlur, (S) => {
                  S.currentTarget.contains(S.target) ||
                    (window.clearTimeout(M.current), (T.current = ""));
                }),
                onPointerMove: C(
                  e.onPointerMove,
                  ue((S) => {
                    const J = S.target,
                      X = ve.current !== S.clientX;
                    if (S.currentTarget.contains(J) && X) {
                      const se = S.clientX > ve.current ? "right" : "left";
                      ((G.current = se), (ve.current = S.clientX));
                    }
                  }),
                ),
              }),
            }),
          }),
        }),
      }),
    });
  });
kr.displayName = U;
var ya = "MenuGroup",
  yt = s.forwardRef((e, t) => {
    const { __scopeMenu: r, ...n } = e;
    return i.jsx(O.div, { role: "group", ...n, ref: t });
  });
yt.displayName = ya;
var xa = "MenuLabel",
  Fr = s.forwardRef((e, t) => {
    const { __scopeMenu: r, ...n } = e;
    return i.jsx(O.div, { ...n, ref: t });
  });
Fr.displayName = xa;
var Ie = "MenuItem",
  $t = "menu.itemSelect",
  Ue = s.forwardRef((e, t) => {
    const { disabled: r = !1, onSelect: n, ...o } = e,
      a = s.useRef(null),
      l = pe(Ie, e.__scopeMenu),
      c = gt(Ie, e.__scopeMenu),
      p = F(t, a),
      f = s.useRef(!1),
      u = () => {
        const d = a.current;
        if (!r && d) {
          const h = new CustomEvent($t, { bubbles: !0, cancelable: !0 });
          (d.addEventListener($t, (g) => n?.(g), { once: !0 }),
            Bn(d, h),
            h.defaultPrevented ? (f.current = !1) : l.onClose());
        }
      };
    return i.jsx(Lr, {
      ...o,
      ref: p,
      disabled: r,
      onClick: C(e.onClick, u),
      onPointerDown: (d) => {
        (e.onPointerDown?.(d), (f.current = !0));
      },
      onPointerUp: C(e.onPointerUp, (d) => {
        f.current || d.currentTarget?.click();
      }),
      onKeyDown: C(e.onKeyDown, (d) => {
        const h = c.searchRef.current !== "";
        r ||
          (h && d.key === " ") ||
          (ot.includes(d.key) && (d.currentTarget.click(), d.preventDefault()));
      }),
    });
  });
Ue.displayName = Ie;
var Lr = s.forwardRef((e, t) => {
    const { __scopeMenu: r, disabled: n = !1, textValue: o, ...a } = e,
      l = gt(Ie, r),
      c = jr(r),
      p = s.useRef(null),
      f = F(t, p),
      [u, d] = s.useState(!1),
      [h, g] = s.useState("");
    return (
      s.useEffect(() => {
        const y = p.current;
        y && g((y.textContent ?? "").trim());
      }, [a.children]),
      i.jsx(le.ItemSlot, {
        scope: r,
        disabled: n,
        textValue: o ?? h,
        children: i.jsx(bs, {
          asChild: !0,
          ...c,
          focusable: !n,
          children: i.jsx(O.div, {
            role: "menuitem",
            "data-highlighted": u ? "" : void 0,
            "aria-disabled": n || void 0,
            "data-disabled": n ? "" : void 0,
            ...a,
            ref: f,
            onPointerMove: C(
              e.onPointerMove,
              ue((y) => {
                n
                  ? l.onItemLeave(y)
                  : (l.onItemEnter(y),
                    y.defaultPrevented ||
                      y.currentTarget.focus({ preventScroll: !0 }));
              }),
            ),
            onPointerLeave: C(
              e.onPointerLeave,
              ue((y) => l.onItemLeave(y)),
            ),
            onFocus: C(e.onFocus, () => d(!0)),
            onBlur: C(e.onBlur, () => d(!1)),
          }),
        }),
      })
    );
  }),
  wa = "MenuCheckboxItem",
  Ur = s.forwardRef((e, t) => {
    const { checked: r = !1, onCheckedChange: n, ...o } = e;
    return i.jsx(Wr, {
      scope: e.__scopeMenu,
      checked: r,
      children: i.jsx(Ue, {
        role: "menuitemcheckbox",
        "aria-checked": je(r) ? "mixed" : r,
        ...o,
        ref: t,
        "data-state": wt(r),
        onSelect: C(o.onSelect, () => n?.(je(r) ? !0 : !r), {
          checkForDefaultPrevented: !1,
        }),
      }),
    });
  });
Ur.displayName = wa;
var Kr = "MenuRadioGroup",
  [Sa, Ca] = Q(Kr, { value: void 0, onValueChange: () => {} }),
  zr = s.forwardRef((e, t) => {
    const { value: r, onValueChange: n, ...o } = e,
      a = L(n);
    return i.jsx(Sa, {
      scope: e.__scopeMenu,
      value: r,
      onValueChange: a,
      children: i.jsx(yt, { ...o, ref: t }),
    });
  });
zr.displayName = Kr;
var $r = "MenuRadioItem",
  Br = s.forwardRef((e, t) => {
    const { value: r, ...n } = e,
      o = Ca($r, e.__scopeMenu),
      a = r === o.value;
    return i.jsx(Wr, {
      scope: e.__scopeMenu,
      checked: a,
      children: i.jsx(Ue, {
        role: "menuitemradio",
        "aria-checked": a,
        ...n,
        ref: t,
        "data-state": wt(a),
        onSelect: C(n.onSelect, () => o.onValueChange?.(r), {
          checkForDefaultPrevented: !1,
        }),
      }),
    });
  });
Br.displayName = $r;
var xt = "MenuItemIndicator",
  [Wr, Ea] = Q(xt, { checked: !1 }),
  Gr = s.forwardRef((e, t) => {
    const { __scopeMenu: r, forceMount: n, ...o } = e,
      a = Ea(xt, r);
    return i.jsx(Y, {
      present: n || je(a.checked) || a.checked === !0,
      children: i.jsx(O.span, { ...o, ref: t, "data-state": wt(a.checked) }),
    });
  });
Gr.displayName = xt;
var Ra = "MenuSeparator",
  Hr = s.forwardRef((e, t) => {
    const { __scopeMenu: r, ...n } = e;
    return i.jsx(O.div, {
      role: "separator",
      "aria-orientation": "horizontal",
      ...n,
      ref: t,
    });
  });
Hr.displayName = Ra;
var Ma = "MenuArrow",
  Vr = s.forwardRef((e, t) => {
    const { __scopeMenu: r, ...n } = e,
      o = Le(r);
    return i.jsx(Hn, { ...o, ...n, ref: t });
  });
Vr.displayName = Ma;
var _a = "MenuSub",
  [Ii, Yr] = Q(_a),
  ie = "MenuSubTrigger",
  Xr = s.forwardRef((e, t) => {
    const r = q(ie, e.__scopeMenu),
      n = pe(ie, e.__scopeMenu),
      o = Yr(ie, e.__scopeMenu),
      a = gt(ie, e.__scopeMenu),
      l = s.useRef(null),
      { pointerGraceTimerRef: c, onPointerGraceIntentChange: p } = a,
      f = { __scopeMenu: e.__scopeMenu },
      u = s.useCallback(() => {
        (l.current && window.clearTimeout(l.current), (l.current = null));
      }, []);
    return (
      s.useEffect(() => u, [u]),
      s.useEffect(() => {
        const d = c.current;
        return () => {
          (window.clearTimeout(d), p(null));
        };
      }, [c, p]),
      i.jsx(mt, {
        asChild: !0,
        ...f,
        children: i.jsx(Lr, {
          id: o.triggerId,
          "aria-haspopup": "menu",
          "aria-expanded": r.open,
          "aria-controls": o.contentId,
          "data-state": Zr(r.open),
          ...e,
          ref: at(t, o.onTriggerChange),
          onClick: (d) => {
            (e.onClick?.(d),
              !(e.disabled || d.defaultPrevented) &&
                (d.currentTarget.focus(), r.open || r.onOpenChange(!0)));
          },
          onPointerMove: C(
            e.onPointerMove,
            ue((d) => {
              (a.onItemEnter(d),
                !d.defaultPrevented &&
                  !e.disabled &&
                  !r.open &&
                  !l.current &&
                  (a.onPointerGraceIntentChange(null),
                  (l.current = window.setTimeout(() => {
                    (r.onOpenChange(!0), u());
                  }, 100))));
            }),
          ),
          onPointerLeave: C(
            e.onPointerLeave,
            ue((d) => {
              u();
              const h = r.content?.getBoundingClientRect();
              if (h) {
                const g = r.content?.dataset.side,
                  y = g === "right",
                  v = y ? -5 : 5,
                  m = h[y ? "left" : "right"],
                  b = h[y ? "right" : "left"];
                (a.onPointerGraceIntentChange({
                  area: [
                    { x: d.clientX + v, y: d.clientY },
                    { x: m, y: h.top },
                    { x: b, y: h.top },
                    { x: b, y: h.bottom },
                    { x: m, y: h.bottom },
                  ],
                  side: g,
                }),
                  window.clearTimeout(c.current),
                  (c.current = window.setTimeout(
                    () => a.onPointerGraceIntentChange(null),
                    300,
                  )));
              } else {
                if ((a.onTriggerLeave(d), d.defaultPrevented)) return;
                a.onPointerGraceIntentChange(null);
              }
            }),
          ),
          onKeyDown: C(e.onKeyDown, (d) => {
            const h = a.searchRef.current !== "";
            e.disabled ||
              (h && d.key === " ") ||
              (ia[n.dir].includes(d.key) &&
                (r.onOpenChange(!0), r.content?.focus(), d.preventDefault()));
          }),
        }),
      })
    );
  });
Xr.displayName = ie;
var Qr = "MenuSubContent",
  qr = s.forwardRef((e, t) => {
    const r = Dr(U, e.__scopeMenu),
      { forceMount: n = r.forceMount, ...o } = e,
      a = q(U, e.__scopeMenu),
      l = pe(U, e.__scopeMenu),
      c = Yr(Qr, e.__scopeMenu),
      p = s.useRef(null),
      f = F(t, p);
    return i.jsx(le.Provider, {
      scope: e.__scopeMenu,
      children: i.jsx(Y, {
        present: n || a.open,
        children: i.jsx(le.Slot, {
          scope: e.__scopeMenu,
          children: i.jsx(bt, {
            id: c.contentId,
            "aria-labelledby": c.triggerId,
            ...o,
            ref: f,
            align: "start",
            side: l.dir === "rtl" ? "left" : "right",
            disableOutsidePointerEvents: !1,
            disableOutsideScroll: !1,
            trapFocus: !1,
            onOpenAutoFocus: (u) => {
              (l.isUsingKeyboardRef.current && p.current?.focus(),
                u.preventDefault());
            },
            onCloseAutoFocus: (u) => u.preventDefault(),
            onFocusOutside: C(e.onFocusOutside, (u) => {
              u.target !== c.trigger && a.onOpenChange(!1);
            }),
            onEscapeKeyDown: C(e.onEscapeKeyDown, (u) => {
              (l.onClose(), u.preventDefault());
            }),
            onKeyDown: C(e.onKeyDown, (u) => {
              const d = u.currentTarget.contains(u.target),
                h = ca[l.dir].includes(u.key);
              d &&
                h &&
                (a.onOpenChange(!1), c.trigger?.focus(), u.preventDefault());
            }),
          }),
        }),
      }),
    });
  });
qr.displayName = Qr;
function Zr(e) {
  return e ? "open" : "closed";
}
function je(e) {
  return e === "indeterminate";
}
function wt(e) {
  return je(e) ? "indeterminate" : e ? "checked" : "unchecked";
}
function Pa(e) {
  const t = document.activeElement;
  for (const r of e)
    if (r === t || (r.focus(), document.activeElement !== t)) return;
}
function Ta(e, t) {
  return e.map((r, n) => e[(t + n) % e.length]);
}
function Na(e, t, r) {
  const o = t.length > 1 && Array.from(t).every((f) => f === t[0]) ? t[0] : t,
    a = r ? e.indexOf(r) : -1;
  let l = Ta(e, Math.max(a, 0));
  o.length === 1 && (l = l.filter((f) => f !== r));
  const p = l.find((f) => f.toLowerCase().startsWith(o.toLowerCase()));
  return p !== r ? p : void 0;
}
function Ia(e, t) {
  const { x: r, y: n } = e;
  let o = !1;
  for (let a = 0, l = t.length - 1; a < t.length; l = a++) {
    const c = t[a],
      p = t[l],
      f = c.x,
      u = c.y,
      d = p.x,
      h = p.y;
    u > n != h > n && r < ((d - f) * (n - u)) / (h - u) + f && (o = !o);
  }
  return o;
}
function ja(e, t) {
  if (!t) return !1;
  const r = { x: e.clientX, y: e.clientY };
  return Ia(r, t);
}
function ue(e) {
  return (t) => (t.pointerType === "mouse" ? e(t) : void 0);
}
var Aa = Ar,
  Da = mt,
  Oa = Or,
  ka = kr,
  Fa = yt,
  La = Fr,
  Ua = Ue,
  Ka = Ur,
  za = zr,
  $a = Br,
  Ba = Gr,
  Wa = Hr,
  Ga = Vr,
  Ha = Xr,
  Va = qr,
  Ke = "DropdownMenu",
  [Ya] = De(Ke, [Ir]),
  A = Ir(),
  [Xa, Jr] = Ya(Ke),
  en = (e) => {
    const {
        __scopeDropdownMenu: t,
        children: r,
        dir: n,
        open: o,
        defaultOpen: a,
        onOpenChange: l,
        modal: c = !0,
      } = e,
      p = A(t),
      f = s.useRef(null),
      [u, d] = Gt({ prop: o, defaultProp: a ?? !1, onChange: l, caller: Ke });
    return i.jsx(Xa, {
      scope: t,
      triggerId: Je(),
      triggerRef: f,
      contentId: Je(),
      open: u,
      onOpenChange: d,
      onOpenToggle: s.useCallback(() => d((h) => !h), [d]),
      modal: c,
      children: i.jsx(Aa, {
        ...p,
        open: u,
        onOpenChange: d,
        dir: n,
        modal: c,
        children: r,
      }),
    });
  };
en.displayName = Ke;
var tn = "DropdownMenuTrigger",
  rn = s.forwardRef((e, t) => {
    const { __scopeDropdownMenu: r, disabled: n = !1, ...o } = e,
      a = Jr(tn, r),
      l = A(r);
    return i.jsx(Da, {
      asChild: !0,
      ...l,
      children: i.jsx(O.button, {
        type: "button",
        id: a.triggerId,
        "aria-haspopup": "menu",
        "aria-expanded": a.open,
        "aria-controls": a.open ? a.contentId : void 0,
        "data-state": a.open ? "open" : "closed",
        "data-disabled": n ? "" : void 0,
        disabled: n,
        ...o,
        ref: at(t, a.triggerRef),
        onPointerDown: C(e.onPointerDown, (c) => {
          !n &&
            c.button === 0 &&
            c.ctrlKey === !1 &&
            (a.onOpenToggle(), a.open || c.preventDefault());
        }),
        onKeyDown: C(e.onKeyDown, (c) => {
          n ||
            (["Enter", " "].includes(c.key) && a.onOpenToggle(),
            c.key === "ArrowDown" && a.onOpenChange(!0),
            ["Enter", " ", "ArrowDown"].includes(c.key) && c.preventDefault());
        }),
      }),
    });
  });
rn.displayName = tn;
var Qa = "DropdownMenuPortal",
  nn = (e) => {
    const { __scopeDropdownMenu: t, ...r } = e,
      n = A(t);
    return i.jsx(Oa, { ...n, ...r });
  };
nn.displayName = Qa;
var on = "DropdownMenuContent",
  sn = s.forwardRef((e, t) => {
    const { __scopeDropdownMenu: r, ...n } = e,
      o = Jr(on, r),
      a = A(r),
      l = s.useRef(!1);
    return i.jsx(ka, {
      id: o.contentId,
      "aria-labelledby": o.triggerId,
      ...a,
      ...n,
      ref: t,
      onCloseAutoFocus: C(e.onCloseAutoFocus, (c) => {
        (l.current || o.triggerRef.current?.focus(),
          (l.current = !1),
          c.preventDefault());
      }),
      onInteractOutside: C(e.onInteractOutside, (c) => {
        const p = c.detail.originalEvent,
          f = p.button === 0 && p.ctrlKey === !0,
          u = p.button === 2 || f;
        (!o.modal || u) && (l.current = !0);
      }),
      style: {
        ...e.style,
        "--radix-dropdown-menu-content-transform-origin":
          "var(--radix-popper-transform-origin)",
        "--radix-dropdown-menu-content-available-width":
          "var(--radix-popper-available-width)",
        "--radix-dropdown-menu-content-available-height":
          "var(--radix-popper-available-height)",
        "--radix-dropdown-menu-trigger-width":
          "var(--radix-popper-anchor-width)",
        "--radix-dropdown-menu-trigger-height":
          "var(--radix-popper-anchor-height)",
      },
    });
  });
sn.displayName = on;
var qa = "DropdownMenuGroup",
  Za = s.forwardRef((e, t) => {
    const { __scopeDropdownMenu: r, ...n } = e,
      o = A(r);
    return i.jsx(Fa, { ...o, ...n, ref: t });
  });
Za.displayName = qa;
var Ja = "DropdownMenuLabel",
  an = s.forwardRef((e, t) => {
    const { __scopeDropdownMenu: r, ...n } = e,
      o = A(r);
    return i.jsx(La, { ...o, ...n, ref: t });
  });
an.displayName = Ja;
var ei = "DropdownMenuItem",
  cn = s.forwardRef((e, t) => {
    const { __scopeDropdownMenu: r, ...n } = e,
      o = A(r);
    return i.jsx(Ua, { ...o, ...n, ref: t });
  });
cn.displayName = ei;
var ti = "DropdownMenuCheckboxItem",
  ln = s.forwardRef((e, t) => {
    const { __scopeDropdownMenu: r, ...n } = e,
      o = A(r);
    return i.jsx(Ka, { ...o, ...n, ref: t });
  });
ln.displayName = ti;
var ri = "DropdownMenuRadioGroup",
  ni = s.forwardRef((e, t) => {
    const { __scopeDropdownMenu: r, ...n } = e,
      o = A(r);
    return i.jsx(za, { ...o, ...n, ref: t });
  });
ni.displayName = ri;
var oi = "DropdownMenuRadioItem",
  un = s.forwardRef((e, t) => {
    const { __scopeDropdownMenu: r, ...n } = e,
      o = A(r);
    return i.jsx($a, { ...o, ...n, ref: t });
  });
un.displayName = oi;
var si = "DropdownMenuItemIndicator",
  dn = s.forwardRef((e, t) => {
    const { __scopeDropdownMenu: r, ...n } = e,
      o = A(r);
    return i.jsx(Ba, { ...o, ...n, ref: t });
  });
dn.displayName = si;
var ai = "DropdownMenuSeparator",
  fn = s.forwardRef((e, t) => {
    const { __scopeDropdownMenu: r, ...n } = e,
      o = A(r);
    return i.jsx(Wa, { ...o, ...n, ref: t });
  });
fn.displayName = ai;
var ii = "DropdownMenuArrow",
  ci = s.forwardRef((e, t) => {
    const { __scopeDropdownMenu: r, ...n } = e,
      o = A(r);
    return i.jsx(Ga, { ...o, ...n, ref: t });
  });
ci.displayName = ii;
var li = "DropdownMenuSubTrigger",
  hn = s.forwardRef((e, t) => {
    const { __scopeDropdownMenu: r, ...n } = e,
      o = A(r);
    return i.jsx(Ha, { ...o, ...n, ref: t });
  });
hn.displayName = li;
var ui = "DropdownMenuSubContent",
  pn = s.forwardRef((e, t) => {
    const { __scopeDropdownMenu: r, ...n } = e,
      o = A(r);
    return i.jsx(Va, {
      ...o,
      ...n,
      ref: t,
      style: {
        ...e.style,
        "--radix-dropdown-menu-content-transform-origin":
          "var(--radix-popper-transform-origin)",
        "--radix-dropdown-menu-content-available-width":
          "var(--radix-popper-available-width)",
        "--radix-dropdown-menu-content-available-height":
          "var(--radix-popper-available-height)",
        "--radix-dropdown-menu-trigger-width":
          "var(--radix-popper-anchor-width)",
        "--radix-dropdown-menu-trigger-height":
          "var(--radix-popper-anchor-height)",
      },
    });
  });
pn.displayName = ui;
var di = en,
  fi = rn,
  hi = nn,
  mn = sn,
  vn = an,
  gn = cn,
  bn = ln,
  yn = un,
  xn = dn,
  wn = fn,
  Sn = hn,
  Cn = pn;
const pi = di,
  mi = fi,
  vi = s.forwardRef(({ className: e, inset: t, children: r, ...n }, o) =>
    i.jsxs(Sn, {
      ref: o,
      className: j(
        "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent",
        t && "pl-8",
        e,
      ),
      ...n,
      children: [r, i.jsx(Xt, { className: "ml-auto h-4 w-4" })],
    }),
  );
vi.displayName = Sn.displayName;
const gi = s.forwardRef(({ className: e, ...t }, r) =>
  i.jsx(Cn, {
    ref: r,
    className: j(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      e,
    ),
    ...t,
  }),
);
gi.displayName = Cn.displayName;
const En = s.forwardRef(({ className: e, sideOffset: t = 4, ...r }, n) =>
  i.jsx(hi, {
    children: i.jsx(mn, {
      ref: n,
      sideOffset: t,
      className: j(
        "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        e,
      ),
      ...r,
    }),
  }),
);
En.displayName = mn.displayName;
const Ee = s.forwardRef(({ className: e, inset: t, ...r }, n) =>
  i.jsx(gn, {
    ref: n,
    className: j(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      t && "pl-8",
      e,
    ),
    ...r,
  }),
);
Ee.displayName = gn.displayName;
const bi = s.forwardRef(({ className: e, children: t, checked: r, ...n }, o) =>
  i.jsxs(bn, {
    ref: o,
    className: j(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      e,
    ),
    checked: r,
    ...n,
    children: [
      i.jsx("span", {
        className:
          "absolute left-2 flex h-3.5 w-3.5 items-center justify-center",
        children: i.jsx(xn, { children: i.jsx(lo, { className: "h-4 w-4" }) }),
      }),
      t,
    ],
  }),
);
bi.displayName = bn.displayName;
const yi = s.forwardRef(({ className: e, children: t, ...r }, n) =>
  i.jsxs(yn, {
    ref: n,
    className: j(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      e,
    ),
    ...r,
    children: [
      i.jsx("span", {
        className:
          "absolute left-2 flex h-3.5 w-3.5 items-center justify-center",
        children: i.jsx(xn, {
          children: i.jsx(ho, { className: "h-2 w-2 fill-current" }),
        }),
      }),
      t,
    ],
  }),
);
yi.displayName = yn.displayName;
const xi = s.forwardRef(({ className: e, inset: t, ...r }, n) =>
  i.jsx(vn, {
    ref: n,
    className: j("px-2 py-1.5 text-sm font-semibold", t && "pl-8", e),
    ...r,
  }),
);
xi.displayName = vn.displayName;
const wi = s.forwardRef(({ className: e, ...t }, r) =>
  i.jsx(wn, { ref: r, className: j("-mx-1 my-1 h-px bg-muted", e), ...t }),
);
wi.displayName = wn.displayName;
function Rn({
  node: e,
  depth: t,
  activeId: r,
  onSelect: n,
  onCreateChild: o,
  onDelete: a,
  onToggleFavorite: l,
}) {
  const [c, p] = s.useState(!0),
    f = e.children.length > 0,
    u = e.id === r;
  return i.jsxs("div", {
    children: [
      i.jsxs("div", {
        className: j(
          "group flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer text-sm min-h-[30px]",
          u
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        ),
        style: { paddingLeft: `${t * 16 + 8}px` },
        onClick: () => n(e.id),
        children: [
          i.jsx("button", {
            className: j(
              "flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-accent",
              !f && "invisible",
            ),
            onClick: (d) => {
              (d.stopPropagation(), p(!c));
            },
            children: i.jsx(Xt, {
              size: 14,
              className: j("transition-transform", c && "rotate-90"),
            }),
          }),
          i.jsx("span", {
            className: "flex-shrink-0 w-5 text-center",
            children:
              e.icon ||
              i.jsx(tt, { size: 14, className: "text-muted-foreground" }),
          }),
          i.jsx("span", {
            className: "flex-1 truncate",
            children: e.title || "Untitled",
          }),
          i.jsxs("div", {
            className:
              "opacity-0 group-hover:opacity-100 flex items-center gap-0.5 flex-shrink-0",
            children: [
              i.jsxs(pi, {
                children: [
                  i.jsx(mi, {
                    asChild: !0,
                    children: i.jsx("button", {
                      className:
                        "w-5 h-5 flex items-center justify-center rounded hover:bg-accent",
                      onClick: (d) => d.stopPropagation(),
                      children: i.jsx(mo, { size: 14 }),
                    }),
                  }),
                  i.jsxs(En, {
                    align: "start",
                    className: "w-48",
                    children: [
                      i.jsxs(Ee, {
                        onClick: () => o(e.id),
                        children: [
                          i.jsx(_e, { size: 14, className: "mr-2" }),
                          "Add sub-page",
                        ],
                      }),
                      i.jsxs(Ee, {
                        onClick: () => l(e.id, !e.isFavorite),
                        children: [
                          i.jsx(Qt, {
                            size: 14,
                            className: j(
                              "mr-2",
                              e.isFavorite && "fill-current",
                            ),
                          }),
                          e.isFavorite
                            ? "Remove from favorites"
                            : "Add to favorites",
                        ],
                      }),
                      i.jsxs(Ee, {
                        className: "text-destructive",
                        onClick: () => a(e.id),
                        children: [
                          i.jsx(Mo, { size: 14, className: "mr-2" }),
                          "Delete",
                        ],
                      }),
                    ],
                  }),
                ],
              }),
              i.jsx("button", {
                className:
                  "w-5 h-5 flex items-center justify-center rounded hover:bg-accent",
                onClick: (d) => {
                  (d.stopPropagation(), o(e.id));
                },
                title: "Add sub-page",
                children: i.jsx(_e, { size: 14 }),
              }),
            ],
          }),
        ],
      }),
      f &&
        c &&
        i.jsx("div", {
          children: e.children.map((d) =>
            i.jsx(
              Rn,
              {
                node: d,
                depth: t + 1,
                activeId: r,
                onSelect: n,
                onCreateChild: o,
                onDelete: a,
                onToggleFavorite: l,
              },
              d.id,
            ),
          ),
        }),
    ],
  });
}
async function me(e, t) {
  const r = await fetch(e, t);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
function Si() {
  return Yt({
    queryKey: ["documents"],
    queryFn: () => me("/api/documents"),
    select: (e) => e.documents,
  });
}
function ji(e) {
  return Yt({
    queryKey: ["document", e],
    queryFn: () => me(`/api/documents/${e}`),
    enabled: !!e,
  });
}
function Ci() {
  const e = de();
  return ct({
    mutationFn: (t) =>
      me("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(t),
      }),
    onSuccess: () => {
      e.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}
function Ei() {
  const e = de();
  return ct({
    mutationFn: ({ id: t, ...r }) =>
      me(`/api/documents/${t}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(r),
      }),
    onSuccess: (t, r) => {
      (e.invalidateQueries({ queryKey: ["documents"] }),
        e.invalidateQueries({ queryKey: ["document", r.id] }));
    },
  });
}
function Ri() {
  const e = de();
  return ct({
    mutationFn: (t) => me(`/api/documents/${t}`, { method: "DELETE" }),
    onSuccess: () => {
      e.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}
function Mi(e) {
  const t = new Map(),
    r = [];
  for (const o of e) t.set(o.id, { ...o, children: [] });
  for (const o of e) {
    const a = t.get(o.id);
    o.parentId && t.has(o.parentId)
      ? t.get(o.parentId).children.push(a)
      : r.push(a);
  }
  const n = (o) => {
    o.sort((a, l) => a.position - l.position);
    for (const a of o) n(a.children);
  };
  return (n(r), r);
}
function _i({ activeDocumentId: e }) {
  const t = Pn(),
    { data: r = [] } = Si(),
    n = Ci(),
    o = Ri(),
    a = Ei(),
    [l, c] = s.useState(""),
    [p, f] = s.useState(!1),
    u = Mi(r),
    d = r.filter((m) => m.isFavorite),
    h = s.useCallback(
      async (m) => {
        const b = await n.mutateAsync({ parentId: m ?? null });
        t(`/${b.id}`);
      },
      [n, t],
    ),
    g = s.useCallback(
      async (m) => {
        (await o.mutateAsync(m), e === m && t("/"));
      },
      [o, e, t],
    ),
    y = s.useCallback(
      (m, b) => {
        a.mutate({ id: m, isFavorite: b });
      },
      [a],
    ),
    v = l
      ? r.filter((m) => m.title.toLowerCase().includes(l.toLowerCase()))
      : null;
  return i.jsxs("div", {
    className: "flex flex-col h-full w-60 border-r border-border bg-muted/30",
    children: [
      i.jsxs("div", {
        className:
          "flex items-center justify-between px-3 py-2 border-b border-border",
        children: [
          i.jsx("span", {
            className: "text-sm font-semibold text-foreground",
            children: "Documents",
          }),
          i.jsxs("div", {
            className: "flex items-center gap-1",
            children: [
              i.jsx("button", {
                className:
                  "w-7 h-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground",
                onClick: () => f(!p),
                title: "Search",
                children: i.jsx(wo, { size: 14 }),
              }),
              i.jsx("button", {
                className:
                  "w-7 h-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground",
                onClick: () => h(),
                title: "New page",
                children: i.jsx(_e, { size: 14 }),
              }),
            ],
          }),
        ],
      }),
      p &&
        i.jsx("div", {
          className: "px-3 py-2 border-b border-border",
          children: i.jsx("input", {
            autoFocus: !0,
            type: "text",
            placeholder: "Search pages...",
            value: l,
            onChange: (m) => c(m.target.value),
            onKeyDown: (m) => {
              m.key === "Escape" && (f(!1), c(""));
            },
            className:
              "w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring",
          }),
        }),
      i.jsx(ur, {
        className: "flex-1",
        children: i.jsx("div", {
          className: "py-2",
          children: v
            ? i.jsxs("div", {
                children: [
                  i.jsx("div", {
                    className:
                      "px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
                    children: "Results",
                  }),
                  v.length === 0
                    ? i.jsx("div", {
                        className:
                          "px-3 py-4 text-sm text-muted-foreground text-center",
                        children: "No pages found",
                      })
                    : v.map((m) =>
                        i.jsxs(
                          "button",
                          {
                            className: j(
                              "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left rounded-md",
                              m.id === e
                                ? "bg-accent text-accent-foreground"
                                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                            ),
                            onClick: () => {
                              (t(`/${m.id}`), f(!1), c(""));
                            },
                            children: [
                              i.jsx("span", {
                                className: "flex-shrink-0 w-5 text-center",
                                children: m.icon || i.jsx(tt, { size: 14 }),
                              }),
                              i.jsx("span", {
                                className: "truncate",
                                children: m.title || "Untitled",
                              }),
                            ],
                          },
                          m.id,
                        ),
                      ),
                ],
              })
            : i.jsxs(i.Fragment, {
                children: [
                  d.length > 0 &&
                    i.jsxs("div", {
                      className: "mb-2",
                      children: [
                        i.jsxs("div", {
                          className:
                            "px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1",
                          children: [i.jsx(Qt, { size: 10 }), "Favorites"],
                        }),
                        d.map((m) =>
                          i.jsxs(
                            "button",
                            {
                              className: j(
                                "w-full flex items-center gap-2 px-4 py-1.5 text-sm text-left rounded-md",
                                m.id === e
                                  ? "bg-accent text-accent-foreground"
                                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                              ),
                              onClick: () => t(`/${m.id}`),
                              children: [
                                i.jsx("span", {
                                  className: "flex-shrink-0 w-5 text-center",
                                  children: m.icon || i.jsx(tt, { size: 14 }),
                                }),
                                i.jsx("span", {
                                  className: "truncate",
                                  children: m.title || "Untitled",
                                }),
                              ],
                            },
                            m.id,
                          ),
                        ),
                      ],
                    }),
                  i.jsxs("div", {
                    children: [
                      i.jsx("div", {
                        className:
                          "px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
                        children: "Pages",
                      }),
                      u.length === 0
                        ? i.jsx("div", {
                            className:
                              "px-3 py-4 text-sm text-muted-foreground text-center",
                            children: "No pages yet",
                          })
                        : u.map((m) =>
                            i.jsx(
                              Rn,
                              {
                                node: m,
                                depth: 0,
                                activeId: e,
                                onSelect: (b) => t(`/${b}`),
                                onCreateChild: (b) => h(b),
                                onDelete: g,
                                onToggleFavorite: y,
                              },
                              m.id,
                            ),
                          ),
                    ],
                  }),
                ],
              }),
        }),
      }),
      i.jsxs("div", {
        className:
          "flex items-center justify-between px-3 py-2 border-t border-border",
        children: [
          i.jsxs(pt, {
            variant: "ghost",
            size: "sm",
            className: "h-8 px-2 text-xs text-muted-foreground",
            onClick: () => h(),
            children: [i.jsx(_e, { size: 14, className: "mr-1" }), "New page"],
          }),
          i.jsx(Zo, {}),
        ],
      }),
    ],
  });
}
function Ai({ activeDocumentId: e, children: t }) {
  return i.jsxs("div", {
    className: "flex h-screen overflow-hidden bg-background",
    children: [
      i.jsx(_i, { activeDocumentId: e }),
      i.jsx("main", {
        className: "flex-1 flex flex-col min-w-0 relative",
        children: t,
      }),
    ],
  });
}
export {
  Ai as A,
  pt as B,
  tt as F,
  _e as P,
  Mo as T,
  ji as a,
  Ei as b,
  Ci as u,
};
