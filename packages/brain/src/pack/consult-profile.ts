/**
 * @file The SHAPE of "the consultation profile" (05/10/2026, phiếu Desk nhóm NHU CẦU / TƯ VẤN).
 *
 * Tier 1 owns the mechanism: WHEN the bot may ask the questions that pick an item for a need (only when
 * the customer has not named an item and the need is one that needs them), WHAT is already known (read
 * from the customer's lines of the session, or inferred), WHAT the page already asked (each piece is
 * asked at most once a session), and that an everyday need is answered with the everyday groups.
 * Tier 2 owns every word: the needs of the industry (a specialist need and the pieces it needs; an everyday need needs
 * nothing), how customers say them, how a page asks for them, and the inferences (words that already
 * give a piece). The data lives in `nganh/<id>/thuc-the.json`
 * under `hoSoTuVan`; an industry without that block has no consultation profile at all.
 *
 * A pharmacy would declare "a child's cold medicine" needing the age and the weight; a cosmetics shop
 * "skin care" needing the skin type. Nothing here knows which.
 */

/** "chuyen-mon": a need that needs its profile before items are offered; "pho-thong": an everyday need, offered by groups. */
export type ConsultNeedKind = "chuyen-mon" | "pho-thong";

/** One piece of the profile (an age, a weight, a skin type...). */
export interface ConsultField {
  id: string;
  /** What the customer calls it — said in the note. */
  name: string;
  /** Regex (accent-stripped, lower case) on the customer's lines: the piece is GIVEN. The match is what was said. */
  read: string;
  /** Regex (accent-stripped) on a page line / a draft sentence: it ASKS for this piece. */
  ask: string;
  /** Needed before items are offered. `false` = asked only when convenient, never blocks. */
  required: boolean;
  /** Key of LLM#1's `needBrief` that carries the same piece ("" = none): a value there counts as given. */
  fromAnalysis: string;
  /** The axis of the industry's line matrices this piece scores ("" = none). Data key, read by the line scorer. */
  axis: string;
}

/** Words that GIVE pieces ("a newborn" = the age is known), unless a counter-sign is there. */
export interface ConsultInference {
  id: string;
  /** Regex (accent-stripped) on the customer's session lines. */
  when: string;
  /** Regex: a sign that cancels the inference ("race", "10km"). "" = none. */
  unless: string;
  /** Field id → what is now known: the text said back, and the matrix band when it maps to one. */
  sets: Record<string, { said: string; band: string }>;
}

export interface ConsultNeed {
  id: string;
  name: string;
  kind: ConsultNeedKind;
  /** Regex (accent-stripped) on the customer's session lines: the customer has THIS need. "" = only via `groups`. */
  when: string;
  /** The storefront groups (the industry's `nhomHang` labels) whose words also say this need — no second word list. */
  groups: string[];
  fields: ConsultField[];
  inferences: ConsultInference[];
  /** "pho-thong": the finder's purpose value for the everyday search (a tool argument, tier 2). */
  purpose: string;
}

export interface ConsultProfileConfig {
  needs: ConsultNeed[];
  /** Regex (accent-stripped) on a page line / a draft sentence: it asks WHICH need the customer has. */
  askNeed: string;
  /** Regex of spans removed from the customer's lines before the pieces are read (a size, an amount of money). */
  strip: string;
  /** How many customer lines back (within the session) are read. */
  history: number;
}

export function emptyConsultProfileConfig(): ConsultProfileConfig {
  return { needs: [], askNeed: "", strip: "", history: 0 };
}

const KINDS: Record<string, ConsultNeedKind> = { "chuyen-mon": "chuyen-mon", "pho-thong": "pho-thong" };

/**
 * Reads `thuc-the.json` → `hoSoTuVan`. No block = no profile (empty config, no problem).
 * Returns the problems instead of throwing, so the registry reports them with the industry's id.
 */
