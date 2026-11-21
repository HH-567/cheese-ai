/* 柒柿AI · 纯前端演示 — 状态、权限与持久化 */
(function () {
  'use strict';
  var App = window.App, U = App.util;
  var KEY = 'qishi-ai.v1';
  // 更名前（神秘 Bot）存下的数据：只读迁移一次，之后统一用新键
  var LEGACY_KEYS = ['shenmi-bot.v2', 'shenmi-bot.v1'];
  var VERSION = 1;

  var S = (App.store = {});
  S.state = null;

  function freshState() {
    var seed = U.clone(App.seed);
    var sessions = seed.sessions.slice();
    if (!sessions.some(function (s) { return s.id === seed.newSessionId; })) {
      sessions.unshift({
        id: seed.newSessionId,
        ownerId: 'u-a',
        title: '新聊天',
        scope: seed.settings.defaultScope,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: []
      });
    }
    return {
      version: VERSION,
      userId: 'u-a',
      theme: 'light',
      page: 'chat',
      sessionId: seed.newSessionId,
      sessions: sessions,
      records: seed.records,
      reports: seed.reports,
      suspensions: seed.suspensions,
      revisions: seed.revisions,
      refreshTasks: [],
      usage: seed.usage,
      settings: seed.settings,
      library: seed.library,
      ui: {
        inspectorTab: 'trace', libFilter: 'all', libQuery: '', expanded: {},
        guideOpen: false, govTab: 'reports', variantOpen: null
      }
    };
  }

  S.reset = function (opts) {
    var keepTheme = opts && opts.keepTheme && S.state ? S.state.theme : 'light';
    var keepPage = opts && opts.keepPage && S.state ? S.state.page : 'chat';
    S.state = freshState();
    S.state.theme = keepTheme;
    S.state.page = keepPage;
    S.save(true);
    return S.state;
  };

  S.load = function () {
    var raw = null;
    var migrated = false;
    try { raw = U.store.get(KEY, null); } catch (e) { raw = null; }
    if (!raw) {
      for (var i = 0; i < LEGACY_KEYS.length && !raw; i++) {
        try { raw = U.store.get(LEGACY_KEYS[i], null); } catch (e) { raw = null; }
        if (raw) {
          migrated = true;
          U.store.remove(LEGACY_KEYS[i]);
        }
      }
    }
    if (!raw || raw.version !== VERSION || !raw.sessions || !raw.records) {
      S.state = freshState();
      S.save(true);
      return S.state;
    }
    if (!App.seed.users[raw.userId]) raw.userId = 'u-a';
    raw.theme = raw.theme === 'dark' ? 'dark' : 'light';
    raw.settings = Object.assign({}, App.seed.settings, raw.settings || {});
    raw.library = raw.library || App.seed.library;
    raw.reports = raw.reports || [];
    raw.suspensions = raw.suspensions || [];
    raw.revisions = raw.revisions || [];
    raw.refreshTasks = raw.refreshTasks || [];
    raw.ui = Object.assign({ inspectorTab: 'trace', libFilter: 'all', libQuery: '', expanded: {}, guideOpen: false, govTab: 'reports' }, raw.ui || {});
    raw.usage = raw.usage || [];
    S.state = raw;
    if (migrated) S.save(true);
    return raw;
  };

  var saveTimer = null;
  S.save = function (immediate) {
    if (immediate) {
      clearTimeout(saveTimer);
      U.store.set(KEY, S.state);
      return;
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { U.store.set(KEY, S.state); }, 260);
  };
  S.saveNow = function () { S.save(true); };

  /* ------------------------------ 身份与权限 ------------------------------ */
  S.user = function () { return App.seed.users[S.state.userId] || App.seed.users['u-a']; };
  S.userById = function (id) { return App.seed.users[id] || { name: id, initials: '?', color: '#888', verified: false, role: 'member' }; };
  S.isAdmin = function (userId) {
    return S.userById(userId || S.state.userId).role === 'admin';
  };
  S.library = function () { return S.state.library; };

  S.switchUser = function (userId) {
    if (!App.seed.users[userId]) return;
    S.state.userId = userId;
    var mine = S.sessionsFor(userId);
    var cur = S.getSession(S.state.sessionId);
    if (!cur || cur.ownerId !== userId) {
      S.state.sessionId = mine.length ? mine[0].id : S.createSession(userId, { activate: false }).id;
    }
    S.save(true);
  };

  /* ------------------------------ 会话 ------------------------------ */
  S.getSession = function (id) {
    return S.state.sessions.filter(function (s) { return s.id === id; })[0] || null;
  };

  S.currentSession = function () {
    var s = S.getSession(S.state.sessionId);
    if (!s) {
      s = S.createSession(S.state.userId, { activate: false });
      S.state.sessionId = s.id;
    }
    return s;
  };

  S.sessionsFor = function (userId) {
    return S.state.sessions
      .filter(function (s) { return s.ownerId === (userId || S.state.userId); })
      .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  };

  S.createSession = function (ownerId, opts) {
    opts = opts || {};
    var session = {
      id: U.uid('ses'),
      ownerId: ownerId || S.state.userId,
      title: opts.title || '新聊天',
      scope: opts.scope || S.state.settings.defaultScope,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };
    S.state.sessions.unshift(session);
    if (opts.activate !== false) S.state.sessionId = session.id;
    S.save();
    return session;
  };

  S.touchSession = function (session) {
    session.updatedAt = Date.now();
    if (session.title === '新聊天' && session.messages.length) {
      var firstUser = session.messages.filter(function (m) { return m.role === 'user'; })[0];
      if (firstUser) session.title = S.titleFrom(firstUser.content);
    }
    S.save();
  };

  S.titleFrom = function (text) {
    var t = App.md.plain(text).replace(/[`*_#>]/g, '').trim();
    if (t.length > 22) t = t.slice(0, 22) + '…';
    return t || '新聊天';
  };

  /* ------------------------------ 问题组 / 版本 / 变体 ------------------------------ */
  S.groupById = function (id) {
    return S.state.records.filter(function (r) { return r.id === id; })[0] || null;
  };
  S.recordById = S.groupById;

  S.currentVersion = function (g) {
    if (!g || !g.versions || !g.versions.length) return null;
    return g.versions.filter(function (v) { return v.id === g.currentVersionId; })[0] ||
      g.versions[g.versions.length - 1];
  };

  S.versionById = function (g, id) {
    return (g.versions || []).filter(function (v) { return v.id === id; })[0] || null;
  };

  S.variantsOf = function (g, versionId) {
    var vid = versionId || (S.currentVersion(g) || {}).id;
    return (g.variants || []).filter(function (v) {
      return v.versionId === vid && v.status === 'published';
    });
  };

  S.variantById = function (g, id) {
    return (g.variants || []).filter(function (v) { return v.id === id; })[0] || null;
  };

  /* 一条版本是否已过期需要核对（时效策略） */
  S.isStale = function (g) {
    var f = (g && g.freshness) || {};
    if (f.kind !== 'versioned') return false;
    return !!(f.reviewAt && f.reviewAt < Date.now());
  };

  S.isExpired = function (g) { return S.isStale(g); };

  /* 可访问范围：共享库 + 自己的个人库 */
  S.visibleRecords = function () {
    var uid = S.state.userId;
    return S.state.records.filter(function (r) {
      if (r.scope === 'shared') return true;
      return r.ownerId === uid;
    });
  };

  S.matchableRecords = function () {
    return S.visibleRecords().filter(function (r) {
      return r.status === 'active' || r.status === 'learning';
    });
  };

  S.addRecord = function (rec) {
    S.state.records.unshift(rec);
    S.save();
    return rec;
  };

  S.countAliases = function () {
    return S.visibleRecords().reduce(function (n, r) {
      return n + (r.aliases || []).filter(function (a) { return a.status === 'active'; }).length;
    }, 0);
  };

  /* ------------------------------ 暂停 / 报告 / 修订 ------------------------------ */
  function targetKeyOf(p) {
    if (p.type === 'version') return 'g:' + p.groupId + ':v:' + p.versionId;
    return 'g:' + p.groupId + ':m:' + U.key(p.matchKey || '');
  }
  S.targetKeyOf = targetKeyOf;

  S.activeSuspension = function (targetKey) {
    return S.state.suspensions.filter(function (s) {
      return s.status === 'active' && targetKeyOf(s) === targetKey;
    })[0] || null;
  };

  /* 命中目标是否被暂停（全局） */
  S.suspensionForMatch = function (groupId, matchKey, versionId) {
    var list = S.state.suspensions.filter(function (s) { return s.status === 'active' && s.groupId === groupId; });
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s.kind === 'match' && U.key(s.matchKey || '') === U.key(matchKey || '')) return s;
      if (s.kind === 'version' && versionId && s.versionId === versionId) return s;
    }
    return null;
  };

  S.suspensionsForGroup = function (groupId) {
    return S.state.suspensions.filter(function (s) { return s.groupId === groupId; });
  };

  /* 报告人自己绕开的对象（事实 / 错配从第一条起生效） */
  S.bypassTargets = function (userId) {
    var set = {};
    S.state.reports.forEach(function (r) {
      if (r.byUserId === (userId || S.state.userId) && (r.category === 'fact' || r.category === 'mismatch')) {
        set[r.targetKey] = true;
      }
    });
    return set;
  };

  S.votesFor = function (targetKey) {
    var win = ((S.state.settings.pauseWindowDays || 7) * 86400000);
    var since = Date.now() - win;
    var rows = S.state.reports.filter(function (r) {
      return r.targetKey === targetKey && r.at >= since && (r.category === 'fact' || r.category === 'mismatch');
    });
    var members = {};
    rows.forEach(function (r) {
      var u = App.seed.users[r.byUserId];
      if (u && u.verified) members[r.byUserId] = true;
    });
    return { count: Object.keys(members).length, rows: rows, members: Object.keys(members) };
  };

  S.addReport = function (payload) {
    var uid = S.state.userId;
    var targetKey = targetKeyOf(payload);
    var existing = null;
    S.state.reports.forEach(function (r) {
      if (r.byUserId === uid && r.targetKey === targetKey && r.category === payload.category && r.status === 'open') existing = r;
    });
    var report = existing;
    if (!existing) {
      report = {
        id: U.uid('rp'),
        at: Date.now(),
        byUserId: uid,
        groupId: payload.groupId,
        targetKey: targetKey,
        type: payload.type,
        versionId: payload.versionId || null,
        matchKey: payload.type === 'match' ? U.key(payload.matchKey || '') : null,
        aliasText: payload.aliasText || null,
        category: payload.category,
        note: payload.note || '',
        status: payload.category === 'style' ? 'resolved' : 'open',
        resolution: payload.category === 'style' ? 'style' : null,
        handledAt: payload.category === 'style' ? Date.now() : null
      };
      S.state.reports.unshift(report);
    } else {
      report.note = payload.note || report.note;
      report.at = Date.now();
    }

    var g = S.groupById(payload.groupId);
    if (g) g.reports = (g.reports || 0) + 1;

    // 风格反馈：记录一条建议，不参与暂停
    if (payload.category === 'style') {
      S.save(true);
      return { report: report, votes: { count: 0, members: [], rows: [] }, suspension: null };
    }

    var votes = S.votesFor(targetKey);
    var threshold = S.state.settings.pauseThreshold || 3;
    var suspension = S.activeSuspension(targetKey);
    if (!suspension && votes.count >= threshold) {
      suspension = {
        id: U.uid('sp'),
        groupId: payload.groupId,
        kind: payload.type,
        matchKey: payload.type === 'match' ? U.key(payload.matchKey || '') : null,
        aliasText: payload.aliasText || null,
        versionId: payload.type === 'version' ? payload.versionId : null,
        status: 'active',
        since: Date.now(),
        by: 'system',
        reason: (S.state.settings.pauseWindowDays || 7) + ' 天窗口内 ' + votes.count + ' 名已验证成员报告同一目标',
        reportIds: votes.rows.map(function (r) { return r.id; }),
        rounds: 1
      };
      S.state.suspensions.unshift(suspension);
      votes.rows.forEach(function (r) { r.resolution = 'suspended'; });
      App.bus && App.bus.emit('records:changed');
    }
    S.save(true);
    return { report: report, votes: votes, suspension: suspension };
  };

  S.releaseSuspension = function (id, resolution, by) {
    var s = S.state.suspensions.filter(function (x) { return x.id === id; })[0];
    if (!s) return null;
    s.status = 'released';
    s.resolution = resolution || 'restored';
    s.releasedAt = Date.now();
    s.releasedBy = by || S.state.userId;
    var key = targetKeyOf(s);
    S.state.reports.forEach(function (r) {
      if (r.targetKey === key && r.status === 'open') { r.status = 'resolved'; r.resolution = s.resolution; r.handledBy = s.releasedBy; r.handledAt = Date.now(); }
    });
    S.save(true);
    App.bus && App.bus.emit('records:changed');
    return s;
  };

  /* 发布一版新答案：旧版全部表达一起退出匹配 */
  S.publishVersion = function (groupId, answer, opts) {
    opts = opts || {};
    var g = S.groupById(groupId);
    if (!g) return null;
    var oldV = S.currentVersion(g);
    var n = (g.versions || []).length + 1;
    var newV = {
      id: 'v' + n, n: n, answer: answer, status: 'published',
      basis: opts.basis || '管理员发布 · 修订建议',
      by: opts.by || S.state.userId,
      createdAt: Date.now(),
      factKey: opts.factKey || null
    };
    if (oldV) oldV.status = 'superseded';
    if (!g.versions) g.versions = [];
    g.versions.push(newV);
    g.currentVersionId = newV.id;
    g.updatedAt = Date.now();
    if (g.status === 'paused') g.status = 'active';
    S.save(true);
    App.bus && App.bus.emit('records:changed');
    return newV;
  };

  S.rollbackVersion = function (groupId, versionId, by) {
    var g = S.groupById(groupId);
    if (!g) return null;
    var target = S.versionById(g, versionId);
    if (!target) return null;
    (g.versions || []).forEach(function (v) {
      if (v.n > target.n) v.status = 'rolledback';
      else if (v.id === target.id) v.status = 'published';
    });
    g.currentVersionId = target.id;
    g.updatedAt = Date.now();
    S.save(true);
    App.bus && App.bus.emit('records:changed');
    return target;
  };

  S.addRevision = function (groupId, proposedAnswer, note) {
    var g = S.groupById(groupId);
    var cur = S.currentVersion(g) || { id: null };
    var rev = {
      id: U.uid('rv'), groupId: groupId, baseVersionId: cur.id,
      proposedAnswer: proposedAnswer, note: note || '',
      byUserId: S.state.userId, at: Date.now(), status: 'pending',
      handledBy: null, handledAt: null
    };
    S.state.revisions.unshift(rev);
    S.save(true);
    App.bus && App.bus.emit('records:changed');
    return rev;
  };

  S.handleRevision = function (revId, action, by) {
    var rev = S.state.revisions.filter(function (r) { return r.id === revId; })[0];
    if (!rev) return null;
    var g = S.groupById(rev.groupId);
    by = by || S.state.userId;
    if (action === 'publish') {
      var v = S.publishVersion(rev.groupId, rev.proposedAnswer, { basis: '管理员发布 · ' + S.userById(rev.byUserId).name + ' 的修订建议', by: by });
      rev.status = 'published';
      rev.publishedVersionId = v.id;
      S.addUsage({
        id: U.uid('u'), at: Date.now(), ownerId: by, sessionId: null,
        query: '发布修订：' + (g ? g.original.slice(0, 26) : rev.groupId), path: 'revision',
        cloudCalls: 0, firstTokenMs: 0, totalMs: 0, cost: 0, ok: true
      });
    } else if (action === 'variant') {
      g.variants = g.variants || [];
      g.variants.push({
        id: U.uid('var'), versionId: S.currentVersion(g).id, style: 'detailed',
        text: rev.proposedAnswer, status: 'published', by: rev.byUserId, at: Date.now()
      });
      g.updatedAt = Date.now();
      rev.status = 'variant';
    } else {
      rev.status = 'kept';
    }
    rev.handledBy = by;
    rev.handledAt = Date.now();
    S.save(true);
    App.bus && App.bus.emit('records:changed');
    return rev;
  };

  /* 个人库：本人采用「重新问云端」的结果为新版本 */
  S.adoptVersion = function (groupId, answer, note) {
    var v = S.publishVersion(groupId, answer, { basis: '本人采用 · 重新问云端的结果', by: S.state.userId });
    var g = S.groupById(groupId);
    if (g) {
      S.suspensionsForGroup(groupId).forEach(function (s) {
        if (s.status === 'active') S.releaseSuspension(s.id, 'fixed', S.state.userId);
      });
    }
    return v;
  };

  /* ------------------------------ 时效核对任务 ------------------------------ */
  S.refreshTaskFor = function (groupId) {
    return S.state.refreshTasks.filter(function (t) {
      return t.groupId === groupId && (t.state === 'running' || t.state === 'pending');
    })[0] || null;
  };

  /* ------------------------------ 用量 ------------------------------ */
  S.addUsage = function (row) {
    S.state.usage.unshift(row);
    if (S.state.usage.length > 300) S.state.usage.length = 300;
    S.save();
    return row;
  };

  S.usageStats = function (filterUserId) {
    var rows = S.state.usage.filter(function (r) { return !filterUserId || r.ownerId === filterUserId; });
    var answers = rows.filter(function (r) { return r.path !== 'learn' && r.path !== 'clarify' && r.path !== 'revision'; });
    var total = answers.length;
    var reuse = answers.filter(function (r) { return r.cloudCalls === 0 && r.ok; });
    var cloudRows = rows.filter(function (r) { return r.cloudCalls > 0; });
    var reported = rows.filter(function (r) { return r.reported; });
    var cost = rows.reduce(function (n, r) { return n + (r.cost || 0); }, 0);
    var firsts = cloudRows.map(function (r) { return r.firstTokenMs; }).filter(Boolean).sort(function (a, b) { return a - b; });
    var durations = rows.map(function (r) { return r.totalMs; }).filter(Boolean).sort(function (a, b) { return a - b; });
    function median(arr) { return arr.length ? arr[Math.floor(arr.length / 2)] : 0; }
    var paths = { exact: 0, alias: 0, semantic: 0, cloud: 0, learn: 0, clarify: 0, tool: 0, revision: 0, other: 0 };
    rows.forEach(function (r) {
      if (paths[r.path] == null) paths.other++; else paths[r.path]++;
    });
    rows = rows.slice().sort(function (a, b) { return b.at - a.at; });
    return {
      total: total,
      reuseCount: reuse.length,
      reuseRate: total ? reuse.length / total : 0,
      cloudCalls: rows.reduce(function (n, r) { return n + (r.cloudCalls || 0); }, 0),
      cloudRows: cloudRows.length,
      cost: cost,
      firstTokenMedian: median(firsts),
      durationMedian: median(durations),
      reported: reported.length,
      paths: paths,
      rows: rows
    };
  };

  /* ------------------------------ 治理视图数据 ------------------------------ */
  S.governance = function () {
    var openReports = S.state.reports.filter(function (r) { return r.status === 'open'; });
    var byTarget = {};
    openReports.forEach(function (r) {
      if (!byTarget[r.targetKey]) {
        byTarget[r.targetKey] = {
          key: r.targetKey, groupId: r.groupId, type: r.type, versionId: r.versionId,
          aliasText: r.aliasText, reports: [], categories: {}
        };
      }
      byTarget[r.targetKey].reports.push(r);
      byTarget[r.targetKey].categories[r.category] = (byTarget[r.targetKey].categories[r.category] || 0) + 1;
    });
    // 仍在暂停、但没有未处理报告的（例如报告已随暂停一起归档）也要出现在队列里
    S.state.suspensions.forEach(function (sp) {
      if (sp.status !== 'active') return;
      var key = targetKeyOf(sp);
      if (byTarget[key]) return;
      var rows = S.state.reports.filter(function (r) { return r.targetKey === key; });
      byTarget[key] = {
        key: key, groupId: sp.groupId, type: sp.kind, versionId: sp.versionId,
        aliasText: sp.aliasText, reports: rows.sort(function (a, b) { return b.at - a.at; }),
        categories: rows.reduce(function (acc, r) { acc[r.category] = (acc[r.category] || 0) + 1; return acc; }, {})
      };
    });
    Object.keys(byTarget).forEach(function (k) {
      var t = byTarget[k];
      t.votes = S.votesFor(k);
      t.suspension = S.activeSuspension(k);
      t.group = S.groupById(t.groupId);
      t.reports.sort(function (a, b) { return b.at - a.at; });
    });
    var activeSuspensions = S.state.suspensions.filter(function (s) { return s.status === 'active'; });
    var released = S.state.suspensions.filter(function (s) { return s.status === 'released'; });
    var pendingRevisions = S.state.revisions.filter(function (r) { return r.status === 'pending'; });
    var handled = S.state.reports.filter(function (r) { return r.handledAt; });
    var handleMs = handled.length
      ? handled.reduce(function (n, r) { return n + Math.max(0, (r.handledAt || r.at) - r.at); }, 0) / handled.length
      : 0;
    var last7 = S.state.reports.filter(function (r) { return r.at > Date.now() - 7 * 86400000; }).length;
    var closed = S.state.suspensions.filter(function (s) { return s.status === 'released'; });
    var restoredWithoutChange = closed.filter(function (s) { return s.resolution === 'restored'; }).length;
    return {
      openReports: openReports,
      targets: Object.keys(byTarget).map(function (k) { return byTarget[k]; })
        .sort(function (a, b) { return b.votes.count - a.votes.count; }),
      suspensions: activeSuspensions,
      released: released,
      revisions: pendingRevisions,
      allRevisions: S.state.revisions,
      metrics: {
        open: openReports.length,
        suspended: activeSuspensions.length,
        pendingRev: pendingRevisions.length,
        last7: last7,
        handled: handled.length,
        handleMs: handleMs,
        falseStopRate: closed.length ? restoredWithoutChange / closed.length : 0,
        closed: closed.length
      }
    };
  };

  S.setPage = function (page) {
    S.state.page = page;
    S.save();
  };
})();
