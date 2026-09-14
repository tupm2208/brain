/**
 * @file Minimal logging port. Xeon writes to the console; tests capture lines in memory.
 */

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

/** Logs to stdout / stderr. */
export const consoleLogger: Logger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message)
};

/** Discards everything. */
export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined
};

/** Keeps every line in memory so tests can assert on them. */
export class MemoryLogger implements Logger {
  readonly infos: string[] = [];
  readonly warnings: string[] = [];

  info(message: string): void { this.infos.push(message); }
  warn(message: string): void { this.warnings.push(message); }
}
