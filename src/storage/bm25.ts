/**
 * Field-scoped inverted index with BM25 scoring (PRD 15.3).
 *
 * Each lexical field keeps its own postings and length statistics; query
 * scores combine per-field BM25 with retrieval-profile weights (a
 * simplified BM25F). Term frequency comes from duplicated analyzer terms.
 */

const K1 = 1.2;
const B = 0.75;

type Postings = Map<string, Map<string, number>>;

export class FieldIndex {
  readonly #postings: Postings = new Map();
  readonly #lengths = new Map<string, number>();
  #totalLength = 0;

  addDocument(docId: string, terms: readonly string[]): void {
    this.removeDocument(docId);
    if (terms.length === 0) return;
    for (const term of terms) {
      let posting = this.#postings.get(term);
      if (posting === undefined) {
        posting = new Map<string, number>();
        this.#postings.set(term, posting);
      }
      posting.set(docId, (posting.get(docId) ?? 0) + 1);
    }
    this.#lengths.set(docId, terms.length);
    this.#totalLength += terms.length;
  }

  removeDocument(docId: string): void {
    const length = this.#lengths.get(docId);
    if (length === undefined) return;
    this.#lengths.delete(docId);
    this.#totalLength -= length;
    for (const [term, posting] of this.#postings) {
      if (posting.delete(docId) && posting.size === 0) this.#postings.delete(term);
    }
  }

  clear(): void {
    this.#postings.clear();
    this.#lengths.clear();
    this.#totalLength = 0;
  }

  get documentCount(): number {
    return this.#lengths.size;
  }

  documentsWithTerm(term: string): ReadonlyMap<string, number> | undefined {
    return this.#postings.get(term);
  }

  /**
   * Accumulate BM25 contributions for the given terms into `scores`.
   * Returns the terms that matched at least one document.
   */
  score(terms: readonly string[], weight: number, scores: Map<string, number>, matched?: Map<string, Set<string>>): readonly string[] {
    const documentCount = this.#lengths.size;
    if (documentCount === 0 || weight <= 0) return [];
    const averageLength = this.#totalLength / documentCount;
    const matchedTerms: string[] = [];
    for (const term of new Set(terms)) {
      const posting = this.#postings.get(term);
      if (posting === undefined) continue;
      matchedTerms.push(term);
      const idf = Math.log(1 + (documentCount - posting.size + 0.5) / (posting.size + 0.5));
      for (const [docId, tf] of posting) {
        const length = this.#lengths.get(docId) ?? averageLength;
        const denominator = tf + K1 * (1 - B + (B * length) / averageLength);
        const contribution = weight * idf * ((tf * (K1 + 1)) / denominator);
        scores.set(docId, (scores.get(docId) ?? 0) + contribution);
        if (matched !== undefined) {
          let set = matched.get(docId);
          if (set === undefined) {
            set = new Set<string>();
            matched.set(docId, set);
          }
          set.add(term);
        }
      }
    }
    return matchedTerms;
  }
}
