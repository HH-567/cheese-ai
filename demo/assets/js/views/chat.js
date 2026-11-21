/* 柒柿AI · 纯前端演示 — 聊天页 */
(function () {
  'use strict';
  var App = window.App, U = App.util, S = App.store, M = App.matcher, E = App.engine, T = App.tools;
  var V = (App.views = App.views || {});
  var chat = (V.chat = {});
  var busy = false;
  var els = {};

  function esc(s) { return U.esc(s); }
  function groupOf(meta) { return meta && meta.groupId ? S.groupById(meta.groupId) : null; }
  function versionOf(meta) {
    var g = groupOf(meta);
    if (!g || !meta.versionId) return null;
    return S.versionById(g, meta.versionId);
  }

  chat.mount = function (root) {
    var session = S.currentSession();
    busy = false;
    els = {};
    root.innerHTML =
      '<div class="chat">' +
      '<div class="chat__scroll" id="chat-scroll"><div class="chat__inner" id="chat-inner"></div></div>' +
      '<div class="composer" id="composer"></div>' +
      '</div>';
    els.scroll = U.$('#chat-scroll');
    els.inner = U.$('#chat-inner');
    els.composer = U.$('#composer');
    chat.renderMessages(session);
    chat.renderComposer();
    bind();
    scrollBottom(true);
  };

  /* ------------------------------ 来源 / 版本 / 表达 ------------------------------ */
  function sourcePill(meta) {
    if (!meta) return '';
    if (meta.error) return '<span class="pill pill--err">' + U.icon('alert', 12) + '云端不可用</span>';
    if (meta.clarify) return '<span class="pill pill--local">' + U.icon('chat', 12) + '本地追问 · 0 次云端</span>';
    if (meta.source === 'tool') {
      var kind = meta.tool && meta.tool.kind === 'calc' ? '计算器' : meta.tool && meta.tool.kind === 'clock' ? '时钟' : '日期';
      return '<span class="pill pill--tool">' + U.icon('bolt', 12) + '本地工具 · ' + kind + ' · 0 次云端</span>';
    }
    if (meta.stale) return '<span class="pill pill--warn">' + U.icon('alert', 12) + '待核对 · 缓存的版本已超复核间隔</span>';
    if (meta.source === 'library') {
      var v = versionOf(meta);
      var label = meta.matchType === 'exact' ? '原问命中' : meta.matchType === 'alias' ? '已收录改写' : '语义匹配 ' + (meta.score || 0).toFixed(2);
      return '<span class="pill pill--lib">' + U.icon('library', 12) + '问答库 · ' + label + (v ? ' · v' + v.n : '') + '</span>';
    }
    if (meta.source === 'cloud') return '<span class="pill pill--cloud">' + U.icon('cloud', 12) + '本次云端生成</span>';
    return '';
  }

  function variantPill(meta) {
    if (!meta || !meta.variantId) return '';
    var g = groupOf(meta);
    var v = g ? S.variantById(g, meta.variantId) : null;
    return '<span class="pill pill--ghost">' + U.icon('layers', 11) + '表达：' + esc(E.variantLabel(v ? v.style : '')) + '</span>';
  }

  function usageText(meta) {
    if (!meta || !meta.usage) return '';
    var u = meta.usage;
    if (meta.error) return '失败 · 0 次云端调用';
    if (meta.clarify) return '0 次云端调用 · ' + (u.totalMs || 0) + ' ms';
    if (!u.cloudCalls) {
      var suffix = meta.source === 'tool' ? '本地计算' : meta.stale ? '等待核对' : '本地读取';
      return '0 次云端调用 · ' + (u.totalMs || 0) + ' ms · ' + suffix;
    }
    return '1 次云端调用 · 首字 ' + (u.firstTokenMs / 1000).toFixed(2) + ' s · 总耗时 ' + (u.totalMs / 1000).toFixed(2) + ' s · ' + U.fmtMoney(u.cost);
  }

  function footHTML(msg) {
    var meta = msg.meta;
    if (!meta) return '';
    var actions = [];
    actions.push('<button class="act" data-action="copy-answer">' + U.icon('copy', 13) + '复制</button>');

    if (meta.source === 'library' && !meta.stale) {
      var g = groupOf(meta);
      var variants = g ? S.variantsOf(g, meta.versionId) : [];
      if (variants.length) {
        actions.push('<button class="act" data-action="variant">' + U.icon('layers', 13) + '换个说法' + (variants.length ? '<em class="act__num">' + variants.length + '</em>' : '') + '</button>');
      }
      actions.push('<button class="act" data-action="source">' + U.icon('library', 13) + '查看来源</button>');
      actions.push('<button class="act" data-action="retry">' + U.icon('refresh', 13) + '重新问云端</button>');
      actions.push('<button class="act act--warn" data-action="report">' + U.icon('flag', 13) + '报告误答</button>');
    } else if (meta.source === 'tool') {
      actions.push('<button class="act" data-action="source">' + U.icon('info', 13) + '来源</button>');
    } else if (meta.source === 'cloud') {
      if (meta.reAskOf) {
        var rg = S.groupById(meta.reAskOf.groupId);
        if (rg) {
          if (meta.adoptedVersionId) {
            // 已采用
          } else if (meta.publishedVersionId) {
            // 已发布
          } else if (meta.revisionId) {
            // 建议已提交
          } else if (rg.scope === 'personal') {
            actions.push('<button class="act act--primary" data-action="adopt">' + U.icon('check', 13) + '采用为新版本</button>');
          } else if (S.isAdmin()) {
            actions.push('<button class="act act--primary" data-action="publish">' + U.icon('check', 13) + '发布为新版本</button>');
          } else {
            actions.push('<button class="act act--primary" data-action="suggest">' + U.icon('edit', 13) + '建议修订</button>');
          }
          actions.push('<button class="act" data-action="keep">保留原版</button>');
        }
      }
      actions.push('<button class="act" data-action="retry">' + U.icon('refresh', 13) + '重新问云端</button>');
      actions.push('<button class="act" data-action="source">' + U.icon('info', 13) + '来源</button>');
      if (meta.learnedGroupId) {
        actions.push('<button class="act act--warn" data-action="report-cloud">' + U.icon('flag', 13) + '报告误答</button>');
      }
    } else if (meta.stale) {
      actions.push('<button class="act act--primary" data-action="refresh">' + U.icon('refresh', 13) + '去核对（模拟）</button>');
      actions.push('<button class="act" data-action="source">' + U.icon('info', 13) + '查看来源</button>');
      actions.push('<button class="act" data-action="retry">' + U.icon('refresh', 13) + '直接问云端</button>');
    } else if (meta.error) {
      actions.push('<button class="act act--primary" data-action="retry">' + U.icon('refresh', 13) + '重试</button>');
    }

    var learnChip = '';
    if (meta.learnedGroupId) {
      var rec = S.groupById(meta.learnedGroupId);
      if (rec) {
        learnChip = rec.status === 'learning'
          ? '<span class="pill pill--learning">' + U.icon('cpu', 12) + '后台生成等价问法…</span>'
          : '<span class="pill pill--learn">' + U.icon('check', 12) + '已入库 · ' + ((rec.aliases || []).filter(function (a) { return a.status === 'active'; }).length) + ' 条问法</span>';
      }
    }
    var stateChip = '';
    if (meta.adoptedVersionId) stateChip = '<span class="pill pill--ok">' + U.icon('check', 11) + '已采用为新版本</span>';
    if (meta.publishedVersionId) stateChip = '<span class="pill pill--ok">' + U.icon('check', 11) + '已发布为新版本</span>';
    if (meta.revisionId) stateChip = '<span class="pill pill--learn">' + U.icon('clock', 11) + '修订建议待审核</span>';
    if (meta.keptOriginal) stateChip = '<span class="pill pill--muted">保留原版</span>';

    return '<div class="turn__foot">' + sourcePill(meta) + variantPill(meta) + learnChip + stateChip +
      '<span class="turn__usage">' + usageText(meta) + '</span>' +
      (actions.length ? '<div class="turn__acts">' + actions.join('') + '</div>' : '') +
      '</div>';
  }

  function turnHTML(msg, opts) {
    opts = opts || {};
    if (msg.role === 'user') {
      return '<article class="turn turn--user" data-msg="' + msg.id + '">' +
        '<div class="bubble">' + esc(msg.content).replace(/\n/g, '<br>') + '</div>' +
        '</article>';
    }
    var body = '';
    if (msg.meta && msg.meta.error) {
      body = '<div class="ans-error">' +
        '<div class="ans-error__title">' + U.icon('alert', 15) + esc(msg.meta.error.title) + '</div>' +
        '<p>' + esc(msg.meta.error.message) + '</p>' +
        '<button class="btn btn--small btn--primary" data-action="retry">' + U.icon('refresh', 13) + '重试这次请求</button>' +
        '</div>';
    } else if (msg.content) {
      body = '<div class="prose">' + App.md.render(msg.content) + '</div>';
    } else {
      body = '<div class="prose"><div class="skeleton"><i></i><i></i><i class="short"></i></div>' +
        '<div class="live-status" data-live>' + U.icon('cpu', 13) + '<span>正在本地检索问答库…</span></div></div>';
    }
    return '<article class="turn turn--bot" data-msg="' + msg.id + '">' +
      '<div class="turn__avatar">' + U.icon('spark', 15) + '</div>' +
      '<div class="turn__body">' + body +
      '<div data-foot>' + (msg.content || (msg.meta && msg.meta.error) ? footHTML(msg) : '') + '</div>' +
      '</div></article>';
  }

  chat.renderMessages = function (session) {
    if (!els.inner) return;
    if (!session.messages.length) {
      els.inner.innerHTML = emptyHTML();
      return;
    }
    els.inner.innerHTML = session.messages.map(function (m) { return turnHTML(m); }).join('');
    scrollBottom(true);
  };

  function previewOf(text) {
    var det = T.detect(text, S.state.settings);
    if (det) return { path: 'tool', label: '本地工具 · 0 调用', score: 1 };
    var blocked = E.blockReason;
    var p = M.preview(text, S.matchableRecords(), S.state.settings.threshold, function (rec, key) {
      return blocked(rec, key);
    });
    return p;
  }

  function emptyHTML() {
    var records = S.matchableRecords();
    var th = S.state.settings.threshold;
    var cards = App.seed.starters.map(function (s) {
      var p = previewOf(s.text);
      var badge, cls;
      if (p.path === 'tool') { badge = '本地工具 · 0 调用'; cls = 'tool'; }
      else if (p.path === 'cloud') { badge = p.label || '云端生成'; cls = 'cloud'; }
      else {
        badge = (p.path === 'exact' ? '原问命中' : p.path === 'alias' ? '已收录改写' : '语义 ' + p.score.toFixed(2)) + ' · 0 调用';
        cls = 'lib';
      }
      return '<button class="starter" data-action="starter" data-text="' + esc(s.text) + '">' +
        '<span class="starter__tag">' + esc(s.tag) + '</span>' +
        '<span class="starter__text">' + esc(App.md.plain(s.text)) + '</span>' +
        '<span class="starter__badge starter__badge--' + cls + '">' + U.icon(cls === 'lib' ? 'library' : cls === 'tool' ? 'bolt' : 'cloud', 11) + esc(badge) + '</span>' +
        '</button>';
    }).join('');
    return '<div class="empty">' +
      '<div class="empty__mark">' + U.icon('spark', 26) + '</div>' +
      '<h1 class="empty__title">今天想弄明白什么？</h1>' +
      '<p class="empty__sub">先查问答库，答过的问题零成本复用；日期和算术本地现算；没见过的才交给云端，答完自动入库。</p>' +
      '<div class="starters">' + cards + '</div>' +
      '<div class="empty__hint"><button class="link" data-action="guide">打开三分钟演示脚本 ' + U.icon('arrow', 12) + '</button>' +
      '<span class="dotsep">·</span><span>命中问答库或本地工具时不会产生云端调用</span></div>' +
      '</div>';
  }

  /* ------------------------------ 输入区 ------------------------------ */
  function suggestionsHTML() {
    var session = S.currentSession();
    var lastBot = null;
    for (var i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'assistant') { lastBot = session.messages[i]; break; }
    }
    var items = [];
    if (lastBot && lastBot.meta && lastBot.meta.options && lastBot.meta.options.length >= 2) {
      items.push({ text: '这两个哪个好？', tag: '会话内追问' });
      items.push({ text: '第二个呢？', tag: '沿用上文' });
    } else if (lastBot && lastBot.meta && lastBot.meta.source === 'tool') {
      items.push({ text: '明天星期一还是星期二？', tag: '再算一次' });
      items.push({ text: '现在几点？', tag: '本地时钟' });
    } else if (!session.messages.length) {
      items = [];
    } else if (lastBot && lastBot.meta && lastBot.meta.source === 'library') {
      items.push({ text: '换个说法，简短一点', tag: '表达变体' });
      items.push({ text: '能举个具体的例子吗？', tag: '补充说明' });
    } else {
      items.push({ text: '能举个具体的例子吗？', tag: '补充说明' });
      items.push({ text: '再详细说说为什么', tag: '追问' });
    }
    if (!items.length) return '';
    return '<div class="suggests">' + items.map(function (it) {
      return '<button class="suggest" data-action="suggest" data-text="' + esc(it.text) + '">' +
        '<span class="suggest__text">' + esc(it.text) + '</span><span class="suggest__tag">' + esc(it.tag) + '</span></button>';
    }).join('') + '</div>';
  }

  chat.renderComposer = function () {
    if (!els.composer) return;
    var session = S.currentSession();
    var scope = session.scope || 'shared';
    els.composer.innerHTML =
      '<div class="composer__inner">' +
      suggestionsHTML() +
      '<div class="composer__box">' +
      '<textarea id="chat-input" class="composer__input" rows="1" placeholder="输入问题，Enter 发送 · Shift + Enter 换行"></textarea>' +
      '<div class="composer__bar">' +
      '<div class="composer__meta">' +
      '<button class="chip chip--toggle' + (scope === 'shared' ? ' is-on' : '') + '" data-action="scope" title="切换这条会话的学习范围">' +
      U.icon(scope === 'shared' ? 'users' : 'lock', 12) + (scope === 'shared' ? '共享学习' : '仅个人') + '</button>' +
      '<span class="chip chip--soft">' + U.icon('cpu', 12) + 'CPU 先查库</span>' +
      '<span class="chip chip--soft">' + U.icon('globe', 12) + esc(S.state.settings.timeZone) + '</span>' +
      '<span class="chip chip--soft">' + U.icon('cloud', 12) + esc(S.state.settings.model) + '</span>' +
      '</div>' +
      '<div class="composer__send">' +
      '<button class="icon-btn icon-btn--stop" data-action="stop" title="停止生成" hidden>' + U.icon('stop', 14) + '</button>' +
      '<button class="btn btn--send" data-action="send" title="发送 (Enter)">' + U.icon('send', 15) + '<span>发送</span></button>' +
      '</div></div></div>' +
      '<div class="composer__hint"><span>' + (scope === 'shared'
        ? '共享学习：这次问答通过检查后会对同一测试库的其他成员可见'
        : '仅个人：这条会话产生的问答只存在你的个人库里') + '</span></div>' +
      '</div>';
    autoGrow(U.$('#chat-input'));
    U.$('#chat-input').focus();
  };

  function autoGrow(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(180, Math.max(24, ta.scrollHeight)) + 'px';
  }

  chat.refreshSuggestions = function () {
    var s = U.$('.suggests', els.composer);
    var html = suggestionsHTML();
    if (s) s.outerHTML = html || '<div class="suggests" hidden></div>';
    else if (html) els.composer.querySelector('.composer__inner').insertAdjacentHTML('afterbegin', html);
  };

  /* ------------------------------ 发送 ------------------------------ */
  function setBusy(v) {
    busy = v;
    var stop = U.$('[data-action="stop"]', els.composer);
    var send = U.$('[data-action="send"]', els.composer);
    if (stop) stop.hidden = !v;
    if (send) send.classList.toggle('is-loading', v);
    document.body.classList.toggle('is-busy', v);
  }

  function scrollBottom(force) {
    if (!els.scroll) return;
    var nearBottom = els.scroll.scrollHeight - els.scroll.scrollTop - els.scroll.clientHeight < 180;
    if (force || nearBottom) els.scroll.scrollTop = els.scroll.scrollHeight;
  }

  function appendTurn(msg, opts) {
    if (U.$('.empty', els.inner)) els.inner.innerHTML = '';
    els.inner.insertAdjacentHTML('beforeend', turnHTML(msg, opts));
    var el = els.inner.lastElementChild;
    scrollBottom(true);
    return el;
  }

  function updateLive(el, trace) {
    var live = U.$('[data-live]', el);
    if (!live) return;
    var last = trace.steps[trace.steps.length - 1];
    if (!last) return;
    var icon = last.key === 'cloud' ? 'cloud' : last.key === 'tool' ? 'bolt' : 'cpu';
    live.innerHTML = U.icon(icon, 13) + '<span>' + esc(last.label + ' · ' + last.detail) + '</span>';
    live.classList.toggle('is-run', last.state === 'run');
  }

  async function send(text, opts) {
    opts = opts || {};
    if (busy) return;
    text = String(text || '').trim();
    if (!text) return;
    var session = S.currentSession();
    if (!opts.silent) {
      var um = { id: U.uid('m'), role: 'user', content: text, at: Date.now() };
      session.messages.push(um);
      S.touchSession(session);
      appendTurn(um);
      if (App.app) { App.app.refreshSidebar(); App.app.refreshTopbar(); }
    }
    var bm = { id: U.uid('m'), role: 'assistant', content: '', at: Date.now(), meta: null };
    session.messages.push(bm);
    var bEl = appendTurn(bm);
    setBusy(true);
    chat.refreshSuggestions();

    var pending = '';
    var rafId = 0;
    function flush() {
      rafId = 0;
      var prose = U.$('.prose', bEl);
      if (!prose) return;
      prose.innerHTML = App.md.renderStreaming(pending) + '<span class="caret"></span>';
      var live = U.$('[data-live]', bEl);
      if (live) live.remove();
      scrollBottom(false);
    }

    await E.run({
      session: session,
      text: text,
      msg: bm,
      forceCloud: !!opts.forceCloud,
      reAsk: opts.reAsk || null,
      sink: {
        onTrace: function (trace) {
          if (bm.meta && bm.meta.error) return;
          if (!bm.content) updateLive(bEl, trace);
          if (App.inspector) App.inspector.show(trace, { live: true });
        },
        onToken: function (partial) {
          bm.content = partial;
          pending = partial;
          if (!rafId) rafId = requestAnimationFrame(flush);
        },
        onDone: function (meta) {
          if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
          finishTurn(bEl, bm);
        }
      }
    });
    setBusy(false);
    chat.refreshSuggestions();
    if (App.app) { App.app.refreshSidebar(); App.app.refreshTopbar(); }
    var input = U.$('#chat-input');
    if (input) input.focus();
  }

  function finishTurn(el, msg) {
    var meta = msg.meta || {};
    var prose = U.$('.prose', el);
    if (meta.error) {
      var body = U.$('.turn__body', el);
      body.innerHTML = '<div class="ans-error"><div class="ans-error__title">' + U.icon('alert', 15) + esc(meta.error.title) + '</div>' +
        '<p>' + esc(meta.error.message) + '</p>' +
        '<button class="btn btn--small btn--primary" data-action="retry">' + U.icon('refresh', 13) + '重试这次请求</button></div>' +
        '<div data-foot>' + footHTML(msg) + '</div>';
    } else if (prose) {
      prose.innerHTML = App.md.render(msg.content);
      var foot = U.$('[data-foot]', el);
      if (foot) foot.innerHTML = footHTML(msg);
    }
    el.classList.remove('is-pending');
    scrollBottom(false);
    if (App.inspector) App.inspector.show(meta.trace || null, { live: false });
    S.save(true);
  }

  /* ------------------------------ 动作 ------------------------------ */
  function findMsg(id) {
    var s = S.currentSession();
    return s.messages.filter(function (m) { return m.id === id; })[0] || null;
  }

  function retryCloud(msg) {
    var s = S.currentSession();
    var idx = s.messages.indexOf(msg);
    var userText = '';
    for (var i = idx - 1; i >= 0; i--) {
      if (s.messages[i].role === 'user') { userText = s.messages[i].content; break; }
    }
    if (!userText) { U.toast('找不到对应的问题', { kind: 'warn' }); return; }
    var gid = msg.meta && (msg.meta.groupId || msg.meta.learnedGroupId);
    var reAsk = gid ? {
      groupId: gid, versionId: msg.meta.versionId || null, variantId: msg.meta.variantId || null
    } : null;
    U.toast('已跳过问答库，直接问云端', { kind: 'info', detail: reAsk ? '重新生成不会计入误答票，个人库所有者可采用为新版本，共享库成员可提交修订建议' : '' });
    send(userText, { forceCloud: true, silent: true, reAsk: reAsk });
  }

  function openVariant(msg) {
    var g = groupOf(msg.meta);
    if (!g) return;
    var variants = S.variantsOf(g, msg.meta.versionId);
    var items = [{ id: null, label: '标准表达', on: !msg.meta.variantId }].concat(variants.map(function (v) {
      return { id: v.id, label: E.variantLabel(v.style) + '表达', on: msg.meta.variantId === v.id, hint: App.md.plain(v.text).slice(0, 26) + '…' };
    }));
    var btn = U.$('[data-action="variant"]', U.$('[data-msg="' + msg.id + '"]', els.inner));
    U.menu(btn, items, function (pick) {
      var ok = E.useVariant(msg, pick.id);
      if (!ok) return;
      var el = U.$('[data-msg="' + msg.id + '"]', els.inner);
      var prose = U.$('.prose', el);
      if (prose) prose.innerHTML = App.md.render(msg.content);
      var foot = U.$('[data-foot]', el);
      if (foot) foot.innerHTML = footHTML(msg);
      U.toast(pick.id ? '已切换到「' + pick.label + '」· 0 次云端调用' : '已切回标准表达 · 0 次云端调用', {
        kind: 'ok', detail: '同一事实版本下的合格答法，事实结论、适用条件和时效一致'
      });
    });
  }

  function openSource(msg) {
    var meta = msg.meta || {};
    var g = groupOf(meta);
    var body;
    if (meta.source === 'tool') {
      body = '<div class="src">' +
        '<div class="src__row"><span>来源</span><b>本地工具（' + esc(meta.tool ? meta.tool.kind : '') + '）</b></div>' +
        '<div class="src__row"><span>计算方式</span><b>' + esc(meta.tool ? meta.tool.detail : '—') + '</b></div>' +
        '<div class="src__row"><span>时区</span><b>' + esc(S.state.settings.timeZone) + '</b></div>' +
        '<div class="src__row"><span>本地耗时</span><b>' + (meta.usage.totalMs || 0) + ' ms</b></div>' +
        '<div class="src__note">' + U.icon('bolt', 13) + '工具结果每次按输入现算，只写进会话；问答库里只保留「这个问题走工具」的路由。</div>' +
        '</div>';
    } else if (meta.source === 'library' && g) {
      var v = versionOf(meta);
      var variants = S.variantsOf(g, meta.versionId);
      var aliases = (g.aliases || []).filter(function (a) { return a.status === 'active'; });
      body = '<div class="src">' +
        '<div class="src__row"><span>来源</span><b>问答库（' + (g.scope === 'shared' ? S.library().name : '个人库') + '）</b></div>' +
        '<div class="src__row"><span>命中方式</span><b>' + (meta.matchType === 'exact' ? '原问精确命中' : meta.matchType === 'alias' ? '已收录等价问法' : '语义匹配 · ' + (meta.score || 0).toFixed(2)) + '</b></div>' +
        '<div class="src__row"><span>版本 / 表达</span><b>' + (v ? 'v' + v.n + '（' + esc(v.basis) + '）' : '—') + ' · ' + (meta.variantId ? '变体' : '默认表达') + '</b></div>' +
        '<div class="src__row"><span>问题组</span><b class="mono">' + esc(g.id) + '</b></div>' +
        '<div class="src__row"><span>更新时间</span><b>' + esc(U.fmtAgo(g.updatedAt)) + ' · 命中 ' + g.hits + ' 次</b></div>' +
        '<div class="src__row"><span>时效</span><b>' + (g.freshness && g.freshness.kind === 'versioned'
          ? '来源版本 ' + esc(g.freshness.sourceVersion || '—') + ' · 下次复核 ' + U.date(g.freshness.reviewAt || Date.now())
          : '稳定事实 · 无日历到期任务') + '</b></div>' +
        '<div class="src__label">原问</div><div class="src__q">' + App.md.render(g.original) + '</div>' +
        '<div class="src__label">同一问题组里的其他问法</div>' +
        '<div class="src__aliases">' + (aliases.length ? aliases.map(function (a) {
          return '<span class="alias' + (M.normalize(a.text) === M.normalize(meta.matchedAlias || '') ? ' alias--hit' : '') + '">' + esc(a.text) + '</span>';
        }).join('') : '<span class="muted">暂无</span>') + '</div>' +
        (variants.length ? '<div class="src__label">同版本的表达变体</div><div class="src__aliases">' +
          variants.map(function (x) { return '<span class="alias">' + esc(E.variantLabel(x.style)) + '表达</span>'; }).join('') + '</div>' : '') +
        '<div class="src__note">' + U.icon('library', 13) + '这条回答由 CPU 直接从库里读出，没有调用云端模型。</div>' +
        '</div>';
    } else if (meta.stale && g) {
      var f = g.freshness || {};
      body = '<div class="src">' +
        '<div class="src__row"><span>状态</span><b>超过复核间隔，暂无法确认当前值</b></div>' +
        '<div class="src__row"><span>记录来源</span><b>' + esc(f.source || '—') + '</b></div>' +
        '<div class="src__row"><span>来源版本</span><b class="mono">' + esc(f.sourceVersion || '—') + '</b></div>' +
        '<div class="src__row"><span>上次核对</span><b>' + (f.reviewAt ? U.date(f.reviewAt) : '—') + '</b></div>' +
        '<div class="src__row"><span>检查结果</span><b>' + (S.isStale(g) ? '已过期' : '已恢复可用') + '</b></div>' +
        '<div class="src__note">' + U.icon('clock', 13) + '到期不会定时刷新：等下一次有人问再核对，同一来源版本同时只允许一个在途核对任务。</div>' +
        '</div>';
    } else if (meta.error) {
      body = '<div class="src"><div class="src__row"><span>状态</span><b>请求失败</b></div>' +
        '<div class="src__row"><span>原因</span><b>' + esc(meta.error.message) + '</b></div></div>';
    } else {
      body = '<div class="src">' +
        '<div class="src__row"><span>来源</span><b>本次云端生成（' + esc(S.state.settings.model) + '）</b></div>' +
        '<div class="src__row"><span>首次出字</span><b>' + (meta.usage.firstTokenMs / 1000).toFixed(2) + ' s</b></div>' +
        '<div class="src__row"><span>总耗时</span><b>' + (meta.usage.totalMs / 1000).toFixed(2) + ' s</b></div>' +
        '<div class="src__row"><span>Token</span><b class="mono">' + meta.usage.tokensIn + ' in / ' + meta.usage.tokensOut + ' out</b></div>' +
        '<div class="src__row"><span>本次费用</span><b class="mono">' + U.fmtMoney(meta.usage.cost) + '</b></div>' +
        (meta.learnedGroupId ? '<div class="src__row"><span>已入库</span><b class="mono">' + esc(meta.learnedGroupId) + ' · v1</b></div>' : '') +
        (meta.reAskOf ? '<div class="src__row"><span>本轮性质</span><b>重新问云端 · 不计入误答票</b></div>' : '') +
        '<div class="src__note">' + U.icon('cloud', 13) + '这次回答没有命中问答库，由云端模型生成。回答结束后系统在后台检查并生成等价问法。</div>' +
        '</div>';
    }
    U.modal({ title: '回答来源', body: body, actions: [{ label: '知道了', kind: 'primary' }] });
  }

  /* ------------------------------ 报告误答 ------------------------------ */
  var REPORT_KINDS = [
    { id: 'fact', label: '事实有误', note: '针对这一版答案的事实结论' },
    { id: 'mismatch', label: '答非所问', note: '针对「这次问法」和问题组的匹配关系' },
    { id: 'style', label: '表达不合适', note: '换个说法就行，不算误答' }
  ];

  function reportTargets(meta, category) {
    var type = category === 'mismatch' ? 'match' : 'version';
    var key = type === 'version'
      ? 'g:' + meta.groupId + ':v:' + meta.versionId
      : 'g:' + meta.groupId + ':m:' + U.key(meta.matchedAlias || (meta.trace && meta.trace.query) || '');
    return { type: type, key: key };
  }

  function openReport(msg) {
    var meta = msg.meta || {};
    if (!meta.groupId) { U.toast('这条回答还不能报告（没有入库）', { kind: 'warn' }); return; }
    var g = S.groupById(meta.groupId);
    var th = S.state.settings.pauseThreshold || 3;
    var vVotes = S.votesFor(reportTargets(meta, 'fact').key).count;
    var mVotes = S.votesFor(reportTargets(meta, 'mismatch').key).count;

    U.modal({
      title: '报告这条回答有问题',
      width: 560,
      body: '<p class="modal__text">报告会定位到具体对象：事实有误指向这一版答案，答非所问指向这次匹配关系，表达不合适只影响你自己看到的说法。</p>' +
        '<div class="radio-list radio-list--rich">' + REPORT_KINDS.map(function (r, i) {
          var count = r.id === 'fact' ? vVotes : r.id === 'mismatch' ? mVotes : 0;
          return '<label class="radio radio--rich"><input type="radio" name="rkind" value="' + r.id + '"' + (i === 0 ? ' checked' : '') + '>' +
            '<span><b>' + r.label + '</b><em>' + r.note + '</em></span>' +
            (r.id !== 'style' ? '<span class="radio__votes">' + count + '/' + th + ' 票</span>' : '') +
            '</label>';
        }).join('') + '</div>' +
        '<textarea class="field field--area" data-report-note rows="3" placeholder="补充说明（可选）"></textarea>' +
        '<div class="modal__hint">' + U.icon('info', 13) + '从第一条报告起，你后续的请求会自动绕开这个对象；共享库滚动 ' +
        (S.state.settings.pauseWindowDays || 7) + ' 天内 ' + th + ' 名不同成员报告同一对象才会临时暂停，重复提交只算 1 人。</div>',
      actions: [
        { label: '取消' },
        {
          label: '提交报告', kind: 'primary', onClick: function (wrap) {
            var sel = wrap.querySelector('input[name="rkind"]:checked');
            var note = wrap.querySelector('[data-report-note]');
            var category = sel ? sel.value : 'fact';
            var res = E.report(meta, category, note ? note.value : '');
            if (!res) return true;
            showReportResult(msg, category, res);
            return true;
          }
        }
      ]
    });
  }

  function showReportResult(msg, category, res) {
    var th = S.state.settings.pauseThreshold || 3;
    var title, text;
    if (category === 'style') {
      title = '已记录表达反馈';
      text = '这条反馈只影响你自己看到的说法，不算误答。可以试试「换个说法」里的其他表达。';
    } else if (res.suspension) {
      title = '已达到暂停阈值';
      text = '「' + (res.suspension.kind === 'match' ? '这次匹配关系' : '这一版答案') + '」现在有 ' + res.votes.count +
        ' 名已验证成员在 ' + (S.state.settings.pauseWindowDays || 7) + ' 天内报告，已临时暂停。之后这类请求会交给云端，直到管理员核查后恢复、修正或停用。';
    } else {
      title = '报告已提交';
      text = '这个对象目前有 ' + res.votes.count + '/' + th +
        ' 名已验证成员报告（7 天内、同一人只算 1 票）。按规则，你现在开始会绕开它；共享库达到 ' + th + ' 票会临时暂停。';
    }
    U.modal({
      title: title,
      body: '<p class="modal__text">' + esc(text) + '</p>' +
        '<div class="modal__hint">' + U.icon('flag', 13) + '重新生成本身不计误答票，看到新答案后再决定是否采用或修订。</div>',
      actions: [
        { label: '知道了' },
        { label: '当场重新问云端', kind: 'primary', onClick: function () { retryCloud(msg); } }
      ]
    });
  }

  /* ------------------------------ 事件 ------------------------------ */
  function bind() {
    els.scroll.addEventListener('click', function (e) {
      var copyCode = e.target.closest('[data-action="copy-code"]');
      if (copyCode) {
        var pre = copyCode.closest('.codeblock').querySelector('pre');
        U.copy(pre.textContent).then(function () {
          copyCode.classList.add('is-done');
          copyCode.querySelector('span').textContent = '已复制';
          setTimeout(function () {
            copyCode.classList.remove('is-done');
            copyCode.querySelector('span').textContent = '复制';
          }, 1400);
        });
        return;
      }
      var starter = e.target.closest('[data-action="starter"],[data-action="suggest"]');
      if (starter) {
        var t = starter.getAttribute('data-text');
        var input = U.$('#chat-input');
        if (input) input.value = t;
        send(t);
        return;
      }
      if (e.target.closest('[data-action="guide"]')) {
        if (App.demo) App.demo.open();
        return;
      }
      var act = e.target.closest('[data-action]');
      if (!act) return;
      var action = act.getAttribute('data-action');
      var turn = act.closest('.turn');
      var msg = turn ? findMsg(turn.getAttribute('data-msg')) : null;
      if (!msg) return;

      if (action === 'copy-answer') {
        U.copy(msg.content).then(function (ok) {
          U.toast(ok ? '回答已复制' : '复制失败，请手动选择', { kind: ok ? 'ok' : 'warn' });
        });
      } else if (action === 'retry') {
        retryCloud(msg);
      } else if (action === 'source') {
        openSource(msg);
      } else if (action === 'variant') {
        openVariant(msg);
      } else if (action === 'report' || action === 'report-cloud') {
        openReport(msg);
      } else if (action === 'refresh') {
        if (msg.meta.groupId) E.startRefresh(msg.meta.groupId);
      } else if (action === 'adopt') {
        E.adopt(msg);
        var el = U.$('[data-msg="' + msg.id + '"]', els.inner);
        var foot = el && U.$('[data-foot]', el);
        if (foot) foot.innerHTML = footHTML(msg);
        App.app.refreshSidebar();
      } else if (action === 'publish') {
        var gid = msg.meta.groupId || (msg.meta.reAskOf && msg.meta.reAskOf.groupId);
        var g = gid ? S.groupById(gid) : null;
        if (g) {
          var v = S.publishVersion(g.id, msg.content, { basis: '管理员发布 · 重新问云端的结果' });
          msg.meta.publishedVersionId = v.id;
          S.addUsage({
            id: U.uid('u'), at: Date.now(), ownerId: S.state.userId, sessionId: null,
            query: '发布修订：' + g.original.slice(0, 26), path: 'revision',
            cloudCalls: 0, totalMs: 0, cost: 0, ok: true
          });
          var el2 = U.$('[data-msg="' + msg.id + '"]', els.inner);
          var foot2 = el2 && U.$('[data-foot]', el2);
          if (foot2) foot2.innerHTML = footHTML(msg);
          U.toast('已发布为新版本 v' + v.n, { kind: 'ok', detail: '旧版本的全部表达已退出匹配，历史聊天仍保留当时的答复' });
          App.app.refreshSidebar();
        }
      } else if (action === 'suggest') {
        U.modal({
          title: '建议修订',
          width: 560,
          body: '<p class="modal__text">只有共享库管理员发布后，才会影响其他人的答案。之前只有你自己看到这份新答案。</p>' +
            '<textarea class="field field--area" data-rev-note rows="3" placeholder="依据（例如：官方文档 2026-11 更新）"></textarea>',
          actions: [
            { label: '取消' },
            {
              label: '提交建议', kind: 'primary', onClick: function (wrap) {
                var note = wrap.querySelector('[data-rev-note]');
                E.suggestRevision(msg, note ? note.value : '');
                var el3 = U.$('[data-msg="' + msg.id + '"]', els.inner);
                var foot3 = el3 && U.$('[data-foot]', el3);
                if (foot3) foot3.innerHTML = footHTML(msg);
                if (App.app) App.app.refreshSidebar();
                return true;
              }
            }
          ]
        });
      } else if (action === 'keep') {
        msg.meta.keptOriginal = true;
        var el4 = U.$('[data-msg="' + msg.id + '"]', els.inner);
        var foot4 = el4 && U.$('[data-foot]', el4);
        if (foot4) foot4.innerHTML = footHTML(msg);
        U.toast('已保留原版', { kind: 'info', detail: '这次的新答案只留在会话记录里' });
      }
    });

    els.composer.addEventListener('click', function (e) {
      var act = e.target.closest('[data-action]');
      if (!act) return;
      var action = act.getAttribute('data-action');
      if (action === 'send') { commit(); }
      else if (action === 'stop') { E.abort(); U.toast('已停止生成', { kind: 'info' }); }
      else if (action === 'scope') {
        var s = S.currentSession();
        s.scope = s.scope === 'shared' ? 'personal' : 'shared';
        S.save(true);
        chat.renderComposer();
        U.toast(s.scope === 'shared' ? '这条会话的问答可以贡献给共享库' : '这条会话的问答只进个人库', { kind: 'info' });
      } else if (action === 'suggest') {
        var t = act.getAttribute('data-text');
        var input = U.$('#chat-input');
        if (input) input.value = t;
        commit();
      }
    });

    els.composer.addEventListener('keydown', function (e) {
      if (e.target.id !== 'chat-input') return;
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        commit();
      }
    });

    els.composer.addEventListener('input', function (e) {
      if (e.target.id === 'chat-input') autoGrow(e.target);
    });
  }

  function commit() {
    var input = U.$('#chat-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    autoGrow(input);
    send(text);
  }

  chat.onLearnDone = function (rec) {
    var s = S.currentSession();
    s.messages.forEach(function (m) {
      if (m.meta && m.meta.learnedGroupId === rec.id) {
        var el = U.$('[data-msg="' + m.id + '"]', els.inner);
        if (el) {
          var foot = U.$('[data-foot]', el);
          if (foot) foot.innerHTML = footHTML(m);
        }
      }
    });
    U.toast('后台改写完成：' + ((rec.aliases || []).filter(function (a) { return a.status === 'active'; }).length) + ' 条等价问法已入库', {
      kind: 'ok',
      detail: '现在换个说法再问，会直接命中问答库、不调用云端'
    });
    if (App.app && S.state.page === 'chat') App.app.refreshSidebar();
  };

  chat.onMessageDone = function (payload) {
    if (!els.inner || !payload) return;
    var el = U.$('[data-msg="' + payload.msg.id + '"]', els.inner);
    if (el) finishTurn(el, payload.msg);
    else if (payload.session.id === S.state.sessionId) chat.renderMessages(payload.session);
  };

  chat.sendDemo = function (text) { return send(text); };
})();
