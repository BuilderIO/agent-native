function Wp(n, o) {
  for (var i = 0; i < o.length; i++) {
    const s = o[i];
    if (typeof s != "string" && !Array.isArray(s)) {
      for (const c in s)
        if (c !== "default" && !(c in n)) {
          const f = Object.getOwnPropertyDescriptor(s, c);
          f &&
            Object.defineProperty(
              n,
              c,
              f.get ? f : { enumerable: !0, get: () => s[c] },
            );
        }
    }
  }
  return Object.freeze(
    Object.defineProperty(n, Symbol.toStringTag, { value: "Module" }),
  );
}
function sd(n) {
  return n && n.__esModule && Object.prototype.hasOwnProperty.call(n, "default")
    ? n.default
    : n;
}
var hu = { exports: {} },
  Vl = {},
  pu = { exports: {} },
  Le = {};
var xf;
function Vp() {
  if (xf) return Le;
  xf = 1;
  var n = Symbol.for("react.element"),
    o = Symbol.for("react.portal"),
    i = Symbol.for("react.fragment"),
    s = Symbol.for("react.strict_mode"),
    c = Symbol.for("react.profiler"),
    f = Symbol.for("react.provider"),
    d = Symbol.for("react.context"),
    m = Symbol.for("react.forward_ref"),
    p = Symbol.for("react.suspense"),
    y = Symbol.for("react.memo"),
    S = Symbol.for("react.lazy"),
    v = Symbol.iterator;
  function k(P) {
    return P === null || typeof P != "object"
      ? null
      : ((P = (v && P[v]) || P["@@iterator"]),
        typeof P == "function" ? P : null);
  }
  var M = {
      isMounted: function () {
        return !1;
      },
      enqueueForceUpdate: function () {},
      enqueueReplaceState: function () {},
      enqueueSetState: function () {},
    },
    F = Object.assign,
    z = {};
  function _(P, I, ue) {
    ((this.props = P),
      (this.context = I),
      (this.refs = z),
      (this.updater = ue || M));
  }
  ((_.prototype.isReactComponent = {}),
    (_.prototype.setState = function (P, I) {
      if (typeof P != "object" && typeof P != "function" && P != null)
        throw Error(
          "setState(...): takes an object of state variables to update or a function which returns an object of state variables.",
        );
      this.updater.enqueueSetState(this, P, I, "setState");
    }),
    (_.prototype.forceUpdate = function (P) {
      this.updater.enqueueForceUpdate(this, P, "forceUpdate");
    }));
  function B() {}
  B.prototype = _.prototype;
  function j(P, I, ue) {
    ((this.props = P),
      (this.context = I),
      (this.refs = z),
      (this.updater = ue || M));
  }
  var K = (j.prototype = new B());
  ((K.constructor = j), F(K, _.prototype), (K.isPureReactComponent = !0));
  var Y = Array.isArray,
    J = Object.prototype.hasOwnProperty,
    Z = { current: null },
    he = { key: !0, ref: !0, __self: !0, __source: !0 };
  function L(P, I, ue) {
    var pe,
      ke = {},
      Ee = null,
      Te = null;
    if (I != null)
      for (pe in (I.ref !== void 0 && (Te = I.ref),
      I.key !== void 0 && (Ee = "" + I.key),
      I))
        J.call(I, pe) && !he.hasOwnProperty(pe) && (ke[pe] = I[pe]);
    var Me = arguments.length - 2;
    if (Me === 1) ke.children = ue;
    else if (1 < Me) {
      for (var je = Array(Me), pt = 0; pt < Me; pt++)
        je[pt] = arguments[pt + 2];
      ke.children = je;
    }
    if (P && P.defaultProps)
      for (pe in ((Me = P.defaultProps), Me))
        ke[pe] === void 0 && (ke[pe] = Me[pe]);
    return {
      $$typeof: n,
      type: P,
      key: Ee,
      ref: Te,
      props: ke,
      _owner: Z.current,
    };
  }
  function me(P, I) {
    return {
      $$typeof: n,
      type: P.type,
      key: I,
      ref: P.ref,
      props: P.props,
      _owner: P._owner,
    };
  }
  function ge(P) {
    return typeof P == "object" && P !== null && P.$$typeof === n;
  }
  function De(P) {
    var I = { "=": "=0", ":": "=2" };
    return (
      "$" +
      P.replace(/[=:]/g, function (ue) {
        return I[ue];
      })
    );
  }
  var we = /\/+/g;
  function ze(P, I) {
    return typeof P == "object" && P !== null && P.key != null
      ? De("" + P.key)
      : I.toString(36);
  }
  function xe(P, I, ue, pe, ke) {
    var Ee = typeof P;
    (Ee === "undefined" || Ee === "boolean") && (P = null);
    var Te = !1;
    if (P === null) Te = !0;
    else
      switch (Ee) {
        case "string":
        case "number":
          Te = !0;
          break;
        case "object":
          switch (P.$$typeof) {
            case n:
            case o:
              Te = !0;
          }
      }
    if (Te)
      return (
        (Te = P),
        (ke = ke(Te)),
        (P = pe === "" ? "." + ze(Te, 0) : pe),
        Y(ke)
          ? ((ue = ""),
            P != null && (ue = P.replace(we, "$&/") + "/"),
            xe(ke, I, ue, "", function (pt) {
              return pt;
            }))
          : ke != null &&
            (ge(ke) &&
              (ke = me(
                ke,
                ue +
                  (!ke.key || (Te && Te.key === ke.key)
                    ? ""
                    : ("" + ke.key).replace(we, "$&/") + "/") +
                  P,
              )),
            I.push(ke)),
        1
      );
    if (((Te = 0), (pe = pe === "" ? "." : pe + ":"), Y(P)))
      for (var Me = 0; Me < P.length; Me++) {
        Ee = P[Me];
        var je = pe + ze(Ee, Me);
        Te += xe(Ee, I, ue, je, ke);
      }
    else if (((je = k(P)), typeof je == "function"))
      for (P = je.call(P), Me = 0; !(Ee = P.next()).done; )
        ((Ee = Ee.value),
          (je = pe + ze(Ee, Me++)),
          (Te += xe(Ee, I, ue, je, ke)));
    else if (Ee === "object")
      throw (
        (I = String(P)),
        Error(
          "Objects are not valid as a React child (found: " +
            (I === "[object Object]"
              ? "object with keys {" + Object.keys(P).join(", ") + "}"
              : I) +
            "). If you meant to render a collection of children, use an array instead.",
        )
      );
    return Te;
  }
  function ye(P, I, ue) {
    if (P == null) return P;
    var pe = [],
      ke = 0;
    return (
      xe(P, pe, "", "", function (Ee) {
        return I.call(ue, Ee, ke++);
      }),
      pe
    );
  }
  function Re(P) {
    if (P._status === -1) {
      var I = P._result;
      ((I = I()),
        I.then(
          function (ue) {
            (P._status === 0 || P._status === -1) &&
              ((P._status = 1), (P._result = ue));
          },
          function (ue) {
            (P._status === 0 || P._status === -1) &&
              ((P._status = 2), (P._result = ue));
          },
        ),
        P._status === -1 && ((P._status = 0), (P._result = I)));
    }
    if (P._status === 1) return P._result.default;
    throw P._result;
  }
  var Pe = { current: null },
    Q = { transition: null },
    X = {
      ReactCurrentDispatcher: Pe,
      ReactCurrentBatchConfig: Q,
      ReactCurrentOwner: Z,
    };
  function G() {
    throw Error("act(...) is not supported in production builds of React.");
  }
  return (
    (Le.Children = {
      map: ye,
      forEach: function (P, I, ue) {
        ye(
          P,
          function () {
            I.apply(this, arguments);
          },
          ue,
        );
      },
      count: function (P) {
        var I = 0;
        return (
          ye(P, function () {
            I++;
          }),
          I
        );
      },
      toArray: function (P) {
        return (
          ye(P, function (I) {
            return I;
          }) || []
        );
      },
      only: function (P) {
        if (!ge(P))
          throw Error(
            "React.Children.only expected to receive a single React element child.",
          );
        return P;
      },
    }),
    (Le.Component = _),
    (Le.Fragment = i),
    (Le.Profiler = c),
    (Le.PureComponent = j),
    (Le.StrictMode = s),
    (Le.Suspense = p),
    (Le.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = X),
    (Le.act = G),
    (Le.cloneElement = function (P, I, ue) {
      if (P == null)
        throw Error(
          "React.cloneElement(...): The argument must be a React element, but you passed " +
            P +
            ".",
        );
      var pe = F({}, P.props),
        ke = P.key,
        Ee = P.ref,
        Te = P._owner;
      if (I != null) {
        if (
          (I.ref !== void 0 && ((Ee = I.ref), (Te = Z.current)),
          I.key !== void 0 && (ke = "" + I.key),
          P.type && P.type.defaultProps)
        )
          var Me = P.type.defaultProps;
        for (je in I)
          J.call(I, je) &&
            !he.hasOwnProperty(je) &&
            (pe[je] = I[je] === void 0 && Me !== void 0 ? Me[je] : I[je]);
      }
      var je = arguments.length - 2;
      if (je === 1) pe.children = ue;
      else if (1 < je) {
        Me = Array(je);
        for (var pt = 0; pt < je; pt++) Me[pt] = arguments[pt + 2];
        pe.children = Me;
      }
      return {
        $$typeof: n,
        type: P.type,
        key: ke,
        ref: Ee,
        props: pe,
        _owner: Te,
      };
    }),
    (Le.createContext = function (P) {
      return (
        (P = {
          $$typeof: d,
          _currentValue: P,
          _currentValue2: P,
          _threadCount: 0,
          Provider: null,
          Consumer: null,
          _defaultValue: null,
          _globalName: null,
        }),
        (P.Provider = { $$typeof: f, _context: P }),
        (P.Consumer = P)
      );
    }),
    (Le.createElement = L),
    (Le.createFactory = function (P) {
      var I = L.bind(null, P);
      return ((I.type = P), I);
    }),
    (Le.createRef = function () {
      return { current: null };
    }),
    (Le.forwardRef = function (P) {
      return { $$typeof: m, render: P };
    }),
    (Le.isValidElement = ge),
    (Le.lazy = function (P) {
      return { $$typeof: S, _payload: { _status: -1, _result: P }, _init: Re };
    }),
    (Le.memo = function (P, I) {
      return { $$typeof: y, type: P, compare: I === void 0 ? null : I };
    }),
    (Le.startTransition = function (P) {
      var I = Q.transition;
      Q.transition = {};
      try {
        P();
      } finally {
        Q.transition = I;
      }
    }),
    (Le.unstable_act = G),
    (Le.useCallback = function (P, I) {
      return Pe.current.useCallback(P, I);
    }),
    (Le.useContext = function (P) {
      return Pe.current.useContext(P);
    }),
    (Le.useDebugValue = function () {}),
    (Le.useDeferredValue = function (P) {
      return Pe.current.useDeferredValue(P);
    }),
    (Le.useEffect = function (P, I) {
      return Pe.current.useEffect(P, I);
    }),
    (Le.useId = function () {
      return Pe.current.useId();
    }),
    (Le.useImperativeHandle = function (P, I, ue) {
      return Pe.current.useImperativeHandle(P, I, ue);
    }),
    (Le.useInsertionEffect = function (P, I) {
      return Pe.current.useInsertionEffect(P, I);
    }),
    (Le.useLayoutEffect = function (P, I) {
      return Pe.current.useLayoutEffect(P, I);
    }),
    (Le.useMemo = function (P, I) {
      return Pe.current.useMemo(P, I);
    }),
    (Le.useReducer = function (P, I, ue) {
      return Pe.current.useReducer(P, I, ue);
    }),
    (Le.useRef = function (P) {
      return Pe.current.useRef(P);
    }),
    (Le.useState = function (P) {
      return Pe.current.useState(P);
    }),
    (Le.useSyncExternalStore = function (P, I, ue) {
      return Pe.current.useSyncExternalStore(P, I, ue);
    }),
    (Le.useTransition = function () {
      return Pe.current.useTransition();
    }),
    (Le.version = "18.3.1"),
    Le
  );
}
var Cf;
function Uu() {
  return (Cf || ((Cf = 1), (pu.exports = Vp())), pu.exports);
}
var Pf;
function Qp() {
  if (Pf) return Vl;
  Pf = 1;
  var n = Uu(),
    o = Symbol.for("react.element"),
    i = Symbol.for("react.fragment"),
    s = Object.prototype.hasOwnProperty,
    c = n.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,
    f = { key: !0, ref: !0, __self: !0, __source: !0 };
  function d(m, p, y) {
    var S,
      v = {},
      k = null,
      M = null;
    (y !== void 0 && (k = "" + y),
      p.key !== void 0 && (k = "" + p.key),
      p.ref !== void 0 && (M = p.ref));
    for (S in p) s.call(p, S) && !f.hasOwnProperty(S) && (v[S] = p[S]);
    if (m && m.defaultProps)
      for (S in ((p = m.defaultProps), p)) v[S] === void 0 && (v[S] = p[S]);
    return {
      $$typeof: o,
      type: m,
      key: k,
      ref: M,
      props: v,
      _owner: c.current,
    };
  }
  return ((Vl.Fragment = i), (Vl.jsx = d), (Vl.jsxs = d), Vl);
}
var Lf;
function Yp() {
  return (Lf || ((Lf = 1), (hu.exports = Qp())), hu.exports);
}
var hg = Yp(),
  mu = { exports: {} },
  Pt = {},
  yu = { exports: {} },
  vu = {};
var _f;
function Kp() {
  return (
    _f ||
      ((_f = 1),
      (function (n) {
        function o(Q, X) {
          var G = Q.length;
          Q.push(X);
          e: for (; 0 < G; ) {
            var P = (G - 1) >>> 1,
              I = Q[P];
            if (0 < c(I, X)) ((Q[P] = X), (Q[G] = I), (G = P));
            else break e;
          }
        }
        function i(Q) {
          return Q.length === 0 ? null : Q[0];
        }
        function s(Q) {
          if (Q.length === 0) return null;
          var X = Q[0],
            G = Q.pop();
          if (G !== X) {
            Q[0] = G;
            e: for (var P = 0, I = Q.length, ue = I >>> 1; P < ue; ) {
              var pe = 2 * (P + 1) - 1,
                ke = Q[pe],
                Ee = pe + 1,
                Te = Q[Ee];
              if (0 > c(ke, G))
                Ee < I && 0 > c(Te, ke)
                  ? ((Q[P] = Te), (Q[Ee] = G), (P = Ee))
                  : ((Q[P] = ke), (Q[pe] = G), (P = pe));
              else if (Ee < I && 0 > c(Te, G))
                ((Q[P] = Te), (Q[Ee] = G), (P = Ee));
              else break e;
            }
          }
          return X;
        }
        function c(Q, X) {
          var G = Q.sortIndex - X.sortIndex;
          return G !== 0 ? G : Q.id - X.id;
        }
        if (
          typeof performance == "object" &&
          typeof performance.now == "function"
        ) {
          var f = performance;
          n.unstable_now = function () {
            return f.now();
          };
        } else {
          var d = Date,
            m = d.now();
          n.unstable_now = function () {
            return d.now() - m;
          };
        }
        var p = [],
          y = [],
          S = 1,
          v = null,
          k = 3,
          M = !1,
          F = !1,
          z = !1,
          _ = typeof setTimeout == "function" ? setTimeout : null,
          B = typeof clearTimeout == "function" ? clearTimeout : null,
          j = typeof setImmediate < "u" ? setImmediate : null;
        typeof navigator < "u" &&
          navigator.scheduling !== void 0 &&
          navigator.scheduling.isInputPending !== void 0 &&
          navigator.scheduling.isInputPending.bind(navigator.scheduling);
        function K(Q) {
          for (var X = i(y); X !== null; ) {
            if (X.callback === null) s(y);
            else if (X.startTime <= Q)
              (s(y), (X.sortIndex = X.expirationTime), o(p, X));
            else break;
            X = i(y);
          }
        }
        function Y(Q) {
          if (((z = !1), K(Q), !F))
            if (i(p) !== null) ((F = !0), Re(J));
            else {
              var X = i(y);
              X !== null && Pe(Y, X.startTime - Q);
            }
        }
        function J(Q, X) {
          ((F = !1), z && ((z = !1), B(L), (L = -1)), (M = !0));
          var G = k;
          try {
            for (
              K(X), v = i(p);
              v !== null && (!(v.expirationTime > X) || (Q && !De()));
            ) {
              var P = v.callback;
              if (typeof P == "function") {
                ((v.callback = null), (k = v.priorityLevel));
                var I = P(v.expirationTime <= X);
                ((X = n.unstable_now()),
                  typeof I == "function"
                    ? (v.callback = I)
                    : v === i(p) && s(p),
                  K(X));
              } else s(p);
              v = i(p);
            }
            if (v !== null) var ue = !0;
            else {
              var pe = i(y);
              (pe !== null && Pe(Y, pe.startTime - X), (ue = !1));
            }
            return ue;
          } finally {
            ((v = null), (k = G), (M = !1));
          }
        }
        var Z = !1,
          he = null,
          L = -1,
          me = 5,
          ge = -1;
        function De() {
          return !(n.unstable_now() - ge < me);
        }
        function we() {
          if (he !== null) {
            var Q = n.unstable_now();
            ge = Q;
            var X = !0;
            try {
              X = he(!0, Q);
            } finally {
              X ? ze() : ((Z = !1), (he = null));
            }
          } else Z = !1;
        }
        var ze;
        if (typeof j == "function")
          ze = function () {
            j(we);
          };
        else if (typeof MessageChannel < "u") {
          var xe = new MessageChannel(),
            ye = xe.port2;
          ((xe.port1.onmessage = we),
            (ze = function () {
              ye.postMessage(null);
            }));
        } else
          ze = function () {
            _(we, 0);
          };
        function Re(Q) {
          ((he = Q), Z || ((Z = !0), ze()));
        }
        function Pe(Q, X) {
          L = _(function () {
            Q(n.unstable_now());
          }, X);
        }
        ((n.unstable_IdlePriority = 5),
          (n.unstable_ImmediatePriority = 1),
          (n.unstable_LowPriority = 4),
          (n.unstable_NormalPriority = 3),
          (n.unstable_Profiling = null),
          (n.unstable_UserBlockingPriority = 2),
          (n.unstable_cancelCallback = function (Q) {
            Q.callback = null;
          }),
          (n.unstable_continueExecution = function () {
            F || M || ((F = !0), Re(J));
          }),
          (n.unstable_forceFrameRate = function (Q) {
            0 > Q || 125 < Q
              ? console.error(
                  "forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported",
                )
              : (me = 0 < Q ? Math.floor(1e3 / Q) : 5);
          }),
          (n.unstable_getCurrentPriorityLevel = function () {
            return k;
          }),
          (n.unstable_getFirstCallbackNode = function () {
            return i(p);
          }),
          (n.unstable_next = function (Q) {
            switch (k) {
              case 1:
              case 2:
              case 3:
                var X = 3;
                break;
              default:
                X = k;
            }
            var G = k;
            k = X;
            try {
              return Q();
            } finally {
              k = G;
            }
          }),
          (n.unstable_pauseExecution = function () {}),
          (n.unstable_requestPaint = function () {}),
          (n.unstable_runWithPriority = function (Q, X) {
            switch (Q) {
              case 1:
              case 2:
              case 3:
              case 4:
              case 5:
                break;
              default:
                Q = 3;
            }
            var G = k;
            k = Q;
            try {
              return X();
            } finally {
              k = G;
            }
          }),
          (n.unstable_scheduleCallback = function (Q, X, G) {
            var P = n.unstable_now();
            switch (
              (typeof G == "object" && G !== null
                ? ((G = G.delay),
                  (G = typeof G == "number" && 0 < G ? P + G : P))
                : (G = P),
              Q)
            ) {
              case 1:
                var I = -1;
                break;
              case 2:
                I = 250;
                break;
              case 5:
                I = 1073741823;
                break;
              case 4:
                I = 1e4;
                break;
              default:
                I = 5e3;
            }
            return (
              (I = G + I),
              (Q = {
                id: S++,
                callback: X,
                priorityLevel: Q,
                startTime: G,
                expirationTime: I,
                sortIndex: -1,
              }),
              G > P
                ? ((Q.sortIndex = G),
                  o(y, Q),
                  i(p) === null &&
                    Q === i(y) &&
                    (z ? (B(L), (L = -1)) : (z = !0), Pe(Y, G - P)))
                : ((Q.sortIndex = I), o(p, Q), F || M || ((F = !0), Re(J))),
              Q
            );
          }),
          (n.unstable_shouldYield = De),
          (n.unstable_wrapCallback = function (Q) {
            var X = k;
            return function () {
              var G = k;
              k = X;
              try {
                return Q.apply(this, arguments);
              } finally {
                k = G;
              }
            };
          }));
      })(vu)),
    vu
  );
}
var Tf;
function Xp() {
  return (Tf || ((Tf = 1), (yu.exports = Kp())), yu.exports);
}
var Mf;
function Jp() {
  if (Mf) return Pt;
  Mf = 1;
  var n = Uu(),
    o = Xp();
  function i(e) {
    for (
      var t = "https://reactjs.org/docs/error-decoder.html?invariant=" + e,
        r = 1;
      r < arguments.length;
      r++
    )
      t += "&args[]=" + encodeURIComponent(arguments[r]);
    return (
      "Minified React error #" +
      e +
      "; visit " +
      t +
      " for the full message or use the non-minified dev environment for full errors and additional helpful warnings."
    );
  }
  var s = new Set(),
    c = {};
  function f(e, t) {
    (d(e, t), d(e + "Capture", t));
  }
  function d(e, t) {
    for (c[e] = t, e = 0; e < t.length; e++) s.add(t[e]);
  }
  var m = !(
      typeof window > "u" ||
      typeof window.document > "u" ||
      typeof window.document.createElement > "u"
    ),
    p = Object.prototype.hasOwnProperty,
    y =
      /^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,
    S = {},
    v = {};
  function k(e) {
    return p.call(v, e)
      ? !0
      : p.call(S, e)
        ? !1
        : y.test(e)
          ? (v[e] = !0)
          : ((S[e] = !0), !1);
  }
  function M(e, t, r, l) {
    if (r !== null && r.type === 0) return !1;
    switch (typeof t) {
      case "function":
      case "symbol":
        return !0;
      case "boolean":
        return l
          ? !1
          : r !== null
            ? !r.acceptsBooleans
            : ((e = e.toLowerCase().slice(0, 5)),
              e !== "data-" && e !== "aria-");
      default:
        return !1;
    }
  }
  function F(e, t, r, l) {
    if (t === null || typeof t > "u" || M(e, t, r, l)) return !0;
    if (l) return !1;
    if (r !== null)
      switch (r.type) {
        case 3:
          return !t;
        case 4:
          return t === !1;
        case 5:
          return isNaN(t);
        case 6:
          return isNaN(t) || 1 > t;
      }
    return !1;
  }
  function z(e, t, r, l, a, u, h) {
    ((this.acceptsBooleans = t === 2 || t === 3 || t === 4),
      (this.attributeName = l),
      (this.attributeNamespace = a),
      (this.mustUseProperty = r),
      (this.propertyName = e),
      (this.type = t),
      (this.sanitizeURL = u),
      (this.removeEmptyString = h));
  }
  var _ = {};
  ("children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style"
    .split(" ")
    .forEach(function (e) {
      _[e] = new z(e, 0, !1, e, null, !1, !1);
    }),
    [
      ["acceptCharset", "accept-charset"],
      ["className", "class"],
      ["htmlFor", "for"],
      ["httpEquiv", "http-equiv"],
    ].forEach(function (e) {
      var t = e[0];
      _[t] = new z(t, 1, !1, e[1], null, !1, !1);
    }),
    ["contentEditable", "draggable", "spellCheck", "value"].forEach(
      function (e) {
        _[e] = new z(e, 2, !1, e.toLowerCase(), null, !1, !1);
      },
    ),
    [
      "autoReverse",
      "externalResourcesRequired",
      "focusable",
      "preserveAlpha",
    ].forEach(function (e) {
      _[e] = new z(e, 2, !1, e, null, !1, !1);
    }),
    "allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope"
      .split(" ")
      .forEach(function (e) {
        _[e] = new z(e, 3, !1, e.toLowerCase(), null, !1, !1);
      }),
    ["checked", "multiple", "muted", "selected"].forEach(function (e) {
      _[e] = new z(e, 3, !0, e, null, !1, !1);
    }),
    ["capture", "download"].forEach(function (e) {
      _[e] = new z(e, 4, !1, e, null, !1, !1);
    }),
    ["cols", "rows", "size", "span"].forEach(function (e) {
      _[e] = new z(e, 6, !1, e, null, !1, !1);
    }),
    ["rowSpan", "start"].forEach(function (e) {
      _[e] = new z(e, 5, !1, e.toLowerCase(), null, !1, !1);
    }));
  var B = /[\-:]([a-z])/g;
  function j(e) {
    return e[1].toUpperCase();
  }
  ("accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height"
    .split(" ")
    .forEach(function (e) {
      var t = e.replace(B, j);
      _[t] = new z(t, 1, !1, e, null, !1, !1);
    }),
    "xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type"
      .split(" ")
      .forEach(function (e) {
        var t = e.replace(B, j);
        _[t] = new z(t, 1, !1, e, "http://www.w3.org/1999/xlink", !1, !1);
      }),
    ["xml:base", "xml:lang", "xml:space"].forEach(function (e) {
      var t = e.replace(B, j);
      _[t] = new z(t, 1, !1, e, "http://www.w3.org/XML/1998/namespace", !1, !1);
    }),
    ["tabIndex", "crossOrigin"].forEach(function (e) {
      _[e] = new z(e, 1, !1, e.toLowerCase(), null, !1, !1);
    }),
    (_.xlinkHref = new z(
      "xlinkHref",
      1,
      !1,
      "xlink:href",
      "http://www.w3.org/1999/xlink",
      !0,
      !1,
    )),
    ["src", "href", "action", "formAction"].forEach(function (e) {
      _[e] = new z(e, 1, !1, e.toLowerCase(), null, !0, !0);
    }));
  function K(e, t, r, l) {
    var a = _.hasOwnProperty(t) ? _[t] : null;
    (a !== null
      ? a.type !== 0
      : l ||
        !(2 < t.length) ||
        (t[0] !== "o" && t[0] !== "O") ||
        (t[1] !== "n" && t[1] !== "N")) &&
      (F(t, r, a, l) && (r = null),
      l || a === null
        ? k(t) &&
          (r === null ? e.removeAttribute(t) : e.setAttribute(t, "" + r))
        : a.mustUseProperty
          ? (e[a.propertyName] = r === null ? (a.type === 3 ? !1 : "") : r)
          : ((t = a.attributeName),
            (l = a.attributeNamespace),
            r === null
              ? e.removeAttribute(t)
              : ((a = a.type),
                (r = a === 3 || (a === 4 && r === !0) ? "" : "" + r),
                l ? e.setAttributeNS(l, t, r) : e.setAttribute(t, r))));
  }
  var Y = n.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
    J = Symbol.for("react.element"),
    Z = Symbol.for("react.portal"),
    he = Symbol.for("react.fragment"),
    L = Symbol.for("react.strict_mode"),
    me = Symbol.for("react.profiler"),
    ge = Symbol.for("react.provider"),
    De = Symbol.for("react.context"),
    we = Symbol.for("react.forward_ref"),
    ze = Symbol.for("react.suspense"),
    xe = Symbol.for("react.suspense_list"),
    ye = Symbol.for("react.memo"),
    Re = Symbol.for("react.lazy"),
    Pe = Symbol.for("react.offscreen"),
    Q = Symbol.iterator;
  function X(e) {
    return e === null || typeof e != "object"
      ? null
      : ((e = (Q && e[Q]) || e["@@iterator"]),
        typeof e == "function" ? e : null);
  }
  var G = Object.assign,
    P;
  function I(e) {
    if (P === void 0)
      try {
        throw Error();
      } catch (r) {
        var t = r.stack.trim().match(/\n( *(at )?)/);
        P = (t && t[1]) || "";
      }
    return (
      `
` +
      P +
      e
    );
  }
  var ue = !1;
  function pe(e, t) {
    if (!e || ue) return "";
    ue = !0;
    var r = Error.prepareStackTrace;
    Error.prepareStackTrace = void 0;
    try {
      if (t)
        if (
          ((t = function () {
            throw Error();
          }),
          Object.defineProperty(t.prototype, "props", {
            set: function () {
              throw Error();
            },
          }),
          typeof Reflect == "object" && Reflect.construct)
        ) {
          try {
            Reflect.construct(t, []);
          } catch (O) {
            var l = O;
          }
          Reflect.construct(e, [], t);
        } else {
          try {
            t.call();
          } catch (O) {
            l = O;
          }
          e.call(t.prototype);
        }
      else {
        try {
          throw Error();
        } catch (O) {
          l = O;
        }
        e();
      }
    } catch (O) {
      if (O && l && typeof O.stack == "string") {
        for (
          var a = O.stack.split(`
`),
            u = l.stack.split(`
`),
            h = a.length - 1,
            g = u.length - 1;
          1 <= h && 0 <= g && a[h] !== u[g];
        )
          g--;
        for (; 1 <= h && 0 <= g; h--, g--)
          if (a[h] !== u[g]) {
            if (h !== 1 || g !== 1)
              do
                if ((h--, g--, 0 > g || a[h] !== u[g])) {
                  var E =
                    `
` + a[h].replace(" at new ", " at ");
                  return (
                    e.displayName &&
                      E.includes("<anonymous>") &&
                      (E = E.replace("<anonymous>", e.displayName)),
                    E
                  );
                }
              while (1 <= h && 0 <= g);
            break;
          }
      }
    } finally {
      ((ue = !1), (Error.prepareStackTrace = r));
    }
    return (e = e ? e.displayName || e.name : "") ? I(e) : "";
  }
  function ke(e) {
    switch (e.tag) {
      case 5:
        return I(e.type);
      case 16:
        return I("Lazy");
      case 13:
        return I("Suspense");
      case 19:
        return I("SuspenseList");
      case 0:
      case 2:
      case 15:
        return ((e = pe(e.type, !1)), e);
      case 11:
        return ((e = pe(e.type.render, !1)), e);
      case 1:
        return ((e = pe(e.type, !0)), e);
      default:
        return "";
    }
  }
  function Ee(e) {
    if (e == null) return null;
    if (typeof e == "function") return e.displayName || e.name || null;
    if (typeof e == "string") return e;
    switch (e) {
      case he:
        return "Fragment";
      case Z:
        return "Portal";
      case me:
        return "Profiler";
      case L:
        return "StrictMode";
      case ze:
        return "Suspense";
      case xe:
        return "SuspenseList";
    }
    if (typeof e == "object")
      switch (e.$$typeof) {
        case De:
          return (e.displayName || "Context") + ".Consumer";
        case ge:
          return (e._context.displayName || "Context") + ".Provider";
        case we:
          var t = e.render;
          return (
            (e = e.displayName),
            e ||
              ((e = t.displayName || t.name || ""),
              (e = e !== "" ? "ForwardRef(" + e + ")" : "ForwardRef")),
            e
          );
        case ye:
          return (
            (t = e.displayName || null),
            t !== null ? t : Ee(e.type) || "Memo"
          );
        case Re:
          ((t = e._payload), (e = e._init));
          try {
            return Ee(e(t));
          } catch {}
      }
    return null;
  }
  function Te(e) {
    var t = e.type;
    switch (e.tag) {
      case 24:
        return "Cache";
      case 9:
        return (t.displayName || "Context") + ".Consumer";
      case 10:
        return (t._context.displayName || "Context") + ".Provider";
      case 18:
        return "DehydratedFragment";
      case 11:
        return (
          (e = t.render),
          (e = e.displayName || e.name || ""),
          t.displayName || (e !== "" ? "ForwardRef(" + e + ")" : "ForwardRef")
        );
      case 7:
        return "Fragment";
      case 5:
        return t;
      case 4:
        return "Portal";
      case 3:
        return "Root";
      case 6:
        return "Text";
      case 16:
        return Ee(t);
      case 8:
        return t === L ? "StrictMode" : "Mode";
      case 22:
        return "Offscreen";
      case 12:
        return "Profiler";
      case 21:
        return "Scope";
      case 13:
        return "Suspense";
      case 19:
        return "SuspenseList";
      case 25:
        return "TracingMarker";
      case 1:
      case 0:
      case 17:
      case 2:
      case 14:
      case 15:
        if (typeof t == "function") return t.displayName || t.name || null;
        if (typeof t == "string") return t;
    }
    return null;
  }
  function Me(e) {
    switch (typeof e) {
      case "boolean":
      case "number":
      case "string":
      case "undefined":
        return e;
      case "object":
        return e;
      default:
        return "";
    }
  }
  function je(e) {
    var t = e.type;
    return (
      (e = e.nodeName) &&
      e.toLowerCase() === "input" &&
      (t === "checkbox" || t === "radio")
    );
  }
  function pt(e) {
    var t = je(e) ? "checked" : "value",
      r = Object.getOwnPropertyDescriptor(e.constructor.prototype, t),
      l = "" + e[t];
    if (
      !e.hasOwnProperty(t) &&
      typeof r < "u" &&
      typeof r.get == "function" &&
      typeof r.set == "function"
    ) {
      var a = r.get,
        u = r.set;
      return (
        Object.defineProperty(e, t, {
          configurable: !0,
          get: function () {
            return a.call(this);
          },
          set: function (h) {
            ((l = "" + h), u.call(this, h));
          },
        }),
        Object.defineProperty(e, t, { enumerable: r.enumerable }),
        {
          getValue: function () {
            return l;
          },
          setValue: function (h) {
            l = "" + h;
          },
          stopTracking: function () {
            ((e._valueTracker = null), delete e[t]);
          },
        }
      );
    }
  }
  function En(e) {
    e._valueTracker || (e._valueTracker = pt(e));
  }
  function oo(e) {
    if (!e) return !1;
    var t = e._valueTracker;
    if (!t) return !0;
    var r = t.getValue(),
      l = "";
    return (
      e && (l = je(e) ? (e.checked ? "true" : "false") : e.value),
      (e = l),
      e !== r ? (t.setValue(e), !0) : !1
    );
  }
  function Ge(e) {
    if (
      ((e = e || (typeof document < "u" ? document : void 0)), typeof e > "u")
    )
      return null;
    try {
      return e.activeElement || e.body;
    } catch {
      return e.body;
    }
  }
  function nr(e, t) {
    var r = t.checked;
    return G({}, t, {
      defaultChecked: void 0,
      defaultValue: void 0,
      value: void 0,
      checked: r ?? e._wrapperState.initialChecked,
    });
  }
  function ll(e, t) {
    var r = t.defaultValue == null ? "" : t.defaultValue,
      l = t.checked != null ? t.checked : t.defaultChecked;
    ((r = Me(t.value != null ? t.value : r)),
      (e._wrapperState = {
        initialChecked: l,
        initialValue: r,
        controlled:
          t.type === "checkbox" || t.type === "radio"
            ? t.checked != null
            : t.value != null,
      }));
  }
  function ao(e, t) {
    ((t = t.checked), t != null && K(e, "checked", t, !1));
  }
  function Wt(e, t) {
    ao(e, t);
    var r = Me(t.value),
      l = t.type;
    if (r != null)
      l === "number"
        ? ((r === 0 && e.value === "") || e.value != r) && (e.value = "" + r)
        : e.value !== "" + r && (e.value = "" + r);
    else if (l === "submit" || l === "reset") {
      e.removeAttribute("value");
      return;
    }
    (t.hasOwnProperty("value")
      ? ol(e, t.type, r)
      : t.hasOwnProperty("defaultValue") && ol(e, t.type, Me(t.defaultValue)),
      t.checked == null &&
        t.defaultChecked != null &&
        (e.defaultChecked = !!t.defaultChecked));
  }
  function io(e, t, r) {
    if (t.hasOwnProperty("value") || t.hasOwnProperty("defaultValue")) {
      var l = t.type;
      if (
        !(
          (l !== "submit" && l !== "reset") ||
          (t.value !== void 0 && t.value !== null)
        )
      )
        return;
      ((t = "" + e._wrapperState.initialValue),
        r || t === e.value || (e.value = t),
        (e.defaultValue = t));
    }
    ((r = e.name),
      r !== "" && (e.name = ""),
      (e.defaultChecked = !!e._wrapperState.initialChecked),
      r !== "" && (e.name = r));
  }
  function ol(e, t, r) {
    (t !== "number" || Ge(e.ownerDocument) !== e) &&
      (r == null
        ? (e.defaultValue = "" + e._wrapperState.initialValue)
        : e.defaultValue !== "" + r && (e.defaultValue = "" + r));
  }
  var Cr = Array.isArray;
  function Pr(e, t, r, l) {
    if (((e = e.options), t)) {
      t = {};
      for (var a = 0; a < r.length; a++) t["$" + r[a]] = !0;
      for (r = 0; r < e.length; r++)
        ((a = t.hasOwnProperty("$" + e[r].value)),
          e[r].selected !== a && (e[r].selected = a),
          a && l && (e[r].defaultSelected = !0));
    } else {
      for (r = "" + Me(r), t = null, a = 0; a < e.length; a++) {
        if (e[a].value === r) {
          ((e[a].selected = !0), l && (e[a].defaultSelected = !0));
          return;
        }
        t !== null || e[a].disabled || (t = e[a]);
      }
      t !== null && (t.selected = !0);
    }
  }
  function al(e, t) {
    if (t.dangerouslySetInnerHTML != null) throw Error(i(91));
    return G({}, t, {
      value: void 0,
      defaultValue: void 0,
      children: "" + e._wrapperState.initialValue,
    });
  }
  function uo(e, t) {
    var r = t.value;
    if (r == null) {
      if (((r = t.children), (t = t.defaultValue), r != null)) {
        if (t != null) throw Error(i(92));
        if (Cr(r)) {
          if (1 < r.length) throw Error(i(93));
          r = r[0];
        }
        t = r;
      }
      (t == null && (t = ""), (r = t));
    }
    e._wrapperState = { initialValue: Me(r) };
  }
  function so(e, t) {
    var r = Me(t.value),
      l = Me(t.defaultValue);
    (r != null &&
      ((r = "" + r),
      r !== e.value && (e.value = r),
      t.defaultValue == null && e.defaultValue !== r && (e.defaultValue = r)),
      l != null && (e.defaultValue = "" + l));
  }
  function lr(e) {
    var t = e.textContent;
    t === e._wrapperState.initialValue &&
      t !== "" &&
      t !== null &&
      (e.value = t);
  }
  function Lr(e) {
    switch (e) {
      case "svg":
        return "http://www.w3.org/2000/svg";
      case "math":
        return "http://www.w3.org/1998/Math/MathML";
      default:
        return "http://www.w3.org/1999/xhtml";
    }
  }
  function Rn(e, t) {
    return e == null || e === "http://www.w3.org/1999/xhtml"
      ? Lr(t)
      : e === "http://www.w3.org/2000/svg" && t === "foreignObject"
        ? "http://www.w3.org/1999/xhtml"
        : e;
  }
  var _r,
    zt = (function (e) {
      return typeof MSApp < "u" && MSApp.execUnsafeLocalFunction
        ? function (t, r, l, a) {
            MSApp.execUnsafeLocalFunction(function () {
              return e(t, r, l, a);
            });
          }
        : e;
    })(function (e, t) {
      if (e.namespaceURI !== "http://www.w3.org/2000/svg" || "innerHTML" in e)
        e.innerHTML = t;
      else {
        for (
          _r = _r || document.createElement("div"),
            _r.innerHTML = "<svg>" + t.valueOf().toString() + "</svg>",
            t = _r.firstChild;
          e.firstChild;
        )
          e.removeChild(e.firstChild);
        for (; t.firstChild; ) e.appendChild(t.firstChild);
      }
    });
  function mt(e, t) {
    if (t) {
      var r = e.firstChild;
      if (r && r === e.lastChild && r.nodeType === 3) {
        r.nodeValue = t;
        return;
      }
    }
    e.textContent = t;
  }
  var Tr = {
      animationIterationCount: !0,
      aspectRatio: !0,
      borderImageOutset: !0,
      borderImageSlice: !0,
      borderImageWidth: !0,
      boxFlex: !0,
      boxFlexGroup: !0,
      boxOrdinalGroup: !0,
      columnCount: !0,
      columns: !0,
      flex: !0,
      flexGrow: !0,
      flexPositive: !0,
      flexShrink: !0,
      flexNegative: !0,
      flexOrder: !0,
      gridArea: !0,
      gridRow: !0,
      gridRowEnd: !0,
      gridRowSpan: !0,
      gridRowStart: !0,
      gridColumn: !0,
      gridColumnEnd: !0,
      gridColumnSpan: !0,
      gridColumnStart: !0,
      fontWeight: !0,
      lineClamp: !0,
      lineHeight: !0,
      opacity: !0,
      order: !0,
      orphans: !0,
      tabSize: !0,
      widows: !0,
      zIndex: !0,
      zoom: !0,
      fillOpacity: !0,
      floodOpacity: !0,
      stopOpacity: !0,
      strokeDasharray: !0,
      strokeDashoffset: !0,
      strokeMiterlimit: !0,
      strokeOpacity: !0,
      strokeWidth: !0,
    },
    Oa = ["Webkit", "ms", "Moz", "O"];
  Object.keys(Tr).forEach(function (e) {
    Oa.forEach(function (t) {
      ((t = t + e.charAt(0).toUpperCase() + e.substring(1)), (Tr[t] = Tr[e]));
    });
  });
  function kn(e, t, r) {
    return t == null || typeof t == "boolean" || t === ""
      ? ""
      : r || typeof t != "number" || t === 0 || (Tr.hasOwnProperty(e) && Tr[e])
        ? ("" + t).trim()
        : t + "px";
  }
  function co(e, t) {
    e = e.style;
    for (var r in t)
      if (t.hasOwnProperty(r)) {
        var l = r.indexOf("--") === 0,
          a = kn(r, t[r], l);
        (r === "float" && (r = "cssFloat"),
          l ? e.setProperty(r, a) : (e[r] = a));
      }
  }
  var Vt = G(
    { menuitem: !0 },
    {
      area: !0,
      base: !0,
      br: !0,
      col: !0,
      embed: !0,
      hr: !0,
      img: !0,
      input: !0,
      keygen: !0,
      link: !0,
      meta: !0,
      param: !0,
      source: !0,
      track: !0,
      wbr: !0,
    },
  );
  function xn(e, t) {
    if (t) {
      if (Vt[e] && (t.children != null || t.dangerouslySetInnerHTML != null))
        throw Error(i(137, e));
      if (t.dangerouslySetInnerHTML != null) {
        if (t.children != null) throw Error(i(60));
        if (
          typeof t.dangerouslySetInnerHTML != "object" ||
          !("__html" in t.dangerouslySetInnerHTML)
        )
          throw Error(i(61));
      }
      if (t.style != null && typeof t.style != "object") throw Error(i(62));
    }
  }
  function Cn(e, t) {
    if (e.indexOf("-") === -1) return typeof t.is == "string";
    switch (e) {
      case "annotation-xml":
      case "color-profile":
      case "font-face":
      case "font-face-src":
      case "font-face-uri":
      case "font-face-format":
      case "font-face-name":
      case "missing-glyph":
        return !1;
      default:
        return !0;
    }
  }
  var Pn = null;
  function il(e) {
    return (
      (e = e.target || e.srcElement || window),
      e.correspondingUseElement && (e = e.correspondingUseElement),
      e.nodeType === 3 ? e.parentNode : e
    );
  }
  var Ln = null,
    Qt = null,
    sr = null;
  function _n(e) {
    if ((e = Tl(e))) {
      if (typeof Ln != "function") throw Error(i(280));
      var t = e.stateNode;
      t && ((t = To(t)), Ln(e.stateNode, e.type, t));
    }
  }
  function fo(e) {
    Qt ? (sr ? sr.push(e) : (sr = [e])) : (Qt = e);
  }
  function ul() {
    if (Qt) {
      var e = Qt,
        t = sr;
      if (((sr = Qt = null), _n(e), t)) for (e = 0; e < t.length; e++) _n(t[e]);
    }
  }
  function ho(e, t) {
    return e(t);
  }
  function sl() {}
  var Mr = !1;
  function nn(e, t, r) {
    if (Mr) return e(t, r);
    Mr = !0;
    try {
      return ho(e, t, r);
    } finally {
      ((Mr = !1), (Qt !== null || sr !== null) && (sl(), ul()));
    }
  }
  function Nr(e, t) {
    var r = e.stateNode;
    if (r === null) return null;
    var l = To(r);
    if (l === null) return null;
    r = l[t];
    e: switch (t) {
      case "onClick":
      case "onClickCapture":
      case "onDoubleClick":
      case "onDoubleClickCapture":
      case "onMouseDown":
      case "onMouseDownCapture":
      case "onMouseMove":
      case "onMouseMoveCapture":
      case "onMouseUp":
      case "onMouseUpCapture":
      case "onMouseEnter":
        ((l = !l.disabled) ||
          ((e = e.type),
          (l = !(
            e === "button" ||
            e === "input" ||
            e === "select" ||
            e === "textarea"
          ))),
          (e = !l));
        break e;
      default:
        e = !1;
    }
    if (e) return null;
    if (r && typeof r != "function") throw Error(i(231, t, typeof r));
    return r;
  }
  var cl = !1;
  if (m)
    try {
      var ln = {};
      (Object.defineProperty(ln, "passive", {
        get: function () {
          cl = !0;
        },
      }),
        window.addEventListener("test", ln, ln),
        window.removeEventListener("test", ln, ln));
    } catch {
      cl = !1;
    }
  function w(e, t, r, l, a, u, h, g, E) {
    var O = Array.prototype.slice.call(arguments, 3);
    try {
      t.apply(r, O);
    } catch (A) {
      this.onError(A);
    }
  }
  var C = !1,
    D = null,
    $ = !1,
    W = null,
    oe = {
      onError: function (e) {
        ((C = !0), (D = e));
      },
    };
  function ee(e, t, r, l, a, u, h, g, E) {
    ((C = !1), (D = null), w.apply(oe, arguments));
  }
  function ie(e, t, r, l, a, u, h, g, E) {
    if ((ee.apply(this, arguments), C)) {
      if (C) {
        var O = D;
        ((C = !1), (D = null));
      } else throw Error(i(198));
      $ || (($ = !0), (W = O));
    }
  }
  function b(e) {
    var t = e,
      r = e;
    if (e.alternate) for (; t.return; ) t = t.return;
    else {
      e = t;
      do ((t = e), (t.flags & 4098) !== 0 && (r = t.return), (e = t.return));
      while (e);
    }
    return t.tag === 3 ? r : null;
  }
  function se(e) {
    if (e.tag === 13) {
      var t = e.memoizedState;
      if (
        (t === null && ((e = e.alternate), e !== null && (t = e.memoizedState)),
        t !== null)
      )
        return t.dehydrated;
    }
    return null;
  }
  function ce(e) {
    if (b(e) !== e) throw Error(i(188));
  }
  function ae(e) {
    var t = e.alternate;
    if (!t) {
      if (((t = b(e)), t === null)) throw Error(i(188));
      return t !== e ? null : e;
    }
    for (var r = e, l = t; ; ) {
      var a = r.return;
      if (a === null) break;
      var u = a.alternate;
      if (u === null) {
        if (((l = a.return), l !== null)) {
          r = l;
          continue;
        }
        break;
      }
      if (a.child === u.child) {
        for (u = a.child; u; ) {
          if (u === r) return (ce(a), e);
          if (u === l) return (ce(a), t);
          u = u.sibling;
        }
        throw Error(i(188));
      }
      if (r.return !== l.return) ((r = a), (l = u));
      else {
        for (var h = !1, g = a.child; g; ) {
          if (g === r) {
            ((h = !0), (r = a), (l = u));
            break;
          }
          if (g === l) {
            ((h = !0), (l = a), (r = u));
            break;
          }
          g = g.sibling;
        }
        if (!h) {
          for (g = u.child; g; ) {
            if (g === r) {
              ((h = !0), (r = u), (l = a));
              break;
            }
            if (g === l) {
              ((h = !0), (l = u), (r = a));
              break;
            }
            g = g.sibling;
          }
          if (!h) throw Error(i(189));
        }
      }
      if (r.alternate !== l) throw Error(i(190));
    }
    if (r.tag !== 3) throw Error(i(188));
    return r.stateNode.current === r ? e : t;
  }
  function Fe(e) {
    return ((e = ae(e)), e !== null ? _e(e) : null);
  }
  function _e(e) {
    if (e.tag === 5 || e.tag === 6) return e;
    for (e = e.child; e !== null; ) {
      var t = _e(e);
      if (t !== null) return t;
      e = e.sibling;
    }
    return null;
  }
  var He = o.unstable_scheduleCallback,
    Ze = o.unstable_cancelCallback,
    at = o.unstable_shouldYield,
    Ue = o.unstable_requestPaint,
    Ne = o.unstable_now,
    cr = o.unstable_getCurrentPriorityLevel,
    fr = o.unstable_ImmediatePriority,
    Yt = o.unstable_UserBlockingPriority,
    yt = o.unstable_NormalPriority,
    fl = o.unstable_LowPriority,
    Dr = o.unstable_IdlePriority,
    Ft = null,
    vt = null;
  function Tn(e) {
    if (vt && typeof vt.onCommitFiberRoot == "function")
      try {
        vt.onCommitFiberRoot(Ft, e, void 0, (e.current.flags & 128) === 128);
      } catch {}
  }
  var Se = Math.clz32 ? Math.clz32 : dr,
    rt = Math.log,
    Or = Math.LN2;
  function dr(e) {
    return ((e >>>= 0), e === 0 ? 32 : (31 - ((rt(e) / Or) | 0)) | 0);
  }
  var $e = 64,
    hr = 4194304;
  function zr(e) {
    switch (e & -e) {
      case 1:
        return 1;
      case 2:
        return 2;
      case 4:
        return 4;
      case 8:
        return 8;
      case 16:
        return 16;
      case 32:
        return 32;
      case 64:
      case 128:
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return e & 4194240;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
      case 67108864:
        return e & 130023424;
      case 134217728:
        return 134217728;
      case 268435456:
        return 268435456;
      case 536870912:
        return 536870912;
      case 1073741824:
        return 1073741824;
      default:
        return e;
    }
  }
  function Mn(e, t) {
    var r = e.pendingLanes;
    if (r === 0) return 0;
    var l = 0,
      a = e.suspendedLanes,
      u = e.pingedLanes,
      h = r & 268435455;
    if (h !== 0) {
      var g = h & ~a;
      g !== 0 ? (l = zr(g)) : ((u &= h), u !== 0 && (l = zr(u)));
    } else ((h = r & ~a), h !== 0 ? (l = zr(h)) : u !== 0 && (l = zr(u)));
    if (l === 0) return 0;
    if (
      t !== 0 &&
      t !== l &&
      (t & a) === 0 &&
      ((a = l & -l), (u = t & -t), a >= u || (a === 16 && (u & 4194240) !== 0))
    )
      return t;
    if (((l & 4) !== 0 && (l |= r & 16), (t = e.entangledLanes), t !== 0))
      for (e = e.entanglements, t &= l; 0 < t; )
        ((r = 31 - Se(t)), (a = 1 << r), (l |= e[r]), (t &= ~a));
    return l;
  }
  function uh(e, t) {
    switch (e) {
      case 1:
      case 2:
      case 4:
        return t + 250;
      case 8:
      case 16:
      case 32:
      case 64:
      case 128:
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return t + 5e3;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
      case 67108864:
        return -1;
      case 134217728:
      case 268435456:
      case 536870912:
      case 1073741824:
        return -1;
      default:
        return -1;
    }
  }
  function sh(e, t) {
    for (
      var r = e.suspendedLanes,
        l = e.pingedLanes,
        a = e.expirationTimes,
        u = e.pendingLanes;
      0 < u;
    ) {
      var h = 31 - Se(u),
        g = 1 << h,
        E = a[h];
      (E === -1
        ? ((g & r) === 0 || (g & l) !== 0) && (a[h] = uh(g, t))
        : E <= t && (e.expiredLanes |= g),
        (u &= ~g));
    }
  }
  function za(e) {
    return (
      (e = e.pendingLanes & -1073741825),
      e !== 0 ? e : e & 1073741824 ? 1073741824 : 0
    );
  }
  function es() {
    var e = $e;
    return (($e <<= 1), ($e & 4194240) === 0 && ($e = 64), e);
  }
  function Fa(e) {
    for (var t = [], r = 0; 31 > r; r++) t.push(e);
    return t;
  }
  function dl(e, t, r) {
    ((e.pendingLanes |= t),
      t !== 536870912 && ((e.suspendedLanes = 0), (e.pingedLanes = 0)),
      (e = e.eventTimes),
      (t = 31 - Se(t)),
      (e[t] = r));
  }
  function ch(e, t) {
    var r = e.pendingLanes & ~t;
    ((e.pendingLanes = t),
      (e.suspendedLanes = 0),
      (e.pingedLanes = 0),
      (e.expiredLanes &= t),
      (e.mutableReadLanes &= t),
      (e.entangledLanes &= t),
      (t = e.entanglements));
    var l = e.eventTimes;
    for (e = e.expirationTimes; 0 < r; ) {
      var a = 31 - Se(r),
        u = 1 << a;
      ((t[a] = 0), (l[a] = -1), (e[a] = -1), (r &= ~u));
    }
  }
  function Ia(e, t) {
    var r = (e.entangledLanes |= t);
    for (e = e.entanglements; r; ) {
      var l = 31 - Se(r),
        a = 1 << l;
      ((a & t) | (e[l] & t) && (e[l] |= t), (r &= ~a));
    }
  }
  var Ae = 0;
  function ts(e) {
    return (
      (e &= -e),
      1 < e ? (4 < e ? ((e & 268435455) !== 0 ? 16 : 536870912) : 4) : 1
    );
  }
  var rs,
    ja,
    ns,
    ls,
    os,
    Ua = !1,
    po = [],
    Fr = null,
    Ir = null,
    jr = null,
    hl = new Map(),
    pl = new Map(),
    Ur = [],
    fh =
      "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(
        " ",
      );
  function as(e, t) {
    switch (e) {
      case "focusin":
      case "focusout":
        Fr = null;
        break;
      case "dragenter":
      case "dragleave":
        Ir = null;
        break;
      case "mouseover":
      case "mouseout":
        jr = null;
        break;
      case "pointerover":
      case "pointerout":
        hl.delete(t.pointerId);
        break;
      case "gotpointercapture":
      case "lostpointercapture":
        pl.delete(t.pointerId);
    }
  }
  function ml(e, t, r, l, a, u) {
    return e === null || e.nativeEvent !== u
      ? ((e = {
          blockedOn: t,
          domEventName: r,
          eventSystemFlags: l,
          nativeEvent: u,
          targetContainers: [a],
        }),
        t !== null && ((t = Tl(t)), t !== null && ja(t)),
        e)
      : ((e.eventSystemFlags |= l),
        (t = e.targetContainers),
        a !== null && t.indexOf(a) === -1 && t.push(a),
        e);
  }
  function dh(e, t, r, l, a) {
    switch (t) {
      case "focusin":
        return ((Fr = ml(Fr, e, t, r, l, a)), !0);
      case "dragenter":
        return ((Ir = ml(Ir, e, t, r, l, a)), !0);
      case "mouseover":
        return ((jr = ml(jr, e, t, r, l, a)), !0);
      case "pointerover":
        var u = a.pointerId;
        return (hl.set(u, ml(hl.get(u) || null, e, t, r, l, a)), !0);
      case "gotpointercapture":
        return (
          (u = a.pointerId),
          pl.set(u, ml(pl.get(u) || null, e, t, r, l, a)),
          !0
        );
    }
    return !1;
  }
  function is(e) {
    var t = on(e.target);
    if (t !== null) {
      var r = b(t);
      if (r !== null) {
        if (((t = r.tag), t === 13)) {
          if (((t = se(r)), t !== null)) {
            ((e.blockedOn = t),
              os(e.priority, function () {
                ns(r);
              }));
            return;
          }
        } else if (t === 3 && r.stateNode.current.memoizedState.isDehydrated) {
          e.blockedOn = r.tag === 3 ? r.stateNode.containerInfo : null;
          return;
        }
      }
    }
    e.blockedOn = null;
  }
  function mo(e) {
    if (e.blockedOn !== null) return !1;
    for (var t = e.targetContainers; 0 < t.length; ) {
      var r = $a(e.domEventName, e.eventSystemFlags, t[0], e.nativeEvent);
      if (r === null) {
        r = e.nativeEvent;
        var l = new r.constructor(r.type, r);
        ((Pn = l), r.target.dispatchEvent(l), (Pn = null));
      } else return ((t = Tl(r)), t !== null && ja(t), (e.blockedOn = r), !1);
      t.shift();
    }
    return !0;
  }
  function us(e, t, r) {
    mo(e) && r.delete(t);
  }
  function hh() {
    ((Ua = !1),
      Fr !== null && mo(Fr) && (Fr = null),
      Ir !== null && mo(Ir) && (Ir = null),
      jr !== null && mo(jr) && (jr = null),
      hl.forEach(us),
      pl.forEach(us));
  }
  function yl(e, t) {
    e.blockedOn === t &&
      ((e.blockedOn = null),
      Ua ||
        ((Ua = !0),
        o.unstable_scheduleCallback(o.unstable_NormalPriority, hh)));
  }
  function vl(e) {
    function t(a) {
      return yl(a, e);
    }
    if (0 < po.length) {
      yl(po[0], e);
      for (var r = 1; r < po.length; r++) {
        var l = po[r];
        l.blockedOn === e && (l.blockedOn = null);
      }
    }
    for (
      Fr !== null && yl(Fr, e),
        Ir !== null && yl(Ir, e),
        jr !== null && yl(jr, e),
        hl.forEach(t),
        pl.forEach(t),
        r = 0;
      r < Ur.length;
      r++
    )
      ((l = Ur[r]), l.blockedOn === e && (l.blockedOn = null));
    for (; 0 < Ur.length && ((r = Ur[0]), r.blockedOn === null); )
      (is(r), r.blockedOn === null && Ur.shift());
  }
  var Nn = Y.ReactCurrentBatchConfig,
    yo = !0;
  function ph(e, t, r, l) {
    var a = Ae,
      u = Nn.transition;
    Nn.transition = null;
    try {
      ((Ae = 1), Aa(e, t, r, l));
    } finally {
      ((Ae = a), (Nn.transition = u));
    }
  }
  function mh(e, t, r, l) {
    var a = Ae,
      u = Nn.transition;
    Nn.transition = null;
    try {
      ((Ae = 4), Aa(e, t, r, l));
    } finally {
      ((Ae = a), (Nn.transition = u));
    }
  }
  function Aa(e, t, r, l) {
    if (yo) {
      var a = $a(e, t, r, l);
      if (a === null) (ni(e, t, l, vo, r), as(e, l));
      else if (dh(a, e, t, r, l)) l.stopPropagation();
      else if ((as(e, l), t & 4 && -1 < fh.indexOf(e))) {
        for (; a !== null; ) {
          var u = Tl(a);
          if (
            (u !== null && rs(u),
            (u = $a(e, t, r, l)),
            u === null && ni(e, t, l, vo, r),
            u === a)
          )
            break;
          a = u;
        }
        a !== null && l.stopPropagation();
      } else ni(e, t, l, null, r);
    }
  }
  var vo = null;
  function $a(e, t, r, l) {
    if (((vo = null), (e = il(l)), (e = on(e)), e !== null))
      if (((t = b(e)), t === null)) e = null;
      else if (((r = t.tag), r === 13)) {
        if (((e = se(t)), e !== null)) return e;
        e = null;
      } else if (r === 3) {
        if (t.stateNode.current.memoizedState.isDehydrated)
          return t.tag === 3 ? t.stateNode.containerInfo : null;
        e = null;
      } else t !== e && (e = null);
    return ((vo = e), null);
  }
  function ss(e) {
    switch (e) {
      case "cancel":
      case "click":
      case "close":
      case "contextmenu":
      case "copy":
      case "cut":
      case "auxclick":
      case "dblclick":
      case "dragend":
      case "dragstart":
      case "drop":
      case "focusin":
      case "focusout":
      case "input":
      case "invalid":
      case "keydown":
      case "keypress":
      case "keyup":
      case "mousedown":
      case "mouseup":
      case "paste":
      case "pause":
      case "play":
      case "pointercancel":
      case "pointerdown":
      case "pointerup":
      case "ratechange":
      case "reset":
      case "resize":
      case "seeked":
      case "submit":
      case "touchcancel":
      case "touchend":
      case "touchstart":
      case "volumechange":
      case "change":
      case "selectionchange":
      case "textInput":
      case "compositionstart":
      case "compositionend":
      case "compositionupdate":
      case "beforeblur":
      case "afterblur":
      case "beforeinput":
      case "blur":
      case "fullscreenchange":
      case "focus":
      case "hashchange":
      case "popstate":
      case "select":
      case "selectstart":
        return 1;
      case "drag":
      case "dragenter":
      case "dragexit":
      case "dragleave":
      case "dragover":
      case "mousemove":
      case "mouseout":
      case "mouseover":
      case "pointermove":
      case "pointerout":
      case "pointerover":
      case "scroll":
      case "toggle":
      case "touchmove":
      case "wheel":
      case "mouseenter":
      case "mouseleave":
      case "pointerenter":
      case "pointerleave":
        return 4;
      case "message":
        switch (cr()) {
          case fr:
            return 1;
          case Yt:
            return 4;
          case yt:
          case fl:
            return 16;
          case Dr:
            return 536870912;
          default:
            return 16;
        }
      default:
        return 16;
    }
  }
  var Ar = null,
    Ha = null,
    go = null;
  function cs() {
    if (go) return go;
    var e,
      t = Ha,
      r = t.length,
      l,
      a = "value" in Ar ? Ar.value : Ar.textContent,
      u = a.length;
    for (e = 0; e < r && t[e] === a[e]; e++);
    var h = r - e;
    for (l = 1; l <= h && t[r - l] === a[u - l]; l++);
    return (go = a.slice(e, 1 < l ? 1 - l : void 0));
  }
  function wo(e) {
    var t = e.keyCode;
    return (
      "charCode" in e
        ? ((e = e.charCode), e === 0 && t === 13 && (e = 13))
        : (e = t),
      e === 10 && (e = 13),
      32 <= e || e === 13 ? e : 0
    );
  }
  function So() {
    return !0;
  }
  function fs() {
    return !1;
  }
  function _t(e) {
    function t(r, l, a, u, h) {
      ((this._reactName = r),
        (this._targetInst = a),
        (this.type = l),
        (this.nativeEvent = u),
        (this.target = h),
        (this.currentTarget = null));
      for (var g in e)
        e.hasOwnProperty(g) && ((r = e[g]), (this[g] = r ? r(u) : u[g]));
      return (
        (this.isDefaultPrevented = (
          u.defaultPrevented != null ? u.defaultPrevented : u.returnValue === !1
        )
          ? So
          : fs),
        (this.isPropagationStopped = fs),
        this
      );
    }
    return (
      G(t.prototype, {
        preventDefault: function () {
          this.defaultPrevented = !0;
          var r = this.nativeEvent;
          r &&
            (r.preventDefault
              ? r.preventDefault()
              : typeof r.returnValue != "unknown" && (r.returnValue = !1),
            (this.isDefaultPrevented = So));
        },
        stopPropagation: function () {
          var r = this.nativeEvent;
          r &&
            (r.stopPropagation
              ? r.stopPropagation()
              : typeof r.cancelBubble != "unknown" && (r.cancelBubble = !0),
            (this.isPropagationStopped = So));
        },
        persist: function () {},
        isPersistent: So,
      }),
      t
    );
  }
  var Dn = {
      eventPhase: 0,
      bubbles: 0,
      cancelable: 0,
      timeStamp: function (e) {
        return e.timeStamp || Date.now();
      },
      defaultPrevented: 0,
      isTrusted: 0,
    },
    Ba = _t(Dn),
    gl = G({}, Dn, { view: 0, detail: 0 }),
    yh = _t(gl),
    Wa,
    Va,
    wl,
    Eo = G({}, gl, {
      screenX: 0,
      screenY: 0,
      clientX: 0,
      clientY: 0,
      pageX: 0,
      pageY: 0,
      ctrlKey: 0,
      shiftKey: 0,
      altKey: 0,
      metaKey: 0,
      getModifierState: Ya,
      button: 0,
      buttons: 0,
      relatedTarget: function (e) {
        return e.relatedTarget === void 0
          ? e.fromElement === e.srcElement
            ? e.toElement
            : e.fromElement
          : e.relatedTarget;
      },
      movementX: function (e) {
        return "movementX" in e
          ? e.movementX
          : (e !== wl &&
              (wl && e.type === "mousemove"
                ? ((Wa = e.screenX - wl.screenX), (Va = e.screenY - wl.screenY))
                : (Va = Wa = 0),
              (wl = e)),
            Wa);
      },
      movementY: function (e) {
        return "movementY" in e ? e.movementY : Va;
      },
    }),
    ds = _t(Eo),
    vh = G({}, Eo, { dataTransfer: 0 }),
    gh = _t(vh),
    wh = G({}, gl, { relatedTarget: 0 }),
    Qa = _t(wh),
    Sh = G({}, Dn, { animationName: 0, elapsedTime: 0, pseudoElement: 0 }),
    Eh = _t(Sh),
    Rh = G({}, Dn, {
      clipboardData: function (e) {
        return "clipboardData" in e ? e.clipboardData : window.clipboardData;
      },
    }),
    kh = _t(Rh),
    xh = G({}, Dn, { data: 0 }),
    hs = _t(xh),
    Ch = {
      Esc: "Escape",
      Spacebar: " ",
      Left: "ArrowLeft",
      Up: "ArrowUp",
      Right: "ArrowRight",
      Down: "ArrowDown",
      Del: "Delete",
      Win: "OS",
      Menu: "ContextMenu",
      Apps: "ContextMenu",
      Scroll: "ScrollLock",
      MozPrintableKey: "Unidentified",
    },
    Ph = {
      8: "Backspace",
      9: "Tab",
      12: "Clear",
      13: "Enter",
      16: "Shift",
      17: "Control",
      18: "Alt",
      19: "Pause",
      20: "CapsLock",
      27: "Escape",
      32: " ",
      33: "PageUp",
      34: "PageDown",
      35: "End",
      36: "Home",
      37: "ArrowLeft",
      38: "ArrowUp",
      39: "ArrowRight",
      40: "ArrowDown",
      45: "Insert",
      46: "Delete",
      112: "F1",
      113: "F2",
      114: "F3",
      115: "F4",
      116: "F5",
      117: "F6",
      118: "F7",
      119: "F8",
      120: "F9",
      121: "F10",
      122: "F11",
      123: "F12",
      144: "NumLock",
      145: "ScrollLock",
      224: "Meta",
    },
    Lh = {
      Alt: "altKey",
      Control: "ctrlKey",
      Meta: "metaKey",
      Shift: "shiftKey",
    };
  function _h(e) {
    var t = this.nativeEvent;
    return t.getModifierState
      ? t.getModifierState(e)
      : (e = Lh[e])
        ? !!t[e]
        : !1;
  }
  function Ya() {
    return _h;
  }
  var Th = G({}, gl, {
      key: function (e) {
        if (e.key) {
          var t = Ch[e.key] || e.key;
          if (t !== "Unidentified") return t;
        }
        return e.type === "keypress"
          ? ((e = wo(e)), e === 13 ? "Enter" : String.fromCharCode(e))
          : e.type === "keydown" || e.type === "keyup"
            ? Ph[e.keyCode] || "Unidentified"
            : "";
      },
      code: 0,
      location: 0,
      ctrlKey: 0,
      shiftKey: 0,
      altKey: 0,
      metaKey: 0,
      repeat: 0,
      locale: 0,
      getModifierState: Ya,
      charCode: function (e) {
        return e.type === "keypress" ? wo(e) : 0;
      },
      keyCode: function (e) {
        return e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
      },
      which: function (e) {
        return e.type === "keypress"
          ? wo(e)
          : e.type === "keydown" || e.type === "keyup"
            ? e.keyCode
            : 0;
      },
    }),
    Mh = _t(Th),
    Nh = G({}, Eo, {
      pointerId: 0,
      width: 0,
      height: 0,
      pressure: 0,
      tangentialPressure: 0,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: 0,
      isPrimary: 0,
    }),
    ps = _t(Nh),
    Dh = G({}, gl, {
      touches: 0,
      targetTouches: 0,
      changedTouches: 0,
      altKey: 0,
      metaKey: 0,
      ctrlKey: 0,
      shiftKey: 0,
      getModifierState: Ya,
    }),
    Oh = _t(Dh),
    zh = G({}, Dn, { propertyName: 0, elapsedTime: 0, pseudoElement: 0 }),
    Fh = _t(zh),
    Ih = G({}, Eo, {
      deltaX: function (e) {
        return "deltaX" in e
          ? e.deltaX
          : "wheelDeltaX" in e
            ? -e.wheelDeltaX
            : 0;
      },
      deltaY: function (e) {
        return "deltaY" in e
          ? e.deltaY
          : "wheelDeltaY" in e
            ? -e.wheelDeltaY
            : "wheelDelta" in e
              ? -e.wheelDelta
              : 0;
      },
      deltaZ: 0,
      deltaMode: 0,
    }),
    jh = _t(Ih),
    Uh = [9, 13, 27, 32],
    Ka = m && "CompositionEvent" in window,
    Sl = null;
  m && "documentMode" in document && (Sl = document.documentMode);
  var Ah = m && "TextEvent" in window && !Sl,
    ms = m && (!Ka || (Sl && 8 < Sl && 11 >= Sl)),
    ys = " ",
    vs = !1;
  function gs(e, t) {
    switch (e) {
      case "keyup":
        return Uh.indexOf(t.keyCode) !== -1;
      case "keydown":
        return t.keyCode !== 229;
      case "keypress":
      case "mousedown":
      case "focusout":
        return !0;
      default:
        return !1;
    }
  }
  function ws(e) {
    return (
      (e = e.detail),
      typeof e == "object" && "data" in e ? e.data : null
    );
  }
  var On = !1;
  function $h(e, t) {
    switch (e) {
      case "compositionend":
        return ws(t);
      case "keypress":
        return t.which !== 32 ? null : ((vs = !0), ys);
      case "textInput":
        return ((e = t.data), e === ys && vs ? null : e);
      default:
        return null;
    }
  }
  function Hh(e, t) {
    if (On)
      return e === "compositionend" || (!Ka && gs(e, t))
        ? ((e = cs()), (go = Ha = Ar = null), (On = !1), e)
        : null;
    switch (e) {
      case "paste":
        return null;
      case "keypress":
        if (!(t.ctrlKey || t.altKey || t.metaKey) || (t.ctrlKey && t.altKey)) {
          if (t.char && 1 < t.char.length) return t.char;
          if (t.which) return String.fromCharCode(t.which);
        }
        return null;
      case "compositionend":
        return ms && t.locale !== "ko" ? null : t.data;
      default:
        return null;
    }
  }
  var Bh = {
    color: !0,
    date: !0,
    datetime: !0,
    "datetime-local": !0,
    email: !0,
    month: !0,
    number: !0,
    password: !0,
    range: !0,
    search: !0,
    tel: !0,
    text: !0,
    time: !0,
    url: !0,
    week: !0,
  };
  function Ss(e) {
    var t = e && e.nodeName && e.nodeName.toLowerCase();
    return t === "input" ? !!Bh[e.type] : t === "textarea";
  }
  function Es(e, t, r, l) {
    (fo(l),
      (t = Po(t, "onChange")),
      0 < t.length &&
        ((r = new Ba("onChange", "change", null, r, l)),
        e.push({ event: r, listeners: t })));
  }
  var El = null,
    Rl = null;
  function Wh(e) {
    As(e, 0);
  }
  function Ro(e) {
    var t = Un(e);
    if (oo(t)) return e;
  }
  function Vh(e, t) {
    if (e === "change") return t;
  }
  var Rs = !1;
  if (m) {
    var Xa;
    if (m) {
      var Ja = "oninput" in document;
      if (!Ja) {
        var ks = document.createElement("div");
        (ks.setAttribute("oninput", "return;"),
          (Ja = typeof ks.oninput == "function"));
      }
      Xa = Ja;
    } else Xa = !1;
    Rs = Xa && (!document.documentMode || 9 < document.documentMode);
  }
  function xs() {
    El && (El.detachEvent("onpropertychange", Cs), (Rl = El = null));
  }
  function Cs(e) {
    if (e.propertyName === "value" && Ro(Rl)) {
      var t = [];
      (Es(t, Rl, e, il(e)), nn(Wh, t));
    }
  }
  function Qh(e, t, r) {
    e === "focusin"
      ? (xs(), (El = t), (Rl = r), El.attachEvent("onpropertychange", Cs))
      : e === "focusout" && xs();
  }
  function Yh(e) {
    if (e === "selectionchange" || e === "keyup" || e === "keydown")
      return Ro(Rl);
  }
  function Kh(e, t) {
    if (e === "click") return Ro(t);
  }
  function Xh(e, t) {
    if (e === "input" || e === "change") return Ro(t);
  }
  function Jh(e, t) {
    return (e === t && (e !== 0 || 1 / e === 1 / t)) || (e !== e && t !== t);
  }
  var Kt = typeof Object.is == "function" ? Object.is : Jh;
  function kl(e, t) {
    if (Kt(e, t)) return !0;
    if (
      typeof e != "object" ||
      e === null ||
      typeof t != "object" ||
      t === null
    )
      return !1;
    var r = Object.keys(e),
      l = Object.keys(t);
    if (r.length !== l.length) return !1;
    for (l = 0; l < r.length; l++) {
      var a = r[l];
      if (!p.call(t, a) || !Kt(e[a], t[a])) return !1;
    }
    return !0;
  }
  function Ps(e) {
    for (; e && e.firstChild; ) e = e.firstChild;
    return e;
  }
  function Ls(e, t) {
    var r = Ps(e);
    e = 0;
    for (var l; r; ) {
      if (r.nodeType === 3) {
        if (((l = e + r.textContent.length), e <= t && l >= t))
          return { node: r, offset: t - e };
        e = l;
      }
      e: {
        for (; r; ) {
          if (r.nextSibling) {
            r = r.nextSibling;
            break e;
          }
          r = r.parentNode;
        }
        r = void 0;
      }
      r = Ps(r);
    }
  }
  function _s(e, t) {
    return e && t
      ? e === t
        ? !0
        : e && e.nodeType === 3
          ? !1
          : t && t.nodeType === 3
            ? _s(e, t.parentNode)
            : "contains" in e
              ? e.contains(t)
              : e.compareDocumentPosition
                ? !!(e.compareDocumentPosition(t) & 16)
                : !1
      : !1;
  }
  function Ts() {
    for (var e = window, t = Ge(); t instanceof e.HTMLIFrameElement; ) {
      try {
        var r = typeof t.contentWindow.location.href == "string";
      } catch {
        r = !1;
      }
      if (r) e = t.contentWindow;
      else break;
      t = Ge(e.document);
    }
    return t;
  }
  function Ga(e) {
    var t = e && e.nodeName && e.nodeName.toLowerCase();
    return (
      t &&
      ((t === "input" &&
        (e.type === "text" ||
          e.type === "search" ||
          e.type === "tel" ||
          e.type === "url" ||
          e.type === "password")) ||
        t === "textarea" ||
        e.contentEditable === "true")
    );
  }
  function Gh(e) {
    var t = Ts(),
      r = e.focusedElem,
      l = e.selectionRange;
    if (
      t !== r &&
      r &&
      r.ownerDocument &&
      _s(r.ownerDocument.documentElement, r)
    ) {
      if (l !== null && Ga(r)) {
        if (
          ((t = l.start),
          (e = l.end),
          e === void 0 && (e = t),
          "selectionStart" in r)
        )
          ((r.selectionStart = t),
            (r.selectionEnd = Math.min(e, r.value.length)));
        else if (
          ((e = ((t = r.ownerDocument || document) && t.defaultView) || window),
          e.getSelection)
        ) {
          e = e.getSelection();
          var a = r.textContent.length,
            u = Math.min(l.start, a);
          ((l = l.end === void 0 ? u : Math.min(l.end, a)),
            !e.extend && u > l && ((a = l), (l = u), (u = a)),
            (a = Ls(r, u)));
          var h = Ls(r, l);
          a &&
            h &&
            (e.rangeCount !== 1 ||
              e.anchorNode !== a.node ||
              e.anchorOffset !== a.offset ||
              e.focusNode !== h.node ||
              e.focusOffset !== h.offset) &&
            ((t = t.createRange()),
            t.setStart(a.node, a.offset),
            e.removeAllRanges(),
            u > l
              ? (e.addRange(t), e.extend(h.node, h.offset))
              : (t.setEnd(h.node, h.offset), e.addRange(t)));
        }
      }
      for (t = [], e = r; (e = e.parentNode); )
        e.nodeType === 1 &&
          t.push({ element: e, left: e.scrollLeft, top: e.scrollTop });
      for (typeof r.focus == "function" && r.focus(), r = 0; r < t.length; r++)
        ((e = t[r]),
          (e.element.scrollLeft = e.left),
          (e.element.scrollTop = e.top));
    }
  }
  var Zh = m && "documentMode" in document && 11 >= document.documentMode,
    zn = null,
    Za = null,
    xl = null,
    qa = !1;
  function Ms(e, t, r) {
    var l =
      r.window === r ? r.document : r.nodeType === 9 ? r : r.ownerDocument;
    qa ||
      zn == null ||
      zn !== Ge(l) ||
      ((l = zn),
      "selectionStart" in l && Ga(l)
        ? (l = { start: l.selectionStart, end: l.selectionEnd })
        : ((l = (
            (l.ownerDocument && l.ownerDocument.defaultView) ||
            window
          ).getSelection()),
          (l = {
            anchorNode: l.anchorNode,
            anchorOffset: l.anchorOffset,
            focusNode: l.focusNode,
            focusOffset: l.focusOffset,
          })),
      (xl && kl(xl, l)) ||
        ((xl = l),
        (l = Po(Za, "onSelect")),
        0 < l.length &&
          ((t = new Ba("onSelect", "select", null, t, r)),
          e.push({ event: t, listeners: l }),
          (t.target = zn))));
  }
  function ko(e, t) {
    var r = {};
    return (
      (r[e.toLowerCase()] = t.toLowerCase()),
      (r["Webkit" + e] = "webkit" + t),
      (r["Moz" + e] = "moz" + t),
      r
    );
  }
  var Fn = {
      animationend: ko("Animation", "AnimationEnd"),
      animationiteration: ko("Animation", "AnimationIteration"),
      animationstart: ko("Animation", "AnimationStart"),
      transitionend: ko("Transition", "TransitionEnd"),
    },
    ba = {},
    Ns = {};
  m &&
    ((Ns = document.createElement("div").style),
    "AnimationEvent" in window ||
      (delete Fn.animationend.animation,
      delete Fn.animationiteration.animation,
      delete Fn.animationstart.animation),
    "TransitionEvent" in window || delete Fn.transitionend.transition);
  function xo(e) {
    if (ba[e]) return ba[e];
    if (!Fn[e]) return e;
    var t = Fn[e],
      r;
    for (r in t) if (t.hasOwnProperty(r) && r in Ns) return (ba[e] = t[r]);
    return e;
  }
  var Ds = xo("animationend"),
    Os = xo("animationiteration"),
    zs = xo("animationstart"),
    Fs = xo("transitionend"),
    Is = new Map(),
    js =
      "abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(
        " ",
      );
  function $r(e, t) {
    (Is.set(e, t), f(t, [e]));
  }
  for (var ei = 0; ei < js.length; ei++) {
    var ti = js[ei],
      qh = ti.toLowerCase(),
      bh = ti[0].toUpperCase() + ti.slice(1);
    $r(qh, "on" + bh);
  }
  ($r(Ds, "onAnimationEnd"),
    $r(Os, "onAnimationIteration"),
    $r(zs, "onAnimationStart"),
    $r("dblclick", "onDoubleClick"),
    $r("focusin", "onFocus"),
    $r("focusout", "onBlur"),
    $r(Fs, "onTransitionEnd"),
    d("onMouseEnter", ["mouseout", "mouseover"]),
    d("onMouseLeave", ["mouseout", "mouseover"]),
    d("onPointerEnter", ["pointerout", "pointerover"]),
    d("onPointerLeave", ["pointerout", "pointerover"]),
    f(
      "onChange",
      "change click focusin focusout input keydown keyup selectionchange".split(
        " ",
      ),
    ),
    f(
      "onSelect",
      "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(
        " ",
      ),
    ),
    f("onBeforeInput", ["compositionend", "keypress", "textInput", "paste"]),
    f(
      "onCompositionEnd",
      "compositionend focusout keydown keypress keyup mousedown".split(" "),
    ),
    f(
      "onCompositionStart",
      "compositionstart focusout keydown keypress keyup mousedown".split(" "),
    ),
    f(
      "onCompositionUpdate",
      "compositionupdate focusout keydown keypress keyup mousedown".split(" "),
    ));
  var Cl =
      "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(
        " ",
      ),
    ep = new Set(
      "cancel close invalid load scroll toggle".split(" ").concat(Cl),
    );
  function Us(e, t, r) {
    var l = e.type || "unknown-event";
    ((e.currentTarget = r), ie(l, t, void 0, e), (e.currentTarget = null));
  }
  function As(e, t) {
    t = (t & 4) !== 0;
    for (var r = 0; r < e.length; r++) {
      var l = e[r],
        a = l.event;
      l = l.listeners;
      e: {
        var u = void 0;
        if (t)
          for (var h = l.length - 1; 0 <= h; h--) {
            var g = l[h],
              E = g.instance,
              O = g.currentTarget;
            if (((g = g.listener), E !== u && a.isPropagationStopped()))
              break e;
            (Us(a, g, O), (u = E));
          }
        else
          for (h = 0; h < l.length; h++) {
            if (
              ((g = l[h]),
              (E = g.instance),
              (O = g.currentTarget),
              (g = g.listener),
              E !== u && a.isPropagationStopped())
            )
              break e;
            (Us(a, g, O), (u = E));
          }
      }
    }
    if ($) throw ((e = W), ($ = !1), (W = null), e);
  }
  function We(e, t) {
    var r = t[si];
    r === void 0 && (r = t[si] = new Set());
    var l = e + "__bubble";
    r.has(l) || ($s(t, e, 2, !1), r.add(l));
  }
  function ri(e, t, r) {
    var l = 0;
    (t && (l |= 4), $s(r, e, l, t));
  }
  var Co = "_reactListening" + Math.random().toString(36).slice(2);
  function Pl(e) {
    if (!e[Co]) {
      ((e[Co] = !0),
        s.forEach(function (r) {
          r !== "selectionchange" && (ep.has(r) || ri(r, !1, e), ri(r, !0, e));
        }));
      var t = e.nodeType === 9 ? e : e.ownerDocument;
      t === null || t[Co] || ((t[Co] = !0), ri("selectionchange", !1, t));
    }
  }
  function $s(e, t, r, l) {
    switch (ss(t)) {
      case 1:
        var a = ph;
        break;
      case 4:
        a = mh;
        break;
      default:
        a = Aa;
    }
    ((r = a.bind(null, t, r, e)),
      (a = void 0),
      !cl ||
        (t !== "touchstart" && t !== "touchmove" && t !== "wheel") ||
        (a = !0),
      l
        ? a !== void 0
          ? e.addEventListener(t, r, { capture: !0, passive: a })
          : e.addEventListener(t, r, !0)
        : a !== void 0
          ? e.addEventListener(t, r, { passive: a })
          : e.addEventListener(t, r, !1));
  }
  function ni(e, t, r, l, a) {
    var u = l;
    if ((t & 1) === 0 && (t & 2) === 0 && l !== null)
      e: for (;;) {
        if (l === null) return;
        var h = l.tag;
        if (h === 3 || h === 4) {
          var g = l.stateNode.containerInfo;
          if (g === a || (g.nodeType === 8 && g.parentNode === a)) break;
          if (h === 4)
            for (h = l.return; h !== null; ) {
              var E = h.tag;
              if (
                (E === 3 || E === 4) &&
                ((E = h.stateNode.containerInfo),
                E === a || (E.nodeType === 8 && E.parentNode === a))
              )
                return;
              h = h.return;
            }
          for (; g !== null; ) {
            if (((h = on(g)), h === null)) return;
            if (((E = h.tag), E === 5 || E === 6)) {
              l = u = h;
              continue e;
            }
            g = g.parentNode;
          }
        }
        l = l.return;
      }
    nn(function () {
      var O = u,
        A = il(r),
        H = [];
      e: {
        var U = Is.get(e);
        if (U !== void 0) {
          var q = Ba,
            re = e;
          switch (e) {
            case "keypress":
              if (wo(r) === 0) break e;
            case "keydown":
            case "keyup":
              q = Mh;
              break;
            case "focusin":
              ((re = "focus"), (q = Qa));
              break;
            case "focusout":
              ((re = "blur"), (q = Qa));
              break;
            case "beforeblur":
            case "afterblur":
              q = Qa;
              break;
            case "click":
              if (r.button === 2) break e;
            case "auxclick":
            case "dblclick":
            case "mousedown":
            case "mousemove":
            case "mouseup":
            case "mouseout":
            case "mouseover":
            case "contextmenu":
              q = ds;
              break;
            case "drag":
            case "dragend":
            case "dragenter":
            case "dragexit":
            case "dragleave":
            case "dragover":
            case "dragstart":
            case "drop":
              q = gh;
              break;
            case "touchcancel":
            case "touchend":
            case "touchmove":
            case "touchstart":
              q = Oh;
              break;
            case Ds:
            case Os:
            case zs:
              q = Eh;
              break;
            case Fs:
              q = Fh;
              break;
            case "scroll":
              q = yh;
              break;
            case "wheel":
              q = jh;
              break;
            case "copy":
            case "cut":
            case "paste":
              q = kh;
              break;
            case "gotpointercapture":
            case "lostpointercapture":
            case "pointercancel":
            case "pointerdown":
            case "pointermove":
            case "pointerout":
            case "pointerover":
            case "pointerup":
              q = ps;
          }
          var ne = (t & 4) !== 0,
            qe = !ne && e === "scroll",
            T = ne ? (U !== null ? U + "Capture" : null) : U;
          ne = [];
          for (var x = O, N; x !== null; ) {
            N = x;
            var V = N.stateNode;
            if (
              (N.tag === 5 &&
                V !== null &&
                ((N = V),
                T !== null &&
                  ((V = Nr(x, T)), V != null && ne.push(Ll(x, V, N)))),
              qe)
            )
              break;
            x = x.return;
          }
          0 < ne.length &&
            ((U = new q(U, re, null, r, A)),
            H.push({ event: U, listeners: ne }));
        }
      }
      if ((t & 7) === 0) {
        e: {
          if (
            ((U = e === "mouseover" || e === "pointerover"),
            (q = e === "mouseout" || e === "pointerout"),
            U &&
              r !== Pn &&
              (re = r.relatedTarget || r.fromElement) &&
              (on(re) || re[pr]))
          )
            break e;
          if (
            (q || U) &&
            ((U =
              A.window === A
                ? A
                : (U = A.ownerDocument)
                  ? U.defaultView || U.parentWindow
                  : window),
            q
              ? ((re = r.relatedTarget || r.toElement),
                (q = O),
                (re = re ? on(re) : null),
                re !== null &&
                  ((qe = b(re)), re !== qe || (re.tag !== 5 && re.tag !== 6)) &&
                  (re = null))
              : ((q = null), (re = O)),
            q !== re)
          ) {
            if (
              ((ne = ds),
              (V = "onMouseLeave"),
              (T = "onMouseEnter"),
              (x = "mouse"),
              (e === "pointerout" || e === "pointerover") &&
                ((ne = ps),
                (V = "onPointerLeave"),
                (T = "onPointerEnter"),
                (x = "pointer")),
              (qe = q == null ? U : Un(q)),
              (N = re == null ? U : Un(re)),
              (U = new ne(V, x + "leave", q, r, A)),
              (U.target = qe),
              (U.relatedTarget = N),
              (V = null),
              on(A) === O &&
                ((ne = new ne(T, x + "enter", re, r, A)),
                (ne.target = N),
                (ne.relatedTarget = qe),
                (V = ne)),
              (qe = V),
              q && re)
            )
              t: {
                for (ne = q, T = re, x = 0, N = ne; N; N = In(N)) x++;
                for (N = 0, V = T; V; V = In(V)) N++;
                for (; 0 < x - N; ) ((ne = In(ne)), x--);
                for (; 0 < N - x; ) ((T = In(T)), N--);
                for (; x--; ) {
                  if (ne === T || (T !== null && ne === T.alternate)) break t;
                  ((ne = In(ne)), (T = In(T)));
                }
                ne = null;
              }
            else ne = null;
            (q !== null && Hs(H, U, q, ne, !1),
              re !== null && qe !== null && Hs(H, qe, re, ne, !0));
          }
        }
        e: {
          if (
            ((U = O ? Un(O) : window),
            (q = U.nodeName && U.nodeName.toLowerCase()),
            q === "select" || (q === "input" && U.type === "file"))
          )
            var le = Vh;
          else if (Ss(U))
            if (Rs) le = Xh;
            else {
              le = Yh;
              var fe = Qh;
            }
          else
            (q = U.nodeName) &&
              q.toLowerCase() === "input" &&
              (U.type === "checkbox" || U.type === "radio") &&
              (le = Kh);
          if (le && (le = le(e, O))) {
            Es(H, le, r, A);
            break e;
          }
          (fe && fe(e, U, O),
            e === "focusout" &&
              (fe = U._wrapperState) &&
              fe.controlled &&
              U.type === "number" &&
              ol(U, "number", U.value));
        }
        switch (((fe = O ? Un(O) : window), e)) {
          case "focusin":
            (Ss(fe) || fe.contentEditable === "true") &&
              ((zn = fe), (Za = O), (xl = null));
            break;
          case "focusout":
            xl = Za = zn = null;
            break;
          case "mousedown":
            qa = !0;
            break;
          case "contextmenu":
          case "mouseup":
          case "dragend":
            ((qa = !1), Ms(H, r, A));
            break;
          case "selectionchange":
            if (Zh) break;
          case "keydown":
          case "keyup":
            Ms(H, r, A);
        }
        var de;
        if (Ka)
          e: {
            switch (e) {
              case "compositionstart":
                var ve = "onCompositionStart";
                break e;
              case "compositionend":
                ve = "onCompositionEnd";
                break e;
              case "compositionupdate":
                ve = "onCompositionUpdate";
                break e;
            }
            ve = void 0;
          }
        else
          On
            ? gs(e, r) && (ve = "onCompositionEnd")
            : e === "keydown" &&
              r.keyCode === 229 &&
              (ve = "onCompositionStart");
        (ve &&
          (ms &&
            r.locale !== "ko" &&
            (On || ve !== "onCompositionStart"
              ? ve === "onCompositionEnd" && On && (de = cs())
              : ((Ar = A),
                (Ha = "value" in Ar ? Ar.value : Ar.textContent),
                (On = !0))),
          (fe = Po(O, ve)),
          0 < fe.length &&
            ((ve = new hs(ve, e, null, r, A)),
            H.push({ event: ve, listeners: fe }),
            de
              ? (ve.data = de)
              : ((de = ws(r)), de !== null && (ve.data = de)))),
          (de = Ah ? $h(e, r) : Hh(e, r)) &&
            ((O = Po(O, "onBeforeInput")),
            0 < O.length &&
              ((A = new hs("onBeforeInput", "beforeinput", null, r, A)),
              H.push({ event: A, listeners: O }),
              (A.data = de))));
      }
      As(H, t);
    });
  }
  function Ll(e, t, r) {
    return { instance: e, listener: t, currentTarget: r };
  }
  function Po(e, t) {
    for (var r = t + "Capture", l = []; e !== null; ) {
      var a = e,
        u = a.stateNode;
      (a.tag === 5 &&
        u !== null &&
        ((a = u),
        (u = Nr(e, r)),
        u != null && l.unshift(Ll(e, u, a)),
        (u = Nr(e, t)),
        u != null && l.push(Ll(e, u, a))),
        (e = e.return));
    }
    return l;
  }
  function In(e) {
    if (e === null) return null;
    do e = e.return;
    while (e && e.tag !== 5);
    return e || null;
  }
  function Hs(e, t, r, l, a) {
    for (var u = t._reactName, h = []; r !== null && r !== l; ) {
      var g = r,
        E = g.alternate,
        O = g.stateNode;
      if (E !== null && E === l) break;
      (g.tag === 5 &&
        O !== null &&
        ((g = O),
        a
          ? ((E = Nr(r, u)), E != null && h.unshift(Ll(r, E, g)))
          : a || ((E = Nr(r, u)), E != null && h.push(Ll(r, E, g)))),
        (r = r.return));
    }
    h.length !== 0 && e.push({ event: t, listeners: h });
  }
  var tp = /\r\n?/g,
    rp = /\u0000|\uFFFD/g;
  function Bs(e) {
    return (typeof e == "string" ? e : "" + e)
      .replace(
        tp,
        `
`,
      )
      .replace(rp, "");
  }
  function Lo(e, t, r) {
    if (((t = Bs(t)), Bs(e) !== t && r)) throw Error(i(425));
  }
  function _o() {}
  var li = null,
    oi = null;
  function ai(e, t) {
    return (
      e === "textarea" ||
      e === "noscript" ||
      typeof t.children == "string" ||
      typeof t.children == "number" ||
      (typeof t.dangerouslySetInnerHTML == "object" &&
        t.dangerouslySetInnerHTML !== null &&
        t.dangerouslySetInnerHTML.__html != null)
    );
  }
  var ii = typeof setTimeout == "function" ? setTimeout : void 0,
    np = typeof clearTimeout == "function" ? clearTimeout : void 0,
    Ws = typeof Promise == "function" ? Promise : void 0,
    lp =
      typeof queueMicrotask == "function"
        ? queueMicrotask
        : typeof Ws < "u"
          ? function (e) {
              return Ws.resolve(null).then(e).catch(op);
            }
          : ii;
  function op(e) {
    setTimeout(function () {
      throw e;
    });
  }
  function ui(e, t) {
    var r = t,
      l = 0;
    do {
      var a = r.nextSibling;
      if ((e.removeChild(r), a && a.nodeType === 8))
        if (((r = a.data), r === "/$")) {
          if (l === 0) {
            (e.removeChild(a), vl(t));
            return;
          }
          l--;
        } else (r !== "$" && r !== "$?" && r !== "$!") || l++;
      r = a;
    } while (r);
    vl(t);
  }
  function Hr(e) {
    for (; e != null; e = e.nextSibling) {
      var t = e.nodeType;
      if (t === 1 || t === 3) break;
      if (t === 8) {
        if (((t = e.data), t === "$" || t === "$!" || t === "$?")) break;
        if (t === "/$") return null;
      }
    }
    return e;
  }
  function Vs(e) {
    e = e.previousSibling;
    for (var t = 0; e; ) {
      if (e.nodeType === 8) {
        var r = e.data;
        if (r === "$" || r === "$!" || r === "$?") {
          if (t === 0) return e;
          t--;
        } else r === "/$" && t++;
      }
      e = e.previousSibling;
    }
    return null;
  }
  var jn = Math.random().toString(36).slice(2),
    or = "__reactFiber$" + jn,
    _l = "__reactProps$" + jn,
    pr = "__reactContainer$" + jn,
    si = "__reactEvents$" + jn,
    ap = "__reactListeners$" + jn,
    ip = "__reactHandles$" + jn;
  function on(e) {
    var t = e[or];
    if (t) return t;
    for (var r = e.parentNode; r; ) {
      if ((t = r[pr] || r[or])) {
        if (
          ((r = t.alternate),
          t.child !== null || (r !== null && r.child !== null))
        )
          for (e = Vs(e); e !== null; ) {
            if ((r = e[or])) return r;
            e = Vs(e);
          }
        return t;
      }
      ((e = r), (r = e.parentNode));
    }
    return null;
  }
  function Tl(e) {
    return (
      (e = e[or] || e[pr]),
      !e || (e.tag !== 5 && e.tag !== 6 && e.tag !== 13 && e.tag !== 3)
        ? null
        : e
    );
  }
  function Un(e) {
    if (e.tag === 5 || e.tag === 6) return e.stateNode;
    throw Error(i(33));
  }
  function To(e) {
    return e[_l] || null;
  }
  var ci = [],
    An = -1;
  function Br(e) {
    return { current: e };
  }
  function Ve(e) {
    0 > An || ((e.current = ci[An]), (ci[An] = null), An--);
  }
  function Be(e, t) {
    (An++, (ci[An] = e.current), (e.current = t));
  }
  var Wr = {},
    st = Br(Wr),
    Et = Br(!1),
    an = Wr;
  function $n(e, t) {
    var r = e.type.contextTypes;
    if (!r) return Wr;
    var l = e.stateNode;
    if (l && l.__reactInternalMemoizedUnmaskedChildContext === t)
      return l.__reactInternalMemoizedMaskedChildContext;
    var a = {},
      u;
    for (u in r) a[u] = t[u];
    return (
      l &&
        ((e = e.stateNode),
        (e.__reactInternalMemoizedUnmaskedChildContext = t),
        (e.__reactInternalMemoizedMaskedChildContext = a)),
      a
    );
  }
  function Rt(e) {
    return ((e = e.childContextTypes), e != null);
  }
  function Mo() {
    (Ve(Et), Ve(st));
  }
  function Qs(e, t, r) {
    if (st.current !== Wr) throw Error(i(168));
    (Be(st, t), Be(Et, r));
  }
  function Ys(e, t, r) {
    var l = e.stateNode;
    if (((t = t.childContextTypes), typeof l.getChildContext != "function"))
      return r;
    l = l.getChildContext();
    for (var a in l) if (!(a in t)) throw Error(i(108, Te(e) || "Unknown", a));
    return G({}, r, l);
  }
  function No(e) {
    return (
      (e =
        ((e = e.stateNode) && e.__reactInternalMemoizedMergedChildContext) ||
        Wr),
      (an = st.current),
      Be(st, e),
      Be(Et, Et.current),
      !0
    );
  }
  function Ks(e, t, r) {
    var l = e.stateNode;
    if (!l) throw Error(i(169));
    (r
      ? ((e = Ys(e, t, an)),
        (l.__reactInternalMemoizedMergedChildContext = e),
        Ve(Et),
        Ve(st),
        Be(st, e))
      : Ve(Et),
      Be(Et, r));
  }
  var mr = null,
    Do = !1,
    fi = !1;
  function Xs(e) {
    mr === null ? (mr = [e]) : mr.push(e);
  }
  function up(e) {
    ((Do = !0), Xs(e));
  }
  function Vr() {
    if (!fi && mr !== null) {
      fi = !0;
      var e = 0,
        t = Ae;
      try {
        var r = mr;
        for (Ae = 1; e < r.length; e++) {
          var l = r[e];
          do l = l(!0);
          while (l !== null);
        }
        ((mr = null), (Do = !1));
      } catch (a) {
        throw (mr !== null && (mr = mr.slice(e + 1)), He(fr, Vr), a);
      } finally {
        ((Ae = t), (fi = !1));
      }
    }
    return null;
  }
  var Hn = [],
    Bn = 0,
    Oo = null,
    zo = 0,
    It = [],
    jt = 0,
    un = null,
    yr = 1,
    vr = "";
  function sn(e, t) {
    ((Hn[Bn++] = zo), (Hn[Bn++] = Oo), (Oo = e), (zo = t));
  }
  function Js(e, t, r) {
    ((It[jt++] = yr), (It[jt++] = vr), (It[jt++] = un), (un = e));
    var l = yr;
    e = vr;
    var a = 32 - Se(l) - 1;
    ((l &= ~(1 << a)), (r += 1));
    var u = 32 - Se(t) + a;
    if (30 < u) {
      var h = a - (a % 5);
      ((u = (l & ((1 << h) - 1)).toString(32)),
        (l >>= h),
        (a -= h),
        (yr = (1 << (32 - Se(t) + a)) | (r << a) | l),
        (vr = u + e));
    } else ((yr = (1 << u) | (r << a) | l), (vr = e));
  }
  function di(e) {
    e.return !== null && (sn(e, 1), Js(e, 1, 0));
  }
  function hi(e) {
    for (; e === Oo; )
      ((Oo = Hn[--Bn]), (Hn[Bn] = null), (zo = Hn[--Bn]), (Hn[Bn] = null));
    for (; e === un; )
      ((un = It[--jt]),
        (It[jt] = null),
        (vr = It[--jt]),
        (It[jt] = null),
        (yr = It[--jt]),
        (It[jt] = null));
  }
  var Tt = null,
    Mt = null,
    Qe = !1,
    Xt = null;
  function Gs(e, t) {
    var r = Ht(5, null, null, 0);
    ((r.elementType = "DELETED"),
      (r.stateNode = t),
      (r.return = e),
      (t = e.deletions),
      t === null ? ((e.deletions = [r]), (e.flags |= 16)) : t.push(r));
  }
  function Zs(e, t) {
    switch (e.tag) {
      case 5:
        var r = e.type;
        return (
          (t =
            t.nodeType !== 1 || r.toLowerCase() !== t.nodeName.toLowerCase()
              ? null
              : t),
          t !== null
            ? ((e.stateNode = t), (Tt = e), (Mt = Hr(t.firstChild)), !0)
            : !1
        );
      case 6:
        return (
          (t = e.pendingProps === "" || t.nodeType !== 3 ? null : t),
          t !== null ? ((e.stateNode = t), (Tt = e), (Mt = null), !0) : !1
        );
      case 13:
        return (
          (t = t.nodeType !== 8 ? null : t),
          t !== null
            ? ((r = un !== null ? { id: yr, overflow: vr } : null),
              (e.memoizedState = {
                dehydrated: t,
                treeContext: r,
                retryLane: 1073741824,
              }),
              (r = Ht(18, null, null, 0)),
              (r.stateNode = t),
              (r.return = e),
              (e.child = r),
              (Tt = e),
              (Mt = null),
              !0)
            : !1
        );
      default:
        return !1;
    }
  }
  function pi(e) {
    return (e.mode & 1) !== 0 && (e.flags & 128) === 0;
  }
  function mi(e) {
    if (Qe) {
      var t = Mt;
      if (t) {
        var r = t;
        if (!Zs(e, t)) {
          if (pi(e)) throw Error(i(418));
          t = Hr(r.nextSibling);
          var l = Tt;
          t && Zs(e, t)
            ? Gs(l, r)
            : ((e.flags = (e.flags & -4097) | 2), (Qe = !1), (Tt = e));
        }
      } else {
        if (pi(e)) throw Error(i(418));
        ((e.flags = (e.flags & -4097) | 2), (Qe = !1), (Tt = e));
      }
    }
  }
  function qs(e) {
    for (
      e = e.return;
      e !== null && e.tag !== 5 && e.tag !== 3 && e.tag !== 13;
    )
      e = e.return;
    Tt = e;
  }
  function Fo(e) {
    if (e !== Tt) return !1;
    if (!Qe) return (qs(e), (Qe = !0), !1);
    var t;
    if (
      ((t = e.tag !== 3) &&
        !(t = e.tag !== 5) &&
        ((t = e.type),
        (t = t !== "head" && t !== "body" && !ai(e.type, e.memoizedProps))),
      t && (t = Mt))
    ) {
      if (pi(e)) throw (bs(), Error(i(418)));
      for (; t; ) (Gs(e, t), (t = Hr(t.nextSibling)));
    }
    if ((qs(e), e.tag === 13)) {
      if (((e = e.memoizedState), (e = e !== null ? e.dehydrated : null), !e))
        throw Error(i(317));
      e: {
        for (e = e.nextSibling, t = 0; e; ) {
          if (e.nodeType === 8) {
            var r = e.data;
            if (r === "/$") {
              if (t === 0) {
                Mt = Hr(e.nextSibling);
                break e;
              }
              t--;
            } else (r !== "$" && r !== "$!" && r !== "$?") || t++;
          }
          e = e.nextSibling;
        }
        Mt = null;
      }
    } else Mt = Tt ? Hr(e.stateNode.nextSibling) : null;
    return !0;
  }
  function bs() {
    for (var e = Mt; e; ) e = Hr(e.nextSibling);
  }
  function Wn() {
    ((Mt = Tt = null), (Qe = !1));
  }
  function yi(e) {
    Xt === null ? (Xt = [e]) : Xt.push(e);
  }
  var sp = Y.ReactCurrentBatchConfig;
  function Ml(e, t, r) {
    if (
      ((e = r.ref),
      e !== null && typeof e != "function" && typeof e != "object")
    ) {
      if (r._owner) {
        if (((r = r._owner), r)) {
          if (r.tag !== 1) throw Error(i(309));
          var l = r.stateNode;
        }
        if (!l) throw Error(i(147, e));
        var a = l,
          u = "" + e;
        return t !== null &&
          t.ref !== null &&
          typeof t.ref == "function" &&
          t.ref._stringRef === u
          ? t.ref
          : ((t = function (h) {
              var g = a.refs;
              h === null ? delete g[u] : (g[u] = h);
            }),
            (t._stringRef = u),
            t);
      }
      if (typeof e != "string") throw Error(i(284));
      if (!r._owner) throw Error(i(290, e));
    }
    return e;
  }
  function Io(e, t) {
    throw (
      (e = Object.prototype.toString.call(t)),
      Error(
        i(
          31,
          e === "[object Object]"
            ? "object with keys {" + Object.keys(t).join(", ") + "}"
            : e,
        ),
      )
    );
  }
  function ec(e) {
    var t = e._init;
    return t(e._payload);
  }
  function tc(e) {
    function t(T, x) {
      if (e) {
        var N = T.deletions;
        N === null ? ((T.deletions = [x]), (T.flags |= 16)) : N.push(x);
      }
    }
    function r(T, x) {
      if (!e) return null;
      for (; x !== null; ) (t(T, x), (x = x.sibling));
      return null;
    }
    function l(T, x) {
      for (T = new Map(); x !== null; )
        (x.key !== null ? T.set(x.key, x) : T.set(x.index, x), (x = x.sibling));
      return T;
    }
    function a(T, x) {
      return ((T = qr(T, x)), (T.index = 0), (T.sibling = null), T);
    }
    function u(T, x, N) {
      return (
        (T.index = N),
        e
          ? ((N = T.alternate),
            N !== null
              ? ((N = N.index), N < x ? ((T.flags |= 2), x) : N)
              : ((T.flags |= 2), x))
          : ((T.flags |= 1048576), x)
      );
    }
    function h(T) {
      return (e && T.alternate === null && (T.flags |= 2), T);
    }
    function g(T, x, N, V) {
      return x === null || x.tag !== 6
        ? ((x = iu(N, T.mode, V)), (x.return = T), x)
        : ((x = a(x, N)), (x.return = T), x);
    }
    function E(T, x, N, V) {
      var le = N.type;
      return le === he
        ? A(T, x, N.props.children, V, N.key)
        : x !== null &&
            (x.elementType === le ||
              (typeof le == "object" &&
                le !== null &&
                le.$$typeof === Re &&
                ec(le) === x.type))
          ? ((V = a(x, N.props)), (V.ref = Ml(T, x, N)), (V.return = T), V)
          : ((V = aa(N.type, N.key, N.props, null, T.mode, V)),
            (V.ref = Ml(T, x, N)),
            (V.return = T),
            V);
    }
    function O(T, x, N, V) {
      return x === null ||
        x.tag !== 4 ||
        x.stateNode.containerInfo !== N.containerInfo ||
        x.stateNode.implementation !== N.implementation
        ? ((x = uu(N, T.mode, V)), (x.return = T), x)
        : ((x = a(x, N.children || [])), (x.return = T), x);
    }
    function A(T, x, N, V, le) {
      return x === null || x.tag !== 7
        ? ((x = vn(N, T.mode, V, le)), (x.return = T), x)
        : ((x = a(x, N)), (x.return = T), x);
    }
    function H(T, x, N) {
      if ((typeof x == "string" && x !== "") || typeof x == "number")
        return ((x = iu("" + x, T.mode, N)), (x.return = T), x);
      if (typeof x == "object" && x !== null) {
        switch (x.$$typeof) {
          case J:
            return (
              (N = aa(x.type, x.key, x.props, null, T.mode, N)),
              (N.ref = Ml(T, null, x)),
              (N.return = T),
              N
            );
          case Z:
            return ((x = uu(x, T.mode, N)), (x.return = T), x);
          case Re:
            var V = x._init;
            return H(T, V(x._payload), N);
        }
        if (Cr(x) || X(x))
          return ((x = vn(x, T.mode, N, null)), (x.return = T), x);
        Io(T, x);
      }
      return null;
    }
    function U(T, x, N, V) {
      var le = x !== null ? x.key : null;
      if ((typeof N == "string" && N !== "") || typeof N == "number")
        return le !== null ? null : g(T, x, "" + N, V);
      if (typeof N == "object" && N !== null) {
        switch (N.$$typeof) {
          case J:
            return N.key === le ? E(T, x, N, V) : null;
          case Z:
            return N.key === le ? O(T, x, N, V) : null;
          case Re:
            return ((le = N._init), U(T, x, le(N._payload), V));
        }
        if (Cr(N) || X(N)) return le !== null ? null : A(T, x, N, V, null);
        Io(T, N);
      }
      return null;
    }
    function q(T, x, N, V, le) {
      if ((typeof V == "string" && V !== "") || typeof V == "number")
        return ((T = T.get(N) || null), g(x, T, "" + V, le));
      if (typeof V == "object" && V !== null) {
        switch (V.$$typeof) {
          case J:
            return (
              (T = T.get(V.key === null ? N : V.key) || null),
              E(x, T, V, le)
            );
          case Z:
            return (
              (T = T.get(V.key === null ? N : V.key) || null),
              O(x, T, V, le)
            );
          case Re:
            var fe = V._init;
            return q(T, x, N, fe(V._payload), le);
        }
        if (Cr(V) || X(V))
          return ((T = T.get(N) || null), A(x, T, V, le, null));
        Io(x, V);
      }
      return null;
    }
    function re(T, x, N, V) {
      for (
        var le = null, fe = null, de = x, ve = (x = 0), ot = null;
        de !== null && ve < N.length;
        ve++
      ) {
        de.index > ve ? ((ot = de), (de = null)) : (ot = de.sibling);
        var Ie = U(T, de, N[ve], V);
        if (Ie === null) {
          de === null && (de = ot);
          break;
        }
        (e && de && Ie.alternate === null && t(T, de),
          (x = u(Ie, x, ve)),
          fe === null ? (le = Ie) : (fe.sibling = Ie),
          (fe = Ie),
          (de = ot));
      }
      if (ve === N.length) return (r(T, de), Qe && sn(T, ve), le);
      if (de === null) {
        for (; ve < N.length; ve++)
          ((de = H(T, N[ve], V)),
            de !== null &&
              ((x = u(de, x, ve)),
              fe === null ? (le = de) : (fe.sibling = de),
              (fe = de)));
        return (Qe && sn(T, ve), le);
      }
      for (de = l(T, de); ve < N.length; ve++)
        ((ot = q(de, T, ve, N[ve], V)),
          ot !== null &&
            (e &&
              ot.alternate !== null &&
              de.delete(ot.key === null ? ve : ot.key),
            (x = u(ot, x, ve)),
            fe === null ? (le = ot) : (fe.sibling = ot),
            (fe = ot)));
      return (
        e &&
          de.forEach(function (br) {
            return t(T, br);
          }),
        Qe && sn(T, ve),
        le
      );
    }
    function ne(T, x, N, V) {
      var le = X(N);
      if (typeof le != "function") throw Error(i(150));
      if (((N = le.call(N)), N == null)) throw Error(i(151));
      for (
        var fe = (le = null), de = x, ve = (x = 0), ot = null, Ie = N.next();
        de !== null && !Ie.done;
        ve++, Ie = N.next()
      ) {
        de.index > ve ? ((ot = de), (de = null)) : (ot = de.sibling);
        var br = U(T, de, Ie.value, V);
        if (br === null) {
          de === null && (de = ot);
          break;
        }
        (e && de && br.alternate === null && t(T, de),
          (x = u(br, x, ve)),
          fe === null ? (le = br) : (fe.sibling = br),
          (fe = br),
          (de = ot));
      }
      if (Ie.done) return (r(T, de), Qe && sn(T, ve), le);
      if (de === null) {
        for (; !Ie.done; ve++, Ie = N.next())
          ((Ie = H(T, Ie.value, V)),
            Ie !== null &&
              ((x = u(Ie, x, ve)),
              fe === null ? (le = Ie) : (fe.sibling = Ie),
              (fe = Ie)));
        return (Qe && sn(T, ve), le);
      }
      for (de = l(T, de); !Ie.done; ve++, Ie = N.next())
        ((Ie = q(de, T, ve, Ie.value, V)),
          Ie !== null &&
            (e &&
              Ie.alternate !== null &&
              de.delete(Ie.key === null ? ve : Ie.key),
            (x = u(Ie, x, ve)),
            fe === null ? (le = Ie) : (fe.sibling = Ie),
            (fe = Ie)));
      return (
        e &&
          de.forEach(function (Bp) {
            return t(T, Bp);
          }),
        Qe && sn(T, ve),
        le
      );
    }
    function qe(T, x, N, V) {
      if (
        (typeof N == "object" &&
          N !== null &&
          N.type === he &&
          N.key === null &&
          (N = N.props.children),
        typeof N == "object" && N !== null)
      ) {
        switch (N.$$typeof) {
          case J:
            e: {
              for (var le = N.key, fe = x; fe !== null; ) {
                if (fe.key === le) {
                  if (((le = N.type), le === he)) {
                    if (fe.tag === 7) {
                      (r(T, fe.sibling),
                        (x = a(fe, N.props.children)),
                        (x.return = T),
                        (T = x));
                      break e;
                    }
                  } else if (
                    fe.elementType === le ||
                    (typeof le == "object" &&
                      le !== null &&
                      le.$$typeof === Re &&
                      ec(le) === fe.type)
                  ) {
                    (r(T, fe.sibling),
                      (x = a(fe, N.props)),
                      (x.ref = Ml(T, fe, N)),
                      (x.return = T),
                      (T = x));
                    break e;
                  }
                  r(T, fe);
                  break;
                } else t(T, fe);
                fe = fe.sibling;
              }
              N.type === he
                ? ((x = vn(N.props.children, T.mode, V, N.key)),
                  (x.return = T),
                  (T = x))
                : ((V = aa(N.type, N.key, N.props, null, T.mode, V)),
                  (V.ref = Ml(T, x, N)),
                  (V.return = T),
                  (T = V));
            }
            return h(T);
          case Z:
            e: {
              for (fe = N.key; x !== null; ) {
                if (x.key === fe)
                  if (
                    x.tag === 4 &&
                    x.stateNode.containerInfo === N.containerInfo &&
                    x.stateNode.implementation === N.implementation
                  ) {
                    (r(T, x.sibling),
                      (x = a(x, N.children || [])),
                      (x.return = T),
                      (T = x));
                    break e;
                  } else {
                    r(T, x);
                    break;
                  }
                else t(T, x);
                x = x.sibling;
              }
              ((x = uu(N, T.mode, V)), (x.return = T), (T = x));
            }
            return h(T);
          case Re:
            return ((fe = N._init), qe(T, x, fe(N._payload), V));
        }
        if (Cr(N)) return re(T, x, N, V);
        if (X(N)) return ne(T, x, N, V);
        Io(T, N);
      }
      return (typeof N == "string" && N !== "") || typeof N == "number"
        ? ((N = "" + N),
          x !== null && x.tag === 6
            ? (r(T, x.sibling), (x = a(x, N)), (x.return = T), (T = x))
            : (r(T, x), (x = iu(N, T.mode, V)), (x.return = T), (T = x)),
          h(T))
        : r(T, x);
    }
    return qe;
  }
  var Vn = tc(!0),
    rc = tc(!1),
    jo = Br(null),
    Uo = null,
    Qn = null,
    vi = null;
  function gi() {
    vi = Qn = Uo = null;
  }
  function wi(e) {
    var t = jo.current;
    (Ve(jo), (e._currentValue = t));
  }
  function Si(e, t, r) {
    for (; e !== null; ) {
      var l = e.alternate;
      if (
        ((e.childLanes & t) !== t
          ? ((e.childLanes |= t), l !== null && (l.childLanes |= t))
          : l !== null && (l.childLanes & t) !== t && (l.childLanes |= t),
        e === r)
      )
        break;
      e = e.return;
    }
  }
  function Yn(e, t) {
    ((Uo = e),
      (vi = Qn = null),
      (e = e.dependencies),
      e !== null &&
        e.firstContext !== null &&
        ((e.lanes & t) !== 0 && (kt = !0), (e.firstContext = null)));
  }
  function Ut(e) {
    var t = e._currentValue;
    if (vi !== e)
      if (((e = { context: e, memoizedValue: t, next: null }), Qn === null)) {
        if (Uo === null) throw Error(i(308));
        ((Qn = e), (Uo.dependencies = { lanes: 0, firstContext: e }));
      } else Qn = Qn.next = e;
    return t;
  }
  var cn = null;
  function Ei(e) {
    cn === null ? (cn = [e]) : cn.push(e);
  }
  function nc(e, t, r, l) {
    var a = t.interleaved;
    return (
      a === null ? ((r.next = r), Ei(t)) : ((r.next = a.next), (a.next = r)),
      (t.interleaved = r),
      gr(e, l)
    );
  }
  function gr(e, t) {
    e.lanes |= t;
    var r = e.alternate;
    for (r !== null && (r.lanes |= t), r = e, e = e.return; e !== null; )
      ((e.childLanes |= t),
        (r = e.alternate),
        r !== null && (r.childLanes |= t),
        (r = e),
        (e = e.return));
    return r.tag === 3 ? r.stateNode : null;
  }
  var Qr = !1;
  function Ri(e) {
    e.updateQueue = {
      baseState: e.memoizedState,
      firstBaseUpdate: null,
      lastBaseUpdate: null,
      shared: { pending: null, interleaved: null, lanes: 0 },
      effects: null,
    };
  }
  function lc(e, t) {
    ((e = e.updateQueue),
      t.updateQueue === e &&
        (t.updateQueue = {
          baseState: e.baseState,
          firstBaseUpdate: e.firstBaseUpdate,
          lastBaseUpdate: e.lastBaseUpdate,
          shared: e.shared,
          effects: e.effects,
        }));
  }
  function wr(e, t) {
    return {
      eventTime: e,
      lane: t,
      tag: 0,
      payload: null,
      callback: null,
      next: null,
    };
  }
  function Yr(e, t, r) {
    var l = e.updateQueue;
    if (l === null) return null;
    if (((l = l.shared), (Oe & 2) !== 0)) {
      var a = l.pending;
      return (
        a === null ? (t.next = t) : ((t.next = a.next), (a.next = t)),
        (l.pending = t),
        gr(e, r)
      );
    }
    return (
      (a = l.interleaved),
      a === null ? ((t.next = t), Ei(l)) : ((t.next = a.next), (a.next = t)),
      (l.interleaved = t),
      gr(e, r)
    );
  }
  function Ao(e, t, r) {
    if (
      ((t = t.updateQueue), t !== null && ((t = t.shared), (r & 4194240) !== 0))
    ) {
      var l = t.lanes;
      ((l &= e.pendingLanes), (r |= l), (t.lanes = r), Ia(e, r));
    }
  }
  function oc(e, t) {
    var r = e.updateQueue,
      l = e.alternate;
    if (l !== null && ((l = l.updateQueue), r === l)) {
      var a = null,
        u = null;
      if (((r = r.firstBaseUpdate), r !== null)) {
        do {
          var h = {
            eventTime: r.eventTime,
            lane: r.lane,
            tag: r.tag,
            payload: r.payload,
            callback: r.callback,
            next: null,
          };
          (u === null ? (a = u = h) : (u = u.next = h), (r = r.next));
        } while (r !== null);
        u === null ? (a = u = t) : (u = u.next = t);
      } else a = u = t;
      ((r = {
        baseState: l.baseState,
        firstBaseUpdate: a,
        lastBaseUpdate: u,
        shared: l.shared,
        effects: l.effects,
      }),
        (e.updateQueue = r));
      return;
    }
    ((e = r.lastBaseUpdate),
      e === null ? (r.firstBaseUpdate = t) : (e.next = t),
      (r.lastBaseUpdate = t));
  }
  function $o(e, t, r, l) {
    var a = e.updateQueue;
    Qr = !1;
    var u = a.firstBaseUpdate,
      h = a.lastBaseUpdate,
      g = a.shared.pending;
    if (g !== null) {
      a.shared.pending = null;
      var E = g,
        O = E.next;
      ((E.next = null), h === null ? (u = O) : (h.next = O), (h = E));
      var A = e.alternate;
      A !== null &&
        ((A = A.updateQueue),
        (g = A.lastBaseUpdate),
        g !== h &&
          (g === null ? (A.firstBaseUpdate = O) : (g.next = O),
          (A.lastBaseUpdate = E)));
    }
    if (u !== null) {
      var H = a.baseState;
      ((h = 0), (A = O = E = null), (g = u));
      do {
        var U = g.lane,
          q = g.eventTime;
        if ((l & U) === U) {
          A !== null &&
            (A = A.next =
              {
                eventTime: q,
                lane: 0,
                tag: g.tag,
                payload: g.payload,
                callback: g.callback,
                next: null,
              });
          e: {
            var re = e,
              ne = g;
            switch (((U = t), (q = r), ne.tag)) {
              case 1:
                if (((re = ne.payload), typeof re == "function")) {
                  H = re.call(q, H, U);
                  break e;
                }
                H = re;
                break e;
              case 3:
                re.flags = (re.flags & -65537) | 128;
              case 0:
                if (
                  ((re = ne.payload),
                  (U = typeof re == "function" ? re.call(q, H, U) : re),
                  U == null)
                )
                  break e;
                H = G({}, H, U);
                break e;
              case 2:
                Qr = !0;
            }
          }
          g.callback !== null &&
            g.lane !== 0 &&
            ((e.flags |= 64),
            (U = a.effects),
            U === null ? (a.effects = [g]) : U.push(g));
        } else
          ((q = {
            eventTime: q,
            lane: U,
            tag: g.tag,
            payload: g.payload,
            callback: g.callback,
            next: null,
          }),
            A === null ? ((O = A = q), (E = H)) : (A = A.next = q),
            (h |= U));
        if (((g = g.next), g === null)) {
          if (((g = a.shared.pending), g === null)) break;
          ((U = g),
            (g = U.next),
            (U.next = null),
            (a.lastBaseUpdate = U),
            (a.shared.pending = null));
        }
      } while (!0);
      if (
        (A === null && (E = H),
        (a.baseState = E),
        (a.firstBaseUpdate = O),
        (a.lastBaseUpdate = A),
        (t = a.shared.interleaved),
        t !== null)
      ) {
        a = t;
        do ((h |= a.lane), (a = a.next));
        while (a !== t);
      } else u === null && (a.shared.lanes = 0);
      ((hn |= h), (e.lanes = h), (e.memoizedState = H));
    }
  }
  function ac(e, t, r) {
    if (((e = t.effects), (t.effects = null), e !== null))
      for (t = 0; t < e.length; t++) {
        var l = e[t],
          a = l.callback;
        if (a !== null) {
          if (((l.callback = null), (l = r), typeof a != "function"))
            throw Error(i(191, a));
          a.call(l);
        }
      }
  }
  var Nl = {},
    ar = Br(Nl),
    Dl = Br(Nl),
    Ol = Br(Nl);
  function fn(e) {
    if (e === Nl) throw Error(i(174));
    return e;
  }
  function ki(e, t) {
    switch ((Be(Ol, t), Be(Dl, e), Be(ar, Nl), (e = t.nodeType), e)) {
      case 9:
      case 11:
        t = (t = t.documentElement) ? t.namespaceURI : Rn(null, "");
        break;
      default:
        ((e = e === 8 ? t.parentNode : t),
          (t = e.namespaceURI || null),
          (e = e.tagName),
          (t = Rn(t, e)));
    }
    (Ve(ar), Be(ar, t));
  }
  function Kn() {
    (Ve(ar), Ve(Dl), Ve(Ol));
  }
  function ic(e) {
    fn(Ol.current);
    var t = fn(ar.current),
      r = Rn(t, e.type);
    t !== r && (Be(Dl, e), Be(ar, r));
  }
  function xi(e) {
    Dl.current === e && (Ve(ar), Ve(Dl));
  }
  var Ye = Br(0);
  function Ho(e) {
    for (var t = e; t !== null; ) {
      if (t.tag === 13) {
        var r = t.memoizedState;
        if (
          r !== null &&
          ((r = r.dehydrated), r === null || r.data === "$?" || r.data === "$!")
        )
          return t;
      } else if (t.tag === 19 && t.memoizedProps.revealOrder !== void 0) {
        if ((t.flags & 128) !== 0) return t;
      } else if (t.child !== null) {
        ((t.child.return = t), (t = t.child));
        continue;
      }
      if (t === e) break;
      for (; t.sibling === null; ) {
        if (t.return === null || t.return === e) return null;
        t = t.return;
      }
      ((t.sibling.return = t.return), (t = t.sibling));
    }
    return null;
  }
  var Ci = [];
  function Pi() {
    for (var e = 0; e < Ci.length; e++)
      Ci[e]._workInProgressVersionPrimary = null;
    Ci.length = 0;
  }
  var Bo = Y.ReactCurrentDispatcher,
    Li = Y.ReactCurrentBatchConfig,
    dn = 0,
    Ke = null,
    et = null,
    nt = null,
    Wo = !1,
    zl = !1,
    Fl = 0,
    cp = 0;
  function ct() {
    throw Error(i(321));
  }
  function _i(e, t) {
    if (t === null) return !1;
    for (var r = 0; r < t.length && r < e.length; r++)
      if (!Kt(e[r], t[r])) return !1;
    return !0;
  }
  function Ti(e, t, r, l, a, u) {
    if (
      ((dn = u),
      (Ke = t),
      (t.memoizedState = null),
      (t.updateQueue = null),
      (t.lanes = 0),
      (Bo.current = e === null || e.memoizedState === null ? pp : mp),
      (e = r(l, a)),
      zl)
    ) {
      u = 0;
      do {
        if (((zl = !1), (Fl = 0), 25 <= u)) throw Error(i(301));
        ((u += 1),
          (nt = et = null),
          (t.updateQueue = null),
          (Bo.current = yp),
          (e = r(l, a)));
      } while (zl);
    }
    if (
      ((Bo.current = Yo),
      (t = et !== null && et.next !== null),
      (dn = 0),
      (nt = et = Ke = null),
      (Wo = !1),
      t)
    )
      throw Error(i(300));
    return e;
  }
  function Mi() {
    var e = Fl !== 0;
    return ((Fl = 0), e);
  }
  function ir() {
    var e = {
      memoizedState: null,
      baseState: null,
      baseQueue: null,
      queue: null,
      next: null,
    };
    return (nt === null ? (Ke.memoizedState = nt = e) : (nt = nt.next = e), nt);
  }
  function At() {
    if (et === null) {
      var e = Ke.alternate;
      e = e !== null ? e.memoizedState : null;
    } else e = et.next;
    var t = nt === null ? Ke.memoizedState : nt.next;
    if (t !== null) ((nt = t), (et = e));
    else {
      if (e === null) throw Error(i(310));
      ((et = e),
        (e = {
          memoizedState: et.memoizedState,
          baseState: et.baseState,
          baseQueue: et.baseQueue,
          queue: et.queue,
          next: null,
        }),
        nt === null ? (Ke.memoizedState = nt = e) : (nt = nt.next = e));
    }
    return nt;
  }
  function Il(e, t) {
    return typeof t == "function" ? t(e) : t;
  }
  function Ni(e) {
    var t = At(),
      r = t.queue;
    if (r === null) throw Error(i(311));
    r.lastRenderedReducer = e;
    var l = et,
      a = l.baseQueue,
      u = r.pending;
    if (u !== null) {
      if (a !== null) {
        var h = a.next;
        ((a.next = u.next), (u.next = h));
      }
      ((l.baseQueue = a = u), (r.pending = null));
    }
    if (a !== null) {
      ((u = a.next), (l = l.baseState));
      var g = (h = null),
        E = null,
        O = u;
      do {
        var A = O.lane;
        if ((dn & A) === A)
          (E !== null &&
            (E = E.next =
              {
                lane: 0,
                action: O.action,
                hasEagerState: O.hasEagerState,
                eagerState: O.eagerState,
                next: null,
              }),
            (l = O.hasEagerState ? O.eagerState : e(l, O.action)));
        else {
          var H = {
            lane: A,
            action: O.action,
            hasEagerState: O.hasEagerState,
            eagerState: O.eagerState,
            next: null,
          };
          (E === null ? ((g = E = H), (h = l)) : (E = E.next = H),
            (Ke.lanes |= A),
            (hn |= A));
        }
        O = O.next;
      } while (O !== null && O !== u);
      (E === null ? (h = l) : (E.next = g),
        Kt(l, t.memoizedState) || (kt = !0),
        (t.memoizedState = l),
        (t.baseState = h),
        (t.baseQueue = E),
        (r.lastRenderedState = l));
    }
    if (((e = r.interleaved), e !== null)) {
      a = e;
      do ((u = a.lane), (Ke.lanes |= u), (hn |= u), (a = a.next));
      while (a !== e);
    } else a === null && (r.lanes = 0);
    return [t.memoizedState, r.dispatch];
  }
  function Di(e) {
    var t = At(),
      r = t.queue;
    if (r === null) throw Error(i(311));
    r.lastRenderedReducer = e;
    var l = r.dispatch,
      a = r.pending,
      u = t.memoizedState;
    if (a !== null) {
      r.pending = null;
      var h = (a = a.next);
      do ((u = e(u, h.action)), (h = h.next));
      while (h !== a);
      (Kt(u, t.memoizedState) || (kt = !0),
        (t.memoizedState = u),
        t.baseQueue === null && (t.baseState = u),
        (r.lastRenderedState = u));
    }
    return [u, l];
  }
  function uc() {}
  function sc(e, t) {
    var r = Ke,
      l = At(),
      a = t(),
      u = !Kt(l.memoizedState, a);
    if (
      (u && ((l.memoizedState = a), (kt = !0)),
      (l = l.queue),
      Oi(dc.bind(null, r, l, e), [e]),
      l.getSnapshot !== t || u || (nt !== null && nt.memoizedState.tag & 1))
    ) {
      if (
        ((r.flags |= 2048),
        jl(9, fc.bind(null, r, l, a, t), void 0, null),
        lt === null)
      )
        throw Error(i(349));
      (dn & 30) !== 0 || cc(r, t, a);
    }
    return a;
  }
  function cc(e, t, r) {
    ((e.flags |= 16384),
      (e = { getSnapshot: t, value: r }),
      (t = Ke.updateQueue),
      t === null
        ? ((t = { lastEffect: null, stores: null }),
          (Ke.updateQueue = t),
          (t.stores = [e]))
        : ((r = t.stores), r === null ? (t.stores = [e]) : r.push(e)));
  }
  function fc(e, t, r, l) {
    ((t.value = r), (t.getSnapshot = l), hc(t) && pc(e));
  }
  function dc(e, t, r) {
    return r(function () {
      hc(t) && pc(e);
    });
  }
  function hc(e) {
    var t = e.getSnapshot;
    e = e.value;
    try {
      var r = t();
      return !Kt(e, r);
    } catch {
      return !0;
    }
  }
  function pc(e) {
    var t = gr(e, 1);
    t !== null && qt(t, e, 1, -1);
  }
  function mc(e) {
    var t = ir();
    return (
      typeof e == "function" && (e = e()),
      (t.memoizedState = t.baseState = e),
      (e = {
        pending: null,
        interleaved: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: Il,
        lastRenderedState: e,
      }),
      (t.queue = e),
      (e = e.dispatch = hp.bind(null, Ke, e)),
      [t.memoizedState, e]
    );
  }
  function jl(e, t, r, l) {
    return (
      (e = { tag: e, create: t, destroy: r, deps: l, next: null }),
      (t = Ke.updateQueue),
      t === null
        ? ((t = { lastEffect: null, stores: null }),
          (Ke.updateQueue = t),
          (t.lastEffect = e.next = e))
        : ((r = t.lastEffect),
          r === null
            ? (t.lastEffect = e.next = e)
            : ((l = r.next), (r.next = e), (e.next = l), (t.lastEffect = e))),
      e
    );
  }
  function yc() {
    return At().memoizedState;
  }
  function Vo(e, t, r, l) {
    var a = ir();
    ((Ke.flags |= e),
      (a.memoizedState = jl(1 | t, r, void 0, l === void 0 ? null : l)));
  }
  function Qo(e, t, r, l) {
    var a = At();
    l = l === void 0 ? null : l;
    var u = void 0;
    if (et !== null) {
      var h = et.memoizedState;
      if (((u = h.destroy), l !== null && _i(l, h.deps))) {
        a.memoizedState = jl(t, r, u, l);
        return;
      }
    }
    ((Ke.flags |= e), (a.memoizedState = jl(1 | t, r, u, l)));
  }
  function vc(e, t) {
    return Vo(8390656, 8, e, t);
  }
  function Oi(e, t) {
    return Qo(2048, 8, e, t);
  }
  function gc(e, t) {
    return Qo(4, 2, e, t);
  }
  function wc(e, t) {
    return Qo(4, 4, e, t);
  }
  function Sc(e, t) {
    if (typeof t == "function")
      return (
        (e = e()),
        t(e),
        function () {
          t(null);
        }
      );
    if (t != null)
      return (
        (e = e()),
        (t.current = e),
        function () {
          t.current = null;
        }
      );
  }
  function Ec(e, t, r) {
    return (
      (r = r != null ? r.concat([e]) : null),
      Qo(4, 4, Sc.bind(null, t, e), r)
    );
  }
  function zi() {}
  function Rc(e, t) {
    var r = At();
    t = t === void 0 ? null : t;
    var l = r.memoizedState;
    return l !== null && t !== null && _i(t, l[1])
      ? l[0]
      : ((r.memoizedState = [e, t]), e);
  }
  function kc(e, t) {
    var r = At();
    t = t === void 0 ? null : t;
    var l = r.memoizedState;
    return l !== null && t !== null && _i(t, l[1])
      ? l[0]
      : ((e = e()), (r.memoizedState = [e, t]), e);
  }
  function xc(e, t, r) {
    return (dn & 21) === 0
      ? (e.baseState && ((e.baseState = !1), (kt = !0)), (e.memoizedState = r))
      : (Kt(r, t) ||
          ((r = es()), (Ke.lanes |= r), (hn |= r), (e.baseState = !0)),
        t);
  }
  function fp(e, t) {
    var r = Ae;
    ((Ae = r !== 0 && 4 > r ? r : 4), e(!0));
    var l = Li.transition;
    Li.transition = {};
    try {
      (e(!1), t());
    } finally {
      ((Ae = r), (Li.transition = l));
    }
  }
  function Cc() {
    return At().memoizedState;
  }
  function dp(e, t, r) {
    var l = Gr(e);
    if (
      ((r = {
        lane: l,
        action: r,
        hasEagerState: !1,
        eagerState: null,
        next: null,
      }),
      Pc(e))
    )
      Lc(t, r);
    else if (((r = nc(e, t, r, l)), r !== null)) {
      var a = wt();
      (qt(r, e, l, a), _c(r, t, l));
    }
  }
  function hp(e, t, r) {
    var l = Gr(e),
      a = {
        lane: l,
        action: r,
        hasEagerState: !1,
        eagerState: null,
        next: null,
      };
    if (Pc(e)) Lc(t, a);
    else {
      var u = e.alternate;
      if (
        e.lanes === 0 &&
        (u === null || u.lanes === 0) &&
        ((u = t.lastRenderedReducer), u !== null)
      )
        try {
          var h = t.lastRenderedState,
            g = u(h, r);
          if (((a.hasEagerState = !0), (a.eagerState = g), Kt(g, h))) {
            var E = t.interleaved;
            (E === null
              ? ((a.next = a), Ei(t))
              : ((a.next = E.next), (E.next = a)),
              (t.interleaved = a));
            return;
          }
        } catch {}
      ((r = nc(e, t, a, l)),
        r !== null && ((a = wt()), qt(r, e, l, a), _c(r, t, l)));
    }
  }
  function Pc(e) {
    var t = e.alternate;
    return e === Ke || (t !== null && t === Ke);
  }
  function Lc(e, t) {
    zl = Wo = !0;
    var r = e.pending;
    (r === null ? (t.next = t) : ((t.next = r.next), (r.next = t)),
      (e.pending = t));
  }
  function _c(e, t, r) {
    if ((r & 4194240) !== 0) {
      var l = t.lanes;
      ((l &= e.pendingLanes), (r |= l), (t.lanes = r), Ia(e, r));
    }
  }
  var Yo = {
      readContext: Ut,
      useCallback: ct,
      useContext: ct,
      useEffect: ct,
      useImperativeHandle: ct,
      useInsertionEffect: ct,
      useLayoutEffect: ct,
      useMemo: ct,
      useReducer: ct,
      useRef: ct,
      useState: ct,
      useDebugValue: ct,
      useDeferredValue: ct,
      useTransition: ct,
      useMutableSource: ct,
      useSyncExternalStore: ct,
      useId: ct,
      unstable_isNewReconciler: !1,
    },
    pp = {
      readContext: Ut,
      useCallback: function (e, t) {
        return ((ir().memoizedState = [e, t === void 0 ? null : t]), e);
      },
      useContext: Ut,
      useEffect: vc,
      useImperativeHandle: function (e, t, r) {
        return (
          (r = r != null ? r.concat([e]) : null),
          Vo(4194308, 4, Sc.bind(null, t, e), r)
        );
      },
      useLayoutEffect: function (e, t) {
        return Vo(4194308, 4, e, t);
      },
      useInsertionEffect: function (e, t) {
        return Vo(4, 2, e, t);
      },
      useMemo: function (e, t) {
        var r = ir();
        return (
          (t = t === void 0 ? null : t),
          (e = e()),
          (r.memoizedState = [e, t]),
          e
        );
      },
      useReducer: function (e, t, r) {
        var l = ir();
        return (
          (t = r !== void 0 ? r(t) : t),
          (l.memoizedState = l.baseState = t),
          (e = {
            pending: null,
            interleaved: null,
            lanes: 0,
            dispatch: null,
            lastRenderedReducer: e,
            lastRenderedState: t,
          }),
          (l.queue = e),
          (e = e.dispatch = dp.bind(null, Ke, e)),
          [l.memoizedState, e]
        );
      },
      useRef: function (e) {
        var t = ir();
        return ((e = { current: e }), (t.memoizedState = e));
      },
      useState: mc,
      useDebugValue: zi,
      useDeferredValue: function (e) {
        return (ir().memoizedState = e);
      },
      useTransition: function () {
        var e = mc(!1),
          t = e[0];
        return ((e = fp.bind(null, e[1])), (ir().memoizedState = e), [t, e]);
      },
      useMutableSource: function () {},
      useSyncExternalStore: function (e, t, r) {
        var l = Ke,
          a = ir();
        if (Qe) {
          if (r === void 0) throw Error(i(407));
          r = r();
        } else {
          if (((r = t()), lt === null)) throw Error(i(349));
          (dn & 30) !== 0 || cc(l, t, r);
        }
        a.memoizedState = r;
        var u = { value: r, getSnapshot: t };
        return (
          (a.queue = u),
          vc(dc.bind(null, l, u, e), [e]),
          (l.flags |= 2048),
          jl(9, fc.bind(null, l, u, r, t), void 0, null),
          r
        );
      },
      useId: function () {
        var e = ir(),
          t = lt.identifierPrefix;
        if (Qe) {
          var r = vr,
            l = yr;
          ((r = (l & ~(1 << (32 - Se(l) - 1))).toString(32) + r),
            (t = ":" + t + "R" + r),
            (r = Fl++),
            0 < r && (t += "H" + r.toString(32)),
            (t += ":"));
        } else ((r = cp++), (t = ":" + t + "r" + r.toString(32) + ":"));
        return (e.memoizedState = t);
      },
      unstable_isNewReconciler: !1,
    },
    mp = {
      readContext: Ut,
      useCallback: Rc,
      useContext: Ut,
      useEffect: Oi,
      useImperativeHandle: Ec,
      useInsertionEffect: gc,
      useLayoutEffect: wc,
      useMemo: kc,
      useReducer: Ni,
      useRef: yc,
      useState: function () {
        return Ni(Il);
      },
      useDebugValue: zi,
      useDeferredValue: function (e) {
        var t = At();
        return xc(t, et.memoizedState, e);
      },
      useTransition: function () {
        var e = Ni(Il)[0],
          t = At().memoizedState;
        return [e, t];
      },
      useMutableSource: uc,
      useSyncExternalStore: sc,
      useId: Cc,
      unstable_isNewReconciler: !1,
    },
    yp = {
      readContext: Ut,
      useCallback: Rc,
      useContext: Ut,
      useEffect: Oi,
      useImperativeHandle: Ec,
      useInsertionEffect: gc,
      useLayoutEffect: wc,
      useMemo: kc,
      useReducer: Di,
      useRef: yc,
      useState: function () {
        return Di(Il);
      },
      useDebugValue: zi,
      useDeferredValue: function (e) {
        var t = At();
        return et === null ? (t.memoizedState = e) : xc(t, et.memoizedState, e);
      },
      useTransition: function () {
        var e = Di(Il)[0],
          t = At().memoizedState;
        return [e, t];
      },
      useMutableSource: uc,
      useSyncExternalStore: sc,
      useId: Cc,
      unstable_isNewReconciler: !1,
    };
  function Jt(e, t) {
    if (e && e.defaultProps) {
      ((t = G({}, t)), (e = e.defaultProps));
      for (var r in e) t[r] === void 0 && (t[r] = e[r]);
      return t;
    }
    return t;
  }
  function Fi(e, t, r, l) {
    ((t = e.memoizedState),
      (r = r(l, t)),
      (r = r == null ? t : G({}, t, r)),
      (e.memoizedState = r),
      e.lanes === 0 && (e.updateQueue.baseState = r));
  }
  var Ko = {
    isMounted: function (e) {
      return (e = e._reactInternals) ? b(e) === e : !1;
    },
    enqueueSetState: function (e, t, r) {
      e = e._reactInternals;
      var l = wt(),
        a = Gr(e),
        u = wr(l, a);
      ((u.payload = t),
        r != null && (u.callback = r),
        (t = Yr(e, u, a)),
        t !== null && (qt(t, e, a, l), Ao(t, e, a)));
    },
    enqueueReplaceState: function (e, t, r) {
      e = e._reactInternals;
      var l = wt(),
        a = Gr(e),
        u = wr(l, a);
      ((u.tag = 1),
        (u.payload = t),
        r != null && (u.callback = r),
        (t = Yr(e, u, a)),
        t !== null && (qt(t, e, a, l), Ao(t, e, a)));
    },
    enqueueForceUpdate: function (e, t) {
      e = e._reactInternals;
      var r = wt(),
        l = Gr(e),
        a = wr(r, l);
      ((a.tag = 2),
        t != null && (a.callback = t),
        (t = Yr(e, a, l)),
        t !== null && (qt(t, e, l, r), Ao(t, e, l)));
    },
  };
  function Tc(e, t, r, l, a, u, h) {
    return (
      (e = e.stateNode),
      typeof e.shouldComponentUpdate == "function"
        ? e.shouldComponentUpdate(l, u, h)
        : t.prototype && t.prototype.isPureReactComponent
          ? !kl(r, l) || !kl(a, u)
          : !0
    );
  }
  function Mc(e, t, r) {
    var l = !1,
      a = Wr,
      u = t.contextType;
    return (
      typeof u == "object" && u !== null
        ? (u = Ut(u))
        : ((a = Rt(t) ? an : st.current),
          (l = t.contextTypes),
          (u = (l = l != null) ? $n(e, a) : Wr)),
      (t = new t(r, u)),
      (e.memoizedState =
        t.state !== null && t.state !== void 0 ? t.state : null),
      (t.updater = Ko),
      (e.stateNode = t),
      (t._reactInternals = e),
      l &&
        ((e = e.stateNode),
        (e.__reactInternalMemoizedUnmaskedChildContext = a),
        (e.__reactInternalMemoizedMaskedChildContext = u)),
      t
    );
  }
  function Nc(e, t, r, l) {
    ((e = t.state),
      typeof t.componentWillReceiveProps == "function" &&
        t.componentWillReceiveProps(r, l),
      typeof t.UNSAFE_componentWillReceiveProps == "function" &&
        t.UNSAFE_componentWillReceiveProps(r, l),
      t.state !== e && Ko.enqueueReplaceState(t, t.state, null));
  }
  function Ii(e, t, r, l) {
    var a = e.stateNode;
    ((a.props = r), (a.state = e.memoizedState), (a.refs = {}), Ri(e));
    var u = t.contextType;
    (typeof u == "object" && u !== null
      ? (a.context = Ut(u))
      : ((u = Rt(t) ? an : st.current), (a.context = $n(e, u))),
      (a.state = e.memoizedState),
      (u = t.getDerivedStateFromProps),
      typeof u == "function" && (Fi(e, t, u, r), (a.state = e.memoizedState)),
      typeof t.getDerivedStateFromProps == "function" ||
        typeof a.getSnapshotBeforeUpdate == "function" ||
        (typeof a.UNSAFE_componentWillMount != "function" &&
          typeof a.componentWillMount != "function") ||
        ((t = a.state),
        typeof a.componentWillMount == "function" && a.componentWillMount(),
        typeof a.UNSAFE_componentWillMount == "function" &&
          a.UNSAFE_componentWillMount(),
        t !== a.state && Ko.enqueueReplaceState(a, a.state, null),
        $o(e, r, a, l),
        (a.state = e.memoizedState)),
      typeof a.componentDidMount == "function" && (e.flags |= 4194308));
  }
  function Xn(e, t) {
    try {
      var r = "",
        l = t;
      do ((r += ke(l)), (l = l.return));
      while (l);
      var a = r;
    } catch (u) {
      a =
        `
Error generating stack: ` +
        u.message +
        `
` +
        u.stack;
    }
    return { value: e, source: t, stack: a, digest: null };
  }
  function ji(e, t, r) {
    return { value: e, source: null, stack: r ?? null, digest: t ?? null };
  }
  function Ui(e, t) {
    try {
      console.error(t.value);
    } catch (r) {
      setTimeout(function () {
        throw r;
      });
    }
  }
  var vp = typeof WeakMap == "function" ? WeakMap : Map;
  function Dc(e, t, r) {
    ((r = wr(-1, r)), (r.tag = 3), (r.payload = { element: null }));
    var l = t.value;
    return (
      (r.callback = function () {
        (ea || ((ea = !0), (bi = l)), Ui(e, t));
      }),
      r
    );
  }
  function Oc(e, t, r) {
    ((r = wr(-1, r)), (r.tag = 3));
    var l = e.type.getDerivedStateFromError;
    if (typeof l == "function") {
      var a = t.value;
      ((r.payload = function () {
        return l(a);
      }),
        (r.callback = function () {
          Ui(e, t);
        }));
    }
    var u = e.stateNode;
    return (
      u !== null &&
        typeof u.componentDidCatch == "function" &&
        (r.callback = function () {
          (Ui(e, t),
            typeof l != "function" &&
              (Xr === null ? (Xr = new Set([this])) : Xr.add(this)));
          var h = t.stack;
          this.componentDidCatch(t.value, {
            componentStack: h !== null ? h : "",
          });
        }),
      r
    );
  }
  function zc(e, t, r) {
    var l = e.pingCache;
    if (l === null) {
      l = e.pingCache = new vp();
      var a = new Set();
      l.set(t, a);
    } else ((a = l.get(t)), a === void 0 && ((a = new Set()), l.set(t, a)));
    a.has(r) || (a.add(r), (e = Np.bind(null, e, t, r)), t.then(e, e));
  }
  function Fc(e) {
    do {
      var t;
      if (
        ((t = e.tag === 13) &&
          ((t = e.memoizedState),
          (t = t !== null ? t.dehydrated !== null : !0)),
        t)
      )
        return e;
      e = e.return;
    } while (e !== null);
    return null;
  }
  function Ic(e, t, r, l, a) {
    return (e.mode & 1) === 0
      ? (e === t
          ? (e.flags |= 65536)
          : ((e.flags |= 128),
            (r.flags |= 131072),
            (r.flags &= -52805),
            r.tag === 1 &&
              (r.alternate === null
                ? (r.tag = 17)
                : ((t = wr(-1, 1)), (t.tag = 2), Yr(r, t, 1))),
            (r.lanes |= 1)),
        e)
      : ((e.flags |= 65536), (e.lanes = a), e);
  }
  var gp = Y.ReactCurrentOwner,
    kt = !1;
  function gt(e, t, r, l) {
    t.child = e === null ? rc(t, null, r, l) : Vn(t, e.child, r, l);
  }
  function jc(e, t, r, l, a) {
    r = r.render;
    var u = t.ref;
    return (
      Yn(t, a),
      (l = Ti(e, t, r, l, u, a)),
      (r = Mi()),
      e !== null && !kt
        ? ((t.updateQueue = e.updateQueue),
          (t.flags &= -2053),
          (e.lanes &= ~a),
          Sr(e, t, a))
        : (Qe && r && di(t), (t.flags |= 1), gt(e, t, l, a), t.child)
    );
  }
  function Uc(e, t, r, l, a) {
    if (e === null) {
      var u = r.type;
      return typeof u == "function" &&
        !au(u) &&
        u.defaultProps === void 0 &&
        r.compare === null &&
        r.defaultProps === void 0
        ? ((t.tag = 15), (t.type = u), Ac(e, t, u, l, a))
        : ((e = aa(r.type, null, l, t, t.mode, a)),
          (e.ref = t.ref),
          (e.return = t),
          (t.child = e));
    }
    if (((u = e.child), (e.lanes & a) === 0)) {
      var h = u.memoizedProps;
      if (
        ((r = r.compare), (r = r !== null ? r : kl), r(h, l) && e.ref === t.ref)
      )
        return Sr(e, t, a);
    }
    return (
      (t.flags |= 1),
      (e = qr(u, l)),
      (e.ref = t.ref),
      (e.return = t),
      (t.child = e)
    );
  }
  function Ac(e, t, r, l, a) {
    if (e !== null) {
      var u = e.memoizedProps;
      if (kl(u, l) && e.ref === t.ref)
        if (((kt = !1), (t.pendingProps = l = u), (e.lanes & a) !== 0))
          (e.flags & 131072) !== 0 && (kt = !0);
        else return ((t.lanes = e.lanes), Sr(e, t, a));
    }
    return Ai(e, t, r, l, a);
  }
  function $c(e, t, r) {
    var l = t.pendingProps,
      a = l.children,
      u = e !== null ? e.memoizedState : null;
    if (l.mode === "hidden")
      if ((t.mode & 1) === 0)
        ((t.memoizedState = {
          baseLanes: 0,
          cachePool: null,
          transitions: null,
        }),
          Be(Gn, Nt),
          (Nt |= r));
      else {
        if ((r & 1073741824) === 0)
          return (
            (e = u !== null ? u.baseLanes | r : r),
            (t.lanes = t.childLanes = 1073741824),
            (t.memoizedState = {
              baseLanes: e,
              cachePool: null,
              transitions: null,
            }),
            (t.updateQueue = null),
            Be(Gn, Nt),
            (Nt |= e),
            null
          );
        ((t.memoizedState = {
          baseLanes: 0,
          cachePool: null,
          transitions: null,
        }),
          (l = u !== null ? u.baseLanes : r),
          Be(Gn, Nt),
          (Nt |= l));
      }
    else
      (u !== null ? ((l = u.baseLanes | r), (t.memoizedState = null)) : (l = r),
        Be(Gn, Nt),
        (Nt |= l));
    return (gt(e, t, a, r), t.child);
  }
  function Hc(e, t) {
    var r = t.ref;
    ((e === null && r !== null) || (e !== null && e.ref !== r)) &&
      ((t.flags |= 512), (t.flags |= 2097152));
  }
  function Ai(e, t, r, l, a) {
    var u = Rt(r) ? an : st.current;
    return (
      (u = $n(t, u)),
      Yn(t, a),
      (r = Ti(e, t, r, l, u, a)),
      (l = Mi()),
      e !== null && !kt
        ? ((t.updateQueue = e.updateQueue),
          (t.flags &= -2053),
          (e.lanes &= ~a),
          Sr(e, t, a))
        : (Qe && l && di(t), (t.flags |= 1), gt(e, t, r, a), t.child)
    );
  }
  function Bc(e, t, r, l, a) {
    if (Rt(r)) {
      var u = !0;
      No(t);
    } else u = !1;
    if ((Yn(t, a), t.stateNode === null))
      (Jo(e, t), Mc(t, r, l), Ii(t, r, l, a), (l = !0));
    else if (e === null) {
      var h = t.stateNode,
        g = t.memoizedProps;
      h.props = g;
      var E = h.context,
        O = r.contextType;
      typeof O == "object" && O !== null
        ? (O = Ut(O))
        : ((O = Rt(r) ? an : st.current), (O = $n(t, O)));
      var A = r.getDerivedStateFromProps,
        H =
          typeof A == "function" ||
          typeof h.getSnapshotBeforeUpdate == "function";
      (H ||
        (typeof h.UNSAFE_componentWillReceiveProps != "function" &&
          typeof h.componentWillReceiveProps != "function") ||
        ((g !== l || E !== O) && Nc(t, h, l, O)),
        (Qr = !1));
      var U = t.memoizedState;
      ((h.state = U),
        $o(t, l, h, a),
        (E = t.memoizedState),
        g !== l || U !== E || Et.current || Qr
          ? (typeof A == "function" && (Fi(t, r, A, l), (E = t.memoizedState)),
            (g = Qr || Tc(t, r, g, l, U, E, O))
              ? (H ||
                  (typeof h.UNSAFE_componentWillMount != "function" &&
                    typeof h.componentWillMount != "function") ||
                  (typeof h.componentWillMount == "function" &&
                    h.componentWillMount(),
                  typeof h.UNSAFE_componentWillMount == "function" &&
                    h.UNSAFE_componentWillMount()),
                typeof h.componentDidMount == "function" &&
                  (t.flags |= 4194308))
              : (typeof h.componentDidMount == "function" &&
                  (t.flags |= 4194308),
                (t.memoizedProps = l),
                (t.memoizedState = E)),
            (h.props = l),
            (h.state = E),
            (h.context = O),
            (l = g))
          : (typeof h.componentDidMount == "function" && (t.flags |= 4194308),
            (l = !1)));
    } else {
      ((h = t.stateNode),
        lc(e, t),
        (g = t.memoizedProps),
        (O = t.type === t.elementType ? g : Jt(t.type, g)),
        (h.props = O),
        (H = t.pendingProps),
        (U = h.context),
        (E = r.contextType),
        typeof E == "object" && E !== null
          ? (E = Ut(E))
          : ((E = Rt(r) ? an : st.current), (E = $n(t, E))));
      var q = r.getDerivedStateFromProps;
      ((A =
        typeof q == "function" ||
        typeof h.getSnapshotBeforeUpdate == "function") ||
        (typeof h.UNSAFE_componentWillReceiveProps != "function" &&
          typeof h.componentWillReceiveProps != "function") ||
        ((g !== H || U !== E) && Nc(t, h, l, E)),
        (Qr = !1),
        (U = t.memoizedState),
        (h.state = U),
        $o(t, l, h, a));
      var re = t.memoizedState;
      g !== H || U !== re || Et.current || Qr
        ? (typeof q == "function" && (Fi(t, r, q, l), (re = t.memoizedState)),
          (O = Qr || Tc(t, r, O, l, U, re, E) || !1)
            ? (A ||
                (typeof h.UNSAFE_componentWillUpdate != "function" &&
                  typeof h.componentWillUpdate != "function") ||
                (typeof h.componentWillUpdate == "function" &&
                  h.componentWillUpdate(l, re, E),
                typeof h.UNSAFE_componentWillUpdate == "function" &&
                  h.UNSAFE_componentWillUpdate(l, re, E)),
              typeof h.componentDidUpdate == "function" && (t.flags |= 4),
              typeof h.getSnapshotBeforeUpdate == "function" &&
                (t.flags |= 1024))
            : (typeof h.componentDidUpdate != "function" ||
                (g === e.memoizedProps && U === e.memoizedState) ||
                (t.flags |= 4),
              typeof h.getSnapshotBeforeUpdate != "function" ||
                (g === e.memoizedProps && U === e.memoizedState) ||
                (t.flags |= 1024),
              (t.memoizedProps = l),
              (t.memoizedState = re)),
          (h.props = l),
          (h.state = re),
          (h.context = E),
          (l = O))
        : (typeof h.componentDidUpdate != "function" ||
            (g === e.memoizedProps && U === e.memoizedState) ||
            (t.flags |= 4),
          typeof h.getSnapshotBeforeUpdate != "function" ||
            (g === e.memoizedProps && U === e.memoizedState) ||
            (t.flags |= 1024),
          (l = !1));
    }
    return $i(e, t, r, l, u, a);
  }
  function $i(e, t, r, l, a, u) {
    Hc(e, t);
    var h = (t.flags & 128) !== 0;
    if (!l && !h) return (a && Ks(t, r, !1), Sr(e, t, u));
    ((l = t.stateNode), (gp.current = t));
    var g =
      h && typeof r.getDerivedStateFromError != "function" ? null : l.render();
    return (
      (t.flags |= 1),
      e !== null && h
        ? ((t.child = Vn(t, e.child, null, u)), (t.child = Vn(t, null, g, u)))
        : gt(e, t, g, u),
      (t.memoizedState = l.state),
      a && Ks(t, r, !0),
      t.child
    );
  }
  function Wc(e) {
    var t = e.stateNode;
    (t.pendingContext
      ? Qs(e, t.pendingContext, t.pendingContext !== t.context)
      : t.context && Qs(e, t.context, !1),
      ki(e, t.containerInfo));
  }
  function Vc(e, t, r, l, a) {
    return (Wn(), yi(a), (t.flags |= 256), gt(e, t, r, l), t.child);
  }
  var Hi = { dehydrated: null, treeContext: null, retryLane: 0 };
  function Bi(e) {
    return { baseLanes: e, cachePool: null, transitions: null };
  }
  function Qc(e, t, r) {
    var l = t.pendingProps,
      a = Ye.current,
      u = !1,
      h = (t.flags & 128) !== 0,
      g;
    if (
      ((g = h) ||
        (g = e !== null && e.memoizedState === null ? !1 : (a & 2) !== 0),
      g
        ? ((u = !0), (t.flags &= -129))
        : (e === null || e.memoizedState !== null) && (a |= 1),
      Be(Ye, a & 1),
      e === null)
    )
      return (
        mi(t),
        (e = t.memoizedState),
        e !== null && ((e = e.dehydrated), e !== null)
          ? ((t.mode & 1) === 0
              ? (t.lanes = 1)
              : e.data === "$!"
                ? (t.lanes = 8)
                : (t.lanes = 1073741824),
            null)
          : ((h = l.children),
            (e = l.fallback),
            u
              ? ((l = t.mode),
                (u = t.child),
                (h = { mode: "hidden", children: h }),
                (l & 1) === 0 && u !== null
                  ? ((u.childLanes = 0), (u.pendingProps = h))
                  : (u = ia(h, l, 0, null)),
                (e = vn(e, l, r, null)),
                (u.return = t),
                (e.return = t),
                (u.sibling = e),
                (t.child = u),
                (t.child.memoizedState = Bi(r)),
                (t.memoizedState = Hi),
                e)
              : Wi(t, h))
      );
    if (((a = e.memoizedState), a !== null && ((g = a.dehydrated), g !== null)))
      return wp(e, t, h, l, g, a, r);
    if (u) {
      ((u = l.fallback), (h = t.mode), (a = e.child), (g = a.sibling));
      var E = { mode: "hidden", children: l.children };
      return (
        (h & 1) === 0 && t.child !== a
          ? ((l = t.child),
            (l.childLanes = 0),
            (l.pendingProps = E),
            (t.deletions = null))
          : ((l = qr(a, E)), (l.subtreeFlags = a.subtreeFlags & 14680064)),
        g !== null ? (u = qr(g, u)) : ((u = vn(u, h, r, null)), (u.flags |= 2)),
        (u.return = t),
        (l.return = t),
        (l.sibling = u),
        (t.child = l),
        (l = u),
        (u = t.child),
        (h = e.child.memoizedState),
        (h =
          h === null
            ? Bi(r)
            : {
                baseLanes: h.baseLanes | r,
                cachePool: null,
                transitions: h.transitions,
              }),
        (u.memoizedState = h),
        (u.childLanes = e.childLanes & ~r),
        (t.memoizedState = Hi),
        l
      );
    }
    return (
      (u = e.child),
      (e = u.sibling),
      (l = qr(u, { mode: "visible", children: l.children })),
      (t.mode & 1) === 0 && (l.lanes = r),
      (l.return = t),
      (l.sibling = null),
      e !== null &&
        ((r = t.deletions),
        r === null ? ((t.deletions = [e]), (t.flags |= 16)) : r.push(e)),
      (t.child = l),
      (t.memoizedState = null),
      l
    );
  }
  function Wi(e, t) {
    return (
      (t = ia({ mode: "visible", children: t }, e.mode, 0, null)),
      (t.return = e),
      (e.child = t)
    );
  }
  function Xo(e, t, r, l) {
    return (
      l !== null && yi(l),
      Vn(t, e.child, null, r),
      (e = Wi(t, t.pendingProps.children)),
      (e.flags |= 2),
      (t.memoizedState = null),
      e
    );
  }
  function wp(e, t, r, l, a, u, h) {
    if (r)
      return t.flags & 256
        ? ((t.flags &= -257), (l = ji(Error(i(422)))), Xo(e, t, h, l))
        : t.memoizedState !== null
          ? ((t.child = e.child), (t.flags |= 128), null)
          : ((u = l.fallback),
            (a = t.mode),
            (l = ia({ mode: "visible", children: l.children }, a, 0, null)),
            (u = vn(u, a, h, null)),
            (u.flags |= 2),
            (l.return = t),
            (u.return = t),
            (l.sibling = u),
            (t.child = l),
            (t.mode & 1) !== 0 && Vn(t, e.child, null, h),
            (t.child.memoizedState = Bi(h)),
            (t.memoizedState = Hi),
            u);
    if ((t.mode & 1) === 0) return Xo(e, t, h, null);
    if (a.data === "$!") {
      if (((l = a.nextSibling && a.nextSibling.dataset), l)) var g = l.dgst;
      return (
        (l = g),
        (u = Error(i(419))),
        (l = ji(u, l, void 0)),
        Xo(e, t, h, l)
      );
    }
    if (((g = (h & e.childLanes) !== 0), kt || g)) {
      if (((l = lt), l !== null)) {
        switch (h & -h) {
          case 4:
            a = 2;
            break;
          case 16:
            a = 8;
            break;
          case 64:
          case 128:
          case 256:
          case 512:
          case 1024:
          case 2048:
          case 4096:
          case 8192:
          case 16384:
          case 32768:
          case 65536:
          case 131072:
          case 262144:
          case 524288:
          case 1048576:
          case 2097152:
          case 4194304:
          case 8388608:
          case 16777216:
          case 33554432:
          case 67108864:
            a = 32;
            break;
          case 536870912:
            a = 268435456;
            break;
          default:
            a = 0;
        }
        ((a = (a & (l.suspendedLanes | h)) !== 0 ? 0 : a),
          a !== 0 &&
            a !== u.retryLane &&
            ((u.retryLane = a), gr(e, a), qt(l, e, a, -1)));
      }
      return (ou(), (l = ji(Error(i(421)))), Xo(e, t, h, l));
    }
    return a.data === "$?"
      ? ((t.flags |= 128),
        (t.child = e.child),
        (t = Dp.bind(null, e)),
        (a._reactRetry = t),
        null)
      : ((e = u.treeContext),
        (Mt = Hr(a.nextSibling)),
        (Tt = t),
        (Qe = !0),
        (Xt = null),
        e !== null &&
          ((It[jt++] = yr),
          (It[jt++] = vr),
          (It[jt++] = un),
          (yr = e.id),
          (vr = e.overflow),
          (un = t)),
        (t = Wi(t, l.children)),
        (t.flags |= 4096),
        t);
  }
  function Yc(e, t, r) {
    e.lanes |= t;
    var l = e.alternate;
    (l !== null && (l.lanes |= t), Si(e.return, t, r));
  }
  function Vi(e, t, r, l, a) {
    var u = e.memoizedState;
    u === null
      ? (e.memoizedState = {
          isBackwards: t,
          rendering: null,
          renderingStartTime: 0,
          last: l,
          tail: r,
          tailMode: a,
        })
      : ((u.isBackwards = t),
        (u.rendering = null),
        (u.renderingStartTime = 0),
        (u.last = l),
        (u.tail = r),
        (u.tailMode = a));
  }
  function Kc(e, t, r) {
    var l = t.pendingProps,
      a = l.revealOrder,
      u = l.tail;
    if ((gt(e, t, l.children, r), (l = Ye.current), (l & 2) !== 0))
      ((l = (l & 1) | 2), (t.flags |= 128));
    else {
      if (e !== null && (e.flags & 128) !== 0)
        e: for (e = t.child; e !== null; ) {
          if (e.tag === 13) e.memoizedState !== null && Yc(e, r, t);
          else if (e.tag === 19) Yc(e, r, t);
          else if (e.child !== null) {
            ((e.child.return = e), (e = e.child));
            continue;
          }
          if (e === t) break e;
          for (; e.sibling === null; ) {
            if (e.return === null || e.return === t) break e;
            e = e.return;
          }
          ((e.sibling.return = e.return), (e = e.sibling));
        }
      l &= 1;
    }
    if ((Be(Ye, l), (t.mode & 1) === 0)) t.memoizedState = null;
    else
      switch (a) {
        case "forwards":
          for (r = t.child, a = null; r !== null; )
            ((e = r.alternate),
              e !== null && Ho(e) === null && (a = r),
              (r = r.sibling));
          ((r = a),
            r === null
              ? ((a = t.child), (t.child = null))
              : ((a = r.sibling), (r.sibling = null)),
            Vi(t, !1, a, r, u));
          break;
        case "backwards":
          for (r = null, a = t.child, t.child = null; a !== null; ) {
            if (((e = a.alternate), e !== null && Ho(e) === null)) {
              t.child = a;
              break;
            }
            ((e = a.sibling), (a.sibling = r), (r = a), (a = e));
          }
          Vi(t, !0, r, null, u);
          break;
        case "together":
          Vi(t, !1, null, null, void 0);
          break;
        default:
          t.memoizedState = null;
      }
    return t.child;
  }
  function Jo(e, t) {
    (t.mode & 1) === 0 &&
      e !== null &&
      ((e.alternate = null), (t.alternate = null), (t.flags |= 2));
  }
  function Sr(e, t, r) {
    if (
      (e !== null && (t.dependencies = e.dependencies),
      (hn |= t.lanes),
      (r & t.childLanes) === 0)
    )
      return null;
    if (e !== null && t.child !== e.child) throw Error(i(153));
    if (t.child !== null) {
      for (
        e = t.child, r = qr(e, e.pendingProps), t.child = r, r.return = t;
        e.sibling !== null;
      )
        ((e = e.sibling),
          (r = r.sibling = qr(e, e.pendingProps)),
          (r.return = t));
      r.sibling = null;
    }
    return t.child;
  }
  function Sp(e, t, r) {
    switch (t.tag) {
      case 3:
        (Wc(t), Wn());
        break;
      case 5:
        ic(t);
        break;
      case 1:
        Rt(t.type) && No(t);
        break;
      case 4:
        ki(t, t.stateNode.containerInfo);
        break;
      case 10:
        var l = t.type._context,
          a = t.memoizedProps.value;
        (Be(jo, l._currentValue), (l._currentValue = a));
        break;
      case 13:
        if (((l = t.memoizedState), l !== null))
          return l.dehydrated !== null
            ? (Be(Ye, Ye.current & 1), (t.flags |= 128), null)
            : (r & t.child.childLanes) !== 0
              ? Qc(e, t, r)
              : (Be(Ye, Ye.current & 1),
                (e = Sr(e, t, r)),
                e !== null ? e.sibling : null);
        Be(Ye, Ye.current & 1);
        break;
      case 19:
        if (((l = (r & t.childLanes) !== 0), (e.flags & 128) !== 0)) {
          if (l) return Kc(e, t, r);
          t.flags |= 128;
        }
        if (
          ((a = t.memoizedState),
          a !== null &&
            ((a.rendering = null), (a.tail = null), (a.lastEffect = null)),
          Be(Ye, Ye.current),
          l)
        )
          break;
        return null;
      case 22:
      case 23:
        return ((t.lanes = 0), $c(e, t, r));
    }
    return Sr(e, t, r);
  }
  var Xc, Qi, Jc, Gc;
  ((Xc = function (e, t) {
    for (var r = t.child; r !== null; ) {
      if (r.tag === 5 || r.tag === 6) e.appendChild(r.stateNode);
      else if (r.tag !== 4 && r.child !== null) {
        ((r.child.return = r), (r = r.child));
        continue;
      }
      if (r === t) break;
      for (; r.sibling === null; ) {
        if (r.return === null || r.return === t) return;
        r = r.return;
      }
      ((r.sibling.return = r.return), (r = r.sibling));
    }
  }),
    (Qi = function () {}),
    (Jc = function (e, t, r, l) {
      var a = e.memoizedProps;
      if (a !== l) {
        ((e = t.stateNode), fn(ar.current));
        var u = null;
        switch (r) {
          case "input":
            ((a = nr(e, a)), (l = nr(e, l)), (u = []));
            break;
          case "select":
            ((a = G({}, a, { value: void 0 })),
              (l = G({}, l, { value: void 0 })),
              (u = []));
            break;
          case "textarea":
            ((a = al(e, a)), (l = al(e, l)), (u = []));
            break;
          default:
            typeof a.onClick != "function" &&
              typeof l.onClick == "function" &&
              (e.onclick = _o);
        }
        xn(r, l);
        var h;
        r = null;
        for (O in a)
          if (!l.hasOwnProperty(O) && a.hasOwnProperty(O) && a[O] != null)
            if (O === "style") {
              var g = a[O];
              for (h in g) g.hasOwnProperty(h) && (r || (r = {}), (r[h] = ""));
            } else
              O !== "dangerouslySetInnerHTML" &&
                O !== "children" &&
                O !== "suppressContentEditableWarning" &&
                O !== "suppressHydrationWarning" &&
                O !== "autoFocus" &&
                (c.hasOwnProperty(O)
                  ? u || (u = [])
                  : (u = u || []).push(O, null));
        for (O in l) {
          var E = l[O];
          if (
            ((g = a?.[O]),
            l.hasOwnProperty(O) && E !== g && (E != null || g != null))
          )
            if (O === "style")
              if (g) {
                for (h in g)
                  !g.hasOwnProperty(h) ||
                    (E && E.hasOwnProperty(h)) ||
                    (r || (r = {}), (r[h] = ""));
                for (h in E)
                  E.hasOwnProperty(h) &&
                    g[h] !== E[h] &&
                    (r || (r = {}), (r[h] = E[h]));
              } else (r || (u || (u = []), u.push(O, r)), (r = E));
            else
              O === "dangerouslySetInnerHTML"
                ? ((E = E ? E.__html : void 0),
                  (g = g ? g.__html : void 0),
                  E != null && g !== E && (u = u || []).push(O, E))
                : O === "children"
                  ? (typeof E != "string" && typeof E != "number") ||
                    (u = u || []).push(O, "" + E)
                  : O !== "suppressContentEditableWarning" &&
                    O !== "suppressHydrationWarning" &&
                    (c.hasOwnProperty(O)
                      ? (E != null && O === "onScroll" && We("scroll", e),
                        u || g === E || (u = []))
                      : (u = u || []).push(O, E));
        }
        r && (u = u || []).push("style", r);
        var O = u;
        (t.updateQueue = O) && (t.flags |= 4);
      }
    }),
    (Gc = function (e, t, r, l) {
      r !== l && (t.flags |= 4);
    }));
  function Ul(e, t) {
    if (!Qe)
      switch (e.tailMode) {
        case "hidden":
          t = e.tail;
          for (var r = null; t !== null; )
            (t.alternate !== null && (r = t), (t = t.sibling));
          r === null ? (e.tail = null) : (r.sibling = null);
          break;
        case "collapsed":
          r = e.tail;
          for (var l = null; r !== null; )
            (r.alternate !== null && (l = r), (r = r.sibling));
          l === null
            ? t || e.tail === null
              ? (e.tail = null)
              : (e.tail.sibling = null)
            : (l.sibling = null);
      }
  }
  function ft(e) {
    var t = e.alternate !== null && e.alternate.child === e.child,
      r = 0,
      l = 0;
    if (t)
      for (var a = e.child; a !== null; )
        ((r |= a.lanes | a.childLanes),
          (l |= a.subtreeFlags & 14680064),
          (l |= a.flags & 14680064),
          (a.return = e),
          (a = a.sibling));
    else
      for (a = e.child; a !== null; )
        ((r |= a.lanes | a.childLanes),
          (l |= a.subtreeFlags),
          (l |= a.flags),
          (a.return = e),
          (a = a.sibling));
    return ((e.subtreeFlags |= l), (e.childLanes = r), t);
  }
  function Ep(e, t, r) {
    var l = t.pendingProps;
    switch ((hi(t), t.tag)) {
      case 2:
      case 16:
      case 15:
      case 0:
      case 11:
      case 7:
      case 8:
      case 12:
      case 9:
      case 14:
        return (ft(t), null);
      case 1:
        return (Rt(t.type) && Mo(), ft(t), null);
      case 3:
        return (
          (l = t.stateNode),
          Kn(),
          Ve(Et),
          Ve(st),
          Pi(),
          l.pendingContext &&
            ((l.context = l.pendingContext), (l.pendingContext = null)),
          (e === null || e.child === null) &&
            (Fo(t)
              ? (t.flags |= 4)
              : e === null ||
                (e.memoizedState.isDehydrated && (t.flags & 256) === 0) ||
                ((t.flags |= 1024), Xt !== null && (ru(Xt), (Xt = null)))),
          Qi(e, t),
          ft(t),
          null
        );
      case 5:
        xi(t);
        var a = fn(Ol.current);
        if (((r = t.type), e !== null && t.stateNode != null))
          (Jc(e, t, r, l, a),
            e.ref !== t.ref && ((t.flags |= 512), (t.flags |= 2097152)));
        else {
          if (!l) {
            if (t.stateNode === null) throw Error(i(166));
            return (ft(t), null);
          }
          if (((e = fn(ar.current)), Fo(t))) {
            ((l = t.stateNode), (r = t.type));
            var u = t.memoizedProps;
            switch (((l[or] = t), (l[_l] = u), (e = (t.mode & 1) !== 0), r)) {
              case "dialog":
                (We("cancel", l), We("close", l));
                break;
              case "iframe":
              case "object":
              case "embed":
                We("load", l);
                break;
              case "video":
              case "audio":
                for (a = 0; a < Cl.length; a++) We(Cl[a], l);
                break;
              case "source":
                We("error", l);
                break;
              case "img":
              case "image":
              case "link":
                (We("error", l), We("load", l));
                break;
              case "details":
                We("toggle", l);
                break;
              case "input":
                (ll(l, u), We("invalid", l));
                break;
              case "select":
                ((l._wrapperState = { wasMultiple: !!u.multiple }),
                  We("invalid", l));
                break;
              case "textarea":
                (uo(l, u), We("invalid", l));
            }
            (xn(r, u), (a = null));
            for (var h in u)
              if (u.hasOwnProperty(h)) {
                var g = u[h];
                h === "children"
                  ? typeof g == "string"
                    ? l.textContent !== g &&
                      (u.suppressHydrationWarning !== !0 &&
                        Lo(l.textContent, g, e),
                      (a = ["children", g]))
                    : typeof g == "number" &&
                      l.textContent !== "" + g &&
                      (u.suppressHydrationWarning !== !0 &&
                        Lo(l.textContent, g, e),
                      (a = ["children", "" + g]))
                  : c.hasOwnProperty(h) &&
                    g != null &&
                    h === "onScroll" &&
                    We("scroll", l);
              }
            switch (r) {
              case "input":
                (En(l), io(l, u, !0));
                break;
              case "textarea":
                (En(l), lr(l));
                break;
              case "select":
              case "option":
                break;
              default:
                typeof u.onClick == "function" && (l.onclick = _o);
            }
            ((l = a), (t.updateQueue = l), l !== null && (t.flags |= 4));
          } else {
            ((h = a.nodeType === 9 ? a : a.ownerDocument),
              e === "http://www.w3.org/1999/xhtml" && (e = Lr(r)),
              e === "http://www.w3.org/1999/xhtml"
                ? r === "script"
                  ? ((e = h.createElement("div")),
                    (e.innerHTML = "<script><\/script>"),
                    (e = e.removeChild(e.firstChild)))
                  : typeof l.is == "string"
                    ? (e = h.createElement(r, { is: l.is }))
                    : ((e = h.createElement(r)),
                      r === "select" &&
                        ((h = e),
                        l.multiple
                          ? (h.multiple = !0)
                          : l.size && (h.size = l.size)))
                : (e = h.createElementNS(e, r)),
              (e[or] = t),
              (e[_l] = l),
              Xc(e, t, !1, !1),
              (t.stateNode = e));
            e: {
              switch (((h = Cn(r, l)), r)) {
                case "dialog":
                  (We("cancel", e), We("close", e), (a = l));
                  break;
                case "iframe":
                case "object":
                case "embed":
                  (We("load", e), (a = l));
                  break;
                case "video":
                case "audio":
                  for (a = 0; a < Cl.length; a++) We(Cl[a], e);
                  a = l;
                  break;
                case "source":
                  (We("error", e), (a = l));
                  break;
                case "img":
                case "image":
                case "link":
                  (We("error", e), We("load", e), (a = l));
                  break;
                case "details":
                  (We("toggle", e), (a = l));
                  break;
                case "input":
                  (ll(e, l), (a = nr(e, l)), We("invalid", e));
                  break;
                case "option":
                  a = l;
                  break;
                case "select":
                  ((e._wrapperState = { wasMultiple: !!l.multiple }),
                    (a = G({}, l, { value: void 0 })),
                    We("invalid", e));
                  break;
                case "textarea":
                  (uo(e, l), (a = al(e, l)), We("invalid", e));
                  break;
                default:
                  a = l;
              }
              (xn(r, a), (g = a));
              for (u in g)
                if (g.hasOwnProperty(u)) {
                  var E = g[u];
                  u === "style"
                    ? co(e, E)
                    : u === "dangerouslySetInnerHTML"
                      ? ((E = E ? E.__html : void 0), E != null && zt(e, E))
                      : u === "children"
                        ? typeof E == "string"
                          ? (r !== "textarea" || E !== "") && mt(e, E)
                          : typeof E == "number" && mt(e, "" + E)
                        : u !== "suppressContentEditableWarning" &&
                          u !== "suppressHydrationWarning" &&
                          u !== "autoFocus" &&
                          (c.hasOwnProperty(u)
                            ? E != null && u === "onScroll" && We("scroll", e)
                            : E != null && K(e, u, E, h));
                }
              switch (r) {
                case "input":
                  (En(e), io(e, l, !1));
                  break;
                case "textarea":
                  (En(e), lr(e));
                  break;
                case "option":
                  l.value != null && e.setAttribute("value", "" + Me(l.value));
                  break;
                case "select":
                  ((e.multiple = !!l.multiple),
                    (u = l.value),
                    u != null
                      ? Pr(e, !!l.multiple, u, !1)
                      : l.defaultValue != null &&
                        Pr(e, !!l.multiple, l.defaultValue, !0));
                  break;
                default:
                  typeof a.onClick == "function" && (e.onclick = _o);
              }
              switch (r) {
                case "button":
                case "input":
                case "select":
                case "textarea":
                  l = !!l.autoFocus;
                  break e;
                case "img":
                  l = !0;
                  break e;
                default:
                  l = !1;
              }
            }
            l && (t.flags |= 4);
          }
          t.ref !== null && ((t.flags |= 512), (t.flags |= 2097152));
        }
        return (ft(t), null);
      case 6:
        if (e && t.stateNode != null) Gc(e, t, e.memoizedProps, l);
        else {
          if (typeof l != "string" && t.stateNode === null) throw Error(i(166));
          if (((r = fn(Ol.current)), fn(ar.current), Fo(t))) {
            if (
              ((l = t.stateNode),
              (r = t.memoizedProps),
              (l[or] = t),
              (u = l.nodeValue !== r) && ((e = Tt), e !== null))
            )
              switch (e.tag) {
                case 3:
                  Lo(l.nodeValue, r, (e.mode & 1) !== 0);
                  break;
                case 5:
                  e.memoizedProps.suppressHydrationWarning !== !0 &&
                    Lo(l.nodeValue, r, (e.mode & 1) !== 0);
              }
            u && (t.flags |= 4);
          } else
            ((l = (r.nodeType === 9 ? r : r.ownerDocument).createTextNode(l)),
              (l[or] = t),
              (t.stateNode = l));
        }
        return (ft(t), null);
      case 13:
        if (
          (Ve(Ye),
          (l = t.memoizedState),
          e === null ||
            (e.memoizedState !== null && e.memoizedState.dehydrated !== null))
        ) {
          if (Qe && Mt !== null && (t.mode & 1) !== 0 && (t.flags & 128) === 0)
            (bs(), Wn(), (t.flags |= 98560), (u = !1));
          else if (((u = Fo(t)), l !== null && l.dehydrated !== null)) {
            if (e === null) {
              if (!u) throw Error(i(318));
              if (
                ((u = t.memoizedState),
                (u = u !== null ? u.dehydrated : null),
                !u)
              )
                throw Error(i(317));
              u[or] = t;
            } else
              (Wn(),
                (t.flags & 128) === 0 && (t.memoizedState = null),
                (t.flags |= 4));
            (ft(t), (u = !1));
          } else (Xt !== null && (ru(Xt), (Xt = null)), (u = !0));
          if (!u) return t.flags & 65536 ? t : null;
        }
        return (t.flags & 128) !== 0
          ? ((t.lanes = r), t)
          : ((l = l !== null),
            l !== (e !== null && e.memoizedState !== null) &&
              l &&
              ((t.child.flags |= 8192),
              (t.mode & 1) !== 0 &&
                (e === null || (Ye.current & 1) !== 0
                  ? tt === 0 && (tt = 3)
                  : ou())),
            t.updateQueue !== null && (t.flags |= 4),
            ft(t),
            null);
      case 4:
        return (
          Kn(),
          Qi(e, t),
          e === null && Pl(t.stateNode.containerInfo),
          ft(t),
          null
        );
      case 10:
        return (wi(t.type._context), ft(t), null);
      case 17:
        return (Rt(t.type) && Mo(), ft(t), null);
      case 19:
        if ((Ve(Ye), (u = t.memoizedState), u === null)) return (ft(t), null);
        if (((l = (t.flags & 128) !== 0), (h = u.rendering), h === null))
          if (l) Ul(u, !1);
          else {
            if (tt !== 0 || (e !== null && (e.flags & 128) !== 0))
              for (e = t.child; e !== null; ) {
                if (((h = Ho(e)), h !== null)) {
                  for (
                    t.flags |= 128,
                      Ul(u, !1),
                      l = h.updateQueue,
                      l !== null && ((t.updateQueue = l), (t.flags |= 4)),
                      t.subtreeFlags = 0,
                      l = r,
                      r = t.child;
                    r !== null;
                  )
                    ((u = r),
                      (e = l),
                      (u.flags &= 14680066),
                      (h = u.alternate),
                      h === null
                        ? ((u.childLanes = 0),
                          (u.lanes = e),
                          (u.child = null),
                          (u.subtreeFlags = 0),
                          (u.memoizedProps = null),
                          (u.memoizedState = null),
                          (u.updateQueue = null),
                          (u.dependencies = null),
                          (u.stateNode = null))
                        : ((u.childLanes = h.childLanes),
                          (u.lanes = h.lanes),
                          (u.child = h.child),
                          (u.subtreeFlags = 0),
                          (u.deletions = null),
                          (u.memoizedProps = h.memoizedProps),
                          (u.memoizedState = h.memoizedState),
                          (u.updateQueue = h.updateQueue),
                          (u.type = h.type),
                          (e = h.dependencies),
                          (u.dependencies =
                            e === null
                              ? null
                              : {
                                  lanes: e.lanes,
                                  firstContext: e.firstContext,
                                })),
                      (r = r.sibling));
                  return (Be(Ye, (Ye.current & 1) | 2), t.child);
                }
                e = e.sibling;
              }
            u.tail !== null &&
              Ne() > Zn &&
              ((t.flags |= 128), (l = !0), Ul(u, !1), (t.lanes = 4194304));
          }
        else {
          if (!l)
            if (((e = Ho(h)), e !== null)) {
              if (
                ((t.flags |= 128),
                (l = !0),
                (r = e.updateQueue),
                r !== null && ((t.updateQueue = r), (t.flags |= 4)),
                Ul(u, !0),
                u.tail === null &&
                  u.tailMode === "hidden" &&
                  !h.alternate &&
                  !Qe)
              )
                return (ft(t), null);
            } else
              2 * Ne() - u.renderingStartTime > Zn &&
                r !== 1073741824 &&
                ((t.flags |= 128), (l = !0), Ul(u, !1), (t.lanes = 4194304));
          u.isBackwards
            ? ((h.sibling = t.child), (t.child = h))
            : ((r = u.last),
              r !== null ? (r.sibling = h) : (t.child = h),
              (u.last = h));
        }
        return u.tail !== null
          ? ((t = u.tail),
            (u.rendering = t),
            (u.tail = t.sibling),
            (u.renderingStartTime = Ne()),
            (t.sibling = null),
            (r = Ye.current),
            Be(Ye, l ? (r & 1) | 2 : r & 1),
            t)
          : (ft(t), null);
      case 22:
      case 23:
        return (
          lu(),
          (l = t.memoizedState !== null),
          e !== null && (e.memoizedState !== null) !== l && (t.flags |= 8192),
          l && (t.mode & 1) !== 0
            ? (Nt & 1073741824) !== 0 &&
              (ft(t), t.subtreeFlags & 6 && (t.flags |= 8192))
            : ft(t),
          null
        );
      case 24:
        return null;
      case 25:
        return null;
    }
    throw Error(i(156, t.tag));
  }
  function Rp(e, t) {
    switch ((hi(t), t.tag)) {
      case 1:
        return (
          Rt(t.type) && Mo(),
          (e = t.flags),
          e & 65536 ? ((t.flags = (e & -65537) | 128), t) : null
        );
      case 3:
        return (
          Kn(),
          Ve(Et),
          Ve(st),
          Pi(),
          (e = t.flags),
          (e & 65536) !== 0 && (e & 128) === 0
            ? ((t.flags = (e & -65537) | 128), t)
            : null
        );
      case 5:
        return (xi(t), null);
      case 13:
        if (
          (Ve(Ye), (e = t.memoizedState), e !== null && e.dehydrated !== null)
        ) {
          if (t.alternate === null) throw Error(i(340));
          Wn();
        }
        return (
          (e = t.flags),
          e & 65536 ? ((t.flags = (e & -65537) | 128), t) : null
        );
      case 19:
        return (Ve(Ye), null);
      case 4:
        return (Kn(), null);
      case 10:
        return (wi(t.type._context), null);
      case 22:
      case 23:
        return (lu(), null);
      case 24:
        return null;
      default:
        return null;
    }
  }
  var Go = !1,
    dt = !1,
    kp = typeof WeakSet == "function" ? WeakSet : Set,
    te = null;
  function Jn(e, t) {
    var r = e.ref;
    if (r !== null)
      if (typeof r == "function")
        try {
          r(null);
        } catch (l) {
          Xe(e, t, l);
        }
      else r.current = null;
  }
  function Yi(e, t, r) {
    try {
      r();
    } catch (l) {
      Xe(e, t, l);
    }
  }
  var Zc = !1;
  function xp(e, t) {
    if (((li = yo), (e = Ts()), Ga(e))) {
      if ("selectionStart" in e)
        var r = { start: e.selectionStart, end: e.selectionEnd };
      else
        e: {
          r = ((r = e.ownerDocument) && r.defaultView) || window;
          var l = r.getSelection && r.getSelection();
          if (l && l.rangeCount !== 0) {
            r = l.anchorNode;
            var a = l.anchorOffset,
              u = l.focusNode;
            l = l.focusOffset;
            try {
              (r.nodeType, u.nodeType);
            } catch {
              r = null;
              break e;
            }
            var h = 0,
              g = -1,
              E = -1,
              O = 0,
              A = 0,
              H = e,
              U = null;
            t: for (;;) {
              for (
                var q;
                H !== r || (a !== 0 && H.nodeType !== 3) || (g = h + a),
                  H !== u || (l !== 0 && H.nodeType !== 3) || (E = h + l),
                  H.nodeType === 3 && (h += H.nodeValue.length),
                  (q = H.firstChild) !== null;
              )
                ((U = H), (H = q));
              for (;;) {
                if (H === e) break t;
                if (
                  (U === r && ++O === a && (g = h),
                  U === u && ++A === l && (E = h),
                  (q = H.nextSibling) !== null)
                )
                  break;
                ((H = U), (U = H.parentNode));
              }
              H = q;
            }
            r = g === -1 || E === -1 ? null : { start: g, end: E };
          } else r = null;
        }
      r = r || { start: 0, end: 0 };
    } else r = null;
    for (
      oi = { focusedElem: e, selectionRange: r }, yo = !1, te = t;
      te !== null;
    )
      if (
        ((t = te), (e = t.child), (t.subtreeFlags & 1028) !== 0 && e !== null)
      )
        ((e.return = t), (te = e));
      else
        for (; te !== null; ) {
          t = te;
          try {
            var re = t.alternate;
            if ((t.flags & 1024) !== 0)
              switch (t.tag) {
                case 0:
                case 11:
                case 15:
                  break;
                case 1:
                  if (re !== null) {
                    var ne = re.memoizedProps,
                      qe = re.memoizedState,
                      T = t.stateNode,
                      x = T.getSnapshotBeforeUpdate(
                        t.elementType === t.type ? ne : Jt(t.type, ne),
                        qe,
                      );
                    T.__reactInternalSnapshotBeforeUpdate = x;
                  }
                  break;
                case 3:
                  var N = t.stateNode.containerInfo;
                  N.nodeType === 1
                    ? (N.textContent = "")
                    : N.nodeType === 9 &&
                      N.documentElement &&
                      N.removeChild(N.documentElement);
                  break;
                case 5:
                case 6:
                case 4:
                case 17:
                  break;
                default:
                  throw Error(i(163));
              }
          } catch (V) {
            Xe(t, t.return, V);
          }
          if (((e = t.sibling), e !== null)) {
            ((e.return = t.return), (te = e));
            break;
          }
          te = t.return;
        }
    return ((re = Zc), (Zc = !1), re);
  }
  function Al(e, t, r) {
    var l = t.updateQueue;
    if (((l = l !== null ? l.lastEffect : null), l !== null)) {
      var a = (l = l.next);
      do {
        if ((a.tag & e) === e) {
          var u = a.destroy;
          ((a.destroy = void 0), u !== void 0 && Yi(t, r, u));
        }
        a = a.next;
      } while (a !== l);
    }
  }
  function Zo(e, t) {
    if (
      ((t = t.updateQueue), (t = t !== null ? t.lastEffect : null), t !== null)
    ) {
      var r = (t = t.next);
      do {
        if ((r.tag & e) === e) {
          var l = r.create;
          r.destroy = l();
        }
        r = r.next;
      } while (r !== t);
    }
  }
  function Ki(e) {
    var t = e.ref;
    if (t !== null) {
      var r = e.stateNode;
      (e.tag, (e = r), typeof t == "function" ? t(e) : (t.current = e));
    }
  }
  function qc(e) {
    var t = e.alternate;
    (t !== null && ((e.alternate = null), qc(t)),
      (e.child = null),
      (e.deletions = null),
      (e.sibling = null),
      e.tag === 5 &&
        ((t = e.stateNode),
        t !== null &&
          (delete t[or],
          delete t[_l],
          delete t[si],
          delete t[ap],
          delete t[ip])),
      (e.stateNode = null),
      (e.return = null),
      (e.dependencies = null),
      (e.memoizedProps = null),
      (e.memoizedState = null),
      (e.pendingProps = null),
      (e.stateNode = null),
      (e.updateQueue = null));
  }
  function bc(e) {
    return e.tag === 5 || e.tag === 3 || e.tag === 4;
  }
  function ef(e) {
    e: for (;;) {
      for (; e.sibling === null; ) {
        if (e.return === null || bc(e.return)) return null;
        e = e.return;
      }
      for (
        e.sibling.return = e.return, e = e.sibling;
        e.tag !== 5 && e.tag !== 6 && e.tag !== 18;
      ) {
        if (e.flags & 2 || e.child === null || e.tag === 4) continue e;
        ((e.child.return = e), (e = e.child));
      }
      if (!(e.flags & 2)) return e.stateNode;
    }
  }
  function Xi(e, t, r) {
    var l = e.tag;
    if (l === 5 || l === 6)
      ((e = e.stateNode),
        t
          ? r.nodeType === 8
            ? r.parentNode.insertBefore(e, t)
            : r.insertBefore(e, t)
          : (r.nodeType === 8
              ? ((t = r.parentNode), t.insertBefore(e, r))
              : ((t = r), t.appendChild(e)),
            (r = r._reactRootContainer),
            r != null || t.onclick !== null || (t.onclick = _o)));
    else if (l !== 4 && ((e = e.child), e !== null))
      for (Xi(e, t, r), e = e.sibling; e !== null; )
        (Xi(e, t, r), (e = e.sibling));
  }
  function Ji(e, t, r) {
    var l = e.tag;
    if (l === 5 || l === 6)
      ((e = e.stateNode), t ? r.insertBefore(e, t) : r.appendChild(e));
    else if (l !== 4 && ((e = e.child), e !== null))
      for (Ji(e, t, r), e = e.sibling; e !== null; )
        (Ji(e, t, r), (e = e.sibling));
  }
  var it = null,
    Gt = !1;
  function Kr(e, t, r) {
    for (r = r.child; r !== null; ) (tf(e, t, r), (r = r.sibling));
  }
  function tf(e, t, r) {
    if (vt && typeof vt.onCommitFiberUnmount == "function")
      try {
        vt.onCommitFiberUnmount(Ft, r);
      } catch {}
    switch (r.tag) {
      case 5:
        dt || Jn(r, t);
      case 6:
        var l = it,
          a = Gt;
        ((it = null),
          Kr(e, t, r),
          (it = l),
          (Gt = a),
          it !== null &&
            (Gt
              ? ((e = it),
                (r = r.stateNode),
                e.nodeType === 8
                  ? e.parentNode.removeChild(r)
                  : e.removeChild(r))
              : it.removeChild(r.stateNode)));
        break;
      case 18:
        it !== null &&
          (Gt
            ? ((e = it),
              (r = r.stateNode),
              e.nodeType === 8
                ? ui(e.parentNode, r)
                : e.nodeType === 1 && ui(e, r),
              vl(e))
            : ui(it, r.stateNode));
        break;
      case 4:
        ((l = it),
          (a = Gt),
          (it = r.stateNode.containerInfo),
          (Gt = !0),
          Kr(e, t, r),
          (it = l),
          (Gt = a));
        break;
      case 0:
      case 11:
      case 14:
      case 15:
        if (
          !dt &&
          ((l = r.updateQueue), l !== null && ((l = l.lastEffect), l !== null))
        ) {
          a = l = l.next;
          do {
            var u = a,
              h = u.destroy;
            ((u = u.tag),
              h !== void 0 && ((u & 2) !== 0 || (u & 4) !== 0) && Yi(r, t, h),
              (a = a.next));
          } while (a !== l);
        }
        Kr(e, t, r);
        break;
      case 1:
        if (
          !dt &&
          (Jn(r, t),
          (l = r.stateNode),
          typeof l.componentWillUnmount == "function")
        )
          try {
            ((l.props = r.memoizedProps),
              (l.state = r.memoizedState),
              l.componentWillUnmount());
          } catch (g) {
            Xe(r, t, g);
          }
        Kr(e, t, r);
        break;
      case 21:
        Kr(e, t, r);
        break;
      case 22:
        r.mode & 1
          ? ((dt = (l = dt) || r.memoizedState !== null), Kr(e, t, r), (dt = l))
          : Kr(e, t, r);
        break;
      default:
        Kr(e, t, r);
    }
  }
  function rf(e) {
    var t = e.updateQueue;
    if (t !== null) {
      e.updateQueue = null;
      var r = e.stateNode;
      (r === null && (r = e.stateNode = new kp()),
        t.forEach(function (l) {
          var a = Op.bind(null, e, l);
          r.has(l) || (r.add(l), l.then(a, a));
        }));
    }
  }
  function Zt(e, t) {
    var r = t.deletions;
    if (r !== null)
      for (var l = 0; l < r.length; l++) {
        var a = r[l];
        try {
          var u = e,
            h = t,
            g = h;
          e: for (; g !== null; ) {
            switch (g.tag) {
              case 5:
                ((it = g.stateNode), (Gt = !1));
                break e;
              case 3:
                ((it = g.stateNode.containerInfo), (Gt = !0));
                break e;
              case 4:
                ((it = g.stateNode.containerInfo), (Gt = !0));
                break e;
            }
            g = g.return;
          }
          if (it === null) throw Error(i(160));
          (tf(u, h, a), (it = null), (Gt = !1));
          var E = a.alternate;
          (E !== null && (E.return = null), (a.return = null));
        } catch (O) {
          Xe(a, t, O);
        }
      }
    if (t.subtreeFlags & 12854)
      for (t = t.child; t !== null; ) (nf(t, e), (t = t.sibling));
  }
  function nf(e, t) {
    var r = e.alternate,
      l = e.flags;
    switch (e.tag) {
      case 0:
      case 11:
      case 14:
      case 15:
        if ((Zt(t, e), ur(e), l & 4)) {
          try {
            (Al(3, e, e.return), Zo(3, e));
          } catch (ne) {
            Xe(e, e.return, ne);
          }
          try {
            Al(5, e, e.return);
          } catch (ne) {
            Xe(e, e.return, ne);
          }
        }
        break;
      case 1:
        (Zt(t, e), ur(e), l & 512 && r !== null && Jn(r, r.return));
        break;
      case 5:
        if (
          (Zt(t, e),
          ur(e),
          l & 512 && r !== null && Jn(r, r.return),
          e.flags & 32)
        ) {
          var a = e.stateNode;
          try {
            mt(a, "");
          } catch (ne) {
            Xe(e, e.return, ne);
          }
        }
        if (l & 4 && ((a = e.stateNode), a != null)) {
          var u = e.memoizedProps,
            h = r !== null ? r.memoizedProps : u,
            g = e.type,
            E = e.updateQueue;
          if (((e.updateQueue = null), E !== null))
            try {
              (g === "input" &&
                u.type === "radio" &&
                u.name != null &&
                ao(a, u),
                Cn(g, h));
              var O = Cn(g, u);
              for (h = 0; h < E.length; h += 2) {
                var A = E[h],
                  H = E[h + 1];
                A === "style"
                  ? co(a, H)
                  : A === "dangerouslySetInnerHTML"
                    ? zt(a, H)
                    : A === "children"
                      ? mt(a, H)
                      : K(a, A, H, O);
              }
              switch (g) {
                case "input":
                  Wt(a, u);
                  break;
                case "textarea":
                  so(a, u);
                  break;
                case "select":
                  var U = a._wrapperState.wasMultiple;
                  a._wrapperState.wasMultiple = !!u.multiple;
                  var q = u.value;
                  q != null
                    ? Pr(a, !!u.multiple, q, !1)
                    : U !== !!u.multiple &&
                      (u.defaultValue != null
                        ? Pr(a, !!u.multiple, u.defaultValue, !0)
                        : Pr(a, !!u.multiple, u.multiple ? [] : "", !1));
              }
              a[_l] = u;
            } catch (ne) {
              Xe(e, e.return, ne);
            }
        }
        break;
      case 6:
        if ((Zt(t, e), ur(e), l & 4)) {
          if (e.stateNode === null) throw Error(i(162));
          ((a = e.stateNode), (u = e.memoizedProps));
          try {
            a.nodeValue = u;
          } catch (ne) {
            Xe(e, e.return, ne);
          }
        }
        break;
      case 3:
        if (
          (Zt(t, e), ur(e), l & 4 && r !== null && r.memoizedState.isDehydrated)
        )
          try {
            vl(t.containerInfo);
          } catch (ne) {
            Xe(e, e.return, ne);
          }
        break;
      case 4:
        (Zt(t, e), ur(e));
        break;
      case 13:
        (Zt(t, e),
          ur(e),
          (a = e.child),
          a.flags & 8192 &&
            ((u = a.memoizedState !== null),
            (a.stateNode.isHidden = u),
            !u ||
              (a.alternate !== null && a.alternate.memoizedState !== null) ||
              (qi = Ne())),
          l & 4 && rf(e));
        break;
      case 22:
        if (
          ((A = r !== null && r.memoizedState !== null),
          e.mode & 1 ? ((dt = (O = dt) || A), Zt(t, e), (dt = O)) : Zt(t, e),
          ur(e),
          l & 8192)
        ) {
          if (
            ((O = e.memoizedState !== null),
            (e.stateNode.isHidden = O) && !A && (e.mode & 1) !== 0)
          )
            for (te = e, A = e.child; A !== null; ) {
              for (H = te = A; te !== null; ) {
                switch (((U = te), (q = U.child), U.tag)) {
                  case 0:
                  case 11:
                  case 14:
                  case 15:
                    Al(4, U, U.return);
                    break;
                  case 1:
                    Jn(U, U.return);
                    var re = U.stateNode;
                    if (typeof re.componentWillUnmount == "function") {
                      ((l = U), (r = U.return));
                      try {
                        ((t = l),
                          (re.props = t.memoizedProps),
                          (re.state = t.memoizedState),
                          re.componentWillUnmount());
                      } catch (ne) {
                        Xe(l, r, ne);
                      }
                    }
                    break;
                  case 5:
                    Jn(U, U.return);
                    break;
                  case 22:
                    if (U.memoizedState !== null) {
                      af(H);
                      continue;
                    }
                }
                q !== null ? ((q.return = U), (te = q)) : af(H);
              }
              A = A.sibling;
            }
          e: for (A = null, H = e; ; ) {
            if (H.tag === 5) {
              if (A === null) {
                A = H;
                try {
                  ((a = H.stateNode),
                    O
                      ? ((u = a.style),
                        typeof u.setProperty == "function"
                          ? u.setProperty("display", "none", "important")
                          : (u.display = "none"))
                      : ((g = H.stateNode),
                        (E = H.memoizedProps.style),
                        (h =
                          E != null && E.hasOwnProperty("display")
                            ? E.display
                            : null),
                        (g.style.display = kn("display", h))));
                } catch (ne) {
                  Xe(e, e.return, ne);
                }
              }
            } else if (H.tag === 6) {
              if (A === null)
                try {
                  H.stateNode.nodeValue = O ? "" : H.memoizedProps;
                } catch (ne) {
                  Xe(e, e.return, ne);
                }
            } else if (
              ((H.tag !== 22 && H.tag !== 23) ||
                H.memoizedState === null ||
                H === e) &&
              H.child !== null
            ) {
              ((H.child.return = H), (H = H.child));
              continue;
            }
            if (H === e) break e;
            for (; H.sibling === null; ) {
              if (H.return === null || H.return === e) break e;
              (A === H && (A = null), (H = H.return));
            }
            (A === H && (A = null),
              (H.sibling.return = H.return),
              (H = H.sibling));
          }
        }
        break;
      case 19:
        (Zt(t, e), ur(e), l & 4 && rf(e));
        break;
      case 21:
        break;
      default:
        (Zt(t, e), ur(e));
    }
  }
  function ur(e) {
    var t = e.flags;
    if (t & 2) {
      try {
        e: {
          for (var r = e.return; r !== null; ) {
            if (bc(r)) {
              var l = r;
              break e;
            }
            r = r.return;
          }
          throw Error(i(160));
        }
        switch (l.tag) {
          case 5:
            var a = l.stateNode;
            l.flags & 32 && (mt(a, ""), (l.flags &= -33));
            var u = ef(e);
            Ji(e, u, a);
            break;
          case 3:
          case 4:
            var h = l.stateNode.containerInfo,
              g = ef(e);
            Xi(e, g, h);
            break;
          default:
            throw Error(i(161));
        }
      } catch (E) {
        Xe(e, e.return, E);
      }
      e.flags &= -3;
    }
    t & 4096 && (e.flags &= -4097);
  }
  function Cp(e, t, r) {
    ((te = e), lf(e));
  }
  function lf(e, t, r) {
    for (var l = (e.mode & 1) !== 0; te !== null; ) {
      var a = te,
        u = a.child;
      if (a.tag === 22 && l) {
        var h = a.memoizedState !== null || Go;
        if (!h) {
          var g = a.alternate,
            E = (g !== null && g.memoizedState !== null) || dt;
          g = Go;
          var O = dt;
          if (((Go = h), (dt = E) && !O))
            for (te = a; te !== null; )
              ((h = te),
                (E = h.child),
                h.tag === 22 && h.memoizedState !== null
                  ? uf(a)
                  : E !== null
                    ? ((E.return = h), (te = E))
                    : uf(a));
          for (; u !== null; ) ((te = u), lf(u), (u = u.sibling));
          ((te = a), (Go = g), (dt = O));
        }
        of(e);
      } else
        (a.subtreeFlags & 8772) !== 0 && u !== null
          ? ((u.return = a), (te = u))
          : of(e);
    }
  }
  function of(e) {
    for (; te !== null; ) {
      var t = te;
      if ((t.flags & 8772) !== 0) {
        var r = t.alternate;
        try {
          if ((t.flags & 8772) !== 0)
            switch (t.tag) {
              case 0:
              case 11:
              case 15:
                dt || Zo(5, t);
                break;
              case 1:
                var l = t.stateNode;
                if (t.flags & 4 && !dt)
                  if (r === null) l.componentDidMount();
                  else {
                    var a =
                      t.elementType === t.type
                        ? r.memoizedProps
                        : Jt(t.type, r.memoizedProps);
                    l.componentDidUpdate(
                      a,
                      r.memoizedState,
                      l.__reactInternalSnapshotBeforeUpdate,
                    );
                  }
                var u = t.updateQueue;
                u !== null && ac(t, u, l);
                break;
              case 3:
                var h = t.updateQueue;
                if (h !== null) {
                  if (((r = null), t.child !== null))
                    switch (t.child.tag) {
                      case 5:
                        r = t.child.stateNode;
                        break;
                      case 1:
                        r = t.child.stateNode;
                    }
                  ac(t, h, r);
                }
                break;
              case 5:
                var g = t.stateNode;
                if (r === null && t.flags & 4) {
                  r = g;
                  var E = t.memoizedProps;
                  switch (t.type) {
                    case "button":
                    case "input":
                    case "select":
                    case "textarea":
                      E.autoFocus && r.focus();
                      break;
                    case "img":
                      E.src && (r.src = E.src);
                  }
                }
                break;
              case 6:
                break;
              case 4:
                break;
              case 12:
                break;
              case 13:
                if (t.memoizedState === null) {
                  var O = t.alternate;
                  if (O !== null) {
                    var A = O.memoizedState;
                    if (A !== null) {
                      var H = A.dehydrated;
                      H !== null && vl(H);
                    }
                  }
                }
                break;
              case 19:
              case 17:
              case 21:
              case 22:
              case 23:
              case 25:
                break;
              default:
                throw Error(i(163));
            }
          dt || (t.flags & 512 && Ki(t));
        } catch (U) {
          Xe(t, t.return, U);
        }
      }
      if (t === e) {
        te = null;
        break;
      }
      if (((r = t.sibling), r !== null)) {
        ((r.return = t.return), (te = r));
        break;
      }
      te = t.return;
    }
  }
  function af(e) {
    for (; te !== null; ) {
      var t = te;
      if (t === e) {
        te = null;
        break;
      }
      var r = t.sibling;
      if (r !== null) {
        ((r.return = t.return), (te = r));
        break;
      }
      te = t.return;
    }
  }
  function uf(e) {
    for (; te !== null; ) {
      var t = te;
      try {
        switch (t.tag) {
          case 0:
          case 11:
          case 15:
            var r = t.return;
            try {
              Zo(4, t);
            } catch (E) {
              Xe(t, r, E);
            }
            break;
          case 1:
            var l = t.stateNode;
            if (typeof l.componentDidMount == "function") {
              var a = t.return;
              try {
                l.componentDidMount();
              } catch (E) {
                Xe(t, a, E);
              }
            }
            var u = t.return;
            try {
              Ki(t);
            } catch (E) {
              Xe(t, u, E);
            }
            break;
          case 5:
            var h = t.return;
            try {
              Ki(t);
            } catch (E) {
              Xe(t, h, E);
            }
        }
      } catch (E) {
        Xe(t, t.return, E);
      }
      if (t === e) {
        te = null;
        break;
      }
      var g = t.sibling;
      if (g !== null) {
        ((g.return = t.return), (te = g));
        break;
      }
      te = t.return;
    }
  }
  var Pp = Math.ceil,
    qo = Y.ReactCurrentDispatcher,
    Gi = Y.ReactCurrentOwner,
    $t = Y.ReactCurrentBatchConfig,
    Oe = 0,
    lt = null,
    be = null,
    ut = 0,
    Nt = 0,
    Gn = Br(0),
    tt = 0,
    $l = null,
    hn = 0,
    bo = 0,
    Zi = 0,
    Hl = null,
    xt = null,
    qi = 0,
    Zn = 1 / 0,
    Er = null,
    ea = !1,
    bi = null,
    Xr = null,
    ta = !1,
    Jr = null,
    ra = 0,
    Bl = 0,
    eu = null,
    na = -1,
    la = 0;
  function wt() {
    return (Oe & 6) !== 0 ? Ne() : na !== -1 ? na : (na = Ne());
  }
  function Gr(e) {
    return (e.mode & 1) === 0
      ? 1
      : (Oe & 2) !== 0 && ut !== 0
        ? ut & -ut
        : sp.transition !== null
          ? (la === 0 && (la = es()), la)
          : ((e = Ae),
            e !== 0 ||
              ((e = window.event), (e = e === void 0 ? 16 : ss(e.type))),
            e);
  }
  function qt(e, t, r, l) {
    if (50 < Bl) throw ((Bl = 0), (eu = null), Error(i(185)));
    (dl(e, r, l),
      ((Oe & 2) === 0 || e !== lt) &&
        (e === lt && ((Oe & 2) === 0 && (bo |= r), tt === 4 && Zr(e, ut)),
        Ct(e, l),
        r === 1 &&
          Oe === 0 &&
          (t.mode & 1) === 0 &&
          ((Zn = Ne() + 500), Do && Vr())));
  }
  function Ct(e, t) {
    var r = e.callbackNode;
    sh(e, t);
    var l = Mn(e, e === lt ? ut : 0);
    if (l === 0)
      (r !== null && Ze(r), (e.callbackNode = null), (e.callbackPriority = 0));
    else if (((t = l & -l), e.callbackPriority !== t)) {
      if ((r != null && Ze(r), t === 1))
        (e.tag === 0 ? up(cf.bind(null, e)) : Xs(cf.bind(null, e)),
          lp(function () {
            (Oe & 6) === 0 && Vr();
          }),
          (r = null));
      else {
        switch (ts(l)) {
          case 1:
            r = fr;
            break;
          case 4:
            r = Yt;
            break;
          case 16:
            r = yt;
            break;
          case 536870912:
            r = Dr;
            break;
          default:
            r = yt;
        }
        r = gf(r, sf.bind(null, e));
      }
      ((e.callbackPriority = t), (e.callbackNode = r));
    }
  }
  function sf(e, t) {
    if (((na = -1), (la = 0), (Oe & 6) !== 0)) throw Error(i(327));
    var r = e.callbackNode;
    if (qn() && e.callbackNode !== r) return null;
    var l = Mn(e, e === lt ? ut : 0);
    if (l === 0) return null;
    if ((l & 30) !== 0 || (l & e.expiredLanes) !== 0 || t) t = oa(e, l);
    else {
      t = l;
      var a = Oe;
      Oe |= 2;
      var u = df();
      (lt !== e || ut !== t) && ((Er = null), (Zn = Ne() + 500), mn(e, t));
      do
        try {
          Tp();
          break;
        } catch (g) {
          ff(e, g);
        }
      while (!0);
      (gi(),
        (qo.current = u),
        (Oe = a),
        be !== null ? (t = 0) : ((lt = null), (ut = 0), (t = tt)));
    }
    if (t !== 0) {
      if (
        (t === 2 && ((a = za(e)), a !== 0 && ((l = a), (t = tu(e, a)))),
        t === 1)
      )
        throw ((r = $l), mn(e, 0), Zr(e, l), Ct(e, Ne()), r);
      if (t === 6) Zr(e, l);
      else {
        if (
          ((a = e.current.alternate),
          (l & 30) === 0 &&
            !Lp(a) &&
            ((t = oa(e, l)),
            t === 2 && ((u = za(e)), u !== 0 && ((l = u), (t = tu(e, u)))),
            t === 1))
        )
          throw ((r = $l), mn(e, 0), Zr(e, l), Ct(e, Ne()), r);
        switch (((e.finishedWork = a), (e.finishedLanes = l), t)) {
          case 0:
          case 1:
            throw Error(i(345));
          case 2:
            yn(e, xt, Er);
            break;
          case 3:
            if (
              (Zr(e, l),
              (l & 130023424) === l && ((t = qi + 500 - Ne()), 10 < t))
            ) {
              if (Mn(e, 0) !== 0) break;
              if (((a = e.suspendedLanes), (a & l) !== l)) {
                (wt(), (e.pingedLanes |= e.suspendedLanes & a));
                break;
              }
              e.timeoutHandle = ii(yn.bind(null, e, xt, Er), t);
              break;
            }
            yn(e, xt, Er);
            break;
          case 4:
            if ((Zr(e, l), (l & 4194240) === l)) break;
            for (t = e.eventTimes, a = -1; 0 < l; ) {
              var h = 31 - Se(l);
              ((u = 1 << h), (h = t[h]), h > a && (a = h), (l &= ~u));
            }
            if (
              ((l = a),
              (l = Ne() - l),
              (l =
                (120 > l
                  ? 120
                  : 480 > l
                    ? 480
                    : 1080 > l
                      ? 1080
                      : 1920 > l
                        ? 1920
                        : 3e3 > l
                          ? 3e3
                          : 4320 > l
                            ? 4320
                            : 1960 * Pp(l / 1960)) - l),
              10 < l)
            ) {
              e.timeoutHandle = ii(yn.bind(null, e, xt, Er), l);
              break;
            }
            yn(e, xt, Er);
            break;
          case 5:
            yn(e, xt, Er);
            break;
          default:
            throw Error(i(329));
        }
      }
    }
    return (Ct(e, Ne()), e.callbackNode === r ? sf.bind(null, e) : null);
  }
  function tu(e, t) {
    var r = Hl;
    return (
      e.current.memoizedState.isDehydrated && (mn(e, t).flags |= 256),
      (e = oa(e, t)),
      e !== 2 && ((t = xt), (xt = r), t !== null && ru(t)),
      e
    );
  }
  function ru(e) {
    xt === null ? (xt = e) : xt.push.apply(xt, e);
  }
  function Lp(e) {
    for (var t = e; ; ) {
      if (t.flags & 16384) {
        var r = t.updateQueue;
        if (r !== null && ((r = r.stores), r !== null))
          for (var l = 0; l < r.length; l++) {
            var a = r[l],
              u = a.getSnapshot;
            a = a.value;
            try {
              if (!Kt(u(), a)) return !1;
            } catch {
              return !1;
            }
          }
      }
      if (((r = t.child), t.subtreeFlags & 16384 && r !== null))
        ((r.return = t), (t = r));
      else {
        if (t === e) break;
        for (; t.sibling === null; ) {
          if (t.return === null || t.return === e) return !0;
          t = t.return;
        }
        ((t.sibling.return = t.return), (t = t.sibling));
      }
    }
    return !0;
  }
  function Zr(e, t) {
    for (
      t &= ~Zi,
        t &= ~bo,
        e.suspendedLanes |= t,
        e.pingedLanes &= ~t,
        e = e.expirationTimes;
      0 < t;
    ) {
      var r = 31 - Se(t),
        l = 1 << r;
      ((e[r] = -1), (t &= ~l));
    }
  }
  function cf(e) {
    if ((Oe & 6) !== 0) throw Error(i(327));
    qn();
    var t = Mn(e, 0);
    if ((t & 1) === 0) return (Ct(e, Ne()), null);
    var r = oa(e, t);
    if (e.tag !== 0 && r === 2) {
      var l = za(e);
      l !== 0 && ((t = l), (r = tu(e, l)));
    }
    if (r === 1) throw ((r = $l), mn(e, 0), Zr(e, t), Ct(e, Ne()), r);
    if (r === 6) throw Error(i(345));
    return (
      (e.finishedWork = e.current.alternate),
      (e.finishedLanes = t),
      yn(e, xt, Er),
      Ct(e, Ne()),
      null
    );
  }
  function nu(e, t) {
    var r = Oe;
    Oe |= 1;
    try {
      return e(t);
    } finally {
      ((Oe = r), Oe === 0 && ((Zn = Ne() + 500), Do && Vr()));
    }
  }
  function pn(e) {
    Jr !== null && Jr.tag === 0 && (Oe & 6) === 0 && qn();
    var t = Oe;
    Oe |= 1;
    var r = $t.transition,
      l = Ae;
    try {
      if ((($t.transition = null), (Ae = 1), e)) return e();
    } finally {
      ((Ae = l), ($t.transition = r), (Oe = t), (Oe & 6) === 0 && Vr());
    }
  }
  function lu() {
    ((Nt = Gn.current), Ve(Gn));
  }
  function mn(e, t) {
    ((e.finishedWork = null), (e.finishedLanes = 0));
    var r = e.timeoutHandle;
    if ((r !== -1 && ((e.timeoutHandle = -1), np(r)), be !== null))
      for (r = be.return; r !== null; ) {
        var l = r;
        switch ((hi(l), l.tag)) {
          case 1:
            ((l = l.type.childContextTypes), l != null && Mo());
            break;
          case 3:
            (Kn(), Ve(Et), Ve(st), Pi());
            break;
          case 5:
            xi(l);
            break;
          case 4:
            Kn();
            break;
          case 13:
            Ve(Ye);
            break;
          case 19:
            Ve(Ye);
            break;
          case 10:
            wi(l.type._context);
            break;
          case 22:
          case 23:
            lu();
        }
        r = r.return;
      }
    if (
      ((lt = e),
      (be = e = qr(e.current, null)),
      (ut = Nt = t),
      (tt = 0),
      ($l = null),
      (Zi = bo = hn = 0),
      (xt = Hl = null),
      cn !== null)
    ) {
      for (t = 0; t < cn.length; t++)
        if (((r = cn[t]), (l = r.interleaved), l !== null)) {
          r.interleaved = null;
          var a = l.next,
            u = r.pending;
          if (u !== null) {
            var h = u.next;
            ((u.next = a), (l.next = h));
          }
          r.pending = l;
        }
      cn = null;
    }
    return e;
  }
  function ff(e, t) {
    do {
      var r = be;
      try {
        if ((gi(), (Bo.current = Yo), Wo)) {
          for (var l = Ke.memoizedState; l !== null; ) {
            var a = l.queue;
            (a !== null && (a.pending = null), (l = l.next));
          }
          Wo = !1;
        }
        if (
          ((dn = 0),
          (nt = et = Ke = null),
          (zl = !1),
          (Fl = 0),
          (Gi.current = null),
          r === null || r.return === null)
        ) {
          ((tt = 1), ($l = t), (be = null));
          break;
        }
        e: {
          var u = e,
            h = r.return,
            g = r,
            E = t;
          if (
            ((t = ut),
            (g.flags |= 32768),
            E !== null && typeof E == "object" && typeof E.then == "function")
          ) {
            var O = E,
              A = g,
              H = A.tag;
            if ((A.mode & 1) === 0 && (H === 0 || H === 11 || H === 15)) {
              var U = A.alternate;
              U
                ? ((A.updateQueue = U.updateQueue),
                  (A.memoizedState = U.memoizedState),
                  (A.lanes = U.lanes))
                : ((A.updateQueue = null), (A.memoizedState = null));
            }
            var q = Fc(h);
            if (q !== null) {
              ((q.flags &= -257),
                Ic(q, h, g, u, t),
                q.mode & 1 && zc(u, O, t),
                (t = q),
                (E = O));
              var re = t.updateQueue;
              if (re === null) {
                var ne = new Set();
                (ne.add(E), (t.updateQueue = ne));
              } else re.add(E);
              break e;
            } else {
              if ((t & 1) === 0) {
                (zc(u, O, t), ou());
                break e;
              }
              E = Error(i(426));
            }
          } else if (Qe && g.mode & 1) {
            var qe = Fc(h);
            if (qe !== null) {
              ((qe.flags & 65536) === 0 && (qe.flags |= 256),
                Ic(qe, h, g, u, t),
                yi(Xn(E, g)));
              break e;
            }
          }
          ((u = E = Xn(E, g)),
            tt !== 4 && (tt = 2),
            Hl === null ? (Hl = [u]) : Hl.push(u),
            (u = h));
          do {
            switch (u.tag) {
              case 3:
                ((u.flags |= 65536), (t &= -t), (u.lanes |= t));
                var T = Dc(u, E, t);
                oc(u, T);
                break e;
              case 1:
                g = E;
                var x = u.type,
                  N = u.stateNode;
                if (
                  (u.flags & 128) === 0 &&
                  (typeof x.getDerivedStateFromError == "function" ||
                    (N !== null &&
                      typeof N.componentDidCatch == "function" &&
                      (Xr === null || !Xr.has(N))))
                ) {
                  ((u.flags |= 65536), (t &= -t), (u.lanes |= t));
                  var V = Oc(u, g, t);
                  oc(u, V);
                  break e;
                }
            }
            u = u.return;
          } while (u !== null);
        }
        pf(r);
      } catch (le) {
        ((t = le), be === r && r !== null && (be = r = r.return));
        continue;
      }
      break;
    } while (!0);
  }
  function df() {
    var e = qo.current;
    return ((qo.current = Yo), e === null ? Yo : e);
  }
  function ou() {
    ((tt === 0 || tt === 3 || tt === 2) && (tt = 4),
      lt === null ||
        ((hn & 268435455) === 0 && (bo & 268435455) === 0) ||
        Zr(lt, ut));
  }
  function oa(e, t) {
    var r = Oe;
    Oe |= 2;
    var l = df();
    (lt !== e || ut !== t) && ((Er = null), mn(e, t));
    do
      try {
        _p();
        break;
      } catch (a) {
        ff(e, a);
      }
    while (!0);
    if ((gi(), (Oe = r), (qo.current = l), be !== null)) throw Error(i(261));
    return ((lt = null), (ut = 0), tt);
  }
  function _p() {
    for (; be !== null; ) hf(be);
  }
  function Tp() {
    for (; be !== null && !at(); ) hf(be);
  }
  function hf(e) {
    var t = vf(e.alternate, e, Nt);
    ((e.memoizedProps = e.pendingProps),
      t === null ? pf(e) : (be = t),
      (Gi.current = null));
  }
  function pf(e) {
    var t = e;
    do {
      var r = t.alternate;
      if (((e = t.return), (t.flags & 32768) === 0)) {
        if (((r = Ep(r, t, Nt)), r !== null)) {
          be = r;
          return;
        }
      } else {
        if (((r = Rp(r, t)), r !== null)) {
          ((r.flags &= 32767), (be = r));
          return;
        }
        if (e !== null)
          ((e.flags |= 32768), (e.subtreeFlags = 0), (e.deletions = null));
        else {
          ((tt = 6), (be = null));
          return;
        }
      }
      if (((t = t.sibling), t !== null)) {
        be = t;
        return;
      }
      be = t = e;
    } while (t !== null);
    tt === 0 && (tt = 5);
  }
  function yn(e, t, r) {
    var l = Ae,
      a = $t.transition;
    try {
      (($t.transition = null), (Ae = 1), Mp(e, t, r, l));
    } finally {
      (($t.transition = a), (Ae = l));
    }
    return null;
  }
  function Mp(e, t, r, l) {
    do qn();
    while (Jr !== null);
    if ((Oe & 6) !== 0) throw Error(i(327));
    r = e.finishedWork;
    var a = e.finishedLanes;
    if (r === null) return null;
    if (((e.finishedWork = null), (e.finishedLanes = 0), r === e.current))
      throw Error(i(177));
    ((e.callbackNode = null), (e.callbackPriority = 0));
    var u = r.lanes | r.childLanes;
    if (
      (ch(e, u),
      e === lt && ((be = lt = null), (ut = 0)),
      ((r.subtreeFlags & 2064) === 0 && (r.flags & 2064) === 0) ||
        ta ||
        ((ta = !0),
        gf(yt, function () {
          return (qn(), null);
        })),
      (u = (r.flags & 15990) !== 0),
      (r.subtreeFlags & 15990) !== 0 || u)
    ) {
      ((u = $t.transition), ($t.transition = null));
      var h = Ae;
      Ae = 1;
      var g = Oe;
      ((Oe |= 4),
        (Gi.current = null),
        xp(e, r),
        nf(r, e),
        Gh(oi),
        (yo = !!li),
        (oi = li = null),
        (e.current = r),
        Cp(r),
        Ue(),
        (Oe = g),
        (Ae = h),
        ($t.transition = u));
    } else e.current = r;
    if (
      (ta && ((ta = !1), (Jr = e), (ra = a)),
      (u = e.pendingLanes),
      u === 0 && (Xr = null),
      Tn(r.stateNode),
      Ct(e, Ne()),
      t !== null)
    )
      for (l = e.onRecoverableError, r = 0; r < t.length; r++)
        ((a = t[r]), l(a.value, { componentStack: a.stack, digest: a.digest }));
    if (ea) throw ((ea = !1), (e = bi), (bi = null), e);
    return (
      (ra & 1) !== 0 && e.tag !== 0 && qn(),
      (u = e.pendingLanes),
      (u & 1) !== 0 ? (e === eu ? Bl++ : ((Bl = 0), (eu = e))) : (Bl = 0),
      Vr(),
      null
    );
  }
  function qn() {
    if (Jr !== null) {
      var e = ts(ra),
        t = $t.transition,
        r = Ae;
      try {
        if ((($t.transition = null), (Ae = 16 > e ? 16 : e), Jr === null))
          var l = !1;
        else {
          if (((e = Jr), (Jr = null), (ra = 0), (Oe & 6) !== 0))
            throw Error(i(331));
          var a = Oe;
          for (Oe |= 4, te = e.current; te !== null; ) {
            var u = te,
              h = u.child;
            if ((te.flags & 16) !== 0) {
              var g = u.deletions;
              if (g !== null) {
                for (var E = 0; E < g.length; E++) {
                  var O = g[E];
                  for (te = O; te !== null; ) {
                    var A = te;
                    switch (A.tag) {
                      case 0:
                      case 11:
                      case 15:
                        Al(8, A, u);
                    }
                    var H = A.child;
                    if (H !== null) ((H.return = A), (te = H));
                    else
                      for (; te !== null; ) {
                        A = te;
                        var U = A.sibling,
                          q = A.return;
                        if ((qc(A), A === O)) {
                          te = null;
                          break;
                        }
                        if (U !== null) {
                          ((U.return = q), (te = U));
                          break;
                        }
                        te = q;
                      }
                  }
                }
                var re = u.alternate;
                if (re !== null) {
                  var ne = re.child;
                  if (ne !== null) {
                    re.child = null;
                    do {
                      var qe = ne.sibling;
                      ((ne.sibling = null), (ne = qe));
                    } while (ne !== null);
                  }
                }
                te = u;
              }
            }
            if ((u.subtreeFlags & 2064) !== 0 && h !== null)
              ((h.return = u), (te = h));
            else
              e: for (; te !== null; ) {
                if (((u = te), (u.flags & 2048) !== 0))
                  switch (u.tag) {
                    case 0:
                    case 11:
                    case 15:
                      Al(9, u, u.return);
                  }
                var T = u.sibling;
                if (T !== null) {
                  ((T.return = u.return), (te = T));
                  break e;
                }
                te = u.return;
              }
          }
          var x = e.current;
          for (te = x; te !== null; ) {
            h = te;
            var N = h.child;
            if ((h.subtreeFlags & 2064) !== 0 && N !== null)
              ((N.return = h), (te = N));
            else
              e: for (h = x; te !== null; ) {
                if (((g = te), (g.flags & 2048) !== 0))
                  try {
                    switch (g.tag) {
                      case 0:
                      case 11:
                      case 15:
                        Zo(9, g);
                    }
                  } catch (le) {
                    Xe(g, g.return, le);
                  }
                if (g === h) {
                  te = null;
                  break e;
                }
                var V = g.sibling;
                if (V !== null) {
                  ((V.return = g.return), (te = V));
                  break e;
                }
                te = g.return;
              }
          }
          if (
            ((Oe = a),
            Vr(),
            vt && typeof vt.onPostCommitFiberRoot == "function")
          )
            try {
              vt.onPostCommitFiberRoot(Ft, e);
            } catch {}
          l = !0;
        }
        return l;
      } finally {
        ((Ae = r), ($t.transition = t));
      }
    }
    return !1;
  }
  function mf(e, t, r) {
    ((t = Xn(r, t)),
      (t = Dc(e, t, 1)),
      (e = Yr(e, t, 1)),
      (t = wt()),
      e !== null && (dl(e, 1, t), Ct(e, t)));
  }
  function Xe(e, t, r) {
    if (e.tag === 3) mf(e, e, r);
    else
      for (; t !== null; ) {
        if (t.tag === 3) {
          mf(t, e, r);
          break;
        } else if (t.tag === 1) {
          var l = t.stateNode;
          if (
            typeof t.type.getDerivedStateFromError == "function" ||
            (typeof l.componentDidCatch == "function" &&
              (Xr === null || !Xr.has(l)))
          ) {
            ((e = Xn(r, e)),
              (e = Oc(t, e, 1)),
              (t = Yr(t, e, 1)),
              (e = wt()),
              t !== null && (dl(t, 1, e), Ct(t, e)));
            break;
          }
        }
        t = t.return;
      }
  }
  function Np(e, t, r) {
    var l = e.pingCache;
    (l !== null && l.delete(t),
      (t = wt()),
      (e.pingedLanes |= e.suspendedLanes & r),
      lt === e &&
        (ut & r) === r &&
        (tt === 4 || (tt === 3 && (ut & 130023424) === ut && 500 > Ne() - qi)
          ? mn(e, 0)
          : (Zi |= r)),
      Ct(e, t));
  }
  function yf(e, t) {
    t === 0 &&
      ((e.mode & 1) === 0
        ? (t = 1)
        : ((t = hr), (hr <<= 1), (hr & 130023424) === 0 && (hr = 4194304)));
    var r = wt();
    ((e = gr(e, t)), e !== null && (dl(e, t, r), Ct(e, r)));
  }
  function Dp(e) {
    var t = e.memoizedState,
      r = 0;
    (t !== null && (r = t.retryLane), yf(e, r));
  }
  function Op(e, t) {
    var r = 0;
    switch (e.tag) {
      case 13:
        var l = e.stateNode,
          a = e.memoizedState;
        a !== null && (r = a.retryLane);
        break;
      case 19:
        l = e.stateNode;
        break;
      default:
        throw Error(i(314));
    }
    (l !== null && l.delete(t), yf(e, r));
  }
  var vf;
  vf = function (e, t, r) {
    if (e !== null)
      if (e.memoizedProps !== t.pendingProps || Et.current) kt = !0;
      else {
        if ((e.lanes & r) === 0 && (t.flags & 128) === 0)
          return ((kt = !1), Sp(e, t, r));
        kt = (e.flags & 131072) !== 0;
      }
    else ((kt = !1), Qe && (t.flags & 1048576) !== 0 && Js(t, zo, t.index));
    switch (((t.lanes = 0), t.tag)) {
      case 2:
        var l = t.type;
        (Jo(e, t), (e = t.pendingProps));
        var a = $n(t, st.current);
        (Yn(t, r), (a = Ti(null, t, l, e, a, r)));
        var u = Mi();
        return (
          (t.flags |= 1),
          typeof a == "object" &&
          a !== null &&
          typeof a.render == "function" &&
          a.$$typeof === void 0
            ? ((t.tag = 1),
              (t.memoizedState = null),
              (t.updateQueue = null),
              Rt(l) ? ((u = !0), No(t)) : (u = !1),
              (t.memoizedState =
                a.state !== null && a.state !== void 0 ? a.state : null),
              Ri(t),
              (a.updater = Ko),
              (t.stateNode = a),
              (a._reactInternals = t),
              Ii(t, l, e, r),
              (t = $i(null, t, l, !0, u, r)))
            : ((t.tag = 0), Qe && u && di(t), gt(null, t, a, r), (t = t.child)),
          t
        );
      case 16:
        l = t.elementType;
        e: {
          switch (
            (Jo(e, t),
            (e = t.pendingProps),
            (a = l._init),
            (l = a(l._payload)),
            (t.type = l),
            (a = t.tag = Fp(l)),
            (e = Jt(l, e)),
            a)
          ) {
            case 0:
              t = Ai(null, t, l, e, r);
              break e;
            case 1:
              t = Bc(null, t, l, e, r);
              break e;
            case 11:
              t = jc(null, t, l, e, r);
              break e;
            case 14:
              t = Uc(null, t, l, Jt(l.type, e), r);
              break e;
          }
          throw Error(i(306, l, ""));
        }
        return t;
      case 0:
        return (
          (l = t.type),
          (a = t.pendingProps),
          (a = t.elementType === l ? a : Jt(l, a)),
          Ai(e, t, l, a, r)
        );
      case 1:
        return (
          (l = t.type),
          (a = t.pendingProps),
          (a = t.elementType === l ? a : Jt(l, a)),
          Bc(e, t, l, a, r)
        );
      case 3:
        e: {
          if ((Wc(t), e === null)) throw Error(i(387));
          ((l = t.pendingProps),
            (u = t.memoizedState),
            (a = u.element),
            lc(e, t),
            $o(t, l, null, r));
          var h = t.memoizedState;
          if (((l = h.element), u.isDehydrated))
            if (
              ((u = {
                element: l,
                isDehydrated: !1,
                cache: h.cache,
                pendingSuspenseBoundaries: h.pendingSuspenseBoundaries,
                transitions: h.transitions,
              }),
              (t.updateQueue.baseState = u),
              (t.memoizedState = u),
              t.flags & 256)
            ) {
              ((a = Xn(Error(i(423)), t)), (t = Vc(e, t, l, r, a)));
              break e;
            } else if (l !== a) {
              ((a = Xn(Error(i(424)), t)), (t = Vc(e, t, l, r, a)));
              break e;
            } else
              for (
                Mt = Hr(t.stateNode.containerInfo.firstChild),
                  Tt = t,
                  Qe = !0,
                  Xt = null,
                  r = rc(t, null, l, r),
                  t.child = r;
                r;
              )
                ((r.flags = (r.flags & -3) | 4096), (r = r.sibling));
          else {
            if ((Wn(), l === a)) {
              t = Sr(e, t, r);
              break e;
            }
            gt(e, t, l, r);
          }
          t = t.child;
        }
        return t;
      case 5:
        return (
          ic(t),
          e === null && mi(t),
          (l = t.type),
          (a = t.pendingProps),
          (u = e !== null ? e.memoizedProps : null),
          (h = a.children),
          ai(l, a) ? (h = null) : u !== null && ai(l, u) && (t.flags |= 32),
          Hc(e, t),
          gt(e, t, h, r),
          t.child
        );
      case 6:
        return (e === null && mi(t), null);
      case 13:
        return Qc(e, t, r);
      case 4:
        return (
          ki(t, t.stateNode.containerInfo),
          (l = t.pendingProps),
          e === null ? (t.child = Vn(t, null, l, r)) : gt(e, t, l, r),
          t.child
        );
      case 11:
        return (
          (l = t.type),
          (a = t.pendingProps),
          (a = t.elementType === l ? a : Jt(l, a)),
          jc(e, t, l, a, r)
        );
      case 7:
        return (gt(e, t, t.pendingProps, r), t.child);
      case 8:
        return (gt(e, t, t.pendingProps.children, r), t.child);
      case 12:
        return (gt(e, t, t.pendingProps.children, r), t.child);
      case 10:
        e: {
          if (
            ((l = t.type._context),
            (a = t.pendingProps),
            (u = t.memoizedProps),
            (h = a.value),
            Be(jo, l._currentValue),
            (l._currentValue = h),
            u !== null)
          )
            if (Kt(u.value, h)) {
              if (u.children === a.children && !Et.current) {
                t = Sr(e, t, r);
                break e;
              }
            } else
              for (u = t.child, u !== null && (u.return = t); u !== null; ) {
                var g = u.dependencies;
                if (g !== null) {
                  h = u.child;
                  for (var E = g.firstContext; E !== null; ) {
                    if (E.context === l) {
                      if (u.tag === 1) {
                        ((E = wr(-1, r & -r)), (E.tag = 2));
                        var O = u.updateQueue;
                        if (O !== null) {
                          O = O.shared;
                          var A = O.pending;
                          (A === null
                            ? (E.next = E)
                            : ((E.next = A.next), (A.next = E)),
                            (O.pending = E));
                        }
                      }
                      ((u.lanes |= r),
                        (E = u.alternate),
                        E !== null && (E.lanes |= r),
                        Si(u.return, r, t),
                        (g.lanes |= r));
                      break;
                    }
                    E = E.next;
                  }
                } else if (u.tag === 10) h = u.type === t.type ? null : u.child;
                else if (u.tag === 18) {
                  if (((h = u.return), h === null)) throw Error(i(341));
                  ((h.lanes |= r),
                    (g = h.alternate),
                    g !== null && (g.lanes |= r),
                    Si(h, r, t),
                    (h = u.sibling));
                } else h = u.child;
                if (h !== null) h.return = u;
                else
                  for (h = u; h !== null; ) {
                    if (h === t) {
                      h = null;
                      break;
                    }
                    if (((u = h.sibling), u !== null)) {
                      ((u.return = h.return), (h = u));
                      break;
                    }
                    h = h.return;
                  }
                u = h;
              }
          (gt(e, t, a.children, r), (t = t.child));
        }
        return t;
      case 9:
        return (
          (a = t.type),
          (l = t.pendingProps.children),
          Yn(t, r),
          (a = Ut(a)),
          (l = l(a)),
          (t.flags |= 1),
          gt(e, t, l, r),
          t.child
        );
      case 14:
        return (
          (l = t.type),
          (a = Jt(l, t.pendingProps)),
          (a = Jt(l.type, a)),
          Uc(e, t, l, a, r)
        );
      case 15:
        return Ac(e, t, t.type, t.pendingProps, r);
      case 17:
        return (
          (l = t.type),
          (a = t.pendingProps),
          (a = t.elementType === l ? a : Jt(l, a)),
          Jo(e, t),
          (t.tag = 1),
          Rt(l) ? ((e = !0), No(t)) : (e = !1),
          Yn(t, r),
          Mc(t, l, a),
          Ii(t, l, a, r),
          $i(null, t, l, !0, e, r)
        );
      case 19:
        return Kc(e, t, r);
      case 22:
        return $c(e, t, r);
    }
    throw Error(i(156, t.tag));
  };
  function gf(e, t) {
    return He(e, t);
  }
  function zp(e, t, r, l) {
    ((this.tag = e),
      (this.key = r),
      (this.sibling =
        this.child =
        this.return =
        this.stateNode =
        this.type =
        this.elementType =
          null),
      (this.index = 0),
      (this.ref = null),
      (this.pendingProps = t),
      (this.dependencies =
        this.memoizedState =
        this.updateQueue =
        this.memoizedProps =
          null),
      (this.mode = l),
      (this.subtreeFlags = this.flags = 0),
      (this.deletions = null),
      (this.childLanes = this.lanes = 0),
      (this.alternate = null));
  }
  function Ht(e, t, r, l) {
    return new zp(e, t, r, l);
  }
  function au(e) {
    return ((e = e.prototype), !(!e || !e.isReactComponent));
  }
  function Fp(e) {
    if (typeof e == "function") return au(e) ? 1 : 0;
    if (e != null) {
      if (((e = e.$$typeof), e === we)) return 11;
      if (e === ye) return 14;
    }
    return 2;
  }
  function qr(e, t) {
    var r = e.alternate;
    return (
      r === null
        ? ((r = Ht(e.tag, t, e.key, e.mode)),
          (r.elementType = e.elementType),
          (r.type = e.type),
          (r.stateNode = e.stateNode),
          (r.alternate = e),
          (e.alternate = r))
        : ((r.pendingProps = t),
          (r.type = e.type),
          (r.flags = 0),
          (r.subtreeFlags = 0),
          (r.deletions = null)),
      (r.flags = e.flags & 14680064),
      (r.childLanes = e.childLanes),
      (r.lanes = e.lanes),
      (r.child = e.child),
      (r.memoizedProps = e.memoizedProps),
      (r.memoizedState = e.memoizedState),
      (r.updateQueue = e.updateQueue),
      (t = e.dependencies),
      (r.dependencies =
        t === null ? null : { lanes: t.lanes, firstContext: t.firstContext }),
      (r.sibling = e.sibling),
      (r.index = e.index),
      (r.ref = e.ref),
      r
    );
  }
  function aa(e, t, r, l, a, u) {
    var h = 2;
    if (((l = e), typeof e == "function")) au(e) && (h = 1);
    else if (typeof e == "string") h = 5;
    else
      e: switch (e) {
        case he:
          return vn(r.children, a, u, t);
        case L:
          ((h = 8), (a |= 8));
          break;
        case me:
          return (
            (e = Ht(12, r, t, a | 2)),
            (e.elementType = me),
            (e.lanes = u),
            e
          );
        case ze:
          return (
            (e = Ht(13, r, t, a)),
            (e.elementType = ze),
            (e.lanes = u),
            e
          );
        case xe:
          return (
            (e = Ht(19, r, t, a)),
            (e.elementType = xe),
            (e.lanes = u),
            e
          );
        case Pe:
          return ia(r, a, u, t);
        default:
          if (typeof e == "object" && e !== null)
            switch (e.$$typeof) {
              case ge:
                h = 10;
                break e;
              case De:
                h = 9;
                break e;
              case we:
                h = 11;
                break e;
              case ye:
                h = 14;
                break e;
              case Re:
                ((h = 16), (l = null));
                break e;
            }
          throw Error(i(130, e == null ? e : typeof e, ""));
      }
    return (
      (t = Ht(h, r, t, a)),
      (t.elementType = e),
      (t.type = l),
      (t.lanes = u),
      t
    );
  }
  function vn(e, t, r, l) {
    return ((e = Ht(7, e, l, t)), (e.lanes = r), e);
  }
  function ia(e, t, r, l) {
    return (
      (e = Ht(22, e, l, t)),
      (e.elementType = Pe),
      (e.lanes = r),
      (e.stateNode = { isHidden: !1 }),
      e
    );
  }
  function iu(e, t, r) {
    return ((e = Ht(6, e, null, t)), (e.lanes = r), e);
  }
  function uu(e, t, r) {
    return (
      (t = Ht(4, e.children !== null ? e.children : [], e.key, t)),
      (t.lanes = r),
      (t.stateNode = {
        containerInfo: e.containerInfo,
        pendingChildren: null,
        implementation: e.implementation,
      }),
      t
    );
  }
  function Ip(e, t, r, l, a) {
    ((this.tag = t),
      (this.containerInfo = e),
      (this.finishedWork =
        this.pingCache =
        this.current =
        this.pendingChildren =
          null),
      (this.timeoutHandle = -1),
      (this.callbackNode = this.pendingContext = this.context = null),
      (this.callbackPriority = 0),
      (this.eventTimes = Fa(0)),
      (this.expirationTimes = Fa(-1)),
      (this.entangledLanes =
        this.finishedLanes =
        this.mutableReadLanes =
        this.expiredLanes =
        this.pingedLanes =
        this.suspendedLanes =
        this.pendingLanes =
          0),
      (this.entanglements = Fa(0)),
      (this.identifierPrefix = l),
      (this.onRecoverableError = a),
      (this.mutableSourceEagerHydrationData = null));
  }
  function su(e, t, r, l, a, u, h, g, E) {
    return (
      (e = new Ip(e, t, r, g, E)),
      t === 1 ? ((t = 1), u === !0 && (t |= 8)) : (t = 0),
      (u = Ht(3, null, null, t)),
      (e.current = u),
      (u.stateNode = e),
      (u.memoizedState = {
        element: l,
        isDehydrated: r,
        cache: null,
        transitions: null,
        pendingSuspenseBoundaries: null,
      }),
      Ri(u),
      e
    );
  }
  function jp(e, t, r) {
    var l =
      3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
    return {
      $$typeof: Z,
      key: l == null ? null : "" + l,
      children: e,
      containerInfo: t,
      implementation: r,
    };
  }
  function wf(e) {
    if (!e) return Wr;
    e = e._reactInternals;
    e: {
      if (b(e) !== e || e.tag !== 1) throw Error(i(170));
      var t = e;
      do {
        switch (t.tag) {
          case 3:
            t = t.stateNode.context;
            break e;
          case 1:
            if (Rt(t.type)) {
              t = t.stateNode.__reactInternalMemoizedMergedChildContext;
              break e;
            }
        }
        t = t.return;
      } while (t !== null);
      throw Error(i(171));
    }
    if (e.tag === 1) {
      var r = e.type;
      if (Rt(r)) return Ys(e, r, t);
    }
    return t;
  }
  function Sf(e, t, r, l, a, u, h, g, E) {
    return (
      (e = su(r, l, !0, e, a, u, h, g, E)),
      (e.context = wf(null)),
      (r = e.current),
      (l = wt()),
      (a = Gr(r)),
      (u = wr(l, a)),
      (u.callback = t ?? null),
      Yr(r, u, a),
      (e.current.lanes = a),
      dl(e, a, l),
      Ct(e, l),
      e
    );
  }
  function ua(e, t, r, l) {
    var a = t.current,
      u = wt(),
      h = Gr(a);
    return (
      (r = wf(r)),
      t.context === null ? (t.context = r) : (t.pendingContext = r),
      (t = wr(u, h)),
      (t.payload = { element: e }),
      (l = l === void 0 ? null : l),
      l !== null && (t.callback = l),
      (e = Yr(a, t, h)),
      e !== null && (qt(e, a, h, u), Ao(e, a, h)),
      h
    );
  }
  function sa(e) {
    return (
      (e = e.current),
      e.child ? (e.child.tag === 5, e.child.stateNode) : null
    );
  }
  function Ef(e, t) {
    if (((e = e.memoizedState), e !== null && e.dehydrated !== null)) {
      var r = e.retryLane;
      e.retryLane = r !== 0 && r < t ? r : t;
    }
  }
  function cu(e, t) {
    (Ef(e, t), (e = e.alternate) && Ef(e, t));
  }
  function Up() {
    return null;
  }
  var Rf =
    typeof reportError == "function"
      ? reportError
      : function (e) {
          console.error(e);
        };
  function fu(e) {
    this._internalRoot = e;
  }
  ((ca.prototype.render = fu.prototype.render =
    function (e) {
      var t = this._internalRoot;
      if (t === null) throw Error(i(409));
      ua(e, t, null, null);
    }),
    (ca.prototype.unmount = fu.prototype.unmount =
      function () {
        var e = this._internalRoot;
        if (e !== null) {
          this._internalRoot = null;
          var t = e.containerInfo;
          (pn(function () {
            ua(null, e, null, null);
          }),
            (t[pr] = null));
        }
      }));
  function ca(e) {
    this._internalRoot = e;
  }
  ca.prototype.unstable_scheduleHydration = function (e) {
    if (e) {
      var t = ls();
      e = { blockedOn: null, target: e, priority: t };
      for (var r = 0; r < Ur.length && t !== 0 && t < Ur[r].priority; r++);
      (Ur.splice(r, 0, e), r === 0 && is(e));
    }
  };
  function du(e) {
    return !(!e || (e.nodeType !== 1 && e.nodeType !== 9 && e.nodeType !== 11));
  }
  function fa(e) {
    return !(
      !e ||
      (e.nodeType !== 1 &&
        e.nodeType !== 9 &&
        e.nodeType !== 11 &&
        (e.nodeType !== 8 || e.nodeValue !== " react-mount-point-unstable "))
    );
  }
  function kf() {}
  function Ap(e, t, r, l, a) {
    if (a) {
      if (typeof l == "function") {
        var u = l;
        l = function () {
          var O = sa(h);
          u.call(O);
        };
      }
      var h = Sf(t, l, e, 0, null, !1, !1, "", kf);
      return (
        (e._reactRootContainer = h),
        (e[pr] = h.current),
        Pl(e.nodeType === 8 ? e.parentNode : e),
        pn(),
        h
      );
    }
    for (; (a = e.lastChild); ) e.removeChild(a);
    if (typeof l == "function") {
      var g = l;
      l = function () {
        var O = sa(E);
        g.call(O);
      };
    }
    var E = su(e, 0, !1, null, null, !1, !1, "", kf);
    return (
      (e._reactRootContainer = E),
      (e[pr] = E.current),
      Pl(e.nodeType === 8 ? e.parentNode : e),
      pn(function () {
        ua(t, E, r, l);
      }),
      E
    );
  }
  function da(e, t, r, l, a) {
    var u = r._reactRootContainer;
    if (u) {
      var h = u;
      if (typeof a == "function") {
        var g = a;
        a = function () {
          var E = sa(h);
          g.call(E);
        };
      }
      ua(t, h, e, a);
    } else h = Ap(r, t, e, a, l);
    return sa(h);
  }
  ((rs = function (e) {
    switch (e.tag) {
      case 3:
        var t = e.stateNode;
        if (t.current.memoizedState.isDehydrated) {
          var r = zr(t.pendingLanes);
          r !== 0 &&
            (Ia(t, r | 1),
            Ct(t, Ne()),
            (Oe & 6) === 0 && ((Zn = Ne() + 500), Vr()));
        }
        break;
      case 13:
        (pn(function () {
          var l = gr(e, 1);
          if (l !== null) {
            var a = wt();
            qt(l, e, 1, a);
          }
        }),
          cu(e, 1));
    }
  }),
    (ja = function (e) {
      if (e.tag === 13) {
        var t = gr(e, 134217728);
        if (t !== null) {
          var r = wt();
          qt(t, e, 134217728, r);
        }
        cu(e, 134217728);
      }
    }),
    (ns = function (e) {
      if (e.tag === 13) {
        var t = Gr(e),
          r = gr(e, t);
        if (r !== null) {
          var l = wt();
          qt(r, e, t, l);
        }
        cu(e, t);
      }
    }),
    (ls = function () {
      return Ae;
    }),
    (os = function (e, t) {
      var r = Ae;
      try {
        return ((Ae = e), t());
      } finally {
        Ae = r;
      }
    }),
    (Ln = function (e, t, r) {
      switch (t) {
        case "input":
          if ((Wt(e, r), (t = r.name), r.type === "radio" && t != null)) {
            for (r = e; r.parentNode; ) r = r.parentNode;
            for (
              r = r.querySelectorAll(
                "input[name=" + JSON.stringify("" + t) + '][type="radio"]',
              ),
                t = 0;
              t < r.length;
              t++
            ) {
              var l = r[t];
              if (l !== e && l.form === e.form) {
                var a = To(l);
                if (!a) throw Error(i(90));
                (oo(l), Wt(l, a));
              }
            }
          }
          break;
        case "textarea":
          so(e, r);
          break;
        case "select":
          ((t = r.value), t != null && Pr(e, !!r.multiple, t, !1));
      }
    }),
    (ho = nu),
    (sl = pn));
  var $p = { usingClientEntryPoint: !1, Events: [Tl, Un, To, fo, ul, nu] },
    Wl = {
      findFiberByHostInstance: on,
      bundleType: 0,
      version: "18.3.1",
      rendererPackageName: "react-dom",
    },
    Hp = {
      bundleType: Wl.bundleType,
      version: Wl.version,
      rendererPackageName: Wl.rendererPackageName,
      rendererConfig: Wl.rendererConfig,
      overrideHookState: null,
      overrideHookStateDeletePath: null,
      overrideHookStateRenamePath: null,
      overrideProps: null,
      overridePropsDeletePath: null,
      overridePropsRenamePath: null,
      setErrorHandler: null,
      setSuspenseHandler: null,
      scheduleUpdate: null,
      currentDispatcherRef: Y.ReactCurrentDispatcher,
      findHostInstanceByFiber: function (e) {
        return ((e = Fe(e)), e === null ? null : e.stateNode);
      },
      findFiberByHostInstance: Wl.findFiberByHostInstance || Up,
      findHostInstancesForRefresh: null,
      scheduleRefresh: null,
      scheduleRoot: null,
      setRefreshHandler: null,
      getCurrentFiber: null,
      reconcilerVersion: "18.3.1-next-f1338f8080-20240426",
    };
  if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u") {
    var ha = __REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!ha.isDisabled && ha.supportsFiber)
      try {
        ((Ft = ha.inject(Hp)), (vt = ha));
      } catch {}
  }
  return (
    (Pt.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = $p),
    (Pt.createPortal = function (e, t) {
      var r =
        2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
      if (!du(t)) throw Error(i(200));
      return jp(e, t, null, r);
    }),
    (Pt.createRoot = function (e, t) {
      if (!du(e)) throw Error(i(299));
      var r = !1,
        l = "",
        a = Rf;
      return (
        t != null &&
          (t.unstable_strictMode === !0 && (r = !0),
          t.identifierPrefix !== void 0 && (l = t.identifierPrefix),
          t.onRecoverableError !== void 0 && (a = t.onRecoverableError)),
        (t = su(e, 1, !1, null, null, r, !1, l, a)),
        (e[pr] = t.current),
        Pl(e.nodeType === 8 ? e.parentNode : e),
        new fu(t)
      );
    }),
    (Pt.findDOMNode = function (e) {
      if (e == null) return null;
      if (e.nodeType === 1) return e;
      var t = e._reactInternals;
      if (t === void 0)
        throw typeof e.render == "function"
          ? Error(i(188))
          : ((e = Object.keys(e).join(",")), Error(i(268, e)));
      return ((e = Fe(t)), (e = e === null ? null : e.stateNode), e);
    }),
    (Pt.flushSync = function (e) {
      return pn(e);
    }),
    (Pt.hydrate = function (e, t, r) {
      if (!fa(t)) throw Error(i(200));
      return da(null, e, t, !0, r);
    }),
    (Pt.hydrateRoot = function (e, t, r) {
      if (!du(e)) throw Error(i(405));
      var l = (r != null && r.hydratedSources) || null,
        a = !1,
        u = "",
        h = Rf;
      if (
        (r != null &&
          (r.unstable_strictMode === !0 && (a = !0),
          r.identifierPrefix !== void 0 && (u = r.identifierPrefix),
          r.onRecoverableError !== void 0 && (h = r.onRecoverableError)),
        (t = Sf(t, null, e, 1, r ?? null, a, !1, u, h)),
        (e[pr] = t.current),
        Pl(e),
        l)
      )
        for (e = 0; e < l.length; e++)
          ((r = l[e]),
            (a = r._getVersion),
            (a = a(r._source)),
            t.mutableSourceEagerHydrationData == null
              ? (t.mutableSourceEagerHydrationData = [r, a])
              : t.mutableSourceEagerHydrationData.push(r, a));
      return new ca(t);
    }),
    (Pt.render = function (e, t, r) {
      if (!fa(t)) throw Error(i(200));
      return da(null, e, t, !1, r);
    }),
    (Pt.unmountComponentAtNode = function (e) {
      if (!fa(e)) throw Error(i(40));
      return e._reactRootContainer
        ? (pn(function () {
            da(null, null, e, !1, function () {
              ((e._reactRootContainer = null), (e[pr] = null));
            });
          }),
          !0)
        : !1;
    }),
    (Pt.unstable_batchedUpdates = nu),
    (Pt.unstable_renderSubtreeIntoContainer = function (e, t, r, l) {
      if (!fa(r)) throw Error(i(200));
      if (e == null || e._reactInternals === void 0) throw Error(i(38));
      return da(e, t, r, !1, l);
    }),
    (Pt.version = "18.3.1-next-f1338f8080-20240426"),
    Pt
  );
}
var Nf;
function Gp() {
  if (Nf) return mu.exports;
  Nf = 1;
  function n() {
    if (
      !(
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" ||
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"
      )
    )
      try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n);
      } catch (o) {
        console.error(o);
      }
  }
  return (n(), (mu.exports = Jp()), mu.exports);
}
var R = Uu();
const Zp = sd(R),
  qp = Wp({ __proto__: null, default: Zp }, [R]);
var cd = (n) => {
    throw TypeError(n);
  },
  bp = (n, o, i) => o.has(n) || cd("Cannot " + i),
  gu = (n, o, i) => (
    bp(n, o, "read from private field"),
    i ? i.call(n) : o.get(n)
  ),
  em = (n, o, i) =>
    o.has(n)
      ? cd("Cannot add the same private member more than once")
      : o instanceof WeakSet
        ? o.add(n)
        : o.set(n, i),
  Df = "popstate";
function Of(n) {
  return (
    typeof n == "object" &&
    n != null &&
    "pathname" in n &&
    "search" in n &&
    "hash" in n &&
    "state" in n &&
    "key" in n
  );
}
function pg(n = {}) {
  function o(s, c) {
    let f = c.state?.masked,
      { pathname: d, search: m, hash: p } = f || s.location;
    return Zl(
      "",
      { pathname: d, search: m, hash: p },
      (c.state && c.state.usr) || null,
      (c.state && c.state.key) || "default",
      f
        ? {
            pathname: s.location.pathname,
            search: s.location.search,
            hash: s.location.hash,
          }
        : void 0,
    );
  }
  function i(s, c) {
    return typeof c == "string" ? c : er(c);
  }
  return rm(o, i, null, n);
}
function Ce(n, o) {
  if (n === !1 || n === null || typeof n > "u") throw new Error(o);
}
function Je(n, o) {
  if (!n) {
    typeof console < "u" && console.warn(o);
    try {
      throw new Error(o);
    } catch {}
  }
}
function tm() {
  return Math.random().toString(36).substring(2, 10);
}
function zf(n, o) {
  return {
    usr: n.state,
    key: n.key,
    idx: o,
    masked: n.unstable_mask
      ? { pathname: n.pathname, search: n.search, hash: n.hash }
      : void 0,
  };
}
function Zl(n, o, i = null, s, c) {
  return {
    pathname: typeof n == "string" ? n : n.pathname,
    search: "",
    hash: "",
    ...(typeof o == "string" ? xr(o) : o),
    state: i,
    key: (o && o.key) || s || tm(),
    unstable_mask: c,
  };
}
function er({ pathname: n = "/", search: o = "", hash: i = "" }) {
  return (
    o && o !== "?" && (n += o.charAt(0) === "?" ? o : "?" + o),
    i && i !== "#" && (n += i.charAt(0) === "#" ? i : "#" + i),
    n
  );
}
function xr(n) {
  let o = {};
  if (n) {
    let i = n.indexOf("#");
    i >= 0 && ((o.hash = n.substring(i)), (n = n.substring(0, i)));
    let s = n.indexOf("?");
    (s >= 0 && ((o.search = n.substring(s)), (n = n.substring(0, s))),
      n && (o.pathname = n));
  }
  return o;
}
function rm(n, o, i, s = {}) {
  let { window: c = document.defaultView, v5Compat: f = !1 } = s,
    d = c.history,
    m = "POP",
    p = null,
    y = S();
  y == null && ((y = 0), d.replaceState({ ...d.state, idx: y }, ""));
  function S() {
    return (d.state || { idx: null }).idx;
  }
  function v() {
    m = "POP";
    let _ = S(),
      B = _ == null ? null : _ - y;
    ((y = _), p && p({ action: m, location: z.location, delta: B }));
  }
  function k(_, B) {
    m = "PUSH";
    let j = Of(_) ? _ : Zl(z.location, _, B);
    y = S() + 1;
    let K = zf(j, y),
      Y = z.createHref(j.unstable_mask || j);
    try {
      d.pushState(K, "", Y);
    } catch (J) {
      if (J instanceof DOMException && J.name === "DataCloneError") throw J;
      c.location.assign(Y);
    }
    f && p && p({ action: m, location: z.location, delta: 1 });
  }
  function M(_, B) {
    m = "REPLACE";
    let j = Of(_) ? _ : Zl(z.location, _, B);
    y = S();
    let K = zf(j, y),
      Y = z.createHref(j.unstable_mask || j);
    (d.replaceState(K, "", Y),
      f && p && p({ action: m, location: z.location, delta: 0 }));
  }
  function F(_) {
    return fd(_);
  }
  let z = {
    get action() {
      return m;
    },
    get location() {
      return n(c, d);
    },
    listen(_) {
      if (p) throw new Error("A history only accepts one active listener");
      return (
        c.addEventListener(Df, v),
        (p = _),
        () => {
          (c.removeEventListener(Df, v), (p = null));
        }
      );
    },
    createHref(_) {
      return o(c, _);
    },
    createURL: F,
    encodeLocation(_) {
      let B = F(_);
      return { pathname: B.pathname, search: B.search, hash: B.hash };
    },
    push: k,
    replace: M,
    go(_) {
      return d.go(_);
    },
  };
  return z;
}
function fd(n, o = !1) {
  let i = "http://localhost";
  (typeof window < "u" &&
    (i =
      window.location.origin !== "null"
        ? window.location.origin
        : window.location.href),
    Ce(i, "No window.location.(origin|href) available to create URL"));
  let s = typeof n == "string" ? n : er(n);
  return (
    (s = s.replace(/ $/, "%20")),
    !o && s.startsWith("//") && (s = i + s),
    new URL(s, i)
  );
}
var Xl,
  Ff = class {
    constructor(n) {
      if ((em(this, Xl, new Map()), n)) for (let [o, i] of n) this.set(o, i);
    }
    get(n) {
      if (gu(this, Xl).has(n)) return gu(this, Xl).get(n);
      if (n.defaultValue !== void 0) return n.defaultValue;
      throw new Error("No value found for context");
    }
    set(n, o) {
      gu(this, Xl).set(n, o);
    }
  };
Xl = new WeakMap();
var nm = new Set(["lazy", "caseSensitive", "path", "id", "index", "children"]);
function lm(n) {
  return nm.has(n);
}
var om = new Set([
  "lazy",
  "caseSensitive",
  "path",
  "id",
  "index",
  "middleware",
  "children",
]);
function am(n) {
  return om.has(n);
}
function im(n) {
  return n.index === !0;
}
function ql(n, o, i = [], s = {}, c = !1) {
  return n.map((f, d) => {
    let m = [...i, String(d)],
      p = typeof f.id == "string" ? f.id : m.join("-");
    if (
      (Ce(
        f.index !== !0 || !f.children,
        "Cannot specify children on an index route",
      ),
      Ce(
        c || !s[p],
        `Found a route id collision on id "${p}".  Route id's must be globally unique within Data Router usages`,
      ),
      im(f))
    ) {
      let y = { ...f, id: p };
      return ((s[p] = If(y, o(y))), y);
    } else {
      let y = { ...f, id: p, children: void 0 };
      return (
        (s[p] = If(y, o(y))),
        f.children && (y.children = ql(f.children, o, m, s, c)),
        y
      );
    }
  });
}
function If(n, o) {
  return Object.assign(n, {
    ...o,
    ...(typeof o.lazy == "object" && o.lazy != null
      ? { lazy: { ...n.lazy, ...o.lazy } }
      : {}),
  });
}
function kr(n, o, i = "/") {
  return Jl(n, o, i, !1);
}
function Jl(n, o, i, s) {
  let c = typeof o == "string" ? xr(o) : o,
    f = Ot(c.pathname || "/", i);
  if (f == null) return null;
  let d = hd(n);
  um(d);
  let m = null;
  for (let p = 0; m == null && p < d.length; ++p) {
    let y = gm(f);
    m = vm(d[p], y, s);
  }
  return m;
}
function dd(n, o) {
  let { route: i, pathname: s, params: c } = n;
  return {
    id: i.id,
    pathname: s,
    params: c,
    data: o[i.id],
    loaderData: o[i.id],
    handle: i.handle,
  };
}
function hd(n, o = [], i = [], s = "", c = !1) {
  let f = (d, m, p = c, y) => {
    let S = {
      relativePath: y === void 0 ? d.path || "" : y,
      caseSensitive: d.caseSensitive === !0,
      childrenIndex: m,
      route: d,
    };
    if (S.relativePath.startsWith("/")) {
      if (!S.relativePath.startsWith(s) && p) return;
      (Ce(
        S.relativePath.startsWith(s),
        `Absolute route path "${S.relativePath}" nested under path "${s}" is not valid. An absolute child route path must start with the combined path of all its parent routes.`,
      ),
        (S.relativePath = S.relativePath.slice(s.length)));
    }
    let v = bt([s, S.relativePath]),
      k = i.concat(S);
    (d.children &&
      d.children.length > 0 &&
      (Ce(
        d.index !== !0,
        `Index routes must not have child routes. Please remove all child routes from route path "${v}".`,
      ),
      hd(d.children, o, k, v, p)),
      !(d.path == null && !d.index) &&
        o.push({ path: v, score: mm(v, d.index), routesMeta: k }));
  };
  return (
    n.forEach((d, m) => {
      if (d.path === "" || !d.path?.includes("?")) f(d, m);
      else for (let p of pd(d.path)) f(d, m, !0, p);
    }),
    o
  );
}
function pd(n) {
  let o = n.split("/");
  if (o.length === 0) return [];
  let [i, ...s] = o,
    c = i.endsWith("?"),
    f = i.replace(/\?$/, "");
  if (s.length === 0) return c ? [f, ""] : [f];
  let d = pd(s.join("/")),
    m = [];
  return (
    m.push(...d.map((p) => (p === "" ? f : [f, p].join("/")))),
    c && m.push(...d),
    m.map((p) => (n.startsWith("/") && p === "" ? "/" : p))
  );
}
function um(n) {
  n.sort((o, i) =>
    o.score !== i.score
      ? i.score - o.score
      : ym(
          o.routesMeta.map((s) => s.childrenIndex),
          i.routesMeta.map((s) => s.childrenIndex),
        ),
  );
}
var sm = /^:[\w-]+$/,
  cm = 3,
  fm = 2,
  dm = 1,
  hm = 10,
  pm = -2,
  jf = (n) => n === "*";
function mm(n, o) {
  let i = n.split("/"),
    s = i.length;
  return (
    i.some(jf) && (s += pm),
    o && (s += fm),
    i
      .filter((c) => !jf(c))
      .reduce((c, f) => c + (sm.test(f) ? cm : f === "" ? dm : hm), s)
  );
}
function ym(n, o) {
  return n.length === o.length && n.slice(0, -1).every((s, c) => s === o[c])
    ? n[n.length - 1] - o[o.length - 1]
    : 0;
}
function vm(n, o, i = !1) {
  let { routesMeta: s } = n,
    c = {},
    f = "/",
    d = [];
  for (let m = 0; m < s.length; ++m) {
    let p = s[m],
      y = m === s.length - 1,
      S = f === "/" ? o : o.slice(f.length) || "/",
      v = xa(
        { path: p.relativePath, caseSensitive: p.caseSensitive, end: y },
        S,
      ),
      k = p.route;
    if (
      (!v &&
        y &&
        i &&
        !s[s.length - 1].route.index &&
        (v = xa(
          { path: p.relativePath, caseSensitive: p.caseSensitive, end: !1 },
          S,
        )),
      !v)
    )
      return null;
    (Object.assign(c, v.params),
      d.push({
        params: c,
        pathname: bt([f, v.pathname]),
        pathnameBase: Em(bt([f, v.pathnameBase])),
        route: k,
      }),
      v.pathnameBase !== "/" && (f = bt([f, v.pathnameBase])));
  }
  return d;
}
function xa(n, o) {
  typeof n == "string" && (n = { path: n, caseSensitive: !1, end: !0 });
  let [i, s] = md(n.path, n.caseSensitive, n.end),
    c = o.match(i);
  if (!c) return null;
  let f = c[0],
    d = f.replace(/(.)\/+$/, "$1"),
    m = c.slice(1);
  return {
    params: s.reduce((y, { paramName: S, isOptional: v }, k) => {
      if (S === "*") {
        let F = m[k] || "";
        d = f.slice(0, f.length - F.length).replace(/(.)\/+$/, "$1");
      }
      const M = m[k];
      return (
        v && !M ? (y[S] = void 0) : (y[S] = (M || "").replace(/%2F/g, "/")),
        y
      );
    }, {}),
    pathname: f,
    pathnameBase: d,
    pattern: n,
  };
}
function md(n, o = !1, i = !0) {
  Je(
    n === "*" || !n.endsWith("*") || n.endsWith("/*"),
    `Route path "${n}" will be treated as if it were "${n.replace(/\*$/, "/*")}" because the \`*\` character must always follow a \`/\` in the pattern. To get rid of this warning, please change the route path to "${n.replace(/\*$/, "/*")}".`,
  );
  let s = [],
    c =
      "^" +
      n
        .replace(/\/*\*?$/, "")
        .replace(/^\/*/, "/")
        .replace(/[\\.*+^${}|()[\]]/g, "\\$&")
        .replace(/\/:([\w-]+)(\?)?/g, (d, m, p, y, S) => {
          if ((s.push({ paramName: m, isOptional: p != null }), p)) {
            let v = S.charAt(y + d.length);
            return v && v !== "/" ? "/([^\\/]*)" : "(?:/([^\\/]*))?";
          }
          return "/([^\\/]+)";
        })
        .replace(/\/([\w-]+)\?(\/|$)/g, "(/$1)?$2");
  return (
    n.endsWith("*")
      ? (s.push({ paramName: "*" }),
        (c += n === "*" || n === "/*" ? "(.*)$" : "(?:\\/(.+)|\\/*)$"))
      : i
        ? (c += "\\/*$")
        : n !== "" && n !== "/" && (c += "(?:(?=\\/|$))"),
    [new RegExp(c, o ? void 0 : "i"), s]
  );
}
function gm(n) {
  try {
    return n
      .split("/")
      .map((o) => decodeURIComponent(o).replace(/\//g, "%2F"))
      .join("/");
  } catch (o) {
    return (
      Je(
        !1,
        `The URL path "${n}" could not be decoded because it is a malformed URL segment. This is probably due to a bad percent encoding (${o}).`,
      ),
      n
    );
  }
}
function Ot(n, o) {
  if (o === "/") return n;
  if (!n.toLowerCase().startsWith(o.toLowerCase())) return null;
  let i = o.endsWith("/") ? o.length - 1 : o.length,
    s = n.charAt(i);
  return s && s !== "/" ? null : n.slice(i) || "/";
}
function wm({ basename: n, pathname: o }) {
  return o === "/" ? n : bt([n, o]);
}
var yd = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i,
  Au = (n) => yd.test(n);
function Sm(n, o = "/") {
  let {
      pathname: i,
      search: s = "",
      hash: c = "",
    } = typeof n == "string" ? xr(n) : n,
    f;
  return (
    i
      ? ((i = i.replace(/\/\/+/g, "/")),
        i.startsWith("/") ? (f = Uf(i.substring(1), "/")) : (f = Uf(i, o)))
      : (f = o),
    { pathname: f, search: Rm(s), hash: km(c) }
  );
}
function Uf(n, o) {
  let i = o.replace(/\/+$/, "").split("/");
  return (
    n.split("/").forEach((c) => {
      c === ".." ? i.length > 1 && i.pop() : c !== "." && i.push(c);
    }),
    i.length > 1 ? i.join("/") : "/"
  );
}
function wu(n, o, i, s) {
  return `Cannot include a '${n}' character in a manually specified \`to.${o}\` field [${JSON.stringify(s)}].  Please separate it out to the \`to.${i}\` field. Alternatively you may provide the full path as a string in <Link to="..."> and the router will parse it for you.`;
}
function vd(n) {
  return n.filter(
    (o, i) => i === 0 || (o.route.path && o.route.path.length > 0),
  );
}
function $u(n) {
  let o = vd(n);
  return o.map((i, s) => (s === o.length - 1 ? i.pathname : i.pathnameBase));
}
function La(n, o, i, s = !1) {
  let c;
  typeof n == "string"
    ? (c = xr(n))
    : ((c = { ...n }),
      Ce(
        !c.pathname || !c.pathname.includes("?"),
        wu("?", "pathname", "search", c),
      ),
      Ce(
        !c.pathname || !c.pathname.includes("#"),
        wu("#", "pathname", "hash", c),
      ),
      Ce(!c.search || !c.search.includes("#"), wu("#", "search", "hash", c)));
  let f = n === "" || c.pathname === "",
    d = f ? "/" : c.pathname,
    m;
  if (d == null) m = i;
  else {
    let v = o.length - 1;
    if (!s && d.startsWith("..")) {
      let k = d.split("/");
      for (; k[0] === ".."; ) (k.shift(), (v -= 1));
      c.pathname = k.join("/");
    }
    m = v >= 0 ? o[v] : "/";
  }
  let p = Sm(c, m),
    y = d && d !== "/" && d.endsWith("/"),
    S = (f || d === ".") && i.endsWith("/");
  return (!p.pathname.endsWith("/") && (y || S) && (p.pathname += "/"), p);
}
var bt = (n) => n.join("/").replace(/\/\/+/g, "/"),
  Em = (n) => n.replace(/\/+$/, "").replace(/^\/*/, "/"),
  Rm = (n) => (!n || n === "?" ? "" : n.startsWith("?") ? n : "?" + n),
  km = (n) => (!n || n === "#" ? "" : n.startsWith("#") ? n : "#" + n),
  xm = class {
    constructor(n, o) {
      ((this.type = "DataWithResponseInit"),
        (this.data = n),
        (this.init = o || null));
    }
  };
function Cm(n, o) {
  return new xm(n, typeof o == "number" ? { status: o } : o);
}
var Pm = (n, o = 302) => {
    let i = o;
    typeof i == "number"
      ? (i = { status: i })
      : typeof i.status > "u" && (i.status = 302);
    let s = new Headers(i.headers);
    return (s.set("Location", n), new Response(null, { ...i, headers: s }));
  },
  rn = class {
    constructor(n, o, i, s = !1) {
      ((this.status = n),
        (this.statusText = o || ""),
        (this.internal = s),
        i instanceof Error
          ? ((this.data = i.toString()), (this.error = i))
          : (this.data = i));
    }
  };
function wn(n) {
  return (
    n != null &&
    typeof n.status == "number" &&
    typeof n.statusText == "string" &&
    typeof n.internal == "boolean" &&
    "data" in n
  );
}
function eo(n) {
  return (
    n
      .map((o) => o.route.path)
      .filter(Boolean)
      .join("/")
      .replace(/\/\/*/g, "/") || "/"
  );
}
var gd =
  typeof window < "u" &&
  typeof window.document < "u" &&
  typeof window.document.createElement < "u";
function wd(n, o) {
  let i = n;
  if (typeof i != "string" || !yd.test(i))
    return { absoluteURL: void 0, isExternal: !1, to: i };
  let s = i,
    c = !1;
  if (gd)
    try {
      let f = new URL(window.location.href),
        d = i.startsWith("//") ? new URL(f.protocol + i) : new URL(i),
        m = Ot(d.pathname, o);
      d.origin === f.origin && m != null
        ? (i = m + d.search + d.hash)
        : (c = !0);
    } catch {
      Je(
        !1,
        `<Link to="${i}"> contains an invalid URL which will probably break when clicked - please update to a valid URL path.`,
      );
    }
  return { absoluteURL: s, isExternal: c, to: i };
}
var tn = Symbol("Uninstrumented");
function Lm(n, o) {
  let i = {
    lazy: [],
    "lazy.loader": [],
    "lazy.action": [],
    "lazy.middleware": [],
    middleware: [],
    loader: [],
    action: [],
  };
  n.forEach((c) =>
    c({
      id: o.id,
      index: o.index,
      path: o.path,
      instrument(f) {
        let d = Object.keys(i);
        for (let m of d) f[m] && i[m].push(f[m]);
      },
    }),
  );
  let s = {};
  if (typeof o.lazy == "function" && i.lazy.length > 0) {
    let c = el(i.lazy, o.lazy, () => {});
    c && (s.lazy = c);
  }
  if (typeof o.lazy == "object") {
    let c = o.lazy;
    ["middleware", "loader", "action"].forEach((f) => {
      let d = c[f],
        m = i[`lazy.${f}`];
      if (typeof d == "function" && m.length > 0) {
        let p = el(m, d, () => {});
        p && (s.lazy = Object.assign(s.lazy || {}, { [f]: p }));
      }
    });
  }
  return (
    ["loader", "action"].forEach((c) => {
      let f = o[c];
      if (typeof f == "function" && i[c].length > 0) {
        let d = f[tn] ?? f,
          m = el(i[c], d, (...p) => Af(p[0]));
        m &&
          (c === "loader" && d.hydrate === !0 && (m.hydrate = !0),
          (m[tn] = d),
          (s[c] = m));
      }
    }),
    o.middleware &&
      o.middleware.length > 0 &&
      i.middleware.length > 0 &&
      (s.middleware = o.middleware.map((c) => {
        let f = c[tn] ?? c,
          d = el(i.middleware, f, (...m) => Af(m[0]));
        return d ? ((d[tn] = f), d) : c;
      })),
    s
  );
}
function _m(n, o) {
  let i = { navigate: [], fetch: [] };
  if (
    (o.forEach((s) =>
      s({
        instrument(c) {
          let f = Object.keys(c);
          for (let d of f) c[d] && i[d].push(c[d]);
        },
      }),
    ),
    i.navigate.length > 0)
  ) {
    let s = n.navigate[tn] ?? n.navigate,
      c = el(i.navigate, s, (...f) => {
        let [d, m] = f;
        return {
          to:
            typeof d == "number" || typeof d == "string" ? d : d ? er(d) : ".",
          ...$f(n, m ?? {}),
        };
      });
    c && ((c[tn] = s), (n.navigate = c));
  }
  if (i.fetch.length > 0) {
    let s = n.fetch[tn] ?? n.fetch,
      c = el(i.fetch, s, (...f) => {
        let [d, , m, p] = f;
        return { href: m ?? ".", fetcherKey: d, ...$f(n, p ?? {}) };
      });
    c && ((c[tn] = s), (n.fetch = c));
  }
  return n;
}
function el(n, o, i) {
  return n.length === 0
    ? null
    : async (...s) => {
        let c = await Sd(n, i(...s), () => o(...s), n.length - 1);
        if (c.type === "error") throw c.value;
        return c.value;
      };
}
async function Sd(n, o, i, s) {
  let c = n[s],
    f;
  if (c) {
    let d,
      m = async () => (
        d
          ? console.error(
              "You cannot call instrumented handlers more than once",
            )
          : (d = Sd(n, o, i, s - 1)),
        (f = await d),
        Ce(f, "Expected a result"),
        f.type === "error" && f.value instanceof Error
          ? { status: "error", error: f.value }
          : { status: "success", error: void 0 }
      );
    try {
      await c(m, o);
    } catch (p) {
      console.error("An instrumentation function threw an error:", p);
    }
    (d || (await m()), await d);
  } else
    try {
      f = { type: "success", value: await i() };
    } catch (d) {
      f = { type: "error", value: d };
    }
  return (
    f || {
      type: "error",
      value: new Error("No result assigned in instrumentation chain."),
    }
  );
}
function Af(n) {
  let { request: o, context: i, params: s, unstable_pattern: c } = n;
  return {
    request: Tm(o),
    params: { ...s },
    unstable_pattern: c,
    context: Mm(i),
  };
}
function $f(n, o) {
  return {
    currentUrl: er(n.state.location),
    ...("formMethod" in o ? { formMethod: o.formMethod } : {}),
    ...("formEncType" in o ? { formEncType: o.formEncType } : {}),
    ...("formData" in o ? { formData: o.formData } : {}),
    ...("body" in o ? { body: o.body } : {}),
  };
}
function Tm(n) {
  return {
    method: n.method,
    url: n.url,
    headers: { get: (...o) => n.headers.get(...o) },
  };
}
function Mm(n) {
  if (Dm(n)) {
    let o = { ...n };
    return (Object.freeze(o), o);
  } else return { get: (o) => n.get(o) };
}
var Nm = Object.getOwnPropertyNames(Object.prototype).sort().join("\0");
function Dm(n) {
  if (n === null || typeof n != "object") return !1;
  const o = Object.getPrototypeOf(n);
  return (
    o === Object.prototype ||
    o === null ||
    Object.getOwnPropertyNames(o).sort().join("\0") === Nm
  );
}
var Ed = ["POST", "PUT", "PATCH", "DELETE"],
  Om = new Set(Ed),
  zm = ["GET", ...Ed],
  Fm = new Set(zm),
  Rd = new Set([301, 302, 303, 307, 308]),
  Im = new Set([307, 308]),
  Su = {
    state: "idle",
    location: void 0,
    formMethod: void 0,
    formAction: void 0,
    formEncType: void 0,
    formData: void 0,
    json: void 0,
    text: void 0,
  },
  jm = {
    state: "idle",
    data: void 0,
    formMethod: void 0,
    formAction: void 0,
    formEncType: void 0,
    formData: void 0,
    json: void 0,
    text: void 0,
  },
  Ql = { state: "unblocked", proceed: void 0, reset: void 0, location: void 0 },
  Um = (n) => ({ hasErrorBoundary: !!n.hasErrorBoundary }),
  kd = "remix-router-transitions",
  xd = Symbol("ResetLoaderData");
function mg(n) {
  const o = n.window ? n.window : typeof window < "u" ? window : void 0,
    i =
      typeof o < "u" &&
      typeof o.document < "u" &&
      typeof o.document.createElement < "u";
  Ce(
    n.routes.length > 0,
    "You must provide a non-empty routes array to createRouter",
  );
  let s = n.hydrationRouteProperties || [],
    c = n.mapRouteProperties || Um,
    f = c;
  if (n.unstable_instrumentations) {
    let w = n.unstable_instrumentations;
    f = (C) => ({ ...c(C), ...Lm(w.map((D) => D.route).filter(Boolean), C) });
  }
  let d = {},
    m = ql(n.routes, f, void 0, d),
    p,
    y = n.basename || "/";
  y.startsWith("/") || (y = `/${y}`);
  let S = n.dataStrategy || Wm,
    v = { ...n.future },
    k = null,
    M = new Set(),
    F = null,
    z = null,
    _ = null,
    B = n.hydrationData != null,
    j = kr(m, n.history.location, y),
    K = !1,
    Y = null,
    J,
    Z;
  if (j == null && !n.patchRoutesOnNavigation) {
    let w = Bt(404, { pathname: n.history.location.pathname }),
      { matches: C, route: D } = pa(m);
    ((J = !0), (Z = !J), (j = C), (Y = { [D.id]: w }));
  } else if (
    (j &&
      !n.hydrationData &&
      Mr(j, m, n.history.location.pathname).active &&
      (j = null),
    j)
  )
    if (j.some((w) => w.route.lazy)) ((J = !1), (Z = !J));
    else if (!j.some((w) => Hu(w.route))) ((J = !0), (Z = !J));
    else {
      let w = n.hydrationData ? n.hydrationData.loaderData : null,
        C = n.hydrationData ? n.hydrationData.errors : null,
        D = j;
      if (C) {
        let $ = j.findIndex((W) => C[W.route.id] !== void 0);
        D = D.slice(0, $ + 1);
      }
      ((Z = !1),
        (J = D.every(($) => {
          let W = Cd($.route, w, C);
          return ((Z = Z || W.renderFallback), !W.shouldLoad);
        })));
    }
  else {
    ((J = !1), (Z = !J), (j = []));
    let w = Mr(null, m, n.history.location.pathname);
    w.active && w.matches && ((K = !0), (j = w.matches));
  }
  let he,
    L = {
      historyAction: n.history.action,
      location: n.history.location,
      matches: j,
      initialized: J,
      renderFallback: Z,
      navigation: Su,
      restoreScrollPosition: n.hydrationData != null ? !1 : null,
      preventScrollReset: !1,
      revalidation: "idle",
      loaderData: (n.hydrationData && n.hydrationData.loaderData) || {},
      actionData: (n.hydrationData && n.hydrationData.actionData) || null,
      errors: (n.hydrationData && n.hydrationData.errors) || Y,
      fetchers: new Map(),
      blockers: new Map(),
    },
    me = "POP",
    ge = null,
    De = !1,
    we,
    ze = !1,
    xe = new Map(),
    ye = null,
    Re = !1,
    Pe = !1,
    Q = new Set(),
    X = new Map(),
    G = 0,
    P = -1,
    I = new Map(),
    ue = new Set(),
    pe = new Map(),
    ke = new Map(),
    Ee = new Set(),
    Te = new Map(),
    Me,
    je = null;
  function pt() {
    if (
      ((k = n.history.listen(({ action: w, location: C, delta: D }) => {
        if (Me) {
          (Me(), (Me = void 0));
          return;
        }
        Je(
          Te.size === 0 || D != null,
          "You are trying to use a blocker on a POP navigation to a location that was not created by @remix-run/router. This will fail silently in production. This can happen if you are navigating outside the router via `window.history.pushState`/`window.location.hash` instead of using router navigation APIs.  This can also happen if you are using createHashRouter and the user manually changes the URL.",
        );
        let $ = sr({
          currentLocation: L.location,
          nextLocation: C,
          historyAction: w,
        });
        if ($ && D != null) {
          let W = new Promise((oe) => {
            Me = oe;
          });
          (n.history.go(D * -1),
            Qt($, {
              state: "blocked",
              location: C,
              proceed() {
                (Qt($, {
                  state: "proceeding",
                  proceed: void 0,
                  reset: void 0,
                  location: C,
                }),
                  W.then(() => n.history.go(D)));
              },
              reset() {
                let oe = new Map(L.blockers);
                (oe.set($, Ql), Ge({ blockers: oe }));
              },
            }),
            ge?.resolve(),
            (ge = null));
          return;
        }
        return Wt(w, C);
      })),
      i)
    ) {
      iy(o, xe);
      let w = () => uy(o, xe);
      (o.addEventListener("pagehide", w),
        (ye = () => o.removeEventListener("pagehide", w)));
    }
    return (
      L.initialized || Wt("POP", L.location, { initialHydration: !0 }),
      he
    );
  }
  function En() {
    (k && k(),
      ye && ye(),
      M.clear(),
      we && we.abort(),
      L.fetchers.forEach((w, C) => kn(C)),
      L.blockers.forEach((w, C) => Ln(C)));
  }
  function oo(w) {
    return (M.add(w), () => M.delete(w));
  }
  function Ge(w, C = {}) {
    (w.matches &&
      (w.matches = w.matches.map((W) => {
        let oe = d[W.route.id],
          ee = W.route;
        return ee.element !== oe.element ||
          ee.errorElement !== oe.errorElement ||
          ee.hydrateFallbackElement !== oe.hydrateFallbackElement
          ? { ...W, route: oe }
          : W;
      })),
      (L = { ...L, ...w }));
    let D = [],
      $ = [];
    (L.fetchers.forEach((W, oe) => {
      W.state === "idle" && (Ee.has(oe) ? D.push(oe) : $.push(oe));
    }),
      Ee.forEach((W) => {
        !L.fetchers.has(W) && !X.has(W) && D.push(W);
      }),
      [...M].forEach((W) =>
        W(L, {
          deletedFetchers: D,
          newErrors: w.errors ?? null,
          viewTransitionOpts: C.viewTransitionOpts,
          flushSync: C.flushSync === !0,
        }),
      ),
      D.forEach((W) => kn(W)),
      $.forEach((W) => L.fetchers.delete(W)));
  }
  function nr(w, C, { flushSync: D } = {}) {
    let $ =
        L.actionData != null &&
        L.navigation.formMethod != null &&
        ht(L.navigation.formMethod) &&
        L.navigation.state === "loading" &&
        w.state?._isRedirect !== !0,
      W;
    C.actionData
      ? Object.keys(C.actionData).length > 0
        ? (W = C.actionData)
        : (W = null)
      : $
        ? (W = L.actionData)
        : (W = null);
    let oe = C.loaderData
        ? Gf(L.loaderData, C.loaderData, C.matches || [], C.errors)
        : L.loaderData,
      ee = L.blockers;
    ee.size > 0 && ((ee = new Map(ee)), ee.forEach((ce, ae) => ee.set(ae, Ql)));
    let ie = Re ? !1 : sl(w, C.matches || L.matches),
      b =
        De === !0 ||
        (L.navigation.formMethod != null &&
          ht(L.navigation.formMethod) &&
          w.state?._isRedirect !== !0);
    (p && ((m = p), (p = void 0)),
      Re ||
        me === "POP" ||
        (me === "PUSH"
          ? n.history.push(w, w.state)
          : me === "REPLACE" && n.history.replace(w, w.state)));
    let se;
    if (me === "POP") {
      let ce = xe.get(L.location.pathname);
      ce && ce.has(w.pathname)
        ? (se = { currentLocation: L.location, nextLocation: w })
        : xe.has(w.pathname) &&
          (se = { currentLocation: w, nextLocation: L.location });
    } else if (ze) {
      let ce = xe.get(L.location.pathname);
      (ce
        ? ce.add(w.pathname)
        : ((ce = new Set([w.pathname])), xe.set(L.location.pathname, ce)),
        (se = { currentLocation: L.location, nextLocation: w }));
    }
    (Ge(
      {
        ...C,
        actionData: W,
        loaderData: oe,
        historyAction: me,
        location: w,
        initialized: !0,
        renderFallback: !1,
        navigation: Su,
        revalidation: "idle",
        restoreScrollPosition: ie,
        preventScrollReset: b,
        blockers: ee,
      },
      { viewTransitionOpts: se, flushSync: D === !0 },
    ),
      (me = "POP"),
      (De = !1),
      (ze = !1),
      (Re = !1),
      (Pe = !1),
      ge?.resolve(),
      (ge = null),
      je?.resolve(),
      (je = null));
  }
  async function ll(w, C) {
    if ((ge?.resolve(), (ge = null), typeof w == "number")) {
      ge || (ge = bf());
      let He = ge.promise;
      return (n.history.go(w), He);
    }
    let D = Lu(L.location, L.matches, y, w, C?.fromRouteId, C?.relative),
      { path: $, submission: W, error: oe } = Hf(!1, D, C),
      ee;
    C?.unstable_mask &&
      (ee = {
        pathname: "",
        search: "",
        hash: "",
        ...(typeof C.unstable_mask == "string"
          ? xr(C.unstable_mask)
          : { ...L.location.unstable_mask, ...C.unstable_mask }),
      });
    let ie = L.location,
      b = Zl(ie, $, C && C.state, void 0, ee);
    b = { ...b, ...n.history.encodeLocation(b) };
    let se = C && C.replace != null ? C.replace : void 0,
      ce = "PUSH";
    se === !0
      ? (ce = "REPLACE")
      : se === !1 ||
        (W != null &&
          ht(W.formMethod) &&
          W.formAction === L.location.pathname + L.location.search &&
          (ce = "REPLACE"));
    let ae =
        C && "preventScrollReset" in C ? C.preventScrollReset === !0 : void 0,
      Fe = (C && C.flushSync) === !0,
      _e = sr({ currentLocation: ie, nextLocation: b, historyAction: ce });
    if (_e) {
      Qt(_e, {
        state: "blocked",
        location: b,
        proceed() {
          (Qt(_e, {
            state: "proceeding",
            proceed: void 0,
            reset: void 0,
            location: b,
          }),
            ll(w, C));
        },
        reset() {
          let He = new Map(L.blockers);
          (He.set(_e, Ql), Ge({ blockers: He }));
        },
      });
      return;
    }
    await Wt(ce, b, {
      submission: W,
      pendingError: oe,
      preventScrollReset: ae,
      replace: C && C.replace,
      enableViewTransition: C && C.viewTransition,
      flushSync: Fe,
      callSiteDefaultShouldRevalidate: C && C.unstable_defaultShouldRevalidate,
    });
  }
  function ao() {
    (je || (je = bf()), _r(), Ge({ revalidation: "loading" }));
    let w = je.promise;
    return L.navigation.state === "submitting"
      ? w
      : L.navigation.state === "idle"
        ? (Wt(L.historyAction, L.location, {
            startUninterruptedRevalidation: !0,
          }),
          w)
        : (Wt(me || L.historyAction, L.navigation.location, {
            overrideNavigation: L.navigation,
            enableViewTransition: ze === !0,
          }),
          w);
  }
  async function Wt(w, C, D) {
    (we && we.abort(),
      (we = null),
      (me = w),
      (Re = (D && D.startUninterruptedRevalidation) === !0),
      ho(L.location, L.matches),
      (De = (D && D.preventScrollReset) === !0),
      (ze = (D && D.enableViewTransition) === !0));
    let $ = p || m,
      W = D && D.overrideNavigation,
      oe =
        D?.initialHydration && L.matches && L.matches.length > 0 && !K
          ? L.matches
          : kr($, C, y),
      ee = (D && D.flushSync) === !0;
    if (
      oe &&
      L.initialized &&
      !Pe &&
      Zm(L.location, C) &&
      !(D && D.submission && ht(D.submission.formMethod))
    ) {
      nr(C, { matches: oe }, { flushSync: ee });
      return;
    }
    let ie = Mr(oe, $, C.pathname);
    if ((ie.active && ie.matches && (oe = ie.matches), !oe)) {
      let { error: Ze, notFoundMatches: at, route: Ue } = _n(C.pathname);
      nr(
        C,
        { matches: at, loaderData: {}, errors: { [Ue.id]: Ze } },
        { flushSync: ee },
      );
      return;
    }
    we = new AbortController();
    let b = bn(n.history, C, we.signal, D && D.submission),
      se = n.getContext ? await n.getContext() : new Ff(),
      ce;
    if (D && D.pendingError)
      ce = [en(oe).route.id, { type: "error", error: D.pendingError }];
    else if (D && D.submission && ht(D.submission.formMethod)) {
      let Ze = await io(
        b,
        C,
        D.submission,
        oe,
        se,
        ie.active,
        D && D.initialHydration === !0,
        { replace: D.replace, flushSync: ee },
      );
      if (Ze.shortCircuited) return;
      if (Ze.pendingActionResult) {
        let [at, Ue] = Ze.pendingActionResult;
        if (Dt(Ue) && wn(Ue.error) && Ue.error.status === 404) {
          ((we = null),
            nr(C, {
              matches: Ze.matches,
              loaderData: {},
              errors: { [at]: Ue.error },
            }));
          return;
        }
      }
      ((oe = Ze.matches || oe),
        (ce = Ze.pendingActionResult),
        (W = Eu(C, D.submission)),
        (ee = !1),
        (ie.active = !1),
        (b = bn(n.history, b.url, b.signal)));
    }
    let {
      shortCircuited: ae,
      matches: Fe,
      loaderData: _e,
      errors: He,
    } = await ol(
      b,
      C,
      oe,
      se,
      ie.active,
      W,
      D && D.submission,
      D && D.fetcherSubmission,
      D && D.replace,
      D && D.initialHydration === !0,
      ee,
      ce,
      D && D.callSiteDefaultShouldRevalidate,
    );
    ae ||
      ((we = null),
      nr(C, { matches: Fe || oe, ...Zf(ce), loaderData: _e, errors: He }));
  }
  async function io(w, C, D, $, W, oe, ee, ie = {}) {
    _r();
    let b = oy(C, D);
    if ((Ge({ navigation: b }, { flushSync: ie.flushSync === !0 }), oe)) {
      let ae = await nn($, C.pathname, w.signal);
      if (ae.type === "aborted") return { shortCircuited: !0 };
      if (ae.type === "error") {
        if (ae.partialMatches.length === 0) {
          let { matches: _e, route: He } = pa(m);
          return {
            matches: _e,
            pendingActionResult: [He.id, { type: "error", error: ae.error }],
          };
        }
        let Fe = en(ae.partialMatches).route.id;
        return {
          matches: ae.partialMatches,
          pendingActionResult: [Fe, { type: "error", error: ae.error }],
        };
      } else if (ae.matches) $ = ae.matches;
      else {
        let { notFoundMatches: Fe, error: _e, route: He } = _n(C.pathname);
        return {
          matches: Fe,
          pendingActionResult: [He.id, { type: "error", error: _e }],
        };
      }
    }
    let se,
      ce = Sa($, C);
    if (!ce.route.action && !ce.route.lazy)
      se = {
        type: "error",
        error: Bt(405, {
          method: w.method,
          pathname: C.pathname,
          routeId: ce.route.id,
        }),
      };
    else {
      let ae = tl(f, d, w, $, ce, ee ? [] : s, W),
        Fe = await Lr(w, ae, W, null);
      if (((se = Fe[ce.route.id]), !se)) {
        for (let _e of $)
          if (Fe[_e.route.id]) {
            se = Fe[_e.route.id];
            break;
          }
      }
      if (w.signal.aborted) return { shortCircuited: !0 };
    }
    if (gn(se)) {
      let ae;
      return (
        ie && ie.replace != null
          ? (ae = ie.replace)
          : (ae =
              Kf(
                se.response.headers.get("Location"),
                new URL(w.url),
                y,
                n.history,
              ) ===
              L.location.pathname + L.location.search),
        await lr(w, se, !0, { submission: D, replace: ae }),
        { shortCircuited: !0 }
      );
    }
    if (Dt(se)) {
      let ae = en($, ce.route.id);
      return (
        (ie && ie.replace) !== !0 && (me = "PUSH"),
        { matches: $, pendingActionResult: [ae.route.id, se, ce.route.id] }
      );
    }
    return { matches: $, pendingActionResult: [ce.route.id, se] };
  }
  async function ol(w, C, D, $, W, oe, ee, ie, b, se, ce, ae, Fe) {
    let _e = oe || Eu(C, ee),
      He = ee || ie || qf(_e),
      Ze = !Re && !se;
    if (W) {
      if (Ze) {
        let rt = Cr(ae);
        Ge(
          { navigation: _e, ...(rt !== void 0 ? { actionData: rt } : {}) },
          { flushSync: ce },
        );
      }
      let Se = await nn(D, C.pathname, w.signal);
      if (Se.type === "aborted") return { shortCircuited: !0 };
      if (Se.type === "error") {
        if (Se.partialMatches.length === 0) {
          let { matches: Or, route: dr } = pa(m);
          return { matches: Or, loaderData: {}, errors: { [dr.id]: Se.error } };
        }
        let rt = en(Se.partialMatches).route.id;
        return {
          matches: Se.partialMatches,
          loaderData: {},
          errors: { [rt]: Se.error },
        };
      } else if (Se.matches) D = Se.matches;
      else {
        let { error: rt, notFoundMatches: Or, route: dr } = _n(C.pathname);
        return { matches: Or, loaderData: {}, errors: { [dr.id]: rt } };
      }
    }
    let at = p || m,
      { dsMatches: Ue, revalidatingFetchers: Ne } = Bf(
        w,
        $,
        f,
        d,
        n.history,
        L,
        D,
        He,
        C,
        se ? [] : s,
        se === !0,
        Pe,
        Q,
        Ee,
        pe,
        ue,
        at,
        y,
        n.patchRoutesOnNavigation != null,
        ae,
        Fe,
      );
    if (
      ((P = ++G),
      !n.dataStrategy &&
        !Ue.some((Se) => Se.shouldLoad) &&
        !Ue.some(
          (Se) => Se.route.middleware && Se.route.middleware.length > 0,
        ) &&
        Ne.length === 0)
    ) {
      let Se = Cn();
      return (
        nr(
          C,
          {
            matches: D,
            loaderData: {},
            errors: ae && Dt(ae[1]) ? { [ae[0]]: ae[1].error } : null,
            ...Zf(ae),
            ...(Se ? { fetchers: new Map(L.fetchers) } : {}),
          },
          { flushSync: ce },
        ),
        { shortCircuited: !0 }
      );
    }
    if (Ze) {
      let Se = {};
      if (!W) {
        Se.navigation = _e;
        let rt = Cr(ae);
        rt !== void 0 && (Se.actionData = rt);
      }
      (Ne.length > 0 && (Se.fetchers = Pr(Ne)), Ge(Se, { flushSync: ce }));
    }
    Ne.forEach((Se) => {
      (Vt(Se.key), Se.controller && X.set(Se.key, Se.controller));
    });
    let cr = () => Ne.forEach((Se) => Vt(Se.key));
    we && we.signal.addEventListener("abort", cr);
    let { loaderResults: fr, fetcherResults: Yt } = await Rn(Ue, Ne, w, $);
    if (w.signal.aborted) return { shortCircuited: !0 };
    (we && we.signal.removeEventListener("abort", cr),
      Ne.forEach((Se) => X.delete(Se.key)));
    let yt = ma(fr);
    if (yt)
      return (
        await lr(w, yt.result, !0, { replace: b }),
        { shortCircuited: !0 }
      );
    if (((yt = ma(Yt)), yt))
      return (
        ue.add(yt.key),
        await lr(w, yt.result, !0, { replace: b }),
        { shortCircuited: !0 }
      );
    let { loaderData: fl, errors: Dr } = Jf(L, D, fr, ae, Ne, Yt);
    se && L.errors && (Dr = { ...L.errors, ...Dr });
    let Ft = Cn(),
      vt = Pn(P),
      Tn = Ft || vt || Ne.length > 0;
    return {
      matches: D,
      loaderData: fl,
      errors: Dr,
      ...(Tn ? { fetchers: new Map(L.fetchers) } : {}),
    };
  }
  function Cr(w) {
    if (w && !Dt(w[1])) return { [w[0]]: w[1].data };
    if (L.actionData)
      return Object.keys(L.actionData).length === 0 ? null : L.actionData;
  }
  function Pr(w) {
    return (
      w.forEach((C) => {
        let D = L.fetchers.get(C.key),
          $ = Yl(void 0, D ? D.data : void 0);
        L.fetchers.set(C.key, $);
      }),
      new Map(L.fetchers)
    );
  }
  async function al(w, C, D, $) {
    Vt(w);
    let W = ($ && $.flushSync) === !0,
      oe = p || m,
      ee = Lu(L.location, L.matches, y, D, C, $?.relative),
      ie = kr(oe, ee, y),
      b = Mr(ie, oe, ee);
    if ((b.active && b.matches && (ie = b.matches), !ie)) {
      mt(w, C, Bt(404, { pathname: ee }), { flushSync: W });
      return;
    }
    let { path: se, submission: ce, error: ae } = Hf(!0, ee, $);
    if (ae) {
      mt(w, C, ae, { flushSync: W });
      return;
    }
    let Fe = n.getContext ? await n.getContext() : new Ff(),
      _e = ($ && $.preventScrollReset) === !0;
    if (ce && ht(ce.formMethod)) {
      await uo(
        w,
        C,
        se,
        ie,
        Fe,
        b.active,
        W,
        _e,
        ce,
        $ && $.unstable_defaultShouldRevalidate,
      );
      return;
    }
    (pe.set(w, { routeId: C, path: se }),
      await so(w, C, se, ie, Fe, b.active, W, _e, ce));
  }
  async function uo(w, C, D, $, W, oe, ee, ie, b, se) {
    (_r(), pe.delete(w));
    let ce = L.fetchers.get(w);
    zt(w, ay(b, ce), { flushSync: ee });
    let ae = new AbortController(),
      Fe = bn(n.history, D, ae.signal, b);
    if (oe) {
      let $e = await nn($, new URL(Fe.url).pathname, Fe.signal, w);
      if ($e.type === "aborted") return;
      if ($e.type === "error") {
        mt(w, C, $e.error, { flushSync: ee });
        return;
      } else if ($e.matches) $ = $e.matches;
      else {
        mt(w, C, Bt(404, { pathname: D }), { flushSync: ee });
        return;
      }
    }
    let _e = Sa($, D);
    if (!_e.route.action && !_e.route.lazy) {
      let $e = Bt(405, { method: b.formMethod, pathname: D, routeId: C });
      mt(w, C, $e, { flushSync: ee });
      return;
    }
    X.set(w, ae);
    let He = G,
      Ze = tl(f, d, Fe, $, _e, s, W),
      at = await Lr(Fe, Ze, W, w),
      Ue = at[_e.route.id];
    if (!Ue) {
      for (let $e of Ze)
        if (at[$e.route.id]) {
          Ue = at[$e.route.id];
          break;
        }
    }
    if (Fe.signal.aborted) {
      X.get(w) === ae && X.delete(w);
      return;
    }
    if (Ee.has(w)) {
      if (gn(Ue) || Dt(Ue)) {
        zt(w, Rr(void 0));
        return;
      }
    } else {
      if (gn(Ue))
        if ((X.delete(w), P > He)) {
          zt(w, Rr(void 0));
          return;
        } else
          return (
            ue.add(w),
            zt(w, Yl(b)),
            lr(Fe, Ue, !1, { fetcherSubmission: b, preventScrollReset: ie })
          );
      if (Dt(Ue)) {
        mt(w, C, Ue.error);
        return;
      }
    }
    let Ne = L.navigation.location || L.location,
      cr = bn(n.history, Ne, ae.signal),
      fr = p || m,
      Yt =
        L.navigation.state !== "idle"
          ? kr(fr, L.navigation.location, y)
          : L.matches;
    Ce(Yt, "Didn't find any matches after fetcher action");
    let yt = ++G;
    I.set(w, yt);
    let fl = Yl(b, Ue.data);
    L.fetchers.set(w, fl);
    let { dsMatches: Dr, revalidatingFetchers: Ft } = Bf(
      cr,
      W,
      f,
      d,
      n.history,
      L,
      Yt,
      b,
      Ne,
      s,
      !1,
      Pe,
      Q,
      Ee,
      pe,
      ue,
      fr,
      y,
      n.patchRoutesOnNavigation != null,
      [_e.route.id, Ue],
      se,
    );
    (Ft.filter(($e) => $e.key !== w).forEach(($e) => {
      let hr = $e.key,
        zr = L.fetchers.get(hr),
        Mn = Yl(void 0, zr ? zr.data : void 0);
      (L.fetchers.set(hr, Mn),
        Vt(hr),
        $e.controller && X.set(hr, $e.controller));
    }),
      Ge({ fetchers: new Map(L.fetchers) }));
    let vt = () => Ft.forEach(($e) => Vt($e.key));
    ae.signal.addEventListener("abort", vt);
    let { loaderResults: Tn, fetcherResults: Se } = await Rn(Dr, Ft, cr, W);
    if (ae.signal.aborted) return;
    if (
      (ae.signal.removeEventListener("abort", vt),
      I.delete(w),
      X.delete(w),
      Ft.forEach(($e) => X.delete($e.key)),
      L.fetchers.has(w))
    ) {
      let $e = Rr(Ue.data);
      L.fetchers.set(w, $e);
    }
    let rt = ma(Tn);
    if (rt) return lr(cr, rt.result, !1, { preventScrollReset: ie });
    if (((rt = ma(Se)), rt))
      return (
        ue.add(rt.key),
        lr(cr, rt.result, !1, { preventScrollReset: ie })
      );
    let { loaderData: Or, errors: dr } = Jf(L, Yt, Tn, void 0, Ft, Se);
    (Pn(yt),
      L.navigation.state === "loading" && yt > P
        ? (Ce(me, "Expected pending action"),
          we && we.abort(),
          nr(L.navigation.location, {
            matches: Yt,
            loaderData: Or,
            errors: dr,
            fetchers: new Map(L.fetchers),
          }))
        : (Ge({
            errors: dr,
            loaderData: Gf(L.loaderData, Or, Yt, dr),
            fetchers: new Map(L.fetchers),
          }),
          (Pe = !1)));
  }
  async function so(w, C, D, $, W, oe, ee, ie, b) {
    let se = L.fetchers.get(w);
    zt(w, Yl(b, se ? se.data : void 0), { flushSync: ee });
    let ce = new AbortController(),
      ae = bn(n.history, D, ce.signal);
    if (oe) {
      let Ue = await nn($, new URL(ae.url).pathname, ae.signal, w);
      if (Ue.type === "aborted") return;
      if (Ue.type === "error") {
        mt(w, C, Ue.error, { flushSync: ee });
        return;
      } else if (Ue.matches) $ = Ue.matches;
      else {
        mt(w, C, Bt(404, { pathname: D }), { flushSync: ee });
        return;
      }
    }
    let Fe = Sa($, D);
    X.set(w, ce);
    let _e = G,
      He = tl(f, d, ae, $, Fe, s, W),
      at = (await Lr(ae, He, W, w))[Fe.route.id];
    if ((X.get(w) === ce && X.delete(w), !ae.signal.aborted)) {
      if (Ee.has(w)) {
        zt(w, Rr(void 0));
        return;
      }
      if (gn(at))
        if (P > _e) {
          zt(w, Rr(void 0));
          return;
        } else {
          (ue.add(w), await lr(ae, at, !1, { preventScrollReset: ie }));
          return;
        }
      if (Dt(at)) {
        mt(w, C, at.error);
        return;
      }
      zt(w, Rr(at.data));
    }
  }
  async function lr(
    w,
    C,
    D,
    {
      submission: $,
      fetcherSubmission: W,
      preventScrollReset: oe,
      replace: ee,
    } = {},
  ) {
    (D || (ge?.resolve(), (ge = null)),
      C.response.headers.has("X-Remix-Revalidate") && (Pe = !0));
    let ie = C.response.headers.get("Location");
    (Ce(ie, "Expected a Location header on the redirect Response"),
      (ie = Kf(ie, new URL(w.url), y, n.history)));
    let b = Zl(L.location, ie, { _isRedirect: !0 });
    if (i) {
      let He = !1;
      if (C.response.headers.has("X-Remix-Reload-Document")) He = !0;
      else if (Au(ie)) {
        const Ze = fd(ie, !0);
        He = Ze.origin !== o.location.origin || Ot(Ze.pathname, y) == null;
      }
      if (He) {
        ee ? o.location.replace(ie) : o.location.assign(ie);
        return;
      }
    }
    we = null;
    let se =
        ee === !0 || C.response.headers.has("X-Remix-Replace")
          ? "REPLACE"
          : "PUSH",
      { formMethod: ce, formAction: ae, formEncType: Fe } = L.navigation;
    !$ && !W && ce && ae && Fe && ($ = qf(L.navigation));
    let _e = $ || W;
    if (Im.has(C.response.status) && _e && ht(_e.formMethod))
      await Wt(se, b, {
        submission: { ..._e, formAction: ie },
        preventScrollReset: oe || De,
        enableViewTransition: D ? ze : void 0,
      });
    else {
      let He = Eu(b, $);
      await Wt(se, b, {
        overrideNavigation: He,
        fetcherSubmission: W,
        preventScrollReset: oe || De,
        enableViewTransition: D ? ze : void 0,
      });
    }
  }
  async function Lr(w, C, D, $) {
    let W,
      oe = {};
    try {
      W = await Qm(S, w, C, $, D, !1);
    } catch (ee) {
      return (
        C.filter((ie) => ie.shouldLoad).forEach((ie) => {
          oe[ie.route.id] = { type: "error", error: ee };
        }),
        oe
      );
    }
    if (w.signal.aborted) return oe;
    if (!ht(w.method))
      for (let ee of C) {
        if (W[ee.route.id]?.type === "error") break;
        !W.hasOwnProperty(ee.route.id) &&
          !L.loaderData.hasOwnProperty(ee.route.id) &&
          (!L.errors || !L.errors.hasOwnProperty(ee.route.id)) &&
          ee.shouldCallHandler() &&
          (W[ee.route.id] = {
            type: "error",
            result: new Error(
              `No result returned from dataStrategy for route ${ee.route.id}`,
            ),
          });
      }
    for (let [ee, ie] of Object.entries(W))
      if (ty(ie)) {
        let b = ie.result;
        oe[ee] = { type: "redirect", response: Jm(b, w, ee, C, y) };
      } else oe[ee] = await Xm(ie);
    return oe;
  }
  async function Rn(w, C, D, $) {
    let W = Lr(D, w, $, null),
      oe = Promise.all(
        C.map(async (b) => {
          if (b.matches && b.match && b.request && b.controller) {
            let ce = (await Lr(b.request, b.matches, $, b.key))[
              b.match.route.id
            ];
            return { [b.key]: ce };
          } else
            return Promise.resolve({
              [b.key]: { type: "error", error: Bt(404, { pathname: b.path }) },
            });
        }),
      ),
      ee = await W,
      ie = (await oe).reduce((b, se) => Object.assign(b, se), {});
    return { loaderResults: ee, fetcherResults: ie };
  }
  function _r() {
    ((Pe = !0),
      pe.forEach((w, C) => {
        (X.has(C) && Q.add(C), Vt(C));
      }));
  }
  function zt(w, C, D = {}) {
    (L.fetchers.set(w, C),
      Ge(
        { fetchers: new Map(L.fetchers) },
        { flushSync: (D && D.flushSync) === !0 },
      ));
  }
  function mt(w, C, D, $ = {}) {
    let W = en(L.matches, C);
    (kn(w),
      Ge(
        { errors: { [W.route.id]: D }, fetchers: new Map(L.fetchers) },
        { flushSync: ($ && $.flushSync) === !0 },
      ));
  }
  function Tr(w) {
    return (
      ke.set(w, (ke.get(w) || 0) + 1),
      Ee.has(w) && Ee.delete(w),
      L.fetchers.get(w) || jm
    );
  }
  function Oa(w, C) {
    (Vt(w, C?.reason), zt(w, Rr(null)));
  }
  function kn(w) {
    let C = L.fetchers.get(w);
    (X.has(w) && !(C && C.state === "loading" && I.has(w)) && Vt(w),
      pe.delete(w),
      I.delete(w),
      ue.delete(w),
      Ee.delete(w),
      Q.delete(w),
      L.fetchers.delete(w));
  }
  function co(w) {
    let C = (ke.get(w) || 0) - 1;
    (C <= 0 ? (ke.delete(w), Ee.add(w)) : ke.set(w, C),
      Ge({ fetchers: new Map(L.fetchers) }));
  }
  function Vt(w, C) {
    let D = X.get(w);
    D && (D.abort(C), X.delete(w));
  }
  function xn(w) {
    for (let C of w) {
      let D = Tr(C),
        $ = Rr(D.data);
      L.fetchers.set(C, $);
    }
  }
  function Cn() {
    let w = [],
      C = !1;
    for (let D of ue) {
      let $ = L.fetchers.get(D);
      (Ce($, `Expected fetcher: ${D}`),
        $.state === "loading" && (ue.delete(D), w.push(D), (C = !0)));
    }
    return (xn(w), C);
  }
  function Pn(w) {
    let C = [];
    for (let [D, $] of I)
      if ($ < w) {
        let W = L.fetchers.get(D);
        (Ce(W, `Expected fetcher: ${D}`),
          W.state === "loading" && (Vt(D), I.delete(D), C.push(D)));
      }
    return (xn(C), C.length > 0);
  }
  function il(w, C) {
    let D = L.blockers.get(w) || Ql;
    return (Te.get(w) !== C && Te.set(w, C), D);
  }
  function Ln(w) {
    (L.blockers.delete(w), Te.delete(w));
  }
  function Qt(w, C) {
    let D = L.blockers.get(w) || Ql;
    Ce(
      (D.state === "unblocked" && C.state === "blocked") ||
        (D.state === "blocked" && C.state === "blocked") ||
        (D.state === "blocked" && C.state === "proceeding") ||
        (D.state === "blocked" && C.state === "unblocked") ||
        (D.state === "proceeding" && C.state === "unblocked"),
      `Invalid blocker state transition: ${D.state} -> ${C.state}`,
    );
    let $ = new Map(L.blockers);
    ($.set(w, C), Ge({ blockers: $ }));
  }
  function sr({ currentLocation: w, nextLocation: C, historyAction: D }) {
    if (Te.size === 0) return;
    Te.size > 1 && Je(!1, "A router only supports one blocker at a time");
    let $ = Array.from(Te.entries()),
      [W, oe] = $[$.length - 1],
      ee = L.blockers.get(W);
    if (
      !(ee && ee.state === "proceeding") &&
      oe({ currentLocation: w, nextLocation: C, historyAction: D })
    )
      return W;
  }
  function _n(w) {
    let C = Bt(404, { pathname: w }),
      D = p || m,
      { matches: $, route: W } = pa(D);
    return { notFoundMatches: $, route: W, error: C };
  }
  function fo(w, C, D) {
    if (((F = w), (_ = C), (z = D || null), !B && L.navigation === Su)) {
      B = !0;
      let $ = sl(L.location, L.matches);
      $ != null && Ge({ restoreScrollPosition: $ });
    }
    return () => {
      ((F = null), (_ = null), (z = null));
    };
  }
  function ul(w, C) {
    return (
      (z &&
        z(
          w,
          C.map(($) => dd($, L.loaderData)),
        )) ||
      w.key
    );
  }
  function ho(w, C) {
    if (F && _) {
      let D = ul(w, C);
      F[D] = _();
    }
  }
  function sl(w, C) {
    if (F) {
      let D = ul(w, C),
        $ = F[D];
      if (typeof $ == "number") return $;
    }
    return null;
  }
  function Mr(w, C, D) {
    if (n.patchRoutesOnNavigation)
      if (w) {
        if (Object.keys(w[0].params).length > 0)
          return { active: !0, matches: Jl(C, D, y, !0) };
      } else return { active: !0, matches: Jl(C, D, y, !0) || [] };
    return { active: !1, matches: null };
  }
  async function nn(w, C, D, $) {
    if (!n.patchRoutesOnNavigation) return { type: "success", matches: w };
    let W = w;
    for (;;) {
      let oe = p == null,
        ee = p || m,
        ie = d;
      try {
        await n.patchRoutesOnNavigation({
          signal: D,
          path: C,
          matches: W,
          fetcherKey: $,
          patch: (ce, ae) => {
            D.aborted || Wf(ce, ae, ee, ie, f, !1);
          },
        });
      } catch (ce) {
        return { type: "error", error: ce, partialMatches: W };
      } finally {
        oe && !D.aborted && (m = [...m]);
      }
      if (D.aborted) return { type: "aborted" };
      let b = kr(ee, C, y),
        se = null;
      if (b) {
        if (Object.keys(b[0].params).length === 0)
          return { type: "success", matches: b };
        if (
          ((se = Jl(ee, C, y, !0)),
          !(se && W.length < se.length && Nr(W, se.slice(0, W.length))))
        )
          return { type: "success", matches: b };
      }
      if ((se || (se = Jl(ee, C, y, !0)), !se || Nr(W, se)))
        return { type: "success", matches: null };
      W = se;
    }
  }
  function Nr(w, C) {
    return (
      w.length === C.length && w.every((D, $) => D.route.id === C[$].route.id)
    );
  }
  function cl(w) {
    ((d = {}), (p = ql(w, f, void 0, d)));
  }
  function ln(w, C, D = !1) {
    let $ = p == null;
    (Wf(w, C, p || m, d, f, D), $ && ((m = [...m]), Ge({})));
  }
  return (
    (he = {
      get basename() {
        return y;
      },
      get future() {
        return v;
      },
      get state() {
        return L;
      },
      get routes() {
        return m;
      },
      get window() {
        return o;
      },
      initialize: pt,
      subscribe: oo,
      enableScrollRestoration: fo,
      navigate: ll,
      fetch: al,
      revalidate: ao,
      createHref: (w) => n.history.createHref(w),
      encodeLocation: (w) => n.history.encodeLocation(w),
      getFetcher: Tr,
      resetFetcher: Oa,
      deleteFetcher: co,
      dispose: En,
      getBlocker: il,
      deleteBlocker: Ln,
      patchRoutes: ln,
      _internalFetchControllers: X,
      _internalSetRoutes: cl,
      _internalSetStateDoNotUseOrYouWillBreakYourApp(w) {
        Ge(w);
      },
    }),
    n.unstable_instrumentations &&
      (he = _m(
        he,
        n.unstable_instrumentations.map((w) => w.router).filter(Boolean),
      )),
    he
  );
}
function Am(n) {
  return (
    n != null &&
    (("formData" in n && n.formData != null) ||
      ("body" in n && n.body !== void 0))
  );
}
function Lu(n, o, i, s, c, f) {
  let d, m;
  if (c) {
    d = [];
    for (let y of o)
      if ((d.push(y), y.route.id === c)) {
        m = y;
        break;
      }
  } else ((d = o), (m = o[o.length - 1]));
  let p = La(s || ".", $u(d), Ot(n.pathname, i) || n.pathname, f === "path");
  if (
    (s == null && ((p.search = n.search), (p.hash = n.hash)),
    (s == null || s === "" || s === ".") && m)
  ) {
    let y = Bu(p.search);
    if (m.route.index && !y)
      p.search = p.search ? p.search.replace(/^\?/, "?index&") : "?index";
    else if (!m.route.index && y) {
      let S = new URLSearchParams(p.search),
        v = S.getAll("index");
      (S.delete("index"),
        v.filter((M) => M).forEach((M) => S.append("index", M)));
      let k = S.toString();
      p.search = k ? `?${k}` : "";
    }
  }
  return (
    i !== "/" && (p.pathname = wm({ basename: i, pathname: p.pathname })),
    er(p)
  );
}
function Hf(n, o, i) {
  if (!i || !Am(i)) return { path: o };
  if (i.formMethod && !ly(i.formMethod))
    return { path: o, error: Bt(405, { method: i.formMethod }) };
  let s = () => ({ path: o, error: Bt(400, { type: "invalid-body" }) }),
    f = (i.formMethod || "get").toUpperCase(),
    d = Nd(o);
  if (i.body !== void 0) {
    if (i.formEncType === "text/plain") {
      if (!ht(f)) return s();
      let v =
        typeof i.body == "string"
          ? i.body
          : i.body instanceof FormData || i.body instanceof URLSearchParams
            ? Array.from(i.body.entries()).reduce(
                (k, [M, F]) => `${k}${M}=${F}
`,
                "",
              )
            : String(i.body);
      return {
        path: o,
        submission: {
          formMethod: f,
          formAction: d,
          formEncType: i.formEncType,
          formData: void 0,
          json: void 0,
          text: v,
        },
      };
    } else if (i.formEncType === "application/json") {
      if (!ht(f)) return s();
      try {
        let v = typeof i.body == "string" ? JSON.parse(i.body) : i.body;
        return {
          path: o,
          submission: {
            formMethod: f,
            formAction: d,
            formEncType: i.formEncType,
            formData: void 0,
            json: v,
            text: void 0,
          },
        };
      } catch {
        return s();
      }
    }
  }
  Ce(
    typeof FormData == "function",
    "FormData is not available in this environment",
  );
  let m, p;
  if (i.formData) ((m = Tu(i.formData)), (p = i.formData));
  else if (i.body instanceof FormData) ((m = Tu(i.body)), (p = i.body));
  else if (i.body instanceof URLSearchParams) ((m = i.body), (p = Xf(m)));
  else if (i.body == null) ((m = new URLSearchParams()), (p = new FormData()));
  else
    try {
      ((m = new URLSearchParams(i.body)), (p = Xf(m)));
    } catch {
      return s();
    }
  let y = {
    formMethod: f,
    formAction: d,
    formEncType: (i && i.formEncType) || "application/x-www-form-urlencoded",
    formData: p,
    json: void 0,
    text: void 0,
  };
  if (ht(y.formMethod)) return { path: o, submission: y };
  let S = xr(o);
  return (
    n && S.search && Bu(S.search) && m.append("index", ""),
    (S.search = `?${m}`),
    { path: er(S), submission: y }
  );
}
function Bf(n, o, i, s, c, f, d, m, p, y, S, v, k, M, F, z, _, B, j, K, Y) {
  let J = K ? (Dt(K[1]) ? K[1].error : K[1].data) : void 0,
    Z = c.createURL(f.location),
    he = c.createURL(p),
    L;
  if (S && f.errors) {
    let ye = Object.keys(f.errors)[0];
    L = d.findIndex((Re) => Re.route.id === ye);
  } else if (K && Dt(K[1])) {
    let ye = K[0];
    L = d.findIndex((Re) => Re.route.id === ye) - 1;
  }
  let me = K ? K[1].statusCode : void 0,
    ge = me && me >= 400,
    De = {
      currentUrl: Z,
      currentParams: f.matches[0]?.params || {},
      nextUrl: he,
      nextParams: d[0].params,
      ...m,
      actionResult: J,
      actionStatus: me,
    },
    we = eo(d),
    ze = d.map((ye, Re) => {
      let { route: Pe } = ye,
        Q = null;
      if (L != null && Re > L) Q = !1;
      else if (Pe.lazy) Q = !0;
      else if (!Hu(Pe)) Q = !1;
      else if (S) {
        let { shouldLoad: I } = Cd(Pe, f.loaderData, f.errors);
        Q = I;
      } else $m(f.loaderData, f.matches[Re], ye) && (Q = !0);
      if (Q !== null) return _u(i, s, n, we, ye, y, o, Q);
      let X = !1;
      typeof Y == "boolean"
        ? (X = Y)
        : ge
          ? (X = !1)
          : (v ||
              Z.pathname + Z.search === he.pathname + he.search ||
              Z.search !== he.search ||
              Hm(f.matches[Re], ye)) &&
            (X = !0);
      let G = { ...De, defaultShouldRevalidate: X },
        P = Gl(ye, G);
      return _u(i, s, n, we, ye, y, o, P, G, Y);
    }),
    xe = [];
  return (
    F.forEach((ye, Re) => {
      if (S || !d.some((pe) => pe.route.id === ye.routeId) || M.has(Re)) return;
      let Pe = f.fetchers.get(Re),
        Q = Pe && Pe.state !== "idle" && Pe.data === void 0,
        X = kr(_, ye.path, B);
      if (!X) {
        if (j && Q) return;
        xe.push({
          key: Re,
          routeId: ye.routeId,
          path: ye.path,
          matches: null,
          match: null,
          request: null,
          controller: null,
        });
        return;
      }
      if (z.has(Re)) return;
      let G = Sa(X, ye.path),
        P = new AbortController(),
        I = bn(c, ye.path, P.signal),
        ue = null;
      if (k.has(Re)) (k.delete(Re), (ue = tl(i, s, I, X, G, y, o)));
      else if (Q) v && (ue = tl(i, s, I, X, G, y, o));
      else {
        let pe;
        typeof Y == "boolean" ? (pe = Y) : ge ? (pe = !1) : (pe = v);
        let ke = { ...De, defaultShouldRevalidate: pe };
        Gl(G, ke) && (ue = tl(i, s, I, X, G, y, o, ke));
      }
      ue &&
        xe.push({
          key: Re,
          routeId: ye.routeId,
          path: ye.path,
          matches: ue,
          match: G,
          request: I,
          controller: P,
        });
    }),
    { dsMatches: ze, revalidatingFetchers: xe }
  );
}
function Hu(n) {
  return n.loader != null || (n.middleware != null && n.middleware.length > 0);
}
function Cd(n, o, i) {
  if (n.lazy) return { shouldLoad: !0, renderFallback: !0 };
  if (!Hu(n)) return { shouldLoad: !1, renderFallback: !1 };
  let s = o != null && n.id in o,
    c = i != null && i[n.id] !== void 0;
  if (!s && c) return { shouldLoad: !1, renderFallback: !1 };
  if (typeof n.loader == "function" && n.loader.hydrate === !0)
    return { shouldLoad: !0, renderFallback: !s };
  let f = !s && !c;
  return { shouldLoad: f, renderFallback: f };
}
function $m(n, o, i) {
  let s = !o || i.route.id !== o.route.id,
    c = !n.hasOwnProperty(i.route.id);
  return s || c;
}
function Hm(n, o) {
  let i = n.route.path;
  return (
    n.pathname !== o.pathname ||
    (i != null && i.endsWith("*") && n.params["*"] !== o.params["*"])
  );
}
function Gl(n, o) {
  if (n.route.shouldRevalidate) {
    let i = n.route.shouldRevalidate(o);
    if (typeof i == "boolean") return i;
  }
  return o.defaultShouldRevalidate;
}
function Wf(n, o, i, s, c, f) {
  let d;
  if (n) {
    let y = s[n];
    (Ce(y, `No route found to patch children into: routeId = ${n}`),
      y.children || (y.children = []),
      (d = y.children));
  } else d = i;
  let m = [],
    p = [];
  if (
    (o.forEach((y) => {
      let S = d.find((v) => Pd(y, v));
      S ? p.push({ existingRoute: S, newRoute: y }) : m.push(y);
    }),
    m.length > 0)
  ) {
    let y = ql(m, c, [n || "_", "patch", String(d?.length || "0")], s);
    d.push(...y);
  }
  if (f && p.length > 0)
    for (let y = 0; y < p.length; y++) {
      let { existingRoute: S, newRoute: v } = p[y],
        k = S,
        [M] = ql([v], c, [], {}, !0);
      Object.assign(k, {
        element: M.element ? M.element : k.element,
        errorElement: M.errorElement ? M.errorElement : k.errorElement,
        hydrateFallbackElement: M.hydrateFallbackElement
          ? M.hydrateFallbackElement
          : k.hydrateFallbackElement,
      });
    }
}
function Pd(n, o) {
  return "id" in n && "id" in o && n.id === o.id
    ? !0
    : n.index === o.index &&
        n.path === o.path &&
        n.caseSensitive === o.caseSensitive
      ? (!n.children || n.children.length === 0) &&
        (!o.children || o.children.length === 0)
        ? !0
        : (n.children?.every((i, s) => o.children?.some((c) => Pd(i, c))) ?? !1)
      : !1;
}
var Vf = new WeakMap(),
  Ld = ({ key: n, route: o, manifest: i, mapRouteProperties: s }) => {
    let c = i[o.id];
    if (
      (Ce(c, "No route found in manifest"),
      !c.lazy || typeof c.lazy != "object")
    )
      return;
    let f = c.lazy[n];
    if (!f) return;
    let d = Vf.get(c);
    d || ((d = {}), Vf.set(c, d));
    let m = d[n];
    if (m) return m;
    let p = (async () => {
      let y = lm(n),
        v = c[n] !== void 0 && n !== "hasErrorBoundary";
      if (y)
        (Je(
          !y,
          "Route property " +
            n +
            " is not a supported lazy route property. This property will be ignored.",
        ),
          (d[n] = Promise.resolve()));
      else if (v)
        Je(
          !1,
          `Route "${c.id}" has a static property "${n}" defined. The lazy property will be ignored.`,
        );
      else {
        let k = await f();
        k != null && (Object.assign(c, { [n]: k }), Object.assign(c, s(c)));
      }
      typeof c.lazy == "object" &&
        ((c.lazy[n] = void 0),
        Object.values(c.lazy).every((k) => k === void 0) && (c.lazy = void 0));
    })();
    return ((d[n] = p), p);
  },
  Qf = new WeakMap();
function Bm(n, o, i, s, c) {
  let f = i[n.id];
  if ((Ce(f, "No route found in manifest"), !n.lazy))
    return { lazyRoutePromise: void 0, lazyHandlerPromise: void 0 };
  if (typeof n.lazy == "function") {
    let S = Qf.get(f);
    if (S) return { lazyRoutePromise: S, lazyHandlerPromise: S };
    let v = (async () => {
      Ce(typeof n.lazy == "function", "No lazy route function found");
      let k = await n.lazy(),
        M = {};
      for (let F in k) {
        let z = k[F];
        if (z === void 0) continue;
        let _ = am(F),
          j = f[F] !== void 0 && F !== "hasErrorBoundary";
        _
          ? Je(
              !_,
              "Route property " +
                F +
                " is not a supported property to be returned from a lazy route function. This property will be ignored.",
            )
          : j
            ? Je(
                !j,
                `Route "${f.id}" has a static property "${F}" defined but its lazy function is also returning a value for this property. The lazy route property "${F}" will be ignored.`,
              )
            : (M[F] = z);
      }
      (Object.assign(f, M), Object.assign(f, { ...s(f), lazy: void 0 }));
    })();
    return (
      Qf.set(f, v),
      v.catch(() => {}),
      { lazyRoutePromise: v, lazyHandlerPromise: v }
    );
  }
  let d = Object.keys(n.lazy),
    m = [],
    p;
  for (let S of d) {
    if (c && c.includes(S)) continue;
    let v = Ld({ key: S, route: n, manifest: i, mapRouteProperties: s });
    v && (m.push(v), S === o && (p = v));
  }
  let y = m.length > 0 ? Promise.all(m).then(() => {}) : void 0;
  return (
    y?.catch(() => {}),
    p?.catch(() => {}),
    { lazyRoutePromise: y, lazyHandlerPromise: p }
  );
}
async function Yf(n) {
  let o = n.matches.filter((c) => c.shouldLoad),
    i = {};
  return (
    (await Promise.all(o.map((c) => c.resolve()))).forEach((c, f) => {
      i[o[f].route.id] = c;
    }),
    i
  );
}
async function Wm(n) {
  return n.matches.some((o) => o.route.middleware) ? _d(n, () => Yf(n)) : Yf(n);
}
function _d(n, o) {
  return Vm(
    n,
    o,
    (s) => {
      if (ny(s)) throw s;
      return s;
    },
    bm,
    i,
  );
  function i(s, c, f) {
    if (f)
      return Promise.resolve(
        Object.assign(f.value, { [c]: { type: "error", result: s } }),
      );
    {
      let { matches: d } = n,
        m = Math.min(
          Math.max(
            d.findIndex((y) => y.route.id === c),
            0,
          ),
          Math.max(
            d.findIndex((y) => y.shouldCallHandler()),
            0,
          ),
        ),
        p = en(d, d[m].route.id).route.id;
      return Promise.resolve({ [p]: { type: "error", result: s } });
    }
  }
}
async function Vm(n, o, i, s, c) {
  let {
      matches: f,
      request: d,
      params: m,
      context: p,
      unstable_pattern: y,
    } = n,
    S = f.flatMap((k) =>
      k.route.middleware ? k.route.middleware.map((M) => [k.route.id, M]) : [],
    );
  return await Td(
    { request: d, params: m, context: p, unstable_pattern: y },
    S,
    o,
    i,
    s,
    c,
  );
}
async function Td(n, o, i, s, c, f, d = 0) {
  let { request: m } = n;
  if (m.signal.aborted)
    throw m.signal.reason ?? new Error(`Request aborted: ${m.method} ${m.url}`);
  let p = o[d];
  if (!p) return await i();
  let [y, S] = p,
    v,
    k = async () => {
      if (v) throw new Error("You may only call `next()` once per middleware");
      try {
        return ((v = { value: await Td(n, o, i, s, c, f, d + 1) }), v.value);
      } catch (M) {
        return ((v = { value: await f(M, y, v) }), v.value);
      }
    };
  try {
    let M = await S(n, k),
      F = M != null ? s(M) : void 0;
    return c(F)
      ? F
      : v
        ? (F ?? v.value)
        : ((v = { value: await k() }), v.value);
  } catch (M) {
    return await f(M, y, v);
  }
}
function Md(n, o, i, s, c) {
  let f = Ld({
      key: "middleware",
      route: s.route,
      manifest: o,
      mapRouteProperties: n,
    }),
    d = Bm(s.route, ht(i.method) ? "action" : "loader", o, n, c);
  return {
    middleware: f,
    route: d.lazyRoutePromise,
    handler: d.lazyHandlerPromise,
  };
}
function _u(n, o, i, s, c, f, d, m, p = null, y) {
  let S = !1,
    v = Md(n, o, i, c, f);
  return {
    ...c,
    _lazyPromises: v,
    shouldLoad: m,
    shouldRevalidateArgs: p,
    shouldCallHandler(k) {
      return (
        (S = !0),
        p
          ? typeof y == "boolean"
            ? Gl(c, { ...p, defaultShouldRevalidate: y })
            : typeof k == "boolean"
              ? Gl(c, { ...p, defaultShouldRevalidate: k })
              : Gl(c, p)
          : m
      );
    },
    resolve(k) {
      let { lazy: M, loader: F, middleware: z } = c.route,
        _ = S || m || (k && !ht(i.method) && (M || F)),
        B = z && z.length > 0 && !F && !M;
      return _ && (ht(i.method) || !B)
        ? Ym({
            request: i,
            unstable_pattern: s,
            match: c,
            lazyHandlerPromise: v?.handler,
            lazyRoutePromise: v?.route,
            handlerOverride: k,
            scopedContext: d,
          })
        : Promise.resolve({ type: "data", result: void 0 });
    },
  };
}
function tl(n, o, i, s, c, f, d, m = null) {
  return s.map((p) =>
    p.route.id !== c.route.id
      ? {
          ...p,
          shouldLoad: !1,
          shouldRevalidateArgs: m,
          shouldCallHandler: () => !1,
          _lazyPromises: Md(n, o, i, p, f),
          resolve: () => Promise.resolve({ type: "data", result: void 0 }),
        }
      : _u(n, o, i, eo(s), p, f, d, !0, m),
  );
}
async function Qm(n, o, i, s, c, f) {
  i.some((y) => y._lazyPromises?.middleware) &&
    (await Promise.all(i.map((y) => y._lazyPromises?.middleware)));
  let d = {
      request: o,
      unstable_pattern: eo(i),
      params: i[0].params,
      context: c,
      matches: i,
    },
    p = await n({
      ...d,
      fetcherKey: s,
      runClientMiddleware: (y) => {
        let S = d;
        return _d(S, () =>
          y({
            ...S,
            fetcherKey: s,
            runClientMiddleware: () => {
              throw new Error(
                "Cannot call `runClientMiddleware()` from within an `runClientMiddleware` handler",
              );
            },
          }),
        );
      },
    });
  try {
    await Promise.all(
      i.flatMap((y) => [y._lazyPromises?.handler, y._lazyPromises?.route]),
    );
  } catch {}
  return p;
}
async function Ym({
  request: n,
  unstable_pattern: o,
  match: i,
  lazyHandlerPromise: s,
  lazyRoutePromise: c,
  handlerOverride: f,
  scopedContext: d,
}) {
  let m,
    p,
    y = ht(n.method),
    S = y ? "action" : "loader",
    v = (k) => {
      let M,
        F = new Promise((B, j) => (M = j));
      ((p = () => M()), n.signal.addEventListener("abort", p));
      let z = (B) =>
          typeof k != "function"
            ? Promise.reject(
                new Error(
                  `You cannot call the handler for a route which defines a boolean "${S}" [routeId: ${i.route.id}]`,
                ),
              )
            : k(
                {
                  request: n,
                  unstable_pattern: o,
                  params: i.params,
                  context: d,
                },
                ...(B !== void 0 ? [B] : []),
              ),
        _ = (async () => {
          try {
            return { type: "data", result: await (f ? f((j) => z(j)) : z()) };
          } catch (B) {
            return { type: "error", result: B };
          }
        })();
      return Promise.race([_, F]);
    };
  try {
    let k = y ? i.route.action : i.route.loader;
    if (s || c)
      if (k) {
        let M,
          [F] = await Promise.all([
            v(k).catch((z) => {
              M = z;
            }),
            s,
            c,
          ]);
        if (M !== void 0) throw M;
        m = F;
      } else {
        await s;
        let M = y ? i.route.action : i.route.loader;
        if (M) [m] = await Promise.all([v(M), c]);
        else if (S === "action") {
          let F = new URL(n.url),
            z = F.pathname + F.search;
          throw Bt(405, { method: n.method, pathname: z, routeId: i.route.id });
        } else return { type: "data", result: void 0 };
      }
    else if (k) m = await v(k);
    else {
      let M = new URL(n.url),
        F = M.pathname + M.search;
      throw Bt(404, { pathname: F });
    }
  } catch (k) {
    return { type: "error", result: k };
  } finally {
    p && n.signal.removeEventListener("abort", p);
  }
  return m;
}
async function Km(n) {
  let o = n.headers.get("Content-Type");
  return o && /\bapplication\/json\b/.test(o)
    ? n.body == null
      ? null
      : n.json()
    : n.text();
}
async function Xm(n) {
  let { result: o, type: i } = n;
  if (_a(o)) {
    let s;
    try {
      s = await Km(o);
    } catch (c) {
      return { type: "error", error: c };
    }
    return i === "error"
      ? {
          type: "error",
          error: new rn(o.status, o.statusText, s),
          statusCode: o.status,
          headers: o.headers,
        }
      : { type: "data", data: s, statusCode: o.status, headers: o.headers };
  }
  return i === "error"
    ? Mu(o)
      ? o.data instanceof Error
        ? {
            type: "error",
            error: o.data,
            statusCode: o.init?.status,
            headers: o.init?.headers ? new Headers(o.init.headers) : void 0,
          }
        : {
            type: "error",
            error: qm(o),
            statusCode: wn(o) ? o.status : void 0,
            headers: o.init?.headers ? new Headers(o.init.headers) : void 0,
          }
      : { type: "error", error: o, statusCode: wn(o) ? o.status : void 0 }
    : Mu(o)
      ? {
          type: "data",
          data: o.data,
          statusCode: o.init?.status,
          headers: o.init?.headers ? new Headers(o.init.headers) : void 0,
        }
      : { type: "data", data: o };
}
function Jm(n, o, i, s, c) {
  let f = n.headers.get("Location");
  if (
    (Ce(
      f,
      "Redirects returned/thrown from loaders/actions must have a Location header",
    ),
    !Au(f))
  ) {
    let d = s.slice(0, s.findIndex((m) => m.route.id === i) + 1);
    ((f = Lu(new URL(o.url), d, c, f)), n.headers.set("Location", f));
  }
  return n;
}
function Kf(n, o, i, s) {
  let c = [
    "about:",
    "blob:",
    "chrome:",
    "chrome-untrusted:",
    "content:",
    "data:",
    "devtools:",
    "file:",
    "filesystem:",
    "javascript:",
  ];
  if (Au(n)) {
    let f = n,
      d = f.startsWith("//") ? new URL(o.protocol + f) : new URL(f);
    if (c.includes(d.protocol)) throw new Error("Invalid redirect location");
    let m = Ot(d.pathname, i) != null;
    if (d.origin === o.origin && m) return d.pathname + d.search + d.hash;
  }
  try {
    let f = s.createURL(n);
    if (c.includes(f.protocol)) throw new Error("Invalid redirect location");
  } catch {}
  return n;
}
function bn(n, o, i, s) {
  let c = n.createURL(Nd(o)).toString(),
    f = { signal: i };
  if (s && ht(s.formMethod)) {
    let { formMethod: d, formEncType: m } = s;
    ((f.method = d.toUpperCase()),
      m === "application/json"
        ? ((f.headers = new Headers({ "Content-Type": m })),
          (f.body = JSON.stringify(s.json)))
        : m === "text/plain"
          ? (f.body = s.text)
          : m === "application/x-www-form-urlencoded" && s.formData
            ? (f.body = Tu(s.formData))
            : (f.body = s.formData));
  }
  return new Request(c, f);
}
function Tu(n) {
  let o = new URLSearchParams();
  for (let [i, s] of n.entries())
    o.append(i, typeof s == "string" ? s : s.name);
  return o;
}
function Xf(n) {
  let o = new FormData();
  for (let [i, s] of n.entries()) o.append(i, s);
  return o;
}
function Gm(n, o, i, s = !1, c = !1) {
  let f = {},
    d = null,
    m,
    p = !1,
    y = {},
    S = i && Dt(i[1]) ? i[1].error : void 0;
  return (
    n.forEach((v) => {
      if (!(v.route.id in o)) return;
      let k = v.route.id,
        M = o[k];
      if (
        (Ce(!gn(M), "Cannot handle redirect results in processLoaderData"),
        Dt(M))
      ) {
        let F = M.error;
        if ((S !== void 0 && ((F = S), (S = void 0)), (d = d || {}), c))
          d[k] = F;
        else {
          let z = en(n, k);
          d[z.route.id] == null && (d[z.route.id] = F);
        }
        (s || (f[k] = xd),
          p || ((p = !0), (m = wn(M.error) ? M.error.status : 500)),
          M.headers && (y[k] = M.headers));
      } else
        ((f[k] = M.data),
          M.statusCode && M.statusCode !== 200 && !p && (m = M.statusCode),
          M.headers && (y[k] = M.headers));
    }),
    S !== void 0 && i && ((d = { [i[0]]: S }), i[2] && (f[i[2]] = void 0)),
    { loaderData: f, errors: d, statusCode: m || 200, loaderHeaders: y }
  );
}
function Jf(n, o, i, s, c, f) {
  let { loaderData: d, errors: m } = Gm(o, i, s);
  return (
    c
      .filter((p) => !p.matches || p.matches.some((y) => y.shouldLoad))
      .forEach((p) => {
        let { key: y, match: S, controller: v } = p;
        if (v && v.signal.aborted) return;
        let k = f[y];
        if ((Ce(k, "Did not find corresponding fetcher result"), Dt(k))) {
          let M = en(n.matches, S?.route.id);
          ((m && m[M.route.id]) || (m = { ...m, [M.route.id]: k.error }),
            n.fetchers.delete(y));
        } else if (gn(k)) Ce(!1, "Unhandled fetcher revalidation redirect");
        else {
          let M = Rr(k.data);
          n.fetchers.set(y, M);
        }
      }),
    { loaderData: d, errors: m }
  );
}
function Gf(n, o, i, s) {
  let c = Object.entries(o)
    .filter(([, f]) => f !== xd)
    .reduce((f, [d, m]) => ((f[d] = m), f), {});
  for (let f of i) {
    let d = f.route.id;
    if (
      (!o.hasOwnProperty(d) &&
        n.hasOwnProperty(d) &&
        f.route.loader &&
        (c[d] = n[d]),
      s && s.hasOwnProperty(d))
    )
      break;
  }
  return c;
}
function Zf(n) {
  return n
    ? Dt(n[1])
      ? { actionData: {} }
      : { actionData: { [n[0]]: n[1].data } }
    : {};
}
function en(n, o) {
  return (
    (o ? n.slice(0, n.findIndex((s) => s.route.id === o) + 1) : [...n])
      .reverse()
      .find((s) => s.route.hasErrorBoundary === !0) || n[0]
  );
}
function pa(n) {
  let o =
    n.length === 1
      ? n[0]
      : n.find((i) => i.index || !i.path || i.path === "/") || {
          id: "__shim-error-route__",
        };
  return {
    matches: [{ params: {}, pathname: "", pathnameBase: "", route: o }],
    route: o,
  };
}
function Bt(
  n,
  { pathname: o, routeId: i, method: s, type: c, message: f } = {},
) {
  let d = "Unknown Server Error",
    m = "Unknown @remix-run/router error";
  return (
    n === 400
      ? ((d = "Bad Request"),
        s && o && i
          ? (m = `You made a ${s} request to "${o}" but did not provide a \`loader\` for route "${i}", so there is no way to handle the request.`)
          : c === "invalid-body" && (m = "Unable to encode submission body"))
      : n === 403
        ? ((d = "Forbidden"), (m = `Route "${i}" does not match URL "${o}"`))
        : n === 404
          ? ((d = "Not Found"), (m = `No route matches URL "${o}"`))
          : n === 405 &&
            ((d = "Method Not Allowed"),
            s && o && i
              ? (m = `You made a ${s.toUpperCase()} request to "${o}" but did not provide an \`action\` for route "${i}", so there is no way to handle the request.`)
              : s && (m = `Invalid request method "${s.toUpperCase()}"`)),
    new rn(n || 500, d, new Error(m), !0)
  );
}
function ma(n) {
  let o = Object.entries(n);
  for (let i = o.length - 1; i >= 0; i--) {
    let [s, c] = o[i];
    if (gn(c)) return { key: s, result: c };
  }
}
function Nd(n) {
  let o = typeof n == "string" ? xr(n) : n;
  return er({ ...o, hash: "" });
}
function Zm(n, o) {
  return n.pathname !== o.pathname || n.search !== o.search
    ? !1
    : n.hash === ""
      ? o.hash !== ""
      : n.hash === o.hash
        ? !0
        : o.hash !== "";
}
function qm(n) {
  return new rn(
    n.init?.status ?? 500,
    n.init?.statusText ?? "Internal Server Error",
    n.data,
  );
}
function bm(n) {
  return (
    n != null &&
    typeof n == "object" &&
    Object.entries(n).every(([o, i]) => typeof o == "string" && ey(i))
  );
}
function ey(n) {
  return (
    n != null &&
    typeof n == "object" &&
    "type" in n &&
    "result" in n &&
    (n.type === "data" || n.type === "error")
  );
}
function ty(n) {
  return _a(n.result) && Rd.has(n.result.status);
}
function Dt(n) {
  return n.type === "error";
}
function gn(n) {
  return (n && n.type) === "redirect";
}
function Mu(n) {
  return (
    typeof n == "object" &&
    n != null &&
    "type" in n &&
    "data" in n &&
    "init" in n &&
    n.type === "DataWithResponseInit"
  );
}
function _a(n) {
  return (
    n != null &&
    typeof n.status == "number" &&
    typeof n.statusText == "string" &&
    typeof n.headers == "object" &&
    typeof n.body < "u"
  );
}
function ry(n) {
  return Rd.has(n);
}
function ny(n) {
  return _a(n) && ry(n.status) && n.headers.has("Location");
}
function ly(n) {
  return Fm.has(n.toUpperCase());
}
function ht(n) {
  return Om.has(n.toUpperCase());
}
function Bu(n) {
  return new URLSearchParams(n).getAll("index").some((o) => o === "");
}
function Sa(n, o) {
  let i = typeof o == "string" ? xr(o).search : o.search;
  if (n[n.length - 1].route.index && Bu(i || "")) return n[n.length - 1];
  let s = vd(n);
  return s[s.length - 1];
}
function qf(n) {
  let {
    formMethod: o,
    formAction: i,
    formEncType: s,
    text: c,
    formData: f,
    json: d,
  } = n;
  if (!(!o || !i || !s)) {
    if (c != null)
      return {
        formMethod: o,
        formAction: i,
        formEncType: s,
        formData: void 0,
        json: void 0,
        text: c,
      };
    if (f != null)
      return {
        formMethod: o,
        formAction: i,
        formEncType: s,
        formData: f,
        json: void 0,
        text: void 0,
      };
    if (d !== void 0)
      return {
        formMethod: o,
        formAction: i,
        formEncType: s,
        formData: void 0,
        json: d,
        text: void 0,
      };
  }
}
function Eu(n, o) {
  return o
    ? {
        state: "loading",
        location: n,
        formMethod: o.formMethod,
        formAction: o.formAction,
        formEncType: o.formEncType,
        formData: o.formData,
        json: o.json,
        text: o.text,
      }
    : {
        state: "loading",
        location: n,
        formMethod: void 0,
        formAction: void 0,
        formEncType: void 0,
        formData: void 0,
        json: void 0,
        text: void 0,
      };
}
function oy(n, o) {
  return {
    state: "submitting",
    location: n,
    formMethod: o.formMethod,
    formAction: o.formAction,
    formEncType: o.formEncType,
    formData: o.formData,
    json: o.json,
    text: o.text,
  };
}
function Yl(n, o) {
  return n
    ? {
        state: "loading",
        formMethod: n.formMethod,
        formAction: n.formAction,
        formEncType: n.formEncType,
        formData: n.formData,
        json: n.json,
        text: n.text,
        data: o,
      }
    : {
        state: "loading",
        formMethod: void 0,
        formAction: void 0,
        formEncType: void 0,
        formData: void 0,
        json: void 0,
        text: void 0,
        data: o,
      };
}
function ay(n, o) {
  return {
    state: "submitting",
    formMethod: n.formMethod,
    formAction: n.formAction,
    formEncType: n.formEncType,
    formData: n.formData,
    json: n.json,
    text: n.text,
    data: o ? o.data : void 0,
  };
}
function Rr(n) {
  return {
    state: "idle",
    formMethod: void 0,
    formAction: void 0,
    formEncType: void 0,
    formData: void 0,
    json: void 0,
    text: void 0,
    data: n,
  };
}
function iy(n, o) {
  try {
    let i = n.sessionStorage.getItem(kd);
    if (i) {
      let s = JSON.parse(i);
      for (let [c, f] of Object.entries(s || {}))
        f && Array.isArray(f) && o.set(c, new Set(f || []));
    }
  } catch {}
}
function uy(n, o) {
  if (o.size > 0) {
    let i = {};
    for (let [s, c] of o) i[s] = [...c];
    try {
      n.sessionStorage.setItem(kd, JSON.stringify(i));
    } catch (s) {
      Je(
        !1,
        `Failed to save applied view transitions in sessionStorage (${s}).`,
      );
    }
  }
}
function bf() {
  let n,
    o,
    i = new Promise((s, c) => {
      ((n = async (f) => {
        s(f);
        try {
          await i;
        } catch {}
      }),
        (o = async (f) => {
          c(f);
          try {
            await i;
          } catch {}
        }));
    });
  return { promise: i, resolve: n, reject: o };
}
var Sn = R.createContext(null);
Sn.displayName = "DataRouter";
var rl = R.createContext(null);
rl.displayName = "DataRouterState";
var Dd = R.createContext(!1);
function Od() {
  return R.useContext(Dd);
}
var Wu = R.createContext({ isTransitioning: !1 });
Wu.displayName = "ViewTransition";
var zd = R.createContext(new Map());
zd.displayName = "Fetchers";
var sy = R.createContext(null);
sy.displayName = "Await";
var Lt = R.createContext(null);
Lt.displayName = "Navigation";
var Ta = R.createContext(null);
Ta.displayName = "Location";
var tr = R.createContext({ outlet: null, matches: [], isDataRoute: !1 });
tr.displayName = "Route";
var Vu = R.createContext(null);
Vu.displayName = "RouteError";
var Fd = "REACT_ROUTER_ERROR",
  cy = "REDIRECT",
  fy = "ROUTE_ERROR_RESPONSE";
function dy(n) {
  if (n.startsWith(`${Fd}:${cy}:{`))
    try {
      let o = JSON.parse(n.slice(28));
      if (
        typeof o == "object" &&
        o &&
        typeof o.status == "number" &&
        typeof o.statusText == "string" &&
        typeof o.location == "string" &&
        typeof o.reloadDocument == "boolean" &&
        typeof o.replace == "boolean"
      )
        return o;
    } catch {}
}
function hy(n) {
  if (n.startsWith(`${Fd}:${fy}:{`))
    try {
      let o = JSON.parse(n.slice(40));
      if (
        typeof o == "object" &&
        o &&
        typeof o.status == "number" &&
        typeof o.statusText == "string"
      )
        return new rn(o.status, o.statusText, o.data);
    } catch {}
}
function py(n, { relative: o } = {}) {
  Ce(
    to(),
    "useHref() may be used only in the context of a <Router> component.",
  );
  let { basename: i, navigator: s } = R.useContext(Lt),
    { hash: c, pathname: f, search: d } = ro(n, { relative: o }),
    m = f;
  return (
    i !== "/" && (m = f === "/" ? i : bt([i, f])),
    s.createHref({ pathname: m, search: d, hash: c })
  );
}
function to() {
  return R.useContext(Ta) != null;
}
function rr() {
  return (
    Ce(
      to(),
      "useLocation() may be used only in the context of a <Router> component.",
    ),
    R.useContext(Ta).location
  );
}
var Id =
  "You should call navigate() in a React.useEffect(), not when your component is first rendered.";
function jd(n) {
  R.useContext(Lt).static || R.useLayoutEffect(n);
}
function my() {
  let { isDataRoute: n } = R.useContext(tr);
  return n ? Ty() : yy();
}
function yy() {
  Ce(
    to(),
    "useNavigate() may be used only in the context of a <Router> component.",
  );
  let n = R.useContext(Sn),
    { basename: o, navigator: i } = R.useContext(Lt),
    { matches: s } = R.useContext(tr),
    { pathname: c } = rr(),
    f = JSON.stringify($u(s)),
    d = R.useRef(!1);
  return (
    jd(() => {
      d.current = !0;
    }),
    R.useCallback(
      (p, y = {}) => {
        if ((Je(d.current, Id), !d.current)) return;
        if (typeof p == "number") {
          i.go(p);
          return;
        }
        let S = La(p, JSON.parse(f), c, y.relative === "path");
        (n == null &&
          o !== "/" &&
          (S.pathname = S.pathname === "/" ? o : bt([o, S.pathname])),
          (y.replace ? i.replace : i.push)(S, y.state, y));
      },
      [o, i, f, c, n],
    )
  );
}
var vy = R.createContext(null);
function gy(n) {
  let o = R.useContext(tr).outlet;
  return R.useMemo(
    () => o && R.createElement(vy.Provider, { value: n }, o),
    [o, n],
  );
}
function Ud() {
  let { matches: n } = R.useContext(tr),
    o = n[n.length - 1];
  return o ? o.params : {};
}
function ro(n, { relative: o } = {}) {
  let { matches: i } = R.useContext(tr),
    { pathname: s } = rr(),
    c = JSON.stringify($u(i));
  return R.useMemo(() => La(n, JSON.parse(c), s, o === "path"), [n, c, s, o]);
}
function wy(n, o, i) {
  Ce(
    to(),
    "useRoutes() may be used only in the context of a <Router> component.",
  );
  let { navigator: s } = R.useContext(Lt),
    { matches: c } = R.useContext(tr),
    f = c[c.length - 1],
    d = f ? f.params : {},
    m = f ? f.pathname : "/",
    p = f ? f.pathnameBase : "/",
    y = f && f.route;
  {
    let _ = (y && y.path) || "";
    Wd(
      m,
      !y || _.endsWith("*") || _.endsWith("*?"),
      `You rendered descendant <Routes> (or called \`useRoutes()\`) at "${m}" (under <Route path="${_}">) but the parent route path has no trailing "*". This means if you navigate deeper, the parent won't match anymore and therefore the child routes will never render.

Please change the parent <Route path="${_}"> to <Route path="${_ === "/" ? "*" : `${_}/*`}">.`,
    );
  }
  let S = rr(),
    v;
  v = S;
  let k = v.pathname || "/",
    M = k;
  if (p !== "/") {
    let _ = p.replace(/^\//, "").split("/");
    M = "/" + k.replace(/^\//, "").split("/").slice(_.length).join("/");
  }
  let F = kr(n, { pathname: M });
  return (
    Je(
      y || F != null,
      `No routes matched location "${v.pathname}${v.search}${v.hash}" `,
    ),
    Je(
      F == null ||
        F[F.length - 1].route.element !== void 0 ||
        F[F.length - 1].route.Component !== void 0 ||
        F[F.length - 1].route.lazy !== void 0,
      `Matched leaf route at location "${v.pathname}${v.search}${v.hash}" does not have an element or Component. This means it will render an <Outlet /> with a null value by default resulting in an "empty" page.`,
    ),
    xy(
      F &&
        F.map((_) =>
          Object.assign({}, _, {
            params: Object.assign({}, d, _.params),
            pathname: bt([
              p,
              s.encodeLocation
                ? s.encodeLocation(
                    _.pathname.replace(/\?/g, "%3F").replace(/#/g, "%23"),
                  ).pathname
                : _.pathname,
            ]),
            pathnameBase:
              _.pathnameBase === "/"
                ? p
                : bt([
                    p,
                    s.encodeLocation
                      ? s.encodeLocation(
                          _.pathnameBase
                            .replace(/\?/g, "%3F")
                            .replace(/#/g, "%23"),
                        ).pathname
                      : _.pathnameBase,
                  ]),
          }),
        ),
      c,
      i,
    )
  );
}
function Sy() {
  let n = Bd(),
    o = wn(n)
      ? `${n.status} ${n.statusText}`
      : n instanceof Error
        ? n.message
        : JSON.stringify(n),
    i = n instanceof Error ? n.stack : null,
    s = "rgba(200,200,200, 0.5)",
    c = { padding: "0.5rem", backgroundColor: s },
    f = { padding: "2px 4px", backgroundColor: s },
    d = null;
  return (
    console.error("Error handled by React Router default ErrorBoundary:", n),
    (d = R.createElement(
      R.Fragment,
      null,
      R.createElement("p", null, "💿 Hey developer 👋"),
      R.createElement(
        "p",
        null,
        "You can provide a way better UX than this when your app throws errors by providing your own ",
        R.createElement("code", { style: f }, "ErrorBoundary"),
        " or",
        " ",
        R.createElement("code", { style: f }, "errorElement"),
        " prop on your route.",
      ),
    )),
    R.createElement(
      R.Fragment,
      null,
      R.createElement("h2", null, "Unexpected Application Error!"),
      R.createElement("h3", { style: { fontStyle: "italic" } }, o),
      i ? R.createElement("pre", { style: c }, i) : null,
      d,
    )
  );
}
var Ey = R.createElement(Sy, null),
  Ad = class extends R.Component {
    constructor(n) {
      (super(n),
        (this.state = {
          location: n.location,
          revalidation: n.revalidation,
          error: n.error,
        }));
    }
    static getDerivedStateFromError(n) {
      return { error: n };
    }
    static getDerivedStateFromProps(n, o) {
      return o.location !== n.location ||
        (o.revalidation !== "idle" && n.revalidation === "idle")
        ? { error: n.error, location: n.location, revalidation: n.revalidation }
        : {
            error: n.error !== void 0 ? n.error : o.error,
            location: o.location,
            revalidation: n.revalidation || o.revalidation,
          };
    }
    componentDidCatch(n, o) {
      this.props.onError
        ? this.props.onError(n, o)
        : console.error(
            "React Router caught the following error during render",
            n,
          );
    }
    render() {
      let n = this.state.error;
      if (
        this.context &&
        typeof n == "object" &&
        n &&
        "digest" in n &&
        typeof n.digest == "string"
      ) {
        const i = hy(n.digest);
        i && (n = i);
      }
      let o =
        n !== void 0
          ? R.createElement(
              tr.Provider,
              { value: this.props.routeContext },
              R.createElement(Vu.Provider, {
                value: n,
                children: this.props.component,
              }),
            )
          : this.props.children;
      return this.context ? R.createElement(Ry, { error: n }, o) : o;
    }
  };
Ad.contextType = Dd;
var Ru = new WeakMap();
function Ry({ children: n, error: o }) {
  let { basename: i } = R.useContext(Lt);
  if (
    typeof o == "object" &&
    o &&
    "digest" in o &&
    typeof o.digest == "string"
  ) {
    let s = dy(o.digest);
    if (s) {
      let c = Ru.get(o);
      if (c) throw c;
      let f = wd(s.location, i);
      if (gd && !Ru.get(o))
        if (f.isExternal || s.reloadDocument)
          window.location.href = f.absoluteURL || f.to;
        else {
          const d = Promise.resolve().then(() =>
            window.__reactRouterDataRouter.navigate(f.to, {
              replace: s.replace,
            }),
          );
          throw (Ru.set(o, d), d);
        }
      return R.createElement("meta", {
        httpEquiv: "refresh",
        content: `0;url=${f.absoluteURL || f.to}`,
      });
    }
  }
  return n;
}
function ky({ routeContext: n, match: o, children: i }) {
  let s = R.useContext(Sn);
  return (
    s &&
      s.static &&
      s.staticContext &&
      (o.route.errorElement || o.route.ErrorBoundary) &&
      (s.staticContext._deepestRenderedBoundaryId = o.route.id),
    R.createElement(tr.Provider, { value: n }, i)
  );
}
function xy(n, o = [], i) {
  let s = i?.state;
  if (n == null) {
    if (!s) return null;
    if (s.errors) n = s.matches;
    else if (o.length === 0 && !s.initialized && s.matches.length > 0)
      n = s.matches;
    else return null;
  }
  let c = n,
    f = s?.errors;
  if (f != null) {
    let S = c.findIndex((v) => v.route.id && f?.[v.route.id] !== void 0);
    (Ce(
      S >= 0,
      `Could not find a matching route for errors on route IDs: ${Object.keys(f).join(",")}`,
    ),
      (c = c.slice(0, Math.min(c.length, S + 1))));
  }
  let d = !1,
    m = -1;
  if (i && s) {
    d = s.renderFallback;
    for (let S = 0; S < c.length; S++) {
      let v = c[S];
      if (
        ((v.route.HydrateFallback || v.route.hydrateFallbackElement) && (m = S),
        v.route.id)
      ) {
        let { loaderData: k, errors: M } = s,
          F =
            v.route.loader &&
            !k.hasOwnProperty(v.route.id) &&
            (!M || M[v.route.id] === void 0);
        if (v.route.lazy || F) {
          (i.isStatic && (d = !0),
            m >= 0 ? (c = c.slice(0, m + 1)) : (c = [c[0]]));
          break;
        }
      }
    }
  }
  let p = i?.onError,
    y =
      s && p
        ? (S, v) => {
            p(S, {
              location: s.location,
              params: s.matches?.[0]?.params ?? {},
              unstable_pattern: eo(s.matches),
              errorInfo: v,
            });
          }
        : void 0;
  return c.reduceRight((S, v, k) => {
    let M,
      F = !1,
      z = null,
      _ = null;
    s &&
      ((M = f && v.route.id ? f[v.route.id] : void 0),
      (z = v.route.errorElement || Ey),
      d &&
        (m < 0 && k === 0
          ? (Wd(
              "route-fallback",
              !1,
              "No `HydrateFallback` element provided to render during initial hydration",
            ),
            (F = !0),
            (_ = null))
          : m === k &&
            ((F = !0), (_ = v.route.hydrateFallbackElement || null))));
    let B = o.concat(c.slice(0, k + 1)),
      j = () => {
        let K;
        return (
          M
            ? (K = z)
            : F
              ? (K = _)
              : v.route.Component
                ? (K = R.createElement(v.route.Component, null))
                : v.route.element
                  ? (K = v.route.element)
                  : (K = S),
          R.createElement(ky, {
            match: v,
            routeContext: { outlet: S, matches: B, isDataRoute: s != null },
            children: K,
          })
        );
      };
    return s && (v.route.ErrorBoundary || v.route.errorElement || k === 0)
      ? R.createElement(Ad, {
          location: s.location,
          revalidation: s.revalidation,
          component: z,
          error: M,
          children: j(),
          routeContext: { outlet: null, matches: B, isDataRoute: !0 },
          onError: y,
        })
      : j();
  }, null);
}
function Qu(n) {
  return `${n} must be used within a data router.  See https://reactrouter.com/en/main/routers/picking-a-router.`;
}
function Cy(n) {
  let o = R.useContext(Sn);
  return (Ce(o, Qu(n)), o);
}
function no(n) {
  let o = R.useContext(rl);
  return (Ce(o, Qu(n)), o);
}
function Py(n) {
  let o = R.useContext(tr);
  return (Ce(o, Qu(n)), o);
}
function lo(n) {
  let o = Py(n),
    i = o.matches[o.matches.length - 1];
  return (
    Ce(
      i.route.id,
      `${n} can only be used on routes that contain a unique "id"`,
    ),
    i.route.id
  );
}
function Ly() {
  return lo("useRouteId");
}
function _y() {
  return no("useNavigation").navigation;
}
function Yu() {
  let { matches: n, loaderData: o } = no("useMatches");
  return R.useMemo(() => n.map((i) => dd(i, o)), [n, o]);
}
function $d() {
  let n = no("useLoaderData"),
    o = lo("useLoaderData");
  return n.loaderData[o];
}
function Hd() {
  let n = no("useActionData"),
    o = lo("useLoaderData");
  return n.actionData ? n.actionData[o] : void 0;
}
function Bd() {
  let n = R.useContext(Vu),
    o = no("useRouteError"),
    i = lo("useRouteError");
  return n !== void 0 ? n : o.errors?.[i];
}
function Ty() {
  let { router: n } = Cy("useNavigate"),
    o = lo("useNavigate"),
    i = R.useRef(!1);
  return (
    jd(() => {
      i.current = !0;
    }),
    R.useCallback(
      async (c, f = {}) => {
        (Je(i.current, Id),
          i.current &&
            (typeof c == "number"
              ? await n.navigate(c)
              : await n.navigate(c, { fromRouteId: o, ...f })));
      },
      [n, o],
    )
  );
}
var ed = {};
function Wd(n, o, i) {
  !o && !ed[n] && ((ed[n] = !0), Je(!1, i));
}
var td = {};
function Nu(n, o) {
  !n && !td[o] && ((td[o] = !0), console.warn(o));
}
var My = "useOptimistic",
  rd = qp[My],
  Ny = () => {};
function Dy(n) {
  return rd ? rd(n) : [n, Ny];
}
function yg(n) {
  let o = {
    hasErrorBoundary:
      n.hasErrorBoundary || n.ErrorBoundary != null || n.errorElement != null,
  };
  return (
    n.Component &&
      (n.element &&
        Je(
          !1,
          "You should not include both `Component` and `element` on your route - `Component` will be used.",
        ),
      Object.assign(o, {
        element: R.createElement(n.Component),
        Component: void 0,
      })),
    n.HydrateFallback &&
      (n.hydrateFallbackElement &&
        Je(
          !1,
          "You should not include both `HydrateFallback` and `hydrateFallbackElement` on your route - `HydrateFallback` will be used.",
        ),
      Object.assign(o, {
        hydrateFallbackElement: R.createElement(n.HydrateFallback),
        HydrateFallback: void 0,
      })),
    n.ErrorBoundary &&
      (n.errorElement &&
        Je(
          !1,
          "You should not include both `ErrorBoundary` and `errorElement` on your route - `ErrorBoundary` will be used.",
        ),
      Object.assign(o, {
        errorElement: R.createElement(n.ErrorBoundary),
        ErrorBoundary: void 0,
      })),
    o
  );
}
var vg = ["HydrateFallback", "hydrateFallbackElement"],
  Oy = class {
    constructor() {
      ((this.status = "pending"),
        (this.promise = new Promise((n, o) => {
          ((this.resolve = (i) => {
            this.status === "pending" && ((this.status = "resolved"), n(i));
          }),
            (this.reject = (i) => {
              this.status === "pending" && ((this.status = "rejected"), o(i));
            }));
        })));
    }
  };
function gg({
  router: n,
  flushSync: o,
  onError: i,
  unstable_useTransitions: s,
}) {
  s = Od() || s;
  let [f, d] = R.useState(n.state),
    [m, p] = Dy(f),
    [y, S] = R.useState(),
    [v, k] = R.useState({ isTransitioning: !1 }),
    [M, F] = R.useState(),
    [z, _] = R.useState(),
    [B, j] = R.useState(),
    K = R.useRef(new Map()),
    Y = R.useCallback(
      (
        L,
        {
          deletedFetchers: me,
          newErrors: ge,
          flushSync: De,
          viewTransitionOpts: we,
        },
      ) => {
        (ge &&
          i &&
          Object.values(ge).forEach((xe) =>
            i(xe, {
              location: L.location,
              params: L.matches[0]?.params ?? {},
              unstable_pattern: eo(L.matches),
            }),
          ),
          L.fetchers.forEach((xe, ye) => {
            xe.data !== void 0 && K.current.set(ye, xe.data);
          }),
          me.forEach((xe) => K.current.delete(xe)),
          Nu(
            De === !1 || o != null,
            'You provided the `flushSync` option to a router update, but you are not using the `<RouterProvider>` from `react-router/dom` so `ReactDOM.flushSync()` is unavailable.  Please update your app to `import { RouterProvider } from "react-router/dom"` and ensure you have `react-dom` installed as a dependency to use the `flushSync` option.',
          ));
        let ze =
          n.window != null &&
          n.window.document != null &&
          typeof n.window.document.startViewTransition == "function";
        if (
          (Nu(
            we == null || ze,
            "You provided the `viewTransition` option to a router update, but you do not appear to be running in a DOM environment as `window.startViewTransition` is not available.",
          ),
          !we || !ze)
        ) {
          o && De
            ? o(() => d(L))
            : s === !1
              ? d(L)
              : R.startTransition(() => {
                  (s === !0 && p((xe) => nd(xe, L)), d(L));
                });
          return;
        }
        if (o && De) {
          o(() => {
            (z && (M?.resolve(), z.skipTransition()),
              k({
                isTransitioning: !0,
                flushSync: !0,
                currentLocation: we.currentLocation,
                nextLocation: we.nextLocation,
              }));
          });
          let xe = n.window.document.startViewTransition(() => {
            o(() => d(L));
          });
          (xe.finished.finally(() => {
            o(() => {
              (F(void 0), _(void 0), S(void 0), k({ isTransitioning: !1 }));
            });
          }),
            o(() => _(xe)));
          return;
        }
        z
          ? (M?.resolve(),
            z.skipTransition(),
            j({
              state: L,
              currentLocation: we.currentLocation,
              nextLocation: we.nextLocation,
            }))
          : (S(L),
            k({
              isTransitioning: !0,
              flushSync: !1,
              currentLocation: we.currentLocation,
              nextLocation: we.nextLocation,
            }));
      },
      [n.window, o, z, M, s, p, i],
    );
  (R.useLayoutEffect(() => n.subscribe(Y), [n, Y]),
    R.useEffect(() => {
      v.isTransitioning && !v.flushSync && F(new Oy());
    }, [v]),
    R.useEffect(() => {
      if (M && y && n.window) {
        let L = y,
          me = M.promise,
          ge = n.window.document.startViewTransition(async () => {
            (s === !1
              ? d(L)
              : R.startTransition(() => {
                  (s === !0 && p((De) => nd(De, L)), d(L));
                }),
              await me);
          });
        (ge.finished.finally(() => {
          (F(void 0), _(void 0), S(void 0), k({ isTransitioning: !1 }));
        }),
          _(ge));
      }
    }, [y, M, n.window, s, p]),
    R.useEffect(() => {
      M && y && m.location.key === y.location.key && M.resolve();
    }, [M, z, m.location, y]),
    R.useEffect(() => {
      !v.isTransitioning &&
        B &&
        (S(B.state),
        k({
          isTransitioning: !0,
          flushSync: !1,
          currentLocation: B.currentLocation,
          nextLocation: B.nextLocation,
        }),
        j(void 0));
    }, [v.isTransitioning, B]));
  let J = R.useMemo(
      () => ({
        createHref: n.createHref,
        encodeLocation: n.encodeLocation,
        go: (L) => n.navigate(L),
        push: (L, me, ge) =>
          n.navigate(L, {
            state: me,
            preventScrollReset: ge?.preventScrollReset,
          }),
        replace: (L, me, ge) =>
          n.navigate(L, {
            replace: !0,
            state: me,
            preventScrollReset: ge?.preventScrollReset,
          }),
      }),
      [n],
    ),
    Z = n.basename || "/",
    he = R.useMemo(
      () => ({ router: n, navigator: J, static: !1, basename: Z, onError: i }),
      [n, J, Z, i],
    );
  return R.createElement(
    R.Fragment,
    null,
    R.createElement(
      Sn.Provider,
      { value: he },
      R.createElement(
        rl.Provider,
        { value: m },
        R.createElement(
          zd.Provider,
          { value: K.current },
          R.createElement(
            Wu.Provider,
            { value: v },
            R.createElement(
              Iy,
              {
                basename: Z,
                location: m.location,
                navigationType: m.historyAction,
                navigator: J,
                unstable_useTransitions: s,
              },
              R.createElement(zy, {
                routes: n.routes,
                future: n.future,
                state: m,
                isStatic: !1,
                onError: i,
              }),
            ),
          ),
        ),
      ),
    ),
    null,
  );
}
function nd(n, o) {
  return {
    ...n,
    navigation: o.navigation.state !== "idle" ? o.navigation : n.navigation,
    revalidation: o.revalidation !== "idle" ? o.revalidation : n.revalidation,
    actionData:
      o.navigation.state !== "submitting" ? o.actionData : n.actionData,
    fetchers: o.fetchers,
  };
}
var zy = R.memo(Fy);
function Fy({ routes: n, future: o, state: i, isStatic: s, onError: c }) {
  return wy(n, void 0, { state: i, isStatic: s, onError: c });
}
function wg(n) {
  return gy(n.context);
}
function Iy({
  basename: n = "/",
  children: o = null,
  location: i,
  navigationType: s = "POP",
  navigator: c,
  static: f = !1,
  unstable_useTransitions: d,
}) {
  Ce(
    !to(),
    "You cannot render a <Router> inside another <Router>. You should never have more than one in your app.",
  );
  let m = n.replace(/^\/*/, "/"),
    p = R.useMemo(
      () => ({
        basename: m,
        navigator: c,
        static: f,
        unstable_useTransitions: d,
        future: {},
      }),
      [m, c, f, d],
    );
  typeof i == "string" && (i = xr(i));
  let {
      pathname: y = "/",
      search: S = "",
      hash: v = "",
      state: k = null,
      key: M = "default",
      unstable_mask: F,
    } = i,
    z = R.useMemo(() => {
      let _ = Ot(y, m);
      return _ == null
        ? null
        : {
            location: {
              pathname: _,
              search: S,
              hash: v,
              state: k,
              key: M,
              unstable_mask: F,
            },
            navigationType: s,
          };
    }, [m, y, S, v, k, M, s, F]);
  return (
    Je(
      z != null,
      `<Router basename="${m}"> is not able to match the URL "${y}${S}${v}" because it does not start with the basename, so the <Router> won't render anything.`,
    ),
    z == null
      ? null
      : R.createElement(
          Lt.Provider,
          { value: p },
          R.createElement(Ta.Provider, { children: o, value: z }),
        )
  );
}
function jy() {
  return { params: Ud(), loaderData: $d(), actionData: Hd(), matches: Yu() };
}
function Sg(n) {
  return function () {
    const i = jy();
    return R.createElement(n, i);
  };
}
function Uy() {
  return { params: Ud(), loaderData: $d(), actionData: Hd() };
}
function Eg(n) {
  return function () {
    const i = Uy();
    return R.createElement(n, i);
  };
}
var Ea = "get",
  Ra = "application/x-www-form-urlencoded";
function Ma(n) {
  return typeof HTMLElement < "u" && n instanceof HTMLElement;
}
function Ay(n) {
  return Ma(n) && n.tagName.toLowerCase() === "button";
}
function $y(n) {
  return Ma(n) && n.tagName.toLowerCase() === "form";
}
function Hy(n) {
  return Ma(n) && n.tagName.toLowerCase() === "input";
}
function By(n) {
  return !!(n.metaKey || n.altKey || n.ctrlKey || n.shiftKey);
}
function Wy(n, o) {
  return n.button === 0 && (!o || o === "_self") && !By(n);
}
var ya = null;
function Vy() {
  if (ya === null)
    try {
      (new FormData(document.createElement("form"), 0), (ya = !1));
    } catch {
      ya = !0;
    }
  return ya;
}
var Qy = new Set([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
]);
function ku(n) {
  return n != null && !Qy.has(n)
    ? (Je(
        !1,
        `"${n}" is not a valid \`encType\` for \`<Form>\`/\`<fetcher.Form>\` and will default to "${Ra}"`,
      ),
      null)
    : n;
}
function Yy(n, o) {
  let i, s, c, f, d;
  if ($y(n)) {
    let m = n.getAttribute("action");
    ((s = m ? Ot(m, o) : null),
      (i = n.getAttribute("method") || Ea),
      (c = ku(n.getAttribute("enctype")) || Ra),
      (f = new FormData(n)));
  } else if (Ay(n) || (Hy(n) && (n.type === "submit" || n.type === "image"))) {
    let m = n.form;
    if (m == null)
      throw new Error(
        'Cannot submit a <button> or <input type="submit"> without a <form>',
      );
    let p = n.getAttribute("formaction") || m.getAttribute("action");
    if (
      ((s = p ? Ot(p, o) : null),
      (i = n.getAttribute("formmethod") || m.getAttribute("method") || Ea),
      (c =
        ku(n.getAttribute("formenctype")) ||
        ku(m.getAttribute("enctype")) ||
        Ra),
      (f = new FormData(m, n)),
      !Vy())
    ) {
      let { name: y, type: S, value: v } = n;
      if (S === "image") {
        let k = y ? `${y}.` : "";
        (f.append(`${k}x`, "0"), f.append(`${k}y`, "0"));
      } else y && f.append(y, v);
    }
  } else {
    if (Ma(n))
      throw new Error(
        'Cannot submit element that is not <form>, <button>, or <input type="submit|image">',
      );
    ((i = Ea), (s = null), (c = Ra), (d = n));
  }
  return (
    f && c === "text/plain" && ((d = f), (f = void 0)),
    { action: s, method: i.toLowerCase(), encType: c, formData: f, body: d }
  );
}
var Ky = -1,
  Xy = -2,
  Jy = -3,
  Gy = -4,
  Zy = -5,
  qy = -6,
  by = -7,
  ev = "B",
  tv = "D",
  Vd = "E",
  rv = "M",
  nv = "N",
  Qd = "P",
  lv = "R",
  ov = "S",
  av = "Y",
  iv = "U",
  uv = "Z",
  Yd = class {
    constructor() {
      this.promise = new Promise((n, o) => {
        ((this.resolve = n), (this.reject = o));
      });
    }
  };
function sv() {
  const n = new TextDecoder();
  let o = "";
  return new TransformStream({
    transform(i, s) {
      const c = n.decode(i, { stream: !0 }),
        f = (o + c).split(`
`);
      o = f.pop() || "";
      for (const d of f) s.enqueue(d);
    },
    flush(i) {
      o && i.enqueue(o);
    },
  });
}
Object.getOwnPropertyNames(Object.prototype).sort().join("\0");
var xu =
  typeof window < "u" ? window : typeof globalThis < "u" ? globalThis : void 0;
function Du(n) {
  const { hydrated: o, values: i } = this;
  if (typeof n == "number") return ld.call(this, n);
  if (!Array.isArray(n) || !n.length) throw new SyntaxError();
  const s = i.length;
  for (const c of n) i.push(c);
  return ((o.length = i.length), ld.call(this, s));
}
function ld(n) {
  const { hydrated: o, values: i, deferred: s, plugins: c } = this;
  let f;
  const d = [
    [
      n,
      (p) => {
        f = p;
      },
    ],
  ];
  let m = [];
  for (; d.length > 0; ) {
    const [p, y] = d.pop();
    switch (p) {
      case by:
        y(void 0);
        continue;
      case Zy:
        y(null);
        continue;
      case Xy:
        y(NaN);
        continue;
      case qy:
        y(1 / 0);
        continue;
      case Jy:
        y(-1 / 0);
        continue;
      case Gy:
        y(-0);
        continue;
    }
    if (o[p]) {
      y(o[p]);
      continue;
    }
    const S = i[p];
    if (!S || typeof S != "object") {
      ((o[p] = S), y(S));
      continue;
    }
    if (Array.isArray(S))
      if (typeof S[0] == "string") {
        const [v, k, M] = S;
        switch (v) {
          case tv:
            y((o[p] = new Date(k)));
            continue;
          case iv:
            y((o[p] = new URL(k)));
            continue;
          case ev:
            y((o[p] = BigInt(k)));
            continue;
          case lv:
            y((o[p] = new RegExp(k, M)));
            continue;
          case av:
            y((o[p] = Symbol.for(k)));
            continue;
          case ov:
            const F = new Set();
            o[p] = F;
            for (let Y = S.length - 1; Y > 0; Y--)
              d.push([
                S[Y],
                (J) => {
                  F.add(J);
                },
              ]);
            y(F);
            continue;
          case rv:
            const z = new Map();
            o[p] = z;
            for (let Y = S.length - 2; Y > 0; Y -= 2) {
              const J = [];
              (d.push([
                S[Y + 1],
                (Z) => {
                  J[1] = Z;
                },
              ]),
                d.push([
                  S[Y],
                  (Z) => {
                    J[0] = Z;
                  },
                ]),
                m.push(() => {
                  z.set(J[0], J[1]);
                }));
            }
            y(z);
            continue;
          case nv:
            const _ = Object.create(null);
            o[p] = _;
            for (const Y of Object.keys(k).reverse()) {
              const J = [];
              (d.push([
                k[Y],
                (Z) => {
                  J[1] = Z;
                },
              ]),
                d.push([
                  Number(Y.slice(1)),
                  (Z) => {
                    J[0] = Z;
                  },
                ]),
                m.push(() => {
                  _[J[0]] = J[1];
                }));
            }
            y(_);
            continue;
          case Qd:
            if (o[k]) y((o[p] = o[k]));
            else {
              const Y = new Yd();
              ((s[k] = Y), y((o[p] = Y.promise)));
            }
            continue;
          case Vd:
            const [, B, j] = S;
            let K = j && xu && xu[j] ? new xu[j](B) : new Error(B);
            ((o[p] = K), y(K));
            continue;
          case uv:
            y((o[p] = o[k]));
            continue;
          default:
            if (Array.isArray(c)) {
              const Y = [],
                J = S.slice(1);
              for (let Z = 0; Z < J.length; Z++) {
                const he = J[Z];
                d.push([
                  he,
                  (L) => {
                    Y[Z] = L;
                  },
                ]);
              }
              m.push(() => {
                for (const Z of c) {
                  const he = Z(S[0], ...Y);
                  if (he) {
                    y((o[p] = he.value));
                    return;
                  }
                }
                throw new SyntaxError();
              });
              continue;
            }
            throw new SyntaxError();
        }
      } else {
        const v = [];
        o[p] = v;
        for (let k = 0; k < S.length; k++) {
          const M = S[k];
          M !== Ky &&
            d.push([
              M,
              (F) => {
                v[k] = F;
              },
            ]);
        }
        y(v);
        continue;
      }
    else {
      const v = {};
      o[p] = v;
      for (const k of Object.keys(S).reverse()) {
        const M = [];
        (d.push([
          S[k],
          (F) => {
            M[1] = F;
          },
        ]),
          d.push([
            Number(k.slice(1)),
            (F) => {
              M[0] = F;
            },
          ]),
          m.push(() => {
            v[M[0]] = M[1];
          }));
      }
      y(v);
      continue;
    }
  }
  for (; m.length > 0; ) m.pop()();
  return f;
}
async function cv(n, o) {
  const { plugins: i } = o ?? {},
    s = new Yd(),
    c = n.pipeThrough(sv()).getReader(),
    f = { values: [], hydrated: [], deferred: {}, plugins: i },
    d = await fv.call(f, c);
  let m = s.promise;
  return (
    d.done
      ? s.resolve()
      : (m = dv
          .call(f, c)
          .then(s.resolve)
          .catch((p) => {
            for (const y of Object.values(f.deferred)) y.reject(p);
            s.reject(p);
          })),
    { done: m.then(() => c.closed), value: d.value }
  );
}
async function fv(n) {
  const o = await n.read();
  if (!o.value) throw new SyntaxError();
  let i;
  try {
    i = JSON.parse(o.value);
  } catch {
    throw new SyntaxError();
  }
  return { done: o.done, value: Du.call(this, i) };
}
async function dv(n) {
  let o = await n.read();
  for (; !o.done; ) {
    if (!o.value) continue;
    const i = o.value;
    switch (i[0]) {
      case Qd: {
        const s = i.indexOf(":"),
          c = Number(i.slice(1, s)),
          f = this.deferred[c];
        if (!f) throw new Error(`Deferred ID ${c} not found in stream`);
        const d = i.slice(s + 1);
        let m;
        try {
          m = JSON.parse(d);
        } catch {
          throw new SyntaxError();
        }
        const p = Du.call(this, m);
        f.resolve(p);
        break;
      }
      case Vd: {
        const s = i.indexOf(":"),
          c = Number(i.slice(1, s)),
          f = this.deferred[c];
        if (!f) throw new Error(`Deferred ID ${c} not found in stream`);
        const d = i.slice(s + 1);
        let m;
        try {
          m = JSON.parse(d);
        } catch {
          throw new SyntaxError();
        }
        const p = Du.call(this, m);
        f.reject(p);
        break;
      }
      default:
        throw new SyntaxError();
    }
    o = await n.read();
  }
}
async function hv(n) {
  let o = { signal: n.signal };
  if (n.method !== "GET") {
    o.method = n.method;
    let i = n.headers.get("Content-Type");
    i && /\bapplication\/json\b/.test(i)
      ? ((o.headers = { "Content-Type": i }),
        (o.body = JSON.stringify(await n.json())))
      : i && /\btext\/plain\b/.test(i)
        ? ((o.headers = { "Content-Type": i }), (o.body = await n.text()))
        : i && /\bapplication\/x-www-form-urlencoded\b/.test(i)
          ? (o.body = new URLSearchParams(await n.text()))
          : (o.body = await n.formData());
  }
  return o;
}
var pv = {
    "&": "\\u0026",
    ">": "\\u003e",
    "<": "\\u003c",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029",
  },
  mv = /[&><\u2028\u2029]/g;
function Ou(n) {
  return n.replace(mv, (o) => pv[o]);
}
function St(n, o) {
  if (n === !1 || n === null || typeof n > "u") throw new Error(o);
}
var zu = Symbol("SingleFetchRedirect"),
  Kd = class extends Error {},
  yv = 202,
  vv = new Set([100, 101, 204, 205]);
function Rg(n, o, i, s, c, f) {
  let d = gv(
    n,
    (m) => {
      let p = o.routes[m.route.id];
      St(p, "Route not found in manifest");
      let y = i[m.route.id];
      return {
        hasLoader: p.hasLoader,
        hasClientLoader: p.hasClientLoader,
        hasShouldRevalidate: !!y?.shouldRevalidate,
      };
    },
    Cv,
    s,
    c,
    f,
  );
  return async (m) => m.runClientMiddleware(d);
}
function gv(n, o, i, s, c, f, d = () => !0) {
  return async (m) => {
    let { request: p, matches: y, fetcherKey: S } = m,
      v = n();
    if (p.method !== "GET") return wv(m, i, c, f);
    let k = y.some((M) => {
      let { hasLoader: F, hasClientLoader: z } = o(M);
      return M.shouldCallHandler() && F && !z;
    });
    return !s && !k
      ? Sv(m, o, i, c, f)
      : S
        ? kv(m, i, c, f)
        : Ev(m, v, o, i, s, c, f, d);
  };
}
async function wv(n, o, i, s) {
  let c = n.matches.find((m) => m.shouldCallHandler());
  St(c, "No action match found");
  let f,
    d = await c.resolve(
      async (m) =>
        await m(async () => {
          let { data: y, status: S } = await o(n, i, s, [c.route.id]);
          return ((f = S), bl(y, c.route.id));
        }),
    );
  return _a(d.result) || wn(d.result) || Mu(d.result)
    ? { [c.route.id]: d }
    : { [c.route.id]: { type: d.type, result: Cm(d.result, f) } };
}
async function Sv(n, o, i, s, c) {
  let f = n.matches.filter((m) => m.shouldCallHandler()),
    d = {};
  return (
    await Promise.all(
      f.map((m) =>
        m.resolve(async (p) => {
          try {
            let { hasClientLoader: y } = o(m),
              S = m.route.id,
              v = y
                ? await p(async () => {
                    let { data: k } = await i(n, s, c, [S]);
                    return bl(k, S);
                  })
                : await p();
            d[m.route.id] = { type: "data", result: v };
          } catch (y) {
            d[m.route.id] = { type: "error", result: y };
          }
        }),
      ),
    ),
    d
  );
}
async function Ev(n, o, i, s, c, f, d, m = () => !0) {
  let p = new Set(),
    y = !1,
    S = n.matches.map(() => od()),
    v = od(),
    k = {},
    M = Promise.all(
      n.matches.map(async (z, _) =>
        z.resolve(async (B) => {
          S[_].resolve();
          let j = z.route.id,
            { hasLoader: K, hasClientLoader: Y, hasShouldRevalidate: J } = i(z),
            Z =
              !z.shouldRevalidateArgs ||
              z.shouldRevalidateArgs.actionStatus == null ||
              z.shouldRevalidateArgs.actionStatus < 400;
          if (!z.shouldCallHandler(Z)) {
            y || (y = z.shouldRevalidateArgs != null && K && J === !0);
            return;
          }
          if (m(z) && Y) {
            K && (y = !0);
            try {
              let L = await B(async () => {
                let { data: me } = await s(n, f, d, [j]);
                return bl(me, j);
              });
              k[j] = { type: "data", result: L };
            } catch (L) {
              k[j] = { type: "error", result: L };
            }
            return;
          }
          K && p.add(j);
          try {
            let L = await B(async () => {
              let me = await v.promise;
              return bl(me, j);
            });
            k[j] = { type: "data", result: L };
          } catch (L) {
            k[j] = { type: "error", result: L };
          }
        }),
      ),
    );
  if (
    (await Promise.all(S.map((z) => z.promise)),
    ((!o.state.initialized && o.state.navigation.state === "idle") ||
      p.size === 0) &&
      !window.__reactRouterHdrActive)
  )
    v.resolve({ routes: {} });
  else {
    let z = c && y && p.size > 0 ? [...p.keys()] : void 0;
    try {
      let _ = await s(n, f, d, z);
      v.resolve(_.data);
    } catch (_) {
      v.reject(_);
    }
  }
  return (await M, await Rv(v.promise, n.matches, p, k), k);
}
async function Rv(n, o, i, s) {
  try {
    let c,
      f = await n;
    if ("routes" in f) {
      for (let d of o)
        if (d.route.id in f.routes) {
          let m = f.routes[d.route.id];
          if ("error" in m) {
            ((c = m.error),
              s[d.route.id]?.result == null &&
                (s[d.route.id] = { type: "error", result: c }));
            break;
          }
        }
    }
    c !== void 0 &&
      Array.from(i.values()).forEach((d) => {
        s[d].result instanceof Kd && (s[d].result = c);
      });
  } catch {}
}
async function kv(n, o, i, s) {
  let c = n.matches.find((m) => m.shouldCallHandler());
  St(c, "No fetcher match found");
  let f = c.route.id,
    d = await c.resolve(async (m) =>
      m(async () => {
        let { data: p } = await o(n, i, s, [f]);
        return bl(p, f);
      }),
    );
  return { [c.route.id]: d };
}
function xv(n) {
  let o = n.searchParams.getAll("index");
  n.searchParams.delete("index");
  let i = [];
  for (let s of o) s && i.push(s);
  for (let s of i) n.searchParams.append("index", s);
  return n;
}
function Xd(n, o, i, s) {
  let c =
    typeof n == "string"
      ? new URL(
          n,
          typeof window > "u"
            ? "server://singlefetch/"
            : window.location.origin,
        )
      : n;
  return (
    i
      ? c.pathname.endsWith("/")
        ? (c.pathname = `${c.pathname}_.${s}`)
        : (c.pathname = `${c.pathname}.${s}`)
      : c.pathname === "/"
        ? (c.pathname = `_root.${s}`)
        : o && Ot(c.pathname, o) === "/"
          ? (c.pathname = `${o.replace(/\/$/, "")}/_root.${s}`)
          : (c.pathname = `${c.pathname.replace(/\/$/, "")}.${s}`),
    c
  );
}
async function Cv(n, o, i, s) {
  let { request: c } = n,
    f = Xd(c.url, o, i, "data");
  c.method === "GET" &&
    ((f = xv(f)), s && f.searchParams.set("_routes", s.join(",")));
  let d = await fetch(f, await hv(c));
  if (d.status >= 400 && !d.headers.has("X-Remix-Response"))
    throw new rn(d.status, d.statusText, await d.text());
  if (d.status === 204 && d.headers.has("X-Remix-Redirect"))
    return {
      status: yv,
      data: {
        redirect: {
          redirect: d.headers.get("X-Remix-Redirect"),
          status: Number(d.headers.get("X-Remix-Status") || "302"),
          revalidate: d.headers.get("X-Remix-Revalidate") === "true",
          reload: d.headers.get("X-Remix-Reload-Document") === "true",
          replace: d.headers.get("X-Remix-Replace") === "true",
        },
      },
    };
  if (vv.has(d.status)) {
    let m = {};
    return (
      s && c.method !== "GET" && (m[s[0]] = { data: void 0 }),
      { status: d.status, data: { routes: m } }
    );
  }
  St(d.body, "No response body to decode");
  try {
    let m = await Pv(d.body, window),
      p;
    if (c.method === "GET") {
      let y = m.value;
      zu in y ? (p = { redirect: y[zu] }) : (p = { routes: y });
    } else {
      let y = m.value,
        S = s?.[0];
      (St(S, "No routeId found for single fetch call decoding"),
        "redirect" in y ? (p = { redirect: y }) : (p = { routes: { [S]: y } }));
    }
    return { status: d.status, data: p };
  } catch {
    throw new Error("Unable to decode turbo-stream response");
  }
}
function Pv(n, o) {
  return cv(n, {
    plugins: [
      (i, ...s) => {
        if (i === "SanitizedError") {
          let [c, f, d] = s,
            m = Error;
          c && c in o && typeof o[c] == "function" && (m = o[c]);
          let p = new m(f);
          return ((p.stack = d), { value: p });
        }
        if (i === "ErrorResponse") {
          let [c, f, d] = s;
          return { value: new rn(f, d, c) };
        }
        if (i === "SingleFetchRedirect") return { value: { [zu]: s[0] } };
        if (i === "SingleFetchClassInstance") return { value: s[0] };
        if (i === "SingleFetchFallback") return { value: void 0 };
      },
    ],
  });
}
function bl(n, o) {
  if ("redirect" in n) {
    let {
      redirect: s,
      revalidate: c,
      reload: f,
      replace: d,
      status: m,
    } = n.redirect;
    throw Pm(s, {
      status: m,
      headers: {
        ...(c ? { "X-Remix-Revalidate": "yes" } : null),
        ...(f ? { "X-Remix-Reload-Document": "yes" } : null),
        ...(d ? { "X-Remix-Replace": "yes" } : null),
      },
    });
  }
  let i = n.routes[o];
  if (i == null) throw new Kd(`No result found for routeId "${o}"`);
  if ("error" in i) throw i.error;
  if ("data" in i) return i.data;
  throw new Error(`Invalid response found for routeId "${o}"`);
}
function od() {
  let n,
    o,
    i = new Promise((s, c) => {
      ((n = async (f) => {
        s(f);
        try {
          await i;
        } catch {}
      }),
        (o = async (f) => {
          c(f);
          try {
            await i;
          } catch {}
        }));
    });
  return { promise: i, resolve: n, reject: o };
}
async function Jd(n, o) {
  if (n.id in o) return o[n.id];
  try {
    let i = await import(n.module);
    return ((o[n.id] = i), i);
  } catch (i) {
    return (
      console.error(
        `Error loading route module \`${n.module}\`, reloading page...`,
      ),
      console.error(i),
      window.__reactRouterContext && window.__reactRouterContext.isSpaMode,
      window.location.reload(),
      new Promise(() => {})
    );
  }
}
function Lv(n, o, i) {
  let s = n
      .map((f) => {
        let d = o[f.route.id],
          m = i.routes[f.route.id];
        return [
          m && m.css ? m.css.map((p) => ({ rel: "stylesheet", href: p })) : [],
          d?.links?.() || [],
        ];
      })
      .flat(2),
    c = Xu(n, i);
  return bd(s, c);
}
function Gd(n) {
  return n.css ? n.css.map((o) => ({ rel: "stylesheet", href: o })) : [];
}
async function _v(n) {
  if (!n.css) return;
  let o = Gd(n);
  await Promise.all(o.map(qd));
}
async function Zd(n, o) {
  if ((!n.css && !o.links) || !Ov()) return;
  let i = [];
  if (
    (n.css && i.push(...Gd(n)), o.links && i.push(...o.links()), i.length === 0)
  )
    return;
  let s = [];
  for (let c of i)
    !Ku(c) &&
      c.rel === "stylesheet" &&
      s.push({ ...c, rel: "preload", as: "style" });
  await Promise.all(s.map(qd));
}
async function qd(n) {
  return new Promise((o) => {
    if (
      (n.media && !window.matchMedia(n.media).matches) ||
      document.querySelector(`link[rel="stylesheet"][href="${n.href}"]`)
    )
      return o();
    let i = document.createElement("link");
    Object.assign(i, n);
    function s() {
      document.head.contains(i) && document.head.removeChild(i);
    }
    ((i.onload = () => {
      (s(), o());
    }),
      (i.onerror = () => {
        (s(), o());
      }),
      document.head.appendChild(i));
  });
}
function Ku(n) {
  return n != null && typeof n.page == "string";
}
function Tv(n) {
  return n == null
    ? !1
    : n.href == null
      ? n.rel === "preload" &&
        typeof n.imageSrcSet == "string" &&
        typeof n.imageSizes == "string"
      : typeof n.rel == "string" && typeof n.href == "string";
}
async function Mv(n, o, i) {
  let s = await Promise.all(
    n.map(async (c) => {
      let f = o.routes[c.route.id];
      if (f) {
        let d = await Jd(f, i);
        return d.links ? d.links() : [];
      }
      return [];
    }),
  );
  return bd(
    s
      .flat(1)
      .filter(Tv)
      .filter((c) => c.rel === "stylesheet" || c.rel === "preload")
      .map((c) =>
        c.rel === "stylesheet"
          ? { ...c, rel: "prefetch", as: "style" }
          : { ...c, rel: "prefetch" },
      ),
  );
}
function ad(n, o, i, s, c, f) {
  let d = (p, y) => (i[y] ? p.route.id !== i[y].route.id : !0),
    m = (p, y) =>
      i[y].pathname !== p.pathname ||
      (i[y].route.path?.endsWith("*") && i[y].params["*"] !== p.params["*"]);
  return f === "assets"
    ? o.filter((p, y) => d(p, y) || m(p, y))
    : f === "data"
      ? o.filter((p, y) => {
          let S = s.routes[p.route.id];
          if (!S || !S.hasLoader) return !1;
          if (d(p, y) || m(p, y)) return !0;
          if (p.route.shouldRevalidate) {
            let v = p.route.shouldRevalidate({
              currentUrl: new URL(
                c.pathname + c.search + c.hash,
                window.origin,
              ),
              currentParams: i[0]?.params || {},
              nextUrl: new URL(n, window.origin),
              nextParams: p.params,
              defaultShouldRevalidate: !0,
            });
            if (typeof v == "boolean") return v;
          }
          return !0;
        })
      : [];
}
function Xu(n, o, { includeHydrateFallback: i } = {}) {
  return Nv(
    n
      .map((s) => {
        let c = o.routes[s.route.id];
        if (!c) return [];
        let f = [c.module];
        return (
          c.clientActionModule && (f = f.concat(c.clientActionModule)),
          c.clientLoaderModule && (f = f.concat(c.clientLoaderModule)),
          i &&
            c.hydrateFallbackModule &&
            (f = f.concat(c.hydrateFallbackModule)),
          c.imports && (f = f.concat(c.imports)),
          f
        );
      })
      .flat(1),
  );
}
function Nv(n) {
  return [...new Set(n)];
}
function Dv(n) {
  let o = {},
    i = Object.keys(n).sort();
  for (let s of i) o[s] = n[s];
  return o;
}
function bd(n, o) {
  let i = new Set(),
    s = new Set(o);
  return n.reduce((c, f) => {
    if (o && !Ku(f) && f.as === "script" && f.href && s.has(f.href)) return c;
    let m = JSON.stringify(Dv(f));
    return (i.has(m) || (i.add(m), c.push({ key: m, link: f })), c);
  }, []);
}
var va;
function Ov() {
  if (va !== void 0) return va;
  let n = document.createElement("link");
  return ((va = n.relList.supports("preload")), (n = null), va);
}
function zv() {
  return R.createElement(
    Fu,
    { title: "Loading...", renderScripts: !0 },
    R.createElement("script", {
      dangerouslySetInnerHTML: {
        __html: `
              console.log(
                "💿 Hey developer 👋. You can provide a way better UX than this " +
                "when your app is loading JS modules and/or running \`clientLoader\` " +
                "functions. Check out https://reactrouter.com/start/framework/route-module#hydratefallback " +
                "for more information."
              );
            `,
      },
    }),
  );
}
function eh(n) {
  let o = {};
  return (
    Object.values(n).forEach((i) => {
      if (i) {
        let s = i.parentId || "";
        (o[s] || (o[s] = []), o[s].push(i));
      }
    }),
    o
  );
}
function Fv(n, o, i) {
  let s = th(o),
    c =
      o.HydrateFallback && (!i || n.id === "root")
        ? o.HydrateFallback
        : n.id === "root"
          ? zv
          : void 0,
    f = o.ErrorBoundary
      ? o.ErrorBoundary
      : n.id === "root"
        ? () => R.createElement(lh, { error: Bd() })
        : void 0;
  return n.id === "root" && o.Layout
    ? {
        ...(s
          ? {
              element: R.createElement(
                o.Layout,
                null,
                R.createElement(s, null),
              ),
            }
          : { Component: s }),
        ...(f
          ? {
              errorElement: R.createElement(
                o.Layout,
                null,
                R.createElement(f, null),
              ),
            }
          : { ErrorBoundary: f }),
        ...(c
          ? {
              hydrateFallbackElement: R.createElement(
                o.Layout,
                null,
                R.createElement(c, null),
              ),
            }
          : { HydrateFallback: c }),
      }
    : { Component: s, ErrorBoundary: f, HydrateFallback: c };
}
function kg(n, o, i, s, c, f) {
  return Ju(o, i, s, c, f, "", eh(o), n);
}
function ga(n, o) {
  if ((n === "loader" && !o.hasLoader) || (n === "action" && !o.hasAction)) {
    let s = `You are trying to call ${n === "action" ? "serverAction()" : "serverLoader()"} on a route that does not have a server ${n} (routeId: "${o.id}")`;
    throw (console.error(s), new rn(400, "Bad Request", new Error(s), !0));
  }
}
function Cu(n, o) {
  let i = n === "clientAction" ? "a" : "an",
    s = `Route "${o}" does not have ${i} ${n}, but you are trying to submit to it. To fix this, please add ${i} \`${n}\` function to the route`;
  throw (console.error(s), new rn(405, "Method Not Allowed", new Error(s), !0));
}
function Ju(n, o, i, s, c, f = "", d = eh(n), m) {
  return (d[f] || []).map((p) => {
    let y = o[p.id];
    function S(j) {
      return (
        St(
          typeof j == "function",
          "No single fetch function available for route handler",
        ),
        j()
      );
    }
    function v(j) {
      return p.hasLoader ? S(j) : Promise.resolve(null);
    }
    function k(j) {
      if (!p.hasAction) throw Cu("action", p.id);
      return S(j);
    }
    function M(j) {
      import(j);
    }
    function F(j) {
      (j.clientActionModule && M(j.clientActionModule),
        j.clientLoaderModule && M(j.clientLoaderModule));
    }
    async function z(j) {
      let K = o[p.id],
        Y = K ? Zd(p, K) : Promise.resolve();
      try {
        return j();
      } finally {
        await Y;
      }
    }
    let _ = { id: p.id, index: p.index, path: p.path };
    if (y) {
      Object.assign(_, {
        ..._,
        ...Fv(p, y, c),
        middleware: y.clientMiddleware,
        handle: y.handle,
        shouldRevalidate: id(_.path, y, p, s, m),
      });
      let j = i && i.loaderData && p.id in i.loaderData,
        K = j ? i?.loaderData?.[p.id] : void 0,
        Y = i && i.errors && p.id in i.errors,
        J = Y ? i?.errors?.[p.id] : void 0,
        Z = m == null && (y.clientLoader?.hydrate === !0 || !p.hasLoader);
      ((_.loader = async (
        { request: he, params: L, context: me, unstable_pattern: ge },
        De,
      ) => {
        try {
          return await z(
            async () => (
              St(y, "No `routeModule` available for critical-route loader"),
              y.clientLoader
                ? y.clientLoader({
                    request: he,
                    params: L,
                    context: me,
                    unstable_pattern: ge,
                    async serverLoader() {
                      if ((ga("loader", p), Z)) {
                        if (j) return K;
                        if (Y) throw J;
                      }
                      return v(De);
                    },
                  })
                : v(De)
            ),
          );
        } finally {
          Z = !1;
        }
      }),
        (_.loader.hydrate = Uv(p.id, y.clientLoader, p.hasLoader, c)),
        (_.action = (
          { request: he, params: L, context: me, unstable_pattern: ge },
          De,
        ) =>
          z(async () => {
            if (
              (St(y, "No `routeModule` available for critical-route action"),
              !y.clientAction)
            ) {
              if (c) throw Cu("clientAction", p.id);
              return k(De);
            }
            return y.clientAction({
              request: he,
              params: L,
              context: me,
              unstable_pattern: ge,
              async serverAction() {
                return (ga("action", p), k(De));
              },
            });
          })));
    } else {
      (p.hasClientLoader || (_.loader = (Y, J) => z(() => v(J))),
        p.hasClientAction ||
          (_.action = (Y, J) =>
            z(() => {
              if (c) throw Cu("clientAction", p.id);
              return k(J);
            })));
      let j;
      async function K() {
        return j
          ? await j
          : ((j = (async () => {
              (p.clientLoaderModule || p.clientActionModule) &&
                (await new Promise((J) => setTimeout(J, 0)));
              let Y = jv(p, o);
              return (F(p), await Y);
            })()),
            await j);
      }
      _.lazy = {
        loader: p.hasClientLoader
          ? async () => {
              let { clientLoader: Y } = p.clientLoaderModule
                ? await import(p.clientLoaderModule)
                : await K();
              return (
                St(Y, "No `clientLoader` export found"),
                (J, Z) =>
                  Y({
                    ...J,
                    async serverLoader() {
                      return (ga("loader", p), v(Z));
                    },
                  })
              );
            }
          : void 0,
        action: p.hasClientAction
          ? async () => {
              let Y = p.clientActionModule ? import(p.clientActionModule) : K();
              F(p);
              let { clientAction: J } = await Y;
              return (
                St(J, "No `clientAction` export found"),
                (Z, he) =>
                  J({
                    ...Z,
                    async serverAction() {
                      return (ga("action", p), k(he));
                    },
                  })
              );
            }
          : void 0,
        middleware: p.hasClientMiddleware
          ? async () => {
              let { clientMiddleware: Y } = p.clientMiddlewareModule
                ? await import(p.clientMiddlewareModule)
                : await K();
              return (St(Y, "No `clientMiddleware` export found"), Y);
            }
          : void 0,
        shouldRevalidate: async () => {
          let Y = await K();
          return id(_.path, Y, p, s, m);
        },
        handle: async () => (await K()).handle,
        Component: async () => (await K()).Component,
        ErrorBoundary: p.hasErrorBoundary
          ? async () => (await K()).ErrorBoundary
          : void 0,
      };
    }
    let B = Ju(n, o, i, s, c, p.id, d, m);
    return (B.length > 0 && (_.children = B), _);
  });
}
function id(n, o, i, s, c) {
  if (c) return Iv(i.id, o.shouldRevalidate, c);
  if (!s && i.hasLoader && !i.hasClientLoader) {
    let f = n ? md(n)[1].map((m) => m.paramName) : [];
    const d = (m) => f.some((p) => m.currentParams[p] !== m.nextParams[p]);
    if (o.shouldRevalidate) {
      let m = o.shouldRevalidate;
      return (p) => m({ ...p, defaultShouldRevalidate: d(p) });
    } else return (m) => d(m);
  }
  return o.shouldRevalidate;
}
function Iv(n, o, i) {
  let s = !1;
  return (c) =>
    s ? (o ? o(c) : c.defaultShouldRevalidate) : ((s = !0), i.has(n));
}
async function jv(n, o) {
  let i = Jd(n, o),
    s = _v(n),
    c = await i;
  return (
    await Promise.all([s, Zd(n, c)]),
    {
      Component: th(c),
      ErrorBoundary: c.ErrorBoundary,
      clientMiddleware: c.clientMiddleware,
      clientAction: c.clientAction,
      clientLoader: c.clientLoader,
      handle: c.handle,
      links: c.links,
      meta: c.meta,
      shouldRevalidate: c.shouldRevalidate,
    }
  );
}
function th(n) {
  if (n.default == null) return;
  if (!(typeof n.default == "object" && Object.keys(n.default).length === 0))
    return n.default;
}
function Uv(n, o, i, s) {
  return (s && n !== "root") || (o != null && (o.hydrate === !0 || i !== !0));
}
var ka = new Set(),
  Av = 1e3,
  Ca = new Set(),
  $v = 7680;
function Gu(n, o) {
  return n.mode === "lazy" && o === !0;
}
function Hv({ sri: n, ...o }, i) {
  let s = new Set(i.state.matches.map((m) => m.route.id)),
    c = i.state.location.pathname.split("/").filter(Boolean),
    f = ["/"];
  for (c.pop(); c.length > 0; ) (f.push(`/${c.join("/")}`), c.pop());
  f.forEach((m) => {
    let p = kr(i.routes, m, i.basename);
    p && p.forEach((y) => s.add(y.route.id));
  });
  let d = [...s].reduce((m, p) => Object.assign(m, { [p]: o.routes[p] }), {});
  return { ...o, routes: d, sri: n ? !0 : void 0 };
}
function xg(n, o, i, s, c, f, d) {
  if (Gu(c, s))
    return async ({ path: m, patch: p, signal: y, fetcherKey: S }) => {
      if (Ca.has(m)) return;
      let { state: v } = n();
      await rh(
        [m],
        S ? window.location.href : er(v.navigation.location || v.location),
        o,
        i,
        s,
        f,
        d,
        c.manifestPath,
        p,
        y,
      );
    };
}
function Cg(n, o, i, s, c, f) {
  R.useEffect(() => {
    if (!Gu(c, s) || window.navigator?.connection?.saveData === !0) return;
    function d(S) {
      let v =
        S.tagName === "FORM"
          ? S.getAttribute("action")
          : S.getAttribute("href");
      if (!v) return;
      let k =
        S.tagName === "A"
          ? S.pathname
          : new URL(v, window.location.origin).pathname;
      Ca.has(k) || ka.add(k);
    }
    async function m() {
      document
        .querySelectorAll("a[data-discover], form[data-discover]")
        .forEach(d);
      let S = Array.from(ka.keys()).filter((v) =>
        Ca.has(v) ? (ka.delete(v), !1) : !0,
      );
      if (S.length !== 0)
        try {
          await rh(
            S,
            null,
            o,
            i,
            s,
            f,
            n.basename,
            c.manifestPath,
            n.patchRoutes,
          );
        } catch (v) {
          console.error("Failed to fetch manifest patches", v);
        }
    }
    let p = Vv(m, 100);
    m();
    let y = new MutationObserver(() => p());
    return (
      y.observe(document.documentElement, {
        subtree: !0,
        childList: !0,
        attributes: !0,
        attributeFilter: ["data-discover", "href", "action"],
      }),
      () => y.disconnect()
    );
  }, [s, f, o, i, n, c]);
}
function Bv(n, o) {
  let i = n || "/__manifest";
  return o == null ? i : `${o}${i}`.replace(/\/+/g, "/");
}
var Pu = "react-router-manifest-version";
async function rh(n, o, i, s, c, f, d, m, p, y) {
  const S = new URLSearchParams();
  (S.set("paths", n.sort().join(",")), S.set("version", i.version));
  let v = new URL(Bv(m, d), window.location.origin);
  if (((v.search = S.toString()), v.toString().length > $v)) {
    ka.clear();
    return;
  }
  let k;
  try {
    let _ = await fetch(v, { signal: y });
    if (_.ok) {
      if (_.status === 204 && _.headers.has("X-Remix-Reload-Document")) {
        if (!o) {
          console.warn(
            "Detected a manifest version mismatch during eager route discovery. The next navigation/fetch to an undiscovered route will result in a new document navigation to sync up with the latest manifest.",
          );
          return;
        }
        try {
          if (sessionStorage.getItem(Pu) === i.version) {
            console.error(
              "Unable to discover routes due to manifest version mismatch.",
            );
            return;
          }
          sessionStorage.setItem(Pu, i.version);
        } catch {}
        ((window.location.href = o),
          console.warn("Detected manifest version mismatch, reloading..."),
          await new Promise(() => {}));
      } else if (_.status >= 400) throw new Error(await _.text());
    } else throw new Error(`${_.status} ${_.statusText}`);
    try {
      sessionStorage.removeItem(Pu);
    } catch {}
    k = await _.json();
  } catch (_) {
    if (y?.aborted) return;
    throw _;
  }
  let M = new Set(Object.keys(i.routes)),
    F = Object.values(k).reduce(
      (_, B) => (B && !M.has(B.id) && (_[B.id] = B), _),
      {},
    );
  (Object.assign(i.routes, F), n.forEach((_) => Wv(_, Ca)));
  let z = new Set();
  (Object.values(F).forEach((_) => {
    _ && (!_.parentId || !F[_.parentId]) && z.add(_.parentId);
  }),
    z.forEach((_) => p(_ || null, Ju(F, s, null, c, f, _))));
}
function Wv(n, o) {
  if (o.size >= Av) {
    let i = o.values().next().value;
    o.delete(i);
  }
  o.add(n);
}
function Vv(n, o) {
  let i;
  return (...s) => {
    (window.clearTimeout(i), (i = window.setTimeout(() => n(...s), o)));
  };
}
function Zu() {
  let n = R.useContext(Sn);
  return (
    St(
      n,
      "You must render this element inside a <DataRouterContext.Provider> element",
    ),
    n
  );
}
function Na() {
  let n = R.useContext(rl);
  return (
    St(
      n,
      "You must render this element inside a <DataRouterStateContext.Provider> element",
    ),
    n
  );
}
var Da = R.createContext(void 0);
Da.displayName = "FrameworkContext";
function nl() {
  let n = R.useContext(Da);
  return (
    St(n, "You must render this element inside a <HydratedRouter> element"),
    n
  );
}
function Qv(n, o) {
  let i = R.useContext(Da),
    [s, c] = R.useState(!1),
    [f, d] = R.useState(!1),
    {
      onFocus: m,
      onBlur: p,
      onMouseEnter: y,
      onMouseLeave: S,
      onTouchStart: v,
    } = o,
    k = R.useRef(null);
  (R.useEffect(() => {
    if ((n === "render" && d(!0), n === "viewport")) {
      let z = (B) => {
          B.forEach((j) => {
            d(j.isIntersecting);
          });
        },
        _ = new IntersectionObserver(z, { threshold: 0.5 });
      return (
        k.current && _.observe(k.current),
        () => {
          _.disconnect();
        }
      );
    }
  }, [n]),
    R.useEffect(() => {
      if (s) {
        let z = setTimeout(() => {
          d(!0);
        }, 100);
        return () => {
          clearTimeout(z);
        };
      }
    }, [s]));
  let M = () => {
      c(!0);
    },
    F = () => {
      (c(!1), d(!1));
    };
  return i
    ? n !== "intent"
      ? [f, k, {}]
      : [
          f,
          k,
          {
            onFocus: Kl(m, M),
            onBlur: Kl(p, F),
            onMouseEnter: Kl(y, M),
            onMouseLeave: Kl(S, F),
            onTouchStart: Kl(v, M),
          },
        ]
    : [!1, k, {}];
}
function Kl(n, o) {
  return (i) => {
    (n && n(i), i.defaultPrevented || o(i));
  };
}
function qu(n, o, i) {
  if (i && !Pa) return [n[0]];
  if (o) {
    let s = n.findIndex((c) => o[c.route.id] !== void 0);
    return n.slice(0, s + 1);
  }
  return n;
}
var ud = "data-react-router-critical-css";
function Pg({ nonce: n, crossOrigin: o }) {
  let { isSpaMode: i, manifest: s, routeModules: c, criticalCss: f } = nl(),
    { errors: d, matches: m } = Na(),
    p = qu(m, d, i),
    y = R.useMemo(() => Lv(p, c, s), [p, c, s]);
  return R.createElement(
    R.Fragment,
    null,
    typeof f == "string"
      ? R.createElement("style", {
          [ud]: "",
          nonce: n,
          dangerouslySetInnerHTML: { __html: f },
        })
      : null,
    typeof f == "object"
      ? R.createElement("link", {
          [ud]: "",
          rel: "stylesheet",
          href: f.href,
          nonce: n,
          crossOrigin: o,
        })
      : null,
    y.map(({ key: S, link: v }) =>
      Ku(v)
        ? R.createElement(nh, {
            key: S,
            nonce: n,
            ...v,
            crossOrigin: v.crossOrigin ?? o,
          })
        : R.createElement("link", {
            key: S,
            nonce: n,
            ...v,
            crossOrigin: v.crossOrigin ?? o,
          }),
    ),
  );
}
function nh({ page: n, ...o }) {
  let { router: i } = Zu(),
    s = R.useMemo(() => kr(i.routes, n, i.basename), [i.routes, n, i.basename]);
  return s ? R.createElement(Kv, { page: n, matches: s, ...o }) : null;
}
function Yv(n) {
  let { manifest: o, routeModules: i } = nl(),
    [s, c] = R.useState([]);
  return (
    R.useEffect(() => {
      let f = !1;
      return (
        Mv(n, o, i).then((d) => {
          f || c(d);
        }),
        () => {
          f = !0;
        }
      );
    }, [n, o, i]),
    s
  );
}
function Kv({ page: n, matches: o, ...i }) {
  let s = rr(),
    { future: c, manifest: f, routeModules: d } = nl(),
    { basename: m } = Zu(),
    { loaderData: p, matches: y } = Na(),
    S = R.useMemo(() => ad(n, o, y, f, s, "data"), [n, o, y, f, s]),
    v = R.useMemo(() => ad(n, o, y, f, s, "assets"), [n, o, y, f, s]),
    k = R.useMemo(() => {
      if (n === s.pathname + s.search + s.hash) return [];
      let z = new Set(),
        _ = !1;
      if (
        (o.forEach((j) => {
          let K = f.routes[j.route.id];
          !K ||
            !K.hasLoader ||
            ((!S.some((Y) => Y.route.id === j.route.id) &&
              j.route.id in p &&
              d[j.route.id]?.shouldRevalidate) ||
            K.hasClientLoader
              ? (_ = !0)
              : z.add(j.route.id));
        }),
        z.size === 0)
      )
        return [];
      let B = Xd(n, m, c.unstable_trailingSlashAwareDataRequests, "data");
      return (
        _ &&
          z.size > 0 &&
          B.searchParams.set(
            "_routes",
            o
              .filter((j) => z.has(j.route.id))
              .map((j) => j.route.id)
              .join(","),
          ),
        [B.pathname + B.search]
      );
    }, [m, c.unstable_trailingSlashAwareDataRequests, p, s, f, S, o, n, d]),
    M = R.useMemo(() => Xu(v, f), [v, f]),
    F = Yv(v);
  return R.createElement(
    R.Fragment,
    null,
    k.map((z) =>
      R.createElement("link", {
        key: z,
        rel: "prefetch",
        as: "fetch",
        href: z,
        ...i,
      }),
    ),
    M.map((z) =>
      R.createElement("link", { key: z, rel: "modulepreload", href: z, ...i }),
    ),
    F.map(({ key: z, link: _ }) =>
      R.createElement("link", {
        key: z,
        nonce: i.nonce,
        ..._,
        crossOrigin: _.crossOrigin ?? i.crossOrigin,
      }),
    ),
  );
}
function Lg() {
  let { isSpaMode: n, routeModules: o } = nl(),
    { errors: i, matches: s, loaderData: c } = Na(),
    f = rr(),
    d = qu(s, i, n),
    m = null;
  i && (m = i[d[d.length - 1].route.id]);
  let p = [],
    y = null,
    S = [];
  for (let v = 0; v < d.length; v++) {
    let k = d[v],
      M = k.route.id,
      F = c[M],
      z = k.params,
      _ = o[M],
      B = [],
      j = {
        id: M,
        data: F,
        loaderData: F,
        meta: [],
        params: k.params,
        pathname: k.pathname,
        handle: k.route.handle,
        error: m,
      };
    if (
      ((S[v] = j),
      _?.meta
        ? (B =
            typeof _.meta == "function"
              ? _.meta({
                  data: F,
                  loaderData: F,
                  params: z,
                  location: f,
                  matches: S,
                  error: m,
                })
              : Array.isArray(_.meta)
                ? [..._.meta]
                : _.meta)
        : y && (B = [...y]),
      (B = B || []),
      !Array.isArray(B))
    )
      throw new Error(
        "The route at " +
          k.route.path +
          ` returns an invalid value. All route meta functions must return an array of meta objects.

To reference the meta function API, see https://reactrouter.com/start/framework/route-module#meta`,
      );
    ((j.meta = B), (S[v] = j), (p = [...B]), (y = p));
  }
  return R.createElement(
    R.Fragment,
    null,
    p.flat().map((v) => {
      if (!v) return null;
      if ("tagName" in v) {
        let { tagName: k, ...M } = v;
        if (!Xv(k))
          return (
            console.warn(
              `A meta object uses an invalid tagName: ${k}. Expected either 'link' or 'meta'`,
            ),
            null
          );
        let F = k;
        return R.createElement(F, { key: JSON.stringify(M), ...M });
      }
      if ("title" in v)
        return R.createElement("title", { key: "title" }, String(v.title));
      if (
        ("charset" in v &&
          (v.charSet ?? (v.charSet = v.charset), delete v.charset),
        "charSet" in v && v.charSet != null)
      )
        return typeof v.charSet == "string"
          ? R.createElement("meta", { key: "charSet", charSet: v.charSet })
          : null;
      if ("script:ld+json" in v)
        try {
          let k = JSON.stringify(v["script:ld+json"]);
          return R.createElement("script", {
            key: `script:ld+json:${k}`,
            type: "application/ld+json",
            dangerouslySetInnerHTML: { __html: Ou(k) },
          });
        } catch {
          return null;
        }
      return R.createElement("meta", { key: JSON.stringify(v), ...v });
    }),
  );
}
function Xv(n) {
  return typeof n == "string" && /^(meta|link)$/.test(n);
}
var Pa = !1;
function Jv() {
  Pa = !0;
}
function Gv(n) {
  let {
      manifest: o,
      serverHandoffString: i,
      isSpaMode: s,
      renderMeta: c,
      routeDiscovery: f,
      ssr: d,
    } = nl(),
    { router: m, static: p, staticContext: y } = Zu(),
    { matches: S } = Na(),
    v = Od(),
    k = Gu(f, d);
  c && (c.didRenderScripts = !0);
  let M = qu(S, null, s);
  R.useEffect(() => {
    Jv();
  }, []);
  let F = R.useMemo(() => {
      if (v) return null;
      let j = y
          ? `window.__reactRouterContext = ${i};window.__reactRouterContext.stream = new ReadableStream({start(controller){window.__reactRouterContext.streamController = controller;}}).pipeThrough(new TextEncoderStream());`
          : " ",
        K = p
          ? `${o.hmr?.runtime ? `import ${JSON.stringify(o.hmr.runtime)};` : ""}${k ? "" : `import ${JSON.stringify(o.url)}`};
${M.map((Y, J) => {
  let Z = `route${J}`,
    he = o.routes[Y.route.id];
  St(he, `Route ${Y.route.id} not found in manifest`);
  let {
      clientActionModule: L,
      clientLoaderModule: me,
      clientMiddlewareModule: ge,
      hydrateFallbackModule: De,
      module: we,
    } = he,
    ze = [
      ...(L ? [{ module: L, varName: `${Z}_clientAction` }] : []),
      ...(me ? [{ module: me, varName: `${Z}_clientLoader` }] : []),
      ...(ge ? [{ module: ge, varName: `${Z}_clientMiddleware` }] : []),
      ...(De ? [{ module: De, varName: `${Z}_HydrateFallback` }] : []),
      { module: we, varName: `${Z}_main` },
    ];
  if (ze.length === 1) return `import * as ${Z} from ${JSON.stringify(we)};`;
  let xe = ze.map((Re) => `import * as ${Re.varName} from "${Re.module}";`)
      .join(`
`),
    ye = `const ${Z} = {${ze.map((Re) => `...${Re.varName}`).join(",")}};`;
  return [xe, ye].join(`
`);
}).join(`
`)}
  ${k ? `window.__reactRouterManifest = ${JSON.stringify(Hv(o, m), null, 2)};` : ""}
  window.__reactRouterRouteModules = {${M.map((Y, J) => `${JSON.stringify(Y.route.id)}:route${J}`).join(",")}};

import(${JSON.stringify(o.entry.module)});`
          : " ";
      return R.createElement(
        R.Fragment,
        null,
        R.createElement("script", {
          ...n,
          suppressHydrationWarning: !0,
          dangerouslySetInnerHTML: { __html: j },
          type: void 0,
        }),
        R.createElement("script", {
          ...n,
          suppressHydrationWarning: !0,
          dangerouslySetInnerHTML: { __html: K },
          type: "module",
          async: !0,
        }),
      );
    }, []),
    z =
      Pa || v
        ? []
        : Zv(o.entry.imports.concat(Xu(M, o, { includeHydrateFallback: !0 }))),
    _ = typeof o.sri == "object" ? o.sri : {};
  return (
    Nu(
      !v,
      "The <Scripts /> element is a no-op when using RSC and can be safely removed.",
    ),
    Pa || v
      ? null
      : R.createElement(
          R.Fragment,
          null,
          typeof o.sri == "object"
            ? R.createElement("script", {
                ...n,
                "rr-importmap": "",
                type: "importmap",
                suppressHydrationWarning: !0,
                dangerouslySetInnerHTML: {
                  __html: JSON.stringify({ integrity: _ }),
                },
              })
            : null,
          k
            ? null
            : R.createElement("link", {
                rel: "modulepreload",
                href: o.url,
                crossOrigin: n.crossOrigin,
                integrity: _[o.url],
                suppressHydrationWarning: !0,
              }),
          R.createElement("link", {
            rel: "modulepreload",
            href: o.entry.module,
            crossOrigin: n.crossOrigin,
            integrity: _[o.entry.module],
            suppressHydrationWarning: !0,
          }),
          z.map((B) =>
            R.createElement("link", {
              key: B,
              rel: "modulepreload",
              href: B,
              crossOrigin: n.crossOrigin,
              integrity: _[B],
              suppressHydrationWarning: !0,
            }),
          ),
          F,
        )
  );
}
function Zv(n) {
  return [...new Set(n)];
}
function qv(...n) {
  return (o) => {
    n.forEach((i) => {
      typeof i == "function" ? i(o) : i != null && (i.current = o);
    });
  };
}
var _g = class extends R.Component {
  constructor(n) {
    (super(n), (this.state = { error: n.error || null, location: n.location }));
  }
  static getDerivedStateFromError(n) {
    return { error: n };
  }
  static getDerivedStateFromProps(n, o) {
    return o.location !== n.location
      ? { error: n.error || null, location: n.location }
      : { error: n.error || o.error, location: o.location };
  }
  render() {
    return this.state.error
      ? R.createElement(lh, { error: this.state.error, isOutsideRemixApp: !0 })
      : this.props.children;
  }
};
function lh({ error: n, isOutsideRemixApp: o }) {
  console.error(n);
  let i = R.createElement("script", {
    dangerouslySetInnerHTML: {
      __html: `
        console.log(
          "💿 Hey developer 👋. You can provide a way better UX than this when your app throws errors. Check out https://reactrouter.com/how-to/error-boundary for more information."
        );
      `,
    },
  });
  if (wn(n))
    return R.createElement(
      Fu,
      { title: "Unhandled Thrown Response!" },
      R.createElement(
        "h1",
        { style: { fontSize: "24px" } },
        n.status,
        " ",
        n.statusText,
      ),
      i,
    );
  let s;
  if (n instanceof Error) s = n;
  else {
    let c =
      n == null
        ? "Unknown Error"
        : typeof n == "object" && "toString" in n
          ? n.toString()
          : JSON.stringify(n);
    s = new Error(c);
  }
  return R.createElement(
    Fu,
    { title: "Application Error!", isOutsideRemixApp: o },
    R.createElement("h1", { style: { fontSize: "24px" } }, "Application Error"),
    R.createElement(
      "pre",
      {
        style: {
          padding: "2rem",
          background: "hsla(10, 50%, 50%, 0.1)",
          color: "red",
          overflow: "auto",
        },
      },
      s.stack,
    ),
    i,
  );
}
function Fu({ title: n, renderScripts: o, isOutsideRemixApp: i, children: s }) {
  let { routeModules: c } = nl();
  return c.root?.Layout && !i
    ? s
    : R.createElement(
        "html",
        { lang: "en" },
        R.createElement(
          "head",
          null,
          R.createElement("meta", { charSet: "utf-8" }),
          R.createElement("meta", {
            name: "viewport",
            content: "width=device-width,initial-scale=1,viewport-fit=cover",
          }),
          R.createElement("title", null, n),
        ),
        R.createElement(
          "body",
          null,
          R.createElement(
            "main",
            { style: { fontFamily: "system-ui, sans-serif", padding: "2rem" } },
            s,
            o ? R.createElement(Gv, null) : null,
          ),
        ),
      );
}
var bv =
  typeof window < "u" &&
  typeof window.document < "u" &&
  typeof window.document.createElement < "u";
try {
  bv && (window.__reactRouterVersion = "7.13.1");
} catch {}
var oh = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i,
  ah = R.forwardRef(function (
    {
      onClick: o,
      discover: i = "render",
      prefetch: s = "none",
      relative: c,
      reloadDocument: f,
      replace: d,
      unstable_mask: m,
      state: p,
      target: y,
      to: S,
      preventScrollReset: v,
      viewTransition: k,
      unstable_defaultShouldRevalidate: M,
      ...F
    },
    z,
  ) {
    let {
        basename: _,
        navigator: B,
        unstable_useTransitions: j,
      } = R.useContext(Lt),
      K = typeof S == "string" && oh.test(S),
      Y = wd(S, _);
    S = Y.to;
    let J = py(S, { relative: c }),
      Z = rr(),
      he = null;
    if (m) {
      let ye = La(m, [], Z.unstable_mask ? Z.unstable_mask.pathname : "/", !0);
      (_ !== "/" &&
        (ye.pathname = ye.pathname === "/" ? _ : bt([_, ye.pathname])),
        (he = B.createHref(ye)));
    }
    let [L, me, ge] = Qv(s, F),
      De = lg(S, {
        replace: d,
        unstable_mask: m,
        state: p,
        target: y,
        preventScrollReset: v,
        relative: c,
        viewTransition: k,
        unstable_defaultShouldRevalidate: M,
        unstable_useTransitions: j,
      });
    function we(ye) {
      (o && o(ye), ye.defaultPrevented || De(ye));
    }
    let ze = !(Y.isExternal || f),
      xe = R.createElement("a", {
        ...F,
        ...ge,
        href: (ze ? he : void 0) || Y.absoluteURL || J,
        onClick: ze ? we : o,
        ref: qv(z, me),
        target: y,
        "data-discover": !K && i === "render" ? "true" : void 0,
      });
    return L && !K
      ? R.createElement(R.Fragment, null, xe, R.createElement(nh, { page: J }))
      : xe;
  });
ah.displayName = "Link";
var eg = R.forwardRef(function (
  {
    "aria-current": o = "page",
    caseSensitive: i = !1,
    className: s = "",
    end: c = !1,
    style: f,
    to: d,
    viewTransition: m,
    children: p,
    ...y
  },
  S,
) {
  let v = ro(d, { relative: y.relative }),
    k = rr(),
    M = R.useContext(rl),
    { navigator: F, basename: z } = R.useContext(Lt),
    _ = M != null && fg(v) && m === !0,
    B = F.encodeLocation ? F.encodeLocation(v).pathname : v.pathname,
    j = k.pathname,
    K =
      M && M.navigation && M.navigation.location
        ? M.navigation.location.pathname
        : null;
  (i ||
    ((j = j.toLowerCase()),
    (K = K ? K.toLowerCase() : null),
    (B = B.toLowerCase())),
    K && z && (K = Ot(K, z) || K));
  const Y = B !== "/" && B.endsWith("/") ? B.length - 1 : B.length;
  let J = j === B || (!c && j.startsWith(B) && j.charAt(Y) === "/"),
    Z =
      K != null &&
      (K === B || (!c && K.startsWith(B) && K.charAt(B.length) === "/")),
    he = { isActive: J, isPending: Z, isTransitioning: _ },
    L = J ? o : void 0,
    me;
  typeof s == "function"
    ? (me = s(he))
    : (me = [
        s,
        J ? "active" : null,
        Z ? "pending" : null,
        _ ? "transitioning" : null,
      ]
        .filter(Boolean)
        .join(" "));
  let ge = typeof f == "function" ? f(he) : f;
  return R.createElement(
    ah,
    {
      ...y,
      "aria-current": L,
      className: me,
      ref: S,
      style: ge,
      to: d,
      viewTransition: m,
    },
    typeof p == "function" ? p(he) : p,
  );
});
eg.displayName = "NavLink";
var tg = R.forwardRef(
  (
    {
      discover: n = "render",
      fetcherKey: o,
      navigate: i,
      reloadDocument: s,
      replace: c,
      state: f,
      method: d = Ea,
      action: m,
      onSubmit: p,
      relative: y,
      preventScrollReset: S,
      viewTransition: v,
      unstable_defaultShouldRevalidate: k,
      ...M
    },
    F,
  ) => {
    let { unstable_useTransitions: z } = R.useContext(Lt),
      _ = ig(),
      B = ug(m, { relative: y }),
      j = d.toLowerCase() === "get" ? "get" : "post",
      K = typeof m == "string" && oh.test(m),
      Y = (J) => {
        if ((p && p(J), J.defaultPrevented)) return;
        J.preventDefault();
        let Z = J.nativeEvent.submitter,
          he = Z?.getAttribute("formmethod") || d,
          L = () =>
            _(Z || J.currentTarget, {
              fetcherKey: o,
              method: he,
              navigate: i,
              replace: c,
              state: f,
              relative: y,
              preventScrollReset: S,
              viewTransition: v,
              unstable_defaultShouldRevalidate: k,
            });
        z && i !== !1 ? R.startTransition(() => L()) : L();
      };
    return R.createElement("form", {
      ref: F,
      method: j,
      action: B,
      onSubmit: s ? p : Y,
      ...M,
      "data-discover": !K && n === "render" ? "true" : void 0,
    });
  },
);
tg.displayName = "Form";
function rg({ getKey: n, storageKey: o, ...i }) {
  let s = R.useContext(Da),
    { basename: c } = R.useContext(Lt),
    f = rr(),
    d = Yu();
  sg({ getKey: n, storageKey: o });
  let m = R.useMemo(() => {
    if (!s || !n) return null;
    let y = ju(f, d, c, n);
    return y !== f.key ? y : null;
  }, []);
  if (!s || s.isSpaMode) return null;
  let p = ((y, S) => {
    if (!window.history.state || !window.history.state.key) {
      let v = Math.random().toString(32).slice(2);
      window.history.replaceState({ key: v }, "");
    }
    try {
      let k = JSON.parse(sessionStorage.getItem(y) || "{}")[
        S || window.history.state.key
      ];
      typeof k == "number" && window.scrollTo(0, k);
    } catch (v) {
      (console.error(v), sessionStorage.removeItem(y));
    }
  }).toString();
  return R.createElement("script", {
    ...i,
    suppressHydrationWarning: !0,
    dangerouslySetInnerHTML: {
      __html: `(${p})(${Ou(JSON.stringify(o || Iu))}, ${Ou(JSON.stringify(m))})`,
    },
  });
}
rg.displayName = "ScrollRestoration";
function ih(n) {
  return `${n} must be used within a data router.  See https://reactrouter.com/en/main/routers/picking-a-router.`;
}
function bu(n) {
  let o = R.useContext(Sn);
  return (Ce(o, ih(n)), o);
}
function ng(n) {
  let o = R.useContext(rl);
  return (Ce(o, ih(n)), o);
}
function lg(
  n,
  {
    target: o,
    replace: i,
    unstable_mask: s,
    state: c,
    preventScrollReset: f,
    relative: d,
    viewTransition: m,
    unstable_defaultShouldRevalidate: p,
    unstable_useTransitions: y,
  } = {},
) {
  let S = my(),
    v = rr(),
    k = ro(n, { relative: d });
  return R.useCallback(
    (M) => {
      if (Wy(M, o)) {
        M.preventDefault();
        let F = i !== void 0 ? i : er(v) === er(k),
          z = () =>
            S(n, {
              replace: F,
              unstable_mask: s,
              state: c,
              preventScrollReset: f,
              relative: d,
              viewTransition: m,
              unstable_defaultShouldRevalidate: p,
            });
        y ? R.startTransition(() => z()) : z();
      }
    },
    [v, S, k, i, s, c, o, n, f, d, m, p, y],
  );
}
var og = 0,
  ag = () => `__${String(++og)}__`;
function ig() {
  let { router: n } = bu("useSubmit"),
    { basename: o } = R.useContext(Lt),
    i = Ly(),
    s = n.fetch,
    c = n.navigate;
  return R.useCallback(
    async (f, d = {}) => {
      let { action: m, method: p, encType: y, formData: S, body: v } = Yy(f, o);
      if (d.navigate === !1) {
        let k = d.fetcherKey || ag();
        await s(k, i, d.action || m, {
          unstable_defaultShouldRevalidate: d.unstable_defaultShouldRevalidate,
          preventScrollReset: d.preventScrollReset,
          formData: S,
          body: v,
          formMethod: d.method || p,
          formEncType: d.encType || y,
          flushSync: d.flushSync,
        });
      } else
        await c(d.action || m, {
          unstable_defaultShouldRevalidate: d.unstable_defaultShouldRevalidate,
          preventScrollReset: d.preventScrollReset,
          formData: S,
          body: v,
          formMethod: d.method || p,
          formEncType: d.encType || y,
          replace: d.replace,
          state: d.state,
          fromRouteId: i,
          flushSync: d.flushSync,
          viewTransition: d.viewTransition,
        });
    },
    [s, c, o, i],
  );
}
function ug(n, { relative: o } = {}) {
  let { basename: i } = R.useContext(Lt),
    s = R.useContext(tr);
  Ce(s, "useFormAction must be used inside a RouteContext");
  let [c] = s.matches.slice(-1),
    f = { ...ro(n || ".", { relative: o }) },
    d = rr();
  if (n == null) {
    f.search = d.search;
    let m = new URLSearchParams(f.search),
      p = m.getAll("index");
    if (p.some((S) => S === "")) {
      (m.delete("index"),
        p.filter((v) => v).forEach((v) => m.append("index", v)));
      let S = m.toString();
      f.search = S ? `?${S}` : "";
    }
  }
  return (
    (!n || n === ".") &&
      c.route.index &&
      (f.search = f.search ? f.search.replace(/^\?/, "?index&") : "?index"),
    i !== "/" && (f.pathname = f.pathname === "/" ? i : bt([i, f.pathname])),
    er(f)
  );
}
var Iu = "react-router-scroll-positions",
  wa = {};
function ju(n, o, i, s) {
  let c = null;
  return (
    s &&
      (i !== "/"
        ? (c = s({ ...n, pathname: Ot(n.pathname, i) || n.pathname }, o))
        : (c = s(n, o))),
    c == null && (c = n.key),
    c
  );
}
function sg({ getKey: n, storageKey: o } = {}) {
  let { router: i } = bu("useScrollRestoration"),
    { restoreScrollPosition: s, preventScrollReset: c } = ng(
      "useScrollRestoration",
    ),
    { basename: f } = R.useContext(Lt),
    d = rr(),
    m = Yu(),
    p = _y();
  (R.useEffect(
    () => (
      (window.history.scrollRestoration = "manual"),
      () => {
        window.history.scrollRestoration = "auto";
      }
    ),
    [],
  ),
    cg(
      R.useCallback(() => {
        if (p.state === "idle") {
          let y = ju(d, m, f, n);
          wa[y] = window.scrollY;
        }
        try {
          sessionStorage.setItem(o || Iu, JSON.stringify(wa));
        } catch (y) {
          Je(
            !1,
            `Failed to save scroll positions in sessionStorage, <ScrollRestoration /> will not work properly (${y}).`,
          );
        }
        window.history.scrollRestoration = "auto";
      }, [p.state, n, f, d, m, o]),
    ),
    typeof document < "u" &&
      (R.useLayoutEffect(() => {
        try {
          let y = sessionStorage.getItem(o || Iu);
          y && (wa = JSON.parse(y));
        } catch {}
      }, [o]),
      R.useLayoutEffect(() => {
        let y = i?.enableScrollRestoration(
          wa,
          () => window.scrollY,
          n ? (S, v) => ju(S, v, f, n) : void 0,
        );
        return () => y && y();
      }, [i, f, n]),
      R.useLayoutEffect(() => {
        if (s !== !1) {
          if (typeof s == "number") {
            window.scrollTo(0, s);
            return;
          }
          try {
            if (d.hash) {
              let y = document.getElementById(
                decodeURIComponent(d.hash.slice(1)),
              );
              if (y) {
                y.scrollIntoView();
                return;
              }
            }
          } catch {
            Je(
              !1,
              `"${d.hash.slice(1)}" is not a decodable element ID. The view will not scroll to it.`,
            );
          }
          c !== !0 && window.scrollTo(0, 0);
        }
      }, [d, s, c])));
}
function cg(n, o) {
  let { capture: i } = {};
  R.useEffect(() => {
    let s = i != null ? { capture: i } : void 0;
    return (
      window.addEventListener("pagehide", n, s),
      () => {
        window.removeEventListener("pagehide", n, s);
      }
    );
  }, [n, i]);
}
function fg(n, { relative: o } = {}) {
  let i = R.useContext(Wu);
  Ce(
    i != null,
    "`useViewTransitionState` must be used within `react-router-dom`'s `RouterProvider`.  Did you accidentally import `RouterProvider` from `react-router`?",
  );
  let { basename: s } = bu("useViewTransitionState"),
    c = ro(n, { relative: o });
  if (!i.isTransitioning) return !1;
  let f = Ot(i.currentLocation.pathname, s) || i.currentLocation.pathname,
    d = Ot(i.nextLocation.pathname, s) || i.nextLocation.pathname;
  return xa(c.pathname, d) != null || xa(c.pathname, f) != null;
}
var dg = Gp();
const Tg = sd(dg);
export {
  Tg as A,
  qp as B,
  rn as E,
  Da as F,
  Pg as L,
  Lg as M,
  vv as N,
  wg as O,
  Zp as R,
  rg as S,
  Gp as a,
  Ce as b,
  _g as c,
  gg as d,
  dg as e,
  Pv as f,
  Ju as g,
  mg as h,
  wn as i,
  hg as j,
  xg as k,
  Rg as l,
  kr as m,
  pg as n,
  kg as o,
  yg as p,
  vg as q,
  R as r,
  Uv as s,
  Eg as t,
  Cg as u,
  Gv as v,
  Sg as w,
  Ud as x,
  rr as y,
  ah as z,
};
