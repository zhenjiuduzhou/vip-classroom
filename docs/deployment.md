# Cloudflare 网页部署全流程

使用 GitHub 和 CF 网页后台，不需要在自己电脑上打开终端。下文的“构建命令/部署命令”粘贴到 CF 表单，由 CF 服务器执行。菜单可能显示中文或英文，以括号内英文和字段名定位。官方资料核对于2026-09-18；尚未在真实CF账号上验证远程部署。

## 固定名称与顺序

| 项目 | 名称 |
| --- | --- |
| GitHub 仓库 | 自己命名，例如 vip-classroom |
| D1 数据库 | `classroom` |
| R2 私有存储桶 | `classroom-private` |
| Pages 项目 | 建议 vip-classroom，名称被占用可换 |
| Worker | 必须 `vip-classroom-api` |

顺序：接入域名 → 上传GitHub → 创建D1/R2 → Pages部署 → Pages绑定域名 → R2配置 → 创建空Worker → 运行时密钥 → Git构建设置与授权 → 自动迁移/发布 → 初始化管理员 → 验收。

每个人在自己的CF账号创建独立资源，使用同一份代码。固定名称适合每个账号一套站点；同一账号第二套需要调整代码中的资源名称，不能共用这组资源。

## 1. 域名接入CF

1. 登录 [CF后台](https://dash.cloudflare.com/)，选择自己的账号。
2. 若域名未接入：Add a domain，按引导到域名注册商修改 Nameservers，等状态 Active。
3. 确定正式网站来源，例如 `https://classroom.yourdomain.com`，对应的区域名称为 `yourdomain.com`。可以使用根域名。
4. 记录32位的 Account ID（账户ID）。域名、D1、R2、Pages、Worker应在同一账号。

## 2. 在GitHub网页上传项目

1. GitHub右上角 `+` → New repository，填仓库名，可选Private，勾选创建README以建立main分支 → Create repository。
2. 仓库 → Add file → Upload files。
3. 可以先解压提供的 `github-source.zip`，再把其中的文件和文件夹拖进上传区域。不要只上传ZIP，不要额外包一层webapp目录。
4. 仓库根目录必须直接有 `package.json`、`package-lock.json`、`wrangler.jsonc`；保留src、web、public、migrations、scripts、deploy、docs、tests、e2e目录结构。文件过多时可以分批上传。
5. 填提交说明 → Commit changes。

**不要上传** `.dev.vars`、`.env*`、node_modules、.wrangler、dist、release、screenshots、test-results、admin-bootstrap.sql、.local-seed.sql或生成的wrangler.production.jsonc。GitHub网页上传不会依据.gitignore自动过滤，请在上传前检查。提供的源码ZIP已排除这些文件。

## 3. 创建D1（无需手动执行SQL）

1. CF → 存储和数据库（Storage & databases）→ D1 SQL database → Create database。
2. 名称填 `classroom`，按引导创建。
3. 打开概览，复制 Database ID，格式类似 `12345678-1234-1234-1234-123456789abc`。
4. 此时没有业务表是正常的。Worker部署会自动执行仓库migrations目录中的迁移，之后在d1_migrations表记录历史，以后仅执行新增迁移。

不要先手动贴SQL建表，也不要导入演示数据，否则可能出现表已存在而迁移历史缺失的冲突。[D1迁移说明](https://developers.cloudflare.com/d1/reference/migrations/)

## 4. 创建私有R2

1. CF → Storage & databases → R2 Object Storage。
2. 如未启用R2，按引导启用。账户可能要求付款方式，由你决定是否接受。
3. Create bucket → 名称 `classroom-private` → 其他设置按需求或默认 → 创建。
4. 桶 → Settings：Public Development URL（r2.dev）保持Disabled，不添加公共自定义域名。

视频播放经过Worker鉴权，上传用临时签名地址，不需要公开桶。

## 5. Pages连接GitHub并部署

1. CF → Workers & Pages → Create application → **Pages** → Connect to Git / Import an existing Git repository。
2. 授权Cloudflare GitHub应用访问第2步的仓库，选择仓库。
3. 填以下字段：

| 字段 | 值 |
| --- | --- |
| Project name | vip-classroom，若被占用可换 |
| Production branch | main |
| Framework preset | Vite，或None并手动填写构建字段 |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | 留空，仓库根目录 |
| Environment variable | `NODE_VERSION` = `22.14.0` |

4. Save and Deploy，等成功。
5. 默认xxx.pages.dev网址应可显示首页。登录暂时不可用，因为Worker尚未部署。

[Pages Git部署参考](https://developers.cloudflare.com/pages/get-started/git-integration/)

## 6. Pages绑定正式域名

1. Pages项目 → Custom domains → Set up a custom domain。
2. 填 `classroom.yourdomain.com`，按提示确认DNS。
3. 等状态Active，打开正式HTTPS网址，确认首页显示。
4. 域名DNS中对应记录必须为Proxied（橙色云）。不要只手动添加CNAME而漏掉Pages的Custom domains设置。

后续API只接入正式域名；pages.dev和Pages预览网址不自动连接后端。来源变量不要带结尾斜杠。

## 7. 网页生成安装密钥和R2 CORS

1. 打开正式网站 `/deployment-tools`，例如 `https://classroom.yourdomain.com/deployment-tools`。只需Pages，不必等Worker。
2. 点击“生成两份独立密钥”，分别复制BOOTSTRAP_TOKEN和SETTINGS_ENCRYPTION_KEY并安全保存。由当前浏览器安全随机生成，不发送到服务器，不写浏览器存储；刷新会清空。
3. 输入正式HTTPS网站来源，点击“生成 R2 网页 CORS 配置”，复制生成的JSON数组。
4. **另行打开CF后台** → R2 → `classroom-private` → Settings → CORS Policy → Add / Edit，粘贴JSON，点击保存。

网站工具只生成配置，不会自动写入CF。必须在R2后台保存才生效；保存CORS不需要重新部署Pages或Worker。AllowedOrigins使用纯HTTPS网址，不要带Markdown链接格式或结尾斜杠。

示例（替换来源）：

```json
[
  {
    "AllowedOrigins": ["https://classroom.yourdomain.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

网页编辑器使用上述格式。仓库deploy/r2-cors.json为Wrangler CLI格式，不能原样贴到网页编辑器。正式域名更改后也要更新CORS。[R2 CORS说明](https://developers.cloudflare.com/r2/buckets/cors/)

## 8. 创建R2上传凭据

1. R2概览 → Manage R2 API Tokens（部分界面在账号详情入口）。
2. 创建R2 API Token / User API Token，权限Object Read & Write，范围仅classroom-private。
3. 复制Access Key ID和Secret Access Key并安全保存，Secret Access Key通常仅在创建时显示。

这里需要两项S3凭据，不要将另外的API Token文本误填为Access Key ID。凭据不上传GitHub、不填Pages、不放前端。[R2凭据说明](https://developers.cloudflare.com/r2/api/tokens/)

## 9. 创建空Worker并配置运行时Secrets

1. CF → Workers & Pages → Create application → Worker → Hello World / Start with Hello World。
2. 名称必须 `vip-classroom-api` → Deploy。临时Hello World随后会被仓库代码替换。
3. Worker → Settings → Variables and Secrets，添加下表四项，类型均选 **Secret**。按界面提示Save / Deploy使设置生效。

| Secret | 值 |
| --- | --- |
| BOOTSTRAP_TOKEN | 第7步初始化密钥 |
| SETTINGS_ENCRYPTION_KEY | 第7步另一份64位十六进制加密密钥 |
| R2_ACCESS_KEY_ID | 第8步Access Key ID |
| R2_SECRET_ACCESS_KEY | 第8步Secret Access Key |

这是Worker运行时设置，不是Builds构建变量。加密密钥应备份并保持稳定；更换后已保存的缓存清理凭据需重新填写。

此时不用手动添加DB/MEDIA绑定，也不用手动添加路由，正式部署会统一配置。

## 10. 给第9步的同一个Worker连接GitHub

只使用第9步创建的 `vip-classroom-api`，不创建第二个Worker，也不要再次点击Create application。

1. CF → Workers & Pages → 打开 `vip-classroom-api` → Settings → Builds / Build → Connect，选第2步同一GitHub仓库，生产分支main，根目录留空或 `/`。
2. 填下面命令，均由CF执行：

| 字段 | 值 |
| --- | --- |
| Build command | `npm run cf:build` |
| Deploy command | `npm run cf:deploy` |
| Builds for non-production branches（启用预览构建） | 关闭 |
| Non-production branch deploy command | 关闭预览构建时跳过，无需填写 |

如以后开启非生产分支构建，可将Non-production branch deploy command填为 `npm run cf:preview`。该备用命令只输出跳过提示，不迁移数据库或发布Worker。

3. 在 **Builds内的Build variables and secrets** 添加以下构建变量：

| 变量 | 值 |
| --- | --- |
| NODE_VERSION | `22.14.0` |
| CLOUDFLARE_ACCOUNT_ID | 第1步32位Account ID |
| BUILD_D1_DATABASE_ID | 第3步Database ID |
| BUILD_APP_ORIGIN | 正式来源，例如 `https://classroom.yourdomain.com`，无结尾斜杠 |
| BUILD_ZONE_NAME | CF区域名称，例如 `yourdomain.com`，不是Zone ID、子域名或网址 |

名称必须一致；D1/R2/Worker名称固定，不用额外填。生产分支默认main；若改为其他分支，额外设置构建变量BUILD_PRODUCTION_BRANCH，并同步修改CF生产分支字段。

如果连接仓库自动触发了缺少变量的构建，补齐后保存，完成下一步授权，再Retry build；不用修改代码。部分界面可以在连接表单中直接填写变量。

构建变量只对CF部署服务器可见，不能替代第9步运行时Secrets。[构建设置说明](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)

## 11. 构建授权增加D1迁移权限

CF自动创建的构建令牌默认权限可能不含D1 Edit。Worker能发布不代表能执行迁移。

1. 在Worker → Settings → Builds查看使用的API token名称。
2. 右上角头像 → My Profile → API Tokens，找到此令牌 → Edit。
3. 保留已有权限，添加 **Account → D1 → Edit**，范围选本站账号。确认同时具备：
   - Account → Workers Scripts → Edit。
   - Account → Workers R2 Storage → Edit。
   - Account → Account Settings → Read。
   - Zone → Workers Routes → Edit，范围包含本站区域。
   - Zone → Zone → Read，范围包含本站区域，供按名称定位区域。
4. 保存。若自动令牌不可编辑，则Create Token → Create Custom Token，按上述权限创建，在Builds的API token设置中选择使用它。若界面要求输入令牌值，仅填CF对应的机密字段，不上传仓库。

这是构建部署授权，与R2上传凭据、初始化密钥均不同。[默认构建令牌权限](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token)、[Worker路由授权](https://developers.cloudflare.com/workers/authorization/workers/)

## 12. 触发正式Worker部署

1. 先完成第10步Git连接、第10步构建变量以及第11步授权，再保存设置。Hello World发布记录不是Git构建记录，未连接仓库时不会有可重试的Git构建。
2. 已有Git构建记录时，打开对应记录的详情，使用界面提供的Retry build（重试构建）。如果没有此按钮，在GitHub的main分支提交一次真实文件改动即可触发自动构建，不必寻找Trigger build按钮。
3. 日志应依次显示：生产配置生成 → D1迁移成功或无需迁移 → Worker发布成功。
4. 迁移失败会停止发布；迁移成功但发布失败时，迁移已生效，解决错误后重试即可。
5. Worker → Bindings应显示 `DB` → classroom，`MEDIA` → classroom-private。
6. Worker → Settings → Domains & Routes应有两条 **Route**：`classroom.yourdomain.com/api/*`、`classroom.yourdomain.com/media/*`。
7. 不给Worker添加占据整个网站域名的Custom Domain；网站域名属于Pages，Worker按路径接管。[路由说明](https://developers.cloudflare.com/workers/configuration/routing/routes/)
8. 运行变量应含APP_ORIGIN、ENVIRONMENT=production、R2_ACCOUNT_ID、R2_BUCKET_NAME=classroom-private；脚本设置每小时一次Cron。
9. 打开 `https://classroom.yourdomain.com/api/v1/health`，应显示JSON且status为ok。freeTierVerified:false表示免费档性能尚未确认，不是连接错误。

网页路径 → Pages；/api/*和/media/* → Worker。前端已使用同域相对路径，不需要Pages另加Worker绑定，也不需要再部署Pages接线。

生产配置文件由CF构建变量自动生成，不上传仓库。绑定、路由及上述四项受管理的运行变量以构建设置为准；不要只在运行时界面改这四项，否则下一次部署会恢复构建值。其他后台变量通过keep_vars:true保留；Secrets不会写入生成配置。

## 13. 初始化管理员

1. 打开正式网站 `/setup`。
2. 输入BOOTSTRAP_TOKEN、未注册过的管理员邮箱、密码及确认密码 → 创建管理员。
3. 成功后正常登录，进入管理后台。初始化不自动建立登录会话。
4. 数据库永久记录已完成；再次访问setup入口关闭，删除管理员、更换密钥或重新部署也不会重开。
5. 可在Worker运行时Secrets删除BOOTSTRAP_TOKEN，按提示保存生效。保留加密密钥和两项R2凭据。

普通用户先注册也不会成为管理员，已注册邮箱会拒绝初始化，不会提升原账号。已有管理员的旧数据库升级时自动记录已完成。

管理后台“系统设置”的缓存清理凭据属于可选功能，与云资源绑定不同，见[系统设置说明](system-settings.md)。

## 14. 线上验收与更新

- 管理员登录、创建课程/章节，上传真实封面和H.264/AAC MP4。
- 大于32MiB视频验证多分片、重试、刷新后重新选文件恢复；手机播放和拖动进度。
- 注册普通用户，确认默认无VIP；授予等级及日期后可看对应课程；未登录、降级或到期的新视频请求被拒绝。
- 删除/替换、定时清理；CF缓存规则绕过/api/*和/media/*，尊重no-store。
- 查看真实Worker CPU及1102错误：原有scrypt密码计算尚未证明能满足Workers Free预算，初始化也使用同一密码算法。可能需升级或另议认证；本地测试不是免费档线上验收。
- 大陆不同网络实测登录、直传与播放。

后续GitHub提交会触发Pages前端部署和Worker迁移/发布，两者独立，检查二者状态。保留迁移历史，不修改已执行迁移。重大数据库变更先备份并评估对旧Worker的兼容性。不同人各自填写CF配置即可复用。

## 常见问题

| 问题 | 检查 |
| --- | --- |
| 缺少BUILD_* | 放在Worker的Builds变量中，保存后重试 |
| Worker名称不匹配 | 必须vip-classroom-api，仓库根目录正确 |
| D1未授权 | 构建API token的D1 Edit及账号范围 |
| 路由未授权 | Zone Read、Workers Routes Edit、区域名称、DNS代理 |
| 表已存在 | 可能手动执行SQL但缺迁移记录；先备份核对，不删除数据硬重试 |
| health显示HTML/404 | 正式域名Route缺失、指错Worker或用了pages.dev |
| 写请求403 | BUILD_APP_ORIGIN与浏览器实际来源不一致 |
| 初始化未启用 | BOOTSTRAP_TOKEN是运行时Secret，32–256字符 |
| 初始化已完成 | 正常登录；入口不会重开 |
| R2密钥未配置 | 两项S3凭据放Worker运行时Secrets |
| 上传CORS错误 | 网页数组格式、正式来源、PUT、Content-Type、ExposeHeaders ETag |
| 登录/初始化1102 | 查看CPU预算和日志，重部署不能保证解决 |

本次没有在你的CF账号创建资源、绑定域名或开通服务。线上权限、实际界面和性能仍以部署后的验收为准。
