# API V1

同域JSON API，返回资源或{ok:true}，失败{error:string}。401未登录、403无权限/来源失败、404不存在、409状态冲突、429限流。写请求必须带匹配APP_ORIGIN的Origin及X-CSRF-Protection:1，JSON最大32KiB。

## 身份（/api/v1前缀）

| 方法/路径 | 请求及行为 |
| --- | --- |
| GET /health | ok及freeTierVerified:false |
| POST /auth/register | email或phone、password、confirmPassword；201，建立会话 |
| POST /auth/login | account、password |
| POST /auth/logout | 删除会话 |
| GET /auth/me | 用户公开字段 |
| GET /auth/bootstrap | state: ready / disabled / completed，不返回密钥 |
| POST /auth/bootstrap | token、email、password、confirmPassword；创建首任管理员，201；完成后永久409 |

注册、登录与管理员初始化共用每IP每15分钟10次限流。初始化必须配置32–256字符的 BOOTSTRAP_TOKEN Secret，并遵循同域来源和CSRF检查；事务内记录永久初始化标记及管理员账号。邮箱已注册时拒绝提升普通用户。创建后不自动登录，通过正常登录接口建立会话。大陆11位手机号规范为+86，国际号码须+区号。会话七天，数据库只保存令牌哈希。

## 学员

| 方法/路径 | 行为 |
| --- | --- |
| GET /courses | 全部课程及accessible |
| GET /courses?mine=1 | 可访问课程 |
| GET /courses/:id | 校验后目录，仅READY小节 |
| GET /lessons/:id | 校验后videoUrl、nextId |
| GET/HEAD /media/lessons/:id（无API前缀） | 私有视频，单段Range支持；HEAD忽略Range |
| GET/HEAD /media/covers/:courseId（无API前缀） | 按数据库引用读取公开封面 |

## 管理（/api/v1/admin前缀）

| 方法/路径 | 数据/行为 |
| --- | --- |
| GET /tree | 三级目录，包括上传中小节 |
| GET /users?search=&page=1 | 搜索，每页20位 |
| PATCH /users/:id | email、phone、name、vipLevel（null/1–5）、expiresDate（空/YYYY-MM-DD） |
| POST /users/:id/password | password，删除已有会话 |
| DELETE /users/:id | 删除学员，禁止删除管理员 |
| POST /courses | title、description、requiredVip |
| PATCH /courses/:id | 同上 |
| POST /chapters | courseId、title |
| PATCH /chapters/:id、/lessons/:id | title |
| DELETE /courses/:id、/chapters/:id、/lessons/:id | 删除及入清理任务 |
| POST /sort | kind（courses/chapters/lessons）、parentId（非课程必填）、ids（完整同级列表） |
| POST /move | kind（chapters/lessons）、id、targetId |
| POST /cleanup | 执行到期清理 |

服务端逐次检查管理员身份，课程移动后继承目标VIP等级。

## 上传（/api/v1/admin/uploads前缀）

- POST /：kind=VIDEO、chapterId、title、filename、size、fingerprint；或kind=COVER、courseId、filename、size、fingerprint、contentType。返回id、lessonId、partSize。
- GET /：当前管理员待完成任务。GET /:id：状态、大小、指纹和已确认分片。
- POST /:id/sign：视频partNumber，封面空对象；返回15分钟PUT URL与headers。
- POST /:id/parts：partNumber、etag。POST /:id/complete：空对象，组装校验后发布，成功后幂等。
- POST /:id/cancel：空对象，未完成小节移除，文件入清理；正在完成或已完成返回409。
- PUT /:id/local/:part：只在local模式适配本地R2，生产404。视频part为1起，封面为0。

任务只由创建者管理，六天有效。VIDEO最大2,000,000,000字节，16MiB分片；COVER最大5MiB，仅JPEG/PNG/WebP。COMPLETING中断后15分钟可重试complete。指纹是名称/大小/修改时间及头尾内容的SHA256，供恢复文件辨识，不是整文件哈希。
