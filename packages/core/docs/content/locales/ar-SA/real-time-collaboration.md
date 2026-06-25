---
title: "التعاون في الوقت الفعلي"
description: "تحرير تعاوني متعدد المستخدمين حيث يكون وكيل الذكاء الاصطناعي نظيرًا من الدرجة الأولى: دمج CRDT، والتواجد المباشر، والمسار السريع SSE، والدمج الدقيق من جانب الخادم - على أي قاعدة بيانات SQL وأي مضيف."
---

# التعاون في الوقت الفعلي

تخيل فتح مستند ورؤية مؤشر أحد الزملاء يمرر إلى فقرة،
ثم يعيد النص كتابة نفسه - جراحيًا، دون أن يفقد مكانه. ذلك
قد يكون النظير زميلًا في الفريق. قد يكون الوكيل. من الإطار
من حيث أنهما متطابقان: كلاهما ينتج عمليات Yjs تندمج
خالي من التعارض في المستند المشترك. هذا هو حجر الزاوية في
نموذج التعاون الأصلي بين الوكيل والوكيل.

## الرؤية {#vision}

يبدو التحرير جنبًا إلى جنب مع الوكيل وكأنه يعمل في Google Docs أو Figma مع
زميل عمل فوري ولا يكل:

إذا كنت تحتاج فقط إلى تحديث UI عندما يكتب الوكيل أو مستخدم آخر إلى SQL، فلن تحتاج إلى أي من هذا — استخدم [`useDbSync`](/docs/client). هذه الصفحة مخصصة للتحرير المشترك على مستوى الأحرف لمستند نص منسق واحد (المؤشرات المشتركة، والدمج الخالي من الصراع). كلاهما يركبان نفس قناة `/_agent-native/poll`.

تم بناء هذا على ثلاث تقنيات تم اختبارها في المعارك: **Yjs** (CRDT للدمج الخالي من الصراعات)، **TipTap** (محرر النص المنسق)، و **المزامنة المستندة إلى الاقتراع** (تعمل في جميع بيئات النشر بما في ذلك بيئات النشر بدون خادم وبيئات Edge).

- **دمج CRDT** — يتم دمج التعديلات المتزامنة التي يجريها البشر والوكلاء بدون
  تعارضات. تكتب في فقرة واحدة؛ الوكيل يعيد كتابة آخر؛ كلا
  الأرض نظيفة.
- **التواجد** — يُظهر `PresenceBar` الأشخاص الموجودين في المستند الآن،
  بما في ذلك مؤشر حضور الوكيل عندما يقوم الوكيل بالتحرير بشكل نشط.
- **الوكيل كمحرر نظير** — تتدفق تعديلات الوكيل عبر نفس Yjs
  البنية الأساسية كتعديلات بشرية. تظهر مباشرة، دون تعطيل المؤشر
  المواضع أو التحديدات أو حزمة التراجع.
- **يعمل في كل مكان** — أي قاعدة بيانات SQL يدعمها Drizzle (SQLite، Postgres).
  أي هدف استضافة يدعمه Nitro، بما في ذلك بدون خادم وEdge.

## الهندسة المعمارية {#architecture}

يحتوي نظام التعاون على خمس طبقات متشابكة.

```an-diagram title="خمس طبقات متشابكة" summary="بدءًا من CRDT في الذاكرة وحتى وسيلة النقل التي تحمل التحديثات بين النظراء — تحتوي كل طبقة على وظيفة واحدة."
{
  "html": "<div class=\"diagram-stack\"><div class=\"diagram-card layer\"><span class=\"diagram-pill accent\">1 &middot; Yjs Y.Doc</span><small class=\"diagram-muted\">CRDT &mdash; دمج بلا تعارض، بلا منسق</small></div><div class=\"diagram-card layer\"><span class=\"diagram-pill\">2 &middot; المحتوى القانوني في SQL</span><small class=\"diagram-muted\">_collab_docs &mdash; durable source of truth, versioned</small></div><div class=\"diagram-card layer\"><span class=\"diagram-pill\">3 &middot; تسوية محكومة بـ updatedAt</span><small class=\"diagram-muted\">تنتشر تعديلات الوكيل عبر تحديث SQL</small></div><div class=\"diagram-card layer\"><span class=\"diagram-pill\">4 &middot; انتخاب العميل القائد</span><small class=\"diagram-muted\">علامة تبويب واحدة فقط تطبق اللقطة</small></div><div class=\"diagram-card layer\"><span class=\"diagram-pill ok\">5 &middot; مسار SSE السريع + الاستطلاع</span><small class=\"diagram-muted\">نحو عشرات المللي ثانية، ويتراجع إلى استطلاع كل ثانيتين في أي مكان</small></div></div>",
  "css": ".diagram-stack{display:flex;flex-direction:column;gap:8px}.diagram-stack .layer{display:flex;flex-direction:column;gap:4px;padding:12px 14px}"
}
```

### 1. Yjs Y.Doc (طبقة CRDT)

