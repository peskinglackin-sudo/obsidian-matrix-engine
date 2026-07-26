import { containsNoSpaceScript } from "../analysis/scripts";
import { isCompoundIdentifier } from "../analysis/identifier";
import type { SearchMode } from "../settings/types";
import { hasContentQuery, isMetadataOnly, type SearchQueryAst } from "./ast";

/**
 * QueryPlanner (PRD 7.5).
 *
 * Auto mode picks the pipeline from the AST shape; explicit modes are
 * honored but still degrade visibly when a capability is missing. The
 * executed plan is always reportable to the UI.
 */

export type PipelineCapabilities = Readonly<{
  /** Provider + recipe configured with a confirmed dimension. */
  embeddingReady: boolean;
  /** Lexical index has content. */
  lexicalReady: boolean;
  /** Store has any rows at all. */
  storeReady: boolean;
}>;

export type DegradeReason = "semantic_unavailable" | "lexical_unavailable" | "store_empty";

export type QueryPlan = Readonly<{
  requestedMode: SearchMode;
  runExact: boolean;
  runLexical: boolean;
  runSemantic: boolean;
  /** Multiplier for the semantic fusion weight (Auto short queries use a reduced weight). */
  semanticWeightFactor: number;
  metadataOnly: boolean;
  degraded: readonly DegradeReason[];
  /** Actual executed shape, e.g. "hybrid" or "exact+lexical" (PRD 7.5). */
  executedLabel: string;
}>;

export function planQuery(ast: SearchQueryAst, requestedMode: SearchMode, capabilities: PipelineCapabilities): QueryPlan {
  const mode = ast.modeHint ?? requestedMode;
  const degraded: DegradeReason[] = [];
  if (!capabilities.storeReady) degraded.push("store_empty");

  if (isMetadataOnly(ast)) {
    return finalize(mode, { exact: true, lexical: false, semantic: false }, 1, true, degraded);
  }
  if (!hasContentQuery(ast)) {
    return finalize(mode, { exact: false, lexical: false, semantic: false }, 1, false, degraded);
  }

  let wants: { exact: boolean; lexical: boolean; semantic: boolean };
  let semanticFactor = 1;
  switch (mode) {
    case "exact":
      wants = { exact: true, lexical: false, semantic: false };
      break;
    case "lexical":
      wants = { exact: false, lexical: true, semantic: false };
      break;
    case "semantic":
      wants = { exact: false, lexical: false, semantic: true };
      break;
    case "hybrid":
      wants = { exact: true, lexical: true, semantic: true };
      break;
    case "auto": {
      const shape = classifyQueryShape(ast);
      if (shape === "precise") {
        wants = { exact: true, lexical: true, semantic: false };
      } else if (shape === "short_words") {
        wants = { exact: true, lexical: true, semantic: true };
        semanticFactor = 0.5;
      } else {
        wants = { exact: true, lexical: true, semantic: true };
      }
      break;
    }
  }

  if (wants.semantic && !capabilities.embeddingReady) {
    wants = { ...wants, semantic: false };
    degraded.push("semantic_unavailable");
    if (!wants.exact && !wants.lexical) {
      // Explicit semantic mode with no provider: degrade to exact+lexical (PRD 7.5).
      wants = { exact: true, lexical: true, semantic: false };
    }
  }
  if (wants.lexical && !capabilities.lexicalReady) {
    wants = { ...wants, lexical: false };
    degraded.push("lexical_unavailable");
    if (!wants.exact && !wants.semantic) {
      wants = { exact: true, lexical: false, semantic: capabilities.embeddingReady };
    }
  }

  return finalize(mode, wants, semanticFactor, false, degraded);
}

type QueryShape = "precise" | "short_words" | "question";

function classifyQueryShape(ast: SearchQueryAst): QueryShape {
  if (ast.exactPhrases.length > 0 || ast.fieldClauses.length > 0) return "precise";
  const terms = ast.positiveTerms.map(({ text }) => text);
  if (terms.some((term) => term.includes("/") || term.includes("::") || isCompoundIdentifier(term))) return "precise";
  if (/[?？]/u.test(ast.raw)) return "question";
  const cjkLength = terms.filter((term) => containsNoSpaceScript(term)).reduce((sum, term) => sum + Array.from(term).length, 0);
  if (cjkLength >= 6) return "question";
  if (terms.length <= 3) return "short_words";
  return "question";
}

function finalize(
  requestedMode: SearchMode,
  wants: Readonly<{ exact: boolean; lexical: boolean; semantic: boolean }>,
  semanticWeightFactor: number,
  metadataOnly: boolean,
  degraded: readonly DegradeReason[]
): QueryPlan {
  const parts: string[] = [];
  if (metadataOnly) parts.push("metadata");
  else {
    if (wants.exact) parts.push("exact");
    if (wants.lexical) parts.push("lexical");
    if (wants.semantic) parts.push("semantic");
  }
  const executedLabel = wants.exact && wants.lexical && wants.semantic && !metadataOnly ? "hybrid" : parts.join("+");
  return Object.freeze({
    requestedMode,
    runExact: wants.exact,
    runLexical: wants.lexical,
    runSemantic: wants.semantic,
    semanticWeightFactor,
    metadataOnly,
    degraded: Object.freeze([...degraded]),
    executedLabel: executedLabel.length === 0 ? "none" : executedLabel
  });
}
