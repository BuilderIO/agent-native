import { setResponseHeader, setResponseStatus, type H3Event } from "h3";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import type { FormField, FormSettings } from "../../shared/types.js";

// In-memory cache
const cache = new Map<string, { data: any; ts: number }>();
const TTL = 60_000;

function getCached(key: string) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < TTL) return entry.data;
  return null;
}

async function getFormById(formId: string) {
  const cached = getCached(formId);
  if (cached) return cached;

  const db = getDb();
  const row = await db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, formId))
    .then((rows) => rows[0]);

  if (!row || row.status !== "published") return null;

  const result = {
    id: row.id,
    title: row.title,
    description: row.description,
    fields: JSON.parse(row.fields) as FormField[],
    settings: JSON.parse(row.settings) as FormSettings,
  };

  cache.set(formId, { data: result, ts: Date.now() });
  return result;
}

// ---------------------------------------------------------------------------
// Field rendering helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderField(field: FormField): string {
  const req = field.required ? " required" : "";
  const ph = field.placeholder
    ? ` placeholder="${escapeHtml(field.placeholder)}"`
    : "";
  const desc = field.description
    ? `<p class="field-desc">${escapeHtml(field.description)}</p>`
    : "";
  const cond = field.conditional
    ? ` data-cond-field="${escapeHtml(field.conditional.fieldId)}" data-cond-op="${escapeHtml(field.conditional.operator)}" data-cond-val="${escapeHtml(field.conditional.value)}"`
    : "";
  const widthClass = field.width === "half" ? " field-half" : "";

  let input = "";

  switch (field.type) {
    case "text":
      input = `<input type="text" name="${field.id}" class="fi"${ph}${req}>`;
      break;
    case "email":
      input = `<input type="email" name="${field.id}" class="fi"${ph || ' placeholder="you@example.com"'}${req}>`;
      break;
    case "number":
      input = `<input type="number" name="${field.id}" class="fi"${ph}${req}${field.validation?.min != null ? ` min="${field.validation.min}"` : ""}${field.validation?.max != null ? ` max="${field.validation.max}"` : ""}>`;
      break;
    case "textarea":
      input = `<textarea name="${field.id}" class="fi fi-ta" rows="4"${ph || ' placeholder="Type your answer..."'}${req}></textarea>`;
      break;
    case "date":
      input = `<input type="date" name="${field.id}" class="fi"${req}>`;
      break;
    case "select":
      input = `<select name="${field.id}" class="fi"${req}><option value="">${field.placeholder || "Select..."}</option>${(field.options || []).map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("")}</select>`;
      break;
    case "multiselect":
      input = `<div class="ms-group">${(field.options || []).map((o) => `<label class="cb-label"><input type="checkbox" name="${field.id}" value="${escapeHtml(o)}" class="cb"><span>${escapeHtml(o)}</span></label>`).join("")}</div>`;
      break;
    case "checkbox":
      input = `<label class="cb-label"><input type="checkbox" name="${field.id}" class="cb"><span>${escapeHtml(field.placeholder || field.label)}</span></label>`;
      break;
    case "radio":
      input = `<div class="radio-group">${(field.options || []).map((o) => `<label class="cb-label"><input type="radio" name="${field.id}" value="${escapeHtml(o)}" class="radio"><span>${escapeHtml(o)}</span></label>`).join("")}</div>`;
      break;
    case "rating":
      input = `<div class="rating-group" data-name="${field.id}">${[1, 2, 3, 4, 5].map((s) => `<button type="button" class="star-btn" data-value="${s}" aria-label="${s} star${s > 1 ? "s" : ""}"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>`).join("")}</div><input type="hidden" name="${field.id}">`;
      break;
    case "scale": {
      const min = field.validation?.min ?? 1;
      const max = field.validation?.max ?? 10;
      input = `<div class="scale-group"><input type="range" name="${field.id}" class="slider" min="${min}" max="${max}" value="${min}" step="1"><div class="scale-labels"><span>${min}</span><span class="scale-val">${min}</span><span>${max}</span></div></div>`;
      break;
    }
  }

  return `<div class="field${widthClass}" data-field-id="${field.id}"${cond}>
    <label class="field-label">${escapeHtml(field.label)}${field.required ? '<span class="req">*</span>' : ""}</label>
    ${desc}${input}</div>`;
}

// ---------------------------------------------------------------------------
// Main SSR handler — called from [...page].get.ts for /f/* URLs
// ---------------------------------------------------------------------------