كل مستند تعاوني عبارة عن `Y.Doc` يحتوي على أنواع مشتركة — عادةً ما يكون
`Y.XmlFragment` للنص المنسق (شجرة العقدة ProseMirror التي يقرأها TipTap) أو
`Y.Map` / `Y.Array` لبيانات JSON المنظمة. Yjs يدمج التحديثات المتزامنة
بدون منسق مركزي؛ أي عميلين يتبادلان وصول حالتهما
نفس النتيجة بغض النظر عن الترتيب.

### 2. المحتوى الأساسي SQL (مصدر دائم للحقيقة)

تستمر حالة Yjs في جدول `_collab_docs` كثنائي مشفر باستخدام base64.
الجدول مُدار بواسطة إطار العمل ولا يعتمد على الموفر (يستخدم SQLite وPostgres
مخططات متطابقة). يحمل كل صف عمود إصدار متزامن متفائل
لمنع سباقات الكتابة المتزامنة. يعمل ضغط شاهد القبر بطريقة انتهازية
عندما تتجاوز النقطة المخزنة 4× الحالة المشفرة حديثًا - لا توجد مهمة في الخلفية
مطلوب.

### 3. تسوية بوابة `updatedAt` (انتشار تحرير الوكيل)

لا يقوم العميل actions بالدفع إلى Yjs قيد التشغيل. وبدلاً من ذلك، يقوم الإجراء بتحرير
عمود محتوى SQL الكنسي والمطبات `updatedAt`. نظام مزامنة التغيير
يكتشف النتوء، ويقوم المحرر المفتوح بإعادة جلب السجل، والعميل الرئيسي
بتطبيق المحتوى الجديد على Y.Doc المشترك عبر `setContent`. `updatedAt`
تضمن البوابة اعتماد المحتوى الأحدث فقط - استجابات الاستطلاع المتأخرة
لا يمكن التراجع عن التعديل.

### 4. اختيار العميل الرئيسي (إلغاء البيانات المكررة)

عند فتح عدة علامات تبويب، تطبق واحدة فقط لقطة SQL موثوقة
في Y.Doc المشترك. العميل المتوقع هو علامة التبويب ذات أدنى Yjs `clientID`
بين النظراء المرئيين حاليًا. يستخدم إدخال الوعي الخاص بالوكيل
`AGENT_CLIENT_ID` (max int) لذا لا يمكن أن يكون هو القائد أبدًا. تحرير العميل
وحده هو القائد دائمًا. الانتخابات حتمية بلا تنسيق
ذهابًا وإيابًا (`isReconcileLeadClient` من `@agent-native/core/client`).

### 5. SSE المسار السريع + الاستقصاء الاحتياطي (النقل)

تنتقل أحداث تحديث التعاون عبر مسارين:

- **المسار السريع SSE** — يشترك العميل في `/_agent-native/poll-events`
  (نفس `EventSource` المستخدم بواسطة `useDbSync`). وصول أحداث تحديث التعاون
  نمط الدفع، عادةً بعشرات المللي ثانية. في حين أن SSE يتمتع بصحة جيدة
  تسترخي حلقة الاستقصاء بإيقاع بطيء (حوالي 12 ثانية افتراضيًا).
- **الاستقصاء الاحتياطي** — يتم استطلاع `/_agent-native/poll?since=N` كل ثانيتين
  عندما يكون SSE غير متاح. وهذا يجعل التعاون يعمل في أي عملية نشر
  الهدف - بما في ذلك الوظائف بدون خادم حيث توجد اتصالات مستمرة
  يمكن للاستدعاءات المستحيلة والمختلفة التعامل مع طلبات مختلفة.

يتم إلغاء تحديثات Yjs المحلية ودمجها مع `Y.mergeUpdates` (~80 مللي ثانية)
قبل إرسالها إلى الخادم، مما يقلل من حركة مرور الشبكة على مستوى ضغط المفاتيح.
يتم مسح الدفعة مباشرة على `visibilitychange` أو `pagehide`. أ
يتم جلب فرق ناقل الحالة (`GET /:docId/state?stateVector=…`) فقط على
إعادة الاتصال، أو تجاوز سعة المخزن المؤقت للحلقة، أو كل دورة استقصاء خامسة عشر - وليس في كل دورة
دورة.

تستخدم أخطاء الشبكة التراجع الأسي مع عدم الاستقرار، بحد أقصى 15 ثانية تقريبًا.

