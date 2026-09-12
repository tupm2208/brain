// DAU DAY PHIA BO NAO — dong khung, gui di, cho ket qua.
//
// Day la mot `ToolPort` nhu moi `ToolPort` khac, nen bo may khong biet minh dang goi
// qua mang hay goi mot cua gia trong bai kiem tra. Do la ly do `ports` ton tai.
//
// BA dieu khac vao day:
//
// 1. HET GIO PHAI LA MOT CAU TRA LOI, khong phai mot loi hua treo mai. Bot cho mot cua
//    khong bao gio tra loi la khach ngoi nhin man hinh "dang soan tin" den luc bo di.
// 2. MAT DUONG thi `online()` tra ve sai, va bo may co san che do han che cho viec do:
//    van chao khach, khong khang dinh ton kho. Tha im ve con so con hon noi sai.
// 3. MOI luot goi mang theo ma hoi thoai. Phia OMI coi no la mot cai CONG.

import {
  LINK_PROTOCOL_VERSION, kiemOutput, linkError, parseLinkFrame,
  type CallFrame, type LinkFrame, type ResultFrame, type ToolInput, type ToolName,
  type ToolOutput, type ActorId
} from "@sp/contract";
import { randomUUID } from "node:crypto";
import type { CallCtx, ToolPort, ToolResult } from "../ports/index";

/** Duong ong hai chieu. Bo may khong biet ben duoi la mang, ong trong bo nho, hay gi khac. */
export interface Kenh {
  gui(frame: LinkFrame): void;
  /** Dang ky nguoi nghe. Tra ve ham go dang ky. */
  nghe(fn: (frame: LinkFrame) => void): () => void;
}

export interface CauHinhGoi {
  kenh: Kenh;
  sessionId: string;
  actor: ActorId;
  /** Cong cu Xeon da cap trong khung `welcome`. */
  tools: ToolName[];
  timeoutMs?: number | undefined;
  /** Duong con song khong. Mat duong thi bo may chuyen sang che do han che. */
  online?: (() => boolean) | undefined;
  now?: (() => number) | undefined;
}

interface DangCho {
  tool: ToolName;
  xong: (f: ResultFrame) => void;
  dongHo: NodeJS.Timeout;
}

export function taoToolPort(cfg: CauHinhGoi): ToolPort & { dong(): void } {
  const cho = new Map<string, DangCho>();
  let dem = 0;
  let daDong = false;
  const han = cfg.timeoutMs ?? 15_000;
  // Ma luot goi phai DUY NHAT theo CUA, khong chi theo phien. Hai cua cung mot ma phien
  // (hoac noi lai giu nguyen ma phien, bo dem ve 0) la khung ket qua cua lot cu tra vao
  // nguoi dang cho o luot moi — bot doc cho khach con so ton cua mot luot da bo.
  const tienTo = randomUUID();

  const goDangKy = cfg.kenh.nghe((f) => {
    if (daDong) return;
    // Du lieu tu mang la du lieu la — KIEM truoc, khong nhin moi truong `t`. Mot khung
    // `result` hong lam `data.rows.filter` nem o tang duoi va ca luot tin chet.
    const kiem = parseLinkFrame(f);
    if (!kiem.ok || kiem.frame.t !== "result") return;
    const r = kiem.frame;
    const doi = cho.get(r.id);
    if (doi === undefined) return;
    // Luot goi cua PHIEN KHAC khong duoc tra vao cho nguoi dang cho o phien nay.
    if (r.sessionId !== cfg.sessionId) return;
    cho.delete(r.id);
    clearTimeout(doi.dongHo);
    if (r.ok) {
      const loi = kiemOutput(doi.tool, r.data);
      if (loi !== null) {
        doi.xong({
          t: "result", v: LINK_PROTOCOL_VERSION, id: r.id, sessionId: cfg.sessionId, ok: false,
          error: linkError("internal", `Ket qua "${doi.tool}" sai hinh dang: ${loi}.`)
        });
        return;
      }
    }
    doi.xong(r);
  });

  return {
    available: () => [...cfg.tools],
    online: () => (cfg.online ?? (() => true))(),
    dong: () => {
      daDong = true;
      goDangKy();
      for (const [id, doi] of cho) {
        clearTimeout(doi.dongHo);
        doi.xong({
          t: "result", v: LINK_PROTOCOL_VERSION, id, sessionId: cfg.sessionId, ok: false,
          error: linkError("omi_offline", "Duong noi toi may shop da dong.")
        });
      }
      cho.clear();
    },

    async call<K extends ToolName>(
      tool: K, input: ToolInput<K>, nguCanh?: CallCtx | undefined
    ): Promise<ToolResult<K>> {
      if (daDong) {
        return { ok: false, tool, error: linkError("omi_offline", "Duong noi toi may shop da dong.") };
      }
      if (!this.online()) {
        return { ok: false, tool, error: linkError("omi_offline", "May shop dang khong noi duoc.") };
      }
      dem += 1;
      const id = `${tienTo}-${dem}`;
      const frame: CallFrame<K> = {
        t: "call",
        v: LINK_PROTOCOL_VERSION,
        id,
        sessionId: cfg.sessionId,
        tool,
        input,
        actor: cfg.actor,
        timeoutMs: han,
        ...(nguCanh?.conversationId === undefined
          ? {}
          : { conversationId: nguCanh.conversationId }),
        ...(nguCanh?.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: nguCanh.idempotencyKey })
      };

      const ra = await new Promise<ResultFrame>((xong) => {
        // Het gio la MOT CAU TRA LOI. Khong co dong ho nay thi mot luot goi that lac
        // se treo mai, va khach ngoi nhin "dang soan tin" den luc bo di.
        const dongHo = setTimeout(() => {
          cho.delete(id);
          cfg.kenh.gui({
            t: "cancel", v: LINK_PROTOCOL_VERSION, id, sessionId: cfg.sessionId,
            reason: "het gio"
          });
          xong({
            t: "result", v: LINK_PROTOCOL_VERSION, id, sessionId: cfg.sessionId, ok: false,
            error: linkError("omi_offline", `May shop khong tra loi trong ${han}ms.`)
          });
        }, han);
        cho.set(id, { tool, xong, dongHo });
        try {
          cfg.kenh.gui(frame);
        } catch (e) {
          cho.delete(id);
          clearTimeout(dongHo);
          xong({
            t: "result", v: LINK_PROTOCOL_VERSION, id, sessionId: cfg.sessionId, ok: false,
            error: linkError("omi_offline", String((e as Error)?.message ?? e))
          });
        }
      });

      return ra.ok
        ? { ok: true, tool, data: ra.data as ToolOutput<K> }
        : { ok: false, tool, error: ra.error };
    }
  };
}
