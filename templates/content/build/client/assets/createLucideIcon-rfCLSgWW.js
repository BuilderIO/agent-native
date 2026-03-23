import {
  a as h,
  q as T,
  e as Gt,
  C as qt,
  z as ar,
  R as ce,
} from "./index-BMHtNQid.js";
var Kt = class {
    constructor() {
      ((this.listeners = new Set()),
        (this.subscribe = this.subscribe.bind(this)));
    }
    subscribe(e) {
      return (
        this.listeners.add(e),
        this.onSubscribe(),
        () => {
          (this.listeners.delete(e), this.onUnsubscribe());
        }
      );
    }
    hasListeners() {
      return this.listeners.size > 0;
    }
    onSubscribe() {}
    onUnsubscribe() {}
  },
  cr = {
    setTimeout: (e, t) => setTimeout(e, t),
    clearTimeout: (e) => clearTimeout(e),
    setInterval: (e, t) => setInterval(e, t),
    clearInterval: (e) => clearInterval(e),
  },
  lr = class {
    #t = cr;
    #n = !1;
    setTimeoutProvider(e) {
      this.#t = e;
    }
    setTimeout(e, t) {
      return this.#t.setTimeout(e, t);
    }
    clearTimeout(e) {
      this.#t.clearTimeout(e);
    }
    setInterval(e, t) {
      return this.#t.setInterval(e, t);
    }
    clearInterval(e) {
      this.#t.clearInterval(e);
    }
  },
  Ge = new lr();
function ur(e) {
  setTimeout(e, 0);
}
var ke = typeof window > "u" || "Deno" in globalThis;
function bt() {}
function _i(e, t) {
  return typeof e == "function" ? e(t) : e;
}
function dr(e) {
  return typeof e == "number" && e >= 0 && e !== 1 / 0;
}
function fr(e, t) {
  return Math.max(e + (t || 0) - Date.now(), 0);
}
function hr(e, t) {
  return typeof e == "function" ? e(t) : e;
}
function pr(e, t) {
  return typeof e == "function" ? e(t) : e;
}
function $i(e, t) {
  const {
    type: n = "all",
    exact: r,
    fetchStatus: o,
    predicate: s,
    queryKey: a,
    stale: i,
  } = e;
  if (a) {
    if (r) {
      if (t.queryHash !== mr(a, t.options)) return !1;
    } else if (!rt(t.queryKey, a)) return !1;
  }
  if (n !== "all") {
    const c = t.isActive();
    if ((n === "active" && !c) || (n === "inactive" && c)) return !1;
  }
  return !(
    (typeof i == "boolean" && t.isStale() !== i) ||
    (o && o !== t.state.fetchStatus) ||
    (s && !s(t))
  );
}
function zi(e, t) {
  const { exact: n, status: r, predicate: o, mutationKey: s } = e;
  if (s) {
    if (!t.options.mutationKey) return !1;
    if (n) {
      if (qe(t.options.mutationKey) !== qe(s)) return !1;
    } else if (!rt(t.options.mutationKey, s)) return !1;
  }
  return !((r && t.state.status !== r) || (o && !o(t)));
}
function mr(e, t) {
  return (t?.queryKeyHashFn || qe)(e);
}
function qe(e) {
  return JSON.stringify(e, (t, n) =>
    Ke(n)
      ? Object.keys(n)
          .sort()
          .reduce((r, o) => ((r[o] = n[o]), r), {})
      : n,
  );
}
function rt(e, t) {
  return e === t
    ? !0
    : typeof e != typeof t
      ? !1
      : e && t && typeof e == "object" && typeof t == "object"
        ? Object.keys(t).every((n) => rt(e[n], t[n]))
        : !1;
}
var gr = Object.prototype.hasOwnProperty;
function Yt(e, t, n = 0) {
  if (e === t) return e;
  if (n > 500) return t;
  const r = wt(e) && wt(t);
  if (!r && !(Ke(e) && Ke(t))) return t;
  const s = (r ? e : Object.keys(e)).length,
    a = r ? t : Object.keys(t),
    i = a.length,
    c = r ? new Array(i) : {};
  let l = 0;
  for (let u = 0; u < i; u++) {
    const d = r ? u : a[u],
      p = e[d],
      f = t[d];
    if (p === f) {
      ((c[d] = p), (r ? u < s : gr.call(e, d)) && l++);
      continue;
    }
    if (
      p === null ||
      f === null ||
      typeof p != "object" ||
      typeof f != "object"
    ) {
      c[d] = f;
      continue;
    }
    const g = Yt(p, f, n + 1);
    ((c[d] = g), g === p && l++);
  }
  return s === i && l === s ? e : c;
}
function Wi(e, t) {
  if (!t || Object.keys(e).length !== Object.keys(t).length) return !1;
  for (const n in e) if (e[n] !== t[n]) return !1;
  return !0;
}
function wt(e) {
  return Array.isArray(e) && e.length === Object.keys(e).length;
}
function Ke(e) {
  if (!xt(e)) return !1;
  const t = e.constructor;
  if (t === void 0) return !0;
  const n = t.prototype;
  return !(
    !xt(n) ||
    !n.hasOwnProperty("isPrototypeOf") ||
    Object.getPrototypeOf(e) !== Object.prototype
  );
}
function xt(e) {
  return Object.prototype.toString.call(e) === "[object Object]";
}
function yr(e) {
  return new Promise((t) => {
    Ge.setTimeout(t, e);
  });
}
function vr(e, t, n) {
  return typeof n.structuralSharing == "function"
    ? n.structuralSharing(e, t)
    : n.structuralSharing !== !1
      ? Yt(e, t)
      : t;
}
function Hi(e, t, n = 0) {
  const r = [...e, t];
  return n && r.length > n ? r.slice(1) : r;
}
function Bi(e, t, n = 0) {
  const r = [t, ...e];
  return n && r.length > n ? r.slice(0, -1) : r;
}
var Xt = Symbol();
function br(e, t) {
  return !e.queryFn && t?.initialPromise
    ? () => t.initialPromise
    : !e.queryFn || e.queryFn === Xt
      ? () => Promise.reject(new Error(`Missing queryFn: '${e.queryHash}'`))
      : e.queryFn;
}
function Ui(e, t) {
  return typeof e == "function" ? e(...t) : !!e;
}
function Vi(e, t, n) {
  let r = !1,
    o;
  return (
    Object.defineProperty(e, "signal", {
      enumerable: !0,
      get: () => (
        (o ??= t()),
        r ||
          ((r = !0),
          o.aborted ? n() : o.addEventListener("abort", n, { once: !0 })),
        o
      ),
    }),
    e
  );
}
var wr = class extends Kt {
    #t;
    #n;
    #e;
    constructor() {
      (super(),
        (this.#e = (e) => {
          if (!ke && window.addEventListener) {
            const t = () => e();
            return (
              window.addEventListener("visibilitychange", t, !1),
              () => {
                window.removeEventListener("visibilitychange", t);
              }
            );
          }
        }));
    }
    onSubscribe() {
      this.#n || this.setEventListener(this.#e);
    }
    onUnsubscribe() {
      this.hasListeners() || (this.#n?.(), (this.#n = void 0));
    }
    setEventListener(e) {
      ((this.#e = e),
        this.#n?.(),
        (this.#n = e((t) => {
          typeof t == "boolean" ? this.setFocused(t) : this.onFocus();
        })));
    }
    setFocused(e) {
      this.#t !== e && ((this.#t = e), this.onFocus());
    }
    onFocus() {
      const e = this.isFocused();
      this.listeners.forEach((t) => {
        t(e);
      });
    }
    isFocused() {
      return typeof this.#t == "boolean"
        ? this.#t
        : globalThis.document?.visibilityState !== "hidden";
    }
  },
  xr = new wr();