export function parseConsultProfile(raw: unknown, where: string): { config: ConsultProfileConfig; problems: string[] } {
  const problems: string[] = [];
  const config = emptyConsultProfileConfig();
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) return { config, problems };
  const block = (raw as Record<string, unknown>)["hoSoTuVan"];
  if (block === undefined || block === null) return { config, problems };
  if (typeof block !== "object" || Array.isArray(block)) return { config, problems: [`\`${where}.hoSoTuVan\` phai la mot khoi { }.`] };
  const o = block as Record<string, unknown>;
  const str = (v: unknown, at: string, optional = true): string => {
    if (v === undefined || v === null) { if (!optional) problems.push(`\`${at}\` thieu.`); return ""; }
    if (typeof v !== "string") { problems.push(`\`${at}\` phai la chu.`); return ""; }
    return v.trim();
  };
  const regex = (v: unknown, at: string, optional = true): string => {
    const s = str(v, at, optional);
    if (s !== "") { try { new RegExp(s); } catch { problems.push(`\`${at}\` khong phai bieu thuc chinh quy hop le.`); return ""; } }
    return s;
  };
  const list = (v: unknown, at: string): unknown[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) { problems.push(`\`${at}\` phai la mot danh sach.`); return []; }
    return v;
  };
  const isBlock = (v: unknown, at: string): v is Record<string, unknown> => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) { problems.push(`\`${at}\` phai la mot khoi { }.`); return false; }
    return true;
  };
  config.askNeed = regex(o["hoiNhuCau"], `${where}.hoSoTuVan.hoiNhuCau`);
  config.strip = regex(o["boTruoc"], `${where}.hoSoTuVan.boTruoc`);
  const history = o["soTinDoc"];
  if (history !== undefined && (typeof history !== "number" || !Number.isInteger(history) || history < 1)) problems.push(`\`${where}.hoSoTuVan.soTinDoc\` phai la so nguyen duong.`);
  config.history = typeof history === "number" && Number.isInteger(history) && history > 0 ? history : 12;
  const ids = new Set<string>();
  list(o["nhom"], `${where}.hoSoTuVan.nhom`).forEach((entry, i) => {
    const at = `${where}.hoSoTuVan.nhom[${i}]`;
    if (!isBlock(entry, at)) return;
    const kind = KINDS[str(entry["kieu"], `${at}.kieu`, false)];
    if (kind === undefined) { problems.push(`\`${at}.kieu\` phai la "chuyen-mon" hoac "pho-thong".`); return; }
    const id = str(entry["id"], `${at}.id`, false);
    if (id !== "" && ids.has(id)) problems.push(`\`${at}.id\` "${id}" bi trung.`);
    ids.add(id);
    const need: ConsultNeed = {
      id, name: str(entry["ten"], `${at}.ten`, false), kind,
      when: regex(entry["khi"], `${at}.khi`),
      groups: list(entry["nhomHang"], `${at}.nhomHang`).map((g) => String(g ?? "").trim()).filter((g) => g !== ""),
      fields: [], inferences: [],
      purpose: str(entry["mucDich"], `${at}.mucDich`)
    };
    if (need.when === "" && need.groups.length === 0) problems.push(`\`${at}\` can \`khi\` hoac \`nhomHang\` de nhan ra nhu cau.`);
    if (kind === "pho-thong" && need.purpose === "") problems.push(`\`${at}.mucDich\` thieu (nhu cau pho thong tra kho theo muc dich).`);
    const fieldIds = new Set<string>();
    list(entry["truong"], `${at}.truong`).forEach((f, j) => {
      const fat = `${at}.truong[${j}]`;
      if (!isBlock(f, fat)) return;
      const field: ConsultField = {
        id: str(f["id"], `${fat}.id`, false), name: str(f["ten"], `${fat}.ten`, false),
        read: regex(f["doc"], `${fat}.doc`, false), ask: regex(f["hoi"], `${fat}.hoi`, false),
        required: f["batBuoc"] !== false,
        fromAnalysis: str(f["tuPhanTich"], `${fat}.tuPhanTich`), axis: str(f["maTran"], `${fat}.maTran`)
      };
      if (field.id !== "" && fieldIds.has(field.id)) problems.push(`\`${fat}.id\` "${field.id}" bi trung.`);
      fieldIds.add(field.id);
      need.fields.push(field);
    });
    if (kind === "pho-thong" && need.fields.length > 0) problems.push(`\`${at}.truong\`: nhu cau pho thong khong hoi ho so.`);
    list(entry["suyRa"], `${at}.suyRa`).forEach((s, j) => {
      const sat = `${at}.suyRa[${j}]`;
      if (!isBlock(s, sat)) return;
      const sets: Record<string, { said: string; band: string }> = {};
      const raw = s["dat"];
      if (!isBlock(raw, `${sat}.dat`)) return;
      for (const [fid, v] of Object.entries(raw)) {
        if (fid.startsWith("_")) continue;
        if (!fieldIds.has(fid)) { problems.push(`\`${sat}.dat\`: khong co truong "${fid}" trong \`truong\`.`); continue; }
        if (!isBlock(v, `${sat}.dat.${fid}`)) continue;
        sets[fid] = { said: str(v["noi"], `${sat}.dat.${fid}.noi`, false), band: str(v["maTran"], `${sat}.dat.${fid}.maTran`) };
      }
      need.inferences.push({ id: str(s["id"], `${sat}.id`, false), when: regex(s["khi"], `${sat}.khi`, false), unless: regex(s["tru"], `${sat}.tru`), sets });
    });
    config.needs.push(need);
  });
  if (config.needs.some((n) => n.fields.length > 0) && config.askNeed === "") problems.push(`\`${where}.hoSoTuVan.hoiNhuCau\` thieu (cau page hoi nhu cau).`);
  return { config, problems };
}
