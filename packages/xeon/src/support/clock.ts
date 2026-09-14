/**
 * @file Clock port. Every timestamp in Xeon comes from here so tests can move time.
 */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock tests can advance by hand. */
export class ManualClock implements Clock {
  private current: number;

  constructor(start: Date) {
    this.current = start.getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  /** Moves the clock forward by `ms` milliseconds. */
  advance(ms: number): void {
    this.current += ms;
  }
}