function Cr() {
  let e, t;
  const n = new Promise((o, s) => {
    ((e = o), (t = s));
  });
  ((n.status = "pending"), n.catch(() => {}));
  function r(o) {
    (Object.assign(n, o), delete n.resolve, delete n.reject);
  }
  return (
    (n.resolve = (o) => {
      (r({ status: "fulfilled", value: o }), e(o));
    }),
    (n.reject = (o) => {
      (r({ status: "rejected", reason: o }), t(o));
    }),
    n
  );
}
var Rr = ur;
function Sr() {
  let e = [],
    t = 0,
    n = (i) => {
      i();
    },
    r = (i) => {
      i();
    },
    o = Rr;
  const s = (i) => {
      t
        ? e.push(i)
        : o(() => {
            n(i);
          });
    },
    a = () => {
      const i = e;
      ((e = []),
        i.length &&
          o(() => {
            r(() => {
              i.forEach((c) => {
                n(c);
              });
            });
          }));
    };
  return {
    batch: (i) => {
      let c;
      t++;
      try {
        c = i();
      } finally {
        (t--, t || a());
      }
      return c;
    },
    batchCalls:
      (i) =>
      (...c) => {
        s(() => {
          i(...c);
        });
      },
    schedule: s,
    setNotifyFunction: (i) => {
      n = i;
    },
    setBatchNotifyFunction: (i) => {
      r = i;
    },
    setScheduler: (i) => {
      o = i;
    },
  };
}
var Qt = Sr(),
  Er = class extends Kt {
    #t = !0;
    #n;
    #e;
    constructor() {
      (super(),
        (this.#e = (e) => {
          if (!ke && window.addEventListener) {
            const t = () => e(!0),
              n = () => e(!1);
            return (
              window.addEventListener("online", t, !1),
              window.addEventListener("offline", n, !1),
              () => {
                (window.removeEventListener("online", t),
                  window.removeEventListener("offline", n));
              }
            );
          }
        }));
    }
    onSubscribe() {
      this.#n || this.setEventListener(this.#e);
    }
    onUnsubscribe() {
      this.hasListeners() || (this.#n?.(), (this.#n = void 0));
    }
    setEventListener(e) {
      ((this.#e = e), this.#n?.(), (this.#n = e(this.setOnline.bind(this))));
    }
    setOnline(e) {
      this.#t !== e &&
        ((this.#t = e),
        this.listeners.forEach((n) => {
          n(e);
        }));
    }
    isOnline() {
      return this.#t;
    }
  },
  Zt = new Er();
function Pr(e) {
  return Math.min(1e3 * 2 ** e, 3e4);
}
function Jt(e) {
  return (e ?? "online") === "online" ? Zt.isOnline() : !0;
}
var Ye = class extends Error {
  constructor(e) {
    (super("CancelledError"),
      (this.revert = e?.revert),
      (this.silent = e?.silent));
  }
};
function en(e) {
  let t = !1,
    n = 0,
    r;
  const o = Cr(),
    s = () => o.status !== "pending",
    a = (m) => {
      if (!s()) {
        const y = new Ye(m);
        (p(y), e.onCancel?.(y));
      }
    },
    i = () => {
      t = !0;
    },
    c = () => {
      t = !1;
    },
    l = () =>
      xr.isFocused() &&
      (e.networkMode === "always" || Zt.isOnline()) &&
      e.canRun(),
    u = () => Jt(e.networkMode) && e.canRun(),
    d = (m) => {
      s() || (r?.(), o.resolve(m));
    },
    p = (m) => {
      s() || (r?.(), o.reject(m));
    },
    f = () =>
      new Promise((m) => {
        ((r = (y) => {
          (s() || l()) && m(y);
        }),
          e.onPause?.());
      }).then(() => {
        ((r = void 0), s() || e.onContinue?.());
      }),
    g = () => {
      if (s()) return;
      let m;
      const y = n === 0 ? e.initialPromise : void 0;
      try {
        m = y ?? e.fn();
      } catch (v) {
        m = Promise.reject(v);
      }
      Promise.resolve(m)
        .then(d)
        .catch((v) => {
          if (s()) return;
          const b = e.retry ?? (ke ? 0 : 3),
            w = e.retryDelay ?? Pr,
            x = typeof w == "function" ? w(n, v) : w,
            C =
              b === !0 ||
              (typeof b == "number" && n < b) ||
              (typeof b == "function" && b(n, v));
          if (t || !C) {
            p(v);
            return;
          }
          (n++,
            e.onFail?.(n, v),
            yr(x)
              .then(() => (l() ? void 0 : f()))
              .then(() => {
                t ? p(v) : g();
              }));
        });
    };
  return {
    promise: o,
    status: () => o.status,
    cancel: a,
    continue: () => (r?.(), o),
    cancelRetry: i,
    continueRetry: c,
    canStart: u,
    start: () => (u() ? g() : f().then(g), o),
  };
}
var tn = class {
    #t;
    destroy() {
      this.clearGcTimeout();
    }
    scheduleGc() {
      (this.clearGcTimeout(),
        dr(this.gcTime) &&
          (this.#t = Ge.setTimeout(() => {
            this.optionalRemove();
          }, this.gcTime)));
    }
    updateGcTime(e) {
      this.gcTime = Math.max(this.gcTime || 0, e ?? (ke ? 1 / 0 : 300 * 1e3));
    }
    clearGcTimeout() {
      this.#t && (Ge.clearTimeout(this.#t), (this.#t = void 0));
    }
  },
  Gi = class extends tn {
    #t;
    #n;
    #e;
    #o;
    #r;
    #a;
    #i;
    constructor(e) {
      (super(),
        (this.#i = !1),
        (this.#a = e.defaultOptions),
        this.setOptions(e.options),
        (this.observers = []),
        (this.#o = e.client),
        (this.#e = this.#o.getQueryCache()),
        (this.queryKey = e.queryKey),
        (this.queryHash = e.queryHash),
        (this.#t = Rt(this.options)),
        (this.state = e.state ?? this.#t),
        this.scheduleGc());
    }
    get meta() {
      return this.options.meta;
    }
    get promise() {
      return this.#r?.promise;
    }
    setOptions(e) {
      if (
        ((this.options = { ...this.#a, ...e }),
        this.updateGcTime(this.options.gcTime),
        this.state && this.state.data === void 0)
      ) {
        const t = Rt(this.options);
        t.data !== void 0 &&
          (this.setState(Ct(t.data, t.dataUpdatedAt)), (this.#t = t));
      }
    }
    optionalRemove() {
      !this.observers.length &&
        this.state.fetchStatus === "idle" &&
        this.#e.remove(this);
    }
    setData(e, t) {
      const n = vr(this.state.data, e, this.options);
      return (
        this.#s({
          data: n,
          type: "success",
          dataUpdatedAt: t?.updatedAt,
          manual: t?.manual,
        }),
        n
      );
    }
    setState(e, t) {
      this.#s({ type: "setState", state: e, setStateOptions: t });
    }
    cancel(e) {
      const t = this.#r?.promise;
      return (this.#r?.cancel(e), t ? t.then(bt).catch(bt) : Promise.resolve());
    }
    destroy() {
      (super.destroy(), this.cancel({ silent: !0 }));
    }
    reset() {
      (this.destroy(), this.setState(this.#t));
    }
    isActive() {
      return this.observers.some((e) => pr(e.options.enabled, this) !== !1);
    }
    isDisabled() {
      return this.getObserversCount() > 0
        ? !this.isActive()
        : this.options.queryFn === Xt ||
            this.state.dataUpdateCount + this.state.errorUpdateCount === 0;
    }
    isStatic() {
      return this.getObserversCount() > 0
        ? this.observers.some((e) => hr(e.options.staleTime, this) === "static")
        : !1;
    }
    isStale() {
      return this.getObserversCount() > 0
        ? this.observers.some((e) => e.getCurrentResult().isStale)
        : this.state.data === void 0 || this.state.isInvalidated;
    }
    isStaleByTime(e = 0) {
      return this.state.data === void 0
        ? !0
        : e === "static"
          ? !1
          : this.state.isInvalidated
            ? !0
            : !fr(this.state.dataUpdatedAt, e);
    }
    onFocus() {
      (this.observers
        .find((t) => t.shouldFetchOnWindowFocus())
        ?.refetch({ cancelRefetch: !1 }),
        this.#r?.continue());
    }
    onOnline() {
      (this.observers
        .find((t) => t.shouldFetchOnReconnect())
        ?.refetch({ cancelRefetch: !1 }),
        this.#r?.continue());
    }
    addObserver(e) {
      this.observers.includes(e) ||
        (this.observers.push(e),
        this.clearGcTimeout(),
        this.#e.notify({ type: "observerAdded", query: this, observer: e }));
    }
    removeObserver(e) {
      this.observers.includes(e) &&
        ((this.observers = this.observers.filter((t) => t !== e)),
        this.observers.length ||
          (this.#r &&
            (this.#i ? this.#r.cancel({ revert: !0 }) : this.#r.cancelRetry()),
          this.scheduleGc()),
        this.#e.notify({ type: "observerRemoved", query: this, observer: e }));
    }
    getObserversCount() {
      return this.observers.length;
    }
    invalidate() {
      this.state.isInvalidated || this.#s({ type: "invalidate" });
    }
    async fetch(e, t) {
      if (
        this.state.fetchStatus !== "idle" &&
        this.#r?.status() !== "rejected"
      ) {
        if (this.state.data !== void 0 && t?.cancelRefetch)
          this.cancel({ silent: !0 });
        else if (this.#r) return (this.#r.continueRetry(), this.#r.promise);
      }
      if ((e && this.setOptions(e), !this.options.queryFn)) {
        const i = this.observers.find((c) => c.options.queryFn);
        i && this.setOptions(i.options);
      }
      const n = new AbortController(),
        r = (i) => {
          Object.defineProperty(i, "signal", {
            enumerable: !0,
            get: () => ((this.#i = !0), n.signal),
          });
        },
        o = () => {
          const i = br(this.options, t),
            l = (() => {
              const u = {
                client: this.#o,
                queryKey: this.queryKey,
                meta: this.meta,
              };
              return (r(u), u);
            })();
          return (
            (this.#i = !1),
            this.options.persister ? this.options.persister(i, l, this) : i(l)
          );
        },
        a = (() => {
          const i = {
            fetchOptions: t,
            options: this.options,
            queryKey: this.queryKey,
            client: this.#o,
            state: this.state,
            fetchFn: o,
          };
          return (r(i), i);
        })();
      (this.options.behavior?.onFetch(a, this),
        (this.#n = this.state),
        (this.state.fetchStatus === "idle" ||
          this.state.fetchMeta !== a.fetchOptions?.meta) &&
          this.#s({ type: "fetch", meta: a.fetchOptions?.meta }),
        (this.#r = en({
          initialPromise: t?.initialPromise,
          fn: a.fetchFn,
          onCancel: (i) => {
            (i instanceof Ye &&
              i.revert &&
              this.setState({ ...this.#n, fetchStatus: "idle" }),
              n.abort());
          },
          onFail: (i, c) => {
            this.#s({ type: "failed", failureCount: i, error: c });
          },
          onPause: () => {
            this.#s({ type: "pause" });
          },
          onContinue: () => {
            this.#s({ type: "continue" });
          },
          retry: a.options.retry,
          retryDelay: a.options.retryDelay,
          networkMode: a.options.networkMode,
          canRun: () => !0,
        })));
      try {
        const i = await this.#r.start();
        if (i === void 0)
          throw new Error(`${this.queryHash} data is undefined`);
        return (
          this.setData(i),
          this.#e.config.onSuccess?.(i, this),
          this.#e.config.onSettled?.(i, this.state.error, this),
          i
        );
      } catch (i) {
        if (i instanceof Ye) {
          if (i.silent) return this.#r.promise;
          if (i.revert) {
            if (this.state.data === void 0) throw i;
            return this.state.data;
          }
        }
        throw (
          this.#s({ type: "error", error: i }),
          this.#e.config.onError?.(i, this),
          this.#e.config.onSettled?.(this.state.data, i, this),
          i
        );
      } finally {
        this.scheduleGc();
      }
    }
    #s(e) {
      const t = (n) => {
        switch (e.type) {
          case "failed":
            return {
              ...n,
              fetchFailureCount: e.failureCount,
              fetchFailureReason: e.error,
            };
          case "pause":
            return { ...n, fetchStatus: "paused" };
          case "continue":
            return { ...n, fetchStatus: "fetching" };
          case "fetch":
            return {
              ...n,
              ...Ar(n.data, this.options),
              fetchMeta: e.meta ?? null,
            };
          case "success":
            const r = {
              ...n,
              ...Ct(e.data, e.dataUpdatedAt),
              dataUpdateCount: n.dataUpdateCount + 1,
              ...(!e.manual && {
                fetchStatus: "idle",
                fetchFailureCount: 0,
                fetchFailureReason: null,
              }),
            };
            return ((this.#n = e.manual ? r : void 0), r);
          case "error":
            const o = e.error;
            return {
              ...n,
              error: o,
              errorUpdateCount: n.errorUpdateCount + 1,
              errorUpdatedAt: Date.now(),
              fetchFailureCount: n.fetchFailureCount + 1,
              fetchFailureReason: o,
              fetchStatus: "idle",
              status: "error",
              isInvalidated: !0,
            };
          case "invalidate":
            return { ...n, isInvalidated: !0 };
          case "setState":
            return { ...n, ...e.state };
        }
      };
      ((this.state = t(this.state)),
        Qt.batch(() => {
          (this.observers.forEach((n) => {
            n.onQueryUpdate();
          }),
            this.#e.notify({ query: this, type: "updated", action: e }));
        }));
    }
  };
function Ar(e, t) {
  return {
    fetchFailureCount: 0,
    fetchFailureReason: null,
    fetchStatus: Jt(t.networkMode) ? "fetching" : "paused",
    ...(e === void 0 && { error: null, status: "pending" }),
  };
}
function Ct(e, t) {
  return {
    data: e,
    dataUpdatedAt: t ?? Date.now(),
    error: null,
    isInvalidated: !1,
    status: "success",
  };
}
function Rt(e) {
  const t =
      typeof e.initialData == "function" ? e.initialData() : e.initialData,
    n = t !== void 0,
    r = n
      ? typeof e.initialDataUpdatedAt == "function"
        ? e.initialDataUpdatedAt()
        : e.initialDataUpdatedAt
      : 0;
  return {
    data: t,
    dataUpdateCount: 0,
    dataUpdatedAt: n ? (r ?? Date.now()) : 0,
    error: null,
    errorUpdateCount: 0,
    errorUpdatedAt: 0,
    fetchFailureCount: 0,
    fetchFailureReason: null,
    fetchMeta: null,
    isInvalidated: !1,
    status: n ? "success" : "pending",
    fetchStatus: "idle",
  };
}
var qi = class extends tn {
  #t;
  #n;
  #e;
  #o;
  constructor(e) {
    (super(),
      (this.#t = e.client),
      (this.mutationId = e.mutationId),
      (this.#e = e.mutationCache),
      (this.#n = []),
      (this.state = e.state || Or()),
      this.setOptions(e.options),
      this.scheduleGc());
  }
  setOptions(e) {
    ((this.options = e), this.updateGcTime(this.options.gcTime));
  }
  get meta() {
    return this.options.meta;
  }
  addObserver(e) {
    this.#n.includes(e) ||
      (this.#n.push(e),
      this.clearGcTimeout(),
      this.#e.notify({ type: "observerAdded", mutation: this, observer: e }));
  }
  removeObserver(e) {
    ((this.#n = this.#n.filter((t) => t !== e)),
      this.scheduleGc(),
      this.#e.notify({ type: "observerRemoved", mutation: this, observer: e }));
  }
  optionalRemove() {
    this.#n.length ||
      (this.state.status === "pending"
        ? this.scheduleGc()
        : this.#e.remove(this));
  }
  continue() {
    return this.#o?.continue() ?? this.execute(this.state.variables);
  }
  async execute(e) {
    const t = () => {
        this.#r({ type: "continue" });
      },
      n = {
        client: this.#t,
        meta: this.options.meta,
        mutationKey: this.options.mutationKey,
      };
    this.#o = en({
      fn: () =>
        this.options.mutationFn
          ? this.options.mutationFn(e, n)
          : Promise.reject(new Error("No mutationFn found")),
      onFail: (s, a) => {
        this.#r({ type: "failed", failureCount: s, error: a });
      },
      onPause: () => {
        this.#r({ type: "pause" });
      },
      onContinue: t,
      retry: this.options.retry ?? 0,
      retryDelay: this.options.retryDelay,
      networkMode: this.options.networkMode,
      canRun: () => this.#e.canRun(this),
    });
    const r = this.state.status === "pending",
      o = !this.#o.canStart();
    try {
      if (r) t();
      else {
        (this.#r({ type: "pending", variables: e, isPaused: o }),
          this.#e.config.onMutate &&
            (await this.#e.config.onMutate(e, this, n)));
        const a = await this.options.onMutate?.(e, n);
        a !== this.state.context &&
          this.#r({ type: "pending", context: a, variables: e, isPaused: o });
      }
      const s = await this.#o.start();
      return (
        await this.#e.config.onSuccess?.(s, e, this.state.context, this, n),
        await this.options.onSuccess?.(s, e, this.state.context, n),
        await this.#e.config.onSettled?.(
          s,
          null,
          this.state.variables,
          this.state.context,
          this,
          n,
        ),
        await this.options.onSettled?.(s, null, e, this.state.context, n),
        this.#r({ type: "success", data: s }),
        s
      );
    } catch (s) {
      try {
        await this.#e.config.onError?.(s, e, this.state.context, this, n);
      } catch (a) {
        Promise.reject(a);
      }
      try {
        await this.options.onError?.(s, e, this.state.context, n);
      } catch (a) {
        Promise.reject(a);
      }
      try {
        await this.#e.config.onSettled?.(
          void 0,
          s,
          this.state.variables,
          this.state.context,
          this,
          n,
        );
      } catch (a) {
        Promise.reject(a);
      }
      try {
        await this.options.onSettled?.(void 0, s, e, this.state.context, n);
      } catch (a) {
        Promise.reject(a);
      }
      throw (this.#r({ type: "error", error: s }), s);
    } finally {
      this.#e.runNext(this);
    }
  }
  #r(e) {
    const t = (n) => {
      switch (e.type) {
        case "failed":
          return { ...n, failureCount: e.failureCount, failureReason: e.error };
        case "pause":
          return { ...n, isPaused: !0 };
        case "continue":
          return { ...n, isPaused: !1 };
        case "pending":
          return {
            ...n,
            context: e.context,
            data: void 0,
            failureCount: 0,
            failureReason: null,
            error: null,
            isPaused: e.isPaused,
            status: "pending",
            variables: e.variables,
            submittedAt: Date.now(),
          };
        case "success":
          return {
            ...n,
            data: e.data,
            failureCount: 0,
            failureReason: null,
            error: null,
            status: "success",
            isPaused: !1,
          };
        case "error":
          return {
            ...n,
            data: void 0,
            error: e.error,
            failureCount: n.failureCount + 1,
            failureReason: e.error,
            isPaused: !1,
            status: "error",
          };
      }
    };
    ((this.state = t(this.state)),
      Qt.batch(() => {
        (this.#n.forEach((n) => {
          n.onMutationUpdate(e);
        }),
          this.#e.notify({ mutation: this, type: "updated", action: e }));
      }));
  }
};
function Or() {
  return {
    context: void 0,
    data: void 0,
    error: null,
    failureCount: 0,
    failureReason: null,
    isPaused: !1,
    status: "idle",
    variables: void 0,
    submittedAt: 0,
  };
}
var nn = h.createContext(void 0),
  Ki = (e) => {
    const t = h.useContext(nn);
    if (!t)
      throw new Error("No QueryClient set, use QueryClientProvider to set one");
    return t;
  },
  Yi = ({ client: e, children: t }) => (
    h.useEffect(
      () => (
        e.mount(),
        () => {
          e.unmount();
        }
      ),
      [e],
    ),
    T.jsx(nn.Provider, { value: e, children: t })
  ),
  Tr = (e, t, n, r, o, s, a, i) => {
    let c = document.documentElement,
      l = ["light", "dark"];
    function u(f) {
      ((Array.isArray(e) ? e : [e]).forEach((g) => {
        let m = g === "class",
          y = m && s ? o.map((v) => s[v] || v) : o;
        m
          ? (c.classList.remove(...y), c.classList.add(s && s[f] ? s[f] : f))
          : c.setAttribute(g, f);
      }),
        d(f));
    }
    function d(f) {
      i && l.includes(f) && (c.style.colorScheme = f);
    }
    function p() {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    if (r) u(r);
    else
      try {
        let f = localStorage.getItem(t) || n,
          g = a && f === "system" ? p() : f;
        u(g);
      } catch {}
  },
  St = ["light", "dark"],
  rn = "(prefers-color-scheme: dark)",
  Mr = typeof window > "u",
  ot = h.createContext(void 0),
  Lr = { setTheme: (e) => {}, themes: [] },
  Xi = () => {
    var e;
    return (e = h.useContext(ot)) != null ? e : Lr;
  },
  Qi = (e) =>
    h.useContext(ot)
      ? h.createElement(h.Fragment, null, e.children)
      : h.createElement(Nr, { ...e }),
  kr = ["light", "dark"],
  Nr = ({
    forcedTheme: e,
    disableTransitionOnChange: t = !1,
    enableSystem: n = !0,
    enableColorScheme: r = !0,
    storageKey: o = "theme",
    themes: s = kr,
    defaultTheme: a = n ? "system" : "light",
    attribute: i = "data-theme",
    value: c,
    children: l,
    nonce: u,
    scriptProps: d,
  }) => {
    let [p, f] = h.useState(() => Ir(o, a)),
      [g, m] = h.useState(() => (p === "system" ? We() : p)),
      y = c ? Object.values(c) : s,
      v = h.useCallback(
        (C) => {
          let R = C;
          if (!R) return;
          C === "system" && n && (R = We());
          let S = c ? c[R] : R,
            k = t ? Fr(u) : null,
            L = document.documentElement,
            E = (M) => {
              M === "class"
                ? (L.classList.remove(...y), S && L.classList.add(S))
                : M.startsWith("data-") &&
                  (S ? L.setAttribute(M, S) : L.removeAttribute(M));
            };
          if ((Array.isArray(i) ? i.forEach(E) : E(i), r)) {
            let M = St.includes(a) ? a : null,
              P = St.includes(R) ? R : M;
            L.style.colorScheme = P;
          }
          k?.();
        },
        [u],
      ),
      b = h.useCallback(
        (C) => {
          let R = typeof C == "function" ? C(p) : C;
          f(R);
          try {
            localStorage.setItem(o, R);
          } catch {}
        },
        [p],
      ),
      w = h.useCallback(
        (C) => {
          let R = We(C);
          (m(R), p === "system" && n && !e && v("system"));
        },
        [p, e],
      );
    (h.useEffect(() => {
      let C = window.matchMedia(rn);
      return (C.addListener(w), w(C), () => C.removeListener(w));
    }, [w]),
      h.useEffect(() => {
        let C = (R) => {
          R.key === o && (R.newValue ? f(R.newValue) : b(a));
        };
        return (
          window.addEventListener("storage", C),
          () => window.removeEventListener("storage", C)
        );
      }, [b]),
      h.useEffect(() => {
        v(e ?? p);
      }, [e, p]));
    let x = h.useMemo(
      () => ({
        theme: p,
        setTheme: b,
        forcedTheme: e,
        resolvedTheme: p === "system" ? g : p,
        themes: n ? [...s, "system"] : s,
        systemTheme: n ? g : void 0,
      }),
      [p, b, e, g, n, s],
    );
    return h.createElement(
      ot.Provider,
      { value: x },
      h.createElement(Dr, {
        forcedTheme: e,
        storageKey: o,
        attribute: i,
        enableSystem: n,
        enableColorScheme: r,
        defaultTheme: a,
        value: c,
        themes: s,
        nonce: u,
        scriptProps: d,
      }),
      l,
    );
  },
  Dr = h.memo(
    ({
      forcedTheme: e,
      storageKey: t,
      attribute: n,
      enableSystem: r,
      enableColorScheme: o,
      defaultTheme: s,
      value: a,
      themes: i,
      nonce: c,
      scriptProps: l,
    }) => {
      let u = JSON.stringify([n, t, s, e, i, a, r, o]).slice(1, -1);
      return h.createElement("script", {
        ...l,
        suppressHydrationWarning: !0,
        nonce: typeof window > "u" ? c : "",
        dangerouslySetInnerHTML: { __html: `(${Tr.toString()})(${u})` },
      });
    },
  ),
  Ir = (e, t) => {
    if (Mr) return;
    let n;
    try {
      n = localStorage.getItem(e) || void 0;
    } catch {}
    return n || t;
  },
  Fr = (e) => {
    let t = document.createElement("style");
    return (
      e && t.setAttribute("nonce", e),
      t.appendChild(
        document.createTextNode(
          "*,*::before,*::after{-webkit-transition:none!important;-moz-transition:none!important;-o-transition:none!important;-ms-transition:none!important;transition:none!important}",
        ),
      ),
      document.head.appendChild(t),
      () => {
        (window.getComputedStyle(document.body),
          setTimeout(() => {
            document.head.removeChild(t);
          }, 1));
      }
    );
  },
  We = (e) => (e || (e = window.matchMedia(rn)), e.matches ? "dark" : "light");
function ee(e, t, { checkForDefaultPrevented: n = !0 } = {}) {
  return function (o) {
    if ((e?.(o), n === !1 || !o.defaultPrevented)) return t?.(o);
  };
}
function Et(e, t) {
  if (typeof e == "function") return e(t);
  e != null && (e.current = t);
}
function on(...e) {
  return (t) => {
    let n = !1;
    const r = e.map((o) => {
      const s = Et(o, t);
      return (!n && typeof s == "function" && (n = !0), s);
    });
    if (n)
      return () => {
        for (let o = 0; o < r.length; o++) {
          const s = r[o];
          typeof s == "function" ? s() : Et(e[o], null);
        }
      };
  };
}
function te(...e) {
  return h.useCallback(on(...e), e);
}
function st(e, t = []) {
  let n = [];
  function r(s, a) {
    const i = h.createContext(a),
      c = n.length;
    n = [...n, a];
    const l = (d) => {
      const { scope: p, children: f, ...g } = d,
        m = p?.[e]?.[c] || i,
        y = h.useMemo(() => g, Object.values(g));
      return T.jsx(m.Provider, { value: y, children: f });
    };
    l.displayName = s + "Provider";
    function u(d, p) {
      const f = p?.[e]?.[c] || i,
        g = h.useContext(f);
      if (g) return g;
      if (a !== void 0) return a;
      throw new Error(`\`${d}\` must be used within \`${s}\``);
    }
    return [l, u];
  }
  const o = () => {
    const s = n.map((a) => h.createContext(a));
    return function (i) {
      const c = i?.[e] || s;
      return h.useMemo(() => ({ [`__scope${e}`]: { ...i, [e]: c } }), [i, c]);
    };
  };
  return ((o.scopeName = e), [r, jr(o, ...t)]);
}
function jr(...e) {
  const t = e[0];
  if (e.length === 1) return t;
  const n = () => {
    const r = e.map((o) => ({ useScope: o(), scopeName: o.scopeName }));
    return function (s) {
      const a = r.reduce((i, { useScope: c, scopeName: l }) => {
        const d = c(s)[`__scope${l}`];
        return { ...i, ...d };
      }, {});
      return h.useMemo(() => ({ [`__scope${t.scopeName}`]: a }), [a]);
    };
  };
  return ((n.scopeName = t.scopeName), n);
}
function Xe(e) {
  const t = _r(e),
    n = h.forwardRef((r, o) => {
      const { children: s, ...a } = r,
        i = h.Children.toArray(s),
        c = i.find(zr);
      if (c) {
        const l = c.props.children,
          u = i.map((d) =>
            d === c
              ? h.Children.count(l) > 1
                ? h.Children.only(null)
                : h.isValidElement(l)
                  ? l.props.children
                  : null
              : d,
          );
        return T.jsx(t, {
          ...a,
          ref: o,
          children: h.isValidElement(l) ? h.cloneElement(l, void 0, u) : null,
        });
      }
      return T.jsx(t, { ...a, ref: o, children: s });
    });
  return ((n.displayName = `${e}.Slot`), n);
}
function _r(e) {
  const t = h.forwardRef((n, r) => {
    const { children: o, ...s } = n;
    if (h.isValidElement(o)) {
      const a = Hr(o),
        i = Wr(s, o.props);
      return (
        o.type !== h.Fragment && (i.ref = r ? on(r, a) : a),
        h.cloneElement(o, i)
      );
    }
    return h.Children.count(o) > 1 ? h.Children.only(null) : null;
  });
  return ((t.displayName = `${e}.SlotClone`), t);
}
var sn = Symbol("radix.slottable");
function $r(e) {
  const t = ({ children: n }) => T.jsx(T.Fragment, { children: n });
  return ((t.displayName = `${e}.Slottable`), (t.__radixId = sn), t);
}
function zr(e) {
  return (
    h.isValidElement(e) &&
    typeof e.type == "function" &&
    "__radixId" in e.type &&
    e.type.__radixId === sn
  );
}
function Wr(e, t) {
  const n = { ...t };
  for (const r in t) {
    const o = e[r],
      s = t[r];
    /^on[A-Z]/.test(r)
      ? o && s
        ? (n[r] = (...i) => {
            const c = s(...i);
            return (o(...i), c);
          })
        : o && (n[r] = o)
      : r === "style"
        ? (n[r] = { ...o, ...s })
        : r === "className" && (n[r] = [o, s].filter(Boolean).join(" "));
  }
  return { ...e, ...n };
}
function Hr(e) {
  let t = Object.getOwnPropertyDescriptor(e.props, "ref")?.get,
    n = t && "isReactWarning" in t && t.isReactWarning;
  return n
    ? e.ref
    : ((t = Object.getOwnPropertyDescriptor(e, "ref")?.get),
      (n = t && "isReactWarning" in t && t.isReactWarning),
      n ? e.props.ref : e.props.ref || e.ref);
}
var Br = [
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
  ae = Br.reduce((e, t) => {
    const n = Xe(`Primitive.${t}`),
      r = h.forwardRef((o, s) => {
        const { asChild: a, ...i } = o,
          c = a ? n : t;
        return (
          typeof window < "u" && (window[Symbol.for("radix-ui")] = !0),
          T.jsx(c, { ...i, ref: s })
        );
      });
    return ((r.displayName = `Primitive.${t}`), { ...e, [t]: r });
  }, {});
function Ur(e, t) {
  e && Gt.flushSync(() => e.dispatchEvent(t));
}
function Ne(e) {
  const t = h.useRef(e);
  return (
    h.useEffect(() => {
      t.current = e;
    }),
    h.useMemo(
      () =>
        (...n) =>
          t.current?.(...n),
      [],
    )
  );
}
function Vr(e, t = globalThis?.document) {
  const n = Ne(e);
  h.useEffect(() => {
    const r = (o) => {
      o.key === "Escape" && n(o);
    };
    return (
      t.addEventListener("keydown", r, { capture: !0 }),
      () => t.removeEventListener("keydown", r, { capture: !0 })
    );
  }, [n, t]);
}
var Gr = "DismissableLayer",
  Qe = "dismissableLayer.update",
  qr = "dismissableLayer.pointerDownOutside",
  Kr = "dismissableLayer.focusOutside",
  Pt,
  an = h.createContext({
    layers: new Set(),
    layersWithOutsidePointerEventsDisabled: new Set(),
    branches: new Set(),
  }),
  it = h.forwardRef((e, t) => {
    const {
        disableOutsidePointerEvents: n = !1,
        onEscapeKeyDown: r,
        onPointerDownOutside: o,
        onFocusOutside: s,
        onInteractOutside: a,
        onDismiss: i,
        ...c
      } = e,
      l = h.useContext(an),
      [u, d] = h.useState(null),
      p = u?.ownerDocument ?? globalThis?.document,
      [, f] = h.useState({}),
      g = te(t, (S) => d(S)),
      m = Array.from(l.layers),
      [y] = [...l.layersWithOutsidePointerEventsDisabled].slice(-1),
      v = m.indexOf(y),
      b = u ? m.indexOf(u) : -1,
      w = l.layersWithOutsidePointerEventsDisabled.size > 0,
      x = b >= v,
      C = Xr((S) => {
        const k = S.target,
          L = [...l.branches].some((E) => E.contains(k));
        !x || L || (o?.(S), a?.(S), S.defaultPrevented || i?.());
      }, p),
      R = Qr((S) => {
        const k = S.target;
        [...l.branches].some((E) => E.contains(k)) ||
          (s?.(S), a?.(S), S.defaultPrevented || i?.());
      }, p);
    return (
      Vr((S) => {
        b === l.layers.size - 1 &&
          (r?.(S), !S.defaultPrevented && i && (S.preventDefault(), i()));
      }, p),
      h.useEffect(() => {
        if (u)
          return (
            n &&
              (l.layersWithOutsidePointerEventsDisabled.size === 0 &&
                ((Pt = p.body.style.pointerEvents),
                (p.body.style.pointerEvents = "none")),
              l.layersWithOutsidePointerEventsDisabled.add(u)),
            l.layers.add(u),
            At(),
            () => {
              n &&
                l.layersWithOutsidePointerEventsDisabled.size === 1 &&
                (p.body.style.pointerEvents = Pt);
            }
          );
      }, [u, p, n, l]),
      h.useEffect(
        () => () => {
          u &&
            (l.layers.delete(u),
            l.layersWithOutsidePointerEventsDisabled.delete(u),
            At());
        },
        [u, l],
      ),
      h.useEffect(() => {
        const S = () => f({});
        return (
          document.addEventListener(Qe, S),
          () => document.removeEventListener(Qe, S)
        );
      }, []),
      T.jsx(ae.div, {
        ...c,
        ref: g,
        style: {
          pointerEvents: w ? (x ? "auto" : "none") : void 0,
          ...e.style,
        },
        onFocusCapture: ee(e.onFocusCapture, R.onFocusCapture),
        onBlurCapture: ee(e.onBlurCapture, R.onBlurCapture),
        onPointerDownCapture: ee(
          e.onPointerDownCapture,
          C.onPointerDownCapture,
        ),
      })
    );
  });
it.displayName = Gr;
var Yr = "DismissableLayerBranch",
  cn = h.forwardRef((e, t) => {
    const n = h.useContext(an),
      r = h.useRef(null),
      o = te(t, r);
    return (
      h.useEffect(() => {
        const s = r.current;
        if (s)
          return (
            n.branches.add(s),
            () => {
              n.branches.delete(s);
            }
          );
      }, [n.branches]),
      T.jsx(ae.div, { ...e, ref: o })
    );
  });
cn.displayName = Yr;
function Xr(e, t = globalThis?.document) {
  const n = Ne(e),
    r = h.useRef(!1),
    o = h.useRef(() => {});
  return (
    h.useEffect(() => {
      const s = (i) => {
          if (i.target && !r.current) {
            let c = function () {
              ln(qr, n, l, { discrete: !0 });
            };
            const l = { originalEvent: i };
            i.pointerType === "touch"
              ? (t.removeEventListener("click", o.current),
                (o.current = c),
                t.addEventListener("click", o.current, { once: !0 }))
              : c();
          } else t.removeEventListener("click", o.current);
          r.current = !1;
        },
        a = window.setTimeout(() => {
          t.addEventListener("pointerdown", s);
        }, 0);
      return () => {
        (window.clearTimeout(a),
          t.removeEventListener("pointerdown", s),
          t.removeEventListener("click", o.current));
      };
    }, [t, n]),
    { onPointerDownCapture: () => (r.current = !0) }
  );
}
function Qr(e, t = globalThis?.document) {
  const n = Ne(e),
    r = h.useRef(!1);
  return (
    h.useEffect(() => {
      const o = (s) => {
        s.target &&
          !r.current &&
          ln(Kr, n, { originalEvent: s }, { discrete: !1 });
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
function At() {
  const e = new CustomEvent(Qe);
  document.dispatchEvent(e);
}
function ln(e, t, n, { discrete: r }) {
  const o = n.originalEvent.target,
    s = new CustomEvent(e, { bubbles: !1, cancelable: !0, detail: n });
  (t && o.addEventListener(e, t, { once: !0 }),
    r ? Ur(o, s) : o.dispatchEvent(s));
}
var Zi = it,
  Ji = cn,
  se = globalThis?.document ? h.useLayoutEffect : () => {},
  Zr = qt[" useId ".trim().toString()] || (() => {}),
  Jr = 0;
function eo(e) {
  const [t, n] = h.useState(Zr());
  return (
    se(() => {
      n((r) => r ?? String(Jr++));
    }, [e]),
    t ? `radix-${t}` : ""
  );
}
const un = ["top", "right", "bottom", "left"],
  Ot = ["start", "end"],
  Tt = un.reduce((e, t) => e.concat(t, t + "-" + Ot[0], t + "-" + Ot[1]), []),
  q = Math.min,
  z = Math.max,
  Oe = Math.round,
  Ee = Math.floor,
  Q = (e) => ({ x: e, y: e }),
  to = { left: "right", right: "left", bottom: "top", top: "bottom" };
function Ze(e, t, n) {
  return z(e, q(t, n));
}
function K(e, t) {
  return typeof e == "function" ? e(t) : e;
}
function B(e) {
  return e.split("-")[0];
}
function G(e) {
  return e.split("-")[1];
}
function at(e) {
  return e === "x" ? "y" : "x";
}
function ct(e) {
  return e === "y" ? "height" : "width";
}
function V(e) {
  const t = e[0];
  return t === "t" || t === "b" ? "y" : "x";
}
function lt(e) {
  return at(V(e));
}
function dn(e, t, n) {
  n === void 0 && (n = !1);
  const r = G(e),
    o = lt(e),
    s = ct(o);
  let a =
    o === "x"
      ? r === (n ? "end" : "start")
        ? "right"
        : "left"
      : r === "start"
        ? "bottom"
        : "top";
  return (t.reference[s] > t.floating[s] && (a = Me(a)), [a, Me(a)]);
}
function no(e) {
  const t = Me(e);
  return [Te(e), t, Te(t)];
}
function Te(e) {
  return e.includes("start")
    ? e.replace("start", "end")
    : e.replace("end", "start");
}
const Mt = ["left", "right"],
  Lt = ["right", "left"],
  ro = ["top", "bottom"],
  oo = ["bottom", "top"];
function so(e, t, n) {
  switch (e) {
    case "top":
    case "bottom":
      return n ? (t ? Lt : Mt) : t ? Mt : Lt;
    case "left":
    case "right":
      return t ? ro : oo;
    default:
      return [];
  }
}
function io(e, t, n, r) {
  const o = G(e);
  let s = so(B(e), n === "start", r);
  return (
    o && ((s = s.map((a) => a + "-" + o)), t && (s = s.concat(s.map(Te)))),
    s
  );
}
function Me(e) {
  const t = B(e);
  return to[t] + e.slice(t.length);
}
function ao(e) {
  return { top: 0, right: 0, bottom: 0, left: 0, ...e };
}
function ut(e) {
  return typeof e != "number"
    ? ao(e)
    : { top: e, right: e, bottom: e, left: e };
}
function he(e) {
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
function kt(e, t, n) {
  let { reference: r, floating: o } = e;
  const s = V(t),
    a = lt(t),
    i = ct(a),
    c = B(t),
    l = s === "y",
    u = r.x + r.width / 2 - o.width / 2,
    d = r.y + r.height / 2 - o.height / 2,
    p = r[i] / 2 - o[i] / 2;
  let f;
  switch (c) {
    case "top":
      f = { x: u, y: r.y - o.height };
      break;
    case "bottom":
      f = { x: u, y: r.y + r.height };
      break;
    case "right":
      f = { x: r.x + r.width, y: d };
      break;
    case "left":
      f = { x: r.x - o.width, y: d };
      break;
    default:
      f = { x: r.x, y: r.y };
  }
  switch (G(t)) {
    case "start":
      f[a] -= p * (n && l ? -1 : 1);
      break;
    case "end":
      f[a] += p * (n && l ? -1 : 1);
      break;
  }
  return f;
}
async function co(e, t) {
  var n;
  t === void 0 && (t = {});
  const { x: r, y: o, platform: s, rects: a, elements: i, strategy: c } = e,
    {
      boundary: l = "clippingAncestors",
      rootBoundary: u = "viewport",
      elementContext: d = "floating",
      altBoundary: p = !1,
      padding: f = 0,
    } = K(t, e),
    g = ut(f),
    y = i[p ? (d === "floating" ? "reference" : "floating") : d],
    v = he(
      await s.getClippingRect({
        element:
          (n = await (s.isElement == null ? void 0 : s.isElement(y))) == null ||
          n
            ? y
            : y.contextElement ||
              (await (s.getDocumentElement == null
                ? void 0
                : s.getDocumentElement(i.floating))),
        boundary: l,
        rootBoundary: u,
        strategy: c,
      }),
    ),
    b =
      d === "floating"
        ? { x: r, y: o, width: a.floating.width, height: a.floating.height }
        : a.reference,
    w = await (s.getOffsetParent == null
      ? void 0
      : s.getOffsetParent(i.floating)),
    x = (await (s.isElement == null ? void 0 : s.isElement(w)))
      ? (await (s.getScale == null ? void 0 : s.getScale(w))) || { x: 1, y: 1 }
      : { x: 1, y: 1 },
    C = he(
      s.convertOffsetParentRelativeRectToViewportRelativeRect
        ? await s.convertOffsetParentRelativeRectToViewportRelativeRect({
            elements: i,
            rect: b,
            offsetParent: w,
            strategy: c,
          })
        : b,
    );
  return {
    top: (v.top - C.top + g.top) / x.y,
    bottom: (C.bottom - v.bottom + g.bottom) / x.y,
    left: (v.left - C.left + g.left) / x.x,
    right: (C.right - v.right + g.right) / x.x,
  };
}
const lo = 50,
  uo = async (e, t, n) => {
    const {
        placement: r = "bottom",
        strategy: o = "absolute",
        middleware: s = [],
        platform: a,
      } = n,
      i = a.detectOverflow ? a : { ...a, detectOverflow: co },
      c = await (a.isRTL == null ? void 0 : a.isRTL(t));
    let l = await a.getElementRects({ reference: e, floating: t, strategy: o }),
      { x: u, y: d } = kt(l, r, c),
      p = r,
      f = 0;
    const g = {};
    for (let m = 0; m < s.length; m++) {
      const y = s[m];
      if (!y) continue;
      const { name: v, fn: b } = y,
        {
          x: w,
          y: x,
          data: C,
          reset: R,
        } = await b({
          x: u,
          y: d,
          initialPlacement: r,
          placement: p,
          strategy: o,
          middlewareData: g,
          rects: l,
          platform: i,
          elements: { reference: e, floating: t },
        });
      ((u = w ?? u),
        (d = x ?? d),
        (g[v] = { ...g[v], ...C }),
        R &&
          f < lo &&
          (f++,
          typeof R == "object" &&
            (R.placement && (p = R.placement),
            R.rects &&
              (l =
                R.rects === !0
                  ? await a.getElementRects({
                      reference: e,
                      floating: t,
                      strategy: o,
                    })
                  : R.rects),
            ({ x: u, y: d } = kt(l, p, c))),
          (m = -1)));
    }
    return { x: u, y: d, placement: p, strategy: o, middlewareData: g };
  },
  fo = (e) => ({
    name: "arrow",
    options: e,
    async fn(t) {
      const {
          x: n,
          y: r,
          placement: o,
          rects: s,
          platform: a,
          elements: i,
          middlewareData: c,
        } = t,
        { element: l, padding: u = 0 } = K(e, t) || {};
      if (l == null) return {};
      const d = ut(u),
        p = { x: n, y: r },
        f = lt(o),
        g = ct(f),
        m = await a.getDimensions(l),
        y = f === "y",
        v = y ? "top" : "left",
        b = y ? "bottom" : "right",
        w = y ? "clientHeight" : "clientWidth",
        x = s.reference[g] + s.reference[f] - p[f] - s.floating[g],
        C = p[f] - s.reference[f],
        R = await (a.getOffsetParent == null ? void 0 : a.getOffsetParent(l));
      let S = R ? R[w] : 0;
      (!S || !(await (a.isElement == null ? void 0 : a.isElement(R)))) &&
        (S = i.floating[w] || s.floating[g]);
      const k = x / 2 - C / 2,
        L = S / 2 - m[g] / 2 - 1,
        E = q(d[v], L),
        M = q(d[b], L),
        P = E,
        D = S - m[g] - M,
        N = S / 2 - m[g] / 2 + k,
        $ = Ze(P, N, D),
        I =
          !c.arrow &&
          G(o) != null &&
          N !== $ &&
          s.reference[g] / 2 - (N < P ? E : M) - m[g] / 2 < 0,
        j = I ? (N < P ? N - P : N - D) : 0;
      return {
        [f]: p[f] + j,
        data: {
          [f]: $,
          centerOffset: N - $ - j,
          ...(I && { alignmentOffset: j }),
        },
        reset: I,
      };
    },
  });
function ho(e, t, n) {
  return (
    e
      ? [...n.filter((o) => G(o) === e), ...n.filter((o) => G(o) !== e)]
      : n.filter((o) => B(o) === o)
  ).filter((o) => (e ? G(o) === e || (t ? Te(o) !== o : !1) : !0));
}
const po = function (e) {
    return (
      e === void 0 && (e = {}),
      {
        name: "autoPlacement",
        options: e,
        async fn(t) {
          var n, r, o;
          const {
              rects: s,
              middlewareData: a,
              placement: i,
              platform: c,
              elements: l,
            } = t,
            {
              crossAxis: u = !1,
              alignment: d,
              allowedPlacements: p = Tt,
              autoAlignment: f = !0,
              ...g
            } = K(e, t),
            m = d !== void 0 || p === Tt ? ho(d || null, f, p) : p,
            y = await c.detectOverflow(t, g),
            v = ((n = a.autoPlacement) == null ? void 0 : n.index) || 0,
            b = m[v];
          if (b == null) return {};
          const w = dn(
            b,
            s,
            await (c.isRTL == null ? void 0 : c.isRTL(l.floating)),
          );
          if (i !== b) return { reset: { placement: m[0] } };
          const x = [y[B(b)], y[w[0]], y[w[1]]],
            C = [
              ...(((r = a.autoPlacement) == null ? void 0 : r.overflows) || []),
              { placement: b, overflows: x },
            ],
            R = m[v + 1];
          if (R)
            return {
              data: { index: v + 1, overflows: C },
              reset: { placement: R },
            };
          const S = C.map((E) => {
              const M = G(E.placement);
              return [
                E.placement,
                M && u
                  ? E.overflows.slice(0, 2).reduce((P, D) => P + D, 0)
                  : E.overflows[0],
                E.overflows,
              ];
            }).sort((E, M) => E[1] - M[1]),
            L =
              ((o = S.filter((E) =>
                E[2].slice(0, G(E[0]) ? 2 : 3).every((M) => M <= 0),
              )[0]) == null
                ? void 0
                : o[0]) || S[0][0];
          return L !== i
            ? { data: { index: v + 1, overflows: C }, reset: { placement: L } }
            : {};
        },
      }
    );
  },
  mo = function (e) {
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
              rects: a,
              initialPlacement: i,
              platform: c,
              elements: l,
            } = t,
            {
              mainAxis: u = !0,
              crossAxis: d = !0,
              fallbackPlacements: p,
              fallbackStrategy: f = "bestFit",
              fallbackAxisSideDirection: g = "none",
              flipAlignment: m = !0,
              ...y
            } = K(e, t);
          if ((n = s.arrow) != null && n.alignmentOffset) return {};
          const v = B(o),
            b = V(i),
            w = B(i) === i,
            x = await (c.isRTL == null ? void 0 : c.isRTL(l.floating)),
            C = p || (w || !m ? [Me(i)] : no(i)),
            R = g !== "none";
          !p && R && C.push(...io(i, m, g, x));
          const S = [i, ...C],
            k = await c.detectOverflow(t, y),
            L = [];
          let E = ((r = s.flip) == null ? void 0 : r.overflows) || [];
          if ((u && L.push(k[v]), d)) {
            const N = dn(o, a, x);
            L.push(k[N[0]], k[N[1]]);
          }
          if (
            ((E = [...E, { placement: o, overflows: L }]),
            !L.every((N) => N <= 0))
          ) {
            var M, P;
            const N = (((M = s.flip) == null ? void 0 : M.index) || 0) + 1,
              $ = S[N];
            if (
              $ &&
              (!(d === "alignment" ? b !== V($) : !1) ||
                E.every((O) =>
                  V(O.placement) === b ? O.overflows[0] > 0 : !0,
                ))
            )
              return {
                data: { index: N, overflows: E },
                reset: { placement: $ },
              };
            let I =
              (P = E.filter((j) => j.overflows[0] <= 0).sort(
                (j, O) => j.overflows[1] - O.overflows[1],
              )[0]) == null
                ? void 0
                : P.placement;
            if (!I)
              switch (f) {
                case "bestFit": {
                  var D;
                  const j =
                    (D = E.filter((O) => {
                      if (R) {
                        const _ = V(O.placement);
                        return _ === b || _ === "y";
                      }
                      return !0;
                    })
                      .map((O) => [
                        O.placement,
                        O.overflows
                          .filter((_) => _ > 0)
                          .reduce((_, W) => _ + W, 0),
                      ])
                      .sort((O, _) => O[1] - _[1])[0]) == null
                      ? void 0
                      : D[0];
                  j && (I = j);
                  break;
                }
                case "initialPlacement":
                  I = i;
                  break;
              }
            if (o !== I) return { reset: { placement: I } };
          }
          return {};
        },
      }
    );
  };
function Nt(e, t) {
  return {
    top: e.top - t.height,
    right: e.right - t.width,
    bottom: e.bottom - t.height,
    left: e.left - t.width,
  };
}
function Dt(e) {
  return un.some((t) => e[t] >= 0);
}
const go = function (e) {
  return (
    e === void 0 && (e = {}),
    {
      name: "hide",
      options: e,
      async fn(t) {
        const { rects: n, platform: r } = t,
          { strategy: o = "referenceHidden", ...s } = K(e, t);
        switch (o) {
          case "referenceHidden": {
            const a = await r.detectOverflow(t, {
                ...s,
                elementContext: "reference",
              }),
              i = Nt(a, n.reference);
            return {
              data: { referenceHiddenOffsets: i, referenceHidden: Dt(i) },
            };
          }
          case "escaped": {
            const a = await r.detectOverflow(t, { ...s, altBoundary: !0 }),
              i = Nt(a, n.floating);
            return { data: { escapedOffsets: i, escaped: Dt(i) } };
          }
          default:
            return {};
        }
      },
    }
  );
};
function fn(e) {
  const t = q(...e.map((s) => s.left)),
    n = q(...e.map((s) => s.top)),
    r = z(...e.map((s) => s.right)),
    o = z(...e.map((s) => s.bottom));
  return { x: t, y: n, width: r - t, height: o - n };
}
function yo(e) {
  const t = e.slice().sort((o, s) => o.y - s.y),
    n = [];
  let r = null;
  for (let o = 0; o < t.length; o++) {
    const s = t[o];
    (!r || s.y - r.y > r.height / 2 ? n.push([s]) : n[n.length - 1].push(s),
      (r = s));
  }
  return n.map((o) => he(fn(o)));
}
const vo = function (e) {
    return (
      e === void 0 && (e = {}),
      {
        name: "inline",
        options: e,
        async fn(t) {
          const {
              placement: n,
              elements: r,
              rects: o,
              platform: s,
              strategy: a,
            } = t,
            { padding: i = 2, x: c, y: l } = K(e, t),
            u = Array.from(
              (await (s.getClientRects == null
                ? void 0
                : s.getClientRects(r.reference))) || [],
            ),
            d = yo(u),
            p = he(fn(u)),
            f = ut(i);
          function g() {
            if (
              d.length === 2 &&
              d[0].left > d[1].right &&
              c != null &&
              l != null
            )
              return (
                d.find(
                  (y) =>
                    c > y.left - f.left &&
                    c < y.right + f.right &&
                    l > y.top - f.top &&
                    l < y.bottom + f.bottom,
                ) || p
              );
            if (d.length >= 2) {
              if (V(n) === "y") {
                const E = d[0],
                  M = d[d.length - 1],
                  P = B(n) === "top",
                  D = E.top,
                  N = M.bottom,
                  $ = P ? E.left : M.left,
                  I = P ? E.right : M.right,
                  j = I - $,
                  O = N - D;
                return {
                  top: D,
                  bottom: N,
                  left: $,
                  right: I,
                  width: j,
                  height: O,
                  x: $,
                  y: D,
                };
              }
              const y = B(n) === "left",
                v = z(...d.map((E) => E.right)),
                b = q(...d.map((E) => E.left)),
                w = d.filter((E) => (y ? E.left === b : E.right === v)),
                x = w[0].top,
                C = w[w.length - 1].bottom,
                R = b,
                S = v,
                k = S - R,
                L = C - x;
              return {
                top: x,
                bottom: C,
                left: R,
                right: S,
                width: k,
                height: L,
                x: R,
                y: x,
              };
            }
            return p;
          }
          const m = await s.getElementRects({
            reference: { getBoundingClientRect: g },
            floating: r.floating,
            strategy: a,
          });
          return o.reference.x !== m.reference.x ||
            o.reference.y !== m.reference.y ||
            o.reference.width !== m.reference.width ||
            o.reference.height !== m.reference.height
            ? { reset: { rects: m } }
            : {};
        },
      }
    );
  },
  hn = new Set(["left", "top"]);
async function bo(e, t) {
  const { placement: n, platform: r, elements: o } = e,
    s = await (r.isRTL == null ? void 0 : r.isRTL(o.floating)),
    a = B(n),
    i = G(n),
    c = V(n) === "y",
    l = hn.has(a) ? -1 : 1,
    u = s && c ? -1 : 1,
    d = K(t, e);
  let {
    mainAxis: p,
    crossAxis: f,
    alignmentAxis: g,
  } = typeof d == "number"
    ? { mainAxis: d, crossAxis: 0, alignmentAxis: null }
    : {
        mainAxis: d.mainAxis || 0,
        crossAxis: d.crossAxis || 0,
        alignmentAxis: d.alignmentAxis,
      };
  return (
    i && typeof g == "number" && (f = i === "end" ? g * -1 : g),
    c ? { x: f * u, y: p * l } : { x: p * l, y: f * u }
  );
}
const wo = function (e) {
    return (
      e === void 0 && (e = 0),
      {
        name: "offset",
        options: e,
        async fn(t) {
          var n, r;
          const { x: o, y: s, placement: a, middlewareData: i } = t,
            c = await bo(t, e);
          return a === ((n = i.offset) == null ? void 0 : n.placement) &&
            (r = i.arrow) != null &&
            r.alignmentOffset
            ? {}
            : { x: o + c.x, y: s + c.y, data: { ...c, placement: a } };
        },
      }
    );
  },
  xo = function (e) {
    return (
      e === void 0 && (e = {}),
      {
        name: "shift",
        options: e,
        async fn(t) {
          const { x: n, y: r, placement: o, platform: s } = t,
            {
              mainAxis: a = !0,
              crossAxis: i = !1,
              limiter: c = {
                fn: (v) => {
                  let { x: b, y: w } = v;
                  return { x: b, y: w };
                },
              },
              ...l
            } = K(e, t),
            u = { x: n, y: r },
            d = await s.detectOverflow(t, l),
            p = V(B(o)),
            f = at(p);
          let g = u[f],
            m = u[p];
          if (a) {
            const v = f === "y" ? "top" : "left",
              b = f === "y" ? "bottom" : "right",
              w = g + d[v],
              x = g - d[b];
            g = Ze(w, g, x);
          }
          if (i) {
            const v = p === "y" ? "top" : "left",
              b = p === "y" ? "bottom" : "right",
              w = m + d[v],
              x = m - d[b];
            m = Ze(w, m, x);
          }
          const y = c.fn({ ...t, [f]: g, [p]: m });
          return {
            ...y,
            data: { x: y.x - n, y: y.y - r, enabled: { [f]: a, [p]: i } },
          };
        },
      }
    );
  },
  Co = function (e) {
    return (
      e === void 0 && (e = {}),
      {
        options: e,
        fn(t) {
          const { x: n, y: r, placement: o, rects: s, middlewareData: a } = t,
            { offset: i = 0, mainAxis: c = !0, crossAxis: l = !0 } = K(e, t),
            u = { x: n, y: r },
            d = V(o),
            p = at(d);
          let f = u[p],
            g = u[d];
          const m = K(i, t),
            y =
              typeof m == "number"
                ? { mainAxis: m, crossAxis: 0 }
                : { mainAxis: 0, crossAxis: 0, ...m };
          if (c) {
            const w = p === "y" ? "height" : "width",
              x = s.reference[p] - s.floating[w] + y.mainAxis,
              C = s.reference[p] + s.reference[w] - y.mainAxis;
            f < x ? (f = x) : f > C && (f = C);
          }
          if (l) {
            var v, b;
            const w = p === "y" ? "width" : "height",
              x = hn.has(B(o)),
              C =
                s.reference[d] -
                s.floating[w] +
                ((x && ((v = a.offset) == null ? void 0 : v[d])) || 0) +
                (x ? 0 : y.crossAxis),
              R =
                s.reference[d] +
                s.reference[w] +
                (x ? 0 : ((b = a.offset) == null ? void 0 : b[d]) || 0) -
                (x ? y.crossAxis : 0);
            g < C ? (g = C) : g > R && (g = R);
          }
          return { [p]: f, [d]: g };
        },
      }
    );
  },
  Ro = function (e) {
    return (
      e === void 0 && (e = {}),
      {
        name: "size",
        options: e,
        async fn(t) {
          var n, r;
          const { placement: o, rects: s, platform: a, elements: i } = t,
            { apply: c = () => {}, ...l } = K(e, t),
            u = await a.detectOverflow(t, l),
            d = B(o),
            p = G(o),
            f = V(o) === "y",
            { width: g, height: m } = s.floating;
          let y, v;
          d === "top" || d === "bottom"
            ? ((y = d),
              (v =
                p ===
                ((await (a.isRTL == null ? void 0 : a.isRTL(i.floating)))
                  ? "start"
                  : "end")
                  ? "left"
                  : "right"))
            : ((v = d), (y = p === "end" ? "top" : "bottom"));
          const b = m - u.top - u.bottom,
            w = g - u.left - u.right,
            x = q(m - u[y], b),
            C = q(g - u[v], w),
            R = !t.middlewareData.shift;
          let S = x,
            k = C;
          if (
            ((n = t.middlewareData.shift) != null && n.enabled.x && (k = w),
            (r = t.middlewareData.shift) != null && r.enabled.y && (S = b),
            R && !p)
          ) {
            const E = z(u.left, 0),
              M = z(u.right, 0),
              P = z(u.top, 0),
              D = z(u.bottom, 0);
            f
              ? (k = g - 2 * (E !== 0 || M !== 0 ? E + M : z(u.left, u.right)))
              : (S = m - 2 * (P !== 0 || D !== 0 ? P + D : z(u.top, u.bottom)));
          }
          await c({ ...t, availableWidth: k, availableHeight: S });
          const L = await a.getDimensions(i.floating);
          return g !== L.width || m !== L.height
            ? { reset: { rects: !0 } }
            : {};
        },
      }
    );
  };
function De() {
  return typeof window < "u";
}
function ge(e) {
  return pn(e) ? (e.nodeName || "").toLowerCase() : "#document";
}
function H(e) {
  var t;
  return (
    (e == null || (t = e.ownerDocument) == null ? void 0 : t.defaultView) ||
    window
  );
}
function Z(e) {
  var t;
  return (t = (pn(e) ? e.ownerDocument : e.document) || window.document) == null
    ? void 0
    : t.documentElement;
}
function pn(e) {
  return De() ? e instanceof Node || e instanceof H(e).Node : !1;
}
function Y(e) {
  return De() ? e instanceof Element || e instanceof H(e).Element : !1;
}
function ne(e) {
  return De() ? e instanceof HTMLElement || e instanceof H(e).HTMLElement : !1;
}
function It(e) {
  return !De() || typeof ShadowRoot > "u"
    ? !1
    : e instanceof ShadowRoot || e instanceof H(e).ShadowRoot;
}
function Re(e) {
  const { overflow: t, overflowX: n, overflowY: r, display: o } = X(e);
  return (
    /auto|scroll|overlay|hidden|clip/.test(t + r + n) &&
    o !== "inline" &&
    o !== "contents"
  );
}
function So(e) {
  return /^(table|td|th)$/.test(ge(e));
}
function Ie(e) {
  try {
    if (e.matches(":popover-open")) return !0;
  } catch {}
  try {
    return e.matches(":modal");
  } catch {
    return !1;
  }
}
const Eo = /transform|translate|scale|rotate|perspective|filter/,
  Po = /paint|layout|strict|content/,
  le = (e) => !!e && e !== "none";
let He;
function dt(e) {
  const t = Y(e) ? X(e) : e;
  return (
    le(t.transform) ||
    le(t.translate) ||
    le(t.scale) ||
    le(t.rotate) ||
    le(t.perspective) ||
    (!ft() && (le(t.backdropFilter) || le(t.filter))) ||
    Eo.test(t.willChange || "") ||
    Po.test(t.contain || "")
  );
}
function Ao(e) {
  let t = ie(e);
  for (; ne(t) && !pe(t); ) {
    if (dt(t)) return t;
    if (Ie(t)) return null;
    t = ie(t);
  }
  return null;
}
function ft() {
  return (
    He == null &&
      (He =
        typeof CSS < "u" &&
        CSS.supports &&
        CSS.supports("-webkit-backdrop-filter", "none")),
    He
  );
}
function pe(e) {
  return /^(html|body|#document)$/.test(ge(e));
}
function X(e) {
  return H(e).getComputedStyle(e);
}
function Fe(e) {
  return Y(e)
    ? { scrollLeft: e.scrollLeft, scrollTop: e.scrollTop }
    : { scrollLeft: e.scrollX, scrollTop: e.scrollY };
}
function ie(e) {
  if (ge(e) === "html") return e;
  const t = e.assignedSlot || e.parentNode || (It(e) && e.host) || Z(e);
  return It(t) ? t.host : t;
}
function mn(e) {
  const t = ie(e);
  return pe(t)
    ? e.ownerDocument
      ? e.ownerDocument.body
      : e.body
    : ne(t) && Re(t)
      ? t
      : mn(t);
}
function xe(e, t, n) {
  var r;
  (t === void 0 && (t = []), n === void 0 && (n = !0));
  const o = mn(e),
    s = o === ((r = e.ownerDocument) == null ? void 0 : r.body),
    a = H(o);
  if (s) {
    const i = Je(a);
    return t.concat(
      a,
      a.visualViewport || [],
      Re(o) ? o : [],
      i && n ? xe(i) : [],
    );
  } else return t.concat(o, xe(o, [], n));
}
function Je(e) {
  return e.parent && Object.getPrototypeOf(e.parent) ? e.frameElement : null;
}
function gn(e) {
  const t = X(e);
  let n = parseFloat(t.width) || 0,
    r = parseFloat(t.height) || 0;
  const o = ne(e),
    s = o ? e.offsetWidth : n,
    a = o ? e.offsetHeight : r,
    i = Oe(n) !== s || Oe(r) !== a;
  return (i && ((n = s), (r = a)), { width: n, height: r, $: i });
}
function ht(e) {
  return Y(e) ? e : e.contextElement;
}
function de(e) {
  const t = ht(e);
  if (!ne(t)) return Q(1);
  const n = t.getBoundingClientRect(),
    { width: r, height: o, $: s } = gn(t);
  let a = (s ? Oe(n.width) : n.width) / r,
    i = (s ? Oe(n.height) : n.height) / o;
  return (
    (!a || !Number.isFinite(a)) && (a = 1),
    (!i || !Number.isFinite(i)) && (i = 1),
    { x: a, y: i }
  );
}
const Oo = Q(0);
function yn(e) {
  const t = H(e);
  return !ft() || !t.visualViewport
    ? Oo
    : { x: t.visualViewport.offsetLeft, y: t.visualViewport.offsetTop };
}
function To(e, t, n) {
  return (t === void 0 && (t = !1), !n || (t && n !== H(e)) ? !1 : t);
}
function ue(e, t, n, r) {
  (t === void 0 && (t = !1), n === void 0 && (n = !1));
  const o = e.getBoundingClientRect(),
    s = ht(e);
  let a = Q(1);
  t && (r ? Y(r) && (a = de(r)) : (a = de(e)));
  const i = To(s, n, r) ? yn(s) : Q(0);
  let c = (o.left + i.x) / a.x,
    l = (o.top + i.y) / a.y,
    u = o.width / a.x,
    d = o.height / a.y;
  if (s) {
    const p = H(s),
      f = r && Y(r) ? H(r) : r;
    let g = p,
      m = Je(g);
    for (; m && r && f !== g; ) {
      const y = de(m),
        v = m.getBoundingClientRect(),
        b = X(m),
        w = v.left + (m.clientLeft + parseFloat(b.paddingLeft)) * y.x,
        x = v.top + (m.clientTop + parseFloat(b.paddingTop)) * y.y;
      ((c *= y.x),
        (l *= y.y),
        (u *= y.x),
        (d *= y.y),
        (c += w),
        (l += x),
        (g = H(m)),
        (m = Je(g)));
    }
  }
  return he({ width: u, height: d, x: c, y: l });
}
function je(e, t) {
  const n = Fe(e).scrollLeft;
  return t ? t.left + n : ue(Z(e)).left + n;
}
function vn(e, t) {
  const n = e.getBoundingClientRect(),
    r = n.left + t.scrollLeft - je(e, n),
    o = n.top + t.scrollTop;
  return { x: r, y: o };
}
function Mo(e) {
  let { elements: t, rect: n, offsetParent: r, strategy: o } = e;
  const s = o === "fixed",
    a = Z(r),
    i = t ? Ie(t.floating) : !1;
  if (r === a || (i && s)) return n;
  let c = { scrollLeft: 0, scrollTop: 0 },
    l = Q(1);
  const u = Q(0),
    d = ne(r);
  if ((d || (!d && !s)) && ((ge(r) !== "body" || Re(a)) && (c = Fe(r)), d)) {
    const f = ue(r);
    ((l = de(r)), (u.x = f.x + r.clientLeft), (u.y = f.y + r.clientTop));
  }
  const p = a && !d && !s ? vn(a, c) : Q(0);
  return {
    width: n.width * l.x,
    height: n.height * l.y,
    x: n.x * l.x - c.scrollLeft * l.x + u.x + p.x,
    y: n.y * l.y - c.scrollTop * l.y + u.y + p.y,
  };
}
function Lo(e) {
  return Array.from(e.getClientRects());
}
function ko(e) {
  const t = Z(e),
    n = Fe(e),
    r = e.ownerDocument.body,
    o = z(t.scrollWidth, t.clientWidth, r.scrollWidth, r.clientWidth),
    s = z(t.scrollHeight, t.clientHeight, r.scrollHeight, r.clientHeight);
  let a = -n.scrollLeft + je(e);
  const i = -n.scrollTop;
  return (
    X(r).direction === "rtl" && (a += z(t.clientWidth, r.clientWidth) - o),
    { width: o, height: s, x: a, y: i }
  );
}
const Ft = 25;
function No(e, t) {
  const n = H(e),
    r = Z(e),
    o = n.visualViewport;
  let s = r.clientWidth,
    a = r.clientHeight,
    i = 0,
    c = 0;
  if (o) {
    ((s = o.width), (a = o.height));
    const u = ft();
    (!u || (u && t === "fixed")) && ((i = o.offsetLeft), (c = o.offsetTop));
  }
  const l = je(r);
  if (l <= 0) {
    const u = r.ownerDocument,
      d = u.body,
      p = getComputedStyle(d),
      f =
        (u.compatMode === "CSS1Compat" &&
          parseFloat(p.marginLeft) + parseFloat(p.marginRight)) ||
        0,
      g = Math.abs(r.clientWidth - d.clientWidth - f);
    g <= Ft && (s -= g);
  } else l <= Ft && (s += l);
  return { width: s, height: a, x: i, y: c };
}
function Do(e, t) {
  const n = ue(e, !0, t === "fixed"),
    r = n.top + e.clientTop,
    o = n.left + e.clientLeft,
    s = ne(e) ? de(e) : Q(1),
    a = e.clientWidth * s.x,
    i = e.clientHeight * s.y,
    c = o * s.x,
    l = r * s.y;
  return { width: a, height: i, x: c, y: l };
}
function jt(e, t, n) {
  let r;
  if (t === "viewport") r = No(e, n);
  else if (t === "document") r = ko(Z(e));
  else if (Y(t)) r = Do(t, n);
  else {
    const o = yn(e);
    r = { x: t.x - o.x, y: t.y - o.y, width: t.width, height: t.height };
  }
  return he(r);
}
function bn(e, t) {
  const n = ie(e);
  return n === t || !Y(n) || pe(n) ? !1 : X(n).position === "fixed" || bn(n, t);
}
function Io(e, t) {
  const n = t.get(e);
  if (n) return n;
  let r = xe(e, [], !1).filter((i) => Y(i) && ge(i) !== "body"),
    o = null;
  const s = X(e).position === "fixed";
  let a = s ? ie(e) : e;
  for (; Y(a) && !pe(a); ) {
    const i = X(a),
      c = dt(a);
    (!c && i.position === "fixed" && (o = null),
      (
        s
          ? !c && !o
          : (!c &&
              i.position === "static" &&
              !!o &&
              (o.position === "absolute" || o.position === "fixed")) ||
            (Re(a) && !c && bn(e, a))
      )
        ? (r = r.filter((u) => u !== a))
        : (o = i),
      (a = ie(a)));
  }
  return (t.set(e, r), r);
}
function Fo(e) {
  let { element: t, boundary: n, rootBoundary: r, strategy: o } = e;
  const a = [
      ...(n === "clippingAncestors"
        ? Ie(t)
          ? []
          : Io(t, this._c)
        : [].concat(n)),
      r,
    ],
    i = jt(t, a[0], o);
  let c = i.top,
    l = i.right,
    u = i.bottom,
    d = i.left;
  for (let p = 1; p < a.length; p++) {
    const f = jt(t, a[p], o);
    ((c = z(f.top, c)),
      (l = q(f.right, l)),
      (u = q(f.bottom, u)),
      (d = z(f.left, d)));
  }
  return { width: l - d, height: u - c, x: d, y: c };
}
function jo(e) {
  const { width: t, height: n } = gn(e);
  return { width: t, height: n };
}
function _o(e, t, n) {
  const r = ne(t),
    o = Z(t),
    s = n === "fixed",
    a = ue(e, !0, s, t);
  let i = { scrollLeft: 0, scrollTop: 0 };
  const c = Q(0);
  function l() {
    c.x = je(o);
  }
  if (r || (!r && !s))
    if (((ge(t) !== "body" || Re(o)) && (i = Fe(t)), r)) {
      const f = ue(t, !0, s, t);
      ((c.x = f.x + t.clientLeft), (c.y = f.y + t.clientTop));
    } else o && l();
  s && !r && o && l();
  const u = o && !r && !s ? vn(o, i) : Q(0),
    d = a.left + i.scrollLeft - c.x - u.x,
    p = a.top + i.scrollTop - c.y - u.y;
  return { x: d, y: p, width: a.width, height: a.height };
}
function Be(e) {
  return X(e).position === "static";
}
function _t(e, t) {
  if (!ne(e) || X(e).position === "fixed") return null;
  if (t) return t(e);
  let n = e.offsetParent;
  return (Z(e) === n && (n = n.ownerDocument.body), n);
}
function wn(e, t) {
  const n = H(e);
  if (Ie(e)) return n;
  if (!ne(e)) {
    let o = ie(e);
    for (; o && !pe(o); ) {
      if (Y(o) && !Be(o)) return o;
      o = ie(o);
    }
    return n;
  }
  let r = _t(e, t);
  for (; r && So(r) && Be(r); ) r = _t(r, t);
  return r && pe(r) && Be(r) && !dt(r) ? n : r || Ao(e) || n;
}
const $o = async function (e) {
  const t = this.getOffsetParent || wn,
    n = this.getDimensions,
    r = await n(e.floating);
  return {
    reference: _o(e.reference, await t(e.floating), e.strategy),
    floating: { x: 0, y: 0, width: r.width, height: r.height },
  };
};
function zo(e) {
  return X(e).direction === "rtl";
}
const Wo = {
  convertOffsetParentRelativeRectToViewportRelativeRect: Mo,
  getDocumentElement: Z,
  getClippingRect: Fo,
  getOffsetParent: wn,
  getElementRects: $o,
  getClientRects: Lo,
  getDimensions: jo,
  getScale: de,
  isElement: Y,
  isRTL: zo,
};
function xn(e, t) {
  return (
    e.x === t.x && e.y === t.y && e.width === t.width && e.height === t.height
  );
}
function Ho(e, t) {
  let n = null,
    r;
  const o = Z(e);
  function s() {
    var i;
    (clearTimeout(r), (i = n) == null || i.disconnect(), (n = null));
  }
  function a(i, c) {
    (i === void 0 && (i = !1), c === void 0 && (c = 1), s());
    const l = e.getBoundingClientRect(),
      { left: u, top: d, width: p, height: f } = l;
    if ((i || t(), !p || !f)) return;
    const g = Ee(d),
      m = Ee(o.clientWidth - (u + p)),
      y = Ee(o.clientHeight - (d + f)),
      v = Ee(u),
      w = {
        rootMargin: -g + "px " + -m + "px " + -y + "px " + -v + "px",
        threshold: z(0, q(1, c)) || 1,
      };
    let x = !0;
    function C(R) {
      const S = R[0].intersectionRatio;
      if (S !== c) {
        if (!x) return a();
        S
          ? a(!1, S)
          : (r = setTimeout(() => {
              a(!1, 1e-7);
            }, 1e3));
      }
      (S === 1 && !xn(l, e.getBoundingClientRect()) && a(), (x = !1));
    }
    try {
      n = new IntersectionObserver(C, { ...w, root: o.ownerDocument });
    } catch {
      n = new IntersectionObserver(C, w);
    }
    n.observe(e);
  }
  return (a(!0), s);
}
function Bo(e, t, n, r) {
  r === void 0 && (r = {});
  const {
      ancestorScroll: o = !0,
      ancestorResize: s = !0,
      elementResize: a = typeof ResizeObserver == "function",
      layoutShift: i = typeof IntersectionObserver == "function",
      animationFrame: c = !1,
    } = r,
    l = ht(e),
    u = o || s ? [...(l ? xe(l) : []), ...(t ? xe(t) : [])] : [];
  u.forEach((v) => {
    (o && v.addEventListener("scroll", n, { passive: !0 }),
      s && v.addEventListener("resize", n));
  });
  const d = l && i ? Ho(l, n) : null;
  let p = -1,
    f = null;
  a &&
    ((f = new ResizeObserver((v) => {
      let [b] = v;
      (b &&
        b.target === l &&
        f &&
        t &&
        (f.unobserve(t),
        cancelAnimationFrame(p),
        (p = requestAnimationFrame(() => {
          var w;
          (w = f) == null || w.observe(t);
        }))),
        n());
    })),
    l && !c && f.observe(l),
    t && f.observe(t));
  let g,
    m = c ? ue(e) : null;
  c && y();
  function y() {
    const v = ue(e);
    (m && !xn(m, v) && n(), (m = v), (g = requestAnimationFrame(y)));
  }
  return (
    n(),
    () => {
      var v;
      (u.forEach((b) => {
        (o && b.removeEventListener("scroll", n),
          s && b.removeEventListener("resize", n));
      }),
        d?.(),
        (v = f) == null || v.disconnect(),
        (f = null),
        c && cancelAnimationFrame(g));
    }
  );
}
const Uo = wo,
  ea = po,
  Vo = xo,
  Go = mo,
  qo = Ro,
  Ko = go,
  $t = fo,
  ta = vo,
  Yo = Co,
  Xo = (e, t, n) => {
    const r = new Map(),
      o = { platform: Wo, ...n },
      s = { ...o.platform, _c: r };
    return uo(e, t, { ...o, platform: s });
  };
var Qo = typeof document < "u",
  Zo = function () {},
  Ae = Qo ? h.useLayoutEffect : Zo;
function Le(e, t) {
  if (e === t) return !0;
  if (typeof e != typeof t) return !1;
  if (typeof e == "function" && e.toString() === t.toString()) return !0;
  let n, r, o;
  if (e && t && typeof e == "object") {
    if (Array.isArray(e)) {
      if (((n = e.length), n !== t.length)) return !1;
      for (r = n; r-- !== 0; ) if (!Le(e[r], t[r])) return !1;
      return !0;
    }
    if (((o = Object.keys(e)), (n = o.length), n !== Object.keys(t).length))
      return !1;
    for (r = n; r-- !== 0; ) if (!{}.hasOwnProperty.call(t, o[r])) return !1;
    for (r = n; r-- !== 0; ) {
      const s = o[r];
      if (!(s === "_owner" && e.$$typeof) && !Le(e[s], t[s])) return !1;
    }
    return !0;
  }
  return e !== e && t !== t;
}
function Cn(e) {
  return typeof window > "u"
    ? 1
    : (e.ownerDocument.defaultView || window).devicePixelRatio || 1;
}
function zt(e, t) {
  const n = Cn(e);
  return Math.round(t * n) / n;
}
function Ue(e) {
  const t = h.useRef(e);
  return (
    Ae(() => {
      t.current = e;
    }),
    t
  );
}
function Jo(e) {
  e === void 0 && (e = {});
  const {
      placement: t = "bottom",
      strategy: n = "absolute",
      middleware: r = [],
      platform: o,
      elements: { reference: s, floating: a } = {},
      transform: i = !0,
      whileElementsMounted: c,
      open: l,
    } = e,
    [u, d] = h.useState({
      x: 0,
      y: 0,
      strategy: n,
      placement: t,
      middlewareData: {},
      isPositioned: !1,
    }),
    [p, f] = h.useState(r);
  Le(p, r) || f(r);
  const [g, m] = h.useState(null),
    [y, v] = h.useState(null),
    b = h.useCallback((O) => {
      O !== R.current && ((R.current = O), m(O));
    }, []),
    w = h.useCallback((O) => {
      O !== S.current && ((S.current = O), v(O));
    }, []),
    x = s || g,
    C = a || y,
    R = h.useRef(null),
    S = h.useRef(null),
    k = h.useRef(u),
    L = c != null,
    E = Ue(c),
    M = Ue(o),
    P = Ue(l),
    D = h.useCallback(() => {
      if (!R.current || !S.current) return;
      const O = { placement: t, strategy: n, middleware: p };
      (M.current && (O.platform = M.current),
        Xo(R.current, S.current, O).then((_) => {
          const W = { ..._, isPositioned: P.current !== !1 };
          N.current &&
            !Le(k.current, W) &&
            ((k.current = W),
            Gt.flushSync(() => {
              d(W);
            }));
        }));
    }, [p, t, n, M, P]);
  Ae(() => {
    l === !1 &&
      k.current.isPositioned &&
      ((k.current.isPositioned = !1), d((O) => ({ ...O, isPositioned: !1 })));
  }, [l]);
  const N = h.useRef(!1);
  (Ae(
    () => (
      (N.current = !0),
      () => {
        N.current = !1;
      }
    ),
    [],
  ),
    Ae(() => {
      if ((x && (R.current = x), C && (S.current = C), x && C)) {
        if (E.current) return E.current(x, C, D);
        D();
      }
    }, [x, C, D, E, L]));
  const $ = h.useMemo(
      () => ({ reference: R, floating: S, setReference: b, setFloating: w }),
      [b, w],
    ),
    I = h.useMemo(() => ({ reference: x, floating: C }), [x, C]),
    j = h.useMemo(() => {
      const O = { position: n, left: 0, top: 0 };
      if (!I.floating) return O;
      const _ = zt(I.floating, u.x),
        W = zt(I.floating, u.y);
      return i
        ? {
            ...O,
            transform: "translate(" + _ + "px, " + W + "px)",
            ...(Cn(I.floating) >= 1.5 && { willChange: "transform" }),
          }
        : { position: n, left: _, top: W };
    }, [n, i, I.floating, u.x, u.y]);
  return h.useMemo(
    () => ({ ...u, update: D, refs: $, elements: I, floatingStyles: j }),
    [u, D, $, I, j],
  );
}
const es = (e) => {
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
            ? $t({ element: r.current, padding: o }).fn(n)
            : {}
          : r
            ? $t({ element: r, padding: o }).fn(n)
            : {};
      },
    };
  },
  ts = (e, t) => {
    const n = Uo(e);
    return { name: n.name, fn: n.fn, options: [e, t] };
  },
  ns = (e, t) => {
    const n = Vo(e);
    return { name: n.name, fn: n.fn, options: [e, t] };
  },
  rs = (e, t) => ({ fn: Yo(e).fn, options: [e, t] }),
  os = (e, t) => {
    const n = Go(e);
    return { name: n.name, fn: n.fn, options: [e, t] };
  },
  ss = (e, t) => {
    const n = qo(e);
    return { name: n.name, fn: n.fn, options: [e, t] };
  },
  is = (e, t) => {
    const n = Ko(e);
    return { name: n.name, fn: n.fn, options: [e, t] };
  },
  as = (e, t) => {
    const n = es(e);
    return { name: n.name, fn: n.fn, options: [e, t] };
  };
var cs = "Arrow",
  Rn = h.forwardRef((e, t) => {
    const { children: n, width: r = 10, height: o = 5, ...s } = e;
    return T.jsx(ae.svg, {
      ...s,
      ref: t,
      width: r,
      height: o,
      viewBox: "0 0 30 10",
      preserveAspectRatio: "none",
      children: e.asChild ? n : T.jsx("polygon", { points: "0,0 30,0 15,10" }),
    });
  });
Rn.displayName = cs;
var ls = Rn;
function us(e) {
  const [t, n] = h.useState(void 0);
  return (
    se(() => {
      if (e) {
        n({ width: e.offsetWidth, height: e.offsetHeight });
        const r = new ResizeObserver((o) => {
          if (!Array.isArray(o) || !o.length) return;
          const s = o[0];
          let a, i;
          if ("borderBoxSize" in s) {
            const c = s.borderBoxSize,
              l = Array.isArray(c) ? c[0] : c;
            ((a = l.inlineSize), (i = l.blockSize));
          } else ((a = e.offsetWidth), (i = e.offsetHeight));
          n({ width: a, height: i });
        });
        return (r.observe(e, { box: "border-box" }), () => r.unobserve(e));
      } else n(void 0);
    }, [e]),
    t
  );
}
var pt = "Popper",
  [Sn, En] = st(pt),
  [ds, Pn] = Sn(pt),
  An = (e) => {
    const { __scopePopper: t, children: n } = e,
      [r, o] = h.useState(null);
    return T.jsx(ds, { scope: t, anchor: r, onAnchorChange: o, children: n });
  };
An.displayName = pt;
var On = "PopperAnchor",
  Tn = h.forwardRef((e, t) => {
    const { __scopePopper: n, virtualRef: r, ...o } = e,
      s = Pn(On, n),
      a = h.useRef(null),
      i = te(t, a),
      c = h.useRef(null);
    return (
      h.useEffect(() => {
        const l = c.current;
        ((c.current = r?.current || a.current),
          l !== c.current && s.onAnchorChange(c.current));
      }),
      r ? null : T.jsx(ae.div, { ...o, ref: i })
    );
  });
Tn.displayName = On;
var mt = "PopperContent",
  [fs, hs] = Sn(mt),
  Mn = h.forwardRef((e, t) => {
    const {
        __scopePopper: n,
        side: r = "bottom",
        sideOffset: o = 0,
        align: s = "center",
        alignOffset: a = 0,
        arrowPadding: i = 0,
        avoidCollisions: c = !0,
        collisionBoundary: l = [],
        collisionPadding: u = 0,
        sticky: d = "partial",
        hideWhenDetached: p = !1,
        updatePositionStrategy: f = "optimized",
        onPlaced: g,
        ...m
      } = e,
      y = Pn(mt, n),
      [v, b] = h.useState(null),
      w = te(t, (ve) => b(ve)),
      [x, C] = h.useState(null),
      R = us(x),
      S = R?.width ?? 0,
      k = R?.height ?? 0,
      L = r + (s !== "center" ? "-" + s : ""),
      E =
        typeof u == "number"
          ? u
          : { top: 0, right: 0, bottom: 0, left: 0, ...u },
      M = Array.isArray(l) ? l : [l],
      P = M.length > 0,
      D = { padding: E, boundary: M.filter(ms), altBoundary: P },
      {
        refs: N,
        floatingStyles: $,
        placement: I,
        isPositioned: j,
        middlewareData: O,
      } = Jo({
        strategy: "fixed",
        placement: L,
        whileElementsMounted: (...ve) =>
          Bo(...ve, { animationFrame: f === "always" }),
        elements: { reference: y.anchor },
        middleware: [
          ts({ mainAxis: o + k, alignmentAxis: a }),
          c &&
            ns({
              mainAxis: !0,
              crossAxis: !1,
              limiter: d === "partial" ? rs() : void 0,
              ...D,
            }),
          c && os({ ...D }),
          ss({
            ...D,
            apply: ({
              elements: ve,
              rects: vt,
              availableWidth: rr,
              availableHeight: or,
            }) => {
              const { width: sr, height: ir } = vt.reference,
                Se = ve.floating.style;
              (Se.setProperty("--radix-popper-available-width", `${rr}px`),
                Se.setProperty("--radix-popper-available-height", `${or}px`),
                Se.setProperty("--radix-popper-anchor-width", `${sr}px`),
                Se.setProperty("--radix-popper-anchor-height", `${ir}px`));
            },
          }),
          x && as({ element: x, padding: i }),
          gs({ arrowWidth: S, arrowHeight: k }),
          p && is({ strategy: "referenceHidden", ...D }),
        ],
      }),
      [_, W] = Nn(I),
      U = Ne(g);
    se(() => {
      j && U?.();
    }, [j, U]);
    const Zn = O.arrow?.x,
      Jn = O.arrow?.y,
      er = O.arrow?.centerOffset !== 0,
      [tr, nr] = h.useState();
    return (
      se(() => {
        v && nr(window.getComputedStyle(v).zIndex);
      }, [v]),
      T.jsx("div", {
        ref: N.setFloating,
        "data-radix-popper-content-wrapper": "",
        style: {
          ...$,
          transform: j ? $.transform : "translate(0, -200%)",
          minWidth: "max-content",
          zIndex: tr,
          "--radix-popper-transform-origin": [
            O.transformOrigin?.x,
            O.transformOrigin?.y,
          ].join(" "),
          ...(O.hide?.referenceHidden && {
            visibility: "hidden",
            pointerEvents: "none",
          }),
        },
        dir: e.dir,
        children: T.jsx(fs, {
          scope: n,
          placedSide: _,
          onArrowChange: C,
          arrowX: Zn,
          arrowY: Jn,
          shouldHideArrow: er,
          children: T.jsx(ae.div, {
            "data-side": _,
            "data-align": W,
            ...m,
            ref: w,
            style: { ...m.style, animation: j ? void 0 : "none" },
          }),
        }),
      })
    );
  });
Mn.displayName = mt;
var Ln = "PopperArrow",
  ps = { top: "bottom", right: "left", bottom: "top", left: "right" },
  kn = h.forwardRef(function (t, n) {
    const { __scopePopper: r, ...o } = t,
      s = hs(Ln, r),
      a = ps[s.placedSide];
    return T.jsx("span", {
      ref: s.onArrowChange,
      style: {
        position: "absolute",
        left: s.arrowX,
        top: s.arrowY,
        [a]: 0,
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
      children: T.jsx(ls, {
        ...o,
        ref: n,
        style: { ...o.style, display: "block" },
      }),
    });
  });
kn.displayName = Ln;
function ms(e) {
  return e !== null;
}
var gs = (e) => ({
  name: "transformOrigin",
  options: e,
  fn(t) {
    const { placement: n, rects: r, middlewareData: o } = t,
      a = o.arrow?.centerOffset !== 0,
      i = a ? 0 : e.arrowWidth,
      c = a ? 0 : e.arrowHeight,
      [l, u] = Nn(n),
      d = { start: "0%", center: "50%", end: "100%" }[u],
      p = (o.arrow?.x ?? 0) + i / 2,
      f = (o.arrow?.y ?? 0) + c / 2;
    let g = "",
      m = "";
    return (
      l === "bottom"
        ? ((g = a ? d : `${p}px`), (m = `${-c}px`))
        : l === "top"
          ? ((g = a ? d : `${p}px`), (m = `${r.floating.height + c}px`))
          : l === "right"
            ? ((g = `${-c}px`), (m = a ? d : `${f}px`))
            : l === "left" &&
              ((g = `${r.floating.width + c}px`), (m = a ? d : `${f}px`)),
      { data: { x: g, y: m } }
    );
  },
});
function Nn(e) {
  const [t, n = "center"] = e.split("-");
  return [t, n];
}
var ys = An,
  vs = Tn,
  bs = Mn,
  ws = kn,
  xs = "Portal",
  Cs = h.forwardRef((e, t) => {
    const { container: n, ...r } = e,
      [o, s] = h.useState(!1);
    se(() => s(!0), []);
    const a = n || (o && globalThis?.document?.body);
    return a ? ar.createPortal(T.jsx(ae.div, { ...r, ref: t }), a) : null;
  });
Cs.displayName = xs;
function Rs(e, t) {
  return h.useReducer((n, r) => t[n][r] ?? n, e);
}
var Dn = (e) => {
  const { present: t, children: n } = e,
    r = Ss(t),
    o =
      typeof n == "function" ? n({ present: r.isPresent }) : h.Children.only(n),
    s = te(r.ref, Es(o));
  return typeof n == "function" || r.isPresent
    ? h.cloneElement(o, { ref: s })
    : null;
};
Dn.displayName = "Presence";
function Ss(e) {
  const [t, n] = h.useState(),
    r = h.useRef(null),
    o = h.useRef(e),
    s = h.useRef("none"),
    a = e ? "mounted" : "unmounted",
    [i, c] = Rs(a, {
      mounted: { UNMOUNT: "unmounted", ANIMATION_OUT: "unmountSuspended" },
      unmountSuspended: { MOUNT: "mounted", ANIMATION_END: "unmounted" },
      unmounted: { MOUNT: "mounted" },
    });
  return (
    h.useEffect(() => {
      const l = Pe(r.current);
      s.current = i === "mounted" ? l : "none";
    }, [i]),
    se(() => {
      const l = r.current,
        u = o.current;
      if (u !== e) {
        const p = s.current,
          f = Pe(l);
        (e
          ? c("MOUNT")
          : f === "none" || l?.display === "none"
            ? c("UNMOUNT")
            : c(u && p !== f ? "ANIMATION_OUT" : "UNMOUNT"),
          (o.current = e));
      }
    }, [e, c]),
    se(() => {
      if (t) {
        let l;
        const u = t.ownerDocument.defaultView ?? window,
          d = (f) => {
            const m = Pe(r.current).includes(CSS.escape(f.animationName));
            if (f.target === t && m && (c("ANIMATION_END"), !o.current)) {
              const y = t.style.animationFillMode;
              ((t.style.animationFillMode = "forwards"),
                (l = u.setTimeout(() => {
                  t.style.animationFillMode === "forwards" &&
                    (t.style.animationFillMode = y);
                })));
            }
          },
          p = (f) => {
            f.target === t && (s.current = Pe(r.current));
          };
        return (
          t.addEventListener("animationstart", p),
          t.addEventListener("animationcancel", d),
          t.addEventListener("animationend", d),
          () => {
            (u.clearTimeout(l),
              t.removeEventListener("animationstart", p),
              t.removeEventListener("animationcancel", d),
              t.removeEventListener("animationend", d));
          }
        );
      } else c("ANIMATION_END");
    }, [t, c]),
    {
      isPresent: ["mounted", "unmountSuspended"].includes(i),
      ref: h.useCallback((l) => {
        ((r.current = l ? getComputedStyle(l) : null), n(l));
      }, []),
    }
  );
}
function Pe(e) {
  return e?.animationName || "none";
}
function Es(e) {
  let t = Object.getOwnPropertyDescriptor(e.props, "ref")?.get,
    n = t && "isReactWarning" in t && t.isReactWarning;
  return n
    ? e.ref
    : ((t = Object.getOwnPropertyDescriptor(e, "ref")?.get),
      (n = t && "isReactWarning" in t && t.isReactWarning),
      n ? e.props.ref : e.props.ref || e.ref);
}
var Ps = qt[" useInsertionEffect ".trim().toString()] || se;
function As({ prop: e, defaultProp: t, onChange: n = () => {}, caller: r }) {
  const [o, s, a] = Os({ defaultProp: t, onChange: n }),
    i = e !== void 0,
    c = i ? e : o;
  {
    const u = h.useRef(e !== void 0);
    h.useEffect(() => {
      const d = u.current;
      (d !== i &&
        console.warn(
          `${r} is changing from ${d ? "controlled" : "uncontrolled"} to ${i ? "controlled" : "uncontrolled"}. Components should not switch from controlled to uncontrolled (or vice versa). Decide between using a controlled or uncontrolled value for the lifetime of the component.`,
        ),
        (u.current = i));
    }, [i, r]);
  }
  const l = h.useCallback(
    (u) => {
      if (i) {
        const d = Ts(u) ? u(e) : u;
        d !== e && a.current?.(d);
      } else s(u);
    },
    [i, e, s, a],
  );
  return [c, l];
}
function Os({ defaultProp: e, onChange: t }) {
  const [n, r] = h.useState(e),
    o = h.useRef(n),
    s = h.useRef(t);
  return (
    Ps(() => {
      s.current = t;
    }, [t]),
    h.useEffect(() => {
      o.current !== n && (s.current?.(n), (o.current = n));
    }, [n, o]),
    [n, r, s]
  );
}
function Ts(e) {
  return typeof e == "function";
}
var Ms = Object.freeze({
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
  Ls = "VisuallyHidden",
  In = h.forwardRef((e, t) =>
    T.jsx(ae.span, { ...e, ref: t, style: { ...Ms, ...e.style } }),
  );
In.displayName = Ls;
var ks = In,
  [_e] = st("Tooltip", [En]),
  $e = En(),
  Fn = "TooltipProvider",
  Ns = 700,
  et = "tooltip.open",
  [Ds, gt] = _e(Fn),
  jn = (e) => {
    const {
        __scopeTooltip: t,
        delayDuration: n = Ns,
        skipDelayDuration: r = 300,
        disableHoverableContent: o = !1,
        children: s,
      } = e,
      a = h.useRef(!0),
      i = h.useRef(!1),
      c = h.useRef(0);
    return (
      h.useEffect(() => {
        const l = c.current;
        return () => window.clearTimeout(l);
      }, []),
      T.jsx(Ds, {
        scope: t,
        isOpenDelayedRef: a,
        delayDuration: n,
        onOpen: h.useCallback(() => {
          (window.clearTimeout(c.current), (a.current = !1));
        }, []),
        onClose: h.useCallback(() => {
          (window.clearTimeout(c.current),
            (c.current = window.setTimeout(() => (a.current = !0), r)));
        }, [r]),
        isPointerInTransitRef: i,
        onPointerInTransitChange: h.useCallback((l) => {
          i.current = l;
        }, []),
        disableHoverableContent: o,
        children: s,
      })
    );
  };
jn.displayName = Fn;
var Ce = "Tooltip",
  [Is, ze] = _e(Ce),
  _n = (e) => {
    const {
        __scopeTooltip: t,
        children: n,
        open: r,
        defaultOpen: o,
        onOpenChange: s,
        disableHoverableContent: a,
        delayDuration: i,
      } = e,
      c = gt(Ce, e.__scopeTooltip),
      l = $e(t),
      [u, d] = h.useState(null),
      p = eo(),
      f = h.useRef(0),
      g = a ?? c.disableHoverableContent,
      m = i ?? c.delayDuration,
      y = h.useRef(!1),
      [v, b] = As({
        prop: r,
        defaultProp: o ?? !1,
        onChange: (S) => {
          (S
            ? (c.onOpen(), document.dispatchEvent(new CustomEvent(et)))
            : c.onClose(),
            s?.(S));
        },
        caller: Ce,
      }),
      w = h.useMemo(
        () => (v ? (y.current ? "delayed-open" : "instant-open") : "closed"),
        [v],
      ),
      x = h.useCallback(() => {
        (window.clearTimeout(f.current),
          (f.current = 0),
          (y.current = !1),
          b(!0));
      }, [b]),
      C = h.useCallback(() => {
        (window.clearTimeout(f.current), (f.current = 0), b(!1));
      }, [b]),
      R = h.useCallback(() => {
        (window.clearTimeout(f.current),
          (f.current = window.setTimeout(() => {
            ((y.current = !0), b(!0), (f.current = 0));
          }, m)));
      }, [m, b]);
    return (
      h.useEffect(
        () => () => {
          f.current && (window.clearTimeout(f.current), (f.current = 0));
        },
        [],
      ),
      T.jsx(ys, {
        ...l,
        children: T.jsx(Is, {
          scope: t,
          contentId: p,
          open: v,
          stateAttribute: w,
          trigger: u,
          onTriggerChange: d,
          onTriggerEnter: h.useCallback(() => {
            c.isOpenDelayedRef.current ? R() : x();
          }, [c.isOpenDelayedRef, R, x]),
          onTriggerLeave: h.useCallback(() => {
            g ? C() : (window.clearTimeout(f.current), (f.current = 0));
          }, [C, g]),
          onOpen: x,
          onClose: C,
          disableHoverableContent: g,
          children: n,
        }),
      })
    );
  };
_n.displayName = Ce;
var tt = "TooltipTrigger",
  $n = h.forwardRef((e, t) => {
    const { __scopeTooltip: n, ...r } = e,
      o = ze(tt, n),
      s = gt(tt, n),
      a = $e(n),
      i = h.useRef(null),
      c = te(t, i, o.onTriggerChange),
      l = h.useRef(!1),
      u = h.useRef(!1),
      d = h.useCallback(() => (l.current = !1), []);
    return (
      h.useEffect(
        () => () => document.removeEventListener("pointerup", d),
        [d],
      ),
      T.jsx(vs, {
        asChild: !0,
        ...a,
        children: T.jsx(ae.button, {
          "aria-describedby": o.open ? o.contentId : void 0,
          "data-state": o.stateAttribute,
          ...r,
          ref: c,
          onPointerMove: ee(e.onPointerMove, (p) => {
            p.pointerType !== "touch" &&
              !u.current &&
              !s.isPointerInTransitRef.current &&
              (o.onTriggerEnter(), (u.current = !0));
          }),
          onPointerLeave: ee(e.onPointerLeave, () => {
            (o.onTriggerLeave(), (u.current = !1));
          }),
          onPointerDown: ee(e.onPointerDown, () => {
            (o.open && o.onClose(),
              (l.current = !0),
              document.addEventListener("pointerup", d, { once: !0 }));
          }),
          onFocus: ee(e.onFocus, () => {
            l.current || o.onOpen();
          }),
          onBlur: ee(e.onBlur, o.onClose),
          onClick: ee(e.onClick, o.onClose),
        }),
      })
    );
  });
$n.displayName = tt;
var Fs = "TooltipPortal",
  [na, js] = _e(Fs, { forceMount: void 0 }),
  me = "TooltipContent",
  zn = h.forwardRef((e, t) => {
    const n = js(me, e.__scopeTooltip),
      { forceMount: r = n.forceMount, side: o = "top", ...s } = e,
      a = ze(me, e.__scopeTooltip);
    return T.jsx(Dn, {
      present: r || a.open,
      children: a.disableHoverableContent
        ? T.jsx(Wn, { side: o, ...s, ref: t })
        : T.jsx(_s, { side: o, ...s, ref: t }),
    });
  }),
  _s = h.forwardRef((e, t) => {
    const n = ze(me, e.__scopeTooltip),
      r = gt(me, e.__scopeTooltip),
      o = h.useRef(null),
      s = te(t, o),
      [a, i] = h.useState(null),
      { trigger: c, onClose: l } = n,
      u = o.current,
      { onPointerInTransitChange: d } = r,
      p = h.useCallback(() => {
        (i(null), d(!1));
      }, [d]),
      f = h.useCallback(
        (g, m) => {
          const y = g.currentTarget,
            v = { x: g.clientX, y: g.clientY },
            b = Bs(v, y.getBoundingClientRect()),
            w = Us(v, b),
            x = Vs(m.getBoundingClientRect()),
            C = qs([...w, ...x]);
          (i(C), d(!0));
        },
        [d],
      );
    return (
      h.useEffect(() => () => p(), [p]),
      h.useEffect(() => {
        if (c && u) {
          const g = (y) => f(y, u),
            m = (y) => f(y, c);
          return (
            c.addEventListener("pointerleave", g),
            u.addEventListener("pointerleave", m),
            () => {
              (c.removeEventListener("pointerleave", g),
                u.removeEventListener("pointerleave", m));
            }
          );
        }
      }, [c, u, f, p]),
      h.useEffect(() => {
        if (a) {
          const g = (m) => {
            const y = m.target,
              v = { x: m.clientX, y: m.clientY },
              b = c?.contains(y) || u?.contains(y),
              w = !Gs(v, a);
            b ? p() : w && (p(), l());
          };
          return (
            document.addEventListener("pointermove", g),
            () => document.removeEventListener("pointermove", g)
          );
        }
      }, [c, u, a, l, p]),
      T.jsx(Wn, { ...e, ref: s })
    );
  }),
  [$s, zs] = _e(Ce, { isInside: !1 }),
  Ws = $r("TooltipContent"),
  Wn = h.forwardRef((e, t) => {
    const {
        __scopeTooltip: n,
        children: r,
        "aria-label": o,
        onEscapeKeyDown: s,
        onPointerDownOutside: a,
        ...i
      } = e,
      c = ze(me, n),
      l = $e(n),
      { onClose: u } = c;
    return (
      h.useEffect(
        () => (
          document.addEventListener(et, u),
          () => document.removeEventListener(et, u)
        ),
        [u],
      ),
      h.useEffect(() => {
        if (c.trigger) {
          const d = (p) => {
            p.target?.contains(c.trigger) && u();
          };
          return (
            window.addEventListener("scroll", d, { capture: !0 }),
            () => window.removeEventListener("scroll", d, { capture: !0 })
          );
        }
      }, [c.trigger, u]),
      T.jsx(it, {
        asChild: !0,
        disableOutsidePointerEvents: !1,
        onEscapeKeyDown: s,
        onPointerDownOutside: a,
        onFocusOutside: (d) => d.preventDefault(),
        onDismiss: u,
        children: T.jsxs(bs, {
          "data-state": c.stateAttribute,
          ...l,
          ...i,
          ref: t,
          style: {
            ...i.style,
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
            T.jsx(Ws, { children: r }),
            T.jsx($s, {
              scope: n,
              isInside: !0,
              children: T.jsx(ks, {
                id: c.contentId,
                role: "tooltip",
                children: o || r,
              }),
            }),
          ],
        }),
      })
    );
  });
zn.displayName = me;
var Hn = "TooltipArrow",
  Hs = h.forwardRef((e, t) => {
    const { __scopeTooltip: n, ...r } = e,
      o = $e(n);
    return zs(Hn, n).isInside ? null : T.jsx(ws, { ...o, ...r, ref: t });
  });
Hs.displayName = Hn;
function Bs(e, t) {
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
function Us(e, t, n = 5) {
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
function Vs(e) {
  const { top: t, right: n, bottom: r, left: o } = e;
  return [
    { x: o, y: t },
    { x: n, y: t },
    { x: n, y: r },
    { x: o, y: r },
  ];
}
function Gs(e, t) {
  const { x: n, y: r } = e;
  let o = !1;
  for (let s = 0, a = t.length - 1; s < t.length; a = s++) {
    const i = t[s],
      c = t[a],
      l = i.x,
      u = i.y,
      d = c.x,
      p = c.y;
    u > r != p > r && n < ((d - l) * (r - u)) / (p - u) + l && (o = !o);
  }
  return o;
}
function qs(e) {
  const t = e.slice();
  return (
    t.sort((n, r) =>
      n.x < r.x ? -1 : n.x > r.x ? 1 : n.y < r.y ? -1 : n.y > r.y ? 1 : 0,
    ),
    Ks(t)
  );
}
function Ks(e) {
  if (e.length <= 1) return e.slice();
  const t = [];
  for (let r = 0; r < e.length; r++) {
    const o = e[r];
    for (; t.length >= 2; ) {
      const s = t[t.length - 1],
        a = t[t.length - 2];
      if ((s.x - a.x) * (o.y - a.y) >= (s.y - a.y) * (o.x - a.x)) t.pop();
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
        a = n[n.length - 2];
      if ((s.x - a.x) * (o.y - a.y) >= (s.y - a.y) * (o.x - a.x)) n.pop();
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
var Ys = jn,
  Xs = _n,
  Qs = $n,
  Bn = zn;
typeof window < "u" &&
  window.addEventListener("message", (e) => {
    e.data?.type === "builder.fusion.chatRunning" &&
      window.dispatchEvent(
        new CustomEvent("builder.fusion.chatRunning", {
          detail: e.data.detail,
        }),
      );
  });
function Un(e) {
  var t,
    n,
    r = "";
  if (typeof e == "string" || typeof e == "number") r += e;
  else if (typeof e == "object")
    if (Array.isArray(e)) {
      var o = e.length;
      for (t = 0; t < o; t++)
        e[t] && (n = Un(e[t])) && (r && (r += " "), (r += n));
    } else for (n in e) e[n] && (r && (r += " "), (r += n));
  return r;
}
function Vn() {
  for (var e, t, n = 0, r = "", o = arguments.length; n < o; n++)
    (e = arguments[n]) && (t = Un(e)) && (r && (r += " "), (r += t));
  return r;
}
const yt = "-",
  Zs = (e) => {
    const t = ei(e),
      { conflictingClassGroups: n, conflictingClassGroupModifiers: r } = e;
    return {
      getClassGroupId: (a) => {
        const i = a.split(yt);
        return (i[0] === "" && i.length !== 1 && i.shift(), Gn(i, t) || Js(a));
      },
      getConflictingClassGroupIds: (a, i) => {
        const c = n[a] || [];
        return i && r[a] ? [...c, ...r[a]] : c;
      },
    };
  },
  Gn = (e, t) => {
    if (e.length === 0) return t.classGroupId;
    const n = e[0],
      r = t.nextPart.get(n),
      o = r ? Gn(e.slice(1), r) : void 0;
    if (o) return o;
    if (t.validators.length === 0) return;
    const s = e.join(yt);
    return t.validators.find(({ validator: a }) => a(s))?.classGroupId;
  },
  Wt = /^\[(.+)\]$/,
  Js = (e) => {
    if (Wt.test(e)) {
      const t = Wt.exec(e)[1],
        n = t?.substring(0, t.indexOf(":"));
      if (n) return "arbitrary.." + n;
    }
  },
  ei = (e) => {
    const { theme: t, prefix: n } = e,
      r = { nextPart: new Map(), validators: [] };
    return (
      ni(Object.entries(e.classGroups), n).forEach(([s, a]) => {
        nt(a, r, s, t);
      }),
      r
    );
  },
  nt = (e, t, n, r) => {
    e.forEach((o) => {
      if (typeof o == "string") {
        const s = o === "" ? t : Ht(t, o);
        s.classGroupId = n;
        return;
      }
      if (typeof o == "function") {
        if (ti(o)) {
          nt(o(r), t, n, r);
          return;
        }
        t.validators.push({ validator: o, classGroupId: n });
        return;
      }
      Object.entries(o).forEach(([s, a]) => {
        nt(a, Ht(t, s), n, r);
      });
    });
  },
  Ht = (e, t) => {
    let n = e;
    return (
      t.split(yt).forEach((r) => {
        (n.nextPart.has(r) ||
          n.nextPart.set(r, { nextPart: new Map(), validators: [] }),
          (n = n.nextPart.get(r)));
      }),
      n
    );
  },
  ti = (e) => e.isThemeGetter,
  ni = (e, t) =>
    t
      ? e.map(([n, r]) => {
          const o = r.map((s) =>
            typeof s == "string"
              ? t + s
              : typeof s == "object"
                ? Object.fromEntries(
                    Object.entries(s).map(([a, i]) => [t + a, i]),
                  )
                : s,
          );
          return [n, o];
        })
      : e,
  ri = (e) => {
    if (e < 1) return { get: () => {}, set: () => {} };
    let t = 0,
      n = new Map(),
      r = new Map();
    const o = (s, a) => {
      (n.set(s, a), t++, t > e && ((t = 0), (r = n), (n = new Map())));
    };
    return {
      get(s) {
        let a = n.get(s);
        if (a !== void 0) return a;
        if ((a = r.get(s)) !== void 0) return (o(s, a), a);
      },
      set(s, a) {
        n.has(s) ? n.set(s, a) : o(s, a);
      },
    };
  },
  qn = "!",
  oi = (e) => {
    const { separator: t, experimentalParseClassName: n } = e,
      r = t.length === 1,
      o = t[0],
      s = t.length,
      a = (i) => {
        const c = [];
        let l = 0,
          u = 0,
          d;
        for (let y = 0; y < i.length; y++) {
          let v = i[y];
          if (l === 0) {
            if (v === o && (r || i.slice(y, y + s) === t)) {
              (c.push(i.slice(u, y)), (u = y + s));
              continue;
            }
            if (v === "/") {
              d = y;
              continue;
            }
          }
          v === "[" ? l++ : v === "]" && l--;
        }
        const p = c.length === 0 ? i : i.substring(u),
          f = p.startsWith(qn),
          g = f ? p.substring(1) : p,
          m = d && d > u ? d - u : void 0;
        return {
          modifiers: c,
          hasImportantModifier: f,
          baseClassName: g,
          maybePostfixModifierPosition: m,
        };
      };
    return n ? (i) => n({ className: i, parseClassName: a }) : a;
  },
  si = (e) => {
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
  ii = (e) => ({ cache: ri(e.cacheSize), parseClassName: oi(e), ...Zs(e) }),
  ai = /\s+/,
  ci = (e, t) => {
    const {
        parseClassName: n,
        getClassGroupId: r,
        getConflictingClassGroupIds: o,
      } = t,
      s = [],
      a = e.trim().split(ai);
    let i = "";
    for (let c = a.length - 1; c >= 0; c -= 1) {
      const l = a[c],
        {
          modifiers: u,
          hasImportantModifier: d,
          baseClassName: p,
          maybePostfixModifierPosition: f,
        } = n(l);
      let g = !!f,
        m = r(g ? p.substring(0, f) : p);
      if (!m) {
        if (!g) {
          i = l + (i.length > 0 ? " " + i : i);
          continue;
        }
        if (((m = r(p)), !m)) {
          i = l + (i.length > 0 ? " " + i : i);
          continue;
        }
        g = !1;
      }
      const y = si(u).join(":"),
        v = d ? y + qn : y,
        b = v + m;
      if (s.includes(b)) continue;
      s.push(b);
      const w = o(m, g);
      for (let x = 0; x < w.length; ++x) {
        const C = w[x];
        s.push(v + C);
      }
      i = l + (i.length > 0 ? " " + i : i);
    }
    return i;
  };
function li() {
  let e = 0,
    t,
    n,
    r = "";
  for (; e < arguments.length; )
    (t = arguments[e++]) && (n = Kn(t)) && (r && (r += " "), (r += n));
  return r;
}
const Kn = (e) => {
  if (typeof e == "string") return e;
  let t,
    n = "";
  for (let r = 0; r < e.length; r++)
    e[r] && (t = Kn(e[r])) && (n && (n += " "), (n += t));
  return n;
};
function ui(e, ...t) {
  let n,
    r,
    o,
    s = a;
  function a(c) {
    const l = t.reduce((u, d) => d(u), e());
    return ((n = ii(l)), (r = n.cache.get), (o = n.cache.set), (s = i), i(c));
  }
  function i(c) {
    const l = r(c);
    if (l) return l;
    const u = ci(c, n);
    return (o(c, u), u);
  }
  return function () {
    return s(li.apply(null, arguments));
  };
}
const F = (e) => {
    const t = (n) => n[e] || [];
    return ((t.isThemeGetter = !0), t);
  },
  Yn = /^\[(?:([a-z-]+):)?(.+)\]$/i,
  di = /^\d+\/\d+$/,
  fi = new Set(["px", "full", "screen"]),
  hi = /^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/,
  pi =
    /\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/,
  mi = /^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix)\(.+\)$/,
  gi = /^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/,
  yi =
    /^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/,
  J = (e) => fe(e) || fi.has(e) || di.test(e),
  re = (e) => ye(e, "length", Ei),
  fe = (e) => !!e && !Number.isNaN(Number(e)),
  Ve = (e) => ye(e, "number", fe),
  be = (e) => !!e && Number.isInteger(Number(e)),
  vi = (e) => e.endsWith("%") && fe(e.slice(0, -1)),
  A = (e) => Yn.test(e),
  oe = (e) => hi.test(e),
  bi = new Set(["length", "size", "percentage"]),
  wi = (e) => ye(e, bi, Xn),
  xi = (e) => ye(e, "position", Xn),
  Ci = new Set(["image", "url"]),
  Ri = (e) => ye(e, Ci, Ai),
  Si = (e) => ye(e, "", Pi),
  we = () => !0,
  ye = (e, t, n) => {
    const r = Yn.exec(e);
    return r
      ? r[1]
        ? typeof t == "string"
          ? r[1] === t
          : t.has(r[1])
        : n(r[2])
      : !1;
  },
  Ei = (e) => pi.test(e) && !mi.test(e),
  Xn = () => !1,
  Pi = (e) => gi.test(e),
  Ai = (e) => yi.test(e),
  Oi = () => {
    const e = F("colors"),
      t = F("spacing"),
      n = F("blur"),
      r = F("brightness"),
      o = F("borderColor"),
      s = F("borderRadius"),
      a = F("borderSpacing"),
      i = F("borderWidth"),
      c = F("contrast"),
      l = F("grayscale"),
      u = F("hueRotate"),
      d = F("invert"),
      p = F("gap"),
      f = F("gradientColorStops"),
      g = F("gradientColorStopPositions"),
      m = F("inset"),
      y = F("margin"),
      v = F("opacity"),
      b = F("padding"),
      w = F("saturate"),
      x = F("scale"),
      C = F("sepia"),
      R = F("skew"),
      S = F("space"),
      k = F("translate"),
      L = () => ["auto", "contain", "none"],
      E = () => ["auto", "hidden", "clip", "visible", "scroll"],
      M = () => ["auto", A, t],
      P = () => [A, t],
      D = () => ["", J, re],
      N = () => ["auto", fe, A],
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
      I = () => ["solid", "dashed", "dotted", "double", "none"],
      j = () => [
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
      O = () => [
        "start",
        "end",
        "center",
        "between",
        "around",
        "evenly",
        "stretch",
      ],
      _ = () => ["", "0", A],
      W = () => [
        "auto",
        "avoid",
        "all",
        "avoid-page",
        "page",
        "left",
        "right",
        "column",
      ],
      U = () => [fe, A];
    return {
      cacheSize: 500,
      separator: ":",
      theme: {
        colors: [we],
        spacing: [J, re],
        blur: ["none", "", oe, A],
        brightness: U(),
        borderColor: [e],
        borderRadius: ["none", "", "full", oe, A],
        borderSpacing: P(),
        borderWidth: D(),
        contrast: U(),
        grayscale: _(),
        hueRotate: U(),
        invert: _(),
        gap: P(),
        gradientColorStops: [e],
        gradientColorStopPositions: [vi, re],
        inset: M(),
        margin: M(),
        opacity: U(),
        padding: P(),
        saturate: U(),
        scale: U(),
        sepia: _(),
        skew: U(),
        space: P(),
        translate: P(),
      },
      classGroups: {
        aspect: [{ aspect: ["auto", "square", "video", A] }],
        container: ["container"],
        columns: [{ columns: [oe] }],
        "break-after": [{ "break-after": W() }],
        "break-before": [{ "break-before": W() }],
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
        "object-position": [{ object: [...$(), A] }],
        overflow: [{ overflow: E() }],
        "overflow-x": [{ "overflow-x": E() }],
        "overflow-y": [{ "overflow-y": E() }],
        overscroll: [{ overscroll: L() }],
        "overscroll-x": [{ "overscroll-x": L() }],
        "overscroll-y": [{ "overscroll-y": L() }],
        position: ["static", "fixed", "absolute", "relative", "sticky"],
        inset: [{ inset: [m] }],
        "inset-x": [{ "inset-x": [m] }],
        "inset-y": [{ "inset-y": [m] }],
        start: [{ start: [m] }],
        end: [{ end: [m] }],
        top: [{ top: [m] }],
        right: [{ right: [m] }],
        bottom: [{ bottom: [m] }],
        left: [{ left: [m] }],
        visibility: ["visible", "invisible", "collapse"],
        z: [{ z: ["auto", be, A] }],
        basis: [{ basis: M() }],
        "flex-direction": [
          { flex: ["row", "row-reverse", "col", "col-reverse"] },
        ],
        "flex-wrap": [{ flex: ["wrap", "wrap-reverse", "nowrap"] }],
        flex: [{ flex: ["1", "auto", "initial", "none", A] }],
        grow: [{ grow: _() }],
        shrink: [{ shrink: _() }],
        order: [{ order: ["first", "last", "none", be, A] }],
        "grid-cols": [{ "grid-cols": [we] }],
        "col-start-end": [{ col: ["auto", { span: ["full", be, A] }, A] }],
        "col-start": [{ "col-start": N() }],
        "col-end": [{ "col-end": N() }],
        "grid-rows": [{ "grid-rows": [we] }],
        "row-start-end": [{ row: ["auto", { span: [be, A] }, A] }],
        "row-start": [{ "row-start": N() }],
        "row-end": [{ "row-end": N() }],
        "grid-flow": [
          { "grid-flow": ["row", "col", "dense", "row-dense", "col-dense"] },
        ],
        "auto-cols": [{ "auto-cols": ["auto", "min", "max", "fr", A] }],
        "auto-rows": [{ "auto-rows": ["auto", "min", "max", "fr", A] }],
        gap: [{ gap: [p] }],
        "gap-x": [{ "gap-x": [p] }],
        "gap-y": [{ "gap-y": [p] }],
        "justify-content": [{ justify: ["normal", ...O()] }],
        "justify-items": [
          { "justify-items": ["start", "end", "center", "stretch"] },
        ],
        "justify-self": [
          { "justify-self": ["auto", "start", "end", "center", "stretch"] },
        ],
        "align-content": [{ content: ["normal", ...O(), "baseline"] }],
        "align-items": [
          { items: ["start", "end", "center", "baseline", "stretch"] },
        ],
        "align-self": [
          { self: ["auto", "start", "end", "center", "stretch", "baseline"] },
        ],
        "place-content": [{ "place-content": [...O(), "baseline"] }],
        "place-items": [
          { "place-items": ["start", "end", "center", "baseline", "stretch"] },
        ],
        "place-self": [
          { "place-self": ["auto", "start", "end", "center", "stretch"] },
        ],
        p: [{ p: [b] }],
        px: [{ px: [b] }],
        py: [{ py: [b] }],
        ps: [{ ps: [b] }],
        pe: [{ pe: [b] }],
        pt: [{ pt: [b] }],
        pr: [{ pr: [b] }],
        pb: [{ pb: [b] }],
        pl: [{ pl: [b] }],
        m: [{ m: [y] }],
        mx: [{ mx: [y] }],
        my: [{ my: [y] }],
        ms: [{ ms: [y] }],
        me: [{ me: [y] }],
        mt: [{ mt: [y] }],
        mr: [{ mr: [y] }],
        mb: [{ mb: [y] }],
        ml: [{ ml: [y] }],
        "space-x": [{ "space-x": [S] }],
        "space-x-reverse": ["space-x-reverse"],
        "space-y": [{ "space-y": [S] }],
        "space-y-reverse": ["space-y-reverse"],
        w: [{ w: ["auto", "min", "max", "fit", "svw", "lvw", "dvw", A, t] }],
        "min-w": [{ "min-w": [A, t, "min", "max", "fit"] }],
        "max-w": [
          {
            "max-w": [
              A,
              t,
              "none",
              "full",
              "min",
              "max",
              "fit",
              "prose",
              { screen: [oe] },
              oe,
            ],
          },
        ],
        h: [{ h: [A, t, "auto", "min", "max", "fit", "svh", "lvh", "dvh"] }],
        "min-h": [
          { "min-h": [A, t, "min", "max", "fit", "svh", "lvh", "dvh"] },
        ],
        "max-h": [
          { "max-h": [A, t, "min", "max", "fit", "svh", "lvh", "dvh"] },
        ],
        size: [{ size: [A, t, "auto", "min", "max", "fit"] }],
        "font-size": [{ text: ["base", oe, re] }],
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
              Ve,
            ],
          },
        ],
        "font-family": [{ font: [we] }],
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
              A,
            ],
          },
        ],
        "line-clamp": [{ "line-clamp": ["none", fe, Ve] }],
        leading: [
          {
            leading: [
              "none",
              "tight",
              "snug",
              "normal",
              "relaxed",
              "loose",
              J,
              A,
            ],
          },
        ],
        "list-image": [{ "list-image": ["none", A] }],
        "list-style-type": [{ list: ["none", "disc", "decimal", A] }],
        "list-style-position": [{ list: ["inside", "outside"] }],
        "placeholder-color": [{ placeholder: [e] }],
        "placeholder-opacity": [{ "placeholder-opacity": [v] }],
        "text-alignment": [
          { text: ["left", "center", "right", "justify", "start", "end"] },
        ],
        "text-color": [{ text: [e] }],
        "text-opacity": [{ "text-opacity": [v] }],
        "text-decoration": [
          "underline",
          "overline",
          "line-through",
          "no-underline",
        ],
        "text-decoration-style": [{ decoration: [...I(), "wavy"] }],
        "text-decoration-thickness": [
          { decoration: ["auto", "from-font", J, re] },
        ],
        "underline-offset": [{ "underline-offset": ["auto", J, A] }],
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
              A,
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
        content: [{ content: ["none", A] }],
        "bg-attachment": [{ bg: ["fixed", "local", "scroll"] }],
        "bg-clip": [{ "bg-clip": ["border", "padding", "content", "text"] }],
        "bg-opacity": [{ "bg-opacity": [v] }],
        "bg-origin": [{ "bg-origin": ["border", "padding", "content"] }],
        "bg-position": [{ bg: [...$(), xi] }],
        "bg-repeat": [
          { bg: ["no-repeat", { repeat: ["", "x", "y", "round", "space"] }] },
        ],
        "bg-size": [{ bg: ["auto", "cover", "contain", wi] }],
        "bg-image": [
          {
            bg: [
              "none",
              { "gradient-to": ["t", "tr", "r", "br", "b", "bl", "l", "tl"] },
              Ri,
            ],
          },
        ],
        "bg-color": [{ bg: [e] }],
        "gradient-from-pos": [{ from: [g] }],
        "gradient-via-pos": [{ via: [g] }],
        "gradient-to-pos": [{ to: [g] }],
        "gradient-from": [{ from: [f] }],
        "gradient-via": [{ via: [f] }],
        "gradient-to": [{ to: [f] }],
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
        "border-w": [{ border: [i] }],
        "border-w-x": [{ "border-x": [i] }],
        "border-w-y": [{ "border-y": [i] }],
        "border-w-s": [{ "border-s": [i] }],
        "border-w-e": [{ "border-e": [i] }],
        "border-w-t": [{ "border-t": [i] }],
        "border-w-r": [{ "border-r": [i] }],
        "border-w-b": [{ "border-b": [i] }],
        "border-w-l": [{ "border-l": [i] }],
        "border-opacity": [{ "border-opacity": [v] }],
        "border-style": [{ border: [...I(), "hidden"] }],
        "divide-x": [{ "divide-x": [i] }],
        "divide-x-reverse": ["divide-x-reverse"],
        "divide-y": [{ "divide-y": [i] }],
        "divide-y-reverse": ["divide-y-reverse"],
        "divide-opacity": [{ "divide-opacity": [v] }],
        "divide-style": [{ divide: I() }],
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
        "outline-style": [{ outline: ["", ...I()] }],
        "outline-offset": [{ "outline-offset": [J, A] }],
        "outline-w": [{ outline: [J, re] }],
        "outline-color": [{ outline: [e] }],
        "ring-w": [{ ring: D() }],
        "ring-w-inset": ["ring-inset"],
        "ring-color": [{ ring: [e] }],
        "ring-opacity": [{ "ring-opacity": [v] }],
        "ring-offset-w": [{ "ring-offset": [J, re] }],
        "ring-offset-color": [{ "ring-offset": [e] }],
        shadow: [{ shadow: ["", "inner", "none", oe, Si] }],
        "shadow-color": [{ shadow: [we] }],
        opacity: [{ opacity: [v] }],
        "mix-blend": [{ "mix-blend": [...j(), "plus-lighter", "plus-darker"] }],
        "bg-blend": [{ "bg-blend": j() }],
        filter: [{ filter: ["", "none"] }],
        blur: [{ blur: [n] }],
        brightness: [{ brightness: [r] }],
        contrast: [{ contrast: [c] }],
        "drop-shadow": [{ "drop-shadow": ["", "none", oe, A] }],
        grayscale: [{ grayscale: [l] }],
        "hue-rotate": [{ "hue-rotate": [u] }],
        invert: [{ invert: [d] }],
        saturate: [{ saturate: [w] }],
        sepia: [{ sepia: [C] }],
        "backdrop-filter": [{ "backdrop-filter": ["", "none"] }],
        "backdrop-blur": [{ "backdrop-blur": [n] }],
        "backdrop-brightness": [{ "backdrop-brightness": [r] }],
        "backdrop-contrast": [{ "backdrop-contrast": [c] }],
        "backdrop-grayscale": [{ "backdrop-grayscale": [l] }],
        "backdrop-hue-rotate": [{ "backdrop-hue-rotate": [u] }],
        "backdrop-invert": [{ "backdrop-invert": [d] }],
        "backdrop-opacity": [{ "backdrop-opacity": [v] }],
        "backdrop-saturate": [{ "backdrop-saturate": [w] }],
        "backdrop-sepia": [{ "backdrop-sepia": [C] }],
        "border-collapse": [{ border: ["collapse", "separate"] }],
        "border-spacing": [{ "border-spacing": [a] }],
        "border-spacing-x": [{ "border-spacing-x": [a] }],
        "border-spacing-y": [{ "border-spacing-y": [a] }],
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
              A,
            ],
          },
        ],
        duration: [{ duration: U() }],
        ease: [{ ease: ["linear", "in", "out", "in-out", A] }],
        delay: [{ delay: U() }],
        animate: [{ animate: ["none", "spin", "ping", "pulse", "bounce", A] }],
        transform: [{ transform: ["", "gpu", "none"] }],
        scale: [{ scale: [x] }],
        "scale-x": [{ "scale-x": [x] }],
        "scale-y": [{ "scale-y": [x] }],
        rotate: [{ rotate: [be, A] }],
        "translate-x": [{ "translate-x": [k] }],
        "translate-y": [{ "translate-y": [k] }],
        "skew-x": [{ "skew-x": [R] }],
        "skew-y": [{ "skew-y": [R] }],
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
              A,
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
              A,
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
          { "will-change": ["auto", "scroll", "contents", "transform", A] },
        ],
        fill: [{ fill: [e, "none"] }],
        "stroke-w": [{ stroke: [J, re, Ve] }],
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
  Ti = ui(Oi);
function Mi(...e) {
  return Ti(Vn(e));
}
typeof window < "u" &&
  window.addEventListener("message", (e) => {
    e.data?.type === "builder.harnessOrigin" && e.data.origin && e.data.origin;
  });
const ra = Ys,
  oa = Xs,
  sa = Qs,
  Li = h.forwardRef(({ className: e, sideOffset: t = 4, ...n }, r) =>
    T.jsx(Bn, {
      ref: r,
      sideOffset: t,
      className: Mi(
        "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        e,
      ),
      ...n,
    }),
  );
Li.displayName = Bn.displayName;
function ia(e) {
  const t = e + "CollectionProvider",
    [n, r] = st(t),
    [o, s] = n(t, { collectionRef: { current: null }, itemMap: new Map() }),
    a = (m) => {
      const { scope: y, children: v } = m,
        b = ce.useRef(null),
        w = ce.useRef(new Map()).current;
      return T.jsx(o, { scope: y, itemMap: w, collectionRef: b, children: v });
    };
  a.displayName = t;
  const i = e + "CollectionSlot",
    c = Xe(i),
    l = ce.forwardRef((m, y) => {
      const { scope: v, children: b } = m,
        w = s(i, v),
        x = te(y, w.collectionRef);
      return T.jsx(c, { ref: x, children: b });
    });
  l.displayName = i;
  const u = e + "CollectionItemSlot",
    d = "data-radix-collection-item",
    p = Xe(u),
    f = ce.forwardRef((m, y) => {
      const { scope: v, children: b, ...w } = m,
        x = ce.useRef(null),
        C = te(y, x),
        R = s(u, v);
      return (
        ce.useEffect(
          () => (
            R.itemMap.set(x, { ref: x, ...w }),
            () => {
              R.itemMap.delete(x);
            }
          ),
        ),
        T.jsx(p, { [d]: "", ref: C, children: b })
      );
    });
  f.displayName = u;
  function g(m) {
    const y = s(e + "CollectionConsumer", m);
    return ce.useCallback(() => {
      const b = y.collectionRef.current;
      if (!b) return [];
      const w = Array.from(b.querySelectorAll(`[${d}]`));
      return Array.from(y.itemMap.values()).sort(
        (R, S) => w.indexOf(R.ref.current) - w.indexOf(S.ref.current),
      );
    }, [y.collectionRef, y.itemMap]);
  }
  return [{ Provider: a, Slot: l, ItemSlot: f }, g, r];
}
const Bt = (e) => (typeof e == "boolean" ? `${e}` : e === 0 ? "0" : e),
  Ut = Vn,
  aa = (e, t) => (n) => {
    var r;
    if (t?.variants == null) return Ut(e, n?.class, n?.className);
    const { variants: o, defaultVariants: s } = t,
      a = Object.keys(o).map((l) => {
        const u = n?.[l],
          d = s?.[l];
        if (u === null) return null;
        const p = Bt(u) || Bt(d);
        return o[l][p];
      }),
      i =
        n &&
        Object.entries(n).reduce((l, u) => {
          let [d, p] = u;
          return (p === void 0 || (l[d] = p), l);
        }, {}),
      c =
        t == null || (r = t.compoundVariants) === null || r === void 0
          ? void 0
          : r.reduce((l, u) => {
              let { class: d, className: p, ...f } = u;
              return Object.entries(f).every((g) => {
                let [m, y] = g;
                return Array.isArray(y)
                  ? y.includes({ ...s, ...i }[m])
                  : { ...s, ...i }[m] === y;
              })
                ? [...l, d, p]
                : l;
            }, []);
    return Ut(e, a, c, n?.class, n?.className);
  };
const ki = (e) => e.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(),
  Ni = (e) =>
    e.replace(/^([A-Z])|[\s-_]+(\w)/g, (t, n, r) =>
      r ? r.toUpperCase() : n.toLowerCase(),
    ),
  Vt = (e) => {
    const t = Ni(e);
    return t.charAt(0).toUpperCase() + t.slice(1);
  },
  Qn = (...e) =>
    e
      .filter((t, n, r) => !!t && t.trim() !== "" && r.indexOf(t) === n)
      .join(" ")
      .trim(),
  Di = (e) => {
    for (const t in e)
      if (t.startsWith("aria-") || t === "role" || t === "title") return !0;
  };
var Ii = {
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
const Fi = h.forwardRef(
  (
    {
      color: e = "currentColor",
      size: t = 24,
      strokeWidth: n = 2,
      absoluteStrokeWidth: r,
      className: o = "",
      children: s,
      iconNode: a,
      ...i
    },
    c,
  ) =>
    h.createElement(
      "svg",
      {
        ref: c,
        ...Ii,
        width: t,
        height: t,
        stroke: e,
        strokeWidth: r ? (Number(n) * 24) / Number(t) : n,
        className: Qn("lucide", o),
        ...(!s && !Di(i) && { "aria-hidden": "true" }),
        ...i,
      },
      [
        ...a.map(([l, u]) => h.createElement(l, u)),
        ...(Array.isArray(s) ? s : [s]),
      ],
    ),
);
const ca = (e, t) => {
  const n = h.forwardRef(({ className: r, ...o }, s) =>
    h.createElement(Fi, {
      ref: s,
      iconNode: t,
      className: Qn(`lucide-${ki(Vt(e))}`, `lucide-${e}`, r),
      ...o,
    }),
  );
  return ((n.displayName = Vt(e)), n);
};
export {
  ke as $,
  ca as A,
  Ji as B,
  Mi as C,
  aa as D,
  Xi as E,
  Ki as F,
  Yi as G,
  Go as H,
  Vo as I,
  Qi as J,
  Uo as K,
  $t as L,
  qi as M,
  qo as N,
  ea as O,
  ae as P,
  Gi as Q,
  Zi as R,
  Kt as S,
  ra as T,
  Ko as U,
  In as V,
  ta as W,
  Xo as X,
  Cr as Y,
  pr as Z,
  Wi as _,
  Bi as a,
  dr as a0,
  fr as a1,
  Ge as a2,
  Ar as a3,
  vr as a4,
  Or as a5,
  Ui as a6,
  on as a7,
  oa as a8,
  sa as a9,
  Li as aa,
  eo as ab,
  En as ac,
  vs as ad,
  it as ae,
  bs as af,
  Xe as ag,
  ys as ah,
  ws as ai,
  Hi as b,
  Vi as c,
  bt as d,
  br as e,
  $i as f,
  xr as g,
  mr as h,
  _i as i,
  qe as j,
  As as k,
  Dn as l,
  zi as m,
  Qt as n,
  Zt as o,
  rt as p,
  ee as q,
  hr as r,
  Xt as s,
  Ne as t,
  te as u,
  ia as v,
  st as w,
  Cs as x,
  Ur as y,
  se as z,
};
