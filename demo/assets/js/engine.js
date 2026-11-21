/* 柒柿AI · 纯前端演示 — 请求管线
 * 指代补全 → 会话记忆 → 本地工具 → 精确/等价 → 语义 → 条件校验 → 暂停检查 → 时效检查 → 复用/云端 → 学习
 */
(function () {
  'use strict';
  var App = window.App, U = App.util, S = App.store, M = App.matcher, C = App.cloud, T = App.tools;
  var E = (App.engine = {});
  var DAY = 86400000;

  /* ------------------------------- 会话记忆 ------------------------------- */
  var CONSTRAINT_RULES = [
    { re: /没有?\s*(独显|独立显卡)|无独显/g, text: '没有独显' },
    { re: /预算[^，。；,]{0,4}(?:有限|不多|不太多|紧|不够|少)|少花钱|省钱/g, text: '预算有限' },
    { re: /(?:预算|价格|花)\D{0,4}(\d{3,6})\s*(?:元|块)/g, text: function (m) { return '预算 ' + m[1] + ' 元'; } },
    { re: /(Windows|Mac|macOS|Linux)/gi, text: function (m) { return '平台：' + m[1]; } },
    { re: /Python\s*([23])/g, text: function (m) { return 'Python ' + m[1]; } },
    { re: /\b(React|Vue|Angular|Svelte)\b/g, text: function (m) { return '框架：' + m[1]; } },
    { re: /用(中文|英语|英文)/g, text: function (m) { return '输出语言：' + m[1]; } },
    { re: /(excel|wps|ppt|word)/gi, text: function (m) { return '工具：' + m[1]; } },
    { re: /(RTX|5060|4090|显卡|显存)/gi, text: function (m) { return '硬件：' + m[1]; } }
  ];

  E.extractConstraints = function (text) {
    var out = [], seen = {};
    CONSTRAINT_RULES.forEach(function (r) {
      var re = new RegExp(r.re.source, r.re.flags);
      var m, guard = 0;
      while ((m = re.exec(text)) && guard++ < 6) {
        var v = typeof r.text === 'function' ? r.text(m) : r.text;
        var k = v.toLowerCase();
        if (!seen[k]) { seen[k] = 1; out.push(v); }
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    });
    return out;
  };

  E.memoryOf = function (session, currentText, limit, excludeId) {
    limit = limit || S.state.settings.maxContextTurns || 3;
    var msgs = (session.messages || []).filter(function (m) { return m.id !== excludeId; });
    if (msgs.length && msgs[msgs.length - 1].role === 'user' && msgs[msgs.length - 1].content === currentText) msgs.pop();
    var turns = [];
    for (var i = msgs.length - 1; i >= 0 && turns.length < limit; i--) {
      if (msgs[i].role !== 'assistant') continue;
      var q = '';
      for (var j = i - 1; j >= 0; j--) { if (msgs[j].role === 'user') { q = msgs[j].content; break; } }
      turns.unshift({ q: q, a: msgs[i].content, meta: msgs[i].meta || null });
    }
    var constraints = [];
    turns.forEach(function (t) { constraints = constraints.concat(E.extractConstraints(t.q)); });
    constraints = constraints.concat(E.extractConstraints(currentText));
    var seen = {}, uniq = [];
    constraints.forEach(function (c) { if (!seen[c]) { seen[c] = 1; uniq.push(c); } });

    var options = [];
    for (var k = turns.length - 1; k >= 0; k--) {
      var m = turns[k].meta;
      if (m && m.options && m.options.length >= 2) { options = m.options; break; }
    }
    return { turns: turns, constraints: uniq, options: options };
  };

  var CN_NUM = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5 };

  E.resolve = function (text, memory) {
    var t = String(text || '');
    var options = memory.options || [];
    var idxM = /(?:第|前)\s*([一二三四五1-5])\s*(?:个|条|项|种)?/.exec(t);
    var former = /前者/.test(t), latter = /后者/.test(t);
    var two = /(这两|那两|两者|二者|它们|这两个|两个方案)/.test(t);
    var cont = /^那(.{1,40}?)呢/.test(t) || /^(那么|那)/.test(t);

    if (idxM) {
      var idx = CN_NUM[idxM[1]] != null ? CN_NUM[idxM[1]] : parseInt(idxM[1], 10);
      if (options[idx - 1]) return { type: 'index', index: idx - 1, options: options, raw: idxM[0].trim() };
      return { type: 'ambiguous', reason: 'index-miss', options: options };
    }
    if (former || latter) {
      if (latter && options[1]) return { type: 'index', index: 1, options: options, raw: '后者' };
      if (former && options[0]) return { type: 'index', index: 0, options: options, raw: '前者' };
      return { type: 'ambiguous', reason: 'index-miss', options: options };
    }
    if (two) {
      if (options.length >= 2) return { type: 'two', options: options };
      return { type: 'ambiguous', reason: 'no-options', options: options };
    }
    if (cont) return { type: 'continuation', options: options };
    return null;
  };

  function twoAnswer(constraints, a, b) {
    var cond = constraints.length ? '在「' + constraints.join('、') + '」的条件下，' : '';
    return cond + '比较「' + a + '」和「' + b + '」，哪个更适合、为什么？';
  }

  /* ------------------------------- 学习任务 ------------------------------- */
  function startLearn(rec, learn, trace, sink) {
    var settings = S.state.settings;
    var planned = C.planParaphrases(learn, settings.paraphraseCount || 5);
    rec.learnTask = {
      state: 'running',
      planned: planned,
      total: planned.length,
      passed: 0,
      rejected: 0,
      startedAt: Date.now()
    };
    App.bus.emit('records:changed');

    var delay = U.rand(2600, 4200);
    rec.learnTask.timer = setTimeout(function () { finishLearn(rec, trace, sink); }, delay);
    return rec;
  }

  function finishLearn(rec, trace, sink) {
    var settings = S.state.settings;
    var lt = rec.learnTask || {};
    var planned = lt.planned || [];
    if (lt.state === 'done') return;
    rec.aliases = planned.map(function (a) {
      return { text: a.text, status: a.status, reason: a.reason || '', source: 'generated', at: Date.now() };
    });
    rec.status = 'active';
    rec.updatedAt = Date.now();
    lt.state = 'done';
    lt.passed = rec.aliases.filter(function (a) { return a.status === 'active'; }).length;
    lt.rejected = rec.aliases.length - lt.passed;
    lt.finishedAt = Date.now();
    delete lt.timer;

    var text = planned.map(function (a) { return a.text; }).join('\n');
    var est = C.estimate(rec.original + '\n' + M.answerOf(rec), text, settings);
    lt.cost = est.cost;
    lt.tokensOut = est.tokensOut;

    S.addUsage({
      id: U.uid('u'), at: Date.now(), ownerId: rec.ownerId, sessionId: null,
      query: '后台改写：' + rec.original.slice(0, 26), path: 'learn',
      cloudCalls: 1, firstTokenMs: 0, totalMs: Math.round(U.rand(1400, 2600)),
      cost: est.cost, tokensIn: est.tokensIn, tokensOut: est.tokensOut, ok: true, reported: false
    });

    if (trace && sink) {
      var step = trace.steps.filter(function (s) { return s.key === 'learn'; })[0];
      if (step) {
        step.state = 'ok';
        step.detail = '生成 ' + rec.aliases.length + ' 条 · 通过 ' + lt.passed + ' · 拒收 ' + lt.rejected + ' · 已入库';
      }
      sink.onTrace && sink.onTrace(trace);
    }
    S.save(true);
    App.bus.emit('records:changed');
    App.bus.emit('trace', trace);
    if (App.views && App.views.chat && App.views.chat.onLearnDone) App.views.chat.onLearnDone(rec);
  }

  E.resumeTasks = function () {
    S.state.records.forEach(function (rec) {
      if (rec.status === 'learning' && rec.learnTask) {
        if (Date.now() - (rec.learnTask.startedAt || 0) > 1200) finishLearn(rec, null, null);
      }
    });
    S.state.refreshTasks.forEach(function (t) {
      if (t.state === 'running' && Date.now() - t.startedAt > 2000) E.finishRefresh(t.groupId, t.id);
    });
  };

  /* 重新跑一遍等价检查（幂等，不花云端成本） */
  E.recheck = function (rec) {
    var passed = 0, rejected = 0;
    (rec.aliases || []).forEach(function (a) {
      if (a.source === 'reused') { a.status = 'active'; passed++; return; }
      var chk = C.checkAlias(rec.original, a.text, M.answerOf(rec));
      a.status = chk.ok ? 'active' : 'rejected';
      a.reason = chk.ok ? '' : chk.reason;
      if (chk.ok) passed++; else rejected++;
    });
    rec.updatedAt = Date.now();
    S.save(true);
    App.bus.emit('records:changed');
    U.toast('重新检查完成：' + passed + ' 条通过 · ' + rejected + ' 条拒收', {
      kind: 'info', detail: '检查只比对条件，不产生云端调用'
    });
  };

  /* ------------------------------- 暂停 / 绕开 ------------------------------- */
  E.blockReason = function (rec, matchKey) {
    var cur = S.currentVersion(rec) || {};
    var sp = S.suspensionForMatch(rec.id, matchKey, cur.id);
    if (sp) {
      return {
        kind: 'suspended',
        reason: (sp.kind === 'version' ? 'v' + (S.versionById(rec, sp.versionId) || {}).n + ' 版本' : '这条匹配关系') +
          '已被暂停（' + (sp.reportIds || []).length + ' 名已验证成员报告），本次交给云端'
      };
    }
    var bypass = S.bypassTargets();
    var mKey = 'g:' + rec.id + ':m:' + U.key(matchKey || '');
    var vKey = 'g:' + rec.id + ':v:' + cur.id;
    if (bypass[mKey] || bypass[vKey]) {
      return { kind: 'bypass', reason: '你之前报告过这个目标，按规则本次为你绕开它' };
    }
    return null;
  };

  /* ------------------------------- 时效核对 ------------------------------- */
  E.staleAnswer = function (g) {
    var f = g.freshness || {};
    var v = S.currentVersion(g);
    var lastCheck = f.lastCheckedAt || f.reviewAt || Date.now();
    var days = Math.max(0, Math.floor((Date.now() - lastCheck) / DAY));
    return [
      '**这条记录需要先核对，暂无法确认当前值。**',
      '',
      '它属于「会变的资料」，库里保存的是带版本号的快照，不是实时值。',
      '',
      '| 项目 | 值 |',
      '| --- | --- |',
      '| 记录来源 | ' + (f.source || '—') + ' |',
      '| 来源版本 | `' + (f.sourceVersion || '—') + '` |',
      '| 上次核对 | ' + U.date(lastCheck) + '（' + days + ' 天前） |',
      '| 复核间隔 | ' + (f.reviewIntervalDays || 30) + ' 天 |',
      '',
      '按设计：到期不会定时刷新，等下一次有人问再核对；同一来源版本同时只允许一个在途核对任务。你可以点下面的「去核对（模拟）」触发一次。'
    ].join('\n');
  };

  E.startRefresh = function (groupId) {
    var g = S.groupById(groupId);
    if (!g) return null;
    var running = S.refreshTaskFor(groupId);
    if (running) {
      U.toast('已有在途核对任务', { kind: 'warn', detail: '同一来源版本只允许一个在途核对，避免重复成本' });
      return running;
    }
    var task = {
      id: U.uid('rt'), groupId: groupId, state: 'running',
      source: (g.freshness || {}).source || '外部来源',
      sourceVersion: (g.freshness || {}).sourceVersion || '',
      startedAt: Date.now()
    };
    S.state.refreshTasks.unshift(task);
    S.save(true);
    App.bus.emit('records:changed');
    U.toast('已发起核对（模拟抓取来源）', { kind: 'info', detail: '同一来源版本只会有一个在途任务' });
    setTimeout(function () { E.finishRefresh(groupId, task.id); }, U.rand(1800, 2800));
    return task;
  };

  E.finishRefresh = function (groupId, taskId) {
    var g = S.groupById(groupId);
    var task = S.state.refreshTasks.filter(function (t) { return t.id === taskId || t.groupId === groupId; })[0];
    if (!g || !task) return;
    if (task.state === 'done') return;
    // 演示：内容未变化，只更新核验时间
    g.freshness = g.freshness || {};
    g.freshness.lastCheckedAt = Date.now();
    g.freshness.reviewAt = Date.now() + (g.freshness.reviewIntervalDays || 30) * DAY;
    task.state = 'done';
    task.finishedAt = Date.now();
    task.result = 'unchanged';
    S.addUsage({
      id: U.uid('u'), at: Date.now(), ownerId: S.state.userId, sessionId: null,
      query: '来源核对：' + g.original.slice(0, 24), path: 'learn',
      cloudCalls: 0, firstTokenMs: 0, totalMs: Date.now() - task.startedAt,
      cost: 0, ok: true
    });
    S.save(true);
    App.bus.emit('records:changed');
    U.toast('核对完成：来源内容未变化', { kind: 'ok', detail: '已更新核验时间，这条记录恢复可用' });
  };

  /* ------------------------------- 主流程 ------------------------------- */
  E.run = function (opts) {
    var session = opts.session;
    var text = opts.text;
    var msg = opts.msg;
    var sink = opts.sink || {};
    var settings = S.state.settings;
    var t0 = Date.now();

    var trace = {
      id: U.uid('tr'), at: t0, query: text, steps: [], candidates: [],
      decision: null, resolved: null, groupId: null, versionId: null, matchType: null,
      model: settings.model, threshold: settings.threshold,
      usage: { cloudCalls: 0, firstTokenMs: 0, totalMs: 0, cost: 0, tokensIn: 0, tokensOut: 0 },
      error: null
    };
    var meta = {
      source: 'cloud', groupId: null, versionId: null, variantId: null, matchedAlias: null,
      matchType: 'none', score: 0, usage: trace.usage, trace: trace, candidates: [], options: [],
      status: 'pending', error: null, at: Date.now(),
      reAskOf: opts.reAsk || null
    };
    msg.meta = meta;

    function emit() {
      try { sink.onTrace && sink.onTrace(trace); } catch (e) { }
      App.bus.emit('trace', trace);
    }
    function step(key, label, state, detail) {
      var s = trace.steps.filter(function (x) { return x.key === key; })[0];
      if (s) { s.state = state; s.detail = detail; }
      else { trace.steps.push({ key: key, label: label, state: state, detail: detail }); }
      emit();
      return s;
    }
    function done() {
      meta.status = 'done';
      S.touchSession(session);
      S.save(true);
      sink.onDone && sink.onDone(meta);
      App.bus.emit('message:done', { session: session, msg: msg });
    }

    return (async function () {
      var memory = E.memoryOf(session, text, null, msg.id);
      var resolved = E.resolve(text, memory);
      var effective = text;
      var mode = null;

      /* 1) 指代补全 */
      if (resolved && resolved.type === 'two') {
        var a = resolved.options[0].label, b = resolved.options[1].label;
        effective = twoAnswer(memory.constraints, a, b);
        mode = 'compare';
        trace.resolved = { kind: 'two', options: [resolved.options[0], resolved.options[1]], completed: effective };
        step('refs', '指代补全', 'ok', '「这两个」→ 补全为：' + effective);
      } else if (resolved && resolved.type === 'index') {
        var opt = resolved.options[resolved.index];
        mode = resolved.index === 1 ? 'second' : 'compare';
        effective = (memory.constraints.length ? '在「' + memory.constraints.join('、') + '」的条件下，' : '') +
          '具体说说「' + opt.label + '」：它怎么落地、成本多少、适合什么情况？';
        trace.resolved = { kind: 'index', index: resolved.index, options: resolved.options, completed: effective };
        step('refs', '指代补全', 'ok', '「' + (resolved.raw || ('第' + (resolved.index + 1) + '个')) + '」→ 指向「' + opt.label + '」');
      } else if (resolved && resolved.type === 'continuation') {
        trace.resolved = { kind: 'continuation', completed: text };
        step('refs', '指代补全', 'ok', '「那…呢」延续上文，沿用最近对话里的对象');
      } else if (resolved && resolved.type === 'ambiguous') {
        step('refs', '指代补全', 'fail', '上下文里找不到可指代的对象（' +
          (resolved.reason === 'no-options' ? '上文没有列过候选方案' : '编号超出上文列出的范围') + '）');
        meta.source = 'local';
        meta.clarify = true;
        meta.matchType = 'clarify';
        msg.content = [
          '我需要先确认一下你指的是哪两个：现在的对话里还没找到可以指代的对象。',
          '',
          '可以这样继续：',
          '',
          '- 直接把两个方案的名称贴出来，我来比较；',
          '- 或者先说「给我两个运行 AI 助手的方案」，我列出选项后你再追问。'
        ].join('\n');
        step('answer', '本地追问', 'ok', '指代有歧义 → 先问清楚，不调用云端');
        trace.decision = 'ask';
        meta.usage.totalMs = Math.round(U.rand(6, 14));
        S.addUsage({
          id: U.uid('u'), at: Date.now(), ownerId: S.state.userId, sessionId: session.id,
          query: text, path: 'clarify', cloudCalls: 0, firstTokenMs: 0, totalMs: meta.usage.totalMs,
          cost: 0, tokensIn: 0, tokensOut: 0, ok: true
        });
        await U.sleep(180);
        done();
        return;
      } else {
        step('refs', '指代补全', 'skip', '未检测到「这两个 / 第二个 / 那…呢」等指代');
      }

      /* 2) 会话记忆 */
      if (memory.turns.length) {
        var det = '载入最近 ' + memory.turns.length + ' 轮';
        if (memory.constraints.length) det += ' · 提取条件：' + memory.constraints.join('、');
        step('memory', '会话记忆', 'ok', det);
      } else {
        step('memory', '会话记忆', 'skip', '新会话，无历史上下文');
      }

      /* 3) 本地工具 */
      var toolDet = opts.forceCloud ? null : T.detect(effective, settings);
      if (toolDet) {
        var toolRes = T.run(toolDet);
        if (toolRes.ok) {
          step('tool', '本地工具', 'ok', toolRes.detail);
          await U.sleep(U.rand(100, 220));
          msg.content = toolRes.text;
          meta.source = 'tool';
          meta.matchType = 'tool';
          meta.tool = { kind: toolRes.tool, detail: toolRes.detail, costMs: toolRes.costMs };
          meta.usage.cloudCalls = 0;
          meta.usage.firstTokenMs = 0;
          meta.usage.totalMs = Math.max(1, Math.round(toolRes.costMs));
          trace.decision = 'tool';
          trace.matchType = 'tool';
          step('answer', '本地计算', 'ok', '按本次输入现算 · ' + meta.usage.totalMs + ' ms · 0 次云端调用');
          step('learn', '写入会话', 'skip', '工具结果只写会话，不进问答库（库里只保留工具路由）');
          S.addUsage({
            id: U.uid('u'), at: Date.now(), ownerId: S.state.userId, sessionId: session.id,
            query: text, path: 'tool', cloudCalls: 0, firstTokenMs: 0, totalMs: meta.usage.totalMs,
            cost: 0, tokensIn: 0, tokensOut: 0, ok: true
          });
          done();
          return;
        }
        step('tool', '本地工具', 'fail', '识别到算术但解析失败：' + (toolRes.error || '表达式不合法') + '，改走云端');
      } else {
        step('tool', '本地工具', 'skip', '不是日期 / 星期 / 时间 / 算术请求');
      }

      /* 4) 查库 */
      if (opts.forceCloud) {
        step('exact', '精确匹配', 'skip', '用户主动要求重新问云端');
        step('alias', '等价问法', 'skip', '跳过');
        step('semantic', '语义检索', 'skip', '跳过');
        step('verify', '条件校验', 'skip', '跳过');
        step('pause', '暂停检查', 'skip', '跳过');
        step('freshness', '时效检查', 'skip', '跳过');
      } else {
        var groups = S.matchableRecords();
        var analysis = M.analyze(effective, groups, {
          threshold: settings.threshold,
          skipSemantic: !!trace.resolved && trace.resolved.kind !== 'continuation',
          isBlocked: function (rec, matchKey) { return E.blockReason(rec, matchKey); }
        });
        trace.reason = analysis.reason;

        if (analysis.exact) {
          step('exact', '精确匹配', 'ok', '在 ' + groups.length + ' 条可见记录中比中原问「' + analysis.exact.record.original.slice(0, 24) + '」');
        } else {
          step('exact', '精确匹配', 'ok', '在 ' + groups.length + ' 条可见记录中比对原问 · 0 条');
        }

        if (analysis.alias) {
          step('alias', '等价问法', 'ok', '命中已收录改写「' + analysis.alias.text.slice(0, 26) + '」· 0.99');
        } else {
          var aliasCount = groups.reduce(function (n, r) {
            return n + (r.aliases || []).filter(function (x) { return x.status === 'active'; }).length;
          }, 0);
          step('alias', '等价问法', 'ok', '在 ' + aliasCount + ' 条已收录改写中比对 · 0 条');
        }

        if (trace.resolved && trace.resolved.kind !== 'continuation') {
          step('semantic', '语义检索', 'skip', '补全后的问题需要结合前文，只在精确索引里找');
        } else if (analysis.shortlist && analysis.shortlist.length) {
          var top = analysis.shortlist[0];
          step('semantic', '语义检索', 'ok',
            '本地向量召回 ' + analysis.shortlist.length + ' 条候选 · 最高 ' + top.score.toFixed(2) +
            '（门槛 ' + settings.threshold.toFixed(2) + '）');
        } else {
          step('semantic', '语义检索', 'ok', '本地向量召回 · 无高于 0.50 的候选');
        }

        if (analysis.conflicts && analysis.conflicts.length) {
          step('verify', '条件校验', 'fail', analysis.conflicts.map(function (c) { return c.field + '：' + c.detail; }).join('；'));
        } else if (analysis.decision === 'reuse') {
          step('verify', '条件校验', 'ok', '对象 / 数值 / 语言 / 否定条件一致 · 可复用');
        } else if (analysis.blocked && analysis.blocked.length) {
          step('verify', '条件校验', 'skip', '候选在暂停检查里被拦下，不再校验条件');
        } else if (trace.resolved && trace.resolved.kind !== 'continuation') {
          step('verify', '条件校验', 'skip', '补全后的问题需要结合前文，交给云端综合');
        } else {
          step('verify', '条件校验', 'skip', analysis.top ? '最高候选未过门槛，无需校验条件' : '无候选可校验');
        }

        if (analysis.blocked && analysis.blocked.length) {
          var seenReason = {};
          var reasons = [];
          analysis.blocked.forEach(function (b) {
            if (seenReason[b.reason]) return;
            seenReason[b.reason] = 1;
            reasons.push(b.reason);
          });
          step('pause', '暂停检查', 'fail', reasons.join('；'));
          if (!meta.reAskOf) {
            meta.reAskOf = {
              groupId: analysis.blocked[0].recordId,
              versionId: analysis.blocked[0].versionId || null,
              blocked: analysis.blocked[0].kind
            };
          }
        } else if (analysis.decision === 'reuse') {
          step('pause', '暂停检查', 'ok', '目标版本与匹配关系均未被暂停，也没有你报告过的对象');
        } else {
          step('pause', '暂停检查', 'skip', '无命中目标');
        }

        trace.candidates = (analysis.shortlist || []).map(function (c) {
          return {
            recordId: c.record.id, original: c.record.original, score: c.score,
            cov: c.cov, bigram: c.bigram, shared: c.shared, missing: c.missing,
            chosen: analysis.chosen && analysis.chosen.record.id === c.record.id
          };
        });

        if (analysis.decision === 'reuse') {
          var rec = analysis.chosen.record;
          var via = analysis.chosen.via;
          var version = S.currentVersion(rec);

          // 时效：会变的资料到期 → 本地提示 + 核对入口
          if (S.isStale(rec)) {
            var f = rec.freshness || {};
            step('freshness', '时效检查', 'fail',
              '来源版本 `' + (f.sourceVersion || '—') + '` 上次核对于 ' + U.date(f.reviewAt) +
              '，已超过 ' + (f.reviewIntervalDays || 30) + ' 天复核间隔');
            await U.sleep(U.rand(140, 260));
            msg.content = E.staleAnswer(rec);
            meta.source = 'library';
            meta.groupId = rec.id;
            meta.versionId = version ? version.id : null;
            meta.matchType = via;
            meta.matchedAlias = analysis.chosen.matchKey;
            meta.stale = true;
            meta.freshness = f;
            meta.usage.cloudCalls = 0;
            meta.usage.totalMs = Math.round(U.rand(9, 18));
            trace.decision = 'stale';
            trace.groupId = rec.id;
            trace.matchType = via;
            rec.hits = (rec.hits || 0) + 1;
            step('answer', '返回核对提示', 'ok', '暂无可用版本 · 0 次云端调用 · 等待核对');
            S.addUsage({
              id: U.uid('u'), at: Date.now(), ownerId: S.state.userId, sessionId: session.id,
              query: text, path: via, cloudCalls: 0, firstTokenMs: 0, totalMs: meta.usage.totalMs,
              cost: 0, ok: true
            });
            done();
            return;
          }

          await U.sleep(U.rand(160, 300));
          var ms = Math.round(U.rand(7, 15));
          meta.source = 'library';
          meta.groupId = rec.id;
          meta.versionId = version ? version.id : null;
          meta.matchType = via;
          meta.score = analysis.chosen.score;
          meta.matchedAlias = analysis.chosen.matchKey;
          meta.variants = S.variantsOf(rec).map(function (v) { return { id: v.id, style: v.style }; });
          meta.usage.cloudCalls = 0;
          meta.usage.totalMs = ms;
          meta.usage.firstTokenMs = 0;
          msg.content = version ? version.answer : '';
          rec.hits = (rec.hits || 0) + 1;
          trace.decision = 'reuse';
          trace.groupId = rec.id;
          trace.versionId = meta.versionId;
          trace.matchType = via;
          trace.variantCount = (meta.variants || []).length;
          step('freshness', '时效检查', 'ok', (rec.freshness || {}).kind === 'versioned'
            ? '来源版本在复核间隔内，可直接复用'
            : '稳定事实，无需日历到期任务');
          step('answer', '返回答案', 'ok',
            '读取' + (rec.scope === 'shared' ? '共享库' : '个人库') + ' ' + (version ? 'v' + version.n : '') +
            ' 版本的默认表达 · ' + ms + ' ms · 0 次云端调用');

          // 真实复用的新问法进入同一问题组
          if (via === 'semantic') {
            var chk = C.checkAlias(rec.original, text, M.answerOf(rec));
            if (chk.ok) {
              rec.aliases.push({ text: text, status: 'active', source: 'reused', at: Date.now() });
              rec.updatedAt = Date.now();
              step('learn', '问法入库', 'ok', '这次的真实问法通过等价检查，已加入该问题组');
              App.bus.emit('records:changed');
            } else {
              step('learn', '问法入库', 'skip', '真实问法未通过检查：' + chk.reason);
            }
          }
          S.addUsage({
            id: U.uid('u'), at: Date.now(), ownerId: S.state.userId, sessionId: session.id,
            query: text, path: via, cloudCalls: 0, firstTokenMs: 0, totalMs: ms,
            cost: 0, tokensIn: 0, tokensOut: 0, ok: true
          });
          done();
          return;
        }
      }

      /* 5) 云端 */
      if (!settings.cloudOnline) {
        step('cloud', '云端请求', 'fail', '云端不可用（演示开关已关闭）');
        meta.source = 'error';
        meta.error = {
          title: '云端暂不可用',
          message: '演示里已经把云端连接关掉了。已收录的问答仍然可以直接命中——换个问法试试，或者打开「设置 → 云端连接」恢复。'
        };
        trace.decision = 'error';
        trace.error = meta.error;
        S.addUsage({
          id: U.uid('u'), at: Date.now(), ownerId: S.state.userId, sessionId: session.id,
          query: text, path: 'cloud', cloudCalls: 0, firstTokenMs: 0, totalMs: Date.now() - t0,
          cost: 0, tokensIn: 0, tokensOut: 0, ok: false
        });
        done();
        return;
      }

      var answer = C.choose(effective, {
        mode: mode,
        candidates: (resolved && resolved.options && resolved.options.length >= 2) ? resolved.options : (memory.options || []),
        constraints: memory.constraints
      });
      if (answer.candidates) meta.options = answer.candidates;
      if (trace.resolved && trace.resolved.options && !meta.options.length) meta.options = trace.resolved.options;

      var inputText = effective + '\n' + memory.turns.map(function (t) { return t.q + '\n' + App.md.plain(t.a).slice(0, 200); }).join('\n');
      step('cloud', '云端请求', 'run', '正在调用 ' + settings.model + '…');

      var streamer = C.stream({
        answer: answer,
        settings: settings,
        inputText: inputText,
        onToken: function (partial) {
          msg.content = partial;
          sink.onToken && sink.onToken(partial, msg);
        }
      });
      App.engine._active = streamer;

      var res;
      try {
        res = await streamer.promise;
      } catch (err) {
        App.engine._active = null;
        if (err && err.aborted) {
          step('cloud', '云端请求', 'skip', '已停止生成');
          trace.decision = 'aborted';
          meta.status = 'done';
          meta.aborted = true;
          S.save(true);
          sink.onDone && sink.onDone(meta);
          return;
        }
        step('cloud', '云端请求', 'fail', '网络错误');
        meta.error = { title: '请求失败', message: '模拟云端返回了错误，可以点重试。' };
        meta.source = 'error';
        S.addUsage({
          id: U.uid('u'), at: Date.now(), ownerId: S.state.userId, sessionId: session.id,
          query: text, path: 'cloud', cloudCalls: 1, firstTokenMs: 0, totalMs: Date.now() - t0,
          cost: 0, tokensIn: 0, tokensOut: 0, ok: false
        });
        done();
        return;
      }
      App.engine._active = null;

      meta.source = 'cloud';
      meta.matchType = 'none';
      meta.score = 0;
      meta.usage.cloudCalls = 1;
      meta.usage.firstTokenMs = res.firstTokenMs;
      meta.usage.totalMs = res.totalMs;
      meta.usage.cost = res.cost;
      meta.usage.tokensIn = res.tokensIn;
      meta.usage.tokensOut = res.tokensOut;
      trace.decision = 'cloud';
      step('cloud', '云端请求', 'ok',
        settings.model + ' · 首字 ' + (res.firstTokenMs / 1000).toFixed(2) + ' s · 总耗时 ' +
        (res.totalMs / 1000).toFixed(2) + ' s · ' + res.tokensOut + ' output tokens · ' + U.fmtMoney(res.cost));

      S.addUsage({
        id: U.uid('u'), at: Date.now(), ownerId: S.state.userId, sessionId: session.id,
        query: text, path: 'cloud', cloudCalls: 1, firstTokenMs: res.firstTokenMs, totalMs: res.totalMs,
        cost: res.cost, tokensIn: res.tokensIn, tokensOut: res.tokensOut, ok: true
      });

      /* 6) 后台学习 */
      if (meta.reAskOf) {
        step('learn', '写入会话', 'skip', '主动重答的答案先留在会话里，等你采用或提交修订');
      } else if (res.learn && settings.autoLearn) {
        var scope = session.scope || 'personal';
        var recNew = {
          id: U.uid('grp'),
          ownerId: S.state.userId,
          scope: scope,
          original: res.learn.original || text,
          aliases: [],
          intent: res.learn.intent || '',
          entities: res.learn.entities || [],
          constraints: res.learn.constraints || [],
          versions: [{
            id: 'v1', n: 1, answer: res.text, status: 'published',
            basis: '云端生成 · ' + settings.model, by: S.state.userId, createdAt: Date.now()
          }],
          currentVersionId: 'v1',
          variants: [],
          freshness: { kind: 'stable', reviewAt: null },
          model: settings.model,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: 'learning',
          hits: 0,
          reports: 0
        };
        S.addRecord(recNew);
        meta.learnedGroupId = recNew.id;
        step('learn', '后台学习', 'run', '问题组 v1 已入库（' + (scope === 'shared' ? '共享库' : '个人库') + '），正在生成等价问法…');
        startLearn(recNew, res.learn, trace, sink);
      } else if (res.learn && !settings.autoLearn) {
        step('learn', '后台学习', 'skip', '自动学习已关闭，本次只写入会话历史');
      } else {
        step('learn', '后台学习', 'skip', '本次答复依赖上下文，只留在会话里');
      }

      done();
    })().catch(function (err) {
      console.error(err);
      step('error', '管线异常', 'fail', String(err && err.message || err));
      meta.source = 'error';
      meta.error = { title: '出了点问题', message: String(err && err.message || err) };
      done();
    });
  };

  E.abort = function () {
    if (App.engine._active) { App.engine._active.abort(); App.engine._active = null; }
  };

  /* ------------------------------- 表达变体 ------------------------------- */
  E.useVariant = function (msg, variantId) {
    var g = S.groupById(msg.meta.groupId);
    if (!g) return false;
    var version = S.versionById(g, msg.meta.versionId) || S.currentVersion(g);
    var text;
    if (!variantId) {
      text = version ? version.answer : '';
      msg.meta.variantId = null;
    } else {
      var v = S.variantById(g, variantId);
      if (!v) return false;
      text = v.text;
      msg.meta.variantId = v.id;
    }
    msg.content = text;
    S.save(true);
    return true;
  };

  E.variantLabel = function (style) {
    return { brief: '简短', detailed: '详细', example: '举例' }[style] || style;
  };

  /* ------------------------------- 采用 / 修订 ------------------------------- */
  E.adopt = function (msg) {
    var gid = msg.meta.groupId || (msg.meta.reAskOf && msg.meta.reAskOf.groupId);
    var g = gid ? S.groupById(gid) : null;
    if (!g) return null;
    var v = S.adoptVersion(g.id, msg.content, '重新问云端的结果');
    msg.meta.adoptedVersionId = v.id;
    S.save(true);
    App.bus.emit('records:changed');
    U.toast('已采用为新版本 v' + v.n, { kind: 'ok', detail: '旧版本的全部表达已退出匹配，历史聊天仍保留当时的答复' });
    return v;
  };

  E.suggestRevision = function (msg, note) {
    var gid = msg.meta.groupId || (msg.meta.reAskOf && msg.meta.reAskOf.groupId);
    var g = gid ? S.groupById(gid) : null;
    if (!g) return null;
    var rev = S.addRevision(g.id, msg.content, note || '来自「重新问云端」的结果');
    msg.meta.revisionId = rev.id;
    S.save(true);
    U.toast('修订建议已提交给库管理员', { kind: 'ok', detail: '管理员发布后才会影响其他人的答案；在此之前只有你自己看到新答案' });
    return rev;
  };

  /* ------------------------------- 报告误答 ------------------------------- */
  E.report = function (meta, category, note) {
    if (!meta.groupId) return null;
    var g = S.groupById(meta.groupId);
    if (!g) return null;
    var type = category === 'mismatch' ? 'match' : 'version';
    var payload = {
      groupId: meta.groupId,
      type: type,
      versionId: meta.versionId,
      matchKey: meta.matchedAlias || (meta.trace && meta.trace.query) || '',
      aliasText: meta.matchedAlias || (meta.trace && meta.trace.query) || '',
      category: category,
      note: note || ''
    };
    var res = S.addReport(payload);
    if (meta.trace && meta.trace.query) {
      for (var i = 0; i < S.state.usage.length; i++) {
        if (S.state.usage[i].query === meta.trace.query && !S.state.usage[i].reported) {
          S.state.usage[i].reported = true;
          break;
        }
      }
    }
    App.bus.emit('records:changed');
    S.save(true);
    return res;
  };

  E.unblock = function (groupId) {
    var list = S.suspensionsForGroup(groupId).filter(function (s) { return s.status === 'active'; });
    list.forEach(function (s) { S.releaseSuspension(s.id, 'restored', S.state.userId); });
  };
})();
