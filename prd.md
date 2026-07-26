# Matrix Engine for Obsidian
## 多语言本地优先检索与知识关联插件 PRD v2.0

> 文档状态：设计评审稿  
> 版本：2.0  
> 日期：2026-07-14  
> 目标平台：Obsidian Desktop  
> 最终插件 ID：`matrix-engine`
> 英文名称：`Matrix Engine`
> 中文名称：`矩阵引擎`
> 核心能力：精准检索、全文检索、语义检索、混合检索、语义关联知识点、多语言、本地与远程向量模型、可扩展重排序

---

## 0. 文档目的

本文档定义一个独立的 Obsidian 检索插件。插件不是 `smart-lookup-obsidian` 的补丁，也不以 `obsidian-smart-env` 作为运行时平台；它吸收 Omnisearch 在已知内容检索方面的产品经验，以及 Smart Connections 在语义发现和当前笔记关联方面的交互经验，但核心实现、数据模型和检索管线均独立设计。

本 PRD 用于：

- 产品范围确认。
- 架构评审。
- MVP、P1、P2 排期。
- 数据结构与接口冻结。
- 多语言支持边界确认。
- 检索质量、性能与发布验收。

本文档中的“多语言”同时包含：

1. **内容多语言**：同一 vault 可包含中文、英文、日文、韩文、阿拉伯文、欧洲语言及混合文本。
2. **查询多语言**：查询可以与文档同语种，也可以通过多语言 embedding 模型进行跨语言语义检索。
3. **界面多语言**：插件 UI、设置项、错误信息和帮助文本可本地化。

---

# 1. 产品摘要

## 1.1 产品定位

```txt
关键词、短语、问题或当前笔记
  -> 精准 / 词法 / 语义 / 混合检索
  -> 可解释的相关结果与关联知识点
  -> 预览 / 打开 / 链接 / 拖拽 / 复制 / 固定 / 隐藏
```

插件解决三类不同问题：

- **已知内容查找**：用户记得标题、路径、原词、代码标识符或精确短语。
- **含义查找**：用户只记得概念、问题或另一种语言下的表达。
- **知识发现**：用户正在阅读或编辑一篇笔记，希望看到相关笔记、相关段落和语义邻接关系。

产品身份合同：

- `manifest.json`、Community 条目和正式安装目录使用不可随意变更的 ID `matrix-engine`。
- 英文显示名称为 `Matrix Engine`；中文 UI/文档名称为 `矩阵引擎`。
- 持久化设置、SecretStorage、数据库、诊断和 artifact namespace 由单一插件 ID 常量派生，不散落硬编码。
- 中文名称只用于本地化显示，不进入持久键、文件路径或升级标识。
- Spike/测试并行安装使用隔离测试 ID 和专用 vault，不读写正式 namespace。
- 截至 2026-07-15，Obsidian Community registry 中未发现 `matrix-engine` ID 或 `Matrix Engine` 名称冲突；正式提交前必须重新检查。

## 1.2 核心价值

- 精确字符串不会被“语义相似”结果淹没。
- 多语言 vault 不要求用户为每种语言维护独立索引。
- 多语言 embedding 模型可支持跨语言知识发现。
- 本地 llama.cpp 与远程 OpenAI-compatible embeddings 使用统一 Provider 接口。
- Query Profile 可复用已有索引，不因查询模板、排序参数或 UI 设置变化而重复嵌入。
- 结果展示匹配原因，而不是只显示无法解释的分数。
- 后台索引不阻塞编辑与搜索。
- 索引是可重建缓存，vault 始终是唯一事实来源。

## 1.3 产品原则

1. **精准检索、词法检索和语义检索是不同能力，不互相冒充。**
2. **多语言是索引和评测的一等维度，不是 UI 中的一个开关。**
3. **本地优先，远程调用必须显式、可预览、可撤销。**
4. **先保证召回完整和结果可解释，再追求 ANN 极限速度。**
5. **逻辑配置与物理索引产物分离。**
6. **写入可恢复、任务可取消、旧任务不能覆盖新内容。**
7. **默认配置适合普通用户，高级配置逐步展开。**
8. **不以全量 O(N²) 相似度图作为知识图谱基础。**

---

# 2. 背景与问题定义

## 2.1 用户问题

Obsidian 用户常同时面临以下问题：

- 核心搜索适合简单文本匹配，但复杂权重、容错、结构化过滤和语义召回有限。
- 纯语义搜索对精确标题、路径、缩写、代码标识符和引号短语不稳定。
- 纯 BM25 或普通分词对中文、日文、泰文等无空格语言不可靠。
- 同一 vault 中常混用中文、英文、代码、产品名和缩写。
- 相关知识点往往存在于其他语言、其他标题或不同表达中。
- 本地模型与远程服务接口能力不一致，配置容易与索引生命周期耦合。
- 大型 vault 的增量索引、原生依赖打包和索引维护容易成为长期性能问题。

## 2.2 现有设计需要修正的问题

本版本明确替换以下早期决策：

| 早期决策 | v2.0 决策 |
|---|---|
| MVP 仅做 Vector Search | MVP 交付 Exact、Lexical、Semantic、基础 Hybrid 和 Connections |
| LanceDB FTS 等同“精准检索” | Exact 与 Lexical 分离，精准结果最终回到原文验证 |
| 每个 Index Profile 一张表 | Provider、Recipe、Corpus、Artifact、Retrieval Profile 分离 |
| 单一 llama.cpp Adapter | 通用 OpenAI-compatible Provider，llama.cpp 作为能力增强实现 |
| 仅用 `content_hash` 判断重嵌入 | 使用最终 `embedding_input_hash` 与分层 hash |
| 所有任务进入单一队列 | 事件合并、解析、嵌入、写入、维护分阶段调度 |
| Source 与 Block 建两套完整索引 | 默认检索 block，source 通过聚合生成 |
| 知识图谱放在模糊后续范围 | MVP 交付当前笔记 Connections，P1 交付懒加载局部图 |
| 原生打包是发布前检查 | 原生打包成为 Spike 0 的 go/no-go 条件 |
| 仅验证工程正确性 | 增加按语言拆分的检索质量基准与 ANN Recall 测试 |

---

# 3. 目标与非目标

## 3.1 产品目标

### G1：可靠的已知内容查找

用户输入标题、路径、标签、标识符、文件名或精确短语时，插件应优先返回真正包含目标字符串的结果。

### G2：高质量多语言词法检索

插件应在不依赖单一语言专用分词器的前提下，为空格语言、CJK、泰文等文本提供可用的全文召回，并允许后续接入语言专用 analyzer。

### G3：同语种与跨语言语义检索

当模型支持多语言语义空间时，用户可使用一种语言查询另一种语言的笔记；插件必须明确显示该能力由当前模型决定。

### G4：当前上下文知识发现

用户打开笔记或选中文本后，可查看相关笔记和知识块，理解关联来源并进行打开、拖拽、固定或隐藏操作。

### G5：性能、完整性与可恢复性

增量更新不得长时间阻塞 UI；搜索结果不得因未维护索引而静默缺失；数据库损坏后可从 vault 重建。

### G6：模型与排序可扩展

本地 llama.cpp、远程 OpenAI-compatible embeddings 和未来 reranker 应通过稳定接口接入，不重写主检索管线。

### G7：隐私透明

远程调用前，用户能看到目标服务、发送字段和渲染后的示例输入；API key 不保存在插件普通设置文件中。

## 3.2 非目标

MVP 与 P1 不包含：

- 移动端支持。
- Chat、Completion、Agent 或自动写作。
- 云端账号体系、OAuth、插件商店或 Pro gating。
- 自动修改用户笔记。
- 全 vault 预计算两两语义边。
- 默认上传遥测、查询或笔记内容。
- 把翻译服务作为跨语言检索的必需依赖。
- 将 LanceDB 数据库视为不可丢失的主数据。

P2 之前不包含：

- PDF、OCR、图片、多模态。
- ColBERT、ColPali 或其他 multivector 模型。
- 移动端替代存储后端。

---

# 4. 目标用户与核心场景

## 4.1 目标用户

### A. 双语或多语研究者

笔记包含中文与英文论文摘要，希望使用中文问题检索英文资料，也希望英文原词能精确命中。

### B. 知识管理用户

希望在写作时自动发现语义相关笔记，而不依赖手工链接和统一命名。

### C. 开发者与技术写作者

笔记中包含类名、函数名、路径、错误码、代码块和自然语言说明，需要精确标识符检索与语义问题检索并存。

### D. 隐私敏感用户

