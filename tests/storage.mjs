import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage(); await page.goto('http://127.0.0.1:5173/matchday-xi/');
 const result=await page.evaluate(async()=>{
  const {readPhoto}=await import('/matchday-xi/src/lib/images.ts');
  const {store}=await import(performance.getEntriesByType('resource').find(e => new URL(e.name).pathname.endsWith('/src/lib/store.ts')).name); await store.ready;
  const canvas=document.createElement('canvas');canvas.width=3000;canvas.height=3200;
  canvas.getContext('2d').fillRect(0,0,3000,3200);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  const photo=await readPhoto(blob,500);const image=new Image();image.src=photo.data;await image.decode();
  store.update(s=>{s.players[0].photo2=photo.data;s.players[0].fitS={z:1.4,x:3,y:4};});
  return [image.naturalWidth,image.naturalHeight,photo.res];
 });
 assert.deepEqual(result,[3000,3200,[3000,3200]]);
 await page.waitForTimeout(700);await page.reload();
 const saved=await page.evaluate(async()=>{const {store}=await import(performance.getEntriesByType('resource').find(e => new URL(e.name).pathname.endsWith('/src/lib/store.ts')).name);await store.ready;const image=new Image();image.src=store.state.players[0].photo2;await image.decode();return [image.naturalWidth,store.state.players[0].fitS.z];});
 assert.deepEqual(saved,[3000,1.4]);console.log('Original portrait dimensions and independent crop survive IndexedDB reload');
} finally {await browser.close();}
