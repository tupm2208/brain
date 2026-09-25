/**
 * @file The `nganh/` folder: the ONLY place industry knowledge is read from disk.
 *
 * Decided 21/09/2026: an industry is a folder of JSON, not a TypeScript file. Opening a new
 * industry must not require a programmer, a build or a redeploy — copy the folder, edit the JSON,
 * restart. Everything the platform knows about one industry sits in `bo-nao/nganh/<id>/`:
 *
 *   bo-luat.json      the chatbot's rules (`IndustryPack` — pronouns, lexicon, axes, intents, gates)
 *   agent.json        the AI salesperson's playbook. ABSENT = the rule engine answers alone
 *   kien-thuc.json    what Xeon knows about the industry's product lines (Đ9 knowledge pack)
 *   line-dna.json     the lines themselves
 *   mau-mac-dinh.json the default sample profiles ("Nạp lại mẫu mặc định")
 *   nghien-cuu.md     the research prompt, named from `kien-thuc.json`
 *
 * `@sp/brain` may not open files (DESIGN.md §1), so the disk lives here and is handed to the core
 * as a `PackSource`. That is also why a missing or broken file must fail LOUDLY on the pack it was
 * asked for: a silent `{}` would turn a typo into a bot that greets and says nothing else.
 */

import fs from "node:fs";
import path from "node:path";
import { usePackSource, type CommonFileName, type PackSource, type RawPackFiles } from "@sp/brain";

/** From `dist/knowledge/` (or `src/knowledge/` under a type-stripping runner) up to `bo-nao/nganh`. */
export const INDUSTRY_DIRECTORY = path.join(__dirname, "..", "..", "..", "..", "nganh");
/**
 * Tier 1's instructions (24/09/2026): `bo-nao/loi-chung/agent-chung.json`, beside `nganh/` and
 * NOT inside it — it is the platform's, not an industry's. Given an industry folder, tier 1 is
 * `<folder>/../loi-chung/`, so a test pointing at a temporary `nganh/` brings its own tier 1 (or none).
 */
export const COMMON_AGENT_FILE = "agent-chung.json";
export function commonAgentPath(industryDirectory: string): string {
  return path.join(industryDirectory, "..", "loi-chung", COMMON_AGENT_FILE);
}
/**
 * Tier 1's other files (24/09/2026, Sales Desk's tier 1 as data): the dialogue frame, the ledger
 * wording and the system note wording. Same folder as `agent-chung.json`; a missing file is empty.
 */
export const COMMON_FILES: Record<CommonFileName, string> = {
  "khung-hoi-thoai": "khung-hoi-thoai.json",
  "so-hoi-thoai": "so-hoi-thoai.json",
  "ghi-chu-he-thong": "ghi-chu-he-thong.json",
  /** LLM#1 context analysis and LLM#3 fallback draft (24/09/2026): Sales Desk's tier-1 prompts as data. */
  "phan-tich-ngu-canh": "phan-tich-ngu-canh.json",
  "soan-nhap": "soan-nhap.json",
  /** Stage 2 of tier 1 (24/09/2026): the intent classifier, the entity extractor and the scripted replies as data. */
  "y-dinh-chung": "y-dinh-chung.json",
  "thuc-the-chung": "thuc-the-chung.json",
  "kich-ban-chung": "kich-ban-chung.json",
  /** Stage 3 (25/09/2026): catalog scoring, the uncertain-product gate and the stock facts as data. */
  "cham-diem-chung": "cham-diem-chung.json",
  /** Stage 6 (25/09/2026): the reply gate after the draft (Desk `enforceReplyEvidence` / `enforcePolicyClaims`) as data. */
  "cong-soat-chung": "cong-soat-chung.json",
  /** GĐ5 / LLM#2 (25/09/2026): the photo-reading prompt and the catalog-verification prompt as data. */
  "xem-anh": "xem-anh.json",
  "xac-nhan-catalog": "xac-nhan-catalog.json"
};
export function commonFilePath(industryDirectory: string, name: CommonFileName): string {
  return path.join(industryDirectory, "..", "loi-chung", COMMON_FILES[name]);
}

/** File names inside an industry folder. They are the operator's contract, so they stay Vietnamese. */
export const INDUSTRY_FILES = {
  rules: "bo-luat.json",
  agent: "agent.json",
  knowledge: "kien-thuc.json",
  lines: "line-dna.json",
  defaultProfiles: "mau-mac-dinh.json",
  /** The industry's part of the dialogue frame / episode config. */
  dialogue: "khung-hoi-thoai.json",
  /** The industry's wording of the system note blocks. */
  systemNote: "ghi-chu-he-thong.json",
  /** The industry's part of the LLM#1 context-analysis prompt. */
  contextAnalysis: "phan-tich-ngu-canh.json",
  /** The industry's rules of the LLM#3 fallback-draft prompt. */
  draft: "soan-nhap.json",
  /** Real exchanges of the industry (customer → person on duty), for the draft's tone. */
  humanExamples: "vi-du-nguoi-truc.json",
  /** Stage 2 (24/09/2026): the industry's intent keywords, entity patterns, tag → size chart and scripted replies. */
  intentRules: "y-dinh.json",
  entities: "thuc-the.json",
  sizeChart: "bang-size.json",
  scripts: "kich-ban.json",
  /** GĐ5 / LLM#2: the industry's part of the photo-reading and catalog-verification prompts. */
  imageRead: "xem-anh.json",
  catalogVerify: "xac-nhan-catalog.json",
  /** Stage 3 (25/09/2026): the industry's catalog-matching words (noise, brand hints, type rules). */
  matching: "cham-diem.json",
  /** Stage 6 (25/09/2026): the industry's part of the reply gate (stock wording, size steps, warranty). */
  replyGate: "cong-soat.json"
} as const;

