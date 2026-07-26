import { canonicalJson, sha256 } from "../evidence/canonical";

export const LANGUAGES = ["zh-Hans", "zh-Hant", "en", "ja", "ko", "es", "fr", "de", "ru", "ar", "hi", "th"] as const;
export const DIRECTIONS = ["zh-Hans-en", "en-zh-Hans", "ja-en", "en-ja", "es-en", "en-es"] as const;
export type SemanticLanguage = (typeof LANGUAGES)[number];
export type SemanticDirection = (typeof DIRECTIONS)[number];

type Phrase = Readonly<{ query: string; document: string }>;
type Concept = Readonly<{ id: string; phrases: Readonly<Partial<Record<SemanticLanguage, Phrase>>> }>;

const CONCEPTS: readonly Concept[] = [
  { id: "lunar-eclipse", phrases: {
    "zh-Hans": { query: "月亮变暗的天文现象", document: "地球的影子遮住月球时会发生月食" }, "zh-Hant": { query: "月亮變暗的天文現象", document: "地球的影子遮住月球時會發生月食" },
    en: { query: "why the moon turns dark", document: "A lunar eclipse occurs when Earth shades the Moon" }, ja: { query: "月が暗くなる天文現象", document: "地球の影が月を覆うと月食が起きる" },
    ko: { query: "달이 어두워지는 천문 현상", document: "지구의 그림자가 달을 가리면 월식이 일어난다" }, es: { query: "fenómeno en que la luna se oscurece", document: "Un eclipse lunar ocurre cuando la Tierra proyecta su sombra sobre la Luna" },
    fr: { query: "phénomène où la lune devient sombre", document: "Une éclipse lunaire se produit quand la Terre cache la lumière de la Lune" }, de: { query: "Himmelsereignis bei dem der Mond dunkel wird", document: "Eine Mondfinsternis entsteht wenn der Erdschatten den Mond bedeckt" },
    ru: { query: "явление когда луна темнеет", document: "Лунное затмение происходит когда тень Земли закрывает Луну" }, ar: { query: "ظاهرة يصبح فيها القمر مظلما", document: "يحدث خسوف القمر عندما يغطي ظل الأرض القمر" },
    hi: { query: "चंद्रमा के अंधेरा होने की खगोलीय घटना", document: "पृथ्वी की छाया चंद्रमा को ढकती है तो चंद्र ग्रहण होता है" }, th: { query: "ปรากฏการณ์ที่ดวงจันทร์มืดลง", document: "จันทรุปราคาเกิดเมื่อเงาโลกบังดวงจันทร์" }
  } },
  { id: "bread-fermentation", phrases: {
    "zh-Hans": { query: "面团为什么会发起来", document: "酵母发酵产生二氧化碳，让面包面团膨胀" }, "zh-Hant": { query: "麵團為什麼會發起來", document: "酵母發酵產生二氧化碳，讓麵包麵團膨脹" },
    en: { query: "what makes bread dough rise", document: "Yeast fermentation releases carbon dioxide that expands bread dough" }, ja: { query: "パン生地が膨らむ理由", document: "酵母の発酵で二酸化炭素が生まれパン生地が膨らむ" },
    ko: { query: "빵 반죽이 부푸는 이유", document: "효모 발효에서 생긴 이산화탄소가 빵 반죽을 부풀린다" }, es: { query: "por qué sube la masa de pan", document: "La fermentación de la levadura libera dióxido de carbono que infla la masa" },
    fr: { query: "pourquoi la pâte à pain gonfle", document: "La fermentation de la levure libère du dioxyde de carbone qui fait lever la pâte" }, de: { query: "warum Brotteig aufgeht", document: "Bei der Hefegärung entsteht Kohlendioxid das den Brotteig aufgehen lässt" },
    ru: { query: "почему поднимается тесто для хлеба", document: "Дрожжевое брожение выделяет углекислый газ и поднимает тесто" }, ar: { query: "لماذا يرتفع عجين الخبز", document: "ينتج تخمر الخميرة ثاني أكسيد الكربون فيتمدد العجين" },
    hi: { query: "रोटी का आटा क्यों फूलता है", document: "खमीर के किण्वन से कार्बन डाइऑक्साइड बनती है और आटा फूलता है" }, th: { query: "เหตุใดแป้งขนมปังจึงฟู", document: "ยีสต์หมักแล้วปล่อยคาร์บอนไดออกไซด์ทำให้แป้งขยายตัว" }
  } },
  { id: "rainwater-garden", phrases: {
    "zh-Hans": { query: "花园怎样收集雨水", document: "雨水桶可以储存屋顶径流，用来浇灌花园" }, "zh-Hant": { query: "花園怎樣收集雨水", document: "雨水桶可以儲存屋頂逕流，用來澆灌花園" },
    en: { query: "collecting rain for a garden", document: "A rain barrel stores roof runoff for watering a garden" }, ja: { query: "庭で雨水を集める方法", document: "雨水タンクは屋根からの雨をためて庭の水やりに使える" },
    ko: { query: "정원에서 빗물을 모으는 방법", document: "빗물통은 지붕에서 흐른 물을 저장해 정원에 사용할 수 있다" }, es: { query: "recoger lluvia para el jardín", document: "Un barril de lluvia guarda el agua del tejado para regar el jardín" },
    fr: { query: "récupérer la pluie pour le jardin", document: "Un récupérateur stocke l'eau du toit pour arroser le jardin" }, de: { query: "Regenwasser für den Garten sammeln", document: "Eine Regentonne speichert Dachwasser zum Gießen des Gartens" },
    ru: { query: "сбор дождевой воды для сада", document: "Дождевая бочка хранит воду с крыши для полива сада" }, ar: { query: "جمع مياه المطر للحديقة", document: "يخزن برميل المطر مياه السطح لاستخدامها في ري الحديقة" },
    hi: { query: "बगीचे के लिए वर्षा जल जमा करना", document: "रेन बैरल छत का पानी बगीचे की सिंचाई के लिए सहेजता है" }, th: { query: "เก็บน้ำฝนไว้ใช้ในสวน", document: "ถังเก็บน้ำฝนรองรับน้ำจากหลังคาเพื่อใช้รดสวน" }
  } },
  { id: "train-transfer", phrases: {
    "zh-Hans": { query: "火车换乘要预留什么", document: "规划铁路换乘时要考虑站台距离和转车时间" }, "zh-Hant": { query: "火車轉乘要預留什麼", document: "規劃鐵路轉乘時要考慮月台距離和轉車時間" },
    en: { query: "planning a connection between trains", document: "A rail transfer should allow time to walk between platforms" }, ja: { query: "列車の乗り換え計画", document: "鉄道の乗り換えではホーム間の移動時間を確保する" },
    ko: { query: "기차 환승 계획", document: "철도 환승에는 승강장 사이를 이동할 시간을 확보해야 한다" }, es: { query: "planear una conexión entre trenes", document: "Un transbordo ferroviario debe dejar tiempo para cambiar de andén" },
    fr: { query: "prévoir une correspondance entre trains", document: "Une correspondance ferroviaire doit laisser le temps de changer de quai" }, de: { query: "Umstieg zwischen Zügen planen", document: "Für einen Bahnwechsel muss Zeit für den Weg zwischen den Gleisen bleiben" },
    ru: { query: "планирование пересадки между поездами", document: "При пересадке нужно оставить время на переход между платформами" }, ar: { query: "التخطيط للتبديل بين القطارات", document: "يجب أن يتيح تبديل القطار وقتا للانتقال بين الأرصفة" },
    hi: { query: "रेलगाड़ियों के बीच बदलाव की योजना", document: "ट्रेन बदलते समय प्लेटफॉर्मों के बीच चलने का समय रखना चाहिए" }, th: { query: "วางแผนเปลี่ยนขบวนรถไฟ", document: "การต่อรถไฟควรเผื่อเวลาเดินระหว่างชานชาลา" }
  } },
  { id: "guitar-tuning", phrases: {
    "zh-Hans": { query: "吉他音高不准怎么办", document: "用调音器调整每根琴弦可以恢复吉他的标准音高" }, "zh-Hant": { query: "吉他音高不準怎麼辦", document: "用調音器調整每根琴弦可以恢復吉他的標準音高" },
    en: { query: "fixing the pitch of a guitar", document: "A tuner guides each guitar string back to its standard pitch" }, ja: { query: "ギターの音程を直す方法", document: "チューナーを使って各弦を標準の音程に合わせる" },
    ko: { query: "기타 음정을 맞추는 방법", document: "튜너를 사용해 기타 줄을 표준 음높이에 맞춘다" }, es: { query: "corregir la afinación de una guitarra", document: "Un afinador ayuda a llevar cada cuerda de guitarra a su tono estándar" },
    fr: { query: "corriger la justesse d'une guitare", document: "Un accordeur ramène chaque corde de guitare à sa hauteur standard" }, de: { query: "Tonhöhe einer Gitarre korrigieren", document: "Ein Stimmgerät bringt jede Gitarrensaite auf die Standardtonhöhe" },
    ru: { query: "как исправить строй гитары", document: "Тюнер помогает настроить каждую струну гитары на нужную высоту" }, ar: { query: "تصحيح نغمة الغيتار", document: "يساعد جهاز الضبط على إعادة كل وتر إلى النغمة القياسية" },
    hi: { query: "गिटार की सुर ठीक करना", document: "ट्यूनर हर गिटार तार को मानक सुर पर लाने में मदद करता है" }, th: { query: "แก้ระดับเสียงกีตาร์", document: "เครื่องตั้งสายช่วยปรับสายกีตาร์แต่ละเส้นให้ตรงระดับมาตรฐาน" }
  } },
  { id: "sleep-routine", phrases: {
    "zh-Hans": { query: "怎样建立规律睡眠", document: "每天在相近时间上床和起床有助于稳定睡眠节律" }, "zh-Hant": { query: "怎樣建立規律睡眠", document: "每天在相近時間上床和起床有助於穩定睡眠節律" },
    en: { query: "building a regular sleep schedule", document: "Going to bed and waking at similar times supports a stable sleep rhythm" }, ja: { query: "規則的な睡眠習慣を作る", document: "毎日ほぼ同じ時間に寝起きすると睡眠リズムが整う" },
    ko: { query: "규칙적인 수면 습관 만들기", document: "매일 비슷한 시간에 자고 일어나면 수면 리듬이 안정된다" }, es: { query: "crear un horario regular de sueño", document: "Acostarse y levantarse a horas parecidas estabiliza el ritmo de sueño" },
    fr: { query: "établir un rythme de sommeil régulier", document: "Se coucher et se lever à des heures proches stabilise le sommeil" }, de: { query: "einen regelmäßigen Schlafplan aufbauen", document: "Ähnliche Schlaf- und Aufstehzeiten stabilisieren den Schlafrhythmus" },
    ru: { query: "как наладить регулярный сон", document: "Отход ко сну и подъем в одно время стабилизируют режим сна" }, ar: { query: "بناء جدول نوم منتظم", document: "النوم والاستيقاظ في أوقات متقاربة يساعدان على ثبات إيقاع النوم" },
    hi: { query: "नियमित नींद की दिनचर्या बनाना", document: "रोज लगभग एक समय सोना और उठना नींद की लय स्थिर करता है" }, th: { query: "สร้างตารางนอนให้สม่ำเสมอ", document: "การนอนและตื่นเวลาใกล้เคียงกันทุกวันช่วยให้จังหวะการนอนคงที่" }
  } },
  { id: "storm-forecast", phrases: {
    "zh-Hans": { query: "如何判断暴风雨将到", document: "气压快速下降和雷达回波增强可能预示风暴接近" }, "zh-Hant": { query: "如何判斷暴風雨將到", document: "氣壓快速下降和雷達回波增強可能預示風暴接近" },
    en: { query: "signs that a storm is approaching", document: "Falling air pressure and stronger radar echoes can signal an incoming storm" }, ja: { query: "嵐が近づく兆候", document: "気圧の急低下と強いレーダー反射は嵐の接近を示すことがある" },
    ko: { query: "폭풍이 다가오는 징후", document: "기압 하락과 강한 레이더 반사는 폭풍 접근을 알릴 수 있다" }, es: { query: "señales de que se acerca una tormenta", document: "La caída de presión y ecos fuertes de radar pueden anunciar una tormenta" },
    fr: { query: "signes annonçant une tempête", document: "Une baisse de pression et des échos radar forts peuvent signaler une tempête" }, de: { query: "Anzeichen für einen nahenden Sturm", document: "Fallender Luftdruck und stärkere Radarechos können einen Sturm ankündigen" },
    ru: { query: "признаки приближения бури", document: "Падение давления и усиление радарного сигнала могут предвещать бурю" }, ar: { query: "علامات اقتراب العاصفة", document: "قد يشير انخفاض الضغط وقوة صدى الرادار إلى عاصفة قادمة" },
    hi: { query: "तूफान आने के संकेत", document: "गिरता वायु दबाव और तेज रडार संकेत आने वाले तूफान को दिखा सकते हैं" }, th: { query: "สัญญาณว่าพายุกำลังมา", document: "ความกดอากาศที่ลดลงและสัญญาณเรดาร์ที่แรงขึ้นอาจบอกว่าพายุกำลังเข้า" }
  } },
  { id: "spaced-learning", phrases: {
    "zh-Hans": { query: "怎样长期记住所学内容", document: "把复习分散到多天进行，比一次集中学习更利于长期记忆" }, "zh-Hant": { query: "怎樣長期記住所學內容", document: "把複習分散到多天進行，比一次集中學習更利於長期記憶" },
    en: { query: "remembering lessons for longer", document: "Spacing review across several days improves long-term retention" }, ja: { query: "学んだ内容を長く覚える方法", document: "復習を数日に分ける間隔学習は長期記憶を高める" },
    ko: { query: "배운 내용을 오래 기억하는 방법", document: "복습을 여러 날에 나누는 간격 학습은 장기 기억을 높인다" }, es: { query: "recordar lo aprendido durante más tiempo", document: "Repartir el repaso durante varios días mejora la retención a largo plazo" },
    fr: { query: "retenir une leçon plus longtemps", document: "Espacer les révisions sur plusieurs jours améliore la mémoire à long terme" }, de: { query: "Lernstoff länger behalten", document: "Über mehrere Tage verteiltes Wiederholen verbessert das Langzeitgedächtnis" },
    ru: { query: "как надолго запомнить материал", document: "Повторение с интервалами в несколько дней улучшает долговременную память" }, ar: { query: "تذكر الدروس لمدة أطول", document: "توزيع المراجعة على عدة أيام يحسن الاحتفاظ طويل المدى" },
    hi: { query: "पढ़ी बातों को लंबे समय तक याद रखना", document: "कई दिनों में बाँटकर दोहराने से दीर्घकालीन स्मृति बेहतर होती है" }, th: { query: "จำบทเรียนให้ได้นานขึ้น", document: "การทบทวนแบบเว้นช่วงหลายวันช่วยเพิ่มความจำระยะยาว" }
  } },
  { id: "emergency-fund", phrases: {
    "zh-Hans": { query: "如何准备意外开支", document: "应急储蓄可以支付失业、维修或医疗等突发费用" }, "zh-Hant": { query: "如何準備意外開支", document: "緊急儲蓄可以支付失業、維修或醫療等突發費用" },
    en: { query: "saving for unexpected expenses", document: "An emergency fund covers sudden costs such as repairs or medical bills" }, ja: { query: "予期しない出費への備え", document: "緊急資金は修理や医療など突然の費用に備える貯蓄である" },
    ko: { query: "예상하지 못한 지출에 대비하기", document: "비상금은 수리비나 의료비 같은 갑작스러운 비용을 충당한다" }, es: { query: "ahorrar para gastos inesperados", document: "Un fondo de emergencia cubre costes repentinos como reparaciones o facturas médicas" },
    fr: { query: "épargner pour les dépenses imprévues", document: "Un fonds d'urgence couvre les réparations ou frais médicaux soudains" }, de: { query: "für unerwartete Ausgaben sparen", document: "Ein Notgroschen deckt plötzliche Reparatur- oder Arztkosten" },
    ru: { query: "накопления на непредвиденные расходы", document: "Резервный фонд покрывает внезапный ремонт или медицинские счета" }, ar: { query: "الادخار للنفقات غير المتوقعة", document: "يغطي صندوق الطوارئ تكاليف مفاجئة مثل الإصلاح أو العلاج" },
    hi: { query: "अचानक खर्चों के लिए बचत", document: "आपातकालीन निधि मरम्मत या चिकित्सा जैसे अचानक खर्चों को संभालती है" }, th: { query: "ออมเงินสำหรับค่าใช้จ่ายฉุกเฉิน", document: "เงินสำรองฉุกเฉินใช้จ่ายค่าซ่อมหรือค่ารักษาที่เกิดขึ้นกะทันหัน" }
  } },
  { id: "software-backup", phrases: {
    "zh-Hans": { query: "如何防止文件意外丢失", document: "定期自动备份并保留异地副本可以降低数据丢失风险" }, "zh-Hant": { query: "如何防止檔案意外遺失", document: "定期自動備份並保留異地副本可以降低資料遺失風險" },
    en: { query: "preventing accidental file loss", document: "Regular automated backups with an offsite copy reduce the risk of data loss" }, ja: { query: "ファイルの予期しない消失を防ぐ", document: "定期的な自動バックアップと遠隔地の複製でデータ消失を減らせる" },
    ko: { query: "파일이 갑자기 사라지는 것을 막기", document: "정기 자동 백업과 외부 사본은 데이터 손실 위험을 줄인다" }, es: { query: "evitar la pérdida accidental de archivos", document: "Copias automáticas periódicas y una copia externa reducen el riesgo de perder datos" },
    fr: { query: "éviter la perte accidentelle de fichiers", document: "Des sauvegardes automatiques et une copie distante réduisent le risque de perte" }, de: { query: "versehentlichen Dateiverlust verhindern", document: "Regelmäßige automatische Sicherungen mit externer Kopie senken das Verlustrisiko" },
    ru: { query: "как избежать случайной потери файлов", document: "Регулярные автоматические и удаленные копии снижают риск потери данных" }, ar: { query: "منع فقدان الملفات بالخطأ", document: "تقلل النسخ الاحتياطية الآلية مع نسخة خارجية خطر فقدان البيانات" },
    hi: { query: "फाइलें अचानक खोने से बचना", document: "नियमित स्वचालित बैकअप और बाहरी प्रति डेटा हानि का जोखिम घटाते हैं" }, th: { query: "ป้องกันไฟล์สูญหายโดยไม่ตั้งใจ", document: "การสำรองอัตโนมัติเป็นประจำพร้อมสำเนานอกสถานที่ช่วยลดความเสี่ยงข้อมูลหาย" }
  } },
  { id: "urban-bees", phrases: {
    "zh-Hans": { query: "城市里怎样帮助蜜蜂", document: "种植本地开花植物并减少农药可以为城市蜜蜂提供食物" }, en: { query: "helping bees in a city", document: "Planting native flowers and reducing pesticides provides food for urban bees" },
    ja: { query: "都市でミツバチを助ける方法", document: "在来の花を植え農薬を減らすと都市のミツバチの餌になる" }, es: { query: "ayudar a las abejas en una ciudad", document: "Plantar flores nativas y reducir pesticidas alimenta a las abejas urbanas" }
  } },
  { id: "solar-roof", phrases: {
    "zh-Hans": { query: "屋顶怎样利用阳光发电", document: "光伏板把屋顶接收的太阳光转换为电能" }, en: { query: "making electricity from sunlight on a roof", document: "Photovoltaic panels convert sunlight on a roof into electricity" },
    ja: { query: "屋根の日光から発電する方法", document: "太陽光パネルは屋根に当たる光を電力へ変換する" }, es: { query: "generar electricidad con el sol del tejado", document: "Los paneles fotovoltaicos convierten la luz solar del tejado en electricidad" }
  } },
  { id: "library-catalog", phrases: {
    "zh-Hans": { query: "怎样查找图书馆藏书", document: "图书馆目录可以按作者、书名或主题定位馆藏" }, en: { query: "finding a book held by a library", document: "A library catalog locates holdings by author, title, or subject" },
    ja: { query: "図書館の本を探す方法", document: "図書館目録では著者名、書名、主題から所蔵資料を探せる" }, es: { query: "encontrar un libro en una biblioteca", document: "El catálogo localiza fondos por autor, título o tema" }
  } },
  { id: "bike-brakes", phrases: {
    "zh-Hans": { query: "自行车刹车变软怎么检查", document: "检查刹车片磨损和线缆张力可以恢复自行车制动力" }, en: { query: "checking weak bicycle brakes", document: "Inspecting pad wear and cable tension can restore bicycle braking force" },
    ja: { query: "自転車のブレーキが弱い時の点検", document: "パッドの摩耗とケーブル張力を確認すると制動力を戻せる" }, es: { query: "revisar frenos débiles de bicicleta", document: "Revisar el desgaste de las pastillas y la tensión del cable recupera la frenada" }
  } },
  { id: "food-compost", phrases: {
    "zh-Hans": { query: "厨房残渣如何变成肥料", document: "把果蔬残渣与干燥材料混合堆肥可以形成土壤改良剂" }, en: { query: "turning kitchen scraps into fertilizer", document: "Composting fruit and vegetable scraps with dry material creates a soil amendment" },
    ja: { query: "台所のくずを肥料にする方法", document: "野菜くずと乾いた材料を堆肥化すると土壌改良材になる" }, es: { query: "convertir restos de cocina en abono", document: "Compostar restos de fruta y verdura con material seco produce una mejora para el suelo" }
  } }
] as const;