希望全部 embedding 在本地 llama.cpp 完成，索引只保存在设备中。

### E. 远程模型用户

希望使用兼容 OpenAI embeddings API 的企业网关、自托管服务或第三方服务，并清楚了解发送了哪些内容。

## 4.2 核心用户场景

1. 输入 `"embedding dimension"`，只查找原文包含该短语的位置。
2. 输入 `IndexProfileService`，优先命中标题、路径、标识符和原始正文。
3. 输入“如何避免重命名后重新计算全部向量”，检索同义表达。
4. 用中文查询英文笔记“incremental vector indexing strategy”。
5. 在中英文混排笔记中搜索中文概念与英文缩写。
6. 打开当前笔记后查看相关笔记列表，并知道是“语义相似”“共享标签”还是“存在 wikilink”。
7. 用户修改模型连接地址，但向量空间未变时，不重复重建索引。
8. 用户修改文档模板中引用的 `{path}` 后，系统明确要求重嵌入。
9. 用户快速连续编辑同一文件，只有最新版本可写入数据库。
10. 用户断开本地模型服务后，现有 Lexical/Exact 搜索仍可继续工作。

---

# 5. 成功指标

## 5.1 产品指标

- 用户可在一个 Lookup View 中切换或自动选择 Exact、Lexical、Semantic、Hybrid。
- 当前笔记 Connections 在索引可用时自动更新。
- 用户可在不理解 LanceDB 表名的情况下完成首次配置、索引和搜索。
- 远程模型配置始终显示隐私边界和发送预览。
- MVP 必须能够通过官方 Obsidian Community 目录一键安装，并使用其标准更新机制；平台专用手动包只用于 Spike、开发预览和故障诊断。

## 5.2 检索质量指标

按语言和查询类型分别统计：

- Exact Hit@1。
- Recall@5、Recall@10、Recall@20。
- MRR@10。
- nDCG@10。
- Zero-result rate。
- Source diversity。
- Cross-language Recall@10。
- ANN Recall@10 相对 flat ground truth。

MVP 发布门槛：

- 标题、路径、标签、标识符的确定性测试 Hit@1 = 100%。
- 精确短语候选经原文验证后不得返回假阳性。
- Hybrid 在综合基准上不得比 Lexical 与 Semantic 中较优者低超过 1% nDCG@10。
- Hybrid 应在综合查询集上相对单一模式至少提升 5% nDCG@10，或在同等质量下显著降低 zero-result rate。
- 对宣称支持的每个语言组，不得出现超过 10% 的相对质量回退而无显式降级提示。
- 启用 ANN 后 Recall@10 目标不低于 0.95；低于目标时自动回退 flat 或调整参数。

## 5.3 性能指标

在 50,000 chunks、索引已热身、排除 embedding 服务耗时的参考环境中：

- Query parse p95 < 10 ms。
- Exact/Lexical 数据库阶段 p95 < 150 ms。
- Vector 数据库阶段 p95 < 100 ms。
- Fusion、diversify、hydrate 合计 p95 < 80 ms。
- Lookup 首屏渲染 p95 < 50 ms。
- UI 输入不得因后台索引出现可感知持续卡顿。

端到端语义延迟需单独显示：

```txt
query_embed_ms
vector_search_ms
fusion_ms
hydrate_ms
render_ms
```

模型服务耗时不与数据库检索耗时混合统计。

---

# 6. 发布范围与路线图

## 6.1 Spike 0：技术可行性与风险清零

必须在正式业务开发前完成：

- 使用 Spike 启动时 npm `latest` 指向的稳定版 LanceDB；本轮锁定并验证 `@lancedb/lancedb@0.31.0`，不得使用 preview/beta 或跨版本混装原生包。
- Windows x64、macOS Apple Silicon、Linux x64 glibc 的 LanceDB packaged plugin 加载。
- 首版明确不支持 macOS Intel/x64 与 Windows ARM64；不得以 Rosetta、旧版 LanceDB 原生包或包元数据代替支持声明。
- Obsidian enable、disable、reload、升级和数据库关闭测试。
- 路径含空格、中文、日文和 emoji 的数据库测试。
- TypeScript FTS 实际能力探测：`whitespace`、`ngram`、phrase、fuzzy、array field。
- 插件侧多语言预分词原型。
- llama.cpp 字符串数组 batch embeddings。
- 通用 OpenAI-compatible embeddings 服务兼容性测试。
- 10 种语言及混合文本的最小 golden vault。
- Flat search 与 ANN 的质量、延迟对比。

Go/no-go 条件：

- 如果原生 LanceDB 无法通过官方支持的 Obsidian Community 安装与标准更新路径稳定分发，则即使平台专用手工包可以加载，也必须在业务架构冻结前替换 VectorStore 实现。
- 不把首次运行下载/释放 native sidecar 作为默认规避方案；只有在完成完整性、签名、原子安装、回滚、隐私披露并获得目标 Obsidian 分发渠道的书面接受后，才可另行评审。
- 如果 TypeScript FTS 无法满足多语言底线，则保留 LanceDB 向量能力，同时将 LexicalStore 抽象为可替换实现。

## 6.2 MVP：可日常使用的最小完整产品

MVP 必须交付：

- Exact Search。
- Multilingual Lexical Search。
- Semantic Search。
- 基础 Hybrid Search，默认 RRF。
- Auto 模式。
- `.md` 与 `.txt` 扫描。
- heading block 为主的 chunk 索引。
- source 聚合结果。
- 多语言文本分析管线。
- llama.cpp 本地 embedding provider。
- OpenAI-compatible 远程 embedding provider。
- Provider capability probe。
- 增量索引与分阶段调度。
- Lookup View。
- 当前笔记与当前选区 Connections 列表。
- folder、path、tag、extension、mtime 过滤。
- 可解释匹配原因。
- 预览、打开、hover、拖拽、复制链接。
- 索引状态、暂停、恢复、修复和重建。
- 中英文 UI 资源文件与可扩展 i18n 框架。
- 远程发送预览与 SecretStorage 引用。
- rerank 接口预留但默认禁用。

MVP 不交付：

- 全局语义图。
- PDF、OCR、图片。
- 生产级 rerank UI。
- multivector。
- saved searches。
- 移动端。

## 6.3 P1：规模化、可配置与知识图谱

- 完整查询 AST 与布尔组合。
- 字段权重调节。
- 模糊搜索、前缀搜索和用户词典。
- 简繁中文扩展、日文宽窄字符与假名增强、阿拉伯文可选规范化。
- 懒加载 Ego Graph。
- Connections pin、hide、feedback。
- ANN 自动策略与 Recall 校验。
- Scalar/FTS/vector maintenance scheduler。
- Index health dashboard。
- 语言质量 dashboard。
- Profile 导入、导出、复制和差异预览。
- 更多 UI 语言包。
- 结构化 frontmatter filter。
- 受控的高级 raw predicate；默认关闭。

## 6.4 P2：高级检索与多模态

- Rerank 正式启用。
- llama.cpp rerank 与通用 rerank provider。
- PDF page indexing。
- OCR 与图片文本。
- Multivector Search。
- ColBERT / ColPali。
- Query history 与 saved searches。
- 多 Retrieval Profile 对比。
- 结果打包为上下文。
- 可选 query rewrite；必须明确标识并可关闭。
- 移动端后端重新评估。

---

# 7. 搜索模式定义

## 7.1 Exact Search

用途：

- 原始子串。
- 精确短语。
- 标题、文件名、路径。
- 标签。
- URL、错误码、函数名、类名、代码标识符。

原则：

- Exact 结果必须在原始字段或原文片段中完成最终验证。
- FTS、ngram 或 FM index 只用于生成候选，不作为最终真实性依据。
- 匹配大小写、Unicode 规范化和变音符号策略由用户选择。

默认行为：

```txt
"quoted phrase"  -> 精确短语
path:projects     -> 原始路径 contains
file:design.md    -> 文件名精确或前缀
id:IndexProfile   -> 标识符字段优先
```

## 7.2 Lexical Search

用途：

- BM25 相关性。
- 多字段权重。
- 词项组合。
- CJK 字词召回。
- 拼写容错。
- 前缀与子串候选。

Lexical 不承诺跨语言语义等价；它只在当前查询词与索引词之间建立词法匹配。

## 7.3 Semantic Search

用途：

- 同义表达。
- 自然语言问题。
- 概念相关内容。
- 模型支持时的跨语言检索。

Semantic 搜索必须显示当前模型能力：

```txt
Multilingual capability: verified / declared / unknown / failed
```

