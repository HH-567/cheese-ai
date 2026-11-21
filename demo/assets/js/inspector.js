/* 柒柿AI · 纯前端演示 — 右侧请求追踪面板 */
(function () {
  'use strict';
  var App = window.App, U = App.util, S = App.store;
  var I = (App.inspector = {});
  I.trace = null;
  I.el = null;
  I.tab = 'trace';
  I.live = false;

  I.mount = function (el) {
    I.el = el;
    I.render();
  };

  I.show = function (trace, opts) {
    if (!I.el) return;
    if (trace) I.trace = trace;
    I.live = !!(opts && opts.live);
    if (!I.el.classList.contains('is-open')) I.el.classList.add('is-open');
    I.render();
  };

  I.setTab = function (tab) {
    I.tab = tab;
    I.render();
  };

  I.render = function () {
    if (!I.el) return;
    var trace = I.trace;
    I.el.innerHTML =
      '<div class="ins__head">' +
      '<div class="ins__title">' + U.icon('layers', 14) + '请求追踪</div>' +
      '<div class="ins__tabs">' +
      ['trace', 'memory', 'usage'].map(function (t) {
        return '<button class="ins__tab' + (I.tab === t ? ' is-on' : '') + '" data-ins-tab="' + t + '">' +
          (t === 'trace' ? '管线' : t === 'memory' ? '记忆' : '会话用量') + '</button>';
      }).join('') +
      '</div></div>' +
      '<div class="ins__body">' + (I.tab === 'trace' ? traceHTML(trace) : I.tab === 'memory' ? memoryHTML() : usageHTML()) + '</div>';
    bind();
  };

  function bind() {
    if (!I.el) return;
    I.el.querySelectorAll('[data-ins-tab]').forEach(function (b) {
      b.addEventListener('click', function () { I.setTab(b.getAttribute('data-ins-tab')); });
    });
    I.el.querySelectorAll('[data-jump]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-jump');
        if (App.app) App.app.go('library', { recordId: id });
      });
    });
  }

  function decisionPill(t) {
    if (!t) return '<span class="pill pill--muted">待请求</span>';
    if (t.decision === 'reuse') return '<span class="pill pill--lib">' + U.icon('check', 11) + '问答库复用 · 0 次云端</span>';
    if (t.decision === 'cloud') return '<span class="pill pill--cloud">' + U.icon('cloud', 11) + '云端生成 · 1 次调用</span>';
    if (t.decision === 'tool') return '<span class="pill pill--tool">' + U.icon('bolt', 11) + '本地工具 · 0 次云端调用</span>';
    if (t.decision === 'stale') return '<span class="pill pill--warn">' + U.icon('alert', 11) + '待核对 · 未返回缓存答案</span>';
    if (t.decision === 'ask') return '<span class="pill pill--local">' + U.icon('chat', 11) + '本地追问 · 0 次云端</span>';
    if (t.decision === 'error') return '<span class="pill pill--err">' + U.icon('alert', 11) + '请求失败</span>';
    if (t.decision === 'aborted') return '<span class="pill pill--muted">已停止</span>';
    return '<span class="pill pill--muted">进行中…</span>';
  }

  function traceHTML(t) {
    if (!t) {
      return '<div class="ins__empty">' +
        '<div class="ins__empty-ico">' + U.icon('layers', 22) + '</div>' +
        '<p>发出一个问题后，这里会显示它走过的每一步：</p>' +
        '<ol class="ins__empty-list">' +
        '<li><b>指代补全</b>「这两个 / 第二个」→ 补成完整问题</li>' +
        '<li><b>本地工具</b>日期 / 星期 / 算术，0 次云端</li>' +
        '<li><b>精确匹配</b>原问与已收录改写</li>' +
        '<li><b>语义检索</b>概念覆盖 + 字面相似打分</li>' +
        '<li><b>条件校验</b>数值 / 代码入参 / 语言 / 否定</li>' +
        '<li><b>暂停检查</b>被报告暂停的目标改走云端</li>' +
        '<li><b>复用或云端</b>，回答后后台生成等价问法</li>' +
        '</ol></div>';
    }
    var u = t.usage || {};
    var steps = t.steps.map(function (s, i) {
      var ico = s.state === 'ok' ? U.icon('check', 11) : s.state === 'fail' ? U.icon('x', 11) : s.state === 'run' ? U.icon('refresh', 11) : '·';
      return '<div class="tstep tstep--' + s.state + '">' +
        '<div class="tstep__dot">' + ico + '</div>' +
        '<div class="tstep__body"><div class="tstep__label">' + U.esc(s.label) + '</div>' +
        '<div class="tstep__detail">' + U.esc(s.detail) + '</div></div>' +
        '</div>';
    }).join('');

    var resolved = t.resolved ? '<div class="ins__block ins__block--note">' +
      '<div class="ins__block-h">' + U.icon('target', 12) + '补全后的问题</div>' +
      '<div class="ins__completed">' + U.esc(t.resolved.completed) + '</div></div>' : '';

    var cands = '';
    if (t.candidates && t.candidates.length) {
      cands = '<div class="ins__block">' +
        '<div class="ins__block-h">' + U.icon('target', 12) + '语义候选 <span class="muted">门槛 ' + t.threshold.toFixed(2) + '</span></div>' +
        t.candidates.map(function (c) {
          var pass = c.score >= t.threshold;
          return '<div class="cand' + (c.chosen ? ' is-chosen' : '') + '">' +
            '<div class="cand__top"><span class="cand__q">' + U.esc(c.original) + '</span>' +
            '<span class="cand__score mono">' + c.score.toFixed(2) + '</span></div>' +
            '<i class="cand__bar"><i style="width:' + Math.round(c.score * 100) + '%;background:' + (pass ? 'var(--lib)' : 'var(--line-strong)') + '"></i></i>' +
            '<div class="cand__why">概念覆盖 ' + c.cov.toFixed(2) + ' · 字面 ' + c.bigram.toFixed(2) +
            (c.missing && c.missing.length ? ' · 缺 ' + c.missing.map(function (m) { return App.matcher.conceptLabel(m); }).join('、') : '') +
            (c.chosen ? ' · <b class="hl-ok">选中</b>' : '') + '</div>' +
            '</div>';
        }).join('') + '</div>';
    }

    var conflicts = '';
    if (t.steps.some(function (s) { return s.key === 'verify' && s.state === 'fail'; })) {
      conflicts = '<div class="ins__block ins__block--danger">' +
        '<div class="ins__block-h">' + U.icon('alert', 12) + '条件不一致 → 不复用</div>' +
        '<div class="ins__conf">' + U.esc(t.steps.filter(function (s) { return s.key === 'verify'; })[0].detail) + '</div>' +
        '</div>';
    }

    var target = '';
    if (t.groupId) {
      var g = S.groupById(t.groupId);
      var v = g && t.versionId ? S.versionById(g, t.versionId) : null;
      target = '<div class="ins__target">' + U.icon('library', 11) +
        '<span class="mono">' + U.esc(t.groupId) + '</span>' +
        (v ? '<span>v' + v.n + '</span>' : '') +
        (t.variantCount ? '<span>' + t.variantCount + ' 个表达变体</span>' : '') +
        '</div>';
    }
    return '<div class="ins__summary">' + decisionPill(t) +
      '<span class="ins__model mono">' + U.esc(t.model || '') + '</span></div>' + target +
      '<div class="ins__metrics">' +
      '<div><span>云端调用</span><b>' + (u.cloudCalls || 0) + '</b></div>' +
      '<div><span>首字</span><b>' + (u.firstTokenMs ? (u.firstTokenMs / 1000).toFixed(2) + 's' : '—') + '</b></div>' +
      '<div><span>总耗时</span><b>' + (u.totalMs ? (u.totalMs / 1000).toFixed(2) + 's' : '—') + '</b></div>' +
      '<div><span>成本</span><b>' + (u.cost ? U.fmtMoney(u.cost) : '¥0') + '</b></div>' +
      '</div>' +
      '<div class="ins__query">' + U.esc(t.query) + '</div>' +
      '<div class="tsteps">' + steps + '</div>' +
      resolved + cands + conflicts;
  }

  function memoryHTML() {
    var session = S.currentSession();
    var turns = [];
    var msgs = session.messages;
    for (var i = msgs.length - 1; i >= 0 && turns.length < 3; i--) {
      var m = msgs[i];
      if (m.role !== 'assistant' || !m.meta) continue;
      if (m.meta.status === 'pending') continue;
      var q = '';
      for (var j = i - 1; j >= 0; j--) { if (msgs[j].role === 'user') { q = msgs[j].content; break; } }
      turns.unshift({ q: q, a: m.content, meta: m.meta });
    }
    var constraints = [];
    turns.forEach(function (t) { constraints = constraints.concat(App.engine.extractConstraints(t.q)); });
    var lastBot = null;
    for (var k = msgs.length - 1; k >= 0; k--) { if (msgs[k].role === 'assistant') { lastBot = msgs[k]; break; } }
    var options = (lastBot && lastBot.meta && lastBot.meta.options) || [];

    return '<div class="ins__block">' +
      '<div class="ins__block-h">' + U.icon('clock', 12) + '最近 ' + turns.length + ' 轮（上限 ' + S.state.settings.maxContextTurns + ' 轮）</div>' +
      (turns.length ? turns.map(function (t) {
        return '<div class="mem">' +
          '<div class="mem__q">' + U.esc(App.md.plain(t.q).slice(0, 46)) + '</div>' +
          '<div class="mem__a">' + U.esc(App.md.plain(t.a).slice(0, 70)) + (App.md.plain(t.a).length > 70 ? '…' : '') + '</div>' +
          '<div class="mem__src">' + (t.meta && t.meta.source === 'library' ? '来自问答库' : t.meta && t.meta.source === 'cloud' ? '来自云端' : '本地') + '</div>' +
          '</div>';
      }).join('') : '<div class="muted">这条会话还没有历史，追问会从空白上下文开始。</div>') +
      '</div>' +
      '<div class="ins__block">' +
      '<div class="ins__block-h">' + U.icon('filter', 12) + '从上下文提取到的条件</div>' +
      '<div class="chips">' + (constraints.length ? constraints.map(function (c) {
        return '<span class="mini mini--accent">' + U.esc(c) + '</span>';
      }).join('') : '<span class="muted">暂无可沿用的条件</span>') + '</div>' +
      (constraints.length ? '<div class="ins__hint">追问时这些条件会自动带进补全后的问题</div>' : '') +
      '</div>' +
      (options.length ? '<div class="ins__block">' +
        '<div class="ins__block-h">' + U.icon('target', 12) + '可以指代的选项</div>' +
        options.map(function (o, i) {
          return '<div class="opt"><span class="opt__idx">' + (i + 1) + '</span>' +
            '<span class="opt__label">' + U.esc(o.label) + '</span></div>' +
            (o.detail ? '<div class="opt__detail">' + U.esc(o.detail) + '</div>' : '');
        }).join('') +
        '<div class="ins__hint">现在输入「这两个哪个好？」或「第二个呢？」，指代会自动补全</div>' +
        '</div>' : '');
  }

  function usageHTML() {
    var session = S.currentSession();
    var st = S.usageStats();
    var mine = st.rows.filter(function (r) { return r.sessionId === session.id; });
    var mineReuse = mine.filter(function (r) { return r.cloudCalls === 0 && r.path !== 'clarify' && r.path !== 'learn'; }).length;
    var mineCloud = mine.reduce(function (n, r) { return n + (r.cloudCalls || 0); }, 0);
    var mineCost = mine.reduce(function (n, r) { return n + (r.cost || 0); }, 0);
    return '<div class="ins__block">' +
      '<div class="ins__block-h">' + U.icon('chat', 12) + '这条会话</div>' +
      '<div class="kv"><span>请求</span><b>' + mine.length + '</b></div>' +
      '<div class="kv"><span>零云端复用</span><b>' + mineReuse + '</b></div>' +
      '<div class="kv"><span>云端调用</span><b>' + mineCloud + '</b></div>' +
      '<div class="kv"><span>累计成本</span><b>' + U.fmtMoney(mineCost) + '</b></div>' +
      '</div>' +
      '<div class="ins__block">' +
      '<div class="ins__block-h">' + U.icon('chart', 12) + '全部请求</div>' +
      '<div class="kv"><span>复用率</span><b>' + Math.round(st.reuseRate * 100) + '%</b></div>' +
      '<div class="kv"><span>云端调用</span><b>' + st.cloudCalls + '</b></div>' +
      '<div class="kv"><span>总成本</span><b>' + U.fmtMoney(st.cost) + '</b></div>' +
      '<div class="kv"><span>首字中位</span><b>' + (st.firstTokenMedian ? (st.firstTokenMedian / 1000).toFixed(2) + 's' : '—') + '</b></div>' +
      '</div>' +
      '<div class="ins__hint">完整的请求日志、成本拆分在「用量」页。</div>';
  }
})();
