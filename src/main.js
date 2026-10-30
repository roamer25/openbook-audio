import { PhononTTS } from 'phonon-tts';
import { importEpub } from './book-navigation.js';
import { importPdf } from './pdf-navigation.js';
import { BufferedNarrator, narrationChunk } from './buffered-narrator.js';
import { ListeningProgress, clockTime } from './listening-progress.js';
import { BookLibrary } from './book-library.js';
import { SectionMediaSession } from './section-media-session.js';
import { chapterPassage,passagePosition } from './chapter-narration.js';
const $=id=>document.getElementById(id),synth=window.speechSynthesis;let aiEngine=null,aiVoiceCache={},aiMode=false;let sections=[],title='',sectionIndex=0,charIndex=0,playing=false,paused=false,token=0,voiceList=[],utterance=null,started=false,watchdog=null;const status=t=>$('status').textContent=t;const normalize=t=>t.replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();let contents=[],contentsSource='',activeContentsIndex=-1;
let timing=null,activeBookId=null,bookVersion=0,saveTimer=null,lastSavedPosition='',lastSavedAt=0;
const bookLibrary=new BookLibrary();
let mediaPlaying=false;
const sectionMedia=new SectionMediaSession({
 onPlay:()=>{if(!playing)play()},
 onPause:()=>{if(playing)$('pause').click()},
 onStop:()=>{stop();status('Stopped.')},
 onSeek:seconds=>{if(!timing||!sections.length)return;const target=timing.seekChapter(sectionIndex,charIndex,seconds,Number($('speed').value));const resume=playing;stop();sectionIndex=target.sectionIndex;charIndex=target.charIndex;display();if(resume)play()},
});
function setBook(name,parts,bookContents,source,options={}){savePlace();stop();bookVersion++;activeBookId=options.id||null;title=name;sections=parts.filter(x=>x.text.trim());sectionIndex=0;charIndex=0;contents=bookContents||sections.map((p,i)=>({title:p.title,depth:0,sectionIndex:i,charIndex:0}));contentsSource=source||'Reading sections';timing=new ListeningProgress(sections,contents);if(options.settings?.timing)timing.restore(options.settings.timing);if(options.position){sectionIndex=Math.max(0,Math.min(options.position.sectionIndex,sections.length-1));charIndex=Math.max(0,Math.min(options.position.charIndex,sections[sectionIndex].text.length))}if(options.settings){$('speed').value=String(options.settings.rate||1);$('speedLabel').textContent=Number($('speed').value).toFixed(1)+'×';if(Array.from($('voices').options).some(option=>option.value===options.settings.voice))$('voices').value=options.settings.voice;aiMode=$('voices').value.startsWith('ai:')}$('chapterSearch').value='';activeContentsIndex=-1;renderContents();$('filename').textContent=name;$('bookTitle').textContent=name;$('chapters').replaceChildren();sections.forEach((p,i)=>{let o=new Option(`${i+1}. ${p.title}`,String(i));$('chapters').add(o)});display();status(`Ready: ${sections.length} section(s).`);if(options.save!==false&&!options.id)storeCurrentBook();else if(options.id)scheduleSave()}function display(){let p=sections[sectionIndex];$('reader').textContent=p?p.text:'Your book’s text will appear here.';$('reader').scrollTop=0;$('chapters').value=String(sectionIndex);progress()}function progress(){let p=sections[sectionIndex];$('seek').value=p?Math.round((charIndex/p.text.length)*100):0;$('progress').textContent=p?`Section ${sectionIndex+1}/${sections.length} · ${Math.min(charIndex,p.text.length).toLocaleString()}/${p.text.length.toLocaleString()} characters`:'No book loaded';updateReadingPosition();updateTimeDisplay();scheduleSave()}function stop(){aiPlayback.stop();token++;playing=false;paused=false;started=false;clearTimeout(watchdog);utterance=null;synth?.cancel();$('play').textContent='▶';updateTimeDisplay()}
function chooseChunk(text,start){return narrationChunk(text,start,800)}
function narratedContents(){return contentsSource==='Reading sections'||contentsSource.includes('chapter boundaries unavailable')?[]:contents}
function speak(){if(aiMode){speakAI();return}
if(!playing)return;if(!synth&&!aiMode)return;
const mine=token;
if(sectionIndex>=sections.length){stop();sectionIndex=sections.length-1;charIndex=sections[sectionIndex].text.length;display();status('Finished the book. Tap Play to listen again.');return}
const text=sections[sectionIndex].text;
if(charIndex>=text.length){sectionIndex++;charIndex=0;display();speak();return}
const passage=chapterPassage(sections[sectionIndex],sectionIndex,charIndex,narratedContents(),narrationChunk,800);
const chunk=passage.text;
if(!chunk){charIndex=text.length;speak();return}
const start=charIndex;
const u=new SpeechSynthesisUtterance(chunk);
utterance=u;started=false;
const selected=voiceList.find(v=>v.voiceURI===$('voices').value);
// Safari may reject a stale voice object; the system default is the safe fallback.
if(selected)u.voice=selected;
u.lang=selected?.lang||'en-US';
u.pitch=1;u.rate=Number($('speed').value);
u.onstart=()=>{if(mine!==token)return;started=true;clearTimeout(watchdog);status('Narrating…');updateTimeDisplay()};
u.onboundary=e=>{if(mine!==token||!playing)return;if(typeof e.charIndex==='number'){charIndex=passagePosition(passage,Math.min(e.charIndex,chunk.length)/chunk.length);progress()}};
u.onend=()=>{if(mine!==token||!playing)return;clearTimeout(watchdog);charIndex=passage.end;progress();if(mine===token&&playing)speak()};
u.onerror=e=>{if(mine!==token)return;clearTimeout(watchdog);if(e.error==='interrupted'||e.error==='canceled'){if(playing){playing=false;paused=false;$('play').textContent='▶';status('Narration interrupted. Tap Play to try again.')}return}playing=false;paused=false;status('Speech error: '+(e.error||'unknown')+'. Try another voice.');$('play').textContent='▶'};
try{synth.speak(u)}catch(err){playing=false;$('play').textContent='▶';status('Could not start speech: '+err.message);return}
status('Starting narration…');progress();
watchdog=setTimeout(()=>{if(mine===token&&playing&&!started){status('Speech did not start. Try the Default voice, then tap Play again.');playing=false;paused=false;$('play').textContent='▶';synth.cancel()}},4500);
}
function play(){
if(!sections.length){status('Open a book or paste text first.');return}
if(!synth&&!aiMode){status('Speech is not supported by this browser.');return}
if(paused){paused=false;playing=true;$('play').textContent='❚❚';status('Resuming…');if(aiMode)aiPlayback.resume();else synth.resume();updateTimeDisplay();return}
if(playing){if(aiMode)aiPlayback.pause();else synth.pause();paused=true;playing=false;$('play').textContent='▶';status('Paused.');updateTimeDisplay();return}
// Important for iOS Safari: do not cancel and immediately speak in the same tap.
// Previous cancellation happens only when stopping/seeking/changing books.
if(sectionIndex>=sections.length||charIndex>=sections[sectionIndex].text.length){sectionIndex=0;charIndex=0;display()}
token++;playing=true;paused=false;$('play').textContent='❚❚';
if(!aiMode&&synth?.paused)synth.resume();
speak();
}
$('play').onclick=play;$('pause').onclick=()=>{if(playing&&!paused){paused=true;playing=false;if(aiMode)aiPlayback.pause();else synth.pause();$('play').textContent='▶';status('Paused.');updateTimeDisplay()}};$('stop').onclick=()=>{stop();status('Stopped.')};$('back').onclick=()=>{if(!sections.length)return;let active=playing;stop();charIndex=Math.max(0,charIndex-250);progress();if(active)play()};$('next').onclick=()=>{if(!sections.length)return;const next=contents.find(entry=>entry.sectionIndex>sectionIndex||(entry.sectionIndex===sectionIndex&&entry.charIndex>charIndex))||contents[0];if(next)jumpToSection(next.sectionIndex,next.charIndex)};$('chapters').onchange=()=>jumpToSection(Number($('chapters').value),0);$('speed').oninput=()=>{const rate=Number($('speed').value);$('speedLabel').textContent=rate.toFixed(1)+'×';aiPlayback.setRate(rate);updateTimeDisplay();scheduleSave()};$('usePaste').onclick=()=>{let t=normalize($('paste').value);if(!t){status('Paste some text first.');return}setBook('Pasted text',[{title:'Pasted text',text:t}])};$('clear').onclick=()=>{savePlace();stop();activeBookId=null;bookVersion++;timing=null;sections=[];title='';sectionIndex=0;charIndex=0;$('paste').value='';$('filename').textContent='No file selected';$('bookTitle').textContent='Open a book to begin.';$('chapters').replaceChildren();contents=[];activeContentsIndex=-1;$('chapterSearch').value='';renderContents();display();status('Cleared.')};$('seek').onchange=()=>{if(!sections.length)return;let active=playing;stop();charIndex=Math.floor(sections[sectionIndex].text.length*Number($('seek').value)/100);progress();if(active)play()};$('demo').onclick=()=>setBook('Sample reading',[{title:'Welcome',text:'Welcome to OpenBook Audio. You can import an EPUB book, a text-based PDF, a plain text file, or paste any text. Choose a voice and press play. There are no accounts, subscriptions, or listening limits.'}],undefined,undefined,{save:false});function voices(){voiceList=synth?.getVoices()||[];let prev=$('voices').value;$('voices').replaceChildren();$('voices').add(new Option('★ Easton — AI narrator (US)','ai:easton'));$('voices').add(new Option('★ Edwin — AI narrator (UK)','ai:edwin'));$('voices').add(new Option('Default iPhone voice (recommended)','')); voiceList.forEach(v=>$('voices').add(new Option(`${v.name} (${v.lang})${v.localService?' · device':''}`,v.voiceURI)));if(prev==='ai:easton'||prev==='ai:edwin'||voiceList.some(v=>v.voiceURI===prev))$('voices').value=prev;else $('voices').value='ai:easton';aiMode=$('voices').value.startsWith('ai:')}voices();if(synth)synth.onvoiceschanged=voices;$('voices').addEventListener('change',()=>{stop();aiMode=$('voices').value.startsWith('ai:');status(aiMode?'AI narrator selected. Tap Play to load.':'iPhone voice selected.');scheduleSave()});
// Official Phonon WebAssembly browser engine, bundled with Vite.
let aiLoadPromise=null;
const voiceFiles={easton:'LMDIYE0Oa377Qh6Z',edwin:'zUCxzrOrugTSis03'};
async function loadAI(){
 if(aiEngine)return aiEngine;
 if(!aiLoadPromise){
  aiLoadPromise=(async()=>{
   status('Downloading Phonon speech engine and model (first use may take minutes)…');
   const engine=await PhononTTS.load({lang:'en',quant:'q8',threads:1,device:'cpu',onProgress:({file,loaded,total,cached})=>{
    if(cached||!aiPlayback.active)return;
    if(total)status('Downloading '+String(file).split('/').pop()+': '+Math.round(loaded/total*100)+'%');
   }});
   aiEngine=engine;
   return engine;
  })().catch(e=>{aiLoadPromise=null;throw e});
 }
 return aiLoadPromise;
}
async function ensureVoice(engine,name){
 if(aiVoiceCache[name])return;
 if(aiPlayback.active)status('Loading '+name+' voice…');
 await engine.addVoice(name,'https://huggingface.co/gradium/phonon-voices/resolve/main/voices/'+voiceFiles[name]+'.safetensors');
 aiVoiceCache[name]=true;
}
const aiPlayback=new BufferedNarrator({
 audioFactory:()=>$('narrationAudio'),
 onPlaybackState:state=>{mediaPlaying=state==='playing';updateTimeDisplay()},
 onBlocked:()=>{playing=false;paused=true;$('play').textContent='▶';status('Audio is ready. Tap Play to start.')},
 onPassage:({section,start,end,seconds})=>{timing?.observe(section,start,end,seconds);updateTimeDisplay()},
 onPosition:(index,offset)=>{if(!playing)return;const changed=index!==sectionIndex;sectionIndex=index;charIndex=offset;if(changed)display();else progress()},
 onStatus:message=>{if(!paused)status(message)},
 onEnded:()=>{playing=false;paused=false;sectionIndex=sections.length-1;charIndex=sections[sectionIndex]?.text.length||0;display();$('play').textContent='▶';status('Finished the book. Tap Play to listen again.')},
 onError:error=>{playing=false;paused=false;$('play').textContent='▶';status('AI voice failed: '+(error.message||error))},
});
function speakAI(){
 if(!playing||aiPlayback.active)return;
 const name=$('voices').value.split(':')[1];
 aiPlayback.start({
  getEngine:async()=>{const engine=await loadAI();if(aiPlayback.active)await ensureVoice(engine,name);return engine},
  parts:sections,contents:narratedContents(),sectionIndex,charIndex,voice:name,rate:Number($('speed').value),
 });
}
$('upload').onchange=async e=>{let file=e.target.files?.[0];if(!file)return;status('Opening '+file.name+'…');try{let ext=file.name.split('.').pop().toLowerCase();let book;if(ext==='epub')book=await importEpub(file);else if(ext==='pdf')book=await importPdf(file,{onProgress:status});else if(ext==='txt'||ext==='md')book={name:file.name,parts:[{title:'Document',text:normalize(await file.text())}]};else throw Error('Unsupported file format.');setBook(book.name,book.parts,book.contents,book.contentsSource);if(book.navigationNotice)status(book.navigationNotice)}catch(err){status('Could not open file: '+err.message)}e.target.value=''};
const cover=document.getElementById('coverTitle');new MutationObserver(()=>{cover.textContent=document.getElementById('bookTitle').textContent.slice(0,70)}).observe(document.getElementById('bookTitle'),{childList:true});
function jumpToSection(index,offset){
 if(!sections[index])return;
 const resume=playing;stop();sectionIndex=index;charIndex=Math.max(0,Math.min(offset,sections[index].text.length));display();
 status('Selected: '+(contents.find(entry=>entry.sectionIndex===index&&entry.charIndex===charIndex)?.title||sections[index].title));
 if(resume)play();
}
function renderContents(){
 const query=$('chapterSearch').value.trim().toLocaleLowerCase();
 const list=$('contentsList');list.replaceChildren();
 const matches=contents.map((entry,index)=>({entry,index})).filter(({entry})=>entry.title.toLocaleLowerCase().includes(query));
 $('contentsSummary').textContent=contents.length?`${contentsSource} · ${matches.length} of ${contents.length} entries`:'Import a book to see its chapters.';
 if(contents.length&&!matches.length){const message=document.createElement('p');message.className='note';message.textContent='No matching chapters. Try another word.';list.append(message)}
 for(const {entry,index} of matches){
  const item=document.createElement('li'),button=document.createElement('button');
  button.type='button';button.className='chapter-link';button.dataset.contentsIndex=String(index);
  button.style.paddingLeft=(12+Math.min(entry.depth||0,5)*16)+'px';button.textContent=entry.title;
  if(index===activeContentsIndex)button.setAttribute('aria-current','location');
  button.onclick=()=>{jumpToSection(entry.sectionIndex,entry.charIndex);$('currentChapter').scrollIntoView({behavior:'smooth',block:'nearest'})};
  item.append(button);list.append(item);
 }
}
function updateReadingPosition(){
 const part=sections[sectionIndex];
 let current=-1;
 contents.forEach((entry,index)=>{
  if(entry.sectionIndex>sectionIndex||(entry.sectionIndex===sectionIndex&&entry.charIndex>charIndex))return;
  const previous=contents[current];
  if(!previous||entry.sectionIndex>previous.sectionIndex||(entry.sectionIndex===previous.sectionIndex&&entry.charIndex>=previous.charIndex))current=index;
 });
 activeContentsIndex=current;
 $('currentChapter').textContent=part?(contents[current]?.title||part.title):'No chapter selected';
 document.querySelectorAll('[data-contents-index]').forEach(button=>{
  if(Number(button.dataset.contentsIndex)===current)button.setAttribute('aria-current','location');else button.removeAttribute('aria-current');
 });
 if(!part)return;
 const reader=$('reader');const end=Math.min(part.text.length,charIndex+chooseChunk(part.text,charIndex).length);
 const mark=document.createElement('mark');mark.textContent=part.text.slice(charIndex,end);mark.id='readingPosition';
 reader.replaceChildren(document.createTextNode(part.text.slice(0,charIndex)),mark,document.createTextNode(part.text.slice(end)));
 if(mark.offsetTop<reader.scrollTop||mark.offsetTop+mark.offsetHeight>reader.scrollTop+reader.clientHeight)reader.scrollTop=Math.max(0,mark.offsetTop-24);
}
$('chapterSearch').oninput=renderContents;

