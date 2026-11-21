/* ============================================================================
 * qishi-auth.js —— 身份核验层（默认：浏览器本地账号库）
 * ----------------------------------------------------------------------------
 * 为什么单独一层：片头只是皮，真正决定「能不能进去」的是这一个模块。
 * 项目里所有界面（第 2 幕的登录框、跳过片头后的登录卡、退出登录）都只跟
 * QishiAuth.active 打交道，不直接碰存储。要接到自己的后端，就照着
 * assets/auth/auth-http.example.js 再写一个适配器、QishiAuth.use(它) 即可。
 *
 * ── 适配器契约（4 个方法 + 1 个同步读）────────────────────────────────
 *   ready()                       → Promise，初始化完成（建库/播种/读设备密钥）
 *   login(username, password, o)  → Promise<Result>
 *   register({account, password, display})  → Promise<Result>
 *   logout()                      → Promise<void>
 *   peekSession()                 → User | null（同步，用于首屏决定要不要跳过片头）
 *
 *   Result = { ok:true, user } | { ok:false, code, message, waitMs?, remaining? }
 *   User   = { account, display, serial, level, createdAt, lastLoginAt }
 *
 * ── 安全边界（请务必读这一段）───────────────────────────────────────────
 * 本地适配器把账号存在 localStorage，把派生的口令哈希存在同一个浏览器里。
 * 它能完整演示注册/核验/失败锁定/会话/审计的真实流程，但**不构成安全边界**：
 * 同一台机器上的人可以直接改 localStorage 或改这段 JS 把自己放进去。
 * 它适合 demo、内网工具、离线样机；要防人，请把适配器换成后端实现
 * （口令在服务端校验、会话由服务端签发 HttpOnly Cookie）。
 * ========================================================================== */
