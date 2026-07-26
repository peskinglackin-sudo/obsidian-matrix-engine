import { ItemView, Notice, type WorkspaceLeaf } from "obsidian";

import type { MatrixEngineController } from "../app/controller";
import { markdownFileFor } from "../app/obsidian-ports";
import type { SearchResponse, SearchResult, MatchReason } from "../retrieval/types";
import type { SearchMode } from "../settings/types";
import { translate, type TranslationKey } from "../i18n/translate";

/**
 * Lookup View (PRD 18.1, FR-010/012/013).
 *
 * Debounced auto-submit with AbortController and request generations,
 * mode/result toggles, explainable result cards with safe plain-text
 * snippets and <mark> highlights, keyboard navigation, and visible
 * degradation + executed-mode reporting.
 */

export const LOOKUP_VIEW_TYPE = "matrix-engine-lookup";

const MODES: readonly SearchMode[] = ["auto", "exact", "lexical", "semantic", "hybrid"];
const DEBOUNCE_MS = 250;

export class LookupView extends ItemView {
  readonly #controller: MatrixEngineController;
  #mode: SearchMode = "auto";
  #resultType: "blocks" | "sources" = "blocks";
  #query = "";
  #results: readonly SearchResult[] = [];
  #selectedIndex = -1;
  #generation = 0;
  #abort: AbortController | undefined;
  #debounceTimer: ReturnType<typeof setTimeout> | undefined;
  #statusUnsubscribe: (() => void) | undefined;

  #inputEl: HTMLTextAreaElement | undefined;
  #resultsEl: HTMLElement | undefined;
  #statusEl: HTMLElement | undefined;
  #noticeEl: HTMLElement | undefined;

  constructor(leaf: WorkspaceLeaf, controller: MatrixEngineController) {
    super(leaf);
    this.#controller = controller;
    this.#mode = controller.settings.current.retrievalProfiles.find(({ id }) => id === controller.settings.current.activeRetrievalProfileId)?.mode ?? "auto";
    this.#resultType = controller.settings.current.ui.lookupResultType;
  }

  override getViewType(): string {
    return LOOKUP_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return translate("lookup.title");
  }

  override getIcon(): string {
    return "search";
  }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("matrix-engine-lookup");

