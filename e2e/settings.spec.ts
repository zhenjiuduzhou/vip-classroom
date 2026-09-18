import { test, expect } from '@playwright/test';

test('系统设置入口、凭据保存与认证方式切换',async({page})=>{
  let config={zoneId:'',email:'',authMode:'token',enabled:false,hasSecret:false,encryptionReady:true,lastStatus:'',pending:0};
  let lastWrite:Record<string,unknown>={};
  await page.route('**/api/v1/auth/me',route=>route.fulfill({json:{user:{id:'admin',email:'admin@example.com',name:'管理员',role:'ADMIN',vipLevel:null,vipExpiresAt:null}}}));
  await page.route('**/api/v1/admin/tree',route=>route.fulfill({json:{courses:[]}}));
  await page.route('**/api/v1/admin/uploads',route=>route.fulfill({json:{uploads:[]}}));
  await page.route('**/api/v1/admin/settings',async route=>{
    if(route.request().method()==='PUT'){
      lastWrite=route.request().postDataJSON();
      config={...config,zoneId:lastWrite.zoneId as string,email:lastWrite.email as string,authMode:lastWrite.authMode as string,enabled:lastWrite.enabled as boolean,hasSecret:!!lastWrite.secret};
      await route.fulfill({json:{ok:true}});
    }else await route.fulfill({json:config});
  });
  await page.goto('/admin');await page.getByRole('link',{name:'系统设置'}).click();
  await expect(page.getByRole('heading',{name:'系统设置',exact:true})).toBeVisible();
  await page.getByLabel('区域 ID（Zone ID）').fill('a'.repeat(32));
  await page.getByLabel('账户邮箱（可选）').fill('owner@example.com');
  await page.getByLabel('API Token', {exact:true}).fill('example-token-for-ui-test');
  await page.getByLabel('启用封面缓存自动清理').check();
  await page.getByRole('button',{name:'保存设置'}).click();
  await expect(page.getByRole('status')).toHaveText('系统设置已保存');
  expect(lastWrite.secret).toBe('example-token-for-ui-test');
  await expect(page.getByLabel('API Token',{exact:true})).toHaveValue('');
  await expect(page.getByRole('button',{name:'测试已保存配置'})).toBeEnabled();
  await page.screenshot({path:'screenshots/system-settings-desktop.png',fullPage:true});
  await page.getByLabel('认证方式').selectOption('key');
  await expect(page.getByLabel('API Key',{exact:true})).toBeVisible();
  await page.getByLabel('API Key',{exact:true}).fill('example-key-for-ui-test');
  await page.getByRole('button',{name:'显示凭据'}).click();
  await expect(page.getByLabel('API Key',{exact:true})).toHaveAttribute('type','text');
  await page.getByRole('button',{name:'保存设置'}).click();
  await expect(page.getByRole('status')).toHaveText('系统设置已保存');
  expect(lastWrite.authMode).toBe('key');expect(lastWrite.email).toBe('owner@example.com');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'screenshots/system-settings-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
