import processorUrl from '@soundtouchjs/audio-worklet/processor?url';
const registered=new WeakMap();
export async function createPitchOutput(context){
 if(!context.audioWorklet)throw Error('Pitch-preserving audio needs a secure browser page. Open this app in Safari over HTTPS.');
 const {SoundTouchNode}=await import('@soundtouchjs/audio-worklet');
 if(!registered.has(context))registered.set(context,SoundTouchNode.register(context,processorUrl).catch(error=>{registered.delete(context);throw error}));
 await registered.get(context);
 const node=new SoundTouchNode({context,outputChannelCount:1});
 node.pitch.value=1;node.pitchSemitones.value=0;node.connect(context.destination);
 let lastRate=null;
 return {input:node,drainSeconds:0.3,setRateAtTime(rate,time){if(rate!==lastRate){node.playbackRate.setValueAtTime(rate,time);lastRate=rate}},onFailure(handler){node.onprocessorerror=()=>handler(Error('Audio playback stopped. Tap Play to try again.'))},dispose(){node.onprocessorerror=null;node.disconnect();node.port.close()}};
}
