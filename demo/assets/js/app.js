/* 柒柿AI · 纯前端演示 — 应用外壳与路由 */
(function () {
  'use strict';
  var App = window.App, U = App.util, S = App.store;
  var A = (App.app = {});
  var els = {};
  A.insOpen = true;

  var NAV = [
    { id: 'chat', label: '聊天', icon: 'chat' },
    { id: 'library', label: '问答库', icon: 'library' },
    { id: 'governance', label: '审核', icon: 'flag' },
    { id: 'usage', label: '用量', icon: 'chart' },
    { id: 'settings', label: '设置', icon: 'gear' }
  ];

  A.boot = function () {
    S.load();
    App.engine.resumeTasks();
    document.documentElement.dataset.theme = S.state.theme || 'light';

    els.sidebar = U.$('#sidebar');
    els.topbar = U.$('#topbar');
    els.view = U.$('#view');
    els.inspector = U.$('#inspector');

    var params = new URLSearchParams(location.search);
    if (params.get('page')) S.state.page = params.get('page');
    if (params.get('theme') === 'dark' || params.get('theme') === 'light') {
      S.state.theme = params.get('theme');
      document.documentElement.dataset.theme = S.state.theme;
    }

    App.demo.mount(U.$('#guide-root'));
    App.inspector.mount(els.inspector);

    renderShell();
    A.go(S.state.page || 'chat');

    App.bus.on('records:changed', function () {
      A.refreshSidebar();
      A.refreshTopbar();
      if (S.state.page === 'library') App.views.library.render();
      if (S.state.page === 'usage') App.views.usage.render();
      if (S.state.page === 'governance') App.views.governance.render();
    });
    App.bus.on('data:reset', function () {
      A.refreshAll();
    });
    App.bus.on('message:done', function (payload) {
      if (S.state.page === 'chat' && App.views.chat) App.views.chat.onMessageDone(payload);
    });
    App.bus.on('settings:changed', function () {
      A.refreshTopbar();
      if (S.state.page === 'chat') App.views.chat.refreshSuggestions();
    });

    document.addEventListener('keydown', function (e) {
      var mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        A.newChat();
      }
      if (mod && e.key === '/') {
        e.preventDefault();
        App.demo.toggle();
      }
    });

    if (params.get('guide') === '1') App.demo.open();
    if (params.get('ins')) App.inspector.setTab(params.get('ins'));
    if (params.get('auto')) {
      var n = parseInt(params.get('auto'), 10) || 1;
      setTimeout(function () { App.demo.autoRun(n); }, 500);
    }
  };

  A.toast = U.toast;

  /* ------------------------------ 外壳 ------------------------------ */
  function renderShell() {
    A.refreshSidebar();
    A.refreshTopbar();
    document.body.setAttribute('data-ins', A.insOpen ? 'on' : 'off');
  }

  A.refreshSidebar = function () {
    if (!els.sidebar) return;
    var page = S.state.page;
    var user = S.user();
    var sessions = S.sessionsFor();
    var recCount = S.visibleRecords().length;
    var aliasCount = S.countAliases();
    var learning = S.visibleRecords().filter(function (r) { return r.status === 'learning'; }).length;
    var govData = S.governance();
    var govBadge = govData.metrics.open + govData.metrics.pendingRev;

    var sessHTML = sessions.length ? sessions.slice(0, 9).map(function (s) {
      var last = s.messages.length ? s.messages[s.messages.length - 1] : null;
      var dot = last && last.meta && last.meta.source === 'library' ? 'lib' :
        last && last.meta && last.meta.source === 'cloud' ? 'cloud' : 'none';
      return '<button class="sess' + (s.id === S.state.sessionId && page === 'chat' ? ' is-on' : '') + '" data-sess="' + s.id + '">' +
        '<span class="sess__row"><i class="sess__dot sess__dot--' + dot + '"></i>' +
        '<span class="sess__title">' + U.esc(s.title) + '</span></span>' +
        '<span class="sess__meta">' + U.fmtAgo(s.updatedAt) + ' · ' + (s.scope === 'shared' ? '共享' : '个人') + '</span>' +
        '</button>';
    }).join('') : '<div class="sess__empty">还没有会话</div>';

    els.sidebar.innerHTML =
      '<div class="brand">' +
      '<div class="brand__mark">' + U.icon('spark', 17) + '</div>' +
      '<div class="brand__txt"><div class="brand__name">柒柿AI</div>' +
      '<div class="brand__tag">CPU 先查库 · 答过就不再问云端</div></div>' +
      '</div>' +

      '<button class="newchat" data-act="new-chat">' + U.icon('plus', 15) + '<span>新聊天</span><kbd>Ctrl K</kbd></button>' +

      '<nav class="nav">' + NAV.map(function (n) {
        var badge = n.id === 'library' ? recCount : n.id === 'chat' ? sessions.length : n.id === 'governance' ? govBadge : 0;
        return '<button class="nav__item' + (page === n.id ? ' is-on' : '') + '" data-nav="' + n.id + '">' +
          U.icon(n.icon, 15) + '<span>' + n.label + '</span>' +
          (badge ? '<em class="nav__num">' + badge + '</em>' : '') + '</button>';
      }).join('') + '</nav>' +

      '<div class="sess-block">' +
      '<div class="sess-block__head"><span>最近会话</span><span class="muted">' + sessions.length + '</span></div>' +
      '<div class="sess-list">' + sessHTML + '</div></div>' +

      '<div class="side-foot">' +
      '<div class="libcard">' +
      '<div class="libcard__row"><i class="dot ' + (S.state.settings.cloudOnline ? 'dot--ok' : 'dot--off') + '"></i>' +
      '<span>' + U.esc(S.library().name) + ' · ' + U.esc(S.library().id) + '</span></div>' +
      '<div class="libcard__meta">' + recCount + ' 条问题组 · ' + aliasCount + ' 条等价问法' +
      (learning ? ' · <b class="hl-learning">' + learning + ' 条生成中</b>' : '') +
      (govData.metrics.suspended ? ' · <b class="hl-warn">' + govData.metrics.suspended + ' 条暂停</b>' : '') + '</div>' +
      '<div class="libcard__users">' +
      ['u-a', 'u-b', 'u-c'].map(function (id) {
        return '<span class="mini-av" style="background:' + App.seed.users[id].color + '">' + App.seed.users[id].initials + '</span>';
      }).join('') +
      '<span class="libcard__who">' + U.esc(user.name) + (S.isAdmin() ? ' · 管理员' : ' · 成员') + '</span>' +
      '</div></div>' +
      '<button class="side-link" data-act="guide">' + U.icon('play', 12) + '三分钟演示脚本</button>' +
      '</div>';
    bindSidebar();
  };

  function bindSidebar() {
    els.sidebar.querySelectorAll('[data-nav]').forEach(function (b) {
      b.addEventListener('click', function () { A.go(b.getAttribute('data-nav')); });
    });
    els.sidebar.querySelectorAll('[data-sess]').forEach(function (b) {
      b.addEventListener('click', function () {
        S.state.sessionId = b.getAttribute('data-sess');
        S.save();
        A.go('chat');
      });
    });
    var nc = els.sidebar.querySelector('[data-act="new-chat"]');
    if (nc) nc.addEventListener('click', A.newChat);
    var g = els.sidebar.querySelector('[data-act="guide"]');
    if (g) g.addEventListener('click', function () { App.demo.open(); });
  }

  A.refreshTopbar = function () {
    if (!els.topbar) return;
    var page = S.state.page;
    var session = S.currentSession();
    var left = '';
    var right =
      '<div class="ids" role="group" aria-label="切换身份">' +
      ['u-a', 'u-b', 'u-c'].map(function (id) {
        var u = App.seed.users[id];
        return '<button class="idbtn' + (S.state.userId === id ? ' is-on' : '') + '" data-user="' + id + '" title="' + U.esc(u.name + ' · ' + u.desc) + '">' +
          U.avatar(u, 20) + '<span>' + U.esc(u.name) + '</span></button>';
      }).join('') +
      '</div>' +
      '<button class="icon-btn" data-act="theme" title="切换明暗主题">' + U.icon(S.state.theme === 'dark' ? 'sun' : 'moon', 16) + '</button>' +
      '<button class="icon-btn only-mobile" data-act="nav" title="会话列表">' + U.icon('menu', 16) + '</button>' +
      '<button class="btn btn--ghost btn--small" data-act="guide">' + U.icon('play', 12) + '演示</button>' +
      (page === 'chat' ? '<button class="icon-btn' + (A.insOpen ? ' is-on' : '') + '" data-act="ins" title="请求追踪面板">' + U.icon('layers', 16) + '</button>' : '');

    if (page === 'chat') {
      var memCount = Math.min(3, Math.floor(session.messages.filter(function (m) { return m.role === 'assistant'; }).length));
      left = '<div class="topbar__title">' + U.esc(session.title) + '</div>' +
        '<div class="topbar__chips">' +
        '<button class="chip chip--toggle' + (session.scope === 'shared' ? ' is-on' : '') + '" data-act="scope">' +
        U.icon(session.scope === 'shared' ? 'users' : 'lock', 11) + (session.scope === 'shared' ? '共享学习' : '仅个人') + '</button>' +
        '<span class="chip chip--soft">' + U.icon('clock', 11) + '记忆 ' + memCount + ' / ' + S.state.settings.maxContextTurns + ' 轮</span>' +
        '<span class="chip chip--soft">' + U.icon('cloud', 11) + U.esc(S.state.settings.model) + '</span>' +
        '</div>';
    } else if (page === 'library') {
      left = '<div class="topbar__title">问答库</div><div class="topbar__chips">' +
        '<span class="chip chip--soft">' + U.icon('users', 11) + '共享 + 个人</span></div>';
    } else if (page === 'governance') {
      left = '<div class="topbar__title">审核与治理</div><div class="topbar__chips">' +
        '<span class="chip chip--soft">' + U.icon(S.isAdmin() ? 'users' : 'lock', 11) + (S.isAdmin() ? '库管理员' : '普通成员 · 只读') + '</span>' +
        '<span class="chip chip--soft">' + U.icon('flag', 11) + '待处理 ' + (S.governance().metrics.open + S.governance().metrics.pendingRev) + '</span></div>';
    } else if (page === 'usage') {
      left = '<div class="topbar__title">用量与成本</div><div class="topbar__chips">' +
        '<span class="chip chip--soft">' + U.icon('cloud', 11) + '仿真计量</span></div>';
    } else {
      left = '<div class="topbar__title">设置</div><div class="topbar__chips">' +
        '<span class="chip chip--soft">' + U.icon('gear', 11) + '匹配 / 学习 / 云端</span></div>';
    }

    els.topbar.innerHTML = '<div class="topbar__left">' + left + '</div><div class="topbar__right">' + right + '</div>';

    els.topbar.querySelectorAll('[data-user]').forEach(function (b) {
      b.addEventListener('click', function () { A.setUser(b.getAttribute('data-user')); });
    });
    var th = els.topbar.querySelector('[data-act="theme"]');
    if (th) th.addEventListener('click', A.toggleTheme);
    var gd = els.topbar.querySelector('[data-act="guide"]');
    if (gd) gd.addEventListener('click', function () { App.demo.open(); });
    var ins = els.topbar.querySelector('[data-act="ins"]');
    if (ins) ins.addEventListener('click', A.toggleInspector);
    var navBtn = els.topbar.querySelector('[data-act="nav"]');
    if (navBtn) navBtn.addEventListener('click', function () { document.body.classList.toggle('nav-open'); });
    var sc = els.topbar.querySelector('[data-act="scope"]');
    if (sc) sc.addEventListener('click', function () {
      var s = S.currentSession();
      s.scope = s.scope === 'shared' ? 'personal' : 'shared';
      S.save(true);
      A.refreshTopbar();
      A.go('chat');
      U.toast(s.scope === 'shared' ? '这条会话会贡献到共享库' : '这条会话只写入个人库', { kind: 'info' });
    });
  };

  A.toggleTheme = function () {
    S.state.theme = S.state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = S.state.theme;
    S.save(true);
    A.refreshTopbar();
  };

  A.toggleInspector = function () {
    A.insOpen = !A.insOpen;
    document.body.setAttribute('data-ins', A.insOpen ? 'on' : 'off');
    A.refreshTopbar();
  };

  A.setUser = function (id) {
    if (id === S.state.userId) return;
    var u = S.userById(id);
    S.switchUser(id);
    A.refreshAll();
    U.toast('已切换到 ' + u.name, {
      kind: 'info',
      detail: id === 'u-b' ? '共享库的记录可以复用，用户 A 的个人库记录对你不可见' : '个人库 + 共享库都可访问'
    });
  };

  A.newChat = function () {
    S.createSession(S.state.userId, { scope: S.state.settings.defaultScope, activate: true });
    A.go('chat');
    A.refreshSidebar();
    var input = U.$('#chat-input');
    if (input) input.focus();
  };

  A.go = function (page, opts) {
    opts = opts || {};
    if (['chat', 'library', 'governance', 'usage', 'settings'].indexOf(page) < 0) page = 'chat';
    S.state.page = page;
    S.setPage(page);
    document.body.setAttribute('data-page', page);
    A.refreshTopbar();
    A.refreshSidebar();

    if (page === 'chat') {
      els.view.className = 'view view--chat';
      App.views.chat.mount(els.view);
      var session = S.currentSession();
      var lastTrace = null;
      for (var i = session.messages.length - 1; i >= 0; i--) {
        if (session.messages[i].meta && session.messages[i].meta.trace) { lastTrace = session.messages[i].meta.trace; break; }
      }
      App.inspector.show(lastTrace, { live: false });
    } else {
      els.view.className = 'view view--page';
      if (page === 'library') {
        App.views.library.mount(els.view);
        if (opts.recordId) App.views.library.focus(opts.recordId);
      } else if (page === 'governance') {
        App.views.governance.mount(els.view);
      } else if (page === 'usage') {
        App.views.usage.mount(els.view);
      } else {
        App.views.settings.mount(els.view);
      }
      els.view.scrollTop = 0;
    }
    document.body.setAttribute('data-ins', (A.insOpen && page === 'chat') ? 'on' : 'off');
  };

  A.refreshAll = function () {
    A.refreshSidebar();
    A.refreshTopbar();
    A.go(S.state.page || 'chat');
  };

  document.addEventListener('DOMContentLoaded', function () {
    A.boot();
  });
})();
