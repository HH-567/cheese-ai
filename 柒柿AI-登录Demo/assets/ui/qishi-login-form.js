/* ============================================================================
 * qishi-login-form.js —— 登录表单（一个组件，两处复用）
 * ----------------------------------------------------------------------------
 *   gate 版：挂进片头第 2 幕「身份资料确认」原来的身份卡位置，提交按钮借
 *            启动动画自己的那颗 .dsu-btn（所以视觉上是同一套版式）。
 *   page 版：跳过片头、或者退出登录之后，单独摆在纸面上用。
 * 两种版式共用同一份校验/报错/锁定逻辑，只有按钮位置不同。
 * ========================================================================== */
(function (global) {
  'use strict'

  var CFG = global.__QISHI_CFG__ || {}
  var seq = 0

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function create(opts) {
    opts = opts || {}
    var variant = opts.variant === 'page' ? 'page' : 'gate'
    var uid = 'qf' + (++seq)
    var busy = false
    var mode = 'login'               /* login | register */
    var lockTimer = null
    var lockedUntil = 0

    var form = el('form', 'qishi-form qishi-form--' + variant)
    form.setAttribute('novalidate', 'novalidate')
    form.autocomplete = 'on'
    form.setAttribute('aria-label', '身份核验')

    /* ── 身份名称 ─────────────────────────────────────────────────────── */
    var rowAccount = el('div', 'qishi-row')
    var labAccount = el('label', 'qishi-label')
    labAccount.setAttribute('for', uid + '-account')
    labAccount.appendChild(el('span', 'qishi-label-zh', '身份名称'))
    labAccount.appendChild(el('i', 'qishi-label-en', 'IDENTITY'))
    var inAccount = el('input', 'qishi-input')
    inAccount.id = uid + '-account'
    inAccount.name = 'username'
    inAccount.type = 'text'
    inAccount.autocomplete = 'username'
    inAccount.spellcheck = false
    inAccount.placeholder = 'ACCOUNT'
    inAccount.maxLength = 24
    rowAccount.appendChild(labAccount)
    rowAccount.appendChild(inAccount)

    /* ── 访问口令 ─────────────────────────────────────────────────────── */
    var rowPass = el('div', 'qishi-row')
    var labPass = el('label', 'qishi-label')
    labPass.setAttribute('for', uid + '-pass')
    labPass.appendChild(el('span', 'qishi-label-zh', '访问口令'))
    labPass.appendChild(el('i', 'qishi-label-en', 'PASSCODE'))
    var passWrap = el('div', 'qishi-passwrap')
    var inPass = el('input', 'qishi-input')
    inPass.id = uid + '-pass'
    inPass.name = 'password'
    inPass.type = 'password'
    inPass.autocomplete = 'current-password'
    inPass.placeholder = '••••••••'
    inPass.maxLength = 128
    var eye = el('button', 'qishi-eye', 'SHOW')
    eye.type = 'button'
    eye.setAttribute('aria-label', '显示或隐藏访问口令')
    passWrap.appendChild(inPass)
    passWrap.appendChild(eye)
    rowPass.appendChild(labPass)
    rowPass.appendChild(passWrap)

    /* ── 登记模式才出现的两行 ─────────────────────────────────────────── */
    var rowDisplay = el('div', 'qishi-row qishi-row--reg')
    var labDisplay = el('label', 'qishi-label')
    labDisplay.setAttribute('for', uid + '-display')
    labDisplay.appendChild(el('span', 'qishi-label-zh', '显示名称'))
    labDisplay.appendChild(el('i', 'qishi-label-en', 'DISPLAY'))
    var inDisplay = el('input', 'qishi-input')
    inDisplay.id = uid + '-display'
    inDisplay.name = 'display'
    inDisplay.type = 'text'
    inDisplay.maxLength = 20
    inDisplay.placeholder = '终端上称呼你的名字'
    rowDisplay.appendChild(labDisplay)
    rowDisplay.appendChild(inDisplay)

    var rowConfirm = el('div', 'qishi-row qishi-row--reg')
    var labConfirm = el('label', 'qishi-label')
    labConfirm.setAttribute('for', uid + '-confirm')
    labConfirm.appendChild(el('span', 'qishi-label-zh', '再输一次'))
    labConfirm.appendChild(el('i', 'qishi-label-en', 'REPEAT'))
    var inConfirm = el('input', 'qishi-input')
    inConfirm.id = uid + '-confirm'
    inConfirm.name = 'confirm'
    inConfirm.type = 'password'
    inConfirm.maxLength = 128
    rowConfirm.appendChild(labConfirm)
    rowConfirm.appendChild(inConfirm)

    /* ── 状态行 ───────────────────────────────────────────────────────── */
    var msg = el('p', 'qishi-msg')
    msg.setAttribute('role', 'status')
    msg.setAttribute('aria-live', 'polite')

    /* ── 底部：记住我 / 切换登记 ──────────────────────────────────────── */
    var footRow = el('div', 'qishi-footrow')
    var rememberLab = el('label', 'qishi-remember')
    var remember = el('input')
    remember.type = 'checkbox'
    remember.name = 'remember'
    remember.checked = true
    rememberLab.appendChild(remember)
    rememberLab.appendChild(el('span', null, '记住这次核验'))
    var switchBtn = el('button', 'qishi-link', '登记新身份')
    switchBtn.type = 'button'
    footRow.appendChild(rememberLab)
    footRow.appendChild(switchBtn)

    /* ── 演示账号提示（可点，点了自动填）──────────────────────────────── */
    var demoRow = null
    var demo = CFG.demo || {}
    if (demo.account && demo.password) {
      demoRow = el('div', 'qishi-demo')
      var demoBtn = el('button', 'qishi-demo-fill')
      demoBtn.type = 'button'
      demoBtn.appendChild(el('span', null, '演示账号'))
      demoBtn.appendChild(el('code', null, demo.account))
      demoBtn.appendChild(el('span', null, '/'))
      demoBtn.appendChild(el('code', null, demo.password))
      demoBtn.appendChild(el('b', null, '一键填入'))
      demoRow.appendChild(demoBtn)
      demoRow.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('.qishi-demo-fill')) {
          inAccount.value = demo.account
          inPass.value = demo.password
          inPass.focus()
        }
      })
    }

    /* ── page 版自己的提交按钮 ────────────────────────────────────────── */
    var ownBtn = null
    if (variant === 'page') {
      ownBtn = el('button', 'qishi-submit')
      ownBtn.type = 'submit'
      ownBtn.appendChild(el('span', 'qishi-submit-zh', opts.submitLabel || '进入控制台'))
      ownBtn.appendChild(el('span', 'qishi-submit-en', 'SIGN IN'))
    }

    form.appendChild(rowAccount)
    form.appendChild(rowPass)
    form.appendChild(rowDisplay)
    form.appendChild(rowConfirm)
    form.appendChild(msg)
    form.appendChild(footRow)
    if (demoRow) form.appendChild(demoRow)
    if (ownBtn) form.appendChild(ownBtn)

    /* ══ 视觉状态 ═════════════════════════════════════════════════════════ */
    function say(text, kind) {
      msg.textContent = text || ''
      msg.className = 'qishi-msg' + (kind ? ' is-' + kind : '')
      if (!text) return
      if (kind === 'err') {
        form.classList.remove('is-shake')
        void form.offsetWidth
        form.classList.add('is-shake')
      }
    }

    function setBusy(on) {
      busy = !!on
      form.classList.toggle('is-busy', busy)
      inAccount.disabled = busy
      inPass.disabled = busy
      inDisplay.disabled = busy
      inConfirm.disabled = busy
      switchBtn.disabled = busy
      if (ownBtn) ownBtn.disabled = busy
      if (busy) say('核验中…', 'hint')
    }

    function setMode(next) {
      mode = next
      var reg = mode === 'register'
      form.classList.toggle('is-register', reg)
      switchBtn.textContent = reg ? '返回登录' : '登记新身份'
      if (ownBtn) {
        ownBtn.querySelector('.qishi-submit-zh').textContent = reg ? '登记并进入' : (opts.submitLabel || '进入控制台')
        ownBtn.querySelector('.qishi-submit-en').textContent = reg ? 'REGISTER' : 'SIGN IN'
      }
      inPass.autocomplete = reg ? 'new-password' : 'current-password'
      if (reg) {
        say('新身份只存在这台机器上（演示库）', 'hint')
      } else {
        say('')
      }
      setTimeout(function () { (reg ? inDisplay : inAccount).focus() }, 0)
    }

    /* ══ 锁定倒计时 ═══════════════════════════════════════════════════════ */
    function startLock(waitMs) {
      lockedUntil = Date.now() + waitMs
      if (lockTimer) clearInterval(lockTimer)
      function tick() {
        var left = Math.ceil((lockedUntil - Date.now()) / 1000)
        if (left <= 0) {
          clearInterval(lockTimer)
          lockTimer = null
          lockedUntil = 0
          say('可以重试了', 'hint')
          return
        }
        say('锁定中，' + left + ' 秒后可再试', 'err')
      }
      tick()
      lockTimer = setInterval(tick, 500)
    }

    function lockedNow() { return lockedUntil > Date.now() }

    /* ══ 提交 ═════════════════════════════════════════════════════════════ */
    function finishOk(user) {
      setBusy(false)
      form.classList.add('is-done')
      if (opts.onSuccess) opts.onSuccess(user)
    }

    function submit() {
      if (busy || lockedNow()) return
      var account = String(inAccount.value || '').trim()
      var password = String(inPass.value || '')

      if (!account) { say('请先填身份名称', 'err'); inAccount.focus(); return }
      if (!password) { say('请先填访问口令', 'err'); inPass.focus(); return }

      if (mode === 'register') {
        if (String(inConfirm.value || '') !== password) {
          say('两次输入的口令不一致', 'err')
          inConfirm.focus()
          return
        }
        if (password.length < (Number(CFG.auth && CFG.auth.minPassword) || 8)) {
          say('访问口令至少 ' + ((CFG.auth && CFG.auth.minPassword) || 8) + ' 位', 'err')
          inPass.focus()
          return
        }
        setBusy(true)
        global.QishiAuth.register({ account: account, password: password, display: inDisplay.value })
          .then(function (r) {
            if (!r.ok) {
              setBusy(false)
              say(r.message || '登记失败', 'err')
              return null
            }
            /* 登记成功直接登入，少一次输入 */
            return global.QishiAuth.login(account, password, {
              rememberDays: remember.checked ? (CFG.session && CFG.session.rememberDays) : 0
            }).then(function (r2) {
              if (!r2.ok) {
                setBusy(false)
                setMode('login')
                inAccount.value = account
                inPass.value = ''
                say('身份已登记，请登录', 'ok')
                return null
              }
              finishOk(r2.user)
              return null
            })
          })
          .catch(function () { setBusy(false); say('登记时出了点问题，请重试', 'err') })
        return
      }

      setBusy(true)
      global.QishiAuth.login(account, password, {
        rememberDays: remember.checked ? (CFG.session && CFG.session.rememberDays) : 0
      }).then(function (r) {
        if (r.ok) {
          finishOk(r.user)
          return
        }
        setBusy(false)
        say(r.message || '核验未通过', 'err')
        if (r.code === 'LOCKED' && r.waitMs) startLock(r.waitMs)
        inPass.select()
      }).catch(function () {
        setBusy(false)
        say('核验时出了点问题，请重试', 'err')
      })
    }

    /* ══ 事件 ═════════════════════════════════════════════════════════════ */
    form.addEventListener('submit', function (e) {
      e.preventDefault()
      submit()
    })

    function onKey(e) {
      if (e.key === 'Enter') {
        e.preventDefault()
        submit()
      }
    }
    form.addEventListener('keydown', onKey)

    function typeTick(e) {
      if (e.key && e.key.length === 1 && global.QishiSfx) global.QishiSfx.tick()
    }
    inAccount.addEventListener('keydown', typeTick)
    inPass.addEventListener('keydown', typeTick)

    eye.addEventListener('click', function () {
      var hidden = inPass.type === 'password'
      inPass.type = hidden ? 'text' : 'password'
      eye.textContent = hidden ? 'HIDE' : 'SHOW'
      inPass.focus()
    })

    switchBtn.addEventListener('click', function () {
      if (busy) return
      setMode(mode === 'register' ? 'login' : 'register')
    })

    /* 键盘走到输入框时：回车在这里就地提交，其余按键不许冒到片头那套
       「空格/回车继续」的监听上（否则输入空格会把动画推走）。 */
    ;[inAccount, inPass, inDisplay, inConfirm].forEach(function (n) {
      n.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault()
          submit()
        }
        e.stopPropagation()
      })
      n.addEventListener('keyup', function (e) { e.stopPropagation() })
      n.addEventListener('keypress', function (e) { e.stopPropagation() })
    })

    return {
      el: form,
      submit: submit,
      mode: function () { return mode },
      setMode: setMode,
      say: say,
      busy: function () { return busy },
      focus: function () {
        setTimeout(function () { try { inAccount.focus() } catch (e) {} }, 60)
      },
      reset: function () {
        inPass.value = ''
        inConfirm.value = ''
        form.classList.remove('is-done')
        setMode('login')
        say('')
      },
      prefill: function (a, p) {
        if (a != null) inAccount.value = a
        if (p != null) inPass.value = p
      },
      destroy: function () {
        if (lockTimer) clearInterval(lockTimer)
      }
    }
  }

  global.QishiLoginForm = { create: create }
})(window)