(function (global) {
  'use strict'

  var CFG = global.__QISHI_CFG__ || {}
  var ACFG = CFG.auth || {}
  var SCFG = CFG.session || {}

  var K_STORE = 'qishi.auth.v1'
  var K_SESSION = 'qishi.session.v1'
  var K_DEVICE = 'qishi.device.v1'

  var MAX_FAILS = Number(ACFG.maxFails) || 5
  var LADDER = Array.isArray(ACFG.lockLadder) ? ACFG.lockLadder : [15000, 60000, 300000, 900000]
  var ITER_SUBTLE = Number(ACFG.iterations) || 120000
  var ITER_PLAIN = Number(ACFG.iterationsFallback) || 12000
  var MIN_PW = Number(ACFG.minPassword) || 8

  /* ══ 小工具 ══════════════════════════════════════════════════════════════ */
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

  function toB64(bytes) {
    var out = '', i
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]
    }
    var rest = bytes.length - i
    if (rest === 1) {
      var n1 = bytes[i] << 16
      out += B64[(n1 >> 18) & 63] + B64[(n1 >> 12) & 63] + '=='
    } else if (rest === 2) {
      var n2 = (bytes[i] << 16) | (bytes[i + 1] << 8)
      out += B64[(n2 >> 18) & 63] + B64[(n2 >> 12) & 63] + B64[(n2 >> 6) & 63] + '='
    }
    return out
  }

  function fromB64(s) {
    s = String(s || '').replace(/[^A-Za-z0-9+/=]/g, '')
    var out = [], i
    for (i = 0; i < s.length; i += 4) {
      var c0 = B64.indexOf(s[i]), c1 = B64.indexOf(s[i + 1])
      var c2 = s[i + 2] === undefined || s[i + 2] === '=' ? -1 : B64.indexOf(s[i + 2])
      var c3 = s[i + 3] === undefined || s[i + 3] === '=' ? -1 : B64.indexOf(s[i + 3])
      var n = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3)
      out.push((n >> 16) & 255)
      if (c2 >= 0) out.push((n >> 8) & 255)
      if (c3 >= 0) out.push(n & 255)
    }
    return new Uint8Array(out)
  }

  function utf8(s) {
    if (global.TextEncoder) return new TextEncoder().encode(String(s))
    var str = unescape(encodeURIComponent(String(s)))
    var a = new Uint8Array(str.length)
    for (var i = 0; i < str.length; i++) a[i] = str.charCodeAt(i)
    return a
  }

  function rand(n) {
    var a = new Uint8Array(n)
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(a)
    else for (var i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256)
    return a
  }

  function hex(bytes) {
    var s = ''
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16)
    return s
  }

  /** 定长比较：不因为「第几位开始不同」而提前返回。 */
  function same(a, b) {
    a = String(a || '')
    b = String(b || '')
    var diff = a.length ^ b.length
    var n = Math.max(a.length, b.length)
    for (var i = 0; i < n; i++) {
      diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0)
    }
    return diff === 0
  }

  /* ══ SHA-256 / HMAC-SHA256 / PBKDF2（纯 JS 兜底）═════════════════════════
     浏览器有 WebCrypto 时优先用它（快一个量级）；file:// 或老浏览器上
     crypto.subtle 可能不存在，这时用下面这份纯 JS 实现顶上，结果一致
     （tests/auth.test.mjs 会拿 node:crypto 逐位对拍）。 */
  var K256 = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)) }

  function sha256(msg) {
    var ml = msg.length
    var total = (((ml + 9) + 63) >> 6) << 6
    var buf = new Uint8Array(total)
    buf.set(msg)
    buf[ml] = 0x80
    var dv = new DataView(buf.buffer)
    dv.setUint32(total - 8, Math.floor(ml / 536870912))
    dv.setUint32(total - 4, (ml << 3) >>> 0)

    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
    var w = new Int32Array(64)
    for (var off = 0; off < total; off += 64) {
      var i
      for (i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4)
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7]
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
        var ch = (e & f) ^ (~e & g)
        var t1 = (h + S1 + ch + K256[i] + w[i]) | 0
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
        var maj = (a & b) ^ (a & c) ^ (b & c)
        var t2 = (S0 + maj) | 0
        h = g; g = f; f = e; e = (d + t1) | 0
        d = c; c = b; b = a; a = (t1 + t2) | 0
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0
    }
    var out = new Uint8Array(32)
    var odv = new DataView(out.buffer)
    for (var k = 0; k < 8; k++) odv.setInt32(k * 4, H[k])
    return out
  }

  function concat(a, b) {
    var out = new Uint8Array(a.length + b.length)
    out.set(a, 0)
    out.set(b, a.length)
    return out
  }

  function hmac(key, msg) {
    var k = key.length > 64 ? sha256(key) : key
    var ipad = new Uint8Array(64), opad = new Uint8Array(64)
    for (var i = 0; i < 64; i++) {
      var b = i < k.length ? k[i] : 0
      ipad[i] = b ^ 0x36
      opad[i] = b ^ 0x5c
    }
    return sha256(concat(opad, sha256(concat(ipad, msg))))
  }

  function pbkdf2Plain(pw, salt, iter, dkLen) {
    var blocks = Math.ceil(dkLen / 32)
    var out = new Uint8Array(blocks * 32)
    for (var b = 1; b <= blocks; b++) {
      var iv = concat(salt, new Uint8Array([0, 0, 0, b & 255]))
      var U = hmac(pw, iv)
      var T = U.slice(0)
      for (var i = 1; i < iter; i++) {
        U = hmac(pw, U)
        for (var j = 0; j < 32; j++) T[j] ^= U[j]
      }
      out.set(T, (b - 1) * 32)
    }
    return out.subarray(0, dkLen)
  }

  function hasSubtle() {
    return !!(global.crypto && global.crypto.subtle && global.crypto.subtle.importKey && global.crypto.subtle.deriveBits)
  }

  /** 口令 → 派生串（hex）。有 WebCrypto 走标准实现，没有就走上面的纯 JS。 */
  function derive(password, saltBytes, iter) {
    var pw = utf8(password)
    if (hasSubtle()) {
      var saltCopy = saltBytes.slice(0)
      return global.crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits'])
        .then(function (key) {
          return global.crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: saltCopy, iterations: iter, hash: 'SHA-256' }, key, 256)
        })
        .then(function (bits) { return hex(new Uint8Array(bits)) })
        .catch(function () { return hex(pbkdf2Plain(pw, saltBytes, iter, 32)) })
    }
    return Promise.resolve(hex(pbkdf2Plain(pw, saltBytes, iter, 32)))
  }

  function iterNow() { return hasSubtle() ? ITER_SUBTLE : ITER_PLAIN }

  /* ══ 存储 ═══════════════════════════════════════════════════════════════ */
  function lsGet(k) { try { return global.localStorage.getItem(k) } catch (e) { return null } }
  function lsSet(k, v) { try { global.localStorage.setItem(k, v); return true } catch (e) { return false } }
  function ssGet(k) { try { return global.sessionStorage.getItem(k) } catch (e) { return null } }
  function ssSet(k, v) { try { global.sessionStorage.setItem(k, v); return true } catch (e) { return false } }

  /* 无痕模式 / 关掉站点数据 时 localStorage 会直接抛异常。不拦住的话表现是
     「密码永远不对」，非常难查 —— 这里探一次，探不到就给明白话。 */
  var storageState = null
  function storageOk() {
    if (storageState !== null) return storageState
    storageState = false
    try {
      global.localStorage.setItem('qishi.probe', '1')
      global.localStorage.removeItem('qishi.probe')
      storageState = true
    } catch (e) {
      storageState = false
    }
    return storageState
  }

  function readJSON(raw, fallback) {
    if (!raw) return fallback
    try {
      var v = JSON.parse(raw)
      return v && typeof v === 'object' ? v : fallback
    } catch (e) { return fallback }
  }

  function emptyStore() { return { v: 1, users: [], audit: [] } }

  function loadStore() {
    var s = readJSON(lsGet(K_STORE), null)
    if (!s || !Array.isArray(s.users)) s = emptyStore()
    if (!Array.isArray(s.audit)) s.audit = []
    return s
  }

  function saveStore(s) {
    s.audit = (s.audit || []).slice(-40)
    return lsSet(K_STORE, JSON.stringify(s))
  }

  function deviceKey() {
    var k = lsGet(K_DEVICE)
    if (k && k.length >= 32) return k
    var fresh = toB64(rand(32))
    lsSet(K_DEVICE, fresh)
    return fresh
  }

  /* ══ 会话令牌 ═══════════════════════════════════════════════════════════
     本地会话没有服务端可校验，能做到的是：签名 + 过期 + 账号仍存在。
     HMAC 的密钥落在同一台机器的 localStorage 里，所以它挡的是「手改令牌」，
     不是「有本机文件权限的人」—— 这条边界写在文件头，别当它是真隔离。 */
  function sign(payload) {
    return hex(hmac(utf8(deviceKey()), utf8(payload)).subarray(0, 16))
  }

  function makeToken(user, ttlMs) {
    var payload = JSON.stringify({
      u: user.id,
      n: user.account,
      exp: Date.now() + ttlMs,
      iat: Date.now(),
      r: toB64(rand(6))
    })
    return toB64(utf8(payload)) + '.' + sign(payload)
  }

  function readToken(tok) {
    if (!tok || tok.indexOf('.') < 0) return null
    var cut = tok.lastIndexOf('.')
    var body = tok.slice(0, cut), sig = tok.slice(cut + 1)
    var payload
    try { payload = new TextDecoder().decode(fromB64(body)) } catch (e) { return null }
    if (!same(sig, sign(payload))) return null
    var obj
    try { obj = JSON.parse(payload) } catch (e) { return null }
    if (!obj || !obj.exp || obj.exp < Date.now()) return null
    return obj
  }

  function readSessionRaw() {
    var tok = ssGet(K_SESSION) || lsGet(K_SESSION)
    if (!tok) return null
    var obj = readToken(tok)
    if (!obj) {
      try { global.sessionStorage.removeItem(K_SESSION) } catch (e) {}
      try { global.localStorage.removeItem(K_SESSION) } catch (e) {}
      return null
    }
    return { token: tok, payload: obj }
  }

  /* ══ 用户记录 ═══════════════════════════════════════════════════════════ */
  function normAccount(s) {
    return String(s || '').trim().toLowerCase()
  }

  function publicUser(u) {
    return {
      id: u.id,
      account: u.account,
      display: u.display,
      serial: u.serial,
      level: u.level,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt || 0
    }
  }

  function findUser(store, account) {
    var a = normAccount(account)
    for (var i = 0; i < store.users.length; i++) {
      if (store.users[i].account === a) return store.users[i]
    }
    return null
  }

  function newId() {
    return 'u_' + hex(rand(4))
  }

  function serialFor(u) {
    var h = sha256(utf8(u.id + '|' + u.account))
    var n = ((h[0] << 8) | h[1]) % 9000 + 1000
    return String(n)
  }

  function audit(store, account, ok, code) {
    store.audit.push({
      t: Date.now(),
      u: normAccount(account).slice(0, 32),
      ok: !!ok,
      code: String(code || ''),
      ua: (global.navigator && global.navigator.userAgent ? String(global.navigator.userAgent) : '').slice(0, 60)
    })
  }

  function fail(code, message, extra) {
    var r = { ok: false, code: code, message: message || '' }
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) r[k] = extra[k]
    return r
  }

  /* ══ 本地适配器 ═════════════════════════════════════════════════════════ */
  var readyPromise = null
  var seeded = false

  function seedIfEmpty() {
    if (seeded) return Promise.resolve()
    seeded = true
    var store = loadStore()
    if (store.users.length) return Promise.resolve()
    var d = CFG.demo || {}
    if (!d.account || !d.password) return Promise.resolve()
    var salt = rand(16)
    return derive(d.password, salt, iterNow()).then(function (hash) {
      var u = {
        id: newId(),
        account: normAccount(d.account),
        display: String(d.display || d.account).slice(0, 20),
        level: String(d.level || '1').slice(0, 4),
        algo: 'pbkdf2-sha256',
        iter: iterNow(),
        salt: toB64(salt),
        hash: hash,
        createdAt: Date.now(),
        lastLoginAt: 0,
        fails: 0,
        lockedUntil: 0,
        demo: true
      }
      u.serial = serialFor(u)
      var s2 = loadStore()
      if (!s2.users.length) {
        s2.users.push(u)
        audit(s2, u.account, true, 'SEED')
        saveStore(s2)
      }
      return null
    })
  }

  /** 连续失败达到 MAX_FAILS 才开始锁，之后每多失败一次升一档（15s → 1min → 5min → 15min）。 */
  function lockAfterFails(fails) {
    if (fails < MAX_FAILS) return 0
    var over = fails - MAX_FAILS
    return Math.max(0, Number(LADDER[Math.min(LADDER.length - 1, over)]) || 0)
  }

  var local = {
    name: 'local',

    ready: function () {
      if (!readyPromise) {
        deviceKey()
        readyPromise = seedIfEmpty().catch(function () { return null })
      }
      return readyPromise
    },

    peekSession: function () {
      var raw = readSessionRaw()
      if (!raw) return null
      var store = loadStore()
      var u = null
      for (var i = 0; i < store.users.length; i++) if (store.users[i].id === raw.payload.u) u = store.users[i]
      return u ? publicUser(u) : null
    },

    login: function (account, password, opts) {
      opts = opts || {}
      return local.ready().then(function () {
        if (!storageOk()) return fail('STORAGE', '浏览器禁用了本地存储（无痕模式？），账号库不可用')
        var store = loadStore()
        var name = normAccount(account)
        var pw = String(password == null ? '' : password)

        if (!name) return fail('EMPTY', '请输入身份名称')
        if (!pw) return fail('EMPTY', '请输入访问口令')

        var user = findUser(store, name)
        var now = Date.now()

        if (user && user.lockedUntil && user.lockedUntil > now) {
          var waitMs = user.lockedUntil - now
          return fail('LOCKED', '连续核验失败，' + Math.ceil(waitMs / 1000) + ' 秒后再试', {
            waitMs: waitMs
          })
        }

        /* 账号不存在也照跑一次派生：别让「有没有这个账号」从响应快慢上漏出去 */
        var iter = user ? user.iter : iterNow()
        var salt = user ? fromB64(user.salt) : new Uint8Array(16)

        return derive(pw, salt, iter).then(function (hash) {
          var store2 = loadStore()
          var u2 = findUser(store2, name)
          if (!u2) {
            audit(store2, name, false, 'NO_USER')
            saveStore(store2)
            return fail('BAD_CREDENTIALS', '身份名称或访问口令不正确', { remaining: MAX_FAILS })
          }
          if (!same(hash, u2.hash)) {
            u2.fails = (u2.fails || 0) + 1
            var lockMs = lockAfterFails(u2.fails)
            if (lockMs > 0) u2.lockedUntil = Date.now() + lockMs
            audit(store2, name, false, lockMs > 0 ? 'LOCKED' : 'BAD_PW')
            saveStore(store2)
            var remaining = Math.max(0, MAX_FAILS - u2.fails)
            return fail(lockMs > 0 ? 'LOCKED' : 'BAD_CREDENTIALS',
              lockMs > 0
                ? '核验失败 ' + u2.fails + ' 次，已锁定 ' + Math.ceil(lockMs / 1000) + ' 秒'
                : '访问口令不正确，还可尝试 ' + remaining + ' 次',
              { remaining: remaining, waitMs: lockMs, fails: u2.fails })
          }

          /* 通过：清失败计数、必要时把哈希升级到当前迭代档、写会话 */
          u2.fails = 0
          u2.lockedUntil = 0
          u2.lastLoginAt = Date.now()
          var upgrade = (u2.iter || 0) < iterNow()
          var after = Promise.resolve(true)
          if (upgrade) {
            var freshSalt = rand(16)
            after = derive(pw, freshSalt, iterNow()).then(function (freshHash) {
              u2.salt = toB64(freshSalt)
              u2.hash = freshHash
              u2.iter = iterNow()
              return true
            })
          }
          return after.then(function () {
            var days = Number(opts.rememberDays) > 0 ? Number(opts.rememberDays) : 0
            var ttl = days ? days * 86400000 : (Number(SCFG.defaultHours) || 12) * 3600000
            var token = makeToken(u2, ttl)
            try { global.sessionStorage.removeItem(K_SESSION) } catch (e) {}
            try { global.localStorage.removeItem(K_SESSION) } catch (e) {}
            if (days) lsSet(K_SESSION, token); else ssSet(K_SESSION, token)
            audit(store2, name, true, 'OK')
            saveStore(store2)
            return { ok: true, user: publicUser(u2), ttl: ttl }
          })
        })
      })
    },

    register: function (input) {
      input = input || {}
      return local.ready().then(function () {
        if (!storageOk()) return fail('STORAGE', '浏览器禁用了本地存储（无痕模式？），账号库不可用')
        var account = normAccount(input.account)
        var pw = String(input.password || '')
        var display = String(input.display || '').trim()
        var store = loadStore()

        if (!/^[a-z0-9][a-z0-9_.-]{2,23}$/.test(account)) {
          return fail('BAD_ACCOUNT', '身份名称要 3–24 位，只能用小写字母、数字、_ . -')
        }
        if (findUser(store, account)) return fail('EXISTS', '这个身份名称已经登记过了')
        if (pw.length < MIN_PW) return fail('WEAK', '访问口令至少 ' + MIN_PW + ' 位')
        if (!display) display = account.toUpperCase()
        if (display.length > 20) display = display.slice(0, 20)

        var salt = rand(16)
        return derive(pw, salt, iterNow()).then(function (hash) {
          var store2 = loadStore()
          if (findUser(store2, account)) return fail('EXISTS', '这个身份名称已经登记过了')
          var u = {
            id: newId(),
            account: account,
            display: display,
            level: String(input.level || '1').slice(0, 4),
            algo: 'pbkdf2-sha256',
            iter: iterNow(),
            salt: toB64(salt),
            hash: hash,
            createdAt: Date.now(),
            lastLoginAt: 0,
            fails: 0,
            lockedUntil: 0
          }
          u.serial = serialFor(u)
          store2.users.push(u)
          audit(store2, account, true, 'REGISTER')
          saveStore(store2)
          return { ok: true, user: publicUser(u) }
        })
      })
    },

    logout: function () {
      try { global.sessionStorage.removeItem(K_SESSION) } catch (e) {}
      try { global.localStorage.removeItem(K_SESSION) } catch (e) {}
      return Promise.resolve()
    },

    history: function (n) {
      var store = loadStore()
      return store.audit.slice(-(Number(n) || 8)).reverse()
    },

    /* 测试与调试用：把本地库整个抹掉 */
    _reset: function () {
      try { global.localStorage.removeItem(K_STORE) } catch (e) {}
      try { global.localStorage.removeItem(K_DEVICE) } catch (e) {}
      try { global.sessionStorage.removeItem(K_SESSION) } catch (e) {}
      try { global.localStorage.removeItem(K_SESSION) } catch (e) {}
      seeded = false
      readyPromise = null
    },

    /* 测试与调试用：直接看库内容（不含明文口令，只有盐和哈希） */
    _dump: function () { return loadStore() }
  }

  /* ══ 对外 ═══════════════════════════════════════════════════════════════ */
  var registry = { local: local }
  var active = local
  var want = String(ACFG.adapter || 'local')
  if (want !== 'local' && registry[want]) active = registry[want]

  global.QishiAuth = {
    /** 接入自己的后端：QishiAuth.use('http', adapter) 或直接 use(adapterObj) */
    use: function (nameOrAdapter, maybe) {
      if (nameOrAdapter && typeof nameOrAdapter === 'object') { active = nameOrAdapter; return active }
      if (maybe) registry[nameOrAdapter] = maybe
      if (registry[nameOrAdapter]) active = registry[nameOrAdapter]
      return active
    },
    adapters: registry,
    get active() { return active },
    /** 便捷代理，界面只认这几个 */
    ready: function () { return active.ready ? active.ready() : Promise.resolve() },
    login: function (a, p, o) { return active.login(a, p, o) },
    register: function (i) { return active.register(i) },
    logout: function () { return active.logout() },
    peekSession: function () { return active.peekSession ? active.peekSession() : null },
    history: function (n) { return active.history ? active.history(n) : [] },
    _local: local,
    _crypto: { sha256: sha256, hmac: hmac, pbkdf2: pbkdf2Plain, hex: hex, derive: derive, same: same }
  }
})(window)
