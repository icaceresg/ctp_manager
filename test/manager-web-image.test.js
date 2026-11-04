import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWebImage, WEB_IMAGE_SPECS } from '../client/src/webImageUpload.js';

// Header-only binary fixtures exercise the upload orchestrator and parser with
// an injected decoder/encoder. They do not prove browser decoding or quality.
function png(width, height, animated = false) {
  const bytes = new Uint8Array(animated ? 53 : 33), view = new DataView(bytes.buffer);
  bytes.set([137,80,78,71,13,10,26,10]); view.setUint32(8,13);
  bytes.set([73,72,68,82],12); view.setUint32(16,width); view.setUint32(20,height); bytes.set([8,6],24);
  if (animated) { view.setUint32(33,8); bytes.set([97,99,84,76],37); }
  return bytes;
}
function webp(width, height, { animated = false, padding = 0 } = {}) {
  const extra = padding ? 8 + padding + padding % 2 : 0;
  const bytes = new Uint8Array(30 + extra), view = new DataView(bytes.buffer);
  bytes.set([82,73,70,70]); view.setUint32(4,bytes.length-8,true); bytes.set([87,69,66,80,86,80,56,88],8);
  view.setUint32(16,10,true); bytes[20] = animated ? 2 : 0;
  for (let n=0;n<3;n++) { bytes[24+n]=((width-1) >> (n*8))&255; bytes[27+n]=((height-1) >> (n*8))&255; }
  if (padding) { bytes.set([74,85,78,75],30); view.setUint32(34,padding,true); }
  return bytes;
}
function webpChunk(source, name, data) {
  const bytes=new Uint8Array(source.length+8+data.length+data.length%2),view=new DataView(bytes.buffer);
  bytes.set(source);bytes.set([...name].map(c=>c.charCodeAt(0)),source.length);
  view.setUint32(source.length+4,data.length,true);bytes.set(data,source.length+8);
  view.setUint32(4,bytes.length-8,true);return bytes;
}
const file = (bytes=png(800,400), type='image/png') => new File([bytes], 'synthetic-upload', { type });
function avif(width,height){
 const box=(name,data)=>{const b=new Uint8Array(data.length+8);new DataView(b.buffer).setUint32(0,b.length);b.set([...name].map(x=>x.charCodeAt(0)),4);b.set(data,8);return b;};
 const extent=new Uint8Array(12);new DataView(extent.buffer).setUint32(4,width);new DataView(extent.buffer).setUint32(8,height);
 const iprp=box('iprp',box('ipco',box('ispe',extent))),meta=new Uint8Array(iprp.length+4);meta.set(iprp,4);
 return Buffer.concat([box('ftyp',new TextEncoder().encode('avif\0\0\0\0avif')),box('meta',meta)]);
}
function fixture(width, height, encode = (type, quality, canvas) => new Blob([type === 'image/png'
  ? png(canvas.width,canvas.height) : webp(canvas.width,canvas.height)], { type })) {
  const record={draw:[],encodes:[],closed:0,decoded:0};
  const bitmap={width,height,close(){record.closed++;}};
  const canvas={width:0,height:0,getContext(){return{
    drawImage(...args){record.draw.push(args);},
    getImageData(){const data=new Uint8ClampedArray(canvas.width*canvas.height*4);for(let i=3;i<data.length;i+=4)data[i]=255;data[3]=0;return{width:canvas.width,height:canvas.height,data};},
    fillRect(){assert.fail('a transparent image must not receive an opaque background');},
  };},toBlob(callback,type,quality){record.encodes.push({type,quality});callback(encode(type,quality,canvas));}};
  return {record,bitmap,canvas,dependencies:{decode:async()=>{record.decoded++;return bitmap;},makeCanvas:()=>canvas,encodeWebpFallback:async()=>{throw new Error('synthetic_fallback_unavailable');}}};
}

test('logo and map contain their source without upscaling, retaining aspect ratio and no background fill', async () => {
  const logo=fixture(1200,600);
  const result=await prepareWebImage(file(png(1200,600)),WEB_IMAGE_SPECS.logo,logo.dependencies);
  assert.deepEqual([result.width,result.height],[512,256]);
  assert.deepEqual(logo.record.draw[0].slice(1),[0,0,512,256]);
  assert.equal(logo.record.closed,1);assert.equal(result.contentType,'image/png');
  const map=fixture(400,200);
  const small=await prepareWebImage(file(png(400,200)),WEB_IMAGE_SPECS.map,map.dependencies);
  assert.deepEqual([small.width,small.height],[400,200]);assert.deepEqual(map.record.draw[0].slice(1),[0,0,400,200]);
  assert.equal(map.record.closed,1);
});

