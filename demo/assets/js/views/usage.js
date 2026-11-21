/* 柒柿AI · 纯前端演示 — 用量与成本页 */
(function () {
  'use strict';
  var App = window.App, U = App.util, S = App.store;
  var V = (App.views = App.views || {});
  var usage = (V.usage = {});

  var PATH = {
    exact: { label: '原问命中', cls: 'lib', cloud: false },
    alias: { label: '等价问法命中', cls: 'lib', cloud: false },
    semantic: { label: '语义匹配命中', cls: 'lib', cloud: false },
    tool: { label: '本地工具', cls: 'tool', cloud: false },
    cloud: { label: '云端生成', cls: 'cloud', cloud: true },
    learn: { label: '后台改写', cls: 'learn', cloud: true },
    revision: { label: '发布修订', cls: 'rev', cloud: false },
    clarify: { label: '本地追问', cls: 'local', cloud: false },
    other: { label: '其他', cls: 'local', cloud: false }
  };

  usage.mount = function (root) {
    root.innerHTML = '<div class="page page--usage" id="usage-root"></div>';
    usage.render();
  };

  usage.render = function () {
    var root = U.$('#usage-root');
    if (!root) return;
    var st = S.usageStats();
    var settings = S.state.settings;
    var gov = S.governance();
    var answerCalls = st.rows.filter(function (r) { return r.path === 'cloud'; }).length;
    var learnCalls = st.rows.filter(function (r) { return r.path === 'learn'; }).length;
    var toolCalls = st.rows.filter(function (r) { return r.path === 'tool'; }).length;
    var reuseCalls = st.rows.filter(function (r) { return ['exact', 'alias', 'semantic'].indexOf(r.path) >= 0; }).length;
    var costAnswer = st.rows.filter(function (r) { return r.path !== 'learn'; }).reduce(function (n, r) { return n + (r.cost || 0); }, 0);
    var costLearn = st.rows.filter(function (r) { return r.path === 'learn'; }).reduce(function (n, r) { return n + (r.cost || 0); }, 0);
    var misused = st.rows.filter(function (r) { return r.reported; }).length;

    root.innerHTML =
      '<div class="page__head">' +
      '<div><h1 class="page__title">用量与成本</h1>' +
      '<p class="page__sub">演示数据 + 本次会话真实记录 · 云端调用为仿真，费用按当前配置的单价折算</p></div>' +
      '<div class="page__actions"><span class="tag-mono">模型 ' + U.esc(settings.model) + '</span>' +
      '<span class="tag-mono">¥' + settings.priceIn.toFixed(1) + ' / ¥' + settings.priceOut.toFixed(1) + ' 每百万 token</span></div>' +
      '</div>' +

      '<div class="stats">' +
      '<div class="stat stat--hero">' +
      '<div class="stat__k">零云端调用的回答 / 总请求</div>' +
      '<div class="stat__v">' + Math.round(st.reuseRate * 100) + '<span class="stat__unit">%</span></div>' +
      '<div class="stat__bar"><i style="width:' + Math.round(st.reuseRate * 100) + '%"></i></div>' +
      '<div class="stat__m">' + st.reuseCount + ' / ' + st.total + ' 次直接回答 · 其中复用 ' + reuseCalls + ' 次、本地工具 ' + toolCalls + ' 次</div>' +
      '</div>' +
      '<div class="stat">' +
      '<div class="stat__k">云端调用</div>' +
      '<div class="stat__v">' + st.cloudCalls + '<span class="stat__unit">次</span></div>' +
      '<div class="stat__m">回答 ' + answerCalls + ' 次 · 后台改写 ' + learnCalls + ' 次</div>' +
      '<div class="stat__m stat__m--cost">累计 ' + U.fmtMoney(st.cost) + '</div>' +
      '</div>' +
      '<div class="stat">' +
      '<div class="stat__k">首次出字（中位）</div>' +
      '<div class="stat__v">' + (st.firstTokenMedian ? (st.firstTokenMedian / 1000).toFixed(2) : '—') + '<span class="stat__unit">s</span></div>' +
      '<div class="stat__m">总耗时中位 ' + (st.durationMedian ? (st.durationMedian / 1000).toFixed(2) : '—') + ' s</div>' +
      '<div class="stat__m">工具与查库路径为毫秒级</div>' +
      '</div>' +
      '<div class="stat">' +
      '<div class="stat__k">误复用 · 被报告的比例</div>' +
      '<div class="stat__v">' + misused + '<span class="stat__unit">/ ' + st.reuseCount + '</span></div>' +
      '<div class="stat__m">' + (st.reuseCount ? Math.round(misused / st.reuseCount * 100) : 0) + '% 的复用被报告有问题</div>' +
      '<div class="stat__m">另有 <b>' + gov.metrics.suspended + '</b> 个目标被暂停 · 误停率 ' + Math.round(gov.metrics.falseStopRate * 100) + '%</div>' +
      '</div>' +
      '</div>' +

      '<div class="cols2">' +
      '<section class="panel">' +
      '<div class="panel__head"><h2>请求路径分布</h2><span class="muted">' + st.rows.length + ' 条记录</span></div>' +
      pathBars(st) +
      '<div class="strip">' + st.rows.slice(0, 18).map(function (r) {
        var p = PATH[r.path] || PATH.other;
        return '<span class="strip__dot strip__dot--' + p.cls + '" title="' + U.esc(p.label + ' · ' + U.fmtAgo(r.at)) + '"></span>';
      }).join('') + '</div>' +
      '<div class="panel__note">' + U.icon('info', 12) + ' 最近 18 次请求（左新右旧）。绿色 = 零云端调用，蓝色 = 云端。' +
      (gov.metrics.suspended ? ' 有目标被暂停时，对应请求会额外计入云端调用。' : '') + '</div>' +
      '</section>' +
      '<section class="panel">' +
      '<div class="panel__head"><h2>成本构成</h2><span class="muted">按当前单价折算</span></div>' +
      '<div class="cost">' +
      '<div class="cost__row"><span>回答调用</span><b>' + U.fmtMoney(costAnswer) + '</b>' +
      '<i class="cost__bar"><i style="width:' + share(costAnswer, costAnswer + costLearn) + '%;background:var(--cloud)"></i></i></div>' +
      '<div class="cost__row"><span>后台改写</span><b>' + U.fmtMoney(costLearn) + '</b>' +
      '<i class="cost__bar"><i style="width:' + share(costLearn, costAnswer + costLearn) + '%;background:var(--accent)"></i></i></div>' +
      '<div class="cost__row cost__row--total"><span>合计</span><b>' + U.fmtMoney(costAnswer + costLearn) + '</b></div>' +
      '</div>' +
      '<div class="cost__calc">' +
      '<div><span>每百次全部走云端的成本</span><b>' + U.fmtMoney(perHundred(st.rows, true)) + '</b></div>' +
      '<div><span>当前路径下每百次请求</span><b>' + U.fmtMoney(perHundred(st.rows, false)) + '</b></div>' +
      '<div><span>按当前命中率省下</span><b class="hl-ok">' + U.fmtMoney(Math.max(0, perHundred(st.rows, true) - perHundred(st.rows, false))) + '</b></div>' +
      '<div><span>治理成本：平均处理时长</span><b>' + (gov.metrics.handleMs ? (gov.metrics.handleMs / 3600000).toFixed(1) + ' h' : '—') + '</b></div>' +
      '</div>' +
      '<div class="panel__note">' + U.icon('info', 12) + ' 后台改写、重试、修订与核对都计入成本；稳定事实没有周期性刷新费用。</div>' +
      '</section>' +
      '</div>' +

      '<section class="panel">' +
      '<div class="panel__head"><h2>请求日志</h2><span class="muted">最新 ' + Math.min(st.rows.length, 40) + ' 条</span></div>' +
      '<div class="table-wrap">' +
      '<table class="log"><thead><tr>' +
      '<th>时间</th><th>问题</th><th>路径</th><th>云端</th><th>首字</th><th>总耗时</th><th>成本</th><th></th>' +
      '</tr></thead><tbody>' +
      st.rows.slice(0, 40).map(rowHTML).join('') +
      '</tbody></table></div>' +
      '</section>';
  };

  function share(a, total) { return total ? Math.max(2, Math.round(a / total * 100)) : 2; }

  function perHundred(rows, allCloud) {
    if (!rows.length) return 0;
    if (allCloud) {
      var perCall = rows.filter(function (r) { return r.path === 'cloud'; });
      var avg = (perCall.length ? perCall : rows).reduce(function (n, r) { return n + (r.cost || 0.0015); }, 0) / (perCall.length || rows.length);
      return avg * 100;
    }
    return rows.reduce(function (n, r) { return n + (r.cost || 0); }, 0) / rows.length * 100;
  }

  function pathBars(st) {
    var total = st.rows.length || 1;
    var order = ['exact', 'alias', 'semantic', 'tool', 'cloud', 'learn', 'revision', 'clarify'];
    return '<div class="bars">' + order.map(function (k) {
      var n = st.paths[k] || 0;
      var p = PATH[k];
      return '<div class="bars__row">' +
        '<span class="bars__label"><i class="bars__dot bars__dot--' + p.cls + '"></i>' + p.label + '</span>' +
        '<span class="bars__track"><i class="bars__fill bars__fill--' + p.cls + '" style="width:' + Math.round(n / total * 100) + '%"></i></span>' +
        '<span class="bars__num">' + n + '<em>' + Math.round(n / total * 100) + '%</em></span>' +
        '</div>';
    }).join('') + '</div>';
  }

  function rowHTML(r) {
    var p = PATH[r.path] || PATH.other;
    return '<tr class="' + (r.ok ? '' : 'is-fail') + '">' +
      '<td class="mono muted">' + U.esc(U.stamp(r.at)) + '</td>' +
      '<td class="log__q" title="' + U.esc(r.query) + '">' + U.esc(r.query) + '</td>' +
      '<td><span class="path path--' + p.cls + '">' + p.label + '</span></td>' +
      '<td class="mono">' + (r.cloudCalls || 0) + '</td>' +
      '<td class="mono">' + (r.firstTokenMs ? (r.firstTokenMs / 1000).toFixed(2) + 's' : '—') + '</td>' +
      '<td class="mono">' + (r.totalMs ? (r.totalMs < 1000 ? r.totalMs + 'ms' : (r.totalMs / 1000).toFixed(2) + 's') : '—') + '</td>' +
      '<td class="mono">' + (r.cost ? U.fmtMoney(r.cost) : '0') + '</td>' +
      '<td>' + (r.reported ? '<span class="pill pill--warn">已报告</span>' : (r.ok ? '' : '<span class="pill pill--err">失败</span>')) + '</td>' +
      '</tr>';
  }

  usage.onChanged = function () {
    if (S.state.page === 'usage') usage.render();
  };
})();
