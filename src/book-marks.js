export function momentPassage(text,offset){
 let start=Math.max(0,Math.min(text.length,offset));
 while(start>0&&/\S/.test(text[start]||'')&&/\S/.test(text[start-1]))start--;
 if(start===text.length){start=Math.max(0,start-180);while(start>0&&/\S/.test(text[start-1]))start--}
 while(start<text.length&&/\s/.test(text[start]))start++;
 let end=Math.min(text.length,start+240);
 const stop=text.slice(start,end).match(/[.!?](?:["'”’)]*)(?=\s|$)/);
 if(stop&&stop.index>25)end=start+stop.index+stop[0].length;
 else if(end<text.length)while(end<text.length&&/\S/.test(text[end]))end++;
 while(end>start&&/\s/.test(text[end-1]))end--;
 return {start,end,text:text.slice(start,end)};
}

export function selectedPassage(reader,selection){
 if(!selection?.rangeCount||selection.isCollapsed)return null;
 const range=selection.getRangeAt(0);
 if(!reader.contains(range.startContainer)||!reader.contains(range.endContainer))return null;
 const before=range.cloneRange();before.selectNodeContents(reader);before.setEnd(range.startContainer,range.startOffset);
 const start=before.toString().length,text=range.toString();
 return text.trim()?{start,end:start+text.length,text}:null;
}

export function markedSegments(text,marks,start,end){
 const highlights=marks.filter(mark=>mark.kind==='highlight');
 const points=new Set([0,text.length,Math.max(0,Math.min(text.length,start)),Math.max(0,Math.min(text.length,end))]);
 for(const mark of highlights){points.add(Math.max(0,Math.min(text.length,mark.start)));points.add(Math.max(0,Math.min(text.length,mark.end)))}
 const offsets=[...points].sort((a,b)=>a-b),segments=[];
 for(let i=0;i<offsets.length-1;i++){const from=offsets[i],to=offsets[i+1];if(from===to)continue;segments.push({text:text.slice(from,to),start:from,current:from>=start&&from<end,highlighted:highlights.some(mark=>from>=mark.start&&from<mark.end),highlightIds:highlights.filter(mark=>from>=mark.start&&from<mark.end).map(mark=>mark.id)})}
 return segments;
}