function updateTimeDisplay(){
 const rate=Number($('speed').value);
 if(!timing||!sections.length){$('chapterTiming').textContent='No book loaded';$('bookTiming').textContent='Import a book to see your progress.';$('bookProgress').value=0;sectionMedia.clear();return}
 const values=timing.at(sectionIndex,charIndex,rate);
 sectionMedia.update({book:title,title:values.chapter.title,elapsed:values.chapter.elapsed,duration:values.chapter.duration,playing:playing&&!paused&&(!aiMode||mediaPlaying)});
 $('chapterTiming').textContent=`${clockTime(values.chapter.elapsed)} / ${clockTime(values.chapter.duration)} · ${clockTime(values.chapter.remaining)} left`;
 $('chapterTimingTitle').textContent=values.chapter.title;
 $('bookTiming').textContent=`${values.book.percent}% · ${clockTime(values.book.elapsed)} / ${clockTime(values.book.duration)} · ${clockTime(values.book.remaining)} left`;
 $('bookProgress').value=values.book.percent;$('timeEstimate').textContent=`Estimated times at ${rate.toFixed(1)}×. Adjusts as narration is generated.`;
}
function savedSettings(){return {rate:Number($('speed').value),voice:$('voices').value,timing:timing?.stats()}}
function scheduleSave(){if(!activeBookId)return;clearTimeout(saveTimer);saveTimer=setTimeout(savePlace,1200);if(Date.now()-lastSavedAt>5000)savePlace()}
async function savePlace(){
 clearTimeout(saveTimer);if(!activeBookId||!sections.length)return;
 const id=activeBookId,position={sectionIndex,charIndex},settings=savedSettings();const key=JSON.stringify([id,position,settings]);if(key===lastSavedPosition)return;
 lastSavedPosition=key;lastSavedAt=Date.now();
 try{await bookLibrary.update(id,position,settings);await renderLibrary()}catch(error){lastSavedPosition='';$('libraryMessage').textContent='Your place could not be saved: '+error.message}
}
async function storeCurrentBook(){
 const version=bookVersion;const book={name:title,parts:sections,contents,contentsSource};
 $('libraryMessage').textContent='Saving book…';
 try{const saved=await bookLibrary.save(book,{sectionIndex,charIndex},savedSettings());if(version===bookVersion){activeBookId=saved.id;$('libraryMessage').textContent='Book saved on this device.';scheduleSave()}await renderLibrary()}
 catch(error){if(version===bookVersion)$('libraryMessage').textContent='Book opened, but could not be saved: '+error.message}
}
async function openSavedBook(id){
 const version=bookVersion;await savePlace();
 try{const saved=await bookLibrary.get(id);if(version!==bookVersion)return;if(!saved)throw Error('This book is no longer saved.');const {book,shelf}=saved;setBook(book.name,book.parts,book.contents,book.contentsSource,{id,position:shelf.position,settings:shelf.settings});$('libraryMessage').textContent='Resumed your saved place.';$('bookTitle').scrollIntoView({behavior:'smooth',block:'start'})}
 catch(error){$('libraryMessage').textContent='Could not open book: '+error.message}
}
async function renderLibrary(){
 const entries=await bookLibrary.list();const list=$('savedBooks');list.replaceChildren();
 $('libraryCount').textContent=entries.length?`${entries.length} saved ${entries.length===1?'book':'books'}`:'Your library is empty. Import a book or paste text to save it.';
 for(const entry of entries){
  const card=document.createElement('li');card.className='saved-book';const open=document.createElement('button');open.type='button';open.className='saved-book-open';open.textContent=entry.name;open.onclick=()=>openSavedBook(entry.id);
  const note=document.createElement('span');note.className='note';note.textContent=`${entry.wordCount.toLocaleString()} words · ${Number(entry.settings?.rate||1).toFixed(1)}×`;
  const remove=document.createElement('button');remove.type='button';remove.className='remove-book';remove.textContent='Remove';remove.setAttribute('aria-label','Remove '+entry.name+' from library');remove.onclick=async()=>{try{if(activeBookId===entry.id){await savePlace();activeBookId=null}await bookLibrary.remove(entry.id);await renderLibrary();$('libraryMessage').textContent='Removed from My books.'}catch(error){$('libraryMessage').textContent='Could not remove book: '+error.message}};
  card.append(open,note,remove);list.append(card);
 }
 return entries;
}
window.addEventListener('pagehide',()=>savePlace());
document.addEventListener('visibilitychange',()=>{if(document.hidden)savePlace()});
renderLibrary().then(entries=>{if(!sections.length&&entries.length)openSavedBook(entries[0].id)}).catch(error=>{$('libraryMessage').textContent='Books cannot be saved in this browser: '+error.message});

// Reassert the section timeline when Safari returns to or hides this page.
document.addEventListener('visibilitychange',updateTimeDisplay);
