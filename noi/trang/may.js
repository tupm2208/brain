// Trang quan ly may cua chu key — key la thu xac thuc, khong co phien.
"use strict";

(function () {
  const el = (id) => document.getElementById(id);
  const ngay = (iso) => (iso ? new Date(iso).toLocaleString("vi-VN") : "—");
  let choXacNhan = "";

  async function goi(duong, than) {
    const tl = await fetch(duong, { method: "POST", headers: { "Content-Type": "application/json", "X-Yeu-Cau": "xeon" }, body: JSON.stringify(than) });
    const d = await tl.json().catch(() => ({ ok: false, error: "khong_doc_duoc" }));
    return { ma: tl.status, ...d };
  }
  function bao(chu, loai) {
    el("bao").innerHTML = "";
    if (!chu) return;
    const p = document.createElement("div"); p.className = `bao ${loai || "loi"}`; p.textContent = chu; el("bao").appendChild(p);
  }
  const key = () => el("key").value.trim().toUpperCase();

  function ve(d) {
    el("khu-may").hidden = false;
    el("ten-shop").textContent = d.tenShop;
    el("dem").textContent = `${d.may.length}/${d.soMay} máy${d.trangThai !== "dang_dung" ? ` · key ${d.trangThai === "het_han" ? "hết hạn" : "bị khoá"}` : ""}`;
    const b = el("bang-may");
    b.innerHTML = "";
    if (d.may.length === 0) { const tr = document.createElement("tr"); const td = document.createElement("td"); td.colSpan = 6; td.className = "mo"; td.textContent = "Chưa máy nào nhập key."; tr.appendChild(td); b.appendChild(tr); }
    for (const m of d.may) {
      const tr = document.createElement("tr");
      const o = (chu) => { const td = document.createElement("td"); if (chu instanceof Node) td.appendChild(chu); else td.textContent = chu; tr.appendChild(td); };
      o(m.tenMay); const c = document.createElement("code"); c.textContent = m.id; o(c);
      o(ngay(m.ghepLuc)); o(ngay(m.kiemLuc));
      const t = document.createElement("span"); t.className = `nhan ${m.truc ? "xanh" : ""}`; t.textContent = m.truc ? "máy trực" : "—"; o(t);
      const td = document.createElement("td");
      if (!m.truc) { const n1 = document.createElement("button"); n1.textContent = "Đặt làm máy trực"; n1.className = "nut-truc"; n1.dataset.may = m.id; td.appendChild(n1); td.appendChild(document.createTextNode(" ")); }
      const n2 = document.createElement("button"); n2.textContent = "Bỏ máy này"; n2.className = "nut-da nguy"; n2.dataset.may = m.id; td.appendChild(n2);
      tr.appendChild(td);
      b.appendChild(tr);
    }
  }

  async function xem() {
    bao("");
    if (!/^TR-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key())) { el("khu-may").hidden = true; return bao("Key phải có dạng TR-XXXX-XXXX-XXXX-XXXX."); }
    const d = await goi("/may/api/xem", { key: key() });
    if (!d.ok) { el("khu-may").hidden = true; return bao(d.ma === 429 ? "Gọi quá nhiều, chờ 15 phút." : "Không có key này."); }
    ve(d);
  }

  el("nut-xem").addEventListener("click", xem);
  el("key").addEventListener("keydown", (e) => { if (e.key === "Enter") xem(); });

  el("bang-may").addEventListener("click", async (e) => {
    const truc = e.target.closest(".nut-truc");
    const da = e.target.closest(".nut-da");
    if (truc) {
      const d = await goi("/may/api/truc", { key: key(), mayId: truc.dataset.may });
      if (!d.ok) return bao(d.viSao || d.error);
      bao("Đã đổi máy trực. Máy mới bắt đầu trực trong vòng 5 phút.", "ok");
      return xem();
    }
    if (da) {
      if (choXacNhan !== da.dataset.may) { choXacNhan = da.dataset.may; da.textContent = "Bấm lần nữa để bỏ"; return; }
      choXacNhan = "";
      const d = await goi("/may/api/da", { key: key(), mayId: da.dataset.may });
      if (!d.ok) return bao(d.viSao || d.error);
      bao("Đã bỏ máy.", "ok");
      return xem();
    }
  });
})();
