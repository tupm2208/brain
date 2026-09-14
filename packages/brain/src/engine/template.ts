/**
 * @file Template rendering with guarded placeholders.
 */

import type { IndustryPack } from "../pack/types";

/**
 * Placeholders that carry DATA. When a template uses one of these and its value is empty, the
 * sentence would be sent with a hole ("Da khung con suat:  a"); the engine must treat that as an error.
 */
export const BASE_DATA_VARS = [
  "tinhtrang", "ton", "gia", "giacao", "kho", "sokho", "bienthe", "chinhsach",
  "madon", "trangthai", "conphaitra", "songay", "link", "dsbienthe"
];

export interface Rendered {
  text: string;
  /** Data placeholders that were empty. A non-empty list means the sentence must not be sent. */
  missing: string[];
}

/** Fills `{placeholders}` and reports the data placeholders left empty. */
export class TemplateRenderer {
  private readonly dataVars: Set<string>;

  /** @param dataVars placeholders considered data; defaults to `BASE_DATA_VARS`. */
  constructor(dataVars?: Iterable<string>) {
    this.dataVars = new Set(dataVars ?? BASE_DATA_VARS);
  }

  render(template: string, vars: Record<string, string>): Rendered {
    const missing: string[] = [];
    const text = template.replace(/\{(\w+)\}/g, (_m, key: string) => {
      const v = vars[key];
      if (v === undefined || (v === "" && this.dataVars.has(key))) missing.push(key);
      return v ?? "";
    });
    return { text: text.replace(/\s{2,}/g, " ").trim(), missing };
  }

  /** Renders a named pack template; an unknown key renders as empty text. */
  renderPackTemplate(pack: IndustryPack, key: string, vars: Record<string, string>): Rendered {
    return this.render(packTemplate(pack, key), vars);
  }
}

/** The text of a pack template, or an empty string when the pack does not define it. */
export function packTemplate(pack: IndustryPack, key: string): string {
  return pack.templates[key] ?? "";
}
