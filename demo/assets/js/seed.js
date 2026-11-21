/* 柒柿AI · 纯前端演示 — 假数据种子（问题组 / 版本 / 表达变体 / 报告 / 修订 / 暂停） */
(function () {
  'use strict';
  var App = window.App;
  var now = Date.now();
  var MIN = 60000, HOUR = 3600000, DAY = 86400000;

  var USERS = {
    'u-a': { id: 'u-a', name: '用户 A', initials: 'A', color: '#b04a24', role: 'admin', verified: true, desc: 'QS-2048 管理员' },
    'u-b': { id: 'u-b', name: '用户 B', initials: 'B', color: '#2b7a5f', role: 'member', verified: true, desc: '共享库成员' },
    'u-c': { id: 'u-c', name: '用户 C', initials: 'C', color: '#325c8b', role: 'member', verified: true, desc: '共享库成员' }
  };

  var LIBRARY = { id: 'QS-2048', name: '柒柿共享库', adminId: 'u-a', createdAt: now - 30 * DAY };

  function lines(arr) { return arr.join('\n'); }
  var vid = 0;
  function version(n, answer, opts) {
    opts = opts || {};
    return {
      id: 'v' + n,
      n: n,
      answer: answer,
      status: opts.status || 'published',
      basis: opts.basis || '云端生成 · deepseek-chat',
      by: opts.by || 'u-a',
      createdAt: opts.at || now,
      factKey: opts.factKey || null
    };
  }
  function variant(versionId, style, text, opts) {
    opts = opts || {};
    return {
      id: 'var_' + (++vid) + '_' + Math.random().toString(36).slice(2, 5),
      versionId: versionId,
      style: style,
      text: text,
      status: 'published',
      by: opts.by || 'u-a',
      at: opts.at || now
    };
  }

  var A_BOOL_STD = lines([
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
  ]);

  var A_EXCEL_STD = lines([
    '把两列文字合并成一列，有两种常用写法：',
    '',
    '**1. 用 `&` 直接拼（所有版本都能用）**',
    '',
    '```excel',
    '=A2 & B2',
    '=A2 & " " & B2',
    '```',
    '',
    '中间加 `" "` 留一个空格，避免「张」和「三」粘成一个词。',
    '',
    '**2. 用 `CONCAT` / `TEXTJOIN`（Excel 2016+ / WPS 新版）**',
    '',
    '```excel',
    '=CONCAT(A2:B2)',
    '=TEXTJOIN("-", TRUE, A2:B2)',
    '```',
    '',
    '`TEXTJOIN` 第一个参数是分隔符，第二个参数 `TRUE` 表示自动跳过空单元格。',
    '',
    '> 写完后选中这一列 → 复制 → 右键「选择性粘贴 → 数值」，否则源列删掉后公式会一起失效。'
  ]);

  var A_EXCEL_V2 = A_EXCEL_STD + lines([
    '',
    '---',
    '',
    '**补充（2026-11 核对）**：WPS 个人版也支持 `TEXTJOIN`，但早期版本对 `ignore_empty` 参数处理有差异，空单元格可能被算进分隔符；升级到 2024 之后的版本，或改用 `=A2 & IF(B2="","", "-" & B2)`。'
  ]);

  var A_MAC_STD = lines([
    '按 **Shift + Command + 4**，然后**按一下空格键**，光标会变成相机图标；把鼠标移到目标窗口上点一下，就只截这个窗口（带圆角和阴影）。',
    '',
    '- 截图默认存到桌面。',
    '- 想直接复制到剪贴板：再加一个 `Control`（Shift + Command + Control + 4 + 空格）。',
    '- 想截菜单栏或触控栏：按 `Shift + Command + 5` 打开截图工具栏，选「截取所选窗口 / 整个屏幕 / 所选部分」。'
  ]);

  var A_FORCE_STD = lines([
    '《民法典》第 180 条把不可抗力定义为「不能预见、不能避免且不能克服的客观情况」。合同审查里常见的情形大致三类：',
    '',
    '1. **自然灾害**：地震、洪水、台风、非人为火灾、疫情及防控措施。',
    '2. **社会异常事件**：战争、动乱、罢工、政府禁令、封锁。',
    '3. **其他不可归责的客观障碍**：关键设备被依法征用、上游因政策停产等。',
    '',
    '实务上有两点容易被忽略：',
    '',
    '- 单纯的市场价格波动、原材料涨价、自身资金链断裂，**通常不构成不可抗力**。',
    '- 条款里最好写清「通知义务 + 证明文件 + 免责范围」：受影响方应在 X 日内书面通知并提供证明，否则不能免责。'
  ]);

  var A_CSV_STD = lines([
    '用 pandas 三行就能搞定：',
    '',
    '```python',
    'import pandas as pd',
    '',
    'df = pd.read_csv("data.csv")',
    'print(df.mean(numeric_only=True))',
    '```',
    '',
    '只想算指定列、或者列里混了文字：',
    '',
    '```python',
    'cols = ["price", "qty"]',
    'print(df[cols].apply(pd.to_numeric, errors="coerce").mean())',
    '```',
    '',
    '不想装 pandas，标准库也能做：',
    '',
    '```python',
    'import csv, statistics',
    '',
    'with open("data.csv", newline="", encoding="utf-8") as f:',
    '    rows = list(csv.DictReader(f))',
    '',
    'for key in rows[0]:',
    '    values = [float(r[key]) for r in rows if r[key].strip()]',
    '    if values:',
    '        print(key, round(statistics.mean(values), 2))',
    '```'
  ]);

  var A_XLOOKUP_STD = lines([
    '把 `#N/A` 换成空白，两种写法：',
    '',
    '```excel',
    '=IFERROR(VLOOKUP(A2, Sheet2!A:B, 2, FALSE), "")',
    '```',
    '',
    '- `IFERROR` 会把**所有**错误都变成空白（包括列号写错），排查时容易掩盖问题。',
    '- 只想处理「找不到」这一种情况，用 `IFNA`：',
    '',
    '```excel',
    '=IFNA(VLOOKUP(A2, Sheet2!A:B, 2, FALSE), "")',
    '```',
    '',
    'Excel 2021 / Microsoft 365 直接上 `XLOOKUP`，它自带「找不到时返回什么」：',
    '',
    '```excel',
    '=XLOOKUP(A2, Sheet2!A:A, Sheet2!B:B, "")',
    '```',
    '',
    '> 返回 `""` 之后单元格是「空文本」而不是真正的空，`COUNTBLANK` 统计不到它。'
  ]);

  var A_REACT_STD = lines([
    '两者解决的是完全不同的问题：',
    '',
    '| | `useEffect` | `useMemo` |',
    '| --- | --- | --- |',
    '| 用途 | 渲染之后做副作用：请求、订阅、操作 DOM | 渲染期间缓存计算结果 |',
    '| 时机 | DOM 更新之后异步执行 | 渲染过程中同步执行 |',
    '| 返回值 | 可选的清理函数 | 被缓存的值 |',
    '| 依赖变化 | 重新执行副作用 | 重新计算 |',
    '',
    '```jsx',
    '// useEffect：和外部系统同步',
    'useEffect(() => {',
    '  const id = setInterval(tick, 1000);',
    '  return () => clearInterval(id);   // 清理',
    '}, []);',
    '',
    '// useMemo：避免每次渲染都重算',
    'const sorted = useMemo(() => heavySort(rows), [rows]);',
    '```',
    '',
    '一句话记法：**`useMemo` 算值，`useEffect` 干活**。只避免重复计算用 `useMemo`；要和 React 之外的世界同步用 `useEffect`。'
  ]);

  var A_BUDGET_STD = lines([
    '5000 元、没有独显，把预算花在这三处最划算：',
    '',
    '1. **CPU 选 8 核以上**：本地语义检索吃单核 + 内存带宽，R7 / i5-13 代这一档够用。',
    '2. **内存 32GB**：7B 量化模型的权重 + KV cache 很容易把 16GB 吃满。',
    '3. **留 1000 元给 SSD**：模型文件和问答库都要空间，1TB NVMe 起步。',
    '',
    '如果「先把东西跑起来」是硬要求，就先走 CPU + 云端兜底；确实需要离线时再补显卡（5060 12G 约 2500，属于追加预算）。'
  ]);

  var A_FIGMA_STD = lines([
    'Figma 团队版（Professional）按年付是 **$15 / 人 / 月**，按月付是 **$20 / 人 / 月**。',
    '',
    '| 方案 | 年付 | 月付 |',
    '| --- | --- | --- |',
    '| Professional | $15 / 人 / 月 | $20 / 人 / 月 |',
    '',
    '> 价格来自 Figma 官方定价页，取数版本 `pricing-2026-10-08`，下次复核时间 2026-11-07。'
  ]);

  /* ------------------------------- 问题组 ------------------------------- */
  var RECORDS = [
    {
      id: 'grp_excel_merge',
      ownerId: 'u-a',
      scope: 'shared',
      original: 'Excel 怎么把两列文字合并成一列？',
      intent: '把 Excel 两列文本合并成一列文本',
      entities: ['Excel', '单元格', '列'],
      constraints: ['Excel 或 WPS', '输出为文本', '保留分隔符'],
      aliases: [
        { text: 'Excel 两列内容怎么拼到一列里？', status: 'active', source: 'generated', at: now - 3 * DAY },
        { text: '怎么把 A 列和 B 列的文字连起来？', status: 'active', source: 'generated', at: now - 3 * DAY },
        { text: '单元格文字合并用什么公式？', status: 'active', source: 'generated', at: now - 3 * DAY }
      ],
      versions: [
        version(1, A_EXCEL_STD, { at: now - 3 * DAY }),
        version(2, A_EXCEL_V2, { at: now - 1 * DAY, basis: '管理员修正 · 用户 B 建议', by: 'u-a', status: 'published' })
      ],
      currentVersionId: 'v2',
      variants: [
        variant('v2', 'brief', '用 `=A2 & B2` 直接拼，需要分隔符就写 `=A2 & " " & B2`；新版可用 `=TEXTJOIN("-", TRUE, A2:B2)`。拼完记得选择性粘贴为数值。'),
        variant('v2', 'detailed', lines([
          '合并两列文字有三种写法，按 Excel 版本选：',
          '',
          '1. **`&` 连接符**：所有版本都能用，`=A2 & " " & B2`；想加固定前缀就写 `="姓名：" & A2`。',
          '2. **`CONCAT`**：Excel 2016+，一次可以传多个区域，但不支持分隔符。',
          '3. **`TEXTJOIN`**：Excel 2016+ / WPS 新版，第一个参数是分隔符，第二个参数 `TRUE` 表示跳过空单元格。',
          '',
          '注意两件事：合并后的列是公式，删源列前要先「选择性粘贴 → 数值」；日期列合并前先用 `TEXT(A2,"yyyy-mm-dd")` 转成文本，否则会变成序列号。'
        ])),
        variant('v2', 'example', lines([
          '```excel',
          '=A2 & B2',
          '=A2 & " " & B2',
          '=TEXTJOIN("-", TRUE, A2:B2)',
          '```',
          '',
          '示例数据：A2=`张`、B2=`三` → 结果依次是 `张三`、`张 三`、`张-三`。'
        ]))
      ],
      freshness: { kind: 'stable', reviewAt: null },
      model: 'deepseek-chat',
      createdAt: now - 3 * DAY,
      updatedAt: now - 1 * DAY,
      status: 'active',
      hits: 14,
      reports: 0
    },
    {
      id: 'grp_mac_shot',
      ownerId: 'u-a',
      scope: 'shared',
      original: 'Mac 上怎么只截取某个窗口？',
      intent: '在 macOS 上只截取指定窗口',
      entities: ['macOS', '截图', '窗口'],
      constraints: ['macOS', '只要窗口区域'],
      aliases: [
        { text: 'Mac 怎么只截一个窗口？', status: 'active', source: 'generated', at: now - 2 * DAY },
        { text: 'macOS 截图只截窗口的快捷键是什么？', status: 'active', source: 'generated', at: now - 2 * DAY }
      ],
      versions: [version(1, A_MAC_STD, { at: now - 2 * DAY })],
      currentVersionId: 'v1',
      variants: [
        variant('v1', 'brief', 'Shift + Command + 4，再按一下空格，点目标窗口即可；同时按住 Control 会直接复制到剪贴板。')
      ],
      freshness: { kind: 'stable', reviewAt: null },
      model: 'deepseek-chat',
      createdAt: now - 2 * DAY,
      updatedAt: now - 2 * DAY,
      status: 'active',
      hits: 9,
      reports: 0
    },
    {
      id: 'grp_force_majeure',
      ownerId: 'u-a',
      scope: 'shared',
      original: '合同里的「不可抗力」条款一般包括哪些情形？',
      intent: '列举合同中不可抗力条款的常见情形与实务要点',
      entities: ['合同', '不可抗力', '免责条款'],
      constraints: ['中国大陆法律语境', '列举情形', '中文输出'],
      aliases: [
        { text: '合同里不可抗力包括哪些情况？', status: 'active', source: 'generated', at: now - 6 * DAY },
        { text: '不可抗力条款一般写什么情形？', status: 'active', source: 'generated', at: now - 6 * DAY }
      ],
      versions: [version(1, A_FORCE_STD, { at: now - 6 * DAY })],
      currentVersionId: 'v1',
      variants: [],
      freshness: { kind: 'stable', reviewAt: null },
      model: 'deepseek-chat',
      createdAt: now - 6 * DAY,
      updatedAt: now - 6 * DAY,
      status: 'active',
      hits: 6,
      reports: 2
    },
    {
      id: 'grp_py_csv',
      ownerId: 'u-a',
      scope: 'shared',
      original: '怎么用 Python 读取 CSV 并计算每列的均值？',
      intent: '用 Python 读取 CSV 文件并计算各数值列的均值',
      entities: ['Python', 'CSV', '均值'],
      constraints: ['Python 3', 'CSV 输入', '给出可运行代码'],
      aliases: [
        { text: 'Python 怎么读 CSV 并算每列平均值？', status: 'active', source: 'generated', at: now - 4 * DAY },
        { text: '用 pandas 计算 CSV 每列的平均数怎么写？', status: 'active', source: 'generated', at: now - 4 * DAY }
      ],
      versions: [version(1, A_CSV_STD, { at: now - 4 * DAY })],
      currentVersionId: 'v1',
      variants: [
        variant('v1', 'brief', '`pd.read_csv("data.csv").mean(numeric_only=True)` 一行就够了；列里混了文字就先 `apply(pd.to_numeric, errors="coerce")`。')
      ],
      freshness: { kind: 'stable', reviewAt: null },
      model: 'deepseek-chat',
      createdAt: now - 4 * DAY,
      updatedAt: now - 4 * DAY,
      status: 'active',
      hits: 11,
      reports: 0
    },
    {
      id: 'grp_xlookup',
      ownerId: 'u-a',
      scope: 'shared',
      original: 'VLOOKUP 查不到结果时怎么返回空白而不是 #N/A？',
      intent: '让 Excel 查找函数在未命中时返回空白而非 #N/A',
      entities: ['Excel', 'VLOOKUP', 'IFERROR', 'XLOOKUP'],
      constraints: ['Excel 公式', '未命中返回空白'],
      aliases: [
        { text: 'VLOOKUP 找不到时返回空白怎么写？', status: 'active', source: 'generated', at: now - 8 * DAY },
        { text: '怎么把 VLOOKUP 的 #N/A 变成空单元格？', status: 'active', source: 'generated', at: now - 8 * DAY }
      ],
      versions: [version(1, A_XLOOKUP_STD, { at: now - 8 * DAY })],
      currentVersionId: 'v1',
      variants: [
        variant('v1', 'brief', '用 `=IFNA(VLOOKUP(A2, Sheet2!A:B, 2, FALSE), "")`；想一把抓所有错误就用 `IFERROR`，Excel 2021+ 直接用 `XLOOKUP` 的第四个参数。')
      ],
      freshness: { kind: 'stable', reviewAt: null },
      model: 'deepseek-chat',
      createdAt: now - 8 * DAY,
      updatedAt: now - 3 * DAY,
      status: 'active',
      hits: 5,
      reports: 3
    },
    {
      id: 'grp_react_hooks',
      ownerId: 'u-a',
      scope: 'personal',
      original: 'React 的 useEffect 和 useMemo 有什么区别？',
      intent: '对比 React 中 useEffect 与 useMemo 的用途和触发时机',
      entities: ['React', 'useEffect', 'useMemo'],
      constraints: ['React 18', '中文输出', '对比说明'],
      aliases: [
        { text: 'useEffect 和 useMemo 的区别是什么？', status: 'active', source: 'generated', at: now - 1 * DAY },
        { text: 'useMemo 是干嘛的，和 useEffect 怎么区分？', status: 'active', source: 'generated', at: now - 1 * DAY }
      ],
      versions: [version(1, A_REACT_STD, { at: now - 1 * DAY })],
      currentVersionId: 'v1',
      variants: [
        variant('v1', 'brief', '`useMemo` 算值（渲染期缓存结果），`useEffect` 干活（渲染后和外部系统同步）。')
      ],
      freshness: { kind: 'stable', reviewAt: null },
      model: 'deepseek-chat',
      createdAt: now - 1 * DAY,
      updatedAt: now - 1 * DAY,
      status: 'active',
      hits: 3,
      reports: 0
    },
    {
      id: 'grp_budget_rig',
      ownerId: 'u-a',
      scope: 'personal',
      original: '预算 5000 元、没有独显，怎么搭一台能跑 AI 助手的机器？',
      intent: '在 5000 元、无独显约束下给出本地跑 AI 助手的装机建议',
      entities: ['装机', '预算 5000 元', '无独显'],
      constraints: ['预算 5000 元', '无独立显卡', '跑本地 AI 助手'],
      aliases: [
        { text: '5000 元预算不带独显，怎么配一台跑 AI 的电脑？', status: 'active', source: 'generated', at: now - 2 * DAY }
      ],
      versions: [version(1, A_BUDGET_STD, { at: now - 2 * DAY })],
      currentVersionId: 'v1',
      variants: [],
      freshness: { kind: 'stable', reviewAt: null },
      model: 'deepseek-chat',
      createdAt: now - 2 * DAY,
      updatedAt: now - 2 * DAY,
      status: 'active',
      hits: 1,
      reports: 0
    },
    {
      id: 'grp_figma_price',
      ownerId: 'u-a',
      scope: 'shared',
      original: 'Figma 团队版现在多少钱一个人每月？',
      intent: '查询 Figma 团队版的当前订阅价格',
      entities: ['Figma', 'Professional', '价格'],
      constraints: ['按人按月计价', '当前价格'],
      aliases: [
        { text: 'Figma 团队版价格是多少？', status: 'active', source: 'generated', at: now - 43 * DAY },
        { text: 'Figma 团队版多少钱一个月？', status: 'active', source: 'generated', at: now - 43 * DAY },
        { text: 'Figma Professional 多少钱一个月？', status: 'active', source: 'generated', at: now - 43 * DAY }
      ],
      versions: [version(1, A_FIGMA_STD, { at: now - 43 * DAY, factKey: 'pricing-2026-10-08' })],
      currentVersionId: 'v1',
      variants: [],
      freshness: {
        kind: 'versioned',
        source: 'Figma 官方定价页',
        sourceVersion: 'pricing-2026-10-08',
        lastCheckedAt: now - 43 * DAY,
        reviewAt: now - 13 * DAY,
        reviewIntervalDays: 30
      },
      model: 'deepseek-chat',
      createdAt: now - 43 * DAY,
      updatedAt: now - 43 * DAY,
      status: 'active',
      hits: 4,
      reports: 0
    },
    {
      id: 'grp_tool_date',
      ownerId: 'u-a',
      scope: 'shared',
      original: '今天星期几？',
      intent: '按用户时区读取系统时钟，给出当天日期与星期',
      entities: ['日期', '星期', '时区'],
      constraints: ['用户时区', '每次实时计算'],
      aliases: [
        { text: '今天是周几？', status: 'active', source: 'generated', at: now - 9 * DAY },
        { text: '今天几号？', status: 'active', source: 'generated', at: now - 9 * DAY }
      ],
      versions: [],
      currentVersionId: null,
      variants: [],
      routeTool: 'date',
      freshness: { kind: 'tool', reviewAt: null },
      model: '—（本地工具）',
      createdAt: now - 9 * DAY,
      updatedAt: now - 9 * DAY,
      status: 'active',
      hits: 18,
      reports: 0
    },
    {
      id: 'grp_tool_calc',
      ownerId: 'u-a',
      scope: 'shared',
      original: '37 × 48 等于多少？',
      intent: '用本地计算器求解简单算术，不调用云端',
      entities: ['算术', '计算器'],
      constraints: ['只含四则运算与括号'],
      aliases: [
        { text: '37*48 等于多少', status: 'active', source: 'generated', at: now - 9 * DAY }
      ],
      versions: [],
      currentVersionId: null,
      variants: [],
      routeTool: 'calc',
      freshness: { kind: 'tool', reviewAt: null },
      model: '—（本地工具）',
      createdAt: now - 9 * DAY,
      updatedAt: now - 9 * DAY,
      status: 'active',
      hits: 7,
      reports: 0
    }
  ];

  /* ------------------------------- 报告 / 修订 / 暂停 ------------------------------- */
  var XLOOKUP_ALIAS = '怎么把 VLOOKUP 的 #N/A 变成空单元格？';
  var XLOOKUP_KEY = 'g:grp_xlookup:m:' + App.util.key(XLOOKUP_ALIAS);

  var REPORTS = [
    {
      id: 'rp_1', at: now - 2 * DAY - 2 * HOUR, byUserId: 'u-b', groupId: 'grp_xlookup',
      targetKey: XLOOKUP_KEY, type: 'match', versionId: 'v1', aliasText: XLOOKUP_ALIAS,
      category: 'mismatch', note: '我要的是「把 #N/A 变成空字符串」，不是空单元格', status: 'resolved',
      resolution: 'suspended', handledBy: 'u-a', handledAt: now - 2 * DAY + 2 * HOUR
    },
    {
      id: 'rp_2', at: now - 2 * DAY - 1 * HOUR, byUserId: 'u-c', groupId: 'grp_xlookup',
      targetKey: XLOOKUP_KEY, type: 'match', versionId: 'v1', aliasText: XLOOKUP_ALIAS,
      category: 'mismatch', note: '结论和我的场景不一致', status: 'resolved', resolution: 'suspended', handledBy: 'u-a', handledAt: now - 2 * DAY + 2 * HOUR
    },
    {
      id: 'rp_3', at: now - 2 * DAY, byUserId: 'u-a', groupId: 'grp_xlookup',
      targetKey: XLOOKUP_KEY, type: 'match', versionId: 'v1', aliasText: XLOOKUP_ALIAS,
      category: 'mismatch', note: '这条匹配会把 #N/A 和空文本混为一谈', status: 'resolved',
      resolution: 'suspended', handledBy: 'u-a', handledAt: now - 2 * DAY + 2 * HOUR
    },
    {
      id: 'rp_4', at: now - 6 * HOUR, byUserId: 'u-b', groupId: 'grp_force_majeure',
      targetKey: 'g:grp_force_majeure:v:v1', type: 'version', versionId: 'v1', aliasText: null,
      category: 'style', note: '太长了，想要一句话版本', status: 'resolved', resolution: 'style'
    },
    {
      id: 'rp_5', at: now - 3 * HOUR, byUserId: 'u-c', groupId: 'grp_force_majeure',
      targetKey: 'g:grp_force_majeure:v:v1', type: 'version', versionId: 'v1', aliasText: null,
      category: 'fact', note: '第 180 条的表述好像更新过', status: 'open', resolution: null
    }
  ];

  var SUSPENSIONS = [
    {
      id: 'sp_1', groupId: 'grp_xlookup', kind: 'match', matchKey: App.util.key(XLOOKUP_ALIAS),
      aliasText: XLOOKUP_ALIAS, versionId: 'v1', status: 'active',
      since: now - 2 * DAY, by: 'system',
      reason: '7 天窗口内 3 名已验证成员报告同一匹配关系',
      reportIds: ['rp_1', 'rp_2', 'rp_3'], rounds: 1
    }
  ];

  var REVISIONS = [
    {
      id: 'rv_1', groupId: 'grp_py_csv', baseVersionId: 'v1',
      proposedAnswer: A_CSV_STD + lines([
        '',
        '---',
        '',
        '**补充（用户 B 建议）**：pandas 2.x 里 `DataFrame.mean` 的 `numeric_only` 默认值是 `False`，非数值列会直接报 `TypeError`，显式传 `numeric_only=True` 更稳。'
      ]),
      note: 'pandas 2.x 变更，官方文档 Migration Guide', byUserId: 'u-b', at: now - 1 * DAY,
      status: 'pending', handledBy: null, handledAt: null
    }
  ];

  /* ------------------------------- 会话种子 ------------------------------- */
  var byId = {};
  RECORDS.forEach(function (r) { byId[r.id] = r; });

  function st(key, label, state, detail) { return { key: key, label: label, state: state, detail: detail }; }

  function botMeta(opts) {
    return {
      source: opts.source,
      groupId: opts.groupId || null,
      versionId: opts.versionId || null,
      variantId: opts.variantId || null,
      matchedAlias: opts.matchedAlias || null,
      matchType: opts.matchType || 'none',
      score: opts.score || 0,
      usage: opts.usage || { cloudCalls: 0, firstTokenMs: 0, totalMs: 10, cost: 0, tokensIn: 0, tokensOut: 0 },
      trace: opts.trace || null,
      status: 'done',
      at: opts.at || now
    };
  }

  function traceOf(steps, usage, extra) {
    return Object.assign({
      id: 'tr_' + Math.random().toString(36).slice(2, 8),
      at: extra && extra.at || now,
      query: extra && extra.query || '',
      steps: steps,
      candidates: extra && extra.candidates || [],
      decision: extra && extra.decision || 'reuse',
      resolved: null,
      recordId: extra && extra.groupId || null,
      model: 'deepseek-chat',
      threshold: 0.7,
      usage: usage,
      error: null
    }, extra || {});
  }

  function msg(role, content, at, meta) {
    return {
      id: 'm_' + Math.random().toString(36).slice(2, 9),
      role: role,
      content: content,
      at: at,
      meta: meta || null
    };
  }

  var U1 = { cloudCalls: 0, firstTokenMs: 0, totalMs: 12, cost: 0, tokensIn: 0, tokensOut: 0 };

  var SESSIONS = [
    {
      id: 'ses_a_excel',
      ownerId: 'u-a',
      title: 'Excel 两列合并成一列',
      scope: 'shared',
      createdAt: now - 2 * DAY - 40 * MIN,
      updatedAt: now - 2 * DAY - 30 * MIN,
      messages: [
        msg('user', 'Excel 两列内容怎么拼到一列里？', now - 2 * DAY - 40 * MIN),
        msg('assistant', byId.grp_excel_merge.versions[1].answer, now - 2 * DAY - 39 * MIN, botMeta({
          source: 'library', groupId: 'grp_excel_merge', versionId: 'v2', matchType: 'alias',
          matchedAlias: 'Excel 两列内容怎么拼到一列里？', score: 0.99, usage: U1,
          trace: traceOf([
            st('refs', '指代补全', 'skip', '未检测到「这两个 / 第二个 / 那…呢」等指代'),
            st('memory', '会话记忆', 'skip', '新会话，无历史上下文'),
            st('tool', '本地工具', 'skip', '不是日期或算术请求'),
            st('exact', '精确匹配', 'ok', '在 8 条可见记录中比对原问 · 0 条'),
            st('alias', '等价问法', 'ok', '命中已收录改写「Excel 两列内容怎么拼到一列里？」· 0.99'),
            st('semantic', '语义检索', 'skip', '精确命中，跳过向量召回'),
            st('verify', '条件校验', 'ok', '对象 / 数值 / 语言 / 否定 一致'),
            st('pause', '暂停检查', 'skip', '目标版本与匹配关系均正常'),
            st('answer', '返回答案', 'ok', '读取 v2 版本的标准表达 · 12 ms · 0 次云端调用')
          ], U1, { decision: 'reuse', groupId: 'grp_excel_merge' })
        }))
      ]
    },
    {
      id: 'ses_a_react',
      ownerId: 'u-a',
      title: 'React Hooks 对比',
      scope: 'personal',
      createdAt: now - 1 * DAY - 3 * HOUR,
      updatedAt: now - 1 * DAY - 2 * HOUR,
      messages: [
        msg('user', 'useMemo 是干嘛的，和 useEffect 怎么区分？', now - 1 * DAY - 3 * HOUR),
        msg('assistant', A_REACT_STD, now - 1 * DAY - 3 * HOUR + 2600, botMeta({
          source: 'library', groupId: 'grp_react_hooks', versionId: 'v1', matchType: 'alias',
          matchedAlias: 'useMemo 是干嘛的，和 useEffect 怎么区分？', score: 0.97, usage: { cloudCalls: 0, firstTokenMs: 0, totalMs: 9, cost: 0 },
          trace: traceOf([
            st('refs', '指代补全', 'skip', '未检测到指代'),
            st('memory', '会话记忆', 'skip', '新会话，无历史上下文'),
            st('tool', '本地工具', 'skip', '不是日期或算术请求'),
            st('exact', '精确匹配', 'ok', '在个人库 + 共享库中比对 · 0 条'),
            st('alias', '等价问法', 'ok', '命中已收录改写 · 0.97'),
            st('verify', '条件校验', 'ok', '对象一致，未发现冲突'),
            st('pause', '暂停检查', 'skip', '目标版本与匹配关系均正常'),
            st('answer', '返回答案', 'ok', '读取 v1 版本的默认表达 · 9 ms · 0 次云端调用')
          ], { cloudCalls: 0, firstTokenMs: 0, totalMs: 9, cost: 0 }, { decision: 'reuse', groupId: 'grp_react_hooks' })
        })),
        msg('user', '那 useMemo 什么时候不该用？', now - 1 * DAY - 2 * HOUR),
        msg('assistant', lines([
          '`useMemo` 不是越多越好，这几种情况用了反而更糟：',
          '',
          '1. **计算本身很便宜**：一次 `map` / `filter` 的耗时还不如 `useMemo` 自己比依赖数组。',
          '2. **依赖每次渲染都变**：比如依赖一个对象字面量 `{ id }`，每帧都是新引用，缓存永远失效。',
          '3. **为了消除「引用变化」而套 `useMemo`**：这通常说明该用 `useCallback`，或者把状态提升、拆组件。',
          '',
          '> 官方文档的原话是：`useMemo` 是性能优化手段，不是语义保证。React 有权在必要时丢弃缓存，所以别把**正确性**建立在它上面。',
          '',
          '判断标准只有一条：**先测量，再优化**。React DevTools 的 Profiler 里看到某个组件重复渲染且计算确实重，再上 `useMemo`。'
        ]), now - 1 * DAY - 2 * HOUR + 3200, botMeta({
          source: 'cloud', matchType: 'none',
          usage: { cloudCalls: 1, firstTokenMs: 820, totalMs: 6100, cost: 0.0031, tokensIn: 640, tokensOut: 420 },
          trace: traceOf([
            st('refs', '指代补全', 'ok', '检测到「那…呢」延续上文，沿用上文对象「useMemo」'),
            st('memory', '会话记忆', 'ok', '载入最近 3 轮 · 用户条件：React 18、中文'),
            st('tool', '本地工具', 'skip', '不是日期或算术请求'),
            st('exact', '精确匹配', 'ok', '0 条'),
            st('alias', '等价问法', 'ok', '0 条'),
            st('semantic', '语义检索', 'ok', '召回 2 条候选，最高 0.71（低于门槛 0.70 之上但条件不符）'),
            st('verify', '条件校验', 'ok', '候选与问题范围不同，不复用'),
            st('pause', '暂停检查', 'skip', '无命中目标'),
            st('cloud', '云端生成', 'ok', 'deepseek-chat · 首字 0.82 s · 总耗时 6.10 s'),
            st('learn', '后台学习', 'ok', '生成 4 条等价问法 · 通过 3 · 拒收 1')
          ], { cloudCalls: 1, firstTokenMs: 820, totalMs: 6100, cost: 0.0031, tokensIn: 640, tokensOut: 420 }, { decision: 'cloud' })
        }))
      ]
    },
    {
      id: 'ses_b_mac',
      ownerId: 'u-b',
      title: 'Mac 只截窗口',
      scope: 'shared',
      createdAt: now - 5 * HOUR,
      updatedAt: now - 5 * HOUR + 2 * MIN,
      messages: [
        msg('user', 'Mac 怎么只截一个窗口？', now - 5 * HOUR),
        msg('assistant', A_MAC_STD, now - 5 * HOUR + 1800, botMeta({
          source: 'library', groupId: 'grp_mac_shot', versionId: 'v1', matchType: 'alias',
          matchedAlias: 'Mac 怎么只截一个窗口？', score: 1,
          usage: { cloudCalls: 0, firstTokenMs: 0, totalMs: 11, cost: 0 },
          trace: traceOf([
            st('refs', '指代补全', 'skip', '未检测到指代'),
            st('memory', '会话记忆', 'skip', '新会话，无历史上下文'),
            st('tool', '本地工具', 'skip', '不是日期或算术请求'),
            st('exact', '精确匹配', 'ok', '0 条'),
            st('alias', '等价问法', 'ok', '命中已收录改写 · 1.00（来自用户 A 贡献的共享记录）'),
            st('verify', '条件校验', 'ok', '对象 / 平台 / 语言一致'),
            st('pause', '暂停检查', 'skip', '目标版本与匹配关系均正常'),
            st('answer', '返回答案', 'ok', '读取 v1 版本的默认表达 · 11 ms · 0 次云端调用')
          ], { cloudCalls: 0, firstTokenMs: 0, totalMs: 11, cost: 0 }, { decision: 'reuse', groupId: 'grp_mac_shot' })
        }))
      ]
    },
    {
      id: 'ses_c_tool',
      ownerId: 'u-c',
      title: '今天星期几',
      scope: 'shared',
      createdAt: now - 26 * HOUR,
      updatedAt: now - 26 * HOUR,
      messages: [
        msg('user', '今天星期几？', now - 26 * HOUR),
        msg('assistant', '按本地工具计算的回答（每次提问都会重新读时钟）。', now - 26 * HOUR, botMeta({
          source: 'tool', matchType: 'tool',
          usage: { cloudCalls: 0, firstTokenMs: 0, totalMs: 1, cost: 0 },
          trace: traceOf([
            st('refs', '指代补全', 'skip', '未检测到指代'),
            st('memory', '会话记忆', 'skip', '新会话，无历史上下文'),
            st('tool', '本地工具', 'ok', '识别为日期 / 星期请求 · 按 Asia/Shanghai 读取系统时钟'),
            st('answer', '本地计算', 'ok', '结果写入会话 · 1 ms · 0 次云端调用')
          ], { cloudCalls: 0, firstTokenMs: 0, totalMs: 1, cost: 0 }, { decision: 'tool' })
        }))
      ]
    }
  ];

  /* ------------------------------- 用量日志 ------------------------------- */
  function usageRow(at, ownerId, query, path, opts) {
    opts = opts || {};
    return {
      id: 'u_' + Math.random().toString(36).slice(2, 9),
      at: at,
      ownerId: ownerId,
      sessionId: opts.sessionId || null,
      query: query,
      path: path,
      cloudCalls: opts.cloudCalls || 0,
      firstTokenMs: opts.firstTokenMs || 0,
      totalMs: opts.totalMs || 0,
      cost: opts.cost || 0,
      tokensIn: opts.tokensIn || 0,
      tokensOut: opts.tokensOut || 0,
      ok: opts.ok !== false,
      reported: !!opts.reported
    };
  }

  var USAGE = [
    usageRow(now - 5 * HOUR, 'u-b', 'Mac 怎么只截一个窗口？', 'alias', { sessionId: 'ses_b_mac', totalMs: 11 }),
    usageRow(now - 1 * DAY - 3 * HOUR, 'u-a', 'useMemo 是干嘛的，和 useEffect 怎么区分？', 'alias', { sessionId: 'ses_a_react', totalMs: 9 }),
    usageRow(now - 1 * DAY - 2 * HOUR, 'u-a', '那 useMemo 什么时候不该用？', 'cloud', { sessionId: 'ses_a_react', cloudCalls: 1, firstTokenMs: 820, totalMs: 6100, cost: 0.0031, tokensIn: 640, tokensOut: 420 }),
    usageRow(now - 26 * HOUR, 'u-c', '今天星期几？', 'tool', { sessionId: 'ses_c_tool', totalMs: 1 }),
    usageRow(now - 2 * DAY - 40 * MIN, 'u-a', 'Excel 两列内容怎么拼到一列里？', 'alias', { sessionId: 'ses_a_excel', totalMs: 12 }),
    usageRow(now - 3 * DAY - 2 * HOUR, 'u-a', '怎么把 A 列和 B 列的文字连起来？', 'alias', { totalMs: 10 }),
    usageRow(now - 3 * DAY - 6 * HOUR, 'u-b', '单元格文字合并用什么公式？', 'alias', { totalMs: 13 }),
    usageRow(now - 4 * DAY - 1 * HOUR, 'u-b', 'Mac 截屏怎么只截窗口部分？', 'semantic', { totalMs: 42 }),
    usageRow(now - 5 * DAY, 'u-a', '解释一下 Python 的装饰器是怎么工作的', 'cloud', { cloudCalls: 1, firstTokenMs: 910, totalMs: 7200, cost: 0.0038, tokensIn: 520, tokensOut: 480 }),
    usageRow(now - 5 * DAY + 30000, 'u-a', '后台改写：解释一下 Python 的装饰器是怎么工作的', 'learn', { cloudCalls: 1, totalMs: 2100, cost: 0.0012, tokensIn: 980, tokensOut: 260 }),
    usageRow(now - 6 * DAY - 3 * HOUR, 'u-a', '合同里不可抗力包括哪些情况？', 'exact', { totalMs: 8 }),
    usageRow(now - 7 * DAY, 'u-b', '使用 pandas 计算 CSV 每列的平均数怎么写？', 'semantic', { totalMs: 38 }),
    usageRow(now - 2 * DAY - 30 * MIN, 'u-a', '发布修订：VLOOKUP 查不到结果时怎么返回空白而不是 #N/A？', 'revision', { cloudCalls: 0, totalMs: 0, cost: 0 }),
    usageRow(now - 2 * DAY - 6 * HOUR, 'u-c', '怎么把 VLOOKUP 的 #N/A 变成空单元格？', 'cloud', { cloudCalls: 1, firstTokenMs: 880, totalMs: 5200, cost: 0.0029, tokensIn: 610, tokensOut: 380 })
  ];

  var SETTINGS = {
    model: 'deepseek-chat',
    modelOptions: [
      { id: 'deepseek-chat', label: 'deepseek-chat', note: '演示默认 · 强模型 · 按 token 计费' },
      { id: 'qwen-max', label: 'qwen-max', note: '中文长文更强，单价略高' },
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini', note: '便宜，适合后台改写' }
    ],
    threshold: 0.70,
    autoLearn: true,
    cloudOnline: true,
    defaultScope: 'shared',
    expiryDays: 30,
    paraphraseCount: 5,
    maxContextTurns: 3,
    priceIn: 1.0,
    priceOut: 4.0,
    timeZone: 'Asia/Shanghai',
    timeZoneOptions: [
      { id: 'Asia/Shanghai', label: 'Asia/Shanghai（UTC+08:00）' },
      { id: 'Asia/Tokyo', label: 'Asia/Tokyo（UTC+09:00）' },
      { id: 'Europe/London', label: 'Europe/London' },
      { id: 'America/New_York', label: 'America/New_York' },
      { id: 'UTC', label: 'UTC' }
    ],
    pauseThreshold: 3,
    pauseWindowDays: 7
  };

  var STARTERS = [
    { text: 'Python 3 的 `bool([])` 返回什么？为什么？', tag: '学习' },
    { text: 'Excel 怎么把两列文字合并成一列？', tag: '办公' },
    { text: '今天星期几？', tag: '本地工具' },
    { text: '解释一下 Python 的装饰器是怎么工作的', tag: '学习' },
    { text: '37 × 48 等于多少？', tag: '本地工具' },
    { text: '我没有独显，预算也有限。给我两个运行 AI 助手的方案', tag: '决策' }
  ];

  App.seed = {
    users: USERS,
    library: LIBRARY,
    records: RECORDS,
    reports: REPORTS,
    suspensions: SUSPENSIONS,
    revisions: REVISIONS,
    sessions: SESSIONS,
    usage: USAGE,
    settings: SETTINGS,
    starters: STARTERS,
    newSessionId: 'ses_a_new'
  };
})();
