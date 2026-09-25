/**
 * Shared fixtures of the stage-3 tests (catalog scoring, resolver, uncertain gate, focus, stock facts):
 * a few `catalog.find` items shaped like the landing returns them, the shoe pack's matching data and lines.
 */

import fs from "node:fs";
import path from "node:path";
import * as B from "@sp/brain";
import "./fixtures.mts";

export const cfg = B.loadMatchingConfig("giay-chay");
export const pack = B.loadPack("giay-chay");

const lineFile = ((): string => {
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    const candidate = path.join(dir, "nganh", "giay-chay", "line-dna.json");
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error("Khong tim thay line-dna.json tu " + process.cwd());
})();
export const lines = (JSON.parse(fs.readFileSync(lineFile, "utf8")) as { lines: B.CascadeLine[] }).lines;

export const scorer = new B.CatalogScorer(cfg, lines, pack.lexicon.brands);

export const size = (label: string, over: Partial<B.FoundSize> = {}): B.FoundSize => ({ size: label, gia: 3190000, so_luong: 2, kho: "K1", loai: "HANG SAN", ...over });
export const item = (ma: string, ten: string, sizes: B.FoundSize[], over: Partial<B.FoundItem> = {}): B.FoundItem => ({ ma, ten, cac_size: sizes, anh: "", link: `https://shop.example/product/${ma}`, ...over });

export const BOSTON13 = item("JS4955", "ADIZERO BOSTON 13 M", [size("41"), size("42"), size("42 2/3", { kho: "K2", gia: 2990000, so_luong: 3 })]);
export const BOSTON13_DEN = item("IF9414", "ADIZERO BOSTON 13 M den", [size("42"), size("43")]);
export const BOSTON12 = item("IH5748", "ADIZERO BOSTON 12 M", [size("42"), size("43")]);
export const ADIOS9 = item("JQ0764", "ADIZERO ADIOS 9 M", [size("42"), size("44")]);
export const ADIOS_PRO4 = item("IG8054", "ADIZERO ADIOS PRO 4 M", [size("42"), size("43")]);
export const EKIDEN = item("HZ1234", "Ao chay bo Adizero Ekiden", [size("S"), size("M"), size("L")]);
export const NO_BRAND = item("XR0001", "XYZ RUNNER 9", [size("42")]);

export const ALL = [BOSTON13, BOSTON13_DEN, BOSTON12, ADIOS9, ADIOS_PRO4, EKIDEN, NO_BRAND];

export const query = (over: Partial<B.CatalogQuery>): B.CatalogQuery => B.emptyCatalogQuery(over);

/** The ask-back filler a caller would build on `RuleRouter.fillHoiLai`: the shop's pronouns plus the gate's variables. */
export function hoiLaiFiller(vars: Record<string, string> = {}): (key: string, extra: Record<string, string>) => string | null {
  const texts = B.loadScriptTexts("giay-chay").hoiLai;
  return (key, extra) => {
    const text = texts[key];
    if (text === undefined) return null;
    const all: Record<string, string> = { khach: "bác", Khach: "Bác", shop: "em", ...vars, ...extra };
    let missing = false;
    const out = text.replace(/\{([A-Za-z0-9_.]+)\}/g, (_m, k: string) => { const v = all[k] ?? ""; if (v === "") missing = true; return v; });
    return missing ? null : out;
  };
}