```an-diagram title="مساران للتحرير، أحدهما مدمج" summary="تدفق ضغطات المفاتيح البشرية Y.Doc → الخادم → SSE. تمر تعديلات الوكيل عبر SQL: يتم تحديث مطبات الإجراء عند تسوية العميل الرئيسي، ثم يُدخل التغيير مرة أخرى إلى Yjs."
{
  "html": "<div class=\"diagram-collab\"><div class=\"lane\"><span class=\"diagram-pill\">تعديل بشري</span><div class=\"diagram-node\">Y.Doc update<br><small class=\"diagram-muted\">تأخير debounce ~80 مللي ثانية</small></div><span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box\" data-rough>POST /update<br><small class=\"diagram-muted\">apply + persist</small></div><span class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box diagram-accent\">SSE push<br><small class=\"diagram-muted\">to all peers</small></div></div><div class=\"lane\"><span class=\"diagram-pill warn\">تعديل الوكيل</span><div class=\"diagram-node\">الإجراء يكتب SQL<br><small class=\"diagram-muted\">يحدث updatedAt</small></div><span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box\" data-rough>العميل القائد<br><small class=\"diagram-muted\">setContent إلى Y.Doc</small></div><span class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box diagram-accent\">POST /update<br><small class=\"diagram-muted\">re-enters Yjs &middot; SSE push</small></div></div></div>",
  "css": ".diagram-collab{display:flex;flex-direction:column;gap:14px}.diagram-collab .lane{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.diagram-collab .diagram-arrow{font-size:22px;line-height:1}"
}
```

## البدء السريع {#quickstart}

### 1. تثبيت الحزم

```bash
pnpm add @tiptap/extension-collaboration @tiptap/extension-collaboration-caret @tiptap/y-tiptap @tiptap/core
```

### 2. أضف Vite optimDeps

يمنع Vite من إعادة تجميع TipTap بطرق غير متوافقة أثناء التطوير:

```ts
// vite.config.ts
import { reactRouter } from "@react-router/dev/vite";
import { agentNative } from "@agent-native/core/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter(), agentNative()],
  optimizeDeps: {
    include: [
      "yjs",
      "y-protocols/awareness",
      "@tiptap/core",
      "@tiptap/extension-collaboration",
      "@tiptap/extension-collaboration-caret",
      "@tiptap/y-tiptap",
    ],
  },
});
```

### 3. أضف المكوّن الإضافي لخادم التعاون

قم دائمًا بتعيين `resourceType` على اسم المورد القابل للمشاركة المسجل
عبر `registerShareableResource`. وبدون ذلك، يتم تسليم أحداث الدفع التعاوني
لجميع المستخدمين الذين تمت مصادقتهم دون تحديد النطاق على مستوى المستند، والخادم
يسجل تحذيرًا لمرة واحدة.

```ts
// server/plugins/collab.ts
import { createCollabPlugin } from "@agent-native/core/server";

export default createCollabPlugin({
  table: "documents",
  contentColumn: "content",
  idColumn: "id",
  resourceType: "document", // required for access-scoped event delivery
});
```

### 4. استخدم ربط العميل

```ts
import {
  useCollaborativeDoc,
  emailToColor,
  emailToName,
} from "@agent-native/core/client";

const TAB_ID = generateTabId(); // or Math.random().toString(36)

const { ydoc, awareness, isLoading, activeUsers, agentActive, agentPresent } =
  useCollaborativeDoc({
    docId: documentId,
    requestSource: TAB_ID,
    user: {
      name: emailToName(session.email),
      email: session.email,
      color: emailToColor(session.email),
    },
  });
```

### 5. أضف ملحقات TipTap

```ts
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";

const editor = useEditor({
  extensions: [
    StarterKit.configure({ history: false }), // Yjs owns undo
    Collaboration.configure({ document: ydoc }),
    CollaborationCaret.configure({
      provider: { awareness },
      user: { name, color },
    }),
  ],
  // Do NOT pass content here — Yjs owns the content
});
```

### 6. البذور عند التحميل الأول (إذا كان المحتوى موجودًا)

لا يتم زرع ملحق التعاون تلقائيًا من دعامة `content`. إذا كان
Y.Doc فارغ والمستند يحتوي على محتوى موجود، قم بزرعه:

```ts
useEffect(() => {
  if (!ydoc || !editor || !isLoaded) return;
  const fragment = ydoc.getXmlFragment("default");
  if (fragment.length === 0 && initialContent) {
    editor.commands.setContent(initialContent);
  }
}, [ydoc, editor, isLoaded]);
```

يتم اشتقاق هوية المستخدم من البريد الإلكتروني للجلسة. يوفر إطار العمل مساعدين `emailToColor()` و`emailToName()` لإنشاء ألوان مؤشر متسقة وأسماء العرض من عناوين البريد الإلكتروني.

## التعليقات {#comments}

يمكن للقوالب إضافة نظام تعليقات يحتوي على مناقشات مترابطة حول المستندات. يتضمن نظام التعليقات الخاص بقالب المحتوى تنفيذًا كاملاً باستخدام:

- جدول `document_comments` SQL (المواضيع، الردود، حالة الحل)
- مسارات REST لقالب المحتوى للتحديث/الحذف في `/api/comments/:id`؛ إنشاء وتشغيل القائمة من خلال `add-comment` / `list-comments` actions. تطبق القوالب المخصصة نقاط النهاية المكافئة الخاصة بها مقابل مسار `POST /_agent-native/collab/:docId/search-replace` الأساسي.
- الشريط الجانبي للتعليقات مع العرض المتسلسل والرد UI
- حل/إلغاء حل المواضيع
- **زر إرسال إلى AI** — يرسل سياق سلسلة التعليقات إلى دردشة الوكيل عبر `sendToAgentChat()`
- الوكيل actions: `list-comments`، `add-comment`
- مزامنة تعليق Notion: إجراء `sync-notion-comments` للسحب/الدفع ثنائي الاتجاه

