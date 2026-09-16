/**
 * Licence administration page. Browser JavaScript served as-is by Xeon; it only calls same-origin
 * APIs, and every POST carries the `X-Yeu-Cau: xeon` header (CSRF protection).
 *
 * Structure: `ApiClient` talks to the server, `AdminPage` owns the DOM. Element ids are the
 * contract with `admin.html`; a test checks every id used here exists there.
 */
"use strict";

(function () {
  /** Shorthand for `document.getElementById`. Kept as `byId(...)` so a test can grep the ids. */
  const byId = (id) => document.getElementById(id);

  const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString("vi-VN") : "—");
  const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString("vi-VN") : "—");

  /** Same-origin JSON client. Undefined body = GET; otherwise POST. */
  class ApiClient {
    async call(path, body) {
      const response = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", "X-Yeu-Cau": "xeon" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({ ok: false, error: "khong_doc_duoc" }));
      return { ma: response.status, ...data };
    }
  }

  /** Renders a notice (error by default, or success with kind "ok") into a container. */
  function notify(containerId, text, kind) {
    const container = byId(containerId);
    container.innerHTML = "";
    if (!text) return;
    const box = document.createElement("div");
    box.className = `bao ${kind || "loi"}`;
    box.textContent = text;
    container.appendChild(box);
  }

  /** Appends a cell holding text or a node to a table row. */
  function cell(row, content) {
    const td = document.createElement("td");
    if (content instanceof Node) td.appendChild(content); else td.textContent = content;
    row.appendChild(td);
    return td;
  }

  class AdminPage {
    constructor(api) {
      this.api = api;
      this.moduleChoices = [];
      this.keys = [];
      this.selectedKey = "";
      this.pendingRemoval = "";
    }

    // ------------------------------------------------------------ rendering

    renderModuleCheckboxes(container, selected, groupName) {
      container.innerHTML = "";
      for (const m of this.moduleChoices) {
        const label = document.createElement("label");
        const box = document.createElement("input");
        box.type = "checkbox"; box.value = m.id; box.name = groupName;
        box.checked = m.loi || selected.includes(m.id);
        box.disabled = !!m.loi;
        label.appendChild(box);
        label.appendChild(document.createTextNode(` ${m.ten}${m.loi ? " (lõi)" : ""}`));
        container.appendChild(label);
      }
    }

    selectedModules(container) {
      return [...container.querySelectorAll("input:checked")]
        .map((box) => box.value)
        .filter((id) => !this.moduleChoices.find((m) => m.id === id)?.loi);
    }

    statusBadge(status) {
      const badge = document.createElement("span");
      badge.className = `nhan ${status === "dang_dung" ? "xanh" : status === "het_han" ? "vang" : "do"}`;
      badge.textContent = status === "dang_dung" ? "đang dùng" : status === "het_han" ? "hết hạn" : "bị khoá";
      return badge;
    }

    renderKeyTable() {
      const body = byId("bang-key");
      body.innerHTML = "";
      for (const k of this.keys) {
        const row = document.createElement("tr");
        cell(row, `${k.tenShop} (${k.shop})`);
        const code = document.createElement("code"); code.textContent = k.key; cell(row, code);
        cell(row, k.manh.filter((m) => !this.moduleChoices.find((x) => x.id === m)?.loi).join(", ") || "lõi");
        cell(row, formatDate(k.hetHan));
        cell(row, this.statusBadge(k.trangThai));
        cell(row, `${k.may.length}/${k.soMay}`);
        cell(row, k.landing ? k.landing.diaChi : "chưa đăng ký");
        const view = document.createElement("button"); view.textContent = "Xem"; view.dataset.key = k.key; view.className = "nut-xem";
        cell(row, view);
        body.appendChild(row);
      }
      byId("tom-tat").textContent = `${this.keys.length} key · ${this.keys.filter((k) => k.trangThai === "dang_dung").length} đang dùng`;
    }

    renderDetail() {
      const k = this.keys.find((x) => x.key === this.selectedKey);
      if (!k) { byId("chi-tiet").hidden = true; return; }
      byId("chi-tiet").hidden = false;
      byId("ct-tieu-de").textContent = `${k.tenShop} · ${k.key}`;
      const body = byId("bang-may");
      body.innerHTML = "";
      if (k.may.length === 0) {
        const row = document.createElement("tr");
        const td = document.createElement("td"); td.colSpan = 6; td.className = "mo"; td.textContent = "Chưa máy nào nhập key.";
        row.appendChild(td); body.appendChild(row);
      }
      for (const m of k.may) {
        const row = document.createElement("tr");
        cell(row, m.tenMay);
        const code = document.createElement("code"); code.textContent = m.id; cell(row, code);
        cell(row, formatDateTime(m.ghepLuc)); cell(row, formatDateTime(m.kiemLuc));
        const badge = document.createElement("span"); badge.className = `nhan ${m.truc ? "xanh" : ""}`; badge.textContent = m.truc ? "máy trực" : "—"; cell(row, badge);
        const actions = document.createElement("td");
        if (!m.truc) {
          const duty = document.createElement("button"); duty.textContent = "Đặt trực"; duty.className = "nut-truc"; duty.dataset.may = m.id;
          actions.appendChild(duty); actions.appendChild(document.createTextNode(" "));
        }
        const remove = document.createElement("button"); remove.textContent = "Bỏ máy"; remove.className = "nut-da nguy"; remove.dataset.may = m.id;
        actions.appendChild(remove);
        row.appendChild(actions);
        body.appendChild(row);
      }
      this.renderModuleCheckboxes(byId("ct-manh"), k.manh, "ct-manh");
      byId("ct-het-han").value = k.hetHan.slice(0, 10);
      byId("nut-khoa").hidden = k.trangThai === "bi_khoa";
      byId("nut-mo").hidden = k.trangThai !== "bi_khoa";
      byId("chi-tiet").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    showLogin() {
      byId("khu-dang-nhap").hidden = false;
      byId("khu-chinh").hidden = true;
    }

    // ------------------------------------------------------------ data

    async loadKeys() {
      const d = await this.api.call("/quan-tri/api/key/danh-sach", {});
      if (!d.ok) { if (d.ma === 401) return this.showLogin(); notify("bao-key", d.message || d.error); return; }
      this.keys = d.key;
      this.renderKeyTable();
      if (this.selectedKey) this.renderDetail();
    }

    async start() {
      const me = await this.api.call("/quan-tri/api/toi");
      if (!me.bat) { byId("khu-tat").hidden = false; return; }
      const modules = await this.api.call("/quan-tri/api/manh");
      this.moduleChoices = modules.manh || [];
      this.renderModuleCheckboxes(byId("cap-manh"), [], "cap-manh");
      const nextYear = new Date(); nextYear.setFullYear(nextYear.getFullYear() + 1);
      byId("cap-het-han").value = nextYear.toISOString().slice(0, 10);
      if (!me.dangNhap) return this.showLogin();
      byId("khu-chinh").hidden = false;
      await this.loadKeys();
    }

    // ------------------------------------------------------------ events

    bind() {
      byId("nut-dang-nhap").addEventListener("click", async () => {
        notify("bao-dang-nhap", "");
        const d = await this.api.call("/quan-tri/api/dang-nhap", { matKhau: byId("mat-khau").value });
        if (!d.ok) return notify("bao-dang-nhap", d.ma === 429 ? "Sai quá nhiều lần, chờ 15 phút." : "Sai mật khẩu.");
        byId("mat-khau").value = "";
        byId("khu-dang-nhap").hidden = true;
        byId("khu-chinh").hidden = false;
        byId("khu-nhat-ky").hidden = false;
        await this.loadKeys();
        loadLog(this.api);
      });
      byId("mat-khau").addEventListener("keydown", (e) => { if (e.key === "Enter") byId("nut-dang-nhap").click(); });
      byId("nut-dang-xuat").addEventListener("click", async () => { await this.api.call("/quan-tri/api/dang-xuat", {}); location.reload(); });
      byId("nut-tai").addEventListener("click", () => this.loadKeys());

      byId("nut-cap").addEventListener("click", async () => {
        notify("bao-cap", "");
        byId("key-moi").hidden = true;
        const expires = byId("cap-het-han").value ? new Date(`${byId("cap-het-han").value}T23:59:59`).toISOString() : "";
        const d = await this.api.call("/quan-tri/api/key/cap", {
          shop: byId("cap-shop").value.trim(), tenShop: byId("cap-ten").value.trim(), nganh: byId("cap-nganh").value,
          manh: this.selectedModules(byId("cap-manh")), hetHan: expires, soMay: Number(byId("cap-so-may").value)
        });
        if (!d.ok) return notify("bao-cap", d.message || d.error);
        byId("key-moi-chu").textContent = d.key;
        byId("key-moi").hidden = false;
        byId("cap-shop").value = ""; byId("cap-ten").value = "";
        await this.loadKeys();
      });
      byId("nut-chep-key").addEventListener("click", () => { navigator.clipboard?.writeText(byId("key-moi-chu").textContent).catch(() => {}); });

      byId("bang-key").addEventListener("click", (e) => {
        const button = e.target.closest(".nut-xem");
        if (!button) return;
        this.selectedKey = button.dataset.key;
        this.renderDetail();
      });
      byId("nut-dong-ct").addEventListener("click", () => { this.selectedKey = ""; byId("chi-tiet").hidden = true; });

      byId("bang-may").addEventListener("click", async (e) => {
        const duty = e.target.closest(".nut-truc");
        const remove = e.target.closest(".nut-da");
        if (duty) {
          const d = await this.api.call("/quan-tri/api/key/may-truc", { key: this.selectedKey, mayId: duty.dataset.may });
          if (!d.ok) return notify("bao-ct", d.viSao || d.error);
          return this.loadKeys();
        }
        if (remove) {
          // Two clicks to remove: the first only arms the button.
          if (this.pendingRemoval !== remove.dataset.may) { this.pendingRemoval = remove.dataset.may; remove.textContent = "Bấm lần nữa để bỏ"; return; }
          this.pendingRemoval = "";
          const d = await this.api.call("/quan-tri/api/key/da-may", { key: this.selectedKey, mayId: remove.dataset.may });
          if (!d.ok) return notify("bao-ct", d.viSao || d.error);
          return this.loadKeys();
        }
      });
      byId("nut-luu-manh").addEventListener("click", async () => {
        const d = await this.api.call("/quan-tri/api/key/manh", { key: this.selectedKey, manh: this.selectedModules(byId("ct-manh")) });
        notify("bao-ct", d.ok ? "Đã lưu mảnh." : (d.message || d.error), d.ok ? "ok" : "loi");
        await this.loadKeys();
      });
      byId("nut-gia-han").addEventListener("click", async () => {
        const d = await this.api.call("/quan-tri/api/key/gia-han", { key: this.selectedKey, hetHan: new Date(`${byId("ct-het-han").value}T23:59:59`).toISOString() });
        notify("bao-ct", d.ok ? "Đã gia hạn." : (d.message || d.error), d.ok ? "ok" : "loi");
        await this.loadKeys();
      });
      byId("nut-khoa").addEventListener("click", async () => {
        const d = await this.api.call("/quan-tri/api/key/khoa", { key: this.selectedKey, lyDo: byId("ct-ly-do").value });
        notify("bao-ct", d.ok ? "Đã khoá. Máy đang dùng sẽ bị từ chối ở lần kiểm 6 giờ kế tiếp." : (d.message || d.error), d.ok ? "ok" : "loi");
        await this.loadKeys();
      });
      byId("nut-mo").addEventListener("click", async () => {
        const d = await this.api.call("/quan-tri/api/key/mo", { key: this.selectedKey });
        notify("bao-ct", d.ok ? "Đã mở khoá." : (d.message || d.error), d.ok ? "ok" : "loi");
        await this.loadKeys();
      });
    }
  }

  // ------------------------------------------------------------ nhật ký deploy

  async function loadLog(api) {
    const d = await api.call("/quan-tri/api/nhat-ky");
    if (!d.ok) { notify("bao-log", d.error || "Không đọc được nhật ký."); return; }
    notify("bao-log", "");
    const tom = [];
    if (d.deployId) tom.push("Commit: " + d.deployId);
    if (d.buildLuc) tom.push("Build lúc: " + d.buildLuc);
    byId("log-tom-tat").textContent = tom.join("  ·  ") || "Chưa có thông tin deploy.";
    byId("log-auto-deploy").textContent = (d.duoiAutoDeployLog || []).join("\n") || "(trống)";
    byId("log-build").textContent = (d.duoiBuildLog || []).join("\n") || "(trống)";
    byId("log-stderr").textContent = (d.duoiStderr || []).join("\n") || "(trống)";
    if (d.buildLogTen) {
      const h = byId("log-build").previousElementSibling;
      if (h) h.textContent = "Build log mới nhất (" + d.buildLogTen + ")";
    }
  }

  const page = new AdminPage(new ApiClient());
  page.bind();
  byId("nut-tai-log").addEventListener("click", () => loadLog(page.api));
  page.start().then(() => {
    // Chỉ tải log khi đã đăng nhập (khu-chinh đang hiện)
    if (!byId("khu-chinh").hidden) {
      byId("khu-nhat-ky").hidden = false;
      loadLog(page.api);
    }
  });
})();
