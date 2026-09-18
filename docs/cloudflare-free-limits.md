# Cloudflare 免费档限制与本次修复

核对日期：2026-09-18。以下是平台限制，并非本地模拟器的限制。

| 限制 | 免费额度 | 本项目对应位置 |
| --- | --- | --- |
| Workers 内部服务子请求 | 每次调用 1000 次 | src/uploads.ts 的 R2 校验读取、数据库操作；src/mp4.ts 最多调用读取器 128 次，超限提示重新导出 |
| Workers 普通子请求 | 每次调用 50 次 | Worker 内的外部 fetch；浏览器直接 PUT 到 R2 不属于 Worker 内的 fetch |
| D1 查询 | 每次 Worker 调用 50 条 | src/cleanup.ts 每轮最多取消 6 个过期上传、处理 16 个删除任务，最多 38 条清理查询，给 HTTP 认证留余量；batch 中的 SQL 仍应计入预算 |
| Workers CPU | HTTP 和 Cron 每次 10ms | src/security.ts 的 scrypt、src/mp4.ts 的元数据解析；等待存储响应不计 CPU，线上实际 CPU 仍需验证 |
| Workers 内存 | 128MB | MP4 moov 最大 16MiB；封面读取并校验同一份最多 5MiB 数据；scrypt 也占内存 |
| Workers 请求 | 每天 100000 次 | API、视频 Range 和封面路由，播放器多次 Range 请求会分别计数 |
| D1 每日读写 | 读取 500 万行，写入 10 万行 | 计入扫描行和索引维护，不等于接口调用次数；额度用尽后查询会失败 |
| D1 存储 | 每个库 500MB、账户总共 5GB | 用户、课程、上传、会话和清理记录；视频存储在 R2 |
| R2 Standard 免费用量 | 每月 10GB-month、100万次 Class A、1000万次 Class B | 视频和封面容量；分片和发布写入为 A 类，head/get 为 B 类；出网免费，超过免费用量仍可能计费 |
| Cloudflare Free 请求体 | 100MB | 视频使用 16MiB 分片直传 R2，2GB 是本项目单个视频总大小上限，不是 Worker 单次请求体大小 |

上传完成锁在 15 分钟后失效，NULL 锁也可回收。取消可处理锁失效的 COMPLETING；定时清理处理已过期的 UPLOADING 和锁失效的 COMPLETING。未过期的中断完成仍可恢复。新发布和错误回退都检查自己领取的锁，防止旧请求修改新状态。

封面签名链接仍有 15 分钟有效期，目标仅为暂存对象。完成时按 ETag 条件读取完整封面，校验并写入另一个随机对象，再更新课程。旧链接无法写入发布对象。暂存对象延迟至少 16 分钟清理。发布对象在写入前登记清理任务，成功提交时移除，避免中断写入留下没有清理记录的对象。旧封面的清理登记使用事务中的 INSERT SELECT，紧接着更新课程，避免并发完成读到同一个旧封面。

清理 Cron 当前每小时运行一次；积压任务分批处理。对象清理失败仍保留任务并退避重试。

密码校验及页面输入改为 6–128 字符；密码哈希参数保持不变。scrypt N=32768/r=8/p=3 的计算负担仍可能超出免费档 10ms CPU，不应把本地测试通过视为免费档线上验收通过。

上传修复验证：TypeScript 类型检查、54 项自动测试、生产前端构建通过。上传测试使用真实 SQLite 执行数据库 SQL，R2 使用内存对象模拟；未部署、未验证真实 R2 签名/CORS 和 Workers CPU。

后续系统设置新增 Cloudflare 前缀清理：每批6个前缀、每分钟最多1次请求；runCleanup 与 runCachePurge 连续执行最多48条D1查询。详见[系统设置说明](system-settings.md)。

官方文档：

- [Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 限制](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 免费额度](https://developers.cloudflare.com/d1/platform/pricing/)
- [R2 免费用量与计费](https://developers.cloudflare.com/r2/pricing/)
