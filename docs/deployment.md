# Cloudflare 网页部署全流程

主要通过 GitHub 和 CF 网页后台操作，无需本地安装Node.js或Wrangler。下文的“构建命令/部署命令”粘贴到 CF 表单，由 CF 服务器执行。仅在自动构建未触发、需要Deploy Hook时，可使用Windows自带PowerShell发送一条请求。菜单可能显示中文或英文，以括号内英文和字段名定位。

更新于2026-09-18：根据用户提供的真实CF日志，已确认一次D1四个迁移、Worker发布、资源绑定、路由和Cron配置成功；正式域名health接口实测HTTP 200。管理员初始化、真实R2直传、播放、免费档CPU及大陆网络仍需另行验收。

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

记录完整仓库地址 `GitHub用户名/仓库名`。原项目仓库为 `zhenjiuduzhou/vip-classroom`；若复制到其他账号，例如 `zhenzhuo000/vip-classroom`，它就是另一个独立仓库。在原仓库提交不会触发连接到副本的Worker。Pages和Worker应连接你实际准备部署的那份完整仓库。

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

添加表单可能默认选“变量”，务必先把类型下拉框改为“机密 / Secret”，再填写值。不要将这四项配置成普通文本变量。保存后确认类型是Secret，值被隐藏；不要把密钥值截图或贴进日志分享。

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

连接后核对“Git存储库”中完整的用户名和仓库名，不要只看vip-classroom名称。Pages连接成功不会自动替Worker连接GitHub。
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

### 没有构建记录时：先核对仓库，再用部署挂钩触发

“部署”页的“最近构建”显示“此Worker还没有构建”，说明这里尚无Git构建记录，不能使用Retry build。先核对第10步连接的完整仓库地址、main分支、构建监视路径及已保存的设置。在其他账号同名仓库提交不会触发这个Worker。

如果Git连接正确，可使用Deploy Hook（部署挂钩）：

1. 同一个Worker → 设置 → 构建，向下找到“部署挂钩”，点击右侧“＋添加”。这不是下方“Cron触发器”的添加按钮。
2. 名称填 `manual-main`，分支选 `main`，创建并复制生成的Hook URL。
3. Windows开始菜单搜索并打开PowerShell。不需要安装软件或切换到项目目录。
4. 将下面引号中的文字替换成自己的完整Hook URL，粘贴到PowerShell并按回车：

```powershell
Invoke-RestMethod -Method Post -Uri "这里替换成完整的Hook URL"
```

5. 返回Worker → 部署 → 最近构建，刷新，查看新记录及日志。请求返回success:true表示触发已接受，不代表构建或发布已完成。

