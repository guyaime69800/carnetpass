import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { extractPdfItems } from '../server/lib/platform-document-rag.js';
const file=process.argv[2];
const before=process.cpuUsage(),start=performance.now(),bytes=fs.readFileSync(file);
try{
 const result=await extractPdfItems(bytes,{id:'local-resource-measurement',title:'Mesure locale du PDF existant',sha256:'not-published',model_reference:'not-associated'});
 console.log(JSON.stringify({file,bytes:bytes.length,pages:result.pageCount,chunks:result.items.length,blankPages:result.blankPages,wallMs:Math.round(performance.now()-start),cpuMs:Math.round((process.cpuUsage(before).user+process.cpuUsage(before).system)/1000),peakRssMiB:Math.round(process.resourceUsage().maxRSS/1024),environment:'Node Windows, not a Cloudflare CPU or isolate measurement',externalApiCalls:0}));
}catch(e){console.log(JSON.stringify({file,error:e.name,message:String(e.message).slice(0,180),externalApiCalls:0}));process.exitCode=1;}
