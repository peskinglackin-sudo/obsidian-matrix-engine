import { Plugin } from "obsidian";

import { buildNamespaces, identityForPluginId, SPIKE_PLUGIN_ID } from "./identity";
import { LifecycleRegistry } from "./core/lifecycle";
import { translate } from "./i18n/translate";
import { PlatformProbeController } from "./probe/platform-probe";
import { PlatformProbeView, SPIKE_VIEW_TYPE } from "./probe/probe-view";

export default class MatrixEnginePlugin extends Plugin {
  readonly #lifecycle = new LifecycleRegistry();

  override onload(): void {
    buildNamespaces(identityForPluginId(this.manifest.id));
    if (this.manifest.id === SPIKE_PLUGIN_ID) {
      const controller = new PlatformProbeController(this.app, this.manifest.dir);
      this.registerView(SPIKE_VIEW_TYPE, (leaf) => new PlatformProbeView(leaf, controller));
      this.addCommand({ id: "run-platform-probe", name: translate("spike.command.run"), callback: () => { void controller.run().catch(() => undefined); } });
      this.addCommand({ id: "open-platform-probe", name: translate("spike.command.open"), callback: () => { void this.#openProbeView(); } });
    }
  }

  override onunload(): void {
    void this.#lifecycle.close();
  }

  async #openProbeView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(SPIKE_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (leaf === null) throw new Error("SPIKE_VIEW_LEAF_UNAVAILABLE");
    if (existing === undefined) await leaf.setViewState({ type: SPIKE_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
}
