// Trang quan tri license — chi goi API cung goc, moi POST kem X-Yeu-Cau: xeon.
"use strict";

(function () {
  const el = (id) => document.getElementById(id);
  let danhSachManh = [];
  let cacKey = [];
  let keyDangXem = "";

  async function goi(duong, than) {
    const tl = await fetch(duong, {
      method: than === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-Yeu-Cau": "xeon" },
      body: than === undefined ? undefined : JSON.stringify(than)
    });
    const d = await tl.json().catch(() => ({ ok: false, error: "khong_doc_duoc" }));
    return { ma: tl.status, ...d };
  }

  function bao(id, chu, loai) {
    const o = el(id);
    o.innerHTML = "";
    if (!chu) return;
    const p = document.createElement("div");
    p.className = `bao ${loai || "loi"}`;
    p.textContent = chu;
    o.appendChild(p);
  }

  const ngay = (iso) => (iso ? new Date(iso).toLocaleString("vi-VN") : "—");
  const ngayNgan = (iso) => (iso ? new Date(iso).toLocaleDateString("vi-VN") : "—");

  function veManh(khu, daChon, tenTruoc) {
    khu.innerHTML = "";
    for (const m of danhSachManh) {
      const l = document.createElement("label");
      const c = document.createElement("input");
      c.type = "checkbox"; c.value = m.id; c.name = tenTruoc;
      c.checked = m.loi || daChon.includes(m.id);
      c.disabled = !!m.loi;
      l.appendChild(c);
      l.appendChild(document.createTextNode(` ${m.ten}${m.loi ? " (lõi)" : ""}`));
      khu.appendChild(l);
    }
  }
  const manhDaChon = (khu) => [...khu.querySelectorAll("input:checked")].map((c) => c.value).filter((id) => !danhSachManh.find((m) => m.id === id)?.loi);

  function nhanTrangThai(tt) {
    const s = document.createElement("span");
    s.className = `nhan ${tt === "dang_dung" ? "xanh" : tt === "het_han" ? "vang" : "do"}`;
    s.textContent = tt === "dang_dung" ? "đang dùng" : tt === "het_han" ? "hết hạn" : "bị khoá";
    return s;
  }

  function veBangKey() {
    const b = el("bang-key");
    b.innerHTML = "";
    for (const k of cacKey) {
      const tr = document.createElement("tr");
      const o = (chu) => { const td = document.createElement("td"); if (chu instanceof Node) td.appendChild(chu); else td.textContent = chu; tr.appendChild(td); return td; };
      o(`${k.tenShop} (${k.shop})`);
      const c = document.createElement("code"); c.textContent = k.key; o(c);
      o(k.manh.filter((m) => !danhSachManh.find((x) => x.id === m)?.loi).join(", ") || "lõi");
      o(ngayNgan(k.hetHan));
      o(nhanTrangThai(k.trangThai));
      o(`${k.may.length}/${k.soMay}`);
      o(k.landing ? k.landing.diaChi : "chưa đăng ký");
      const nut = document.createElement("button"); nut.textContent = "Xem"; nut.dataset.key = k.key; nut.className = "nut-xem";
      o(nut);
      b.appendChild(tr);
    }
    el("tom-tat").textContent = `${cacKey.length} key · ${cacKey.filter((k) => k.trangThai === "dang_dung").length} đang dùng`;
  }

  async function taiKey() {
    const d = await goi("/quan-tri/api/key/danh-sach", {});
    if (!d.ok) { if (d.ma === 401) return moDangNhap(); bao("bao-key", d.message || d.error); return; }
    cacKey = d.key;
    veBangKey();
    if (keyDangXem) veChiTiet();
  }

  function veChiTiet() {
    const k = cacKey.find((x) => x.key === keyDangXem);
    if (!k) { el("chi-tiet").hidden = true; return; }
    el("chi-tiet").hidden = false;
    el("ct-tieu-de").textContent = `${k.tenShop} · ${k.key}`;
    const b = el("bang-may");
    b.innerHTML = "";
    if (k.may.length === 0) { const tr = document.createElement("tr"); const td = document.createElement("td"); td.colSpan = 6; td.className = "mo"; td.textContent = "Chưa máy nào nhập key."; tr.appendChild(td); b.appendChild(tr); }
    for (const m of k.may) {
      const tr = document.createElement("tr");
      const o = (chu) => { const td = document.createElement("td"); if (chu instanceof Node) td.appendChild(chu); else td.textContent = chu; tr.appendChild(td); };
      o(m.tenMay); const c = document.createElement("code"); c.textContent = m.id; o(c);
      o(ngay(m.ghepLuc)); o(ngay(m.kiemLuc));
      const t = document.createElement("span"); t.className = `nhan ${m.truc ? "xanh" : ""}`; t.textContent = m.truc ? "máy trực" : "—"; o(t);
      const td = document.createElement("td");
      if (!m.truc) { const n1 = document.createElement("button"); n1.textContent = "Đặt trực"; n1.className = "nut-truc"; n1.dataset.may = m.id; td.appendChild(n1); td.appendChild(document.createTextNode(" ")); }
      const n2 = document.createElement("button"); n2.textContent = "Bỏ máy"; n2.className = "nut-da nguy"; n2.dataset.may = m.id; td.appendChild(n2);
      tr.appendChild(td);
      b.appendChild(tr);
    }
    veManh(el("ct-manh"), k.manh, "ct-manh");
    el("ct-het-han").value = k.hetHan.slice(0, 10);
    el("nut-khoa").hidden = k.trangThai === "bi_khoa";
    el("nut-mo").hidden = k.trangThai !== "bi_khoa";
    el("chi-tiet").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function moDangNhap() {
    el("khu-dang-nhap").hidden = false;
    el("khu-chinh").hidden = true;
  }

  async function khoiDong() {
    const toi = await goi("/quan-tri/api/toi");
    if (!toi.bat) { el("khu-tat").hidden = false; return; }
    const m = await goi("/quan-tri/api/manh");
    danhSachManh = m.manh || [];
    veManh(el("cap-manh"), [], "cap-manh");
    const het = new Date(); het.setFullYear(het.getFullYear() + 1);
    el("cap-het-han").value = het.toISOString().slice(0, 10);
    if (!toi.dangNhap) return moDangNhap();
    el("khu-chinh").hidden = false;
    await taiKey();
  }

  el("nut-dang-nhap").addEventListener("click", async () => {
    bao("bao-dang-nhap", "");
    const d = await goi("/quan-tri/api/dang-nhap", { matKhau: el("mat-khau").value });
    if (!d.ok) return bao("bao-dang-nhap", d.ma === 429 ? "Sai quá nhiều lần, chờ 15 phút." : "Sai mật khẩu.");
    el("mat-khau").value = "";
    el("khu-dang-nhap").hidden = true;
    el("khu-chinh").hidden = false;
    await taiKey();
  });
  el("mat-khau").addEventListener("keydown", (e) => { if (e.key === "Enter") el("nut-dang-nhap").click(); });
  el("nut-dang-xuat").addEventListener("click", async () => { await goi("/quan-tri/api/dang-xuat", {}); location.reload(); });
  el("nut-tai").addEventListener("click", taiKey);

  el("nut-cap").addEventListener("click", async () => {
    bao("bao-cap", "");
    el("key-moi").hidden = true;
    const hetHan = el("cap-het-han").value ? new Date(`${el("cap-het-han").value}T23:59:59`).toISOString() : "";
    const d = await goi("/quan-tri/api/key/cap", {
      shop: el("cap-shop").value.trim(), tenShop: el("cap-ten").value.trim(), nganh: el("cap-nganh").value,
      manh: manhDaChon(el("cap-manh")), hetHan, soMay: Number(el("cap-so-may").value)
    });
    if (!d.ok) return bao("bao-cap", d.message || d.error);
    el("key-moi-chu").textContent = d.key;
    el("key-moi").hidden = false;
    el("cap-shop").value = ""; el("cap-ten").value = "";
    await taiKey();
  });
  el("nut-chep-key").addEventListener("click", () => { navigator.clipboard?.writeText(el("key-moi-chu").textContent).catch(() => {}); });

  el("bang-key").addEventListener("click", (e) => {
    const n = e.target.closest(".nut-xem");
    if (!n) return;
    keyDangXem = n.dataset.key;
    veChiTiet();
  });
  el("nut-dong-ct").addEventListener("click", () => { keyDangXem = ""; el("chi-tiet").hidden = true; });

  let choXacNhan = "";
  el("bang-may").addEventListener("click", async (e) => {
    const truc = e.target.closest(".nut-truc");
    const da = e.target.closest(".nut-da");
    if (truc) {
      const d = await goi("/quan-tri/api/key/may-truc", { key: keyDangXem, mayId: truc.dataset.may });
      if (!d.ok) return bao("bao-ct", d.viSao || d.error);
      return taiKey();
    }
    if (da) {
      if (choXacNhan !== da.dataset.may) { choXacNhan = da.dataset.may; da.textContent = "Bấm lần nữa để bỏ"; return; }
      choXacNhan = "";
      const d = await goi("/quan-tri/api/key/da-may", { key: keyDangXem, mayId: da.dataset.may });
      if (!d.ok) return bao("bao-ct", d.viSao || d.error);
      return taiKey();
    }
  });
  el("nut-luu-manh").addEventListener("click", async () => {
    const d = await goi("/quan-tri/api/key/manh", { key: keyDangXem, manh: manhDaChon(el("ct-manh")) });
    bao("bao-ct", d.ok ? "Đã lưu mảnh." : (d.message || d.error), d.ok ? "ok" : "loi");
    await taiKey();
  });
  el("nut-gia-han").addEventListener("click", async () => {
    const d = await goi("/quan-tri/api/key/gia-han", { key: keyDangXem, hetHan: new Date(`${el("ct-het-han").value}T23:59:59`).toISOString() });
    bao("bao-ct", d.ok ? "Đã gia hạn." : (d.message || d.error), d.ok ? "ok" : "loi");
    await taiKey();
  });
  el("nut-khoa").addEventListener("click", async () => {
    const d = await goi("/quan-tri/api/key/khoa", { key: keyDangXem, lyDo: el("ct-ly-do").value });
    bao("bao-ct", d.ok ? "Đã khoá. Máy đang dùng sẽ bị từ chối ở lần kiểm 6 giờ kế tiếp." : (d.message || d.error), d.ok ? "ok" : "loi");
    await taiKey();
  });
  el("nut-mo").addEventListener("click", async () => {
    const d = await goi("/quan-tri/api/key/mo", { key: keyDangXem });
    bao("bao-ct", d.ok ? "Đã mở khoá." : (d.message || d.error), d.ok ? "ok" : "loi");
    await taiKey();
  });

  khoiDong();
})();