export async function renderPublicForm(event: H3Event) {
  // URL format: /f/formId or /f/optional-slug/formId — last segment is always the ID
  const url = event.node.req.url ?? "";
  const segments = url
    .split("?")[0]
    .replace(/^\/f\//, "")
    .split("/")
    .filter(Boolean);
  const formId = segments[segments.length - 1] || "";
  const form = formId ? await getFormById(formId) : null;

  setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");

  if (!form) {
    setResponseStatus(event, 404);
    return notFoundPage();
  }

  // Cache public form pages at CDN level
  setResponseHeader(
    event,
    "Cache-Control",
    "public, s-maxage=60, stale-while-revalidate=300",
  );

  const settings: FormSettings = form.settings || {};
  const fields: FormField[] = form.fields || [];
  const primaryColor = settings.primaryColor || "#334155";
  const turnstileSiteKey = process.env.VITE_TURNSTILE_SITE_KEY || "";

  const fieldsHtml = fields.map(renderField).join("\n");

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(form.title)}</title>
${form.description ? `<meta name="description" content="${escapeHtml(form.description)}">` : ""}
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📋</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>${CSS(primaryColor)}</style>
</head>
<body>
<div class="page">
  <button type="button" class="theme-toggle" id="themeToggle" aria-label="Toggle theme">
    <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
    <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
  </button>

  <div class="container">
    <div class="header">
      <h1>${escapeHtml(form.title)}</h1>
      ${form.description ? `<p class="desc">${escapeHtml(form.description)}</p>` : ""}
    </div>

    <form id="mainForm" novalidate>
      <div class="fields-card">
        ${fieldsHtml || '<p class="empty">This form has no fields yet.</p>'}
      </div>
      ${turnstileSiteKey ? `<div id="turnstile" class="turnstile-wrap"></div>` : ""}
      <button type="submit" class="submit-btn" id="submitBtn">${escapeHtml(settings.submitText || "Submit")}</button>
    </form>
  </div>

  <div id="successView" class="success-view" style="display:none">
    <div class="success-icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
    </div>
    <h1>Response submitted</h1>
    <p class="desc">${escapeHtml(settings.successMessage || "Thank you! Your response has been recorded.")}</p>
  </div>

  <a href="https://agent-native.com" target="_blank" rel="noopener noreferrer" class="powered-badge">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
    Built with Agent Native
  </a>
</div>

<div id="toast" class="toast" style="display:none"></div>

<script>
(function(){
  var FORM_ID = ${JSON.stringify(form.id)};
  var REDIRECT = ${JSON.stringify(settings.redirectUrl || "")};
  var TURNSTILE_KEY = ${JSON.stringify(turnstileSiteKey)};
  var FIELDS = ${JSON.stringify(fields.map((f) => ({ id: f.id, type: f.type, required: f.required, validation: f.validation, label: f.label, conditional: f.conditional })))};

  // Theme toggle
  var html = document.documentElement;
  var saved = localStorage.getItem("theme");
  if (saved === "light") html.classList.remove("dark");
  document.getElementById("themeToggle").onclick = function() {
    var dark = html.classList.toggle("dark");
    localStorage.setItem("theme", dark ? "dark" : "light");
  };

  // Toast
  var toastEl = document.getElementById("toast");
  var toastTimer;
  function showToast(msg, type) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.className = "toast toast-" + (type || "error");
    toastEl.style.display = "block";
    toastTimer = setTimeout(function() { toastEl.style.display = "none"; }, 4000);
  }

  // Rating stars
  document.querySelectorAll(".rating-group").forEach(function(group) {
    var name = group.dataset.name;
    var hidden = group.nextElementSibling;
    var buttons = group.querySelectorAll(".star-btn");
    buttons.forEach(function(btn) {
      btn.onclick = function() {
        var val = parseInt(btn.dataset.value);
        hidden.value = val;
        buttons.forEach(function(b) {
          var v = parseInt(b.dataset.value);
          b.classList.toggle("active", v <= val);
        });
      };
    });
  });

  // Scale sliders
  document.querySelectorAll(".scale-group").forEach(function(group) {
    var slider = group.querySelector(".slider");
    var valLabel = group.querySelector(".scale-val");
    slider.oninput = function() { valLabel.textContent = slider.value; };
  });

  // Conditional visibility
  function updateVisibility() {
    document.querySelectorAll("[data-cond-field]").forEach(function(el) {
      var depId = el.dataset.condField;
      var op = el.dataset.condOp;
      var condVal = el.dataset.condVal;
      var depVal = getFieldValue(depId);
      var show = true;
      if (op === "equals") show = depVal === condVal;
      else if (op === "not_equals") show = depVal !== condVal;
      else if (op === "contains") show = depVal.indexOf(condVal) >= 0;
      el.style.display = show ? "" : "none";
      el.dataset.hidden = show ? "" : "1";
    });
  }

  function getFieldValue(id) {
    var el = document.querySelector('[name="' + id + '"]');
    if (!el) return "";
    if (el.type === "checkbox" && !el.closest(".ms-group")) return el.checked ? "true" : "";
    return el.value || "";
  }

  document.getElementById("mainForm").addEventListener("input", updateVisibility);
  document.getElementById("mainForm").addEventListener("change", updateVisibility);
  updateVisibility();

  // Collect form data
  function collectData() {
    var data = {};
    FIELDS.forEach(function(f) {
      var el = document.querySelector('[data-field-id="' + f.id + '"]');
      if (!el || el.dataset.hidden === "1") return;
      if (f.type === "multiselect") {
        var checked = [];
        el.querySelectorAll('input[type="checkbox"]:checked').forEach(function(cb) { checked.push(cb.value); });
        data[f.id] = checked;
      } else if (f.type === "checkbox") {
        data[f.id] = el.querySelector('input[type="checkbox"]').checked;
      } else if (f.type === "rating") {
        var v = el.querySelector('input[type="hidden"]').value;
        if (v) data[f.id] = parseInt(v);
      } else if (f.type === "scale") {
        data[f.id] = parseInt(el.querySelector(".slider").value);
      } else {
        var input = el.querySelector("input, textarea, select");
        if (input && input.value) data[f.id] = input.value;
      }
    });
    return data;
  }

  // Validation
  function validate(data) {
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i];
      var el = document.querySelector('[data-field-id="' + f.id + '"]');
      if (!el || el.dataset.hidden === "1") continue;
      if (f.required) {
        var val = data[f.id];
        if (val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0)) {
          return f.label + " is required";
        }
      }
      if (f.validation) {
        var v = data[f.id];
        if (f.validation.min != null && Number(v) < f.validation.min)
          return (f.validation.message || f.label + " must be at least " + f.validation.min);
        if (f.validation.max != null && Number(v) > f.validation.max)
          return (f.validation.message || f.label + " must be at most " + f.validation.max);
        if (f.validation.pattern && typeof v === "string" && !new RegExp(f.validation.pattern).test(v))
          return (f.validation.message || f.label + " is invalid");
      }
    }
    return null;
  }

  // Turnstile
  var captchaToken = null;
  if (TURNSTILE_KEY) {
    window.__turnstileOnLoad = function() {
      window.turnstile.render(document.getElementById("turnstile"), {
        sitekey: TURNSTILE_KEY,
        appearance: "managed",
        callback: function(token) { captchaToken = token; },
      });
    };
    var s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__turnstileOnLoad";
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }

  // Submit
  var submitting = false;
  document.getElementById("mainForm").onsubmit = function(e) {
    e.preventDefault();
    if (submitting) return;
    var data = collectData();
    var err = validate(data);
    if (err) { showToast(err); return; }
    submitting = true;
    var btn = document.getElementById("submitBtn");
    btn.textContent = "Submitting...";
    btn.disabled = true;

    fetch("/api/submit/" + FORM_ID, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: data, captchaToken: captchaToken }),
    })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
      if (!res.ok) { throw new Error(res.data.error || "Failed to submit"); }
      if (REDIRECT) { window.location.href = REDIRECT; return; }
      document.querySelector(".container").style.display = "none";
      document.getElementById("successView").style.display = "flex";
    })
    .catch(function(err) {
      showToast(err.message || "Failed to submit form");
      submitting = false;
      btn.textContent = ${JSON.stringify(settings.submitText || "Submit")};
      btn.disabled = false;
    });
  };
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 404 page
// ---------------------------------------------------------------------------

