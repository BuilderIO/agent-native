import { R as a, a as dt, z as Ut } from "./index-BMHtNQid.js";
var Wt = (e) => {
    switch (e) {
      case "success":
        return qt;
      case "info":
        return Jt;
      case "warning":
        return Gt;
      case "error":
        return Qt;
      default:
        return null;
    }
  },
  Kt = Array(12).fill(0),
  Xt = ({ visible: e, className: r }) =>
    a.createElement(
      "div",
      {
        className: ["sonner-loading-wrapper", r].filter(Boolean).join(" "),
        "data-visible": e,
      },
      a.createElement(
        "div",
        { className: "sonner-spinner" },
        Kt.map((o, i) =>
          a.createElement("div", {
            className: "sonner-loading-bar",
            key: `spinner-bar-${i}`,
          }),
        ),
      ),
    ),
  qt = a.createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 20 20",
      fill: "currentColor",
      height: "20",
      width: "20",
    },
    a.createElement("path", {
      fillRule: "evenodd",
      d: "M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z",
      clipRule: "evenodd",
    }),
  ),
  Gt = a.createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 24 24",
      fill: "currentColor",
      height: "20",
      width: "20",
    },
    a.createElement("path", {
      fillRule: "evenodd",
      d: "M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z",
      clipRule: "evenodd",
    }),
  ),
  Jt = a.createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 20 20",
      fill: "currentColor",
      height: "20",
      width: "20",
    },
    a.createElement("path", {
      fillRule: "evenodd",
      d: "M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z",
      clipRule: "evenodd",
    }),
  ),
  Qt = a.createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 20 20",
      fill: "currentColor",
      height: "20",
      width: "20",
    },
    a.createElement("path", {
      fillRule: "evenodd",
      d: "M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z",
      clipRule: "evenodd",
    }),
  ),
  Zt = a.createElement(
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
    a.createElement("line", { x1: "18", y1: "6", x2: "6", y2: "18" }),
    a.createElement("line", { x1: "6", y1: "6", x2: "18", y2: "18" }),
  ),
  _t = () => {
    let [e, r] = a.useState(document.hidden);
    return (
      a.useEffect(() => {
        let o = () => {
          r(document.hidden);
        };
        return (
          document.addEventListener("visibilitychange", o),
          () => window.removeEventListener("visibilitychange", o)
        );
      }, []),
      e
    );
  },
  wt = 1,
  te = class {
    constructor() {
      ((this.subscribe = (e) => (
        this.subscribers.push(e),
        () => {
          let r = this.subscribers.indexOf(e);
          this.subscribers.splice(r, 1);
        }
      )),
        (this.publish = (e) => {
          this.subscribers.forEach((r) => r(e));
        }),
        (this.addToast = (e) => {
          (this.publish(e), (this.toasts = [...this.toasts, e]));
        }),
        (this.create = (e) => {
          var r;
          let { message: o, ...i } = e,
            h =
              typeof e?.id == "number" ||
              ((r = e.id) == null ? void 0 : r.length) > 0
                ? e.id
                : wt++,
            w = this.toasts.find((b) => b.id === h),
            k = e.dismissible === void 0 ? !0 : e.dismissible;
          return (
            this.dismissedToasts.has(h) && this.dismissedToasts.delete(h),
            w
              ? (this.toasts = this.toasts.map((b) =>
                  b.id === h
                    ? (this.publish({ ...b, ...e, id: h, title: o }),
                      { ...b, ...e, id: h, dismissible: k, title: o })
                    : b,
                ))
              : this.addToast({ title: o, ...i, dismissible: k, id: h }),
            h
          );
        }),
        (this.dismiss = (e) => (
          this.dismissedToasts.add(e),
          e ||
            this.toasts.forEach((r) => {
              this.subscribers.forEach((o) => o({ id: r.id, dismiss: !0 }));
            }),
          this.subscribers.forEach((r) => r({ id: e, dismiss: !0 })),
          e
        )),
        (this.message = (e, r) => this.create({ ...r, message: e })),
        (this.error = (e, r) =>
          this.create({ ...r, message: e, type: "error" })),
        (this.success = (e, r) =>
          this.create({ ...r, type: "success", message: e })),
        (this.info = (e, r) => this.create({ ...r, type: "info", message: e })),
        (this.warning = (e, r) =>
          this.create({ ...r, type: "warning", message: e })),
        (this.loading = (e, r) =>
          this.create({ ...r, type: "loading", message: e })),
        (this.promise = (e, r) => {
          if (!r) return;
          let o;
          r.loading !== void 0 &&
            (o = this.create({
              ...r,
              promise: e,
              type: "loading",
              message: r.loading,
              description:
                typeof r.description != "function" ? r.description : void 0,
            }));
          let i = e instanceof Promise ? e : e(),
            h = o !== void 0,
            w,
            k = i
              .then(async (c) => {
                if (((w = ["resolve", c]), a.isValidElement(c)))
                  ((h = !1),
                    this.create({ id: o, type: "default", message: c }));
                else if (ae(c) && !c.ok) {
                  h = !1;
                  let m =
                      typeof r.error == "function"
                        ? await r.error(`HTTP error! status: ${c.status}`)
                        : r.error,
                    y =
                      typeof r.description == "function"
                        ? await r.description(`HTTP error! status: ${c.status}`)
                        : r.description;
                  this.create({
                    id: o,
                    type: "error",
                    message: m,
                    description: y,
                  });
                } else if (r.success !== void 0) {
                  h = !1;
                  let m =
                      typeof r.success == "function"
                        ? await r.success(c)
                        : r.success,
                    y =
                      typeof r.description == "function"
                        ? await r.description(c)
                        : r.description;
                  this.create({
                    id: o,
                    type: "success",
                    message: m,
                    description: y,
                  });
                }
              })
              .catch(async (c) => {
                if (((w = ["reject", c]), r.error !== void 0)) {
                  h = !1;
                  let m =
                      typeof r.error == "function" ? await r.error(c) : r.error,
                    y =
                      typeof r.description == "function"
                        ? await r.description(c)
                        : r.description;
                  this.create({
                    id: o,
                    type: "error",
                    message: m,
                    description: y,
                  });
                }
              })
              .finally(() => {
                var c;
                (h && (this.dismiss(o), (o = void 0)),
                  (c = r.finally) == null || c.call(r));
              }),
            b = () =>
              new Promise((c, m) =>
                k.then(() => (w[0] === "reject" ? m(w[1]) : c(w[1]))).catch(m),
              );
          return typeof o != "string" && typeof o != "number"
            ? { unwrap: b }
            : Object.assign(o, { unwrap: b });
        }),
        (this.custom = (e, r) => {
          let o = r?.id || wt++;
          return (this.create({ jsx: e(o), id: o, ...r }), o);
        }),
        (this.getActiveToasts = () =>
          this.toasts.filter((e) => !this.dismissedToasts.has(e.id))),
        (this.subscribers = []),
        (this.toasts = []),
        (this.dismissedToasts = new Set()));
    }
  },
  E = new te(),
  ee = (e, r) => {
    let o = r?.id || wt++;
    return (E.addToast({ title: e, ...r, id: o }), o);
  },
  ae = (e) =>
    e &&
    typeof e == "object" &&
    "ok" in e &&
    typeof e.ok == "boolean" &&
    "status" in e &&
    typeof e.status == "number",
  re = ee,
  oe = () => E.toasts,
  ne = () => E.getActiveToasts(),
  be = Object.assign(
    re,
    {
      success: E.success,
      info: E.info,
      warning: E.warning,
      error: E.error,
      custom: E.custom,
      message: E.message,
      promise: E.promise,
      dismiss: E.dismiss,
      loading: E.loading,
    },
    { getHistory: oe, getToasts: ne },
  );
