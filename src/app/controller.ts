import type { App } from "obsidian";

import { toSafeError, type SafeError } from "../core/errors";
import { ConnectionFeedbackStore } from "../connections/feedback";
import { ConnectionsService } from "../connections/service";
import { VaultEventCoalescer, type VaultEvent } from "../pipeline/coalescer";
import { IndexCoordinator, type IndexProgress, type ScanReport } from "../pipeline/coordinator";
import { analyzerOptionsFrom } from "../pipeline/row-builder";
import { EmbeddingBatcher } from "../providers/batcher";
import { batchLimitsFor, createEmbeddingProvider, createQueryEmbedder, retryOptionsFor } from "../providers/factory";
import { probeEmbeddingProvider, type EmbeddingProbeReport } from "../providers/http-embedding";
import { testMultilingualCapability, type MultilingualTestResult } from "../providers/multilingual-test";
import { documentTemplateVariables, renderTemplate } from "../indexing/hashes";
import { SearchService, type SearchOptions } from "../retrieval/service";
import type { SearchResponse, SearchTimings } from "../retrieval/types";
import { buildArtifactDescriptor } from "../settings/fingerprint";
import { loadSettings, selectActiveConfiguration, SettingsStore, type ActiveConfiguration, type SettingsIssue } from "../settings/store";
import { classifyEndpoint, type EndpointTrust, type PluginSettings, type SearchMode } from "../settings/types";
import { LocalArtifactStore } from "../storage/local-store";
import type { RowFilter } from "../storage/contracts";
import { ObsidianStorageAdapter, ObsidianVaultPort } from "./obsidian-ports";

/**
 * MatrixEngineController: composition root for the formal plugin.
 *
 * Owns settings, the artifact store, the indexing coordinator, and the
 * search/connections services. Artifact-fingerprint changes swap the
 * runtime and rebuild; retrieval/UI setting changes apply live.
 */

export type ControllerStatus = Readonly<{
  progress: IndexProgress;
  stats: ReturnType<LocalArtifactStore["stats"]>;
  embeddingReady: boolean;
}>;

export type ConnectionTestOutcome = Readonly<{
  report: EmbeddingProbeReport;
  endpoint: EndpointTrust;
  destination: string;
  samplePreview: string;
}>;

type SecretStorageLike = Readonly<{
  setSecret(id: string, secret: string): void;
  getSecret(id: string): string | null;
}>;

export class MatrixEngineController {
  readonly #app: App;
  readonly #settings: SettingsStore;
  readonly settingsIssues: readonly SettingsIssue[];
  readonly #adapter: ObsidianStorageAdapter;
  readonly #vaultPort: ObsidianVaultPort;
  readonly #feedback: ConnectionFeedbackStore;
  readonly #statusListeners = new Set<(status: ControllerStatus) => void>();

  #store: LocalArtifactStore;
  #coordinator: IndexCoordinator;
  #coalescer: VaultEventCoalescer;
  #searchService: SearchService;
  #connections: ConnectionsService;
  #activeFingerprint: string;
  #lastTimings: SearchTimings | undefined;
  #lastError: SafeError | undefined;
  #closed = false;

  private constructor(app: App, settings: SettingsStore, issues: readonly SettingsIssue[], adapter: ObsidianStorageAdapter, feedback: ConnectionFeedbackStore) {
    this.#app = app;
    this.#settings = settings;
    this.settingsIssues = issues;
    this.#adapter = adapter;
    this.#vaultPort = new ObsidianVaultPort(app);
    this.#feedback = feedback;
    const runtime = this.#buildRuntime();
    this.#store = runtime.store;
    this.#coordinator = runtime.coordinator;
    this.#coalescer = runtime.coalescer;
    this.#searchService = runtime.search;
    this.#connections = runtime.connections;
    this.#activeFingerprint = runtime.fingerprint;
    this.#settings.subscribe(() => this.#onSettingsChanged());
  }