只有通过内置跨语言探测或用户明确声明后，UI 才显示“支持跨语言检索”。

## 7.4 Hybrid Search

Hybrid 组合：

```txt
Exact candidates
+ Lexical candidates
+ Semantic candidates
-> rank fusion
-> source diversity
-> optional rerank
```

默认融合为 Reciprocal Rank Fusion，不直接线性混合 BM25、向量距离和 rerank 分数。

## 7.5 Auto 模式

Auto 根据 Query AST 选择检索管线：

| 查询特征 | 默认计划 |
|---|---|
| 引号短语、路径、标识符 | Exact + Lexical |
| 1–3 个短词 | Exact + Lexical + Semantic 小权重 |
| 自然语言问题 | Hybrid |
| 仅 metadata filter | Metadata scan |
| 模型不可用 | Exact + Lexical 降级 |
| Lexical index 不可用 | Exact + Semantic 降级 |

Auto 必须在结果区域显示实际执行模式。

---

# 8. 多语言产品要求

## 8.1 支持层级

多语言能力分为四层：

| 层级 | 能力 | 支持边界 |
|---|---|---|
| Unicode Exact | 原始文本、路径、标题和短语验证 | 所有可读取 Unicode 文本 |
| Multilingual Lexical | 分词、字符 ngram、字段权重 | 默认覆盖主要文字系统，质量按语言评测 |
| Semantic | 同语种语义检索 | 取决于 embedding 模型 |
| Cross-lingual Semantic | 不同语言之间语义检索 | 仅在模型验证通过时承诺 |

## 8.2 文本规范化原则

每个字段保留至少两种形态：

```txt
raw      原始文本，用于展示和最终精确验证
norm     检索规范化文本，用于词法召回
```

规范化规则：

- 原始文本永不覆盖。
- Lexical norm 默认执行 Unicode NFKC、大小写折叠和空白统一。
- 变音符号折叠写入独立 secondary field，不替换原始 token。
- 代码块、URL、路径和标识符使用独立规则，避免破坏 `_`、`-`、`.`、`/`、`::`。
- emoji 和符号默认保留在 raw；是否进入 lexical token 由 analyzer 决定。
- 不默认把一种文字转写为另一种文字。

## 8.3 语言与文字系统识别

MVP 不要求对所有文本准确识别具体语言；检索主路由以**文字系统和分词行为**为核心。

每个 chunk 生成：

```ts
type LanguageMetadata = {
  primaryLanguage?: string;       // BCP 47，无法确定时为 und
  languages: string[];
  scripts: Array<
    | "Latin"
    | "Han"
    | "Hiragana"
    | "Katakana"
    | "Hangul"
    | "Cyrillic"
    | "Arabic"
    | "Devanagari"
    | "Thai"
    | "Hebrew"
    | "Other"
  >;
  confidence?: number;
  mixed: boolean;
};
```

MVP 实现：

1. Unicode Script 分类。
2. 可用时使用 `Intl.Segmenter` 进行词边界分割。
3. 无法分词或文本无空格时使用字符 ngram fallback。
4. 具体语言检测作为可插拔 `LanguageDetector`，不阻塞主检索。

## 8.4 默认多语言 Lexical Analyzer

### 8.4.1 空格语言

适用于大多数 Latin、Cyrillic、Greek、Arabic、Hebrew、Devanagari 文本：

- Unicode word segmentation。
- lowercase/casefold。
- 保留原 token 与 accent-folded token。
- MVP 默认不做 aggressive stemming。
- MVP 默认不删除 stop words，以避免短语和混合语言信息丢失。

### 8.4.2 中文

生成：

- `Intl.Segmenter` 或可插拔中文分词结果。
- 汉字 bigram。
- 对短词保留 unigram。
- 英文、数字、缩写独立 token。
- 原文短语通过 raw 验证。

P1 可选：

- 简体/繁体变体扩展。
- 用户词典。
- 专有名词保护。

### 8.4.3 日文

生成：

- 可用时的词边界 token。
- Kanji/Kana bigram fallback。
- Latin 与数字 token。
- P1 增加宽窄字符和可选假名规范化。

### 8.4.4 韩文

生成：

- Hangul word token。
- Hangul syllable bigram fallback。
- Latin 与数字 token。

### 8.4.5 泰文、老挝文、缅甸文、高棉文等无空格语言

- 优先使用 `Intl.Segmenter`。
- 失败时使用字符 bigram/trigram。
- Exact 搜索始终回到 raw 文本验证。

### 8.4.6 代码与标识符

`IdentifierAnalyzer` 额外生成：

```txt
IndexProfileService
Index
Profile
Service
indexprofileservice
index_profile_service
index-profile-service
```

路径额外生成目录段、文件名、扩展名和完整原始路径。

## 8.5 LanceDB 多语言策略

MVP 不把多语言能力硬绑定到 LanceDB 的语言专用 tokenizer。

默认策略：

```txt
插件侧 analyzer
-> 生成空格分隔 lexical_terms
-> LanceDB whitespace FTS

无空格/子串补充
-> lexical_ngrams
-> LanceDB ngram FTS 或预生成 ngram + whitespace FTS
```

运行时通过 `LanceDbCapabilities` 探测：

```ts
type LanceDbCapabilities = {
  fts: boolean;
  phraseQuery: boolean;
  fuzzyQuery: boolean;
  ngramTokenizer: boolean;
  icuTokenizer: boolean;
  fmIndex: boolean;
  labelListIndex: boolean;
  multiMatch: boolean;
};
```

若当前 SDK 后续稳定支持 ICU、Jieba 或 Lindera，用户可在 Advanced 中选择 native analyzer；索引 fingerprint 必须包含 tokenizer 名称、版本和资源摘要。

## 8.6 跨语言语义能力

跨语言能力由 `EmbeddingRecipe` 声明并验证：

```ts
type MultilingualCapability = {
  declared: boolean;
  verified: boolean;
  testedPairs: Array<[string, string]>;
  benchmarkVersion?: string;
  score?: number;
};
```

插件内置轻量测试集，例如：

- 中文 ↔ 英文。
- 日文 ↔ 英文。
- 西班牙文 ↔ 英文。

测试仅用于能力提示，不替代完整 benchmark。

当模型未验证：

- Semantic 仍可使用。
- UI 显示“跨语言能力未知”。
- 不在产品文案中承诺跨语言召回。

## 8.7 UI 国际化

MVP 内置：

- `zh-CN`。
- `en`。

语言资源结构：

```txt
src/i18n/en.json
src/i18n/zh-CN.json
```

要求：

- 所有用户可见字符串使用 key，不在组件内硬编码。
- 使用 BCP 47 locale。
- `uiLocale = auto | explicit locale`。
- Auto 为 best-effort，用户可随时显式覆盖。
- 缺失 key 回退到英文，并在 debug 模式记录。
- 日期、数字、百分比、复数使用 `Intl` API。
- RTL locale 的布局在 P1 验证；文本方向根据内容块自动设置 `dir="auto"`。
- 翻译文件不得影响检索 tokenizer 和内容语言设置。

---

# 9. 查询语法与 Query AST

## 9.1 MVP 查询语法

```txt
"exact phrase"
-excluded
folder:research
path:projects
file:design
ext:md
tag:ai
title:embedding
before:2026-01-01
after:2025-01-01
```

模式快捷前缀：

```txt
exact:IndexProfileService
lexical:vector database
semantic:如何维护增量索引
```

## 9.2 Query AST

```ts
type SearchQueryAst = {
  raw: string;
  positiveTerms: TermNode[];
  exactPhrases: PhraseNode[];
  excludedTerms: TermNode[];
  fieldClauses: FieldClause[];
  filters: MetadataFilterNode[];
  modeHint?: "auto" | "exact" | "lexical" | "semantic" | "hybrid";
  languageHint?: string;
};
```

P1 增加：

- 显式 AND、OR、NOT。
- 括号。
- 字段组合。
- proximity。
- fuzzy distance。
- boost 语法。

QueryParser 不直接生成 LanceDB SQL；它生成 AST，再由各 retriever 编译。

---

# 10. 功能需求

## 10.1 索引与数据源

### FR-001 Vault 扫描

- 扫描 `.md` 与 `.txt`。
- 支持 include folders、exclude folders 和 path glob。
- 首次扫描在 layout ready 后启动。
- `onload` 不执行全量扫描。

### FR-002 增量事件

监听：

- create。
- modify。
- rename。
- delete。
- metadata cache change。

短时间重复事件按 path 合并，采用 latest-wins generation。

