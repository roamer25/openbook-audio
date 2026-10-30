import test from 'node:test';
import assert from 'node:assert/strict';
import {SoundTouch} from '@soundtouchjs/core';
import {BufferedNarrator} from '../src/buffered-narrator.js';
function frequency(stereo,sampleRate){const start=Math.floor(stereo.length/2*.25),end=Math.floor(stereo.length/2*.7);let crossings=0;for(let i=start+1;i<end;i++)if(stereo[(i-1)*2]<=0&&stereo[i*2]>0)crossings++;return crossings/((end-start)/sampleRate)}
for(const rate of [0.6,1,2,2.5])test(`pitch compensation preserves a 440 Hz voice fundamental at ${rate}x`,()=>{
 const sampleRate=24000,frames=Math.ceil(4*sampleRate/rate);const input=new Float32Array(frames*2);for(let i=0;i<frames;i++)input[i*2]=input[i*2+1]=0.5*Math.sin(2*Math.PI*440*rate*i/sampleRate);
 const pipe=new SoundTouch({sampleRate});pipe.pitch=1/rate;pipe.inputBuffer.putSamples(input);pipe.inputBuffer.putSamples(new Float32Array(24000));pipe.process();const output=new Float32Array(pipe.outputBuffer.frameCount*2);pipe.outputBuffer.extract(output,0,pipe.outputBuffer.frameCount);
 const fundamental=frequency(output,sampleRate);assert.ok(Math.abs(fundamental-440)<12,`${fundamental} Hz should stay near 440 Hz, not ${440*rate} Hz`);assert.ok(Math.abs(output.length/2/sampleRate-frames/sampleRate)<0.8,'tempo remains controlled by source rate');
});
test('scheduled source rate and pitch correction are kept in sync',async()=>{
 const corrections=[],sources=[];const context={currentTime:0,resume:async()=>{},suspend:async()=>{},createBuffer:(channels,length,rate)=>({duration:length/rate,copyToChannel(){}}),createBufferSource:()=>{const source={playbackRate:{value:1},connect(node){this.node=node},disconnect(){},stop(){},start(time){this.time=time}};sources.push(source);return source}};const destination={};
 const player=new BufferedNarrator({contextFactory:()=>context,outputFactory:async()=>({input:destination,setRateAtTime:(rate,time)=>corrections.push({rate,time}),dispose(){}})});
 try{player.start({parts:[{text:'This is narration.'}],sectionIndex:0,charIndex:0,rate:2,voice:'easton',getEngine:async()=>({sampleRate:100,stream(){return {cancel(){},async *[Symbol.asyncIterator](){yield new Float32Array(400)}}}})});await player.task;assert.equal(sources[0].node,destination);assert.equal(corrections[0].rate,sources[0].playbackRate.value);assert.equal(corrections[0].time,sources[0].time)}finally{player.stop()}
});
let Processor;
globalThis.sampleRate=24000;
globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage(){},onmessage:null}}};
globalThis.registerProcessor=(name,implementation)=>{Processor=implementation};
await import('@soundtouchjs/audio-worklet/processor');
test('the shipped AudioWorklet processor preserves pitch without steady-state dropouts at 2x',()=>{
 const processor=new Processor({processorOptions:{sampleBufferType:'circular'}}),sr=24000,blocks=700,signal=new Float32Array(blocks*128*2);
 let silent=0,checked=0;
 for(let block=0;block<blocks;block++){
  const input=new Float32Array(128),output=new Float32Array(128);
  for(let frame=0;frame<128;frame++)input[frame]=0.5*Math.sin(2*Math.PI*880*(block*128+frame)/sr);
  processor.process([[input]],[[output]],{pitch:new Float32Array([1]),pitchSemitones:new Float32Array([0]),playbackRate:new Float32Array([2])});
  let energy=0;for(let frame=0;frame<128;frame++){signal[(block*128+frame)*2]=signal[(block*128+frame)*2+1]=output[frame];energy+=output[frame]**2}
  if(block>100){checked++;if(energy<0.00001)silent++}
 }
 const pitch=frequency(signal,sr);assert.ok(Math.abs(pitch-440)<12,`worklet pitch ${pitch} Hz should remain near 440 Hz`);assert.ok(silent/checked<0.01,'no repeated silent audio blocks after the initial buffer');
});