Hook URL含触发凭据，只在本机/CF中使用，不上传GitHub或公开分享。浏览器地址栏打开URL发送的是GET，不能代替上述POST。此方法构建的是Worker当前连接的仓库，不会替你同步其他账号仓库的代码。[官方Deploy Hooks说明](https://developers.cloudflare.com/workers/ci-cd/builds/deploy-hooks/)

### 日志成功但后台路由或Cron为空

生产脚本实际执行 `wrangler deploy` 后，绑定、路由和Cron正常应在后台显示，不是“只在脚本中存在”。检查日志尾部是否同时出现：

```text
Uploaded vip-classroom-api
Deployed vip-classroom-api triggers
  你的正式域名/api/*
  你的正式域名/media/*
  schedule: 0 * * * *
Current Version ID: ...
Success: Deploy command completed
```

仅Build command completed不是部署成功。确认完整发布成功后：

1. 关闭旧Worker页面，从Workers和Pages列表重新进入同一个Worker；必要时强制刷新。
2. 核对当前CF账号的Account ID与CLOUDFLARE_ACCOUNT_ID一致，并核对最新已发布Version ID。相同名称的Worker可以存在于不同账号，不要混淆。
3. “绑定”页检查DB和MEDIA；“域”页检查正式域名的两条路由。脚本应关闭workers.dev生产访问；若仍开启且路由空，继续核对账号、版本与页面状态。
4. 设置 → 触发事件 → Cron触发器检查 `0 * * * *`。Cron变更传播可能需要最多15分钟。[官方Cron说明](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
5. 用正式域名health接口验证API路由。health成功仅验证这一条API请求，不能证明媒体权限或定时清理均已通过。

不要仅因旧页面显示空白就重复添加路由和Cron。若账号、版本、刷新及等待后仍不一致，应结合实际日志继续排查；确需手动补配时，使用“添加路由”配置/api/*和/media/*，不要用“添加域名”占据Pages的整个域名；Cron为每小时一次。后续部署仍以构建生成的配置为准。

### 日志出现密钥明文：修正运行时类型

如果部署日志在vars差异中输出BOOTSTRAP_TOKEN、SETTINGS_ENCRYPTION_KEY或R2密钥的值，说明这些值被当作普通变量处理，不应忽略。

1. Worker → 设置 → 变量和机密，检查四项运行时凭据，将其改为Secret；若界面不支持改类型，按提示移除普通变量后，以同名Secret重新添加并保存生效。
2. 已输出到日志并分享的R2凭据应重新创建、更新Worker中的两项Secret，并撤销旧R2令牌。
3. 尚未初始化时更换BOOTSTRAP_TOKEN；已初始化后可以删除它，入口仍永久关闭。
4. SETTINGS_ENCRYPTION_KEY尚未使用时可换新；若已保存加密凭据，换密钥后必须重新填写后台缓存清理凭据。管理员密码与R2对象不由此密钥加密。

不需要重建D1/R2、删除数据或重新执行已成功的迁移。

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

## 15. 已部署网站更换域名

适用于继续使用同一 Cloudflare 账号、Pages 项目、Worker、D1 和 R2，仅更换网站网址。不需要重建项目、重新初始化管理员或导入数据；现有账号、VIP、课程和视频继续保留。前端使用同域相对路径，通常无需修改代码。

以下以新网址 `https://classroom.newdomain.com` 为例。正式来源不带结尾斜杠；区域名称为 `newdomain.com`，不是子域名、Zone ID 或完整网址。

### 15.1 接入新域名并绑定现有 Pages

1. 如果换整个主域名，将 `newdomain.com` 添加到当前 Cloudflare 账号，按提示到注册商修改 Nameservers，等待区域状态 Active。只换已有区域下的子域名时，跳过接入步骤。
2. Workers & Pages → 现有 Pages 项目 → Custom domains → Set up a domain，输入 `classroom.newdomain.com`，按提示确认 DNS。
3. 等待域名状态 Active 和 HTTPS 生效，打开新网址确认首页正常。
4. 新网站 DNS 记录必须为 Proxied（橙色云），供后续 Worker 路由接管 API 和媒体路径。必须在 Pages 中绑定域名，不能只手动改 CNAME。
5. 先保留旧域名，等新网址完整验收后再处理旧入口。

[Pages 自定义域名官方说明](https://developers.cloudflare.com/pages/configuration/custom-domains/)

### 15.2 修改 Worker 构建变量和区域授权

打开 `vip-classroom-api` → Settings → Builds → Build variables and secrets，修改：

| 构建变量 | 示例值 | 说明 |
| --- | --- | --- |
| BUILD_APP_ORIGIN | `https://classroom.newdomain.com` | 新网站 HTTPS 来源，无结尾斜杠 |
| BUILD_ZONE_NAME | `newdomain.com` | 新主域名对应的 Cloudflare 区域；只换子域名时保持原值 |

保留原 CLOUDFLARE_ACCOUNT_ID、BUILD_D1_DATABASE_ID、D1/R2 绑定和运行时 Secrets，尤其不要因换域名重新生成 SETTINGS_ENCRYPTION_KEY。

如果换主域名，检查第11步使用的构建 API Token：Zone → Zone → Read 和 Zone → Workers Routes → Edit 的区域范围必须包含新区域；仅授权旧区域的令牌需要调整。

保存构建变量后，按第12步重新触发一次 Worker Git 构建部署。不要只修改运行时 APP_ORIGIN 或手动路由，否则下一次构建会按 BUILD_* 值覆盖。部署脚本会生成新的 APP_ORIGIN 和两条路由：

```text
classroom.newdomain.com/api/*
classroom.newdomain.com/media/*
```

部署成功后，检查 Worker → Settings → Domains & Routes 中两条 Route 均指向同一个 Worker，并检查运行时 APP_ORIGIN 已为新来源。网站域名绑定在 Pages，Worker 使用路径路由，不添加占据整个网站域名的 Worker Custom Domain。

当前代码只接受一个 APP_ORIGIN；切换后旧来源的写请求会被拒绝，两个网址不能同时作为完整业务入口。建议选择访问较少的时间完成切换并通知用户。

[Worker 路由官方说明](https://developers.cloudflare.com/workers/configuration/routing/routes/)

### 15.3 更新 R2 上传 CORS

1. 打开新网站 `/deployment-tools`，输入新正式来源并生成 R2 网页 CORS 配置。换域名只需生成 CORS，无需生成或更换安装密钥。
2. Cloudflare → R2 → `classroom-private` → Settings → CORS Policy，将 AllowedOrigins 更新为新来源，保持 PUT、Content-Type 和 ExposeHeaders ETag。
3. 保存到 R2 后生效，无需为 CORS 另行部署代码。过渡期可以同时保留新旧来源，验收后移除旧来源；这不会使 Worker 同时接受两个 APP_ORIGIN。
4. 桶继续保持私有，不为视频桶添加公共自定义域名。

[R2 CORS 官方说明](https://developers.cloudflare.com/r2/buckets/cors/)

### 15.4 更新可选缓存清理设置与验收

如果后台“系统设置”启用了 Cloudflare 缓存清理：换主域名后更新新区域的 Zone ID，并确保缓存清理 API Token 有新区域的 Cache Purge 权限；只换同一区域下的子域名，Zone ID 不变。保存后点击“测试已保存配置”，详见[系统设置说明](system-settings.md)。新区域如有自定义缓存规则，应绕过 /api/* 和 /media/*，尊重 no-store。

逐项验证：

- 新网址 `/api/v1/health` 返回 JSON，status 为 ok；仅显示首页不能证明后端已接通。
- 使用现有管理员账号重新登录，确认原有用户、VIP 和课程仍在；新域名不会继承旧域名的登录 Cookie。
- 创建或编辑课程、上传封面和真实视频，确认写请求无来源校验 403，直传无 CORS 错误。
- 播放原有与新上传的视频，测试拖动进度，并检查未登录用户无法访问受保护内容。
- 在手机及实际使用网络验证访问。health 成功不能替代登录、上传与播放验收。

### 15.5 旧域名跳转和清理

确认新域名正常后，在旧域名的 Cloudflare 区域配置 Redirect Rule，将旧主机名的请求以 301 跳转到新网址，保留路径和查询参数，例如旧 `/login?next=...` 跳到新网址的对应地址。规则只匹配旧主机名，避免新域名跳转循环，并测试首页及课程深层链接。

需要长期跳转时，保留旧域名注册、Cloudflare 区域和可代理的 DNS 记录，确保旧 HTTPS 仍可访问。旧域名跳转不会迁移登录状态，用户需在新网址重新登录。检查并移除不再使用的旧 Worker 路由；旧 Pages 绑定和 DNS 的清理应以不破坏跳转为前提。

常见漏项：只改 Pages 域名会出现首页正常但 API 不通；未改 BUILD_APP_ORIGIN 会导致写请求 403；未改 R2 CORS 会导致上传失败；换主域名后未更新令牌区域范围会导致部署路由或缓存清理授权失败。

## 常见问题

| 问题 | 检查 |
| --- | --- |
| 缺少BUILD_* | 放在Worker的Builds变量中，保存后重试 |
| 提交后没有任何构建 | 核对完整仓库用户名/名称和生产分支；需要时使用部署挂钩POST触发 |
| 日志发布成功但后台为空 | 核对CF账号与Version ID，重进页面；Cron传播最多15分钟 |
| 日志出现密钥明文 | 普通变量误填为凭据，改运行时Secret并更换已暴露凭据 |
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

CF资源及发布操作由用户完成；本次依据用户提供的真实日志及health实测补充说明。其他线上行为、权限和性能仍以实际验收为准。
