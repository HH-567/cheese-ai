/* 柒柿AI · 纯前端演示 — 「CPU 侧」匹配引擎
 * 精确命中 → 等价问法命中 → 语义召回（概念覆盖 + 字面相似）→ 条件校验
 */
(function () {
  'use strict';
  var App = window.App, U = App.util;
  var M = (App.matcher = {});

  /* 概念表：把问题拆成「任务 + 对象 + 条件」的可比单元 */
  var CONCEPTS = [
    { id: 'python', label: 'Python', w: 1.2, re: /python|py3|python3/i },
    { id: 'bool', label: '布尔求值', w: 1.4, re: /bool|布尔|真假|为真|为假|真值|假值|truthy|falsy|判断为真|判断为假|真还是假/i },
    { id: 'empty-coll', label: '空容器', w: 1.5, re: /空列表|空的列表|空数组|空字典|空字符串|空集合|empty\s+list|\[\s*\]/i },
    { id: 'list', label: '列表', w: 0.9, re: /列表|数组|\blist\b|\barray\b/i },
    { id: 'condition', label: '条件判断', w: 1.0, re: /条件|\bif\b|判断|分支|\belse\b/i },
    { id: 'excel', label: 'Excel', w: 1.2, re: /excel|wps|电子表格|表格软件/i },
    { id: 'merge-text', label: '文本合并', w: 1.5, re: /合并|拼接|拼到|拼成|连起来|串起来|粘在|concat|并成一列/i },
    { id: 'column', label: '列', w: 1.0, re: /列(?![表])|column|单元格|字段|多列|两列|一列/i },
    { id: 'row', label: '行', w: 1.0, re: /每一?行|一行|两行|三行|多行|按行|行之间|\brow\b/i },
    { id: 'vlookup', label: '查找函数', w: 1.5, re: /vlookup|iferror|ifna|xlookup|查找函数|lookup/i },
    { id: 'na', label: '未命中/空白', w: 1.2, re: /#n\/a|找不到|查不到|未命中|空白|空单元格/i },
    { id: 'mac', label: 'macOS', w: 1.2, re: /mac\b|macos|macbook|苹果电脑/i },
    { id: 'windows', label: 'Windows', w: 1.2, re: /windows|win10|win11/i },
    { id: 'screenshot', label: '截图', w: 1.5, re: /截图|截屏|screenshot|抓屏|截取/i },
    { id: 'window', label: '窗口', w: 1.0, re: /窗口|\bwindow\b/i },
    { id: 'contract', label: '合同条款', w: 1.2, re: /合同|条款|甲方|乙方|协议/i },
    { id: 'force-majeure', label: '不可抗力', w: 1.6, re: /不可抗力|天灾|战争|疫情|罢工|自然灾害/i },
    { id: 'csv', label: 'CSV', w: 1.4, re: /\bcsv\b|逗号分隔/i },
    { id: 'pandas', label: 'pandas', w: 1.0, re: /pandas|dataframe/i },
    { id: 'mean', label: '求均值', w: 1.4, re: /均值|平均值|平均数|\bmean\b|\bavg\b/i },
    { id: 'react', label: 'React', w: 1.3, re: /react|jsx|\bhook\b/i },
    { id: 'useeffect', label: 'useEffect', w: 1.6, re: /useeffect|副作用|side\s*effect/i },
    { id: 'usememo', label: 'useMemo', w: 1.6, re: /usememo|记忆化|缓存计算/i },
    { id: 'usecallback', label: 'useCallback', w: 1.5, re: /usecallback/i },
    { id: 'usestate', label: 'useState', w: 1.4, re: /usestate/i },
    { id: 'decorator', label: '装饰器', w: 1.7, re: /装饰器|decorator|functools\.wraps|@\w+/i },
    { id: 'ai-deploy', label: 'AI 部署', w: 1.3, re: /部署|本地运行|跑\s*(ai|模型)|推理服务|自建|跑起来/i },
    { id: 'gpu', label: '显卡', w: 1.3, re: /显卡|\bgpu\b|rtx|显存|nvidia|独显/i },
    { id: 'cpu', label: 'CPU', w: 1.1, re: /\bcpu\b|处理器|核\b/i },
    { id: 'local-model', label: '本地模型', w: 1.3, re: /本地.*模型|量化|小模型|llama|qwen|ollama/i },
    { id: 'budget', label: '预算/成本', w: 1.2, re: /预算|省钱|便宜|成本|花多少钱|价格|元\b|块钱/i },
    { id: 'compare', label: '比较/选择', w: 1.2, re: /哪个好|哪个更|比较|对比|区别|差异|选哪个|怎么选|更适合|哪个适合/i },
    { id: 'writing', label: '写作/改写', w: 1.2, re: /润色|改写|写一段|文案|周报|作文|邮件|朋友圈|总结成/i },
    { id: 'translate', label: '翻译/英文', w: 1.6, re: /翻译|英语|英文|english|日语|中英/i },
    { id: 'realtime', label: '时效性信息', w: 1.7, re: /今天|现在|最新|实时|股价|天气|新闻|近期|汇率/i },
    { id: 'sql', label: 'SQL', w: 1.3, re: /\bsql\b|数据库|查询语句|索引/i },
    { id: 'git', label: 'Git', w: 1.3, re: /\bgit\b|分支|commit|合并冲突|rebase/i },
    { id: 'rag', label: '检索/向量', w: 1.2, re: /\brag\b|向量|检索|embedding|语义匹配|召回/i },
    { id: 'office-doc', label: 'Office 文档', w: 1.1, re: /\bppt\b|幻灯片|演示文稿|\bword\b|docx|文档排版/i },
    { id: 'rag-hackathon', label: '问答库复用', w: 1.2, re: /问答库|复用|命中率|零调用|缓存答案/i }
  ];

  /* 互斥对象组：命中同组不同成员 → 条件冲突 */
  var GROUPS = [
    { id: 'axis', label: '对象（行 / 列）', members: ['row', 'column'] },
    { id: 'os', label: '平台（macOS / Windows）', members: ['mac', 'windows'] },
    { id: 'hook', label: '对比对象（Hook）', members: ['useeffect', 'usememo', 'usecallback', 'usestate'] }
  ];

  var CONCEPT_BY_ID = {};
  CONCEPTS.forEach(function (c) { CONCEPT_BY_ID[c.id] = c; });

  M.CONCEPTS = CONCEPTS;

  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[`"'“”‘’]/g, '')
      .replace(/[，。？！、；：,?!;:—~…]/g, ' ')
      .replace(/[（）]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  M.normalize = normalize;

  function bigramSet(str) {
    var s = normalize(str).replace(/\s+/g, '');
    var set = {};
    for (var i = 0; i < s.length - 1; i++) {
      var g = s.slice(i, i + 2);
      set[g] = (set[g] || 0) + 1;
    }
    return set;
  }

  function dice(a, b) {
    var A = bigramSet(a), B = bigramSet(b);
    var ka = Object.keys(A), kb = Object.keys(B);
    if (!ka.length || !kb.length) return 0;
    var inter = 0;
    ka.forEach(function (k) { if (B[k]) inter += 1; });
    return (2 * inter) / (ka.length + kb.length);
  }

  function conceptMap(text) {
    var map = {};
    CONCEPTS.forEach(function (c) {
      if (c.re.test(text)) map[c.id] = c.w;
    });
    return map;
  }

  function answerOf(rec) {
    if (rec.answer) return rec.answer;
    var list = rec.versions || [];
    if (!list.length) return '';
    var cur = list.filter(function (v) { return v.id === rec.currentVersionId; })[0] || list[list.length - 1];
    return cur ? cur.answer : '';
  }

  function recordTexts(rec) {
    var primary = [
      rec.original, rec.intent || '',
      (rec.entities || []).join(' '), (rec.constraints || []).join(' '),
      (rec.aliases || []).filter(function (a) { return a.status === 'active'; }).map(function (a) { return a.text; }).join(' ')
    ].join(' \n ');
    return { primary: primary, answer: answerOf(rec) };
  }

  function recordConcepts(rec) {
    var t = recordTexts(rec);
    var prim = conceptMap(t.primary);
    var ans = conceptMap(t.answer);
    return { primary: prim, answerOnly: ans };
  }

  /* ---------- 特征抽取：数值 / 代码字面量 / 语言 / 格式 ---------- */
  function stripCode(s) {
    return String(s)
      .replace(/`[^`]*`/g, ' ')
      .replace(/\b[a-z_][\w.]*\s*\([^()]*\)/gi, ' ')
      .replace(/\[[^\]]*\]/g, ' ');
  }

  function numbers(s) {
    var set = {};
    (stripCode(s).match(/\d+(?:\.\d+)?/g) || []).forEach(function (n) { set[String(parseFloat(n))] = true; });
    return Object.keys(set);
  }

  function codeCalls(s) {
    var out = [];
    var re = /([a-z_][\w.]*)\s*\(\s*([^()]*)\s*\)/gi, m;
    while ((m = re.exec(String(s)))) {
      var name = m[1].toLowerCase();
      if (['if', 'for', 'while', 'print', 'return', 'in', 'and', 'or', 'not'].indexOf(name) >= 0) continue;
      var arg = m[2].replace(/\s+/g, '').replace(/["']/g, '');
      out.push({ name: name, arg: arg, raw: m[0] });
    }
    return out;
  }

  function langOf(s) {
    if (/用英语|用英文|英语(解释|回答|说明)|英文(回答|解释)|in english|english answer|日语|用日文/i.test(s)) return 'en';
    return 'zh';
  }

  function formatOf(s) {
    var f = [];
    if (/表格(形式|输出|呈现)|列成表格|用表格/.test(s)) f.push('table');
    if (/只要(一段|一段)?代码|只给代码|纯代码/.test(s)) f.push('code');
    if (/一句话|简短|简明/.test(s)) f.push('brief');
    if (/步骤|分几点|分条/.test(s)) f.push('steps');
    return f;
  }

  var STRONG_NEG = ['不要', '不用', '不需要', '无需', '除了', '避免', '不能', '禁止', '排除', '别用', '不再'];

  function negations(s) {
    return STRONG_NEG.filter(function (t) { return s.indexOf(t) >= 0; });
  }

  /* ---------- 条件校验 ---------- */
  M.check = function (query, rec) {
    var conflicts = [];
    var warnings = [];
    if (!rec) return { conflicts: conflicts, warnings: warnings };

    // 1) 代码字面量（同一函数、不同入参）
    var qc = codeCalls(query), rc = codeCalls(rec.original);
    (rec.aliases || []).forEach(function (a) { if (a.status === 'active') rc = rc.concat(codeCalls(a.text)); });
    if (qc.length && rc.length) {
      var recorded = {};
      rc.forEach(function (c) { recorded[c.name] = c.arg; });
      qc.forEach(function (c) {
        if (recorded[c.name] != null && recorded[c.name] !== c.arg) {
          conflicts.push({
            field: '代码输入',
            detail: '`' + c.name + '(' + recorded[c.name] + ')` → `' + c.name + '(' + c.arg + ')`',
            note: '入参变了，答案结论可能反转'
          });
        }
      });
    }

    // 2) 数值条件
    var qn = numbers(query), rn = numbers([rec.original, (rec.entities || []).join(' '), (rec.constraints || []).join(' ')].join(' '));
    var extra = qn.filter(function (n) { return rn.indexOf(n) < 0; });
    if (extra.length && rn.length) {
      conflicts.push({
        field: '数值条件',
        detail: '新问题里的 ' + extra.join(' / ') + ' 与已记录条件（' + rn.join(' / ') + '）不一致',
        note: '数字通常直接改变结论'
      });
    }

    // 3) 输出语言
    var qlang = langOf(query), rlang = langOf([rec.original, rec.intent || '', (rec.constraints || []).join(' ')].join(' '));
    if (qlang !== rlang) {
      conflicts.push({ field: '输出语言', detail: qlang === 'en' ? '要求英语输出，已记录答案为中文' : '要求中文输出，已记录答案为英文', note: '语言不同，无法直接复用' });
    }

    // 4) 互斥对象组
    var qm = conceptMap(query), rm = conceptMap(recordTexts(rec).primary);
    GROUPS.forEach(function (g) {
      var inQ = g.members.filter(function (m) { return qm[m]; });
      var inR = g.members.filter(function (m) { return rm[m]; });
      if (inQ.length && inR.length) {
        var missing = inQ.filter(function (m) { return inR.indexOf(m) < 0; });
        if (missing.length) {
          conflicts.push({
            field: '对象 / 条件',
            detail: g.label + '：新问题提到「' + missing.map(function (m) { return CONCEPT_BY_ID[m].label; }).join('、') +
              '」，已记录记录的是「' + inR.map(function (m) { return CONCEPT_BY_ID[m].label; }).join('、') + '」',
            note: '同组对象不同，不能共用答案'
          });
        }
      }
    });

    // 5) 否定 / 排除条件
    var qn2 = negations(query), rn2 = negations([rec.original, (rec.constraints || []).join(' ')].join(' '));
    if (!!qn2.length !== !!rn2.length) {
      conflicts.push({
        field: '否定条件',
        detail: qn2.length ? '新问题带有排除条件「' + qn2.join('、') + '」，已记录答案没有' : '已记录问题带有排除条件「' + rn2.join('、') + '」，新问题没有',
        note: '否定条件会改变适用结论'
      });
    }

    // 6) 输出格式
    var qf = formatOf(query);
    var ans = answerOf(rec) || '';
    qf.forEach(function (f) {
      if (f === 'table' && ans.indexOf('| ---') < 0) conflicts.push({ field: '输出格式', detail: '要求表格输出，已记录答案不是表格', note: '' });
      if (f === 'code' && ans.indexOf('```') < 0) conflicts.push({ field: '输出格式', detail: '要求只要代码，已记录答案是说明文', note: '' });
    });

    // 7) 时效性
    if (conceptMap(query).realtime) {
      conflicts.push({ field: '时效性', detail: '问题包含时效性信息（今天 / 最新 / 实时），库里的答案是缓存', note: '这类问题直接走云端' });
    }

    return { conflicts: conflicts, warnings: warnings };
  };

  /* ---------- 打分 ---------- */
  function scoreRecord(query, rec) {
    var qm = conceptMap(query);
    var rc = recordConcepts(rec);
    var sum = 0, hit = 0, shared = [], missing = [];
    Object.keys(qm).forEach(function (id) {
      var w = qm[id];
      sum += w;
      if (rc.primary[id]) { hit += w; shared.push(id); }
      else if (rc.answerOnly[id]) { hit += w * 0.6; shared.push(id); }
      else missing.push(id);
    });
    var cov = sum ? hit / sum : 0;
    var bg = dice(query, [rec.original, rec.intent || ''].join(' '));
    var score = 0.85 * cov + 0.15 * bg;
    return {
      record: rec,
      score: Math.round(score * 1000) / 1000,
      cov: Math.round(cov * 1000) / 1000,
      bigram: Math.round(bg * 1000) / 1000,
      shared: shared,
      missing: missing
    };
  }

  M.scoreRecord = scoreRecord;
  M.answerOf = answerOf;

  /* ---------- 生成类 / 需要综合的请求 → 直接云端 ---------- */
  M.needsGeneration = function (query) {
    if (/给我.{0,4}(两个|三个|几个|几套)|列出.{0,3}(方案|选项)|出个方案|写一段|写一个|帮我写|起草|润色/.test(query)) {
      return { yes: true, label: '生成类请求', detail: '要求组织/生成新内容，问答库只存单一答案' };
    }
    if (/我的|我们公司|我这边|我个人/.test(query) && /怎么|如何|帮我/.test(query)) {
      return { yes: true, label: '依赖个人条件', detail: '问题包含个人条件，不适合共享复用' };
    }
    return { yes: false };
  };

  /* ---------- 主流程 ---------- */
  M.analyze = function (query, records, opts) {
    opts = opts || {};
    var threshold = opts.threshold != null ? opts.threshold : 0.7;
    var q = U.key(query);
    var isBlocked = opts.isBlocked || function () { return null; };
    var blocked = [];

    function blockedFor(rec, key, versionId) {
      var r = isBlocked(rec, key, versionId);
      if (r) blocked.push({ recordId: rec.id, original: rec.original, matchKey: key, reason: r.reason, kind: r.kind });
      return r;
    }

    // 1) 精确命中：原问
    var exact = null;
    for (var i = 0; i < records.length && !exact; i++) {
      var r = records[i];
      if (U.key(r.original) !== q) continue;
      if (blockedFor(r, r.original, null)) continue;
      exact = r;
    }

    // 2) 精确命中：已收录的等价问法
    var alias = null, aliasText = null;
    if (!exact) {
      for (var i2 = 0; i2 < records.length && !alias; i2++) {
        var r2 = records[i2];
        var list = (r2.aliases || []);
        for (var k = 0; k < list.length; k++) {
          if (list[k].status !== 'active' || U.key(list[k].text) !== q) continue;
          if (blockedFor(r2, list[k].text, null)) continue;
          alias = r2;
          aliasText = list[k].text;
          break;
        }
      }
    }

    var scored = records.map(function (rec) { return scoreRecord(query, rec); })
      .sort(function (a, b) { return b.score - a.score; });

    var shortlist = scored.filter(function (s) { return s.score >= 0.5; }).slice(0, 4);
    var top = shortlist[0] || scored[0] || null;

    var result = {
      query: query,
      normalized: q,
      threshold: threshold,
      exact: exact ? { record: exact } : null,
      alias: alias ? { record: alias, text: aliasText } : null,
      shortlist: shortlist,
      top: top,
      chosen: null,
      decision: 'cloud',
      conflicts: [],
      blocked: blocked,
      reason: '',
      generation: M.needsGeneration(query)
    };

    if (result.generation.yes && !opts.ignoreGeneration) {
      result.decision = 'cloud';
      result.reason = result.generation.label + '：' + result.generation.detail;
      return result;
    }

    if (exact) {
      var c1 = M.check(query, exact);
      result.conflicts = c1.conflicts;
      if (!c1.conflicts.length) {
        result.chosen = { record: exact, score: 1, via: 'exact', matchKey: exact.original };
        result.decision = 'reuse';
        result.reason = '原问精确命中';
        return result;
      }
      result.reason = '精确命中但条件冲突：' + c1.conflicts[0].field;
      result.decision = 'cloud';
      return result;
    }

    if (alias) {
      var c2 = M.check(query, alias);
      result.conflicts = c2.conflicts;
      if (!c2.conflicts.length) {
        result.chosen = { record: alias, score: 0.99, via: 'alias', matchKey: aliasText };
        result.decision = 'reuse';
        result.reason = '命中已收录的等价问法';
        return result;
      }
      result.reason = '等价问法命中但条件冲突：' + c2.conflicts[0].field;
      result.decision = 'cloud';
      return result;
    }

    if (opts.skipSemantic) {
      result.reason = '补全后的问题需要结合前文，跳过语义召回 → 云端';
      result.decision = 'cloud';
      return result;
    }

    // 3) 语义召回：逐个候选检查暂停 / 报告人绕开
    for (var s = 0; s < shortlist.length; s++) {
      var cand = shortlist[s];
      if (cand.score < threshold) break;
      if (blockedFor(cand.record, query, null)) continue;
      var c3 = M.check(query, cand.record);
      if (!c3.conflicts.length) {
        result.chosen = { record: cand.record, score: cand.score, via: 'semantic', matchKey: query };
        result.conflicts = [];
        result.decision = 'reuse';
        result.reason = '语义匹配通过条件校验（未收录问法）';
        return result;
      }
      result.conflicts = c3.conflicts;
      result.reason = '语义候选 ' + cand.score.toFixed(2) + '，但条件校验不通过：' + c3.conflicts[0].field;
      result.decision = 'cloud';
      return result;
    }

    var allowedTop = blocked.length ? shortlist.filter(function (x) {
      return !blocked.some(function (b) { return b.recordId === x.record.id; });
    })[0] : top;

    result.reason = blocked.length
      ? '候选被暂停或报告人主动绕开 → 云端'
      : (top
        ? '最高候选 ' + top.score.toFixed(2) + '，低于复用门槛 ' + threshold.toFixed(2)
        : '问答库里没有语义候选');
    result.top = allowedTop || top;
    result.decision = 'cloud';
    return result;
  };

  /* ---------- 预览（给起始提示 / 设置页调试用） ---------- */
  M.preview = function (query, records, threshold, isBlocked) {
    var r = M.analyze(query, records, { threshold: threshold, isBlocked: isBlocked });
    if (r.decision === 'reuse') {
      return {
        path: r.chosen.via,
        score: r.chosen.score,
        recordId: r.chosen.record.id,
        label: r.chosen.via === 'exact' ? '原问命中' : r.chosen.via === 'alias' ? '已收录改写' : '语义匹配'
      };
    }
    return { path: 'cloud', score: r.top ? r.top.score : 0, label: r.generation.yes ? r.generation.label : '', blocked: r.blocked };
  };

  M.keyOf = function (s) { return U.key(s); };

  M.conceptLabel = function (id) {
    return CONCEPT_BY_ID[id] ? CONCEPT_BY_ID[id].label : id;
  };
  M.conceptMap = conceptMap;
})();
