// ==UserScript==
// @name         X Tools 推特小工具
// @namespace    https://github.com/xifandev/Tampermonkey
// @version      1.6.2
// @description  推特小工具集：视频一键下载、广告屏蔽、时间线快捷关注、悬浮控制面板
// @author       xifan
// @license      MIT
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://mobile.twitter.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      video.twimg.com
// @connect      twimg.com
// @connect      cdn.syndication.twimg.com
// @connect      api.fxtwitter.com
// @updateURL    https://raw.githubusercontent.com/xifandev/Tampermonkey/main/x-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/xifandev/Tampermonkey/main/x-tools.user.js
// @supportURL   https://github.com/xifandev/Tampermonkey/issues
// @homepageURL  https://github.com/xifandev/Tampermonkey
// ==/UserScript==

(function () {
  'use strict';

  /* ============================================================
   * X Tools 推特小工具
   * 模块结构：
   *   1. Settings  —— 开关持久化（GM 存储）
   *   2. Panel     —— 悬浮按钮 + 浮窗控制面板
   *   3. ApiHub    —— 共享网络 Hook（一次解析，多模块消费）
   *   4. AdBlocker —— 广告屏蔽（纯 DOM 隐藏，零网络拦截，防封号）
   *   5. VideoDL   —— 推文视频下载（hook GraphQL + 多源兜底）
   *   6. Follow    —— 时间线关注状态 + 手动一键关注
   * ============================================================ */

  const w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const PREFIX = '[X-Tools]';

  /* ============================================================
   * 1. Settings —— 开关持久化
   * ============================================================ */

  const Settings = {
    defaults: {
      hideAds: true,        // 广告屏蔽
      videoDownload: true,  // 视频下载按钮
      quickFollow: true,    // 时间线关注状态与一键关注
    },
    get(key) {
      const v = GM_getValue('xt_' + key, undefined);
      return v === undefined ? this.defaults[key] : v;
    },
    set(key, val) {
      GM_setValue('xt_' + key, val);
    },
  };

  /* ============================================================
   * 2. Panel —— 悬浮按钮 + 浮窗控制面板
   * ============================================================ */

  const Panel = {
    button: null,
    card: null,
    open: false,

    init() {
      injectPanelStyle();
      this.button = createButton();
      this.card = createCard();
      // 篡改猴菜单也加入口
      if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('打开 X Tools 面板', () => this.toggle(true));
      }
      const mount = () => {
        mountFab(this.button);
        document.body.appendChild(this.card);
        this.button.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.toggle();
        });
        // 点面板外关闭
        document.addEventListener('click', (e) => {
          if (this.open && !this.card.contains(e.target) && !this.button.contains(e.target)) {
            this.toggle(false);
          }
        });
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && this.open) this.toggle(false);
        });
        // 守卫：X 是 SPA，官方按钮位置可能动态变化。
        // 逐帧跟随坐标（仅在变化时写样式），官方按钮渲染/动画一结束立即就位；
        // 定时器只负责按钮被 X 移除后的重挂载和主题变化后的样式刷新。
        const mountedAt = performance.now();
        const rePosition = () => {
          const ok = positionFab(this.button);
          // 长时间找不到官方按钮（如未登录页），退回默认固定位置，保证入口不丢
          if (!ok && performance.now() - mountedAt > 15000) fallbackFab(this.button);
          if (this.open) this.positionCard();
        };
        const track = () => { rePosition(); requestAnimationFrame(track); };
        requestAnimationFrame(track);
        setInterval(() => {
          if (!document.body.contains(this.button)) mountFab(this.button);
          else positionFab(this.button, true);
        }, 2000);
      };
      if (document.body) mount();
      else {
        const obs = new MutationObserver(() => {
          if (document.body) { obs.disconnect(); mount(); }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
      }
    },

    toggle(force) {
      this.open = (force === undefined) ? !this.open : force;
      if (this.open) this.positionCard();
      this.card.style.display = this.open ? 'flex' : 'none';
      this.button.classList.toggle('xt-btn-active', this.open);
    },

    // 面板贴在按钮左侧弹出，位置按按钮实时计算
    positionCard() {
      const r = this.button.getBoundingClientRect();
      this.card.style.right = Math.max(12, window.innerWidth - r.left + 12) + 'px';
      this.card.style.bottom = Math.max(12, window.innerHeight - r.bottom) + 'px';
    },

    // 重建开关列表（设置变化时调用）
    refresh() {
      const list = this.card.querySelector('.xt-list');
      if (!list) return;
      list.innerHTML = '';
      features.forEach(f => list.appendChild(buildToggleRow(f)));
    },
  };

  // 功能注册表：每个功能 { key, label, desc, get, set, onToggle }
  const features = [];

  function registerFeature(f) { features.push(f); }

  function buildToggleRow(f) {
    const row = document.createElement('div');
    row.className = 'xt-row';
    const on = f.get();
    row.innerHTML =
      '<div class="xt-row-text">' +
        '<div class="xt-row-name">' + f.label + '</div>' +
        '<div class="xt-row-desc">' + f.desc + '</div>' +
      '</div>' +
      '<div class="xt-switch' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '">' +
        '<div class="xt-knob"></div>' +
      '</div>';
    const sw = row.querySelector('.xt-switch');
    sw.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const newVal = !f.get();
      f.set(newVal);
      sw.classList.toggle('on', newVal);
      sw.setAttribute('aria-checked', newVal);
      if (f.onToggle) f.onToggle(newVal);
      console.log(PREFIX, f.label, '→', newVal);
    });
    return row;
  }

  function injectPanelStyle() {
    if (document.getElementById('xt-style')) return;
    const style = document.createElement('style');
    style.id = 'xt-style';
    style.textContent = `
      /* 悬浮按钮：不设置 z-index，避免盖住 Grok 聊天窗等 X 原生浮层 */
      .xt-fab {
        position: fixed;
        display: flex; align-items: center; justify-content: center;
        box-sizing: border-box; cursor: pointer; padding: 0; outline: none;
        transition: transform 0.15s, filter 0.15s;
      }
      .xt-fab:hover { transform: scale(1.06); filter: brightness(1.3); }
      .xt-fab:active { transform: scale(0.95); }
      .xt-fab.xt-btn-active { filter: brightness(1.4); }
      /* 面板卡片 */
      .xt-card {
        position: fixed;
        width: 300px; display: none; flex-direction: column;
        background: rgba(21, 24, 28, 0.96);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 16px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.55);
        backdrop-filter: blur(16px);
        color: rgb(231, 233, 234);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        overflow: hidden;
        animation: xt-pop 0.16s ease-out;
      }
      @keyframes xt-pop { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }
      .xt-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .xt-title { font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
      .xt-title-dot { width: 8px; height: 8px; border-radius: 50%; background: rgb(29, 155, 240); }
      .xt-close {
        width: 24px; height: 24px; border-radius: 50%; border: none; cursor: pointer;
        background: rgba(255,255,255,0.08); color: rgb(231, 233, 234);
        font-size: 16px; line-height: 1; display: flex; align-items: center; justify-content: center;
      }
      .xt-close:hover { background: rgba(255,255,255,0.16); }
      .xt-list { padding: 8px 0; max-height: 60vh; overflow-y: auto; }
      .xt-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 16px; cursor: pointer; transition: background 0.12s;
      }
      .xt-row:hover { background: rgba(255,255,255,0.04); }
      .xt-row-text { flex: 1; min-width: 0; }
      .xt-row-name { font-size: 14px; font-weight: 600; }
      .xt-row-desc { font-size: 12px; color: rgb(113, 118, 123); margin-top: 2px; }
      /* iOS 风格开关 */
      .xt-switch {
        flex-shrink: 0; width: 38px; height: 22px; border-radius: 11px;
        background: rgb(83, 100, 113); position: relative; transition: background 0.18s;
        cursor: pointer;
      }
      .xt-switch.on { background: rgb(29, 155, 240); }
      .xt-knob {
        position: absolute; top: 2px; left: 2px; width: 18px; height: 18px;
        border-radius: 50%; background: #fff;
        transition: transform 0.18s; box-shadow: 0 1px 3px rgba(0,0,0,0.4);
      }
      .xt-switch.on .xt-knob { transform: translateX(16px); }
      .xt-foot {
        padding: 10px 16px; border-top: 1px solid rgba(255,255,255,0.08);
        font-size: 11px; color: rgb(113, 118, 123);
        display: flex; justify-content: space-between; align-items: center;
      }
      .xt-foot a { color: rgb(29, 155, 240); text-decoration: none; }
      .xt-foot a:hover { text-decoration: underline; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // 悬浮按钮图标：双滑块，贴"工具开关"语义
  const FAB_ICON_SLIDER = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">'
    + '<line x1="4" y1="8" x2="20" y2="8"/><circle cx="9" cy="8" r="2.2" fill="currentColor"/>'
    + '<line x1="4" y1="16" x2="20" y2="16"/><circle cx="15" cy="16" r="2.2" fill="currentColor"/>'
    + '</svg>';

  function createButton() {
    const btn = document.createElement('button');
    btn.className = 'xt-fab';
    btn.type = 'button';
    btn.title = 'X Tools 推特小工具';
    btn.setAttribute('aria-label', 'X Tools 面板');
    btn.innerHTML = FAB_ICON_SLIDER;
    return btn;
  }

  // 悬浮按钮定位：不插入 X 容器，改用"动态跟随 Grok 按钮真实坐标"。
  // 尺寸/圆角/背景/阴影直接复制 Grok 的 computed style，位置 = Grok 正上方，
  // 间距取 Grok 与聊天按钮的真实间距——全程不硬编码任何数值，X 改版也不失效。
  // 官方按钮未渲染或还在入场动画（坐标无效）时先隐藏，避免刷新初期错位闪现。
  const fabState = { grok: null, key: '' };

  function positionFab(btn, forceStyle) {
    const grok = document.querySelector('button[aria-label="Grok"]');
    const r = grok && grok.getBoundingClientRect();
    const valid = r && r.width > 0 && r.height > 0 &&
      r.left >= 0 && r.top >= 0 &&
      r.right <= window.innerWidth && r.bottom <= window.innerHeight;
    if (!valid) {
      btn.style.visibility = 'hidden';
      fabState.grok = null; fabState.key = '';
      return false;
    }
    const chat = document.querySelector(
      'button[aria-label="聊天"], button[aria-label="消息"], button[aria-label="Chat"], button[aria-label="Messages"]');
    // 间距 = Grok 与聊天按钮的真实间距（动态测量，不写死）
    let gap = 12;
    if (chat) {
      const cr = chat.getBoundingClientRect();
      if (cr.top > r.bottom) gap = Math.max(6, cr.top - r.bottom);
    }
    const right = window.innerWidth - r.right;
    const bottom = window.innerHeight - r.top + gap;
    const key = [right, bottom, r.width, r.height].join(',');
    // 坐标没变就不写样式，避免逐帧触发重排
    if (grok !== fabState.grok || key !== fabState.key || forceStyle) {
      const cs = getComputedStyle(grok);
      btn.style.width = r.width + 'px';
      btn.style.height = r.height + 'px';
      btn.style.borderRadius = cs.borderRadius;
      btn.style.background = cs.backgroundColor;
      btn.style.color = cs.color;
      btn.style.boxShadow = cs.boxShadow;
      btn.style.borderTop = cs.borderTop; btn.style.borderRight = cs.borderRight;
      btn.style.borderBottom = cs.borderBottom; btn.style.borderLeft = cs.borderLeft;
      btn.style.right = right + 'px';
      btn.style.bottom = bottom + 'px';
      fabState.grok = grok; fabState.key = key;
    }
    btn.style.visibility = 'visible';
    return true;
  }

  // 兜底：页面上确实没有官方按钮时的默认固定位置
  function fallbackFab(btn) {
    btn.style.width = '50px'; btn.style.height = '50px';
    btn.style.borderRadius = '16px';
    btn.style.background = 'rgba(22, 24, 28, 0.96)'; btn.style.color = '#fff';
    btn.style.border = '1px solid rgba(255,255,255,0.16)';
    btn.style.boxShadow = '0 0 14px rgba(255,255,255,0.10), 0 4px 14px rgba(0,0,0,0.45)';
    btn.style.right = '16px'; btn.style.bottom = '96px';
    btn.style.visibility = 'visible';
  }

  function mountFab(btn) {
    if (!document.body.contains(btn)) document.body.appendChild(btn);
    positionFab(btn);
    console.log(PREFIX, '悬浮按钮已挂载（跟随官方坐标）');
  }

  function createCard() {
    const card = document.createElement('div');
    card.className = 'xt-card';
    card.innerHTML =
      '<div class="xt-head">' +
        '<div class="xt-title"><span class="xt-title-dot"></span>X Tools 推特小工具</div>' +
        '<button class="xt-close" type="button" aria-label="关闭">×</button>' +
      '</div>' +
      '<div class="xt-list"></div>' +
      '<div class="xt-foot">' +
        '<span>v1.6.2</span>' +
        '<a href="https://github.com/xifandev/Tampermonkey" target="_blank" rel="noopener">仓库 ↗</a>' +
      '</div>';
    card.querySelector('.xt-close').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      Panel.toggle(false);
    });
    // 阻止面板内点击冒泡触发外层关闭
    card.addEventListener('click', (e) => e.stopPropagation());
    return card;
  }

  /* ============================================================
   * 3. ApiHub —— 共享网络 Hook
   * 所有模块共用一次响应读取/JSON 解析，避免重复包装 fetch 和 XHR。
   * 同时只在内存中捕获页面自己的认证头，供用户主动操作时使用。
   * ============================================================ */

  const ApiHub = {
    listeners: new Set(),
    originalFetch: null,
    authorization: '',
    csrfToken: '',
    hooked: false,

    addListener(fn) {
      this.listeners.add(fn);
    },

    captureHeader(name, value) {
      const key = String(name).toLowerCase();
      if (key === 'authorization' && /^Bearer\s+/i.test(value)) {
        this.authorization = value;
      } else if (key === 'x-csrf-token' && value) {
        this.csrfToken = value;
      }
    },

    captureHeaders(headers) {
      if (!headers) return;
      try {
        if (typeof headers.forEach === 'function') {
          headers.forEach((value, key) => this.captureHeader(key, value));
        } else if (Array.isArray(headers)) {
          for (const pair of headers) {
            if (pair && pair.length >= 2) this.captureHeader(pair[0], pair[1]);
          }
        } else {
          for (const [key, value] of Object.entries(headers)) this.captureHeader(key, value);
        }
      } catch (e) {}
    },

    emit(json) {
      for (const listener of this.listeners) {
        try { listener(json); } catch (e) {}
      }
    },

    parseResponse(text) {
      if (!text || (text[0] !== '{' && text[0] !== '[')) return;
      try { this.emit(JSON.parse(text)); } catch (e) {}
    },

    hookNetwork() {
      if (this.hooked) return;
      this.hooked = true;
      const isApiUrl = url => typeof url === 'string' && url.includes('/i/api/');

      if (typeof w.fetch === 'function') {
        const origFetch = w.fetch;
        this.originalFetch = origFetch;
        w.fetch = function (...args) {
          const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
          if (isApiUrl(url)) {
            ApiHub.captureHeaders(args[0]?.headers);
            ApiHub.captureHeaders(args[1]?.headers);
          }
          const p = origFetch.apply(this, args);
          try {
            if (isApiUrl(url)) {
              p.then(res => {
                res.clone().text().then(text => ApiHub.parseResponse(text)).catch(() => {});
              }).catch(() => {});
            }
          } catch (e) {}
          return p;
        };
      }

      const xhrProto = w.XMLHttpRequest?.prototype;
      if (!xhrProto) return;
      const origOpen = xhrProto.open;
      const origSend = xhrProto.send;
      const origSetRequestHeader = xhrProto.setRequestHeader;
      xhrProto.open = function (method, url, ...rest) {
        this.__xtApiUrl = String(url || '');
        return origOpen.call(this, method, url, ...rest);
      };
      xhrProto.setRequestHeader = function (name, value, ...rest) {
        if (isApiUrl(this.__xtApiUrl)) ApiHub.captureHeader(name, value);
        return origSetRequestHeader.call(this, name, value, ...rest);
      };
      xhrProto.send = function (...args) {
        try {
          if (isApiUrl(this.__xtApiUrl)) {
            this.addEventListener('load', function () {
              try { ApiHub.parseResponse(this.responseText); } catch (e) {}
            });
          }
        } catch (e) {}
        return origSend.apply(this, args);
      };
    },

    // 自有请求走原始 fetch，避免被 Hook 再次解析或触发额外逻辑。
    fetch(...args) {
      const fn = this.originalFetch || w.fetch;
      return fn.apply(w, args);
    },
  };

  /* ============================================================
   * 4. AdBlocker —— 广告屏蔽（纯 DOM 隐藏，防封号）
   * 原则：只在前端隐藏 HTML，不拦截网络请求、不模拟点击举报/拉黑，
   *       X 服务端完全感知不到，不触发风控。
   * 识别：X 给广告推文打了 [data-testid="placementTracking"] 追踪标记，
   *       命中即隐藏整条推文。
   * ============================================================ */

  const AdBlocker = {
    observer: null,
    enabled: false,

    init() {
      registerFeature({
        key: 'hideAds',
        label: '广告屏蔽',
        desc: '隐藏推广推文（纯前端，不影响账号）',
        get: () => Settings.get('hideAds'),
        set: (v) => Settings.set('hideAds', v),
        onToggle: (v) => this.setEnabled(v),
      });
      this.setEnabled(Settings.get('hideAds'));
    },

    setEnabled(on) {
      this.enabled = on;
      if (on) this.start();
      else this.stop();
    },

    start() {
      if (this.observer) return;
      const scan = () => this.scan(document);
      // 先扫一次已有内容
      if (document.body) scan();
      this.observer = new MutationObserver((muts) => {
        if (!this.enabled) return;
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1) this.scan(n);
          }
        }
      });
      if (document.body) this.observer.observe(document.body, { childList: true, subtree: true });
      else {
        const o = new MutationObserver(() => {
          if (document.body) { o.disconnect(); scan(); this.observer.observe(document.body, { childList: true, subtree: true }); }
        });
        o.observe(document.documentElement, { childList: true, subtree: true });
      }
    },

    stop() {
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      // 已隐藏的不恢复（避免布局抖动），刷新页面后自然恢复
    },

    // 在节点范围内找推广推文并隐藏
    scan(root) {
      try {
        // placementTracking 是 X 专给广告位打的追踪容器，稳定可靠
        const tracks = root.querySelectorAll ?
          root.querySelectorAll('[data-testid="placementTracking"]') : [];
        for (const t of tracks) {
          // 只隐藏明确的广告推文；文章页可能复用追踪标记，不能隐藏任意 article 或整片容器
          const tweet = t.closest('article[data-testid="tweet"]');
          if (tweet && tweet.style.display !== 'none') {
            tweet.style.display = 'none';
            console.debug(PREFIX, '已隐藏推广推文');
          }
        }
      } catch (e) { /* 忽略 */ }
    },
  };

  /* ============================================================
   * 5. VideoDL —— 推文视频下载（原有逻辑，保留）
   * ============================================================ */

  const VideoDL = {
    observer: null,
    enabled: false,
    videoCache: new Map(),

    init() {
      // hook GraphQL 已在 document-start 阶段单独调用（见文件末尾），此处不再重复
      this.injectButtonStyle();
      registerFeature({
        key: 'videoDownload',
        label: '视频下载',
        desc: '推文操作栏加下载按钮（最高画质 MP4）',
        get: () => Settings.get('videoDownload'),
        set: (v) => Settings.set('videoDownload', v),
        onToggle: (v) => this.setEnabled(v),
      });
      this.setEnabled(Settings.get('videoDownload'));
    },

    setEnabled(on) {
      this.enabled = on;
      if (on) this.startObserver();
      else this.stopObserver();
    },

    startObserver() {
      if (this.observer) return;
      const schedule = () => {
        if (this._t) return;
        this._t = setTimeout(() => {
          this._t = null;
          document.querySelectorAll('article[data-testid="tweet"]').forEach(a => this.addButton(a));
        }, 150);
      };
      schedule();
      this.observer = new MutationObserver(schedule);
      if (document.body) this.observer.observe(document.body, { childList: true, subtree: true });
      else {
        const o = new MutationObserver(() => {
          if (document.body) { o.disconnect(); schedule(); this.observer.observe(document.body, { childList: true, subtree: true }); }
        });
        o.observe(document.documentElement, { childList: true, subtree: true });
      }
    },

    stopObserver() {
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      // 移除已注入的按钮
      document.querySelectorAll('.tvd-btn').forEach(b => b.closest('.tvd-holder')?.remove() || b.remove());
    },

    hookNetwork() {
      ApiHub.addListener(json => this.extractFromJson(json));
    },

    extractFromJson(json) {
      try {
        (function walk(node) {
          if (!node || typeof node !== 'object') return;
          const media = node.extended_entities?.media || node.entities?.media;
          if (Array.isArray(media)) {
            for (const m of media) {
              const variants = m.video_info?.variants;
              if (!Array.isArray(variants)) continue;
              const mp4s = variants
                .filter(v => v.content_type === 'video/mp4' && v.url)
                .map(v => ({ url: v.url, bitrate: v.bitrate || 0 }))
                .sort((a, b) => b.bitrate - a.bitrate);
              if (!mp4s.length) continue;
              const id = node.rest_id || node.legacy?.id_str;
              if (id && /^\d+$/.test(String(id))) {
                VideoDL.videoCache.set(String(id), mp4s);
                console.debug(PREFIX, '已捕获视频:', id);
              }
            }
          }
          for (const k of Object.keys(node)) {
            const c = node[k];
            if (c && typeof c === 'object') walk(c);
          }
        })(json);
      } catch (e) {}
    },

    injectButtonStyle() {
      if (document.getElementById('tvd-style')) return;
      const style = document.createElement('style');
      style.id = 'tvd-style';
      style.textContent = `
        .tvd-btn {
          display: inline-flex; align-items: center; justify-content: center;
          gap: 6px; height: 40px; padding: 0 14px; margin: -6px 0 -6px 4px;
          border: 1.5px solid rgb(83, 100, 113); border-radius: 9999px;
          background: transparent; color: rgb(231, 233, 234);
          font-size: 14px; font-weight: 700; font-family: inherit;
          cursor: pointer; white-space: nowrap;
          transition: background-color 0.2s, color 0.2s, border-color 0.2s;
        }
        .tvd-btn:hover {
          background-color: rgba(29, 155, 240, 0.15);
          border-color: rgb(29, 155, 240);
          color: rgb(29, 155, 240);
        }
        .tvd-btn:disabled { cursor: wait; opacity: 0.75; }
        .tvd-spin { animation: tvd-rotate 0.8s linear infinite; }
        @keyframes tvd-rotate { to { transform: rotate(360deg); } }
      `;
      (document.head || document.documentElement).appendChild(style);
    },

    genFilename() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${Math.random().toString(36).slice(2,8)}.mp4`;
    },

    ICON_DOWNLOAD: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 15.586l-4.293-4.293 1.414-1.414L11 11.758V3h2v8.758l1.879-1.879 1.414 1.414L12 15.586zM5 19h14v2H5v-2z"/></svg>',
    ICON_LOADING: '<svg class="tvd-spin" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke-opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>',

    getTweetId(article) {
      for (const a of article.querySelectorAll('a[href*="/status/"]')) {
        const m = (a.getAttribute('href') || '').match(/\/status\/(\d+)/);
        if (m) return m[1];
      }
      return null;
    },

    hasVideo(article) {
      return !!article.querySelector('video, [data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="playButton"]');
    },

    addButton(article) {
      if (article.querySelector('.tvd-btn')) return;
      const group = article.querySelector('div[role="group"]');
      if (!group) return;
      const tweetId = this.getTweetId(article);
      if (!tweetId) return;
      if (!this.hasVideo(article) && !this.videoCache.has(tweetId)) return;
      const btn = document.createElement('button');
      btn.className = 'tvd-btn';
      btn.type = 'button';
      btn.title = '下载视频（最高画质）';
      btn.setAttribute('aria-label', '下载视频');
      btn.innerHTML = this.ICON_DOWNLOAD + '<span>下载</span>';
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.handleDownload(btn, tweetId);
      });
      const holder = document.createElement('div');
      holder.className = 'tvd-holder';
      holder.style.display = 'flex';
      holder.appendChild(btn);
      group.appendChild(holder);
    },

    async handleDownload(btn, tweetId) {
      btn.disabled = true;
      btn.innerHTML = this.ICON_LOADING + '<span>下载中</span>';
      try {
        const { variants, errors } = await this.resolveVideo(tweetId);
        if (!variants) {
          alert('未能获取到视频地址：\n\n' + errors.join('\n') +
            '\n\n可尝试：\n1. 刷新页面让推文重新加载；\n2. 点开推文详情页再下载；\n3. 敏感/受限内容需登录会话；\n4. 仅 m3u8 流可用 yt-dlp。');
          return;
        }
        const result = await this.downloadWithFallback(variants[0].url, this.genFilename());
        if (!result.ok) {
          alert('自动下载通道均未成功，已在新标签页打开视频，可右键/Ctrl+S 保存。\n\n失败原因：\n' + result.errors.join('\n'));
        }
      } catch (e) {
        alert('下载失败：' + (e?.message || e));
      } finally {
        btn.disabled = false;
        btn.innerHTML = this.ICON_DOWNLOAD + '<span>下载</span>';
      }
    },

    calcToken(id) {
      return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
    },

    gmGetJson(url) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET', url, timeout: 20000,
          onload: (r) => {
            if (r.status < 200 || r.status >= 300) { reject(new Error(`HTTP ${r.status}`)); return; }
            try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(new Error('返回非 JSON')); }
          },
          onerror: (r) => reject(new Error(`网络错误${r?.status ? ' HTTP ' + r.status : ''}`)),
          ontimeout: () => reject(new Error('请求超时')),
        });
      });
    },

    async resolveVideo(tweetId) {
      const cached = this.videoCache.get(tweetId);
      if (cached) return { variants: cached };
      const errors = [];
      const sources = [
        ['Syndication', async () => {
          const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=zh-cn&token=${this.calcToken(tweetId)}`;
          try {
            const r = await fetch(url, { credentials: 'omit' });
            if (r.ok) return this.parseSyndication(await r.json());
            throw new Error(`HTTP ${r.status}`);
          } catch (e) {
            return this.parseSyndication(await this.gmGetJson(url));
          }
        }],
        ['FixTweet', async () => this.parseFxTwitter(await this.gmGetJson(`https://api.fxtwitter.com/status/${tweetId}`))],
      ];
      for (const [name, fn] of sources) {
        try {
          const variants = await fn();
          this.videoCache.set(tweetId, variants);
          return { variants };
        } catch (e) { errors.push(`${name}: ${e?.message || e}`); }
      }
      return { variants: null, errors };
    },

    parseSyndication(json) {
      const media = (json.mediaDetails || []).find(m => m.video_info);
      const variants = media?.video_info?.variants || [];
      const mp4s = variants.filter(v => (v.type === 'video/mp4' || v.content_type === 'video/mp4') && (v.url || v.src))
        .map(v => ({ url: v.url || v.src, bitrate: v.bitrate || 0 })).sort((a, b) => b.bitrate - a.bitrate);
      if (!mp4s.length) throw new Error('无 MP4 源');
      return mp4s;
    },

    parseFxTwitter(json) {
      const tweet = json.tweet || {};
      const videos = tweet.media?.videos || (tweet.media?.all || []).filter(m => m.type === 'video' || m.type === 'gif');
      const mp4s = (videos || []).filter(v => v.url)
        .map(v => ({ url: v.url, bitrate: (v.width || 0) * (v.height || 0) })).sort((a, b) => b.bitrate - a.bitrate);
      if (!mp4s.length) throw new Error('无 MP4 源');
      return mp4s;
    },

    saveBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.style.display = 'none';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },

    async downloadWithFallback(url, filename) {
      const errors = [];
      const channels = [
        ['GM_download', () => new Promise((resolve, reject) => {
          if (typeof GM_download !== 'function') { reject(new Error('不支持 GM_download')); return; }
          GM_download({
            url, name: filename, headers: { 'Referer': 'https://x.com/' },
            onload: () => resolve(), onerror: (e) => reject(new Error('原生下载失败' + (e?.error ? `(${e.error})` : ''))),
            ontimeout: () => reject(new Error('原生下载超时')),
          });
        })],
        ['GM_xhr', () => new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'GET', url, responseType: 'blob', headers: { 'Referer': 'https://x.com/' }, timeout: 180000,
            onload: (r) => {
              if (r.status < 200 || r.status >= 300) { reject(new Error(`HTTP ${r.status}`)); return; }
              try { this.saveBlob(r.response, filename); resolve(); } catch (e) { reject(e); }
            },
            onerror: (r) => reject(new Error(`网络错误${r?.status ? ' HTTP ' + r.status : ''}`)),
            ontimeout: () => reject(new Error('请求超时')),
          });
        })],
        ['pageFetch', async () => {
          const r = await fetch(url, { credentials: 'omit' });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          this.saveBlob(await r.blob(), filename);
        }],
      ];
      for (const [name, fn] of channels) {
        try { await fn(); console.debug(PREFIX, '下载成功，通道:', name); return { ok: true }; }
        catch (e) { errors.push(`${name}: ${e?.message || e}`); }
      }
      window.open(url, '_blank', 'noopener');
      return { ok: false, errors };
    },
  };

  /* ============================================================
   * 6. Follow —— 时间线关注状态 + 手动一键关注
   * 状态优先来自页面自身的 GraphQL/REST 响应；未知时才批量只读查询。
   * 唯一写操作由用户点击触发，不做自动关注、批量关注或取关。
   * ============================================================ */

  const Follow = {
    CACHE_KEY: 'xt_follow_cache_v2',  // v1 缓存含 legacy.following 误判的 false，弃用
    CACHE_TTL: 12 * 3600 * 1000,
    MAX_CACHE: 1000,
    LOOKUP_BATCH: 60,
    LOOKUP_INTERVAL: 2500,
    PENDING_LOOKUP_MAX: 200,
    RESERVED_PATHS: new Set([
      'home', 'explore', 'notifications', 'messages', 'i', 'settings',
      'search', 'compose', 'intent', 'account', 'welcome', 'status',
      'hashtag', 'lists', 'communities', 'jobs', 'download', 'tos', 'privacy',
    ]),
    // X Web 客户端公开 Bearer（页面前端写死，非用户凭证），仅用于 REST 兜底。
    PUBLIC_BEARER: 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
    FOLLOW_WORDS: ['follow', '关注', 'seguir', 'suivre', 'フォロー'],
    UNFOLLOW_WORDS: ['unfollow', '取消关注', '取消關注', 'フォロー解除', 'dejar de seguir', 'ne plus suivre', 'entfolgen'],
    EXCLUDE_WORDS: ['mute', 'block', '静音', '屏蔽', 'list', '列表', 'not interested', '不感兴趣'],
    MORE_LABELS: new Set(['more', '更多', '更多选项', '更多選項', 'その他', 'más', 'mehr', 'plus']),

    enabled: false,
    cacheLoaded: false,
    observer: null,
    scanTimer: null,
    rescanTimer: null,
    lookupTimer: null,
    saveTimer: null,
    cooldownTimer: null,
    peekTimer: null,
    confirmTimer: null,
    followState: new Map(),
    userIds: new Map(),
    pendingLookup: new Set(),
    weakState: new Set(),          // legacy.following 等低可信来源，须经菜单复核
    peekQueue: new Set(),
    peekArticles: new Map(),
    peekDone: new Set(),
    peekBusy: false,
    confirmUnfollow: new Map(),   // name -> 确认过期时间
    locallyFollowed: new Set(),
    locallyUnfollowed: new Set(),
    selfName: null,
    lookupPausedUntil: 0,
    followInFlight: false,
    followDisabledUntil: 0,

    hookNetwork() {
      this.enabled = Settings.get('quickFollow');
      this.loadCache();
      ApiHub.addListener(json => {
        if (this.enabled) this.extractFromJson(json);
      });
    },

    init() {
      this.injectStyle();
      registerFeature({
        key: 'quickFollow',
        label: '快捷关注',
        desc: '作者名旁显示关注/取关，自动探测已关注状态',
        get: () => Settings.get('quickFollow'),
        set: (v) => Settings.set('quickFollow', v),
        onToggle: (v) => this.setEnabled(v),
      });
      this.installClickHandler();
      this.setEnabled(Settings.get('quickFollow'));
    },

    normalize(name) {
      return typeof name === 'string' ? name.trim().replace(/^@/, '').toLowerCase() : '';
    },

    loadCache() {
      if (this.cacheLoaded) return;
      this.cacheLoaded = true;
      try {
        const cache = GM_getValue(this.CACHE_KEY, {});
        const now = Date.now();
        const entries = Object.entries(cache || {})
          .filter(([, v]) => v && typeof v.f === 'boolean' && now - v.t < this.CACHE_TTL)
          .slice(-this.MAX_CACHE);
        for (const [name, value] of entries) {
          const key = this.normalize(name);
          if (!key || this.followState.has(key)) continue;
          this.followState.set(key, value.f);
          if (value.id) this.userIds.set(key, String(value.id));
        }
      } catch (e) {}
    },

    saveCache() {
      if (!this.cacheLoaded) return;
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        try {
          const cache = {};
          const entries = [...this.followState.entries()].slice(-this.MAX_CACHE);
          for (const [name, following] of entries) {
            if (this.weakState.has(name)) continue;  // 低可信状态不落盘，避免错误缓存 12 小时
            cache[name] = { f: following, t: Date.now() };
            const id = this.userIds.get(name);
            if (id) cache[name].id = id;
          }
          GM_setValue(this.CACHE_KEY, cache);
        } catch (e) {}
      }, 800);
    },

    setState(name, following, restId = '', refresh = true, weak = false) {
      const key = this.normalize(name);
      if (!key || typeof following !== 'boolean') return false;
      // 用户操作后的短路保护：忽略在途的旧响应，避免按钮闪回。
      if (!following && this.locallyFollowed.has(key)) return false;
      if (following && this.locallyUnfollowed.has(key)) return false;
      if (restId) this.userIds.set(key, String(restId));
      // 低可信来源不得覆盖已确认结果；确认来源可覆盖并清除低可信标记。
      if (weak && this.followState.has(key) && !this.weakState.has(key)) return false;
      if (weak) this.weakState.add(key);
      else this.weakState.delete(key);
      this.pendingLookup.delete(key);
      this.peekQueue.delete(key);
      if (this.followState.get(key) === following && !weak) return false;
      this.followState.set(key, following);
      this.saveCache();
      if (refresh) this.refreshBadges(key);
      return true;
    },

    readUser(node) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
      const legacy = node.legacy && typeof node.legacy === 'object' ? node.legacy : null;
      const relationship = node.relationship_perspectives;
      const name = this.normalize(node.core?.screen_name || legacy?.screen_name || node.screen_name);
      let following;
      let weak = false;
      if (relationship && typeof relationship.following === 'boolean') {
        following = relationship.following;
      } else if (typeof node.following === 'boolean') {
        following = node.following;
      } else if (typeof node.is_following === 'boolean') {
        following = node.is_following;
      } else if (legacy && typeof legacy.following === 'boolean') {
        // 时间线响应不带 relationship_perspectives，legacy.following 常为 false 占位。
        following = legacy.following;
        weak = true;
      }
      if (!name || typeof following !== 'boolean') return null;
      return { name, following, id: node.rest_id || legacy?.id_str || '', weak };
    },

    extractFromJson(json) {
      if (!json || typeof json !== 'object') return;
      const pending = [json];
      const visited = new WeakSet();
      let visits = 0;
      let changed = false;
      while (pending.length && visits++ < 50000) {
        const node = pending.pop();
        if (!node || typeof node !== 'object' || visited.has(node)) continue;
        visited.add(node);
        const user = this.readUser(node);
        if (user && this.setState(user.name, user.following, user.id, false, user.weak)) changed = true;
        for (const child of Object.values(node)) {
          if (child && typeof child === 'object') pending.push(child);
        }
      }
      if (changed) this.refreshBadges();
    },

    getCookie(name) {
      const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
      if (!match) return null;
      try { return decodeURIComponent(match[1]); } catch (e) { return match[1]; }
    },

    authHeaders() {
      const csrf = ApiHub.csrfToken || this.getCookie('ct0');
      if (!csrf) return null;
      // 页面请求捕获不到 authorization 时回退到 X Web 公开客户端 token，
      // 否则 REST 兜底永远发不出去（旧版"点了没反应"的根因之一）。
      return {
        authorization: ApiHub.authorization || this.PUBLIC_BEARER,
        'x-csrf-token': csrf,
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-client-language': 'zh-cn',
      };
    },

    queueLookup(name) {
      const key = this.normalize(name);
      // 低可信状态仍要复核；已确认状态才跳过。
      if (!key || this.pendingLookup.has(key)) return;
      if (this.followState.has(key) && !this.weakState.has(key)) return;
      if (this.selfName && key === this.selfName) return;
      if (this.pendingLookup.size >= this.PENDING_LOOKUP_MAX) {
        const oldest = this.pendingLookup.values().next().value;
        if (oldest !== undefined) this.pendingLookup.delete(oldest);
      }
      this.pendingLookup.add(key);
      this.scheduleLookup();
    },

    scheduleLookup() {
      if (!this.enabled || this.lookupTimer) return;
      const wait = Math.max(
        this.LOOKUP_INTERVAL + Math.floor(Math.random() * 1500),
        this.lookupPausedUntil - Date.now()
      );
      this.lookupTimer = setTimeout(() => this.runLookup(), wait);
    },

    async runLookup() {
      this.lookupTimer = null;
      if (!this.enabled || !this.pendingLookup.size) return;
      if (Date.now() < this.lookupPausedUntil) { this.scheduleLookup(); return; }
      const headers = this.authHeaders();
      if (!headers) {
        // 等页面自己的首个 API 请求带来认证头，期间不发送任何请求。
        this.lookupTimer = setTimeout(() => this.runLookup(), 5000);
        return;
      }
      const batch = [...this.pendingLookup].slice(0, this.LOOKUP_BATCH);
      try {
        const res = await ApiHub.fetch(
          location.origin + '/i/api/1.1/friendships/lookup.json?screen_name=' + encodeURIComponent(batch.join(',')),
          { headers, credentials: 'include' }
        );
        if (res.ok) {
          const users = await res.json();
          const returned = new Set();
          let changed = false;
          for (const user of Array.isArray(users) ? users : []) {
            const name = this.normalize(user.screen_name);
            if (!name) continue;
            returned.add(name);
            const following = Array.isArray(user.connections) && user.connections.includes('following');
            if (this.setState(name, following, user.id_str, false)) changed = true;
          }
          // 已删除、受限等未返回的账号不再反复查询。
          for (const name of batch) {
            if (!returned.has(name)) this.pendingLookup.delete(name);
          }
          if (changed) this.refreshBadges();
        } else if (res.status === 429) {
          const resetAt = Number(res.headers.get('x-rate-limit-reset')) * 1000;
          this.lookupPausedUntil = resetAt > Date.now() ? resetAt : Date.now() + 60000;
        }
      } catch (e) {}
      if (this.pendingLookup.size) this.scheduleLookup();
    },

    injectStyle() {
      if (document.getElementById('xt-follow-style')) return;
      const style = document.createElement('style');
      style.id = 'xt-follow-style';
      style.textContent = `
        .xt-follow-badge{display:inline-flex!important;align-items:center;align-self:center;vertical-align:middle;margin-left:8px;flex-shrink:0;font-family:inherit}
        .xt-follow-btn{cursor:pointer;border:none;border-radius:9999px;padding:3px 12px;font-size:12px;font-weight:700;line-height:16px;transition:background-color .15s,opacity .15s;white-space:nowrap}
        .xt-follow-btn:disabled{cursor:default;opacity:.6}
        .xt-follow-btn.xt-dark{background:#eff3f4;color:#0f1419}
        .xt-follow-btn.xt-dark:hover{background:#d7dbdc}
        .xt-follow-btn.xt-light{background:#0f1419;color:#fff}
        .xt-follow-btn.xt-light:hover{background:#272c30}
        .xt-follow-btn.xt-unfollow{background:transparent;font-weight:500;border:1px solid}
        .xt-follow-btn.xt-unfollow.xt-dark{color:#71767b;border-color:#333639}
        .xt-follow-btn.xt-unfollow.xt-light{color:#536471;border-color:#cfd9de}
        .xt-follow-btn.xt-unfollow:hover{color:#f4212e;border-color:rgba(244,33,46,.45);background:rgba(244,33,46,.06)}
        .xt-follow-btn.xt-confirm{color:#f4212e;border-color:rgba(244,33,46,.55)}
        body.xt-silent-mode [role="menu"],
        body.xt-silent-mode [data-testid="Dropdown"],
        body.xt-silent-mode [data-testid="confirmationSheetDialog"],
        body.xt-silent-mode [data-testid="sheetDialog"],
        body.xt-silent-mode [role="dialog"],
        body.xt-silent-mode [role="alertdialog"],
        body.xt-silent-mode [data-slot="xds-modal-surface"],
        body.xt-silent-mode [data-slot="xds-modal-backdrop"]{opacity:0!important;transition:none!important}
      `;
      (document.head || document.documentElement).appendChild(style);
    },

    isDarkMode() {
      try {
        const channels = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g);
        if (!channels || channels.length < 3) return true;
        const luminance = 0.299 * +channels[0] + 0.587 * +channels[1] + 0.114 * +channels[2];
        return luminance < 128;
      } catch (e) { return true; }
    },

    refreshBadges(key) {
      const selector = key ? '[data-xt-follow="' + key + '"]' : '[data-xt-follow]';
      document.querySelectorAll(selector).forEach(badge => this.renderBadge(badge));
    },

    renderBadge(badge) {
      const name = this.normalize(badge.getAttribute('data-xt-follow'));
      badge.textContent = '';
      if (!name || (this.selfName && name === this.selfName)) return;
      const article = badge.closest('article, [role="article"]');
      let state = this.followState.get(name);
      if (state === undefined || this.weakState.has(name)) {
        // 时间线响应通常不带 relationship_perspectives，legacy.following 是 false 占位。
        // 用原生「···」菜单文本做权威复核，只读查询作为补充。
        this.queueLookup(name);
        if (article) this.queuePeek(name, article);
      }
      const theme = this.isDarkMode() ? 'xt-dark' : 'xt-light';
      const coolingDown = Date.now() < this.followDisabledUntil;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-xt-follow-user', name);
      if (state === true) {
        // 已关注：低调暗色「取关」，点击需二次确认防误触。
        const confirming = (this.confirmUnfollow.get(name) || 0) > Date.now();
        btn.className = 'xt-follow-btn xt-unfollow ' + (confirming ? 'xt-confirm ' : '') + theme;
        btn.setAttribute('data-xt-follow-action', 'unfollow');
        btn.setAttribute('aria-label', '取关 @' + name);
        btn.textContent = confirming ? '确认取关' : '取关';
      } else {
        btn.className = 'xt-follow-btn ' + theme;
        btn.setAttribute('data-xt-follow-action', 'follow');
        btn.setAttribute('aria-label', '关注 @' + name);
        if (state === undefined) btn.title = '关注状态未知，点击尝试关注';
        btn.textContent = coolingDown ? '限流中' : '关注';
      }
      btn.disabled = this.followInFlight || coolingDown;
      badge.appendChild(btn);
    },

    // ---- 原生「···」菜单：状态探测 + 动作执行（借鉴 X FollowFlow）----
    // X 新版写操作需要事务签名，直接 POST v1.1 REST 常失效；
    // 让 X 自己点菜单发请求最稳，REST 仅作兜底。
    findCaretButton(article) {
      if (!article || typeof article.querySelectorAll !== 'function') return null;
      const legacy = this.ownQuery(article, 'button[data-testid="caret"]');
      if (legacy) return legacy;
      try {
        const icon = this.ownQuery(article, 'button:has(use[href*="icon-more-dots"])');
        if (icon) return icon;
      } catch (e) {}
      for (const btn of article.querySelectorAll('button[aria-label], button[aria-haspopup="menu"], button[data-slot="xds-menu-trigger"]')) {
        // 只认本条帖子的按钮，排除嵌套引用推文，避免点错菜单。
        if (btn.closest('article, [role="article"]') !== article) continue;
        if (btn.closest('[data-engagement-action]')) continue;
        const label = (btn.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (this.MORE_LABELS.has(label)) return btn;
        if (btn.getAttribute('aria-haspopup') === 'menu' || btn.getAttribute('data-slot') === 'xds-menu-trigger') return btn;
      }
      return null;
    },

    findOpenMenu() {
      return document.querySelector('[role="menu"], [data-testid="Dropdown"]');
    },

    findConfirmButton() {
      const legacy = document.querySelector('[data-testid="confirmationSheetConfirm"]');
      if (legacy) return legacy;
      for (const modal of document.querySelectorAll('[role="dialog"], [role="alertdialog"], [data-slot="xds-modal-surface"]')) {
        const text = (modal.textContent || '').toLowerCase();
        if (!this.UNFOLLOW_WORDS.some(word => text.includes(word))) continue;
        for (const btn of modal.querySelectorAll('button, [role="button"]')) {
          const label = (btn.textContent || '').trim().toLowerCase();
          if (this.UNFOLLOW_WORDS.some(word => label.includes(word))) return btn;
        }
        const footer = modal.querySelectorAll('[data-slot="xds-modal-footer-actions"] button');
        if (footer.length) return footer[footer.length - 1];
      }
      return null;
    },

    triggerClick(el) {
      if (!el) return;
      const opts = { bubbles: true, cancelable: true, view: w };
      try {
        if (typeof w.PointerEvent === 'function') {
          el.dispatchEvent(new w.PointerEvent('pointerdown', opts));
          el.dispatchEvent(new w.PointerEvent('pointerup', opts));
        }
        el.dispatchEvent(new w.MouseEvent('mousedown', opts));
        el.dispatchEvent(new w.MouseEvent('mouseup', opts));
      } catch (e) {}
      el.click();
    },

    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },

    closeMenu(caret) {
      this.triggerClick(caret);
      try {
        document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      } catch (e) {}
    },

    // 静默打开菜单读文本："取消关注 @x" => 已关注；"关注 @x" => 未关注。
    async peekCaretState(article, name) {
      const caret = this.findCaretButton(article);
      if (!caret) return null;
      document.body.classList.add('xt-silent-mode');
      try {
        this.triggerClick(caret);
        let menu = null;
        for (let i = 0; i < 12; i++) {
          menu = this.findOpenMenu();
          if (menu) break;
          await this.sleep(25);
        }
        if (!menu) return null;
        const text = (menu.textContent || '').toLowerCase();
        let result = null;
        if (text.includes('@' + name)) {
          if (this.UNFOLLOW_WORDS.some(word => text.includes(word))) result = true;
          else if (this.FOLLOW_WORDS.some(word => text.includes(word))) result = false;
        }
        this.closeMenu(caret);
        return result;
      } catch (e) {
        return null;
      } finally {
        document.body.classList.remove('xt-silent-mode');
      }
    },

    queuePeek(name, article) {
      const key = this.normalize(name);
      if (!key || !article || this.peekDone.has(key) || this.peekQueue.has(key)) return;
      if (this.selfName && key === this.selfName) return;
      if (this.peekDone.size > 500) this.peekDone.clear();
      this.peekQueue.add(key);
      this.peekArticles.set(key, article);
      this.schedulePeek();
    },

    schedulePeek() {
      if (!this.enabled || this.peekBusy || this.peekTimer) return;
      this.peekTimer = setTimeout(() => {
        this.peekTimer = null;
        this.runPeek();
      }, 120);
    },

    async runPeek() {
      if (this.peekBusy || !this.peekQueue.size) return;
      this.peekBusy = true;
      const key = this.peekQueue.values().next().value;
      this.peekQueue.delete(key);
      this.peekDone.add(key);  // 立即标记，避免并发重绘导致重复开菜单
      const article = this.peekArticles.get(key);
      this.peekArticles.delete(key);
      try {
        if (article?.isConnected) {
          const state = await this.peekCaretState(article, key);
          if (typeof state === 'boolean') this.setState(key, state, '', true);
        }
      } catch (e) {} finally {
        this.peekBusy = false;
        if (this.peekQueue.size) this.schedulePeek();
      }
    },

    async executeViaCaret(article, name, wantFollow) {
      const caret = this.findCaretButton(article);
      if (!caret) return false;
      document.body.classList.add('xt-silent-mode');
      try {
        this.triggerClick(caret);
        let menu = null;
        for (let i = 0; i < 20; i++) {
          menu = this.findOpenMenu();
          if (menu) break;
          await this.sleep(40);
        }
        if (!menu) { this.closeMenu(caret); return false; }
        const items = menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], button, a, div[tabindex="0"]');
        let target = null;
        for (const item of items) {
          const text = (item.textContent || '').toLowerCase();
          if (this.EXCLUDE_WORDS.some(word => text.includes(word))) continue;
          const hasHandle = text.includes('@' + name);
          if (wantFollow) {
            const isFollow = this.FOLLOW_WORDS.some(word => text.includes(word)) &&
              !this.UNFOLLOW_WORDS.some(word => text.includes(word));
            if (isFollow && hasHandle) { target = item; break; }
            // 弱兜底：菜单项不带 @handle 时，只接受短文本且不含其他 handle 的项。
            if (isFollow && !target && text.length < 30 && !/@[a-z0-9_]{2,}/.test(text)) target = item;
          } else if (hasHandle && this.UNFOLLOW_WORDS.some(word => text.includes(word))) {
            target = item;
            break;
          }
        }
        if (!target) { this.closeMenu(caret); return false; }
        this.triggerClick(target);
        if (!wantFollow) {
          for (let i = 0; i < 20; i++) {
            const confirm = this.findConfirmButton();
            if (confirm) { this.triggerClick(confirm); break; }
            await this.sleep(40);
          }
        }
        await this.sleep(120);
        return true;
      } catch (e) {
        return false;
      } finally {
        document.body.classList.remove('xt-silent-mode');
      }
    },

    ownQuery(article, selector) {
      for (const el of article.querySelectorAll(selector)) {
        if (el.closest('article, [role="article"]') === article) return el;
      }
      return null;
    },

    userFromHref(href) {
      try {
        const url = new URL(href, location.origin);
        const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
        if (!match) return '';
        const name = this.normalize(match[1]);
        return this.RESERVED_PATHS.has(name) ? '' : name;
      } catch (e) { return ''; }
    },

    userFromAlt(alt) {
      const match = String(alt || '').trim().match(/^@([A-Za-z0-9_]{1,15})$/);
      return match ? this.normalize(match[1]) : '';
    },

    authorFromContainer(container) {
      if (!container || typeof container.querySelectorAll !== 'function') return null;
      for (const link of container.querySelectorAll('a[href]')) {
        const name = this.userFromHref(link.getAttribute('href'));
        if (name) return { name, container };
      }
      const match = (container.textContent || '').match(/@([A-Za-z0-9_]{1,15})/);
      if (match && !this.RESERVED_PATHS.has(this.normalize(match[1]))) {
        return { name: this.normalize(match[1]), container };
      }
      return null;
    },

    // 找 @handle 文本所在的最小元素（通常是名字行里的 span），用于定位徽标。
    findHandleElement(root) {
      try {
        const SHOW_TEXT = w.NodeFilter?.SHOW_TEXT || 4;
        const walker = document.createTreeWalker(root, SHOW_TEXT, null);
        let node;
        while ((node = walker.nextNode())) {
          // 允许 "@handle · 时间" 同一节点，但排除正文里的 @提及。
          const match = (node.nodeValue || '').trim().match(/^@([A-Za-z0-9_]{1,15})(?=\s*[·•]|\s*$)/);
          if (!match) continue;
          const parent = node.parentElement;
          if (parent && parent !== root && !this.RESERVED_PATHS.has(this.normalize(match[1]))) return parent;
        }
      } catch (e) {}
      return null;
    },

    extractAuthor(article) {
      // 不依赖 X 内部 testid / class：改版移除 data-testid 后仍可工作。
      // 作者 = 名字行（或整条帖子）里第一条指向 /{handle} 的链接。
      const userName = this.ownQuery(article, '[data-testid="User-Name"]');
      let link = null;
      let name = '';
      let scanned = 0;
      for (const a of (userName || article).querySelectorAll('a[href]')) {
        if (++scanned > 30) break;
        const candidate = this.userFromHref(a.getAttribute('href'));
        if (candidate) { link = a; name = candidate; break; }
      }
      if (!name && userName) name = this.authorFromContainer(userName)?.name || '';
      if (!name) {
        const avatar = this.ownQuery(article, 'img[alt^="@"]');
        if (avatar) name = this.userFromAlt(avatar.getAttribute('alt'));
      }
      if (!name) {
        const match = (userName?.textContent || article.textContent || '')
          .match(/@([A-Za-z0-9_]{1,15})/);
        if (match) name = this.normalize(match[1]);
      }
      if (!name || this.RESERVED_PATHS.has(name)) return null;

      let row = null;
      let before = null;
      if (userName && userName.firstElementChild) {
        // 旧版：徽标跟在显示名行末尾，保持原有视觉位置。
        row = userName.firstElementChild;
      } else {
        const handleEl = this.findHandleElement(article);
        if (handleEl) {
          const anchor = handleEl.closest('a');
          const ref = anchor || handleEl;
          row = ref.parentElement;
          before = ref.nextSibling;
        } else if (link) {
          // 再兜底：直接插到作者链接之后。
          row = link.parentElement;
          before = link.nextSibling;
        }
      }
      if (!row) return null;
      return { name, row, before };
    },

    detectSelf() {
      let name = '';
      const profile = document.querySelector('a[data-testid="AppTabBar_Profile_Link"][href]');
      if (profile) name = this.userFromHref(profile.getAttribute('href'));
      if (!name) {
        const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
        const match = (switcher?.textContent || '').match(/@([A-Za-z0-9_]{1,15})/);
        if (match) name = this.normalize(match[1]);
      }
      if (!name) {
        // 只认导航区里 aria-label 明确的“个人资料/Profile”，避免误把帖内链接当自己。
        for (const anchor of document.querySelectorAll('nav a[href^="/"], [role="navigation"] a[href^="/"]')) {
          const label = (anchor.getAttribute('aria-label') || '')
            .replace(/\s+/g, ' ').trim().toLowerCase();
          if (!(label === '个人资料' || /^profile(?:\s|,|@|$)/.test(label))) continue;
          const candidate = this.userFromHref(anchor.getAttribute('href'));
          if (candidate) { name = candidate; break; }
        }
      }
      if (name && name !== this.selfName) {
        this.selfName = name;
        this.refreshBadges();
      }
    },

    processArticle(article) {
      const author = this.extractAuthor(article);
      let badge = this.ownQuery(article, '[data-xt-follow]');
      if (!author) { badge?.remove(); return; }
      if (this.selfName && author.name === this.selfName) { badge?.remove(); return; }
      if (badge && badge.getAttribute('data-xt-follow') !== author.name) {
        badge.remove();
        badge = null;
      }
      if (badge) {
        // React 重渲染可能清空外部插入的节点，内容丢了就重建，避免留下空白徽标。
        if (!badge.firstChild) this.renderBadge(badge);
        return;
      }
      badge = document.createElement('span');
      badge.className = 'xt-follow-badge';
      badge.setAttribute('data-xt-follow', author.name);
      if (author.before && author.before.parentNode === author.row) {
        author.row.insertBefore(badge, author.before);
      } else {
        author.row.appendChild(badge);
      }
      this.renderBadge(badge);
    },

    scan() {
      if (!this.enabled) return;
      this.detectSelf();
      // 不预设 testid：任何 article / role=article 都尝试识别作者，
      // 识别不到的容器由 processArticle 自行跳过。个人资料页不再短路清空。
      document.querySelectorAll('article, [role="article"]').forEach(article => {
        try { this.processArticle(article); } catch (e) {}
      });
    },

    scheduleScan() {
      if (this.scanTimer) return;
      this.scanTimer = setTimeout(() => {
        this.scanTimer = null;
        this.scan();
      }, 120);
    },

    setEnabled(on) {
      this.enabled = on;
      if (!on) {
        this.observer?.disconnect();
        this.observer = null;
        clearTimeout(this.scanTimer);
        clearTimeout(this.lookupTimer);
        clearInterval(this.rescanTimer);
        clearTimeout(this.peekTimer);
        clearTimeout(this.confirmTimer);
        this.scanTimer = null;
        this.lookupTimer = null;
        this.rescanTimer = null;
        this.peekTimer = null;
        this.peekBusy = false;
        this.peekQueue.clear();
        this.peekArticles.clear();
        this.confirmUnfollow.clear();
        this.pendingLookup.clear();
        document.body.classList.remove('xt-silent-mode');
        document.querySelectorAll('[data-xt-follow]').forEach(badge => badge.remove());
        return;
      }
      this.peekDone.clear();
      this.detectSelf();
      this.scan();
      if (!this.observer) {
        this.observer = new MutationObserver(() => this.scheduleScan());
        this.observer.observe(document.body, { childList: true, subtree: true });
      }
      if (!this.rescanTimer) this.rescanTimer = setInterval(() => this.scan(), 2500);
    },

    installClickHandler() {
      const shield = (e) => {
        if (e.target?.closest?.('.xt-follow-badge')) e.stopPropagation();
      };
      document.addEventListener('mousedown', shield, true);
      document.addEventListener('click', async (e) => {
        const btn = e.target?.closest?.('[data-xt-follow-user]');
        if (!btn) { shield(e); return; }
        e.preventDefault();
        e.stopPropagation();
        if (this.followInFlight || Date.now() < this.followDisabledUntil) return;
        const name = this.normalize(btn.getAttribute('data-xt-follow-user'));
        if (!name) return;
        const wantFollow = btn.getAttribute('data-xt-follow-action') !== 'unfollow';
        const article = btn.closest('article, [role="article"]');

        // 取关两步确认：3 秒内再点才执行，防刷推误触。
        if (!wantFollow && (this.confirmUnfollow.get(name) || 0) <= Date.now()) {
          this.confirmUnfollow.set(name, Date.now() + 3000);
          this.refreshBadges(name);
          clearTimeout(this.confirmTimer);
          this.confirmTimer = setTimeout(() => {
            this.confirmUnfollow.delete(name);
            this.refreshBadges(name);
          }, 3100);
          return;
        }
        this.confirmUnfollow.delete(name);

        this.followInFlight = true;
        this.setButtonsDisabled(true);
        btn.textContent = '…';
        let result = { ok: false, status: 0, resetAt: 0 };
        try {
          result = await this.followUser(name, article, wantFollow);
        } catch (err) {} finally {
          this.followInFlight = false;
        }
        // 所有分支都要恢复其余按钮，否则后续点击全部"没反应"。
        this.setButtonsDisabled(false);
        if (result.ok) {
          if (wantFollow) {
            this.locallyFollowed.add(name);
            this.locallyUnfollowed.delete(name);
          } else {
            this.locallyUnfollowed.add(name);
            this.locallyFollowed.delete(name);
          }
          this.setState(name, wantFollow);
        } else if (result.status === 429) {
          const wait = result.resetAt > Date.now() ? result.resetAt - Date.now() : 15 * 60000;
          this.startCooldown(wait);
        } else if (btn.isConnected) {
          btn.textContent = '重试';
          btn.title = '操作失败，点击重试';
        }
      }, true);
    },

    setButtonsDisabled(disabled) {
      const coolingDown = Date.now() < this.followDisabledUntil;
      document.querySelectorAll('[data-xt-follow-user]').forEach(btn => {
        btn.disabled = disabled || coolingDown;
      });
    },

    startCooldown(wait) {
      this.followDisabledUntil = Date.now() + wait;
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = setTimeout(() => {
        this.followDisabledUntil = 0;
        this.refreshBadges();
      }, wait);
      this.refreshBadges();
    },

    async followUser(name, article, wantFollow = true) {
      // 首选：触发推文原生「···」菜单，由 X 自己发带签名的请求。
      // 旧版直接 POST v1.1 REST 在 X 新版常失效，表现为"点了没反应"。
      if (article) {
        try {
          if (await this.executeViaCaret(article, name, wantFollow)) {
            return { ok: true, status: 200, resetAt: 0 };
          }
        } catch (e) {}
      }
      return this.followUserViaApi(name, wantFollow);
    },

    async followUserViaApi(name, wantFollow) {
      const headers = this.authHeaders();
      if (!headers) return { ok: false, status: 0, resetAt: 0 };
      const path = wantFollow ? 'friendships/create.json' : 'friendships/destroy.json';
      const params = new URLSearchParams({ screen_name: name });
      const userId = this.userIds.get(name);
      if (userId) params.set('user_id', userId);
      const body = params.toString();
      const endpoints = [
        location.origin + '/i/api/1.1/' + path,
        'https://api.x.com/1.1/' + path,
      ];
      let lastStatus = 0;
      let resetAt = 0;
      for (const url of endpoints) {
        try {
          const res = await ApiHub.fetch(url, {
            method: 'POST',
            headers: Object.assign({}, headers, { 'content-type': 'application/x-www-form-urlencoded' }),
            body,
            credentials: 'include',
          });
          lastStatus = res.status;
          const ra = Number(res.headers.get('x-rate-limit-reset')) * 1000;
          if (ra) resetAt = ra;
          if (res.ok) return { ok: true, status: 200, resetAt };
          if (res.status === 429) return { ok: false, status: 429, resetAt };
        } catch (e) {}
      }
      return { ok: false, status: lastStatus, resetAt };
    },
  };

  /* ============================================================
   * 启动
   * ============================================================ */

  function boot() {
    // 各模块初始化（注册功能开关）
    AdBlocker.init();
    VideoDL.init();
    Follow.init();
    // 面板最后初始化（需要 features 已注册）
    Panel.init();
    // 面板里填开关
    Panel.refresh();
    console.log(PREFIX, '已启动 v1.6.2', '| 快捷关注:', Follow.enabled ? 'on' : 'off');
  }

  // document-start 期注册消费者并共享一次网络 Hook，DOM 操作需等 body
  VideoDL.hookNetwork();
  Follow.hookNetwork();
  ApiHub.hookNetwork();
  if (document.body) boot();
  else {
    const obs = new MutationObserver(() => {
      if (document.body) { obs.disconnect(); boot(); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
