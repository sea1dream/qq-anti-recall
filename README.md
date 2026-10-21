# QQ 防撤回 · Windows 兼容修复版

基于 [xh321/LiteLoaderQQNT-Anti-Recall 0.3.0](https://github.com/xh321/LiteLoaderQQNT-Anti-Recall) 的修改版，需要先安装 [LiteLoaderQQNT](https://github.com/LiteLoaderQQNT/LiteLoaderQQNT)。保留原作者 XiaoHe321 的 MIT 许可证。

本版修复新版 QQ 的消息缓存遗漏，并增加已下载图片的本地备份。撤回的内容留在原聊天位置，带红色高亮和“已撤回”标记。

## 已验证环境

- Windows x64，QQ **9.9.36-53644**。
- LiteLoaderQQNT **1.4.1**，加载器需应用下文的 Node 24 兼容修复。
- 文字：真实群聊撤回、退出并重新启动 QQ 后恢复均已验证。
- 图片：真实群聊中先收到并显示图片、再撤回，仍可显示；本地备份已核对。
- 真实图片的“重启 QQ 后恢复”尚未单独测试；自动测试覆盖从磁盘备份恢复。

没有验证其他 QQ 版本、macOS 或 Linux。QQ 更新可能改变内部接口，需要重新检查兼容性。

## 安装

1. 按 [LiteLoaderQQNT 官方安装说明](https://liteloaderqqnt.github.io/guide/install.html) 安装并确认 QQ 设置页出现 LiteLoaderQQNT。
2. 从本仓库 [Releases](https://github.com/sea1dream/qq-anti-recall/releases) 下载 `qq-anti-recall.zip`。
3. 在 LiteLoaderQQNT 的插件管理页导入压缩包，完全退出并重新打开 QQ。
4. 在 QQ 设置的“防撤回”页面开启**保存到本地数据库**；首次启用或更改此开关后重启 QQ。否则关闭 QQ 后内存中的撤回记录可能丢失。
5. 请用一条新收到的测试消息验证。旧版本已丢失的消息无法凭空补回。

本版沿用 `anti_recall` 标识和数据目录。更新已有插件前，先退出 QQ，并备份原插件目录及 `LiteLoaderQQNT/data/anti_recall`。不要同时安装两份同标识插件。

仓库及安装包不包含 QQ 本体、修改后的 QQ DLL、加载器、账号数据、聊天记录或测试图片。

### LiteLoaderQQNT 1.4.1 / Node 24 兼容

若加载器在扫描插件时报错，提示传给 `path.join` 的路径为 `undefined`，检查加载器的 `src/main/store.js`：

```js
// 原写法使用新版 Node 已移除的 Dirent.path
path.join(dirent.path, dirent.name, "manifest.json")

// 改为已知插件根目录
path.join(LiteLoader.path.plugins, dirent.name, "manifest.json")
```

修改前备份该文件，修改后重启 QQ。本仓库不会自动修改 QQ DLL 或加载器文件。

## 保存范围和容量

- 设置中的 **10,000 条**是所有会话最近收到消息的默认内存缓存上限，每次清理默认 500 条。
- 已保存的撤回消息数据库**没有配置固定条数上限**，实际受磁盘空间和运行性能限制。
- 图片备份目录为 `LiteLoaderQQNT/data/anti_recall/images`。为赶在 QQ 删除缓存前保存图片，备份也包含部分尚未撤回的图片；目前没有自动清理上限。
- 保存的是这台电脑实际收到、缓存到的内容。插件随 QQ 启动，登录在线后才能继续保留新消息；最小化或托盘运行即可，QQ 完全退出期间不会工作。
- 未下载到本机、服务器又无法下载的图片无法恢复；只有缩略图时，恢复的预览可能低于原图质量。
- 上游使用的图片下载凭据服务 `llob.linyuchen.net` 在 2026-10-21 本次环境检测中证书过期。本版优先恢复本地副本，不会关闭 HTTPS 证书校验。
- 撤回记录与图片备份是**未加密本地文件**。设置里的“清空已储存的撤回消息”清理消息数据库，不会同时清除图片备份。
- 默认不保留自己撤回的消息，可在插件设置中调整。

## 本次修改

- 缓存完整消息列表、活动消息更新，使用独立快照，防止 QQ 原地修改消息对象后覆盖原文。
- 保留缩略图路径的 Map 内容；原文不存在时保留 QQ 的正常撤回提示。
- 修复重复保存数据库时的错误。
- 预先备份已下载原图及缩略图，在下载延迟完成时继续检查缓存。
- 优先从本地恢复图片，修复损坏占位图判断，拒绝把下载错误页面当作图片保存。
- 增加下载超时与重定向限制；图片失败不会中断整个消息恢复。

## 开发和打包

需要 Node.js 18 或更新版本，已在 Node.js 24 下执行测试。

```powershell
npm ci
npm test
powershell -ExecutionPolicy Bypass -File .\scripts\build-release.ps1
```

构建产物为 `dist/qq-anti-recall.zip`，包含运行依赖，可直接导入插件管理页。构建只收集明确列出的插件文件及 `node_modules`，不收集本机数据目录。

## 来源与许可证

- [原插件及作者](https://github.com/xh321/LiteLoaderQQNT-Anti-Recall)：主体代码与 UI。
- [LiteLoaderQQNT](https://github.com/LiteLoaderQQNT/LiteLoaderQQNT)：插件运行框架，单独安装。
- 兼容修复和本地图片恢复修改：sea1dream。
- 本仓库采用 [MIT 许可证](LICENSE)，依赖保留各自许可证。

这是第三方兼容修改版，与腾讯 QQ 官方无关联。
