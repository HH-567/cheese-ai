/* ============================================================================
 * qishi.config.js —— 这一个文件就是全部可调项
 * ----------------------------------------------------------------------------
 * 换品牌、换演示账号、关掉声音、改片头文案，都只改这里，不用碰 vendor/ 里的
 * 启动动画运行时（那是 dsh-boot-suite 的 MIT 代码，改了以后不好升级）。
 * ========================================================================== */
window.__QISHI_CFG__ = {
  brand: {
    zh: '柒柿 AI',
    en: 'QISHI',
    org: '柒柿实验室',
    /* 品牌色。片头里它同时管：光标/步骤读数、终幕高光（WELCOME TO 与欢迎语）、
       色散副本的暖色那一路 —— 换成别的颜色整套高光跟着走。 */
    accent: '#ff7500',
    /* 底板左上角第二行；参考片原来是 SYNTHESIZE INTELLIGENCE */
    line2: 'ACCESS CONTROL',
    /* 底板右上角的两个字块，原来是 HARNESS / OS */
    tag: ['ACCESS', 'GATE'],
    welcomeBox: 'QISHI AI',
    /* 终幕标识下面那行字，字母间空格是刻意的（原版对着参考片调的） */
    welcomeLabel: 'Q I S H I  ·  A I',
    /* 片头第 3 幕 logo 下方那行字（原版是 D E E P S E E K） */
    logoLabel: 'Q I S H I',
    footer: 'POWERED BY QISHI'
  },

  /* 片头本身 */
  intro: {
    enabled: true,      /* false = 整页跳过动画，直接进登录卡 */
    theme: 'light',     /* light | dark */
    speed: 1,
    sound: true,        /* 界面音效（点击/打字） */
    voice: true,        /* line-1..6 真人配音 */
    allowSkip: true,    /* 右上角 SKIP / Esc：跳过动画，但登录仍然要做 */
    /* 已登录的人再打开页面，直接进控制台、不重播片头 */
    skipWhenSignedIn: true
  },

  /* 演示账号：只在**第一次运行**（本地库还没建起来）时写入。
     之后改这里不会覆盖已有账号，密码用「登记新身份」或 localStorage 里的记录改。 */
  demo: {
    account: 'qishi',
    password: 'qishi2026',
    display: '柒柿',
    level: '3'
  },

  auth: {
    /* local = 浏览器本地库（默认，演示用）
       http  = 走你自己的后端，见 assets/auth/auth-http.example.js */
    adapter: 'local',
    maxFails: 5,              /* 连续失败几次开始锁定 */
    /* 锁定阶梯：第 5 次失败锁 15s，第 6 次 1min，第 7 次 5min，第 8 次起 15min */
    lockLadder: [15000, 60000, 300000, 900000],
    iterations: 120000,       /* PBKDF2-SHA256 迭代数（有 WebCrypto 时） */
    iterationsFallback: 12000,/* 没有 WebCrypto 时（纯 JS 实现）降档，仍带盐 */
    minPassword: 8
  },

  session: {
    rememberDays: 7,   /* 勾「记住这次核验」的有效期 */
    defaultHours: 12   /* 不勾的有效期（存在 sessionStorage，关标签页即失效） */
  },

  /* 主界面：登录之后看到的那一页 */
  app: {
    title: '访问控制台',
    kicker: 'ACCESS CONSOLE',
    showAudit: true    /* 显示最近核验记录 */
  }
}
