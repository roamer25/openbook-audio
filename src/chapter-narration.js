const key=value=>String(value||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const chapter=/^chapter\s+(\d+|[ivxlcdm]+|[a-z]+(?:[ -][a-z]+)?)(?=$|[\s:—–.\-])/i;
const frontMatter=/^(?:part\b|book\s+[ivxlcdm\d]+\b|preface\b|introduction\b|foreword\b|prologue\b|epilogue\b|afterword\b|acknowledg|contents\b|table of contents\b|notes\b|endnotes\b|footnotes\b|bibliography\b|index\b|copyright\b|title page\b|dedication\b|appendix\b)/i;
function spokenNumber(value){
 if(!/^[ivxlcdm]+$/i.test(value))return value;
 const numbers={i:1,v:5,x:10,l:50,c:100,d:500,m:1000};let result=0;
 for(let i=0;i<value.length;i++){const n=numbers[value[i].toLowerCase()],next=numbers[value[i+1]?.toLowerCase()]||0;result+=n<next?-n:n}
 return String(result);
}
function numberTitle(title){return title.replace(chapter,(_,number)=>'Chapter '+spokenNumber(number)).replace(/^(\d+)[.)]\s+/, 'Chapter $1. ')}

// Keep announcements separate from stored text so old saved places remain valid.
export function chapterPassage(part,section,start,contents,chunker,limit=600){
 const text=part.text;
 const entries=contents.filter(entry=>entry.sectionIndex===section).sort((a,b)=>a.charIndex-b.charIndex);
 const next=entries.find(entry=>entry.charIndex>start)?.charIndex??text.length;
 const entry=entries.filter(entry=>entry.charIndex===start).at(-1);
 let bodyStart=start,prefix='';
 if(entry){
  const labels=[entry.title];
  // New imports retain exact heading spans; saved books use only recognizable
  // leading heading lines, never a paragraph guessed from its length.
  const headings=(part.headings||[]).filter(heading=>heading.start>=start&&heading.start<next);
  for(let count=0;count<3;count++){
   const whitespace=text.slice(bodyStart,next).match(/^\s*/)[0].length;
   const position=bodyStart+whitespace;
   const heading=headings.find(item=>item.start===position);
   const line=text.slice(position,next).match(/^[^\n]+/)?.[0]||'';
   const recognized=heading||chapter.test(line)||/^\d+[.)]?$/.test(line)||labels.some(label=>key(label)===key(line)||key(label).endsWith(' '+key(line)));
   if(!line||!recognized)break;
   labels.push(heading?.title||line);bodyStart=heading?.end??position+line.length;
  }
  const normalized=labels.map(numberTitle);
  let chapterLabel=normalized.find(label=>chapter.test(label));
  if(!chapterLabel){
   const bare=labels.find(label=>/^\d+[.)]?$/.test(label));
   if(bare)chapterLabel='Chapter '+bare.replace(/\D/g,'');
   else if(!frontMatter.test(entry.title)&&!(entry.depth>0)){
    const peers=contents.filter(item=>!(item.depth>0)&&!frontMatter.test(item.title));
    chapterLabel='Chapter '+(peers.indexOf(entry)+1);
   }
  }
  const spoken=[];
  for(const label of [chapterLabel,...normalized]){
   if(!label||/^\d+[.)]?$/.test(label))continue;
   const cleaned=label.trim().replace(/[.:;—–\-]+$/,'').trim();
   if(spoken.some(previous=>key(previous).includes(key(cleaned))))continue;
   // A full TOC label supersedes its shorter printed chapter heading.
   for(let i=spoken.length-1;i>=0;i--)if(key(cleaned).includes(key(spoken[i])))spoken.splice(i,1);
   spoken.push(cleaned);
  }
  prefix=spoken.join('. ')+'. ';
  while(bodyStart<next&&/\s/.test(text[bodyStart]))bodyStart++;
 }
 const body=chunker(text.slice(0,next),bodyStart,Math.max(100,limit-prefix.length));
 const end=bodyStart+body.length;
 return {text:prefix+body,start,end,prefixLength:prefix.length,bodyStart};
}
export function passagePosition(passage,fraction){
 const spoken=passage.text?.length??passage.spokenLength;
 const offset=Math.floor(Math.max(0,Math.min(1,fraction))*spoken);
 if(offset<(passage.prefixLength||0))return passage.start;
 return Math.min(passage.end,(passage.bodyStart??passage.start)+offset-(passage.prefixLength||0));
}
