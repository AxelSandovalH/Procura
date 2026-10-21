const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const FPS=30;fs.mkdirSync('frames',{recursive:true});
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1920,height:1080}});
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file://'+process.cwd()+'/video.html');
const total=await p.evaluate(()=>TOTAL);const n=Math.round(total*FPS);
const a=+process.argv[2]||0,z=+process.argv[3]||n;
for(let i=a;i<z;i++){await p.evaluate(t=>seek(t),i/FPS);await p.screenshot({path:`frames/f${String(i).padStart(5,'0')}.png`,omitBackground:true})}
await b.close();console.log('done',a,z)})();
