# ==UserScript==
# @name         X/Twitter 视频下载按钮
# @namespace    https://github.com/xifandev/Tampermonkey
# @version      1.2.1
# @description  在含视频的推文操作栏添加醒目的"下载"按钮，一键保存最高画质 MP4 到本地
# @author       xifan
# @license      MIT
# @match        https://x.com/*
# @match        https://twitter.com/*
# @match        https://mobile.twitter.com/*
# @run-at       document-start
# @grant        GM_xmlhttpRequest
# @grant        GM_download
# @grant        unsafeWindow
# @connect      video.twimg.com
# @connect      twimg.com
# @connect      cdn.syndication.twimg.com
# @connect      api.fxtwitter.com
# @updateURL    https://raw.githubusercontent.com/xifandev/Tampermonkey/main/scripts/twitter-video-dl.user.js
# @downloadURL  https://raw.githubusercontent.com/xifandev/Tampermonkey/main/scripts/twitter-video-dl.user.js
# @supportURL   https://github.com/xifandev/Tampermonkey/issues
# @homepageURL  https://github.com/xifandev/Tampermonkey
# ==/UserScript==

(function () {
  'use strict';

  /* ============================================================
   * 工作原理（与各类"粘贴链接下载"网站相同）：
   * 1. 主路径：X 网页版加载推文时，内部 GraphQL 接口的响应里
   *    就带着 video_info.variants（各码率 MP4 直链）。脚本在
   *    document-start 阶段 hook 页面的 fetch / XHR 缓存下来。
   * 2. 兜底 A：Twitter 官方嵌入推文接口（Syndication API），
   *    无需登录，token 由推文 ID 算出。
   * 3. 兜底 B：开源项目 FixTweet 的公共 API（api.fxtwitter.com）。
   * ============================================================ */

  // tweetId -> [{url, bitrate}] 按码率从高到低排序
  const videoCache = new Map();

  const w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

  /* ---------- 0. 文件名：随机时间戳，不含任何推文信息 ---------- */

  function genFilename() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_` +
                  `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const rand = Math.random().toString(36).slice(2, 8);
    return `${stamp}_${rand}.mp4`;
  }

  /* ---------- 1. 从接口响应中提取视频地址 ---------- */

  function walk(node, cb) {
    if (!node || typeof node !== 'object') return;
    cb(node);
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (child && typeof child === 'object') walk(child, cb);
    }
  }

  function extractFromJson(json) {
    try {
      walk(json, (node) => {
        const media = node.extended_entities?.media || node.entities?.media;
        if (!Array.isArray(media)) return;
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
            videoCache.set(String(id), mp4s);
            console.debug('[TVD] 已捕获视频:', id, mp4s[0].url);
          }
        }
      });
    } catch (e) { /* 忽略解析失败 */ }
  }

  // 覆盖 X 网页版的全部内部 GraphQL 请求，不再只匹配固定接口名
  const API_PATTERN = /\/i\/api\/graphql\//;

  /* hook fetch */
  const origFetch = w.fetch;
  w.fetch = function (...args) {
    const promise = origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      if (API_PATTERN.test(url)) {
        promise.then(res => {
          res.clone().text().then(t => {
            try { extractFromJson(JSON.parse(t)); } catch (e) {}
          }).catch(() => {});
        }).catch(() => {});
      }
    } catch (e) {}
    return promise;
  };

  /* hook XMLHttpRequest */
  const origOpen = w.XMLHttpRequest.prototype.open;
  const origSend = w.XMLHttpRequest.prototype.send;
  w.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__tvdUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  w.XMLHttpRequest.prototype.send = function (...args) {
    try {
      if (API_PATTERN.test(this.__tvdUrl || '')) {
        this.addEventListener('load', function () {
          try { extractFromJson(JSON.parse(this.responseText)); } catch (e) {}
        });
      }
    } catch (e) {}
    return origSend.apply(this, args);
  };

  /* ---------- 2. 兜底链路：多来源逐个尝试 ---------- */

  function calcToken(id) {
    // Twitter 嵌入接口的 token 算法（公开算法，多个开源项目在用）
    return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
  }

  function gmGetJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 20000,
        onload: (r) => {
          if (r.status < 200 || r.status >= 300) {
            reject(new Error(`HTTP ${r.status}`));
            return;
          }
          try { resolve(JSON.parse(r.responseText)); }
          catch (e) { reject(new Error('返回内容不是 JSON')); }
        },
        onerror: (r) => reject(new Error(`网络错误${r?.status ? ' HTTP ' + r.status : ''}`)),
        ontimeout: () => reject(new Error('请求超时')),
      });
    });
  }

  function parseSyndication(json) {
    const media = (json.mediaDetails || []).find(m => m.video_info);
    const variants = media?.video_info?.variants || [];
    const mp4s = variants
      .filter(v => (v.type === 'video/mp4' || v.content_type === 'video/mp4') && (v.url || v.src))
      .map(v => ({ url: v.url || v.src, bitrate: v.bitrate || 0 }))
      .sort((a, b) => b.bitrate - a.bitrate);
    if (!mp4s.length) throw new Error('接口返回中没有 MP4 源');
    return mp4s;
  }

  function parseFxTwitter(json) {
    const tweet = json.tweet || {};
    const videos = tweet.media?.videos
      || (tweet.media?.all || []).filter(m => m.type === 'video' || m.type === 'gif');
    const mp4s = (videos || [])
      .filter(v => v.url)
      .map(v => ({ url: v.url, bitrate: (v.width || 0) * (v.height || 0) }))
      .sort((a, b) => b.bitrate - a.bitrate);
    if (!mp4s.length) throw new Error('接口返回中没有 MP4 源');
    return mp4s;
  }

  async function fetchViaSyndication(tweetId) {
    const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=zh-cn&token=${calcToken(tweetId)}`;
    // 先试页面内 fetch（该接口面向第三方嵌入，通常允许跨域）
    try {
      const r = await fetch(url, { credentials: 'omit' });
      if (r.ok) return parseSyndication(await r.json());
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      // 页面内请求失败再试 GM 通道（可绕过跨域限制）
      const json = await gmGetJson(url);
      return parseSyndication(json);
    }
  }

  async function fetchViaFxTwitter(tweetId) {
    const json = await gmGetJson(`https://api.fxtwitter.com/status/${tweetId}`);
    return parseFxTwitter(json);
  }

  /**
   * 按优先级尝试所有来源，返回 { variants, errors }
   */
  async function resolveVideo(tweetId) {
    const cached = videoCache.get(tweetId);
    if (cached) return { variants: cached, source: '页面缓存' };

    const errors = [];
    const sources = [
      ['Syndication 接口', () => fetchViaSyndication(tweetId)],
      ['FixTweet 接口', () => fetchViaFxTwitter(tweetId)],
    ];
    for (const [name, fn] of sources) {
      try {
        const variants = await fn();
        videoCache.set(tweetId, variants);
        return { variants, source: name };
      } catch (e) {
        errors.push(`${name}: ${e?.message || e}`);
      }
    }
    return { variants: null, errors };
  }

  /* ---------- 3. 下载文件（多通道兜底） ---------- */

  function saveBlob(blob, filename) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  }

  /* 通道 1：GM_download，走浏览器原生下载管理器，大文件最稳 */
  function downloadViaGmDownload(url, filename) {
    return new Promise((resolve, reject) => {
      if (typeof GM_download !== 'function') {
        reject(new Error('当前脚本管理器不支持 GM_download'));
        return;
      }
      GM_download({
        url,
        name: filename,
        headers: { 'Referer': 'https://x.com/' },
        onload: () => resolve(),
        onerror: (e) => reject(new Error('原生下载通道失败' + (e?.error ? `（${e.error}）` : ''))),
        ontimeout: () => reject(new Error('原生下载通道超时')),
      });
    });
  }

  /* 通道 2：GM_xmlhttpRequest 拉 blob（带 Referer 头） */
  function downloadViaGmXhr(url, filename) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'blob',
        headers: { 'Referer': 'https://x.com/' },
        timeout: 180000,
        onload: (r) => {
          if (r.status < 200 || r.status >= 300) {
            reject(new Error(`HTTP ${r.status}`));
            return;
          }
          try { saveBlob(r.response, filename); resolve(); }
          catch (e) { reject(e); }
        },
        onerror: (r) => reject(new Error(`网络错误${r?.status ? ' HTTP ' + r.status : ''}`)),
        ontimeout: () => reject(new Error('请求超时')),
      });
    });
  }

  /* 通道 3：页面内 fetch（video.twimg.com 通常允许跨域读取） */
  async function downloadViaPageFetch(url, filename) {
    const r = await fetch(url, { credentials: 'omit' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    saveBlob(await r.blob(), filename);
  }

  /**
   * 依次尝试所有下载通道，全部失败才报错。
   * 最后的保底：直接新标签页打开视频，由用户 Ctrl+S 保存。
   */
  async function downloadWithFallback(url, filename) {
    const errors = [];
    const channels = [
      ['浏览器原生下载', () => downloadViaGmDownload(url, filename)],
      ['脚本请求通道', () => downloadViaGmXhr(url, filename)],
      ['页面请求通道', () => downloadViaPageFetch(url, filename)],
    ];
    for (const [name, fn] of channels) {
      try {
        await fn();
        console.debug('[TVD] 下载成功，通道:', name);
        return { ok: true };
      } catch (e) {
        errors.push(`${name}: ${e?.message || e}`);
      }
    }
    // 保底：新标签页打开，浏览器会直接播放/下载
    window.open(url, '_blank', 'noopener');
    return { ok: false, errors };
  }

  /* ---------- 4. 按钮 UI（加大醒目版） ---------- */

  function injectStyle() {
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
  }

  const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 15.586l-4.293-4.293 1.414-1.414L11 11.758V3h2v8.758l1.879-1.879 1.414 1.414L12 15.586zM5 19h14v2H5v-2z"/></svg>';
  const ICON_LOADING = '<svg class="tvd-spin" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke-opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>';

  function getTweetId(article) {
    const links = article.querySelectorAll('a[href*="/status/"]');
    for (const a of links) {
      const m = (a.getAttribute('href') || '').match(/\/status\/(\d+)/);
      if (m) return m[1];
    }
    return null;
  }

  function articleHasVideo(article) {
    return !!article.querySelector(
      'video, [data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="playButton"]'
    );
  }

  async function handleDownload(btn, tweetId) {
    btn.disabled = true;
    btn.innerHTML = ICON_LOADING + '<span>下载中</span>';
    try {
      const { variants, errors } = await resolveVideo(tweetId);
      if (!variants) {
        alert(
          '未能获取到视频地址：\n\n' + errors.join('\n') +
          '\n\n可尝试：\n' +
          '1. 刷新页面，让这条推文重新加载后再点下载；\n' +
          '2. 点开推文详情页再下载；\n' +
          '3. 涉及敏感/受限内容的推文可能需要登录后的会话才能解析；\n' +
          '4. 仅含 m3u8 流的视频可用 yt-dlp 命令行下载。'
        );
        return;
      }
      const best = variants[0];
      const result = await downloadWithFallback(best.url, genFilename());
      if (!result.ok) {
        alert(
          '自动下载通道均未成功，已在新标签页中打开视频，可在新标签页里右键 / Ctrl+S 保存。\n\n' +
          '各通道失败原因：\n' + result.errors.join('\n') +
          '\n\n提示：HTTP 408 / 超时类错误通常与代理节点到 Twitter 视频服务器的连接质量有关，可切换节点后重试。'
        );
      }
    } catch (e) {
      alert('下载失败：' + (e?.message || e));
    } finally {
      btn.disabled = false;
      btn.innerHTML = ICON_DOWNLOAD + '<span>下载</span>';
    }
  }

  function addButton(article) {
    if (article.querySelector('.tvd-btn')) return;
    const group = article.querySelector('div[role="group"]');
    if (!group) return;
    const tweetId = getTweetId(article);
    if (!tweetId) return;
    // 只给含视频的推文加按钮（已缓存到视频地址的也算）
    if (!articleHasVideo(article) && !videoCache.has(tweetId)) return;

    injectStyle();
    const btn = document.createElement('button');
    btn.className = 'tvd-btn';
    btn.type = 'button';
    btn.title = '下载视频（最高画质）';
    btn.setAttribute('aria-label', '下载视频');
    btn.innerHTML = ICON_DOWNLOAD + '<span>下载</span>';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleDownload(btn, tweetId);
    });
    // 插到操作栏末尾
    const holder = document.createElement('div');
    holder.style.display = 'flex';
    holder.appendChild(btn);
    group.appendChild(holder);
  }

  /* ---------- 5. 监听时间线，自动加按钮 ---------- */

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      document.querySelectorAll('article[data-testid="tweet"]').forEach(addButton);
    }, 150);
  }

  function startObserver() {
    scheduleScan();
    new MutationObserver(scheduleScan).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.body) {
    startObserver();
  } else {
    new MutationObserver((_, obs) => {
      if (document.body) {
        obs.disconnect();
        startObserver();
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
