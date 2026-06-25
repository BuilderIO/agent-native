---
title: "التوجيه"
description: "التوجيه المستند إلى الملفات لتطبيقات الوكيل الأصلية باستخدام React Router v8 - الصفحات والمعلمات الديناميكية والتنقل."
---

# التوجيه

تستخدم تطبيقات الوكيل الأصلية **React Router v8** مع التوجيه المستند إلى الملف عبر `flatRoutes()` من `@react-router/fs-routes`. كل ملف في `app/routes/` يصبح URL. تستخدم القوالب اصطلاح التدوين النقطي — حيث تفصل النقاط مقاطع URL داخل اسم ملف واحد.

## التوجيه المستند إلى الملف {#file-based-routing}

### ملف → تعيين URL

| ملف                   | URL                | ملاحظات                                 |
| --------------------- | ------------------ | --------------------------------------- |
| `_index.tsx`          | `/`                | فهرس المسار                             |
| `settings.tsx`        | `/settings`        | صفحة بسيطة                              |
| `inbox.$threadId.tsx` | `/inbox/:threadId` | النقطة = `/`، `$` = المعلمة الديناميكية |
| `_app.tsx`            | (لا يوجد مقطع URL) | تخطيط بدون مسار — بادئة بـ `_`          |
| `inbox/route.tsx`     | `/inbox`           | نموذج المجلد — `route.tsx` هو الفهرس    |

بادئة مقطع بـ `$` لمعلمة ديناميكية. البادئة بـ `_` لجعلها مسار تخطيط بلا مسار (لا يوجد مقطع URL). تستخدم القوالب `flatRoutes()` — ملف التدوين النقطي أعلاه هو ملف أساسي؛ يعمل أيضًا نموذج المجلد المتداخل `inbox/route.tsx`.

```an-diagram title="تخطيط بلا مسار يلتف الصفحات" summary="يعرض تخطيط _app.tsx (لا يوجد مقطع URL) الصدفة المشتركة مرة واحدة؛ يتم عرض الصفحات المطابقة داخل <Outlet/> الخاص بها، لذلك لا يتم إعادة تحميل الشريط الجانبي للوكيل أبدًا أثناء التنقل."
{
"html": "<div class=\"diagram-layout\" data-rough><div class=\"diagram-shell\"><span class=\"diagram-pill accent\">_app.tsx</span><small class=\"diagram-muted\">تخطيط بلا مسار · غلاف دائم + شريط الوكيل</small><div class=\"diagram-outlet\" data-rough><small class=\"diagram-muted\">&lt;Outlet/&gt; — the matched page</small><div class=\"diagram-row\"><span class=\"diagram-pill\">_index.tsx &rarr; /</span><span class=\"diagram-pill\">settings.tsx &rarr; /settings</span><span class=\"diagram-pill\">inbox.$threadId.tsx &rarr; /inbox/:threadId</span></div></div></div></div>",
"css": ".diagram-layout .diagram-shell{display:flex;flex-direction:column;gap:8px;padding:16px}.diagram-layout .diagram-outlet{display:flex;flex-direction:column;gap:8px;padding:14px;margin-top:6px}.diagram-layout .diagram-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}"
}

```

## إضافة صفحة جديدة {#adding-a-page}

قم بإنشاء الملف وتصدير المكون الافتراضي:

```tsx
// app/routes/settings.tsx
export function meta() {
  return [{ title: "Settings" }];
}

export default function SettingsPage() {
  return <div>Settings</div>;
}
```

هذا كل شيء — يقوم جهاز التوجيه React باستلامها تلقائيًا، دون الحاجة إلى التسجيل.

## المعاملات الديناميكية {#dynamic-params}

```tsx
// app/routes/inbox/$threadId.tsx
import { useParams } from "react-router";

export default function ThreadPage() {
  const { threadId } = useParams();
  return <div>Thread: {threadId}</div>;
}
```

## الملاحة {#navigation}

استخدم `<Link>` للتنقل من جانب العميل و`useNavigate()` للتنقل البرمجي:

```tsx
import { Link, useNavigate } from "react-router";

// In JSX
<Link to="/settings">Settings</Link>;

// Programmatic
const navigate = useNavigate();
navigate(`/inbox/${threadId}`);
```

## ما هي الخطوة التالية

- [**Client**](/docs/client) — أدوات مساعدة وربط المتصفح الأصلي للوكيل
- [**Server**](/docs/server) — مسارات الخادم المستندة إلى الملفات ومساحة الاسم `/_agent-native/`
