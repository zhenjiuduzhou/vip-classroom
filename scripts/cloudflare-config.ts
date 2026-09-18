import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function productionConfig(input: NodeJS.ProcessEnv) {
  function required(name: string) {
    const value = input[name]?.trim();
    if (!value) throw new Error(`请在 CF Worker 的 Settings → Builds → Variables and secrets 填写 ${name}`);
    return value;
  }
  const account = required('CLOUDFLARE_ACCOUNT_ID');
  if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error('CLOUDFLARE_ACCOUNT_ID 必须是32位账户ID');
  const database = required('BUILD_D1_DATABASE_ID');
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(database) || database === '00000000-0000-0000-0000-000000000000') throw new Error('BUILD_D1_DATABASE_ID 必须是实际的 D1 Database ID');
  const origin = required('BUILD_APP_ORIGIN');
  let url: URL;
  try {url = new URL(origin);} catch {throw new Error('BUILD_APP_ORIGIN 必须是正式 HTTPS 网站来源');}
  if (url.protocol !== 'https:' || origin !== url.origin || url.port || url.username || url.password)
    throw new Error('BUILD_APP_ORIGIN 示例：https://classroom.yourdomain.com，不带结尾斜杠、路径或端口');
  const zone = required('BUILD_ZONE_NAME').toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(zone) || !(url.hostname === zone || url.hostname.endsWith(`.${zone}`)))
    throw new Error('BUILD_ZONE_NAME 必须是包含网站域名的 Cloudflare 区域名称，例如 yourdomain.com');
  if (zone === 'example.com' || zone.endsWith('.example.com') || url.hostname.endsWith('.pages.dev'))
    throw new Error('请使用已加入 Cloudflare 的正式域名');
  return {
    $schema:'node_modules/wrangler/config-schema.json',
    name:'vip-classroom-api',main:'src/worker.ts',compatibility_date:'2026-09-17',
    account_id:account,workers_dev:false,preview_urls:false,keep_vars:true,
    routes:[{pattern:`${url.hostname}/api/*`,zone_name:zone},{pattern:`${url.hostname}/media/*`,zone_name:zone}],
    vars:{APP_ORIGIN:origin,ENVIRONMENT:'production',R2_ACCOUNT_ID:account,R2_BUCKET_NAME:'classroom-private'},
    d1_databases:[{binding:'DB',database_name:'classroom',database_id:database,migrations_dir:'migrations'}],
    r2_buckets:[{binding:'MEDIA',bucket_name:'classroom-private'}],
    observability:{enabled:true},triggers:{crons:['0 * * * *']}
  };
}
export async function generateProductionConfig() {
  const config = productionConfig(process.env);
  await writeFile(fileURLToPath(new URL('../wrangler.production.jsonc',import.meta.url)),JSON.stringify(config,null,2)+'\n');
  console.log('生产配置已从 CF 构建变量生成；未包含运行时密钥。');
}
export function assertProductionBranch(input: NodeJS.ProcessEnv) {
  if (input.WORKERS_CI === '1' && input.WORKERS_CI_BRANCH !== (input.BUILD_PRODUCTION_BRANCH || 'main'))
    throw new Error('已拒绝非生产分支或缺少分支信息的部署，未执行数据库迁移。生产分支默认 main，可通过 BUILD_PRODUCTION_BRANCH 修改。');
}
