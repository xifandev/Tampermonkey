# 开发与提交规范

本仓库的脚本开发、版本管理与 Git 提交约定。

## 一、脚本开发规范

### 1. 文件命名

- 统一扩展名 `.user.js`
- 小写 + 连字符，简短表意：`x-tools.user.js`
- 一个脚本一个文件，直接放仓库根目录

### 2. 头部元数据（必填项）

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
// @updateURL    https://raw.githubusercontent.com/xifandev/Tampermonkey/main/xxx.user.js
// @downloadURL  https://raw.githubusercontent.com/xifandev/Tampermonkey/main/xxx.user.js
// @supportURL   https://github.com/xifandev/Tampermonkey/issues
// @homepageURL  https://github.com/xifandev/Tampermonkey
// ==/UserScript==
```

### 3. 版本号（语义化版本）

格式：`MAJOR.MINOR.PATCH`

- `PATCH`（x.x.**1**）：修 bug、适配站点 DOM 变化
- `MINOR`（x.**1**.0）：新增功能、向后兼容
- `MAJOR`（**1**.0.0）：破坏性重构

**每次推送必须递增 `@version`**，否则已安装端不会触发自动更新。

### 4. 权限最小化

- `@grant` 只声明实际用到的 API，能用 `none` 就用 `none`
- `@match` 尽量收窄到具体路径
- `@connect` 只列实际请求的域名

### 5. 代码风格

- IIFE 包裹 + `'use strict'`
- 纯 JS，不依赖构建、不混淆
- 关键逻辑加注释，调试日志用 `console.debug` 并加 `[脚本缩写]` 前缀（如 `[X-Tools]`）

### 6. 稳定性约束

- **已发布脚本的文件名 / 仓库路径不要改动**——已安装端头部 `@updateURL` 是写死的绝对地址，路径一变即断更，需要所有人重装
- `@name`、`@description` 可以随意改，更新后自动同步显示

## 二、开发流程（GitHub 工作流）

```
本地改代码 → 递增 @version → commit + push
        ↓
等 1~5 分钟（raw CDN 缓存过期）
        ↓
篡改猴点"检查更新" → 自动拉新版 → 刷新目标页面验证
```

- 紧急小改可直接把完整脚本代码粘贴进篡改猴编辑器（Cmd+A → Cmd+V → Cmd+S → 刷新），验证通过后再 push
- push 后可用 GitHub API 直查确认仓库源头内容（raw 有缓存，API 无）：
  `gh api repos/xifandev/Tampermonkey/contents/xxx.user.js`

### AI 协作约定

日常修改由 AI 完成，遵循以下流程，避免用户忘记更新：

1. AI 改完代码 → 用户在页面上确认功能正常
2. **用户确认后，AI 主动完成**：递增 `@version` → commit → push
3. **push 后 AI 必须明确提醒用户**："已推送 vX.X.X，可以去篡改猴点检查更新了"
4. 提醒时附注：raw 有约 5 分钟 CDN 缓存，若点更新显示"无更新"，稍后再点

### 篡改猴更新机制（备忘）

| 触发方式 | 说明 |
|----------|------|
| 自动检查 | 默认**每天一次**（浏览器当日首次启动时），设置里可调整周期 |
| 手动检查 | 脚本列表 → 选中脚本 → 点刷新图标，**立即触发** |
| 不做的事 | 不追求"每次使用都拉更新"——拖慢页面加载，日常改动频率也用不上 |

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

脚本名简写，如 `x-tools`。文档类用 `docs`。

### subject

- 简体中文，祈使语气，不超过 50 字，结尾不加句号

### 示例

```
feat(x-tools): 新增推文视频下载功能

- hook GraphQL 接口缓存视频直链
- 兜底 Syndication / FixTweet 接口
- 三通道下载（GM_download / GM_xhr / page fetch）
```

```
fix(x-tools): 修复视频地址捕获失败时按钮不消失的问题
```

```
docs: 更新 README 脚本列表
```

## 四、分支与推送

### 分支策略

- `main`：稳定主线，`@updateURL` 直接指向此分支
- `dev-<脚本名>`：脚本开发分支，调试稳定后合并回 main

小改动可直接在 main 上提交；大改动建议开分支。

### 推送流程

```bash
git status              # 确认改动
git diff
git add -A
git commit -m "feat(x-tools): xxx"
git push origin main
```

### 推送前自检

- [ ] `@version` 已递增
- [ ] 文件名 / 路径未变动（变动 = 全员断更重装）
- [ ] 目标页面功能正常，无 `console.error` 遗留
- [ ] 无硬编码敏感信息（token、密码）

## 五、新增脚本 checklist

- [ ] 根目录新建 `xxx.user.js`
- [ ] 头部元数据完整（参考第一节）
- [ ] `@updateURL` / `@downloadURL` 路径正确（指向根目录）
- [ ] README 脚本列表新增一行
- [ ] commit + push，验证 raw 链接可访问
