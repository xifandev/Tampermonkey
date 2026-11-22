# 开发与提交规范

本仓库的脚本开发、版本管理与 Git 提交约定。

## 一、脚本开发规范

### 1. 文件命名

- 统一扩展名 `.user.js`
- 小写 + 连字符，简短表意：`twitter-video-dl.user.js`、`bilibili-cover.user.js`
- 一个脚本一个文件，放在 `scripts/` 目录下

### 2. 头部元数据（必填项）

每个脚本头部必须包含以下字段：

```javascript
// ==UserScript==
// @name         脚本中文名
// @namespace    https://github.com/xifandev/Tampermonkey
// @version      1.0.0
// @description  一句话说明做什么
// @author       xifan
// @license      MIT
// @match        https://example.com/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/xifandev/Tampermonkey/main/scripts/xxx.user.js
// @downloadURL  https://raw.githubusercontent.com/xifandev/Tampermonkey/main/scripts/xxx.user.js
// @supportURL   https://github.com/xifandev/Tampermonkey/issues
// @homepageURL  https://github.com/xifandev/Tampermonkey
// ==/UserScript==
```

### 3. 版本号（语义化版本）

格式：`MAJOR.MINOR.PATCH`

- `PATCH`（x.x.**1**）：修 bug、适配站点 DOM 变化
- `MINOR`（x.**1**.0）：新增功能、向后兼容
- `MAJOR`（**1**.0.0）：破坏性重构

**每次推送必须递增 `@version`**，否则分发版不会触发自动更新。

### 4. 权限最小化

- `@grant` 只声明实际用到的 API，能用 `none` 就用 `none`
- `@match` 尽量收窄到具体路径，避免 `*://*/*`
- `@connect` 只列实际请求的域名

### 5. 代码风格

- IIFE 包裹 + `'use strict'`
- 纯 JS，不依赖构建、不混淆
- 关键逻辑加注释，console 调试用 `console.debug` 并加 `[脚本缩写]` 前缀

## 二、本地开发流程

采用 **壳脚本 + `@require file://`** 模式，实现"改文件 → 刷新页面 → 立即生效"。

1. 本地仓库路径：`/Users/getlong/Code/Tampermonkey`
2. 篡改猴里为每个脚本建一个壳脚本（头部 + `@require file:///Users/getlong/Code/Tampermonkey/scripts/xxx.user.js`）
3. 直接编辑 `scripts/xxx.user.js`，保存后刷新目标页面即可
4. 调试通过后再 commit

详见 [README.md](README.md) 的"方式 A：本地开发模式"。

## 三、Git 提交规范

采用 [Conventional Commits](https://www.conventionalcommits.org/) 规范。

### 提交格式

```
<type>(<scope>): <subject>

<body>
```

### type 类型

| type | 说明 |
|------|------|
| `feat` | 新增脚本或新功能 |
| `fix` | 修复 bug |
| `update` | 适配目标站点改版、更新选择器 |
| `refactor` | 重构，无功能变化 |
| `docs` | 文档变更（README、CONTRIBUTING） |
| `chore` | 杂项（.gitignore、目录调整） |
| `revert` | 回滚 |

### scope（可选）

脚本名简写，如 `twitter-video-dl`、`bilibili-cover`。文档类用 `docs`。

### subject

- 简体中文，祈使语气
- 不超过 50 字
- 结尾不加句号

### 示例

```
feat(twitter-video-dl): 新增推文视频下载按钮

- hook GraphQL 接口缓存视频直链
- 兜底 Syndication / FixTweet 接口
- 三通道下载（GM_download / GM_xhr / page fetch）
```

```
fix(twitter-video-dl): 修复视频地址捕获失败时按钮不消失的问题
```

```
update(bilibili-cover): 适配 B 站 2026 年新版播放器 DOM 结构
```

```
docs: 补充本地开发模式说明
```

## 四、分支与推送

### 分支策略

- `main`：稳定主线，可直接被 `@updateURL` 拉取
- `dev-<脚本名>`：脚本开发分支，调试稳定后合并回 main

小改动可直接在 main 上提交；大改动建议开分支。

### 推送流程

```bash
# 1. 确认改动
git status
git diff

# 2. 暂存（按需）
git add scripts/xxx.user.js
# 或全部
git add -A

# 3. 提交（遵守 Conventional Commits）
git commit -m "feat(twitter-video-dl): 新增推文视频下载按钮"

# 4. 推送
git push origin main
```

### 推送前自检

- [ ] `@version` 是否递增（分发版必须）
- [ ] 壳脚本的 `@grant` / `@match` / `@connect` 是否与逻辑文件一致（本地模式）
- [ ] 本地刷新目标页面，功能正常
- [ ] 无 `console.error` 遗留
- [ ] 无硬编码的敏感信息（token、密码等）

## 五、新增脚本 checklist

- [ ] `scripts/` 下新建 `xxx.user.js`
- [ ] 头部元数据完整（参考第二节）
- [ ] `@updateURL` / `@downloadURL` 指向正确路径
- [ ] README 脚本列表新增一行
- [ ] 本地建对应壳脚本测试
- [ ] commit + push
