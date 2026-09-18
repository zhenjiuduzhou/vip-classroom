import { describe, expect, it } from 'vitest';
import { canAccess, expiryForBeijingDate, hashPassword, normalizeEmail, normalizePhone, parseRange, sha256, verifyPassword, validPassword } from '../src/security';
describe('密码与凭据', () => {
  it('允许6–128字符密码',()=>{
    expect(validPassword('12345')).toBe(false);expect(validPassword('123456')).toBe(true);
    expect(validPassword('x'.repeat(128))).toBe(true);expect(validPassword('x'.repeat(129))).toBe(false);
  });
  it('随机盐、正确密码、错误密码、格式拒绝', async () => {
    const a = await hashPassword('strong-test-password');
    const b = await hashPassword('strong-test-password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('strong-test-password', a)).toBe(true);
    expect(await verifyPassword('wrong-test-password', a)).toBe(false);
    expect(await verifyPassword('strong-test-password', 'scrypt$v1$1$1$1$xx$xx')).toBe(false);
  }, 30000);
  it('规范化及拒绝无效联系方式', () => {
    expect(normalizeEmail(' Test@Example.com ')).toBe('test@example.com');
    expect(normalizePhone('138 1234 5678')).toBe('+8613812345678');
    expect(normalizePhone('+86 13812345678')).toBe('+8613812345678');
    expect(() => normalizePhone('123')).toThrow();
    expect(() => normalizeEmail('invalid')).toThrow();
  });
  it('会话令牌哈希', async () => expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
});
describe('VIP权限与到期', () => {
  for (let level = 1; level <= 5; level++) for (let required = 1; required <= 5; required++) {
    it(`VIP${level} -> VIP${required}`, () => expect(canAccess({role:'USER',vip_level:level,vip_expires_at:null},required)).toBe(level >= required));
  }
  it('未开通、到期边界、管理员', () => {
    const expiry = expiryForBeijingDate('2026-09-17');
    expect(expiry).toBe('2026-09-17T16:00:00.000Z');
    const user = {role:'USER',vip_level:3,vip_expires_at:expiry};
    expect(canAccess(user,3,Date.parse(expiry)-1)).toBe(true);
    expect(canAccess(user,3,Date.parse(expiry))).toBe(false);
    expect(canAccess({...user,vip_level:null},1)).toBe(false);
    expect(canAccess({...user,role:'ADMIN'},5)).toBe(true);
    expect(() => expiryForBeijingDate('2026-02-30')).toThrow();
  });
});
describe('单段范围读取', () => {
  it.each([['bytes=0-9',0,10],['bytes=10-',10,90],['bytes=-10',90,10],['bytes=90-200',90,10],['bytes=-200',0,100]])('%s', (value,offset,length) => expect(parseRange(value,100)).toEqual({offset,length}));
  it.each(['bytes=100-','bytes=9-1','bytes=-0','bytes=0-1,3-4','bytes=-','foo','bytes=999999999999999999999-'])('拒绝 %s', value => expect(parseRange(value,100)).toBeNull());
});
