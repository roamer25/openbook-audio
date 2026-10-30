// Expose a whole reading section to the OS, independently of the short audio
// files used to generate and preload narration.
export class SectionMediaSession {
  constructor({session=globalThis.navigator?.mediaSession,Metadata=globalThis.MediaMetadata,onPlay,onPause,onStop,onSeek}={}) {
    this.session=session;this.Metadata=Metadata;this.onSeek=onSeek;
    const handlers={play:onPlay,pause:onPause,stop:onStop,
      seekto:details=>this.seek(details.seekTime),
      seekbackward:details=>this.seek(this.snapshot?.elapsed-(details.seekOffset??10)),
      seekforward:details=>this.seek(this.snapshot?.elapsed+(details.seekOffset??10))};
    for(const [action,handler] of Object.entries(handlers)) {
      try{session?.setActionHandler(action,handler||null)}catch{/* Older browsers may support only some actions. */}
    }
  }
  seek(seconds){const state=this.snapshot;if(!state||!Number.isFinite(seconds))return;this.onSeek?.(Math.max(0,Math.min(state.duration,seconds)))}
  update({book,title,elapsed,duration,playing}) {
    if(!this.session)return;
    if(!Number.isFinite(duration)||duration<=0){this.clear();return}
    const position=Math.max(0,Math.min(duration,elapsed||0));
    this.snapshot={elapsed:position,duration};
    const key=JSON.stringify([book,title]);
    if(key!==this.metadataKey){
      this.metadataKey=key;
      try{if(this.Metadata)this.session.metadata=new this.Metadata({title,artist:book,album:'OpenBook Audio'})}catch{}
    }
    try{this.session.playbackState=playing?'playing':'paused'}catch{}
    // Times are already adjusted to the selected listening speed, matching the
    // in-app section timer. This virtual clock advances one second per second.
    try{this.session.setPositionState?.({duration,position,playbackRate:1})}catch{}
  }
  clear(){this.snapshot=null;this.metadataKey=null;if(!this.session)return;try{this.session.playbackState='none';this.session.metadata=null;this.session.setPositionState?.()}catch{}}
}
