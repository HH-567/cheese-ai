/* ============================================================================
 * qishi-app.js —— 登录之后的那一页（以及跳过片头时的登录卡）
 * ----------------------------------------------------------------------------
 * 只有两个状态：
 *   console —— 核验通过：身份档案 / 本次会话 / 最近核验记录 / 退出
 *   login   —— 没通过（或刚退出）：纸面上一张独立登录卡
 * 片头在播的时候这里不画东西，等 dsh-startup:done 再决定画哪个。
 * ========================================================================== */
(function (global) {
  'use strict'

  var CFG = global.__QISHI_CFG__ || {}
  var HOST = document.getElementById('qishi-app')
  var rendered = false
  var pageForm = null
  var pollTimer = null

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  /** 品牌标识（矢量，跟片头那份是同一张图，见 assets/icon/） */
  function mark(size) {
    var img = document.createElement('img')
    img.src = 'assets/icon/qishi-icon.svg'
    img.alt = ''
    img.className = 'qa-mark'
    img.width = size || 20
    img.height = size || 20
    return img
  }

  function ts(t) {    if (!t) return '—'
    var d = new Date(t)
    var p = function (n) { return (n < 10 ? '0' : '') + n }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
  }

  function clearLine() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  }

  function teardown() {
    if (pageForm) { pageForm.destroy(); pageForm = null }
    HOST.innerHTML = ''
    HOST.className = 'qa-root'
  }

  /* ══ 独立登录卡（跳过片头 / 退出登录之后）════════════════════════════ */
  function renderLogin(notice) {
    clearLine()
    teardown()
    rendered = true
    global.__QISHI_USER__ = null

    HOST.className = 'qa-root qa-root--login'
    var shell = el('div', 'qa-login')
    var brand = el('div', 'qa-login-brand')
    brand.appendChild(mark(26))
    brand.appendChild(el('div', 'qa-brand-mark', CFG.brand && CFG.brand.en || 'QISHI'))
    brand.appendChild(el('div', 'qa-brand-sub', CFG.brand && CFG.brand.line2 || 'ACCESS CONTROL'))
    shell.appendChild(brand)

    var plate = el('div', 'qa-login-plate')
    var head = el('div', 'qa-login-head')
    head.appendChild(el('div', 'qa-eyebrow', 'IDENTITY VERIFICATION'))
    head.appendChild(el('h1', null, '身份核验'))
    head.appendChild(el('p', null, notice
      ? '本次核验已注销。重新核验身份后继续。'
      : '片头被跳过了，但门还在。请核验身份后进入访问控制台。'))
    plate.appendChild(head)

    if (notice) plate.appendChild(el('p', 'qa-notice', notice))

    pageForm = global.QishiLoginForm.create({
      variant: 'page',
      submitLabel: '进入控制台',
      onSuccess: function (user) { renderConsole(user, { fresh: true }) }
    })
    plate.appendChild(pageForm.el)
    shell.appendChild(plate)

    var foot = el('div', 'qa-login-foot')
    foot.appendChild(el('span', null, (CFG.brand && CFG.brand.org) || ''))
    foot.appendChild(el('span', null, '本地演示库 · 未接后端'))
    shell.appendChild(foot)

    HOST.appendChild(shell)
    pageForm.focus()
  }

  /* ══ 控制台 ═══════════════════════════════════════════════════════════ */
  function renderConsole(user, opts) {
    opts = opts || {}
    clearLine()
    teardown()
    rendered = true
    global.__QISHI_USER__ = user
    HOST.className = 'qa-root qa-root--console'

    var app = CFG.app || {}

    /* 顶栏 */
    var top = el('header', 'qa-top')
    var brandBox = el('div', 'qa-top-brand')
    brandBox.appendChild(mark(20))
    brandBox.appendChild(el('b', null, (CFG.brand && CFG.brand.en) || 'QISHI'))
    brandBox.appendChild(el('span', null, (CFG.brand && CFG.brand.zh) || ''))
    top.appendChild(brandBox)
    top.appendChild(el('div', 'qa-top-kicker', app.kicker || ''))

    var actions = el('div', 'qa-top-actions')
    var chip = el('div', 'qa-chip')
    chip.appendChild(el('b', null, user.display))
    chip.appendChild(el('span', null, '权限 ' + user.level + ' · #' + user.serial))
    actions.appendChild(chip)

    var replay = el('button', 'qa-btn', '重播开场')
    replay.type = 'button'
    replay.addEventListener('click', function () {
      var api = global.__DSH_STARTUP_API__
      if (api && api.replay) {
        try { api.replay() } catch (e) { /* 没片头就安静 */ }
      }
    })
    actions.appendChild(replay)

    var out = el('button', 'qa-btn qa-btn--ghost', '退出登录')
    out.type = 'button'
    out.addEventListener('click', function () {
      out.disabled = true
      global.QishiAuth.logout().then(function () {
        renderLogin('本次核验已注销')
      })
    })
    actions.appendChild(out)
    top.appendChild(actions)
    HOST.appendChild(top)

    /* 主体 */
    var main = el('main', 'qa-main')

    var hero = el('section', 'qa-hero')
    hero.appendChild(el('p', 'qa-eyebrow', opts.fresh ? 'SESSION ESTABLISHED' : 'SESSION RESTORED'))
    hero.appendChild(el('h1', null, '欢迎回来，' + user.display))
    hero.appendChild(el('p', 'qa-sub',
      '这次核验发生在 ' + ts(user.lastLoginAt) + '，会话由本机账号库签发。' +
      '下面的档案和记录都来自同一个库，改账号 = 换这里的每一个字。'))
    main.appendChild(hero)

    var grid = el('section', 'qa-grid')

    /* 身份档案 */
    var cardId = el('article', 'qa-card')
    cardId.appendChild(el('h2', null, '身份档案'))
    var dl = el('dl', 'qa-dl')
    ;[
      ['身份名称', user.display],
      ['账号', user.account],
      ['身份编号', '#' + user.serial],
      ['权限等级', user.level],
      ['登记时间', ts(user.createdAt)]
    ].forEach(function (r) {
      var row = el('div', 'qa-dl-row')
      row.appendChild(el('dt', null, r[0]))
      row.appendChild(el('dd', null, r[1]))
      dl.appendChild(row)
    })
    cardId.appendChild(dl)
    grid.appendChild(cardId)

    /* 本次会话 */
    var cardSess = el('article', 'qa-card')
    cardSess.appendChild(el('h2', null, '本次会话'))
    var sl = el('dl', 'qa-dl')
    ;[
      ['建立时间', ts(user.lastLoginAt)],
      ['核验方式', '账号 + 口令（PBKDF2-SHA256）'],
      ['存放位置', '浏览器本地库'],
      ['状态', '已授权']
    ].forEach(function (r) {
      var row = el('div', 'qa-dl-row')
      row.appendChild(el('dt', null, r[0]))
      row.appendChild(el('dd', null, r[1]))
      sl.appendChild(row)
    })
    cardSess.appendChild(sl)
    var seal = el('div', 'qa-seal')
    seal.appendChild(el('i', null, '✓'))
    seal.appendChild(el('span', null, 'ACCESS GRANTED'))
    cardSess.appendChild(seal)
    grid.appendChild(cardSess)

    /* 最近核验记录 */
    if (app.showAudit !== false && global.QishiAuth.history) {
      var cardLog = el('article', 'qa-card qa-card--wide')
      cardLog.appendChild(el('h2', null, '最近核验记录'))
      var rows = global.QishiAuth.history(8) || []
      if (!rows.length) {
        cardLog.appendChild(el('p', 'qa-empty', '还没有记录'))
      } else {
        var table = el('table', 'qa-log')
        var thead = el('thead')
        var trh = el('tr')
        ;['时间', '账号', '结果', '来源'].forEach(function (h) {
          trh.appendChild(el('th', null, h))
        })
        thead.appendChild(trh)
        table.appendChild(thead)
        var tbody = el('tbody')
        rows.forEach(function (r) {
          var tr = el('tr', r.ok ? 'is-ok' : 'is-bad')
          tr.appendChild(el('td', null, ts(r.t)))
          tr.appendChild(el('td', null, r.u || '—'))
          tr.appendChild(el('td', null, (r.ok ? '通过' : '拒绝') + ' · ' + (r.code || '')))
          tr.appendChild(el('td', 'qa-ua', r.ua ? r.ua.slice(0, 34) : '—'))
          tbody.appendChild(tr)
        })
        table.appendChild(tbody)
        cardLog.appendChild(table)
      }
      grid.appendChild(cardLog)
    }

    main.appendChild(grid)
    HOST.appendChild(main)

    var foot = el('footer', 'qa-foot')
    foot.appendChild(el('span', null, (CFG.brand && CFG.brand.footer) || ''))
    foot.appendChild(el('span', null, '演示库 · 接入真实项目请替换 assets/auth 下的适配器'))
    HOST.appendChild(foot)
  }

  /* ══ 片头结束之后 ═════════════════════════════════════════════════════ */
  function afterIntro() {
    clearLine()
    if (rendered) return
    var sess = global.__QISHI_USER__ ||
      (global.QishiAuth && global.QishiAuth.peekSession ? global.QishiAuth.peekSession() : null)
    if (sess) {
      /* 30 秒内刚核验过 = 本次刚建立；更早的就是恢复出来的会话 */
      renderConsole(sess, { fresh: Date.now() - (sess.lastLoginAt || 0) < 30000 })
    } else {
      renderLogin('')
    }
  }

  global.addEventListener('dsh-startup:done', afterIntro)

  function boot() {
    var skip = !!global.__DSH_STARTUP_SKIP__
    var sess = global.QishiAuth && global.QishiAuth.peekSession ? global.QishiAuth.peekSession() : null

    /* 已登录 + 允许跳过片头：直接进控制台 */
    if (sess && skip) { renderConsole(sess); return }
    if (skip) { renderLogin(''); return }

    /* 片头在播：等它拆掉自己。也防它半路崩掉把人留在黑幕里。 */
    pollTimer = setInterval(function () {
      if (document.getElementById('dsh-startup-root')) return
      afterIntro()
    }, 1000)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }

  global.QishiApp = {
    renderConsole: renderConsole,
    renderLogin: renderLogin,
    user: function () { return global.__QISHI_USER__ || null }
  }
})(window)
