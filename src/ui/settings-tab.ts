/* eslint-disable @typescript-eslint/no-deprecated -- PluginSettingTab.display() is the only settings surface available at the minAppVersion 1.11.4 floor; the 1.13 replacement API does not exist there. */
import { Notice, PluginSettingTab, Setting, type App, type Plugin } from "obsidian";

import type { MatrixEngineController } from "../app/controller";
import { translate, type TranslationKey } from "../i18n/translate";
import type { SearchMode } from "../settings/types";
import { classifyEndpoint } from "../settings/types";

/**
 * Settings View (PRD 19): Overview / Models / Indexing / Retrieval /
 * Advanced. Remote endpoints always show the trust boundary and a send
 * preview; API keys go to SecretStorage only; artifact-affecting changes
 * state their rebuild impact.
 */

type TabId = "overview" | "models" | "indexing" | "retrieval" | "advanced";

export class MatrixEngineSettingTab extends PluginSettingTab {
  readonly #controller: MatrixEngineController;
  #activeTab: TabId = "overview";

  constructor(app: App, plugin: Plugin, controller: MatrixEngineController) {
    super(app, plugin);
    this.#controller = controller;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("matrix-engine-settings");

    const nav = containerEl.createDiv({ cls: "matrix-engine-settings-nav" });
    for (const tab of ["overview", "models", "indexing", "retrieval", "advanced"] as const) {
      const button = nav.createEl("button", { text: translate(`settings.tab.${tab}` as TranslationKey) });
      if (tab === this.#activeTab) button.addClass("is-active");
      button.addEventListener("click", () => {
        this.#activeTab = tab;
        this.display();
      });
    }

    const body = containerEl.createDiv({ cls: "matrix-engine-settings-body" });
    switch (this.#activeTab) {
      case "overview":
        this.#renderOverview(body);
        break;
      case "models":
        this.#renderModels(body);
        break;
      case "indexing":
        this.#renderIndexing(body);
        break;
      case "retrieval":
        this.#renderRetrieval(body);
        break;
      case "advanced":
        this.#renderAdvanced(body);
        break;
    }
  }

  #renderOverview(root: HTMLElement): void {
    const controller = this.#controller;
    const status = controller.status();
    const config = controller.activeConfiguration();

    new Setting(root)
      .setName(translate("settings.overview.provider"))
      .setDesc(controller.embeddingReady() ? translate("settings.overview.providerReady") : translate("settings.overview.providerUnconfigured"));

    new Setting(root)
      .setName(translate("settings.overview.artifact"))
      .setDesc(config.artifact === undefined ? translate("settings.overview.artifactMissing") : `${config.artifact.id} · ${config.artifact.artifactFingerprint.slice(0, 12)}`);

    new Setting(root)
      .setName(translate("settings.overview.status"))
      .setDesc(`${translate(`status.state.${status.progress.state}` as TranslationKey)} · ${translate("status.summary", {
        files: String(status.stats.sources),
        chunks: String(status.stats.chunks),
        embedded: String(status.stats.chunksWithEmbedding)
      })}`);

    new Setting(root)
      .setName(translate("settings.overview.lastSync"))
      .setDesc(status.progress.lastSyncAt === 0 ? translate("settings.overview.never") : new Date(status.progress.lastSyncAt).toLocaleString());

    const lastError = controller.lastError ?? status.progress.lastError;
    if (lastError !== undefined) {
      new Setting(root)
        .setName(translate("settings.overview.recentError"))
        .setDesc(`${lastError.code} — ${translate(lastError.messageKey as TranslationKey)}`);
    }

    new Setting(root)
      .addButton((button) => button.setButtonText(translate(status.progress.state === "paused" ? "settings.overview.resume" : "settings.overview.pause")).onClick(() => {
        if (controller.status().progress.state === "paused") {
          controller.resumeIndexing();
          new Notice(translate("notice.indexingResumed"));
        } else {
          controller.pauseIndexing();
          new Notice(translate("notice.indexingPaused"));
        }
        this.display();
      }))
      .addButton((button) => button.setButtonText(translate("settings.overview.retryFailed")).onClick(async () => {
        await controller.retryFailed();
        this.display();
      }))
      .addButton((button) => button.setButtonText(translate("settings.overview.rebuild")).onClick(async () => {
        new Notice(translate("notice.rebuildStarted"));
        const report = await controller.rebuildIndex();
        new Notice(translate("notice.scanComplete", { indexed: String(report.indexed), failed: String(report.failed) }));
        this.display();
      }));
  }

