const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
const key=value=>clean(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const titleKey=value=>key(value).replace(/^(?:chapter|section|part)\s+/,'').replace(/^(?:\d+|[ivxlcdm]+)\s+/,'');
const chapterLabel=/^(?:chapter|part|book|section)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i;
const contentsHeading=value=>/^(?:table\s+of\s+)?contents(?:\s+[ivxlcdm\d]+)?$/i.test(clean(value));
const median=values=>{const ordered=values.filter(Number.isFinite).sort((a,b)=>a-b);return ordered[Math.floor(ordered.length/2)]||12};
const optional=async(fn,fallback)=>{try{return await fn()??fallback}catch{return fallback}};

// PDF.js text items can divide a word into multiple font runs. Preserve the
// publisher's order, joining adjacent runs without introducing mid-word spaces.
export function pdfTextPage(items,view=[0,0,612,792]){
 const lines=[];let row=null;
 const finish=()=>{if(row){row.text=clean(row.text);if(row.text)lines.push(row)}row=null};
 for(const item of items){
  if(typeof item.str!=='string')continue;
  const x=item.transform?.[4]||0,y=item.transform?.[5]||0;
  const size=Math.hypot(item.transform?.[2]||0,item.transform?.[3]||0)||item.height||12;
  if(row&&Math.abs(y-row.y)>Math.max(3,Math.min(size,row.size)*.45))finish();
  if(!row)row={text:'',x,y,size,right:x};
  const gap=x-row.right;
  if(row.text&&!/\s$/.test(row.text)&&!/^\s/.test(item.str)&&gap>Math.max(1,size*.12))row.text+=' ';
  row.text+=item.str;row.right=x+(item.width||0);row.size=Math.max(row.size,size);
  if(item.hasEOL)finish();
 }
 finish();let text='';
 for(const line of lines){if(text)text+='\n';line.start=text.length;text+=line.text;line.end=text.length}
 const sizes=lines.filter(line=>line.text.length>35).map(line=>line.size);
 return {text,lines,view,bodySize:median(sizes.length?sizes:lines.map(line=>line.size))};
}

function printedNumber(value){
 if(/^\d+$/.test(value))return Number(value);
 if(!/^[ivxlcdm]+$/i.test(value))return null;
 const numbers={i:1,v:5,x:10,l:50,c:100,d:500,m:1000};let total=0;
 for(let i=0;i<value.length;i++){const n=numbers[value[i].toLowerCase()],next=numbers[value[i+1]?.toLowerCase()]||0;total+=n<next?-n:n}
 return total;
}
function tocRow(text){
 const match=clean(text).match(/^(.+?)(?:\s*[.·…_]{2,}\s*|\s+)(\d{1,5}|[ivxlcdm]{1,8})$/i);
 if(!match||match[1].length<2||/^(?:chapter|part|book|section)$/i.test(match[1]))return null;
 return {title:match[1].replace(/[.·…_\s]+$/,'').trim(),label:match[2],number:printedNumber(match[2]),roman:!/\d/.test(match[2])};
}
function contentsPages(pages){
 const found=new Set();
 for(let index=0;index<Math.min(pages.length,60);index++){
  if(!pages[index].lines.some(line=>contentsHeading(line.text)))continue;
  found.add(index);
  for(let next=index+1;next<Math.min(pages.length,index+12);next++){
   const lines=pages[next].lines,rows=lines.filter(line=>tocRow(line.text));
   if(rows.length<2||rows.length<lines.length*.35)break;
   found.add(next);
  }
 }
 return found;
}
function recurringHeaders(pages){
 const counts=new Map();
 for(const page of pages){const seen=new Set();for(const line of [...page.lines.slice(0,2),...page.lines.slice(-2)]){const value=key(line.text);if(value&&value.length<100&&!seen.has(value)){counts.set(value,(counts.get(value)||0)+1);seen.add(value)}}}
 return new Set([...counts].filter(([,count])=>count>=3&&count>=pages.length*.35).map(([value])=>value));
}

function headingMatch(page,title,{top=null,ignore=new Set()}={}){
 const full=key(title),short=titleKey(title);let best=null;
 for(let index=0;index<page.lines.length;index++){
  const line=page.lines[index];if(line.text.length>180||ignore.has(key(line.text))||tocRow(line.text))continue;
  for(let count=1;count<=3&&index+count<=page.lines.length;count++){
   const text=page.lines.slice(index,index+count).map(item=>item.text).join(' ');
   if(text.length>220)break;
   const match=key(text),shortMatch=titleKey(text);
   const score=match===full?5:short.length>=4&&shortMatch===short?4:0;
   if(!score)continue;
   const distance=top===null?index:Math.abs(line.y-top)/20;
   if(!best||score-distance*.01>best.rank)best={index,line,rank:score-distance*.01};
  }
 }
 if(!best)return null;
 // Some bookmarks label only the subtitle, while the printed number sits on
 // the preceding line. Start at that number so the announcement includes both.
 if(best.index>0&&chapterLabel.test(page.lines[best.index-1].text))return page.lines[best.index-1];
 return best.line;
}

async function resolveDestination(doc,destination,pages,refCache){
 try{
  const dest=typeof destination==='string'?await doc.getDestination(destination):destination;
  if(!Array.isArray(dest)||dest.length<2)return null;
  let index;
  if(Number.isInteger(dest[0]))index=dest[0];
  else if(dest[0]&&typeof dest[0]==='object'){
   const id=JSON.stringify(dest[0]);if(!refCache.has(id))refCache.set(id,doc.getPageIndex(dest[0]));index=await refCache.get(id);
  }
  if(!Number.isInteger(index)||index<0||index>=pages.length)return null;
  const kind=dest[1]?.name;
  const top=kind==='XYZ'?dest[3]:kind==='FitH'||kind==='FitBH'?dest[2]:kind==='FitR'?dest[5]:null;
  return {pageIndex:index,top:Number.isFinite(top)?top:null};
 }catch{return null}
}
function destinationOffset(page,title,top,ignore){
 const heading=headingMatch(page,title,{top,ignore});
 if(heading)return heading.start;
 if(top!==null){const line=page.lines.find(line=>line.y<=top+Math.max(4,line.size*.3));if(line)return line.start}
 return 0;
}
async function outlineEntries(doc,pages,bases,ignore,refCache){
 const entries=[];
 async function visit(items,depth){for(const item of items||[]){
  const title=clean(item.title),location=await resolveDestination(doc,item.dest,pages,refCache);
  if(location&&title){const offset=destinationOffset(pages[location.pageIndex],title,location.top,ignore);entries.push({title,depth,pageIndex:location.pageIndex,offset:bases[location.pageIndex]+offset})}
  await visit(item.items,depth+1);
 }}
 await visit(await optional(()=>doc.getOutline(),[]),0);return entries;
}

async function linkedContents(doc,pages,bases,tocPages,ignore,refCache){
 const entries=[];
 for(const index of tocPages){
  const page=await doc.getPage(index+1);
  for(const annotation of await optional(()=>page.getAnnotations(),[])){
   if(annotation.subtype!=='Link'||!annotation.dest||!Array.isArray(annotation.rect))continue;
   const [left,bottom,right,top]=annotation.rect;
   const row=pages[index].lines.find(line=>line.y>=bottom-line.size*.4&&line.y<=top+line.size*.4&&line.right>=left&&line.x<=right);
   if(!row||contentsHeading(row.text))continue;
   const title=tocRow(row.text)?.title||row.text;
   const location=await resolveDestination(doc,annotation.dest,pages,refCache);
   if(!location||tocPages.has(location.pageIndex))continue;
   entries.push({title,depth:0,pageIndex:location.pageIndex,offset:bases[location.pageIndex]+destinationOffset(pages[location.pageIndex],title,location.top,ignore)});
  }
 }
 return entries;
}

function parsePrintedContents(pages,tocPages){
 const rows=[];
 for(const pageIndex of tocPages){
  let pending='';const page=pages[pageIndex];
  for(const line of page.lines){
   if(contentsHeading(line.text)){pending='';continue}
   let row=tocRow(line.text);
   if(!row&&/^\d{1,5}$/.test(line.text)&&pending)row={title:pending,label:line.text,number:Number(line.text),roman:false};
   if(row){
    if(pending&&!chapterLabel.test(row.title)&&!/^\d+[.)]\s/.test(row.title)&&!/^part\s+/i.test(pending))row.title=pending+': '+row.title;
    rows.push({...row,tocPage:pageIndex,x:line.x,depth:0});pending='';
   }else pending=line.text.length<150&&!/[.!?]$/.test(line.text)?line.text:'';
  }
 }
 return rows;
}
function pageLabelMap(pages,labels){
 const map=new Map();
 const add=(label,index)=>{const value=String(label);if(!map.has(value))map.set(value,index);else if(map.get(value)!==index)map.set(value,null)};
 // Explicit document labels are useful but are validated against observed
 // headings below rather than assumed to equal the PDF's physical page order.
 labels?.forEach((label,index)=>add(label,index));
 const printed=new Map();
 for(let index=0;index<pages.length;index++){
  const page=pages[index];
  for(const line of [...page.lines.slice(0,1),...page.lines.slice(-2)]){
   const bottom=page.view[1],top=page.view[3],nearEdge=line.y<bottom+(top-bottom)*.15||line.y>top-(top-bottom)*.08;
   if(nearEdge&&/^(?:\d{1,5}|[ivxlcdm]{1,8})$/i.test(line.text)){
    if(!printed.has(line.text))printed.set(line.text,index);else printed.set(line.text,null);
   }
  }
 }
 for(const [label,index] of printed)if(index!==null)map.set(label,index);
 return map;
}
function printedContents(pages,bases,tocPages,labels,ignore){
 const rows=parsePrintedContents(pages,tocPages),entries=[],matched=new Map();
 const after=Math.min(...tocPages)+1;
 let last=-1;
 for(const row of rows){
  for(let index=after;index<pages.length;index++){
   if(tocPages.has(index))continue;
   const line=headingMatch(pages[index],row.title,{ignore});
   const offset=line&&bases[index]+line.start;
   if(line&&offset>last){matched.set(row,{pageIndex:index,offset});last=offset;break}
  }
 }
 const offsets={arabic:[],roman:[]};
 for(const [row,location] of matched)offsets[row.roman?'roman':'arabic'].push(location.pageIndex+1-row.number);
 const commonOffset=values=>{const counts=new Map();for(const value of values)counts.set(value,(counts.get(value)||0)+1);return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]};
 const labelMap=pageLabelMap(pages,labels);
 for(const row of rows){
  let location=matched.get(row);
  if(!location){
   const correction=commonOffset(offsets[row.roman?'roman':'arabic']);
   const index=correction===undefined?labelMap.get(row.label):row.number+correction-1;
   if(!Number.isInteger(index)||index<0||index>=pages.length||tocPages.has(index))continue;
   location={pageIndex:index,offset:bases[index]+destinationOffset(pages[index],row.title,null,ignore)};
  }
  entries.push({...location,title:row.title,depth:row.depth});
 }
 return entries;
}

