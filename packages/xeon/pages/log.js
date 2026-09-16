/* Nhật ký Xeon — activity log viewer */
(function () {
  "use strict";

  var KINDS = [
    ["meta-webhook","Webhook"],["tin-den","Tin đến"],["meta-chuyen","Chuyển Meta"],
    ["meta-retry","Thử lại"],["goi-landing","→ Landing"],["license","License"],
    ["viet-bai","Viết bài"],["admin","Admin"],["http","HTTP"]
  ];
  var activeKinds = {};
  var entries = [];
  var paused = false;
  var lastStt = 0;
  var timer = null;

  function byId(id) { return document.getElementById(id); }

  function init() {
    var fil = byId("filters");
    KINDS.forEach(function (pair) {
      var k = pair[0], label = pair[1];
      var chip = document.createElement("span");
      chip.className = "chip"; chip.textContent = label; chip.dataset.kind = k;
      chip.addEventListener("click", function () {
        chip.classList.toggle("on");
        if (chip.classList.contains("on")) activeKinds[k] = true; else delete activeKinds[k];
        render();
      });
      fil.appendChild(chip);
    });
    byId("search").addEventListener("input", render);
    byId("pause-btn").addEventListener("click", togglePause);
    poll();
  }

  function togglePause() {
    paused = !paused;
    var btn = byId("pause-btn");
    btn.textContent = paused ? "▶ Tiếp tục" : "⏸ Tạm dừng";
    if (paused) btn.classList.add("paused"); else btn.classList.remove("paused");
    if (!paused) poll();
  }

  function poll() {
    if (paused) return;
    var url = "/nhat-ky?n=500" + (lastStt ? "&since=" + lastStt : "");
    fetch(url).then(function (r) { return r.json(); }).then(function (data) {
      if (!data.ok) return;
      byId("stats").textContent =
        "Tổng: " + data.tong + " | Trong bộ nhớ: " + data.trongBo + " | Hiển thị: " + entries.length;
      if (data.muc.length > 0) {
        var newOnes = data.muc.slice().reverse();
        for (var i = 0; i < newOnes.length; i++) {
          if (newOnes[i].stt > lastStt) { entries.push(newOnes[i]); lastStt = newOnes[i].stt; }
        }
        if (entries.length > 500) entries = entries.slice(-500);
        render();
      }
      byId("dot").style.background = "var(--ok)";
    }).catch(function () {
      byId("dot").style.background = "var(--err)";
    }).finally(function () {
      timer = setTimeout(poll, 3000);
    });
  }

  function render() {
    var q = byId("search").value.toLowerCase();
    var hasFilter = Object.keys(activeKinds).length > 0;
    var filtered = entries;
    if (hasFilter) filtered = filtered.filter(function (e) { return activeKinds[e.loai]; });
    if (q) filtered = filtered.filter(function (e) {
      var hay = (e.loai + " " + (e.method||"") + " " + (e.duong||"") + " " + (e.shop||"") + " " + (e.tomTat||"") + " " + JSON.stringify(e.chiTiet||"")).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    var show = filtered.slice().reverse();
    byId("stats").textContent =
      "Tổng: " + lastStt + " | Trong bộ nhớ: " + entries.length + " | Hiển thị: " + show.length;

    var log = byId("log");
    if (show.length === 0) { log.innerHTML = '<div class="empty">Chưa có nhật ký nào</div>'; return; }
    var html = [];
    for (var i = 0; i < show.length; i++) {
      var e = show[i];
      var statusCls = !e.status ? "" : e.status < 300 ? "status-ok" : e.status < 400 ? "status-warn" : "status-err";
      var huongLabel = e.huong === "in" ? "↓IN" : e.huong === "out" ? "↑OUT" : "⚙";
      var huongCls = "huong-" + e.huong;
      var badgeCls = "badge-" + e.loai;
      var hasDetail = e.chiTiet !== undefined && e.chiTiet !== null;
      var detailText = hasDetail ? (typeof e.chiTiet === "string" ? e.chiTiet : JSON.stringify(e.chiTiet, null, 2)) : "";
      var msText = e.ms !== undefined ? " " + e.ms + "ms" : "";
      var t = new Date(e.luc);
      var timeStr = pad2(t.getHours()) + ":" + pad2(t.getMinutes()) + ":" + pad2(t.getSeconds())
        + "." + pad3(t.getMilliseconds());
      html.push(
        '<div class="row">' +
          '<div class="stt">#' + e.stt + '</div>' +
          '<div class="meta"><span class="luc">' + timeStr + '</span>' +
            '<span><span class="huong ' + huongCls + '">' + huongLabel + '</span>' +
            (e.status ? '<span class="status ' + statusCls + '">' + e.status + '</span>' : '') + msText + '</span></div>' +
          '<div class="body">' +
            '<div><span class="badge ' + badgeCls + '">' + e.loai + '</span>' +
              '<span class="summary">' + esc(e.method||"") + ' ' + esc(e.duong||"") + (e.shop ? " [" + esc(e.shop) + "]" : "") + '</span>' +
              (e.tomTat ? " — " + esc(e.tomTat) : "") +
              (hasDetail ? ' <span class="toggle-detail" data-idx="' + i + '">▼</span>' : '') +
            '</div>' +
            (hasDetail ? '<div class="detail" data-idx="' + i + '">' + esc(detailText) + '</div>' : '') +
          '</div>' +
        '</div>'
      );
    }
    log.innerHTML = html.join("");
    // event delegation for toggling details
    log.onclick = function (ev) {
      var tgt = ev.target;
      if (!tgt) return;
      var idx = tgt.dataset && tgt.dataset.idx;
      if (idx === undefined) return;
      if (tgt.classList.contains("toggle-detail")) {
        var detail = log.querySelector('.detail[data-idx="' + idx + '"]');
        if (detail) detail.classList.toggle("open");
      } else if (tgt.classList.contains("detail")) {
        tgt.classList.remove("open");
      }
    };
    if (byId("auto-scroll").checked) window.scrollTo(0, 0);
  }

  function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function pad3(n) { return n < 10 ? "00" + n : n < 100 ? "0" + n : "" + n; }

  init();
})();
