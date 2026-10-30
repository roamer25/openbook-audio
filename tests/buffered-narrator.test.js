import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferedNarrator, narrationChunk } from '../src/buffered-narrator.js';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
class Clock {
 constructor(){this.currentTime=0;this.state='suspended';this.scheduled=[];this.destination={};}
 async resume(){this.state='running'}
 async suspend(){this.state='suspended'}
 createBuffer(channels,length,rate){return {duration:length/rate,copyToChannel(){}}}
 createBufferSource(){const clock=this;return {playbackRate:{value:1},connect(){},disconnect(){},start(time){this.time=time;this.end=time+this.buffer.duration/this.playbackRate.value;clock.scheduled.push(this)},stop(){this.stopped=true}}}
 advance(time){this.currentTime=time;for(const source of this.scheduled)if(!source.ended&&source.end<=time){source.ended=true;source.onended?.()}}
}
const request={parts:[{text:'One complete sentence. Another complete sentence follows.'}],sectionIndex:0,charIndex:0,voice:'easton',rate:1};
function setup(overrides={}){const clock=new Clock();const statuses=[];const player=new BufferedNarrator({contextFactory:()=>clock,onStatus:s=>statuses.push(s),...overrides});return {clock,statuses,player}}
const engine={sampleRate:100,stream(){return {cancel(){},async *[Symbol.asyncIterator](){for(let i=0;i<20;i++)yield new Float32Array(100)}}}};
test('chunks preserve text and do not cut words at character limits',()=>{
 for(const text of ['Sentence one. Sentence two. '+'extraordinary '.repeat(40),'z'.repeat(2000)+' end','Words\nwith spaces—and punctuation. '.repeat(90)]){
  let offset=0,result='';while(offset<text.length){const piece=narrationChunk(text,offset,155);assert.ok(piece.length);result+=piece;offset+=piece.length;if(offset<text.length)assert.ok(/\s/.test(text[offset-1])||/\s/.test(text[offset]));}assert.equal(result,text);
 }
});
test('stream buffers ahead and audio frames use contiguous scheduled times',async()=>{
 const {clock,player}=setup();try{
  player.start({...request,getEngine:async()=>engine});await player.task;
  for(let time=0;time<22;time+=0.25){clock.advance(time);player.tick(player.epoch)}
  assert.equal(clock.scheduled.length,20);
  for(let i=1;i<clock.scheduled.length;i++)assert.ok(Math.abs(clock.scheduled[i].time-clock.scheduled[i-1].end)<1e-8,'no sentence or frame gap');
  assert.equal(player.active,false);
 }finally{player.stop()}
});
test('short readings flush when their duration is below prebuffer',async()=>{
 const {clock,player}=setup();try{player.start({...request,getEngine:async()=>({...engine,stream(){return {cancel(){},async *[Symbol.asyncIterator](){yield new Float32Array(100)}}}})});await player.task;assert.equal(clock.scheduled.length,1);}finally{player.stop()}
});
test('pause while model loads buffers safely and resume starts playback',async()=>{
 const {clock,player}=setup();let release;
 try{player.start({...request,getEngine:()=>new Promise(resolve=>release=resolve)});await turn();await player.pause();release(engine);await player.task;assert.equal(clock.scheduled.length,0);assert.equal(clock.state,'suspended');await player.resume();assert.ok(clock.scheduled.length);assert.equal(clock.state,'running');}finally{player.stop()}
});
test('stop cancels generation and prevents a stale model request from playing',async()=>{
 const {clock,player}=setup();let release;
 player.start({...request,getEngine:()=>new Promise(resolve=>release=resolve)});await turn();player.stop();release(engine);await player.task;assert.equal(clock.scheduled.length,0);assert.equal(player.active,false);
});
test('playback speed is applied to audio scheduling',async()=>{
 const {clock,player}=setup();try{player.start({...request,rate:2,getEngine:async()=>engine});await player.task;assert.equal(clock.scheduled[0].end-clock.scheduled[0].time,0.5);player.setRate(1.5);clock.advance(0.6);player.tick(player.epoch);assert.equal(clock.scheduled.at(-1).playbackRate.value,1.5);}finally{player.stop()}
});
test('separate passages and sections stay contiguous while producing ahead',async()=>{
 const {clock,player}=setup({maxAhead:100});let calls=0;
 try{player.start({...request,parts:[{text:'First section.'},{text:'Second section.'}],getEngine:async()=>({...engine,stream(){calls++;return engine.stream()}})});await player.task;
 for(let time=0;time<42;time+=0.25){clock.advance(time);player.tick(player.epoch)}
 assert.equal(calls,2);assert.equal(clock.scheduled.length,40);for(let i=1;i<clock.scheduled.length;i++)assert.ok(Math.abs(clock.scheduled[i].time-clock.scheduled[i-1].end)<1e-8);assert.equal(player.active,false);
 }finally{player.stop()}
});
