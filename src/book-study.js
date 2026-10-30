// Source-grounded study extraction. No external service receives book text.
const STOP=new Set(('a about above according across after again against ago all almost alone along already also although always am among an and another any anyone anything are around as at author away back be became because become been before began behind being believe below beside best between beyond book both brought but by called came can cannot case certain chapter come comes concerning could day did do does done down during each early either else end enough especially even ever every everyone everything example fact far few finally first five for form found four from full gave general get give given gives go good great had hand has have having he heard hence her here herself him himself his history how however i if important in indeed into is it its itself just keep kind know known last later least left less let life like little long look made make man many matter may me mean men might more most much must my name named near necessary need neither never new next no nor not nothing now number of off often old on once one only or order other others ought our out over own part people perhaps person place present put quite rather read really reason right same said say says second see seem seems seen shall she should show since so some someone something sometimes still such take taken than that the their them themselves then there therefore these they thing things think third this those though thought three through thus time to together told too toward true two under until up upon us use used uses very was way we well were what whatever when where whether which while who whole whom whose why will with within without word words work world would wrote year years yet you your').split(' '));
const NOT_PERSON=new Set(('chapter section introduction conclusion preface contents volume part book holy spirit old testament new testament united states great britain north america south america roman empire holy roman empire first second third fourth christian church church council lord day god word scripture scriptures bible christian christianity monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december').split(' '));
const key=s=>s.toLocaleLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function phrasePattern(phrase){return new RegExp('(?<![\\p{L}\\p{N}])'+escape(phrase)+'(?![\\p{L}\\p{N}])','giu')}
function chapterName(parts,contents,index,offset){let best=null;for(const entry of contents||[]){if(entry.sectionIndex>index||(entry.sectionIndex===index&&entry.charIndex>offset))continue;if(!best||entry.sectionIndex>best.sectionIndex||(entry.sectionIndex===best.sectionIndex&&entry.charIndex>=best.charIndex))best=entry}return best?.title||parts[index]?.title||'Reading'}
export function studyRanges(parts,contents=[],scope='chapter',position={sectionIndex:0,charIndex:0}){
 if(!['chapter','sofar','book'].includes(scope))throw Error('Choose a study scope.');
 if(!parts.length)return [];
 const si=Math.max(0,Math.min(parts.length-1,position.sectionIndex||0)),ci=Math.max(0,Math.min(parts[si].text.length,position.charIndex||0));
 let first={sectionIndex:0,charIndex:0},last={sectionIndex:parts.length-1,charIndex:parts.at(-1).text.length};
 if(scope==='sofar')last={sectionIndex:si,charIndex:ci};
 if(scope==='chapter'){
  const entries=(contents.length?contents:parts.map((p,i)=>({sectionIndex:i,charIndex:0,title:p.title}))).filter(e=>parts[e.sectionIndex]).toSorted((a,b)=>a.sectionIndex-b.sectionIndex||a.charIndex-b.charIndex);
  first={sectionIndex:si,charIndex:0};
  for(const entry of entries){if(entry.sectionIndex<si||(entry.sectionIndex===si&&entry.charIndex<=ci))first=entry;else {last=entry;break}}
 }
 const ranges=[];
 for(let i=first.sectionIndex;i<=last.sectionIndex;i++){const start=i===first.sectionIndex?first.charIndex:0,end=Math.min(parts[i].text.length,i===last.sectionIndex?last.charIndex:parts[i].text.length);if(end>start)ranges.push({sectionIndex:i,start,end})}
 return ranges;
}
function sentences(text,start,end){
 const result=[];const slice=text.slice(start,end);const re=/[^.!?]+(?:[.!?]+["'”’)]*|$)/gu;
 for(const match of slice.matchAll(re)){const lead=match[0].search(/\S/u);if(lead<0)continue;const content=match[0].trim();if(content.length<45||content.length>800)continue;const offset=start+match.index+lead;result.push({text:content,start:offset,end:offset+content.length})}
 return result;
}
function usable(label){return /\p{L}/u.test(label)&&label.length>=3&&label.length<=65&&!/^\d/u.test(label)&&!label.split(/\s+/u).every(w=>STOP.has(key(w)))}
function isPerson(label){const words=key(label).split(' ');return words.every(w=>!NOT_PERSON.has(w)&&!STOP.has(w))}
export function analyzeBook({parts,contents=[],scope='chapter',position,custom=[]}){
 const ranges=studyRanges(parts,contents,scope,position),terms=new Map(),people=new Map(),wordStats=new Map();let wordCount=0;
 const add=(map,label,evidence,bonus=0)=>{label=label.replace(/^["'“‘]+|["'”’:,;]+$/gu,'').trim();if(!usable(label))return;const id=key(label);if(!map.has(id)&&map.size>=3000)return;const prev=map.get(id);if(prev){prev.count++;prev.score+=1+bonus;if(bonus>prev.bonus){prev.label=label;prev.evidence=evidence;delete prev.definition;prev.bonus=bonus}}else map.set(id,{id:(map===people?'person:':'term:')+id,label,count:1,score:1+bonus,bonus,evidence})};
 for(const range of ranges){
  const part=parts[range.sectionIndex];
  for(const sentence of sentences(part.text,range.start,range.end)){
   const evidence={...sentence,sectionIndex:range.sectionIndex,chapter:chapterName(parts,contents,range.sectionIndex,sentence.start)};
   const words=[...sentence.text.matchAll(/\p{L}[\p{L}’'-]{2,}/gu)];wordCount+=(sentence.text.match(/\S+/gu)||[]).length;
   for(const m of words){const id=key(m[0]);if(STOP.has(id)||NOT_PERSON.has(id)||id.length<5)continue;let item=wordStats.get(id);if(!item&&wordStats.size<12000){item={label:m[0],count:0,evidence};wordStats.set(id,item)}if(item)item.count++}
   // Explicit author-defined terms receive priority over frequency alone.
   const definition=sentence.text.match(/(?:^|[,;:]\s*|\b(?:the term|by|called)\s+)([\p{L}][\p{L}’' -]{2,60}?)\s+(?:is defined as|refers to|means|denotes|signifies|is the|is an?|are the)\s+(.{15,})/iu);
   if(definition){let label=definition[1].replace(/^(?:the|a|an|but|and|thus|therefore|however|now)\s+/iu,'');const tokens=label.split(/\s+/u);if(tokens.length<=5){add(terms,label,evidence,7);const item=terms.get(key(label));if(item&&!phrasePattern(label).test(definition[2])){item.definition=definition[2];item.evidence=evidence}}}
   for(const m of sentence.text.matchAll(/[“"]([^”"\n]{4,60})[”"]/gu)){if(m[1].split(/\s+/u).length<=5)add(terms,m[1],evidence,3)}
   const capital=/\b\p{Lu}[\p{L}’'-]+(?:\s+(?:(?:van|von|de|of)\s+)?\p{Lu}[\p{L}’'-]+){1,3}\b/gu;
   for(const m of sentence.text.matchAll(capital)){let label=m[0].replace(/^(?:The|Saint|Sir|King|Queen|President|Professor|Doctor|Apostle)\s+/u,'');const context=sentence.text.slice(Math.max(0,m.index-30),m.index+m[0].length+65);if(isPerson(label)&&/\b(?:said|says|wrote|writes|taught|teaches|argued|argues|believed|believes|born|died|king|queen|president|professor|doctor|saint|sir|apostle|according to|author|theologian|philosopher|poet|writer|emperor|prophet|disciple|named|called|led|ruled|met|asked|answered|replied)\b/iu.test(context))add(people,label,evidence,3)}
   for(const m of sentence.text.matchAll(/\b(\p{Lu}[\p{L}’'-]{2,})\s+(?:was|is)\s+(?:an?|the)\s+(?:[\p{L}-]+\s+){0,3}(?:philosopher|theologian|poet|writer|emperor|king|queen|prophet|disciple|apostle|author)\b/gu)){if(isPerson(m[1]))add(people,m[1],evidence,3)}
   // A single name needs an explicit attribution, not capitalization alone.
   for(const m of sentence.text.matchAll(/\b(\p{Lu}[\p{L}’'-]{3,})\s+(?:said|says|wrote|writes|taught|teaches|argued|argues|believed|believes|replied|ruled|answered|explained)\b/gu)){if(isPerson(m[1]))add(people,m[1],evidence,3)}
  }
 }
 for(const [id,item] of wordStats){if(item.count>=2&&!people.has(id))add(terms,item.label,item.evidence,Math.min(item.count,20)/3)}
 // User additions must also have an actual occurrence within the chosen scope.
 for(const item of custom){if(!['term','person'].includes(item.kind)||!usable(item.label))continue;for(const range of ranges){const text=parts[range.sectionIndex].text,found=[...text.slice(range.start,range.end).matchAll(phrasePattern(item.label))][0];if(!found)continue;const point=range.start+found.index;const context=sentences(text,range.start,range.end).find(s=>s.start<=point&&s.end>=point+item.label.length);if(context)add(item.kind==='person'?people:terms,item.label,{...context,sectionIndex:range.sectionIndex,chapter:chapterName(parts,contents,range.sectionIndex,context.start)},20);break}}
 // Merge short name references into their full name when unambiguous.
 for(const [id,item] of [...people]){if(id.includes(' '))continue;const full=[...people.values()].filter(p=>p.label!==item.label&&key(p.label).split(' ').includes(id));if(full.length===1){full[0].count+=item.count;full[0].score+=item.score;people.delete(id)}}
 const allPeople=[...people.values()];
 for(const [id] of terms){if(allPeople.some(p=>key(p.label)===id||key(p.label).split(' ').includes(id)))terms.delete(id)}
 const sort=map=>[...map.values()].sort((a,b)=>b.score-a.score||a.label.localeCompare(b.label)).slice(0,40);
 return {version:1,scope,ranges,wordCount,terms:sort(terms),people:sort(people)};
}
export function shuffled(items,random=Math.random){const result=[...items];for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]]}return result}
export function buildQuiz(study,{count=10,random=Math.random,hidden=[]}={}){
 const questions=[],seen=new Set(),groups=[['term',study.terms],['person',study.people]];
 for(const [kind,raw] of groups){const items=raw.filter(item=>!hidden.includes(item.id));for(const item of items){const evidence=item.evidence;const matches=[...evidence.text.matchAll(phrasePattern(item.label))];if(!matches.length)continue;let prompt=evidence.text.replace(phrasePattern(item.label),'_____');
   // Do not leave another option visibly answered in the same passage.
   const pool=items.filter(other=>other.id!==item.id&&!phrasePattern(other.label).test(evidence.text));
   const distractors=shuffled(pool,random).slice(0,3);if(!distractors.length)continue;
   const signature=key(evidence.text);if(seen.has(signature))continue;seen.add(signature);
   const options=shuffled([item.label,...distractors.map(p=>p.label)],random);if(item.definition)prompt=item.definition;
   questions.push({id:item.id,kind,prompt:kind==='person'?'Which person completes this passage?':item.definition?'Which concept does the book describe this way?':'Which term completes this passage?',passage:prompt,options,answer:options.indexOf(item.label),evidence,topic:item.label});
 }}
 const limit=Math.max(1,Math.min(20,Number(count)||10)),mixed=shuffled(questions,random),chosen=[];
 if(limit>=2){for(const kind of ['term','person']){const question=mixed.find(q=>q.kind===kind);if(question)chosen.push(question)}}
 for(const question of mixed){if(chosen.length>=limit)break;if(!chosen.includes(question))chosen.push(question)}
 return shuffled(chosen,random);
}
