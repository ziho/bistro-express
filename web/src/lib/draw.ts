/** Unbiased random index in [0, n) using crypto randomness (rejection sampling). */
export function randomIndex(n: number): number {
  if (n <= 0) throw new Error('empty');
  const max = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const v = buf[0]!;
    if (v < max) return v % n;
  }
}

/** Uniform draw among de-duplicated candidates. Each draw is independent and may repeat. */
export function drawOne(candidateIds: readonly string[]): string | null {
  const unique = [...new Set(candidateIds)];
  if (unique.length === 0) return null;
  return unique[randomIndex(unique.length)] ?? null;
}
