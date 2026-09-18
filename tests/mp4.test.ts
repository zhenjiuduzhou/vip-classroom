import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { inspectMp4, MP4_MAX_READS } from '../src/mp4';
describe('上传格式验证',()=>{
  it('拒绝大量顶层box，实际读取次数不会超过预算',async()=>{
    const bytes=await readFile('tests/fixtures/sample.mp4');
    const box=Buffer.alloc(8);box.writeUInt32BE(8);box.write('free',4);
    const complex=Buffer.concat([...Array.from({length:1006},()=>box),bytes]);
    let calls=0;
    await expect(inspectMp4(async(o,n)=>{calls++;return complex.subarray(o,o+n);},complex.length)).rejects.toThrow('过于复杂');
    expect(calls).toBe(MP4_MAX_READS);
  });
  it('接受真实H.264/AAC素材，读取量受限',async()=>{const bytes=await readFile('tests/fixtures/sample.mp4');let read=0;await inspectMp4(async(o,n)=>{read+=n;return bytes.subarray(o,o+n);},bytes.length);expect(read).toBeLessThan(bytes.length);});
  it('拒绝HEVC、伪装文件、过大文件和截断元数据',async()=>{
    const bytes=await readFile('tests/fixtures/sample.mp4');const invalid=Buffer.from(bytes);const index=invalid.lastIndexOf('avc1');invalid.write('hvc1',index);
    await expect(inspectMp4(async(o,n)=>invalid.subarray(o,o+n),invalid.length)).rejects.toThrow('H.264');
    await expect(inspectMp4(async()=>new Uint8Array(16),100)).rejects.toThrow();
    await expect(inspectMp4(async()=>new Uint8Array(),2_000_000_001)).rejects.toThrow('2GB');
    await expect(inspectMp4(async(o,n)=>bytes.subarray(o,o+n),bytes.length-2)).rejects.toThrow();
  });
});

