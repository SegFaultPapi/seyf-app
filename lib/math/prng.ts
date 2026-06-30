/**
 * Mulberry32 is a fast, seedable 32-bit pseudo-random number generator.
 * It provides excellent distribution quality for Monte Carlo simulations.
 */
export function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * SeededRandom provides reproducible random numbers, including standard
 * normally distributed numbers Z ~ N(0, 1) via the Box-Muller transform.
 */
export class SeededRandom {
  private nextRand: () => number;

  constructor(seed: number) {
    this.nextRand = mulberry32(seed);
  }

  /**
   * Returns a uniformly distributed pseudo-random number in [0, 1)
   */
  next(): number {
    return this.nextRand();
  }

  /**
   * Returns a normally distributed pseudo-random number Z ~ N(0, 1)
   * using the Box-Muller transform.
   */
  nextNormal(): number {
    let u = 0;
    let v = 0;
    // Box-Muller cannot take the natural log of 0, so we skip 0 values.
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }
}
