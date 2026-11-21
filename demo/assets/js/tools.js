/* 柒柿AI · 纯前端演示 — 本地工具（日期 / 星期 / 时间 / 四则运算），每次现算，0 次云端调用 */
(function () {
  'use strict';
  var App = window.App, U = App.util;
  var T = (App.tools = {});
  var WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  function pad(n) { return String(n).padStart(2, '0'); }

  function offsetLabel(tz) {
    try {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
        .formatToParts(new Date());
      var off = parts.filter(function (p) { return p.type === 'timeZoneName'; })[0];
      return off ? off.value.replace('GMT', 'UTC').replace(/^UTC$/, 'UTC+00:00') : '';
    } catch (e) { return ''; }
  }

  function partsIn(tz, date) {
    var fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    var out = {};
    fmt.formatToParts(date).forEach(function (p) { if (p.type !== 'literal') out[p.type] = p.value; });
    return out;
  }

  function weekdayOf(y, mo, d) {
    return new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)).getUTCDay();
  }

  function fmtCN(y, mo, d) {
    return y + ' 年 ' + mo + ' 月 ' + d + ' 日，' + WEEK[weekdayOf(y, mo, d)];
  }

  /* ------------------------------ 识别 ------------------------------ */
  T.detect = function (query, settings) {
    var tz = (settings && settings.timeZone) || 'Asia/Shanghai';
    var q = String(query || '');

    var m = /(\d{4})\s*[年\-\/\.]\s*(\d{1,2})\s*[月\-\/\.]\s*(\d{1,2})\s*[日号]?\s*(?:是|的)?\s*(?:星期|周|礼拜)几/.exec(q);
    if (m) {
      return { kind: 'date', mode: 'explicit', y: +m[1], mo: +m[2], d: +m[3], timeZone: tz, raw: m[0] };
    }

    if (/(今天|今日|现在|当前)[^，。]{0,6}(星期|周|礼拜)几|今天几号|今天(是)?(几月几号|什么日子|日期)|今天是几号|today.*(date|day)/i.test(q)) {
      return { kind: 'date', mode: 'today', timeZone: tz };
    }

    if (/(明天|后天|昨天|前天)[^，。]{0,6}(星期|周|礼拜)几/.test(q)) {
      var offset = /明天/.test(q) ? 1 : /后天/.test(q) ? 2 : /前天/.test(q) ? -2 : -1;
      return { kind: 'date', mode: 'relative', offset: offset, timeZone: tz };
    }

    if (/现在几点|当前时间|几点了|什么时间|what time/i.test(q)) {
      return { kind: 'time', mode: 'now', timeZone: tz };
    }

    var expr = q
      .replace(/[，。？?！!]/g, ' ')
      .replace(/(帮我|请|麻烦)?(计算|算一下|算算|求)/g, ' ')
      .replace(/(等于|是)?\s*(多少|几)\s*$/g, ' ')
      .replace(/乘以|×/g, '*')
      .replace(/除以|÷/g, '/')
      .replace(/加上/g, '+')
      .replace(/减去/g, '-')
      .replace(/[=＝]/g, ' ')
      .trim();
    if (/^[\d\s+\-*/%^().]+$/.test(expr) && /\d/.test(expr) && /[+\-*/%^]/.test(expr)) {
      return { kind: 'calc', mode: 'expr', expr: expr.replace(/\s+/g, ''), raw: q };
    }
    return null;
  };

  /* ------------------------------ 计算器 ------------------------------ */
  function evaluate(src) {
    var s = String(src).replace(/\s+/g, '');
    var i = 0;
    function peek() { return s[i]; }
    function parseExpr() {
      var v = parseTerm();
      while (peek() === '+' || peek() === '-') {
        var op = s[i++];
        var r = parseTerm();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    }
    function parseTerm() {
      var v = parsePower();
      while (peek() === '*' || peek() === '/' || peek() === '%') {
        var op = s[i++];
        var r = parsePower();
        if (op === '*') v *= r;
        else if (op === '/') v /= r;
        else v %= r;
      }
      return v;
    }
    function parsePower() {
      var v = parseUnary();
      if (peek() === '^') { i++; return Math.pow(v, parsePower()); }
      return v;
    }
    function parseUnary() {
      if (peek() === '-') { i++; return -parseUnary(); }
      if (peek() === '+') { i++; return parseUnary(); }
      return parseAtom();
    }
    function parseAtom() {
      if (peek() === '(') {
        i++;
        var v = parseExpr();
        if (peek() === ')') i++;
        return v;
      }
      var start = i;
      while (/[0-9.]/.test(peek() || '')) i++;
      if (start === i) throw new Error('表达式不完整');
      return parseFloat(s.slice(start, i));
    }
    var val = parseExpr();
    if (i < s.length) throw new Error('无法解析剩余部分：' + s.slice(i));
    if (!isFinite(val)) throw new Error('结果不是有限数');
    return val;
  }

  T.evaluate = evaluate;

  function fmtNum(n) {
    if (Number.isInteger(n)) return String(n);
    return String(Math.round(n * 1e10) / 1e10);
  }

  function prettyExpr(expr) {
    return expr.replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/\+/g, ' + ').replace(/-/g, ' − ').replace(/\^/g, ' ^ ');
  }

  /* ------------------------------ 执行 ------------------------------ */
  T.run = function (det) {
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var tz = det.timeZone;
    var off = offsetLabel(tz);

    function cost() {
      var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      return Math.max(0.2, Math.round((t1 - t0) * 10) / 10);
    }

    if (det.kind === 'date') {
      var y, mo, d, label;
      if (det.mode === 'explicit') {
        y = det.y; mo = det.mo; d = det.d;
        label = '指定日期';
      } else {
        var base = new Date();
        if (det.mode === 'relative') base = new Date(base.getTime() + det.offset * 86400000);
        var p = partsIn(tz, base);
        y = +p.year; mo = +p.month; d = +p.day;
        label = det.mode === 'relative' ? (det.offset > 0 ? '未来 ' + det.offset + ' 天' : '过去 ' + Math.abs(det.offset) + ' 天') : '今天';
      }
      var wd = WEEK[weekdayOf(y, mo, d)];
      var ms = cost();
      var text = [
        '**' + fmtCN(y, mo, d) + '。**',
        '',
        det.mode === 'explicit'
          ? '这个日期是按本地日历直接算的：只需要年和月日，不依赖当前时间，也不调用云端。'
          : '按你设置的时区 **' + tz + (off ? '（' + off + '）' : '') + '** 读取系统时钟算出' + label + '的日期，纯本地计算。',
        '',
        '| 项目 | 值 |',
        '| --- | --- |',
        '| 日期 | ' + y + '-' + pad(mo) + '-' + pad(d) + ' |',
        '| 星期 | ' + wd + ' |',
        '| 时区 | ' + tz + (off ? '（' + off + '）' : '') + ' |',
        '| 计算耗时 | ' + ms + ' ms · 0 次云端调用 |',
        '',
        '> 每次提问都会重新读时钟：跨过午夜、切换时区或过完这一天，都会得到新的结果。按设计这类工具结果只写进会话记录，不进问答库；库里只保留「这个问题走工具」这条路由。'
      ].join('\n');
      return {
        ok: true, tool: 'date', text: text, costMs: ms,
        detail: '本地日历 · ' + tz + ' · ' + y + '-' + pad(mo) + '-' + pad(d) + ' ' + wd,
        result: { y: y, mo: mo, d: d, weekday: wd, timeZone: tz, offset: off, mode: det.mode }
      };
    }

    if (det.kind === 'time') {
      var now = new Date();
      var pp = partsIn(tz, now);
      var ms2 = cost();
      return {
        ok: true, tool: 'clock', costMs: ms2,
        detail: '本地时钟 · ' + tz + ' · ' + pp.hour + ':' + pp.minute,
        text: [
          '**现在是 ' + pp.hour + ':' + pp.minute + '（' + tz + (off ? '，' + off : '') + '）。**',
          '',
          '时间来自本机系统时钟，按你设置的时区换算，没有调用云端。',
          '',
          '| 项目 | 值 |',
          '| --- | --- |',
          '| 本地时间 | ' + pp.hour + ':' + pp.minute + ' |',
          '| 时区 | ' + tz + (off ? '（' + off + '）' : '') + ' |',
          '| 计算耗时 | ' + ms2 + ' ms · 0 次云端调用 |'
        ].join('\n'),
        result: { hour: pp.hour, minute: pp.minute, timeZone: tz }
      };
    }

    // 算术
    var value;
    try {
      value = evaluate(det.expr);
    } catch (e) {
      return { ok: false, tool: 'calc', error: e.message };
    }
    var ms3 = cost();
    return {
      ok: true, tool: 'calc', costMs: ms3,
      detail: '本地计算器 · ' + det.expr + ' = ' + fmtNum(value),
      result: { expr: det.expr, value: value },
      text: [
        '**' + prettyExpr(det.expr) + ' = ' + fmtNum(value) + '**',
        '',
        '用本地计算器算的：只解析四则运算、括号、`%` 和 `^`，不连网、不调用云端。',
        '',
        '| 项目 | 值 |',
        '| --- | --- |',
        '| 表达式 | `' + det.expr + '` |',
        '| 结果 | **' + fmtNum(value) + '** |',
        '| 计算耗时 | ' + ms3 + ' ms · 0 次云端调用 |',
        '',
        '> 换一组数字、加上括号或改运算符，都会就地重算。这类结果只写进会话，不进问答库。'
      ].join('\n')
    };
  };
})();
