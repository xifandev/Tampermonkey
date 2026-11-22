// ==UserScript==
// @name         X Tools 推特小工具
// @namespace    https://github.com/xifandev/Tampermonkey
// @version      1.4.3
// @description  推特小工具集：视频一键下载、广告屏蔽、悬浮控制面板，功能持续增加
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
   *   3. AdBlocker —— 广告屏蔽（纯 DOM 隐藏，零网络拦截，防封号）
   *   4. VideoDL   —— 推文视频下载（hook GraphQL + 多源兜底）
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
      /* 悬浮按钮：fixed 定位，尺寸/样式运行时复制官方 Grok 按钮，位置动态跟随 */
      .xt-fab {
        position: fixed; z-index: 2147483646;
        display: flex; align-items: center; justify-content: center;
        box-sizing: border-box; cursor: pointer; padding: 0; outline: none;
        transition: transform 0.15s, filter 0.15s;
      }
      .xt-fab:hover { transform: scale(1.06); filter: brightness(1.3); }
      .xt-fab:active { transform: scale(0.95); }
      .xt-fab.xt-btn-active { filter: brightness(1.4); }
      /* 面板卡片 */
      .xt-card {
        position: fixed; z-index: 2147483647;
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
        '<span>v1.4.3</span>' +
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
   * 3. AdBlocker —— 广告屏蔽（纯 DOM 隐藏，防封号）
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
          // 向上找到推文滚动单元（cellInnerDiv）或 article，整条隐藏
          const cell = t.closest('div[data-testid="cellInnerDiv"]') ||
                       t.closest('article[data-testid="tweet"]') ||
                       t.closest('article');
          if (cell && cell.style.display !== 'none') {
            cell.style.display = 'none';
            console.debug(PREFIX, '已隐藏推广推文');
          }
        }
      } catch (e) { /* 忽略 */ }
    },
  };

  /* ============================================================
   * 4. VideoDL —— 推文视频下载（原有逻辑，保留）
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
      const API_PATTERN = /\/i\/api\/graphql\//;
      const extractFromJson = (json) => {
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
      };

      const origFetch = w.fetch;
      w.fetch = function (...args) {
        const p = origFetch.apply(this, args);
        try {
          const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
          if (API_PATTERN.test(url)) {
            p.then(res => res.clone().text().then(t => { try { extractFromJson(JSON.parse(t)); } catch (e) {} }).catch(() => {})).catch(() => {});
          }
        } catch (e) {}
        return p;
      };
      const origOpen = w.XMLHttpRequest.prototype.open;
      const origSend = w.XMLHttpRequest.prototype.send;
      w.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__xtUrl = url;
        return origOpen.call(this, method, url, ...rest);
      };
      w.XMLHttpRequest.prototype.send = function (...args) {
        try {
          if (API_PATTERN.test(this.__xtUrl || '')) {
            this.addEventListener('load', function () {
              try { extractFromJson(JSON.parse(this.responseText)); } catch (e) {}
            });
          }
        } catch (e) {}
        return origSend.apply(this, args);
      };
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
   * 启动
   * ============================================================ */

  function boot() {
    // 各模块初始化（注册功能开关）
    AdBlocker.init();
    VideoDL.init();
    // 面板最后初始化（需要 features 已注册）
    Panel.init();
    // 面板里填开关
    Panel.refresh();
    console.log(PREFIX, '已启动 v1.4.3');
  }

  // document-start 期 hook 网络要尽早，但 DOM 操作需等 body
  VideoDL.hookNetwork();
  if (document.body) boot();
  else {
    const obs = new MutationObserver(() => {
      if (document.body) { obs.disconnect(); boot(); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
