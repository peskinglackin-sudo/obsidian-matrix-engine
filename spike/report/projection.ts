type FtsEvidence = Readonly<{ lancedbVersion: string; authoritativeScope: string; checks: readonly unknown[] }>;
type LexicalEvidence = Readonly<{ fixtureSha256: string; documentCount: number; queryCount: number; groups: readonly Readonly<{ pass: boolean }>[] }>;
type LiveEvidence = Readonly<{ model: string; testedAt: string; dimensions: number; vectorCount: number; vectorShapeSha256: string }>;
type SemanticEvidence = Readonly<{ sha256: string; recipeSha256: string; documents: readonly unknown[]; distractors: readonly unknown[]; sameLanguage: readonly unknown[]; crossLanguage: readonly unknown[]; prefixControls: Readonly<{ queries: readonly unknown[]; documents: readonly unknown[] }> }>;
type AnnEvidence = Readonly<{
  fixtureSha256: string;
  fixture: unknown;
  flat: unknown;
  configurations: readonly Readonly<{ id: string; indexParameters: unknown; queryParameters: unknown; buildMs: number; openMs: number; coldFirstQueryMs: number; dataSizeBeforeIndex: number; indexSizeBytes: number; indexAndDataSizeBytes: number; latency: unknown; evaluation: unknown }>[];
}>;
type LicenseEvidence = Readonly<{ generatedFromLockfile: boolean; packageCount: number; nativeArtifacts: readonly unknown[]; modelFixture: unknown; sourceAndSyntheticFixturesLicense: string }>;

export function projectSafeEvidence(sources: Readonly<{
  fts: FtsEvidence;
  lexical: LexicalEvidence;
  live: LiveEvidence;
  semantic: SemanticEvidence;
  ann: AnnEvidence;
  licenses: LicenseEvidence;
}>) {
  return Object.freeze({
    fts: { lancedbVersion: sources.fts.lancedbVersion, authoritativeScope: sources.fts.authoritativeScope, checks: sources.fts.checks },
    lexical: { fixtureSha256: sources.lexical.fixtureSha256, documentCount: sources.lexical.documentCount, queryCount: sources.lexical.queryCount, groupCount: sources.lexical.groups.length, allGroupsPass: sources.lexical.groups.every((group) => group.pass) },
    live: { model: sources.live.model, testedAt: sources.live.testedAt, dimensions: sources.live.dimensions, vectorCount: sources.live.vectorCount, vectorShapeSha256: sources.live.vectorShapeSha256 },
    semantic: { fixtureSha256: sources.semantic.sha256, recipeSha256: sources.semantic.recipeSha256, documentCount: sources.semantic.documents.length, distractorCount: sources.semantic.distractors.length, sameLanguageQueryCount: sources.semantic.sameLanguage.length, crossLanguageQueryCount: sources.semantic.crossLanguage.length, queryControlCount: sources.semantic.prefixControls.queries.length, documentControlCount: sources.semantic.prefixControls.documents.length },
    ann: { fixtureSha256: sources.ann.fixtureSha256, fixture: sources.ann.fixture, flat: sources.ann.flat, configurations: sources.ann.configurations.map((configuration) => ({ id: configuration.id, indexParameters: configuration.indexParameters, queryParameters: configuration.queryParameters, buildMs: configuration.buildMs, openMs: configuration.openMs, coldFirstQueryMs: configuration.coldFirstQueryMs, dataSizeBeforeIndex: configuration.dataSizeBeforeIndex, indexSizeBytes: configuration.indexSizeBytes, indexAndDataSizeBytes: configuration.indexAndDataSizeBytes, latency: configuration.latency, evaluation: configuration.evaluation })) },
    licenses: { generatedFromLockfile: sources.licenses.generatedFromLockfile, packageCount: sources.licenses.packageCount, nativeArtifacts: sources.licenses.nativeArtifacts, modelFixture: sources.licenses.modelFixture, sourceAndSyntheticFixturesLicense: sources.licenses.sourceAndSyntheticFixturesLicense }
  });
}
