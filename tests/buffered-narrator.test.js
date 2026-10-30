import test from 'node:test';
import assert from 'node:assert/strict';
import {BufferedNarrator,narrationChunk} from '../src/buffered-narrator.js';
export class FakeAudio {
 constructor(){this._src='';this.currentTime=0;this.webkitPreservesPitch=false;this.plays=[]}
 set src(value){this._src=value;this.currentTime=0}get src(){return this._src}
 removeAttribute(name){if(name==='src')this._src=''}load(){this.loads=(this.loads||0)+1}pause(){this.paused=true}
 async play(){if(this.rejectNext){this.rejectNext=false;const error=Error('Tap needed');error.name='NotAllowedError';throw error}this.plays.push(this.src);this.paused=false;this.onplaying?.()}
}
export function setup(overrides={}){const audio=new FakeAudio(),preloader=new FakeAudio(),blobs=new Map(),revoked=[];let next=0;const player=new BufferedNarrator({audioFactory:()=>audio,preloaderFactory:()=>preloader,prime:false,urls:{createObjectURL(blob){const id='blob:test-'+next++;blobs.set(id,blob);return id},revokeObjectURL(url){revoked.push(url)}},...overrides});return {player,audio,preloader,blobs,revoked}}
export const request={parts:[{text:'The first passage is complete.'},{text:'The second passage follows.'}],sectionIndex:0,charIndex:0,voice:'easton',rate:1};
export function engine(calls=[]){return {sampleRate:24000,stream(text,options){calls.push({text,options});return {cancel(){},async *[Symbol.asyncIterator](){yield new Float32Array(24000)}}}}}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('passage boundaries preserve text without cutting words',()=>{for(const text of ['A sentence. Another sentence. '+'extraordinary '.repeat(50),'x'.repeat(2000)+' end']){let offset=0,output='';while(offset<text.length){const part=narrationChunk(text,offset,155);assert.ok(part.length);output+=part;offset+=part.length;if(offset<text.length)assert.ok(/\s/.test(text[offset-1])||/\s/.test(text[offset]))}assert.equal(output,text)}});
test('upcoming passages are generated and preloaded before current audio ends',async()=>{
 const {player,audio,preloader}=setup();const calls=[];let finished=0;player.onEnded=()=>finished++;
 try{player.start({...request,getEngine:async()=>engine(calls)});await player.task;assert.equal(calls.length,2);assert.equal(player.queue.length,1);assert.equal(preloader.src,player.queue[0].url);const next=preloader.src;assert.equal(audio.plays.length,1);audio.onended();assert.equal(audio.src,next);assert.equal(audio.plays.length,2,'next passage starts synchronously, without waiting for generation');assert.equal(calls.length,2);audio.onended();assert.equal(finished,1)}finally{player.stop()}
});
test('pause during model loading retains audio and resumes without regeneration',async()=>{
 const {player,audio}=setup();let release;const calls=[];
 try{player.start({...request,getEngine:()=>new Promise(resolve=>release=resolve)});player.pause();release(engine(calls));await player.task;assert.equal(audio.plays.length,0);player.resume();assert.equal(audio.plays.length,1);assert.equal(calls.length,2)}finally{player.stop()}
});
test('cancellation prevents stale model work and releases all generated audio URLs',async()=>{
 const {player,audio,blobs,revoked}=setup();let release;player.start({...request,getEngine:()=>new Promise(resolve=>release=resolve)});player.stop();release(engine());await player.task;assert.equal(audio.plays.length,0);
 player.start({...request,getEngine:async()=>engine()});await player.task;assert.equal(blobs.size,2);player.stop();assert.equal(new Set(revoked).size,blobs.size);assert.equal(audio.src,'');
});
test('browser gesture rejection keeps prepared audio ready for a second tap',async()=>{
 const {player,audio}=setup();audio.rejectNext=true;let blocked=0;player.onBlocked=()=>blocked++;const calls=[];
 try{player.start({...request,getEngine:async()=>engine(calls)});await player.task;await turn();assert.equal(blocked,1);assert.equal(player.paused,true);assert.ok(player.current);await player.resume();assert.equal(audio.plays.length,1);assert.equal(calls.length,2)}finally{player.stop()}
});
test('progress follows the media position and supports chapter changes',async()=>{
 const positions=[];const {player,audio}=setup({onPosition:(...value)=>positions.push(value)});
 try{player.start({...request,getEngine:async()=>engine()});await player.task;audio.currentTime=.5;audio.ontimeupdate();assert.deepEqual(positions.at(-1),[0,Math.floor(request.parts[0].text.length/2)]);audio.onended();assert.deepEqual(positions.at(-1),[1,0])}finally{player.stop()}
});
test('resuming a saved position starts at the beginning of its word',async()=>{
 const calls=[];const {player}=setup();try{player.start({...request,charIndex:7,getEngine:async()=>engine(calls)});await player.task;assert.ok(calls[0].text.startsWith('first'))}finally{player.stop()}
});
