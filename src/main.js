import { setupReadAlong } from './read-along.js';
import { PhononTTS } from 'phonon-tts';
import { importEpub } from './book-navigation.js';
import { importPdf } from './pdf-navigation.js';
import { setupKindlePlace } from './kindle-place.js';
import { momentPassage,selectedPassage,markedSegments } from './book-marks.js';
import { BufferedNarrator, narrationChunk } from './buffered-narrator.js';
import { ListeningProgress, clockTime } from './listening-progress.js';
import { BookLibrary } from './book-library.js';
import { SectionMediaSession } from './section-media-session.js';
import { chapterPassage,passagePosition } from './chapter-narration.js';
const $=id=>document.getElementById(id),synth=window.speechSynthesis;let aiEngine=null,aiVoiceCache={},aiMode=false;let sections=[],title='',sectionIndex=0,charIndex=0,playing=false,paused=false,token=0,voiceList=[],utterance=null,started=false,watchdog=null;const status=t=>$('status').textContent=t;const normalize=t=>t.replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();let contents=[],contentsSource='',activeContentsIndex=-1;
let timing=null,activeBookId=null,bookVersion=0,saveTimer=null,lastSavedPosition='',lastSavedAt=0;
const bookLibrary=new BookLibrary();
let bookMarks=[],selectionSnapshot=null,highlightEditorIds=[],deletedMoment=null;
const readAlong=setupReadAlong({reader:$('reader'),button:$('followAlong'),message:$('readAlongStatus'),getPosition:()=>sections.length?{sectionIndex,charIndex}:null,render:renderReader,onBrowse:()=>{$('reader').classList.add('browsing')}});
$('followAlong').onclick=()=>{selectionSnapshot=null;closeHighlightEditor();window.getSelection()?.removeAllRanges();readAlong.follow();refreshMomentControls()};
const kindleHandoff=setupKindlePlace({
 button:$('kindlePlace'),panel:$('kindlePanel'),field:$('kindlePhrase'),message:$('kindleMessage'),location:$('kindleLocation'),copyButton:$('kindleCopy'),closeButton:$('kindleClose'),
 getPlace:()=>sections.length?{text:sections[sectionIndex]?.text||'',offset:charIndex,book:title,chapter:contents[activeContentsIndex]?.title||sections[sectionIndex]?.title}:null,
 pause:()=>{if(playing)$('pause').click()},save:()=>{void savePlace()},
});
let mediaPlaying=false;
const sectionMedia=new SectionMediaSession({
 onPlay:()=>{if(!playing)play()},
 onPause:()=>{if(playing)$('pause').click()},
 onStop:()=>{stop();status('Stopped.')},
 onSeek:seconds=>{if(!timing||!sections.length)return;const target=timing.seekChapter(sectionIndex,charIndex,seconds,Number($('speed').value));const resume=playing;stop();sectionIndex=target.sectionIndex;charIndex=target.charIndex;display();if(resume)play()},
});
function setBook(name,parts,bookContents,source,options={}){savePlace();stop();bookVersion++;resetMoments();kindleHandoff.reset();activeBookId=options.id||null;title=name;sections=parts.filter(x=>x.text.trim());sectionIndex=0;charIndex=0;contents=bookContents||sections.map((p,i)=>({title:p.title,depth:0,sectionIndex:i,charIndex:0}));contentsSource=source||'Reading sections';timing=new ListeningProgress(sections,contents);if(options.settings?.timing)timing.restore(options.settings.timing);if(options.position){sectionIndex=Math.max(0,Math.min(options.position.sectionIndex,sections.length-1));charIndex=Math.max(0,Math.min(options.position.charIndex,sections[sectionIndex].text.length))}if(options.settings){$('speed').value=String(options.settings.rate||1);$('speedLabel').textContent=Number($('speed').value).toFixed(1)+'×';if(Array.from($('voices').options).some(option=>option.value===options.settings.voice))$('voices').value=options.settings.voice;aiMode=$('voices').value.startsWith('ai:')}readAlong.reset();$('chapterSearch').value='';activeContentsIndex=-1;renderContents();$('filename').textContent=name;$('bookTitle').textContent=name;$('chapters').replaceChildren();sections.forEach((p,i)=>{let o=new Option(`${i+1}. ${p.title}`,String(i));$('chapters').add(o)});display();status(`Ready: ${sections.length} section(s).`);if(options.save!==false&&!options.id)storeCurrentBook();else if(options.id){scheduleSave();loadMoments()}}function display(){if(!sections.length){$('reader').textContent='Your book’s text will appear here.';$('currentChapter').textContent='No chapter selected';readAlong.reset()}$('chapters').value=String(sectionIndex);progress()}function progress(){let p=sections[sectionIndex];$('seek').value=p?Math.round((charIndex/p.text.length)*100):0;$('progress').textContent=p?`Section ${sectionIndex+1}/${sections.length} · ${Math.min(charIndex,p.text.length).toLocaleString()}/${p.text.length.toLocaleString()} characters`:'No book loaded';updateReadingPosition();refreshMomentControls();kindleHandoff.refresh();updateTimeDisplay();scheduleSave()}function stop(){closeHighlightEditor();selectionSnapshot=null;aiPlayback.stop();token++;playing=false;paused=false;started=false;clearTimeout(watchdog);utterance=null;synth?.cancel();$('play').textContent='▶';updateTimeDisplay()}
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
$('play').onclick=play;$('pause').onclick=()=>{if(playing&&!paused){paused=true;playing=false;if(aiMode)aiPlayback.pause();else synth.pause();$('play').textContent='▶';status('Paused.');updateTimeDisplay()}};$('stop').onclick=()=>{stop();status('Stopped.')};$('back').onclick=()=>{if(!sections.length)return;let active=playing;stop();charIndex=Math.max(0,charIndex-250);progress();if(active)play()};$('next').onclick=()=>{if(!sections.length)return;const next=contents.find(entry=>entry.sectionIndex>sectionIndex||(entry.sectionIndex===sectionIndex&&entry.charIndex>charIndex))||contents[0];if(next)jumpToSection(next.sectionIndex,next.charIndex)};$('chapters').onchange=()=>jumpToSection(Number($('chapters').value),0);$('speed').oninput=()=>{const rate=Number($('speed').value);$('speedLabel').textContent=rate.toFixed(1)+'×';aiPlayback.setRate(rate);updateTimeDisplay();scheduleSave()};$('usePaste').onclick=()=>{let t=normalize($('paste').value);if(!t){status('Paste some text first.');return}setBook('Pasted text',[{title:'Pasted text',text:t}])};$('clear').onclick=()=>{savePlace();stop();activeBookId=null;bookVersion++;resetMoments();kindleHandoff.reset();timing=null;sections=[];title='';sectionIndex=0;charIndex=0;$('paste').value='';$('filename').textContent='No file selected';$('bookTitle').textContent='Open a book to begin.';$('chapters').replaceChildren();contents=[];activeContentsIndex=-1;$('chapterSearch').value='';renderContents();display();status('Cleared.')};$('seek').onchange=()=>{if(!sections.length)return;let active=playing;stop();charIndex=Math.floor(sections[sectionIndex].text.length*Number($('seek').value)/100);progress();if(active)play()};$('demo').onclick=()=>setBook('Sample reading',[{title:'Welcome',text:'Welcome to OpenBook Audio. You can import an EPUB book, a text-based PDF, a plain text file, or paste any text. Choose a voice and press play. There are no accounts, subscriptions, or listening limits.'}],undefined,undefined,{save:false});function voices(){voiceList=synth?.getVoices()||[];let prev=$('voices').value;$('voices').replaceChildren();$('voices').add(new Option('★ Easton — AI narrator (US)','ai:easton'));$('voices').add(new Option('★ Edwin — AI narrator (UK)','ai:edwin'));$('voices').add(new Option('Default iPhone voice (recommended)','')); voiceList.forEach(v=>$('voices').add(new Option(`${v.name} (${v.lang})${v.localService?' · device':''}`,v.voiceURI)));if(prev==='ai:easton'||prev==='ai:edwin'||voiceList.some(v=>v.voiceURI===prev))$('voices').value=prev;else $('voices').value='ai:easton';aiMode=$('voices').value.startsWith('ai:')}voices();if(synth)synth.onvoiceschanged=voices;$('voices').addEventListener('change',()=>{stop();aiMode=$('voices').value.startsWith('ai:');status(aiMode?'AI narrator selected. Tap Play to load.':'iPhone voice selected.');scheduleSave()});
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
 selectionSnapshot=null;const resume=playing;stop();sectionIndex=index;charIndex=Math.max(0,Math.min(offset,sections[index].text.length));readAlong.follow();display();
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

 document.querySelectorAll('[data-contents-index]').forEach(button=>{
  if(Number(button.dataset.contentsIndex)===current)button.setAttribute('aria-current','location');else button.removeAttribute('aria-current');
 });
 if(!part)return;
 readAlong.update();
}
function chapterAt(index,offset){let name=sections[index]?.title||'No chapter selected';for(const entry of contents){if(entry.sectionIndex<index||(entry.sectionIndex===index&&entry.charIndex<=offset))name=entry.title}return name}
function renderReader(position,following){
 const {sectionIndex:index,charIndex:offset}=position,part=sections[index];if(!part)return;
 const reader=$('reader'),previousScroll=reader.scrollTop,changed=reader.dataset.sectionIndex!==String(index);
 reader.classList.toggle('browsing',!following);
 $('currentChapter').textContent=chapterAt(index,offset);
 const end=following?Math.min(part.text.length,offset+chooseChunk(part.text,offset).length):0;
 const fragments=markedSegments(part.text,bookMarks.filter(mark=>mark.sectionIndex===index),following?offset:0,end);const output=document.createDocumentFragment();let activeMark=null;
 for(const fragment of fragments){if(!fragment.current&&!fragment.highlighted){output.append(document.createTextNode(fragment.text));continue}const node=document.createElement('mark');node.textContent=fragment.text;if(fragment.highlighted){node.classList.add('saved-highlight');node.dataset.highlightIds=JSON.stringify(fragment.highlightIds);node.tabIndex=0;node.setAttribute('role','button');node.setAttribute('aria-label','Edit saved highlight');node.title='Tap to delete this highlight'}if(fragment.current){node.classList.add('current-passage');if(!activeMark){node.id='readingPosition';activeMark=node}}output.append(node)}
 reader.replaceChildren(output);reader.dataset.sectionIndex=String(index);reader.scrollTop=changed?0:previousScroll;
 if(following&&activeMark&&(activeMark.offsetTop<reader.scrollTop||activeMark.offsetTop+activeMark.offsetHeight>reader.scrollTop+reader.clientHeight))reader.scrollTop=Math.max(0,activeMark.offsetTop-24);
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
 try{const saved=await bookLibrary.save(book,{sectionIndex,charIndex},savedSettings());if(version===bookVersion){activeBookId=saved.id;loadMoments();$('libraryMessage').textContent='Book saved on this device.';scheduleSave()}await renderLibrary()}
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

function resetMoments(){closeHighlightEditor();deletedMoment=null;$('undoMoment').hidden=true;$('undoHighlight').hidden=true;bookMarks=[];selectionSnapshot=null;$('savedMoments').replaceChildren();$('markNote').value='';$('marksMessage').textContent='';refreshMomentControls()}
function refreshMomentControls(){const loaded=!!sections.length;for(const id of ['saveBookmark','saveClip','saveHighlight','clipSelection','highlightSelection'])$(id).disabled=!loaded;const chosen=selectionSnapshot?.version===bookVersion&&sections[selectionSnapshot.sectionIndex]?selectionSnapshot:null;$('markSelection').textContent=!loaded?'Open a book to save a moment.':chosen?'Selected: '+chosen.text.slice(0,240):'Using the passage near your current listening position.'}
async function loadMoments(){const id=activeBookId,version=bookVersion;if(!id)return;try{const marks=await bookLibrary.listMarks(id);if(id!==activeBookId||version!==bookVersion)return;bookMarks=marks;renderMoments();renderHighlightEditor();if(!selectedPassage($('reader'),window.getSelection()))readAlong.update({refresh:true});refreshMomentControls()}catch(error){$('marksMessage').textContent='Saved moments could not load: '+error.message}}
function renderMoments(){const list=$('savedMoments');list.replaceChildren();for(const mark of bookMarks){const item=document.createElement('li'),jump=document.createElement('button');jump.type='button';jump.className='moment-jump';jump.textContent=mark.kind[0].toUpperCase()+mark.kind.slice(1)+' · '+mark.chapter;jump.onclick=()=>jumpToSection(mark.sectionIndex,mark.start);const quote=document.createElement('blockquote');quote.textContent=mark.text;item.append(jump,quote);if(mark.note){const note=document.createElement('p');note.className='moment-note';note.textContent=mark.note;item.append(note)}const remove=document.createElement('button');remove.type='button';remove.className='remove-book';remove.textContent='Delete '+mark.kind;remove.setAttribute('aria-label','Delete '+mark.kind+' from '+mark.chapter);remove.onclick=()=>deleteMoment(mark);item.append(remove);list.append(item)}}
async function saveMoment(kind){
 if(!sections.length)return;
 const version=bookVersion,note=$('markNote').value;
 const selected=kind!=='bookmark'&&selectionSnapshot?.version===version?selectionSnapshot:null;
 const index=selected?selected.sectionIndex:sectionIndex,point=charIndex;
 const passage=kind!=='bookmark'&&selected?selected:momentPassage(sections[index].text,point);
 const mark={kind,sectionIndex:index,start:kind==='bookmark'?point:passage.start,end:Math.max(kind==='bookmark'?point:passage.start,passage.end),text:passage.text,note,chapter:chapterAt(index,kind==='bookmark'?point:passage.start)};
 $('marksMessage').textContent='Saving…';
 try{if(!activeBookId)await storeCurrentBook();if(version!==bookVersion)return;if(!activeBookId)throw Error('The book must be saved before adding a moment.');await bookLibrary.saveMark(activeBookId,mark);if(version!==bookVersion)return;if($('markNote').value===note)$('markNote').value='';selectionSnapshot=null;window.getSelection()?.removeAllRanges();await loadMoments();$('marksMessage').textContent=kind==='bookmark'?'Listening position bookmarked.':kind==='clip'?'Text clip saved.':'Passage highlighted and saved.'}
 catch(error){if(version===bookVersion)$('marksMessage').textContent='Could not save: '+error.message}
}
$('saveBookmark').onclick=()=>saveMoment('bookmark');$('saveClip').onclick=()=>saveMoment('clip');$('saveHighlight').onclick=()=>saveMoment('highlight');
document.addEventListener('selectionchange',()=>{if(!sections.length)return;const chosen=selectedPassage($('reader'),window.getSelection());if(!chosen)return;readAlong.browse();selectionSnapshot={...chosen,sectionIndex:readAlong.position.sectionIndex,version:bookVersion};refreshMomentControls()});

$('clipSelection').onclick=()=>saveMoment('clip');$('highlightSelection').onclick=()=>saveMoment('highlight');

function closeHighlightEditor(){highlightEditorIds=[];$('highlightEditor').hidden=true;$('highlightChoices').replaceChildren()}
function renderHighlightEditor(){const selected=bookMarks.filter(mark=>mark.kind==='highlight'&&highlightEditorIds.includes(mark.id));if(!selected.length){closeHighlightEditor();return}const list=$('highlightChoices');list.replaceChildren();for(const mark of selected){const item=document.createElement('article'),quote=document.createElement('blockquote'),remove=document.createElement('button');quote.textContent=mark.text;remove.type='button';remove.className='delete-highlight';remove.textContent='Delete highlight';remove.onclick=()=>deleteMoment(mark);item.append(quote,remove);list.append(item)}$('highlightEditor').hidden=false}
function openHighlightEditor(event){const target=event.target.closest?.('[data-highlight-ids]');if(!target)return;if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;if(event.type==='keydown')event.preventDefault();if(selectedPassage($('reader'),window.getSelection()))return;readAlong.browse();highlightEditorIds=JSON.parse(target.dataset.highlightIds);renderHighlightEditor();$('highlightEditor').scrollIntoView({behavior:'smooth',block:'nearest'})}
async function deleteMoment(mark){const version=bookVersion,id=activeBookId;try{await bookLibrary.removeMark(mark.id);if(version!==bookVersion||id!==activeBookId)return;deletedMoment={mark,bookId:id,version};selectionSnapshot=null;await loadMoments();if(version!==bookVersion)return;$('marksMessage').textContent=mark.kind[0].toUpperCase()+mark.kind.slice(1)+' deleted.';$('undoMoment').hidden=false;$('undoHighlight').hidden=false}catch(error){if(version===bookVersion)$('marksMessage').textContent='Could not delete: '+error.message}}
$('undoMoment').onclick=async()=>{const removed=deletedMoment;if(!removed||removed.version!==bookVersion||removed.bookId!==activeBookId)return;$('undoMoment').disabled=true;$('undoHighlight').disabled=true;try{await bookLibrary.saveMark(removed.bookId,removed.mark);if(removed.version!==bookVersion)return;deletedMoment=null;$('undoMoment').hidden=true;$('undoHighlight').hidden=true;await loadMoments();$('marksMessage').textContent='Saved moment restored.'}catch(error){if(removed.version===bookVersion)$('marksMessage').textContent='Could not restore: '+error.message}finally{$('undoMoment').disabled=false;$('undoHighlight').disabled=false}};
$('reader').addEventListener('click',openHighlightEditor);$('reader').addEventListener('keydown',openHighlightEditor);$('closeHighlightEditor').onclick=closeHighlightEditor;

$('undoHighlight').onclick=()=>$('undoMoment').onclick();
