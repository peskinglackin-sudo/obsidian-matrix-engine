import { ItemView, type WorkspaceLeaf } from "obsidian";

import { translate } from "../i18n/translate";
import type { PlatformProbeController, PlatformProbeProgress } from "./platform-probe";

export const SPIKE_VIEW_TYPE = "matrix-engine-spike-probe";

export class PlatformProbeView extends ItemView {
  readonly #controller: PlatformProbeController;
  #unsubscribe: (() => void) | undefined;

  constructor(leaf: WorkspaceLeaf, controller: PlatformProbeController) {
    super(leaf);
    this.#controller = controller;
  }

  getViewType(): string { return SPIKE_VIEW_TYPE; }
  getDisplayText(): string { return translate("spike.title"); }
  override onOpen(): Promise<void> { this.#unsubscribe = this.#controller.subscribe((progress) => this.#render(progress)); return Promise.resolve(); }
  override onClose(): Promise<void> { this.#unsubscribe?.(); this.#unsubscribe = undefined; return Promise.resolve(); }

  #render(progress: PlatformProbeProgress): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: translate("spike.title") });
    this.contentEl.createEl("p", { text: translate("spike.status", { status: progress.status, phase: progress.phase, count: String(progress.completed) }) });
    if (progress.errorCode !== undefined) this.contentEl.createEl("p", { text: translate("spike.error", { code: progress.errorCode }) });
    const button = this.contentEl.createEl("button", { text: translate("spike.command.run") });
    button.disabled = progress.status === "running";
    button.addEventListener("click", () => { void this.#controller.run().catch(() => undefined); });
  }
}
