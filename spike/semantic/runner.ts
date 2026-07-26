import { evaluateSemanticResultSet, semanticResultSetSchema, type SemanticEvaluation } from "./evaluate";
import { buildSemanticFixtures } from "./fixtures";

type Vector = readonly number[];
type EmbeddedItem = Readonly<{ id: string; text: string }>;

export type SemanticWorkload = Readonly<{
  inputs: readonly string[];
  evaluate(vectors: readonly Vector[], metadata: Readonly<{ backend: "cpu" | "vulkan" | "metal"; platform: "windows-x64" | "macos-arm64" | "linux-x64"; modelSha256: string; llamaCommit: string }>): Readonly<{ resultSet: ReturnType<typeof semanticResultSetSchema.parse>; evaluation: SemanticEvaluation }>;
}>;

function dot(left: Vector, right: Vector): number {
  if (left.length !== right.length || left.length === 0) throw new Error("SEMANTIC_VECTOR_SHAPE_INVALID");
  let value = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]; const b = right[index];
    if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) throw new Error("SEMANTIC_VECTOR_VALUE_INVALID");
    value += a * b;
  }
  return value;
}

function rank(queries: readonly EmbeddedItem[], documents: readonly EmbeddedItem[], vectors: ReadonlyMap<string, Vector>) {
  return queries.map((query) => {
    const queryVector = vectors.get(query.id);
    if (queryVector === undefined) throw new Error("SEMANTIC_QUERY_VECTOR_MISSING");
    const rankedTargetIds = documents.map((document) => {
      const documentVector = vectors.get(document.id);
      if (documentVector === undefined) throw new Error("SEMANTIC_DOCUMENT_VECTOR_MISSING");
      return { id: document.id.replace(/-workload$/u, ""), score: dot(queryVector, documentVector) };
    }).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id)).slice(0, 10).map(({ id }) => id);
    return { queryId: query.id.replace(/-workload$/u, ""), rankedTargetIds };
  });
}

export function buildSemanticWorkload(): SemanticWorkload {
  const fixture = buildSemanticFixtures();
  const baselineDocuments: EmbeddedItem[] = [...fixture.documents, ...fixture.distractors].map(({ id, text }) => ({ id: `${id}-workload`, text }));
  const gatingQueries: EmbeddedItem[] = [...fixture.sameLanguage, ...fixture.crossLanguage].map(({ id, text }) => ({ id: `${id}-workload`, text }));
  const queryControls = fixture.prefixControls.queries.map(({ id, sourceId, kind, text }) => ({ id: `${id}-workload`, sourceId, kind, text }));
  const documentControls = fixture.prefixControls.documents.map(({ id, sourceId, kind, text }) => ({ id: `${id}-workload`, sourceId, kind, text }));
  const items: EmbeddedItem[] = [...baselineDocuments, ...gatingQueries, ...queryControls, ...documentControls];
  if (new Set(items.map(({ id }) => id)).size !== items.length) throw new Error("SEMANTIC_WORKLOAD_ID_DUPLICATE");

  return Object.freeze({
    inputs: Object.freeze(items.map(({ text }) => text)),
    evaluate(vectors, metadata) {
      if (vectors.length !== items.length) throw new Error("SEMANTIC_WORKLOAD_VECTOR_COUNT_INVALID");
      const byId = new Map(items.map((item, index) => [item.id, vectors[index] ?? []]));
      const gatingResults = rank(gatingQueries, baselineDocuments, byId);
      const queryControlResults = (kind: "query-prefix-removed" | "query-prefix-swapped") => rank(
        queryControls.filter((control) => control.kind === kind).map((control) => ({ id: `${control.sourceId}-workload`, text: control.text })),
        baselineDocuments,
        new Map([...byId, ...queryControls.filter((control) => control.kind === kind).map((control) => [
          `${control.sourceId}-workload`, byId.get(`${control.id}-workload`) ?? []
        ] as const)])
      );
      const documentControlResults = (kind: "document-prefix-removed" | "document-prefix-swapped") => {
        const controls = documentControls.filter((control) => control.kind === kind);
        const documents = baselineDocuments.map((document) => {
          const sourceId = document.id.replace(/-workload$/u, "");
          const control = controls.find((candidate) => candidate.sourceId === sourceId);
          return control === undefined ? document : { id: document.id, text: control.text };
        });
        const remapped = new Map(byId);
        for (const control of controls) remapped.set(`${control.sourceId}-workload`, byId.get(`${control.id}-workload`) ?? []);
        return rank(gatingQueries, documents, remapped);
      };
      const resultSet = semanticResultSetSchema.parse({
        schemaVersion: 1,
        fixtureSha256: fixture.sha256,
        recipeSha256: fixture.recipeSha256,
        modelSha256: metadata.modelSha256,
        llamaCommit: metadata.llamaCommit,
        backend: metadata.backend,
        platform: metadata.platform,
        gatingResults,
        controls: [
          { kind: "query-prefix-removed", results: queryControlResults("query-prefix-removed") },
          { kind: "query-prefix-swapped", results: queryControlResults("query-prefix-swapped") },
          { kind: "document-prefix-removed", results: documentControlResults("document-prefix-removed") },
          { kind: "document-prefix-swapped", results: documentControlResults("document-prefix-swapped") }
        ]
      });
      return Object.freeze({ resultSet, evaluation: evaluateSemanticResultSet(resultSet) });
    }
  });
}
