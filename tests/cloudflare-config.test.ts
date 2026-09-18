import { describe, expect, it } from 'vitest';
import { assertProductionBranch, productionConfig } from '../scripts/cloudflare-config';
const input={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),BUILD_D1_DATABASE_ID:'12345678-1234-1234-1234-123456789abc',BUILD_APP_ORIGIN:'https://classroom.myacademy.com',BUILD_ZONE_NAME:'myacademy.com'};
describe('CF 构建配置',()=>{
  it('拒绝预览分支修改生产资源，允许指定生产分支',()=>{
    expect(()=>assertProductionBranch({WORKERS_CI:'1',WORKERS_CI_BRANCH:'feature'})).toThrow();
    expect(()=>assertProductionBranch({WORKERS_CI:'1'})).toThrow();
    expect(()=>assertProductionBranch({WORKERS_CI:'1',WORKERS_CI_BRANCH:'main'})).not.toThrow();
    expect(()=>assertProductionBranch({WORKERS_CI:'1',WORKERS_CI_BRANCH:'release',BUILD_PRODUCTION_BRANCH:'release'})).not.toThrow();
  });
  it('固定绑定及路径，保留后台变量，不写入密钥',()=>{
    const c=productionConfig({...input,BOOTSTRAP_TOKEN:'secret',R2_SECRET_ACCESS_KEY:'secret'});
    expect(c.keep_vars).toBe(true);expect(c.workers_dev).toBe(false);
    expect(c.d1_databases[0]).toMatchObject({binding:'DB',database_name:'classroom',database_id:input.BUILD_D1_DATABASE_ID});
    expect(c.r2_buckets[0]).toEqual({binding:'MEDIA',bucket_name:'classroom-private'});
    expect(c.routes.map(r=>r.pattern)).toEqual(['classroom.myacademy.com/api/*','classroom.myacademy.com/media/*']);
    expect(JSON.stringify(c)).not.toContain('secret');
  });
  it.each(Object.keys(input))('缺少 %s 时拒绝发布',key=>{
    expect(()=>productionConfig({...input,[key]:''})).toThrow();
  });
  it.each(['http://classroom.myacademy.com','https://classroom.myacademy.com/','https://classroom.myacademy.com/path','https://user:pass@classroom.myacademy.com','https://classroom.myacademy.com:8443','https://other.com','https://demo.pages.dev'])('拒绝错误来源 %s',origin=>{
    expect(()=>productionConfig({...input,BUILD_APP_ORIGIN:origin})).toThrow();
  });
  it('拒绝示例数据库ID、错误区域和账户ID',()=>{
    expect(()=>productionConfig({...input,BUILD_D1_DATABASE_ID:'00000000-0000-0000-0000-000000000000'})).toThrow();
    expect(()=>productionConfig({...input,BUILD_ZONE_NAME:'https://myacademy.com'})).toThrow();
    expect(()=>productionConfig({...input,CLOUDFLARE_ACCOUNT_ID:'REPLACE_ACCOUNT_ID'})).toThrow();
  });
});
