import { Notice, Plugin, TFile } from "obsidian";

import { MatrixEngineController } from "./app/controller";
import { buildNamespaces, identityForPluginId, SPIKE_PLUGIN_ID } from "./identity";
import { LifecycleRegistry } from "./core/lifecycle";
import { translate } from "./i18n/translate";
import { PlatformProbeController } from "./probe/platform-probe";
import { PlatformProbeView, SPIKE_VIEW_TYPE } from "./probe/probe-view";
import { ConnectionsView, CONNECTIONS_VIEW_TYPE } from "./ui/connections-view";
import { LookupView, LOOKUP_VIEW_TYPE } from "./ui/lookup-view";
import { MatrixEngineSettingTab } from "./ui/settings-tab";

export default class MatrixEnginePlugin extends Plugin {
  readonly #lifecycle = new LifecycleRegistry();
  #controller: MatrixEngineController | undefined;

  override async onload(): Promise<void> {
    buildNamespaces(identityForPluginId(this.manifest.id));
    if (this.manifest.id === SPIKE_PLUGIN_ID) {
      this.#loadSpike();
      return;
    }
    await this.#loadFormal();
  }

  override onunload(): void {
    void this.#controller?.close();
    void this.#lifecycle.close();
  }

  #loadSpike(): void {
    const controller = new PlatformProbeController(this.app, this.manifest.dir);
    this.registerView(SPIKE_VIEW_TYPE, (leaf) => new PlatformProbeView(leaf, controller));
    this.addCommand({ id: "run-platform-probe", name: translate("spike.command.run"), callback: () => { void controller.run().catch(() => undefined); } });
    this.addCommand({ id: "open-platform-probe", name: translate("spike.command.open"), callback: () => { void this.#revealView(SPIKE_VIEW_TYPE); } });
  }

  async #loadFormal(): Promise<void> {
    const controller = await MatrixEngineController.create(this.app, {
      baseDir: `${this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`}/artifacts`,
      loadData: () => this.loadData(),
      saveData: (data) => this.saveData(data)
    });
    this.#controller = controller;

    this.registerView(LOOKUP_VIEW_TYPE, (leaf) => new LookupView(leaf, controller));
    this.registerView(CONNECTIONS_VIEW_TYPE, (leaf) => new ConnectionsView(leaf, controller));

    this.addRibbonIcon("search", translate("command.openLookup"), () => {
      void this.#revealView(LOOKUP_VIEW_TYPE);
    });

    this.addCommand({ id: "open-lookup", name: translate("command.openLookup"), callback: () => { void this.#revealView(LOOKUP_VIEW_TYPE, true); } });
    this.addCommand({ id: "open-connections", name: translate("command.openConnections"), callback: () => { void this.#revealView(CONNECTIONS_VIEW_TYPE); } });
    this.addCommand({
      id: "search-selection",
      name: translate("command.searchSelection"),
      callback: () => {
        void this.#revealView(CONNECTIONS_VIEW_TYPE).then(() => {
          const view = this.app.workspace.getLeavesOfType(CONNECTIONS_VIEW_TYPE)[0]?.view;
          if (view instanceof ConnectionsView) void view.searchSelection();
        });
      }
    });
    this.addCommand({ id: "pause-indexing", name: translate("command.pauseIndexing"), callback: () => { controller.pauseIndexing(); new Notice(translate("notice.indexingPaused")); } });
    this.addCommand({ id: "resume-indexing", name: translate("command.resumeIndexing"), callback: () => { controller.resumeIndexing(); new Notice(translate("notice.indexingResumed")); } });
    this.addCommand({ id: "retry-failed", name: translate("command.retryFailed"), callback: () => { void controller.retryFailed(); } });
    this.addCommand({
      id: "rebuild-index",
      name: translate("command.rebuildIndex"),
      callback: () => {
        new Notice(translate("notice.rebuildStarted"));
        void controller.rebuildIndex().then((report) => {
          new Notice(translate("notice.scanComplete", { indexed: String(report.indexed), failed: String(report.failed) }));
        });
      }
    });

    this.addSettingTab(new MatrixEngineSettingTab(this.app, this, controller));

    // Incremental events (FR-002); Obsidian fires create for every file at
    // startup before layout-ready, which the initial scan already covers.
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", (file) => {
        if (file instanceof TFile) controller.handleVaultEvent({ kind: "create", path: file.path });
      }));
      this.registerEvent(this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) controller.handleVaultEvent({ kind: "modify", path: file.path });
      }));
      this.registerEvent(this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) controller.handleVaultEvent({ kind: "delete", path: file.path });
      }));
      this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) controller.handleVaultEvent({ kind: "rename", path: file.path, oldPath });
      }));
      this.registerEvent(this.app.metadataCache.on("changed", (file) => {
        controller.handleVaultEvent({ kind: "modify", path: file.path });
      }));
      void controller.initialScan().then((report) => {
        if (report.indexed > 0 || report.failed > 0) {
          new Notice(translate("notice.scanComplete", { indexed: String(report.indexed), failed: String(report.failed) }));
        }
      }).catch(() => undefined);
    });
  }

  async #revealView(viewType: string, focusInput = false): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(viewType)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (leaf === null) return;
    if (existing === undefined) await leaf.setViewState({ type: viewType, active: true });
    await this.app.workspace.revealLeaf(leaf);
    if (focusInput && leaf.view instanceof LookupView) leaf.view.focusInput();
  }
}