### FR-003 Markdown 结构抽取

提取：

- frontmatter。
- title、aliases、tags。
- headings 与 heading path。
- links、embeds。
- tasks。
- code fences。
- line 与 char range。

### FR-004 Chunk 策略

默认：

- heading block 为语义知识点。
- 超长 block 按模型 token 预算切分。
- 小 block 可与相邻 block 合并。
- fenced code block 不在内部解析 heading。
- 表格切分时重复表头。
- chunk embedding 输入包含 title 与 heading path。

## 10.2 Lookup

### FR-010 统一搜索入口

Lookup View 提供：

- Auto、Exact、Lexical、Semantic、Hybrid。
- Blocks、Sources 结果切换。
- Profile 选择。
- 过滤器。
- 索引状态。

### FR-011 搜索降级

- embedding provider 不可用时，Exact/Lexical 继续工作。
- FTS 未就绪时，Exact/Semantic 继续工作。
- 所有降级必须显示原因。

### FR-012 结果操作

- Open source。
- Open in new pane。
- Hover preview。
- Copy wikilink。
- Copy Markdown link。
- Drag result。
- Pin result。
- Hide result。

### FR-013 结果解释

每条结果至少显示一种匹配原因：

```txt
Exact phrase at line 18
Matched title
Matched path
Matched tag #ai
Lexical rank 3
Semantic similarity
Shared wikilink
Hybrid: exact 1 / lexical 4 / semantic 9
```

## 10.3 Connections

### FR-020 当前笔记关联

- 当前活动笔记变化时自动更新。
- 可暂停自动更新。
- 排除当前 source。
- 默认按 source 聚合。
- 显示最相关 block 作为证据。

### FR-021 当前选区关联

- 用户有选区时，可搜索与选中文本相关的知识块。
- 选区查询不写入索引。
- 选区过长时按 query token 预算截断并提示。

### FR-022 反馈

- Pin。
- Hide。
- “不相关”反馈。
- P1 可将反馈用于局部排序，不自动训练模型。

## 10.4 Graph

### FR-030 Ego Graph（P1）

- 以当前 note/block 为 seed。
- 仅加载 top-k 一跳邻居。
- 点击节点时再扩展。
- 默认最多 100 节点。
- 区分 semantic、wikilink、backlink、shared_tag 边。
- 不预计算全 vault 两两相似度。

## 10.5 模型与 Provider

### FR-040 本地 llama.cpp

- 支持 `/v1/embeddings`。
- 可选使用 `/tokenize`、`/props`、`/health`。
- 支持字符串数组 batch。
- 自动探测 embedding dimension。
- 连接失败只暂停依赖该 provider 的 embedding 任务。

### FR-041 OpenAI-compatible Remote

- 自定义 base URL。
- 自定义 model ID。
- API key secret reference。
- 自定义 headers。
- timeout、retry、batch 配置。
- 不要求服务实现 llama.cpp 专属 endpoint。

### FR-042 Rerank 预留

- MVP 定义 `RerankProvider` 接口。
- 无 reranker 时完整检索流程可运行。
- P2 支持 llama.cpp `/v1/rerank` 及通用 rerank API adapter。

## 10.6 Profile 与 Artifact

### FR-050 Provider Profile

定义连接、鉴权、超时与能力覆盖。

### FR-051 Embedding Recipe

定义模型、维度、模板、归一化、metric 和向量空间签名。

### FR-052 Corpus Profile

定义文件范围、抽取版本、chunk 策略和语言分析配置。

### FR-053 Index Artifact

物理索引由唯一的 corpus + lexical + embedding recipe 生成。

### FR-054 Retrieval Profile

定义模式、候选数量、融合、source 聚合、过滤和未来 rerank。

多个 Retrieval Profile 可共享同一 Index Artifact。

## 10.7 管理与恢复

### FR-060 索引状态

显示：

- Files、chunks、rows。
- Pending、active、failed jobs。
- Last sync。
- Unindexed rows。
- Last optimize。
- Artifact state。
- Provider state。

### FR-061 恢复操作

- Retry failed。
- Re-index changed files。
- Rebuild lexical indexes。
- Rebuild vectors。
- Rebuild full artifact。
- Cleanup stale rows。

每个操作必须预览影响范围。

---

# 11. 总体架构

```txt
Obsidian PluginShell
│
├── Core
│   ├── SettingsStore
│   ├── SecretStore
│   ├── TypedEventBus
│   ├── CancellationRegistry
│   └── DiagnosticsService
│
├── Source Pipeline
│   ├── VaultEventCoalescer
│   ├── VaultSourceService
│   ├── MarkdownExtractor
│   ├── SemanticBlockParser
│   ├── LanguageAnalysisService
│   ├── IndexDiffPlanner
│   ├── ParseWorkerPool
│   ├── EmbeddingBatcher
│   ├── IndexWriter
│   └── MaintenanceScheduler
│
├── Provider Layer
│   ├── ProviderRegistry
│   ├── OpenAICompatibleEmbeddingProvider
│   ├── LlamaCppEmbeddingProvider
│   ├── OptionalTokenCounter
│   └── OptionalRerankProvider
│
├── Storage Layer
│   ├── VectorStore
│   ├── LexicalStore
│   ├── SourceRepository
│   ├── ChunkRepository
│   ├── IndexArtifactManager
│   └── LanceDbStore
│
├── Retrieval Pipeline
│   ├── QueryParser
│   ├── QueryPlanner
│   ├── ExactRetriever
│   ├── LexicalRetriever
│   ├── VectorRetriever
│   ├── CandidateFusion
│   ├── SourceAggregator
│   ├── SourceDiversifier
│   ├── OptionalReranker
│   └── ResultHydrator
│
├── Knowledge Discovery
│   ├── ConnectionsService
│   ├── ConnectionFeedbackStore
│   └── SemanticGraphService
│
└── UI
    ├── LookupView
    ├── ConnectionsView
    ├── SemanticGraphView
    ├── SettingsView
    ├── IndexStatusView
    └── I18nService
```

## 11.1 抽象边界

业务层不得直接依赖 LanceDB API：

```ts
interface VectorStore {
  openArtifact(id: string): Promise<VectorArtifactHandle>;
  upsert(rows: VectorRowBatch): Promise<WriteResult>;
  deleteBySourceRevision(input: DeleteInput): Promise<WriteResult>;
  vectorSearch(input: VectorSearchInput): Promise<VectorHit[]>;
  optimize(input: OptimizeInput): Promise<OptimizeResult>;
}

interface LexicalStore {
  lexicalSearch(input: LexicalSearchInput): Promise<LexicalHit[]>;
  exactCandidates(input: ExactCandidateInput): Promise<ExactCandidate[]>;
  rebuildIndexes(input: RebuildLexicalInput): Promise<void>;
}
```

MVP 可由同一 `LanceDbStore` 同时实现两个接口，但保留替换空间。

---

# 12. 核心配置模型

## 12.1 PluginSettings

```ts
type PluginSettings = {
  version: number;
  activeRetrievalProfileId: string;
  providerProfiles: ProviderProfile[];
  embeddingRecipes: EmbeddingRecipe[];
  corpusProfiles: CorpusProfile[];
  lexicalProfiles: LexicalProfile[];
  indexArtifacts: IndexArtifactDescriptor[];
  retrievalProfiles: RetrievalProfile[];
  language: LanguageSettings;
  ui: UiSettings;
  maintenance: MaintenanceSettings;
  privacy: PrivacySettings;
};
```

## 12.2 ProviderProfile

```ts
type ProviderProfile = {
  id: string;
  name: string;
  kind: "openai_compatible" | "llama_cpp";
  baseUrl: string;
  secretRef?: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  maxRetries: number;
  concurrency: number;
  maxBatchItems?: number;
  maxBatchTokens?: number;
  maxPayloadBytes?: number;
  capabilityOverrides?: Partial<EmbeddingCapabilities>;
};
```

连接参数不进入 embedding artifact fingerprint。

## 12.3 EmbeddingRecipe

```ts
type EmbeddingRecipe = {
  id: string;
  name: string;
  providerProfileId: string;
  modelId: string;
  modelSignature: string;
  dimension: number;
  pooling?: string;
  normalize: boolean;
  metric: "cosine" | "dot" | "l2";
  documentTemplate: string;
  queryTemplate: string;
  templateRendererVersion: number;
  tokenizerPolicyVersion: number;
  maxInputTokens?: number;
  multilingual: MultilingualCapability;
  recipeVersion: number;
};
```

`modelSignature` 用于判断向量空间兼容性；相同 `modelId` 不自动视为相同向量空间。

