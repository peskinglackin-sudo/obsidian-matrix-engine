import { canonicalJson, sha256 } from "../evidence/canonical";

export const LEXICAL_GROUPS = ["zh-Hans", "zh-Hant", "en", "ja", "ko", "es", "fr", "de", "ru", "ar", "hi", "th", "zh-en-mixed", "natural-code"] as const;
export const LEXICAL_CATEGORIES = ["body", "title-key", "phrase-order", "normalization", "metadata", "segmentation-risk"] as const;
const TOKENS: Record<(typeof LEXICAL_GROUPS)[number], readonly string[]> = {
  "zh-Hans": ["检索", "向量", "笔记", "索引", "语言", "连接", "标题", "路径", "标签", "片段"],
  "zh-Hant": ["檢索", "向量", "筆記", "索引", "語言", "連結", "標題", "路徑", "標籤", "片段"],
  en: ["retrieval", "vector", "notebook", "indexing", "language", "connection", "heading", "pathway", "tagging", "fragment"],
  ja: ["検索", "ベクトル", "ノート", "索引", "言語", "接続", "見出し", "経路", "タグ", "断片"],
  ko: ["검색", "벡터", "노트", "색인", "언어", "연결", "제목", "경로", "태그", "조각"],
  es: ["búsqueda", "vector", "cuaderno", "índice", "idioma", "conexión", "título", "ruta", "etiqueta", "fragmento"],
  fr: ["recherche", "vecteur", "carnet", "indice", "langue", "connexion", "titre", "chemin", "étiquette", "fragment"],
  de: ["suche", "vektor", "notiz", "index", "sprache", "verbindung", "titel", "pfad", "marke", "abschnitt"],
  ru: ["поиск", "вектор", "заметка", "индекс", "язык", "связь", "заголовок", "путь", "метка", "фрагмент"],
  ar: ["بحث", "متجه", "ملاحظة", "فهرس", "لغة", "اتصال", "عنوان", "مسار", "وسم", "مقطع"],
  hi: ["खोज", "सदिश", "नोट", "सूचकांक", "भाषा", "संबंध", "शीर्षक", "पथ", "टैग", "खंड"],
  th: ["ค้นหา", "เวกเตอร์", "บันทึก", "ดัชนี", "ภาษา", "เชื่อมโยง", "หัวข้อ", "เส้นทาง", "แท็ก", "ส่วน"],
  "zh-en-mixed": ["检索Engine", "向量Store", "笔记Vault", "索引Index", "语言Locale", "连接Graph", "标题Title", "路径Path", "标签Tag", "片段Chunk"],
  "natural-code": ["queryParser", "vector_store", "noteId", "index-v2", "languageCode", "connectGraph", "headingKey", "vault/path", "tagRef", "chunkHash"]
};

export type LexicalDocument = Readonly<{ id: string; group: string; title: string; body: string; path: string; tags: readonly string[] }>;
export type LexicalQuery = Readonly<{ id: string; group: string; category: string; text: string; expectedTargets: readonly string[]; gating: boolean }>;

function marker(category: (typeof LEXICAL_CATEGORIES)[number], index: number): string {
  const code = { body: "body", "title-key": "title", "phrase-order": "phrase", normalization: "norm", metadata: "meta", "segmentation-risk": "risk" }[category];
  return `mx${code}${String(index).padStart(2, "0")}qz`;
}

function fullWidth(value: string): string {
  return Array.from(value).map((character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 0x21 || codePoint > 0x7e) return character;
    return String.fromCodePoint(codePoint + 0xfee0);
  }).join("");
}

export function buildLexicalFixtures(): Readonly<{ documents: readonly LexicalDocument[]; queries: readonly LexicalQuery[]; sha256: string }> {
  const documents: LexicalDocument[] = [];
  const queries: LexicalQuery[] = [];
  for (const group of LEXICAL_GROUPS) {
    TOKENS[group].forEach((token, index) => {
      const phrase = `${marker("phrase-order", index)}first ${marker("phrase-order", index)}second`;
      const segmentationRisk = `${token}${marker("segmentation-risk", index)}`;
      documents.push(Object.freeze({
        id: `${group}-doc-${String(index).padStart(2, "0")}`,
        group,
        title: marker("title-key", index),
        body: `${marker("body", index)} ${phrase} ${fullWidth(marker("normalization", index))} ${segmentationRisk}`,
        path: `${group}/${marker("metadata", index)}.md`,
        tags: Object.freeze([marker("metadata", index)])
      }));
    });
    LEXICAL_CATEGORIES.forEach((category, categoryIndex) => {
      for (let index = 0; index < 5; index += 1) {
        const targetIndex = (categoryIndex * 5 + index) % 10;
        const token = TOKENS[group][targetIndex];
        if (token === undefined) throw new Error("Lexical fixture token missing");
        const text = category === "phrase-order"
          ? `${marker(category, targetIndex)}first ${marker(category, targetIndex)}second`
          : category === "segmentation-risk"
            ? `${token}${marker(category, targetIndex)}`
            : marker(category, targetIndex);
        queries.push(Object.freeze({ id: `${group}-${category}-${String(index)}`, group, category, text, expectedTargets: Object.freeze([`${group}-doc-${String(targetIndex).padStart(2, "0")}`]), gating: true }));
      }
    });
  }
  for (let index = 0; index < 60; index += 1) queries.push(Object.freeze({ id: `diagnostic-${String(index).padStart(2, "0")}`, group: LEXICAL_GROUPS[index % LEXICAL_GROUPS.length] ?? "en", category: "diagnostic", text: `absent-diagnostic-${String(index)}`, expectedTargets: Object.freeze([]), gating: false }));
  const manifest = { schemaVersion: 1, license: "Apache-2.0", analyzerId: "matrix-engine-multilingual", analyzerVersion: 1, documents, queries };
  return Object.freeze({ documents: Object.freeze(documents), queries: Object.freeze(queries), sha256: sha256(canonicalJson(manifest)) });
}