function se(e, { insertAt: r } = {}) {
  if (typeof document > "u") return;
  let o = document.head || document.getElementsByTagName("head")[0],
    i = document.createElement("style");
  ((i.type = "text/css"),
    r === "top" && o.firstChild
      ? o.insertBefore(i, o.firstChild)
      : o.appendChild(i),
    i.styleSheet
      ? (i.styleSheet.cssText = e)
      : i.appendChild(document.createTextNode(e)));
}
se(`:where(html[dir="ltr"]),:where([data-sonner-toaster][dir="ltr"]){--toast-icon-margin-start: -3px;--toast-icon-margin-end: 4px;--toast-svg-margin-start: -1px;--toast-svg-margin-end: 0px;--toast-button-margin-start: auto;--toast-button-margin-end: 0;--toast-close-button-start: 0;--toast-close-button-end: unset;--toast-close-button-transform: translate(-35%, -35%)}:where(html[dir="rtl"]),:where([data-sonner-toaster][dir="rtl"]){--toast-icon-margin-start: 4px;--toast-icon-margin-end: -3px;--toast-svg-margin-start: 0px;--toast-svg-margin-end: -1px;--toast-button-margin-start: 0;--toast-button-margin-end: auto;--toast-close-button-start: unset;--toast-close-button-end: 0;--toast-close-button-transform: translate(35%, -35%)}:where([data-sonner-toaster]){position:fixed;width:var(--width);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,Noto Sans,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol,Noto Color Emoji;--gray1: hsl(0, 0%, 99%);--gray2: hsl(0, 0%, 97.3%);--gray3: hsl(0, 0%, 95.1%);--gray4: hsl(0, 0%, 93%);--gray5: hsl(0, 0%, 90.9%);--gray6: hsl(0, 0%, 88.7%);--gray7: hsl(0, 0%, 85.8%);--gray8: hsl(0, 0%, 78%);--gray9: hsl(0, 0%, 56.1%);--gray10: hsl(0, 0%, 52.3%);--gray11: hsl(0, 0%, 43.5%);--gray12: hsl(0, 0%, 9%);--border-radius: 8px;box-sizing:border-box;padding:0;margin:0;list-style:none;outline:none;z-index:999999999;transition:transform .4s ease}:where([data-sonner-toaster][data-lifted="true"]){transform:translateY(-10px)}@media (hover: none) and (pointer: coarse){:where([data-sonner-toaster][data-lifted="true"]){transform:none}}:where([data-sonner-toaster][data-x-position="right"]){right:var(--offset-right)}:where([data-sonner-toaster][data-x-position="left"]){left:var(--offset-left)}:where([data-sonner-toaster][data-x-position="center"]){left:50%;transform:translate(-50%)}:where([data-sonner-toaster][data-y-position="top"]){top:var(--offset-top)}:where([data-sonner-toaster][data-y-position="bottom"]){bottom:var(--offset-bottom)}:where([data-sonner-toast]){--y: translateY(100%);--lift-amount: calc(var(--lift) * var(--gap));z-index:var(--z-index);position:absolute;opacity:0;transform:var(--y);filter:blur(0);touch-action:none;transition:transform .4s,opacity .4s,height .4s,box-shadow .2s;box-sizing:border-box;outline:none;overflow-wrap:anywhere}:where([data-sonner-toast][data-styled="true"]){padding:16px;background:var(--normal-bg);border:1px solid var(--normal-border);color:var(--normal-text);border-radius:var(--border-radius);box-shadow:0 4px 12px #0000001a;width:var(--width);font-size:13px;display:flex;align-items:center;gap:6px}:where([data-sonner-toast]:focus-visible){box-shadow:0 4px 12px #0000001a,0 0 0 2px #0003}:where([data-sonner-toast][data-y-position="top"]){top:0;--y: translateY(-100%);--lift: 1;--lift-amount: calc(1 * var(--gap))}:where([data-sonner-toast][data-y-position="bottom"]){bottom:0;--y: translateY(100%);--lift: -1;--lift-amount: calc(var(--lift) * var(--gap))}:where([data-sonner-toast]) :where([data-description]){font-weight:400;line-height:1.4;color:inherit}:where([data-sonner-toast]) :where([data-title]){font-weight:500;line-height:1.5;color:inherit}:where([data-sonner-toast]) :where([data-icon]){display:flex;height:16px;width:16px;position:relative;justify-content:flex-start;align-items:center;flex-shrink:0;margin-left:var(--toast-icon-margin-start);margin-right:var(--toast-icon-margin-end)}:where([data-sonner-toast][data-promise="true"]) :where([data-icon])>svg{opacity:0;transform:scale(.8);transform-origin:center;animation:sonner-fade-in .3s ease forwards}:where([data-sonner-toast]) :where([data-icon])>*{flex-shrink:0}:where([data-sonner-toast]) :where([data-icon]) svg{margin-left:var(--toast-svg-margin-start);margin-right:var(--toast-svg-margin-end)}:where([data-sonner-toast]) :where([data-content]){display:flex;flex-direction:column;gap:2px}[data-sonner-toast][data-styled=true] [data-button]{border-radius:4px;padding-left:8px;padding-right:8px;height:24px;font-size:12px;color:var(--normal-bg);background:var(--normal-text);margin-left:var(--toast-button-margin-start);margin-right:var(--toast-button-margin-end);border:none;cursor:pointer;outline:none;display:flex;align-items:center;flex-shrink:0;transition:opacity .4s,box-shadow .2s}:where([data-sonner-toast]) :where([data-button]):focus-visible{box-shadow:0 0 0 2px #0006}:where([data-sonner-toast]) :where([data-button]):first-of-type{margin-left:var(--toast-button-margin-start);margin-right:var(--toast-button-margin-end)}:where([data-sonner-toast]) :where([data-cancel]){color:var(--normal-text);background:rgba(0,0,0,.08)}:where([data-sonner-toast][data-theme="dark"]) :where([data-cancel]){background:rgba(255,255,255,.3)}:where([data-sonner-toast]) :where([data-close-button]){position:absolute;left:var(--toast-close-button-start);right:var(--toast-close-button-end);top:0;height:20px;width:20px;display:flex;justify-content:center;align-items:center;padding:0;color:var(--gray12);border:1px solid var(--gray4);transform:var(--toast-close-button-transform);border-radius:50%;cursor:pointer;z-index:1;transition:opacity .1s,background .2s,border-color .2s}[data-sonner-toast] [data-close-button]{background:var(--gray1)}:where([data-sonner-toast]) :where([data-close-button]):focus-visible{box-shadow:0 4px 12px #0000001a,0 0 0 2px #0003}:where([data-sonner-toast]) :where([data-disabled="true"]){cursor:not-allowed}:where([data-sonner-toast]):hover :where([data-close-button]):hover{background:var(--gray2);border-color:var(--gray5)}:where([data-sonner-toast][data-swiping="true"]):before{content:"";position:absolute;left:-50%;right:-50%;height:100%;z-index:-1}:where([data-sonner-toast][data-y-position="top"][data-swiping="true"]):before{bottom:50%;transform:scaleY(3) translateY(50%)}:where([data-sonner-toast][data-y-position="bottom"][data-swiping="true"]):before{top:50%;transform:scaleY(3) translateY(-50%)}:where([data-sonner-toast][data-swiping="false"][data-removed="true"]):before{content:"";position:absolute;inset:0;transform:scaleY(2)}:where([data-sonner-toast]):after{content:"";position:absolute;left:0;height:calc(var(--gap) + 1px);bottom:100%;width:100%}:where([data-sonner-toast][data-mounted="true"]){--y: translateY(0);opacity:1}:where([data-sonner-toast][data-expanded="false"][data-front="false"]){--scale: var(--toasts-before) * .05 + 1;--y: translateY(calc(var(--lift-amount) * var(--toasts-before))) scale(calc(-1 * var(--scale)));height:var(--front-toast-height)}:where([data-sonner-toast])>*{transition:opacity .4s}:where([data-sonner-toast][data-expanded="false"][data-front="false"][data-styled="true"])>*{opacity:0}:where([data-sonner-toast][data-visible="false"]){opacity:0;pointer-events:none}:where([data-sonner-toast][data-mounted="true"][data-expanded="true"]){--y: translateY(calc(var(--lift) * var(--offset)));height:var(--initial-height)}:where([data-sonner-toast][data-removed="true"][data-front="true"][data-swipe-out="false"]){--y: translateY(calc(var(--lift) * -100%));opacity:0}:where([data-sonner-toast][data-removed="true"][data-front="false"][data-swipe-out="false"][data-expanded="true"]){--y: translateY(calc(var(--lift) * var(--offset) + var(--lift) * -100%));opacity:0}:where([data-sonner-toast][data-removed="true"][data-front="false"][data-swipe-out="false"][data-expanded="false"]){--y: translateY(40%);opacity:0;transition:transform .5s,opacity .2s}:where([data-sonner-toast][data-removed="true"][data-front="false"]):before{height:calc(var(--initial-height) + 20%)}[data-sonner-toast][data-swiping=true]{transform:var(--y) translateY(var(--swipe-amount-y, 0px)) translate(var(--swipe-amount-x, 0px));transition:none}[data-sonner-toast][data-swiped=true]{user-select:none}[data-sonner-toast][data-swipe-out=true][data-y-position=bottom],[data-sonner-toast][data-swipe-out=true][data-y-position=top]{animation-duration:.2s;animation-timing-function:ease-out;animation-fill-mode:forwards}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=left]{animation-name:swipe-out-left}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=right]{animation-name:swipe-out-right}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=up]{animation-name:swipe-out-up}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=down]{animation-name:swipe-out-down}@keyframes swipe-out-left{0%{transform:var(--y) translate(var(--swipe-amount-x));opacity:1}to{transform:var(--y) translate(calc(var(--swipe-amount-x) - 100%));opacity:0}}@keyframes swipe-out-right{0%{transform:var(--y) translate(var(--swipe-amount-x));opacity:1}to{transform:var(--y) translate(calc(var(--swipe-amount-x) + 100%));opacity:0}}@keyframes swipe-out-up{0%{transform:var(--y) translateY(var(--swipe-amount-y));opacity:1}to{transform:var(--y) translateY(calc(var(--swipe-amount-y) - 100%));opacity:0}}@keyframes swipe-out-down{0%{transform:var(--y) translateY(var(--swipe-amount-y));opacity:1}to{transform:var(--y) translateY(calc(var(--swipe-amount-y) + 100%));opacity:0}}@media (max-width: 600px){[data-sonner-toaster]{position:fixed;right:var(--mobile-offset-right);left:var(--mobile-offset-left);width:100%}[data-sonner-toaster][dir=rtl]{left:calc(var(--mobile-offset-left) * -1)}[data-sonner-toaster] [data-sonner-toast]{left:0;right:0;width:calc(100% - var(--mobile-offset-left) * 2)}[data-sonner-toaster][data-x-position=left]{left:var(--mobile-offset-left)}[data-sonner-toaster][data-y-position=bottom]{bottom:var(--mobile-offset-bottom)}[data-sonner-toaster][data-y-position=top]{top:var(--mobile-offset-top)}[data-sonner-toaster][data-x-position=center]{left:var(--mobile-offset-left);right:var(--mobile-offset-right);transform:none}}[data-sonner-toaster][data-theme=light]{--normal-bg: #fff;--normal-border: var(--gray4);--normal-text: var(--gray12);--success-bg: hsl(143, 85%, 96%);--success-border: hsl(145, 92%, 91%);--success-text: hsl(140, 100%, 27%);--info-bg: hsl(208, 100%, 97%);--info-border: hsl(221, 91%, 91%);--info-text: hsl(210, 92%, 45%);--warning-bg: hsl(49, 100%, 97%);--warning-border: hsl(49, 91%, 91%);--warning-text: hsl(31, 92%, 45%);--error-bg: hsl(359, 100%, 97%);--error-border: hsl(359, 100%, 94%);--error-text: hsl(360, 100%, 45%)}[data-sonner-toaster][data-theme=light] [data-sonner-toast][data-invert=true]{--normal-bg: #000;--normal-border: hsl(0, 0%, 20%);--normal-text: var(--gray1)}[data-sonner-toaster][data-theme=dark] [data-sonner-toast][data-invert=true]{--normal-bg: #fff;--normal-border: var(--gray3);--normal-text: var(--gray12)}[data-sonner-toaster][data-theme=dark]{--normal-bg: #000;--normal-bg-hover: hsl(0, 0%, 12%);--normal-border: hsl(0, 0%, 20%);--normal-border-hover: hsl(0, 0%, 25%);--normal-text: var(--gray1);--success-bg: hsl(150, 100%, 6%);--success-border: hsl(147, 100%, 12%);--success-text: hsl(150, 86%, 65%);--info-bg: hsl(215, 100%, 6%);--info-border: hsl(223, 100%, 12%);--info-text: hsl(216, 87%, 65%);--warning-bg: hsl(64, 100%, 6%);--warning-border: hsl(60, 100%, 12%);--warning-text: hsl(46, 87%, 65%);--error-bg: hsl(358, 76%, 10%);--error-border: hsl(357, 89%, 16%);--error-text: hsl(358, 100%, 81%)}[data-sonner-toaster][data-theme=dark] [data-sonner-toast] [data-close-button]{background:var(--normal-bg);border-color:var(--normal-border);color:var(--normal-text)}[data-sonner-toaster][data-theme=dark] [data-sonner-toast] [data-close-button]:hover{background:var(--normal-bg-hover);border-color:var(--normal-border-hover)}[data-rich-colors=true][data-sonner-toast][data-type=success],[data-rich-colors=true][data-sonner-toast][data-type=success] [data-close-button]{background:var(--success-bg);border-color:var(--success-border);color:var(--success-text)}[data-rich-colors=true][data-sonner-toast][data-type=info],[data-rich-colors=true][data-sonner-toast][data-type=info] [data-close-button]{background:var(--info-bg);border-color:var(--info-border);color:var(--info-text)}[data-rich-colors=true][data-sonner-toast][data-type=warning],[data-rich-colors=true][data-sonner-toast][data-type=warning] [data-close-button]{background:var(--warning-bg);border-color:var(--warning-border);color:var(--warning-text)}[data-rich-colors=true][data-sonner-toast][data-type=error],[data-rich-colors=true][data-sonner-toast][data-type=error] [data-close-button]{background:var(--error-bg);border-color:var(--error-border);color:var(--error-text)}.sonner-loading-wrapper{--size: 16px;height:var(--size);width:var(--size);position:absolute;inset:0;z-index:10}.sonner-loading-wrapper[data-visible=false]{transform-origin:center;animation:sonner-fade-out .2s ease forwards}.sonner-spinner{position:relative;top:50%;left:50%;height:var(--size);width:var(--size)}.sonner-loading-bar{animation:sonner-spin 1.2s linear infinite;background:var(--gray11);border-radius:6px;height:8%;left:-10%;position:absolute;top:-3.9%;width:24%}.sonner-loading-bar:nth-child(1){animation-delay:-1.2s;transform:rotate(.0001deg) translate(146%)}.sonner-loading-bar:nth-child(2){animation-delay:-1.1s;transform:rotate(30deg) translate(146%)}.sonner-loading-bar:nth-child(3){animation-delay:-1s;transform:rotate(60deg) translate(146%)}.sonner-loading-bar:nth-child(4){animation-delay:-.9s;transform:rotate(90deg) translate(146%)}.sonner-loading-bar:nth-child(5){animation-delay:-.8s;transform:rotate(120deg) translate(146%)}.sonner-loading-bar:nth-child(6){animation-delay:-.7s;transform:rotate(150deg) translate(146%)}.sonner-loading-bar:nth-child(7){animation-delay:-.6s;transform:rotate(180deg) translate(146%)}.sonner-loading-bar:nth-child(8){animation-delay:-.5s;transform:rotate(210deg) translate(146%)}.sonner-loading-bar:nth-child(9){animation-delay:-.4s;transform:rotate(240deg) translate(146%)}.sonner-loading-bar:nth-child(10){animation-delay:-.3s;transform:rotate(270deg) translate(146%)}.sonner-loading-bar:nth-child(11){animation-delay:-.2s;transform:rotate(300deg) translate(146%)}.sonner-loading-bar:nth-child(12){animation-delay:-.1s;transform:rotate(330deg) translate(146%)}@keyframes sonner-fade-in{0%{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}}@keyframes sonner-fade-out{0%{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.8)}}@keyframes sonner-spin{0%{opacity:1}to{opacity:.15}}@media (prefers-reduced-motion){[data-sonner-toast],[data-sonner-toast]>*,.sonner-loading-bar{transition:none!important;animation:none!important}}.sonner-loader{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);transform-origin:center;transition:opacity .2s,transform .2s}.sonner-loader[data-visible=false]{opacity:0;transform:scale(.8) translate(-50%,-50%)}
`);
function lt(e) {
  return e.label !== void 0;
}
var ie = 3,
  le = "32px",
  de = "16px",
  Ct = 4e3,
  ce = 356,
  ue = 14,
  me = 20,
  fe = 200;
