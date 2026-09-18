import { test, expect } from '@playwright/test';

for (const width of [1440,390]) test(`首次初始化页面 ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:960});
  let completed=false;
  await page.route('**/api/v1/auth/bootstrap',async route=>{
    if(route.request().method()==='POST') {
      const data=route.request().postDataJSON();
      if(data.token!=='test-token-'.repeat(6)) return route.fulfill({status:403,json:{error:'初始化密钥错误'}});
      completed=true;return route.fulfill({status:201,json:{ok:true}});
    }
    return route.fulfill({json:{state:completed?'completed':'ready'}});
  });
  await page.goto('/setup');await expect(page.getByRole('heading',{name:'创建首任管理员'})).toBeVisible();
  await page.getByLabel('初始化密钥').fill('wrong-token-'.repeat(6));
  await page.getByLabel('管理员邮箱').fill('owner@example.com');
  await page.getByLabel('管理员密码',{exact:true}).fill('Owner-password-2026');
  await page.getByLabel('确认密码').fill('Owner-password-2026');
  await page.getByRole('button',{name:'创建管理员',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('初始化密钥错误');
  await page.getByLabel('初始化密钥').fill('test-token-'.repeat(6));
  await page.screenshot({path:`screenshots/bootstrap-${width}.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'创建管理员',exact:true}).click();
  await expect(page.getByText('管理员已创建，请使用刚设置的邮箱和密码登录。')).toBeVisible();
  await page.reload();await expect(page.getByText('本站已完成初始化，创建入口已关闭。')).toBeVisible();
  await expect(page.getByLabel('初始化密钥')).toHaveCount(0);
});

test('浏览器部署工具生成独立密钥和网页格式CORS',async({page})=>{
  await page.goto('/deployment-tools');
  await page.getByRole('button',{name:'生成两份独立密钥'}).click();
  const token=await page.getByLabel('BOOTSTRAP_TOKEN',{exact:true}).inputValue();
  const key=await page.getByLabel('SETTINGS_ENCRYPTION_KEY',{exact:true}).inputValue();
  expect(token).toMatch(/^[a-f0-9]{64}$/);expect(key).toMatch(/^[a-f0-9]{64}$/);expect(token).not.toBe(key);
  await page.getByLabel('正式网站来源').fill('https://classroom.myacademy.com/');
  await page.getByRole('button',{name:'生成 R2 网页 CORS 配置'}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('正式网站来源').fill('https://classroom.myacademy.com');
  await page.getByRole('button',{name:'生成 R2 网页 CORS 配置'}).click();
  const cors=JSON.parse(await page.getByLabel('复制到 R2 → Settings → CORS Policy').inputValue());
  expect(cors).toHaveLength(1);expect(cors[0].AllowedOrigins).toEqual(['https://classroom.myacademy.com']);expect(cors[0].ExposeHeaders).toContain('ETag');
  await page.reload();await expect(page.getByLabel('BOOTSTRAP_TOKEN',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('SETTINGS_ENCRYPTION_KEY',{exact:true})).toHaveValue('');
});