## مسارات التعاون {#collab-routes}

يتم تثبيت جميع مسارات التعاون تلقائيًا ضمن `/_agent-native/collab/` بواسطة البرنامج الإضافي للتعاون:

| المسار                        | الغرض                                         |
| ----------------------------- | --------------------------------------------- |
| `GET /:docId/state`           | جلب حالة Y.Doc الكاملة (base64)               |
| `POST /:docId/update`         | تطبيق تحديث Yjs للعميل                        |
| `POST /:docId/text`           | تطبيق استبدال النص الكامل (على أساس الاختلاف) |
| `POST /:docId/search-replace` | البحث/الاستبدال الجراحي في Y.XmlFragment      |
| `POST /:docId/awareness`      | مزامنة حالة المؤشر/التواجد                    |
| `GET /:docId/users`           | إدراج المستخدمين النشطين في المستند           |

## إجراء تحرير الوكيل {#edit-document}

يعد إجراء `edit-document` الخاص بقالب المحتوى هو الطريقة الأساسية التي يقوم بها الوكلاء بإجراء تغييرات على المستندات في الوضع التعاوني:

```bash
# تعديل فردي
pnpm action edit-document --id doc123 --find "old text" --replace "new text"

# التعديلات المجمعة
pnpm action edit-document --id doc123 --edits '[{"find":"old","replace":"new"}]'

# حذف النص
pnpm action edit-document --id doc123 --find "delete me" --replace ""
```

---

## مجموعة أدوات الحضور {#presence-kit}

توفر مجموعة أدوات الحضور Liveblocks/مؤشر مباشر على مستوى Figma وأساسيات التحديد أعلى طبقة الوعي الحالية.

استيراد التواجد من جانب العميل والمحرر UI من المسار الفرعي للمتصفح الذي يتم التركيز عليه:

```ts
import {
  PresenceBar,
  LiveCursorOverlay,
  RemoteSelectionRings,
  useCollaborativeDoc,
  usePresence,
} from "@agent-native/core/client/collab";
```

يظل مساعدو وجود الوكيل من جانب الخادم في حزمة التعاون ذات المستوى الأدنى:

```ts
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
} from "@agent-native/core/collab";
```

### API عام {#presence-public-api}