function phrase(concept: Concept, language: SemanticLanguage): Phrase {
  const value = concept.phrases[language];
  if (value === undefined) throw new Error(`SEMANTIC_PHRASE_MISSING_${concept.id}_${language}`);
  return value;
}

function splitDirection(direction: SemanticDirection): readonly [SemanticLanguage, SemanticLanguage] {
  const mapping: Record<SemanticDirection, readonly [SemanticLanguage, SemanticLanguage]> = {
    "zh-Hans-en": ["zh-Hans", "en"], "en-zh-Hans": ["en", "zh-Hans"],
    "ja-en": ["ja", "en"], "en-ja": ["en", "ja"],
    "es-en": ["es", "en"], "en-es": ["en", "es"]
  };
  return mapping[direction];
}

export function buildSemanticFixtures() {
  const recipe = { queryPrefix: "Query: ", documentPrefix: "Document: ", modelPreset: "jina-v5-nano", dimensions: 768, pooling: "last" } as const;
  const recipeSha256 = sha256(canonicalJson(recipe));
  const coreConcepts = CONCEPTS.slice(0, 10);
  const documentLanguages = new Set<SemanticLanguage>([...LANGUAGES]);
  const documents = CONCEPTS.flatMap((concept, conceptIndex) => [...documentLanguages]
    .filter((language) => concept.phrases[language] !== undefined)
    .map((language) => ({ id: `${language}-doc-${concept.id}`, language, conceptId: concept.id, text: `${recipe.documentPrefix}${phrase(concept, language).document}`, sourceOrder: conceptIndex })));
  const distractors = LANGUAGES.flatMap((language) => coreConcepts.flatMap((concept, conceptIndex) =>
    Array.from({ length: 4 }, (_, offset) => {
      const adjacent = coreConcepts[(conceptIndex + offset + 1) % coreConcepts.length];
      if (adjacent === undefined) throw new Error("SEMANTIC_DISTRACTOR_MISSING");
      return { id: `${language}-distractor-${concept.id}-${String(offset)}`, language, conceptId: concept.id, text: `${recipe.documentPrefix}${phrase(adjacent, language).document}` };
    })));
  const sameLanguage = LANGUAGES.flatMap((language) => coreConcepts.map((concept) => ({
    id: `${language}-query-${concept.id}`, language, conceptId: concept.id,
    text: `${recipe.queryPrefix}${phrase(concept, language).query}`,
    expectedTargets: [`${language}-doc-${concept.id}`]
  })));
  const crossLanguage = DIRECTIONS.flatMap((direction) => {
    const [source, target] = splitDirection(direction);
    return CONCEPTS.map((concept) => ({
      id: `${direction}-query-${concept.id}`, direction, conceptId: concept.id,
      text: `${recipe.queryPrefix}${phrase(concept, source).query}`,
      expectedTargets: [`${target}-doc-${concept.id}`]
    }));
  });
  const allQueries = [...sameLanguage, ...crossLanguage];
  const candidateDocuments = [...documents, ...distractors];
  const prefixControls = {
    queries: allQueries.flatMap(({ id, text }) => [
      { id: `${id}-prefix-removed`, sourceId: id, kind: "query-prefix-removed" as const, text: text.slice(recipe.queryPrefix.length) },
      { id: `${id}-prefix-swapped`, sourceId: id, kind: "query-prefix-swapped" as const, text: `${recipe.documentPrefix}${text.slice(recipe.queryPrefix.length)}` }
    ]),
    documents: candidateDocuments.flatMap(({ id, text }) => [
      { id: `${id}-prefix-removed`, sourceId: id, kind: "document-prefix-removed" as const, text: text.slice(recipe.documentPrefix.length) },
      { id: `${id}-prefix-swapped`, sourceId: id, kind: "document-prefix-swapped" as const, text: `${recipe.queryPrefix}${text.slice(recipe.documentPrefix.length)}` }
    ])
  };
  const manifest = { schemaVersion: 2, license: "Apache-2.0", recipe, recipeSha256, documents, distractors, sameLanguage, crossLanguage, prefixControls } as const;
  return Object.freeze({ ...manifest, sha256: sha256(canonicalJson(manifest)) });
}
