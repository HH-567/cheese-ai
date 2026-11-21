/* 柒柿AI · 纯前端演示 — 通用工具 */
(function () {
  'use strict';
  var App = (window.App = window.App || {});
  var U = (App.util = {});

  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  U.uid = function (p) { return (p || 'id') + '_' + Math.random().toString(36).slice(2, 9); };
  U.now = function () { return Date.now(); };
  U.clamp = function (n, a, b) { return Math.min(b, Math.max(a, n)); };
  U.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  U.clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  U.rand = function (a, b) { return a + Math.random() * (b - a); };
  U.pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };

  U.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  U.fmtAgo = function (ts) {
    if (!ts) return '';
    var d = Date.now() - ts;
    if (d < 45 * 1000) return '刚刚';
    if (d < 3600 * 1000) return Math.round(d / 60000) + ' 分钟前';
    if (d < 24 * 3600 * 1000) return Math.round(d / 3600000) + ' 小时前';
    if (d < 48 * 3600 * 1000) return '昨天 ' + U.clock(ts);
    if (d < 7 * 24 * 3600 * 1000) return Math.round(d / 86400000) + ' 天前';
    return U.date(ts);
  };

  U.date = function (ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  };

  U.clock = function (ts) {
    var d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };

  U.stamp = function (ts) {
    var d = new Date(ts), n = new Date();
    if (d.toDateString() === n.toDateString()) return U.clock(ts);
    var y = new Date(n.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天 ' + U.clock(ts);
    return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + U.clock(ts);
  };

  U.dayKey = function (ts) {
    var d = new Date(ts), n = new Date();
    var sameDay = d.toDateString() === n.toDateString();
    if (sameDay) return '今天';
    var y = new Date(n.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天';
    if (n - ts < 7 * 86400000) return '更早';
    return '更久';
  };

  U.fmtMs = function (ms) {
    if (ms == null) return '—';
    if (ms < 1000) return Math.round(ms) + ' ms';
    return (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s';
  };

  U.fmtMoney = function (n) {
    if (!n) return '¥0';
    if (n < 0.01) return '¥' + n.toFixed(4);
    return '¥' + n.toFixed(3);
  };

  U.fmtNum = function (n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  U.pct = function (a, b) {
    if (!b) return '0%';
    return Math.round((a / b) * 100) + '%';
  };

  U.debounce = function (fn, wait) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  };

  /* ---------------- 存储（file:// 下 localStorage 可能受限，降级到内存） ---------------- */
  U.store = (function () {
    var mem = {};
    var ok = null;
    function probe() {
      if (ok !== null) return ok;
      try {
        var k = '__probe__';
        window.localStorage.setItem(k, '1');
        window.localStorage.removeItem(k);
        ok = true;
      } catch (e) { ok = false; }
      return ok;
    }
    return {
      get: function (key, fallback) {
        try {
          if (probe()) {
            var raw = window.localStorage.getItem(key);
            if (raw == null) return fallback;
            return JSON.parse(raw);
          }
        } catch (e) { /* ignore */ }
        return key in mem ? mem[key] : fallback;
      },
      set: function (key, val) {
        mem[key] = val;
        try { if (probe()) window.localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
        return val;
      },
      remove: function (key) {
        delete mem[key];
        try { if (probe()) window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
      },
      available: probe
    };
  })();

  /* ---------------- 剪贴板 ---------------- */
  U.copy = function (text) {
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  };

  /* ---------------- Toast ---------------- */
  U.toast = function (message, opts) {
    opts = opts || {};
    var root = U.$('#toasts');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'toast toast--' + (opts.kind || 'info');
    el.innerHTML =
      '<span class="toast__icon">' + (opts.kind === 'ok' ? U.icon('check') : opts.kind === 'warn' ? U.icon('alert') : opts.kind === 'err' ? U.icon('x') : U.icon('spark')) + '</span>' +
      '<div class="toast__body"><div class="toast__msg">' + U.esc(message) + '</div>' +
      (opts.detail ? '<div class="toast__detail">' + U.esc(opts.detail) + '</div>' : '') + '</div>';
    root.appendChild(el);
    var life = opts.life || (opts.detail ? 4200 : 2600);
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { el.remove(); }, 260);
    }, life);
    return el;
  };

  /* ---------------- Modal ---------------- */
  U.modal = function (opts) {
    var root = U.$('#modal-root');
    var wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    var actions = (opts.actions || []).map(function (a, i) {
      return '<button class="btn ' + (a.kind === 'primary' ? 'btn--primary' : a.kind === 'danger' ? 'btn--danger' : 'btn--ghost') +
        '" data-modal-action="' + i + '">' + U.esc(a.label) + '</button>';
    }).join('');
    wrap.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" style="max-width:' + (opts.width || 560) + 'px">' +
      '<div class="modal__head"><div class="modal__title">' + U.esc(opts.title || '') + '</div>' +
      '<button class="icon-btn" data-modal-close aria-label="关闭">' + U.icon('x') + '</button></div>' +
      '<div class="modal__body">' + (opts.body || '') + '</div>' +
      (actions ? '<div class="modal__foot">' + actions + '</div>' : '') +
      '</div>';
    root.appendChild(wrap);
    requestAnimationFrame(function () { wrap.classList.add('is-in'); });

    function close() {
      wrap.classList.remove('is-in');
      document.removeEventListener('keydown', onKey);
      setTimeout(function () { wrap.remove(); }, 180);
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) return close();
      if (e.target.closest('[data-modal-close]')) return close();
      var btn = e.target.closest('[data-modal-action]');
      if (btn) {
        var i = +btn.getAttribute('data-modal-action');
        var act = opts.actions[i];
        if (act && act.onClick) {
          var keep = act.onClick(wrap, close);
          if (keep !== false) close();
        } else close();
      }
    });
    setTimeout(function () {
      var f = wrap.querySelector('[data-autofocus]');
      if (f) f.focus();
    }, 60);
    return { close: close, el: wrap };
  };

  U.confirm = function (opts) {
    return new Promise(function (resolve) {
      U.modal({
        title: opts.title,
        body: '<p class="modal__text">' + U.esc(opts.body || '') + '</p>',
        actions: [
          { label: '取消', onClick: function () { resolve(false); } },
          { label: opts.okLabel || '确定', kind: opts.danger ? 'danger' : 'primary', onClick: function () { resolve(true); } }
        ],
        onClose: function () { resolve(false); }
      });
    });
  };

  /* ---------------- 图标 ---------------- */
  var P = {
    spark: '<path d="M12 3l1.9 5.4L19.5 10l-5.6 1.6L12 17l-1.9-5.4L4.5 10l5.6-1.6z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chat: '<path d="M20 15.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5z"/>',
    library: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H18v18H7.5A2.5 2.5 0 0 1 5 18.5z"/><path d="M9 8h5M9 12h5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    moon: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z"/>',
    send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 4v7h-7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13"/>',
    edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17.4 10 3.5 3.5 0 0 1 17.5 17H7z"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.3a3.2 3.2 0 0 1 0 5.4M17 14a6 6 0 0 1 4 6"/>',
    play: '<path d="M7 4.5l12 7.5-12 7.5z"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    dot: '<circle cx="12" cy="12" r="3"/>',
    hash: '<path d="M9 3L7 21M17 3l-2 18M3.5 8.5h17M3 15.5h17"/>',
    bolt: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/>',
    download: '<path d="M12 4v11M7 11l5 5 5-5M4 20h16"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6h.01"/>',
    flag: '<path d="M5 21V4h9l-1 3h6l-2 5 2 5h-9l-1-3H5"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z"/><path d="M4 17h15"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>'
  };

  U.icon = function (name, size) {
    var d = P[name] || P.dot;
    return '<svg class="ico" width="' + (size || 16) + '" height="' + (size || 16) + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  };

  U.avatar = function (user, size) {
    var s = size || 24;
    return '<span class="avatar" style="--av:' + user.color + ';width:' + s + 'px;height:' + s + 'px;font-size:' +
      Math.round(s * 0.42) + 'px" title="' + U.esc(user.name) + '">' + U.esc(user.initials) + '</span>';
  };

  U.flash = function (el) {
    if (!el) return;
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
  };

  U.scrollToEl = function (el, container, offset) {
    if (!el || !container) return;
    var top = el.offsetTop - (offset || 24);
    container.scrollTo({ top: top, behavior: 'smooth' });
  };

  U.revealEl = function (el, container, margin) {
    if (!el || !container) return;
    margin = margin == null ? 120 : margin;
    var top = el.offsetTop;
    var bottom = top + el.offsetHeight;
    var viewTop = container.scrollTop;
    var viewBottom = viewTop + container.clientHeight;
    if (top >= viewTop + 8 && bottom <= viewBottom - 8) return;
    var target = Math.max(0, top - margin);
    container.scrollTo({ top: target, behavior: 'smooth' });
  };

  U.escapeRe = function (s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };

  /* 归一化查询键：去标点、去空白、小写，用于精确索引与暂停目标定位 */
  U.key = function (s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[`"'“”‘’]/g, '')
      .replace(/[，。？！、；：,?!;:—~…]/g, ' ')
      .replace(/[（）]/g, ' ')
      .replace(/\s+/g, '')
      .trim();
  };

  /* ---------------- 浮层菜单 ---------------- */
  U.closeMenu = function () {
    if (!U._menu) return;
    document.removeEventListener("mousedown", U._menu.onDoc);
    U._menu.el.remove();
    U._menu = null;
  };

  U.menu = function (anchor, items, onPick) {
    U.closeMenu();
    if (!anchor) return;
    var el = document.createElement("div");
    el.className = "menu";
    el.innerHTML = items.map(function (it, i) {
      return '<button class="menu__item' + (it.on ? " is-on" : "") + '" data-i="' + i + '">' +
        '<span class="menu__body"><span class="menu__label">' + U.esc(it.label) + "</span>" +
        (it.hint ? '<span class="menu__hint">' + U.esc(it.hint) + "</span>" : "") + "</span>" +
        (it.on ? '<span class="menu__check">' + U.icon("check", 12) + "</span>" : "") +
        "</button>";
    }).join("");
    el.style.visibility = "hidden";
    document.body.appendChild(el);
    var r = anchor.getBoundingClientRect();
    var w = el.offsetWidth, h = el.offsetHeight;
    var left = Math.min(window.innerWidth - w - 12, Math.max(12, r.right - w));
    var top = r.top - h - 8;
    if (top < 12) top = r.bottom + 8;
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.style.visibility = "";
    el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-i]");
      if (!b) return;
      var i = +b.getAttribute("data-i");
      U.closeMenu();
      onPick && onPick(items[i], i);
    });
    function onDoc(e) {
      if (!el.contains(e.target) && e.target !== anchor) U.closeMenu();
    }
    setTimeout(function () { document.addEventListener("mousedown", onDoc); }, 0);
    U._menu = { el: el, onDoc: onDoc };
  };

  /* ---------------- 极简事件总线 ---------------- */
  App.bus = (function () {
    var map = {};
    return {
      on: function (evt, fn) { (map[evt] = map[evt] || []).push(fn); return fn; },
      off: function (evt, fn) { map[evt] = (map[evt] || []).filter(function (f) { return f !== fn; }); },
      emit: function (evt, payload) { (map[evt] || []).forEach(function (fn) { try { fn(payload); } catch (e) { console.error(e); } }); }
    };
  })();
})();
