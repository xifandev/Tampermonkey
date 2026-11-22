# Tampermonkey 自用脚本集

个人自用的篡改猴（Tampermonkey）用户脚本仓库。

## 目录结构

```
Tampermonkey/
├── README.md                       # 本文件
├── CONTRIBUTING.md                 # 开发与提交规范
├── scripts/                        # 脚本目录
│   └── twitter-video-dl.user.js    # X/Twitter 视频下载按钮
└── .gitignore
```

## 脚本列表

| 脚本 | 说明 | 适用站点 |
|------|------|----------|
| [twitter-video-dl](scripts/twitter-video-dl.user.js) | 推文操作栏加"下载"按钮，一键保存最高画质 MP4 | x.com / twitter.com |

## 两种使用方式

### 方式 A：本地开发模式（推荐，改完刷新即生效）

适合日常自用与频繁迭代。真正的逻辑文件留在本地，篡改猴里只放一个壳脚本通过 `@require file://` 加载，改文件 → 保存 → 刷新页面 → 立即生效。

**一次性配置：**

1. Chrome 访问 `chrome://extensions` → 篡改猴 → 详情 → 开启 **"允许访问文件网址"**
2. 篡改猴仪表盘 → 设置 → 通用 → 配置模式改为 **高级** → 安全 → **允许脚本访问本地文件** → 设为 **"外部(@require 和 @resource)"**

**安装壳脚本：**

篡改猴仪表盘 → 新建脚本，粘贴以下内容（以推特视频下载为例），保存：

```javascript
// ==UserScript==
// @name         X/Twitter 视频下载按钮（本地壳）
// @namespace    https://github.com/xifandev/Tampermonkey
// @version      1.2.1
// @description  本地开发壳，@require 本地文件，改完刷新即生效
// @author       xifan
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://mobile.twitter.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        unsafeWindow
// @connect      video.twimg.com
// @connect      twimg.com
// @connect      cdn.syndication.twimg.com
// @connect      api.fxtwitter.com
// @require      file:///Users/getlong/Code/Tampermonkey/scripts/twitter-video-dl.user.js
// ==/UserScript==
```

> 注意：壳脚本里的 `@grant` / `@match` / `@connect` 必须与逻辑文件头部一致——`@require` 进来的文件头部元数据会被忽略，只有壳脚本的头部生效。

**日常迭代：**

```
修改 scripts/twitter-video-dl.user.js → 保存（Cmd+S）
        ↓
  刷新推特页面 → 自动加载最新代码 → 立即生效
```

### 方式 B：分发版安装（GitHub raw URL）

适合给别人用或换设备时安装。脚本头部已配置 `@updateURL` / `@downloadURL`，安装后篡改猴自动检查更新。

浏览器打开以下链接，篡改猴自动拦截并提示安装：

```
https://raw.githubusercontent.com/xifandev/Tampermonkey/main/scripts/twitter-video-dl.user.js
```

更新流程：改脚本 → 递增 `@version` → commit push → 篡改猴自动拉取。

## 技术栈

- 纯 JavaScript，无构建步骤
- 文件扩展名统一 `.user.js`
- 脚本头部遵循 [UserScript 元数据规范](https://www.tampermonkey.net/documentation.php)

## 许可证

MIT