function notFoundPage() {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Form not found</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS("#334155")}</style>
</head>
<body>
<div class="page">
  <div class="not-found">
    <h1>Form not found</h1>
    <p class="desc">This form may have been removed or is no longer accepting responses.</p>
    <button class="submit-btn" style="width:auto;padding:8px 20px;font-size:13px" onclick="location.reload()">Try Again</button>
  </div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

function CSS(primaryColor: string) {
  return `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

:root{
  --bg:0 0% 100%;--fg:220 10% 10%;
  --card:0 0% 100%;--card-fg:220 10% 10%;
  --muted:220 10% 95%;--muted-fg:220 5% 45%;
  --border:220 10% 90%;--input:220 10% 90%;
  --primary:${primaryColor};
  --ring:220 10% 40%;
  --radius:0.5rem;
}
.dark{
  --bg:220 6% 10%;--fg:0 0% 90%;
  --card:220 5% 12%;--card-fg:0 0% 90%;
  --muted:220 4% 10%;--muted-fg:220 4% 55%;
  --border:220 4% 18%;--input:220 4% 18%;
  --ring:0 0% 60%;
}

html{font-family:"Inter",system-ui,-apple-system,sans-serif;font-feature-settings:"cv02","cv03","cv04","cv11"}
body{background:hsl(var(--bg));color:hsl(var(--fg));min-height:100vh;-webkit-font-smoothing:antialiased}

.page{min-height:100vh;padding:48px 16px 80px;position:relative}
.container{max-width:640px;margin:0 auto}

.header{margin-bottom:32px}
.header h1{font-size:1.5rem;font-weight:600;line-height:1.3;letter-spacing:-0.01em}
.desc{margin-top:6px;font-size:0.875rem;color:hsl(var(--muted-fg));line-height:1.5}

.fields-card{border:1px solid hsl(var(--border));border-radius:12px;background:hsl(var(--card));padding:24px;display:flex;flex-direction:column;gap:24px}

.field{display:flex;flex-direction:column;gap:6px}
.field-half{width:50%}
.field-label{font-size:0.875rem;font-weight:500;color:hsl(var(--card-fg))}
.field-desc{font-size:0.75rem;color:hsl(var(--muted-fg))}
.req{color:#ef4444;margin-left:2px}

.fi{width:100%;padding:8px 12px;font-size:0.875rem;font-family:inherit;background:transparent;border:1px solid hsl(var(--input));border-radius:var(--radius);color:hsl(var(--fg));outline:none}
.fi:focus{border-color:hsl(var(--ring));box-shadow:0 0 0 2px hsl(var(--ring)/0.15)}
.fi-ta{resize:vertical;min-height:80px}
select.fi{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:30px}
select.fi option{background:hsl(var(--card));color:hsl(var(--fg))}

.cb-label{display:flex;align-items:center;gap:8px;font-size:0.875rem;cursor:pointer}
.cb,.radio{width:16px;height:16px;accent-color:var(--primary);cursor:pointer}
.ms-group,.radio-group{display:flex;flex-direction:column;gap:8px}

.rating-group{display:flex;gap:4px}
.star-btn{background:none;border:none;cursor:pointer;padding:2px;color:hsl(var(--muted-fg)/0.3)}
.star-btn.active{color:#fbbf24;fill:#fbbf24}
.star-btn.active svg{fill:#fbbf24}

.scale-group{padding-top:8px}
.slider{width:100%;accent-color:var(--primary);cursor:pointer}
.scale-labels{display:flex;justify-content:space-between;font-size:0.75rem;color:hsl(var(--muted-fg));margin-top:4px}
.scale-val{font-weight:500;color:hsl(var(--fg))}

.turnstile-wrap{margin-top:16px}

.submit-btn{
  width:100%;margin-top:16px;padding:10px 16px;
  font-size:0.875rem;font-weight:500;font-family:inherit;
  background:var(--primary);color:#fff;
  border:none;border-radius:var(--radius);cursor:pointer;
}
.submit-btn:hover{opacity:0.9}
.submit-btn:disabled{opacity:0.6;cursor:not-allowed}

.theme-toggle{
  position:absolute;top:16px;right:16px;
  background:none;border:1px solid hsl(var(--border));border-radius:var(--radius);
  width:36px;height:36px;display:flex;align-items:center;justify-content:center;
  cursor:pointer;color:hsl(var(--muted-fg));
}
.theme-toggle:hover{background:hsl(var(--muted));color:hsl(var(--fg))}
.dark .icon-sun{display:none}
.dark .icon-moon{display:block}
html:not(.dark) .icon-sun{display:block}
html:not(.dark) .icon-moon{display:none}

.success-view{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  text-align:center;max-width:400px;margin:120px auto 0;
}
.success-icon{
  width:56px;height:56px;border-radius:50%;
  background:rgba(16,185,129,0.1);
  display:flex;align-items:center;justify-content:center;
  color:#10b981;margin-bottom:16px;
}

.not-found{text-align:center;margin-top:120px}
.not-found h1{font-size:1.5rem;font-weight:600;margin-bottom:8px}
.not-found .submit-btn{margin-top:16px;display:inline-block}

.powered-badge{
  position:fixed;bottom:16px;right:16px;z-index:50;
  display:flex;align-items:center;gap:6px;
  padding:6px 12px;border-radius:8px;
  font-size:12px;font-weight:500;line-height:1;
  color:rgba(150,150,150,0.9);
  background:rgba(0,0,0,0.05);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  border:1px solid rgba(0,0,0,0.06);
  text-decoration:none;opacity:0.7;
}
.dark .powered-badge{background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.08);color:rgba(180,180,180,0.9)}
.powered-badge:hover{opacity:1}

.toast{
  position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
  padding:10px 20px;border-radius:var(--radius);
  font-size:0.875rem;font-weight:500;z-index:100;
  background:#1f2937;color:#f9fafb;
  box-shadow:0 4px 12px rgba(0,0,0,0.3);
}
.toast-error{background:#991b1b}

.empty{text-align:center;color:hsl(var(--muted-fg));padding:32px 0}

@media(max-width:640px){
  .page{padding:32px 12px 80px}
  .fields-card{padding:16px}
  .field-half{width:100%}
}
`;
}