    const toolbar = root.createDiv({ cls: "matrix-engine-toolbar" });
    const modeGroup = toolbar.createDiv({ cls: "matrix-engine-mode-group" });
    for (const mode of MODES) {
      const button = modeGroup.createEl("button", { text: translate(`lookup.mode.${mode}` as TranslationKey), cls: "matrix-engine-mode" });
      button.setAttr("data-mode", mode);
      if (mode === this.#mode) button.addClass("is-active");
      button.addEventListener("click", () => {
        this.#mode = mode;
        for (const sibling of Array.from(modeGroup.children)) sibling.removeClass("is-active");
        button.addClass("is-active");
        this.#scheduleSearch(true);
      });
    }
    const typeGroup = toolbar.createDiv({ cls: "matrix-engine-type-group" });
    for (const type of ["blocks", "sources"] as const) {
      const button = typeGroup.createEl("button", { text: translate(`lookup.resultType.${type}` as TranslationKey), cls: "matrix-engine-type" });
      if (type === this.#resultType) button.addClass("is-active");
      button.addEventListener("click", () => {
        this.#resultType = type;
        for (const sibling of Array.from(typeGroup.children)) sibling.removeClass("is-active");
        button.addClass("is-active");
        this.#scheduleSearch(true);
      });
    }

    const queryRow = root.createDiv({ cls: "matrix-engine-query" });
    this.#inputEl = queryRow.createEl("textarea", { cls: "matrix-engine-input" });
    this.#inputEl.setAttr("rows", "2");
    this.#inputEl.setAttr("placeholder", translate("lookup.placeholder"));
    this.#inputEl.setAttr("aria-label", translate("lookup.search"));
    this.#inputEl.addEventListener("input", () => {
      this.#query = this.#inputEl?.value ?? "";
      if (this.#controller.settings.current.ui.autoSubmit) this.#scheduleSearch(false);
    });
    this.#inputEl.addEventListener("keydown", (event) => this.#onKeyDown(event));

    const buttonRow = queryRow.createDiv({ cls: "matrix-engine-buttons" });
    const searchButton = buttonRow.createEl("button", { text: translate("lookup.search"), cls: "mod-cta" });
    searchButton.addEventListener("click", () => this.#scheduleSearch(true));
    const clearButton = buttonRow.createEl("button", { text: translate("lookup.clear") });
    clearButton.addEventListener("click", () => {
      if (this.#inputEl !== undefined) this.#inputEl.value = "";
      this.#query = "";
      this.#results = [];
      this.#renderResults(undefined);
    });

    this.#noticeEl = root.createDiv({ cls: "matrix-engine-notices" });
    this.#resultsEl = root.createDiv({ cls: "matrix-engine-results" });
    this.#resultsEl.setAttr("role", "listbox");
    this.#statusEl = root.createDiv({ cls: "matrix-engine-status" });

    this.#statusUnsubscribe = this.#controller.onStatus(() => this.#renderStatus());
    this.#renderStatus();
    return Promise.resolve();
  }

  override async onClose(): Promise<void> {
    this.#abort?.abort();
    if (this.#debounceTimer !== undefined) clearTimeout(this.#debounceTimer);
    this.#statusUnsubscribe?.();
    return Promise.resolve();
  }

  focusInput(): void {
    this.#inputEl?.focus();
  }

  #scheduleSearch(immediate: boolean): void {
    if (this.#debounceTimer !== undefined) clearTimeout(this.#debounceTimer);
    if (immediate) {
      void this.#runSearch();
      return;
    }
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = undefined;
      void this.#runSearch();
    }, DEBOUNCE_MS);
  }

  async #runSearch(): Promise<void> {
    this.#abort?.abort();
    const controller = new AbortController();
    this.#abort = controller;
    this.#generation += 1;
    const generation = this.#generation;
    const query = this.#query;
    if (query.trim().length === 0) {
      this.#results = [];
      this.#renderResults(undefined);
      return;
    }
    try {
      const response = await this.#controller.runSearch(query, {
        mode: this.#mode,
        resultType: this.#resultType,
        signal: controller.signal
      });
      if (generation !== this.#generation) return;
      this.#results = response.results;
      this.#selectedIndex = response.results.length > 0 ? 0 : -1;
      this.#renderResults(response);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (generation !== this.#generation) return;
      this.#results = [];
      this.#renderResults(undefined);
      new Notice(translate("error.search.failed"));
    }
  }

  #onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        void this.#openSelected(true);
      } else if (this.#selectedIndex >= 0 && this.#results.length > 0) {
        void this.#openSelected(false);
      } else {
        this.#scheduleSearch(true);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.#moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.#moveSelection(-1);
    }
  }

  #moveSelection(delta: number): void {
    if (this.#results.length === 0) return;
    this.#selectedIndex = Math.min(this.#results.length - 1, Math.max(0, this.#selectedIndex + delta));
    this.#applySelectionHighlight();
  }

  #applySelectionHighlight(): void {
    const container = this.#resultsEl;
    if (container === undefined) return;
    const cards = container.querySelectorAll(".matrix-engine-result");
    cards.forEach((card, index) => {
      if (index === this.#selectedIndex) {
        card.addClass("is-selected");
        card.scrollIntoView({ block: "nearest" });
      } else {
        card.removeClass("is-selected");
      }
    });
  }

  async #openSelected(newPane: boolean): Promise<void> {
    const result = this.#results[this.#selectedIndex];
    if (result !== undefined) await this.#openResult(result, newPane);
  }

  async #openResult(result: SearchResult, newPane: boolean): Promise<void> {
    const file = markdownFileFor(this.app, result.path);
    if (file === null) return;
    const leaf = this.app.workspace.getLeaf(newPane ? "split" : false);
    await leaf.openFile(file, result.lineStart === undefined ? undefined : { eState: { line: result.lineStart } });
  }

  #renderResults(response: SearchResponse | undefined): void {
    const container = this.#resultsEl;
    const notices = this.#noticeEl;
    if (container === undefined || notices === undefined) return;
    container.empty();
    notices.empty();

    if (response !== undefined) {
      notices.createDiv({ cls: "matrix-engine-executed", text: translate("lookup.executed", { label: response.plan.executedLabel }) });
      for (const reason of response.degraded) {
        notices.createDiv({ cls: "matrix-engine-degraded", text: translate(`lookup.degraded.${reason}` as TranslationKey) });
      }
      const timingParts = translate("lookup.timings", {
        parse: response.timings.queryParseMs.toFixed(1),
        search: (
          (response.timings.exactMs ?? 0) + (response.timings.lexicalMs ?? 0) + (response.timings.vectorMs ?? 0)
        ).toFixed(1),
        fuse: (response.timings.fusionMs + response.timings.hydrateMs).toFixed(1),
        embed: response.timings.queryEmbedMs === undefined ? "" : translate("lookup.timings.embed", { ms: response.timings.queryEmbedMs.toFixed(1) })
      });
      notices.createDiv({ cls: "matrix-engine-timings", text: timingParts });
    }

    if (response?.results.length === 0) {
      const stats = this.#controller.status().stats;
      container.createDiv({ cls: "matrix-engine-empty", text: stats.chunks === 0 ? translate("lookup.emptyIndex") : translate("lookup.noResults") });
      return;
    }

    this.#results.forEach((result, index) => {
      const card = container.createDiv({ cls: "matrix-engine-result" });
      card.setAttr("role", "option");
      if (index === this.#selectedIndex) card.addClass("is-selected");
      card.setAttr("draggable", "true");
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", wikilinkFor(result));
      });
      card.addEventListener("click", () => {
        this.#selectedIndex = index;
        this.#applySelectionHighlight();
      });
      card.addEventListener("dblclick", () => void this.#openResult(result, false));

      const header = card.createDiv({ cls: "matrix-engine-result-header" });
      header.createSpan({ cls: "matrix-engine-result-rank", text: String(index + 1) });
      header.createSpan({ cls: "matrix-engine-result-title", text: result.title.length > 0 ? result.title : result.filename });
      if (result.languages.length > 0) {
        header.createSpan({ cls: "matrix-engine-result-lang", text: result.languages.join(",") });
      }

      const breadcrumb = card.createDiv({ cls: "matrix-engine-result-path" });
      breadcrumb.setAttr("dir", "auto");
      const crumbText = result.headingPath !== undefined && result.headingPath.length > 0 ? `${result.path} › ${result.headingPath.join(" › ")}` : result.path;
      breadcrumb.setText(crumbText);
      if (result.lineStart !== undefined && result.lineEnd !== undefined) {
        breadcrumb.createSpan({ cls: "matrix-engine-result-lines", text: ` · ${translate("lookup.lines", { start: String(result.lineStart + 1), end: String(result.lineEnd + 1) })}` });
      }

      const reasons = card.createDiv({ cls: "matrix-engine-result-reasons" });
      for (const reason of result.reasons.slice(0, 3)) {
        reasons.createSpan({ cls: "matrix-engine-reason", text: reasonText(reason) });
      }

      if (result.snippet !== undefined) {
        const snippet = card.createDiv({ cls: "matrix-engine-result-snippet" });
        snippet.setAttr("dir", "auto");
        renderSnippet(snippet, result.snippet, result.snippetHighlights);
      }

      const actions = card.createDiv({ cls: "matrix-engine-result-actions" });
      const openButton = actions.createEl("button", { text: translate("lookup.action.open") });
      openButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.#openResult(result, false);
      });
      const paneButton = actions.createEl("button", { text: translate("lookup.action.openNewPane") });
      paneButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.#openResult(result, true);
      });
      const wikiButton = actions.createEl("button", { text: translate("lookup.action.copyWikilink") });
      wikiButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void navigator.clipboard.writeText(wikilinkFor(result)).then(() => new Notice(translate("lookup.copied")));
      });
      const mdButton = actions.createEl("button", { text: translate("lookup.action.copyMarkdownLink") });
      mdButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void navigator.clipboard.writeText(markdownLinkFor(result)).then(() => new Notice(translate("lookup.copied")));
      });
    });
    this.#applySelectionHighlight();
  }

  #renderStatus(): void {
    const statusEl = this.#statusEl;
    if (statusEl === undefined) return;
    statusEl.empty();
    const status = this.#controller.status();
    const parts = [
      translate(`status.state.${status.progress.state}` as TranslationKey),
      translate("status.summary", {
        files: String(status.stats.sources),
        chunks: String(status.stats.chunks),
        embedded: String(status.stats.chunksWithEmbedding)
      })
    ];
    if (status.progress.queued > 0) parts.push(translate("status.queued", { count: String(status.progress.queued) }));
    if (status.progress.deadLetters > 0) parts.push(translate("status.deadLetters", { count: String(status.progress.deadLetters) }));
    statusEl.setText(parts.join(" · "));
  }
}

