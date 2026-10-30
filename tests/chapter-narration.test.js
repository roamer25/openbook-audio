import test from 'node:test';
import assert from 'node:assert/strict';
import {chapterPassage,passagePosition} from '../src/chapter-narration.js';
import {BufferedNarrator,narrationChunk} from '../src/buffered-narrator.js';
const cue=(title,charIndex=0,depth=0)=>({title,charIndex,sectionIndex:0,depth});
test('speaks chapter number and separate subtitle once without altering stored text',()=>{
 const text='Chapter I\n\nThe Great Voyage\n\nThe traveller stepped aboard.';
 const part={text,headings:[{title:'Chapter I',start:0,end:9},{title:'The Great Voyage',start:11,end:27}]};
 const passage=chapterPassage(part,0,0,[cue('Chapter I')],narrationChunk);
 assert.equal(passage.text,'Chapter 1. The Great Voyage. The traveller stepped aboard.');
 assert.equal(passage.start,0);assert.equal(passage.end,text.length);assert.equal(part.text,text);
 assert.equal(passagePosition(passage,0.1),0);assert.equal(passagePosition(passage,1),text.length);
});
test('saved EPUBs announce existing chapter labels and preserve a mid-chapter resume',()=>{
 const text='Chapter 2: The Storm\n\nThe traveller watched the waves.';
 const entries=[cue('Chapter 2: The Storm')];
 assert.equal(chapterPassage({text},0,0,entries,narrationChunk).text,'Chapter 2: The Storm. The traveller watched the waves.');
 const start=text.indexOf('watched');const resumed=chapterPassage({text},0,start,entries,narrationChunk);assert.equal(resumed.text,text.slice(start));assert.equal(resumed.prefixLength,0);
});
test('announcements respect intra-file boundaries without numbering front matter or nested headings',()=>{
 const text='A foreword.\n\nThe Voyage\n\nHe sailed.\n\nThe Storm\n\nRain fell.';
 const first=text.indexOf('The Voyage'),second=text.indexOf('The Storm');
 const entries=[cue('Foreword'),cue('The Voyage',first),cue('The Storm',second)];
 const before=chapterPassage({text},0,0,entries,narrationChunk);assert.equal(before.end,first);assert.ok(!before.text.includes('The Voyage'));
 assert.equal(chapterPassage({text},0,first,entries,narrationChunk).text,'Chapter 1. The Voyage. He sailed.\n\n');
 assert.equal(chapterPassage({text},0,second,entries,narrationChunk).text,'Chapter 2. The Storm. Rain fell.');
 assert.ok(chapterPassage({text:'Details\n\nSome prose.'},0,0,[cue('Details',0,1)],narrationChunk).text.startsWith('Details. Some prose.'));
});
test('AI preloading announces a chapter reached naturally within the same spine file',async()=>{
 const calls=[],text='Opening words.\n\nThe Storm\n\nThe rain began.';
 const offset=text.indexOf('The Storm');const audio={pause(){},load(){},removeAttribute(){},play:async()=>{}};
 const player=new BufferedNarrator({prime:false,audioFactory:()=>({...audio}),preloaderFactory:()=>({...audio}),urls:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}}});
 try{player.start({parts:[{text}],contents:[cue('Chapter 1',0),cue('Chapter 2: The Storm',offset)],sectionIndex:0,charIndex:0,getEngine:async()=>({sampleRate:10,stream(value){calls.push(value);return {cancel(){},async *[Symbol.asyncIterator](){yield new Float32Array(10)}}}})});await player.task;assert.equal(calls.length,2);assert.ok(calls[0].startsWith('Chapter 1.'));assert.equal(calls[1],'Chapter 2: The Storm. The rain began.');assert.equal(player.queue[0].start,offset)}finally{player.stop()}
});
