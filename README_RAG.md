# خطة RAG لمشروع تفسير الأحلام

هذا المشروع يحول كتب تفسير الأحلام والملفات الحديثية الموجودة محليًا إلى فهرس بحث قابل للمراجعة، ثم يستخدم Gemini لصياغة جواب عربي مستند إلى المقتطفات المسترجعة.

## نبذة عن الداتا الحالية

المصادر الرئيسية للتفسير:

- `public/Tafseer_AlAhlam_AlKabeer_BnSereen/Tafseer_AlAhlam_AlKabeer_BnSereen_djvu.txt`
  - أوضح مصدر حاليًا.
  - يستخدم كمصدر تفسير رئيسي.
- `public/Ta_teer_Al_Anam_Fi_Tabeer_Al_Manam/*.txt`
  - تعطير الأنام للنابلسي، جزآن.
  - النص مفيد لكن فيه أخطاء OCR وتلاصق كلمات.
- `public/Tabeer_Al_Roya/Tabeer_Al_Roya_Le_Ibn_Qutaybah_Al_Dinari_djvu.txt`
  - مناسب جدًا لمنهجية التعبير وآداب الرؤيا، وليس مجرد قاموس رموز.
- `scripts/Mawsoat_Al_Ahlam_Al_Ammah_djvu.txt`
  - OCR ضعيف جدًا في العينات، لذلك وزنه منخفض في الفهرس.

مصادر مساندة:

- `public/Al_Saheehan/Saheeh_Bukhari_djvu.xml`
- `public/Al_Saheehan/Saheeh_Muslim_Book_djvu.xml`

الصحيحان يستخدمان كمصدر شرعي مساند لآداب الرؤيا والأحاديث، وليس كموسوعة تفسير رموز.

## كيف يعمل النظام

```text
كتب TXT/XML
  ↓
تنظيف وتطبيع عربي
  ↓
تقسيم إلى chunks
  ↓
فهرس بحث محلي
  ↓
استرجاع أفضل المقاطع
  ↓
إرسال المقاطع إلى Gemini
  ↓
جواب + مصادر + تقييم + debug
```

## الأوامر

ثبت الحزم:

```bash
pnpm install
```

ابن الفهرس:

```bash
pnpm rag:build
```

جرّب البحث بدون Gemini:

```bash
pnpm rag:search "رأيت أسدا يلاحقني وخفت منه ودخلت البيت"
```

ابن التطبيق:

```bash
pnpm build
```

شغّل الواجهة:

```bash
pnpm start
```

ثم افتح:

```text
http://localhost:3000
```

## Gemini

ضع المفتاح في `.env` بهذا الاسم:

```bash
GOOGLE_AI_STUDIO_API_KEY=...
```

الموديل الافتراضي مأخوذ من:

```bash
GEMINI_TEXT_MODEL
```

أو:

```bash
GEMINI_COMPOSE_MODEL
```

إن لم توجد قيمة، يستخدم التطبيق `gemini-2.5-flash`.

إعدادات مقاومة مشاكل الكوتا والردود غير الصالحة:

```bash
GEMINI_LITE_MODEL=gemini-2.5-flash-lite
GEMINI_FALLBACK_MODELS=
GEMINI_MIN_REQUEST_INTERVAL_MS=12000
GEMINI_MAX_RETRIES=1
GEMINI_RETRY_BASE_DELAY_MS=1500
GEMINI_COMPOSE_MAX_OUTPUT_TOKENS=2200
```

المعنى:

- إذا رفض `gemini-2.5-flash` الطلب بسبب `429 RESOURCE_EXHAUSTED`، ينتظر التطبيق حسب `retryDelay` ثم يحاول مرة ثانية.
- إذا بقي الطلب مرفوضًا، يجرب `GEMINI_LITE_MODEL`.
- `GEMINI_MIN_REQUEST_INTERVAL_MS=12000` يبطئ الطلبات حتى لا يتجاوز حد الخطة المجانية بسرعة.
- الرد مضبوط على `responseMimeType: application/json`، ومع ذلك يوجد تنظيف احتياطي للرد لو رجع داخل ```json.

إذا ظهرت رسالة:

```text
Your prepayment credits are depleted
```

فهذه ليست مشكلة كود؛ معناها أن رصيد مشروع Google AI Studio نفسه انتهى ويحتاج إدارة billing/prepay أو مفتاح/مشروع آخر.

إذا ظهرت:

```text
RESOURCE_EXHAUSTED / 429
```

فهذه غالبًا rate limit مؤقت. انتظر قيمة `retryDelay` أو قلل تكرار الطلبات.

## ماذا يعرض الديباق

الواجهة تعرض:

- نص الحلم بعد التطبيع.
- كلمات البحث المستخرجة.
- عدد المقاطع المرشحة.
- أفضل المقاطع المسترجعة مع المصدر والمؤلف والموضع.
- score لكل مقطع.
- تقييم Gemini لتغطية البحث وقوة الاستشهاد وحذر الجواب.
- Thought summary من Gemini إذا أرجعه الموديل.
- stage الذي فشل فيه الطلب.
- محاولات Gemini: الموديل، attempt، مدة الطلب، هل نجح، status/code، وretryDelay.
- partial retrieval إذا نجح البحث وفشل Gemini.

ملاحظة: Thought summary ليس سلسلة التفكير الداخلية الخام، بل ملخص رسمي قابل للعرض عندما يدعمه Gemini.

## التطوير القادم

النسخة الحالية RAG نصي سريع ومناسب للتقييم الأولي. بعد مراجعة جودة النتائج، الخطوة الاحترافية التالية:

1. تنظيف OCR للنابلسي والموسوعة العامة.
2. فصل الكتب إلى أبواب ورموز مثل: أسد، بيت، باب، ماء.
3. إضافة Qdrant وembeddings.
4. إضافة reranker.
5. حفظ تقييمات المستخدمين لتحسين الاسترجاع.
