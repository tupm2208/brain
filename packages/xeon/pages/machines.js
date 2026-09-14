/**
 * Machine management page for the key owner. The key itself is the credential; there is no session.
 * Same-origin JSON only; every POST carries the `X-Yeu-Cau: xeon` header.
 */
"use strict";

(function () {
  const byId = (id) => document.getElementById(id);
  const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString("vi-VN") : "—");
  const KEY_SHAPE = /^TR-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

  class ApiClient {
    async post(path, body) {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Yeu-Cau": "xeon" },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({ ok: false, error: "khong_doc_duoc" }));
      return { ma: response.status, ...data };
    }
  }

  function notify(text, kind) {
    const container = byId("bao");
    container.innerHTML = "";
    if (!text) return;
    const box = document.createElement("div"); box.className = `bao ${kind || "loi"}`; box.textContent = text;
    container.appendChild(box);
  }

  function cell(row, content) {
    const td = document.createElement("td");
    if (content instanceof Node) td.appendChild(content); else td.textContent = content;
    row.appendChild(td);
  }

  class MachinesPage {
    constructor(api) {
      this.api = api;
      this.pendingRemoval = "";
    }

    key() {
      return byId("key").value.trim().toUpperCase();
    }

    render(view) {
      byId("khu-may").hidden = false;
      byId("ten-shop").textContent = view.tenShop;
      byId("dem").textContent = `${view.may.length}/${view.soMay} máy${view.trangThai !== "dang_dung" ? ` · key ${view.trangThai === "het_han" ? "hết hạn" : "bị khoá"}` : ""}`;
      const body = byId("bang-may");
      body.innerHTML = "";
      if (view.may.length === 0) {
        const row = document.createElement("tr");
        const td = document.createElement("td"); td.colSpan = 6; td.className = "mo"; td.textContent = "Chưa máy nào nhập key.";
        row.appendChild(td); body.appendChild(row);
      }
      for (const m of view.may) {
        const row = document.createElement("tr");
        cell(row, m.tenMay);
        const code = document.createElement("code"); code.textContent = m.id; cell(row, code);
        cell(row, formatDateTime(m.ghepLuc)); cell(row, formatDateTime(m.kiemLuc));
        const badge = document.createElement("span"); badge.className = `nhan ${m.truc ? "xanh" : ""}`; badge.textContent = m.truc ? "máy trực" : "—"; cell(row, badge);
        const actions = document.createElement("td");
        if (!m.truc) {
          const duty = document.createElement("button"); duty.textContent = "Đặt làm máy trực"; duty.className = "nut-truc"; duty.dataset.may = m.id;
          actions.appendChild(duty); actions.appendChild(document.createTextNode(" "));
        }
        const remove = document.createElement("button"); remove.textContent = "Bỏ máy này"; remove.className = "nut-da nguy"; remove.dataset.may = m.id;
        actions.appendChild(remove);
        row.appendChild(actions);
        body.appendChild(row);
      }
    }

    async load() {
      notify("");
      if (!KEY_SHAPE.test(this.key())) { byId("khu-may").hidden = true; return notify("Key phải có dạng TR-XXXX-XXXX-XXXX-XXXX."); }
      const d = await this.api.post("/may/api/xem", { key: this.key() });
      if (!d.ok) { byId("khu-may").hidden = true; return notify(d.ma === 429 ? "Gọi quá nhiều, chờ 15 phút." : "Không có key này."); }
      this.render(d);
    }

    bind() {
      byId("nut-xem").addEventListener("click", () => this.load());
      byId("key").addEventListener("keydown", (e) => { if (e.key === "Enter") this.load(); });

      byId("bang-may").addEventListener("click", async (e) => {
        const duty = e.target.closest(".nut-truc");
        const remove = e.target.closest(".nut-da");
        if (duty) {
          const d = await this.api.post("/may/api/truc", { key: this.key(), mayId: duty.dataset.may });
          if (!d.ok) return notify(d.viSao || d.error);
          notify("Đã đổi máy trực. Máy mới bắt đầu trực trong vòng 5 phút.", "ok");
          return this.load();
        }
        if (remove) {
          if (this.pendingRemoval !== remove.dataset.may) { this.pendingRemoval = remove.dataset.may; remove.textContent = "Bấm lần nữa để bỏ"; return; }
          this.pendingRemoval = "";
          const d = await this.api.post("/may/api/da", { key: this.key(), mayId: remove.dataset.may });
          if (!d.ok) return notify(d.viSao || d.error);
          notify("Đã bỏ máy.", "ok");
          return this.load();
        }
      });
    }
  }

  const page = new MachinesPage(new ApiClient());
  page.bind();
})();
