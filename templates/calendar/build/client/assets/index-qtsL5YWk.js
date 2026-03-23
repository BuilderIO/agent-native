import { r as w, j as pe, R as o, A as ye } from "./index-Coy-XKTg.js";
var Yt = class {
    constructor() {
      ((this.listeners = new Set()),
        (this.subscribe = this.subscribe.bind(this)));
    }
    subscribe(t) {
      return (
        this.listeners.add(t),
        this.onSubscribe(),
        () => {
          (this.listeners.delete(t), this.onUnsubscribe());
        }
      );
    }
    hasListeners() {
      return this.listeners.size > 0;
    }
    onSubscribe() {}
    onUnsubscribe() {}
  },
  ve = {
    setTimeout: (t, e) => setTimeout(t, e),
    clearTimeout: (t) => clearTimeout(t),
    setInterval: (t, e) => setInterval(t, e),
    clearInterval: (t) => clearInterval(t),
  },
  ge = class {
    #e = ve;
    #a = !1;
    setTimeoutProvider(t) {
      this.#e = t;
    }
    setTimeout(t, e) {
      return this.#e.setTimeout(t, e);
    }
    clearTimeout(t) {
      this.#e.clearTimeout(t);
    }
    setInterval(t, e) {
      return this.#e.setInterval(t, e);
    }
    clearInterval(t) {
      this.#e.clearInterval(t);
    }
  },
  St = new ge();
function be(t) {
  setTimeout(t, 0);
}
var mt = typeof window > "u" || "Deno" in globalThis;
function Lt() {}
function ba(t, e) {
  return typeof t == "function" ? t(e) : t;
}
function we(t) {
  return typeof t == "number" && t >= 0 && t !== 1 / 0;
}
function xe(t, e) {
  return Math.max(t + (e || 0) - Date.now(), 0);
}
function Se(t, e) {
  return typeof t == "function" ? t(e) : t;
}
function Ee(t, e) {
  return typeof t == "function" ? t(e) : t;
}
function wa(t, e) {
  const {
    type: a = "all",
    exact: r,
    fetchStatus: i,
    predicate: l,
    queryKey: u,
    stale: n,
  } = t;
  if (u) {
    if (r) {
      if (e.queryHash !== Ce(u, e.options)) return !1;
    } else if (!Mt(e.queryKey, u)) return !1;
  }
  if (a !== "all") {
    const d = e.isActive();
    if ((a === "active" && !d) || (a === "inactive" && d)) return !1;
  }
  return !(
    (typeof n == "boolean" && e.isStale() !== n) ||
    (i && i !== e.state.fetchStatus) ||
    (l && !l(e))
  );
}
function xa(t, e) {
  const { exact: a, status: r, predicate: i, mutationKey: l } = t;
  if (l) {
    if (!e.options.mutationKey) return !1;
    if (a) {
      if (Et(e.options.mutationKey) !== Et(l)) return !1;
    } else if (!Mt(e.options.mutationKey, l)) return !1;
  }
  return !((r && e.state.status !== r) || (i && !i(e)));
}
function Ce(t, e) {
  return (e?.queryKeyHashFn || Et)(t);
}
function Et(t) {
  return JSON.stringify(t, (e, a) =>
    Ct(a)
      ? Object.keys(a)
          .sort()
          .reduce((r, i) => ((r[i] = a[i]), r), {})
      : a,
  );
}
function Mt(t, e) {
  return t === e
    ? !0
    : typeof t != typeof e
      ? !1
      : t && e && typeof t == "object" && typeof e == "object"
        ? Object.keys(e).every((a) => Mt(t[a], e[a]))
        : !1;
}
var Te = Object.prototype.hasOwnProperty;
function Qt(t, e, a = 0) {
  if (t === e) return t;
  if (a > 500) return e;
  const r = Bt(t) && Bt(e);
  if (!r && !(Ct(t) && Ct(e))) return e;
  const l = (r ? t : Object.keys(t)).length,
    u = r ? e : Object.keys(e),
    n = u.length,
    d = r ? new Array(n) : {};
  let h = 0;
  for (let f = 0; f < n; f++) {
    const R = r ? f : u[f],
      y = t[R],
      s = e[R];
    if (y === s) {
      ((d[R] = y), (r ? f < l : Te.call(t, R)) && h++);
      continue;
    }
    if (
      y === null ||
      s === null ||
      typeof y != "object" ||
      typeof s != "object"
    ) {
      d[R] = s;
      continue;
    }
    const M = Qt(y, s, a + 1);
    ((d[R] = M), M === y && h++);
  }
  return l === n && h === l ? t : d;
}
function Sa(t, e) {
  if (!e || Object.keys(t).length !== Object.keys(e).length) return !1;
  for (const a in t) if (t[a] !== e[a]) return !1;
  return !0;
}
function Bt(t) {
  return Array.isArray(t) && t.length === Object.keys(t).length;
}
function Ct(t) {
  if (!Ut(t)) return !1;
  const e = t.constructor;
  if (e === void 0) return !0;
  const a = e.prototype;
  return !(
    !Ut(a) ||
    !a.hasOwnProperty("isPrototypeOf") ||
    Object.getPrototypeOf(t) !== Object.prototype
  );
}
function Ut(t) {
  return Object.prototype.toString.call(t) === "[object Object]";
}
function ke(t) {
  return new Promise((e) => {
    St.setTimeout(e, t);
  });
}
function Me(t, e, a) {
  return typeof a.structuralSharing == "function"
    ? a.structuralSharing(t, e)
    : a.structuralSharing !== !1
      ? Qt(t, e)
      : e;
}
function Ea(t, e, a = 0) {
  const r = [...t, e];
  return a && r.length > a ? r.slice(1) : r;
}
function Ca(t, e, a = 0) {
  const r = [e, ...t];
  return a && r.length > a ? r.slice(0, -1) : r;
}
var Gt = Symbol();
function Fe(t, e) {
  return !t.queryFn && e?.initialPromise
    ? () => e.initialPromise
    : !t.queryFn || t.queryFn === Gt
      ? () => Promise.reject(new Error(`Missing queryFn: '${t.queryHash}'`))
      : t.queryFn;
}
function Ta(t, e) {
  return typeof t == "function" ? t(...e) : !!t;
}
function ka(t, e, a) {
  let r = !1,
    i;
  return (
    Object.defineProperty(t, "signal", {
      enumerable: !0,
      get: () => (
        (i ??= e()),
        r ||
          ((r = !0),
          i.aborted ? a() : i.addEventListener("abort", a, { once: !0 })),
        i
      ),
    }),
    t
  );
}
var Re = class extends Yt {
    #e;
    #a;
    #t;
    constructor() {
      (super(),
        (this.#t = (t) => {
          if (!mt && window.addEventListener) {
            const e = () => t();
            return (
              window.addEventListener("visibilitychange", e, !1),
              () => {
                window.removeEventListener("visibilitychange", e);
              }
            );
          }
        }));
    }
    onSubscribe() {
      this.#a || this.setEventListener(this.#t);
    }
    onUnsubscribe() {
      this.hasListeners() || (this.#a?.(), (this.#a = void 0));
    }
    setEventListener(t) {
      ((this.#t = t),
        this.#a?.(),
        (this.#a = t((e) => {
          typeof e == "boolean" ? this.setFocused(e) : this.onFocus();
        })));
    }
    setFocused(t) {
      this.#e !== t && ((this.#e = t), this.onFocus());
    }
    onFocus() {
      const t = this.isFocused();
      this.listeners.forEach((e) => {
        e(t);
      });
    }
    isFocused() {
      return typeof this.#e == "boolean"
        ? this.#e
        : globalThis.document?.visibilityState !== "hidden";
    }
  },
  Pe = new Re();
