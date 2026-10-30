import test from 'node:test';
import assert from 'node:assert/strict';
import {setupReadAlong} from '../src/read-along.js';
function fixture(){
 const reader=new EventTarget();reader.scrollTop=0;
 const button={setAttribute(name,value){this[name]=value}},message={};
 let position={sectionIndex:0,charIndex:10},renders=[];
 const controller=setupReadAlong({reader,button,message,getPosition:()=>position,render:(point,following)=>{renders.push({point,following});if(following)reader.scrollTop=point.charIndex}});
 controller.update();
 return {reader,button,message,controller,renders,move(value){position=value;controller.update()}};
}
test('manual browsing holds the viewport through audio updates and chapter transitions',()=>{
 const f=fixture();f.reader.dispatchEvent(new Event('wheel'));const count=f.renders.length;
 f.move({sectionIndex:0,charIndex:500});f.move({sectionIndex:1,charIndex:20});
 assert.equal(f.renders.length,count);assert.deepEqual(f.controller.position,{sectionIndex:0,charIndex:10});
 assert.equal(f.button.textContent,'Follow along');
 f.controller.follow();assert.deepEqual(f.controller.position,{sectionIndex:1,charIndex:20});assert.equal(f.reader.scrollTop,20);assert.equal(f.button['aria-pressed'],'true');
});
test('pointer, touch, keyboard and scrollbar interaction suspend following',()=>{
 for(const name of ['pointerdown','touchstart','keydown','scroll']){
  const f=fixture();if(name==='scroll')f.reader.scrollTop=200;
  const event=new Event(name);if(name==='keydown')event.key='PageDown';f.reader.dispatchEvent(event);
  assert.equal(f.controller.following,false,name);
 }
});
test('programmatic scroll does not disable following, and refresh retains the browsed section',()=>{
 const f=fixture();f.reader.dispatchEvent(new Event('scroll'));assert.equal(f.controller.following,true);
 f.controller.browse();f.move({sectionIndex:2,charIndex:50});f.controller.update({refresh:true});
 assert.deepEqual(f.renders.at(-1),{point:{sectionIndex:0,charIndex:10},following:false});
 f.controller.reset();assert.deepEqual(f.controller.position,{sectionIndex:2,charIndex:50});assert.equal(f.controller.following,true);
});
test('empty books disable follow and cannot enter browsing mode',()=>{
 const f=fixture();f.move(null);f.controller.browse();assert.equal(f.controller.following,true);assert.equal(f.controller.position,null);assert.equal(f.button.disabled,true);
});
