# AI FDE Academy VIP 课程平台

React + Vite（Pages）、Hono（Workers）、D1、私有R2。实现公开首页、学员课程播放、用户权限后台、文件夹课程后台、排序移动和上传队列。

## 本地启动

需要Node.js 22.14+、npm。首次运行：

```powershell
npm ci
npm run db:migrate
npm run seed
npm run dev
```

打开 **http://localhost:5173**，前端5173代理API8787。seed仅本地执行，重置演示账号密码、权限和会话；不要导入生产。

统一演示密码：`Demo-Classroom-2026`。

| 账号 | 身份 |
| --- | --- |
| admin@example.com | 管理员 |
| student@example.com | VIP3永久 |
| pending@example.com | 未开通 |
| expired@example.com | 已到期VIP5 |

测试素材是自行生成的四秒画面与音调。

## 测试与构建

```powershell
npm run typecheck
npm test
npm run build
npm run deploy:check
# 以下需dev正在运行，先seed
npm run test:integration
npx playwright install chromium
npm run test:e2e
```

生产前端输出dist/。E2E自动重置演示账号，截图在screenshots/，失败记录在test-results/，均忽略提交。

## 主要行为

- 手机号或邮箱二选一注册，6–128字符密码，无验证码，注册后无VIP。
- 随机会话只存哈希；退出、重置密码使会话失效。生产Cookie为HttpOnly/Secure/SameSite=Lax。
- VIP1–VIP5向下兼容，日期按北京时间当天结束计算；权限逐请求从D1读取。
- 课程创建后立即展示，仅READY视频可播放。后台拖拽同级排序，菜单移动，删除确认影响数量。
- H.264/AAC MP4，允许无音轨，最大2,000,000,000字节。客户端和服务端校验有限元数据，不转码，不提供完整视频损坏检测。
- 16MiB分片、3个并发、失败3次重试、取消、重新选原文件恢复。生产浏览器直传R2，本地专用接口适配模拟R2。
- 视频GET/HEAD/Range/206/416，private/no-store；R2不开公共访问，封面仅按课程ID公开读取。
- 数据库删除先撤销访问，定时任务重试清理对象。中断完成请求有15分钟恢复锁。
- L1–L4商业档位不自动绑定VIP1–VIP5，人工指导、陪跑和报名线下完成。没有在线支付、评论、学习记录或社区功能。

首页集中配置在src/content/home.ts，保留四档价格及L4的90天首单全额退款承诺，无虚构学员评价。

见[Cloudflare网页部署全流程](docs/deployment.md)、[API说明](docs/api.md)、[验证记录](docs/validation.md)。部署配置在CF的Worker构建变量填写；固定D1 `classroom`、R2 `classroom-private`、Worker `vip-classroom-api`。CF执行 `cf:deploy` 自动迁移后发布，生产配置不提交。正式域名 `/setup` 创建首任管理员，`/deployment-tools` 在浏览器生成安装密钥及网页R2 CORS配置，无需本地终端。
本次上传修复与各免费额度对应代码见[Cloudflare 免费档限制](docs/cloudflare-free-limits.md)。
后台 Cloudflare 配置及凭据加密部署步骤见[系统设置说明](docs/system-settings.md)。

用户已授权先完成本地版本，再自行部署。**免费档性能、实际R2直传CORS及大陆网络播放待线上验证。**没有降低scrypt安全参数，没有开通付费服务，本地结果不能替代线上测试。
