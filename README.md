# Tampermonkey 自用脚本集

个人自用的篡改猴（Tampermonkey）用户脚本仓库。

## 脚本列表

| 脚本 | 说明 | 适用站点 |
|------|------|----------|
| [x-tools](x-tools.user.js) | X Tools 推特小工具：推文视频一键下载（最高画质 MP4），功能持续增加 | x.com / twitter.com |

## 安装

1. 浏览器安装 [篡改猴](https://www.tampermonkey.net/) 扩展
2. 打开脚本 raw 链接，篡改猴自动弹出安装确认：

```
https://raw.githubusercontent.com/xifandev/Tampermonkey/main/x-tools.user.js
```

## 更新

- 脚本头部已配置 `@updateURL` / `@downloadURL`，篡改猴自动检查更新
- 手动触发：篡改猴脚本列表 → 选中脚本 → 点刷新图标
- 推送后 raw 地址有约 **5 分钟** CDN 缓存，期间点"检查更新"可能显示无更新，稍后再点即可

## 许可证

MIT
