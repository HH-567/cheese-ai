/* 柒柿AI · 纯前端演示 — 模拟云端模型 + 后台改写生成
 * 没有网络请求：回答来自本地模板，流式节奏 / token 计量 / 费用都是仿真值
 */
(function () {
  'use strict';
  var App = window.App, U = App.util;
  var C = (App.cloud = {});
  var L = function (arr) { return arr.join('\n'); };

  function chars(s) { return String(s || '').replace(/\s+/g, ' ').length; }
  function tokensOf(s) { return Math.max(8, Math.round(chars(s) / 1.6)); }

  C.estimate = function (inputText, outputText, settings) {
    var ti = tokensOf(inputText), to = tokensOf(outputText);
    var cost = (ti * settings.priceIn + to * settings.priceOut) / 1e6;
    return { tokensIn: ti, tokensOut: to, cost: Math.round(cost * 100000) / 100000 };
  };

  /* ------------------------------- 回答模板 ------------------------------- */
  function compareAnswer(ctx) {
    var cs = ctx.candidates || [];
    var a = cs[0] ? cs[0].label : '方案 A';
    var b = cs[1] ? cs[1].label : '方案 B';
    var cond = (ctx.constraints || []).length ? (ctx.constraints || []).join('、') : '你刚才提到的条件';
    return {
      id: 'compare',
      text: L([
        '回到你刚才的两个方案——**' + a + '** 和 **' + b + '**——结合你「' + cond + '」这几个条件：',
        '',
        '**结论：先走 ' + a + '。**',
        '',
        '| 维度 | ' + a + ' | ' + b + ' |',
        '| --- | --- | --- |',
        '| 启动成本 | 现有电脑直接用，约 0 元 | 需要一块 5060，约 2500 元 |',
        '| 日常问答 | 本地查库命中即零调用，未命中才联网 | 本地量化模型离线推理 |',
        '| 质量上限 | 难题交给云端强模型 | 受显存限制的小模型 |',
        '| 断网可用 | 只有已收录的问答 | 全部可离线 |',
        '| 适合谁 | 想先把闭环跑起来、预算敏感 | 长期高频、确实需要离线 |',
        '',
        '具体到你「没有独显、预算也有限」的情况，还有三点值得说透：',
        '',
        '1. **启动成本**：' + a + '不需要新硬件，' + b + '要一次性投入一块显卡，这笔钱在黑客松阶段换不来等量的答案质量。',
        '2. **响应速度**：查库是毫秒级，本地小模型在 5060 上出字通常 20–40 token/s，日常问答反而更慢。',
        '3. **质量天花板**：需要推理和长文综合作答时，云端强模型和小模型不是一个量级。',
        '',
        '> 一个折中做法：先按 ' + a + ' 跑两周，把「复用命中率」和「云端账单」记下来。如果命中率已经到 70% 以上、月账单又确实心疼，再加显卡做离线兜底。'
      ]),
      learn: {
        original: '在预算有限且没有独显的前提下，CPU 查库加云端兜底与 5060 本地跑小模型，哪个更适合起步？',
        intent: '在预算有限、无独显的约束下比较两种 AI 助手运行方案',
        entities: ['CPU 查库 + 云端兜底', 'RTX 5060 本地小模型'],
        constraints: ['预算有限', '没有独显', '比较启动成本与质量'],
        aliases: [
          { text: '预算紧、没有独显的情况下，CPU 查库加云端和 5060 本地小模型怎么选？' },
          { text: '两个方案里，哪个更适合先跑起来？', reason: '指代未补全，脱离上下文无法理解' },
          { text: '没有独显、预算有限，AI 助手该用云端还是本地小模型？' },
          { text: '想省钱又没有独显，起步阶段应该选 CPU 查库还是 5060？' }
        ]
      }
    };
  }

  function secondPlanAnswer(ctx) {
    var cs = ctx.candidates || [];
    var b = cs[1] ? cs[1].label : '方案 B';
    return {
      id: 'second-plan',
      text: L([
        '单独把 **' + b + '** 说清楚。',
        '',
        '**它能做什么**',
        '',
        '- 在本机跑 7B–14B 的量化模型（4bit 下 7B 约 5 GB 显存），断网也能回答，数据不出本机。',
        '- 承担意图判断、问法改写、简单问答，这三件事正是「自动学习」闭环里最费 token 的部分。',
        '',
        '**它做不了什么**',
        '',
        '- 长文综合、多步推理、代码大改这类任务，小模型和云端强模型的差距非常明显。',
        '- 上下文窗口通常只有 8k–32k，塞不下很长的参考资料。',
        '',
        '**成本怎么算**',
        '',
        '| 项目 | 数值 |',
        '| --- | --- |',
        '| 显卡 | 5060 12G，约 2500 元 |',
        '| 电费 | 满载 150W，按每天 4 小时算，月均约 15 元 |',
        '| 等效云端额度 | 约等于 60 万–80 万 output token |',
        '',
        '结论：它是一笔**一次性投入换长期零调用费**的选择。按你现在的用量，回本点大概在每天 40–60 次新问题之后；在这之前，' + (cs[0] ? cs[0].label : '方案 A') + '更划算。'
      ]),
      learn: null
    };
  }

  function boolEmptyAnswer() {
    return {
      id: 'bool-empty',
      text: L([
        '`bool([])` 返回 **False**。',
        '',
        'Python 3 里内置容器是「空即假」：列表、元组、字典、集合、字符串在**没有任何元素**时都是假值，和元素本身是什么无关。',
        '',
        '| 表达式 | `bool()` | 说明 |',
        '| --- | --- | --- |',
        '| `bool([])` | `False` | 空列表 |',
        '| `bool([0])` | `True` | 有一个元素，哪怕元素是 0 |',
        '| `bool([[]])` | `True` | 里面套了空列表，但外层不空 |',
        '| `bool("")` | `False` | 空字符串 |',
        '| `bool([None])` | `True` | 同上，只看长度 |',
        '',
        '```python',
        '>>> bool([])',
        'False',
        '>>> if []:',
        '...     print("真分支")',
        '... else:',
        '...     print("假分支")',
        '假分支',
        '```',
        '',
        '所以 `if []:` 和 `if bool([]):` 走的是同一个分支——**空列表在条件判断里为假**。这也是 `if not items:` 能替代 `if len(items) == 0:` 的原因。'
      ]),
      learn: {
        original: 'Python 3 的 `bool([])` 返回什么？为什么？',
        intent: '解释 Python 3 空列表的布尔求值结果与原因',
        entities: ['Python 3', 'bool()', '空列表'],
        constraints: ['Python 3', '列表长度为 0', '中文输出', '解释原因'],
        aliases: [
          { text: '在 Python 3 中，`bool([])` 的结果和原因是什么？' },
          { text: '为什么空列表在 Python 3 里是假值？' },
          { text: 'Python 3 里 `bool([])` 为什么返回 False？' },
          { text: '用英语解释 `bool([])` 为什么为假。', reason: '输出语言改变：中文 → 英语' },
          { text: '`bool([0])` 返回什么？', reason: '代码输入改变：`[]` → `[0]`，条件不一致' }
        ]
      }
    };
  }

  function boolNonEmptyAnswer() {
    return {
      id: 'bool-nonempty',
      text: L([
        '`bool([0])` 返回 **True**。',
        '',
        '关键点是：`bool()` 对列表只看**长度**，不看里面的元素是什么。`[0]` 里有一个元素（数字 0），长度是 1，所以它是非空列表 → 真值。',
        '',
        '| 表达式 | 长度 | `bool()` |',
        '| --- | --- | --- |',
        '| `bool([])` | 0 | `False` |',
        '| `bool([0])` | 1 | `True` |',
        '| `bool([False])` | 1 | `True` |',
        '| `bool([[], []])` | 2 | `True` |',
        '',
        '```python',
        '>>> bool([0])',
        'True',
        '>>> if [0]:',
        '...     print("真分支")',
        '真分支',
        '>>> bool([False])',
        'True',
        '```',
        '',
        '最后一行最容易反直觉：元素本身是 `False`，但列表长度是 1，所以整个列表仍然是真值。判断「列表里有没有值」应该写 `any(x)`，判断「列表是不是空的」才用 `if not lst:`。'
      ]),
      learn: {
        original: 'Python 3 的 `bool([0])` 返回什么？',
        intent: '解释 Python 3 非空列表的布尔求值结果',
        entities: ['Python 3', 'bool()', '非空列表'],
        constraints: ['Python 3', '列表长度为 1', '中文输出'],
        aliases: [
          { text: 'Python 3 里 `bool([0])` 为什么是 True？' },
          { text: '列表里只有一个 0，布尔判断算真还是假？' },
          { text: '`bool([False])` 的结果是什么？', reason: '代码输入改变：`[0]` → `[False]`' },
          { text: 'Python 3 中 `bool([0])` 返回 True 的原因？' }
        ]
      }
    };
  }

  function boolEnglishAnswer() {
    return {
      id: 'bool-en',
      text: L([
        '`bool([])` returns **False** in Python 3.',
        '',
        'The reason is that list truthiness depends on **length, not contents**. An empty list has length `0`, and Python\'s built-in containers (`list`, `tuple`, `dict`, `set`, `str`) are falsy when they contain no elements.',
        '',
        '| Expression | `bool()` |',
        '| --- | --- |',
        '| `bool([])` | `False` |',
        '| `bool([0])` | `True` |',
        '| `bool("")` | `False` |',
        '',
        '```python',
        '>>> bool([])',
        'False',
        '>>> if []:',
        '...     print("truthy")',
        '... else:',
        '...     print("falsy")',
        'falsy',
        '```',
        '',
        'So `if []:` and `if bool([]):` take the same branch: an empty list is falsy in a condition. That is why `if not items:` is the idiomatic replacement for `if len(items) == 0:`.'
      ]),
      learn: {
        original: 'Explain in English why `bool([])` is False in Python 3.',
        intent: '用英文解释 Python 3 空列表的布尔求值',
        entities: ['Python 3', 'bool()', 'empty list'],
        constraints: ['输出语言：英语', '解释原因'],
        aliases: [
          { text: 'Why is an empty list falsy in Python 3?' },
          { text: 'In English: what does `bool([])` evaluate to, and why?' },
          { text: '为什么 Python 3 的空列表是假值？', reason: '输出语言改变：英语 → 中文' }
        ]
      }
    };
  }

  function excelMergeAnswer() {
    return {
      id: 'excel-merge',
      text: L([
        '两列文字合并成一列，按版本选写法：',
        '',
        '**通用：`&` 直接拼**',
        '',
        '```excel',
        '=A2 & B2',
        '=A2 & " " & B2',
        '=A2 & "-" & B2',
        '```',
        '',
        '**Excel 2016+ / WPS 新版：`TEXTJOIN`**',
        '',
        '```excel',
        '=TEXTJOIN(" ", TRUE, A2:B2)',
        '```',
        '',
        '`TRUE` 表示跳过空单元格，整行只有一列有值时不会多出多余的分隔符。',
        '',
        '| 场景 | 写法 |',
        '| --- | --- |',
        '| 两列，插入空格 | `=A2 & " " & B2` |',
        '| 多列，统一分隔符 | `=TEXTJOIN("-", TRUE, A2:C2)` |',
        '| 只想拼有值的列 | `=TEXTJOIN("", TRUE, A2:C2)` |',
        '',
        '> 拼完之后如果要删掉源列：先选这一列，复制 → 右键「选择性粘贴 → 数值」，否则公式会跟着源列一起失效。'
      ]),
      learn: null
    };
  }

  function xlookupAnswer() {
    return {
      id: 'xlookup-blank',
      text: L([
        '把 `#N/A` 换成空白，按你想要的「空」来选写法：',
        '',
        '**只处理「找不到」这一种错误 —— `IFNA`**',
        '',
        '```excel',
        '=IFNA(VLOOKUP(A2, Sheet2!A:B, 2, FALSE), "")',
        '```',
        '',
        '**所有错误都变成空白 —— `IFERROR`**',
        '',
        '```excel',
        '=IFERROR(VLOOKUP(A2, Sheet2!A:B, 2, FALSE), "")',
        '```',
        '',
        '`IFERROR` 会把列号写错、引用失效一并吞掉，排查时容易掩盖问题。',
        '',
        '**Excel 2021 / Microsoft 365 —— `XLOOKUP` 自带兜底参数**',
        '',
        '```excel',
        '=XLOOKUP(A2, Sheet2!A:A, Sheet2!B:B, "")',
        '```',
        '',
        '| 写法 | 兼容性 | 兜住哪些错误 |',
        '| --- | --- | --- |',
        '| `IFNA` | Excel 2013+ | 只兜 #N/A |',
        '| `IFERROR` | Excel 2007+ | 全部错误 |',
        '| `XLOOKUP` | 2021 / M365 | 由第四个参数决定 |',
        '',
        '> 返回 `""` 之后单元格是「空文本」而不是真正的空：`COUNTBLANK` 统计不到它，参与数字计算时要再套一层判断。'
      ]),
      learn: null
    };
  }

  function decoratorAnswer() {
    return {
      id: 'decorator',
      text: L([
        '装饰器本质上是**接收函数、返回函数的高阶函数**，`@` 只是语法糖：',
        '',
        '```python',
        'import functools, time',
        '',
        'def timer(fn):',
        '    @functools.wraps(fn)',
        '    def wrapper(*args, **kwargs):',
        '        start = time.perf_counter()',
        '        result = fn(*args, **kwargs)',
        '        print(f"{fn.__name__} 用时 {time.perf_counter() - start:.3f}s")',
        '        return result',
        '    return wrapper',
        '',
        '',
        '@timer',
        'def slow_task(n):',
        '    return sum(i * i for i in range(n))',
        '',
        '',
        'slow_task(10_000_000)',
        '```',
        '',
        '`@timer` 等价于 `slow_task = timer(slow_task)`。几个容易踩的点：',
        '',
        '1. **一定加 `functools.wraps`**，否则函数名、docstring 都会变成 `wrapper`，调试时很难找。',
        '2. **带参数的装饰器要多包一层**：`@retry(times=3)` 实际上是「先调用 `retry(times=3)`，再拿返回值当装饰器」。',
        '3. **装饰器在模块导入时就执行**，不在函数调用时执行——所以装饰器里不要写重逻辑。',
        '4. **多个装饰器从下往上套**：`@a` `@b` 作用在 `f` 上，等价于 `a(b(f))`。',
        '',
        '> 判断要不要用装饰器：如果多个函数都要在前后加同一段逻辑（计时、重试、鉴权、日志），就抽成装饰器；如果只有一处，直接写反而更好读。'
      ]),
      learn: {
        original: '解释一下 Python 的装饰器是怎么工作的',
        intent: '解释 Python 装饰器的原理与常见用法',
        entities: ['Python', '装饰器', '@ 语法'],
        constraints: ['中文输出', '给出可运行示例', '解释原理'],
        aliases: [
          { text: 'Python 装饰器是什么原理？' },
          { text: '`@` 语法在 Python 里等价于什么写法？' },
          { text: '怎么自己写一个 Python 装饰器？' },
          { text: '为什么装饰器里要用 functools.wraps？', reason: '任务范围改变：从「原理解释」变成「wraps 的作用」' },
          { text: '解释一下 Python 装饰器，最好带一个计时的例子' }
        ]
      }
    };
  }

  function genericAnswer(query) {
    var core = String(query).replace(/[？?。\s]+$/, '').slice(0, 60);
    return {
      id: 'generic',
      text: L([
        '你问的是「' + core + '」。先把问题拆成可以验证的几步：',
        '',
        '**1. 这类问题的通用结构**',
        '',
        '绝大多数「怎么做 / 为什么」的问题都能拆成三段：输入是什么 → 规则怎么作用 → 输出是什么。先定位到「规则」那一段，答案通常就出来了。',
        '',
        '**2. 直接给做法**',
        '',
        '1. 用**最小的例子**验证一次，不要直接套在真实数据或生产环境上。',
        '2. 记录下这次的实际输出，和你的预期逐项对照，差异点就是真正的问题所在。',
        '3. 确认行为符合预期后，再扩大范围、加异常分支。',
        '',
        '**3. 容易踩的坑**',
        '',
        '- **版本差异**：同一件事在不同版本里默认行为经常不同。',
        '- **默认参数 / 隐式转换**：看起来该报错的地方被悄悄处理了。',
        '- **边界输入**：空值、`0`、空字符串、单元素集合，往往是分水岭。',
        '',
        '> 如果你把版本号、具体场景或者一段示例贴出来，我可以给出针对你这台机器/这个版本的写法。'
      ]),
      learn: (function () {
        var short = core.length > 26 ? core.slice(0, 26) : core;
        return {
          original: core,
          intent: '回答：' + short,
          entities: [],
          constraints: ['中文输出'],
          aliases: [
            { text: short + '，能具体讲讲原因和适用条件吗？' },
            { text: '关于「' + short + '」，一般怎么做比较稳妥？' },
            { text: short + '？想要可以直接照做的步骤' },
            { text: 'Please explain 「' + short + '」 in English.', reason: '输出语言改变：中文 → 英语' },
            { text: short + ' 有没有坑？', reason: '任务改变：从「给出做法」变成「列举注意事项」' }
          ]
        };
      })()
    };
  }

  /* ------------------------------- 选模板 ------------------------------- */
  C.choose = function (query, ctx) {
    ctx = ctx || {};
    var q = String(query || '');
    if (ctx.mode === 'compare' && (ctx.candidates || []).length >= 2) return compareAnswer(ctx);
    if (ctx.mode === 'second' && (ctx.candidates || []).length >= 2) return secondPlanAnswer(ctx);
    if (/bool\s*\(\s*\[\s*0\s*\]\s*\)|\[\s*0\s*\]\s*(返回|是|为|真假|布尔)/i.test(q) || (/bool/i.test(q) && /\[0\]/.test(q))) return boolNonEmptyAnswer();
    if (/bool\s*\(\s*\[\s*\]\s*\)|空列表|empty\s+list/i.test(q) && /英语|英文|english/i.test(q)) return boolEnglishAnswer();
    if (/bool\s*\(\s*\[\s*\]\s*\)/i.test(q) || (/空列表|empty\s+list/i.test(q) && /python|bool|布尔/i.test(q))) return boolEmptyAnswer();
    if (/vlookup|iferror|ifna|xlookup|#n\/a/i.test(q)) return xlookupAnswer();
    if (/excel|wps|表格/i.test(q) && /合并|拼|连起来|并成一列/i.test(q)) return excelMergeAnswer();
    if (/装饰器|decorator/i.test(q)) return decoratorAnswer();
    if (/两个方案|两个选项|方案/i.test(q) && /AI|模型|部署|跑/i.test(q) && ctx.mode !== 'compare') {
      return planListAnswer();
    }
    return genericAnswer(q);
  };

  function planListAnswer() {
    return {
      id: 'plan-list',
      text: L([
        '在没有独立显卡、预算有限的前提下，先给你两个能跑起来的方案：',
        '',
        '1. **方案 A：CPU 查库 + 云端兜底**',
        '   - 本机只跑网页、SQLite 问答库和本地语义检索，第一次遇到的复杂问题交给云端强模型。',
        '   - 一台普通笔记本就能起步，对显卡没有要求；已收录的问答是零边际成本。',
        '   - 代价：新问题依赖网络和 API 额度。',
        '',
        '2. **方案 B：RTX 5060 本地跑小模型**',
        '   - 显卡负责量化后的 7B 级模型，意图判断、问法改写和部分简单问题可以完全离线。',
        '   - 一次买断、长期零调用费，断网也能答。',
        '   - 代价：显存决定能跑多大模型，复杂推理明显不如云端。',
        '',
        '> 同样预算下，A 的启动成本接近 0，B 需要一次性投入一块显卡。选哪个取决于你更在意「先跑起来」还是「长期不付 API 账单」。'
      ]),
      candidates: [
        { label: '方案 A：CPU 查库 + 云端兜底', detail: '本机查库 + 云端强模型兜底，零硬件投入' },
        { label: '方案 B：RTX 5060 本地跑小模型', detail: '一次性 2500 元，离线可用，质量受显存限制' }
      ],
      learn: {
        original: '我没有独显，预算也有限。给我两个运行 AI 助手的方案',
        intent: '在无独显、预算有限的条件下给出两种运行 AI 助手的方案',
        entities: ['CPU 查库 + 云端', 'RTX 5060 本地模型'],
        constraints: ['没有独显', '预算有限', '给出两个方案'],
        aliases: [
          { text: '没有独显、预算不多，AI 助手可以怎么部署？' , reason: '未明确要求「两个方案」，答复范围不同' },
          { text: '不买显卡怎么把 AI 助手跑起来，有什么可选方案？' },
          { text: '预算有限的情况下，本机跑 AI 助手有哪些部署方式？' }
        ]
      }
    };
  }

  /* ------------------------------- 流式执行 ------------------------------- */
  C.stream = function (opts) {
    var ans = opts.answer;
    var settings = opts.settings;
    var text = ans.text;
    var firstMs = Math.round(U.rand(620, 1080));
    var cps = 230; // 每秒字符数（仿真）
    var started = Date.now();
    var aborted = false;
    var self = { abort: function () { aborted = true; } };

    var p = new Promise(function (resolve, reject) {
      var i = 0;
      var firstAt = 0;
      setTimeout(function tick() {
        if (aborted) { reject({ aborted: true }); return; }
        if (firstAt === 0) firstAt = Date.now();
        var step = 2 + Math.floor(Math.random() * 4);
        i = Math.min(text.length, i + step);
        if (opts.onToken) opts.onToken(text.slice(0, i), text);
        if (i >= text.length) {
          var totalMs = Date.now() - started;
          var est = C.estimate(opts.inputText || '', text, settings);
          resolve({
            ok: true,
            text: text,
            firstTokenMs: firstAt ? firstAt - started : firstMs,
            totalMs: totalMs,
            tokensIn: est.tokensIn,
            tokensOut: est.tokensOut,
            cost: est.cost,
            replyId: ans.id,
            learn: ans.learn || null,
            candidates: ans.candidates || null
          });
          return;
        }
        setTimeout(tick, 1000 / cps * step);
      }, firstMs);
    });
    self.promise = p;
    return self;
  };

  /* ------------------------------- 改写校验 ------------------------------- */
  C.checkAlias = function (original, text, answer) {
    var t = String(text || '').trim();
    if (!t) return { ok: false, reason: '空改写' };
    if (t.length < 6) return { ok: false, reason: '改写过短，无法独立成立' };
    if (App.matcher.normalize(t) === App.matcher.normalize(original)) return { ok: false, reason: '与原问重复' };

    // 语言
    var enQ = /英语|英文|english/i.test(original);
    var enA = /英语|英文|english/i.test(t);
    if (enQ !== enA) return { ok: false, reason: '输出语言改变：' + (enQ ? '英语 → 中文' : '中文 → 英语') };

    // 代码入参
    var oCode = (original.match(/[a-z_][\w.]*\s*\([^()]*\)/gi) || []).map(function (s) { return s.replace(/\s+/g, ''); });
    var tCode = (t.match(/[a-z_][\w.]*\s*\([^()]*\)/gi) || []).map(function (s) { return s.replace(/\s+/g, ''); });
    if (oCode.length && tCode.length) {
      var oSet = oCode.join('|');
      var mismatch = tCode.filter(function (c) { return oSet.indexOf(c) < 0; });
      if (mismatch.length) return { ok: false, reason: '代码输入改变：`' + oCode[0] + '` → `' + mismatch[0] + '`' };
    }
    if (oCode.length && !tCode.length) {
      // 改写里完全没有代码片段，但仍可能是正常改写
    }

    // 数字
    var oNums = (original.match(/\d+(?:\.\d+)?/g) || []);
    var tNums = (t.match(/\d+(?:\.\d+)?/g) || []);
    var extra = tNums.filter(function (n) { return oNums.indexOf(n) < 0; });
    if (extra.length) return { ok: false, reason: '数值条件改变：出现原问没有的 ' + extra.join(' / ') };

    // 任务改变
    if (/翻译成|翻译为/.test(t) && !/翻译成|翻译为/.test(original)) return { ok: false, reason: '任务改变：从「解释」变成「翻译」' };
    return { ok: true };
  };

  /* ------------------------------- 后台改写任务 ------------------------------- */
  C.planParaphrases = function (learn, count) {
    var list = (learn.aliases || []).slice();
    var out = [];
    list.forEach(function (a) {
      if (a.reason) { out.push({ text: a.text, status: 'rejected', reason: a.reason }); return; }
      var chk = C.checkAlias(learn.original, a.text, '');
      out.push({ text: a.text, status: chk.ok ? 'active' : 'rejected', reason: chk.ok ? '' : chk.reason });
    });
    // 去重
    var seen = {};
    out = out.filter(function (a) {
      var k = App.matcher.normalize(a.text);
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
    if (count && out.length > count) out = out.slice(0, count);
    return out;
  };
})();
