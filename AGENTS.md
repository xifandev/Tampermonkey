# AGENTS.md

本仓库的 AI 协作规则。详细开发/提交规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 核心规则：改完即发版

每次完成一个新版本或新功能/修复，**用户确认改完后，AI 必须主动完成发版三步**：

1. **递增版本号**：脚本头部 `@version` 按语义化版本递增（修 bug 升 PATCH，新功能升 MINOR），脚本内其他显示版本号的地方（如面板页脚、启动日志）同步更新
2. **commit**：遵循 Conventional Commits，简体中文 subject，如 `fix(x-tools): v1.4.3 修复xxx`
3. **push 到 main**：`@updateURL` 指向 main 分支，不推送用户端就收不到自动更新

push 后必须明确提醒用户："已推送 vX.X.X，可以去篡改猴点检查更新了"，并附注 raw 有约 5 分钟 CDN 缓存，显示"无更新"时稍后再试。

## 其他约束

- 已发布脚本的文件名/路径不可改动（`@updateURL` 写死，改动 = 全员断更重装）
- 推送前自检：版本号已递增、无 console.error 遗留、无硬编码敏感信息
- 用户会在真实浏览器里验证功能，AI 不要仅凭语法检查就声称功能正常