| API                                                 | الغرض                                                                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useCollaborativeDoc(options)`                      | إنشاء `Y.Doc` المستقر ومثيل الوعي، ومعالجة مزامنة ناقل الحالة، والمسار السريع SSE، والاحتياطي للاستقصاء، والمستخدمين النشطين، وإشارات حضور الوكيل. |
| `usePresence(awareness, localClientId)`             | يستخرج مشاركين عن بعد وينشر مجالات وعي محلية عشوائية مثل المؤشر أو التحديد أو إطار العرض أو وضع الأداة.                                            |
| `<PresenceBar>`                                     | يعرض المتعاونين النشطين بالإضافة إلى وكيل الذكاء الاصطناعي، من خلال توصيل وضع المتابعة الاختياري بالنقر على الصورة الرمزية.                        |
| `<LiveCursorOverlay>`                               | يعرض تسميات المؤشر عن بعد فوق حاوية موضوعة من الإحداثيات المقيسة 0-1.                                                                              |
| `<RemoteSelectionRings>`                            | يعرض حلقات وعلامات ملونة حول عناصر DOM المحددة التي تم حلها بواسطة تطبيقك.                                                                         |
| `useFollowUser(options)`                            | استدعاء رد الاتصال عندما ينشر المشارك المتابع تغييرات إطار العرض.                                                                                  |
| `toNormalized()` / `fromNormalized()`               | تحويل إحداثيات المؤشر من/إلى إحداثيات الحاوية المقيسة.                                                                                             |
| `dedupeCollabUsersByEmail()`                        | إنشاء مجموعات صور رمزية مخصصة دون ظهور مستخدم واحد مرة واحدة لكل علامة تبويب مفتوحة.                                                               |
| `useCollaborativeMap()` / `useCollaborativeArray()` | ربطات العميل للتعاون المنظم على Y.Map/Y.Array. تعامل كمستوى أدنى حتى يثبت النموذج نمط المنتج الدقيق.                                               |

`UseCollaborativeDocOptions`:

| الخيار                | الوصف                                                                        |
| --------------------- | ---------------------------------------------------------------------------- |
| `docId`               | معرف المستند، أو `null` لتعطيل الربط.                                        |
| `pollInterval`        | الفاصل الزمني للاستقصاء عندما يكون SSE غير متاح. الافتراضي: `2000`.          |
| `pollIntervalWithSse` | الفاصل الزمني للاستقصاء بطيء بينما يكون SSE سليمًا. الافتراضي: `12000`.      |
| `pauseWhenHidden`     | إيقاف مؤقت لاستقصاء التواجد/التحديث عن بعد أثناء إخفائه. الافتراضي: `true`.  |
| `baseUrl`             | بادئة نقطة نهاية Collab. الافتراضي: `/_agent-native/collab`.                 |
| `requestSource`       | معرف علامة التبويب/المصدر الثابت المستخدم لتجاهل ضجيج التحديث الناتج ذاتيًا. |
| `user`                | `{ name, email, color }` يظهر في المؤشر والحضور UI.                          |

`UseCollaborativeDocResult`:

| الحقل          | الوصف                                                              |
| -------------- | ------------------------------------------------------------------ |
| `ydoc`         | `Y.Doc` مستقر لـ `docId` الحالي.                                   |
| `awareness`    | مثيل Yjs Awareness الذي تستخدمه المؤشرات والتحديدات ووضع المتابعة. |
| `isLoading`    | لا تزال حالة الخادم الأولية قيد التحميل.                           |
| `isSynced`     | لقد لحق الخطاف بحالة الخادم.                                       |
| `activeUsers`  | المتعاونون مع الإنسان من الوعي.                                    |
| `agentActive`  | يقوم الوكيل بالتحرير بشكل نشط الآن.                                |
| `agentPresent` | الوكيل لديه إدخال توعوي لهذا المستند.                              |

### الوعي السريع {#fast-awareness}

تنتشر الآن تغييرات حالة الوعي بمعدل 150 مللي ثانية تقريبًا بدلاً من دورة الاستقصاء التي تستغرق ثانيتين:

- **العميل → الخادم**: أي استدعاء لـ `setPresence()` أو `awareness.setLocalStateField()` يؤدي إلى تشغيل POST المقيد إلى `/_agent-native/collab/:docId/awareness` خلال 150 مللي ثانية، مما يؤدي إلى دمج التغييرات السريعة في طلب واحد.
- **الخادم → العملاء**: يُصدر معالج `postAwareness` `AWARENESS_CHANGE_EVENT` بعد التخزين. يقوم تيار `/_agent-native/poll-events` SSE بإعادة توجيه هذه الأحداث بأسلوب الدفع إلى أقرانهم المتصلين. تستمر عمليات النشر المخصصة للاستقصاء فقط في العمل - حيث تنخفض المؤشرات وفقًا لإيقاع الاستقصاء دون أخطاء.

### `usePresence(awareness, localClientId)` {#use-presence}

إرجاع قائمة تفاعلية للمشاركين عن بعد ومحدد لحمولة التواجد المحلي:

```ts
import { usePresence } from "@agent-native/core/client";

const { others, setPresence } = usePresence(awareness, ydoc?.clientID);

// Publish cursor position (normalized 0–1)
setPresence({ cursor: { x: 0.4, y: 0.7 }, selection: "#hero" });

// others: OtherPresence[]
// {
//   clientId: number
//   user: { name, email, color }
//   presence: { cursor?, selection?, viewport?, ... }
//   isAgent: boolean   ← true for AGENT_CLIENT_ID
// }
```

يظهر الوكيل (AGENT_CLIENT_ID) كمشارك من الدرجة الأولى مع `isAgent: true`. عندما يتم استدعاء `agentUpdateSelection()` من جانب الخادم، تتدفق بيانات تعريف التحديد الخاصة به عبر `usePresence` مثل أي مشارك آخر.

### `LiveCursorOverlay` {#live-cursor-overlay}

يعرض المؤشرات عن بعد كتسميات ذات موضع مطلق فوق عنصر الحاوية:

```tsx
import { LiveCursorOverlay } from "@agent-native/core/client";

// cursor positions stored as { x, y } normalized 0–1 under presence.cursor
<div ref={containerRef} style={{ position: "relative" }}>
  {content}
  <LiveCursorOverlay
    others={others} // from usePresence
    containerRef={containerRef}
    cursorKey="cursor" // key in presence payload (default: "cursor")
  />
</div>;
```

يتم عرض مؤشر الوكيل بشكل واضح باستخدام رمز لامع. تتلاشى المؤشرات بعد 10 ثوانٍ من عدم النشاط من خلال انتقالات CSS السلسة بسرعة 120 مللي ثانية.

### `RemoteSelectionRings` {#remote-selection-rings}

يعرض حلقات مخطط تفصيلي ملونة + علامات أسماء على عناصر محددة عن بعد:

```tsx
import { RemoteSelectionRings } from "@agent-native/core/client";

<div ref={containerRef} style={{ position: "relative" }}>
  {content}
  <RemoteSelectionRings
    others={others}
    selectionKey="selection" // key in presence payload (default: "selection")
    resolveRect={(descriptor) =>
      document.querySelector(descriptor)?.getBoundingClientRect() ?? null
    }
    containerRef={containerRef}
  />
