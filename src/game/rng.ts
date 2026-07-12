import type { RngState } from "./types";

const UINT32_RANGE = 0x1_0000_0000;
const NON_ZERO_FALLBACK = 0x9e37_79b9;

/** Stable FNV-1a hash so a human-readable seed produces the same run everywhere. */
export function hashSeed(seed: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  const unsigned = hash >>> 0;
  return unsigned === 0 ? NON_ZERO_FALLBACK : unsigned;
}

export function createRng(seed = "dungeon-crawl"): RngState {
  return { seed, state: hashSeed(seed), draws: 0 };
}

/** Pure xorshift32 step. */
export function nextRandom(rng: RngState): { rng: RngState; value: number } {
  let value = rng.state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  value >>>= 0;
  if (value === 0) value = NON_ZERO_FALLBACK;
  return {
    rng: { ...rng, state: value, draws: rng.draws + 1 },
    value: value / UINT32_RANGE,
  };
}

export function rollD6(rng: RngState): { rng: RngState; roll: number } {
  const result = nextRandom(rng);
  return { rng: result.rng, roll: Math.floor(result.value * 6) + 1 };
}

export function shuffleWithRng<T>(
  items: readonly T[],
  rng: RngState,
): { items: T[]; rng: RngState } {
  const shuffled = [...items];
  let nextRng = rng;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const result = nextRandom(nextRng);
    nextRng = result.rng;
    const swapIndex = Math.floor(result.value * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return { items: shuffled, rng: nextRng };
}
