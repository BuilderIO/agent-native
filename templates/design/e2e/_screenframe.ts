import { chromium } from "@playwright/test";
const BASE="http://127.0.0.1:9401";
const BLANK=`<!doctype html><html><head><meta charset="utf-8"><title>Home</title></head><body style="margin:0;min-height:900px;background:#0f1115"></body></html>`;
const b=await chromium.launch({channel:"chrome",headless:true});
const p=await (await b.newContext({viewport:{width:1440,height:900},storageState:"/tmp/design-loop/.auth/state.json"})).newPage();
const act=async(n:string,i:any)=>(await p.request.post(`${BASE}/_agent-native/actions/${n}`,{data:i,headers:{"Content-Type":"application/json"}})).json();
async function fresh(){const cr=await act("create-design",{title:"sf",projectType:"prototype"});const id=cr.id??cr.data?.id;
 await act("create-file",{designId:id,filename:"index.html",content:BLANK,fileType:"html"});
 await p.goto(`${BASE}/design/${id}`,{waitUntil:"domcontentloaded"});
 await p.locator('[data-design-bottom-toolbar] button[aria-label="Move"]').waitFor({timeout:45000});
 await p.waitForTimeout(4000); return id;}
const files=async(id:string)=>{const d=await p.request.get(`${BASE}/_agent-native/actions/get-design?id=${id}`).then(r=>r.json());
 return (d.files??[]).map((f:any)=>f.filename);};
const board=async(id:string)=>{const d=await p.request.get(`${BASE}/_agent-native/actions/get-design?id=${id}`).then(r=>r.json());
 return (d.files??[]).find((f:any)=>f.filename==="__board__.html")?.content??"";};
const emptyPt=async()=>await p.evaluate(()=>{const w=document.querySelector("[data-multi-screen-canvas-world]");const s=(w?.parentElement??w) as HTMLElement;
 const r=s.getBoundingClientRect();const cards=[...document.querySelectorAll("[data-screen-iframe-id]")].map(e=>e.getBoundingClientRect());
 for(let y=r.top+60;y<r.bottom-60;y+=40)for(let x=r.left+60;x<r.right-60;x+=40){
  if(cards.some(c=>x>=c.left-24&&x<=c.right+24&&y>=c.top-24&&y<=c.bottom+24))continue;
  const h=document.elementFromPoint(x,y); if(h&&s.contains(h))return{x,y};} return null;})!;
async function drawFrame(option:string){
  await p.locator('[data-design-bottom-toolbar] button[aria-label="Frame options"]').click().catch(async()=>{
    await p.locator('[data-design-bottom-toolbar] button').filter({hasText:""}).nth(1).click().catch(()=>{});});
  await p.waitForTimeout(500);
  const item=p.getByRole("menuitem",{name:new RegExp(option,"i")}).first();
  if(await item.count()) { await item.click(); } else { console.log("SF  (no menu item "+option+")"); await p.keyboard.press("Escape");
    await p.locator('[data-design-bottom-toolbar] button[aria-label="Frame"]').click(); }
  await p.waitForTimeout(500);
  const e=await emptyPt();
  await p.mouse.move(e!.x,e!.y); await p.mouse.down();
  await p.mouse.move(e!.x+220,e!.y+200,{steps:14}); await p.mouse.up(); await p.waitForTimeout(3000);
}
let id=await fresh(); let before=(await files(id)).length;
await drawFrame("Screen");
console.log("SF screen-mode → files +", (await files(id)).length-before, "| board frame:", /data-an-primitive="frame"/.test(await board(id)));
id=await fresh(); before=(await files(id)).length;
await drawFrame("Frame");
console.log("SF frame-mode  → files +", (await files(id)).length-before, "| board frame:", /data-an-primitive="frame"/.test(await board(id)));
await b.close();