  static async create(app: App, options: Readonly<{
    baseDir: string;
    loadData: () => Promise<unknown>;
    saveData: (data: unknown) => Promise<void>;
  }>): Promise<MatrixEngineController> {
    const raw = await options.loadData();
    const loaded = loadSettings(raw);
    const store = new SettingsStore(loaded.settings, (settings) => options.saveData(settings));
    if (loaded.changed) await options.saveData(loaded.settings);
    const adapter = new ObsidianStorageAdapter(app.vault.adapter, options.baseDir);
    const feedback = new ConnectionFeedbackStore(adapter);
    await feedback.load();
    return new MatrixEngineController(app, store, loaded.issues, adapter, feedback);
  }

  get settings(): SettingsStore {
    return this.#settings;
  }

  get search(): SearchService {
    return this.#searchService;
  }

  get connections(): ConnectionsService {
    return this.#connections;
  }

  get feedback(): ConnectionFeedbackStore {
    return this.#feedback;
  }

  get coordinator(): IndexCoordinator {
    return this.#coordinator;
  }

  get lastTimings(): SearchTimings | undefined {
    return this.#lastTimings;
  }

  get lastError(): SafeError | undefined {
    return this.#lastError;
  }

  activeConfiguration(): ActiveConfiguration {
    return selectActiveConfiguration(this.#settings.current);
  }

  embeddingReady(): boolean {
    const config = this.activeConfiguration();
    return config.recipe !== undefined && config.provider !== undefined && config.recipe.dimension > 0;
  }

  status(): ControllerStatus {
    return Object.freeze({
      progress: this.#coordinator.progress(),
      stats: this.#store.stats(),
      embeddingReady: this.embeddingReady()
    });
  }

  onStatus(listener: (status: ControllerStatus) => void): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  sourceIdForPath(path: string): string | undefined {
    return this.#store.getSourceByPath(path)?.sourceId;
  }

  handleVaultEvent(event: VaultEvent): void {
    this.#coalescer.push(event);
  }

  async initialScan(): Promise<ScanReport> {
    const report = await this.#loadAndScan();
    this.#notifyStatus();
    return report;
  }

  async runSearch(rawQuery: string, overrides: Readonly<{ mode?: SearchMode; resultType?: "blocks" | "sources"; baseFilter?: RowFilter; signal?: AbortSignal }>): Promise<SearchResponse> {
    const config = this.activeConfiguration();
    const options: SearchOptions = {
      mode: overrides.mode ?? config.retrieval.mode,
      resultType: overrides.resultType ?? this.#settings.current.ui.lookupResultType,
      limit: config.retrieval.limit,
      profile: config.retrieval,
      ...(overrides.baseFilter === undefined ? {} : { baseFilter: overrides.baseFilter }),
      ...(overrides.signal === undefined ? {} : { signal: overrides.signal })
    };
    const response = await this.#searchService.search(rawQuery, options);
    this.#lastTimings = response.timings;
    return response;
  }

  pauseIndexing(): void {
    this.#coordinator.pause();
    this.#notifyStatus();
  }

  resumeIndexing(): void {
    this.#coordinator.resume();
    this.#notifyStatus();
  }

  async retryFailed(): Promise<void> {
    await this.#coordinator.retryFailed();
    this.#notifyStatus();
  }

  async rebuildIndex(): Promise<ScanReport> {
    const report = await this.#coordinator.rebuildAll();
    this.#notifyStatus();
    return report;
  }

  /** Test connection (PRD 19.2): probe + endpoint trust + send preview. */
  async testConnection(signal?: AbortSignal): Promise<ConnectionTestOutcome | undefined> {
    const config = this.activeConfiguration();
    if (config.provider === undefined || config.recipe === undefined) return undefined;
    const provider = createEmbeddingProvider(config.provider, { modelId: config.recipe.modelId, dimension: 0 }, this.#secretFor(config), fetch);
    const report = await probeEmbeddingProvider(provider, signal);
    const sample = renderTemplate(config.recipe.documentTemplate, documentTemplateVariables({
      title: "Example note title",
      headingPath: ["Heading"],
      content: "Example paragraph content from your note.",
      path: "folder/example.md",
      tags: ["tag"]
    }));
    return Object.freeze({
      report,
      endpoint: classifyEndpoint(config.provider.baseUrl),
      destination: `${config.provider.baseUrl}/embeddings`,
      samplePreview: sample.text
    });
  }

  async applyDetectedDimension(report: EmbeddingProbeReport): Promise<boolean> {
    const dimensions = report.dimensions;
    if (dimensions === undefined || dimensions <= 0) return false;
    const config = this.activeConfiguration();
    const recipeId = config.recipe?.id;
    if (recipeId === undefined) return false;
    await this.#settings.update((settings) => {
      const recipe = settings.embeddingRecipes.find(({ id }) => id === recipeId);
      if (recipe !== undefined) {
        recipe.dimension = dimensions;
        if (recipe.modelSignature.length === 0) {
          recipe.modelSignature = report.actualModel ?? recipe.modelId;
        }
      }
      return settings;
    });
    return true;
  }