function detectedHeadings(pages,bases,tocPages,ignore){
 const explicit=[],formatted=[];
 for(let index=0;index<pages.length;index++){
  if(tocPages.has(index))continue;
  const page=pages[index];
  for(let i=0;i<page.lines.length;i++){
   const line=page.lines[i];if(ignore.has(key(line.text))||line.text.length>150||tocRow(line.text))continue;
   const chapter=chapterLabel.test(line.text),large=line.size>=page.bodySize*1.3&&line.text.length<120;
   if(!chapter&&!large)continue;
   let title=line.text;
   const next=page.lines[i+1];
   if(chapter&&next&&next.text.length<120&&!/[.!?]$/.test(next.text)&&!chapterLabel.test(next.text)&&(next.size>page.bodySize*1.1||line.text.split(/\s+/).length<=3))title+=': '+next.text;
   (chapter?explicit:formatted).push({title,depth:0,pageIndex:index,offset:bases[index]+line.start});
  }
 }
 return explicit.length?explicit:formatted.length>=2?formatted:[];
}

function makeSections(text,pages,bases,entries){
 const seen=new Set();const contents=entries.filter(entry=>{
  const id=entry.offset+':'+entry.title;
  if(!entry.title||entry.offset<0||entry.offset>=text.length||seen.has(id))return false;
  seen.add(id);return true;
 }).sort((a,b)=>a.offset-b.offset||a.depth-b.depth);
 const boundaries=[...new Set(contents.map(entry=>entry.offset))];
 if(!boundaries.length||boundaries[0]>0)boundaries.unshift(0);
 const parts=[],result=[];
 for(let i=0;i<boundaries.length;i++){
  const start=boundaries[i],end=boundaries[i+1]??text.length,raw=text.slice(start,end),leading=raw.length-raw.trimStart().length;
  const sectionText=raw.trim();if(!sectionText)continue;
  const labels=contents.filter(entry=>entry.offset===start);
  const title=labels.at(-1)?.title||(contents.length?'Front matter':'Document');
  const headings=[];
  for(let pageIndex=0;pageIndex<pages.length;pageIndex++){
   if(bases[pageIndex]>end||bases[pageIndex]+pages[pageIndex].text.length<start)continue;
   for(const line of pages[pageIndex].lines){
    const offset=bases[pageIndex]+line.start-start-leading;
    if(offset<0||offset>Math.min(250,sectionText.length))continue;
    if(chapterLabel.test(line.text)||line.size>pages[pageIndex].bodySize*1.1||labels.some(label=>key(label.title)===key(line.text)))headings.push({title:line.text,start:offset,end:offset+line.text.length});
   }
  }
  const sectionIndex=parts.length;parts.push({title,text:sectionText,headings});
  if(labels.length)for(const label of labels)result.push({title:label.title,depth:label.depth,sectionIndex,charIndex:0});
  else result.push({title,depth:0,sectionIndex,charIndex:0});
 }
 return {parts,contents:result};
}