  #renderModels(root: HTMLElement): void {
    const controller = this.#controller;
    const config = controller.activeConfiguration();
    const provider = config.provider;
    const recipe = config.recipe;
    if (provider === undefined || recipe === undefined) return;

    new Setting(root)
      .setName(translate("settings.models.kind"))
      .addDropdown((dropdown) => dropdown
        .addOption("llama_cpp", translate("settings.models.kind.llama"))
        .addOption("openai_compatible", translate("settings.models.kind.openai"))
        .setValue(provider.kind)
        .onChange(async (value) => {
          await controller.settings.update((draft) => {
            const target = draft.providerProfiles.find(({ id }) => id === provider.id);
            if (target !== undefined) target.kind = value === "llama_cpp" ? "llama_cpp" : "openai_compatible";
            return draft;
          });
        }));

    const endpointSetting = new Setting(root)
      .setName(translate("settings.models.baseUrl"))
      .setDesc(translate("settings.models.baseUrlDesc"))
      .addText((text) => text.setValue(provider.baseUrl).onChange(async (value) => {
        try {
          classifyEndpoint(value);
        } catch {
          return;
        }
        await controller.settings.update((draft) => {
          const target = draft.providerProfiles.find(({ id }) => id === provider.id);
          if (target !== undefined) target.baseUrl = value;
          return draft;
        });
        this.display();
      }));
    try {
      const trust = classifyEndpoint(provider.baseUrl);
      const trustEl = endpointSetting.descEl.createDiv({ cls: `matrix-engine-endpoint matrix-engine-endpoint-${trust}` });
      trustEl.setText(translate(`settings.models.endpoint.${trust}` as TranslationKey));
    } catch {
      // invalid URL already prevented from saving
    }

    new Setting(root)
      .setName(translate("settings.models.model"))
      .setDesc(translate("settings.models.modelDesc"))
      .addText((text) => text.setValue(recipe.modelId).onChange(async (value) => {
        await controller.settings.update((draft) => {
          const target = draft.embeddingRecipes.find(({ id }) => id === recipe.id);
          if (target !== undefined) target.modelId = value;
          return draft;
        });
      }));

    new Setting(root)
      .setName(translate("settings.models.dimension"))
      .setDesc(translate("settings.models.dimensionDesc"))
      .addText((text) => {
        text.setValue(recipe.dimension > 0 ? String(recipe.dimension) : "");
        text.setDisabled(true);
      });