## 12.4 CorpusProfile

```ts
type CorpusProfile = {
  id: string;
  name: string;
  includes: string[];
  excludes: string[];
  fileTypes: Array<"md" | "txt">;
  extractionVersion: number;
  chunkStrategy: "heading_blocks" | "semantic_blocks";
  chunkSizeTokens: number;
  chunkOverlapTokens: number;
  minChunkTokens: number;
  includeCode: boolean;
  includeFrontmatterFields: string[];
};
```

## 12.5 LexicalProfile

```ts
type LexicalProfile = {
  id: string;
  name: string;
  analyzerId: string;
  analyzerVersion: number;
  useIntlSegmenter: boolean;
  cjkNgramMin: number;
  cjkNgramMax: number;
  normalizeNfkc: boolean;
  accentFoldSecondary: boolean;
  preserveStopWords: boolean;
  identifierSplitting: boolean;
  nativeTokenizer?: string;
  customDictionaryHash?: string;
};
```

## 12.6 IndexArtifact

```ts
type IndexArtifactDescriptor = {
  id: string;
  corpusProfileId: string;
  lexicalProfileId: string;
  embeddingRecipeId: string;
  corpusFingerprint: string;
  lexicalFingerprint: string;
  embeddingSpaceId: string;
  artifactFingerprint: string;
  schemaVersion: number;
  sourceTableName: string;
  chunkTableName: string;
  manifestTableName: string;
  state: "building" | "ready" | "stale" | "failed";
  createdAt: number;
  updatedAt: number;
};
```

## 12.7 RetrievalProfile

```ts
type RetrievalProfile = {
  id: string;
  name: string;
  artifactId: string;
  mode: "auto" | "exact" | "lexical" | "semantic" | "hybrid";
  limit: number;
  exactCandidateLimit: number;
  lexicalCandidateLimit: number;
  semanticCandidateLimit: number;
  fusion: {
    method: "rrf" | "weighted_rrf";
    rrfK: number;
    exactWeight: number;
    lexicalWeight: number;
    semanticWeight: number;
  };
  sourceAggregation: "max" | "top_mean";
  maxResultsPerSource: number;
  rerankerProfileId?: string;
};
```

## 12.8 Fingerprint 规则

进入 artifact fingerprint：

```txt
model_signature
dimension
pooling
normalization
metric
document_template
template_renderer_version
tokenizer/truncation policy
extraction_version
chunk_strategy
chunk parameters
lexical analyzer id/version
normalization policy
custom dictionary hash
schema version
```

不进入 artifact fingerprint：

```txt
base_url
API key
headers
timeout
concurrency
query_template
limit
candidate limits
fusion weights
filters
UI settings
```

---

# 13. LanceDB 数据模型

## 13.1 Source Catalog

共享、模型无关：

```txt
source_id
vault_id
path_raw
path_norm
filename_raw
filename_norm
folder_raw
folder_norm
extension
title_raw
title_norm
aliases
aliases_norm
tags
headings
links
frontmatter_json
ctime
mtime
size
raw_content_hash
metadata_projection_hash
source_revision
primary_language
languages
scripts
created_at
updated_at
```

## 13.2 Chunk Table

每个 Index Artifact 一张 chunk table：

```txt
row_id
artifact_id
source_id
source_revision
structural_anchor
chunk_ordinal
heading_path_raw
heading_path_norm
block_type
text_raw
lexical_terms
lexical_ngrams
identifier_terms
title_terms
heading_terms
tag_terms
path_terms
language_codes
script_codes
line_start
line_end
char_start
char_end
raw_chunk_hash
extraction_hash
lexical_input_hash
embedding_input_hash
embedding
mtime
folder_norm
extension
tags
created_at
updated_at
```

## 13.3 Manifest Table

```txt
artifact_id
source_id
seen_revision
indexed_revision
status
last_error_code
last_error_message
retry_count
last_attempt_at
updated_at
```

## 13.4 稳定 ID

```txt
source_id = 首次观察 source 时生成并持久化的 UUID
row_id    = hash(artifact_id + source_id + structural_anchor + chunk_ordinal)
```

- `source_id` 不从 path 推导。
- 正常 rename 事件必须保留原 `source_id`，只更新 path 映射和 revision。
- 插件离线期间发生 rename 时，启动 reconciliation 可按内容 hash、mtime、size 和邻近路径做高置信度匹配；无法可靠判断时创建新 source，不做危险合并。
- 路径变化通过 revision 安全迁移。

## 13.5 索引配置

FTS：

- `title_terms`：whitespace。
- `heading_terms`：whitespace。
- `tag_terms`：whitespace 或 array FTS。
- `lexical_terms`：whitespace。
- `lexical_ngrams`：ngram 或预生成 ngram + whitespace。
- phrase 查询需要 positions；是否为全部字段开启由 benchmark 决定。

Scalar：

- BTREE：`source_id`、`mtime`、`source_revision`。
- BITMAP：`extension`、`block_type`、低基数 language/script。
- LABEL_LIST：`tags`、`language_codes`，仅在能力可用时启用。
- FM：`path_raw`、标识符或 URL，能力可用时启用。

所有高级索引都必须 capability-gated，并可回退到功能正确但更慢的路径。

---

# 14. 增量索引与任务调度

## 14.1 分阶段流水线

```txt
Vault Events
  -> EventCoalescer
  -> Read / Parse Pool
  -> Metadata & Language Analysis
  -> Diff Planner
  -> Embedding Batcher
  -> Single/Bounded DB Writer
  -> Maintenance Scheduler
```

不使用单一串联队列阻塞全部任务。

## 14.2 队列分类

- Control lane：delete、rename、pause、cancel，最高优先级。
- Read lane：文件读取。
- Parse lane：Markdown、语言分析、chunking。
- Embed lane：provider batch。
- Write lane：LanceDB 写入，单写者或严格限并发。
- Maintenance lane：optimize、cleanup、index rebuild，低优先级。

## 14.3 Latest-wins Generation

每个 source 保存 generation：

```txt
A generation 14
A generation 15
A generation 16
```

只有 generation 16 可提交。旧 generation 即使 embedding 已完成，也必须在写入前被拒绝。

## 14.4 分层 Hash

```ts
type IndexHashes = {
  rawContentHash: string;
  extractionHash: string;
  metadataProjectionHash: string;
  lexicalInputHash: string;
  embeddingInputHash: string;
};
```

判定：

```txt
rawContentHash changed
  -> 重新解析

extractionHash changed
  -> 重新切块

lexicalInputHash changed
  -> 更新 lexical fields / FTS

embeddingInputHash changed
  -> 调用 embedding

metadataProjectionHash changed only
  -> 只更新 metadata/scalar fields
```

`embeddingInputHash` 必须来自最终渲染文本：

```txt
hash(render(documentTemplate, actualVariables))
```

## 14.5 Rename 与原子性

禁止“先删旧 path，再写新 path”。

推荐流程：

```txt
创建新 source revision
-> 写入或更新新 revision rows
-> commit 成功
-> 标记旧 revision stale
-> 异步清理旧 revision
```

## 14.6 Embedding Batch

同时限制：

- max items。
- estimated tokens。
- payload bytes。

失败策略：

```txt
batch 请求失败且疑似超限
-> 二分 batch
-> 单项仍失败
-> dead letter + 可重试错误
```

只对临时错误重试：

- 408。
- 429。
- 5xx。
- 网络中断。

重试使用指数退避、jitter 和 `Retry-After`。

## 14.7 Maintenance

自动 optimize 条件满足任一即可：

- data modification operations 达阈值。
- unindexed rows 达阈值。
- 删除碎片达阈值。
- 距离上次 maintenance 达时间阈值。
- 用户空闲且设备资源允许。

默认不在用户主动输入时执行重维护。

显示：

```txt
Indexed rows
Unindexed rows
Deleted fragments
Last optimize
Next maintenance
```

---

# 15. 检索管线

## 15.1 总流程

```txt
QueryParser
  -> QueryPlanner
  -> Metadata Prefilter
  -> ExactRetriever
  -> LexicalRetriever
  -> VectorRetriever
  -> CandidateFusion
  -> SourceAggregator
  -> SourceDiversifier
  -> OptionalReranker
  -> ResultHydrator
  -> Renderer
```

## 15.2 ExactRetriever

候选来源：

- scalar equality/contains。
- FM index。
- phrase FTS。
- ngram FTS。
- 受控候选集 scan。

最终步骤：

