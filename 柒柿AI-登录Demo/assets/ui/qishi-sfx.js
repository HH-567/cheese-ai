/* ============================================================================
 * qishi-sfx.js —— 打字哒哒声（可选）
 * ----------------------------------------------------------------------------
 * 片头自己有一套 WebAudio 音效，这里只补「输口令时的那一下」。
 * 素材缺失 / 用户关掉声音 / 浏览器禁止自动播放时全部静默降级，不影响登录。
 * ========================================================================== */
(function (global) {
  'use strict'

  var CFG = global.__QISHI_CFG__ || {}
  var ON = !!(CFG.intro && CFG.intro.sound)
  var base = global.__QISHI_ASSET_BASE__ || './vendor/dsh-boot-suite/lib/assets'
  var pool = []
  var idx = 0
  var armed = false

  function warm() {
    if (!ON || armed) return
    armed = true
    for (var i = 0; i < 4; i++) {
      try {
        var a = new Audio(base.replace(/\/+$/, '') + '/sfx/sfx-tick.mp3')
        a.preload = 'auto'
        a.volume = 0.18
        pool.push(a)
      } catch (e) { /* 没素材就安静 */ }
    }
  }

  global.QishiSfx = {
    /** 键位一下。任何异常都不许冒泡到表单逻辑里。 */
    tick: function () {
      if (!ON) return
      warm()
      if (!pool.length) return
      try {
        var a = pool[idx++ % pool.length]
        a.currentTime = 0
        var p = a.play()
        if (p && p.catch) p.catch(function () {})
      } catch (e) { /* noop */ }
    }
  }
})(window)
