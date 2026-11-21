/* 柒柿AI · 纯前端演示 — 演示脚本（学习闭环 / 工具 / 变体 / 治理 / 版本） */
(function () {
  'use strict';
  var App = window.App, U = App.util, S = App.store;
  var D = (App.demo = {});
  var root = null;
  var open = false;
  var minimized = false;
  var running = null;
  var done = {};

  var BOOL_Q = 'Python 3 的 `bool([])` 返回什么？为什么？';

  function findGroup(word) {
    return S.state.records.filter(function (r) { return r.original.indexOf(word) >= 0; })[0] || null;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function waitFor(fn, timeout) {
    var start = Date.now();
    return new Promise(function (resolve) {
      (function tick() {
        var ok = false;
        try { ok = !!fn(); } catch (e) { ok = false; }
        if (ok || Date.now() - start > (timeout || 8000)) resolve(ok);
        else setTimeout(tick, 150);
      })();
    });
  }
  function click(sel, root) {
    var el = (root || document).querySelector(sel);
    if (el) { el.click(); return true; }
    return false;
  }
  function lastBot() {
    var list = document.querySelectorAll('.turn--bot');
    return list[list.length - 1] || null;
  }

  D.steps = [
    {
      id: 'ask',
      title: '用户 A 提问：`bool([])` 返回什么？',
      desc: '新会话走云端，回答完自动入库并生成等价问法',
      run: async function () {
        S.switchUser('u-a');
        S.createSession('u-a', { scope: 'shared', activate: true, title: '新聊天' });
        App.app.go('chat');
        await App.views.chat.sendDemo(BOOL_Q);
        await waitFor(function () {
          var r = findGroup('bool([])');
          return r && r.learnTask && r.learnTask.state === 'done';
        }, 9000);
        await wait(500);
      }
    },
    {
      id: 'library',
      title: '打开问答库：问题组、版本、表达变体',
      desc: '3 条问法通过检查、2 条被拒收，全部指向同一版答案',
      requires: function () { return !!findGroup('bool([])'); },
      run: async function () {
        App.app.go('library');
        await wait(200);
        var rec = findGroup('bool([])');
        if (rec) {
          S.state.ui.expanded[rec.id] = true;
          S.state.ui.libFilter = 'all';
          App.views.library.render();
          var el = U.$('.rec[data-rec="' + rec.id + '"]');
          if (el) { U.revealEl(el, U.$('.view'), 150); U.flash(el); }
        }
      }
    },
    {
      id: 'alias',
      title: '换用户 B，用已收录的改写提问',
      desc: '等价问法精确命中 → 云端调用 0 次，回答直接读 v1',
      requires: function () { return !!findGroup('bool([])'); },
      run: async function () {
        S.switchUser('u-b');
        S.createSession('u-b', { scope: 'shared', activate: true, title: '新聊天' });
        App.app.go('chat');
        await App.views.chat.sendDemo('在 Python 3 中，`bool([])` 的结果和原因是什么？');
        await wait(800);
      }
    },
    {
      id: 'semantic',
      title: 'B 换一个从没收录过的说法',
      desc: '语义匹配 + 条件校验通过 → 依然 0 次云端调用，真实问法并入问题组',
      requires: function () { return !!findGroup('bool([])'); },
      run: async function () {
        App.app.go('chat');
        await App.views.chat.sendDemo('Python 3 的 `if` 条件遇到空列表时会判断为真还是假？原因是什么？');
        await wait(800);
      }
    },
    {
      id: 'changed',
      title: 'B 把输入改成 `bool([0])`',
      desc: '代码入参变了 → 条件校验不通过 → 重新问云端',
      run: async function () {
        App.app.go('chat');
        await App.views.chat.sendDemo('那 `bool([0])` 呢？');
        await wait(1000);
      }
    },
    {
      id: 'tool',
      title: 'A 问「今天星期几？」和「37 × 48」',
      desc: '本地工具按时区读系统时钟、就地算算术：0 次云端调用，不入库',
      run: async function () {
        S.switchUser('u-a');
        S.createSession('u-a', { scope: 'shared', activate: true, title: '新聊天' });
        App.app.go('chat');
        await App.views.chat.sendDemo('今天星期几？');
        await wait(700);
        await App.views.chat.sendDemo('37 × 48 等于多少？');
        await wait(700);
      }
    },
    {
      id: 'plans',
      title: 'A 要两个方案，再问「这两个哪个好？」',
      desc: '生成类请求走云端；追问时补全指代并沿用预算、设备条件',
      run: async function () {
        S.switchUser('u-a');
        S.createSession('u-a', { scope: 'shared', activate: true, title: '新聊天' });
        App.app.go('chat');
        await App.views.chat.sendDemo('我没有独显，预算也有限。给我两个运行 AI 助手的方案');
        await wait(900);
        await App.views.chat.sendDemo('这两个哪个好？');
        await wait(1200);
        await App.views.chat.sendDemo('第二个呢？');
        await wait(900);
      }
    },
    {
      id: 'variant',
      title: 'B 用「换个说法」切到简短表达',
      desc: '同一版本下的合格答法，切换 0 次云端调用',
      run: async function () {
        S.switchUser('u-b');
        S.createSession('u-b', { scope: 'shared', activate: true, title: '新聊天' });
        App.app.go('chat');
        await App.views.chat.sendDemo('Mac 怎么只截一个窗口？');
        await wait(700);
        var bot = lastBot();
        var btn = bot && bot.querySelector('[data-action="variant"]');
        if (btn) {
          btn.click();
          await wait(220);
          var item = document.querySelector('.menu [data-i="1"]');
          if (item) item.click();
          await wait(400);
        }
      }
    },
    {
      id: 'report',
      title: 'B 报告「答非所问」，看票数进度',
      desc: '报告绑定到具体匹配关系；从第一条起，报告人自己会绕开它',
      run: async function () {
        S.switchUser('u-b');
        S.createSession('u-b', { scope: 'shared', activate: true, title: '新聊天' });
        App.app.go('chat');
        await App.views.chat.sendDemo('VLOOKUP 找不到时返回空白怎么写？');
        await wait(700);
        var bot = lastBot();
        var btn = bot && bot.querySelector('[data-action="report"]');
        if (btn) {
          btn.click();
          await wait(260);
          var mismatch = document.querySelector('input[name="rkind"][value="mismatch"]');
          if (mismatch) mismatch.checked = true;
          var note = document.querySelector('[data-report-note]');
          if (note) note.value = '我要的是空文本，不是空单元格';
          click('[data-modal-action="1"]');
          await wait(300);
          click('[data-modal-action="0"]');
          await wait(200);
        }
      }
    },
    {
      id: 'governance',
      title: 'A 在审核页补齐票数 → 暂停 → 发布修正',
      desc: '7 天内 3 名不同成员报告同一对象才暂停；修正发布后自动恢复',
      run: async function () {
        S.switchUser('u-a');
        App.app.go('governance');
        await wait(300);
        var g = S.governance();
        var t = g.targets.filter(function (x) { return x.groupId === 'grp_xlookup' && !x.suspension; })[0] ||
          g.targets.filter(function (x) { return x.groupId === 'grp_xlookup'; })[0] || g.targets[0];
        var key = t ? t.key : null;
        if (t && !t.suspension) {
          App.views.governance.simulate(key);
          await wait(600);
        }
        if (key) {
          App.views.governance.openFix(key);
          await wait(300);
          var basis = document.querySelector('[data-basis]');
          if (basis) basis.value = '用户 B 的报告 + 官方文档核对';
          click('[data-modal-action="1"]');
          await wait(400);
        }
      }
    },
    {
      id: 'version',
      title: 'A 重新问云端，再发布为新版本',
      desc: '旧版全部表达一起退出匹配，历史聊天仍保留当时的答复',
      run: async function () {
        S.switchUser('u-a');
        S.createSession('u-a', { scope: 'shared', activate: true, title: '新聊天' });
        App.app.go('chat');
        await App.views.chat.sendDemo('Excel 怎么把两列文字合并成一列？');
        await wait(700);
        var bot = lastBot();
        var retry = bot && bot.querySelector('[data-action="retry"]');
        if (retry) {
          retry.click();
          await waitFor(function () {
            var b = lastBot();
            return b && b.querySelector('[data-action="publish"]');
          }, 15000);
          await wait(300);
          var pub = lastBot() && lastBot().querySelector('[data-action="publish"]');
          if (pub) pub.click();
          await wait(500);
        }
        App.app.go('library');
        await wait(200);
        var rec = findGroup('Excel 怎么把两列');
        if (rec) {
          S.state.ui.expanded[rec.id] = true;
          App.views.library.render();
          var el = U.$('.rec[data-rec="' + rec.id + '"]');
          if (el) { U.revealEl(el, U.$('.view'), 150); U.flash(el); }
        }
      }
    }
  ];

  D.open = function () { open = true; minimized = false; D.render(); };
  D.close = function () { open = false; minimized = false; D.render(); };
  D.toggle = function () {
    if (!open) { D.open(); return; }
    minimized = !minimized;
    D.render();
  };
  D.mount = function (el) { root = el; D.render(); };
  D.markDone = function (id, ok) { done[id] = ok !== false; D.render(); };

  D.render = function () {
    if (!root) return;
    if (!open) { root.innerHTML = ''; return; }
    var current = D.steps.filter(function (s) { return !done[s.id]; })[0];
    var doneCount = D.steps.filter(function (s) { return done[s.id]; }).length;
    var dots = '<span class="gmini__dots">' + D.steps.map(function (s) {
      return '<i class="' + (done[s.id] ? 'is-on' : '') + '"></i>';
    }).join('') + '</span>';

    if (minimized) {
      root.innerHTML = '<div class="guide guide--mini">' +
        '<div class="guide__head guide__head--mini">' +
        '<div class="guide__title">' + U.icon('play', 13) + '演示脚本</div>' +
        dots +
        '<span class="gmini__next">' + (running ? '执行中…' : current ? U.esc(App.md.plain(current.title).slice(0, 16)) : '全部完成') + '</span>' +
        '<button class="icon-btn" data-guide="expand" title="展开脚本">' + U.icon('chevronDown', 15) + '</button>' +
        '</div></div>';
      bind();
      return;
    }

    root.innerHTML = '<div class="guide">' +
      '<div class="guide__head">' +
      '<div class="guide__title">' + U.icon('play', 14) + '三分钟演示脚本</div>' +
      '<div class="guide__acts"><span class="muted">' + doneCount + '/' + D.steps.length + '</span>' +
      '<button class="icon-btn" data-guide="mini" aria-label="收起">' + U.icon('chevronDown', 15) + '</button>' +
      '<button class="icon-btn" data-guide="close" aria-label="关闭">' + U.icon('x', 15) + '</button></div>' +
      '</div>' +
      '<div class="guide__sub">按顺序点「执行」，每一步都会真的走一遍请求管线；右侧面板会同步显示判断过程。</div>' +
      '<ol class="guide__list">' +
      D.steps.map(function (s, i) {
        var isDone = !!done[s.id];
        var isCur = current && current.id === s.id;
        var isRunning = running === s.id;
        return '<li class="gstep' + (isDone ? ' is-done' : '') + (isCur ? ' is-cur' : '') + '" data-step="' + s.id + '">' +
          '<div class="gstep__idx">' + (isDone ? U.icon('check', 11) : (i + 1)) + '</div>' +
          '<div class="gstep__body"><div class="gstep__title">' + s.title + '</div>' +
          '<div class="gstep__desc">' + s.desc + '</div></div>' +
          '<button class="gstep__run" data-run="' + s.id + '"' + (isRunning ? ' disabled' : '') + '>' +
          (isDone ? '重跑' : isRunning ? '执行中…' : '执行') + '</button>' +
          '</li>';
      }).join('') +
      '</ol>' +
      '<div class="guide__foot">' +
      '<button class="link" data-guide="reset">重置演示数据</button>' +
      '<span class="muted">提示：换身份在右上角 A / B / C</span>' +
      '</div></div>';
    bind();
  };

  function bind() {
    if (!root) return;
    root.querySelectorAll('[data-guide]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-guide');
        if (a === 'close') D.close();
        if (a === 'mini') { minimized = true; D.render(); }
        if (a === 'expand') { minimized = false; D.render(); }
        if (a === 'reset') {
          U.confirm({ title: '重置演示数据？', body: '会丢弃当前会话、问答库改动、报告与治理记录。', okLabel: '重置', danger: true }).then(function (ok) {
            if (!ok) return;
            var theme = S.state.theme;
            S.reset({ keepTheme: true, keepPage: true });
            S.state.theme = theme;
            done = {};
            App.bus.emit('data:reset');
            U.toast('已恢复初始演示数据', { kind: 'ok' });
          });
        }
      });
    });
    root.querySelectorAll('[data-run]').forEach(function (b) {
      b.addEventListener('click', function () { D.runStep(b.getAttribute('data-run')); });
    });
  }

  D.runStep = async function (id) {
    if (running) return;
    var step = D.steps.filter(function (s) { return s.id === id; })[0];
    if (!step) return;
    if (step.requires && !step.requires()) {
      U.toast('这一步依赖第 1 步的结果，先执行第 1 步', { kind: 'warn', detail: '先把 bool([]) 这个问题问一遍，问答库里才有可复用的记录' });
      return;
    }
    running = id;
    minimized = true;
    D.render();
    try {
      await step.run();
      done[id] = true;
      var idx = D.steps.indexOf(step);
      if (D.steps[idx + 1]) App.app.toast('下一步：' + App.md.plain(D.steps[idx + 1].title), { kind: 'info', life: 2600 });
    } catch (e) {
      console.error(e);
      U.toast('这一步执行失败：' + (e && e.message || e), { kind: 'err' });
    }
    running = null;
    D.render();
  };

  D.autoRun = async function (n) {
    var target = Math.min(n, D.steps.length);
    for (var i = 0; i < target; i++) {
      var step = D.steps[i];
      if (step.requires && !step.requires()) break;
      running = step.id;
      D.render();
      try { await step.run(); done[step.id] = true; } catch (e) { console.error(e); }
      running = null;
      D.render();
      await wait(200);
    }
    return target;
  };

  D.isOpen = function () { return open; };
})();
