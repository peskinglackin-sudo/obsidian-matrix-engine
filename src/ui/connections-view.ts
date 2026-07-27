import { ItemView, MarkdownView, Notice, type WorkspaceLeaf } from "obsidian";

import type { MatrixEngineController } from "../app/controller";
import { markdownFileFor } from "../app/obsidian-ports";
import type { ConnectionItem, ConnectionsResult } from "../connections/service";
import { translate, type TranslationKey } from "../i18n/translate";

/**
 * Connections View (PRD 18.2, FR-020/021/022).
 *
 * Auto-updates on active note changes (toggleable), supports selection
 * queries, shows explainable edges with evidence, and offers pin/hide,
 * open, and drag actions.
 */

export const CONNECTIONS_VIEW_TYPE = "matrix-engine-connections";

export class ConnectionsView extends ItemView {
  readonly #controller: MatrixEngineController;
  #autoUpdate: boolean;
  #currentPath: string | undefined;
  #abort: AbortController | undefined;
  #listEl: HTMLElement | undefined;
  #headerEl: HTMLElement | undefined;

  constructor(leaf: WorkspaceLeaf, controller: MatrixEngineController) {
    super(leaf);
    this.#controller = controller;
    this.#autoUpdate = controller.settings.current.ui.connectionsAutoUpdate;
  }

  override getViewType(): string {
    return CONNECTIONS_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return translate("connections.title");
  }

  override getIcon(): string {
    return "git-branch";
  }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("matrix-engine-connections");

    const toolbar = root.createDiv({ cls: "matrix-engine-toolbar" });
    const autoLabel = toolbar.createEl("label", { cls: "matrix-engine-auto" });
    const checkbox = autoLabel.createEl("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.#autoUpdate;
    checkbox.addEventListener("change", () => {
      this.#autoUpdate = checkbox.checked;
      if (this.#autoUpdate) void this.refreshForActiveNote();
    });
    autoLabel.appendText(` ${translate("connections.autoUpdate")}`);

    const selectionButton = toolbar.createEl("button", { text: translate("connections.searchSelection") });
    selectionButton.addEventListener("click", () => void this.searchSelection());

    this.#headerEl = root.createDiv({ cls: "matrix-engine-connections-header" });
    this.#listEl = root.createDiv({ cls: "matrix-engine-connections-list" });

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      if (this.#autoUpdate) void this.refreshForActiveNote();
    }));
    this.registerEvent(this.app.workspace.on("file-open", () => {
      if (this.#autoUpdate) void this.refreshForActiveNote();
    }));

    await this.refreshForActiveNote();
  }

  override async onClose(): Promise<void> {
    this.#abort?.abort();
    return Promise.resolve();
  }

  async refreshForActiveNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    const header = this.#headerEl;
    const list = this.#listEl;
    if (header === undefined || list === undefined) return;
    if (file === null) {
      header.setText(translate("connections.noActiveNote"));
      list.empty();
      return;
    }
    this.#currentPath = file.path;
    const sourceId = this.#controller.sourceIdForPath(file.path);
    if (sourceId === undefined) {
      header.setText(`${file.basename} — ${translate("connections.notIndexed")}`);
      list.empty();
      return;
    }
    this.#abort?.abort();
    const abort = new AbortController();
    this.#abort = abort;
    try {
      const limit = this.#controller.settings.current.ui.connectionsLimit;
      const result = await this.#controller.connections.forSource(sourceId, limit, abort.signal);
      if (abort.signal.aborted || this.#currentPath !== file.path) return;
      this.#render(file.basename, result);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      new Notice(translate("error.search.failed"));
    }
  }