```txt
candidate
-> 读取 text_raw / raw metadata
-> 按用户大小写与 Unicode 策略逐字验证
-> 计算 char offset 和 line range
```

## 15.3 LexicalRetriever

字段默认权重：

```txt
title       6.0
aliases     5.0
headings    3.5
tags        3.0
filename    2.5
path        1.5
body        1.0
identifier  4.0
```

权重由 Retrieval Profile 覆盖。

多字段查询可由多个 FTS 子查询产生 rank，再内部融合；不要求把所有字段拼成单一文本。

## 15.4 VectorRetriever

```txt
query
-> queryTemplate
-> provider.embed(purpose=query)
-> vector search
-> metadata prefilter
-> semantic candidates
```

查询与索引必须使用同一 embedding space、维度、normalization 和 metric。

## 15.5 Candidate Fusion

默认 RRF：

```txt
score(d) = Σ weight_i / (k + rank_i(d))
```

默认：

```txt
k = 60
exactWeight = 1.4
lexicalWeight = 1.0
semanticWeight = 1.0
```

Exact 已经通过原文验证时可获得额外 boost，但不得无限覆盖所有其他信号。

## 15.6 Source Aggregation

默认索引粒度为 block，Source 结果由 block 聚合：

```txt
source_score = max(block_scores)
```

可选：

```txt
source_score = mean(top 2 or 3 block_scores)
```

保留最高分 block 作为 snippet 和跳转位置。

## 15.7 Source Diversity

默认：

```txt
maxResultsPerSource = 2
```

防止长笔记占满结果列表。

## 15.8 Score 模型

```ts
type SearchScore = {
  rawValue: number;
  rawKind:
    | "exact"
    | "cosine_distance"
    | "dot_similarity"
    | "l2_distance"
    | "bm25"
    | "rrf"
    | "rerank";
  rankScore: number;
  displayValue?: number;
};
```

不把不同模式的原始分数统一显示成“相似度百分比”。

## 15.9 Result 类型

```ts
type SearchResult = {
  id: string;
  sourceId: string;
  artifactId: string;
  path: string;
  filename: string;
  title: string;
  folder: string;
  resultType: "block" | "source";
  lineStart?: number;
  lineEnd?: number;
  charStart?: number;
  charEnd?: number;
  snippet?: string;
  score: SearchScore;
  reasons: MatchReason[];
  languages: string[];
  metadata: Record<string, unknown>;
};
```

---

# 16. Connections 与知识图谱

## 16.1 知识点定义

默认知识点：

1. Markdown heading block。
2. 无 heading 时的稳定语义 chunk。
3. 整篇 note 作为聚合节点。

普通 overlap chunk 仅作为召回单元，不默认展示为图节点。

## 16.2 Connections 计算

当前 note：

- 获取其代表性 block vectors。
- 对每个代表 block 搜索邻居。
- 按 source 聚合。
- 排除自身。
- 与 wikilink、shared tag 信号融合。

当前选区：

- 动态生成 query vector。
- 搜索相关 blocks。
- 不写入 artifact。

## 16.3 Edge 类型

```ts
type KnowledgeEdge = {
  from: string;
  to: string;
  kind: "semantic" | "wikilink" | "backlink" | "shared_tag";
  score?: number;
  artifactRevision?: string;
  evidence?: string[];
};
```

语义边缓存必须绑定 artifact revision；重建模型后自动失效。

## 16.4 Graph 原则

- 只做局部 ego graph。
- 节点按需扩展。
- 默认限制节点和边数量。
- 语义边与显式链接边使用不同样式。
- 列表始终是主要可操作入口；图用于探索。

---

# 17. Provider 接口

## 17.1 EmbeddingProvider

```ts
interface EmbeddingProvider {
  probe(signal?: AbortSignal): Promise<EmbeddingCapabilities>;

  embed(
    inputs: string[],
    options: {
      purpose: "document" | "query";
      model: string;
      dimensions?: number;
      signal?: AbortSignal;
    }
  ): Promise<EmbeddingBatch>;
}
```

## 17.2 TokenCounter

```ts
interface TokenCounter {
  countTokens(inputs: string[], signal?: AbortSignal): Promise<number[]>;
}
```

没有 TokenCounter 时：

- 使用字符数与模型家族估算。
- 留安全余量。
- 服务返回超限时自动拆分。

## 17.3 RerankProvider

```ts
interface RerankProvider {
  probe(signal?: AbortSignal): Promise<RerankCapabilities>;
  rerank(
    query: string,
    documents: RerankDocument[],
    options: { topN: number; signal?: AbortSignal }
  ): Promise<RerankResult[]>;
}
```

## 17.4 Capability Probe

```ts
type EmbeddingCapabilities = {
  batchInput: boolean;
  maxBatchItems?: number;
  maxInputTokens?: number;
  requestedDimensions: boolean;
  tokenCounter: boolean;
  modelList: boolean;
  serverNormalization: "none" | "l2" | "unknown";
  rerank: boolean;
};
```

探测不得把 `/props` 或 `/tokenize` 作为通用 OpenAI-compatible 服务的必需条件。

## 17.5 Provider 安全

- API key 通过 Obsidian SecretStorage 引用。
- `data.json` 中只保存 `secretRef`。
- 日志不得输出 Authorization header。
- 非 localhost 的 HTTP endpoint 显示强警告。
- Test Embedding 显示实际 destination、model 和发送样例。

---

# 18. UI 需求

## 18.1 Lookup View

布局：

```txt
工具栏
  Mode: Auto / Exact / Lexical / Semantic / Hybrid
  Result: Blocks / Sources
  Retrieval Profile
  Index status

查询区
  Textarea
  Auto-submit
  Search
  Clear

过滤区
  Folder
  Path
  Tag
  Extension
  Date
  More

结果区
  Rank / reason
  Title
  Breadcrumb
  Language badge（可选）
  Line range
  Snippet + highlight
  Actions

展开区
  Safe preview
  Open
  Copy link
  Drag
```

交互：

- debounce。
- AbortController 取消旧请求。
- request generation 防竞态。
- 键盘上下选择、Enter 打开、Cmd/Ctrl+Enter 新 pane。
- 长列表分页或虚拟化。
- 首屏只 hydrate 必需字段。

## 18.2 Connections View

显示：

- 当前 source。
- Auto update 开关。
- Current note / Selection 模式。
- Related notes 列表。
- 匹配证据。
- Pin、hide、open、drag。

## 18.3 Semantic Graph View（P1）

- 当前节点居中。
- 边类型图例。
- depth 与 top-k 控制。
- 点击节点加载下一跳。
- 列表与图联动。

## 18.4 安全预览

默认结果卡片使用：

- escaped plain-text snippet。
- 自己控制的 `<mark>` 高亮。

展开预览：

- 默认使用受限 Markdown 子集。
- 不执行第三方插件自定义 code block processor。
- 不自动加载外部资源。
- 不自动展开 embeds/transclusion。
- 用户可从结果直接打开原笔记查看完整渲染。

## 18.5 可访问性

- 所有操作可键盘完成。
- ARIA label 使用 i18n key。
- 不只用颜色表达状态。
- RTL 文本使用 `dir="auto"`。
- 高亮需兼容明暗主题。

---

# 19. Settings View

首版使用五个主 tab：

```txt
Overview
Models
Indexing
Retrieval
Advanced
```

## 19.1 Overview

显示：

- Active Retrieval Profile。
- Search mode。
- UI language。
- Provider state。
- Artifact state。
- Files/chunks。
- Pending jobs。
- Last sync。
- Last maintenance。
- Recent errors。

操作：

- Open Lookup。
- Open Connections。
- Pause/Resume indexing。
- Retry failed。
- Rebuild active artifact。

## 19.2 Models

Provider：

- Kind。
- Base URL。
- Secret reference。
- Model ID。
- Headers。
- Timeout。
- Batch 与 concurrency。

测试：

- Test connection。
- Test embedding。
- Detect dimension。
- Test batch。
- Test token count。
- Test multilingual capability。
- Test rerank（未来）。

必须显示：

- 发送目标。
- 发送字段。
- 渲染后 document/query 示例。
- 本地或远程状态。

## 19.3 Indexing

Simple：

- Included folders。
- Excluded folders。
- File types。
- Chunk size。
- Rebuild。

Advanced：

- Corpus Profile。
- Lexical Profile。
- Embedding Recipe。
- Fingerprints。
- Artifact tables。
- Hash impact preview。
- Maintenance thresholds。

## 19.4 Retrieval