</div>;
```

### `useFollowUser` {#follow-user}

قم باستدعاء رد الاتصال عندما يتغير إطار عرض المشارك المتابع:

```ts
import { useFollowUser } from "@agent-native/core/client";

const { isFollowing, stopFollowing } = useFollowUser({
  others,
  followingId, // null to stop following
  viewportKey: "viewport",
  onViewport: (vp) => {
    if (vp.fileId) setActiveFileId(vp.fileId);
    if (vp.zoom) setZoom(vp.zoom);
  },
});
```

ينشر المشاركون إطار العرض الخاص بهم باستخدام `setPresence({ viewport: { fileId, zoom } })`.

### دعائم وضع المتابعة `PresenceBar` {#presence-bar-follow}

يقبل الآن مكون `PresenceBar` دعائم وضع المتابعة الاختيارية:

```tsx
<PresenceBar
  activeUsers={activeUsers}
  agentActive={agentActive}
  onAvatarClick={(user) => {
    // user is null for the agent avatar
    const email = user?.email ?? "agent@system";
    setFollowing((prev) => (prev === email ? null : email));
  }}
  followingEmail={followingEmail} // highlighted avatar + "Following X" chip
/>
```

### مساعدي التنسيق الطبيعي {#norm-coords}

```ts
import { toNormalized, fromNormalized } from "@agent-native/core/client";

// In a pointer event handler:
const norm = toNormalized(
  e.clientX,
  e.clientY,
  container.getBoundingClientRect(),
);
setPresence({ cursor: norm });

// In a cursor renderer:
const px = fromNormalized(norm, container.getBoundingClientRect());
```

### عامل السباكة {#agent-cursor}

استدعاء actions من جانب الخادم `agentUpdateSelection()` للنشر حيث يعمل الوكيل. يستدعي `edit-design` و`generate-design` actions لقالب التصميم هذا تلقائيًا. يمكن للنماذج الأخرى أن تفعل الشيء نفسه:

```ts
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
} from "@agent-native/core/collab";