function R(...e) {
  return e.filter(Boolean).join(" ");
}
function he(e) {
  let [r, o] = e.split("-"),
    i = [];
  return (r && i.push(r), o && i.push(o), i);
}
var pe = (e) => {
  var r, o, i, h, w, k, b, c, m, y, Z;
  let {
      invert: ct,
      toast: t,
      unstyled: ut,
      interacting: v,
      setHeights: z,
      visibleToasts: _,
      heights: O,
      index: Y,
      toasts: mt,
      expanded: X,
      removeToast: S,
      defaultRichColors: q,
      closeButton: tt,
      style: et,
      cancelButtonStyle: ft,
      actionButtonStyle: at,
      className: j = "",
      descriptionClassName: rt = "",
      duration: V,
      position: ot,
      gap: H,
      loadingIcon: I,
      expandByDefault: nt,
      classNames: s,
      icons: N,
      closeButtonAriaLabel: ht = "Close toast",
      pauseWhenPageIsHidden: d,
    } = e,
    [u, p] = a.useState(null),
    [x, F] = a.useState(null),
    [g, pt] = a.useState(!1),
    [G, st] = a.useState(!1),
    [J, gt] = a.useState(!1),
    [xt, zt] = a.useState(!1),
    [jt, Et] = a.useState(!1),
    [It, vt] = a.useState(0),
    [Yt, kt] = a.useState(0),
    Q = a.useRef(t.duration || V || Ct),
    Nt = a.useRef(null),
    L = a.useRef(null),
    $t = Y === 0,
    Dt = Y + 1 <= _,
    T = t.type,
    U = t.dismissible !== !1,
    Pt = t.className || "",
    Ht = t.descriptionClassName || "",
    it = a.useMemo(
      () => O.findIndex((n) => n.toastId === t.id) || 0,
      [O, t.id],
    ),
    Lt = a.useMemo(() => {
      var n;
      return (n = t.closeButton) != null ? n : tt;
    }, [t.closeButton, tt]),
    Tt = a.useMemo(() => t.duration || V || Ct, [t.duration, V]),
    bt = a.useRef(0),
    W = a.useRef(0),
    St = a.useRef(0),
    K = a.useRef(null),
    [At, Ot] = ot.split("-"),
    Bt = a.useMemo(
      () => O.reduce((n, l, f) => (f >= it ? n : n + l.height), 0),
      [O, it],
    ),
    Mt = _t(),
    Vt = t.invert || ct,
    yt = T === "loading";
  ((W.current = a.useMemo(() => it * H + Bt, [it, Bt])),
    a.useEffect(() => {
      Q.current = Tt;
    }, [Tt]),
    a.useEffect(() => {
      pt(!0);
    }, []),
    a.useEffect(() => {
      let n = L.current;
      if (n) {
        let l = n.getBoundingClientRect().height;
        return (
          kt(l),
          z((f) => [{ toastId: t.id, height: l, position: t.position }, ...f]),
          () => z((f) => f.filter((B) => B.toastId !== t.id))
        );
      }
    }, [z, t.id]),
    a.useLayoutEffect(() => {
      if (!g) return;
      let n = L.current,
        l = n.style.height;
      n.style.height = "auto";
      let f = n.getBoundingClientRect().height;
      ((n.style.height = l),
        kt(f),
        z((B) =>
          B.find((M) => M.toastId === t.id)
            ? B.map((M) => (M.toastId === t.id ? { ...M, height: f } : M))
            : [{ toastId: t.id, height: f, position: t.position }, ...B],
        ));
    }, [g, t.title, t.description, z, t.id]));
  let $ = a.useCallback(() => {
    (st(!0),
      vt(W.current),
      z((n) => n.filter((l) => l.toastId !== t.id)),
      setTimeout(() => {
        S(t);
      }, fe));
  }, [t, S, z, W]);
  (a.useEffect(() => {
    if (
      (t.promise && T === "loading") ||
      t.duration === 1 / 0 ||
      t.type === "loading"
    )
      return;
    let n;
    return (
      X || v || (d && Mt)
        ? (() => {
            if (St.current < bt.current) {
              let l = new Date().getTime() - bt.current;
              Q.current = Q.current - l;
            }
            St.current = new Date().getTime();
          })()
        : Q.current !== 1 / 0 &&
          ((bt.current = new Date().getTime()),
          (n = setTimeout(() => {
            var l;
            ((l = t.onAutoClose) == null || l.call(t, t), $());
          }, Q.current))),
      () => clearTimeout(n)
    );
  }, [X, v, t, T, d, Mt, $]),
    a.useEffect(() => {
      t.delete && $();
    }, [$, t.delete]));
  function Ft() {
    var n, l, f;
    return N != null && N.loading
      ? a.createElement(
          "div",
          {
            className: R(
              s?.loader,
              (n = t?.classNames) == null ? void 0 : n.loader,
              "sonner-loader",
            ),
            "data-visible": T === "loading",
          },
          N.loading,
        )
      : I
        ? a.createElement(
            "div",
            {
              className: R(
                s?.loader,
                (l = t?.classNames) == null ? void 0 : l.loader,
                "sonner-loader",
              ),
              "data-visible": T === "loading",
            },
            I,
          )
        : a.createElement(Xt, {
            className: R(
              s?.loader,
              (f = t?.classNames) == null ? void 0 : f.loader,
            ),
            visible: T === "loading",
          });
  }
  return a.createElement(
    "li",
    {
      tabIndex: 0,
      ref: L,
      className: R(
        j,
        Pt,
        s?.toast,
        (r = t?.classNames) == null ? void 0 : r.toast,
        s?.default,
        s?.[T],
        (o = t?.classNames) == null ? void 0 : o[T],
      ),
      "data-sonner-toast": "",
      "data-rich-colors": (i = t.richColors) != null ? i : q,
      "data-styled": !(t.jsx || t.unstyled || ut),
      "data-mounted": g,
      "data-promise": !!t.promise,
      "data-swiped": jt,
      "data-removed": G,
      "data-visible": Dt,
      "data-y-position": At,
      "data-x-position": Ot,
      "data-index": Y,
      "data-front": $t,
      "data-swiping": J,
      "data-dismissible": U,
      "data-type": T,
      "data-invert": Vt,
      "data-swipe-out": xt,
      "data-swipe-direction": x,
      "data-expanded": !!(X || (nt && g)),
      style: {
        "--index": Y,
        "--toasts-before": Y,
        "--z-index": mt.length - Y,
        "--offset": `${G ? It : W.current}px`,
        "--initial-height": nt ? "auto" : `${Yt}px`,
        ...et,
        ...t.style,
      },
      onDragEnd: () => {
        (gt(!1), p(null), (K.current = null));
      },
      onPointerDown: (n) => {
        yt ||
          !U ||
          ((Nt.current = new Date()),
          vt(W.current),
          n.target.setPointerCapture(n.pointerId),
          n.target.tagName !== "BUTTON" &&
            (gt(!0), (K.current = { x: n.clientX, y: n.clientY })));
      },
      onPointerUp: () => {
        var n, l, f, B;
        if (xt || !U) return;
        K.current = null;
        let M = Number(
            ((n = L.current) == null
              ? void 0
              : n.style
                  .getPropertyValue("--swipe-amount-x")
                  .replace("px", "")) || 0,
          ),
          D = Number(
            ((l = L.current) == null
              ? void 0
              : l.style
                  .getPropertyValue("--swipe-amount-y")
                  .replace("px", "")) || 0,
          ),
          A =
            new Date().getTime() -
            ((f = Nt.current) == null ? void 0 : f.getTime()),
          C = u === "x" ? M : D,
          P = Math.abs(C) / A;
        if (Math.abs(C) >= me || P > 0.11) {
          (vt(W.current),
            (B = t.onDismiss) == null || B.call(t, t),
            F(u === "x" ? (M > 0 ? "right" : "left") : D > 0 ? "down" : "up"),
            $(),
            zt(!0),
            Et(!1));
          return;
        }
        (gt(!1), p(null));
      },
      onPointerMove: (n) => {
        var l, f, B, M;
        if (
          !K.current ||
          !U ||
          ((l = window.getSelection()) == null ? void 0 : l.toString().length) >
            0
        )
          return;
        let D = n.clientY - K.current.y,
          A = n.clientX - K.current.x,
          C = (f = e.swipeDirections) != null ? f : he(ot);
        !u &&
          (Math.abs(A) > 1 || Math.abs(D) > 1) &&
          p(Math.abs(A) > Math.abs(D) ? "x" : "y");
        let P = { x: 0, y: 0 };
        (u === "y"
          ? (C.includes("top") || C.includes("bottom")) &&
            ((C.includes("top") && D < 0) || (C.includes("bottom") && D > 0)) &&
            (P.y = D)
          : u === "x" &&
            (C.includes("left") || C.includes("right")) &&
            ((C.includes("left") && A < 0) || (C.includes("right") && A > 0)) &&
            (P.x = A),
          (Math.abs(P.x) > 0 || Math.abs(P.y) > 0) && Et(!0),
          (B = L.current) == null ||
            B.style.setProperty("--swipe-amount-x", `${P.x}px`),
          (M = L.current) == null ||
            M.style.setProperty("--swipe-amount-y", `${P.y}px`));
      },
    },
    Lt && !t.jsx
      ? a.createElement(
          "button",
          {
            "aria-label": ht,
            "data-disabled": yt,
            "data-close-button": !0,
            onClick:
              yt || !U
                ? () => {}
                : () => {
                    var n;
                    ($(), (n = t.onDismiss) == null || n.call(t, t));
                  },
            className: R(
              s?.closeButton,
              (h = t?.classNames) == null ? void 0 : h.closeButton,
            ),
          },
          (w = N?.close) != null ? w : Zt,
        )
      : null,
    t.jsx || dt.isValidElement(t.title)
      ? t.jsx
        ? t.jsx
        : typeof t.title == "function"
          ? t.title()
          : t.title
      : a.createElement(
          a.Fragment,
          null,
          T || t.icon || t.promise
            ? a.createElement(
                "div",
                {
                  "data-icon": "",
                  className: R(
                    s?.icon,
                    (k = t?.classNames) == null ? void 0 : k.icon,
                  ),
                },
                t.promise || (t.type === "loading" && !t.icon)
                  ? t.icon || Ft()
                  : null,
                t.type !== "loading" ? t.icon || N?.[T] || Wt(T) : null,
              )
            : null,
          a.createElement(
            "div",
            {
              "data-content": "",
              className: R(
                s?.content,
                (b = t?.classNames) == null ? void 0 : b.content,
              ),
            },
            a.createElement(
              "div",
              {
                "data-title": "",
                className: R(
                  s?.title,
                  (c = t?.classNames) == null ? void 0 : c.title,
                ),
              },
              typeof t.title == "function" ? t.title() : t.title,
            ),
            t.description
              ? a.createElement(
                  "div",
                  {
                    "data-description": "",
                    className: R(
                      rt,
                      Ht,
                      s?.description,
                      (m = t?.classNames) == null ? void 0 : m.description,
                    ),
                  },
                  typeof t.description == "function"
                    ? t.description()
                    : t.description,
                )
              : null,
          ),
          dt.isValidElement(t.cancel)
            ? t.cancel
            : t.cancel && lt(t.cancel)
              ? a.createElement(
                  "button",
                  {
                    "data-button": !0,
                    "data-cancel": !0,
                    style: t.cancelButtonStyle || ft,
                    onClick: (n) => {
                      var l, f;
                      lt(t.cancel) &&
                        U &&
                        ((f = (l = t.cancel).onClick) == null || f.call(l, n),
                        $());
                    },
                    className: R(
                      s?.cancelButton,
                      (y = t?.classNames) == null ? void 0 : y.cancelButton,
                    ),
                  },
                  t.cancel.label,
                )
              : null,
          dt.isValidElement(t.action)
            ? t.action
            : t.action && lt(t.action)
              ? a.createElement(
                  "button",
                  {
                    "data-button": !0,
                    "data-action": !0,
                    style: t.actionButtonStyle || at,
                    onClick: (n) => {
                      var l, f;
                      lt(t.action) &&
                        ((f = (l = t.action).onClick) == null || f.call(l, n),
                        !n.defaultPrevented && $());
                    },
                    className: R(
                      s?.actionButton,
                      (Z = t?.classNames) == null ? void 0 : Z.actionButton,
                    ),
                  },
                  t.action.label,
                )
              : null,
        ),
  );
};
function Rt() {
  if (typeof window > "u" || typeof document > "u") return "ltr";
  let e = document.documentElement.getAttribute("dir");
  return e === "auto" || !e
    ? window.getComputedStyle(document.documentElement).direction
    : e;
}
function ge(e, r) {
  let o = {};
  return (
    [e, r].forEach((i, h) => {
      let w = h === 1,
        k = w ? "--mobile-offset" : "--offset",
        b = w ? de : le;
      function c(m) {
        ["top", "right", "bottom", "left"].forEach((y) => {
          o[`${k}-${y}`] = typeof m == "number" ? `${m}px` : m;
        });
      }
      typeof i == "number" || typeof i == "string"
        ? c(i)
        : typeof i == "object"
          ? ["top", "right", "bottom", "left"].forEach((m) => {
              i[m] === void 0
                ? (o[`${k}-${m}`] = b)
                : (o[`${k}-${m}`] =
                    typeof i[m] == "number" ? `${i[m]}px` : i[m]);
            })
          : c(b);
    }),
    o
  );
}
var ye = dt.forwardRef(function (e, r) {
  let {
      invert: o,
      position: i = "bottom-right",
      hotkey: h = ["altKey", "KeyT"],
      expand: w,
      closeButton: k,
      className: b,
      offset: c,
      mobileOffset: m,
      theme: y = "light",
      richColors: Z,
      duration: ct,
      style: t,
      visibleToasts: ut = ie,
      toastOptions: v,
      dir: z = Rt(),
      gap: _ = ue,
      loadingIcon: O,
      icons: Y,
      containerAriaLabel: mt = "Notifications",
      pauseWhenPageIsHidden: X,
    } = e,
    [S, q] = a.useState([]),
    tt = a.useMemo(
      () =>
        Array.from(
          new Set(
            [i].concat(S.filter((d) => d.position).map((d) => d.position)),
          ),
        ),
      [S, i],
    ),
    [et, ft] = a.useState([]),
    [at, j] = a.useState(!1),
    [rt, V] = a.useState(!1),
    [ot, H] = a.useState(
      y !== "system"
        ? y
        : typeof window < "u" &&
            window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light",
    ),
    I = a.useRef(null),
    nt = h.join("+").replace(/Key/g, "").replace(/Digit/g, ""),
    s = a.useRef(null),
    N = a.useRef(!1),
    ht = a.useCallback((d) => {
      q((u) => {
        var p;
        return (
          ((p = u.find((x) => x.id === d.id)) != null && p.delete) ||
            E.dismiss(d.id),
          u.filter(({ id: x }) => x !== d.id)
        );
      });
    }, []);
  return (
    a.useEffect(
      () =>
        E.subscribe((d) => {
          if (d.dismiss) {
            q((u) => u.map((p) => (p.id === d.id ? { ...p, delete: !0 } : p)));
            return;
          }
          setTimeout(() => {
            Ut.flushSync(() => {
              q((u) => {
                let p = u.findIndex((x) => x.id === d.id);
                return p !== -1
                  ? [...u.slice(0, p), { ...u[p], ...d }, ...u.slice(p + 1)]
                  : [d, ...u];
              });
            });
          });
        }),
      [],
    ),
    a.useEffect(() => {
      if (y !== "system") {
        H(y);
        return;
      }
      if (
        (y === "system" &&
          (window.matchMedia &&
          window.matchMedia("(prefers-color-scheme: dark)").matches
            ? H("dark")
            : H("light")),
        typeof window > "u")
      )
        return;
      let d = window.matchMedia("(prefers-color-scheme: dark)");
      try {
        d.addEventListener("change", ({ matches: u }) => {
          H(u ? "dark" : "light");
        });
      } catch {
        d.addListener(({ matches: p }) => {
          try {
            H(p ? "dark" : "light");
          } catch (x) {
            console.error(x);
          }
        });
      }
    }, [y]),
    a.useEffect(() => {
      S.length <= 1 && j(!1);
    }, [S]),
    a.useEffect(() => {
      let d = (u) => {
        var p, x;
        (h.every((F) => u[F] || u.code === F) &&
          (j(!0), (p = I.current) == null || p.focus()),
          u.code === "Escape" &&
            (document.activeElement === I.current ||
              ((x = I.current) != null &&
                x.contains(document.activeElement))) &&
            j(!1));
      };
      return (
        document.addEventListener("keydown", d),
        () => document.removeEventListener("keydown", d)
      );
    }, [h]),
    a.useEffect(() => {
      if (I.current)
        return () => {
          s.current &&
            (s.current.focus({ preventScroll: !0 }),
            (s.current = null),
            (N.current = !1));
        };
    }, [I.current]),
    a.createElement(
      "section",
      {
        ref: r,
        "aria-label": `${mt} ${nt}`,
        tabIndex: -1,
        "aria-live": "polite",
        "aria-relevant": "additions text",
        "aria-atomic": "false",
        suppressHydrationWarning: !0,
      },
      tt.map((d, u) => {
        var p;
        let [x, F] = d.split("-");
        return S.length
          ? a.createElement(
              "ol",
              {
                key: d,
                dir: z === "auto" ? Rt() : z,
                tabIndex: -1,
                ref: I,
                className: b,
                "data-sonner-toaster": !0,
                "data-theme": ot,
                "data-y-position": x,
                "data-lifted": at && S.length > 1 && !w,
                "data-x-position": F,
                style: {
                  "--front-toast-height": `${((p = et[0]) == null ? void 0 : p.height) || 0}px`,
                  "--width": `${ce}px`,
                  "--gap": `${_}px`,
                  ...t,
                  ...ge(c, m),
                },
                onBlur: (g) => {
                  N.current &&
                    !g.currentTarget.contains(g.relatedTarget) &&
                    ((N.current = !1),
                    s.current &&
                      (s.current.focus({ preventScroll: !0 }),
                      (s.current = null)));
                },
                onFocus: (g) => {
                  (g.target instanceof HTMLElement &&
                    g.target.dataset.dismissible === "false") ||
                    N.current ||
                    ((N.current = !0), (s.current = g.relatedTarget));
                },
                onMouseEnter: () => j(!0),
                onMouseMove: () => j(!0),
                onMouseLeave: () => {
                  rt || j(!1);
                },
                onDragEnd: () => j(!1),
                onPointerDown: (g) => {
                  (g.target instanceof HTMLElement &&
                    g.target.dataset.dismissible === "false") ||
                    V(!0);
                },
                onPointerUp: () => V(!1),
              },
              S.filter((g) => (!g.position && u === 0) || g.position === d).map(
                (g, pt) => {
                  var G, st;
                  return a.createElement(pe, {
                    key: g.id,
                    icons: Y,
                    index: pt,
                    toast: g,
                    defaultRichColors: Z,
                    duration: (G = v?.duration) != null ? G : ct,
                    className: v?.className,
                    descriptionClassName: v?.descriptionClassName,
                    invert: o,
                    visibleToasts: ut,
                    closeButton: (st = v?.closeButton) != null ? st : k,
                    interacting: rt,
                    position: d,
                    style: v?.style,
                    unstyled: v?.unstyled,
                    classNames: v?.classNames,
                    cancelButtonStyle: v?.cancelButtonStyle,
                    actionButtonStyle: v?.actionButtonStyle,
                    removeToast: ht,
                    toasts: S.filter((J) => J.position == g.position),
                    heights: et.filter((J) => J.position == g.position),
                    setHeights: ft,
                    expandByDefault: w,
                    gap: _,
                    loadingIcon: O,
                    expanded: at,
                    pauseWhenPageIsHidden: X,
                    swipeDirections: e.swipeDirections,
                  });
                },
              ),
            )
          : null;
      }),
    )
  );
});
export { ye as $, be as u };
