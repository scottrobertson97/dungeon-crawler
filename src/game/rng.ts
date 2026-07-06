export function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 1;
}

export function nextRandomState(state: number): number {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}

export function randomFloat(state: number): { state: number; value: number } {
  const next = nextRandomState(state);
  return {
    state: next,
    value: next / 0x100000000
  };
}

export function randomInt(state: number, min: number, max: number): { state: number; value: number } {
  const result = randomFloat(state);
  return {
    state: result.state,
    value: Math.floor(result.value * (max - min + 1)) + min
  };
}

export function shuffleWithState<T>(items: T[], state: number): { state: number; items: T[] } {
  const copy = [...items];
  let nextState = state;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const roll = randomInt(nextState, 0, index);
    nextState = roll.state;
    [copy[index], copy[roll.value]] = [copy[roll.value], copy[index]];
  }
  return { state: nextState, items: copy };
}