agentEnterDocument(docId);
agentUpdateSelection(docId, {
  selection: "#target-element",
  editingFile: "index.html",
});
try {
  // ... perform edits ...
} finally {
  agentLeaveDocument(docId);
}
```

تتدفق بيانات تعريف التحديد عبر `usePresence` على العملاء المتصلين كـ `other.presence.selection`.

---

## جدول التوجيه {#routes}

يتم تثبيت جميع المسارات تلقائيًا ضمن `/_agent-native/collab/` بواسطة التعاون
المكون الإضافي:

| المسار                        | الغرض                                                                |
| ----------------------------- | -------------------------------------------------------------------- |
| `GET /:docId/state`           | حالة Y.Doc الكاملة (base64). يقبل `?stateVector=` للفرق              |
| `POST /:docId/update`         | تطبيق تحديث Yjs للعميل (base64). الحد الأقصى 2 ميغابايت بشكل افتراضي |
| `POST /:docId/text`           | تطبيق استبدال النص الكامل (على أساس الاختلاف)                        |
| `POST /:docId/search-replace` | البحث/الاستبدال الجراحي في Y.XmlFragment                             |
| `POST /:docId/json`           | تطبيق فرق JSON الكامل على Y.Map/Y.Array                              |
| `GET /:docId/json`            | اقرأ حالة JSON الحالية                                               |
| `POST /:docId/patch`          | تطبيق عمليات تصحيح JSON الجراحية (ظهور/إزالة/إعادة ترتيب)            |
| `POST /:docId/awareness`      | مزامنة حالة المؤشر/التواجد                                           |
| `GET /:docId/users`           | إدراج المستخدمين النشطين في المستند                                  |

## النقل والأداء {#transport}

| الخاصية                            | القيمة                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| تحديث الارتداد                     | ~80 مللي ثانية (تجمع ضغطات المفاتيح السريعة عبر `Y.mergeUpdates`)             |
| الفاصل الزمني للاستقصاء (بدون SSE) | 2 ثانية (قابلة للتكوين عبر `pollInterval`)                                    |
| الفاصل الزمني للاستقصاء (SSE سليم) | ~12 ثانية (قابلة للتكوين عبر `pollIntervalWithSse`)                           |
| تكرار جلب ناقل الحالة              | عند إعادة الاتصال، أو فجوة المخزن المؤقت للحلقة، أو كل دورة استقصاء خامسة عشر |
| التراجع عن الخطأ                   | أسي مع الارتعاش، الحد الأقصى ~15 ثانية                                        |
| الحمولة القصوى (الكتابة)           | 2 ميجابايت افتراضي، قابل للتكوين عبر `maxPayloadBytes`                        |
| عتبة الضغط                         | النقطة المخزنة > 4× تشفير جديد يؤدي إلى تشغيل علامة مميزة                     |
| قراءات قاعدة البيانات لكل كتابة    | 1 (إصدار CAS للقراءة داخل `persistMergedState` فقط)                           |

## الأمان {#security}

### اضبط `resourceType` دائمًا

```ts
createCollabPlugin({
  resourceType: "document", // the name passed to registerShareableResource
});
```

بدون `resourceType`، يقوم المكون الإضافي بتسجيل تحذير ويبث دفعة تعاون
أحداث لجميع المستخدمين الذين تمت مصادقتهم عند النشر بدون مستوى المستند
النطاق. يعود غير المالكين إلى اللحاق بناقلات الحالة (آمن ولكن أعلى
زمن الوصول) بغض النظر عما إذا تم تعيين `resourceType` أم لا.

### التحقق من الوصول

تتطلب كافة مسارات التعاون المصادقة. عندما يتم تعيين `resourceType`، يقرأ
تتطلب وصول المشاهد على الأقل وتتطلب الكتابة وصول المحرر باستخدام
نفس مساعدي `resolveAccess` / `assertAccess` كنظام المشاركة. أ404
(ليس 403) عند فشل الوصول لتجنب تسرب وجود المستند.

### حدود الحمولة

رفض كتابة المسارات (`update`، `text`، `json`، `patch`، `search-replace`)
تتجاوز الحمولات الحد الذي تم تكوينه باستخدام HTTP 413. الافتراضي هو 2 ميجابايت.
التجاوز لكل مكون إضافي:

```ts
createCollabPlugin({
  resourceType: "document",
  maxPayloadBytes: 512 * 1024, // 512 KB
});
```

### نطاق الوعي

يتم ربط مسارات التوعية (`POST /awareness`، `GET /users`) بنفس البوابة
التحقق من الوصول كما هو مقروء - لا يمكن للمستخدم الذي يفتقر إلى حق الوصول للمشاهد التعرف على الأشخاص الآخرين
يقوم بتحرير مستند.

## الأنماط {#patterns}

### دمج دقيق من جانب الخادم للبيانات المنظمة

بالنسبة للمستندات المنظمة (مجموعات الشرائح، منشئي النماذج، ملفات التصميم) فإن Yjs
يمكن أن يتعارض نموذج التعاون الأساسي عندما يقوم وكيلان أو مستخدمان بإعادة كتابة نفس النموذج
تسجيل المستوى الأعلى في وقت واحد. النمط الأكثر أمانًا هو **جانب الخادم الدقيق
دمج**: تحديد الإجراء الذي يقبل مجموعة من العمليات المستهدفة و
يطبقها تلقائيًا، بحيث تظل التعديلات المتزامنة على العناصر المختلفة موجودة.

**الشرائح (`patch-deck`)** — بدلاً من استبدال المجموعة بأكملها JSON في كل
تغيير، يقبل الإجراء العمليات لكل شريحة:

```ts
// Conceptual patch-deck action shape
type PatchDeckOp =
  | { type: "patch"; slideId: string; fields: Partial<SlideFields> }
  | { type: "add"; position: number; slide: SlideData }
  | { type: "delete"; slideId: string }
  | { type: "reorder"; slideId: string; newIndex: number };
```

ينجح مستخدمان في تحرير شرائح مختلفة؛ لا يوجد مضرب LWW في
مستوى سطح السفينة.

**النماذج (`patch-form-fields`)** — الدمج على مستوى الحقل مع الإدراج/الإزالة/إعادة الترتيب
ops حتى تبقى التعديلات المتزامنة لحقول النماذج المختلفة.

استخدم هذا النمط عندما:

- المستند منظم (عناصر داخل حاوية).
- تستهدف التعديلات المتزامنة عناصر مختلفة.
- التعاون الجسدي (Yjs `Y.XmlFragment`) مبالغ فيه أو غير قابل للتطبيق.

استخدم التعاون الأساسي (Y.XmlFragment + TipTap) عندما:

- المستند عبارة عن نص منسق حر حيث يمكن تعديل أي منطقة.
- دمج المسائل المتعلقة بدمج CRDT على مستوى المؤشر.

### التراجع التعاوني عن تحديد النطاق (Y.UndoManager)

يستخدم قالب التصميم `Y.UndoManager` لنطاق التراجع/الإعادة إلى المستوى المحلي
تعديلات المستخدم الخاصة. لا يتم التراجع مطلقًا عن تعديلات النظير البعيد وتحريرات الوكيل بواسطة
Cmd+Z للمستخدم.

```ts
import * as Y from "yjs";

const LOCAL_EDIT_ORIGIN = "local";

const undoManager = new Y.UndoManager(ydoc.getText("content"), {
  trackedOrigins: new Set([LOCAL_EDIT_ORIGIN]),
  captureTimeout: 800, // coalesce rapid slider drags into one undo step
});

// Wrap local edits with the tracked origin
ydoc.transact(() => {
  // apply local style change
}, LOCAL_EDIT_ORIGIN);