/** A folder name that is safe to join onto a path: an industry id, never `..` or a drive letter. */
export function isIndustryId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(id);
}

/** Every industry folder that carries a `bo-luat.json`, sorted. An unreadable folder yields none. */
export function industryIds(directory: string = INDUSTRY_DIRECTORY): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((e) => e.isDirectory() && isIndustryId(e.name))
    .map((e) => e.name)
    .filter((id) => fs.existsSync(path.join(directory, id, INDUSTRY_FILES.rules)))
    .sort();
}

/** The path of one file of one industry, or `null` when the id is not a safe folder name. */
export function industryFile(directory: string, id: string, file: string): string | null {
  return isIndustryId(id) ? path.join(directory, id, file) : null;
}

/** Parsed JSON of an industry file. `null` when the file is absent; throws when it is broken. */
export function readIndustryJson(directory: string, id: string, file: string): unknown {
  const full = industryFile(directory, id, file);
  if (full === null || !fs.existsSync(full)) return null;
  const raw = fs.readFileSync(full, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    // Naming the file is the whole point: "Unexpected token }" with no path is unfixable for the
    // person who edited it.
    throw new Error(`Tep "${full}" khong phai JSON hop le: ${(error as Error).message}`);
  }
}

/** Text of an industry file (a research prompt), or "" when it is absent. */
export function readIndustryText(directory: string, id: string, file: string): string {
  const full = industryFile(directory, id, file);
  if (full === null) return "";
  try { return fs.readFileSync(full, "utf8"); } catch { return ""; }
}

/**
 * The brain's `PackSource`, backed by the `nganh/` folder.
 *
 * It re-reads on every miss and the registry caches the parsed result, so editing JSON and
 * restarting is enough; nothing is copied into `dist/`.
 */
export class DiskPackSource implements PackSource {
  constructor(private readonly directory: string = INDUSTRY_DIRECTORY) {}

  /** The folder this source reads, for the start-up log and the admin screen. */
  get path(): string {
    return this.directory;
  }

  ids(): string[] {
    return industryIds(this.directory);
  }

  read(id: string): RawPackFiles | null {
    const rules = readIndustryJson(this.directory, id, INDUSTRY_FILES.rules);
    if (rules === null) return null;
    const agent = readIndustryJson(this.directory, id, INDUSTRY_FILES.agent);
    const dialogue = readIndustryJson(this.directory, id, INDUSTRY_FILES.dialogue);
    const systemNote = readIndustryJson(this.directory, id, INDUSTRY_FILES.systemNote);
    const contextAnalysis = readIndustryJson(this.directory, id, INDUSTRY_FILES.contextAnalysis);
    const draft = readIndustryJson(this.directory, id, INDUSTRY_FILES.draft);
    const humanExamples = readIndustryJson(this.directory, id, INDUSTRY_FILES.humanExamples);
    const intentRules = readIndustryJson(this.directory, id, INDUSTRY_FILES.intentRules);
    const entities = readIndustryJson(this.directory, id, INDUSTRY_FILES.entities);
    const sizeChart = readIndustryJson(this.directory, id, INDUSTRY_FILES.sizeChart);
    const scripts = readIndustryJson(this.directory, id, INDUSTRY_FILES.scripts);
    const matching = readIndustryJson(this.directory, id, INDUSTRY_FILES.matching);
    const lines = readIndustryJson(this.directory, id, INDUSTRY_FILES.lines);
    const replyGate = readIndustryJson(this.directory, id, INDUSTRY_FILES.replyGate);
    const imageRead = readIndustryJson(this.directory, id, INDUSTRY_FILES.imageRead);
    const catalogVerify = readIndustryJson(this.directory, id, INDUSTRY_FILES.catalogVerify);
    return {
      rules,
      ...(agent === null ? {} : { agent }),
      ...(dialogue === null ? {} : { dialogue }),
      ...(systemNote === null ? {} : { systemNote }),
      ...(contextAnalysis === null ? {} : { contextAnalysis }),
      ...(draft === null ? {} : { draft }),
      ...(humanExamples === null ? {} : { humanExamples }),
      ...(intentRules === null ? {} : { intentRules }),
      ...(entities === null ? {} : { entities }),
      ...(sizeChart === null ? {} : { sizeChart }),
      ...(scripts === null ? {} : { scripts }),
      ...(matching === null ? {} : { matching }),
      ...(lines === null ? {} : { lines }),
      ...(replyGate === null ? {} : { replyGate }),
      ...(imageRead === null ? {} : { imageRead }),
      ...(catalogVerify === null ? {} : { catalogVerify })
    };
  }

  /** Tier 1's JSON, or `null` when the file is absent; a broken file throws with its path. */
  common(): unknown {
    return readCommonJson(commonAgentPath(this.directory));
  }

  /** Another tier 1 file, or `null` when absent; a broken file throws with its path. */
  commonFile(name: CommonFileName): unknown {
    return readCommonJson(commonFilePath(this.directory, name));
  }
}

function readCommonJson(full: string): unknown {
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (error) {
    throw new Error(`Tep "${full}" khong phai JSON hop le: ${(error as Error).message}`);
  }
}

/**
 * Tells the brain to read its packs from `directory` (empty = the folder that ships).
 *
 * Every entry point calls this before anything can ask for a pack: the server, the video service
 * and the `chan-doan` CLI, which replays a turn with a pack of its own choosing. Returns the
 * folder, so the caller can say in its log where the industries came from.
 */
export function installIndustryPacks(directory = ""): string {
  const resolved = directory.trim() || INDUSTRY_DIRECTORY;
  usePackSource(new DiskPackSource(resolved));
  return resolved;
}