- Default mode。
- Result type。
- Limit。
- Candidate limits。
- Field boosts。
- RRF k 与 weights。
- max results per source。
- Connections top-k。
- Filters。

## 19.5 Advanced

- Diagnostics。
- Search timing。
- Index stats。
- Native capability report。
- Raw settings import/export。
- Safe redacted diagnostic export。
- Debug logs。
- Raw predicate（P1，默认关闭）。

配置变更必须显示影响：

```txt
No rebuild
Rebuild lexical indexes
Re-embed affected chunks
Build new artifact
```

---

# 20. 非功能需求

## 20.1 性能

- 后台处理必须分批让出事件循环。
- UI 搜索优先级高于后台维护。
- 文件读取、解析、embedding 和写入各自限流。
- 查询只 select 需要字段。
- 预览展开时再读取完整内容。
- 小索引默认 flat vector search。
- 只有规模或 p95 超标时建立 ANN。

## 20.2 稳定性

- 所有长任务支持取消。
- 插件 unload 时关闭 provider 请求、队列和数据库 handle。
- 未处理异常不能导致 Obsidian 崩溃。
- 单文件失败不阻塞整个 artifact。
- Dead-letter job 可从 UI 重试。
- 数据库损坏可安全删除并重建。

## 20.3 数据一致性

- revision 与 generation 双重保护。
- 不允许旧任务覆盖新版本。
- Rename 使用 commit 后清理。
- 每次写入记录 LanceDB version 或写入结果。
- Manifest 与 chunk rows 可进行一致性扫描。

## 20.4 兼容性

- `manifest.json` 标记 `isDesktopOnly: true`。
- `manifest.json` 的 `minAppVersion` 固定为 Obsidian `1.11.4`，这是 `SecretStorage` 的最低官方版本。
- MVP 首版支持 Windows x64、macOS arm64 与 Linux x64 glibc。
- MVP 首版不支持 macOS Intel/x64 与 Windows ARM64；只有在当前稳定依赖和真实设备通过完整 packaged-plugin 门禁后，才可通过后续评审扩大平台范围。
- Obsidian 最低版本需满足 SecretStorage 与目标 API。
- 原生二进制随发布包验证。
- 官方 Community 一键安装和标准更新是 MVP 硬门禁；手动复制 `.node` sidecar 或平台专用测试包不能满足发布兼容性。

## 20.5 可观测性

本地 diagnostics：

```txt
query_parse_ms
language_analysis_ms
query_embed_ms
exact_search_ms
lexical_search_ms
vector_search_ms
fusion_ms
rerank_ms
hydrate_ms
render_ms
```

默认不上传遥测。

---

# 21. 隐私与安全

## 21.1 本地与远程边界

本地默认：

- LanceDB 在插件目录。
- llama.cpp 默认 `127.0.0.1`。
- 不发送远程请求。

远程模式可能发送：

- 文档模板渲染结果。
- 查询模板渲染结果。
- title、path、tags、frontmatter 或正文，取决于模板。
- 用户查询。

远程配置必须提供“发送内容预览”。

## 21.2 本地数据库说明

必须明确告知：

```txt
本地优先不等于数据库加密。
索引可能包含正文、metadata 和向量。
```

## 21.3 数据库同步

- 默认提示不要通过第三方同步工具跨设备同步 LanceDB 目录。
- 保存 device ID。
- 使用实例锁或 lock file。
- 检测异常目录替换和并发写入。
- 索引目录冲突时停止写入并提示重建。

## 21.4 Filter 安全

- 普通过滤器生成结构化 Filter AST。
- 所有字符串经过 escaping/binding。
- 不直接拼接用户输入为 SQL predicate。
- raw predicate 仅 Advanced 提供，默认关闭。

## 21.5 日志脱敏

不得记录：

- API key。
- Authorization header。
- 完整文档正文。
- 完整查询历史，除非用户显式启用本地 debug。

---

# 22. 测试与评测

## 22.1 单元测试

- settings migration。
- fingerprint 稳定性。
- template renderer 与变量依赖。
- Unicode normalization。
- Script classifier。
- multilingual analyzer。
- identifier analyzer。
- QueryParser/AST。
- FilterCompiler。
- chunk line/char range。
- source aggregation。
- RRF。
- score direction。
- request cancellation。

## 22.2 集成测试

- mock vault 全量扫描。
- create/modify/rename/delete。
- metadataCache fallback。
- llama.cpp batch embedding。
- OpenAI-compatible mock server。
- LanceDB create/upsert/merge/delete/search。
- FTS phrase/fuzzy/ngram。
- optimize 与 unindexed rows。
- artifact rebuild。
- provider failure degradation。

## 22.3 多语言 Golden Vault

至少包含：

- zh-Hans。
- zh-Hant。
- en。
- ja。
- ko。
- es。
- fr。
- de。
- ru。
- ar。
- hi。
- th。
- 中英混排。
- 自然语言 + 代码标识符。

查询类型：

- 精确标题。
- 路径。
- 引号短语。
- 标签。
- 缩写。
- 拼写错误。
- CJK 无空格关键词。
- 同语种语义改写。
- 跨语言语义查询。
- 否定词。
- metadata filter。
- 多篇长笔记竞争。

## 22.4 ANN 评测

- 使用 `flat` 结果作为 ground truth。
- 记录 Recall@10、Recall@20、p50、p95、index size、build time。
- Recall 不达标时不得默认启用 ANN。

## 22.5 UI 测试

- Lookup View。
- Connections View。
- Settings View。
- 长列表。
- RTL snippet。
- 中英文 UI。
- 错误与降级状态。
- 键盘导航。
- 预览安全。

## 22.6 Packaging 测试

- Windows x64。
- macOS arm64。
- Linux x64 glibc。
- Obsidian `1.11.4` 最低版本兼容性；不得以当前 TypeScript 类型检查代替真实运行验证。
- Windows x64、macOS arm64、Linux x64 glibc 均执行双版本实机门禁：`1.11.4` 验证最低兼容性，测试时当前稳定版验证完整 packaged-plugin 生命周期。
- 断言 macOS x64 与 Windows ARM64 被明确报告为 unsupported，而不是 supported、pass 或静默尝试跨架构加载。
- Obsidian reload。
- 插件升级。
- DB schema migration。
- 非 ASCII 路径。

---

# 23. 依赖策略

## 23.1 MVP 依赖

- `obsidian`。
- `@lancedb/lancedb`。
- `zod`。
- `p-queue`。
- `gray-matter`。
- `xxhash-wasm`。
- `vitest`。

可根据 Arrow schema 构建需要显式依赖 `apache-arrow`。

## 23.2 P1 依赖候选

- `fast-check`。
- `playwright`。
- 简繁转换库或精简词典，仅在 bundle、许可证和质量评估通过后引入。
- 可选语言检测库，仅作为增强，不得成为基本检索必需依赖。

## 23.3 不引入

MVP 与 P1 不引入：

- LangChain。
- LlamaIndex。
- React、Vue、Svelte。
- SQLite。
- 强制在线翻译服务。

## 23.4 许可证边界

- 本仓库原创源代码、插件代码和原创合成 fixtures 采用 Apache License 2.0。
- 发布仓库必须包含 Apache-2.0 `LICENSE`；根据依赖审计结果生成必要的 `NOTICE` 和 third-party notices。
- 仓库许可证不覆盖第三方依赖、模型、外部测试资产或参考项目；它们继续遵守各自许可证与归属要求。
- Omnisearch 与 Smart Connections 只作为产品行为和公开文档参考。
- 核心代码、类结构、算法实现与样式重新实现。
- 建立 clean-room 记录。
- 引入任何源码前单独审核当前许可证与分发义务。
- Spike 0 使用的 `jina-embeddings-v5-text-nano-retrieval-Q8_0.gguf` 仅为用户本地提供的认证夹具，许可为 CC-BY-NC-4.0；不随插件分发、不自动下载、不作为首版默认生产模型推荐。
- “已测试模型”信息必须同时显示模型许可、固定构件哈希、测试 runtime/revision 和认证范围。商业使用适用性由用户自行确认或另行取得模型授权。

## 23.5 Community 发布托管与敏感配置