export async function importPdf(file,{pdfjs=globalThis.window?.pdfjsLib,onProgress=()=>{}}={}){
 if(!pdfjs)throw Error('PDF parser unavailable. Connect to the internet and reload.');
 pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
 const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())});
 let doc;
 try{
  doc=await task.promise;const pages=[],bases=[];let text='';
  for(let number=1;number<=doc.numPages;number++){
   const page=await doc.getPage(number),content=await page.getTextContent();
   const extracted=pdfTextPage(content.items,page.view);bases.push(text.length);pages.push(extracted);
   text+=extracted.text+'\n\n';page.cleanup?.();
   if(number%10===0||number===doc.numPages)onProgress(`Reading PDF: ${number}/${doc.numPages} pages…`);
  }
  if(!text.trim())throw Error('No selectable text found. This PDF may be scanned images; OCR is not available yet.');
  onProgress('Finding PDF chapters and table of contents…');
  const ignore=recurringHeaders(pages),refCache=new Map(),tocPages=contentsPages(pages);
  let entries=await outlineEntries(doc,pages,bases,ignore,refCache),contentsSource='PDF bookmarks';
  if(!entries.length){entries=await linkedContents(doc,pages,bases,tocPages,ignore,refCache);contentsSource='Linked PDF table of contents'}
  if(!entries.length){entries=printedContents(pages,bases,tocPages,await optional(()=>doc.getPageLabels(),null),ignore);contentsSource='Printed PDF table of contents'}
  if(!entries.length){entries=detectedHeadings(pages,bases,tocPages,ignore);contentsSource='Detected PDF headings'}
  const navigationNotice=entries.length?'':'No reliable PDF chapter boundaries found. The document is kept together instead of treating each page as a chapter.';
  if(!entries.length)contentsSource='PDF document — chapter boundaries unavailable';
  const sections=makeSections(text,pages,bases,entries);
  return {name:file.name,...sections,contentsSource,navigationNotice};
 }finally{await optional(()=>doc?doc.destroy():task.destroy(),null)}
}
