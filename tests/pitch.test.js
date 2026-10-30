import test from 'node:test';
import assert from 'node:assert/strict';
import {BufferedNarrator} from '../src/buffered-narrator.js';
class Audio {
 constructor(){this.webkitPreservesPitch=false;this.currentTime=0}set src(value){this._src=value}get src(){return this._src}removeAttribute(){this._src=''}load(){}pause(){}async play(){}
}
function build(){const audio=new Audio(),blobs=[];const player=new BufferedNarrator({audioFactory:()=>audio,preloaderFactory:()=>new Audio(),prime:false,urls:{createObjectURL(blob){blobs.push(blob);return 'blob:'+blobs.length},revokeObjectURL(){}}});return {audio,player,blobs}}
const input={parts:[{text:'An unprocessed natural voice test.'}],sectionIndex:0,charIndex:0,voice:'easton',rate:2};
function source(samples){return {sampleRate:24000,stream(){return {cancel(){},async *[Symbol.asyncIterator](){yield samples}}}}}
test('native pitch preservation stays enabled during 2x playback and metadata loading',async()=>{const {player,audio}=build();try{player.start({...input,getEngine:async()=>source(new Float32Array(2400))});await player.task;assert.equal(audio.preservesPitch,true);assert.equal(audio.webkitPreservesPitch,true);assert.equal(audio.playbackRate,2);audio.playbackRate=1;audio.onloadedmetadata();assert.equal(audio.playbackRate,2);player.setRate(1.5);assert.equal(audio.playbackRate,1.5);assert.equal(audio.preservesPitch,true)}finally{player.stop()}});
test('original generated samples reach the native player without pitch processing',async()=>{const {player,blobs}=build();const samples=Float32Array.from([0,.1,-.1,.5,-.5,1,-1,0]);try{player.start({...input,getEngine:async()=>source(samples)});await player.task;const bytes=await blobs[0].arrayBuffer(),view=new DataView(bytes);assert.equal(bytes.byteLength,44+samples.length*2);for(let i=0;i<samples.length;i++){const expected=samples[i]*(samples[i]<0?32768:32767);assert.ok(Math.abs(view.getInt16(44+i*2,true)-expected)<1.01)}}finally{player.stop()}});
