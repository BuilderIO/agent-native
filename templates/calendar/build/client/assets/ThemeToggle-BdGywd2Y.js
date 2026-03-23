import {
  S as pn,
  t as Lt,
  v as G,
  w as je,
  r as Me,
  f as $e,
  x as ct,
  y as Wt,
  A as Sr,
  B as Le,
  j as Er,
  C as Rr,
  D as It,
  n as Qe,
  l as Ft,
  E as Mr,
  F as yt,
  u as mn,
  z as Tr,
} from "./index-qtsL5YWk.js";
import { r as d, j as S, B as bt, e as gn } from "./index-Coy-XKTg.js";
var Ar = class extends pn {
  constructor(e, t) {
    (super(),
      (this.options = t),
      (this.#n = e),
      (this.#a = null),
      (this.#i = Lt()),
      this.bindMethods(),
      this.setOptions(t));
  }
  #n;
  #e = void 0;
  #r = void 0;
  #t = void 0;
  #o;
  #s;
  #i;
  #a;
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
      jt(this.#e, this.options) ? this.#d() : this.updateResult(),
      this.#w());
  }
  onUnsubscribe() {
    this.hasListeners() || this.destroy();
  }
  shouldFetchOnReconnect() {
    return lt(this.#e, this.options, this.options.refetchOnReconnect);
  }
  shouldFetchOnWindowFocus() {
    return lt(this.#e, this.options, this.options.refetchOnWindowFocus);
  }
  destroy() {
    ((this.listeners = new Set()),
      this.#v(),
      this.#x(),
      this.#e.removeObserver(this));
  }
  setOptions(e) {
    const t = this.options,
      n = this.#e;
    if (
      ((this.options = this.#n.defaultQueryOptions(e)),
      this.options.enabled !== void 0 &&
        typeof this.options.enabled != "boolean" &&
        typeof this.options.enabled != "function" &&
        typeof G(this.options.enabled, this.#e) != "boolean")
    )
      throw new Error(
        "Expected enabled to be a boolean or a callback that returns a boolean",
      );
    (this.#C(),
      this.#e.setOptions(this.options),
      t._defaulted &&
        !je(this.options, t) &&
        this.#n
          .getQueryCache()
          .notify({
            type: "observerOptionsUpdated",
            query: this.#e,
            observer: this,
          }));
    const r = this.hasListeners();
    (r && $t(this.#e, n, this.options, t) && this.#d(),
      this.updateResult(),
      r &&
        (this.#e !== n ||
          G(this.options.enabled, this.#e) !== G(t.enabled, this.#e) ||
          Me(this.options.staleTime, this.#e) !== Me(t.staleTime, this.#e)) &&
        this.#g());
    const o = this.#y();
    r &&
      (this.#e !== n ||
        G(this.options.enabled, this.#e) !== G(t.enabled, this.#e) ||
        o !== this.#c) &&
      this.#b(o);
  }
  getOptimisticResult(e) {
    const t = this.#n.getQueryCache().build(this.#n, e),
      n = this.createResult(t, e);
    return (
      Dr(this, n) &&
        ((this.#t = n), (this.#s = this.options), (this.#o = this.#e.state)),
      n
    );
  }
  getCurrentResult() {
    return this.#t;
  }
  trackResult(e, t) {
    return new Proxy(e, {
      get: (n, r) => (
        this.trackProp(r),
        t?.(r),
        r === "promise" &&
          (this.trackProp("data"),
          !this.options.experimental_prefetchInRender &&
            this.#i.status === "pending" &&
            this.#i.reject(
              new Error(
                "experimental_prefetchInRender feature flag is not enabled",
              ),
            )),
        Reflect.get(n, r)
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
    const t = this.#n.defaultQueryOptions(e),
      n = this.#n.getQueryCache().build(this.#n, t);
    return n.fetch().then(() => this.createResult(n, t));
  }
  fetch(e) {
    return this.#d({ ...e, cancelRefetch: e.cancelRefetch ?? !0 }).then(
      () => (this.updateResult(), this.#t),
    );
  }
  #d(e) {
    this.#C();
    let t = this.#e.fetch(this.options, e);
    return (e?.throwOnError || (t = t.catch($e)), t);
  }
  #g() {
    this.#v();
    const e = Me(this.options.staleTime, this.#e);
    if (ct || this.#t.isStale || !Wt(e)) return;
    const n = Sr(this.#t.dataUpdatedAt, e) + 1;
    this.#l = Le.setTimeout(() => {
      this.#t.isStale || this.updateResult();
    }, n);
  }
  #y() {
    return (
      (typeof this.options.refetchInterval == "function"
        ? this.options.refetchInterval(this.#e)
        : this.options.refetchInterval) ?? !1
    );
  }
  #b(e) {
    (this.#x(),
      (this.#c = e),
      !(
        ct ||
        G(this.options.enabled, this.#e) === !1 ||
        !Wt(this.#c) ||
        this.#c === 0
      ) &&
        (this.#u = Le.setInterval(() => {
          (this.options.refetchIntervalInBackground || Er.isFocused()) &&
            this.#d();
        }, this.#c)));
  }
  #w() {
    (this.#g(), this.#b(this.#y()));
  }
  #v() {
    this.#l && (Le.clearTimeout(this.#l), (this.#l = void 0));
  }
  #x() {
    this.#u && (Le.clearInterval(this.#u), (this.#u = void 0));
  }
  createResult(e, t) {
    const n = this.#e,
      r = this.options,
      o = this.#t,
      s = this.#o,
      i = this.#s,
      l = e !== n ? e.state : this.#r,
      { state: u } = e;
    let c = { ...u },
      f = !1,
      h;
    if (t._optimisticResults) {
      const M = this.hasListeners(),
        D = !M && jt(e, t),
        A = M && $t(e, n, t, r);
      ((D || A) && (c = { ...c, ...Rr(u.data, e.options) }),
        t._optimisticResults === "isRestoring" && (c.fetchStatus = "idle"));
    }
    let { error: p, errorUpdatedAt: m, status: g } = c;
    h = c.data;
    let y = !1;
    if (t.placeholderData !== void 0 && h === void 0 && g === "pending") {
      let M;
      (o?.isPlaceholderData && t.placeholderData === i?.placeholderData
        ? ((M = o.data), (y = !0))
        : (M =
            typeof t.placeholderData == "function"
              ? t.placeholderData(this.#h?.state.data, this.#h)
              : t.placeholderData),
        M !== void 0 && ((g = "success"), (h = It(o?.data, M, t)), (f = !0)));
    }
    if (t.select && h !== void 0 && !y)
      if (o && h === s?.data && t.select === this.#m) h = this.#f;
      else
        try {
          ((this.#m = t.select),
            (h = t.select(h)),
            (h = It(o?.data, h, t)),
            (this.#f = h),
            (this.#a = null));
        } catch (M) {
          this.#a = M;
        }
    this.#a && ((p = this.#a), (h = this.#f), (m = Date.now()), (g = "error"));
    const b = c.fetchStatus === "fetching",
      w = g === "pending",
      C = g === "error",
      v = w && b,
      O = h !== void 0,
      x = {
        status: g,
        fetchStatus: c.fetchStatus,
        isPending: w,
        isSuccess: g === "success",
        isError: C,
        isInitialLoading: v,
        isLoading: v,
        data: h,
        dataUpdatedAt: c.dataUpdatedAt,
        error: p,
        errorUpdatedAt: m,
        failureCount: c.fetchFailureCount,
        failureReason: c.fetchFailureReason,
        errorUpdateCount: c.errorUpdateCount,
        isFetched: c.dataUpdateCount > 0 || c.errorUpdateCount > 0,
        isFetchedAfterMount:
          c.dataUpdateCount > l.dataUpdateCount ||
          c.errorUpdateCount > l.errorUpdateCount,
        isFetching: b,
        isRefetching: b && !w,
        isLoadingError: C && !O,
        isPaused: c.fetchStatus === "paused",
        isPlaceholderData: f,
        isRefetchError: C && O,
        isStale: wt(e, t),
        refetch: this.refetch,
        promise: this.#i,
        isEnabled: G(t.enabled, e) !== !1,
      };
    if (this.options.experimental_prefetchInRender) {
      const M = x.data !== void 0,
        D = x.status === "error" && !M,
        A = (N) => {
          D ? N.reject(x.error) : M && N.resolve(x.data);
        },
        I = () => {
          const N = (this.#i = x.promise = Lt());
          A(N);
        },
        P = this.#i;
      switch (P.status) {
        case "pending":
          e.queryHash === n.queryHash && A(P);
          break;
        case "fulfilled":
          (D || x.data !== P.value) && I();
          break;
        case "rejected":
          (!D || x.error !== P.reason) && I();
          break;
      }
    }
    return x;
  }
  updateResult() {
    const e = this.#t,
      t = this.createResult(this.#e, this.options);
    if (
      ((this.#o = this.#e.state),
      (this.#s = this.options),
      this.#o.data !== void 0 && (this.#h = this.#e),
      je(t, e))
    )
      return;
    this.#t = t;
    const n = () => {
      if (!e) return !0;
      const { notifyOnChangeProps: r } = this.options,
        o = typeof r == "function" ? r() : r;
      if (o === "all" || (!o && !this.#p.size)) return !0;
      const s = new Set(o ?? this.#p);
      return (
        this.options.throwOnError && s.add("error"),
        Object.keys(this.#t).some((i) => {
          const a = i;
          return this.#t[a] !== e[a] && s.has(a);
        })
      );
    };
    this.#O({ listeners: n() });
  }
  #C() {
    const e = this.#n.getQueryCache().build(this.#n, this.options);
    if (e === this.#e) return;
    const t = this.#e;
    ((this.#e = e),
      (this.#r = e.state),
      this.hasListeners() && (t?.removeObserver(this), e.addObserver(this)));
  }
  onQueryUpdate() {
    (this.updateResult(), this.hasListeners() && this.#w());
  }
  #O(e) {
    Qe.batch(() => {
      (e.listeners &&
        this.listeners.forEach((t) => {
          t(this.#t);
        }),
        this.#n
          .getQueryCache()
          .notify({ query: this.#e, type: "observerResultsUpdated" }));
    });
  }
};
function kr(e, t) {
  return (
    G(t.enabled, e) !== !1 &&
    e.state.data === void 0 &&
    !(e.state.status === "error" && t.retryOnMount === !1)
  );
}
function jt(e, t) {
  return kr(e, t) || (e.state.data !== void 0 && lt(e, t, t.refetchOnMount));
}
function lt(e, t, n) {
  if (G(t.enabled, e) !== !1 && Me(t.staleTime, e) !== "static") {
    const r = typeof n == "function" ? n(e) : n;
    return r === "always" || (r !== !1 && wt(e, t));
  }
  return !1;
}
function $t(e, t, n, r) {
  return (
    (e !== t || G(r.enabled, e) === !1) &&
    (!n.suspense || e.state.status !== "error") &&
    wt(e, n)
  );
}
function wt(e, t) {
  return G(t.enabled, e) !== !1 && e.isStaleByTime(Me(t.staleTime, e));
}
function Dr(e, t) {
  return !je(e.getCurrentResult(), t);
}
var Nr = class extends pn {
    #n;
    #e = void 0;
    #r;
    #t;
    constructor(e, t) {
      (super(),
        (this.#n = e),
        this.setOptions(t),
        this.bindMethods(),
        this.#o());
    }
    bindMethods() {
      ((this.mutate = this.mutate.bind(this)),
        (this.reset = this.reset.bind(this)));
    }
    setOptions(e) {
      const t = this.options;
      ((this.options = this.#n.defaultMutationOptions(e)),
        je(this.options, t) ||
          this.#n
            .getMutationCache()
            .notify({
              type: "observerOptionsUpdated",
              mutation: this.#r,
              observer: this,
            }),
        t?.mutationKey &&
        this.options.mutationKey &&
        Ft(t.mutationKey) !== Ft(this.options.mutationKey)
          ? this.reset()
          : this.#r?.state.status === "pending" &&
            this.#r.setOptions(this.options));
    }
    onUnsubscribe() {
      this.hasListeners() || this.#r?.removeObserver(this);
    }
    onMutationUpdate(e) {
      (this.#o(), this.#s(e));
    }
    getCurrentResult() {
      return this.#e;
    }
    reset() {
      (this.#r?.removeObserver(this), (this.#r = void 0), this.#o(), this.#s());
    }
    mutate(e, t) {
      return (
        (this.#t = t),
        this.#r?.removeObserver(this),
        (this.#r = this.#n.getMutationCache().build(this.#n, this.options)),
        this.#r.addObserver(this),
        this.#r.execute(e)
      );
    }
    #o() {
      const e = this.#r?.state ?? Mr();
      this.#e = {
        ...e,
        isPending: e.status === "pending",
        isSuccess: e.status === "success",
        isError: e.status === "error",
        isIdle: e.status === "idle",
        mutate: this.mutate,
        reset: this.reset,
      };
    }
    #s(e) {
      Qe.batch(() => {
        if (this.#t && this.hasListeners()) {
          const t = this.#e.variables,
            n = this.#e.context,
            r = {
              client: this.#n,
              meta: this.options.meta,
              mutationKey: this.options.mutationKey,
            };
          if (e?.type === "success") {
            try {
              this.#t.onSuccess?.(e.data, t, n, r);
            } catch (o) {
              Promise.reject(o);
            }
            try {
              this.#t.onSettled?.(e.data, null, t, n, r);
            } catch (o) {
              Promise.reject(o);
            }
          } else if (e?.type === "error") {
            try {
              this.#t.onError?.(e.error, t, n, r);
            } catch (o) {
              Promise.reject(o);
            }
            try {
              this.#t.onSettled?.(void 0, e.error, t, n, r);
            } catch (o) {
              Promise.reject(o);
            }
          }
        }
        this.listeners.forEach((t) => {
          t(this.#e);
        });
      });
    }
  },
  yn = d.createContext(!1),
  _r = () => d.useContext(yn);
yn.Provider;
function Lr() {
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
var Wr = d.createContext(Lr()),
  Ir = () => d.useContext(Wr),
  Fr = (e, t, n) => {
    const r =
      n?.state.error && typeof e.throwOnError == "function"
        ? yt(e.throwOnError, [n.state.error, n])
        : e.throwOnError;
    (e.suspense || e.experimental_prefetchInRender || r) &&
      (t.isReset() || (e.retryOnMount = !1));
  },
  jr = (e) => {
    d.useEffect(() => {
      e.clearReset();
    }, [e]);
  },
  $r = ({
    result: e,
    errorResetBoundary: t,
    throwOnError: n,
    query: r,
    suspense: o,
  }) =>
    e.isError &&
    !t.isReset() &&
    !e.isFetching &&
    r &&
    ((o && e.data === void 0) || yt(n, [e.error, r])),
  zr = (e) => {
    if (e.suspense) {
      const n = (o) => (o === "static" ? o : Math.max(o ?? 1e3, 1e3)),
        r = e.staleTime;
      ((e.staleTime = typeof r == "function" ? (...o) => n(r(...o)) : n(r)),
        typeof e.gcTime == "number" && (e.gcTime = Math.max(e.gcTime, 1e3)));
    }
  },
  Hr = (e, t) => e.isLoading && e.isFetching && !t,
  Yr = (e, t) => e?.suspense && t.isPending,
  zt = (e, t, n) =>
    t.fetchOptimistic(e).catch(() => {
      n.clearReset();
    });
function Br(e, t, n) {
  const r = _r(),
    o = Ir(),
    s = mn(),
    i = s.defaultQueryOptions(e);
  s.getDefaultOptions().queries?._experimental_beforeQuery?.(i);
  const a = s.getQueryCache().get(i.queryHash);
  ((i._optimisticResults = r ? "isRestoring" : "optimistic"),
    zr(i),
    Fr(i, o, a),
    jr(o));
  const l = !s.getQueryCache().get(i.queryHash),
    [u] = d.useState(() => new t(s, i)),
    c = u.getOptimisticResult(i),
    f = !r && e.subscribed !== !1;
  if (
    (d.useSyncExternalStore(
      d.useCallback(
        (h) => {
          const p = f ? u.subscribe(Qe.batchCalls(h)) : $e;
          return (u.updateResult(), p);
        },
        [u, f],
      ),
      () => u.getCurrentResult(),
      () => u.getCurrentResult(),
    ),
    d.useEffect(() => {
      u.setOptions(i);
    }, [i, u]),
    Yr(i, c))
  )
    throw zt(i, u, o);
  if (
    $r({
      result: c,
      errorResetBoundary: o,
      throwOnError: i.throwOnError,
      query: a,
      suspense: i.suspense,
    })
  )
    throw c.error;
  return (
    s.getDefaultOptions().queries?._experimental_afterQuery?.(i, c),
    i.experimental_prefetchInRender &&
      !ct &&
      Hr(c, r) &&
      (l ? zt(i, u, o) : a?.promise)?.catch($e).finally(() => {
        u.updateResult();
      }),
    i.notifyOnChangeProps ? c : u.trackResult(c)
  );
}
function mc(e, t) {
  return Br(e, Ar);
}
function gc(e, t) {
  const n = mn(),
    [r] = d.useState(() => new Nr(n, e));
  d.useEffect(() => {
    r.setOptions(e);
  }, [r, e]);
  const o = d.useSyncExternalStore(
      d.useCallback((i) => r.subscribe(Qe.batchCalls(i)), [r]),
      () => r.getCurrentResult(),
      () => r.getCurrentResult(),
    ),
    s = d.useCallback(
      (i, a) => {
        r.mutate(i, a).catch($e);
      },
      [r],
    );
  if (o.error && yt(r.options.throwOnError, [o.error])) throw o.error;
  return { ...o, mutate: s, mutateAsync: o.mutate };
}
function bn(e) {
  var t,
    n,
    r = "";
  if (typeof e == "string" || typeof e == "number") r += e;
  else if (typeof e == "object")
    if (Array.isArray(e)) {
      var o = e.length;
      for (t = 0; t < o; t++)
        e[t] && (n = bn(e[t])) && (r && (r += " "), (r += n));
    } else for (n in e) e[n] && (r && (r += " "), (r += n));
  return r;
}
function wn() {
  for (var e, t, n = 0, r = "", o = arguments.length; n < o; n++)
    (e = arguments[n]) && (t = bn(e)) && (r && (r += " "), (r += t));
  return r;
}
const vt = "-",
  Vr = (e) => {
    const t = Gr(e),
      { conflictingClassGroups: n, conflictingClassGroupModifiers: r } = e;
    return {
      getClassGroupId: (i) => {
        const a = i.split(vt);
        return (a[0] === "" && a.length !== 1 && a.shift(), vn(a, t) || Ur(i));
      },
      getConflictingClassGroupIds: (i, a) => {
        const l = n[i] || [];
        return a && r[i] ? [...l, ...r[i]] : l;
      },
    };
  },
  vn = (e, t) => {
    if (e.length === 0) return t.classGroupId;
    const n = e[0],
      r = t.nextPart.get(n),
      o = r ? vn(e.slice(1), r) : void 0;
    if (o) return o;
    if (t.validators.length === 0) return;
    const s = e.join(vt);
    return t.validators.find(({ validator: i }) => i(s))?.classGroupId;
  },
  Ht = /^\[(.+)\]$/,
  Ur = (e) => {
    if (Ht.test(e)) {
      const t = Ht.exec(e)[1],
        n = t?.substring(0, t.indexOf(":"));
      if (n) return "arbitrary.." + n;
    }
  },
  Gr = (e) => {
    const { theme: t, prefix: n } = e,
      r = { nextPart: new Map(), validators: [] };
    return (
      qr(Object.entries(e.classGroups), n).forEach(([s, i]) => {
        ut(i, r, s, t);
      }),
      r
    );
  },
  ut = (e, t, n, r) => {
    e.forEach((o) => {
      if (typeof o == "string") {
        const s = o === "" ? t : Yt(t, o);
        s.classGroupId = n;
        return;
      }
      if (typeof o == "function") {
        if (Qr(o)) {
          ut(o(r), t, n, r);
          return;
        }
        t.validators.push({ validator: o, classGroupId: n });
        return;
      }
      Object.entries(o).forEach(([s, i]) => {
        ut(i, Yt(t, s), n, r);
      });
    });
  },
  Yt = (e, t) => {
    let n = e;
    return (
      t.split(vt).forEach((r) => {
        (n.nextPart.has(r) ||
          n.nextPart.set(r, { nextPart: new Map(), validators: [] }),
          (n = n.nextPart.get(r)));
      }),
      n
    );
  },
  Qr = (e) => e.isThemeGetter,
  qr = (e, t) =>
    t
      ? e.map(([n, r]) => {
          const o = r.map((s) =>
            typeof s == "string"
              ? t + s
              : typeof s == "object"
                ? Object.fromEntries(
                    Object.entries(s).map(([i, a]) => [t + i, a]),
                  )
                : s,
          );
          return [n, o];
        })
      : e,
  Xr = (e) => {
    if (e < 1) return { get: () => {}, set: () => {} };
    let t = 0,
      n = new Map(),
      r = new Map();
    const o = (s, i) => {
      (n.set(s, i), t++, t > e && ((t = 0), (r = n), (n = new Map())));
    };
    return {
      get(s) {
        let i = n.get(s);
        if (i !== void 0) return i;
        if ((i = r.get(s)) !== void 0) return (o(s, i), i);
      },
      set(s, i) {
        n.has(s) ? n.set(s, i) : o(s, i);
      },
    };
  },
  xn = "!",
  Kr = (e) => {
    const { separator: t, experimentalParseClassName: n } = e,
      r = t.length === 1,
      o = t[0],
      s = t.length,
      i = (a) => {
        const l = [];
        let u = 0,
          c = 0,
          f;
        for (let y = 0; y < a.length; y++) {
          let b = a[y];
          if (u === 0) {
            if (b === o && (r || a.slice(y, y + s) === t)) {
              (l.push(a.slice(c, y)), (c = y + s));
              continue;
            }
            if (b === "/") {
              f = y;
              continue;
            }
          }
          b === "[" ? u++ : b === "]" && u--;
        }
        const h = l.length === 0 ? a : a.substring(c),
          p = h.startsWith(xn),
          m = p ? h.substring(1) : h,
          g = f && f > c ? f - c : void 0;
        return {
          modifiers: l,
          hasImportantModifier: p,
          baseClassName: m,
          maybePostfixModifierPosition: g,
        };
      };
    return n ? (a) => n({ className: a, parseClassName: i }) : i;
  },
  Jr = (e) => {
    if (e.length <= 1) return e;
    const t = [];
    let n = [];
    return (
      e.forEach((r) => {
        r[0] === "[" ? (t.push(...n.sort(), r), (n = [])) : n.push(r);
      }),
      t.push(...n.sort()),
      t
    );
  },
  Zr = (e) => ({ cache: Xr(e.cacheSize), parseClassName: Kr(e), ...Vr(e) }),
  eo = /\s+/,
  to = (e, t) => {
    const {
        parseClassName: n,
        getClassGroupId: r,
        getConflictingClassGroupIds: o,
      } = t,
      s = [],
      i = e.trim().split(eo);
    let a = "";
    for (let l = i.length - 1; l >= 0; l -= 1) {
      const u = i[l],
        {
          modifiers: c,
          hasImportantModifier: f,
          baseClassName: h,
          maybePostfixModifierPosition: p,
        } = n(u);
      let m = !!p,
        g = r(m ? h.substring(0, p) : h);
      if (!g) {
        if (!m) {
          a = u + (a.length > 0 ? " " + a : a);
          continue;
        }
        if (((g = r(h)), !g)) {
          a = u + (a.length > 0 ? " " + a : a);
          continue;
        }
        m = !1;
      }
      const y = Jr(c).join(":"),
        b = f ? y + xn : y,
        w = b + g;
      if (s.includes(w)) continue;
      s.push(w);
      const C = o(g, m);
      for (let v = 0; v < C.length; ++v) {
        const O = C[v];
        s.push(b + O);
      }
      a = u + (a.length > 0 ? " " + a : a);
    }
    return a;
  };
function no() {
  let e = 0,
    t,
    n,
    r = "";
  for (; e < arguments.length; )
    (t = arguments[e++]) && (n = Cn(t)) && (r && (r += " "), (r += n));
  return r;
}
const Cn = (e) => {
  if (typeof e == "string") return e;
  let t,
    n = "";
  for (let r = 0; r < e.length; r++)
    e[r] && (t = Cn(e[r])) && (n && (n += " "), (n += t));
  return n;
};
function ro(e, ...t) {
  let n,
    r,
    o,
    s = i;
  function i(l) {
    const u = t.reduce((c, f) => f(c), e());
    return ((n = Zr(u)), (r = n.cache.get), (o = n.cache.set), (s = a), a(l));
  }
  function a(l) {
    const u = r(l);
    if (u) return u;
    const c = to(l, n);
    return (o(l, c), c);
  }
  return function () {
    return s(no.apply(null, arguments));
  };
}
const L = (e) => {
    const t = (n) => n[e] || [];
    return ((t.isThemeGetter = !0), t);
  },
  On = /^\[(?:([a-z-]+):)?(.+)\]$/i,
  oo = /^\d+\/\d+$/,
  so = new Set(["px", "full", "screen"]),
  io = /^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/,
  ao =
    /\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/,
  co = /^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix)\(.+\)$/,
  lo = /^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/,
  uo =
    /^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/,
  Z = (e) => ge(e) || so.has(e) || oo.test(e),
  oe = (e) => ve(e, "length", wo),
  ge = (e) => !!e && !Number.isNaN(Number(e)),
  rt = (e) => ve(e, "number", ge),
  Pe = (e) => !!e && Number.isInteger(Number(e)),
  fo = (e) => e.endsWith("%") && ge(e.slice(0, -1)),
  R = (e) => On.test(e),
  se = (e) => io.test(e),
  ho = new Set(["length", "size", "percentage"]),
  po = (e) => ve(e, ho, Pn),
  mo = (e) => ve(e, "position", Pn),
  go = new Set(["image", "url"]),
  yo = (e) => ve(e, go, xo),
  bo = (e) => ve(e, "", vo),
  Se = () => !0,
  ve = (e, t, n) => {
    const r = On.exec(e);
    return r
      ? r[1]
        ? typeof t == "string"
          ? r[1] === t
          : t.has(r[1])
        : n(r[2])
      : !1;
  },
  wo = (e) => ao.test(e) && !co.test(e),
  Pn = () => !1,
  vo = (e) => lo.test(e),
  xo = (e) => uo.test(e),
  Co = () => {
    const e = L("colors"),
      t = L("spacing"),
      n = L("blur"),
      r = L("brightness"),
      o = L("borderColor"),
      s = L("borderRadius"),
      i = L("borderSpacing"),
      a = L("borderWidth"),
      l = L("contrast"),
      u = L("grayscale"),
      c = L("hueRotate"),
      f = L("invert"),
      h = L("gap"),
      p = L("gradientColorStops"),
      m = L("gradientColorStopPositions"),
      g = L("inset"),
      y = L("margin"),
      b = L("opacity"),
      w = L("padding"),
      C = L("saturate"),
      v = L("scale"),
      O = L("sepia"),
      E = L("skew"),
      x = L("space"),
      M = L("translate"),
      D = () => ["auto", "contain", "none"],
      A = () => ["auto", "hidden", "clip", "visible", "scroll"],
      I = () => ["auto", R, t],
      P = () => [R, t],
      N = () => ["", Z, oe],
      _ = () => ["auto", ge, R],
      $ = () => [
        "bottom",
        "center",
        "left",
        "left-bottom",
        "left-top",
        "right",
        "right-bottom",
        "right-top",
        "top",
      ],
      W = () => ["solid", "dashed", "dotted", "double", "none"],
      F = () => [
        "normal",
        "multiply",
        "screen",
        "overlay",
        "darken",
        "lighten",
        "color-dodge",
        "color-burn",
        "hard-light",
        "soft-light",
        "difference",
        "exclusion",
        "hue",
        "saturation",
        "color",
        "luminosity",
      ],
      T = () => [
        "start",
        "end",
        "center",
        "between",
        "around",
        "evenly",
        "stretch",
      ],
      j = () => ["", "0", R],
      H = () => [
        "auto",
        "avoid",
        "all",
        "avoid-page",
        "page",
        "left",
        "right",
        "column",
      ],
      U = () => [ge, R];
    return {
      cacheSize: 500,
      separator: ":",
      theme: {
        colors: [Se],
        spacing: [Z, oe],
        blur: ["none", "", se, R],
        brightness: U(),
        borderColor: [e],
        borderRadius: ["none", "", "full", se, R],
        borderSpacing: P(),
        borderWidth: N(),
        contrast: U(),
        grayscale: j(),
        hueRotate: U(),
        invert: j(),
        gap: P(),
        gradientColorStops: [e],
        gradientColorStopPositions: [fo, oe],
        inset: I(),
        margin: I(),
        opacity: U(),
        padding: P(),
        saturate: U(),
        scale: U(),
        sepia: j(),
        skew: U(),
        space: P(),
        translate: P(),
      },
      classGroups: {
        aspect: [{ aspect: ["auto", "square", "video", R] }],
        container: ["container"],
        columns: [{ columns: [se] }],
        "break-after": [{ "break-after": H() }],
        "break-before": [{ "break-before": H() }],
        "break-inside": [
          { "break-inside": ["auto", "avoid", "avoid-page", "avoid-column"] },
        ],
        "box-decoration": [{ "box-decoration": ["slice", "clone"] }],
        box: [{ box: ["border", "content"] }],
        display: [
          "block",
          "inline-block",
          "inline",
          "flex",
          "inline-flex",
          "table",
          "inline-table",
          "table-caption",
          "table-cell",
          "table-column",
          "table-column-group",
          "table-footer-group",
          "table-header-group",
          "table-row-group",
          "table-row",
          "flow-root",
          "grid",
          "inline-grid",
          "contents",
          "list-item",
          "hidden",
        ],
        float: [{ float: ["right", "left", "none", "start", "end"] }],
        clear: [{ clear: ["left", "right", "both", "none", "start", "end"] }],
        isolation: ["isolate", "isolation-auto"],
        "object-fit": [
          { object: ["contain", "cover", "fill", "none", "scale-down"] },
        ],
        "object-position": [{ object: [...$(), R] }],
        overflow: [{ overflow: A() }],
        "overflow-x": [{ "overflow-x": A() }],
        "overflow-y": [{ "overflow-y": A() }],
        overscroll: [{ overscroll: D() }],
        "overscroll-x": [{ "overscroll-x": D() }],
        "overscroll-y": [{ "overscroll-y": D() }],
        position: ["static", "fixed", "absolute", "relative", "sticky"],
        inset: [{ inset: [g] }],
        "inset-x": [{ "inset-x": [g] }],
        "inset-y": [{ "inset-y": [g] }],
        start: [{ start: [g] }],
        end: [{ end: [g] }],
        top: [{ top: [g] }],
        right: [{ right: [g] }],
        bottom: [{ bottom: [g] }],
        left: [{ left: [g] }],
        visibility: ["visible", "invisible", "collapse"],
        z: [{ z: ["auto", Pe, R] }],
        basis: [{ basis: I() }],
        "flex-direction": [
          { flex: ["row", "row-reverse", "col", "col-reverse"] },
        ],
        "flex-wrap": [{ flex: ["wrap", "wrap-reverse", "nowrap"] }],
        flex: [{ flex: ["1", "auto", "initial", "none", R] }],
        grow: [{ grow: j() }],
        shrink: [{ shrink: j() }],
        order: [{ order: ["first", "last", "none", Pe, R] }],
        "grid-cols": [{ "grid-cols": [Se] }],
        "col-start-end": [{ col: ["auto", { span: ["full", Pe, R] }, R] }],
        "col-start": [{ "col-start": _() }],
        "col-end": [{ "col-end": _() }],
        "grid-rows": [{ "grid-rows": [Se] }],
        "row-start-end": [{ row: ["auto", { span: [Pe, R] }, R] }],
        "row-start": [{ "row-start": _() }],
        "row-end": [{ "row-end": _() }],
        "grid-flow": [
          { "grid-flow": ["row", "col", "dense", "row-dense", "col-dense"] },
        ],
        "auto-cols": [{ "auto-cols": ["auto", "min", "max", "fr", R] }],
        "auto-rows": [{ "auto-rows": ["auto", "min", "max", "fr", R] }],
        gap: [{ gap: [h] }],
        "gap-x": [{ "gap-x": [h] }],
        "gap-y": [{ "gap-y": [h] }],
        "justify-content": [{ justify: ["normal", ...T()] }],
        "justify-items": [
          { "justify-items": ["start", "end", "center", "stretch"] },
        ],
        "justify-self": [
          { "justify-self": ["auto", "start", "end", "center", "stretch"] },
        ],
        "align-content": [{ content: ["normal", ...T(), "baseline"] }],
        "align-items": [
          { items: ["start", "end", "center", "baseline", "stretch"] },
        ],
        "align-self": [
          { self: ["auto", "start", "end", "center", "stretch", "baseline"] },
        ],
        "place-content": [{ "place-content": [...T(), "baseline"] }],
        "place-items": [
          { "place-items": ["start", "end", "center", "baseline", "stretch"] },
        ],
        "place-self": [
          { "place-self": ["auto", "start", "end", "center", "stretch"] },
        ],
        p: [{ p: [w] }],
        px: [{ px: [w] }],
        py: [{ py: [w] }],
        ps: [{ ps: [w] }],
        pe: [{ pe: [w] }],
        pt: [{ pt: [w] }],
        pr: [{ pr: [w] }],
        pb: [{ pb: [w] }],
        pl: [{ pl: [w] }],
        m: [{ m: [y] }],
        mx: [{ mx: [y] }],
        my: [{ my: [y] }],
        ms: [{ ms: [y] }],
        me: [{ me: [y] }],
        mt: [{ mt: [y] }],
        mr: [{ mr: [y] }],
        mb: [{ mb: [y] }],
        ml: [{ ml: [y] }],
        "space-x": [{ "space-x": [x] }],
        "space-x-reverse": ["space-x-reverse"],
        "space-y": [{ "space-y": [x] }],
        "space-y-reverse": ["space-y-reverse"],
        w: [{ w: ["auto", "min", "max", "fit", "svw", "lvw", "dvw", R, t] }],
        "min-w": [{ "min-w": [R, t, "min", "max", "fit"] }],
        "max-w": [
          {
            "max-w": [
              R,
              t,
              "none",
              "full",
              "min",
              "max",
              "fit",
              "prose",
              { screen: [se] },
              se,
            ],
          },
        ],
        h: [{ h: [R, t, "auto", "min", "max", "fit", "svh", "lvh", "dvh"] }],
        "min-h": [
          { "min-h": [R, t, "min", "max", "fit", "svh", "lvh", "dvh"] },
        ],
        "max-h": [
          { "max-h": [R, t, "min", "max", "fit", "svh", "lvh", "dvh"] },
        ],
        size: [{ size: [R, t, "auto", "min", "max", "fit"] }],
        "font-size": [{ text: ["base", se, oe] }],
        "font-smoothing": ["antialiased", "subpixel-antialiased"],
        "font-style": ["italic", "not-italic"],
        "font-weight": [
          {
            font: [
              "thin",
              "extralight",
              "light",
              "normal",
              "medium",
              "semibold",
              "bold",
              "extrabold",
              "black",
              rt,
            ],
          },
        ],
        "font-family": [{ font: [Se] }],
        "fvn-normal": ["normal-nums"],
        "fvn-ordinal": ["ordinal"],
        "fvn-slashed-zero": ["slashed-zero"],
        "fvn-figure": ["lining-nums", "oldstyle-nums"],
        "fvn-spacing": ["proportional-nums", "tabular-nums"],
        "fvn-fraction": ["diagonal-fractions", "stacked-fractions"],
        tracking: [
          {
            tracking: [
              "tighter",
              "tight",
              "normal",
              "wide",
              "wider",
              "widest",
              R,
            ],
          },
        ],
        "line-clamp": [{ "line-clamp": ["none", ge, rt] }],
        leading: [
          {
            leading: [
              "none",
              "tight",
              "snug",
              "normal",
              "relaxed",
              "loose",
              Z,
              R,
            ],
          },
        ],
        "list-image": [{ "list-image": ["none", R] }],
        "list-style-type": [{ list: ["none", "disc", "decimal", R] }],
        "list-style-position": [{ list: ["inside", "outside"] }],
        "placeholder-color": [{ placeholder: [e] }],
        "placeholder-opacity": [{ "placeholder-opacity": [b] }],
        "text-alignment": [
          { text: ["left", "center", "right", "justify", "start", "end"] },
        ],
        "text-color": [{ text: [e] }],
        "text-opacity": [{ "text-opacity": [b] }],
        "text-decoration": [
          "underline",
          "overline",
          "line-through",
          "no-underline",
        ],
        "text-decoration-style": [{ decoration: [...W(), "wavy"] }],
        "text-decoration-thickness": [
          { decoration: ["auto", "from-font", Z, oe] },
        ],
        "underline-offset": [{ "underline-offset": ["auto", Z, R] }],
        "text-decoration-color": [{ decoration: [e] }],
        "text-transform": [
          "uppercase",
          "lowercase",
          "capitalize",
          "normal-case",
        ],
        "text-overflow": ["truncate", "text-ellipsis", "text-clip"],
        "text-wrap": [{ text: ["wrap", "nowrap", "balance", "pretty"] }],
        indent: [{ indent: P() }],
        "vertical-align": [
          {
            align: [
              "baseline",
              "top",
              "middle",
              "bottom",
              "text-top",
              "text-bottom",
              "sub",
              "super",
              R,
            ],
          },
        ],
        whitespace: [
          {
            whitespace: [
              "normal",
              "nowrap",
              "pre",
              "pre-line",
              "pre-wrap",
              "break-spaces",
            ],
          },
        ],
        break: [{ break: ["normal", "words", "all", "keep"] }],
        hyphens: [{ hyphens: ["none", "manual", "auto"] }],
        content: [{ content: ["none", R] }],
        "bg-attachment": [{ bg: ["fixed", "local", "scroll"] }],
        "bg-clip": [{ "bg-clip": ["border", "padding", "content", "text"] }],
        "bg-opacity": [{ "bg-opacity": [b] }],
        "bg-origin": [{ "bg-origin": ["border", "padding", "content"] }],
        "bg-position": [{ bg: [...$(), mo] }],
        "bg-repeat": [
          { bg: ["no-repeat", { repeat: ["", "x", "y", "round", "space"] }] },
        ],
        "bg-size": [{ bg: ["auto", "cover", "contain", po] }],
        "bg-image": [
          {
            bg: [
              "none",
              { "gradient-to": ["t", "tr", "r", "br", "b", "bl", "l", "tl"] },
              yo,
            ],
          },
        ],
        "bg-color": [{ bg: [e] }],
        "gradient-from-pos": [{ from: [m] }],
        "gradient-via-pos": [{ via: [m] }],
        "gradient-to-pos": [{ to: [m] }],
        "gradient-from": [{ from: [p] }],
        "gradient-via": [{ via: [p] }],
        "gradient-to": [{ to: [p] }],
        rounded: [{ rounded: [s] }],
        "rounded-s": [{ "rounded-s": [s] }],
        "rounded-e": [{ "rounded-e": [s] }],
        "rounded-t": [{ "rounded-t": [s] }],
        "rounded-r": [{ "rounded-r": [s] }],
        "rounded-b": [{ "rounded-b": [s] }],
        "rounded-l": [{ "rounded-l": [s] }],
        "rounded-ss": [{ "rounded-ss": [s] }],
        "rounded-se": [{ "rounded-se": [s] }],
        "rounded-ee": [{ "rounded-ee": [s] }],
        "rounded-es": [{ "rounded-es": [s] }],
        "rounded-tl": [{ "rounded-tl": [s] }],
        "rounded-tr": [{ "rounded-tr": [s] }],
        "rounded-br": [{ "rounded-br": [s] }],
        "rounded-bl": [{ "rounded-bl": [s] }],
        "border-w": [{ border: [a] }],
        "border-w-x": [{ "border-x": [a] }],
        "border-w-y": [{ "border-y": [a] }],
        "border-w-s": [{ "border-s": [a] }],
        "border-w-e": [{ "border-e": [a] }],
        "border-w-t": [{ "border-t": [a] }],
        "border-w-r": [{ "border-r": [a] }],
        "border-w-b": [{ "border-b": [a] }],
        "border-w-l": [{ "border-l": [a] }],
        "border-opacity": [{ "border-opacity": [b] }],
        "border-style": [{ border: [...W(), "hidden"] }],
        "divide-x": [{ "divide-x": [a] }],
        "divide-x-reverse": ["divide-x-reverse"],
        "divide-y": [{ "divide-y": [a] }],
        "divide-y-reverse": ["divide-y-reverse"],
        "divide-opacity": [{ "divide-opacity": [b] }],
        "divide-style": [{ divide: W() }],
        "border-color": [{ border: [o] }],
        "border-color-x": [{ "border-x": [o] }],
        "border-color-y": [{ "border-y": [o] }],
        "border-color-s": [{ "border-s": [o] }],
        "border-color-e": [{ "border-e": [o] }],
        "border-color-t": [{ "border-t": [o] }],
        "border-color-r": [{ "border-r": [o] }],
        "border-color-b": [{ "border-b": [o] }],
        "border-color-l": [{ "border-l": [o] }],
        "divide-color": [{ divide: [o] }],
        "outline-style": [{ outline: ["", ...W()] }],
        "outline-offset": [{ "outline-offset": [Z, R] }],
        "outline-w": [{ outline: [Z, oe] }],
        "outline-color": [{ outline: [e] }],
        "ring-w": [{ ring: N() }],
        "ring-w-inset": ["ring-inset"],
        "ring-color": [{ ring: [e] }],
        "ring-opacity": [{ "ring-opacity": [b] }],
        "ring-offset-w": [{ "ring-offset": [Z, oe] }],
        "ring-offset-color": [{ "ring-offset": [e] }],
        shadow: [{ shadow: ["", "inner", "none", se, bo] }],
        "shadow-color": [{ shadow: [Se] }],
        opacity: [{ opacity: [b] }],
        "mix-blend": [{ "mix-blend": [...F(), "plus-lighter", "plus-darker"] }],
        "bg-blend": [{ "bg-blend": F() }],
        filter: [{ filter: ["", "none"] }],
        blur: [{ blur: [n] }],
        brightness: [{ brightness: [r] }],
        contrast: [{ contrast: [l] }],
        "drop-shadow": [{ "drop-shadow": ["", "none", se, R] }],
        grayscale: [{ grayscale: [u] }],
        "hue-rotate": [{ "hue-rotate": [c] }],
        invert: [{ invert: [f] }],
        saturate: [{ saturate: [C] }],
        sepia: [{ sepia: [O] }],
        "backdrop-filter": [{ "backdrop-filter": ["", "none"] }],
        "backdrop-blur": [{ "backdrop-blur": [n] }],
        "backdrop-brightness": [{ "backdrop-brightness": [r] }],
        "backdrop-contrast": [{ "backdrop-contrast": [l] }],
        "backdrop-grayscale": [{ "backdrop-grayscale": [u] }],
        "backdrop-hue-rotate": [{ "backdrop-hue-rotate": [c] }],
        "backdrop-invert": [{ "backdrop-invert": [f] }],
        "backdrop-opacity": [{ "backdrop-opacity": [b] }],
        "backdrop-saturate": [{ "backdrop-saturate": [C] }],
        "backdrop-sepia": [{ "backdrop-sepia": [O] }],
        "border-collapse": [{ border: ["collapse", "separate"] }],
        "border-spacing": [{ "border-spacing": [i] }],
        "border-spacing-x": [{ "border-spacing-x": [i] }],
        "border-spacing-y": [{ "border-spacing-y": [i] }],
        "table-layout": [{ table: ["auto", "fixed"] }],
        caption: [{ caption: ["top", "bottom"] }],
        transition: [
          {
            transition: [
              "none",
              "all",
              "",
              "colors",
              "opacity",
              "shadow",
              "transform",
              R,
            ],
          },
        ],
        duration: [{ duration: U() }],
        ease: [{ ease: ["linear", "in", "out", "in-out", R] }],
        delay: [{ delay: U() }],
        animate: [{ animate: ["none", "spin", "ping", "pulse", "bounce", R] }],
        transform: [{ transform: ["", "gpu", "none"] }],
        scale: [{ scale: [v] }],
        "scale-x": [{ "scale-x": [v] }],
        "scale-y": [{ "scale-y": [v] }],
        rotate: [{ rotate: [Pe, R] }],
        "translate-x": [{ "translate-x": [M] }],
        "translate-y": [{ "translate-y": [M] }],
        "skew-x": [{ "skew-x": [E] }],
        "skew-y": [{ "skew-y": [E] }],
        "transform-origin": [
          {
            origin: [
              "center",
              "top",
              "top-right",
              "right",
              "bottom-right",
              "bottom",
              "bottom-left",
              "left",
              "top-left",
              R,
            ],
          },
        ],
        accent: [{ accent: ["auto", e] }],
        appearance: [{ appearance: ["none", "auto"] }],
        cursor: [
          {
            cursor: [
              "auto",
              "default",
              "pointer",
              "wait",
              "text",
              "move",
              "help",
              "not-allowed",
              "none",
              "context-menu",
              "progress",
              "cell",
              "crosshair",
              "vertical-text",
              "alias",
              "copy",
              "no-drop",
              "grab",
              "grabbing",
              "all-scroll",
              "col-resize",
              "row-resize",
              "n-resize",
              "e-resize",
              "s-resize",
              "w-resize",
              "ne-resize",
              "nw-resize",
              "se-resize",
              "sw-resize",
              "ew-resize",
              "ns-resize",
              "nesw-resize",
              "nwse-resize",
              "zoom-in",
              "zoom-out",
              R,
            ],
          },
        ],
        "caret-color": [{ caret: [e] }],
        "pointer-events": [{ "pointer-events": ["none", "auto"] }],
        resize: [{ resize: ["none", "y", "x", ""] }],
        "scroll-behavior": [{ scroll: ["auto", "smooth"] }],
        "scroll-m": [{ "scroll-m": P() }],
        "scroll-mx": [{ "scroll-mx": P() }],
        "scroll-my": [{ "scroll-my": P() }],
        "scroll-ms": [{ "scroll-ms": P() }],
        "scroll-me": [{ "scroll-me": P() }],
        "scroll-mt": [{ "scroll-mt": P() }],
        "scroll-mr": [{ "scroll-mr": P() }],
        "scroll-mb": [{ "scroll-mb": P() }],
        "scroll-ml": [{ "scroll-ml": P() }],
        "scroll-p": [{ "scroll-p": P() }],
        "scroll-px": [{ "scroll-px": P() }],
        "scroll-py": [{ "scroll-py": P() }],
        "scroll-ps": [{ "scroll-ps": P() }],
        "scroll-pe": [{ "scroll-pe": P() }],
        "scroll-pt": [{ "scroll-pt": P() }],
        "scroll-pr": [{ "scroll-pr": P() }],
        "scroll-pb": [{ "scroll-pb": P() }],
        "scroll-pl": [{ "scroll-pl": P() }],
        "snap-align": [{ snap: ["start", "end", "center", "align-none"] }],
        "snap-stop": [{ snap: ["normal", "always"] }],
        "snap-type": [{ snap: ["none", "x", "y", "both"] }],
        "snap-strictness": [{ snap: ["mandatory", "proximity"] }],
        touch: [{ touch: ["auto", "none", "manipulation"] }],
        "touch-x": [{ "touch-pan": ["x", "left", "right"] }],
        "touch-y": [{ "touch-pan": ["y", "up", "down"] }],
        "touch-pz": ["touch-pinch-zoom"],
        select: [{ select: ["none", "text", "all", "auto"] }],
        "will-change": [
          { "will-change": ["auto", "scroll", "contents", "transform", R] },
        ],
        fill: [{ fill: [e, "none"] }],
        "stroke-w": [{ stroke: [Z, oe, rt] }],
        stroke: [{ stroke: [e, "none"] }],
        sr: ["sr-only", "not-sr-only"],
        "forced-color-adjust": [{ "forced-color-adjust": ["auto", "none"] }],
      },
      conflictingClassGroups: {
        overflow: ["overflow-x", "overflow-y"],
        overscroll: ["overscroll-x", "overscroll-y"],
        inset: [
          "inset-x",
          "inset-y",
          "start",
          "end",
          "top",
          "right",
          "bottom",
          "left",
        ],
        "inset-x": ["right", "left"],
        "inset-y": ["top", "bottom"],
        flex: ["basis", "grow", "shrink"],
        gap: ["gap-x", "gap-y"],
        p: ["px", "py", "ps", "pe", "pt", "pr", "pb", "pl"],
        px: ["pr", "pl"],
        py: ["pt", "pb"],
        m: ["mx", "my", "ms", "me", "mt", "mr", "mb", "ml"],
        mx: ["mr", "ml"],
        my: ["mt", "mb"],
        size: ["w", "h"],
        "font-size": ["leading"],
        "fvn-normal": [
          "fvn-ordinal",
          "fvn-slashed-zero",
          "fvn-figure",
          "fvn-spacing",
          "fvn-fraction",
        ],
        "fvn-ordinal": ["fvn-normal"],
        "fvn-slashed-zero": ["fvn-normal"],
        "fvn-figure": ["fvn-normal"],
        "fvn-spacing": ["fvn-normal"],
        "fvn-fraction": ["fvn-normal"],
        "line-clamp": ["display", "overflow"],
        rounded: [
          "rounded-s",
          "rounded-e",
          "rounded-t",
          "rounded-r",
          "rounded-b",
          "rounded-l",
          "rounded-ss",
          "rounded-se",
          "rounded-ee",
          "rounded-es",
          "rounded-tl",
          "rounded-tr",
          "rounded-br",
          "rounded-bl",
        ],
        "rounded-s": ["rounded-ss", "rounded-es"],
        "rounded-e": ["rounded-se", "rounded-ee"],
        "rounded-t": ["rounded-tl", "rounded-tr"],
        "rounded-r": ["rounded-tr", "rounded-br"],
        "rounded-b": ["rounded-br", "rounded-bl"],
        "rounded-l": ["rounded-tl", "rounded-bl"],
        "border-spacing": ["border-spacing-x", "border-spacing-y"],
        "border-w": [
          "border-w-s",
          "border-w-e",
          "border-w-t",
          "border-w-r",
          "border-w-b",
          "border-w-l",
        ],
        "border-w-x": ["border-w-r", "border-w-l"],
        "border-w-y": ["border-w-t", "border-w-b"],
        "border-color": [
          "border-color-s",
          "border-color-e",
          "border-color-t",
          "border-color-r",
          "border-color-b",
          "border-color-l",
        ],
        "border-color-x": ["border-color-r", "border-color-l"],
        "border-color-y": ["border-color-t", "border-color-b"],
        "scroll-m": [
          "scroll-mx",
          "scroll-my",
          "scroll-ms",
          "scroll-me",
          "scroll-mt",
          "scroll-mr",
          "scroll-mb",
          "scroll-ml",
        ],
        "scroll-mx": ["scroll-mr", "scroll-ml"],
        "scroll-my": ["scroll-mt", "scroll-mb"],
        "scroll-p": [
          "scroll-px",
          "scroll-py",
          "scroll-ps",
          "scroll-pe",
          "scroll-pt",
          "scroll-pr",
          "scroll-pb",
          "scroll-pl",
        ],
        "scroll-px": ["scroll-pr", "scroll-pl"],
        "scroll-py": ["scroll-pt", "scroll-pb"],
        touch: ["touch-x", "touch-y", "touch-pz"],
        "touch-x": ["touch"],
        "touch-y": ["touch"],
        "touch-pz": ["touch"],
      },
      conflictingClassGroupModifiers: { "font-size": ["leading"] },
    };
  },
  Oo = ro(Co);
function xt(...e) {
  return Oo(wn(e));
}
function Bt(e, t) {
  if (typeof e == "function") return e(t);
  e != null && (e.current = t);
}
function Ct(...e) {
  return (t) => {
    let n = !1;
    const r = e.map((o) => {
      const s = Bt(o, t);
      return (!n && typeof s == "function" && (n = !0), s);
    });
    if (n)
      return () => {
        for (let o = 0; o < r.length; o++) {
          const s = r[o];
          typeof s == "function" ? s() : Bt(e[o], null);
        }
      };
  };
}
function he(...e) {
  return d.useCallback(Ct(...e), e);
}
var Po = Symbol.for("react.lazy"),
  ze = bt[" use ".trim().toString()];
function So(e) {
  return typeof e == "object" && e !== null && "then" in e;
}
function Sn(e) {
  return (
    e != null &&
    typeof e == "object" &&
    "$$typeof" in e &&
    e.$$typeof === Po &&
    "_payload" in e &&
    So(e._payload)
  );
}
function Eo(e) {
  const t = Mo(e),
    n = d.forwardRef((r, o) => {
      let { children: s, ...i } = r;
      Sn(s) && typeof ze == "function" && (s = ze(s._payload));
      const a = d.Children.toArray(s),
        l = a.find(Ao);
      if (l) {
        const u = l.props.children,
          c = a.map((f) =>
            f === l
              ? d.Children.count(u) > 1
                ? d.Children.only(null)
                : d.isValidElement(u)
                  ? u.props.children
                  : null
              : f,
          );
        return S.jsx(t, {
          ...i,
          ref: o,
          children: d.isValidElement(u) ? d.cloneElement(u, void 0, c) : null,
        });
      }
      return S.jsx(t, { ...i, ref: o, children: s });
    });
  return ((n.displayName = `${e}.Slot`), n);
}
var Ro = Eo("Slot");
function Mo(e) {
  const t = d.forwardRef((n, r) => {
    let { children: o, ...s } = n;
    if (
      (Sn(o) && typeof ze == "function" && (o = ze(o._payload)),
      d.isValidElement(o))
    ) {
      const i = Do(o),
        a = ko(s, o.props);
      return (
        o.type !== d.Fragment && (a.ref = r ? Ct(r, i) : i),
        d.cloneElement(o, a)
      );
    }
    return d.Children.count(o) > 1 ? d.Children.only(null) : null;
  });
  return ((t.displayName = `${e}.SlotClone`), t);
}
var To = Symbol("radix.slottable");
function Ao(e) {
  return (
    d.isValidElement(e) &&
    typeof e.type == "function" &&
    "__radixId" in e.type &&
    e.type.__radixId === To
  );
}
function ko(e, t) {
  const n = { ...t };
  for (const r in t) {
    const o = e[r],
      s = t[r];
    /^on[A-Z]/.test(r)
      ? o && s
        ? (n[r] = (...a) => {
            const l = s(...a);
            return (o(...a), l);
          })
        : o && (n[r] = o)
      : r === "style"
        ? (n[r] = { ...o, ...s })
        : r === "className" && (n[r] = [o, s].filter(Boolean).join(" "));
  }
  return { ...e, ...n };
}
function Do(e) {
  let t = Object.getOwnPropertyDescriptor(e.props, "ref")?.get,
    n = t && "isReactWarning" in t && t.isReactWarning;
  return n
    ? e.ref
    : ((t = Object.getOwnPropertyDescriptor(e, "ref")?.get),
      (n = t && "isReactWarning" in t && t.isReactWarning),
      n ? e.props.ref : e.props.ref || e.ref);
}
const Vt = (e) => (typeof e == "boolean" ? `${e}` : e === 0 ? "0" : e),
  Ut = wn,
  No = (e, t) => (n) => {
    var r;
    if (t?.variants == null) return Ut(e, n?.class, n?.className);
    const { variants: o, defaultVariants: s } = t,
      i = Object.keys(o).map((u) => {
        const c = n?.[u],
          f = s?.[u];
        if (c === null) return null;
        const h = Vt(c) || Vt(f);
        return o[u][h];
      }),
      a =
        n &&
        Object.entries(n).reduce((u, c) => {
          let [f, h] = c;
          return (h === void 0 || (u[f] = h), u);
        }, {}),
      l =
        t == null || (r = t.compoundVariants) === null || r === void 0
          ? void 0
          : r.reduce((u, c) => {
              let { class: f, className: h, ...p } = c;
              return Object.entries(p).every((m) => {
                let [g, y] = m;
                return Array.isArray(y)
                  ? y.includes({ ...s, ...a }[g])
                  : { ...s, ...a }[g] === y;
              })
                ? [...u, f, h]
                : u;
            }, []);
    return Ut(e, i, l, n?.class, n?.className);
  },
  _o = No(
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
  En = d.forwardRef(
    ({ className: e, variant: t, size: n, asChild: r = !1, ...o }, s) => {
      const i = r ? Ro : "button";
      return S.jsx(i, {
        className: xt(_o({ variant: t, size: n, className: e })),
        ref: s,
        ...o,
      });
    },
  );
En.displayName = "Button";
function ee(e, t, { checkForDefaultPrevented: n = !0 } = {}) {
  return function (o) {
    if ((e?.(o), n === !1 || !o.defaultPrevented)) return t?.(o);
  };
}
function yc(e, t) {
  const n = d.createContext(t),
    r = (s) => {
      const { children: i, ...a } = s,
        l = d.useMemo(() => a, Object.values(a));
      return S.jsx(n.Provider, { value: l, children: i });
    };
  r.displayName = e + "Provider";
  function o(s) {
    const i = d.useContext(n);
    if (i) return i;
    if (t !== void 0) return t;
    throw new Error(`\`${s}\` must be used within \`${e}\``);
  }
  return [r, o];
}
function Rn(e, t = []) {
  let n = [];
  function r(s, i) {
    const a = d.createContext(i),
      l = n.length;
    n = [...n, i];
    const u = (f) => {
      const { scope: h, children: p, ...m } = f,
        g = h?.[e]?.[l] || a,
        y = d.useMemo(() => m, Object.values(m));
      return S.jsx(g.Provider, { value: y, children: p });
    };
    u.displayName = s + "Provider";
    function c(f, h) {
      const p = h?.[e]?.[l] || a,
        m = d.useContext(p);
      if (m) return m;
      if (i !== void 0) return i;
      throw new Error(`\`${f}\` must be used within \`${s}\``);
    }
    return [u, c];
  }
  const o = () => {
    const s = n.map((i) => d.createContext(i));
    return function (a) {
      const l = a?.[e] || s;
      return d.useMemo(() => ({ [`__scope${e}`]: { ...a, [e]: l } }), [a, l]);
    };
  };
  return ((o.scopeName = e), [r, Lo(o, ...t)]);
}
function Lo(...e) {
  const t = e[0];
  if (e.length === 1) return t;
  const n = () => {
    const r = e.map((o) => ({ useScope: o(), scopeName: o.scopeName }));
    return function (s) {
      const i = r.reduce((a, { useScope: l, scopeName: u }) => {
        const f = l(s)[`__scope${u}`];
        return { ...a, ...f };
      }, {});
      return d.useMemo(() => ({ [`__scope${t.scopeName}`]: i }), [i]);
    };
  };
  return ((n.scopeName = t.scopeName), n);
}
var de = globalThis?.document ? d.useLayoutEffect : () => {},
  Wo = bt[" useInsertionEffect ".trim().toString()] || de;
function Io({ prop: e, defaultProp: t, onChange: n = () => {}, caller: r }) {
  const [o, s, i] = Fo({ defaultProp: t, onChange: n }),
    a = e !== void 0,
    l = a ? e : o;
  {
    const c = d.useRef(e !== void 0);
    d.useEffect(() => {
      const f = c.current;
      (f !== a &&
        console.warn(
          `${r} is changing from ${f ? "controlled" : "uncontrolled"} to ${a ? "controlled" : "uncontrolled"}. Components should not switch from controlled to uncontrolled (or vice versa). Decide between using a controlled or uncontrolled value for the lifetime of the component.`,
        ),
        (c.current = a));
    }, [a, r]);
  }
  const u = d.useCallback(
    (c) => {
      if (a) {
        const f = jo(c) ? c(e) : c;
        f !== e && i.current?.(f);
      } else s(c);
    },
    [a, e, s, i],
  );
  return [l, u];
}
function Fo({ defaultProp: e, onChange: t }) {
  const [n, r] = d.useState(e),
    o = d.useRef(n),
    s = d.useRef(t);
  return (
    Wo(() => {
      s.current = t;
    }, [t]),
    d.useEffect(() => {
      o.current !== n && (s.current?.(n), (o.current = n));
    }, [n, o]),
    [n, r, s]
  );
}
function jo(e) {
  return typeof e == "function";
}
function $o(e) {
  const [t, n] = d.useState(void 0);
  return (
    de(() => {
      if (e) {
        n({ width: e.offsetWidth, height: e.offsetHeight });
        const r = new ResizeObserver((o) => {
          if (!Array.isArray(o) || !o.length) return;
          const s = o[0];
          let i, a;
          if ("borderBoxSize" in s) {
            const l = s.borderBoxSize,
              u = Array.isArray(l) ? l[0] : l;
            ((i = u.inlineSize), (a = u.blockSize));
          } else ((i = e.offsetWidth), (a = e.offsetHeight));
          n({ width: i, height: a });
        });
        return (r.observe(e, { box: "border-box" }), () => r.unobserve(e));
      } else n(void 0);
    }, [e]),
    t
  );
}
function zo(e) {
  const t = Ho(e),
    n = d.forwardRef((r, o) => {
      const { children: s, ...i } = r,
        a = d.Children.toArray(s),
        l = a.find(Bo);
      if (l) {
        const u = l.props.children,
          c = a.map((f) =>
            f === l
              ? d.Children.count(u) > 1
                ? d.Children.only(null)
                : d.isValidElement(u)
                  ? u.props.children
                  : null
              : f,
          );
        return S.jsx(t, {
          ...i,
          ref: o,
          children: d.isValidElement(u) ? d.cloneElement(u, void 0, c) : null,
        });
      }
      return S.jsx(t, { ...i, ref: o, children: s });
    });
  return ((n.displayName = `${e}.Slot`), n);
}
function Ho(e) {
  const t = d.forwardRef((n, r) => {
    const { children: o, ...s } = n;
    if (d.isValidElement(o)) {
      const i = Uo(o),
        a = Vo(s, o.props);
      return (
        o.type !== d.Fragment && (a.ref = r ? Ct(r, i) : i),
        d.cloneElement(o, a)
      );
    }
    return d.Children.count(o) > 1 ? d.Children.only(null) : null;
  });
  return ((t.displayName = `${e}.SlotClone`), t);
}
var Mn = Symbol("radix.slottable");
function Yo(e) {
  const t = ({ children: n }) => S.jsx(S.Fragment, { children: n });
  return ((t.displayName = `${e}.Slottable`), (t.__radixId = Mn), t);
}
function Bo(e) {
  return (
    d.isValidElement(e) &&
    typeof e.type == "function" &&
    "__radixId" in e.type &&
    e.type.__radixId === Mn
  );
}
function Vo(e, t) {
  const n = { ...t };
  for (const r in t) {
    const o = e[r],
      s = t[r];
    /^on[A-Z]/.test(r)
      ? o && s
        ? (n[r] = (...a) => {
            const l = s(...a);
            return (o(...a), l);
          })
        : o && (n[r] = o)
      : r === "style"
        ? (n[r] = { ...o, ...s })
        : r === "className" && (n[r] = [o, s].filter(Boolean).join(" "));
  }
  return { ...e, ...n };
}
function Uo(e) {
  let t = Object.getOwnPropertyDescriptor(e.props, "ref")?.get,
    n = t && "isReactWarning" in t && t.isReactWarning;
  return n
    ? e.ref
    : ((t = Object.getOwnPropertyDescriptor(e, "ref")?.get),
      (n = t && "isReactWarning" in t && t.isReactWarning),
      n ? e.props.ref : e.props.ref || e.ref);
}
var Go = [
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
  pe = Go.reduce((e, t) => {
    const n = zo(`Primitive.${t}`),
      r = d.forwardRef((o, s) => {
        const { asChild: i, ...a } = o,
          l = i ? n : t;
        return (
          typeof window < "u" && (window[Symbol.for("radix-ui")] = !0),
          S.jsx(l, { ...a, ref: s })
        );
      });
    return ((r.displayName = `Primitive.${t}`), { ...e, [t]: r });
  }, {});
function Qo(e, t) {
  e && gn.flushSync(() => e.dispatchEvent(t));
}
const qo = (e) => e.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(),
  Xo = (e) =>
    e.replace(/^([A-Z])|[\s-_]+(\w)/g, (t, n, r) =>
      r ? r.toUpperCase() : n.toLowerCase(),
    ),
  Gt = (e) => {
    const t = Xo(e);
    return t.charAt(0).toUpperCase() + t.slice(1);
  },
  Tn = (...e) =>
    e
      .filter((t, n, r) => !!t && t.trim() !== "" && r.indexOf(t) === n)
      .join(" ")
      .trim(),
  Ko = (e) => {
    for (const t in e)
      if (t.startsWith("aria-") || t === "role" || t === "title") return !0;
  };
var Jo = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};
const Zo = d.forwardRef(
  (
    {
      color: e = "currentColor",
      size: t = 24,
      strokeWidth: n = 2,
      absoluteStrokeWidth: r,
      className: o = "",
      children: s,
      iconNode: i,
      ...a
    },
    l,
  ) =>
    d.createElement(
      "svg",
      {
        ref: l,
        ...Jo,
        width: t,
        height: t,
        stroke: e,
        strokeWidth: r ? (Number(n) * 24) / Number(t) : n,
        className: Tn("lucide", o),
        ...(!s && !Ko(a) && { "aria-hidden": "true" }),
        ...a,
      },
      [
        ...i.map(([u, c]) => d.createElement(u, c)),
        ...(Array.isArray(s) ? s : [s]),
      ],
    ),
);
const Ot = (e, t) => {
  const n = d.forwardRef(({ className: r, ...o }, s) =>
    d.createElement(Zo, {
      ref: s,
      iconNode: t,
      className: Tn(`lucide-${qo(Gt(e))}`, `lucide-${e}`, r),
      ...o,
    }),
  );
  return ((n.displayName = Gt(e)), n);
};
const es = [
    ["path", { d: "M8 2v4", key: "1cmpym" }],
    ["path", { d: "M16 2v4", key: "4m81vk" }],
    [
      "rect",
      { width: "18", height: "18", x: "3", y: "4", rx: "2", key: "1hopcy" },
    ],
    ["path", { d: "M3 10h18", key: "8toen8" }],
    ["path", { d: "M8 14h.01", key: "6423bh" }],
    ["path", { d: "M12 14h.01", key: "1etili" }],
    ["path", { d: "M16 14h.01", key: "1gbofw" }],
    ["path", { d: "M8 18h.01", key: "lrp35t" }],
    ["path", { d: "M12 18h.01", key: "mhygvu" }],
    ["path", { d: "M16 18h.01", key: "kzsmim" }],
  ],
  bc = Ot("calendar-days", es);
const ts = [
    [
      "path",
      {
        d: "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401",
        key: "kfwtm",
      },
    ],
  ],
  ns = Ot("moon", ts);
const rs = [
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
  os = Ot("sun", rs),
  An = 6048e5,
  ss = 864e5,
  wc = 6e4,
  vc = 36e5,
  xc = 1e3,
  Qt = Symbol.for("constructDateFrom");
function V(e, t) {
  return typeof e == "function"
    ? e(t)
    : e && typeof e == "object" && Qt in e
      ? e[Qt](t)
      : e instanceof Date
        ? new e.constructor(t)
        : new Date(t);
}
function z(e, t) {
  return V(t || e, e);
}
function Cc(e, t, n) {
  const r = z(e, n?.in);
  return isNaN(t) ? V(n?.in || e, NaN) : (t && r.setDate(r.getDate() + t), r);
}
function is(e, t, n) {
  const r = z(e, n?.in);
  if (isNaN(t)) return V(n?.in || e, NaN);
  if (!t) return r;
  const o = r.getDate(),
    s = V(n?.in || e, r.getTime());
  s.setMonth(r.getMonth() + t + 1, 0);
  const i = s.getDate();
  return o >= i ? s : (r.setFullYear(s.getFullYear(), s.getMonth(), o), r);
}
let as = {};
function De() {
  return as;
}
function Te(e, t) {
  const n = De(),
    r =
      t?.weekStartsOn ??
      t?.locale?.options?.weekStartsOn ??
      n.weekStartsOn ??
      n.locale?.options?.weekStartsOn ??
      0,
    o = z(e, t?.in),
    s = o.getDay(),
    i = (s < r ? 7 : 0) + s - r;
  return (o.setDate(o.getDate() - i), o.setHours(0, 0, 0, 0), o);
}
function He(e, t) {
  return Te(e, { ...t, weekStartsOn: 1 });
}
function kn(e, t) {
  const n = z(e, t?.in),
    r = n.getFullYear(),
    o = V(n, 0);
  (o.setFullYear(r + 1, 0, 4), o.setHours(0, 0, 0, 0));
  const s = He(o),
    i = V(n, 0);
  (i.setFullYear(r, 0, 4), i.setHours(0, 0, 0, 0));
  const a = He(i);
  return n.getTime() >= s.getTime()
    ? r + 1
    : n.getTime() >= a.getTime()
      ? r
      : r - 1;
}
function qt(e) {
  const t = z(e),
    n = new Date(
      Date.UTC(
        t.getFullYear(),
        t.getMonth(),
        t.getDate(),
        t.getHours(),
        t.getMinutes(),
        t.getSeconds(),
        t.getMilliseconds(),
      ),
    );
  return (n.setUTCFullYear(t.getFullYear()), +e - +n);
}
function Pt(e, ...t) {
  const n = V.bind(
    null,
    t.find((r) => typeof r == "object"),
  );
  return t.map(n);
}
function Ye(e, t) {
  const n = z(e, t?.in);
  return (n.setHours(0, 0, 0, 0), n);
}
function cs(e, t, n) {
  const [r, o] = Pt(n?.in, e, t),
    s = Ye(r),
    i = Ye(o),
    a = +s - qt(s),
    l = +i - qt(i);
  return Math.round((a - l) / ss);
}
function ls(e, t) {
  const n = kn(e, t),
    r = V(e, 0);
  return (r.setFullYear(n, 0, 4), r.setHours(0, 0, 0, 0), He(r));
}
function us(e) {
  return V(e, Date.now());
}
function ds(e, t, n) {
  const [r, o] = Pt(n?.in, e, t);
  return +Ye(r) == +Ye(o);
}
function fs(e) {
  return (
    e instanceof Date ||
    (typeof e == "object" &&
      Object.prototype.toString.call(e) === "[object Date]")
  );
}
function hs(e) {
  return !((!fs(e) && typeof e != "number") || isNaN(+z(e)));
}
function Oc(e, t) {
  const n = z(e, t?.in),
    r = n.getMonth();
  return (
    n.setFullYear(n.getFullYear(), r + 1, 0),
    n.setHours(23, 59, 59, 999),
    n
  );
}
function Pc(e, t) {
  const n = z(e, t?.in);
  return (n.setDate(1), n.setHours(0, 0, 0, 0), n);
}
function ps(e, t) {
  const n = z(e, t?.in);
  return (n.setFullYear(n.getFullYear(), 0, 1), n.setHours(0, 0, 0, 0), n);
}
function Sc(e, t) {
  const n = De(),
    r = n.weekStartsOn ?? n.locale?.options?.weekStartsOn ?? 0,
    o = z(e, t?.in),
    s = o.getDay(),
    i = (s < r ? -7 : 0) + 6 - (s - r);
  return (o.setDate(o.getDate() + i), o.setHours(23, 59, 59, 999), o);
}
const ms = {
    lessThanXSeconds: {
      one: "less than a second",
      other: "less than {{count}} seconds",
    },
    xSeconds: { one: "1 second", other: "{{count}} seconds" },
    halfAMinute: "half a minute",
    lessThanXMinutes: {
      one: "less than a minute",
      other: "less than {{count}} minutes",
    },
    xMinutes: { one: "1 minute", other: "{{count}} minutes" },
    aboutXHours: { one: "about 1 hour", other: "about {{count}} hours" },
    xHours: { one: "1 hour", other: "{{count}} hours" },
    xDays: { one: "1 day", other: "{{count}} days" },
    aboutXWeeks: { one: "about 1 week", other: "about {{count}} weeks" },
    xWeeks: { one: "1 week", other: "{{count}} weeks" },
    aboutXMonths: { one: "about 1 month", other: "about {{count}} months" },
    xMonths: { one: "1 month", other: "{{count}} months" },
    aboutXYears: { one: "about 1 year", other: "about {{count}} years" },
    xYears: { one: "1 year", other: "{{count}} years" },
    overXYears: { one: "over 1 year", other: "over {{count}} years" },
    almostXYears: { one: "almost 1 year", other: "almost {{count}} years" },
  },
  gs = (e, t, n) => {
    let r;
    const o = ms[e];
    return (
      typeof o == "string"
        ? (r = o)
        : t === 1
          ? (r = o.one)
          : (r = o.other.replace("{{count}}", t.toString())),
      n?.addSuffix
        ? n.comparison && n.comparison > 0
          ? "in " + r
          : r + " ago"
        : r
    );
  };
function ot(e) {
  return (t = {}) => {
    const n = t.width ? String(t.width) : e.defaultWidth;
    return e.formats[n] || e.formats[e.defaultWidth];
  };
}
const ys = {
    full: "EEEE, MMMM do, y",
    long: "MMMM do, y",
    medium: "MMM d, y",
    short: "MM/dd/yyyy",
  },
  bs = {
    full: "h:mm:ss a zzzz",
    long: "h:mm:ss a z",
    medium: "h:mm:ss a",
    short: "h:mm a",
  },
  ws = {
    full: "{{date}} 'at' {{time}}",
    long: "{{date}} 'at' {{time}}",
    medium: "{{date}}, {{time}}",
    short: "{{date}}, {{time}}",
  },
  vs = {
    date: ot({ formats: ys, defaultWidth: "full" }),
    time: ot({ formats: bs, defaultWidth: "full" }),
    dateTime: ot({ formats: ws, defaultWidth: "full" }),
  },
  xs = {
    lastWeek: "'last' eeee 'at' p",
    yesterday: "'yesterday at' p",
    today: "'today at' p",
    tomorrow: "'tomorrow at' p",
    nextWeek: "eeee 'at' p",
    other: "P",
  },
  Cs = (e, t, n, r) => xs[e];
function Ee(e) {
  return (t, n) => {
    const r = n?.context ? String(n.context) : "standalone";
    let o;
    if (r === "formatting" && e.formattingValues) {
      const i = e.defaultFormattingWidth || e.defaultWidth,
        a = n?.width ? String(n.width) : i;
      o = e.formattingValues[a] || e.formattingValues[i];
    } else {
      const i = e.defaultWidth,
        a = n?.width ? String(n.width) : e.defaultWidth;
      o = e.values[a] || e.values[i];
    }
    const s = e.argumentCallback ? e.argumentCallback(t) : t;
    return o[s];
  };
}
const Os = {
    narrow: ["B", "A"],
    abbreviated: ["BC", "AD"],
    wide: ["Before Christ", "Anno Domini"],
  },
  Ps = {
    narrow: ["1", "2", "3", "4"],
    abbreviated: ["Q1", "Q2", "Q3", "Q4"],
    wide: ["1st quarter", "2nd quarter", "3rd quarter", "4th quarter"],
  },
  Ss = {
    narrow: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"],
    abbreviated: [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ],
    wide: [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ],
  },
  Es = {
    narrow: ["S", "M", "T", "W", "T", "F", "S"],
    short: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
    abbreviated: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    wide: [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ],
  },
  Rs = {
    narrow: {
      am: "a",
      pm: "p",
      midnight: "mi",
      noon: "n",
      morning: "morning",
      afternoon: "afternoon",
      evening: "evening",
      night: "night",
    },
    abbreviated: {
      am: "AM",
      pm: "PM",
      midnight: "midnight",
      noon: "noon",
      morning: "morning",
      afternoon: "afternoon",
      evening: "evening",
      night: "night",
    },
    wide: {
      am: "a.m.",
      pm: "p.m.",
      midnight: "midnight",
      noon: "noon",
      morning: "morning",
      afternoon: "afternoon",
      evening: "evening",
      night: "night",
    },
  },
  Ms = {
    narrow: {
      am: "a",
      pm: "p",
      midnight: "mi",
      noon: "n",
      morning: "in the morning",
      afternoon: "in the afternoon",
      evening: "in the evening",
      night: "at night",
    },
    abbreviated: {
      am: "AM",
      pm: "PM",
      midnight: "midnight",
      noon: "noon",
      morning: "in the morning",
      afternoon: "in the afternoon",
      evening: "in the evening",
      night: "at night",
    },
    wide: {
      am: "a.m.",
      pm: "p.m.",
      midnight: "midnight",
      noon: "noon",
      morning: "in the morning",
      afternoon: "in the afternoon",
      evening: "in the evening",
      night: "at night",
    },
  },
  Ts = (e, t) => {
    const n = Number(e),
      r = n % 100;
    if (r > 20 || r < 10)
      switch (r % 10) {
        case 1:
          return n + "st";
        case 2:
          return n + "nd";
        case 3:
          return n + "rd";
      }
    return n + "th";
  },
  As = {
    ordinalNumber: Ts,
    era: Ee({ values: Os, defaultWidth: "wide" }),
    quarter: Ee({
      values: Ps,
      defaultWidth: "wide",
      argumentCallback: (e) => e - 1,
    }),
    month: Ee({ values: Ss, defaultWidth: "wide" }),
    day: Ee({ values: Es, defaultWidth: "wide" }),
    dayPeriod: Ee({
      values: Rs,
      defaultWidth: "wide",
      formattingValues: Ms,
      defaultFormattingWidth: "wide",
    }),
  };
function Re(e) {
  return (t, n = {}) => {
    const r = n.width,
      o = (r && e.matchPatterns[r]) || e.matchPatterns[e.defaultMatchWidth],
      s = t.match(o);
    if (!s) return null;
    const i = s[0],
      a = (r && e.parsePatterns[r]) || e.parsePatterns[e.defaultParseWidth],
      l = Array.isArray(a) ? Ds(a, (f) => f.test(i)) : ks(a, (f) => f.test(i));
    let u;
    ((u = e.valueCallback ? e.valueCallback(l) : l),
      (u = n.valueCallback ? n.valueCallback(u) : u));
    const c = t.slice(i.length);
    return { value: u, rest: c };
  };
}
function ks(e, t) {
  for (const n in e)
    if (Object.prototype.hasOwnProperty.call(e, n) && t(e[n])) return n;
}
function Ds(e, t) {
  for (let n = 0; n < e.length; n++) if (t(e[n])) return n;
}
function Ns(e) {
  return (t, n = {}) => {
    const r = t.match(e.matchPattern);
    if (!r) return null;
    const o = r[0],
      s = t.match(e.parsePattern);
    if (!s) return null;
    let i = e.valueCallback ? e.valueCallback(s[0]) : s[0];
    i = n.valueCallback ? n.valueCallback(i) : i;
    const a = t.slice(o.length);
    return { value: i, rest: a };
  };
}
const _s = /^(\d+)(th|st|nd|rd)?/i,
  Ls = /\d+/i,
  Ws = {
    narrow: /^(b|a)/i,
    abbreviated: /^(b\.?\s?c\.?|b\.?\s?c\.?\s?e\.?|a\.?\s?d\.?|c\.?\s?e\.?)/i,
    wide: /^(before christ|before common era|anno domini|common era)/i,
  },
  Is = { any: [/^b/i, /^(a|c)/i] },
  Fs = {
    narrow: /^[1234]/i,
    abbreviated: /^q[1234]/i,
    wide: /^[1234](th|st|nd|rd)? quarter/i,
  },
  js = { any: [/1/i, /2/i, /3/i, /4/i] },
  $s = {
    narrow: /^[jfmasond]/i,
    abbreviated: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
    wide: /^(january|february|march|april|may|june|july|august|september|october|november|december)/i,
  },
  zs = {
    narrow: [
      /^j/i,
      /^f/i,
      /^m/i,
      /^a/i,
      /^m/i,
      /^j/i,
      /^j/i,
      /^a/i,
      /^s/i,
      /^o/i,
      /^n/i,
      /^d/i,
    ],
    any: [
      /^ja/i,
      /^f/i,
      /^mar/i,
      /^ap/i,
      /^may/i,
      /^jun/i,
      /^jul/i,
      /^au/i,
      /^s/i,
      /^o/i,
      /^n/i,
      /^d/i,
    ],
  },
  Hs = {
    narrow: /^[smtwf]/i,
    short: /^(su|mo|tu|we|th|fr|sa)/i,
    abbreviated: /^(sun|mon|tue|wed|thu|fri|sat)/i,
    wide: /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i,
  },
  Ys = {
    narrow: [/^s/i, /^m/i, /^t/i, /^w/i, /^t/i, /^f/i, /^s/i],
    any: [/^su/i, /^m/i, /^tu/i, /^w/i, /^th/i, /^f/i, /^sa/i],
  },
  Bs = {
    narrow: /^(a|p|mi|n|(in the|at) (morning|afternoon|evening|night))/i,
    any: /^([ap]\.?\s?m\.?|midnight|noon|(in the|at) (morning|afternoon|evening|night))/i,
  },
  Vs = {
    any: {
      am: /^a/i,
      pm: /^p/i,
      midnight: /^mi/i,
      noon: /^no/i,
      morning: /morning/i,
      afternoon: /afternoon/i,
      evening: /evening/i,
      night: /night/i,
    },
  },
  Us = {
    ordinalNumber: Ns({
      matchPattern: _s,
      parsePattern: Ls,
      valueCallback: (e) => parseInt(e, 10),
    }),
    era: Re({
      matchPatterns: Ws,
      defaultMatchWidth: "wide",
      parsePatterns: Is,
      defaultParseWidth: "any",
    }),
    quarter: Re({
      matchPatterns: Fs,
      defaultMatchWidth: "wide",
      parsePatterns: js,
      defaultParseWidth: "any",
      valueCallback: (e) => e + 1,
    }),
    month: Re({
      matchPatterns: $s,
      defaultMatchWidth: "wide",
      parsePatterns: zs,
      defaultParseWidth: "any",
    }),
    day: Re({
      matchPatterns: Hs,
      defaultMatchWidth: "wide",
      parsePatterns: Ys,
      defaultParseWidth: "any",
    }),
    dayPeriod: Re({
      matchPatterns: Bs,
      defaultMatchWidth: "any",
      parsePatterns: Vs,
      defaultParseWidth: "any",
    }),
  },
  Gs = {
    code: "en-US",
    formatDistance: gs,
    formatLong: vs,
    formatRelative: Cs,
    localize: As,
    match: Us,
    options: { weekStartsOn: 0, firstWeekContainsDate: 1 },
  };
function Qs(e, t) {
  const n = z(e, t?.in);
  return cs(n, ps(n)) + 1;
}
function qs(e, t) {
  const n = z(e, t?.in),
    r = +He(n) - +ls(n);
  return Math.round(r / An) + 1;
}
function Dn(e, t) {
  const n = z(e, t?.in),
    r = n.getFullYear(),
    o = De(),
    s =
      t?.firstWeekContainsDate ??
      t?.locale?.options?.firstWeekContainsDate ??
      o.firstWeekContainsDate ??
      o.locale?.options?.firstWeekContainsDate ??
      1,
    i = V(t?.in || e, 0);
  (i.setFullYear(r + 1, 0, s), i.setHours(0, 0, 0, 0));
  const a = Te(i, t),
    l = V(t?.in || e, 0);
  (l.setFullYear(r, 0, s), l.setHours(0, 0, 0, 0));
  const u = Te(l, t);
  return +n >= +a ? r + 1 : +n >= +u ? r : r - 1;
}
function Xs(e, t) {
  const n = De(),
    r =
      t?.firstWeekContainsDate ??
      t?.locale?.options?.firstWeekContainsDate ??
      n.firstWeekContainsDate ??
      n.locale?.options?.firstWeekContainsDate ??
      1,
    o = Dn(e, t),
    s = V(t?.in || e, 0);
  return (s.setFullYear(o, 0, r), s.setHours(0, 0, 0, 0), Te(s, t));
}
function Ks(e, t) {
  const n = z(e, t?.in),
    r = +Te(n, t) - +Xs(n, t);
  return Math.round(r / An) + 1;
}
function k(e, t) {
  const n = e < 0 ? "-" : "",
    r = Math.abs(e).toString().padStart(t, "0");
  return n + r;
}
const ie = {
    y(e, t) {
      const n = e.getFullYear(),
        r = n > 0 ? n : 1 - n;
      return k(t === "yy" ? r % 100 : r, t.length);
    },
    M(e, t) {
      const n = e.getMonth();
      return t === "M" ? String(n + 1) : k(n + 1, 2);
    },
    d(e, t) {
      return k(e.getDate(), t.length);
    },
    a(e, t) {
      const n = e.getHours() / 12 >= 1 ? "pm" : "am";
      switch (t) {
        case "a":
        case "aa":
          return n.toUpperCase();
        case "aaa":
          return n;
        case "aaaaa":
          return n[0];
        default:
          return n === "am" ? "a.m." : "p.m.";
      }
    },
    h(e, t) {
      return k(e.getHours() % 12 || 12, t.length);
    },
    H(e, t) {
      return k(e.getHours(), t.length);
    },
    m(e, t) {
      return k(e.getMinutes(), t.length);
    },
    s(e, t) {
      return k(e.getSeconds(), t.length);
    },
    S(e, t) {
      const n = t.length,
        r = e.getMilliseconds(),
        o = Math.trunc(r * Math.pow(10, n - 3));
      return k(o, t.length);
    },
  },
  me = {
    midnight: "midnight",
    noon: "noon",
    morning: "morning",
    afternoon: "afternoon",
    evening: "evening",
    night: "night",
  },
  Xt = {
    G: function (e, t, n) {
      const r = e.getFullYear() > 0 ? 1 : 0;
      switch (t) {
        case "G":
        case "GG":
        case "GGG":
          return n.era(r, { width: "abbreviated" });
        case "GGGGG":
          return n.era(r, { width: "narrow" });
        default:
          return n.era(r, { width: "wide" });
      }
    },
    y: function (e, t, n) {
      if (t === "yo") {
        const r = e.getFullYear(),
          o = r > 0 ? r : 1 - r;
        return n.ordinalNumber(o, { unit: "year" });
      }
      return ie.y(e, t);
    },
    Y: function (e, t, n, r) {
      const o = Dn(e, r),
        s = o > 0 ? o : 1 - o;
      if (t === "YY") {
        const i = s % 100;
        return k(i, 2);
      }
      return t === "Yo" ? n.ordinalNumber(s, { unit: "year" }) : k(s, t.length);
    },
    R: function (e, t) {
      const n = kn(e);
      return k(n, t.length);
    },
    u: function (e, t) {
      const n = e.getFullYear();
      return k(n, t.length);
    },
    Q: function (e, t, n) {
      const r = Math.ceil((e.getMonth() + 1) / 3);
      switch (t) {
        case "Q":
          return String(r);
        case "QQ":
          return k(r, 2);
        case "Qo":
          return n.ordinalNumber(r, { unit: "quarter" });
        case "QQQ":
          return n.quarter(r, { width: "abbreviated", context: "formatting" });
        case "QQQQQ":
          return n.quarter(r, { width: "narrow", context: "formatting" });
        default:
          return n.quarter(r, { width: "wide", context: "formatting" });
      }
    },
    q: function (e, t, n) {
      const r = Math.ceil((e.getMonth() + 1) / 3);
      switch (t) {
        case "q":
          return String(r);
        case "qq":
          return k(r, 2);
        case "qo":
          return n.ordinalNumber(r, { unit: "quarter" });
        case "qqq":
          return n.quarter(r, { width: "abbreviated", context: "standalone" });
        case "qqqqq":
          return n.quarter(r, { width: "narrow", context: "standalone" });
        default:
          return n.quarter(r, { width: "wide", context: "standalone" });
      }
    },
    M: function (e, t, n) {
      const r = e.getMonth();
      switch (t) {
        case "M":
        case "MM":
          return ie.M(e, t);
        case "Mo":
          return n.ordinalNumber(r + 1, { unit: "month" });
        case "MMM":
          return n.month(r, { width: "abbreviated", context: "formatting" });
        case "MMMMM":
          return n.month(r, { width: "narrow", context: "formatting" });
        default:
          return n.month(r, { width: "wide", context: "formatting" });
      }
    },
    L: function (e, t, n) {
      const r = e.getMonth();
      switch (t) {
        case "L":
          return String(r + 1);
        case "LL":
          return k(r + 1, 2);
        case "Lo":
          return n.ordinalNumber(r + 1, { unit: "month" });
        case "LLL":
          return n.month(r, { width: "abbreviated", context: "standalone" });
        case "LLLLL":
          return n.month(r, { width: "narrow", context: "standalone" });
        default:
          return n.month(r, { width: "wide", context: "standalone" });
      }
    },
    w: function (e, t, n, r) {
      const o = Ks(e, r);
      return t === "wo" ? n.ordinalNumber(o, { unit: "week" }) : k(o, t.length);
    },
    I: function (e, t, n) {
      const r = qs(e);
      return t === "Io" ? n.ordinalNumber(r, { unit: "week" }) : k(r, t.length);
    },
    d: function (e, t, n) {
      return t === "do"
        ? n.ordinalNumber(e.getDate(), { unit: "date" })
        : ie.d(e, t);
    },
    D: function (e, t, n) {
      const r = Qs(e);
      return t === "Do"
        ? n.ordinalNumber(r, { unit: "dayOfYear" })
        : k(r, t.length);
    },
    E: function (e, t, n) {
      const r = e.getDay();
      switch (t) {
        case "E":
        case "EE":
        case "EEE":
          return n.day(r, { width: "abbreviated", context: "formatting" });
        case "EEEEE":
          return n.day(r, { width: "narrow", context: "formatting" });
        case "EEEEEE":
          return n.day(r, { width: "short", context: "formatting" });
        default:
          return n.day(r, { width: "wide", context: "formatting" });
      }
    },
    e: function (e, t, n, r) {
      const o = e.getDay(),
        s = (o - r.weekStartsOn + 8) % 7 || 7;
      switch (t) {
        case "e":
          return String(s);
        case "ee":
          return k(s, 2);
        case "eo":
          return n.ordinalNumber(s, { unit: "day" });
        case "eee":
          return n.day(o, { width: "abbreviated", context: "formatting" });
        case "eeeee":
          return n.day(o, { width: "narrow", context: "formatting" });
        case "eeeeee":
          return n.day(o, { width: "short", context: "formatting" });
        default:
          return n.day(o, { width: "wide", context: "formatting" });
      }
    },
    c: function (e, t, n, r) {
      const o = e.getDay(),
        s = (o - r.weekStartsOn + 8) % 7 || 7;
      switch (t) {
        case "c":
          return String(s);
        case "cc":
          return k(s, t.length);
        case "co":
          return n.ordinalNumber(s, { unit: "day" });
        case "ccc":
          return n.day(o, { width: "abbreviated", context: "standalone" });
        case "ccccc":
          return n.day(o, { width: "narrow", context: "standalone" });
        case "cccccc":
          return n.day(o, { width: "short", context: "standalone" });
        default:
          return n.day(o, { width: "wide", context: "standalone" });
      }
    },
    i: function (e, t, n) {
      const r = e.getDay(),
        o = r === 0 ? 7 : r;
      switch (t) {
        case "i":
          return String(o);
        case "ii":
          return k(o, t.length);
        case "io":
          return n.ordinalNumber(o, { unit: "day" });
        case "iii":
          return n.day(r, { width: "abbreviated", context: "formatting" });
        case "iiiii":
          return n.day(r, { width: "narrow", context: "formatting" });
        case "iiiiii":
          return n.day(r, { width: "short", context: "formatting" });
        default:
          return n.day(r, { width: "wide", context: "formatting" });
      }
    },
    a: function (e, t, n) {
      const o = e.getHours() / 12 >= 1 ? "pm" : "am";
      switch (t) {
        case "a":
        case "aa":
          return n.dayPeriod(o, {
            width: "abbreviated",
            context: "formatting",
          });
        case "aaa":
          return n
            .dayPeriod(o, { width: "abbreviated", context: "formatting" })
            .toLowerCase();
        case "aaaaa":
          return n.dayPeriod(o, { width: "narrow", context: "formatting" });
        default:
          return n.dayPeriod(o, { width: "wide", context: "formatting" });
      }
    },
    b: function (e, t, n) {
      const r = e.getHours();
      let o;
      switch (
        (r === 12
          ? (o = me.noon)
          : r === 0
            ? (o = me.midnight)
            : (o = r / 12 >= 1 ? "pm" : "am"),
        t)
      ) {
        case "b":
        case "bb":
          return n.dayPeriod(o, {
            width: "abbreviated",
            context: "formatting",
          });
        case "bbb":
          return n
            .dayPeriod(o, { width: "abbreviated", context: "formatting" })
            .toLowerCase();
        case "bbbbb":
          return n.dayPeriod(o, { width: "narrow", context: "formatting" });
        default:
          return n.dayPeriod(o, { width: "wide", context: "formatting" });
      }
    },
    B: function (e, t, n) {
      const r = e.getHours();
      let o;
      switch (
        (r >= 17
          ? (o = me.evening)
          : r >= 12
            ? (o = me.afternoon)
            : r >= 4
              ? (o = me.morning)
              : (o = me.night),
        t)
      ) {
        case "B":
        case "BB":
        case "BBB":
          return n.dayPeriod(o, {
            width: "abbreviated",
            context: "formatting",
          });
        case "BBBBB":
          return n.dayPeriod(o, { width: "narrow", context: "formatting" });
        default:
          return n.dayPeriod(o, { width: "wide", context: "formatting" });
      }
    },
    h: function (e, t, n) {
      if (t === "ho") {
        let r = e.getHours() % 12;
        return (r === 0 && (r = 12), n.ordinalNumber(r, { unit: "hour" }));
      }
      return ie.h(e, t);
    },
    H: function (e, t, n) {
      return t === "Ho"
        ? n.ordinalNumber(e.getHours(), { unit: "hour" })
        : ie.H(e, t);
    },
    K: function (e, t, n) {
      const r = e.getHours() % 12;
      return t === "Ko" ? n.ordinalNumber(r, { unit: "hour" }) : k(r, t.length);
    },
    k: function (e, t, n) {
      let r = e.getHours();
      return (
        r === 0 && (r = 24),
        t === "ko" ? n.ordinalNumber(r, { unit: "hour" }) : k(r, t.length)
      );
    },
    m: function (e, t, n) {
      return t === "mo"
        ? n.ordinalNumber(e.getMinutes(), { unit: "minute" })
        : ie.m(e, t);
    },
    s: function (e, t, n) {
      return t === "so"
        ? n.ordinalNumber(e.getSeconds(), { unit: "second" })
        : ie.s(e, t);
    },
    S: function (e, t) {
      return ie.S(e, t);
    },
    X: function (e, t, n) {
      const r = e.getTimezoneOffset();
      if (r === 0) return "Z";
      switch (t) {
        case "X":
          return Jt(r);
        case "XXXX":
        case "XX":
          return ue(r);
        default:
          return ue(r, ":");
      }
    },
    x: function (e, t, n) {
      const r = e.getTimezoneOffset();
      switch (t) {
        case "x":
          return Jt(r);
        case "xxxx":
        case "xx":
          return ue(r);
        default:
          return ue(r, ":");
      }
    },
    O: function (e, t, n) {
      const r = e.getTimezoneOffset();
      switch (t) {
        case "O":
        case "OO":
        case "OOO":
          return "GMT" + Kt(r, ":");
        default:
          return "GMT" + ue(r, ":");
      }
    },
    z: function (e, t, n) {
      const r = e.getTimezoneOffset();
      switch (t) {
        case "z":
        case "zz":
        case "zzz":
          return "GMT" + Kt(r, ":");
        default:
          return "GMT" + ue(r, ":");
      }
    },
    t: function (e, t, n) {
      const r = Math.trunc(+e / 1e3);
      return k(r, t.length);
    },
    T: function (e, t, n) {
      return k(+e, t.length);
    },
  };
function Kt(e, t = "") {
  const n = e > 0 ? "-" : "+",
    r = Math.abs(e),
    o = Math.trunc(r / 60),
    s = r % 60;
  return s === 0 ? n + String(o) : n + String(o) + t + k(s, 2);
}
function Jt(e, t) {
  return e % 60 === 0 ? (e > 0 ? "-" : "+") + k(Math.abs(e) / 60, 2) : ue(e, t);
}
function ue(e, t = "") {
  const n = e > 0 ? "-" : "+",
    r = Math.abs(e),
    o = k(Math.trunc(r / 60), 2),
    s = k(r % 60, 2);
  return n + o + t + s;
}
const Zt = (e, t) => {
    switch (e) {
      case "P":
        return t.date({ width: "short" });
      case "PP":
        return t.date({ width: "medium" });
      case "PPP":
        return t.date({ width: "long" });
      default:
        return t.date({ width: "full" });
    }
  },
  Nn = (e, t) => {
    switch (e) {
      case "p":
        return t.time({ width: "short" });
      case "pp":
        return t.time({ width: "medium" });
      case "ppp":
        return t.time({ width: "long" });
      default:
        return t.time({ width: "full" });
    }
  },
  Js = (e, t) => {
    const n = e.match(/(P+)(p+)?/) || [],
      r = n[1],
      o = n[2];
    if (!o) return Zt(e, t);
    let s;
    switch (r) {
      case "P":
        s = t.dateTime({ width: "short" });
        break;
      case "PP":
        s = t.dateTime({ width: "medium" });
        break;
      case "PPP":
        s = t.dateTime({ width: "long" });
        break;
      default:
        s = t.dateTime({ width: "full" });
        break;
    }
    return s.replace("{{date}}", Zt(r, t)).replace("{{time}}", Nn(o, t));
  },
  Zs = { p: Nn, P: Js },
  ei = /^D+$/,
  ti = /^Y+$/,
  ni = ["D", "DD", "YY", "YYYY"];
function ri(e) {
  return ei.test(e);
}
function oi(e) {
  return ti.test(e);
}
function si(e, t, n) {
  const r = ii(e, t, n);
  if ((console.warn(r), ni.includes(e))) throw new RangeError(r);
}
function ii(e, t, n) {
  const r = e[0] === "Y" ? "years" : "days of the month";
  return `Use \`${e.toLowerCase()}\` instead of \`${e}\` (in \`${t}\`) for formatting ${r} to the input \`${n}\`; see: https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md`;
}
const ai = /[yYQqMLwIdDecihHKkms]o|(\w)\1*|''|'(''|[^'])+('|$)|./g,
  ci = /P+p+|P+|p+|''|'(''|[^'])+('|$)|./g,
  li = /^'([^]*?)'?$/,
  ui = /''/g,
  di = /[a-zA-Z]/;
function Ec(e, t, n) {
  const r = De(),
    o = r.locale ?? Gs,
    s =
      r.firstWeekContainsDate ?? r.locale?.options?.firstWeekContainsDate ?? 1,
    i = r.weekStartsOn ?? r.locale?.options?.weekStartsOn ?? 0,
    a = z(e, n?.in);
  if (!hs(a)) throw new RangeError("Invalid time value");
  let l = t
    .match(ci)
    .map((c) => {
      const f = c[0];
      if (f === "p" || f === "P") {
        const h = Zs[f];
        return h(c, o.formatLong);
      }
      return c;
    })
    .join("")
    .match(ai)
    .map((c) => {
      if (c === "''") return { isToken: !1, value: "'" };
      const f = c[0];
      if (f === "'") return { isToken: !1, value: fi(c) };
      if (Xt[f]) return { isToken: !0, value: c };
      if (f.match(di))
        throw new RangeError(
          "Format string contains an unescaped latin alphabet character `" +
            f +
            "`",
        );
      return { isToken: !1, value: c };
    });
  o.localize.preprocessor && (l = o.localize.preprocessor(a, l));
  const u = { firstWeekContainsDate: s, weekStartsOn: i, locale: o };
  return l
    .map((c) => {
      if (!c.isToken) return c.value;
      const f = c.value;
      (oi(f) || ri(f)) && si(f, t, String(e));
      const h = Xt[f[0]];
      return h(a, f, o.localize, u);
    })
    .join("");
}
function fi(e) {
  const t = e.match(li);
  return t ? t[1].replace(ui, "'") : e;
}
function Rc(e, t, n) {
  const [r, o] = Pt(n?.in, e, t);
  return r.getFullYear() === o.getFullYear() && r.getMonth() === o.getMonth();
}
function Mc(e, t) {
  return ds(V(e, e), us(e));
}
function Tc(e, t, n) {
  return is(e, -t, n);
}
function qe(e) {
  const t = d.useRef(e);
  return (
    d.useEffect(() => {
      t.current = e;
    }),
    d.useMemo(
      () =>
        (...n) =>
          t.current?.(...n),
      [],
    )
  );
}
function hi(e, t = globalThis?.document) {
  const n = qe(e);
  d.useEffect(() => {
    const r = (o) => {
      o.key === "Escape" && n(o);
    };
    return (
      t.addEventListener("keydown", r, { capture: !0 }),
      () => t.removeEventListener("keydown", r, { capture: !0 })
    );
  }, [n, t]);
}
var pi = "DismissableLayer",
  dt = "dismissableLayer.update",
  mi = "dismissableLayer.pointerDownOutside",
  gi = "dismissableLayer.focusOutside",
  en,
  _n = d.createContext({
    layers: new Set(),
    layersWithOutsidePointerEventsDisabled: new Set(),
    branches: new Set(),
  }),
  Ln = d.forwardRef((e, t) => {
    const {
        disableOutsidePointerEvents: n = !1,
        onEscapeKeyDown: r,
        onPointerDownOutside: o,
        onFocusOutside: s,
        onInteractOutside: i,
        onDismiss: a,
        ...l
      } = e,
      u = d.useContext(_n),
      [c, f] = d.useState(null),
      h = c?.ownerDocument ?? globalThis?.document,
      [, p] = d.useState({}),
      m = he(t, (x) => f(x)),
      g = Array.from(u.layers),
      [y] = [...u.layersWithOutsidePointerEventsDisabled].slice(-1),
      b = g.indexOf(y),
      w = c ? g.indexOf(c) : -1,
      C = u.layersWithOutsidePointerEventsDisabled.size > 0,
      v = w >= b,
      O = wi((x) => {
        const M = x.target,
          D = [...u.branches].some((A) => A.contains(M));
        !v || D || (o?.(x), i?.(x), x.defaultPrevented || a?.());
      }, h),
      E = vi((x) => {
        const M = x.target;
        [...u.branches].some((A) => A.contains(M)) ||
          (s?.(x), i?.(x), x.defaultPrevented || a?.());
      }, h);
    return (
      hi((x) => {
        w === u.layers.size - 1 &&
          (r?.(x), !x.defaultPrevented && a && (x.preventDefault(), a()));
      }, h),
      d.useEffect(() => {
        if (c)
          return (
            n &&
              (u.layersWithOutsidePointerEventsDisabled.size === 0 &&
                ((en = h.body.style.pointerEvents),
                (h.body.style.pointerEvents = "none")),
              u.layersWithOutsidePointerEventsDisabled.add(c)),
            u.layers.add(c),
            tn(),
            () => {
              n &&
                u.layersWithOutsidePointerEventsDisabled.size === 1 &&
                (h.body.style.pointerEvents = en);
            }
          );
      }, [c, h, n, u]),
      d.useEffect(
        () => () => {
          c &&
            (u.layers.delete(c),
            u.layersWithOutsidePointerEventsDisabled.delete(c),
            tn());
        },
        [c, u],
      ),
      d.useEffect(() => {
        const x = () => p({});
        return (
          document.addEventListener(dt, x),
          () => document.removeEventListener(dt, x)
        );
      }, []),
      S.jsx(pe.div, {
        ...l,
        ref: m,
        style: {
          pointerEvents: C ? (v ? "auto" : "none") : void 0,
          ...e.style,
        },
        onFocusCapture: ee(e.onFocusCapture, E.onFocusCapture),
        onBlurCapture: ee(e.onBlurCapture, E.onBlurCapture),
        onPointerDownCapture: ee(
          e.onPointerDownCapture,
          O.onPointerDownCapture,
        ),
      })
    );
  });
Ln.displayName = pi;
var yi = "DismissableLayerBranch",
  bi = d.forwardRef((e, t) => {
    const n = d.useContext(_n),
      r = d.useRef(null),
      o = he(t, r);
    return (
      d.useEffect(() => {
        const s = r.current;
        if (s)
          return (
            n.branches.add(s),
            () => {
              n.branches.delete(s);
            }
          );
      }, [n.branches]),
      S.jsx(pe.div, { ...e, ref: o })
    );
  });
bi.displayName = yi;
function wi(e, t = globalThis?.document) {
  const n = qe(e),
    r = d.useRef(!1),
    o = d.useRef(() => {});
  return (
    d.useEffect(() => {
      const s = (a) => {
          if (a.target && !r.current) {
            let l = function () {
              Wn(mi, n, u, { discrete: !0 });
            };
            const u = { originalEvent: a };
            a.pointerType === "touch"
              ? (t.removeEventListener("click", o.current),
                (o.current = l),
                t.addEventListener("click", o.current, { once: !0 }))
              : l();
          } else t.removeEventListener("click", o.current);
          r.current = !1;
        },
        i = window.setTimeout(() => {
          t.addEventListener("pointerdown", s);
        }, 0);
      return () => {
        (window.clearTimeout(i),
          t.removeEventListener("pointerdown", s),
          t.removeEventListener("click", o.current));
      };
    }, [t, n]),
    { onPointerDownCapture: () => (r.current = !0) }
  );
}
function vi(e, t = globalThis?.document) {
  const n = qe(e),
    r = d.useRef(!1);
  return (
    d.useEffect(() => {
      const o = (s) => {
        s.target &&
          !r.current &&
          Wn(gi, n, { originalEvent: s }, { discrete: !1 });
      };
      return (
        t.addEventListener("focusin", o),
        () => t.removeEventListener("focusin", o)
      );
    }, [t, n]),
    {
      onFocusCapture: () => (r.current = !0),
      onBlurCapture: () => (r.current = !1),
    }
  );
}
function tn() {
  const e = new CustomEvent(dt);
  document.dispatchEvent(e);
}
function Wn(e, t, n, { discrete: r }) {
  const o = n.originalEvent.target,
    s = new CustomEvent(e, { bubbles: !1, cancelable: !0, detail: n });
  (t && o.addEventListener(e, t, { once: !0 }),
    r ? Qo(o, s) : o.dispatchEvent(s));
}
var xi = bt[" useId ".trim().toString()] || (() => {}),
  Ci = 0;
function Oi(e) {
  const [t, n] = d.useState(xi());
  return (
    de(() => {
      n((r) => r ?? String(Ci++));
    }, [e]),
    t ? `radix-${t}` : ""
  );
}
const Pi = ["top", "right", "bottom", "left"],
  ae = Math.min,
  Y = Math.max,
  Be = Math.round,
  We = Math.floor,
  K = (e) => ({ x: e, y: e }),
  Si = { left: "right", right: "left", bottom: "top", top: "bottom" };
function ft(e, t, n) {
  return Y(e, ae(t, n));
}
function te(e, t) {
  return typeof e == "function" ? e(t) : e;
}
function ne(e) {
  return e.split("-")[0];
}
function xe(e) {
  return e.split("-")[1];
}
function St(e) {
  return e === "x" ? "y" : "x";
}
function Et(e) {
  return e === "y" ? "height" : "width";
}
function X(e) {
  const t = e[0];
  return t === "t" || t === "b" ? "y" : "x";
}
function Rt(e) {
  return St(X(e));
}
function Ei(e, t, n) {
  n === void 0 && (n = !1);
  const r = xe(e),
    o = Rt(e),
    s = Et(o);
  let i =
    o === "x"
      ? r === (n ? "end" : "start")
        ? "right"
        : "left"
      : r === "start"
        ? "bottom"
        : "top";
  return (t.reference[s] > t.floating[s] && (i = Ve(i)), [i, Ve(i)]);
}
function Ri(e) {
  const t = Ve(e);
  return [ht(e), t, ht(t)];
}
function ht(e) {
  return e.includes("start")
    ? e.replace("start", "end")
    : e.replace("end", "start");
}
const nn = ["left", "right"],
  rn = ["right", "left"],
  Mi = ["top", "bottom"],
  Ti = ["bottom", "top"];
function Ai(e, t, n) {
  switch (e) {
    case "top":
    case "bottom":
      return n ? (t ? rn : nn) : t ? nn : rn;
    case "left":
    case "right":
      return t ? Mi : Ti;
    default:
      return [];
  }
}
function ki(e, t, n, r) {
  const o = xe(e);
  let s = Ai(ne(e), n === "start", r);
  return (
    o && ((s = s.map((i) => i + "-" + o)), t && (s = s.concat(s.map(ht)))),
    s
  );
}
function Ve(e) {
  const t = ne(e);
  return Si[t] + e.slice(t.length);
}
function Di(e) {
  return { top: 0, right: 0, bottom: 0, left: 0, ...e };
}
function In(e) {
  return typeof e != "number"
    ? Di(e)
    : { top: e, right: e, bottom: e, left: e };
}
function Ue(e) {
  const { x: t, y: n, width: r, height: o } = e;
  return {
    width: r,
    height: o,
    top: n,
    left: t,
    right: t + r,
    bottom: n + o,
    x: t,
    y: n,
  };
}
function on(e, t, n) {
  let { reference: r, floating: o } = e;
  const s = X(t),
    i = Rt(t),
    a = Et(i),
    l = ne(t),
    u = s === "y",
    c = r.x + r.width / 2 - o.width / 2,
    f = r.y + r.height / 2 - o.height / 2,
    h = r[a] / 2 - o[a] / 2;
  let p;
  switch (l) {
    case "top":
      p = { x: c, y: r.y - o.height };
      break;
    case "bottom":
      p = { x: c, y: r.y + r.height };
      break;
    case "right":
      p = { x: r.x + r.width, y: f };
      break;
    case "left":
      p = { x: r.x - o.width, y: f };
      break;
    default:
      p = { x: r.x, y: r.y };
  }
  switch (xe(t)) {
    case "start":
      p[i] -= h * (n && u ? -1 : 1);
      break;
    case "end":
      p[i] += h * (n && u ? -1 : 1);
      break;
  }
  return p;
}
async function Ni(e, t) {
  var n;
  t === void 0 && (t = {});
  const { x: r, y: o, platform: s, rects: i, elements: a, strategy: l } = e,
    {
      boundary: u = "clippingAncestors",
      rootBoundary: c = "viewport",
      elementContext: f = "floating",
      altBoundary: h = !1,
      padding: p = 0,
    } = te(t, e),
    m = In(p),
    y = a[h ? (f === "floating" ? "reference" : "floating") : f],
    b = Ue(
      await s.getClippingRect({
        element:
          (n = await (s.isElement == null ? void 0 : s.isElement(y))) == null ||
          n
            ? y
            : y.contextElement ||
              (await (s.getDocumentElement == null
                ? void 0
                : s.getDocumentElement(a.floating))),
        boundary: u,
        rootBoundary: c,
        strategy: l,
      }),
    ),
    w =
      f === "floating"
        ? { x: r, y: o, width: i.floating.width, height: i.floating.height }
        : i.reference,
    C = await (s.getOffsetParent == null
      ? void 0
      : s.getOffsetParent(a.floating)),
    v = (await (s.isElement == null ? void 0 : s.isElement(C)))
      ? (await (s.getScale == null ? void 0 : s.getScale(C))) || { x: 1, y: 1 }
      : { x: 1, y: 1 },
    O = Ue(
      s.convertOffsetParentRelativeRectToViewportRelativeRect
        ? await s.convertOffsetParentRelativeRectToViewportRelativeRect({
            elements: a,
            rect: w,
            offsetParent: C,
            strategy: l,
          })
        : w,
    );
  return {
    top: (b.top - O.top + m.top) / v.y,
    bottom: (O.bottom - b.bottom + m.bottom) / v.y,
    left: (b.left - O.left + m.left) / v.x,
    right: (O.right - b.right + m.right) / v.x,
  };
}
const _i = 50,
  Li = async (e, t, n) => {
    const {
        placement: r = "bottom",
        strategy: o = "absolute",
        middleware: s = [],
        platform: i,
      } = n,
      a = i.detectOverflow ? i : { ...i, detectOverflow: Ni },
      l = await (i.isRTL == null ? void 0 : i.isRTL(t));
    let u = await i.getElementRects({ reference: e, floating: t, strategy: o }),
      { x: c, y: f } = on(u, r, l),
      h = r,
      p = 0;
    const m = {};
    for (let g = 0; g < s.length; g++) {
      const y = s[g];
      if (!y) continue;
      const { name: b, fn: w } = y,
        {
          x: C,
          y: v,
          data: O,
          reset: E,
        } = await w({
          x: c,
          y: f,
          initialPlacement: r,
          placement: h,
          strategy: o,
          middlewareData: m,
          rects: u,
          platform: a,
          elements: { reference: e, floating: t },
        });
      ((c = C ?? c),
        (f = v ?? f),
        (m[b] = { ...m[b], ...O }),
        E &&
          p < _i &&
          (p++,
          typeof E == "object" &&
            (E.placement && (h = E.placement),
            E.rects &&
              (u =
                E.rects === !0
                  ? await i.getElementRects({
                      reference: e,
                      floating: t,
                      strategy: o,
                    })
                  : E.rects),
            ({ x: c, y: f } = on(u, h, l))),
          (g = -1)));
    }
    return { x: c, y: f, placement: h, strategy: o, middlewareData: m };
  },
  Wi = (e) => ({
    name: "arrow",
    options: e,
    async fn(t) {
      const {
          x: n,
          y: r,
          placement: o,
          rects: s,
          platform: i,
          elements: a,
          middlewareData: l,
        } = t,
        { element: u, padding: c = 0 } = te(e, t) || {};
      if (u == null) return {};
      const f = In(c),
        h = { x: n, y: r },
        p = Rt(o),
        m = Et(p),
        g = await i.getDimensions(u),
        y = p === "y",
        b = y ? "top" : "left",
        w = y ? "bottom" : "right",
        C = y ? "clientHeight" : "clientWidth",
        v = s.reference[m] + s.reference[p] - h[p] - s.floating[m],
        O = h[p] - s.reference[p],
        E = await (i.getOffsetParent == null ? void 0 : i.getOffsetParent(u));
      let x = E ? E[C] : 0;
      (!x || !(await (i.isElement == null ? void 0 : i.isElement(E)))) &&
        (x = a.floating[C] || s.floating[m]);
      const M = v / 2 - O / 2,
        D = x / 2 - g[m] / 2 - 1,
        A = ae(f[b], D),
        I = ae(f[w], D),
        P = A,
        N = x - g[m] - I,
        _ = x / 2 - g[m] / 2 + M,
        $ = ft(P, _, N),
        W =
          !l.arrow &&
          xe(o) != null &&
          _ !== $ &&
          s.reference[m] / 2 - (_ < P ? A : I) - g[m] / 2 < 0,
        F = W ? (_ < P ? _ - P : _ - N) : 0;
      return {
        [p]: h[p] + F,
        data: {
          [p]: $,
          centerOffset: _ - $ - F,
          ...(W && { alignmentOffset: F }),
        },
        reset: W,
      };
    },
  }),
  Ii = function (e) {
    return (
      e === void 0 && (e = {}),
      {
        name: "flip",
        options: e,
        async fn(t) {
          var n, r;
          const {
              placement: o,
              middlewareData: s,
              rects: i,
              initialPlacement: a,
              platform: l,
              elements: u,
            } = t,
            {
              mainAxis: c = !0,
              crossAxis: f = !0,
              fallbackPlacements: h,
              fallbackStrategy: p = "bestFit",
              fallbackAxisSideDirection: m = "none",
              flipAlignment: g = !0,
              ...y
            } = te(e, t);
          if ((n = s.arrow) != null && n.alignmentOffset) return {};
          const b = ne(o),
            w = X(a),
            C = ne(a) === a,
            v = await (l.isRTL == null ? void 0 : l.isRTL(u.floating)),
            O = h || (C || !g ? [Ve(a)] : Ri(a)),
            E = m !== "none";
          !h && E && O.push(...ki(a, g, m, v));
          const x = [a, ...O],
            M = await l.detectOverflow(t, y),
            D = [];
          let A = ((r = s.flip) == null ? void 0 : r.overflows) || [];
          if ((c && D.push(M[b]), f)) {
            const _ = Ei(o, i, v);
            D.push(M[_[0]], M[_[1]]);
          }
          if (
            ((A = [...A, { placement: o, overflows: D }]),
            !D.every((_) => _ <= 0))
          ) {
            var I, P;
            const _ = (((I = s.flip) == null ? void 0 : I.index) || 0) + 1,
              $ = x[_];
            if (
              $ &&
              (!(f === "alignment" ? w !== X($) : !1) ||
                A.every((T) =>
                  X(T.placement) === w ? T.overflows[0] > 0 : !0,
                ))
            )
              return {
                data: { index: _, overflows: A },
                reset: { placement: $ },
              };
            let W =
              (P = A.filter((F) => F.overflows[0] <= 0).sort(
                (F, T) => F.overflows[1] - T.overflows[1],
              )[0]) == null
                ? void 0
                : P.placement;
            if (!W)
              switch (p) {
                case "bestFit": {
                  var N;
                  const F =
                    (N = A.filter((T) => {
                      if (E) {
                        const j = X(T.placement);
                        return j === w || j === "y";
                      }
                      return !0;
                    })
                      .map((T) => [
                        T.placement,
                        T.overflows
                          .filter((j) => j > 0)
                          .reduce((j, H) => j + H, 0),
                      ])
                      .sort((T, j) => T[1] - j[1])[0]) == null
                      ? void 0
                      : N[0];
                  F && (W = F);
                  break;
                }
                case "initialPlacement":
                  W = a;
                  break;
              }
            if (o !== W) return { reset: { placement: W } };
          }
          return {};
        },
      }
    );
  };
function sn(e, t) {
  return {
    top: e.top - t.height,
    right: e.right - t.width,
    bottom: e.bottom - t.height,
    left: e.left - t.width,
  };
}
function an(e) {
  return Pi.some((t) => e[t] >= 0);
}
const Fi = function (e) {
    return (
      e === void 0 && (e = {}),
      {
        name: "hide",
        options: e,
        async fn(t) {
          const { rects: n, platform: r } = t,
            { strategy: o = "referenceHidden", ...s } = te(e, t);
          switch (o) {
            case "referenceHidden": {
              const i = await r.detectOverflow(t, {
                  ...s,
                  elementContext: "reference",
                }),
                a = sn(i, n.reference);
              return {
                data: { referenceHiddenOffsets: a, referenceHidden: an(a) },
              };
            }
            case "escaped": {
              const i = await r.detectOverflow(t, { ...s, altBoundary: !0 }),
                a = sn(i, n.floating);
              return { data: { escapedOffsets: a, escaped: an(a) } };
            }
            default:
              return {};
          }
        },
      }
    );
  },
  Fn = new Set(["left", "top"]);
async function ji(e, t) {
  const { placement: n, platform: r, elements: o } = e,
    s = await (r.isRTL == null ? void 0 : r.isRTL(o.floating)),
    i = ne(n),
    a = xe(n),
    l = X(n) === "y",
    u = Fn.has(i) ? -1 : 1,
    c = s && l ? -1 : 1,
    f = te(t, e);
  let {
    mainAxis: h,
    crossAxis: p,
    alignmentAxis: m,
  } = typeof f == "number"
    ? { mainAxis: f, crossAxis: 0, alignmentAxis: null }
    : {
        mainAxis: f.mainAxis || 0,
        crossAxis: f.crossAxis || 0,
        alignmentAxis: f.alignmentAxis,
      };
  return (
    a && typeof m == "number" && (p = a === "end" ? m * -1 : m),
    l ? { x: p * c, y: h * u } : { x: h * u, y: p * c }
  );
}
const $i = function (e) {
    return (
      e === void 0 && (e = 0),
      {
        name: "offset",
        options: e,
        async fn(t) {
          var n, r;
          const { x: o, y: s, placement: i, middlewareData: a } = t,
            l = await ji(t, e);
          return i === ((n = a.offset) == null ? void 0 : n.placement) &&
            (r = a.arrow) != null &&
            r.alignmentOffset
            ? {}
            : { x: o + l.x, y: s + l.y, data: { ...l, placement: i } };
        },
      }
    );
  },
  zi = function (e) {
    return (
      e === void 0 && (e = {}),
      {
        name: "shift",
        options: e,
        async fn(t) {
          const { x: n, y: r, placement: o, platform: s } = t,
            {
              mainAxis: i = !0,
              crossAxis: a = !1,
              limiter: l = {
                fn: (b) => {
                  let { x: w, y: C } = b;
                  return { x: w, y: C };
                },
              },
              ...u
            } = te(e, t),
            c = { x: n, y: r },
            f = await s.detectOverflow(t, u),
            h = X(ne(o)),
            p = St(h);
          let m = c[p],
            g = c[h];
          if (i) {
            const b = p === "y" ? "top" : "left",
              w = p === "y" ? "bottom" : "right",
              C = m + f[b],
              v = m - f[w];
            m = ft(C, m, v);
          }
          if (a) {
            const b = h === "y" ? "top" : "left",
              w = h === "y" ? "bottom" : "right",
              C = g + f[b],
              v = g - f[w];
            g = ft(C, g, v);
          }
          const y = l.fn({ ...t, [p]: m, [h]: g });
          return {
            ...y,
            data: { x: y.x - n, y: y.y - r, enabled: { [p]: i, [h]: a } },
          };
        },
      }
    );
  },
  Hi = function (e) {
    return (
      e === void 0 && (e = {}),
      {
        options: e,
        fn(t) {
          const { x: n, y: r, placement: o, rects: s, middlewareData: i } = t,
            { offset: a = 0, mainAxis: l = !0, crossAxis: u = !0 } = te(e, t),
            c = { x: n, y: r },
            f = X(o),
            h = St(f);
          let p = c[h],
            m = c[f];
          const g = te(a, t),
            y =
              typeof g == "number"
                ? { mainAxis: g, crossAxis: 0 }
                : { mainAxis: 0, crossAxis: 0, ...g };
          if (l) {
            const C = h === "y" ? "height" : "width",
              v = s.reference[h] - s.floating[C] + y.mainAxis,
              O = s.reference[h] + s.reference[C] - y.mainAxis;
            p < v ? (p = v) : p > O && (p = O);
          }
          if (u) {
            var b, w;
            const C = h === "y" ? "width" : "height",
              v = Fn.has(ne(o)),
              O =
                s.reference[f] -
                s.floating[C] +
                ((v && ((b = i.offset) == null ? void 0 : b[f])) || 0) +
                (v ? 0 : y.crossAxis),
              E =
                s.reference[f] +
                s.reference[C] +
                (v ? 0 : ((w = i.offset) == null ? void 0 : w[f]) || 0) -
                (v ? y.crossAxis : 0);
            m < O ? (m = O) : m > E && (m = E);
          }
          return { [h]: p, [f]: m };
        },
      }
    );
  },
  Yi = function (e) {
    return (
      e === void 0 && (e = {}),
      {
        name: "size",
        options: e,
        async fn(t) {
          var n, r;
          const { placement: o, rects: s, platform: i, elements: a } = t,
            { apply: l = () => {}, ...u } = te(e, t),
            c = await i.detectOverflow(t, u),
            f = ne(o),
            h = xe(o),
            p = X(o) === "y",
            { width: m, height: g } = s.floating;
          let y, b;
          f === "top" || f === "bottom"
            ? ((y = f),
              (b =
                h ===
                ((await (i.isRTL == null ? void 0 : i.isRTL(a.floating)))
                  ? "start"
                  : "end")
                  ? "left"
                  : "right"))
            : ((b = f), (y = h === "end" ? "top" : "bottom"));
          const w = g - c.top - c.bottom,
            C = m - c.left - c.right,
            v = ae(g - c[y], w),
            O = ae(m - c[b], C),
            E = !t.middlewareData.shift;
          let x = v,
            M = O;
          if (
            ((n = t.middlewareData.shift) != null && n.enabled.x && (M = C),
            (r = t.middlewareData.shift) != null && r.enabled.y && (x = w),
            E && !h)
          ) {
            const A = Y(c.left, 0),
              I = Y(c.right, 0),
              P = Y(c.top, 0),
              N = Y(c.bottom, 0);
            p
              ? (M = m - 2 * (A !== 0 || I !== 0 ? A + I : Y(c.left, c.right)))
              : (x = g - 2 * (P !== 0 || N !== 0 ? P + N : Y(c.top, c.bottom)));
          }
          await l({ ...t, availableWidth: M, availableHeight: x });
          const D = await i.getDimensions(a.floating);
          return m !== D.width || g !== D.height
            ? { reset: { rects: !0 } }
            : {};
        },
      }
    );
  };
function Xe() {
  return typeof window < "u";
}
function Ce(e) {
  return jn(e) ? (e.nodeName || "").toLowerCase() : "#document";
}
function B(e) {
  var t;
  return (
    (e == null || (t = e.ownerDocument) == null ? void 0 : t.defaultView) ||
    window
  );
}
function J(e) {
  var t;
  return (t = (jn(e) ? e.ownerDocument : e.document) || window.document) == null
    ? void 0
    : t.documentElement;
}
function jn(e) {
  return Xe() ? e instanceof Node || e instanceof B(e).Node : !1;
}
function Q(e) {
  return Xe() ? e instanceof Element || e instanceof B(e).Element : !1;
}
function re(e) {
  return Xe() ? e instanceof HTMLElement || e instanceof B(e).HTMLElement : !1;
}
function cn(e) {
  return !Xe() || typeof ShadowRoot > "u"
    ? !1
    : e instanceof ShadowRoot || e instanceof B(e).ShadowRoot;
}
function Ne(e) {
  const { overflow: t, overflowX: n, overflowY: r, display: o } = q(e);
  return (
    /auto|scroll|overlay|hidden|clip/.test(t + r + n) &&
    o !== "inline" &&
    o !== "contents"
  );
}
function Bi(e) {
  return /^(table|td|th)$/.test(Ce(e));
}
function Ke(e) {
  try {
    if (e.matches(":popover-open")) return !0;
  } catch {}
  try {
    return e.matches(":modal");
  } catch {
    return !1;
  }
}
const Vi = /transform|translate|scale|rotate|perspective|filter/,
  Ui = /paint|layout|strict|content/,
  le = (e) => !!e && e !== "none";
let st;
function Mt(e) {
  const t = Q(e) ? q(e) : e;
  return (
    le(t.transform) ||
    le(t.translate) ||
    le(t.scale) ||
    le(t.rotate) ||
    le(t.perspective) ||
    (!Tt() && (le(t.backdropFilter) || le(t.filter))) ||
    Vi.test(t.willChange || "") ||
    Ui.test(t.contain || "")
  );
}
function Gi(e) {
  let t = ce(e);
  for (; re(t) && !be(t); ) {
    if (Mt(t)) return t;
    if (Ke(t)) return null;
    t = ce(t);
  }
  return null;
}
function Tt() {
  return (
    st == null &&
      (st =
        typeof CSS < "u" &&
        CSS.supports &&
        CSS.supports("-webkit-backdrop-filter", "none")),
    st
  );
}
function be(e) {
  return /^(html|body|#document)$/.test(Ce(e));
}
function q(e) {
  return B(e).getComputedStyle(e);
}
function Je(e) {
  return Q(e)
    ? { scrollLeft: e.scrollLeft, scrollTop: e.scrollTop }
    : { scrollLeft: e.scrollX, scrollTop: e.scrollY };
}
function ce(e) {
  if (Ce(e) === "html") return e;
  const t = e.assignedSlot || e.parentNode || (cn(e) && e.host) || J(e);
  return cn(t) ? t.host : t;
}
function $n(e) {
  const t = ce(e);
  return be(t)
    ? e.ownerDocument
      ? e.ownerDocument.body
      : e.body
    : re(t) && Ne(t)
      ? t
      : $n(t);
}
function Ae(e, t, n) {
  var r;
  (t === void 0 && (t = []), n === void 0 && (n = !0));
  const o = $n(e),
    s = o === ((r = e.ownerDocument) == null ? void 0 : r.body),
    i = B(o);
  if (s) {
    const a = pt(i);
    return t.concat(
      i,
      i.visualViewport || [],
      Ne(o) ? o : [],
      a && n ? Ae(a) : [],
    );
  } else return t.concat(o, Ae(o, [], n));
}
function pt(e) {
  return e.parent && Object.getPrototypeOf(e.parent) ? e.frameElement : null;
}
function zn(e) {
  const t = q(e);
  let n = parseFloat(t.width) || 0,
    r = parseFloat(t.height) || 0;
  const o = re(e),
    s = o ? e.offsetWidth : n,
    i = o ? e.offsetHeight : r,
    a = Be(n) !== s || Be(r) !== i;
  return (a && ((n = s), (r = i)), { width: n, height: r, $: a });
}
function At(e) {
  return Q(e) ? e : e.contextElement;
}
function ye(e) {
  const t = At(e);
  if (!re(t)) return K(1);
  const n = t.getBoundingClientRect(),
    { width: r, height: o, $: s } = zn(t);
  let i = (s ? Be(n.width) : n.width) / r,
    a = (s ? Be(n.height) : n.height) / o;
  return (
    (!i || !Number.isFinite(i)) && (i = 1),
    (!a || !Number.isFinite(a)) && (a = 1),
    { x: i, y: a }
  );
}
const Qi = K(0);
function Hn(e) {
  const t = B(e);
  return !Tt() || !t.visualViewport
    ? Qi
    : { x: t.visualViewport.offsetLeft, y: t.visualViewport.offsetTop };
}
function qi(e, t, n) {
  return (t === void 0 && (t = !1), !n || (t && n !== B(e)) ? !1 : t);
}
function fe(e, t, n, r) {
  (t === void 0 && (t = !1), n === void 0 && (n = !1));
  const o = e.getBoundingClientRect(),
    s = At(e);
  let i = K(1);
  t && (r ? Q(r) && (i = ye(r)) : (i = ye(e)));
  const a = qi(s, n, r) ? Hn(s) : K(0);
  let l = (o.left + a.x) / i.x,
    u = (o.top + a.y) / i.y,
    c = o.width / i.x,
    f = o.height / i.y;
  if (s) {
    const h = B(s),
      p = r && Q(r) ? B(r) : r;
    let m = h,
      g = pt(m);
    for (; g && r && p !== m; ) {
      const y = ye(g),
        b = g.getBoundingClientRect(),
        w = q(g),
        C = b.left + (g.clientLeft + parseFloat(w.paddingLeft)) * y.x,
        v = b.top + (g.clientTop + parseFloat(w.paddingTop)) * y.y;
      ((l *= y.x),
        (u *= y.y),
        (c *= y.x),
        (f *= y.y),
        (l += C),
        (u += v),
        (m = B(g)),
        (g = pt(m)));
    }
  }
  return Ue({ width: c, height: f, x: l, y: u });
}
function Ze(e, t) {
  const n = Je(e).scrollLeft;
  return t ? t.left + n : fe(J(e)).left + n;
}
function Yn(e, t) {
  const n = e.getBoundingClientRect(),
    r = n.left + t.scrollLeft - Ze(e, n),
    o = n.top + t.scrollTop;
  return { x: r, y: o };
}
function Xi(e) {
  let { elements: t, rect: n, offsetParent: r, strategy: o } = e;
  const s = o === "fixed",
    i = J(r),
    a = t ? Ke(t.floating) : !1;
  if (r === i || (a && s)) return n;
  let l = { scrollLeft: 0, scrollTop: 0 },
    u = K(1);
  const c = K(0),
    f = re(r);
  if ((f || (!f && !s)) && ((Ce(r) !== "body" || Ne(i)) && (l = Je(r)), f)) {
    const p = fe(r);
    ((u = ye(r)), (c.x = p.x + r.clientLeft), (c.y = p.y + r.clientTop));
  }
  const h = i && !f && !s ? Yn(i, l) : K(0);
  return {
    width: n.width * u.x,
    height: n.height * u.y,
    x: n.x * u.x - l.scrollLeft * u.x + c.x + h.x,
    y: n.y * u.y - l.scrollTop * u.y + c.y + h.y,
  };
}
function Ki(e) {
  return Array.from(e.getClientRects());
}
function Ji(e) {
  const t = J(e),
    n = Je(e),
    r = e.ownerDocument.body,
    o = Y(t.scrollWidth, t.clientWidth, r.scrollWidth, r.clientWidth),
    s = Y(t.scrollHeight, t.clientHeight, r.scrollHeight, r.clientHeight);
  let i = -n.scrollLeft + Ze(e);
  const a = -n.scrollTop;
  return (
    q(r).direction === "rtl" && (i += Y(t.clientWidth, r.clientWidth) - o),
    { width: o, height: s, x: i, y: a }
  );
}
const ln = 25;
function Zi(e, t) {
  const n = B(e),
    r = J(e),
    o = n.visualViewport;
  let s = r.clientWidth,
    i = r.clientHeight,
    a = 0,
    l = 0;
  if (o) {
    ((s = o.width), (i = o.height));
    const c = Tt();
    (!c || (c && t === "fixed")) && ((a = o.offsetLeft), (l = o.offsetTop));
  }
  const u = Ze(r);
  if (u <= 0) {
    const c = r.ownerDocument,
      f = c.body,
      h = getComputedStyle(f),
      p =
        (c.compatMode === "CSS1Compat" &&
          parseFloat(h.marginLeft) + parseFloat(h.marginRight)) ||
        0,
      m = Math.abs(r.clientWidth - f.clientWidth - p);
    m <= ln && (s -= m);
  } else u <= ln && (s += u);
  return { width: s, height: i, x: a, y: l };
}
function ea(e, t) {
  const n = fe(e, !0, t === "fixed"),
    r = n.top + e.clientTop,
    o = n.left + e.clientLeft,
    s = re(e) ? ye(e) : K(1),
    i = e.clientWidth * s.x,
    a = e.clientHeight * s.y,
    l = o * s.x,
    u = r * s.y;
  return { width: i, height: a, x: l, y: u };
}
function un(e, t, n) {
  let r;
  if (t === "viewport") r = Zi(e, n);
  else if (t === "document") r = Ji(J(e));
  else if (Q(t)) r = ea(t, n);
  else {
    const o = Hn(e);
    r = { x: t.x - o.x, y: t.y - o.y, width: t.width, height: t.height };
  }
  return Ue(r);
}
function Bn(e, t) {
  const n = ce(e);
  return n === t || !Q(n) || be(n) ? !1 : q(n).position === "fixed" || Bn(n, t);
}
function ta(e, t) {
  const n = t.get(e);
  if (n) return n;
  let r = Ae(e, [], !1).filter((a) => Q(a) && Ce(a) !== "body"),
    o = null;
  const s = q(e).position === "fixed";
  let i = s ? ce(e) : e;
  for (; Q(i) && !be(i); ) {
    const a = q(i),
      l = Mt(i);
    (!l && a.position === "fixed" && (o = null),
      (
        s
          ? !l && !o
          : (!l &&
              a.position === "static" &&
              !!o &&
              (o.position === "absolute" || o.position === "fixed")) ||
            (Ne(i) && !l && Bn(e, i))
      )
        ? (r = r.filter((c) => c !== i))
        : (o = a),
      (i = ce(i)));
  }
  return (t.set(e, r), r);
}
function na(e) {
  let { element: t, boundary: n, rootBoundary: r, strategy: o } = e;
  const i = [
      ...(n === "clippingAncestors"
        ? Ke(t)
          ? []
          : ta(t, this._c)
        : [].concat(n)),
      r,
    ],
    a = un(t, i[0], o);
  let l = a.top,
    u = a.right,
    c = a.bottom,
    f = a.left;
  for (let h = 1; h < i.length; h++) {
    const p = un(t, i[h], o);
    ((l = Y(p.top, l)),
      (u = ae(p.right, u)),
      (c = ae(p.bottom, c)),
      (f = Y(p.left, f)));
  }
  return { width: u - f, height: c - l, x: f, y: l };
}
function ra(e) {
  const { width: t, height: n } = zn(e);
  return { width: t, height: n };
}
function oa(e, t, n) {
  const r = re(t),
    o = J(t),
    s = n === "fixed",
    i = fe(e, !0, s, t);
  let a = { scrollLeft: 0, scrollTop: 0 };
  const l = K(0);
  function u() {
    l.x = Ze(o);
  }
  if (r || (!r && !s))
    if (((Ce(t) !== "body" || Ne(o)) && (a = Je(t)), r)) {
      const p = fe(t, !0, s, t);
      ((l.x = p.x + t.clientLeft), (l.y = p.y + t.clientTop));
    } else o && u();
  s && !r && o && u();
  const c = o && !r && !s ? Yn(o, a) : K(0),
    f = i.left + a.scrollLeft - l.x - c.x,
    h = i.top + a.scrollTop - l.y - c.y;
  return { x: f, y: h, width: i.width, height: i.height };
}
function it(e) {
  return q(e).position === "static";
}
function dn(e, t) {
  if (!re(e) || q(e).position === "fixed") return null;
  if (t) return t(e);
  let n = e.offsetParent;
  return (J(e) === n && (n = n.ownerDocument.body), n);
}
function Vn(e, t) {
  const n = B(e);
  if (Ke(e)) return n;
  if (!re(e)) {
    let o = ce(e);
    for (; o && !be(o); ) {
      if (Q(o) && !it(o)) return o;
      o = ce(o);
    }
    return n;
  }
  let r = dn(e, t);
  for (; r && Bi(r) && it(r); ) r = dn(r, t);
  return r && be(r) && it(r) && !Mt(r) ? n : r || Gi(e) || n;
}
const sa = async function (e) {
  const t = this.getOffsetParent || Vn,
    n = this.getDimensions,
    r = await n(e.floating);
  return {
    reference: oa(e.reference, await t(e.floating), e.strategy),
    floating: { x: 0, y: 0, width: r.width, height: r.height },
  };
};
function ia(e) {
  return q(e).direction === "rtl";
}
const aa = {
  convertOffsetParentRelativeRectToViewportRelativeRect: Xi,
  getDocumentElement: J,
  getClippingRect: na,
  getOffsetParent: Vn,
  getElementRects: sa,
  getClientRects: Ki,
  getDimensions: ra,
  getScale: ye,
  isElement: Q,
  isRTL: ia,
};
function Un(e, t) {
  return (
    e.x === t.x && e.y === t.y && e.width === t.width && e.height === t.height
  );
}
function ca(e, t) {
  let n = null,
    r;
  const o = J(e);
  function s() {
    var a;
    (clearTimeout(r), (a = n) == null || a.disconnect(), (n = null));
  }
  function i(a, l) {
    (a === void 0 && (a = !1), l === void 0 && (l = 1), s());
    const u = e.getBoundingClientRect(),
      { left: c, top: f, width: h, height: p } = u;
    if ((a || t(), !h || !p)) return;
    const m = We(f),
      g = We(o.clientWidth - (c + h)),
      y = We(o.clientHeight - (f + p)),
      b = We(c),
      C = {
        rootMargin: -m + "px " + -g + "px " + -y + "px " + -b + "px",
        threshold: Y(0, ae(1, l)) || 1,
      };
    let v = !0;
    function O(E) {
      const x = E[0].intersectionRatio;
      if (x !== l) {
        if (!v) return i();
        x
          ? i(!1, x)
          : (r = setTimeout(() => {
              i(!1, 1e-7);
            }, 1e3));
      }
      (x === 1 && !Un(u, e.getBoundingClientRect()) && i(), (v = !1));
    }
    try {
      n = new IntersectionObserver(O, { ...C, root: o.ownerDocument });
    } catch {
      n = new IntersectionObserver(O, C);
    }
    n.observe(e);
  }
  return (i(!0), s);
}
function la(e, t, n, r) {
  r === void 0 && (r = {});
  const {
      ancestorScroll: o = !0,
      ancestorResize: s = !0,
      elementResize: i = typeof ResizeObserver == "function",
      layoutShift: a = typeof IntersectionObserver == "function",
      animationFrame: l = !1,
    } = r,
    u = At(e),
    c = o || s ? [...(u ? Ae(u) : []), ...(t ? Ae(t) : [])] : [];
  c.forEach((b) => {
    (o && b.addEventListener("scroll", n, { passive: !0 }),
      s && b.addEventListener("resize", n));
  });
  const f = u && a ? ca(u, n) : null;
  let h = -1,
    p = null;
  i &&
    ((p = new ResizeObserver((b) => {
      let [w] = b;
      (w &&
        w.target === u &&
        p &&
        t &&
        (p.unobserve(t),
        cancelAnimationFrame(h),
        (h = requestAnimationFrame(() => {
          var C;
          (C = p) == null || C.observe(t);
        }))),
        n());
    })),
    u && !l && p.observe(u),
    t && p.observe(t));
  let m,
    g = l ? fe(e) : null;
  l && y();
  function y() {
    const b = fe(e);
    (g && !Un(g, b) && n(), (g = b), (m = requestAnimationFrame(y)));
  }
  return (
    n(),
    () => {
      var b;
      (c.forEach((w) => {
        (o && w.removeEventListener("scroll", n),
          s && w.removeEventListener("resize", n));
      }),
        f?.(),
        (b = p) == null || b.disconnect(),
        (p = null),
        l && cancelAnimationFrame(m));
    }
  );
}
const ua = $i,
  da = zi,
  fa = Ii,
  ha = Yi,
  pa = Fi,
  fn = Wi,
  ma = Hi,
  ga = (e, t, n) => {
    const r = new Map(),
      o = { platform: aa, ...n },
      s = { ...o.platform, _c: r };
    return Li(e, t, { ...o, platform: s });
  };
var ya = typeof document < "u",
  ba = function () {},
  Fe = ya ? d.useLayoutEffect : ba;
function Ge(e, t) {
  if (e === t) return !0;
  if (typeof e != typeof t) return !1;
  if (typeof e == "function" && e.toString() === t.toString()) return !0;
  let n, r, o;
  if (e && t && typeof e == "object") {
    if (Array.isArray(e)) {
      if (((n = e.length), n !== t.length)) return !1;
      for (r = n; r-- !== 0; ) if (!Ge(e[r], t[r])) return !1;
      return !0;
    }
    if (((o = Object.keys(e)), (n = o.length), n !== Object.keys(t).length))
      return !1;
    for (r = n; r-- !== 0; ) if (!{}.hasOwnProperty.call(t, o[r])) return !1;
    for (r = n; r-- !== 0; ) {
      const s = o[r];
      if (!(s === "_owner" && e.$$typeof) && !Ge(e[s], t[s])) return !1;
    }
    return !0;
  }
  return e !== e && t !== t;
}
function Gn(e) {
  return typeof window > "u"
    ? 1
    : (e.ownerDocument.defaultView || window).devicePixelRatio || 1;
}
function hn(e, t) {
  const n = Gn(e);
  return Math.round(t * n) / n;
}
function at(e) {
  const t = d.useRef(e);
  return (
    Fe(() => {
      t.current = e;
    }),
    t
  );
}
function wa(e) {
  e === void 0 && (e = {});
  const {
      placement: t = "bottom",
      strategy: n = "absolute",
      middleware: r = [],
      platform: o,
      elements: { reference: s, floating: i } = {},
      transform: a = !0,
      whileElementsMounted: l,
      open: u,
    } = e,
    [c, f] = d.useState({
      x: 0,
      y: 0,
      strategy: n,
      placement: t,
      middlewareData: {},
      isPositioned: !1,
    }),
    [h, p] = d.useState(r);
  Ge(h, r) || p(r);
  const [m, g] = d.useState(null),
    [y, b] = d.useState(null),
    w = d.useCallback((T) => {
      T !== E.current && ((E.current = T), g(T));
    }, []),
    C = d.useCallback((T) => {
      T !== x.current && ((x.current = T), b(T));
    }, []),
    v = s || m,
    O = i || y,
    E = d.useRef(null),
    x = d.useRef(null),
    M = d.useRef(c),
    D = l != null,
    A = at(l),
    I = at(o),
    P = at(u),
    N = d.useCallback(() => {
      if (!E.current || !x.current) return;
      const T = { placement: t, strategy: n, middleware: h };
      (I.current && (T.platform = I.current),
        ga(E.current, x.current, T).then((j) => {
          const H = { ...j, isPositioned: P.current !== !1 };
          _.current &&
            !Ge(M.current, H) &&
            ((M.current = H),
            gn.flushSync(() => {
              f(H);
            }));
        }));
    }, [h, t, n, I, P]);
  Fe(() => {
    u === !1 &&
      M.current.isPositioned &&
      ((M.current.isPositioned = !1), f((T) => ({ ...T, isPositioned: !1 })));
  }, [u]);
  const _ = d.useRef(!1);
  (Fe(
    () => (
      (_.current = !0),
      () => {
        _.current = !1;
      }
    ),
    [],
  ),
    Fe(() => {
      if ((v && (E.current = v), O && (x.current = O), v && O)) {
        if (A.current) return A.current(v, O, N);
        N();
      }
    }, [v, O, N, A, D]));
  const $ = d.useMemo(
      () => ({ reference: E, floating: x, setReference: w, setFloating: C }),
      [w, C],
    ),
    W = d.useMemo(() => ({ reference: v, floating: O }), [v, O]),
    F = d.useMemo(() => {
      const T = { position: n, left: 0, top: 0 };
      if (!W.floating) return T;
      const j = hn(W.floating, c.x),
        H = hn(W.floating, c.y);
      return a
        ? {
            ...T,
            transform: "translate(" + j + "px, " + H + "px)",
            ...(Gn(W.floating) >= 1.5 && { willChange: "transform" }),
          }
        : { position: n, left: j, top: H };
    }, [n, a, W.floating, c.x, c.y]);
  return d.useMemo(
    () => ({ ...c, update: N, refs: $, elements: W, floatingStyles: F }),
    [c, N, $, W, F],
  );
}
const va = (e) => {
    function t(n) {
      return {}.hasOwnProperty.call(n, "current");
    }
    return {
      name: "arrow",
      options: e,
      fn(n) {
        const { element: r, padding: o } = typeof e == "function" ? e(n) : e;
        return r && t(r)
          ? r.current != null
            ? fn({ element: r.current, padding: o }).fn(n)
            : {}
          : r
            ? fn({ element: r, padding: o }).fn(n)
            : {};
      },
    };
  },
  xa = (e, t) => {
    const n = ua(e);
    return { name: n.name, fn: n.fn, options: [e, t] };
  },
  Ca = (e, t) => {
    const n = da(e);
    return { name: n.name, fn: n.fn, options: [e, t] };
  },
  Oa = (e, t) => ({ fn: ma(e).fn, options: [e, t] }),
  Pa = (e, t) => {
    const n = fa(e);
    return { name: n.name, fn: n.fn, options: [e, t] };
  },
  Sa = (e, t) => {
    const n = ha(e);
    return { name: n.name, fn: n.fn, options: [e, t] };
  },
  Ea = (e, t) => {
    const n = pa(e);
    return { name: n.name, fn: n.fn, options: [e, t] };
  },
  Ra = (e, t) => {
    const n = va(e);
    return { name: n.name, fn: n.fn, options: [e, t] };
  };
var Ma = "Arrow",
  Qn = d.forwardRef((e, t) => {
    const { children: n, width: r = 10, height: o = 5, ...s } = e;
    return S.jsx(pe.svg, {
      ...s,
      ref: t,
      width: r,
      height: o,
      viewBox: "0 0 30 10",
      preserveAspectRatio: "none",
      children: e.asChild ? n : S.jsx("polygon", { points: "0,0 30,0 15,10" }),
    });
  });
Qn.displayName = Ma;
var Ta = Qn,
  kt = "Popper",
  [qn, Xn] = Rn(kt),
  [Aa, Kn] = qn(kt),
  Jn = (e) => {
    const { __scopePopper: t, children: n } = e,
      [r, o] = d.useState(null);
    return S.jsx(Aa, { scope: t, anchor: r, onAnchorChange: o, children: n });
  };
Jn.displayName = kt;
var Zn = "PopperAnchor",
  er = d.forwardRef((e, t) => {
    const { __scopePopper: n, virtualRef: r, ...o } = e,
      s = Kn(Zn, n),
      i = d.useRef(null),
      a = he(t, i),
      l = d.useRef(null);
    return (
      d.useEffect(() => {
        const u = l.current;
        ((l.current = r?.current || i.current),
          u !== l.current && s.onAnchorChange(l.current));
      }),
      r ? null : S.jsx(pe.div, { ...o, ref: a })
    );
  });
er.displayName = Zn;
var Dt = "PopperContent",
  [ka, Da] = qn(Dt),
  tr = d.forwardRef((e, t) => {
    const {
        __scopePopper: n,
        side: r = "bottom",
        sideOffset: o = 0,
        align: s = "center",
        alignOffset: i = 0,
        arrowPadding: a = 0,
        avoidCollisions: l = !0,
        collisionBoundary: u = [],
        collisionPadding: c = 0,
        sticky: f = "partial",
        hideWhenDetached: h = !1,
        updatePositionStrategy: p = "optimized",
        onPlaced: m,
        ...g
      } = e,
      y = Kn(Dt, n),
      [b, w] = d.useState(null),
      C = he(t, (Oe) => w(Oe)),
      [v, O] = d.useState(null),
      E = $o(v),
      x = E?.width ?? 0,
      M = E?.height ?? 0,
      D = r + (s !== "center" ? "-" + s : ""),
      A =
        typeof c == "number"
          ? c
          : { top: 0, right: 0, bottom: 0, left: 0, ...c },
      I = Array.isArray(u) ? u : [u],
      P = I.length > 0,
      N = { padding: A, boundary: I.filter(_a), altBoundary: P },
      {
        refs: _,
        floatingStyles: $,
        placement: W,
        isPositioned: F,
        middlewareData: T,
      } = wa({
        strategy: "fixed",
        placement: D,
        whileElementsMounted: (...Oe) =>
          la(...Oe, { animationFrame: p === "always" }),
        elements: { reference: y.anchor },
        middleware: [
          xa({ mainAxis: o + M, alignmentAxis: i }),
          l &&
            Ca({
              mainAxis: !0,
              crossAxis: !1,
              limiter: f === "partial" ? Oa() : void 0,
              ...N,
            }),
          l && Pa({ ...N }),
          Sa({
            ...N,
            apply: ({
              elements: Oe,
              rects: _t,
              availableWidth: xr,
              availableHeight: Cr,
            }) => {
              const { width: Or, height: Pr } = _t.reference,
                _e = Oe.floating.style;
              (_e.setProperty("--radix-popper-available-width", `${xr}px`),
                _e.setProperty("--radix-popper-available-height", `${Cr}px`),
                _e.setProperty("--radix-popper-anchor-width", `${Or}px`),
                _e.setProperty("--radix-popper-anchor-height", `${Pr}px`));
            },
          }),
          v && Ra({ element: v, padding: a }),
          La({ arrowWidth: x, arrowHeight: M }),
          h && Ea({ strategy: "referenceHidden", ...N }),
        ],
      }),
      [j, H] = or(W),
      U = qe(m);
    de(() => {
      F && U?.();
    }, [F, U]);
    const gr = T.arrow?.x,
      yr = T.arrow?.y,
      br = T.arrow?.centerOffset !== 0,
      [wr, vr] = d.useState();
    return (
      de(() => {
        b && vr(window.getComputedStyle(b).zIndex);
      }, [b]),
      S.jsx("div", {
        ref: _.setFloating,
        "data-radix-popper-content-wrapper": "",
        style: {
          ...$,
          transform: F ? $.transform : "translate(0, -200%)",
          minWidth: "max-content",
          zIndex: wr,
          "--radix-popper-transform-origin": [
            T.transformOrigin?.x,
            T.transformOrigin?.y,
          ].join(" "),
          ...(T.hide?.referenceHidden && {
            visibility: "hidden",
            pointerEvents: "none",
          }),
        },
        dir: e.dir,
        children: S.jsx(ka, {
          scope: n,
          placedSide: j,
          onArrowChange: O,
          arrowX: gr,
          arrowY: yr,
          shouldHideArrow: br,
          children: S.jsx(pe.div, {
            "data-side": j,
            "data-align": H,
            ...g,
            ref: C,
            style: { ...g.style, animation: F ? void 0 : "none" },
          }),
        }),
      })
    );
  });
tr.displayName = Dt;
var nr = "PopperArrow",
  Na = { top: "bottom", right: "left", bottom: "top", left: "right" },
  rr = d.forwardRef(function (t, n) {
    const { __scopePopper: r, ...o } = t,
      s = Da(nr, r),
      i = Na[s.placedSide];
    return S.jsx("span", {
      ref: s.onArrowChange,
      style: {
        position: "absolute",
        left: s.arrowX,
        top: s.arrowY,
        [i]: 0,
        transformOrigin: {
          top: "",
          right: "0 0",
          bottom: "center 0",
          left: "100% 0",
        }[s.placedSide],
        transform: {
          top: "translateY(100%)",
          right: "translateY(50%) rotate(90deg) translateX(-50%)",
          bottom: "rotate(180deg)",
          left: "translateY(50%) rotate(-90deg) translateX(50%)",
        }[s.placedSide],
        visibility: s.shouldHideArrow ? "hidden" : void 0,
      },
      children: S.jsx(Ta, {
        ...o,
        ref: n,
        style: { ...o.style, display: "block" },
      }),
    });
  });
rr.displayName = nr;
function _a(e) {
  return e !== null;
}
var La = (e) => ({
  name: "transformOrigin",
  options: e,
  fn(t) {
    const { placement: n, rects: r, middlewareData: o } = t,
      i = o.arrow?.centerOffset !== 0,
      a = i ? 0 : e.arrowWidth,
      l = i ? 0 : e.arrowHeight,
      [u, c] = or(n),
      f = { start: "0%", center: "50%", end: "100%" }[c],
      h = (o.arrow?.x ?? 0) + a / 2,
      p = (o.arrow?.y ?? 0) + l / 2;
    let m = "",
      g = "";
    return (
      u === "bottom"
        ? ((m = i ? f : `${h}px`), (g = `${-l}px`))
        : u === "top"
          ? ((m = i ? f : `${h}px`), (g = `${r.floating.height + l}px`))
          : u === "right"
            ? ((m = `${-l}px`), (g = i ? f : `${p}px`))
            : u === "left" &&
              ((m = `${r.floating.width + l}px`), (g = i ? f : `${p}px`)),
      { data: { x: m, y: g } }
    );
  },
});
function or(e) {
  const [t, n = "center"] = e.split("-");
  return [t, n];
}
var Wa = Jn,
  Ia = er,
  Fa = tr,
  ja = rr;
function $a(e, t) {
  return d.useReducer((n, r) => t[n][r] ?? n, e);
}
var sr = (e) => {
  const { present: t, children: n } = e,
    r = za(t),
    o =
      typeof n == "function" ? n({ present: r.isPresent }) : d.Children.only(n),
    s = he(r.ref, Ha(o));
  return typeof n == "function" || r.isPresent
    ? d.cloneElement(o, { ref: s })
    : null;
};
sr.displayName = "Presence";
function za(e) {
  const [t, n] = d.useState(),
    r = d.useRef(null),
    o = d.useRef(e),
    s = d.useRef("none"),
    i = e ? "mounted" : "unmounted",
    [a, l] = $a(i, {
      mounted: { UNMOUNT: "unmounted", ANIMATION_OUT: "unmountSuspended" },
      unmountSuspended: { MOUNT: "mounted", ANIMATION_END: "unmounted" },
      unmounted: { MOUNT: "mounted" },
    });
  return (
    d.useEffect(() => {
      const u = Ie(r.current);
      s.current = a === "mounted" ? u : "none";
    }, [a]),
    de(() => {
      const u = r.current,
        c = o.current;
      if (c !== e) {
        const h = s.current,
          p = Ie(u);
        (e
          ? l("MOUNT")
          : p === "none" || u?.display === "none"
            ? l("UNMOUNT")
            : l(c && h !== p ? "ANIMATION_OUT" : "UNMOUNT"),
          (o.current = e));
      }
    }, [e, l]),
    de(() => {
      if (t) {
        let u;
        const c = t.ownerDocument.defaultView ?? window,
          f = (p) => {
            const g = Ie(r.current).includes(CSS.escape(p.animationName));
            if (p.target === t && g && (l("ANIMATION_END"), !o.current)) {
              const y = t.style.animationFillMode;
              ((t.style.animationFillMode = "forwards"),
                (u = c.setTimeout(() => {
                  t.style.animationFillMode === "forwards" &&
                    (t.style.animationFillMode = y);
                })));
            }
          },
          h = (p) => {
            p.target === t && (s.current = Ie(r.current));
          };
        return (
          t.addEventListener("animationstart", h),
          t.addEventListener("animationcancel", f),
          t.addEventListener("animationend", f),
          () => {
            (c.clearTimeout(u),
              t.removeEventListener("animationstart", h),
              t.removeEventListener("animationcancel", f),
              t.removeEventListener("animationend", f));
          }
        );
      } else l("ANIMATION_END");
    }, [t, l]),
    {
      isPresent: ["mounted", "unmountSuspended"].includes(a),
      ref: d.useCallback((u) => {
        ((r.current = u ? getComputedStyle(u) : null), n(u));
      }, []),
    }
  );
}
function Ie(e) {
  return e?.animationName || "none";
}
function Ha(e) {
  let t = Object.getOwnPropertyDescriptor(e.props, "ref")?.get,
    n = t && "isReactWarning" in t && t.isReactWarning;
  return n
    ? e.ref
    : ((t = Object.getOwnPropertyDescriptor(e, "ref")?.get),
      (n = t && "isReactWarning" in t && t.isReactWarning),
      n ? e.props.ref : e.props.ref || e.ref);
}
var Ya = Object.freeze({
    position: "absolute",
    border: 0,
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    wordWrap: "normal",
  }),
  Ba = "VisuallyHidden",
  ir = d.forwardRef((e, t) =>
    S.jsx(pe.span, { ...e, ref: t, style: { ...Ya, ...e.style } }),
  );
ir.displayName = Ba;
var Va = ir,
  [et] = Rn("Tooltip", [Xn]),
  tt = Xn(),
  ar = "TooltipProvider",
  Ua = 700,
  mt = "tooltip.open",
  [Ga, Nt] = et(ar),
  cr = (e) => {
    const {
        __scopeTooltip: t,
        delayDuration: n = Ua,
        skipDelayDuration: r = 300,
        disableHoverableContent: o = !1,
        children: s,
      } = e,
      i = d.useRef(!0),
      a = d.useRef(!1),
      l = d.useRef(0);
    return (
      d.useEffect(() => {
        const u = l.current;
        return () => window.clearTimeout(u);
      }, []),
      S.jsx(Ga, {
        scope: t,
        isOpenDelayedRef: i,
        delayDuration: n,
        onOpen: d.useCallback(() => {
          (window.clearTimeout(l.current), (i.current = !1));
        }, []),
        onClose: d.useCallback(() => {
          (window.clearTimeout(l.current),
            (l.current = window.setTimeout(() => (i.current = !0), r)));
        }, [r]),
        isPointerInTransitRef: a,
        onPointerInTransitChange: d.useCallback((u) => {
          a.current = u;
        }, []),
        disableHoverableContent: o,
        children: s,
      })
    );
  };
cr.displayName = ar;
var ke = "Tooltip",
  [Qa, nt] = et(ke),
  lr = (e) => {
    const {
        __scopeTooltip: t,
        children: n,
        open: r,
        defaultOpen: o,
        onOpenChange: s,
        disableHoverableContent: i,
        delayDuration: a,
      } = e,
      l = Nt(ke, e.__scopeTooltip),
      u = tt(t),
      [c, f] = d.useState(null),
      h = Oi(),
      p = d.useRef(0),
      m = i ?? l.disableHoverableContent,
      g = a ?? l.delayDuration,
      y = d.useRef(!1),
      [b, w] = Io({
        prop: r,
        defaultProp: o ?? !1,
        onChange: (x) => {
          (x
            ? (l.onOpen(), document.dispatchEvent(new CustomEvent(mt)))
            : l.onClose(),
            s?.(x));
        },
        caller: ke,
      }),
      C = d.useMemo(
        () => (b ? (y.current ? "delayed-open" : "instant-open") : "closed"),
        [b],
      ),
      v = d.useCallback(() => {
        (window.clearTimeout(p.current),
          (p.current = 0),
          (y.current = !1),
          w(!0));
      }, [w]),
      O = d.useCallback(() => {
        (window.clearTimeout(p.current), (p.current = 0), w(!1));
      }, [w]),
      E = d.useCallback(() => {
        (window.clearTimeout(p.current),
          (p.current = window.setTimeout(() => {
            ((y.current = !0), w(!0), (p.current = 0));
          }, g)));
      }, [g, w]);
    return (
      d.useEffect(
        () => () => {
          p.current && (window.clearTimeout(p.current), (p.current = 0));
        },
        [],
      ),
      S.jsx(Wa, {
        ...u,
        children: S.jsx(Qa, {
          scope: t,
          contentId: h,
          open: b,
          stateAttribute: C,
          trigger: c,
          onTriggerChange: f,
          onTriggerEnter: d.useCallback(() => {
            l.isOpenDelayedRef.current ? E() : v();
          }, [l.isOpenDelayedRef, E, v]),
          onTriggerLeave: d.useCallback(() => {
            m ? O() : (window.clearTimeout(p.current), (p.current = 0));
          }, [O, m]),
          onOpen: v,
          onClose: O,
          disableHoverableContent: m,
          children: n,
        }),
      })
    );
  };
lr.displayName = ke;
var gt = "TooltipTrigger",
  ur = d.forwardRef((e, t) => {
    const { __scopeTooltip: n, ...r } = e,
      o = nt(gt, n),
      s = Nt(gt, n),
      i = tt(n),
      a = d.useRef(null),
      l = he(t, a, o.onTriggerChange),
      u = d.useRef(!1),
      c = d.useRef(!1),
      f = d.useCallback(() => (u.current = !1), []);
    return (
      d.useEffect(
        () => () => document.removeEventListener("pointerup", f),
        [f],
      ),
      S.jsx(Ia, {
        asChild: !0,
        ...i,
        children: S.jsx(pe.button, {
          "aria-describedby": o.open ? o.contentId : void 0,
          "data-state": o.stateAttribute,
          ...r,
          ref: l,
          onPointerMove: ee(e.onPointerMove, (h) => {
            h.pointerType !== "touch" &&
              !c.current &&
              !s.isPointerInTransitRef.current &&
              (o.onTriggerEnter(), (c.current = !0));
          }),
          onPointerLeave: ee(e.onPointerLeave, () => {
            (o.onTriggerLeave(), (c.current = !1));
          }),
          onPointerDown: ee(e.onPointerDown, () => {
            (o.open && o.onClose(),
              (u.current = !0),
              document.addEventListener("pointerup", f, { once: !0 }));
          }),
          onFocus: ee(e.onFocus, () => {
            u.current || o.onOpen();
          }),
          onBlur: ee(e.onBlur, o.onClose),
          onClick: ee(e.onClick, o.onClose),
        }),
      })
    );
  });
ur.displayName = gt;
var qa = "TooltipPortal",
  [Ac, Xa] = et(qa, { forceMount: void 0 }),
  we = "TooltipContent",
  dr = d.forwardRef((e, t) => {
    const n = Xa(we, e.__scopeTooltip),
      { forceMount: r = n.forceMount, side: o = "top", ...s } = e,
      i = nt(we, e.__scopeTooltip);
    return S.jsx(sr, {
      present: r || i.open,
      children: i.disableHoverableContent
        ? S.jsx(fr, { side: o, ...s, ref: t })
        : S.jsx(Ka, { side: o, ...s, ref: t }),
    });
  }),
  Ka = d.forwardRef((e, t) => {
    const n = nt(we, e.__scopeTooltip),
      r = Nt(we, e.__scopeTooltip),
      o = d.useRef(null),
      s = he(t, o),
      [i, a] = d.useState(null),
      { trigger: l, onClose: u } = n,
      c = o.current,
      { onPointerInTransitChange: f } = r,
      h = d.useCallback(() => {
        (a(null), f(!1));
      }, [f]),
      p = d.useCallback(
        (m, g) => {
          const y = m.currentTarget,
            b = { x: m.clientX, y: m.clientY },
            w = nc(b, y.getBoundingClientRect()),
            C = rc(b, w),
            v = oc(g.getBoundingClientRect()),
            O = ic([...C, ...v]);
          (a(O), f(!0));
        },
        [f],
      );
    return (
      d.useEffect(() => () => h(), [h]),
      d.useEffect(() => {
        if (l && c) {
          const m = (y) => p(y, c),
            g = (y) => p(y, l);
          return (
            l.addEventListener("pointerleave", m),
            c.addEventListener("pointerleave", g),
            () => {
              (l.removeEventListener("pointerleave", m),
                c.removeEventListener("pointerleave", g));
            }
          );
        }
      }, [l, c, p, h]),
      d.useEffect(() => {
        if (i) {
          const m = (g) => {
            const y = g.target,
              b = { x: g.clientX, y: g.clientY },
              w = l?.contains(y) || c?.contains(y),
              C = !sc(b, i);
            w ? h() : C && (h(), u());
          };
          return (
            document.addEventListener("pointermove", m),
            () => document.removeEventListener("pointermove", m)
          );
        }
      }, [l, c, i, u, h]),
      S.jsx(fr, { ...e, ref: s })
    );
  }),
  [Ja, Za] = et(ke, { isInside: !1 }),
  ec = Yo("TooltipContent"),
  fr = d.forwardRef((e, t) => {
    const {
        __scopeTooltip: n,
        children: r,
        "aria-label": o,
        onEscapeKeyDown: s,
        onPointerDownOutside: i,
        ...a
      } = e,
      l = nt(we, n),
      u = tt(n),
      { onClose: c } = l;
    return (
      d.useEffect(
        () => (
          document.addEventListener(mt, c),
          () => document.removeEventListener(mt, c)
        ),
        [c],
      ),
      d.useEffect(() => {
        if (l.trigger) {
          const f = (h) => {
            h.target?.contains(l.trigger) && c();
          };
          return (
            window.addEventListener("scroll", f, { capture: !0 }),
            () => window.removeEventListener("scroll", f, { capture: !0 })
          );
        }
      }, [l.trigger, c]),
      S.jsx(Ln, {
        asChild: !0,
        disableOutsidePointerEvents: !1,
        onEscapeKeyDown: s,
        onPointerDownOutside: i,
        onFocusOutside: (f) => f.preventDefault(),
        onDismiss: c,
        children: S.jsxs(Fa, {
          "data-state": l.stateAttribute,
          ...u,
          ...a,
          ref: t,
          style: {
            ...a.style,
            "--radix-tooltip-content-transform-origin":
              "var(--radix-popper-transform-origin)",
            "--radix-tooltip-content-available-width":
              "var(--radix-popper-available-width)",
            "--radix-tooltip-content-available-height":
              "var(--radix-popper-available-height)",
            "--radix-tooltip-trigger-width": "var(--radix-popper-anchor-width)",
            "--radix-tooltip-trigger-height":
              "var(--radix-popper-anchor-height)",
          },
          children: [
            S.jsx(ec, { children: r }),
            S.jsx(Ja, {
              scope: n,
              isInside: !0,
              children: S.jsx(Va, {
                id: l.contentId,
                role: "tooltip",
                children: o || r,
              }),
            }),
          ],
        }),
      })
    );
  });
dr.displayName = we;
var hr = "TooltipArrow",
  tc = d.forwardRef((e, t) => {
    const { __scopeTooltip: n, ...r } = e,
      o = tt(n);
    return Za(hr, n).isInside ? null : S.jsx(ja, { ...o, ...r, ref: t });
  });
tc.displayName = hr;
function nc(e, t) {
  const n = Math.abs(t.top - e.y),
    r = Math.abs(t.bottom - e.y),
    o = Math.abs(t.right - e.x),
    s = Math.abs(t.left - e.x);
  switch (Math.min(n, r, o, s)) {
    case s:
      return "left";
    case o:
      return "right";
    case n:
      return "top";
    case r:
      return "bottom";
    default:
      throw new Error("unreachable");
  }
}
function rc(e, t, n = 5) {
  const r = [];
  switch (t) {
    case "top":
      r.push({ x: e.x - n, y: e.y + n }, { x: e.x + n, y: e.y + n });
      break;
    case "bottom":
      r.push({ x: e.x - n, y: e.y - n }, { x: e.x + n, y: e.y - n });
      break;
    case "left":
      r.push({ x: e.x + n, y: e.y - n }, { x: e.x + n, y: e.y + n });
      break;
    case "right":
      r.push({ x: e.x - n, y: e.y - n }, { x: e.x - n, y: e.y + n });
      break;
  }
  return r;
}
function oc(e) {
  const { top: t, right: n, bottom: r, left: o } = e;
  return [
    { x: o, y: t },
    { x: n, y: t },
    { x: n, y: r },
    { x: o, y: r },
  ];
}
function sc(e, t) {
  const { x: n, y: r } = e;
  let o = !1;
  for (let s = 0, i = t.length - 1; s < t.length; i = s++) {
    const a = t[s],
      l = t[i],
      u = a.x,
      c = a.y,
      f = l.x,
      h = l.y;
    c > r != h > r && n < ((f - u) * (r - c)) / (h - c) + u && (o = !o);
  }
  return o;
}
function ic(e) {
  const t = e.slice();
  return (
    t.sort((n, r) =>
      n.x < r.x ? -1 : n.x > r.x ? 1 : n.y < r.y ? -1 : n.y > r.y ? 1 : 0,
    ),
    ac(t)
  );
}
function ac(e) {
  if (e.length <= 1) return e.slice();
  const t = [];
  for (let r = 0; r < e.length; r++) {
    const o = e[r];
    for (; t.length >= 2; ) {
      const s = t[t.length - 1],
        i = t[t.length - 2];
      if ((s.x - i.x) * (o.y - i.y) >= (s.y - i.y) * (o.x - i.x)) t.pop();
      else break;
    }
    t.push(o);
  }
  t.pop();
  const n = [];
  for (let r = e.length - 1; r >= 0; r--) {
    const o = e[r];
    for (; n.length >= 2; ) {
      const s = n[n.length - 1],
        i = n[n.length - 2];
      if ((s.x - i.x) * (o.y - i.y) >= (s.y - i.y) * (o.x - i.x)) n.pop();
      else break;
    }
    n.push(o);
  }
  return (
    n.pop(),
    t.length === 1 && n.length === 1 && t[0].x === n[0].x && t[0].y === n[0].y
      ? t
      : t.concat(n)
  );
}
var cc = cr,
  lc = lr,
  uc = ur,
  pr = dr;
const kc = cc,
  dc = lc,
  fc = uc,
  mr = d.forwardRef(({ className: e, sideOffset: t = 4, ...n }, r) =>
    S.jsx(pr, {
      ref: r,
      sideOffset: t,
      className: xt(
        "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        e,
      ),
      ...n,
    }),
  );
mr.displayName = pr.displayName;
function Dc({ className: e }) {
  const { theme: t, setTheme: n } = Tr();
  return S.jsxs(dc, {
    children: [
      S.jsx(fc, {
        asChild: !0,
        children: S.jsx(En, {
          variant: "ghost",
          size: "icon",
          onClick: () => n(t === "dark" ? "light" : "dark"),
          className: xt("text-muted-foreground", e),
          children:
            t === "dark"
              ? S.jsx(os, { className: "h-4 w-4" })
              : S.jsx(ns, { className: "h-4 w-4" }),
        }),
      }),
      S.jsx(mr, { children: "Toggle theme" }),
    ],
  });
}
export {
  Fa as $,
  Cc as A,
  En as B,
  Tc as C,
  is as D,
  Rc as E,
  ds as F,
  Mc as G,
  bc as H,
  De as I,
  xc as J,
  Dn as K,
  He as L,
  Ks as M,
  qs as N,
  qt as O,
  pe as P,
  Gs as Q,
  Zs as R,
  oi as S,
  Dc as T,
  si as U,
  ri as V,
  de as W,
  Ct as X,
  Xn as Y,
  Ia as Z,
  Ln as _,
  gc as a,
  Qo as a0,
  Wa as a1,
  ja as a2,
  yc as a3,
  hs as a4,
  kc as a5,
  dc as a6,
  fc as a7,
  mr as a8,
  Ot as b,
  xt as c,
  V as d,
  wc as e,
  Rn as f,
  he as g,
  zo as h,
  Oi as i,
  ee as j,
  Io as k,
  qe as l,
  vc as m,
  Pt as n,
  $o as o,
  Eo as p,
  No as q,
  sr as r,
  Ec as s,
  z as t,
  mc as u,
  Pc as v,
  Oc as w,
  Te as x,
  Sc as y,
  Ye as z,
};
