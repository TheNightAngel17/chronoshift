// Shared bucket color helpers (BUILD_PLAN §5.4).
//
// `buckets.color` is nullable: when null the effective color is inherited from
// the nearest ancestor that has one, and when no ancestor has one either it
// falls back to a deterministic color derived from the bucket id. Both the
// main process (`BucketsRepository.resolveColor`) and the renderer's bucket
// tree editor need that fallback, so it lives here rather than in either.
//
// This file must be importable from both the main process and the renderer:
// no Node APIs (fs, path, electron, ...) and no DOM APIs.

/** Stable, evenly spread color for a bucket that has no color of its own (§5.4). */
export function deriveDeterministicBucketColor(id: number): string {
  const hue = Math.abs(Math.imul(id, 137)) % 360
  return `hsl(${hue} 60% 50%)`
}