test('a cover crops centrally to the banner ratio and never magnifies a smaller original', async () => {
  const cover=fixture(3200,1000);
  const result=await prepareWebImage(file(png(3200,1000)),WEB_IMAGE_SPECS.cover,cover.dependencies);
  assert.deepEqual([result.width,result.height],[1600,600]);
  assert.deepEqual(cover.record.draw[0].slice(1),[-160,0,1920,600]);
  const small=fixture(800,800);
  const out=await prepareWebImage(file(png(800,800)),WEB_IMAGE_SPECS.cover,small.dependencies);
  assert.deepEqual([out.width,out.height],[800,300]); assert.deepEqual(small.record.draw[0].slice(1),[0,-250,800,800]);
  assert.equal(cover.record.closed,1);assert.equal(small.record.closed,1);
});

test('the native decoder is explicitly orientation-aware and returned bitmap dimensions drive the result', async () => {
  const image=fixture(200,400), original=globalThis.createImageBitmap;
  let observed;
  globalThis.createImageBitmap=async (source,options)=>{observed={source,options};return image.bitmap;};
  const source=file(png(400,200));
  try {
    const out=await prepareWebImage(source,WEB_IMAGE_SPECS.logo,{makeCanvas:image.dependencies.makeCanvas});
    assert.equal(observed.source,source);assert.deepEqual(observed.options,{imageOrientation:'from-image'});
    assert.deepEqual([out.width,out.height],[200,400]);assert.equal(image.record.closed,1);
  } finally { if(original===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=original; }
});

test('oversized, malformed, mismatched and animated inputs fail before decoding', async () => {
  const cases=[
    [{size:0,type:'image/png'},/12 MB/],
    [{size:12*1024*1024+1,type:'image/png'},/12 MB/],
    [file(png(4,4),'image/jpeg'),/foto PNG/],
    [file(png(4,4),'image/gif'),/foto PNG/],
    [file(new Uint8Array([1,2,3])) ,/foto PNG/],
    [file(png(12001,1)),/24 megapíxeles/],
    [file(png(6000,5000)),/24 megapíxeles/],
    [file(png(4,4,true)),/imagen estática/],
    [file(webp(4,4,{animated:true}),'image/webp'),/escudo debe ser/],
  ];
  for(const [source,message] of cases){
    const image=fixture(4,4);await assert.rejects(prepareWebImage(source,WEB_IMAGE_SPECS.logo,image.dependencies),message);
    assert.equal(image.record.decoded,0);assert.equal(image.record.encodes.length,0);assert.equal(image.record.closed,0);
  }
});

test('AVIF spatial extents are bounded before invoking the native decoder',async()=>{
 for(const bytes of [avif(12001,1),avif(6000,5000)]){
  const image=fixture(4,4);await assert.rejects(prepareWebImage(file(bytes,'image/avif'),WEB_IMAGE_SPECS.map,image.dependencies),/24 megapíxeles/);assert.equal(image.record.decoded,0);
 }
 const image=fixture(100,50);const result=await prepareWebImage(file(avif(100,50),'image/avif'),WEB_IMAGE_SPECS.map,image.dependencies);assert.equal(result.contentType,'image/webp');assert.equal(image.record.decoded,1);
});

test('the final encoded bytes and MIME agree, and base64 is the exact blob rather than the source', async () => {
  const image=fixture(400,200);
  const out=await prepareWebImage(file(png(400,200)),WEB_IMAGE_SPECS.map,image.dependencies);
  assert.equal(out.contentType,out.blob.type);assert.equal(out.size,out.blob.size);
  assert.deepEqual(Buffer.from(out.base64,'base64'),Buffer.from(await out.blob.arrayBuffer()));
  assert.notEqual(out.base64,Buffer.from(png(400,200)).toString('base64'));
  assert.deepEqual(image.record.encodes,[{type:'image/webp',quality:.86}]);
});

test('a browser without WebP encoding fails closed for photos instead of uploading PNG bytes', async () => {
  const image=fixture(400,200,(_type,_quality,canvas)=>new Blob([png(canvas.width,canvas.height)],{type:'image/png'}));
  await assert.rejects(prepareWebImage(file(png(400,200)),WEB_IMAGE_SPECS.map,image.dependencies),/generar WebP/);
  assert.deepEqual(image.record.encodes.map(x=>x.type),['image/webp']);
  assert.equal(image.record.closed,1);
});

test('a browser that falls back to PNG uses the bounded local WebP encoder, never the source MIME',async()=>{
 const image=fixture(100,50,(_type,_quality,canvas)=>new Blob([png(canvas.width,canvas.height)],{type:'image/png'}));
 let calls=0;image.dependencies.encodeWebpFallback=async(canvas,quality)=>{calls++;assert.equal(quality,.86);return new Blob([webp(canvas.width,canvas.height)],{type:'image/webp'});};
 const result=await prepareWebImage(file(png(100,50)),WEB_IMAGE_SPECS.map,image.dependencies);
 assert.equal(result.contentType,'image/webp');assert.equal(calls,1);assert.equal(image.record.closed,1);
});

test('logos require PNG source and real visible pixels with a clear outside border',async()=>{
 for(const policy of ['opaque','empty','inside']){
  const image=fixture(4,4);image.canvas.getContext=()=>({drawImage(){},getImageData(){const data=new Uint8ClampedArray(64);for(let i=3;i<data.length;i+=4)data[i]=policy==='empty'?0:255;if(policy==='inside')data[(1*4+1)*4+3]=0;return{width:4,height:4,data};}});
  await assert.rejects(prepareWebImage(file(png(4,4)),WEB_IMAGE_SPECS.logo,image.dependencies),/transparente hasta el borde/);assert.equal(image.record.encodes.length,0);assert.equal(image.record.closed,1);
 }
 const image=fixture(4,4);await assert.rejects(prepareWebImage(file(webp(4,4),'image/webp'),WEB_IMAGE_SPECS.logo,image.dependencies),/archivo PNG/);assert.equal(image.record.decoded,0);
});

test('wrong output dimensions or MIME, animation and absent encoders never produce an upload payload', async () => {
  const encoders=[
    (_type,_q,canvas)=>new Blob([webp(canvas.width+1,canvas.height)],{type:'image/webp'}),
    (_type,_q,canvas)=>new Blob([png(canvas.width,canvas.height)],{type:'image/webp'}),
    (_type,_q,canvas)=>new Blob([webp(canvas.width,canvas.height,{animated:true})],{type:'image/webp'}),
    ()=>null,
  ];
  for(const encode of encoders){const image=fixture(400,200,encode);
    await assert.rejects(prepareWebImage(file(png(400,200)),WEB_IMAGE_SPECS.map,image.dependencies),/generar WebP/);
    assert.equal(image.record.closed,1);
  }
});

test('quality retries are bounded and output larger than 2 MB stays rejected', async () => {
  const large=(_type,_quality,canvas)=>new Blob([webp(canvas.width,canvas.height,{padding:2*1024*1024})],{type:'image/webp'});
  const image=fixture(400,200,large);
  await assert.rejects(prepareWebImage(file(png(400,200)),WEB_IMAGE_SPECS.map,image.dependencies),/2 MB/);
  assert.deepEqual(image.record.encodes.map(x=>x.quality),[.86,.74,.64]);assert.equal(image.record.closed,1);
  const retry=fixture(400,200,(type,quality,canvas)=>quality===.86?large(type,quality,canvas):new Blob([webp(canvas.width,canvas.height)],{type}));
  const out=await prepareWebImage(file(png(400,200)),WEB_IMAGE_SPECS.map,retry.dependencies);
  assert.ok(out.size<=2*1024*1024);assert.equal(retry.record.encodes.length,2);assert.equal(retry.record.closed,1);
});

test('bitmap resources close on invalid decoded dimensions, missing context and encoding failures', async () => {
  for(const [width,height] of [[0,10],[12001,1],[6000,5000]]){
    const image=fixture(width,height);
    await assert.rejects(prepareWebImage(file(),WEB_IMAGE_SPECS.map,image.dependencies));assert.equal(image.record.closed,1);
  }
  const missing=fixture(400,200);missing.canvas.getContext=()=>null;
  await assert.rejects(prepareWebImage(file(),WEB_IMAGE_SPECS.logo,missing.dependencies),/preparar/);assert.equal(missing.record.closed,1);
  const throwing=fixture(400,200,()=>{throw new Error('synthetic_encoding_failure');});
  await assert.rejects(prepareWebImage(file(),WEB_IMAGE_SPECS.logo,throwing.dependencies),/synthetic_encoding_failure/);assert.equal(throwing.record.closed,1);
  const badDecode=fixture(400,200);badDecode.dependencies.decode=async()=>{throw new Error('synthetic_decode_failure');};
  await assert.rejects(prepareWebImage(file(),WEB_IMAGE_SPECS.logo,badDecode.dependencies),/foto PNG/);assert.equal(badDecode.record.closed,0);
});

test('an already fitting static WebP bypasses the canvas, strips private metadata and still closes the bitmap', async () => {
  let bytes=webp(400,200);
  bytes=webpChunk(bytes,'XMP ',new TextEncoder().encode('synthetic_private_camera_note'));
  const image=fixture(400,200);image.dependencies.makeCanvas=()=>assert.fail('an optimized fitting WebP must not be recompressed');
  const out=await prepareWebImage(file(bytes,'image/webp'),WEB_IMAGE_SPECS.map,image.dependencies);
  assert.equal(out.contentType,'image/webp');assert.ok(out.size<bytes.length);
  assert.doesNotMatch(Buffer.from(out.base64,'base64').toString('utf8'),/synthetic_private_camera_note|XMP /);
  assert.deepEqual(Buffer.from(out.base64,'base64'),Buffer.from(webp(400,200)));
  assert.equal(image.record.encodes.length,0);assert.equal(image.record.draw.length,0);assert.equal(image.record.closed,1);
});

test('WebP needing a cover crop follows the encoder instead of the fitting-image shortcut', async () => {
  const image=fixture(800,800);
  const out=await prepareWebImage(file(webp(800,800),'image/webp'),WEB_IMAGE_SPECS.cover,image.dependencies);
  assert.deepEqual([out.width,out.height],[800,300]);assert.equal(image.record.encodes.length,1);assert.equal(image.record.closed,1);
});
