# 系统设置与 Cloudflare 缓存清理

后台左侧“用户管理”下方新增“系统设置”。管理员可以填写区域 ID、账户邮箱以及 API Token 或 Global API Key，保存、测试已保存配置、清除凭据及重试到期清理任务。普通用户无访问权限。

视频和 API 使用逐次鉴权及 private/no-store，删除用户、撤销等级或课程删除由数据库检查生效，不需要依赖 Cloudflare 清理。此前公开封面允许浏览器缓存 300 秒；新响应改为 no-store。启用清理后，替换封面与删除课程在数据库事务内登记封面 URL 前缀，提交后后台立即尝试请求 Cloudflare，失败由每小时 Cron 重试。前缀清理覆盖带不同 v 查询参数的封面版本，但无法撤回浏览器已经下载的数据。

## 配置步骤

1. 在 Cloudflare 域名概览页复制本站域名的 Zone ID（不是 Account ID）。
2. 推荐创建 API Token，权限限定为本站区域的 Zone → Cache Purge → Purge。无需提供账户邮箱。也支持截图中的“账户邮箱 + Global API Key”，此方式使用 X-Auth-Email/X-Auth-Key。
3. 填写凭据并启用，点击“保存设置”，再点击“测试已保存配置”。测试仅清理本站的专用测试封面前缀，不清空整站缓存。
4. 测试成功只表示 Cloudflare 接受请求；区域 ID 是否属于本站、缓存是否真正被清除，仍需访问真实对象检查 CF-Cache-Status。

密钥输入留空表示保留原凭据；切换认证方式必须填写相应的新凭据。清除已保存凭据会停用自动清理。保存前未启用的历史缓存不会自动登记，可在 Cloudflare 控制台清理。

## 服务器首次配置

按[网页部署教程](deployment.md)操作，CF的Worker Git部署会自动应用所有迁移（包括0003和0004）。打开前端 `/deployment-tools` 生成加密密钥，在CF → Worker → Settings → Variables and Secrets添加 `SETTINGS_ENCRYPTION_KEY`，类型选Secret，按界面提示保存生效。不需要本机命令。本地开发仍使用被.gitignore忽略的.dev.vars。

以下是熟悉命令行的开发者可选方式（先设置构建变量并通过 `npm run cf:build` 生成生产配置），网页部署用户跳过：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npx wrangler secret put SETTINGS_ENCRYPTION_KEY --config wrangler.production.jsonc
npx wrangler d1 migrations apply classroom --remote --config wrangler.production.jsonc
```

域名、区域和数据库信息在CF构建变量设置，构建自动生成生产配置。密钥应备份并保持稳定；换密钥后已保存的 API 凭据无法解密，需要重新填写。API 凭据使用 AES-GCM 随机 IV 加密存储在 D1，读取接口只返回 hasSecret，不返回原文或密文。服务器错误不输出 Cloudflare 响应正文。

本站 Cloudflare 缓存规则应绕过 /api/* 和 /media/*，尊重 no-store。缓存清理是封面更新的补充措施，不能补救把受保护视频配置为公开 CDN 缓存的错误。自定义缓存键、Cloudflare 多环境或额外的图片转换缓存需单独核对。

## 免费档预算

- 使用 prefix purge，当前 Free 支持。平台限制每账户每分钟5次请求，最大100个前缀；本项目通过 D1 原子领取请求额度，最多每分钟1次、每批6个前缀。测试请求共享此间隔。
- 一批只调用一次外部 fetch（10秒连接超时），不把每个封面变成独立子请求。失败保留任务、指数退避，限流不会导致课程事务失败。
- runCleanup 最多38条 D1查询；runCachePurge 满批最多10条，总共48条，低于每次Worker调用50条的限制。
- 清理中的再次替换会更新任务版本；旧清理完成只删除对应版本，避免丢失新任务。
- 未配置或停用时不创建新的清理任务；已有积压保留，重新启用后可继续处理。
- Workers每次10ms CPU预算仍需线上验证，尤其是原有scrypt密码计算。

文档核对日期：2026-09-18。

验证结果：64项自动测试、桌面/手机设置页面E2E、本地D1/R2集成测试、类型检查、前端构建与Worker部署dry-run通过。Cloudflare请求在测试中模拟，未使用真实凭据或发布生产变更。

- [Cloudflare 缓存清理与免费档限制](https://developers.cloudflare.com/cache/how-to/purge-cache/)
- [Cloudflare 清理 API 与认证方式](https://developers.cloudflare.com/api/resources/cache/methods/purge/)
- [创建 API Token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