    new Setting(root)
      .setName(translate("settings.models.apiKey"))
      .setDesc(translate("settings.models.apiKeyDesc"))
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("••••••");
        text.onChange((value) => {
          if (value.length === 0) return;
          const secretRef = provider.secretRef ?? `matrix-engine-${provider.id}-key`;
          if (controller.setSecret(secretRef, value)) {
            if (provider.secretRef !== secretRef) {
              void controller.settings.update((draft) => {
                const target = draft.providerProfiles.find(({ id }) => id === provider.id);
                if (target !== undefined) target.secretRef = secretRef;
                return draft;
              });
            }
            new Notice(translate("settings.models.apiKeySet"));
          }
        });
      });

    new Setting(root)
      .setName(translate("settings.models.timeout"))
      .addText((text) => text.setValue(String(provider.timeoutMs)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isSafeInteger(parsed) || parsed < 1000) return;
        await controller.settings.update((draft) => {
          const target = draft.providerProfiles.find(({ id }) => id === provider.id);
          if (target !== undefined) target.timeoutMs = parsed;
          return draft;
        });
      }));

    new Setting(root)
      .setName(translate("settings.models.maxBatch"))
      .addText((text) => text.setValue(String(provider.maxBatchItems ?? 16)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isSafeInteger(parsed) || parsed < 1) return;
        await controller.settings.update((draft) => {
          const target = draft.providerProfiles.find(({ id }) => id === provider.id);
          if (target !== undefined) target.maxBatchItems = parsed;
          return draft;
        });
      }));

    const testResults = root.createDiv({ cls: "matrix-engine-test-results" });
    new Setting(root)
      .setName(translate("settings.models.test"))
      .addButton((button) => button.setCta().setButtonText(translate("settings.models.test")).onClick(async () => {
        testResults.empty();
        testResults.createDiv({ text: translate("settings.models.testRunning") });
        const outcome = await controller.testConnection();
        testResults.empty();
        if (outcome?.report.reachable !== true) {
          testResults.createDiv({ cls: "matrix-engine-degraded", text: translate("settings.models.testFailed", { code: outcome?.report.error?.code ?? "UNREACHABLE" }) });
          return;
        }
        testResults.createDiv({ text: translate("settings.models.testOk", {
          dimension: String(outcome.report.dimensions ?? 0),
          normalization: outcome.report.serverNormalization,
          model: outcome.report.actualModel ?? "?",
          health: outcome.report.health
        }) });
        // Send preview (PRD 17.5/19.2): destination, fields, rendered sample.
        const preview = testResults.createDiv({ cls: "matrix-engine-send-preview" });
        preview.createDiv({ cls: "matrix-engine-send-preview-title", text: translate("settings.models.sendPreview") });
        preview.createDiv({ text: translate("settings.models.sendPreviewDestination", { url: outcome.destination }) });
        preview.createDiv({ text: translate("settings.models.sendPreviewFields", { fields: "title, heading_path, content" }) });
        preview.createEl("pre", { text: outcome.samplePreview });
        if (await controller.applyDetectedDimension(outcome.report)) {
          new Notice(translate("settings.models.applyDetected"));
          this.display();
        }
      }))
      .addButton((button) => button.setButtonText(translate("settings.models.multilingualTest")).onClick(async () => {
        testResults.empty();
        testResults.createDiv({ text: translate("settings.models.testRunning") });
        const result = await controller.runMultilingualTest();
        testResults.empty();
        if (result === null) {
          testResults.createDiv({ cls: "matrix-engine-degraded", text: translate("settings.models.multilingualFailed") });
          return;
        }
        testResults.createDiv({
          text: result.verified
            ? translate("settings.models.multilingualVerified", { pairs: result.testedPairs.map((pair) => pair.join("↔")).join(", ") })
            : translate("settings.models.multilingualUnverified", { score: result.score.toFixed(2) })
        });
      }));

    const capability = recipe.multilingual.verified ? "verified" : recipe.multilingual.declared ? "declared" : "unknown";
    root.createDiv({ cls: "matrix-engine-capability", text: translate(`settings.models.capability.${capability}` as TranslationKey) });
  }

  #renderIndexing(root: HTMLElement): void {
    const controller = this.#controller;
    const config = controller.activeConfiguration();
    const corpus = config.corpus;
    if (corpus === undefined) return;

    new Setting(root)
      .setName(translate("settings.indexing.includes"))
      .setDesc(translate("settings.indexing.includesDesc"))
      .addTextArea((text) => text.setValue(corpus.includes.join("\n")).onChange(async (value) => {
        await controller.settings.update((draft) => {
          const target = draft.corpusProfiles.find(({ id }) => id === corpus.id);
          if (target !== undefined) target.includes = value.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
          return draft;
        });
      }));

    new Setting(root)
      .setName(translate("settings.indexing.excludes"))
      .addTextArea((text) => text.setValue(corpus.excludes.join("\n")).onChange(async (value) => {
        await controller.settings.update((draft) => {
          const target = draft.corpusProfiles.find(({ id }) => id === corpus.id);
          if (target !== undefined) target.excludes = value.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
          return draft;
        });
      }));

    new Setting(root)
      .setName(translate("settings.indexing.fileTypes"))
      .addToggle((toggle) => toggle.setTooltip(translate("settings.indexing.fileTypes.txt")).setValue(corpus.fileTypes.includes("txt")).onChange(async (enabled) => {
        await controller.settings.update((draft) => {
          const target = draft.corpusProfiles.find(({ id }) => id === corpus.id);
          if (target !== undefined) {
            target.fileTypes = enabled ? ["md", "txt"] : ["md"];
          }
          return draft;
        });
      }))
      .setDesc(`${translate("settings.indexing.fileTypes.md")} + ${translate("settings.indexing.fileTypes.txt")}`);

    new Setting(root)
      .setName(translate("settings.indexing.chunkSize"))
      .setDesc(`${translate("settings.indexing.chunkSizeDesc")} — ${translate("settings.indexing.impact.rebuild")}`)
      .addSlider((slider) => slider.setLimits(128, 2048, 64).setValue(corpus.chunkSizeTokens).onChange(async (value) => {
        await controller.settings.update((draft) => {
          const target = draft.corpusProfiles.find(({ id }) => id === corpus.id);
          if (target !== undefined) target.chunkSizeTokens = value;
          return draft;
        });
      }));

    new Setting(root)
      .addButton((button) => button.setButtonText(translate("settings.indexing.rebuild")).onClick(async () => {
        new Notice(translate("notice.rebuildStarted"));
        const report = await controller.rebuildIndex();
        new Notice(translate("notice.scanComplete", { indexed: String(report.indexed), failed: String(report.failed) }));
      }));
  }

  #renderRetrieval(root: HTMLElement): void {
    const controller = this.#controller;
    const config = controller.activeConfiguration();
    const retrieval = config.retrieval;

    new Setting(root)
      .setName(translate("settings.retrieval.mode"))
      .addDropdown((dropdown) => {
        for (const mode of ["auto", "exact", "lexical", "semantic", "hybrid"] as const) {
          dropdown.addOption(mode, translate(`lookup.mode.${mode}` as TranslationKey));
        }
        dropdown.setValue(retrieval.mode).onChange(async (value) => {
          await controller.settings.update((draft) => {
            const target = draft.retrievalProfiles.find(({ id }) => id === retrieval.id);
            if (target !== undefined) target.mode = value as SearchMode;
            return draft;
          });
        });
      });

    new Setting(root)
      .setName(translate("settings.retrieval.resultType"))
      .addDropdown((dropdown) => dropdown
        .addOption("blocks", translate("lookup.resultType.blocks"))
        .addOption("sources", translate("lookup.resultType.sources"))
        .setValue(controller.settings.current.ui.lookupResultType)
        .onChange(async (value) => {
          await controller.settings.update((draft) => {
            draft.ui.lookupResultType = value === "sources" ? "sources" : "blocks";
            return draft;
          });
        }));

    const numberSetting = (name: TranslationKey, value: number, min: number, max: number, apply: (draftValue: number, draft: Parameters<Parameters<MatrixEngineController["settings"]["update"]>[0]>[0]) => void): void => {
      new Setting(root)
        .setName(translate(name))
        .addText((text) => text.setValue(String(value)).onChange(async (raw) => {
          const parsed = Number.parseFloat(raw);
          if (!Number.isFinite(parsed) || parsed < min || parsed > max) return;
          await controller.settings.update((draft) => {
            apply(parsed, draft);
            return draft;
          });
        }));
    };

    numberSetting("settings.retrieval.limit", retrieval.limit, 1, 200, (value, draft) => {
      const target = draft.retrievalProfiles.find(({ id }) => id === retrieval.id);
      if (target !== undefined) target.limit = Math.round(value);
    });
    numberSetting("settings.retrieval.rrfK", retrieval.fusion.rrfK, 1, 1000, (value, draft) => {
      const target = draft.retrievalProfiles.find(({ id }) => id === retrieval.id);
      if (target !== undefined) target.fusion.rrfK = Math.round(value);
    });
    numberSetting("settings.retrieval.exactWeight", retrieval.fusion.exactWeight, 0, 100, (value, draft) => {
      const target = draft.retrievalProfiles.find(({ id }) => id === retrieval.id);
      if (target !== undefined) target.fusion.exactWeight = value;
    });
    numberSetting("settings.retrieval.lexicalWeight", retrieval.fusion.lexicalWeight, 0, 100, (value, draft) => {
      const target = draft.retrievalProfiles.find(({ id }) => id === retrieval.id);
      if (target !== undefined) target.fusion.lexicalWeight = value;
    });
    numberSetting("settings.retrieval.semanticWeight", retrieval.fusion.semanticWeight, 0, 100, (value, draft) => {
      const target = draft.retrievalProfiles.find(({ id }) => id === retrieval.id);
      if (target !== undefined) target.fusion.semanticWeight = value;
    });
    numberSetting("settings.retrieval.maxPerSource", retrieval.maxResultsPerSource, 1, 50, (value, draft) => {
      const target = draft.retrievalProfiles.find(({ id }) => id === retrieval.id);
      if (target !== undefined) target.maxResultsPerSource = Math.round(value);
    });
    numberSetting("settings.retrieval.connectionsLimit", controller.settings.current.ui.connectionsLimit, 1, 100, (value, draft) => {
      draft.ui.connectionsLimit = Math.round(value);
    });

    new Setting(root)
      .setName(translate("settings.retrieval.connectionsAuto"))
      .addToggle((toggle) => toggle.setValue(controller.settings.current.ui.connectionsAutoUpdate).onChange(async (value) => {
        await controller.settings.update((draft) => {
          draft.ui.connectionsAutoUpdate = value;
          return draft;
        });
      }));
  }

  #renderAdvanced(root: HTMLElement): void {
    const controller = this.#controller;

    root.createDiv({ cls: "matrix-engine-local-notice", text: translate("settings.advanced.localDataNotice") });

    for (const issue of controller.settingsIssues) {
      root.createDiv({ cls: "matrix-engine-degraded", text: translate("settings.advanced.settingsResetNotice", { detail: `${issue.code}: ${issue.detail}` }) });
    }

    new Setting(root)
      .setName(translate("settings.advanced.debugLogging"))
      .setDesc(translate("settings.advanced.debugLoggingDesc"))
      .addToggle((toggle) => toggle.setValue(controller.settings.current.privacy.debugLogging).onChange(async (value) => {
        await controller.settings.update((draft) => {
          draft.privacy.debugLogging = value;
          return draft;
        });
      }));

    const timings = controller.lastTimings;
    new Setting(root)
      .setName(translate("settings.advanced.timings"))
      .setDesc(timings === undefined
        ? translate("settings.advanced.noTimings")
        : `parse ${timings.queryParseMs.toFixed(1)} ms · embed ${timings.queryEmbedMs?.toFixed(1) ?? "-"} ms · exact ${timings.exactMs?.toFixed(1) ?? "-"} ms · lexical ${timings.lexicalMs?.toFixed(1) ?? "-"} ms · vector ${timings.vectorMs?.toFixed(1) ?? "-"} ms · fusion ${timings.fusionMs.toFixed(1)} ms · hydrate ${timings.hydrateMs.toFixed(1)} ms · total ${timings.totalMs.toFixed(1)} ms`);

    new Setting(root)
      .setName(translate("settings.advanced.copyDiagnostics"))
      .addButton((button) => button.setButtonText(translate("settings.advanced.copyDiagnostics")).onClick(async () => {
        await navigator.clipboard.writeText(controller.redactedDiagnostics());
        new Notice(translate("settings.advanced.diagnosticsCopied"));
      }));
  }
}
