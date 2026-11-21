/* 柒柿AI · 纯前端演示 — 设置页 */
(function () {
  'use strict';
  var App = window.App, U = App.util, S = App.store, M = App.matcher, E = App.engine, T = App.tools;
  var V = (App.views = App.views || {});
  var settings = (V.settings = {});
  var dbgQuery = 'Python 3 的 `if` 条件遇到空列表时会判断为真还是假？原因是什么？';

  settings.mount = function (root) {
    root.innerHTML = '<div class="page page--settings" id="settings-root"></div>';
    settings.render();
  };

  function sw(key, on, label, note) {
    return '<label class="row row--switch">' +
      '<span class="row__main"><span class="row__label">' + label + '</span>' +
      (note ? '<span class="row__note">' + note + '</span>' : '') + '</span>' +
      '<span class="switch"><input type="checkbox" data-set="' + key + '"' + (on ? ' checked' : '') + '><i></i></span>' +
      '</label>';
  }

  settings.render = function () {
    var root = U.$('#settings-root');
    if (!root) return;
    var s = S.state.settings;
    var user = S.user();
    var admin = S.isAdmin();
    var modelOpts = App.seed.settings.modelOptions.map(function (o) {
      return '<option value="' + o.id + '"' + (o.id === s.model ? ' selected' : '') + '>' + o.label + '</option>';
    }).join('');
    var tzOpts = s.timeZoneOptions.map(function (o) {
      return '<option value="' + o.id + '"' + (o.id === s.timeZone ? ' selected' : '') + '>' + o.label + '</option>';
    }).join('');

    root.innerHTML =
      '<div class="page__head">' +
      '<div><h1 class="page__title">设置</h1>' +
      '<p class="page__sub">这些开关直接影响匹配、工具与治理行为，演示时可以边调边看右侧的追踪面板</p></div>' +
      '</div>' +

      '<section class="panel">' +
      '<div class="panel__head"><h2>身份与权限</h2><span class="muted">服务端签发凭证后由 ' + U.esc(S.library().name) + ' 授权</span></div>' +
      '<div class="row"><span class="row__main"><span class="row__label">当前身份</span>' +
      '<span class="row__note">' + U.esc(user.desc || '') + ' · ' + (user.verified ? '已验证成员（报告计入投票）' : '游客（反馈只进审核队列）') + '</span></span>' +
      '<span class="pill ' + (admin ? 'pill--lib' : 'pill--muted') + '">' + (admin ? '库管理员' : '普通成员') + '</span></div>' +
      '<div class="row"><span class="row__main"><span class="row__label">共享库</span>' +
      '<span class="row__note">成员关系决定可见范围：个人库只本人可读写，共享库按成员关系放行</span></span>' +
      '<span class="tag-mono">' + U.esc(S.library().name) + ' · ' + Object.keys(App.seed.users).length + ' 名演示身份</span></div>' +
      '<div class="row"><span class="row__main"><span class="row__label">管理权限范围</span>' +
      '<span class="row__note">发布修订、停用、恢复与回滚只覆盖所在共享库；切换身份可以看两边的差别</span></span>' +
      '<span class="tag-mono">' + U.esc(S.userById(S.library().adminId).name) + ' 管理</span></div>' +
      '</section>' +

      '<section class="panel">' +
      '<div class="panel__head"><h2>本地工具与时区</h2><span class="muted">日期 / 星期 / 时间 / 算术，0 次云端调用</span></div>' +
      '<div class="row"><span class="row__main"><span class="row__label">时区</span>' +
      '<span class="row__note">「今天星期几」按这个时区读系统时钟；切换时区或跨午夜都会得到新结果</span></span>' +
      '<select class="field field--select" data-set="timeZone">' + tzOpts + '</select></div>' +
      '<div class="row"><span class="row__main"><span class="row__label">试一试</span>' +
      '<span class="row__note">这几句会走本地工具，不产生云端调用</span></span>' +
      '<span class="inline-fields"><button class="btn btn--small btn--ghost" data-tool="今天星期几？">今天星期几？</button>' +
      '<button class="btn btn--small btn--ghost" data-tool="37 × 48 等于多少？">37 × 48</button></span></div>' +
      '</section>' +

      '<section class="panel">' +
      '<div class="panel__head"><h2>云端模型</h2><span class="muted">只影响新问题与重新问云端</span></div>' +
      '<div class="row"><span class="row__main"><span class="row__label">模型名称</span><span class="row__note">作为配置项保存，调用计入用量</span></span>' +
      '<select class="field field--select" data-set="model">' + modelOpts + '</select></div>' +
      '<div class="row"><span class="row__main"><span class="row__label">单价（¥ / 百万 token）</span><span class="row__note">用于折算每次请求的成本</span></span>' +
      '<span class="inline-fields"><label class="mini-field">输入 <input class="field field--num" type="number" step="0.1" min="0" data-set="priceIn" value="' + s.priceIn + '"></label>' +
      '<label class="mini-field">输出 <input class="field field--num" type="number" step="0.1" min="0" data-set="priceOut" value="' + s.priceOut + '"></label></span></div>' +
      sw('cloudOnline', s.cloudOnline, '云端连接', '关掉之后：已收录问答和本地工具照常工作，未命中的问题保留重试入口') +
      (!s.cloudOnline ? '<div class="banner banner--warn">' + U.icon('alert', 14) + '云端已关闭：新问题会失败并显示重试按钮，这正是「云端不可用时已有问答仍能运行」的验收场景。</div>' : '') +
      '</section>' +

      '<section class="panel">' +
      '<div class="panel__head"><h2>匹配策略</h2><span class="muted">CPU 侧，零云端调用</span></div>' +
      '<div class="row row--slider">' +
      '<span class="row__main"><span class="row__label">语义复用门槛 <b class="mono" data-threshold-label>' + s.threshold.toFixed(2) + '</b></span>' +
      '<span class="row__note">低于门槛就交给云端。调低更容易命中，也更容易误用。</span></span>' +
      '<input type="range" class="slider" min="0.5" max="0.92" step="0.01" value="' + s.threshold + '" style="--p:' + Math.round((s.threshold - 0.5) / 0.42 * 100) + '%" data-set="threshold">' +
      '</div>' +
      '<div class="row"><span class="row__main"><span class="row__label">会话上下文轮数</span><span class="row__note">传给云端的最近对话范围</span></span>' +
      '<select class="field field--select field--narrow" data-set="maxContextTurns">' +
      [2, 3, 5].map(function (n) { return '<option value="' + n + '"' + (n === s.maxContextTurns ? ' selected' : '') + '>' + n + ' 轮</option>'; }).join('') +
      '</select></div>' +
      '<div class="debug">' +
      '<div class="debug__head">' + U.icon('target', 13) + '匹配调试 <span class="muted">拿任意一句话试当前问答库（含暂停与绕开规则）</span></div>' +
      '<div class="debug__input"><input class="field" id="dbg-input" value="' + U.esc(dbgQuery) + '" placeholder="输入一句问法…">' +
      '<button class="btn btn--small btn--primary" data-action="debug">试一下</button></div>' +
      '<div class="debug__out" id="dbg-out"></div>' +
      '</div>' +
      '</section>' +

      '<section class="panel">' +
      '<div class="panel__head"><h2>自动学习与治理</h2><span class="muted">学习成本与暂停阈值都在这里</span></div>' +
      sw('autoLearn', s.autoLearn, '回答后自动入库并生成等价问法', '关闭后只写入会话历史，不再产生后台改写成本') +
      '<div class="row"><span class="row__main"><span class="row__label">新会话默认范围</span><span class="row__note">共享库可以被同一测试库的其他身份复用</span></span>' +
      '<span class="seg seg--sm">' +
      '<button class="seg__item' + (s.defaultScope === 'personal' ? ' is-on' : '') + '" data-scope="personal">个人库</button>' +
      '<button class="seg__item' + (s.defaultScope === 'shared' ? ' is-on' : '') + '" data-scope="shared">共享库</button>' +
      '</span></div>' +
      '<div class="row"><span class="row__main"><span class="row__label">每条记录生成问法数</span><span class="row__note">通过检查的才进索引</span></span>' +
      '<select class="field field--select field--narrow" data-set="paraphraseCount">' +
      [3, 5].map(function (n) { return '<option value="' + n + '"' + (n === s.paraphraseCount ? ' selected' : '') + '>' + n + ' 条</option>'; }).join('') +
      '</select></div>' +
      '<div class="row"><span class="row__main"><span class="row__label">共享暂停阈值</span><span class="row__note">同一对象在窗口内被多少名已验证成员报告后临时暂停</span></span>' +
      '<select class="field field--select field--narrow" data-set="pauseThreshold">' +
      [2, 3, 4, 5].map(function (n) { return '<option value="' + n + '"' + (n === s.pauseThreshold ? ' selected' : '') + '>' + n + ' 人</option>'; }).join('') +
      '</select></div>' +
      '<div class="row"><span class="row__main"><span class="row__label">观察窗口</span><span class="row__note">滚动窗口，重复提交只算 1 人</span></span>' +
      '<select class="field field--select field--narrow" data-set="pauseWindowDays">' +
      [7, 14, 30].map(function (n) { return '<option value="' + n + '"' + (n === s.pauseWindowDays ? ' selected' : '') + '>' + n + ' 天</option>'; }).join('') +
      '</select></div>' +
      '<div class="row"><span class="row__main"><span class="row__label">记录有效期（个人库新记录）</span><span class="row__note">只影响新入库的个人记录</span></span>' +
      '<select class="field field--select field--narrow" data-set="expiryDays">' +
      [7, 30, 90].map(function (n) { return '<option value="' + n + '"' + (n === s.expiryDays ? ' selected' : '') + '>' + n + ' 天</option>'; }).join('') +
      '</select></div>' +
      '</section>' +

      '<section class="panel">' +
      '<div class="panel__head"><h2>演示数据</h2><span class="muted">数据只存在这台电脑的 localStorage</span></div>' +
      '<div class="row"><span class="row__main"><span class="row__label">重置为初始演示数据</span><span class="row__note">恢复种子会话、问答库、报告与治理记录</span></span>' +
      '<button class="btn btn--small btn--ghost" data-action="reset">重置演示</button></div>' +
      '<div class="row"><span class="row__main"><span class="row__label">清空问答库</span><span class="row__note">清空后再问，可以从「空库」完整走一遍学习闭环</span></span>' +
      '<button class="btn btn--small btn--danger-ghost" data-action="clear-lib">清空问答库</button></div>' +
      '<div class="row"><span class="row__main"><span class="row__label">清空用量日志</span><span class="row__note">不影响问答库和会话</span></span>' +
      '<button class="btn btn--small btn--ghost" data-action="clear-usage">清空用量</button></div>' +
      '</section>' +

      '<section class="panel panel--about">' +
      '<div class="panel__head"><h2>关于这个演示</h2><span class="muted">v1.1 · 纯前端</span></div>' +
      '<p class="about">' +
      '这是一个<b>没有后端</b>的产品原型：聊天记录、问答库、版本、报告与治理记录都在浏览器里；云端回答由本地模板模拟（流式节奏、首字延迟、token 计量都是仿真值）。' +
      '匹配引擎是真的在工作——概念覆盖 + 字面相似打分，再逐条校验数值、代码入参、语言、否定条件与互斥对象；日期与算术走本地工具。' +
      '<br><br>换身份（右上角 A / B / C）可以验证：个人库的记录不会出现在另一个身份的匹配结果里；共享库的记录谁都能命中；' +
      '只有 A（库管理员）能发布修订、停用和恢复，B / C 只能报告和建议。' +
      '</p>' +
      '</section>';

    bind();
  };

  function bind() {
    var root = U.$('#settings-root');
    root.addEventListener('change', function (e) {
      var el = e.target;
      var key = el.getAttribute('data-set');
      if (!key) return;
      var v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'number' || el.type === 'range') v = parseFloat(el.value);
      else if (key === 'pauseThreshold' || key === 'pauseWindowDays' || key === 'maxContextTurns' || key === 'paraphraseCount' || key === 'expiryDays') v = parseInt(el.value, 10);
      else v = el.value;
      S.state.settings[key] = v;
      S.save(true);
      if (key === 'model' || key === 'cloudOnline' || key === 'priceIn' || key === 'priceOut' || key === 'timeZone') settings.render();
      if (key === 'threshold') {
        var lab = U.$('[data-threshold-label]');
        if (lab) lab.textContent = v.toFixed(2);
        U.toast('门槛已调整为 ' + v.toFixed(2), { kind: 'info', detail: '起始提示的标签和下面的「匹配调试」会立刻按新门槛计算' });
      }
      if (key === 'pauseThreshold' || key === 'pauseWindowDays') {
        U.toast('治理参数已更新', { kind: 'info', detail: '阈值 ' + S.state.settings.pauseThreshold + ' 人 · 窗口 ' + S.state.settings.pauseWindowDays + ' 天' });
      }
      App.bus.emit('settings:changed');
    });

    root.addEventListener('input', function (e) {
      if (e.target.getAttribute('data-set') === 'threshold') {
        var lab = U.$('[data-threshold-label]');
        var v = parseFloat(e.target.value);
        if (lab) lab.textContent = v.toFixed(2);
        e.target.style.setProperty('--p', Math.round((v - 0.5) / 0.42 * 100) + '%');
      }
    });

    root.addEventListener('click', function (e) {
      var scope = e.target.closest('[data-scope]');
      if (scope) {
        S.state.settings.defaultScope = scope.getAttribute('data-scope');
        S.save(true);
        settings.render();
        return;
      }
      var tool = e.target.closest('[data-tool]');
      if (tool) {
        var text = tool.getAttribute('data-tool');
        App.app.go('chat');
        setTimeout(function () { App.views.chat.sendDemo(text); }, 120);
        return;
      }
      var act = e.target.closest('[data-action]');
      if (!act) return;
      var action = act.getAttribute('data-action');
      if (action === 'debug') {
        runDebug();
      } else if (action === 'reset') {
        U.confirm({ title: '重置演示数据？', body: '会丢弃当前会话、问答库改动、报告与治理记录，恢复初始种子数据。', okLabel: '重置', danger: true })
          .then(function (ok) {
            if (!ok) return;
            var theme = S.state.theme;
            S.reset({ keepTheme: true, keepPage: true });
            S.state.theme = theme;
            App.bus.emit('data:reset');
            U.toast('已恢复初始演示数据', { kind: 'ok' });
          });
      } else if (action === 'clear-lib') {
        U.confirm({ title: '清空问答库？', body: '所有问题组、版本、等价问法都会被删除，之后的提问都会走云端（然后重新学习）。', okLabel: '清空', danger: true })
          .then(function (ok) {
            if (!ok) return;
            S.state.records = [];
            S.state.reports = [];
            S.state.suspensions = [];
            S.state.revisions = [];
            S.save(true);
            App.bus.emit('records:changed');
            U.toast('问答库已清空', { kind: 'info', detail: '现在可以演示「从空库开始」的完整闭环' });
          });
      } else if (action === 'clear-usage') {
        S.state.usage = [];
        S.save(true);
        U.toast('用量日志已清空', { kind: 'info' });
      }
    });

    var dbg = U.$('#dbg-input');
    if (dbg) dbg.addEventListener('keydown', function (e) { if (e.key === 'Enter') runDebug(); });
    runDebug();
  }

  function runDebug() {
    var input = U.$('#dbg-input');
    var out = U.$('#dbg-out');
    if (!input || !out) return;
    var q = input.value.trim();
    if (!q) { out.innerHTML = '<span class="muted">输入一句话开始</span>'; return; }

    var det = T.detect(q, S.state.settings);
    if (det) {
      var res = T.run(det);
      out.innerHTML = '<div class="dbg-verdict dbg-verdict--tool">' + U.icon('bolt', 13) +
        '<b>本地工具 · 0 次云端调用</b><span class="muted">' + U.esc(res.detail || '') + '</span></div>';
      return;
    }

    var a = M.analyze(q, S.matchableRecords(), {
      threshold: S.state.settings.threshold,
      isBlocked: function (rec, key) { return E.blockReason(rec, key); }
    });
    var head, cls;
    if (a.decision === 'reuse') {
      head = '复用 · ' + (a.chosen.via === 'exact' ? '原问命中' : a.chosen.via === 'alias' ? '等价问法命中' : '语义匹配');
      cls = 'lib';
    } else {
      head = '走云端';
      cls = 'cloud';
    }
    var cands = (a.shortlist || []).map(function (c) {
      return '<div class="dbg-cand">' +
        '<span class="dbg-cand__q">' + U.esc(c.record.original) + '</span>' +
        '<span class="dbg-cand__score mono">' + c.score.toFixed(2) + '</span>' +
        '<i class="dbg-cand__bar"><i style="width:' + Math.round(c.score * 100) + '%;background:' + (c.score >= S.state.settings.threshold ? 'var(--lib)' : 'var(--line-strong)') + '"></i></i>' +
        '<span class="dbg-cand__why">覆盖 ' + c.cov.toFixed(2) + ' · 字面 ' + c.bigram.toFixed(2) + '</span>' +
        '</div>';
    }).join('');
    var conf = (a.conflicts || []).map(function (c) {
      return '<div class="dbg-conf">' + U.icon('x', 12) + '<b>' + U.esc(c.field) + '</b>' + U.esc(c.detail) + '</div>';
    }).join('');
    var blocked = (a.blocked || []).map(function (b) {
      return '<div class="dbg-conf dbg-conf--warn">' + U.icon('alert', 12) + '<b>' + U.esc(b.kind === 'suspended' ? '已暂停' : '已绕开') + '</b>' + U.esc(b.reason) + '</div>';
    }).join('');
    out.innerHTML =
      '<div class="dbg-verdict dbg-verdict--' + cls + '">' + U.icon(a.decision === 'reuse' ? 'check' : 'cloud', 13) + '<b>' + head + '</b>' +
      '<span class="muted">' + U.esc(a.reason) + '</span></div>' +
      (cands || '<div class="muted">没有候选</div>') + blocked + conf;
  }
})();
