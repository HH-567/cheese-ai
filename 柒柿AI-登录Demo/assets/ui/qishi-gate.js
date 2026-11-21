/* ============================================================================
 * qishi-gate.js —— 把登录框接到片头第 2 幕
 * ----------------------------------------------------------------------------
 * 这一层只做三件事：
 *   1) 片头走到「身份资料确认」时，把那块只读身份卡换成真表单（mount）
 *   2) 拦住「按回车就往下走」的默认行为，等真实核验通过才放行（wait）
 *   3) 核验通过后，把真实姓名/编号/权限回填进后面的终幕「欢迎 XXX 访问」
 * 契约见 vendor/dsh-boot-suite/lib/splash.js 里的 QISHI PATCH 2/4 注释。
 * ========================================================================== */
(function (global) {
  'use strict'

  var CFG = global.__QISHI_CFG__ || {}
  var form = null
  var granted = false
  var resolver = null
  var pendingUser = null

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function liveSession() {
    try {
      return global.QishiAuth && global.QishiAuth.peekSession ? global.QishiAuth.peekSession() : null
    } catch (e) { return null }
  }

  /** 把真实身份写进片头后面的文案：终幕欢迎语 + 右下角 ID 行。 */
  function applyIdentity(user) {
    global.__QISHI_USER__ = user
    var root = document.getElementById('dsh-startup-root')
    if (!root) return
    var w4 = root.querySelector('.dsu-w4')
    if (w4) w4.textContent = '欢迎 ' + user.display + ' 访问'
    var idline = root.querySelector('.dsu-idline')
    if (idline) idline.textContent = '· ID CONFIRMED : ' + user.serial
  }

  /** 核验通过后，把表单换成一行行只读的身份资料（回到原版的观感）。 */
  function showConfirmed(card, user) {
    card.innerHTML = ''
    card.classList.add('qishi-card--done')
    var rows = [
      ['身份名称', user.display, true],
      ['身份编号', user.serial, false],
      ['权限等级', user.level, false],
      ['核验时间', new Date().toLocaleTimeString('zh-CN', { hour12: false }), false]
    ]
    rows.forEach(function (r) {
      var row = el('div', 'dsu-card-row')
      row.appendChild(el('span', null, r[0]))
      row.appendChild(el('b', r[2] ? 'dsu-zhname' : null, r[1]))
      card.appendChild(row)
    })
    var ok = el('div', 'qishi-ok')
    ok.appendChild(el('i', null, '✓'))
    ok.appendChild(el('span', null, '核验通过 · ACCESS GRANTED'))
    card.appendChild(ok)
  }

  function markDone(ui, zh, en, hint) {
    var bz = ui.btnZh || (ui.btn && ui.btn.querySelector('.dsu-btn-zh'))
    var be = ui.btnEn || (ui.btn && ui.btn.querySelector('.dsu-btn-en'))
    if (bz) bz.textContent = zh
    if (be) be.textContent = en
    ui.btn.disabled = true
    ui.btn.classList.remove('dsu-pulse')
    ui.btn.classList.add('qishi-btn--done')
    ui.hint.innerHTML = hint
  }

  function mount(ui) {
    granted = false
    resolver = null
    pendingUser = null

    var card = ui.card
    card.hidden = false
    card.classList.remove('qishi-card--done')
    card.style.minWidth = '440px'
    card.style.padding = '10px 2px 12px'

    /* 已经有有效会话（比如用户点了「重播开场」）：不再让人输第二遍 */
    var sess = liveSession()
    if (sess) {
      granted = true
      pendingUser = sess
      applyIdentity(sess)
      showConfirmed(card, sess)
      markDone(ui, '已登录', 'SESSION ACTIVE', '检测到有效会话，本幕跳过重复核验')
      return
    }

    form = global.QishiLoginForm.create({
      variant: 'gate',
      onSuccess: function (user) {
        granted = true
        pendingUser = user
        try {
          applyIdentity(user)
          showConfirmed(card, user)
          markDone(ui, '已核验', 'VERIFIED', '会话已建立，正在载入工作区…')
        } catch (ePaint) {
          /* 版式画失败也绝不许拦住放行：会话已经建立，动画该往下走 */
        }
        /* 留 720ms 让这一行读得到，再放动画往下走 */
        setTimeout(function () {
          var fn = resolver
          resolver = null
          if (fn) fn()
        }, 720)
      }
    })

    card.appendChild(form.el)
    form.focus()

    /* 片头自带的那颗按钮就是提交键：不额外造第二颗，视觉上是同一套版式 */
    ui.btn.disabled = false
    ui.btn.classList.remove('qishi-btn--done')
    ui.btn.addEventListener('click', function (e) {
      e.preventDefault()
      e.stopPropagation()
      if (!granted && form) form.submit()
    })

    /* 演示/截图用：地址栏加 #demo=auto，这一幕自动填演示账号并提交 */
    try {
      if (/#.*demo=auto/.test(String(global.location.hash || '')) && CFG.demo && CFG.demo.account) {
        form.prefill(CFG.demo.account, CFG.demo.password)
        setTimeout(function () { if (!granted) form.submit() }, 700)
      }
    } catch (e) { /* noop */ }
  }

  function wait(ctx) {
    /* 已经核验过（重播 / 有效会话）直接放行，别让第二遍卡在表单上 */
    if (granted) { setTimeout(ctx.resolve, 0); return }
    resolver = ctx.resolve
  }

  global.__QISHI_LOGIN__ = {
    btnZh: '验证身份',
    btnEn: 'VERIFY IDENTITY',
    hint: '身份名称与访问口令核验通过后才会继续',
    mount: mount,
    wait: wait
  }

  /* 供页面其它地方问「到底核验过没有」 */
  global.QishiGate = {
    granted: function () { return granted },
    user: function () { return pendingUser },
    applyIdentity: applyIdentity
  }
})(window)
