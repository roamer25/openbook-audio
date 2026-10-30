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

export class BufferedNarrator {
  constructor({ contextFactory, outputFactory, onPosition, onStatus, onEnded, onError, onPassage, prebuffer = 6, maxAhead = 30 } = {}) {
    Object.assign(this, { contextFactory: contextFactory || (() => new (window.AudioContext || window.webkitAudioContext)()), outputFactory:outputFactory|| (async context=>({input:context.destination,setRateAtTime(){},dispose(){},drainSeconds:0})), onPosition, onStatus, onEnded, onError, onPassage, prebuffer, maxAhead });
    this.epoch = 0; this.active = false; this.context = null;
  }
  start({ getEngine, parts, sectionIndex, charIndex, voice, rate = 1 }) {
    this.stop();
    const epoch = this.epoch;
    this.active = true; this.paused = false; this.queue = []; this.sources = new Set(); this.timeline = [];
    this.pendingSeconds = 0; this.started = false; this.inputDone = false; this.rate = rate; this.lastPosition = ''; this.lastPositionUpdate = -Infinity; this.lastSection = -1;
    this.controller = new AbortController();
    // Resume inside the Play tap, before waiting for a model or voice download (iOS).
    try {
      this.context ||= this.contextFactory();
      this.tail = this.context.currentTime;
      this.contextReady = Promise.resolve(this.context.resume());
    } catch (error) { this.fail(error, epoch); return; }
    this.timer = setInterval(() => this.tick(epoch), 50);
    this.task = this.produce({ getEngine, parts, sectionIndex, charIndex, voice, epoch }).catch(error => this.fail(error, epoch));
  }
  async produce({ getEngine, parts, sectionIndex, charIndex, voice, epoch }) {
    await this.contextReady;
    const outputReady=this.outputFactory(this.context).then(output=>{if(this.isCurrent(epoch))this.output=output;else output.dispose();return output});
    const [engine,output] = await Promise.all([getEngine(),outputReady]);
    if (!this.isCurrent(epoch)) {output.dispose();return;}
    this.output=output;output.onFailure?.(error=>this.fail(error,epoch));
    this.sampleRate = engine.sampleRate;
    this.onStatus?.('Buffering narration…');
    for (let section = sectionIndex; section < parts.length; section++) {
      const text = parts[section].text;
      for (let start = section === sectionIndex ? charIndex : 0; start < text.length;) {
        if (!this.isCurrent(epoch)) return;
        // Bound each model request and keep synthesizing ahead of what is audible.
        const passage = narrationChunk(text, start);
        const record = { section, start, end: start + passage.length, totalSamples: 0, complete: false };
        const stream = engine.stream(passage, { voice, signal: this.controller.signal });
        this.stream = stream;
        for await (const pcm of stream) {
          while (this.isCurrent(epoch) && this.pendingSeconds >= this.maxAhead)
            await new Promise(resolve => setTimeout(resolve, 40));
          if (!this.isCurrent(epoch)) return;
          if (!pcm.length) continue;
          this.queue.push({ pcm, record, sampleOffset: record.totalSamples });
          record.totalSamples += pcm.length;
          this.pendingSeconds += pcm.length / this.sampleRate;
          this.pump();
        }
        if (!this.isCurrent(epoch)) return;
        record.complete = true;
        this.onPassage?.({section,start:record.start,end:record.end,seconds:record.totalSamples/this.sampleRate});
        if (!record.totalSamples) throw Error('The narrator returned no audio.');
        start = record.end;
      }
    }
    if (!this.isCurrent(epoch)) return;
    this.inputDone = true;
    this.pump(); this.tick(epoch);
  }
  isCurrent(epoch) { return this.active && this.epoch === epoch; }
  pump() {
    if (!this.active || this.paused) return;
    const now = this.context.currentTime;
    if (this.started && this.tail < now) { this.started = false; this.onStatus?.('Buffering narration…'); }
    if (!this.started) {
      if (!this.queue.length || (!this.inputDone && this.pendingSeconds < this.prebuffer)) return;
      this.started = true; this.tail = now + 0.05;
      this.onStatus?.('Narrating…');
    }
    // Schedule on the audio clock. A new sentence never waits for an HTML audio
    // ended event or for another WAV to be generated and loaded.
    while (this.queue.length && this.tail < now + 1) {
      const item = this.queue.shift();
      this.pendingSeconds -= item.pcm.length / this.sampleRate;
      const buffer = this.context.createBuffer(1, item.pcm.length, this.sampleRate);
      buffer.copyToChannel(item.pcm, 0);
      const source = this.context.createBufferSource();
      source.buffer = buffer; source.playbackRate.value = this.rate; source.connect(this.output.input);
      const time = Math.max(this.tail, now + 0.01);
      this.output.setRateAtTime(this.rate,time);
      const duration = buffer.duration / this.rate;
      this.timeline.push({ time, end: time + duration, ...item });
      this.tail = time + duration;
      this.sources.add(source);
      source.onended = () => { this.sources.delete(source); source.disconnect(); };
      source.start(time);
    }
  }
  tick(epoch) {
    if (!this.isCurrent(epoch) || this.paused) return;
    const now = this.context.currentTime;
    const current = this.timeline.find(item => now >= item.time && now < item.end);
    if (current) {
      const { record } = current;
      const fraction = Math.min(1, Math.max(0, (now - current.time) / (current.end - current.time)));
      const samples = current.sampleOffset + fraction * current.pcm.length;
      // Text progress is estimated from audio duration; the engine supplies no word timestamps.
      const offset = record.complete ? record.start + Math.floor((record.end - record.start) * samples / record.totalSamples) : record.start;
      const position = `${record.section}:${offset}`;
      if (position !== this.lastPosition && (now-this.lastPositionUpdate>=0.25||record.section!==this.lastSection)) { this.lastPosition = position; this.lastPositionUpdate=now; this.lastSection=record.section; this.onPosition?.(record.section, offset); }
    }
    this.timeline = this.timeline.filter(item => item.end > now);
    if (this.started && now >= this.tail && !this.queue.length && !this.inputDone) {
      this.started = false; this.onStatus?.('Buffering narration…');
    }
    this.pump();
    if (this.inputDone && !this.queue.length && !this.sources.size && now >= this.tail+(this.output?.drainSeconds||0)) {
      this.stop(); this.onEnded?.();
    }
  }
  pause() { const epoch = this.epoch; this.paused = true; return this.context?.suspend().catch(error => this.fail(error, epoch)); }
  resume() {
    const epoch = this.epoch; this.paused = false;
    return this.context?.resume().then(() => { if (this.isCurrent(epoch)) this.pump(); }).catch(error => this.fail(error, epoch));
  }
  setRate(rate) { this.rate = rate; } // Takes effect on newly scheduled frames, within one second.
  stop() {
    this.epoch++; this.active = false;
    clearInterval(this.timer); this.controller?.abort(); this.stream?.cancel(); this.stream = null;
    for (const source of this.sources || []) { source.onended = null; try { source.stop(); source.disconnect(); } catch {} }
    this.output?.dispose();this.output=null;
    this.sources?.clear(); this.queue = []; this.timeline = []; this.pendingSeconds = 0;
    this.context?.suspend().catch(() => {});
  }
  fail(error, epoch) { if (!this.isCurrent(epoch)) return; this.stop(); this.onError?.(error); }
}
