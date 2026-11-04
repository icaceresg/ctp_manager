import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { requireTransparentLogoPng, pngCrc32 } from '../shared/transparent-logo.js';

const signature = new Uint8Array([137,80,78,71,13,10,26,10]);
function chunk(name, data) {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length); out.set([...name].map(x => x.charCodeAt(0)), 4); out.set(data, 8);
  view.setUint32(out.length - 4, pngCrc32(out.subarray(4, out.length - 4))); return out;
}
function fixture({ width = 4, height = 4, clear = 'border', filter = 0, animated = false, extraRows = 0 } = {}) {
  const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0,width); view.setUint32(4,height); header.set([8,6,0,0,0],8);
  const stride = width * 4, raw = new Uint8Array((stride + 1) * (height + extraRows)); let prior = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(stride); for(let x=0;x<width;x++)row.set([210,150,20,clear==='all' ? 0 : clear==='border'&&x===0&&y===0 || clear==='inside'&&x===1&&y===1 ? 0 : 255],x*4);
    raw[y * (stride + 1)] = filter;
    for(let x=0;x<stride;x++) {
      const a=x>=4?row[x-4]:0,b=prior[x],c=x>=4?prior[x-4]:0,p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);
      const prediction=filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?(da<=db&&da<=dc?a:db<=dc?b:c):0;
      raw[y*(stride+1)+1+x]=(row[x]-prediction+256)%256;
    }
    prior=row;
  }
  return Buffer.concat([signature,chunk('IHDR',header),...(animated?[chunk('acTL',new Uint8Array(8))]:[]),chunk('IDAT',deflateSync(raw)),chunk('IEND',new Uint8Array())]);
}
test('real PNG inflation and all five filters recover transparency and visible pixels',async()=>{
  for(let filter=0;filter<=4;filter++)assert.deepEqual(await requireTransparentLogoPng(fixture({filter})),{width:4,height:4,mime:'image/png',hasVisiblePixels:true,hasTransparentBorder:true});
});
test('opaque, empty and interior-only transparency cannot pass the logo policy',async()=>{
  for(const clear of ['none','all','inside'])await assert.rejects(requireTransparentLogoPng(fixture({clear})),{code:'transparency'});
});
test('bad CRC, trailing bytes, animation, missing data and oversized dimensions fail',async()=>{
  const broken=fixture();broken[29]^=1;
  for(const raw of [broken,Buffer.concat([fixture(),Buffer.from([0])]),fixture({animated:true}),fixture({width:513}),signature])await assert.rejects(requireTransparentLogoPng(raw),{code:'format'});
});
test('inflation budget and exact decoded dimensions cannot be bypassed',async()=>{
  await assert.rejects(requireTransparentLogoPng(fixture({extraRows:2})),{code:'format'});
  let seen;
  await requireTransparentLogoPng(fixture(),{inflate:async(bytes,limit)=>{seen=limit;return new Uint8Array(inflateSync(bytes,{maxOutputLength:limit}));}});
  assert.equal(seen,(4*4+1)*4);
  await assert.rejects(requireTransparentLogoPng(fixture(),{inflate:async()=>new Uint8Array(1)}),{code:'format'});
});