function wikilinkFor(result: SearchResult): string {
  const base = result.path.replace(/\.md$/iu, "");
  return `[[${base}]]`;
}

function markdownLinkFor(result: SearchResult): string {
  const label = result.title.length > 0 ? result.title : result.filename;
  return `[${label}](${encodeURI(result.path)})`;
}

function reasonText(reason: MatchReason): string {
  switch (reason.kind) {
    case "exact_phrase":
      return reason.line === undefined ? translate("lookup.reason.exactPhraseNoLine") : translate("lookup.reason.exactPhrase", { line: String(reason.line + 1) });
    case "matched_title":
      return translate("lookup.reason.matchedTitle");
    case "matched_alias":
      return translate("lookup.reason.matchedAlias");
    case "matched_filename":
      return translate("lookup.reason.matchedFilename");
    case "matched_path":
      return translate("lookup.reason.matchedPath");
    case "matched_tag":
      return translate("lookup.reason.matchedTag", { tag: reason.tag.replace(/^#/u, "") });
    case "lexical":
      return translate("lookup.reason.lexical", { rank: String(reason.rank) });
    case "semantic":
      return translate("lookup.reason.semantic", { rank: String(reason.rank) });
    case "hybrid": {
      const parts: string[] = [];
      if (reason.exactRank !== undefined) parts.push(translate("lookup.reason.hybrid.exact", { rank: String(reason.exactRank) }));
      if (reason.lexicalRank !== undefined) parts.push(translate("lookup.reason.hybrid.lexical", { rank: String(reason.lexicalRank) }));
      if (reason.semanticRank !== undefined) parts.push(translate("lookup.reason.hybrid.semantic", { rank: String(reason.semanticRank) }));
      return translate("lookup.reason.hybrid", { parts: parts.join(" / ") });
    }
    case "metadata_filter":
      return translate("lookup.reason.metadata");
    case "shared_wikilink":
      return translate("connections.edge.wikilink");
    case "shared_tag":
      return translate("connections.edge.sharedTag", { tag: reason.tag });
  }
}

/** Safe snippet rendering (PRD 18.4): escaped text nodes plus owned <mark> elements. */
function renderSnippet(container: HTMLElement, snippet: string, highlights: readonly (readonly [number, number])[] | undefined): void {
  if (highlights === undefined || highlights.length === 0) {
    container.setText(snippet);
    return;
  }
  let cursor = 0;
  for (const [start, end] of highlights) {
    if (start > cursor) container.appendText(snippet.slice(cursor, start));
    container.createEl("mark", { text: snippet.slice(start, end) });
    cursor = end;
  }
  if (cursor < snippet.length) container.appendText(snippet.slice(cursor));
}
