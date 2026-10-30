import test from 'node:test';
import assert from 'node:assert/strict';
import {SectionMediaSession} from '../src/section-media-session.js';
import {ListeningProgress} from '../src/listening-progress.js';
import {BufferedNarrator} from '../src/buffered-narrator.js';

function setup(){const actions={},positions=[];const session={setActionHandler:(name,handler)=>actions[name]=handler,setPositionState:state=>positions.push(state)};const sought=[];let plays=0,pauses=0;const media=new SectionMediaSession({session,Metadata:class{constructor(value){Object.assign(this,value)}},onPlay:()=>plays++,onPause:()=>pauses++,onSeek:time=>sought.push(time)});return {media,session,actions,positions,sought,counts:()=>({plays,pauses})}}
test('lock screen retains the whole section across successive audio clips',async()=>{
 const {media,positions,session,actions,sought,counts}=setup();
 const text='word '.repeat(500),parts=[{title:'Chapter one',text}],contents=[{title:'Chapter one',sectionIndex:0,charIndex:0}];const timing=new ListeningProgress(parts,contents);
 const audio={currentTime:0,pause(){},load(){},removeAttribute(){},async play(){this.onplaying?.()}};
 let section=0,offset=0;const update=()=>{const chapter=timing.at(section,offset,2).chapter;media.update({book:'A book',title:chapter.title,...chapter,playing:true})};
 const player=new BufferedNarrator({audioFactory:()=>audio,preloaderFactory:()=>({...audio}),prime:false,maxAhead:1000,urls:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},onPosition:(i,n)=>{section=i;offset=n;update()}});
 try{player.start({parts,sectionIndex:0,charIndex:0,rate:2,voice:'test',getEngine:async()=>({sampleRate:10,stream(){return {cancel(){},async *[Symbol.asyncIterator](){yield new Float32Array(300)}}}})});await player.task;
  const first=positions.at(-1);assert.ok(first.duration>30,'duration covers section, not 30-second clip');
  audio.currentTime=15;audio.ontimeupdate();const middle=positions.at(-1).position;assert.ok(middle>0);
  audio.onended();assert.equal(positions.at(-1).duration,first.duration);assert.ok(positions.at(-1).position>middle,'clock continues into next clip');
  assert.equal(session.metadata.title,'Chapter one');assert.equal(session.metadata.artist,'A book');
  actions.play();actions.pause();assert.deepEqual(counts(),{plays:1,pauses:1});
  actions.seekto({seekTime:60});assert.equal(sought.at(-1),60);
  actions.seekforward({seekOffset:9999});assert.equal(sought.at(-1),first.duration);
 }finally{player.stop()}
});
test('section seeking accounts for intra-file TOC boundaries and listening speed',()=>{
 const text='word '.repeat(200);const parts=[{text}],contents=[{title:'A',sectionIndex:0,charIndex:0},{title:'B',sectionIndex:0,charIndex:500}];const timing=new ListeningProgress(parts,contents);
 const at=timing.at(0,600,2);assert.equal(at.chapter.title,'B');
 const target=timing.seekChapter(0,600,at.chapter.duration/2,2);assert.deepEqual(target,{sectionIndex:0,charIndex:750});
 assert.equal(timing.at(target.sectionIndex,target.charIndex,2).chapter.percent,50);
 assert.equal(timing.seekChapter(0,600,-10,2).charIndex,500);
 assert.equal(timing.seekChapter(0,600,9999,2).charIndex,text.length);
 const across=new ListeningProgress([{text:'one two '},{text:'three four five six'}],[{title:'Combined',sectionIndex:0,charIndex:0}]);
 assert.deepEqual(across.seekChapter(0,0,across.at(0,0).chapter.duration/2),{sectionIndex:1,charIndex:6});
});
test('clock matches speed-adjusted section times and stops while paused or buffering',()=>{
 const {media,session,positions}=setup();media.update({book:'Book',title:'Section',elapsed:60,duration:300,playing:true});assert.deepEqual(positions.at(-1),{duration:300,position:60,playbackRate:1});
 media.update({book:'Book',title:'Section',elapsed:30,duration:150,playing:false});assert.equal(session.playbackState,'paused');assert.equal(positions.at(-1).position,30);
 media.update({book:'Book',title:'Next section',elapsed:0,duration:100,playing:true});assert.equal(session.metadata.title,'Next section');assert.equal(positions.at(-1).position,0);
 media.clear();assert.equal(session.metadata,null);assert.equal(session.playbackState,'none');assert.equal(positions.at(-1),undefined);
});
test('unsupported Media Session actions cannot interrupt narration',()=>{
 const media=new SectionMediaSession({session:{setActionHandler(){throw Error('Unsupported')},setPositionState(){throw Error('Unsupported')}},Metadata:null});assert.doesNotThrow(()=>{media.update({elapsed:0,duration:30});media.clear()});
});
