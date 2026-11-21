/* 柒柿AI · 纯前端演示 — 迷你 Markdown 渲染器（支持表格 / 代码高亮 / 列表嵌套） */
(function () {
  'use strict';
  var App = window.App, U = App.util;
  var MD = (App.md = {});

  var KEYWORDS = {
    python: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield print len sum range open self',
    javascript: 'const let var function return if else for while class extends new this import export from default async await try catch finally throw typeof instanceof null undefined true false switch case break continue do in of delete void yield static get set',
    jsx: 'const let var function return if else for while class extends new this import export default async await try catch throw null undefined true false => ',
    json: 'true false null',
    bash: 'if then else fi for do done while case esac function return export cd echo sudo npm pnpm node python git',
    sql: 'select from where group by order having join left right inner outer on as insert update delete create table index limit offset distinct count sum avg min max',
    excel: 'IF IFERROR IFNA VLOOKUP XLOOKUP CONCAT TEXTJOIN SUM AVERAGE COUNT IFERROR'
  };

  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'; });
  }

  function highlight(code, lang) {
    var key = String(lang || '').toLowerCase();
    var words = KEYWORDS[key] || '';
    if (!words) return esc(code);
    var kw = words.trim().split(/\s+/).filter(Boolean).join('|');
    var re = new RegExp(
      '(#[^\\n]*|//[^\\n]*)' +                       // 1 comment
      '|("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\')' + // 2 string
      '|\\b(\\d+(?:\\.\\d+)?)\\b' +                  // 3 number
      '|\\b(' + kw + ')\\b',                         // 4 keyword
      'g');
    var out = '', last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      if (m[1]) out += '<span class="tok-c">' + esc(m[1]) + '</span>';
      else if (m[2]) out += '<span class="tok-s">' + esc(m[2]) + '</span>';
      else if (m[3]) out += '<span class="tok-n">' + esc(m[3]) + '</span>';
      else out += '<span class="tok-k">' + esc(m[4]) + '</span>';
      last = m.index + m[0].length;
    }
    out += esc(code.slice(last));
    return out;
  }

  function inline(text) {
    var s = text;
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, href) {
      var safe = /^(https?:|mailto:|#|\/)/i.test(href) ? href : '#';
      return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(（])\*([^*\n]+)\*(?=[\s)）.,，。]|$)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return s;
  }

  function renderCodeBlock(idx, block) {
    var lang = block.lang || '';
    var label = lang || 'text';
    return '<div class="codeblock">' +
      '<div class="codeblock__bar"><span class="codeblock__lang">' + U.esc(label) + '</span>' +
      '<button class="codeblock__copy" type="button" data-action="copy-code">' + U.icon('copy', 13) + '<span>复制</span></button></div>' +
      '<pre><code>' + highlight(block.code, lang) + '</code></pre></div>';
  }

  function splitRow(line) {
    var s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    var cells = [], cur = '', i = 0;
    while (i < s.length) {
      if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i += 2; continue; }
      if (s[i] === '|') { cells.push(cur); cur = ''; i++; continue; }
      cur += s[i++];
    }
    cells.push(cur);
    return cells.map(function (c) { return c.trim(); });
  }

  var LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

  function buildTree(items) {
    var root = { level: -1, children: [] };
    var stack = [root];
    items.forEach(function (it) {
      while (stack.length > 1 && it.indent <= stack[stack.length - 1].level) stack.pop();
      var node = { text: it.text, ordered: it.ordered, level: it.indent, children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    });
    return root;
  }

  function renderList(nodes) {
    var out = '', i = 0;
    while (i < nodes.length) {
      var ordered = nodes[i].ordered, group = [];
      while (i < nodes.length && nodes[i].ordered === ordered) { group.push(nodes[i]); i++; }
      out += ordered ? '<ol>' : '<ul>';
      group.forEach(function (n) {
        out += '<li>' + inline(n.text) + (n.children.length ? renderList(n.children) : '') + '</li>';
      });
      out += ordered ? '</ol>' : '</ul>';
    }
    return out;
  }

  MD.render = function (src) {
    var text = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
    var codes = [], spans = [];

    // 1) 围栏代码块
    text = text.replace(/```([\w+#.-]*)[ \t]*\n([\s\S]*?)```/g, function (_, lang, code) {
      var i = codes.length;
      codes.push({ lang: lang, code: code.replace(/\n+$/, '') });
      return '\n\u0000C' + i + '\u0000\n';
    });

    // 2) 行内代码
    text = text.replace(/`([^`\n]+)`/g, function (_, code) {
      var i = spans.length;
      spans.push(code);
      return '\u0000I' + i + '\u0000';
    });

    // 3) 转义
    text = esc(text);
    var lines = text.split('\n');
    var out = [];
    var i = 0;

    function isBlockStart(line) {
      return /^\s*$/.test(line) ||
        /^\u0000C\d+\u0000$/.test(line) ||
        /^#{1,6}\s/.test(line) ||
        /^&gt;\s?/.test(line) ||
        /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
        LIST_RE.test(line) ||
        /^\s*\|.*\|\s*$/.test(line);
    }

    while (i < lines.length) {
      var line = lines[i];

      if (/^\s*$/.test(line)) { i++; continue; }

      // 代码块占位
      var cm = /^\u0000C(\d+)\u0000$/.exec(line);
      if (cm) {
        out.push(renderCodeBlock(+cm[1], codes[+cm[1]]));
        i++;
        continue;
      }

      // 标题
      var hm = /^(#{1,6})\s+(.*)$/.exec(line);
      if (hm) {
        var lv = Math.min(hm[1].length + 1, 6);
        out.push('<h' + lv + '>' + inline(hm[2].replace(/\s*#+\s*$/, '')) + '</h' + lv + '>');
        i++;
        continue;
      }

      // 分隔线
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

      // 引用
      if (/^&gt;\s?/.test(line)) {
        var qi = [];
        while (i < lines.length && /^&gt;\s?/.test(lines[i])) {
          qi.push(lines[i].replace(/^&gt;\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + qi.map(function (q) { return inline(q); }).join('<br>') + '</blockquote>');
        continue;
      }

      // 表格
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        var head = splitRow(line);
        var aligns = splitRow(lines[i + 1]).map(function (c) {
          if (/^:-+:$/.test(c)) return 'center';
          if (/^-+:$/.test(c)) return 'right';
          return '';
        });
        i += 2;
        var body = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { body.push(splitRow(lines[i])); i++; }
        var th = head.map(function (c, ci) {
          return '<th' + (aligns[ci] ? ' style="text-align:' + aligns[ci] + '"' : '') + '>' + inline(c) + '</th>';
        }).join('');
        var trs = body.map(function (cells) {
          var tds = '';
          for (var ci = 0; ci < head.length; ci++) {
            tds += '<td' + (aligns[ci] ? ' style="text-align:' + aligns[ci] + '"' : '') + '>' + inline(cells[ci] == null ? '' : cells[ci]) + '</td>';
          }
          return '<tr>' + tds + '</tr>';
        }).join('');
        out.push('<div class="table-wrap"><table><thead><tr>' + th + '</tr></thead><tbody>' + trs + '</tbody></table></div>');
        continue;
      }

      // 列表
      if (LIST_RE.test(line)) {
        var items = [];
        while (i < lines.length) {
          var l = lines[i];
          var m = LIST_RE.exec(l);
          if (m) {
            var indent = m[1].replace(/\t/g, '    ').length;
            items.push({ indent: indent, ordered: /\d/.test(m[2]), text: m[3] });
            i++;
            continue;
          }
          if (/^\s*$/.test(l)) {
            // 空行后若还是列表项则继续
            var nxt = lines[i + 1];
            if (nxt && LIST_RE.test(nxt)) { i++; continue; }
            break;
          }
          // 续行
          if (items.length && /^\s+/.test(l) && !/^\u0000C\d+\u0000$/.test(l.trim())) {
            items[items.length - 1].text += ' ' + l.trim();
            i++;
            continue;
          }
          break;
        }
        out.push(renderList(buildTree(items).children));
        continue;
      }

      // 段落
      var para = [line];
      i++;
      while (i < lines.length && !isBlockStart(lines[i])) {
        if (/^\u0000C\d+\u0000$/.test(lines[i])) break;
        para.push(lines[i]);
        i++;
      }
      out.push('<p>' + para.map(function (p) { return inline(p); }).join('<br>') + '</p>');
    }

    var html = out.join('\n');
    // 还原行内代码
    html = html.replace(/\u0000I(\d+)\u0000/g, function (_, n) {
      return '<code class="inline-code">' + esc(spans[+n]) + '</code>';
    });
    return html;
  };

  MD.plain = function (src) {
    return String(src || '')
      .replace(/```[\s\S]*?```/g, ' [代码] ')
      .replace(/[#>*`_~]/g, '')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  /* 流式渲染：把还没长完的结构补成合法片段，避免半截表格 / 半截代码块 */
  function stabilize(src) {
    var t = String(src == null ? '' : src);
    var fences = (t.match(/```/g) || []).length;
    if (fences % 2 === 1) t += '\n```';
    var lines = t.split('\n');
    var last = lines[lines.length - 1];
    if (/^\s*\|/.test(last) && !/\|\s*$/.test(last)) t += ' |';
    return t;
  }

  MD.renderStreaming = function (src) {
    return MD.render(stabilize(src));
  };
})();
