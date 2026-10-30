import { encodeWav } from 'phonon-tts';
// Preserve every character and never split a word, including unusually long words.
export function narrationChunk(text, start, limit = 600) {
  if (start >= text.length) return '';
  const target = Math.min(start + limit, text.length);
  if (target === text.length) return text.slice(start);
  const window = text.slice(start, target);
  const sentences = [...window.matchAll(/[.!?]["'”’)]*\s+/g)];
  const sentence = sentences.at(-1);
  if (sentence && sentence.index > limit / 2) return text.slice(start, start + sentence.index + sentence[0].length);
  let end = target;
  while (end > start && !/\s/.test(text[end - 1])) end--;
  if (end === start) { end = target; while (end < text.length && !/\s/.test(text[end])) end++; }
  return text.slice(start, end);
}

// Use the browser's native, pitch-preserving media path. The generated PCM is
// encoded unchanged; no third-party pitch processor touches the narrator's voice.
export class BufferedNarrator {
  constructor({audioFactory,preloaderFactory,urls,onPosition,onStatus,onEnded,onError,onBlocked,onPassage,onPlaybackState,maxAhead=90,prime=true}={}) {
    Object.assign(this,{audioFactory:audioFactory||(()=>new Audio()),preloaderFactory:preloaderFactory||(()=>new Audio()),urls:urls||URL,onPosition,onStatus,onEnded,onError,onBlocked,onPassage,onPlaybackState,maxAhead,prime});
    this.active=false;this.epoch=0;this.ownedUrls=new Set();
  }
  start({getEngine,parts,sectionIndex,charIndex,voice,rate=1}) {
    this.stop();const epoch=this.epoch;this.active=true;this.paused=false;this.rate=rate;this.queue=[];this.current=null;this.inputDone=false;this.controller=new AbortController();
    try {
      this.audio ||= this.audioFactory();this.preloader ||= this.preloaderFactory();
      this.audio.preload='auto';this.preloader.preload='auto';this.audio.playsInline=true;this.applyRate();
      // Prime this same element in the Play gesture so Safari can keep using it
      // when asynchronously generated audio becomes available.
      if(this.prime)this.unlock(epoch);
      this.onStatus?.('Preparing narration…');
      this.task=this.produce({getEngine,parts,sectionIndex,charIndex,voice,epoch}).catch(error=>this.fail(error,epoch));
    } catch(error){this.fail(error,epoch)}
  }
  reportPlayback(state){this.playbackState=state;this.onPlaybackState?.(state)}
  isCurrent(epoch){return this.active&&this.epoch===epoch}
  own(blob){const url=this.urls.createObjectURL(blob);this.ownedUrls.add(url);return url}
  release(url){if(this.ownedUrls.delete(url))this.urls.revokeObjectURL(url)}
  unlock(epoch){
    const url=this.own(encodeWav(new Float32Array(2400),24000));this.audio.muted=true;this.audio.src=url;
    Promise.resolve(this.audio.play()).catch(()=>{}).finally(()=>{
      if(this.isCurrent(epoch)&&this.audio.src===url){this.audio.pause();this.audio.muted=false;this.audio.removeAttribute('src');this.audio.load()}
      this.release(url);
    });
  }
  async produce({getEngine,parts,sectionIndex,charIndex,voice,epoch}){
    const engine=await getEngine();if(!this.isCurrent(epoch))return;
    for(let section=sectionIndex;section<parts.length;section++){
      const text=parts[section].text;
      let first=section===sectionIndex?charIndex:0;while(first>0&&/\S/.test(text[first]||'')&&/\S/.test(text[first-1]))first--;
      for(let start=first;start<text.length;){
        while(this.isCurrent(epoch)&&this.aheadSeconds()>=this.maxAhead)await new Promise(resolve=>setTimeout(resolve,40));
        if(!this.isCurrent(epoch))return;
        const passage=narrationChunk(text,start);const frames=[];let sampleCount=0;
        const stream=engine.stream(passage,{voice,signal:this.controller.signal});this.stream=stream;
        for await(const pcm of stream){if(!this.isCurrent(epoch))return;if(pcm.length){frames.push(pcm);sampleCount+=pcm.length}}
        if(!this.isCurrent(epoch))return;if(!sampleCount)throw Error('The narrator returned no audio.');
        const samples=new Float32Array(sampleCount);let offset=0;for(const pcm of frames){samples.set(pcm,offset);offset+=pcm.length}
        const seconds=sampleCount/engine.sampleRate;
        const item={section,start,end:start+passage.length,seconds,url:this.own(encodeWav(samples,engine.sampleRate))};
        this.onPassage?.({section,start,end:item.end,seconds});this.queue.push(item);start=item.end;this.pump(epoch);
      }
    }
    if(!this.isCurrent(epoch))return;this.inputDone=true;this.pump(epoch);
  }
  aheadSeconds(){return this.queue.reduce((sum,item)=>sum+item.seconds,0)+(this.current?Math.max(0,this.current.seconds-(this.audio.currentTime||0)):0)}
  applyRate(){if(!this.audio)return;this.audio.preservesPitch=true;if('webkitPreservesPitch' in this.audio)this.audio.webkitPreservesPitch=true;this.audio.defaultPlaybackRate=this.rate||1;this.audio.playbackRate=this.rate||1}
  pump(epoch){
    if(!this.isCurrent(epoch)||this.paused)return;
    if(this.current){this.preloadNext();return}
    const item=this.queue.shift();
    if(!item){if(this.inputDone){this.stop();this.onEnded?.()}else {this.reportPlayback('paused');this.onStatus?.('Buffering narration…')}return}
    this.current=item;this.audio.muted=false;this.audio.src=item.url;this.applyRate();
    this.audio.onloadedmetadata=()=>{if(this.isCurrent(epoch)&&this.current===item){this.applyRate();this.reportPlayback(this.playbackState||'paused')}};
    this.audio.ontimeupdate=()=>{if(!this.isCurrent(epoch)||this.paused||this.current!==item)return;const fraction=Math.max(0,Math.min(1,(this.audio.currentTime||0)/item.seconds));this.onPosition?.(item.section,item.start+Math.floor((item.end-item.start)*fraction))};
    this.audio.onended=()=>{if(!this.isCurrent(epoch)||this.current!==item)return;this.reportPlayback('paused');this.onPosition?.(item.section,item.end);this.current=null;this.release(item.url);this.pump(epoch)};
    this.audio.onerror=()=>this.fail(Error('Audio could not play. Tap Play to try again.'),epoch);
    this.audio.onplaying=()=>{if(this.isCurrent(epoch)&&!this.paused){this.reportPlayback('playing');this.onStatus?.('Narrating…')}};
    this.audio.onwaiting=()=>{if(this.isCurrent(epoch))this.reportPlayback('paused')};
    this.onPosition?.(item.section,item.start);this.preloadNext();this.playMedia(epoch);
  }
  preloadNext(){const next=this.queue[0];if(next&&this.preloader.src!==next.url){this.preloader.src=next.url;this.preloader.load()}}
  playMedia(epoch){
    return Promise.resolve(this.audio.play()).catch(error=>{
      if(!this.isCurrent(epoch))return;
      if(error.name==='NotAllowedError'){this.paused=true;this.reportPlayback('paused');this.onBlocked?.();this.onStatus?.('Audio is ready. Tap Play to start.');return}
      this.fail(error,epoch);
    });
  }
  pause(){this.paused=true;this.audio?.pause();this.reportPlayback('paused')}
  resume(){const epoch=this.epoch;this.paused=false;if(this.current){this.applyRate();return this.playMedia(epoch)}this.pump(epoch)}
  setRate(rate){this.rate=rate;this.applyRate()}
  stop(){
    this.epoch++;this.active=false;this.controller?.abort();this.stream?.cancel();this.stream=null;
    if(this.audio){this.audio.onended=null;this.audio.ontimeupdate=null;this.audio.onloadedmetadata=null;this.audio.onerror=null;this.audio.onplaying=null;this.audio.onwaiting=null;this.audio.pause();this.audio.removeAttribute('src');this.audio.load();this.audio.muted=false}
    if(this.preloader){this.preloader.pause();this.preloader.removeAttribute('src');this.preloader.load()}
    for(const url of [...this.ownedUrls])this.release(url);this.queue=[];this.current=null;this.reportPlayback('paused');
  }
  fail(error,epoch){if(!this.isCurrent(epoch))return;this.stop();this.onError?.(error)}
}
