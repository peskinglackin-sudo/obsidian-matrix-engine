/**
 * Word segmentation (PRD 8.3, 8.4).
 *
 * Uses Intl.Segmenter when available and enabled; otherwise falls back to
 * letter/number run extraction. CJK ngram generation is handled by the
 * analyzer on top of these segments.
 */

export type WordSegment = Readonly<{ text: string; index: number }>;

type SegmenterConstructor = typeof Intl.Segmenter;

const intlSegmenter: SegmenterConstructor | undefined = (Intl as { Segmenter?: SegmenterConstructor }).Segmenter;

let cachedSegmenter: Intl.Segmenter | undefined;

function wordSegmenter(): Intl.Segmenter | undefined {
  if (intlSegmenter === undefined) return undefined;
  cachedSegmenter ??= new intlSegmenter(undefined, { granularity: "word" });
  return cachedSegmenter;
}

export function segmentWords(text: string, useIntlSegmenter: boolean): readonly WordSegment[] {
  const segmenter = useIntlSegmenter ? wordSegmenter() : undefined;
  if (segmenter === undefined) return fallbackSegments(text);

  const segments: WordSegment[] = [];
  for (const segment of segmenter.segment(text)) {
    if (segment.isWordLike !== true) continue;
    segments.push(Object.freeze({ text: segment.segment, index: segment.index }));
  }
  return segments;
}

const WORD_RUN = /[\p{L}\p{N}_]+/gu;

export function fallbackSegments(text: string): readonly WordSegment[] {
  const segments: WordSegment[] = [];
  for (const match of text.matchAll(WORD_RUN)) {
    segments.push(Object.freeze({ text: match[0], index: match.index }));
  }
  return segments;
}
