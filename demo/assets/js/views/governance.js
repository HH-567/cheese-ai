/* 柒柿AI · 纯前端演示 — 审核与治理页 */
(function () {
  'use strict';
  var App = window.App, U = App.util, S = App.store;
  var V = (App.views = App.views || {});
  var gov = (V.governance = {});
  var els = {};

  var CATEGORY = { fact: '事实有误', mismatch: '答非所问', style: '表达不合适' };

  gov.mount = function (root) {
    els.root = root;
    root.innerHTML = '<div class="page page--gov" id="gov-root"></div>';
    gov.render();
  };

  gov.render = function () {
    var root = U.$('#gov-root');
    if (!root) return;
    var g = S.governance();
    var admin = S.isAdmin();
    var m = g.metrics;
    var tab = S.state.ui.govTab || 'reports';

    root.innerHTML =
      '<div class="page__head">' +
      '<div><h1 class="page__title">审核与治理</h1>' +
      '<p class="page__sub">共享库的暂停、修订与恢复都在这里处理 · ' + (admin ? '<b>你是 ' + U.esc(S.library().name) + ' 的管理员</b>' : '你是共享库成员，可以查看和建议，但不能发布或停用') + '</p></div>' +
      '<div class="page__actions"><span class="tag-mono">窗口 ' + (S.state.settings.pauseWindowDays || 7) + ' 天 · 阈值 ' + (S.state.settings.pauseThreshold || 3) + ' 人</span></div>' +
      '</div>' +

      (admin ? '' : '<div class="banner banner--info">' + U.icon('info', 14) + '<span>成员权限：可以使用问答、报告误答、提交修订建议。发布、停用、恢复与回滚由该共享库的管理员执行。</span></div>') +

      '<div class="stats stats--gov">' +
      govStat('待处理报告', m.open, 'open', '分为事实 / 错配两类') +
      govStat('已暂停目标', m.suspended, 'paused', '受影响请求改走云端') +
      govStat('修订建议', m.pendingRev, 'rev', '等待核对依据') +
      govStat('平均处理时长', m.handleMs ? (m.handleMs / 3600000).toFixed(1) + 'h' : '—', 'time', '从报告到处理完成') +
      govStat('近 7 天报告', m.last7, 'week', '含游客与重复提交') +
      govStat('误停率', Math.round(m.falseStopRate * 100) + '%', 'false', '恢复且未改答案 / 已处理暂停') +
      '</div>' +

      '<div class="seg seg--tabs" id="gov-tabs">' +
      '<button class="seg__item' + (tab === 'reports' ? ' is-on' : '') + '" data-tab="reports">报告队列 <em>' + m.open + '</em></button>' +
      '<button class="seg__item' + (tab === 'revisions' ? ' is-on' : '') + '" data-tab="revisions">修订建议 <em>' + m.pendingRev + '</em></button>' +
      '<button class="seg__item' + (tab === 'freshness' ? ' is-on' : '') + '" data-tab="freshness">数据核对 <em>' + S.state.refreshTasks.filter(function (t) { return t.state === 'running'; }).length + '</em></button>' +
      '</div>' +

      '<div id="gov-body">' + (tab === 'reports' ? reportsHTML(g) : tab === 'revisions' ? revisionsHTML(g) : freshnessHTML()) + '</div>';
    bind();
  };

  function govStat(k, v, cls, note) {
    return '<div class="stat stat--sm">' +
      '<div class="stat__k">' + k + '</div>' +
      '<div class="stat__v stat__v--sm">' + v + '</div>' +
      '<div class="stat__m">' + note + '</div></div>';
  }

  function statusOfTarget(t) {
    if (t.suspension && t.suspension.status === 'active') return '<span class="pill pill--warn">' + U.icon('alert', 11) + '已暂停</span>';
    var th = S.state.settings.pauseThreshold || 3;
    return '<span class="pill pill--muted">' + t.votes.count + '/' + th + ' 票 · 未达阈值</span>';
  }

  function reportsHTML(g) {
    if (!g.targets.length) {
      return '<div class="recs__empty">' + U.icon('check', 22) + '<p>没有待处理的报告。</p><p class="muted">报告会按「版本」或「匹配关系」聚合，重复提交只算 1 人。</p></div>';
    }
    return '<div class="gov">' + g.targets.map(function (t) {
      var grp = t.group || S.groupById(t.groupId) || {};
      var th = S.state.settings.pauseThreshold || 3;
      var admin = S.isAdmin();
      var targetLabel = t.type === 'match'
        ? '匹配关系 · 「' + (t.aliasText || '') + '」'
        : '版本 v' + ((S.versionById(grp, t.versionId) || {}).n || '?') + ' · 「' + grp.original + '」';
      var cats = Object.keys(t.categories).map(function (c) { return CATEGORY[c] + ' ×' + t.categories[c]; }).join(' · ');
      return '<section class="gcard">' +
        '<header class="gcard__head">' +
        '<div class="gcard__title"><span class="gcard__kind">' + (t.type === 'match' ? '匹配关系' : '答案版本') + '</span>' + U.esc(targetLabel) + '</div>' +
        statusOfTarget(t) +
        '</header>' +
        '<div class="gcard__meta">' +
        '<span>' + U.icon('library', 11) + ' ' + U.esc(grp.original || '') + '</span>' +
        '<span>' + U.icon('clock', 11) + ' ' + U.fmtAgo(t.reports.length ? t.reports[0].at : (t.suspension && t.suspension.since) || Date.now()) + '</span>' +
        '<span>' + U.icon('users', 11) + ' ' + t.votes.count + ' 名已验证成员</span>' +
        '<span>' + U.esc(cats) + '</span>' +
        '</div>' +
        '<div class="gcard__reports">' + (t.reports.length ? t.reports.map(function (r) {
          return '<div class="grep">' +
            '<span class="grep__who">' + U.esc(S.userById(r.byUserId).name) + '</span>' +
            '<span class="grep__cat">' + (CATEGORY[r.category] || r.category) + '</span>' +
            '<span class="grep__time">' + U.fmtAgo(r.at) + '</span>' +
            '<span class="grep__note">' + U.esc(r.note || '—') + '</span>' +
            '</div>';
        }).join('') : '<div class="grep"><span class="grep__note">报告已归档：' + U.esc((t.suspension && t.suspension.reason) || '') + '</span></div>') + '</div>' +
        '<div class="gcard__acts">' +
        (admin ? '<button class="btn btn--small btn--primary" data-gov="fix" data-key="' + t.key + '">发布修正</button>' : '') +
        (admin && t.suspension ? '<button class="btn btn--small btn--ghost" data-gov="restore" data-key="' + t.key + '">恢复原状</button>' : '') +
        (admin ? '<button class="btn btn--small btn--ghost" data-gov="disable" data-key="' + t.key + '">停用整组</button>' : '') +
        '<button class="btn btn--small btn--ghost" data-gov="view" data-key="' + t.key + '">查看记录</button>' +
        '<span class="grow"></span>' +
        (t.votes.count < th
          ? '<button class="btn btn--small btn--ghost" data-gov="simulate" data-key="' + t.key + '">' + U.icon('users', 12) + '演示：补齐其余成员的报告</button>'
          : '') +
        '</div>' +
        '</section>';
    }).join('') + '</div>';
  }

  function revisionsHTML(g) {
    var list = g.allRevisions.filter(function (r) { return r.status === 'pending'; });
    var closed = g.allRevisions.filter(function (r) { return r.status !== 'pending'; });
    var admin = S.isAdmin();
    var body = list.length ? list.map(function (r) {
      var grp = S.groupById(r.groupId) || {};
      var base = S.versionById(grp, r.baseVersionId);
      return '<section class="gcard">' +
        '<header class="gcard__head">' +
        '<div class="gcard__title"><span class="gcard__kind">修订建议</span>「' + U.esc(grp.original || '') + '」</div>' +
        '<span class="pill pill--learning">待审核</span>' +
        '</header>' +
        '<div class="gcard__meta">' +
        '<span>' + U.icon('users', 11) + ' ' + U.esc(S.userById(r.byUserId).name) + '</span>' +
        '<span>' + U.icon('clock', 11) + ' ' + U.fmtAgo(r.at) + '</span>' +
        '<span>基准版本 v' + (base ? base.n : '?') + '</span>' +
        '<span>' + U.esc(r.note || '无补充依据') + '</span>' +
        '</div>' +
        '<div class="gdiff">' +
        '<div class="gdiff__col"><div class="gdiff__h">当前答案 v' + (base ? base.n : '?') + '</div><div class="ans-preview prose">' + App.md.render(base ? base.answer : '') + '</div></div>' +
        '<div class="gdiff__col"><div class="gdiff__h">建议答案</div><div class="ans-preview prose">' + App.md.render(r.proposedAnswer) + '</div></div>' +
        '</div>' +
        '<div class="gcard__acts">' +
        (admin ? '<button class="btn btn--small btn--primary" data-gov="rev-publish" data-key="' + r.id + '">发布为新版本</button>' : '') +
        (admin ? '<button class="btn btn--small btn--ghost" data-gov="rev-variant" data-key="' + r.id + '">收为表达变体</button>' : '') +
        (admin ? '<button class="btn btn--small btn--ghost" data-gov="rev-keep" data-key="' + r.id + '">保留原版</button>' : '') +
        '<span class="grow"></span>' +
        '<span class="muted small">' + (admin ? '发布后旧版全部表达退出匹配' : '只有管理员可以发布') + '</span>' +
        '</div>' +
        '</section>';
    }).join('') : '<div class="recs__empty">' + U.icon('check', 22) + '<p>没有待审核的修订建议。</p><p class="muted">成员对共享库做出「重新问云端 → 建议修订」时会出现在这里。</p></div>';

    if (closed.length) {
      body += '<div class="gov__closed"><div class="gov__closed-h">最近处理</div>' + closed.slice(0, 6).map(function (r) {
        var grp = S.groupById(r.groupId) || {};
        var label = { published: '已发布', kept: '保留原版', variant: '收为变体' }[r.status] || r.status;
        return '<div class="grep grep--closed"><span class="grep__who">' + U.esc(S.userById(r.byUserId).name) + '</span>' +
          '<span class="grep__cat">' + U.esc(grp.original || '') + '</span>' +
          '<span class="grep__time">' + U.fmtAgo(r.handledAt || r.at) + '</span>' +
          '<span class="grep__note">' + label + '</span></div>';
      }).join('') + '</div>';
    }
    return body;
  }

  function freshnessHTML() {
    var versioned = S.visibleRecords().filter(function (r) { return (r.freshness || {}).kind === 'versioned'; });
    var tasks = S.state.refreshTasks.slice(0, 8);
    var body = '<section class="gcard">' +
      '<header class="gcard__head"><div class="gcard__title"><span class="gcard__kind">时效</span>会变的资料：按来源版本核对</div>' +
      '<span class="pill pill--muted">到期不主动刷新</span></header>' +
      '<div class="gcard__meta"><span>' + U.icon('clock', 11) + ' 到期后等下一次请求再核对；同一来源版本只允许一个在途任务</span></div>' +
      (versioned.length ? versioned.map(function (r) {
        var f = r.freshness || {};
        var stale = S.isStale(r);
        var running = S.refreshTaskFor(r.id);
        return '<div class="frow">' +
          '<div class="frow__main"><div class="frow__t">' + U.esc(r.original) + '</div>' +
          '<div class="frow__m">来源 ' + U.esc(f.source || '—') + ' · 版本 <span class="mono">' + U.esc(f.sourceVersion || '—') + '</span>' +
          ' · 上次核对 ' + (f.reviewAt ? U.date(f.reviewAt) : '—') + ' · 间隔 ' + (f.reviewIntervalDays || 30) + ' 天</div></div>' +
          (stale ? '<span class="pill pill--warn">已过期</span>' : '<span class="pill pill--ok">' + U.icon('check', 11) + '在复核间隔内</span>') +
          (running ? '<span class="pill pill--learning">核对中…</span>'
            : '<button class="btn btn--small btn--ghost" data-gov="refresh" data-key="' + r.id + '">发起核对</button>') +
          '</div>';
      }).join('') : '<div class="muted small">还没有按来源版本管理的记录。</div>') +
      '</section>' +
      (tasks.length ? '<section class="gcard">' +
        '<header class="gcard__head"><div class="gcard__title"><span class="gcard__kind">任务</span>核对任务</div></header>' +
        tasks.map(function (t) {
          var grp = S.groupById(t.groupId) || {};
          return '<div class="frow">' +
            '<div class="frow__main"><div class="frow__t">' + U.esc(grp.original || t.groupId) + '</div>' +
            '<div class="frow__m">' + U.esc(t.source) + ' · 开始于 ' + U.fmtAgo(t.startedAt) + '</div></div>' +
            (t.state === 'running' ? '<span class="pill pill--learning">在途</span>'
              : '<span class="pill pill--ok">' + (t.result === 'unchanged' ? '内容未变 · 已更新核验时间' : '已完成') + '</span>') +
            '</div>';
        }).join('') + '</section>' : '');
    return body;
  }

  function targetByKey(key) {
    var g = S.governance();
    return g.targets.filter(function (t) { return t.key === key; })[0] || null;
  }

  function bind() {
    var root = els.root;
    root.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-tab]');
      if (tab) {
        S.state.ui.govTab = tab.getAttribute('data-tab');
        S.save();
        gov.render();
        return;
      }
      var btn = e.target.closest('[data-gov]');
      if (!btn) return;
      var action = btn.getAttribute('data-gov');
      var key = btn.getAttribute('data-key');

      if (action === 'restore') {
        var t = targetByKey(key);
        if (t && t.suspension) {
          S.releaseSuspension(t.suspension.id, 'restored', S.state.userId);
          U.toast('已恢复', { kind: 'ok', detail: '受影响的请求重新走问答库；恢复会记入误停率' });
          gov.render();
        }
      } else if (action === 'fix') {
        openFix(key);
      } else if (action === 'disable') {
        var t2 = targetByKey(key);
        if (t2) {
          var grp = S.groupById(t2.groupId);
          if (grp) {
            grp.status = 'disabled';
            grp.updatedAt = Date.now();
          }
          if (t2.suspension) S.releaseSuspension(t2.suspension.id, 'disabled', S.state.userId);
          S.save(true);
          App.bus.emit('records:changed');
          U.toast('已停用整组记录', { kind: 'info', detail: '之后所有问法都不会命中它，直到重新启用' });
          gov.render();
        }
      } else if (action === 'view') {
        var t3 = targetByKey(key);
        if (t3) App.app.go('library', { recordId: t3.groupId });
      } else if (action === 'simulate') {
        simulate(key);
      } else if (action === 'rev-publish' || action === 'rev-variant' || action === 'rev-keep') {
        var map = { 'rev-publish': 'publish', 'rev-variant': 'variant', 'rev-keep': 'kept' };
        S.handleRevision(key, map[action], S.state.userId);
        U.toast({ 'rev-publish': '已发布为新版本', 'rev-variant': '已收为表达变体', 'rev-keep': '已保留原版' }[action], {
          kind: 'ok', detail: action === 'rev-publish' ? '旧版全部表达退出匹配' : ''
        });
        gov.render();
      } else if (action === 'refresh') {
        App.engine.startRefresh(key);
        gov.render();
      }
    });
  }

  function openFix(key) {
    var t = targetByKey(key);
    if (!t) return;
    var grp = S.groupById(t.groupId);
    if (!grp) return;
    var cur = S.currentVersion(grp);
    var proposal = '';
    var rev = S.state.revisions.filter(function (r) { return r.groupId === grp.id && r.status === 'pending'; })[0];
    if (rev) proposal = rev.proposedAnswer;
    U.modal({
      title: '发布修正',
      width: 680,
      body: '<p class="modal__text">发布后成为新的当前版本，旧版全部表达退出匹配；被暂停的目标随修正一起恢复。</p>' +
        '<textarea class="field field--area" data-answer rows="12">' + U.esc(proposal || (cur ? cur.answer : '')) + '</textarea>' +
        '<textarea class="field field--area" data-basis rows="2" placeholder="核对依据（例如：官方文档、用户报告的具体问题）"></textarea>',
      actions: [
        { label: '取消' },
        {
          label: '发布修正', kind: 'primary', onClick: function (wrap) {
            var ta = wrap.querySelector('[data-answer]');
            var basis = wrap.querySelector('[data-basis]');
            var v = ta.value.trim();
            if (!v) { U.toast('答案不能为空', { kind: 'warn' }); return false; }
            var nv = S.publishVersion(grp.id, v, {
              basis: '管理员修正' + (basis && basis.value ? ' · ' + basis.value : ''),
              by: S.state.userId
            });
            S.suspensionsForGroup(grp.id).forEach(function (s) {
              if (s.status === 'active') S.releaseSuspension(s.id, 'fixed', S.state.userId);
            });
            S.state.reports.forEach(function (r) {
              if (r.groupId === grp.id && r.status === 'open') {
                r.status = 'resolved'; r.resolution = 'fixed'; r.handledBy = S.state.userId; r.handledAt = Date.now();
              }
            });
            if (rev) {
              rev.status = 'published'; rev.handledBy = S.state.userId; rev.handledAt = Date.now(); rev.publishedVersionId = nv.id;
            }
            S.addUsage({
              id: U.uid('u'), at: Date.now(), ownerId: S.state.userId, sessionId: null,
              query: '发布修订：' + grp.original.slice(0, 26), path: 'revision',
              cloudCalls: 0, totalMs: 0, cost: 0, ok: true
            });
            S.save(true);
            App.bus.emit('records:changed');
            U.toast('已发布 v' + nv.n + '，暂停已解除', { kind: 'ok', detail: '受影响问法重新走问答库' });
            gov.render();
            return true;
          }
        }
      ]
    });
  }

  function simulate(key) {
    var t = targetByKey(key);
    if (!t) return;
    var th = S.state.settings.pauseThreshold || 3;
    var voted = t.votes.members || [];
    var others = Object.keys(App.seed.users).filter(function (id) {
      return App.seed.users[id].verified && voted.indexOf(id) < 0;
    });
    if (!others.length) { U.toast('没有其他可投票的已验证成员', { kind: 'warn' }); return; }
    var saved = S.state.userId;
    var need = Math.max(1, th - t.votes.count);
    others.slice(0, need).forEach(function (id) {
      S.state.userId = id;
      S.addReport({
        groupId: t.groupId,
        type: t.type,
        versionId: t.versionId,
        matchKey: t.reports[0].matchKey,
        aliasText: t.aliasText,
        category: t.reports[0].category || 'mismatch',
        note: '（演示：模拟该成员提交的报告）'
      });
    });
    S.state.userId = saved;
    S.save(true);
    App.bus.emit('records:changed');
    var after = S.votesFor(key);
    if (after.count >= th) {
      U.toast('已达到 ' + th + ' 票，目标已临时暂停', { kind: 'warn', detail: '受影响请求现在交给云端，等管理员核查后恢复或修正' });
    } else {
      U.toast('已补齐到 ' + after.count + ' 票', { kind: 'info' });
    }
    gov.render();
  }

  gov.onChanged = function () {
    if (S.state.page === 'governance') gov.render();
  };

  gov.simulate = function (key) { simulate(key); };
  gov.openFix = function (key) { openFix(key); };
})();