  async runMultilingualTest(signal?: AbortSignal): Promise<MultilingualTestResult | null> {
    const config = this.activeConfiguration();
    if (config.provider === undefined || config.recipe === undefined || config.recipe.dimension <= 0) return null;
    const provider = createEmbeddingProvider(config.provider, config.recipe, this.#secretFor(config), fetch);
    const result = await testMultilingualCapability(async (texts, innerSignal) => {
      const outcome = await provider.embed(texts, { purpose: "query", ...(innerSignal === undefined ? {} : { signal: innerSignal }) });
      return outcome.ok ? outcome.value.vectors : null;
    }, undefined, signal);
    if (result !== null) {
      const recipeId = config.recipe.id;
      await this.#settings.update((settings) => {
        const recipe = settings.embeddingRecipes.find(({ id }) => id === recipeId);
        if (recipe !== undefined) {
          recipe.multilingual = {
            declared: recipe.multilingual.declared,
            verified: result.verified,
            testedPairs: result.testedPairs.map((pair) => [pair[0], pair[1]]),
            score: result.score
          };
        }
        return settings;
      });
    }
    return result;
  }

  setSecret(secretRef: string, value: string): boolean {
    const storage = this.#secretStorage();
    if (storage === undefined) return false;
    storage.setSecret(secretRef, value);
    return true;
  }

  /** Safe redacted diagnostics (PRD 19.5, 21.5). */
  redactedDiagnostics(): string {
    const settings = this.#settings.current;
    const config = this.activeConfiguration();
    const payload = {
      plugin: "matrix-engine",
      settingsVersion: settings.version,
      mode: config.retrieval.mode,
      limits: {
        limit: config.retrieval.limit,
        exact: config.retrieval.exactCandidateLimit,
        lexical: config.retrieval.lexicalCandidateLimit,
        semantic: config.retrieval.semanticCandidateLimit
      },
      fusion: config.retrieval.fusion,
      providerKind: config.provider?.kind ?? null,
      endpointTrust: config.provider === undefined ? null : classifyEndpoint(config.provider.baseUrl),
      recipeDimension: config.recipe?.dimension ?? 0,
      analyzer: config.lexical === undefined ? null : { id: config.lexical.analyzerId, version: config.lexical.analyzerVersion },
      artifactFingerprint: this.#activeFingerprint,
      stats: this.#store.stats(),
      progress: this.#coordinator.progress(),
      lastTimings: this.#lastTimings ?? null,
      deadLetterCodes: [...this.#coordinator.deadLetters().values()].map(({ code }) => code)
    };
    return JSON.stringify(payload, null, 2);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#coalescer.close();
    await this.#coordinator.close();
  }

  // ------------------------------------------------------------ internals

  #buildRuntime(): Readonly<{
    store: LocalArtifactStore;
    coordinator: IndexCoordinator;
    coalescer: VaultEventCoalescer;
    search: SearchService;
    connections: ConnectionsService;
    fingerprint: string;
  }> {
    const config = this.activeConfiguration();
    if (config.recipe === undefined || config.corpus === undefined || config.lexical === undefined) {
      throw new Error("Active configuration is incomplete");
    }
    const descriptor = buildArtifactDescriptor({
      artifactId: config.retrieval.artifactId,
      corpus: config.corpus,
      lexical: config.lexical,
      recipe: config.recipe,
      now: Date.now()
    });
    const store = new LocalArtifactStore({
      artifactId: descriptor.id,
      artifactFingerprint: descriptor.artifactFingerprint,
      dimension: config.recipe.dimension,
      adapter: this.#adapter
    });

    const embedding = this.#buildEmbedding(config);
    const baseLexical = config.lexical;
    const corpusId = config.corpus.id;
    const lexicalId = config.lexical.id;
    const recipeId = config.recipe.id;
    const configProvider = () => this._configShape(corpusId, lexicalId, recipeId, descriptor.lexicalFingerprint);

    const coordinator = new IndexCoordinator({
      store,
      vault: this.#vaultPort,
      config: configProvider,
      ...(embedding === undefined ? {} : { embedder: embedding.batcher }),
      onStatusChange: () => this.#notifyStatus()
    });
    const coalescer = new VaultEventCoalescer({
      debounceMs: 400,
      onFlush: (tasks) => coordinator.enqueue(tasks)
    });

    const analyzerOptions = (): ReturnType<typeof analyzerOptionsFrom> => {
      const current = selectActiveConfiguration(this.#settings.current);
      return analyzerOptionsFrom(current.lexical ?? baseLexical);
    };
    const queryTemplate = (): string => selectActiveConfiguration(this.#settings.current).recipe?.queryTemplate ?? "{query}";
    const metric = (): "cosine" | "dot" | "l2" => selectActiveConfiguration(this.#settings.current).recipe?.metric ?? "cosine";

    const search = new SearchService({
      store,
      artifactId: descriptor.id,
      analyzerOptions,
      ...(embedding === undefined ? {} : { embedQuery: embedding.embedQuery }),
      queryTemplate,
      metric,
      embeddingReady: () => this.embeddingReady()
    });
    const connections = new ConnectionsService({
      store,
      analyzerOptions,
      metric,
      queryTemplate,
      ...(embedding === undefined ? {} : { embedQuery: embedding.embedQuery }),
      feedback: this.#feedback
    });

    return Object.freeze({ store, coordinator, coalescer, search, connections, fingerprint: descriptor.artifactFingerprint });
  }

  /* Shape helper so the coordinator config closure stays typed. */
  private _configShape(corpusId: string, lexicalId: string, recipeId: string, lexicalFingerprint: string): Readonly<{
    corpus: NonNullable<ActiveConfiguration["corpus"]>;
    lexical: NonNullable<ActiveConfiguration["lexical"]>;
    documentTemplate: string;
    lexicalFingerprint: string;
    embeddingEnabled: boolean;
  }> {
    const settings = this.#settings.current;
    const corpus = settings.corpusProfiles.find(({ id }) => id === corpusId) ?? settings.corpusProfiles[0];
    const lexical = settings.lexicalProfiles.find(({ id }) => id === lexicalId) ?? settings.lexicalProfiles[0];
    const recipe = settings.embeddingRecipes.find(({ id }) => id === recipeId);
    if (corpus === undefined || lexical === undefined) throw new Error("Corpus or lexical profile missing");
    return Object.freeze({
      corpus,
      lexical,
      documentTemplate: recipe?.documentTemplate ?? "{title}\n{heading_path}\n{content}",
      lexicalFingerprint,
      embeddingEnabled: this.embeddingReady()
    });
  }

  #buildEmbedding(config: ActiveConfiguration): Readonly<{ batcher: EmbeddingBatcher; embedQuery: ReturnType<typeof createQueryEmbedder> }> | undefined {
    if (config.provider === undefined || config.recipe === undefined || config.recipe.dimension <= 0) return undefined;
    const provider = createEmbeddingProvider(config.provider, config.recipe, this.#secretFor(config), fetch);
    const batcher = new EmbeddingBatcher(
      (texts, signal) => provider.embed(texts, { purpose: "document", ...(signal === undefined ? {} : { signal }) }),
      batchLimitsFor(config.provider),
      retryOptionsFor(config.provider)
    );
    return Object.freeze({ batcher, embedQuery: createQueryEmbedder(provider, config.provider) });
  }

  #secretFor(config: ActiveConfiguration): string | undefined {
    const secretRef = config.provider?.secretRef;
    if (secretRef === undefined) return undefined;
    return this.#secretStorage()?.getSecret(secretRef) ?? undefined;
  }

  #secretStorage(): SecretStorageLike | undefined {
    const candidate = (this.#app as unknown as { secretStorage?: SecretStorageLike }).secretStorage;
    return candidate;
  }

  #onSettingsChanged(): void {
    if (this.#closed) return;
    try {
      const config = this.activeConfiguration();
      if (config.recipe === undefined || config.corpus === undefined || config.lexical === undefined) return;
      const descriptor = buildArtifactDescriptor({
        artifactId: config.retrieval.artifactId,
        corpus: config.corpus,
        lexical: config.lexical,
        recipe: config.recipe,
        now: Date.now()
      });
      if (descriptor.artifactFingerprint !== this.#activeFingerprint) {
        void this.#swapRuntime();
      } else {
        this.#notifyStatus();
      }
    } catch (error: unknown) {
      this.#lastError = toSafeError(error, "SETTINGS_APPLY_FAILED");
    }
  }

  async #swapRuntime(): Promise<void> {
    const oldCoalescer = this.#coalescer;
    const oldCoordinator = this.#coordinator;
    oldCoalescer.close();
    await oldCoordinator.close();

    const runtime = this.#buildRuntime();
    this.#store = runtime.store;
    this.#coordinator = runtime.coordinator;
    this.#coalescer = runtime.coalescer;
    this.#searchService = runtime.search;
    this.#connections = runtime.connections;
    this.#activeFingerprint = runtime.fingerprint;
    await this.#loadAndScan();
    this.#notifyStatus();
  }

  async #loadAndScan(): Promise<ScanReport> {
    const loadResult = await this.#store.load();
    if (loadResult.error !== undefined) this.#lastError = loadResult.error;
    this.#syncArtifactDescriptor();
    return this.#coordinator.fullScan();
  }

  #syncArtifactDescriptor(): void {
    const config = this.activeConfiguration();
    if (config.recipe === undefined || config.corpus === undefined || config.lexical === undefined) return;
    const descriptor = buildArtifactDescriptor({
      artifactId: config.retrieval.artifactId,
      corpus: config.corpus,
      lexical: config.lexical,
      recipe: config.recipe,
      now: Date.now()
    });
    const existing = this.#settings.current.indexArtifacts.find(({ id }) => id === descriptor.id);
    if (existing?.artifactFingerprint === descriptor.artifactFingerprint) return;
    void this.#settings.update((settings) => {
      const index = settings.indexArtifacts.findIndex(({ id }) => id === descriptor.id);
      const record: PluginSettings["indexArtifacts"][number] = { ...descriptor, state: "ready" };
      if (index >= 0) settings.indexArtifacts[index] = record;
      else settings.indexArtifacts.push(record);
      return settings;
    }).catch(() => undefined);
  }

  #notifyStatus(): void {
    if (this.#closed) return;
    const status = this.status();
    for (const listener of [...this.#statusListeners]) listener(status);
  }
}
