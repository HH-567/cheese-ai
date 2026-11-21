/* ============================================================================
 * auth-http.example.js —— 接到「你自己的后端」的适配器样板
 * ----------------------------------------------------------------------------
 * 用法（两步）：
 *   1) index.html 里把这行注释打开，放在 qishi-auth.js 之后、qishi-gate.js 之前：
 *        <script src="assets/auth/auth-http.example.js"></script>
 *   2) 改本文件顶部的 BASE 与四个请求的路径/字段，让它对上你的服务端。
 *      qishi.config.js 里 auth.adapter 设成 'http' 即可自动启用。
 *
 * 为什么要换：本地适配器把口令哈希存在浏览器里，能演示流程但不构成安全边界。
 * 真项目里口令必须在服务端校验，会话必须由服务端签发（推荐 HttpOnly Cookie，
 * 前端拿不到 token，XSS 也就偷不走），并带上 CSRF 防护。
 *
 * ── 服务端要提供的最小接口 ──────────────────────────────────────────────
 *   POST /api/login     { account, password }        → 200 { user } | 401 { code, message }
 *   POST /api/register  { account, password, display } → 200 { user } | 409 { code, message }
 *   POST /api/logout                                   → 204
 *   GET  /api/session                                  → 200 { user } | 401
 *   user = { account, display, serial, level, createdAt, lastLoginAt }
 *
 * 前端只认这份契约，服务端用什么语言、什么库都行。
 * ========================================================================== */
(function (global) {
  'use strict'

  var BASE = '/api'
  var cached = null

  function json(res) {
    return res.text().then(function (t) {
      var data = null
      try { data = t ? JSON.parse(t) : null } catch (e) { data = null }
      return { ok: res.ok, status: res.status, data: data }
    })
  }

  function post(path, body) {
    return fetch(BASE + path, {
      method: 'POST',
      credentials: 'same-origin',       /* 会话走 Cookie，不带 Authorization */
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(json)
  }

  function toResult(r, okCode) {
    if (r.ok) return { ok: true, user: r.data.user }
    return {
      ok: false,
      code: (r.data && r.data.code) || 'HTTP_' + r.status,
      message: (r.data && r.data.message) || '核验服务返回 ' + r.status,
      remaining: r.data && r.data.remaining,
      waitMs: r.data && r.data.waitMs
    }
  }

  var http = {
    name: 'http',

    ready: function () { return Promise.resolve() },

    /* 首屏同步判断「要不要跳过片头」：这里只能靠一个 Cookie 痕迹来猜，
       猜错了最坏结果是多播一遍片头，不会误放人进去（真权限由服务端判定）。 */
    peekSession: function () {
      if (cached && cached.exp > Date.now()) return cached.user
      return null
    },

    login: function (account, password) {
      return post('/login', { account: account, password: password }).then(function (r) {
        var res = toResult(r)
        if (res.ok) cached = { user: res.user, exp: Date.now() + 10 * 60 * 1000 }
        return res
      }).catch(function () {
        return { ok: false, code: 'NETWORK', message: '连不上核验服务' }
      })
    },

    register: function (input) {
      return post('/register', {
        account: input.account,
        password: input.password,
        display: input.display
      }).then(function (r) { return toResult(r) })
        .catch(function () { return { ok: false, code: 'NETWORK', message: '连不上核验服务' } })
    },

    logout: function () {
      cached = null
      return fetch(BASE + '/logout', { method: 'POST', credentials: 'same-origin' })
        .then(function () { return null })
        .catch(function () { return null })
    },

    history: function () { return [] }   /* 审计记录留在服务端，要显示就再加一个接口 */
  }

  /* 自动挂载：config 里写 adapter:'http' 就生效；否则只是注册，不夺权 */
  global.QishiAuth.use('http', http)
  var want = (global.__QISHI_CFG__ && global.__QISHI_CFG__.auth && global.__QISHI_CFG__.auth.adapter) || 'local'
  if (want === 'http') global.QishiAuth.use('http')
})(window)
