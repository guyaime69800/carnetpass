import { extractPdfItems } from '../server/lib/platform-document-rag.js';
export default { async fetch(request) {
 if (new URL(request.url).hostname !== '127.0.0.1' || request.method !== 'POST') return new Response(null,{status:404});
 const bytes=new Uint8Array(await request.arrayBuffer());
 if(bytes.length>30*1024*1024)return new Response(null,{status:413});
 try {const r=await extractPdfItems(bytes,{id:'local-benchmark',title:'Local resource test',sha256:'not-published',model_reference:'not-associated'});return Response.json({pages:r.pageCount,chunks:r.items.length,blankPages:r.blankPages,externalApiCalls:0});}
 catch(e){return Response.json({error:e.name,message:String(e.message).slice(0,180),externalApiCalls:0},{status:500});}
} };