function je() {
  let t, e;
  const a = new Promise((i, l) => {
    ((t = i), (e = l));
  });
  ((a.status = "pending"), a.catch(() => {}));
  function r(i) {
    (Object.assign(a, i), delete a.resolve, delete a.reject);
  }
  return (
    (a.resolve = (i) => {
      (r({ status: "fulfilled", value: i }), t(i));
    }),
    (a.reject = (i) => {
      (r({ status: "rejected", reason: i }), e(i));
    }),
    a
  );
}
var Ne = be;
function Oe() {
  let t = [],
    e = 0,
    a = (n) => {
      n();
    },
    r = (n) => {
      n();
    },
    i = Ne;
  const l = (n) => {
      e
        ? t.push(n)
        : i(() => {
            a(n);
          });
    },
    u = () => {
      const n = t;
      ((t = []),
        n.length &&
          i(() => {
            r(() => {
              n.forEach((d) => {
                a(d);
              });
            });
          }));
    };
  return {
    batch: (n) => {
      let d;
      e++;
      try {
        d = n();
      } finally {
        (e--, e || u());
      }
      return d;
    },
    batchCalls:
      (n) =>
      (...d) => {
        l(() => {
          n(...d);
        });
      },
    schedule: l,
    setNotifyFunction: (n) => {
      a = n;
    },
    setBatchNotifyFunction: (n) => {
      r = n;
    },
    setScheduler: (n) => {
      i = n;
    },
  };
}
var Vt = Oe(),
  Ie = class extends Yt {
    #e = !0;
    #a;
    #t;
    constructor() {
      (super(),
        (this.#t = (t) => {
          if (!mt && window.addEventListener) {
            const e = () => t(!0),
              a = () => t(!1);
            return (
              window.addEventListener("online", e, !1),
              window.addEventListener("offline", a, !1),
              () => {
                (window.removeEventListener("online", e),
                  window.removeEventListener("offline", a));
              }
            );
          }
        }));
    }
    onSubscribe() {
      this.#a || this.setEventListener(this.#t);
    }
    onUnsubscribe() {
      this.hasListeners() || (this.#a?.(), (this.#a = void 0));
    }
    setEventListener(t) {
      ((this.#t = t), this.#a?.(), (this.#a = t(this.setOnline.bind(this))));
    }
    setOnline(t) {
      this.#e !== t &&
        ((this.#e = t),
        this.listeners.forEach((a) => {
          a(t);
        }));
    }
    isOnline() {
      return this.#e;
    }
  },
  Wt = new Ie();
function Ae(t) {
  return Math.min(1e3 * 2 ** t, 3e4);
}
function _t(t) {
  return (t ?? "online") === "online" ? Wt.isOnline() : !0;
}
var Tt = class extends Error {
  constructor(t) {
    (super("CancelledError"),
      (this.revert = t?.revert),
      (this.silent = t?.silent));
  }
};
function Jt(t) {
  let e = !1,
    a = 0,
    r;
  const i = je(),
    l = () => i.status !== "pending",
    u = (m) => {
      if (!l()) {
        const k = new Tt(m);
        (y(k), t.onCancel?.(k));
      }
    },
    n = () => {
      e = !0;
    },
    d = () => {
      e = !1;
    },
    h = () =>
      Pe.isFocused() &&
      (t.networkMode === "always" || Wt.isOnline()) &&
      t.canRun(),
    f = () => _t(t.networkMode) && t.canRun(),
    R = (m) => {
      l() || (r?.(), i.resolve(m));
    },
    y = (m) => {
      l() || (r?.(), i.reject(m));
    },
    s = () =>
      new Promise((m) => {
        ((r = (k) => {
          (l() || h()) && m(k);
        }),
          t.onPause?.());
      }).then(() => {
        ((r = void 0), l() || t.onContinue?.());
      }),
    M = () => {
      if (l()) return;
      let m;
      const k = a === 0 ? t.initialPromise : void 0;
      try {
        m = k ?? t.fn();
      } catch (F) {
        m = Promise.reject(F);
      }
      Promise.resolve(m)
        .then(R)
        .catch((F) => {
          if (l()) return;
          const P = t.retry ?? (mt ? 0 : 3),
            j = t.retryDelay ?? Ae,
            V = typeof j == "function" ? j(a, F) : j,
            E =
              P === !0 ||
              (typeof P == "number" && a < P) ||
              (typeof P == "function" && P(a, F));
          if (e || !E) {
            y(F);
            return;
          }
          (a++,
            t.onFail?.(a, F),
            ke(V)
              .then(() => (h() ? void 0 : s()))
              .then(() => {
                e ? y(F) : M();
              }));
        });
    };
  return {
    promise: i,
    status: () => i.status,
    cancel: u,
    continue: () => (r?.(), i),
    cancelRetry: n,
    continueRetry: d,
    canStart: f,
    start: () => (f() ? M() : s().then(M), i),
  };
}
var Xt = class {
    #e;
    destroy() {
      this.clearGcTimeout();
    }
    scheduleGc() {
      (this.clearGcTimeout(),
        we(this.gcTime) &&
          (this.#e = St.setTimeout(() => {
            this.optionalRemove();
          }, this.gcTime)));
    }
    updateGcTime(t) {
      this.gcTime = Math.max(this.gcTime || 0, t ?? (mt ? 1 / 0 : 300 * 1e3));
    }
    clearGcTimeout() {
      this.#e && (St.clearTimeout(this.#e), (this.#e = void 0));
    }
  },
  Ma = class extends Xt {
    #e;
    #a;
    #t;
    #r;
    #s;
    #o;
    #i;
    constructor(t) {
      (super(),
        (this.#i = !1),
        (this.#o = t.defaultOptions),
        this.setOptions(t.options),
        (this.observers = []),
        (this.#r = t.client),
        (this.#t = this.#r.getQueryCache()),
        (this.queryKey = t.queryKey),
        (this.queryHash = t.queryHash),
        (this.#e = qt(this.options)),
        (this.state = t.state ?? this.#e),
        this.scheduleGc());
    }
    get meta() {
      return this.options.meta;
    }
    get promise() {
      return this.#s?.promise;
    }
    setOptions(t) {
      if (
        ((this.options = { ...this.#o, ...t }),
        this.updateGcTime(this.options.gcTime),
        this.state && this.state.data === void 0)
      ) {
        const e = qt(this.options);
        e.data !== void 0 &&
          (this.setState(zt(e.data, e.dataUpdatedAt)), (this.#e = e));
      }
    }
    optionalRemove() {
      !this.observers.length &&
        this.state.fetchStatus === "idle" &&
        this.#t.remove(this);
    }
    setData(t, e) {
      const a = Me(this.state.data, t, this.options);
      return (
        this.#n({
          data: a,
          type: "success",
          dataUpdatedAt: e?.updatedAt,
          manual: e?.manual,
        }),
        a
      );
    }
    setState(t, e) {
      this.#n({ type: "setState", state: t, setStateOptions: e });
    }
    cancel(t) {
      const e = this.#s?.promise;
      return (this.#s?.cancel(t), e ? e.then(Lt).catch(Lt) : Promise.resolve());
    }
    destroy() {
      (super.destroy(), this.cancel({ silent: !0 }));
    }
    reset() {
      (this.destroy(), this.setState(this.#e));
    }
    isActive() {
      return this.observers.some((t) => Ee(t.options.enabled, this) !== !1);
    }
    isDisabled() {
      return this.getObserversCount() > 0
        ? !this.isActive()
        : this.options.queryFn === Gt ||
            this.state.dataUpdateCount + this.state.errorUpdateCount === 0;
    }
    isStatic() {
      return this.getObserversCount() > 0
        ? this.observers.some((t) => Se(t.options.staleTime, this) === "static")
        : !1;
    }
    isStale() {
      return this.getObserversCount() > 0
        ? this.observers.some((t) => t.getCurrentResult().isStale)
        : this.state.data === void 0 || this.state.isInvalidated;
    }
    isStaleByTime(t = 0) {
      return this.state.data === void 0
        ? !0
        : t === "static"
          ? !1
          : this.state.isInvalidated
            ? !0
            : !xe(this.state.dataUpdatedAt, t);
    }
    onFocus() {
      (this.observers
        .find((e) => e.shouldFetchOnWindowFocus())
        ?.refetch({ cancelRefetch: !1 }),
        this.#s?.continue());
    }
    onOnline() {
      (this.observers
        .find((e) => e.shouldFetchOnReconnect())
        ?.refetch({ cancelRefetch: !1 }),
        this.#s?.continue());
    }
    addObserver(t) {
      this.observers.includes(t) ||
        (this.observers.push(t),
        this.clearGcTimeout(),
        this.#t.notify({ type: "observerAdded", query: this, observer: t }));
    }
    removeObserver(t) {
      this.observers.includes(t) &&
        ((this.observers = this.observers.filter((e) => e !== t)),
        this.observers.length ||
          (this.#s &&
            (this.#i ? this.#s.cancel({ revert: !0 }) : this.#s.cancelRetry()),
          this.scheduleGc()),
        this.#t.notify({ type: "observerRemoved", query: this, observer: t }));
    }
    getObserversCount() {
      return this.observers.length;
    }
    invalidate() {
      this.state.isInvalidated || this.#n({ type: "invalidate" });
    }
    async fetch(t, e) {
      if (
        this.state.fetchStatus !== "idle" &&
        this.#s?.status() !== "rejected"
      ) {
        if (this.state.data !== void 0 && e?.cancelRefetch)
          this.cancel({ silent: !0 });
        else if (this.#s) return (this.#s.continueRetry(), this.#s.promise);
      }
      if ((t && this.setOptions(t), !this.options.queryFn)) {
        const n = this.observers.find((d) => d.options.queryFn);
        n && this.setOptions(n.options);
      }
      const a = new AbortController(),
        r = (n) => {
          Object.defineProperty(n, "signal", {
            enumerable: !0,
            get: () => ((this.#i = !0), a.signal),
          });
        },
        i = () => {
          const n = Fe(this.options, e),
            h = (() => {
              const f = {
                client: this.#r,
                queryKey: this.queryKey,
                meta: this.meta,
              };
              return (r(f), f);
            })();
          return (
            (this.#i = !1),
            this.options.persister ? this.options.persister(n, h, this) : n(h)
          );
        },
        u = (() => {
          const n = {
            fetchOptions: e,
            options: this.options,
            queryKey: this.queryKey,
            client: this.#r,
            state: this.state,
            fetchFn: i,
          };
          return (r(n), n);
        })();
      (this.options.behavior?.onFetch(u, this),
        (this.#a = this.state),
        (this.state.fetchStatus === "idle" ||
          this.state.fetchMeta !== u.fetchOptions?.meta) &&
          this.#n({ type: "fetch", meta: u.fetchOptions?.meta }),
        (this.#s = Jt({
          initialPromise: e?.initialPromise,
          fn: u.fetchFn,
          onCancel: (n) => {
            (n instanceof Tt &&
              n.revert &&
              this.setState({ ...this.#a, fetchStatus: "idle" }),
              a.abort());
          },
          onFail: (n, d) => {
            this.#n({ type: "failed", failureCount: n, error: d });
          },
          onPause: () => {
            this.#n({ type: "pause" });
          },
          onContinue: () => {
            this.#n({ type: "continue" });
          },
          retry: u.options.retry,
          retryDelay: u.options.retryDelay,
          networkMode: u.options.networkMode,
          canRun: () => !0,
        })));
      try {
        const n = await this.#s.start();
        if (n === void 0)
          throw new Error(`${this.queryHash} data is undefined`);
        return (
          this.setData(n),
          this.#t.config.onSuccess?.(n, this),
          this.#t.config.onSettled?.(n, this.state.error, this),
          n
        );
      } catch (n) {
        if (n instanceof Tt) {
          if (n.silent) return this.#s.promise;
          if (n.revert) {
            if (this.state.data === void 0) throw n;
            return this.state.data;
          }
        }
        throw (
          this.#n({ type: "error", error: n }),
          this.#t.config.onError?.(n, this),
          this.#t.config.onSettled?.(this.state.data, n, this),
          n
        );
      } finally {
        this.scheduleGc();
      }
    }
    #n(t) {
      const e = (a) => {
        switch (t.type) {
          case "failed":
            return {
              ...a,
              fetchFailureCount: t.failureCount,
              fetchFailureReason: t.error,
            };
          case "pause":
            return { ...a, fetchStatus: "paused" };
          case "continue":
            return { ...a, fetchStatus: "fetching" };
          case "fetch":
            return {
              ...a,
              ...De(a.data, this.options),
              fetchMeta: t.meta ?? null,
            };
          case "success":
            const r = {
              ...a,
              ...zt(t.data, t.dataUpdatedAt),
              dataUpdateCount: a.dataUpdateCount + 1,
              ...(!t.manual && {
                fetchStatus: "idle",
                fetchFailureCount: 0,
                fetchFailureReason: null,
              }),
            };
            return ((this.#a = t.manual ? r : void 0), r);
          case "error":
            const i = t.error;
            return {
              ...a,
              error: i,
              errorUpdateCount: a.errorUpdateCount + 1,
              errorUpdatedAt: Date.now(),
              fetchFailureCount: a.fetchFailureCount + 1,
              fetchFailureReason: i,
              fetchStatus: "idle",
              status: "error",
              isInvalidated: !0,
            };
          case "invalidate":
            return { ...a, isInvalidated: !0 };
          case "setState":
            return { ...a, ...t.state };
        }
      };
      ((this.state = e(this.state)),
        Vt.batch(() => {
          (this.observers.forEach((a) => {
            a.onQueryUpdate();
          }),
            this.#t.notify({ query: this, type: "updated", action: t }));
        }));
    }
  };
function De(t, e) {
  return {
    fetchFailureCount: 0,
    fetchFailureReason: null,
    fetchStatus: _t(e.networkMode) ? "fetching" : "paused",
    ...(t === void 0 && { error: null, status: "pending" }),
  };
}
function zt(t, e) {
  return {
    data: t,
    dataUpdatedAt: e ?? Date.now(),
    error: null,
    isInvalidated: !1,
    status: "success",
  };
}
function qt(t) {
  const e =
      typeof t.initialData == "function" ? t.initialData() : t.initialData,
    a = e !== void 0,
    r = a
      ? typeof t.initialDataUpdatedAt == "function"
        ? t.initialDataUpdatedAt()
        : t.initialDataUpdatedAt
      : 0;
  return {
    data: e,
    dataUpdateCount: 0,
    dataUpdatedAt: a ? (r ?? Date.now()) : 0,
    error: null,
    errorUpdateCount: 0,
    errorUpdatedAt: 0,
    fetchFailureCount: 0,
    fetchFailureReason: null,
    fetchMeta: null,
    isInvalidated: !1,
    status: a ? "success" : "pending",
    fetchStatus: "idle",
  };
}
var Fa = class extends Xt {
  #e;
  #a;
  #t;
  #r;
  constructor(t) {
    (super(),
      (this.#e = t.client),
      (this.mutationId = t.mutationId),
      (this.#t = t.mutationCache),
      (this.#a = []),
      (this.state = t.state || Le()),
      this.setOptions(t.options),
      this.scheduleGc());
  }
  setOptions(t) {
    ((this.options = t), this.updateGcTime(this.options.gcTime));
  }
  get meta() {
    return this.options.meta;
  }
  addObserver(t) {
    this.#a.includes(t) ||
      (this.#a.push(t),
      this.clearGcTimeout(),
      this.#t.notify({ type: "observerAdded", mutation: this, observer: t }));
  }
  removeObserver(t) {
    ((this.#a = this.#a.filter((e) => e !== t)),
      this.scheduleGc(),
      this.#t.notify({ type: "observerRemoved", mutation: this, observer: t }));
  }
  optionalRemove() {
    this.#a.length ||
      (this.state.status === "pending"
        ? this.scheduleGc()
        : this.#t.remove(this));
  }
  continue() {
    return this.#r?.continue() ?? this.execute(this.state.variables);
  }
  async execute(t) {
    const e = () => {
        this.#s({ type: "continue" });
      },
      a = {
        client: this.#e,
        meta: this.options.meta,
        mutationKey: this.options.mutationKey,
      };
    this.#r = Jt({
      fn: () =>
        this.options.mutationFn
          ? this.options.mutationFn(t, a)
          : Promise.reject(new Error("No mutationFn found")),
      onFail: (l, u) => {
        this.#s({ type: "failed", failureCount: l, error: u });
      },
      onPause: () => {
        this.#s({ type: "pause" });
      },
      onContinue: e,
      retry: this.options.retry ?? 0,
      retryDelay: this.options.retryDelay,
      networkMode: this.options.networkMode,
      canRun: () => this.#t.canRun(this),
    });
    const r = this.state.status === "pending",
      i = !this.#r.canStart();
    try {
      if (r) e();
      else {
        (this.#s({ type: "pending", variables: t, isPaused: i }),
          this.#t.config.onMutate &&
            (await this.#t.config.onMutate(t, this, a)));
        const u = await this.options.onMutate?.(t, a);
        u !== this.state.context &&
          this.#s({ type: "pending", context: u, variables: t, isPaused: i });
      }
      const l = await this.#r.start();
      return (
        await this.#t.config.onSuccess?.(l, t, this.state.context, this, a),
        await this.options.onSuccess?.(l, t, this.state.context, a),
        await this.#t.config.onSettled?.(
          l,
          null,
          this.state.variables,
          this.state.context,
          this,
          a,
        ),
        await this.options.onSettled?.(l, null, t, this.state.context, a),
        this.#s({ type: "success", data: l }),
        l
      );
    } catch (l) {
      try {
        await this.#t.config.onError?.(l, t, this.state.context, this, a);
      } catch (u) {
        Promise.reject(u);
      }
      try {
        await this.options.onError?.(l, t, this.state.context, a);
      } catch (u) {
        Promise.reject(u);
      }
      try {
        await this.#t.config.onSettled?.(
          void 0,
          l,
          this.state.variables,
          this.state.context,
          this,
          a,
        );
      } catch (u) {
        Promise.reject(u);
      }
      try {
        await this.options.onSettled?.(void 0, l, t, this.state.context, a);
      } catch (u) {
        Promise.reject(u);
      }
      throw (this.#s({ type: "error", error: l }), l);
    } finally {
      this.#t.runNext(this);
    }
  }
  #s(t) {
    const e = (a) => {
      switch (t.type) {
        case "failed":
          return { ...a, failureCount: t.failureCount, failureReason: t.error };
        case "pause":
          return { ...a, isPaused: !0 };
        case "continue":
          return { ...a, isPaused: !1 };
        case "pending":
          return {
            ...a,
            context: t.context,
            data: void 0,
            failureCount: 0,
            failureReason: null,
            error: null,
            isPaused: t.isPaused,
            status: "pending",
            variables: t.variables,
            submittedAt: Date.now(),
          };
        case "success":
          return {
            ...a,
            data: t.data,
            failureCount: 0,
            failureReason: null,
            error: null,
            status: "success",
            isPaused: !1,
          };
        case "error":
          return {
            ...a,
            data: void 0,
            error: t.error,
            failureCount: a.failureCount + 1,
            failureReason: t.error,
            isPaused: !1,
            status: "error",
          };
      }
    };
    ((this.state = e(this.state)),
      Vt.batch(() => {
        (this.#a.forEach((a) => {
          a.onMutationUpdate(t);
        }),
          this.#t.notify({ mutation: this, type: "updated", action: t }));
      }));
  }
};
function Le() {
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
var Zt = w.createContext(void 0),
  Ra = (t) => {
    const e = w.useContext(Zt);
    if (!e)
      throw new Error("No QueryClient set, use QueryClientProvider to set one");
    return e;
  },
  Pa = ({ client: t, children: e }) => (
    w.useEffect(
      () => (
        t.mount(),
        () => {
          t.unmount();
        }
      ),
      [t],
    ),
    pe.jsx(Zt.Provider, { value: t, children: e })
  ),
  Be = (t, e, a, r, i, l, u, n) => {
    let d = document.documentElement,
      h = ["light", "dark"];
    function f(s) {
      ((Array.isArray(t) ? t : [t]).forEach((M) => {
        let m = M === "class",
          k = m && l ? i.map((F) => l[F] || F) : i;
        m
          ? (d.classList.remove(...k), d.classList.add(l && l[s] ? l[s] : s))
          : d.setAttribute(M, s);
      }),
        R(s));
    }
    function R(s) {
      n && h.includes(s) && (d.style.colorScheme = s);
    }
    function y() {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    if (r) f(r);
    else
      try {
        let s = localStorage.getItem(e) || a,
          M = u && s === "system" ? y() : s;
        f(M);
      } catch {}
  },
  $t = ["light", "dark"],
  te = "(prefers-color-scheme: dark)",
  Ue = typeof window > "u",
  Ft = w.createContext(void 0),
  ze = { setTheme: (t) => {}, themes: [] },
  ja = () => {
    var t;
    return (t = w.useContext(Ft)) != null ? t : ze;
  },
  Na = (t) =>
    w.useContext(Ft)
      ? w.createElement(w.Fragment, null, t.children)
      : w.createElement($e, { ...t }),
  qe = ["light", "dark"],
  $e = ({
    forcedTheme: t,
    disableTransitionOnChange: e = !1,
    enableSystem: a = !0,
    enableColorScheme: r = !0,
    storageKey: i = "theme",
    themes: l = qe,
    defaultTheme: u = a ? "system" : "light",
    attribute: n = "data-theme",
    value: d,
    children: h,
    nonce: f,
    scriptProps: R,
  }) => {
    let [y, s] = w.useState(() => Ke(i, u)),
      [M, m] = w.useState(() => (y === "system" ? xt() : y)),
      k = d ? Object.values(d) : l,
      F = w.useCallback(
        (E) => {
          let g = E;
          if (!g) return;
          E === "system" && a && (g = xt());
          let D = d ? d[g] : g,
            W = e ? Ye(f) : null,
            H = document.documentElement,
            Z = (L) => {
              L === "class"
                ? (H.classList.remove(...k), D && H.classList.add(D))
                : L.startsWith("data-") &&
                  (D ? H.setAttribute(L, D) : H.removeAttribute(L));
            };
          if ((Array.isArray(n) ? n.forEach(Z) : Z(n), r)) {
            let L = $t.includes(u) ? u : null,
              B = $t.includes(g) ? g : L;
            H.style.colorScheme = B;
          }
          W?.();
        },
        [f],
      ),
      P = w.useCallback(
        (E) => {
          let g = typeof E == "function" ? E(y) : E;
          s(g);
          try {
            localStorage.setItem(i, g);
          } catch {}
        },
        [y],
      ),
      j = w.useCallback(
        (E) => {
          let g = xt(E);
          (m(g), y === "system" && a && !t && F("system"));
        },
        [y, t],
      );
    (w.useEffect(() => {
      let E = window.matchMedia(te);
      return (E.addListener(j), j(E), () => E.removeListener(j));
    }, [j]),
      w.useEffect(() => {
        let E = (g) => {
          g.key === i && (g.newValue ? s(g.newValue) : P(u));
        };
        return (
          window.addEventListener("storage", E),
          () => window.removeEventListener("storage", E)
        );
      }, [P]),
      w.useEffect(() => {
        F(t ?? y);
      }, [t, y]));
    let V = w.useMemo(
      () => ({
        theme: y,
        setTheme: P,
        forcedTheme: t,
        resolvedTheme: y === "system" ? M : y,
        themes: a ? [...l, "system"] : l,
        systemTheme: a ? M : void 0,
      }),
      [y, P, t, M, a, l],
    );
    return w.createElement(
      Ft.Provider,
      { value: V },
      w.createElement(He, {
        forcedTheme: t,
        storageKey: i,
        attribute: n,
        enableSystem: a,
        enableColorScheme: r,
        defaultTheme: u,
        value: d,
        themes: l,
        nonce: f,
        scriptProps: R,
      }),
      h,
    );
  },
  He = w.memo(
    ({
      forcedTheme: t,
      storageKey: e,
      attribute: a,
      enableSystem: r,
      enableColorScheme: i,
      defaultTheme: l,
      value: u,
      themes: n,
      nonce: d,
      scriptProps: h,
    }) => {
      let f = JSON.stringify([a, e, l, t, n, u, r, i]).slice(1, -1);
      return w.createElement("script", {
        ...h,
        suppressHydrationWarning: !0,
        nonce: typeof window > "u" ? d : "",
        dangerouslySetInnerHTML: { __html: `(${Be.toString()})(${f})` },
      });
    },
  ),
  Ke = (t, e) => {
    if (Ue) return;
    let a;
    try {
      a = localStorage.getItem(t) || void 0;
    } catch {}
    return a || e;
  },
  Ye = (t) => {
    let e = document.createElement("style");
    return (
      t && e.setAttribute("nonce", t),
      e.appendChild(
        document.createTextNode(
          "*,*::before,*::after{-webkit-transition:none!important;-moz-transition:none!important;-o-transition:none!important;-ms-transition:none!important;transition:none!important}",
        ),
      ),
      document.head.appendChild(e),
      () => {
        (window.getComputedStyle(document.body),
          setTimeout(() => {
            document.head.removeChild(e);
          }, 1));
      }
    );
  },
  xt = (t) => (t || (t = window.matchMedia(te)), t.matches ? "dark" : "light");
typeof window < "u" &&
  window.addEventListener("message", (t) => {
    t.data?.type === "builder.fusion.chatRunning" &&
      window.dispatchEvent(
        new CustomEvent("builder.fusion.chatRunning", {
          detail: t.data.detail,
        }),
      );
  });
let ee = null;
typeof window < "u" &&
  window.addEventListener("message", (t) => {
    t.data?.type === "builder.harnessOrigin" &&
      t.data.origin &&
      (ee = t.data.origin);
  });
function Oa() {
  return ee || (typeof window < "u" ? window.location.origin : "");
}
var Qe = (t) => {
    switch (t) {
      case "success":
        return We;
      case "info":
        return Je;
      case "warning":
        return _e;
      case "error":
        return Xe;
      default:
        return null;
    }
  },
  Ge = Array(12).fill(0),
  Ve = ({ visible: t, className: e }) =>
    o.createElement(
      "div",
      {
        className: ["sonner-loading-wrapper", e].filter(Boolean).join(" "),
        "data-visible": t,
      },
      o.createElement(
        "div",
        { className: "sonner-spinner" },
        Ge.map((a, r) =>
          o.createElement("div", {
            className: "sonner-loading-bar",
            key: `spinner-bar-${r}`,
          }),
        ),
      ),
    ),
  We = o.createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 20 20",
      fill: "currentColor",
      height: "20",
      width: "20",
    },
    o.createElement("path", {
      fillRule: "evenodd",
      d: "M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z",
      clipRule: "evenodd",
    }),
  ),
  _e = o.createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 24 24",
      fill: "currentColor",
      height: "20",
      width: "20",
    },
    o.createElement("path", {
      fillRule: "evenodd",
      d: "M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z",
      clipRule: "evenodd",
    }),
  ),
  Je = o.createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 20 20",
      fill: "currentColor",
      height: "20",
      width: "20",
    },
    o.createElement("path", {
      fillRule: "evenodd",
      d: "M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z",
      clipRule: "evenodd",
    }),
  ),
  Xe = o.createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 20 20",
      fill: "currentColor",
      height: "20",
      width: "20",
    },
    o.createElement("path", {
      fillRule: "evenodd",
      d: "M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z",
      clipRule: "evenodd",
    }),
  ),
  Ze = o.createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: "12",
      height: "12",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.5",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    o.createElement("line", { x1: "18", y1: "6", x2: "6", y2: "18" }),
    o.createElement("line", { x1: "6", y1: "6", x2: "18", y2: "18" }),
  ),
  ta = () => {
    let [t, e] = o.useState(document.hidden);
    return (
      o.useEffect(() => {
        let a = () => {
          e(document.hidden);
        };
        return (
          document.addEventListener("visibilitychange", a),
          () => window.removeEventListener("visibilitychange", a)
        );
      }, []),
      t
    );
  },
  kt = 1,
  ea = class {
    constructor() {
      ((this.subscribe = (t) => (
        this.subscribers.push(t),
        () => {
          let e = this.subscribers.indexOf(t);
          this.subscribers.splice(e, 1);
        }
      )),
        (this.publish = (t) => {
          this.subscribers.forEach((e) => e(t));
        }),
        (this.addToast = (t) => {
          (this.publish(t), (this.toasts = [...this.toasts, t]));
        }),
        (this.create = (t) => {
          var e;
          let { message: a, ...r } = t,
            i =
              typeof t?.id == "number" ||
              ((e = t.id) == null ? void 0 : e.length) > 0
                ? t.id
                : kt++,
            l = this.toasts.find((n) => n.id === i),
            u = t.dismissible === void 0 ? !0 : t.dismissible;
          return (
            this.dismissedToasts.has(i) && this.dismissedToasts.delete(i),
            l
              ? (this.toasts = this.toasts.map((n) =>
                  n.id === i
                    ? (this.publish({ ...n, ...t, id: i, title: a }),
                      { ...n, ...t, id: i, dismissible: u, title: a })
                    : n,
                ))
              : this.addToast({ title: a, ...r, dismissible: u, id: i }),
            i
          );
        }),
        (this.dismiss = (t) => (
          this.dismissedToasts.add(t),
          t ||
            this.toasts.forEach((e) => {
              this.subscribers.forEach((a) => a({ id: e.id, dismiss: !0 }));
            }),
          this.subscribers.forEach((e) => e({ id: t, dismiss: !0 })),
          t
        )),
        (this.message = (t, e) => this.create({ ...e, message: t })),
        (this.error = (t, e) =>
          this.create({ ...e, message: t, type: "error" })),
        (this.success = (t, e) =>
          this.create({ ...e, type: "success", message: t })),
        (this.info = (t, e) => this.create({ ...e, type: "info", message: t })),
        (this.warning = (t, e) =>
          this.create({ ...e, type: "warning", message: t })),
        (this.loading = (t, e) =>
          this.create({ ...e, type: "loading", message: t })),
        (this.promise = (t, e) => {
          if (!e) return;
          let a;
          e.loading !== void 0 &&
            (a = this.create({
              ...e,
              promise: t,
              type: "loading",
              message: e.loading,
              description:
                typeof e.description != "function" ? e.description : void 0,
            }));
          let r = t instanceof Promise ? t : t(),
            i = a !== void 0,
            l,
            u = r
              .then(async (d) => {
                if (((l = ["resolve", d]), o.isValidElement(d)))
                  ((i = !1),
                    this.create({ id: a, type: "default", message: d }));
                else if (sa(d) && !d.ok) {
                  i = !1;
                  let h =
                      typeof e.error == "function"
                        ? await e.error(`HTTP error! status: ${d.status}`)
                        : e.error,
                    f =
                      typeof e.description == "function"
                        ? await e.description(`HTTP error! status: ${d.status}`)
                        : e.description;
                  this.create({
                    id: a,
                    type: "error",
                    message: h,
                    description: f,
                  });
                } else if (e.success !== void 0) {
                  i = !1;
                  let h =
                      typeof e.success == "function"
                        ? await e.success(d)
                        : e.success,
                    f =
                      typeof e.description == "function"
                        ? await e.description(d)
                        : e.description;
                  this.create({
                    id: a,
                    type: "success",
                    message: h,
                    description: f,
                  });
                }
              })
              .catch(async (d) => {
                if (((l = ["reject", d]), e.error !== void 0)) {
                  i = !1;
                  let h =
                      typeof e.error == "function" ? await e.error(d) : e.error,
                    f =
                      typeof e.description == "function"
                        ? await e.description(d)
                        : e.description;
                  this.create({
                    id: a,
                    type: "error",
                    message: h,
                    description: f,
                  });
                }
              })
              .finally(() => {
                var d;
                (i && (this.dismiss(a), (a = void 0)),
                  (d = e.finally) == null || d.call(e));
              }),
            n = () =>
              new Promise((d, h) =>
                u.then(() => (l[0] === "reject" ? h(l[1]) : d(l[1]))).catch(h),
              );
          return typeof a != "string" && typeof a != "number"
            ? { unwrap: n }
            : Object.assign(a, { unwrap: n });
        }),
        (this.custom = (t, e) => {
          let a = e?.id || kt++;
          return (this.create({ jsx: t(a), id: a, ...e }), a);
        }),
        (this.getActiveToasts = () =>
          this.toasts.filter((t) => !this.dismissedToasts.has(t.id))),
        (this.subscribers = []),
        (this.toasts = []),
        (this.dismissedToasts = new Set()));
    }
  },
  O = new ea(),
  aa = (t, e) => {
    let a = e?.id || kt++;
    return (O.addToast({ title: t, ...e, id: a }), a);
  },
  sa = (t) =>
    t &&
    typeof t == "object" &&
    "ok" in t &&
    typeof t.ok == "boolean" &&
    "status" in t &&
    typeof t.status == "number",
  ra = aa,
  na = () => O.toasts,
  ia = () => O.getActiveToasts(),
  Ia = Object.assign(
    ra,
    {
      success: O.success,
      info: O.info,
      warning: O.warning,
      error: O.error,
      custom: O.custom,
      message: O.message,
      promise: O.promise,
      dismiss: O.dismiss,
      loading: O.loading,
    },
    { getHistory: na, getToasts: ia },
  );
function oa(t, { insertAt: e } = {}) {
  if (typeof document > "u") return;
  let a = document.head || document.getElementsByTagName("head")[0],
    r = document.createElement("style");
  ((r.type = "text/css"),
    e === "top" && a.firstChild
      ? a.insertBefore(r, a.firstChild)
      : a.appendChild(r),
    r.styleSheet
      ? (r.styleSheet.cssText = t)
      : r.appendChild(document.createTextNode(t)));
}
oa(`:where(html[dir="ltr"]),:where([data-sonner-toaster][dir="ltr"]){--toast-icon-margin-start: -3px;--toast-icon-margin-end: 4px;--toast-svg-margin-start: -1px;--toast-svg-margin-end: 0px;--toast-button-margin-start: auto;--toast-button-margin-end: 0;--toast-close-button-start: 0;--toast-close-button-end: unset;--toast-close-button-transform: translate(-35%, -35%)}:where(html[dir="rtl"]),:where([data-sonner-toaster][dir="rtl"]){--toast-icon-margin-start: 4px;--toast-icon-margin-end: -3px;--toast-svg-margin-start: 0px;--toast-svg-margin-end: -1px;--toast-button-margin-start: 0;--toast-button-margin-end: auto;--toast-close-button-start: unset;--toast-close-button-end: 0;--toast-close-button-transform: translate(35%, -35%)}:where([data-sonner-toaster]){position:fixed;width:var(--width);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,Noto Sans,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol,Noto Color Emoji;--gray1: hsl(0, 0%, 99%);--gray2: hsl(0, 0%, 97.3%);--gray3: hsl(0, 0%, 95.1%);--gray4: hsl(0, 0%, 93%);--gray5: hsl(0, 0%, 90.9%);--gray6: hsl(0, 0%, 88.7%);--gray7: hsl(0, 0%, 85.8%);--gray8: hsl(0, 0%, 78%);--gray9: hsl(0, 0%, 56.1%);--gray10: hsl(0, 0%, 52.3%);--gray11: hsl(0, 0%, 43.5%);--gray12: hsl(0, 0%, 9%);--border-radius: 8px;box-sizing:border-box;padding:0;margin:0;list-style:none;outline:none;z-index:999999999;transition:transform .4s ease}:where([data-sonner-toaster][data-lifted="true"]){transform:translateY(-10px)}@media (hover: none) and (pointer: coarse){:where([data-sonner-toaster][data-lifted="true"]){transform:none}}:where([data-sonner-toaster][data-x-position="right"]){right:var(--offset-right)}:where([data-sonner-toaster][data-x-position="left"]){left:var(--offset-left)}:where([data-sonner-toaster][data-x-position="center"]){left:50%;transform:translate(-50%)}:where([data-sonner-toaster][data-y-position="top"]){top:var(--offset-top)}:where([data-sonner-toaster][data-y-position="bottom"]){bottom:var(--offset-bottom)}:where([data-sonner-toast]){--y: translateY(100%);--lift-amount: calc(var(--lift) * var(--gap));z-index:var(--z-index);position:absolute;opacity:0;transform:var(--y);filter:blur(0);touch-action:none;transition:transform .4s,opacity .4s,height .4s,box-shadow .2s;box-sizing:border-box;outline:none;overflow-wrap:anywhere}:where([data-sonner-toast][data-styled="true"]){padding:16px;background:var(--normal-bg);border:1px solid var(--normal-border);color:var(--normal-text);border-radius:var(--border-radius);box-shadow:0 4px 12px #0000001a;width:var(--width);font-size:13px;display:flex;align-items:center;gap:6px}:where([data-sonner-toast]:focus-visible){box-shadow:0 4px 12px #0000001a,0 0 0 2px #0003}:where([data-sonner-toast][data-y-position="top"]){top:0;--y: translateY(-100%);--lift: 1;--lift-amount: calc(1 * var(--gap))}:where([data-sonner-toast][data-y-position="bottom"]){bottom:0;--y: translateY(100%);--lift: -1;--lift-amount: calc(var(--lift) * var(--gap))}:where([data-sonner-toast]) :where([data-description]){font-weight:400;line-height:1.4;color:inherit}:where([data-sonner-toast]) :where([data-title]){font-weight:500;line-height:1.5;color:inherit}:where([data-sonner-toast]) :where([data-icon]){display:flex;height:16px;width:16px;position:relative;justify-content:flex-start;align-items:center;flex-shrink:0;margin-left:var(--toast-icon-margin-start);margin-right:var(--toast-icon-margin-end)}:where([data-sonner-toast][data-promise="true"]) :where([data-icon])>svg{opacity:0;transform:scale(.8);transform-origin:center;animation:sonner-fade-in .3s ease forwards}:where([data-sonner-toast]) :where([data-icon])>*{flex-shrink:0}:where([data-sonner-toast]) :where([data-icon]) svg{margin-left:var(--toast-svg-margin-start);margin-right:var(--toast-svg-margin-end)}:where([data-sonner-toast]) :where([data-content]){display:flex;flex-direction:column;gap:2px}[data-sonner-toast][data-styled=true] [data-button]{border-radius:4px;padding-left:8px;padding-right:8px;height:24px;font-size:12px;color:var(--normal-bg);background:var(--normal-text);margin-left:var(--toast-button-margin-start);margin-right:var(--toast-button-margin-end);border:none;cursor:pointer;outline:none;display:flex;align-items:center;flex-shrink:0;transition:opacity .4s,box-shadow .2s}:where([data-sonner-toast]) :where([data-button]):focus-visible{box-shadow:0 0 0 2px #0006}:where([data-sonner-toast]) :where([data-button]):first-of-type{margin-left:var(--toast-button-margin-start);margin-right:var(--toast-button-margin-end)}:where([data-sonner-toast]) :where([data-cancel]){color:var(--normal-text);background:rgba(0,0,0,.08)}:where([data-sonner-toast][data-theme="dark"]) :where([data-cancel]){background:rgba(255,255,255,.3)}:where([data-sonner-toast]) :where([data-close-button]){position:absolute;left:var(--toast-close-button-start);right:var(--toast-close-button-end);top:0;height:20px;width:20px;display:flex;justify-content:center;align-items:center;padding:0;color:var(--gray12);border:1px solid var(--gray4);transform:var(--toast-close-button-transform);border-radius:50%;cursor:pointer;z-index:1;transition:opacity .1s,background .2s,border-color .2s}[data-sonner-toast] [data-close-button]{background:var(--gray1)}:where([data-sonner-toast]) :where([data-close-button]):focus-visible{box-shadow:0 4px 12px #0000001a,0 0 0 2px #0003}:where([data-sonner-toast]) :where([data-disabled="true"]){cursor:not-allowed}:where([data-sonner-toast]):hover :where([data-close-button]):hover{background:var(--gray2);border-color:var(--gray5)}:where([data-sonner-toast][data-swiping="true"]):before{content:"";position:absolute;left:-50%;right:-50%;height:100%;z-index:-1}:where([data-sonner-toast][data-y-position="top"][data-swiping="true"]):before{bottom:50%;transform:scaleY(3) translateY(50%)}:where([data-sonner-toast][data-y-position="bottom"][data-swiping="true"]):before{top:50%;transform:scaleY(3) translateY(-50%)}:where([data-sonner-toast][data-swiping="false"][data-removed="true"]):before{content:"";position:absolute;inset:0;transform:scaleY(2)}:where([data-sonner-toast]):after{content:"";position:absolute;left:0;height:calc(var(--gap) + 1px);bottom:100%;width:100%}:where([data-sonner-toast][data-mounted="true"]){--y: translateY(0);opacity:1}:where([data-sonner-toast][data-expanded="false"][data-front="false"]){--scale: var(--toasts-before) * .05 + 1;--y: translateY(calc(var(--lift-amount) * var(--toasts-before))) scale(calc(-1 * var(--scale)));height:var(--front-toast-height)}:where([data-sonner-toast])>*{transition:opacity .4s}:where([data-sonner-toast][data-expanded="false"][data-front="false"][data-styled="true"])>*{opacity:0}:where([data-sonner-toast][data-visible="false"]){opacity:0;pointer-events:none}:where([data-sonner-toast][data-mounted="true"][data-expanded="true"]){--y: translateY(calc(var(--lift) * var(--offset)));height:var(--initial-height)}:where([data-sonner-toast][data-removed="true"][data-front="true"][data-swipe-out="false"]){--y: translateY(calc(var(--lift) * -100%));opacity:0}:where([data-sonner-toast][data-removed="true"][data-front="false"][data-swipe-out="false"][data-expanded="true"]){--y: translateY(calc(var(--lift) * var(--offset) + var(--lift) * -100%));opacity:0}:where([data-sonner-toast][data-removed="true"][data-front="false"][data-swipe-out="false"][data-expanded="false"]){--y: translateY(40%);opacity:0;transition:transform .5s,opacity .2s}:where([data-sonner-toast][data-removed="true"][data-front="false"]):before{height:calc(var(--initial-height) + 20%)}[data-sonner-toast][data-swiping=true]{transform:var(--y) translateY(var(--swipe-amount-y, 0px)) translate(var(--swipe-amount-x, 0px));transition:none}[data-sonner-toast][data-swiped=true]{user-select:none}[data-sonner-toast][data-swipe-out=true][data-y-position=bottom],[data-sonner-toast][data-swipe-out=true][data-y-position=top]{animation-duration:.2s;animation-timing-function:ease-out;animation-fill-mode:forwards}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=left]{animation-name:swipe-out-left}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=right]{animation-name:swipe-out-right}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=up]{animation-name:swipe-out-up}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=down]{animation-name:swipe-out-down}@keyframes swipe-out-left{0%{transform:var(--y) translate(var(--swipe-amount-x));opacity:1}to{transform:var(--y) translate(calc(var(--swipe-amount-x) - 100%));opacity:0}}@keyframes swipe-out-right{0%{transform:var(--y) translate(var(--swipe-amount-x));opacity:1}to{transform:var(--y) translate(calc(var(--swipe-amount-x) + 100%));opacity:0}}@keyframes swipe-out-up{0%{transform:var(--y) translateY(var(--swipe-amount-y));opacity:1}to{transform:var(--y) translateY(calc(var(--swipe-amount-y) - 100%));opacity:0}}@keyframes swipe-out-down{0%{transform:var(--y) translateY(var(--swipe-amount-y));opacity:1}to{transform:var(--y) translateY(calc(var(--swipe-amount-y) + 100%));opacity:0}}@media (max-width: 600px){[data-sonner-toaster]{position:fixed;right:var(--mobile-offset-right);left:var(--mobile-offset-left);width:100%}[data-sonner-toaster][dir=rtl]{left:calc(var(--mobile-offset-left) * -1)}[data-sonner-toaster] [data-sonner-toast]{left:0;right:0;width:calc(100% - var(--mobile-offset-left) * 2)}[data-sonner-toaster][data-x-position=left]{left:var(--mobile-offset-left)}[data-sonner-toaster][data-y-position=bottom]{bottom:var(--mobile-offset-bottom)}[data-sonner-toaster][data-y-position=top]{top:var(--mobile-offset-top)}[data-sonner-toaster][data-x-position=center]{left:var(--mobile-offset-left);right:var(--mobile-offset-right);transform:none}}[data-sonner-toaster][data-theme=light]{--normal-bg: #fff;--normal-border: var(--gray4);--normal-text: var(--gray12);--success-bg: hsl(143, 85%, 96%);--success-border: hsl(145, 92%, 91%);--success-text: hsl(140, 100%, 27%);--info-bg: hsl(208, 100%, 97%);--info-border: hsl(221, 91%, 91%);--info-text: hsl(210, 92%, 45%);--warning-bg: hsl(49, 100%, 97%);--warning-border: hsl(49, 91%, 91%);--warning-text: hsl(31, 92%, 45%);--error-bg: hsl(359, 100%, 97%);--error-border: hsl(359, 100%, 94%);--error-text: hsl(360, 100%, 45%)}[data-sonner-toaster][data-theme=light] [data-sonner-toast][data-invert=true]{--normal-bg: #000;--normal-border: hsl(0, 0%, 20%);--normal-text: var(--gray1)}[data-sonner-toaster][data-theme=dark] [data-sonner-toast][data-invert=true]{--normal-bg: #fff;--normal-border: var(--gray3);--normal-text: var(--gray12)}[data-sonner-toaster][data-theme=dark]{--normal-bg: #000;--normal-bg-hover: hsl(0, 0%, 12%);--normal-border: hsl(0, 0%, 20%);--normal-border-hover: hsl(0, 0%, 25%);--normal-text: var(--gray1);--success-bg: hsl(150, 100%, 6%);--success-border: hsl(147, 100%, 12%);--success-text: hsl(150, 86%, 65%);--info-bg: hsl(215, 100%, 6%);--info-border: hsl(223, 100%, 12%);--info-text: hsl(216, 87%, 65%);--warning-bg: hsl(64, 100%, 6%);--warning-border: hsl(60, 100%, 12%);--warning-text: hsl(46, 87%, 65%);--error-bg: hsl(358, 76%, 10%);--error-border: hsl(357, 89%, 16%);--error-text: hsl(358, 100%, 81%)}[data-sonner-toaster][data-theme=dark] [data-sonner-toast] [data-close-button]{background:var(--normal-bg);border-color:var(--normal-border);color:var(--normal-text)}[data-sonner-toaster][data-theme=dark] [data-sonner-toast] [data-close-button]:hover{background:var(--normal-bg-hover);border-color:var(--normal-border-hover)}[data-rich-colors=true][data-sonner-toast][data-type=success],[data-rich-colors=true][data-sonner-toast][data-type=success] [data-close-button]{background:var(--success-bg);border-color:var(--success-border);color:var(--success-text)}[data-rich-colors=true][data-sonner-toast][data-type=info],[data-rich-colors=true][data-sonner-toast][data-type=info] [data-close-button]{background:var(--info-bg);border-color:var(--info-border);color:var(--info-text)}[data-rich-colors=true][data-sonner-toast][data-type=warning],[data-rich-colors=true][data-sonner-toast][data-type=warning] [data-close-button]{background:var(--warning-bg);border-color:var(--warning-border);color:var(--warning-text)}[data-rich-colors=true][data-sonner-toast][data-type=error],[data-rich-colors=true][data-sonner-toast][data-type=error] [data-close-button]{background:var(--error-bg);border-color:var(--error-border);color:var(--error-text)}.sonner-loading-wrapper{--size: 16px;height:var(--size);width:var(--size);position:absolute;inset:0;z-index:10}.sonner-loading-wrapper[data-visible=false]{transform-origin:center;animation:sonner-fade-out .2s ease forwards}.sonner-spinner{position:relative;top:50%;left:50%;height:var(--size);width:var(--size)}.sonner-loading-bar{animation:sonner-spin 1.2s linear infinite;background:var(--gray11);border-radius:6px;height:8%;left:-10%;position:absolute;top:-3.9%;width:24%}.sonner-loading-bar:nth-child(1){animation-delay:-1.2s;transform:rotate(.0001deg) translate(146%)}.sonner-loading-bar:nth-child(2){animation-delay:-1.1s;transform:rotate(30deg) translate(146%)}.sonner-loading-bar:nth-child(3){animation-delay:-1s;transform:rotate(60deg) translate(146%)}.sonner-loading-bar:nth-child(4){animation-delay:-.9s;transform:rotate(90deg) translate(146%)}.sonner-loading-bar:nth-child(5){animation-delay:-.8s;transform:rotate(120deg) translate(146%)}.sonner-loading-bar:nth-child(6){animation-delay:-.7s;transform:rotate(150deg) translate(146%)}.sonner-loading-bar:nth-child(7){animation-delay:-.6s;transform:rotate(180deg) translate(146%)}.sonner-loading-bar:nth-child(8){animation-delay:-.5s;transform:rotate(210deg) translate(146%)}.sonner-loading-bar:nth-child(9){animation-delay:-.4s;transform:rotate(240deg) translate(146%)}.sonner-loading-bar:nth-child(10){animation-delay:-.3s;transform:rotate(270deg) translate(146%)}.sonner-loading-bar:nth-child(11){animation-delay:-.2s;transform:rotate(300deg) translate(146%)}.sonner-loading-bar:nth-child(12){animation-delay:-.1s;transform:rotate(330deg) translate(146%)}@keyframes sonner-fade-in{0%{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}}@keyframes sonner-fade-out{0%{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.8)}}@keyframes sonner-spin{0%{opacity:1}to{opacity:.15}}@media (prefers-reduced-motion){[data-sonner-toast],[data-sonner-toast]>*,.sonner-loading-bar{transition:none!important;animation:none!important}}.sonner-loader{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);transform-origin:center;transition:opacity .2s,transform .2s}.sonner-loader[data-visible=false]{opacity:0;transform:scale(.8) translate(-50%,-50%)}
`);
function ft(t) {
  return t.label !== void 0;
}
var la = 3,
  da = "32px",
  ua = "16px",
  Ht = 4e3,
  ca = 356,
  ha = 14,
  fa = 20,
  ma = 200;
function $(...t) {
  return t.filter(Boolean).join(" ");
}
function pa(t) {
  let [e, a] = t.split("-"),
    r = [];
  return (e && r.push(e), a && r.push(a), r);
}
var ya = (t) => {
  var e, a, r, i, l, u, n, d, h, f, R;
  let {
      invert: y,
      toast: s,
      unstyled: M,
      interacting: m,
      setHeights: k,
      visibleToasts: F,
      heights: P,
      index: j,
      toasts: V,
      expanded: E,
      removeToast: g,
      defaultRichColors: D,
      closeButton: W,
      style: H,
      cancelButtonStyle: Z,
      actionButtonStyle: L,
      className: B = "",
      descriptionClassName: lt = "",
      duration: tt,
      position: dt,
      gap: _,
      loadingIcon: K,
      expandByDefault: ut,
      classNames: p,
      icons: I,
      closeButtonAriaLabel: pt = "Close toast",
      pauseWhenPageIsHidden: b,
    } = t,
    [x, C] = o.useState(null),
    [N, et] = o.useState(null),
    [T, yt] = o.useState(!1),
    [nt, ct] = o.useState(!1),
    [it, vt] = o.useState(!1),
    [Rt, ae] = o.useState(!1),
    [se, Pt] = o.useState(!1),
    [re, gt] = o.useState(0),
    [ne, jt] = o.useState(0),
    ot = o.useRef(s.duration || tt || Ht),
    Nt = o.useRef(null),
    J = o.useRef(null),
    ie = j === 0,
    oe = j + 1 <= F,
    A = s.type,
    at = s.dismissible !== !1,
    le = s.className || "",
    de = s.descriptionClassName || "",
    ht = o.useMemo(
      () => P.findIndex((c) => c.toastId === s.id) || 0,
      [P, s.id],
    ),
    ue = o.useMemo(() => {
      var c;
      return (c = s.closeButton) != null ? c : W;
    }, [s.closeButton, W]),
    Ot = o.useMemo(() => s.duration || tt || Ht, [s.duration, tt]),
    bt = o.useRef(0),
    st = o.useRef(0),
    It = o.useRef(0),
    rt = o.useRef(null),
    [ce, he] = dt.split("-"),
    At = o.useMemo(
      () => P.reduce((c, v, S) => (S >= ht ? c : c + v.height), 0),
      [P, ht],
    ),
    Dt = ta(),
    fe = s.invert || y,
    wt = A === "loading";
  ((st.current = o.useMemo(() => ht * _ + At, [ht, At])),
    o.useEffect(() => {
      ot.current = Ot;
    }, [Ot]),
    o.useEffect(() => {
      yt(!0);
    }, []),
    o.useEffect(() => {
      let c = J.current;
      if (c) {
        let v = c.getBoundingClientRect().height;
        return (
          jt(v),
          k((S) => [{ toastId: s.id, height: v, position: s.position }, ...S]),
          () => k((S) => S.filter((U) => U.toastId !== s.id))
        );
      }
    }, [k, s.id]),
    o.useLayoutEffect(() => {
      if (!T) return;
      let c = J.current,
        v = c.style.height;
      c.style.height = "auto";
      let S = c.getBoundingClientRect().height;
      ((c.style.height = v),
        jt(S),
        k((U) =>
          U.find((z) => z.toastId === s.id)
            ? U.map((z) => (z.toastId === s.id ? { ...z, height: S } : z))
            : [{ toastId: s.id, height: S, position: s.position }, ...U],
        ));
    }, [T, s.title, s.description, k, s.id]));
  let Y = o.useCallback(() => {
    (ct(!0),
      gt(st.current),
      k((c) => c.filter((v) => v.toastId !== s.id)),
      setTimeout(() => {
        g(s);
      }, ma));
  }, [s, g, k, st]);
  (o.useEffect(() => {
    if (
      (s.promise && A === "loading") ||
      s.duration === 1 / 0 ||
      s.type === "loading"
    )
      return;
    let c;
    return (
      E || m || (b && Dt)
        ? (() => {
            if (It.current < bt.current) {
              let v = new Date().getTime() - bt.current;
              ot.current = ot.current - v;
            }
            It.current = new Date().getTime();
          })()
        : ot.current !== 1 / 0 &&
          ((bt.current = new Date().getTime()),
          (c = setTimeout(() => {
            var v;
            ((v = s.onAutoClose) == null || v.call(s, s), Y());
          }, ot.current))),
      () => clearTimeout(c)
    );
  }, [E, m, s, A, b, Dt, Y]),
    o.useEffect(() => {
      s.delete && Y();
    }, [Y, s.delete]));
  function me() {
    var c, v, S;
    return I != null && I.loading
      ? o.createElement(
          "div",
          {
            className: $(
              p?.loader,
              (c = s?.classNames) == null ? void 0 : c.loader,
              "sonner-loader",
            ),
            "data-visible": A === "loading",
          },
          I.loading,
        )
      : K
        ? o.createElement(
            "div",
            {
              className: $(
                p?.loader,
                (v = s?.classNames) == null ? void 0 : v.loader,
                "sonner-loader",
              ),
              "data-visible": A === "loading",
            },
            K,
          )
        : o.createElement(Ve, {
            className: $(
              p?.loader,
              (S = s?.classNames) == null ? void 0 : S.loader,
            ),
            visible: A === "loading",
          });
  }
  return o.createElement(
    "li",
    {
      tabIndex: 0,
      ref: J,
      className: $(
        B,
        le,
        p?.toast,
        (e = s?.classNames) == null ? void 0 : e.toast,
        p?.default,
        p?.[A],
        (a = s?.classNames) == null ? void 0 : a[A],
      ),
      "data-sonner-toast": "",
      "data-rich-colors": (r = s.richColors) != null ? r : D,
      "data-styled": !(s.jsx || s.unstyled || M),
      "data-mounted": T,
      "data-promise": !!s.promise,
      "data-swiped": se,
      "data-removed": nt,
      "data-visible": oe,
      "data-y-position": ce,
      "data-x-position": he,
      "data-index": j,
      "data-front": ie,
      "data-swiping": it,
      "data-dismissible": at,
      "data-type": A,
      "data-invert": fe,
      "data-swipe-out": Rt,
      "data-swipe-direction": N,
      "data-expanded": !!(E || (ut && T)),
      style: {
        "--index": j,
        "--toasts-before": j,
        "--z-index": V.length - j,
        "--offset": `${nt ? re : st.current}px`,
        "--initial-height": ut ? "auto" : `${ne}px`,
        ...H,
        ...s.style,
      },
      onDragEnd: () => {
        (vt(!1), C(null), (rt.current = null));
      },
      onPointerDown: (c) => {
        wt ||
          !at ||
          ((Nt.current = new Date()),
          gt(st.current),
          c.target.setPointerCapture(c.pointerId),
          c.target.tagName !== "BUTTON" &&
            (vt(!0), (rt.current = { x: c.clientX, y: c.clientY })));
      },
      onPointerUp: () => {
        var c, v, S, U;
        if (Rt || !at) return;
        rt.current = null;
        let z = Number(
            ((c = J.current) == null
              ? void 0
              : c.style
                  .getPropertyValue("--swipe-amount-x")
                  .replace("px", "")) || 0,
          ),
          Q = Number(
            ((v = J.current) == null
              ? void 0
              : v.style
                  .getPropertyValue("--swipe-amount-y")
                  .replace("px", "")) || 0,
          ),
          X =
            new Date().getTime() -
            ((S = Nt.current) == null ? void 0 : S.getTime()),
          q = x === "x" ? z : Q,
          G = Math.abs(q) / X;
        if (Math.abs(q) >= fa || G > 0.11) {
          (gt(st.current),
            (U = s.onDismiss) == null || U.call(s, s),
            et(x === "x" ? (z > 0 ? "right" : "left") : Q > 0 ? "down" : "up"),
            Y(),
            ae(!0),
            Pt(!1));
          return;
        }
        (vt(!1), C(null));
      },
      onPointerMove: (c) => {
        var v, S, U, z;
        if (
          !rt.current ||
          !at ||
          ((v = window.getSelection()) == null ? void 0 : v.toString().length) >
            0
        )
          return;
        let Q = c.clientY - rt.current.y,
          X = c.clientX - rt.current.x,
          q = (S = t.swipeDirections) != null ? S : pa(dt);
        !x &&
          (Math.abs(X) > 1 || Math.abs(Q) > 1) &&
          C(Math.abs(X) > Math.abs(Q) ? "x" : "y");
        let G = { x: 0, y: 0 };
        (x === "y"
          ? (q.includes("top") || q.includes("bottom")) &&
            ((q.includes("top") && Q < 0) || (q.includes("bottom") && Q > 0)) &&
            (G.y = Q)
          : x === "x" &&
            (q.includes("left") || q.includes("right")) &&
            ((q.includes("left") && X < 0) || (q.includes("right") && X > 0)) &&
            (G.x = X),
          (Math.abs(G.x) > 0 || Math.abs(G.y) > 0) && Pt(!0),
          (U = J.current) == null ||
            U.style.setProperty("--swipe-amount-x", `${G.x}px`),
          (z = J.current) == null ||
            z.style.setProperty("--swipe-amount-y", `${G.y}px`));
      },
    },
    ue && !s.jsx
      ? o.createElement(
          "button",
          {
            "aria-label": pt,
            "data-disabled": wt,
            "data-close-button": !0,
            onClick:
              wt || !at
                ? () => {}
                : () => {
                    var c;
                    (Y(), (c = s.onDismiss) == null || c.call(s, s));
                  },
            className: $(
              p?.closeButton,
              (i = s?.classNames) == null ? void 0 : i.closeButton,
            ),
          },
          (l = I?.close) != null ? l : Ze,
        )
      : null,
    s.jsx || w.isValidElement(s.title)
      ? s.jsx
        ? s.jsx
        : typeof s.title == "function"
          ? s.title()
          : s.title
      : o.createElement(
          o.Fragment,
          null,
          A || s.icon || s.promise
            ? o.createElement(
                "div",
                {
                  "data-icon": "",
                  className: $(
                    p?.icon,
                    (u = s?.classNames) == null ? void 0 : u.icon,
                  ),
                },
                s.promise || (s.type === "loading" && !s.icon)
                  ? s.icon || me()
                  : null,
                s.type !== "loading" ? s.icon || I?.[A] || Qe(A) : null,
              )
            : null,
          o.createElement(
            "div",
            {
              "data-content": "",
              className: $(
                p?.content,
                (n = s?.classNames) == null ? void 0 : n.content,
              ),
            },
            o.createElement(
              "div",
              {
                "data-title": "",
                className: $(
                  p?.title,
                  (d = s?.classNames) == null ? void 0 : d.title,
                ),
              },
              typeof s.title == "function" ? s.title() : s.title,
            ),
            s.description
              ? o.createElement(
                  "div",
                  {
                    "data-description": "",
                    className: $(
                      lt,
                      de,
                      p?.description,
                      (h = s?.classNames) == null ? void 0 : h.description,
                    ),
                  },
                  typeof s.description == "function"
                    ? s.description()
                    : s.description,
                )
              : null,
          ),
          w.isValidElement(s.cancel)
            ? s.cancel
            : s.cancel && ft(s.cancel)
              ? o.createElement(
                  "button",
                  {
                    "data-button": !0,
                    "data-cancel": !0,
                    style: s.cancelButtonStyle || Z,
                    onClick: (c) => {
                      var v, S;
                      ft(s.cancel) &&
                        at &&
                        ((S = (v = s.cancel).onClick) == null || S.call(v, c),
                        Y());
                    },
                    className: $(
                      p?.cancelButton,
                      (f = s?.classNames) == null ? void 0 : f.cancelButton,
                    ),
                  },
                  s.cancel.label,
                )
              : null,
          w.isValidElement(s.action)
            ? s.action
            : s.action && ft(s.action)
              ? o.createElement(
                  "button",
                  {
                    "data-button": !0,
                    "data-action": !0,
                    style: s.actionButtonStyle || L,
                    onClick: (c) => {
                      var v, S;
                      ft(s.action) &&
                        ((S = (v = s.action).onClick) == null || S.call(v, c),
                        !c.defaultPrevented && Y());
                    },
                    className: $(
                      p?.actionButton,
                      (R = s?.classNames) == null ? void 0 : R.actionButton,
                    ),
                  },
                  s.action.label,
                )
              : null,
        ),
  );
};
function Kt() {
  if (typeof window > "u" || typeof document > "u") return "ltr";
  let t = document.documentElement.getAttribute("dir");
  return t === "auto" || !t
    ? window.getComputedStyle(document.documentElement).direction
    : t;
}
function va(t, e) {
  let a = {};
  return (
    [t, e].forEach((r, i) => {
      let l = i === 1,
        u = l ? "--mobile-offset" : "--offset",
        n = l ? ua : da;
      function d(h) {
        ["top", "right", "bottom", "left"].forEach((f) => {
          a[`${u}-${f}`] = typeof h == "number" ? `${h}px` : h;
        });
      }
      typeof r == "number" || typeof r == "string"
        ? d(r)
        : typeof r == "object"
          ? ["top", "right", "bottom", "left"].forEach((h) => {
              r[h] === void 0
                ? (a[`${u}-${h}`] = n)
                : (a[`${u}-${h}`] =
                    typeof r[h] == "number" ? `${r[h]}px` : r[h]);
            })
          : d(n);
    }),
    a
  );
}
var Aa = w.forwardRef(function (t, e) {
  let {
      invert: a,
      position: r = "bottom-right",
      hotkey: i = ["altKey", "KeyT"],
      expand: l,
      closeButton: u,
      className: n,
      offset: d,
      mobileOffset: h,
      theme: f = "light",
      richColors: R,
      duration: y,
      style: s,
      visibleToasts: M = la,
      toastOptions: m,
      dir: k = Kt(),
      gap: F = ha,
      loadingIcon: P,
      icons: j,
      containerAriaLabel: V = "Notifications",
      pauseWhenPageIsHidden: E,
    } = t,
    [g, D] = o.useState([]),
    W = o.useMemo(
      () =>
        Array.from(
          new Set(
            [r].concat(g.filter((b) => b.position).map((b) => b.position)),
          ),
        ),
      [g, r],
    ),
    [H, Z] = o.useState([]),
    [L, B] = o.useState(!1),
    [lt, tt] = o.useState(!1),
    [dt, _] = o.useState(
      f !== "system"
        ? f
        : typeof window < "u" &&
            window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light",
    ),
    K = o.useRef(null),
    ut = i.join("+").replace(/Key/g, "").replace(/Digit/g, ""),
    p = o.useRef(null),
    I = o.useRef(!1),
    pt = o.useCallback((b) => {
      D((x) => {
        var C;
        return (
          ((C = x.find((N) => N.id === b.id)) != null && C.delete) ||
            O.dismiss(b.id),
          x.filter(({ id: N }) => N !== b.id)
        );
      });
    }, []);
  return (
    o.useEffect(
      () =>
        O.subscribe((b) => {
          if (b.dismiss) {
            D((x) => x.map((C) => (C.id === b.id ? { ...C, delete: !0 } : C)));
            return;
          }
          setTimeout(() => {
            ye.flushSync(() => {
              D((x) => {
                let C = x.findIndex((N) => N.id === b.id);
                return C !== -1
                  ? [...x.slice(0, C), { ...x[C], ...b }, ...x.slice(C + 1)]
                  : [b, ...x];
              });
            });
          });
        }),
      [],
    ),
    o.useEffect(() => {
      if (f !== "system") {
        _(f);
        return;
      }
      if (
        (f === "system" &&
          (window.matchMedia &&
          window.matchMedia("(prefers-color-scheme: dark)").matches
            ? _("dark")
            : _("light")),
        typeof window > "u")
      )
        return;
      let b = window.matchMedia("(prefers-color-scheme: dark)");
      try {
        b.addEventListener("change", ({ matches: x }) => {
          _(x ? "dark" : "light");
        });
      } catch {
        b.addListener(({ matches: C }) => {
          try {
            _(C ? "dark" : "light");
          } catch (N) {
            console.error(N);
          }
        });
      }
    }, [f]),
    o.useEffect(() => {
      g.length <= 1 && B(!1);
    }, [g]),
    o.useEffect(() => {
      let b = (x) => {
        var C, N;
        (i.every((et) => x[et] || x.code === et) &&
          (B(!0), (C = K.current) == null || C.focus()),
          x.code === "Escape" &&
            (document.activeElement === K.current ||
              ((N = K.current) != null &&
                N.contains(document.activeElement))) &&
            B(!1));
      };
      return (
        document.addEventListener("keydown", b),
        () => document.removeEventListener("keydown", b)
      );
    }, [i]),
    o.useEffect(() => {
      if (K.current)
        return () => {
          p.current &&
            (p.current.focus({ preventScroll: !0 }),
            (p.current = null),
            (I.current = !1));
        };
    }, [K.current]),
    o.createElement(
      "section",
      {
        ref: e,
        "aria-label": `${V} ${ut}`,
        tabIndex: -1,
        "aria-live": "polite",
        "aria-relevant": "additions text",
        "aria-atomic": "false",
        suppressHydrationWarning: !0,
      },
      W.map((b, x) => {
        var C;
        let [N, et] = b.split("-");
        return g.length
          ? o.createElement(
              "ol",
              {
                key: b,
                dir: k === "auto" ? Kt() : k,
                tabIndex: -1,
                ref: K,
                className: n,
                "data-sonner-toaster": !0,
                "data-theme": dt,
                "data-y-position": N,
                "data-lifted": L && g.length > 1 && !l,
                "data-x-position": et,
                style: {
                  "--front-toast-height": `${((C = H[0]) == null ? void 0 : C.height) || 0}px`,
                  "--width": `${ca}px`,
                  "--gap": `${F}px`,
                  ...s,
                  ...va(d, h),
                },
                onBlur: (T) => {
                  I.current &&
                    !T.currentTarget.contains(T.relatedTarget) &&
                    ((I.current = !1),
                    p.current &&
                      (p.current.focus({ preventScroll: !0 }),
                      (p.current = null)));
                },
                onFocus: (T) => {
                  (T.target instanceof HTMLElement &&
                    T.target.dataset.dismissible === "false") ||
                    I.current ||
                    ((I.current = !0), (p.current = T.relatedTarget));
                },
                onMouseEnter: () => B(!0),
                onMouseMove: () => B(!0),
                onMouseLeave: () => {
                  lt || B(!1);
                },
                onDragEnd: () => B(!1),
                onPointerDown: (T) => {
                  (T.target instanceof HTMLElement &&
                    T.target.dataset.dismissible === "false") ||
                    tt(!0);
                },
                onPointerUp: () => tt(!1),
              },
              g
                .filter((T) => (!T.position && x === 0) || T.position === b)
                .map((T, yt) => {
                  var nt, ct;
                  return o.createElement(ya, {
                    key: T.id,
                    icons: j,
                    index: yt,
                    toast: T,
                    defaultRichColors: R,
                    duration: (nt = m?.duration) != null ? nt : y,
                    className: m?.className,
                    descriptionClassName: m?.descriptionClassName,
                    invert: a,
                    visibleToasts: M,
                    closeButton: (ct = m?.closeButton) != null ? ct : u,
                    interacting: lt,
                    position: b,
                    style: m?.style,
                    unstyled: m?.unstyled,
                    classNames: m?.classNames,
                    cancelButtonStyle: m?.cancelButtonStyle,
                    actionButtonStyle: m?.actionButtonStyle,
                    removeToast: pt,
                    toasts: g.filter((it) => it.position == T.position),
                    heights: H.filter((it) => it.position == T.position),
                    setHeights: Z,
                    expandByDefault: l,
                    gap: F,
                    loadingIcon: P,
                    expanded: L,
                    pauseWhenPageIsHidden: E,
                    swipeDirections: t.swipeDirections,
                  });
                }),
            )
          : null;
      }),
    )
  );
});
export {
  Aa as $,
  xe as A,
  St as B,
  De as C,
  Me as D,
  Le as E,
  Ta as F,
  Na as J,
  Fa as M,
  Ma as Q,
  Yt as S,
  Ia as a,
  Ca as b,
  Ea as c,
  ka as d,
  Fe as e,
  Lt as f,
  Oa as g,
  Ce as h,
  wa as i,
  Pe as j,
  ba as k,
  Et as l,
  xa as m,
  Vt as n,
  Wt as o,
  Mt as p,
  Pa as q,
  Se as r,
  Gt as s,
  je as t,
  Ra as u,
  Ee as v,
  Sa as w,
  mt as x,
  we as y,
  ja as z,
};
