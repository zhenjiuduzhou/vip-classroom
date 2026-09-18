// Read only box headers and the bounded moov metadata, never the complete video.
export type ReadBytes = (offset: number, length: number) => Promise<Uint8Array>;
export const MP4_MAX_READS = 128;
const word = (bytes: Uint8Array, offset: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
const fourcc = (bytes: Uint8Array, offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
function boxes(bytes: Uint8Array, start = 0, end = bytes.length) {
  const result: { type: string; start: number; end: number }[] = [];
  while (start < end) {
    if (start + 8 > end) throw new Error('MP4元数据不完整');
    let size = word(bytes, start); let header = 8;
    if (size === 1) {
      if (start + 16 > end) throw new Error('MP4元数据不完整');
      size = word(bytes,start+8)*4294967296 + word(bytes,start+12); header = 16;
    }
    if (size === 0) size = end - start;
    if (!Number.isSafeInteger(size) || size < header || start + size > end) throw new Error('MP4结构不正确');
    result.push({ type: fourcc(bytes,start+4), start: start+header, end:start+size });
    start += size;
  }
  return result;
}
export async function inspectMp4(read: ReadBytes, size: number): Promise<void> {
  const source = read;
  let reads = 0;
  read = async (offset, length) => {
    if (++reads > MP4_MAX_READS) throw new Error('MP4文件结构过于复杂，请重新导出');
    return source(offset, length);
  };
  if (!Number.isSafeInteger(size) || size < 24 || size > 2_000_000_000) throw new Error('MP4视频须小于或等于2GB');
  let offset = 0, moov: Uint8Array | null = null, ftyp = false, mdat = false, count = 0;
  while (offset < size) {
    if (++count > 10000) throw new Error('MP4文件结构过于复杂');
    const h = await read(offset, Math.min(16,size-offset));
    if (h.length < 8) throw new Error('MP4文件不完整');
    let length = word(h,0); let header = 8;
    if (length === 1) { if(h.length<16) throw new Error('MP4文件不完整'); length = word(h,8)*4294967296 + word(h,12); header=16; }
    if (length === 0) length=size-offset;
    if (!Number.isSafeInteger(length) || length<header || offset+length>size) throw new Error('MP4文件结构不正确');
    const type = fourcc(h,4);
    if (type==='ftyp') ftyp=true;
    if (type==='mdat') mdat=true;
    if (type==='moov') {
      if (length > 16*1024*1024 || moov) throw new Error('MP4元数据过大或重复，请重新导出');
      moov=await read(offset+header,length-header);
      if (moov.length !== length-header) throw new Error('MP4元数据不完整');
    }
    offset+=length;
  }
  if (!ftyp || !moov || !mdat) throw new Error('请上传标准MP4文件');
  let videos=0;
  for (const track of boxes(moov).filter(b=>b.type==='trak')) {
    const mdia=boxes(moov,track.start,track.end).find(b=>b.type==='mdia');
    if (!mdia) continue;
    const children=boxes(moov,mdia.start,mdia.end);
    const hdlr=children.find(b=>b.type==='hdlr');
    if (!hdlr || hdlr.end-hdlr.start<12) throw new Error('视频轨信息不完整');
    const handler=fourcc(moov,hdlr.start+8);
    if (handler!=='vide' && handler!=='soun') continue;
    const minf=children.find(b=>b.type==='minf');
    const stbl=minf && boxes(moov,minf.start,minf.end).find(b=>b.type==='stbl');
    const stsd=stbl && boxes(moov,stbl.start,stbl.end).find(b=>b.type==='stsd');
    if (!stsd || stsd.end-stsd.start<8) throw new Error('编码信息不完整');
    const entries=boxes(moov,stsd.start+8,stsd.end);
    if (!entries.length || entries.length!==word(moov,stsd.start+4)) throw new Error('编码信息不完整');
    for (const entry of entries) {
      if (handler==='vide' && !['avc1','avc3'].includes(entry.type)) throw new Error('视频编码须为H.264，请重新导出MP4');
      if (handler==='soun' && entry.type!=='mp4a') throw new Error('音频编码须为AAC，请重新导出MP4');
      if (handler==='vide') {
        const avcc=boxes(moov,entry.start+78,entry.end).find(b=>b.type==='avcC');
        if (!avcc || avcc.end-avcc.start<7 || moov[avcc.start]!==1) throw new Error('H.264配置无效');
      } else {
        // ISO AudioSampleEntry version 0 (standard AAC in MP4); reject unsupported legacy layouts.
        if (entry.end-entry.start<28 || moov[entry.start+8]!==0 || moov[entry.start+9]!==0) throw new Error('请使用标准AAC音轨');
        const esds=boxes(moov,entry.start+28,entry.end).find(b=>b.type==='esds');
        if (!esds || !aacDescriptor(moov.subarray(esds.start+4,esds.end))) throw new Error('音频编码须为AAC');
      }
    }
    if (handler==='vide') videos++;
  }
  if (videos!==1) throw new Error('请上传含一条H.264视频轨的MP4');
}
function aacDescriptor(bytes: Uint8Array): boolean {
  let p=0;
  while (p<bytes.length) {
    const tag=bytes[p++]; let length=0, n=0, b=0;
    do { if(p>=bytes.length || ++n>4)return false; b=bytes[p++]; length=(length<<7)|(b&127); } while(b&128);
    const end=p+length; if(end>bytes.length)return false;
    if (tag===3) {
      if(length<3)return false;
      const flags=bytes[p+2]; let skip=3;
      if(flags&128)skip+=2;
      if(flags&64){ if(p+skip>=end)return false; skip+=1+bytes[p+skip]; }
      if(flags&32)skip+=2;
      return skip<=length && aacDescriptor(bytes.subarray(p+skip,end));
    }
    if (tag===4) return length>=13 && bytes[p]===0x40 && aacDescriptor(bytes.subarray(p+13,end));
    if (tag===5) { const audioType=bytes[p]>>3; return length>=2 && [2,5,29].includes(audioType); }
    p=end;
  }
  return false;
}
