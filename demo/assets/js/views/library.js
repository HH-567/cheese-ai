/* 柒柿AI · 纯前端演示 — 问答库页（问题组 / 版本 / 表达变体 / 暂停） */
(function () {
  'use strict';
  var App = window.App, U = App.util, S = App.store, M = App.matcher, E = App.engine;
  var V = (App.views = App.views || {});
  var lib = (V.library = {});
  var els = {};

  var FILTERS = [
    { id: 'all', label: '全部' },
    { id: 'mine', label: '我的个人库' },
    { id: 'shared', label: '共享库' },
    { id: 'review', label: '待复核' },
    { id: 'disabled', label: '已停用' }
  ];

  lib.mount = function (root) {
    els.root = root;
    root.innerHTML = '<div class="page page--library">' +
      '<div class="page__head">' +
      '<div><h1 class="page__title">问答库</h1><p class="page__sub" id="lib-sub"></p></div>' +
      '<div class="page__actions">' +
      '<button class="btn btn--ghost" data-action="export">' + U.icon('download', 14) + '导出 JSON</button>' +
      '</div></div>' +
      '<div class="toolbar">' +
      '<div class="seg" id="lib-seg">' + FILTERS.map(function (f) {
        return '<button class="seg__item" data-filter="' + f.id + '">' + f.label + '</button>';
      }).join('') + '</div>' +
      '<div class="search">' + U.icon('search', 14) +
      '<input class="search__input" id="lib-search" placeholder="搜索原问、等价问法或意图" value="' + U.esc(S.state.ui.libQuery || '') + '">' +
      '</div></div>' +
      '<div class="recs" id="lib-list"></div>' +
      '</div>';
    bind();
    lib.render();
  };

  function stats() {
    var recs = S.visibleRecords();
    var activeAliases = recs.reduce(function (n, r) {
      return n + (r.aliases || []).filter(function (a) { return a.status === 'active'; }).length;
    }, 0);
    var hits = recs.reduce(function (n, r) { return n + (r.hits || 0); }, 0);
    var review = recs.filter(function (r) {
      return S.state.reports.some(function (x) { return x.groupId === r.id && x.status === 'open'; });
    }).length;
    var learning = recs.filter(function (r) { return r.status === 'learning'; }).length;
    var paused = recs.filter(function (r) {
      return S.suspensionsForGroup(r.id).some(function (s) { return s.status === 'active'; });
    }).length;
    var updated = recs.reduce(function (m, r) { return Math.max(m, r.updatedAt || 0); }, 0);
    var versions = recs.reduce(function (n, r) { return n + (r.versions || []).length; }, 0);
    return {
      recs: recs, activeAliases: activeAliases, hits: hits, review: review,
      learning: learning, paused: paused, updated: updated, versions: versions
    };
  }

  function visibleFor(filter) {
    var uid = S.state.userId;
    var q = (S.state.ui.libQuery || '').trim().toLowerCase();
    return S.visibleRecords().filter(function (r) {
      if (filter === 'mine' && r.ownerId !== uid) return false;
      if (filter === 'shared' && r.scope !== 'shared') return false;
      if (filter === 'review') {
        var open = S.state.reports.some(function (x) { return x.groupId === r.id && x.status === 'open'; });
        var sus = S.suspensionsForGroup(r.id).some(function (s) { return s.status === 'active'; });
        if (!open && !sus) return false;
      }
      if (filter === 'disabled' && r.status !== 'disabled') return false;
      if (filter !== 'disabled' && r.status === 'disabled') return false;
      if (!q) return true;
      var hay = [r.original, r.intent, (r.entities || []).join(' '), (r.constraints || []).join(' ')]
        .concat((r.aliases || []).map(function (a) { return a.text; })).join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  }

  lib.render = function () {
    if (!els.root) return;
    var st = stats();
    var sub = U.$('#lib-sub');
    if (sub) {
      sub.innerHTML = '当前身份可访问 <b>' + st.recs.length + '</b> 条问题组 · <b>' + st.versions + '</b> 个答案版本 · <b>' +
        st.activeAliases + '</b> 条等价问法 · 累计命中 <b>' + st.hits + '</b> 次' +
        (st.learning ? ' · <span class="hl-learning">' + st.learning + ' 条后台生成中</span>' : '') +
        (st.paused ? ' · <span class="hl-warn">' + st.paused + ' 条被暂停</span>' : '') +
        (st.review ? ' · <span class="hl-warn">' + st.review + ' 条待复核</span>' : '') +
        ' · 最近更新 ' + U.fmtAgo(st.updated);
    }
    U.$$('#lib-seg .seg__item').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-filter') === S.state.ui.libFilter);
    });
    var list = visibleFor(S.state.ui.libFilter);
    var wrap = U.$('#lib-list');
    if (!list.length) {
      wrap.innerHTML = '<div class="recs__empty">' + U.icon('library', 22) +
        '<p>这个筛选下还没有记录。</p>' +
        '<p class="muted">在聊天里问一个没被收录的问题，云端答完后会自动入库。</p></div>';
      return;
    }
    wrap.innerHTML = list.map(recordHTML).join('');
  };

  function groupPaused(g) {
    return S.suspensionsForGroup(g.id).filter(function (s) { return s.status === 'active'; });
  }

  function statusPill(g) {
    if (g.status === 'learning') return '<span class="pill pill--learning">' + U.icon('cpu', 11) + '生成中</span>';
    if (g.status === 'disabled') return '<span class="pill pill--muted">已停用</span>';
    var paused = groupPaused(g);
    if (paused.length) return '<span class="pill pill--warn">' + U.icon('alert', 11) + '已暂停</span>';
    var open = S.state.reports.some(function (x) { return x.groupId === g.id && x.status === 'open'; });
    if (open) return '<span class="pill pill--warn">待复核</span>';
    if (S.isStale(g)) return '<span class="pill pill--warn">待核对</span>';
    return '<span class="pill pill--ok">' + U.icon('check', 11) + '已启用</span>';
  }

  function recordHTML(rec) {
    var expanded = !!S.state.ui.expanded[rec.id];
    var active = (rec.aliases || []).filter(function (a) { return a.status === 'active'; });
    var rejected = (rec.aliases || []).filter(function (a) { return a.status === 'rejected'; });
    var pausedAliases = S.suspensionsForGroup(rec.id).filter(function (s) { return s.status === 'active' && s.kind === 'match'; })
      .map(function (s) { return U.key(s.matchKey || ''); });
    var chips = active.slice(0, 3).map(function (a) {
      var isPaused = pausedAliases.indexOf(U.key(a.text)) >= 0;
      return '<span class="alias alias--sm' + (isPaused ? ' alias--paused' : '') + '" title="' + U.esc(a.text) + '">' + U.esc(a.text) + '</span>';
    }).join('');
    if (active.length > 3) chips += '<span class="alias alias--more">+' + (active.length - 3) + '</span>';
    if (rejected.length) chips += '<span class="alias alias--rej" title="被检查拒收的问法">' + rejected.length + ' 条被拒收</span>';
    if (rec.routeTool) chips += '<span class="alias alias--tool">工具路由 · ' + (rec.routeTool === 'date' ? '日期' : '算术') + '</span>';

    var learning = rec.status === 'learning' && rec.learnTask;
    var cur = S.currentVersion(rec);
    return '<article class="rec' + (expanded ? ' is-open' : '') + '" data-rec="' + rec.id + '">' +
      '<div class="rec__top" data-action="toggle">' +
      '<div class="rec__scope rec__scope--' + rec.scope + '">' + (rec.scope === 'shared' ? '共享' : '个人') + '</div>' +
      '<div class="rec__body">' +
      '<h3 class="rec__q">' + U.esc(rec.original) + '</h3>' +
      '<div class="rec__meta">' +
      statusPill(rec) +
      '<span>' + U.icon('target', 11) + ' 命中 ' + (rec.hits || 0) + '</span>' +
      (cur ? '<span class="mono">v' + cur.n + (rec.versions.length > 1 ? ' / ' + rec.versions.length + ' 版' : '') + '</span>' : '') +
      '<span>' + U.icon('clock', 11) + ' ' + U.fmtAgo(rec.updatedAt) + '</span>' +
      '<span class="mono">' + U.esc(rec.model || '') + '</span>' +
      '<span>' + (rec.ownerId === S.state.userId ? '我' : U.esc(S.userById(rec.ownerId).name)) + ' 的记录</span>' +
      '</div></div>' +
      '<button class="rec__chev" data-action="toggle" aria-label="展开">' + U.icon('chevronDown', 16) + '</button>' +
      '</div>' +
      (learning
        ? '<div class="rec__learning">' + U.icon('cpu', 13) + '<span>后台正在为这条问答生成等价问法…</span><i class="spinner"></i></div>'
        : '<div class="rec__aliases">' + chips + '</div>') +
      (expanded ? detailHTML(rec) : '') +
      '</article>';
  }

  function versionsHTML(rec) {
    var list = (rec.versions || []).slice().sort(function (a, b) { return b.n - a.n; });
    if (!list.length) {
      return '<div class="muted small">这是工具路由，没有答案版本：每次按输入现算。</div>';
    }
    return '<div class="vlist">' + list.map(function (v) {
      var cls = v.id === rec.currentVersionId ? 'is-cur' : v.status === 'published' ? '' : 'is-old';
      var label = v.id === rec.currentVersionId ? '当前版本' : v.status === 'superseded' ? '已被替换' : v.status === 'rolledback' ? '已回滚' : '历史';
      return '<div class="vrow ' + cls + '">' +
        '<span class="vrow__n mono">v' + v.n + '</span>' +
        '<div class="vrow__body"><div class="vrow__basis">' + U.esc(v.basis || '') + '</div>' +
        '<div class="vrow__meta">' + U.esc(S.userById(v.by).name) + ' · ' + U.fmtAgo(v.createdAt) + ' · ' + label + '</div></div>' +
        (v.id !== rec.currentVersionId && S.isAdmin() && rec.scope === 'shared'
          ? '<button class="btn btn--small btn--ghost" data-action="rollback" data-version="' + v.id + '">回滚到此版</button>'
          : (v.id !== rec.currentVersionId ? '<span class="vrow__tag">已退出匹配</span>' : '')) +
        '</div>';
    }).join('') + '</div>';
  }

  function detailHTML(rec) {
    var active = (rec.aliases || []).filter(function (a) { return a.status === 'active'; });
    var rejected = (rec.aliases || []).filter(function (a) { return a.status === 'rejected'; });
    var cur = S.currentVersion(rec);
    var variants = S.variantsOf(rec, cur ? cur.id : null);
    var susp = groupPaused(rec);
    var pausedKeys = susp.filter(function (s) { return s.kind === 'match'; }).map(function (s) { return s.matchKey; });
    var aliasRows = (rec.aliases || []).map(function (a) {
      var isPaused = a.status === 'active' && pausedKeys.indexOf(U.key(a.text)) >= 0;
      return '<div class="arow arow--' + (isPaused ? 'paused' : a.status) + '">' +
        '<span class="arow__ico">' + (isPaused ? U.icon('alert', 12) : a.status === 'active' ? U.icon('check', 12) : U.icon('x', 12)) + '</span>' +
        '<div class="arow__body"><div class="arow__text">' + U.esc(a.text) + '</div>' +
        (isPaused ? '<div class="arow__reason">这条匹配关系已被暂停，请求改走云端</div>' : '') +
        (a.reason ? '<div class="arow__reason">拒收原因：' + U.esc(a.reason) + '</div>' : '') + '</div>' +
        '<span class="arow__tag">' + (a.source === 'reused' ? '真实复用' : a.source === 'generated' ? '后台生成' : '初始') + '</span>' +
        '</div>';
    }).join('');

    var variantRows = variants.length
      ? '<div class="chips">' + variants.map(function (v) {
        return '<span class="mini mini--accent">' + U.esc(E.variantLabel(v.style)) + '表达</span>';
      }).join('') + '</div>'
      : '<div class="muted small">这一版只有默认表达；用户可以主动重新问云端拿新写法。</div>';

    return '<div class="rec__detail">' +
      (susp.length ? '<div class="banner banner--warn">' + U.icon('alert', 14) +
        '<span>' + susp.map(function (s) {
          return (s.kind === 'match' ? '「' + U.esc(s.aliasText || '') + '」这条匹配关系' : '某一版答案') +
            '自 ' + U.fmtAgo(s.since) + ' 起暂停：' + U.esc(s.reason || '');
        }).join('；') + '。受影响请求交给云端，' + (S.isAdmin() ? '可在审核页恢复或修正。' : '等待库管理员处理。') + '</span></div>' : '') +
      '<div class="meta-grid">' +
      '<div><div class="meta-grid__k">标准化意图</div><div class="meta-grid__v">' + U.esc(rec.intent || '—') + '</div></div>' +
      '<div><div class="meta-grid__k">涉及对象</div><div class="meta-grid__v">' + ((rec.entities || []).map(function (e) { return '<span class="mini">' + U.esc(e) + '</span>'; }).join('') || '—') + '</div></div>' +
      '<div><div class="meta-grid__k">影响答案的条件</div><div class="meta-grid__v">' + ((rec.constraints || []).map(function (e) { return '<span class="mini">' + U.esc(e) + '</span>'; }).join('') || '—') + '</div></div>' +
      '<div><div class="meta-grid__k">可见范围</div><div class="meta-grid__v">' + (rec.scope === 'shared' ? esc(S.library().name) + '（成员可复用）' : '仅个人（不会出现在其他人的匹配结果里）') + '</div></div>' +
      '<div><div class="meta-grid__k">时效策略</div><div class="meta-grid__v">' + freshnessText(rec) + '</div></div>' +
      '<div><div class="meta-grid__k">报告</div><div class="meta-grid__v">' + (rec.reports || 0) + ' 次</div></div>' +
      '</div>' +
      '<div class="detail__cols">' +
      '<div class="detail__col">' +
      '<div class="detail__h">答案版本 <span class="muted">（旧版全部表达一起退出匹配）</span></div>' +
      versionsHTML(rec) +
      '<div class="detail__h">表达变体 <span class="muted">（同一版本下的合格答法，切换 0 次云端调用）</span></div>' +
      variantRows +
      '<div class="detail__h">等价问法 <span class="muted">（' + active.length + ' 条可用 / ' + rejected.length + ' 条拒收）</span></div>' +
      '<div class="arows">' + aliasRows + '</div>' +
      '<div class="detail__hint">' + U.icon('info', 12) + ' 同一问题组只保存一份当前版本；修正后所有问法一起生效。</div>' +
      '</div>' +
      '<div class="detail__col">' +
      '<div class="detail__h">当前答案预览' + (cur ? ' <span class="muted">v' + cur.n + '</span>' : '') + '</div>' +
      (cur
        ? '<div class="ans-preview prose">' + App.md.render(cur.answer) + '</div>'
        : '<div class="tool-preview">' + U.icon('bolt', 18) + '<div><b>本地工具路由</b><p>这类问题不走云端、也没有固定答案：每次按输入现算（' +
          (rec.routeTool === 'date' ? '日期 / 星期 / 时区' : '四则运算 / 括号') + '）。</p></div></div>') +
      '</div></div>' +
      '<div class="rec__acts">' +
      (cur ? '<button class="btn btn--small btn--primary" data-action="edit-answer">' + U.icon('edit', 13) + '发布新版本</button>' : '') +
      '<button class="btn btn--small btn--ghost" data-action="recheck">' + U.icon('refresh', 13) + '重新检查问法</button>' +
      '<button class="btn btn--small btn--ghost" data-action="toggle-status">' + U.icon(rec.status === 'disabled' ? 'check' : 'x', 13) + (rec.status === 'disabled' ? '启用' : '停用') + '</button>' +
      '<button class="btn btn--small btn--ghost" data-action="copy-group">' + U.icon('copy', 13) + '复制整组</button>' +
      (susp.length && S.isAdmin() ? '<button class="btn btn--small btn--ghost" data-action="resume">' + U.icon('check', 13) + '恢复被暂停的目标</button>' : '') +
      '<span class="grow"></span>' +
      '<span class="rec__id mono">' + U.esc(rec.id) + '</span>' +
      '</div>' +
      '</div>';
  }

  function freshnessText(rec) {
    var f = rec.freshness || {};
    if (f.kind === 'tool') return '工具路由 · 每次实时计算，不入库';
    if (f.kind === 'versioned') {
      var last = f.lastCheckedAt || f.reviewAt;
      return '来源版本 ' + U.esc(f.sourceVersion || '—') + ' · 上次核对 ' + (last ? U.date(last) : '—') +
        ' · 复核间隔 ' + (f.reviewIntervalDays || 30) + ' 天' + (S.isStale(rec) ? ' <b class="hl-warn">（已过期）</b>' : '');
    }
    return '稳定事实 · 无日历到期任务（有纠错或条件变化时复核）';
  }

  function esc(s) { return U.esc(s); }

  function bind() {
    var root = els.root;
    root.addEventListener('click', function (e) {
      var seg = e.target.closest('[data-filter]');
      if (seg) {
        S.state.ui.libFilter = seg.getAttribute('data-filter');
        S.save();
        lib.render();
        return;
      }
      if (e.target.closest('[data-action="export"]')) { lib.exportJSON(); return; }
      var art = e.target.closest('.rec');
      if (!art) return;
      var rec = S.groupById(art.getAttribute('data-rec'));
      if (!rec) return;
      var act = e.target.closest('[data-action]');
      if (!act) return;
      var action = act.getAttribute('data-action');
      if (action === 'toggle') {
        S.state.ui.expanded[rec.id] = !S.state.ui.expanded[rec.id];
        S.save();
        lib.render();
        var el = U.$('.rec[data-rec="' + rec.id + '"]');
        if (el && S.state.ui.expanded[rec.id]) U.flash(el);
      } else if (action === 'edit-answer') {
        lib.openEdit(rec);
      } else if (action === 'toggle-status') {
        rec.status = rec.status === 'disabled' ? 'active' : 'disabled';
        rec.updatedAt = Date.now();
        S.save(true);
        App.bus.emit('records:changed');
        lib.render();
        U.toast(rec.status === 'disabled' ? '已停用，后续匹配不会再命中这条记录' : '已重新启用', { kind: 'info' });
      } else if (action === 'recheck') {
        E.recheck(rec);
        lib.render();
      } else if (action === 'rollback') {
        var vid = act.getAttribute('data-version');
        var v = S.rollbackVersion(rec.id, vid, S.state.userId);
        if (v) {
          U.toast('已回滚到 v' + v.n, { kind: 'info', detail: '回滚留痕：被回滚的版本仍可在版本列表里看到' });
          lib.render();
        }
      } else if (action === 'resume') {
        groupPaused(rec).forEach(function (s) { S.releaseSuspension(s.id, 'restored', S.state.userId); });
        U.toast('已恢复，受影响请求重新走问答库', { kind: 'ok' });
        lib.render();
      } else if (action === 'copy-group') {
        var cur = S.currentVersion(rec);
        var text = '原问：' + rec.original + '\n\n等价问法：\n' + (rec.aliases || []).filter(function (a) { return a.status === 'active'; })
          .map(function (a) { return '- ' + a.text; }).join('\n') + '\n\n当前答案（v' + (cur ? cur.n : '—') + '）：\n' + (cur ? cur.answer : '');
        U.copy(text).then(function (ok) { U.toast(ok ? '整组问答已复制' : '复制失败', { kind: ok ? 'ok' : 'warn' }); });
      }
    });
    root.addEventListener('input', function (e) {
      if (e.target.id !== 'lib-search') return;
      S.state.ui.libQuery = e.target.value;
      S.save();
      var list = visibleFor(S.state.ui.libFilter);
      var wrap = U.$('#lib-list');
      if (wrap) {
        wrap.innerHTML = list.length ? list.map(recordHTML).join('') :
          '<div class="recs__empty">' + U.icon('search', 20) + '<p>没有匹配「' + U.esc(e.target.value) + '」的记录。</p></div>';
      }
    });
  }

  lib.openEdit = function (rec) {
    var cur = S.currentVersion(rec);
    var canPublish = rec.scope === 'personal' ? (rec.ownerId === S.state.userId) : S.isAdmin();
    if (!canPublish) {
      U.toast('共享库只有库管理员可以发布修订', {
        kind: 'warn', detail: '你可以用「报告误答」或「建议修订」把依据提交给管理员'
      });
      return;
    }
    U.modal({
      title: '发布新版本',
      width: 660,
      body: '<p class="modal__text">发布后这一版成为当前版本，旧版的所有表达一起退出匹配；已经发出的聊天仍保留用户当时看到的文本。</p>' +
        '<textarea class="field field--area" data-answer rows="12">' + U.esc(cur ? cur.answer : '') + '</textarea>' +
        '<textarea class="field field--area" data-basis rows="2" placeholder="修订依据（例如：官方文档 2026-11 更新）"></textarea>',
      actions: [
        { label: '取消' },
        {
          label: '发布', kind: 'primary', onClick: function (wrap) {
            var ta = wrap.querySelector('[data-answer]');
            var basis = wrap.querySelector('[data-basis]');
            var v = ta.value.trim();
            if (!v) { U.toast('答案不能为空', { kind: 'warn' }); return false; }
            var nv = S.publishVersion(rec.id, v, {
              basis: '本人修正' + (basis && basis.value ? ' · ' + basis.value : ''),
              by: S.state.userId
            });
            S.addUsage({
              id: U.uid('u'), at: Date.now(), ownerId: S.state.userId, sessionId: null,
              query: '发布修订：' + rec.original.slice(0, 26), path: 'revision',
              cloudCalls: 0, totalMs: 0, cost: 0, ok: true
            });
            S.suspensionsForGroup(rec.id).forEach(function (s) {
              if (s.status === 'active') S.releaseSuspension(s.id, 'fixed', S.state.userId);
            });
            U.toast('已发布 v' + nv.n, { kind: 'ok', detail: '旧版表达已退出匹配；被暂停的目标已随修正恢复' });
            lib.render();
            return true;
          }
        }
      ]
    });
  };

  lib.exportJSON = function () {
    var data = {
      exportedAt: new Date().toISOString(),
      user: S.state.userId,
      library: S.library(),
      groups: S.visibleRecords().map(function (r) {
        return {
          id: r.id, scope: r.scope, owner: r.ownerId, original: r.original, intent: r.intent,
          entities: r.entities, constraints: r.constraints,
          freshness: r.freshness,
          versions: (r.versions || []).map(function (v) {
            return { id: v.id, n: v.n, status: v.status, basis: v.basis, by: v.by, createdAt: new Date(v.createdAt).toISOString() };
          }),
          currentVersionId: r.currentVersionId,
          variants: (r.variants || []).map(function (v) { return { id: v.id, versionId: v.versionId, style: v.style, status: v.status }; }),
          aliases: (r.aliases || []).map(function (a) { return { text: a.text, status: a.status, reason: a.reason || '' }; }),
          hits: r.hits, reports: r.reports,
          suspended: S.suspensionsForGroup(r.id).filter(function (s) { return s.status === 'active'; }).length
        };
      })
    };
    try {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'qishi-ai-library.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
      U.toast('已导出问答库快照', { kind: 'ok' });
    } catch (e) {
      U.modal({ title: '问答库快照', body: '<pre class="code-inline">' + U.esc(JSON.stringify(data, null, 2)) + '</pre>', actions: [{ label: '关闭' }] });
    }
  };

  lib.onChanged = function () {
    if (els.root && S.state.page === 'library') lib.render();
  };

  lib.focus = function (id) {
    if (!els.root) return;
    S.state.ui.libFilter = 'all';
    S.state.ui.libQuery = '';
    S.state.ui.expanded[id] = true;
    lib.render();
    var el = U.$('.rec[data-rec="' + id + '"]');
    if (el) {
      U.revealEl(el, U.$('.view'), 90);
      U.flash(el);
    }
  };
})();