- 官方 Obsidian Community 提交流程要求公开 GitHub 仓库、GitHub 身份关联和 GitHub Releases；仅有 Gitea remote 不能满足发布门禁。
- 当前开发阶段仅使用现有私有 Gitea；不得创建公开 GitHub、公开 push 或提交 Community，除非用户届时再次明确授权。
- 首次公开发布准备开始后，公开 GitHub 才成为 Community 审核、默认分支、正式 tag、GitHub Release、README、支持入口和 issue 跟踪的权威源；现有 Gitea 随后保留为私有开发镜像/备份。
- 同一版本在 GitHub 与 Gitea 的 tag 必须指向相同 commit；正式 release 记录 source commit 和构件 SHA-256，禁止镜像间同版本内容漂移。
- 公开 GitHub 前必须完成敏感文件与完整 Git 历史审计。
- `.envrc`、真实密钥、token、credential 和私有 endpoint 配置不得进入公开仓库或发布构件；仓库只提供无值示例文件。
- 任何曾进入 Git 历史的真实凭据必须轮换；仅从最新提交删除文件不足以撤销泄露。

---

# 24. 默认配置

## 24.1 默认 Provider

```json
{
  "kind": "llama_cpp",
  "baseUrl": "http://127.0.0.1:8080/v1",
  "timeoutMs": 30000,
  "maxRetries": 3,
  "concurrency": 1,
  "maxBatchItems": 16
}
```

模型 ID 和维度由用户测试连接后确认，不硬编码模型名称。
首版不预选 Jina nano 或任何其他具体本地模型，也不声称内置免费商用模型。

## 24.2 默认 Embedding Recipe

```json
{
  "documentTemplate": "{title}\n{heading_path}\n{content}",
  "queryTemplate": "{query}",
  "normalize": true,
  "metric": "cosine"
}
```

不默认添加英文 instruction；需要 instruction 的模型通过 model preset 提供专属 Recipe。

## 24.3 默认 Lexical Profile

```json
{
  "analyzerId": "unicode-multilingual",
  "analyzerVersion": 1,
  "useIntlSegmenter": true,
  "cjkNgramMin": 2,
  "cjkNgramMax": 3,
  "normalizeNfkc": true,
  "accentFoldSecondary": true,
  "preserveStopWords": true,
  "identifierSplitting": true
}
```

## 24.4 默认 Retrieval Profile

```json
{
  "mode": "auto",
  "limit": 20,
  "exactCandidateLimit": 50,
  "lexicalCandidateLimit": 80,
  "semanticCandidateLimit": 80,
  "fusion": {
    "method": "rrf",
    "rrfK": 60,
    "exactWeight": 1.4,
    "lexicalWeight": 1.0,
    "semanticWeight": 1.0
  },
  "sourceAggregation": "max",
  "maxResultsPerSource": 2
}
```

Auto 在 embedding 与 lexical 能力均就绪时执行 Hybrid；Provider 不可用时自动降级为 Exact + Lexical。

## 24.5 默认 UI

```txt
UI locale: Auto，首次缺省回退英文
Lookup result type: Blocks
Search mode: Auto
Auto-submit: On
Connections auto-update: On
Connections limit: 12
Advanced settings: Collapsed
Safe plain-text preview: On
```

---

# 25. 迁移映射

| 原结构 | 新结构 |
|---|---|
| IndexProfile.provider/base_url | ProviderProfile |
| IndexProfile.model/template/dimension | EmbeddingRecipe |
| IndexProfile.includes/chunk settings | CorpusProfile |
| FTS tokenizer 与字段 | LexicalProfile |
| Index Profile 对应物理表 | IndexArtifact |
| QueryProfile | RetrievalProfile + EmbeddingRecipe.queryTemplate |
| Sources/Blocks 两套向量 | Block artifact + Source aggregation |
| LlamaCppEmbeddingAdapter | OpenAICompatibleProvider + LlamaCppProvider |
| SearchService | Parser/Planner/Retrievers/Fusion/Hydrator |
| 单队列 | 分阶段 lanes |
| content_hash | 分层 hashes + embedding_input_hash |
| Vector-only MVP | Exact + Lexical + Semantic + Hybrid + Connections |

旧数据库不做原地复杂迁移；开发期建议重建新 artifact。正式发布后需要 schema migration policy。

---

# 26. 风险与缓解

## 26.1 LanceDB Native Packaging

风险：平台二进制、Electron、asar、架构支持。

缓解：Spike 0；VectorStore 抽象；平台矩阵；启动自检；明确 Desktop-only。

## 26.2 TypeScript 多语言 FTS 能力差异

风险：通用文档与 JS SDK 暴露能力可能不同步。

缓解：插件侧预分词；whitespace/ngram 基线；capability probe；LexicalStore 可替换。

## 26.3 多语言模型质量不一致

风险：模型声称 multilingual，但特定语言或跨语言对质量较差。

缓解：能力验证、语言分组 benchmark、UI badge、不做未经验证的承诺。

## 26.4 大 Vault 更新放大

风险：频繁更新造成大量 unindexed rows 和延迟上升。

缓解：latest-wins、分层 hash、batch upsert、maintenance scheduler、health dashboard。

## 26.5 同步冲突

风险：多设备同步数据库造成损坏或覆盖。

缓解：不建议同步、device ID、lock、异常检测、可重建。

## 26.6 配置复杂度

风险：Provider、Recipe、Corpus、Artifact、Retrieval 概念过多。

缓解：Simple/Advanced；普通用户只看到 Model、Folders、Search Mode、Rebuild；高级概念隐藏。

## 26.7 许可证

风险：参考项目许可证与竞争性产品限制。

缓解：clean-room、独立实现、依赖审计、发布前法律复核。

---

# 27. Definition of Done

## 27.1 Spike 0 DoD

- 支持平台 packaged plugin 可加载。
- 已确认所选后端可由官方 Obsidian Community 安装与标准更新机制交付；若无法确认，记录 LanceDB packaging no-go 并触发 VectorStore 替换。
- 多语言 lexical prototype 达到基础召回要求。
- 两类 embedding provider 可 batch。
- 质量和性能基准可重复执行。
- 后端替换风险已作 go/no-go 决策。

## 27.2 MVP DoD

- Exact、Lexical、Semantic、Hybrid、Auto 全部可用。
- Provider 离线时 Exact/Lexical 可用。
- 中英文 UI 完整，无关键 hardcoded 文本。
- 12 类语言/混合文本 golden vault 通过发布门槛。
- Connections View 可用于当前 note 与 selection。
- 增量 create/modify/rename/delete 无已知数据丢失。
- 旧任务不能覆盖新 revision。
- 远程发送预览、SecretStorage、HTTP 警告完成。
- Windows/macOS/Linux 发布包通过验证。
- 可安全删除数据库并从 vault 重建。

## 27.3 P1 DoD

- Ego Graph 可懒加载扩展。
- ANN 自动策略通过 Recall gate。
- Maintenance dashboard 可解释 unindexed 状态。
- 用户词典与至少一类语言增强可用。
- 完整 Query AST 与字段权重可配置。
- 语言分组质量 dashboard 可生成。

## 27.4 P2 DoD

- Rerank 接入不破坏无 rerank 流程。
- PDF/OCR/multivector 各自有独立 artifact 与 benchmark。
- Saved search 与 context packaging 不泄露远程数据边界。

---

# 28. 最终产品定义

本插件是一个面向 Obsidian Desktop 的、多语言、本地优先知识检索与发现系统。

其最小完整形态不是“向量数据库加一个搜索框”，而是：

```txt
确定性精准检索
+ 多语言词法检索
+ 同语种/跨语言语义检索
+ RRF 混合排序
+ 当前上下文知识关联
+ 可复用索引产物
+ 可解释结果
+ 可恢复增量索引
```

插件默认尊重原文、尊重用户隐私，并在模型、语言、索引和排序能力不足时显式降级，而不是静默返回不完整或误导性的结果。

---

# 29. 技术依据与参考

- LanceDB Full-Text Search：<https://docs.lancedb.com/search/full-text-search>
- LanceDB FTS Index：<https://docs.lancedb.com/indexing/fts-index>
- LanceDB Hybrid Search：<https://docs.lancedb.com/search/hybrid-search>
- LanceDB Scalar Indexes：<https://docs.lancedb.com/indexing/scalar-index>
- LanceDB Reindexing：<https://docs.lancedb.com/indexing/reindexing>
- LanceDB Updating Data：<https://docs.lancedb.com/tables/update>
- LanceDB JavaScript FtsOptions：<https://lancedb.github.io/lancedb/js/interfaces/FtsOptions/>
- llama.cpp Server API：<https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md>
- Obsidian Secret Storage：<https://docs.obsidian.md/plugins/guides/secret-storage>
- Obsidian API：<https://github.com/obsidianmd/obsidian-api>
- Omnisearch：<https://github.com/scambier/obsidian-omnisearch>
- Smart Connections：<https://github.com/brianpetro/obsidian-smart-connections>