  async searchSelection(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const selection = view?.editor.getSelection() ?? "";
    if (selection.trim().length === 0) {
      await this.refreshForActiveNote();
      return;
    }
    const activePath = this.app.workspace.getActiveFile()?.path;
    const sourceId = activePath === undefined ? undefined : this.#controller.sourceIdForPath(activePath);
    this.#abort?.abort();
    const abort = new AbortController();
    this.#abort = abort;
    try {
      const limit = this.#controller.settings.current.ui.connectionsLimit;
      const result = await this.#controller.connections.forSelection(selection, sourceId, limit, abort.signal);
      if (abort.signal.aborted) return;
      this.#render(translate("connections.modeSelection"), result);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      new Notice(translate("error.search.failed"));
    }
  }

  #render(contextLabel: string, result: ConnectionsResult): void {
    const header = this.#headerEl;
    const list = this.#listEl;
    if (header === undefined || list === undefined) return;
    header.empty();
    header.createSpan({ text: contextLabel, cls: "matrix-engine-connections-context" });
    header.createSpan({ text: ` · ${translate(`connections.mode.${result.mode}` as TranslationKey)}`, cls: "matrix-engine-connections-mode" });
    if (result.truncatedSelection) {
      header.createDiv({ cls: "matrix-engine-degraded", text: translate("connections.truncated") });
    }

    list.empty();
    if (result.items.length === 0) {
      list.createDiv({ cls: "matrix-engine-empty", text: translate("connections.none") });
      return;
    }
    for (const item of result.items) {
      this.#renderItem(list, item);
    }
  }

  #renderItem(list: HTMLElement, item: ConnectionItem): void {
    const card = list.createDiv({ cls: "matrix-engine-result" });
    if (item.pinned) card.addClass("is-pinned");
    card.setAttr("draggable", "true");
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", `[[${item.path.replace(/\.md$/iu, "")}]]`);
    });

    const header = card.createDiv({ cls: "matrix-engine-result-header" });
    header.createSpan({ cls: "matrix-engine-result-title", text: item.title.length > 0 ? item.title : item.filename });
    header.createSpan({ cls: "matrix-engine-result-score", text: item.score.toFixed(2) });

    const path = card.createDiv({ cls: "matrix-engine-result-path", text: item.path });
    path.setAttr("dir", "auto");

    const edges = card.createDiv({ cls: "matrix-engine-result-reasons" });
    for (const edge of item.edges.slice(0, 4)) {
      const text = edge.kind === "semantic"
        ? translate("connections.edge.semantic", { score: edge.score.toFixed(2) })
        : edge.kind === "wikilink"
          ? translate("connections.edge.wikilink")
          : edge.kind === "backlink"
            ? translate("connections.edge.backlink")
            : edge.kind === "shared_tag"
              ? translate("connections.edge.sharedTag", { tag: edge.tag })
              : translate("connections.edge.lexical");
      edges.createSpan({ cls: "matrix-engine-reason", text });
    }

    if (item.evidenceSnippet !== undefined) {
      const snippet = card.createDiv({ cls: "matrix-engine-result-snippet", text: item.evidenceSnippet });
      snippet.setAttr("dir", "auto");
    }

    const actions = card.createDiv({ cls: "matrix-engine-result-actions" });
    const openButton = actions.createEl("button", { text: translate("lookup.action.open") });
    openButton.addEventListener("click", () => {
      const file = markdownFileFor(this.app, item.path);
      if (file !== null) {
        void this.app.workspace.getLeaf(false).openFile(file, item.evidenceLineStart === undefined ? undefined : { eState: { line: item.evidenceLineStart } });
      }
    });
    const pinButton = actions.createEl("button", { text: item.pinned ? translate("connections.unpin") : translate("connections.pin") });
    pinButton.addEventListener("click", () => {
      void this.#controller.feedback.setPinned(item.sourceId, !item.pinned).then(() => this.refreshForActiveNote());
    });
    const hideButton = actions.createEl("button", { text: translate("connections.hide") });
    hideButton.addEventListener("click", () => {
      void this.#controller.feedback.setHidden(item.sourceId, true).then(() => this.refreshForActiveNote());
    });
  }
}