// Undo/redo — only reverses LOCAL_EDIT_ORIGIN transactions
undoManager.undo(); // Cmd+Z
undoManager.redo(); // Shift+Cmd+Z
```

الخصائص الرئيسية:

- يجب أن يكون `trackedOrigins` هو `Set`. فقط transactions ذو الأصل المطابق
  يتم التقاطها في مكدس التراجع.
- التحديثات عن بعد (الأصل `"remote"`) وتحديثات الوكيل (الأصل `"agent"`) هي
  لم يتم التقاطه مطلقًا.
- إعادة إنشاء المدير والتخلص منه عند تغيير المستند النشط؛ قديمة
  يحتفظ المديرون بمراجع يمكن أن تنمو بلا حدود.

## القيود المعروفة {#limitations}

```an-callout
{
  "tone": "risk",
  "body": "**إعادة الكتابة المتزامنة لنفس المنطقة هي الفوز الأخير.** إذا أعاد الوكيل كتابة مقطع بينما كان لدى الإنسان تعديلات غير محفوظة في *نفس المنطقة بالضبط*، يمكن للقطة العميل الرئيسي أن تعرقل التحرير البشري أثناء الرحلة. يتم دائمًا دمج التعديلات في المناطق المختلفة بشكل نظيف عبر CRDT. بالنسبة للمستندات المنظمة، استخدم الدمج الدقيق من جانب الخادم لتجنب ذلك تمامًا."
}
```

- **إعادة الكتابة المتزامنة لنفس المنطقة هي LWW** — إذا أعاد الوكيل كتابة
  مقطع وشخص لديه تعديلات غير محفوظة في نفس المنطقة بالضبط،
  يمكن للقطة العميل المتوقع أن تحل محل التغييرات التي أجراها الإنسان أثناء الرحلة. التعديلات في
  تندمج المناطق المختلفة بشكل صحيح عبر CRDT. دمج دقيق من جانب الخادم
  (انظر أعلاه) يتجنب ذلك بالنسبة للمستندات المنظمة.
- **تأمين الكتابة قيد التشغيل على بدون خادم** — خريطة `_writeLocks` هي
  العملية محلية. تصل الطلبات المتزامنة إلى أجهزة مختلفة بدون خادم
  يتم إجراء تسلسل للاستدعاءات في طبقة SQL CAS (التزامن المتفائل) بدلاً من ذلك
  من قفل الذاكرة. يعد هذا آمنًا ولكنه يعني سيناريوهات عالية الإنتاجية على
  قد يرى بدون خادم المزيد من محاولات CAS.
- **الوعي لكل عملية** — مخزن الوعي في الذاكرة هو
  عملية محلية. تشهد عمليات النشر بدون خادم/متعددة العمليات وعيًا جزئيًا
  حالة لكل استدعاء. لا يزال العملاء يتلقون لقطات توعوية كاملة عن كل
  دورة الاستقصاء، بحيث يتم تحديث مؤشرات التواجد خلال فترة استقصاء واحدة.

## التواجد {#presence}

يرجع الخطاف `useCollaborativeDoc`:

- `activeUsers` — مجموعة من `CollabUser` (الاسم والبريد الإلكتروني واللون) لجميع الأقران
  موجود حاليًا في المستند (مصدره الوعي).
- `agentActive` — `true` لفترة وجيزة بعد قيام الوكيل بإجراء التعديل (استخدمه لـ
  مؤشر بصري عابر).
- `agentPresent` — `true` بينما يكون لدى الوكيل إدخال وعي نشط
  (نبض القلب الدائم الحضور).

استخدم `emailToColor(email)` و`emailToName(email)` من
`@agent-native/core/client` لإنشاء ألوان وشاشة عرض متسقة للمؤشر
الأسماء من عناوين البريد الإلكتروني.

تظهر `PresenceBar` التي تم تقديمها باستخدام `activeUsers` الإنسان والوكيل الحي
المتعاونون. التواجد لكل شريحة (الذي يشاهده المستخدمون شريحة معينة)
طبقات أعلى حالة الوعي نفسها.

## المستندات ذات الصلة {#related}

- [Real-Time Sync](/docs/client#usedbsync) — `useDbSync` + `useChangeVersion`
  النظام الذي يقدم تسوية محرر قيادة الصدمات `updatedAt`.
- [Security](/docs/security) — `registerShareableResource`, `resolveAccess`,
  و`assertAccess` لنموذج الوصول المشار إليه بواسطة `resourceType`.
- [Sharing](/docs/sharing) — كيفية مشاركة المستندات وكيفية منح حق الوصول.
- [Template: Content](/docs/template-content) — التنفيذ المرجعي لـ
  تحرير النص المنسق بشكل تعاوني.
- [Template: Slides](/docs/template-slides) — إجراء `patch-deck` الدقيق لـ
  التحرير المتزامن المنظم.
- [Template: Forms](/docs/template-forms) — `patch-form-fields` على مستوى الحقل
  دمج جانب الخادم.
- [Template: Design](/docs/template-design) — `Y.UndoManager` التراجع/إعادة النطاق
  لتعديلات المستخدم المحلي.
