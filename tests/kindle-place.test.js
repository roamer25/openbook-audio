import test from 'node:test';
import assert from 'node:assert/strict';
import {kindleSearchText,setupKindlePlace} from '../src/kindle-place.js';
test('Kindle search text follows the listening position rather than the chapter start',()=>{
 const text='An opening sentence is here before the next passage. The traveller opened his book beside the quiet harbour. He read until evening.';
 assert.equal(kindleSearchText(text,text.indexOf('quiet')+2),'The traveller opened his book beside the quiet harbour.');
 assert.equal(kindleSearchText('',0),'');
 const long='word '.repeat(100)+'distinctive destination '+'word '.repeat(100);
 const phrase=kindleSearchText(long,long.indexOf('destination')+4);assert.ok(phrase.includes('destination'));assert.ok(phrase.split(' ').length<=14);assert.ok(!phrase.startsWith('tination'));
});
test('PDF line wrapping and soft hyphens are cleaned without changing ordinary hyphenated words',()=>{
 const text='The extraor-\ndinary traveller crossed the quiet harbour with his well-known companion and re\u00adturned home.';
 const phrase=kindleSearchText(text,text.indexOf('harbour'));assert.ok(phrase.includes('extraordinary'));assert.ok(phrase.includes('well-known'));assert.ok(phrase.includes('returned'));assert.ok(!phrase.includes('\n'));
});
function node(){return {hidden:true,disabled:false,value:'',textContent:'',focus(){this.focused=true},select(){this.selected=true},setSelectionRange(){},scrollIntoView(){}}}
function setup(writeText){const elements=Object.fromEntries(['button','panel','field','message','location','copyButton','closeButton'].map(name=>[name,node()]));let place={book:'A book',chapter:'Chapter 2',text:'The traveller opened his book beside the quiet harbour.',offset:20},pauses=0,saves=0;const handoff=setupKindlePlace({...elements,getPlace:()=>place,pause:()=>pauses++,save:()=>saves++,clipboard:writeText?{writeText}:null});return {...elements,handoff,setPlace:value=>place=value,counts:()=>({pauses,saves})}}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('handoff pauses, saves, copies the passage and closes without resuming playback',async()=>{
 const copied=[];const ui=setup(async text=>copied.push(text));ui.button.onclick();await turn();assert.deepEqual(ui.counts(),{pauses:1,saves:1});assert.equal(ui.panel.hidden,false);assert.equal(copied[0],ui.field.value);assert.match(ui.location.textContent,/Chapter 2/);assert.match(ui.message.textContent,/Copied/);ui.closeButton.onclick();assert.equal(ui.panel.hidden,true);assert.equal(ui.field.value,'');assert.equal(ui.button.focused,true);
});
test('clipboard denial leaves selectable text and never claims a successful copy',async()=>{
 const ui=setup(async()=>{throw Error('Permission denied')});ui.button.onclick();await turn();assert.match(ui.message.textContent,/Automatic copy was unavailable/);assert.ok(ui.field.value.length>0);assert.equal(ui.field.selected,true);assert.equal(ui.panel.hidden,false);
 ui.setPlace(null);ui.handoff.refresh();assert.equal(ui.button.disabled,true);assert.equal(ui.panel.hidden,true);
});
test('late clipboard results cannot expose a passage from a previously closed book',async()=>{
 let complete;const ui=setup(()=>new Promise(resolve=>complete=resolve));ui.button.onclick();ui.handoff.reset();complete();await turn();assert.equal(ui.message.textContent,'');assert.equal(ui.field.value,'');assert.equal(ui.panel.hidden,true);
});
