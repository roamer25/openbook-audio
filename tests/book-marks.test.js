import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {BookLibrary} from '../src/book-library.js';
import {momentPassage,markedSegments} from '../src/book-marks.js';
test('moments survive reopening and reimporting and are isolated by book',async()=>{
 const name='marks-'+Date.now();let library=new BookLibrary({indexedDB,name});const book={name:'A Book',parts:[{title:'Chapter 1',text:'The traveller opened the book beside the harbour.'}]};const shelf=await library.save(book,{sectionIndex:0,charIndex:10},{rate:2});const second=await library.save({...book,name:'Another Book'},{},{});
 const mark=await library.saveMark(shelf.id,{kind:'highlight',sectionIndex:0,start:4,end:13,text:'traveller',chapter:'Chapter 1',note:'Remember this'});await library.close();library=new BookLibrary({indexedDB,name});assert.equal((await library.listMarks(shelf.id))[0].note,'Remember this');assert.equal((await library.listMarks(second.id)).length,0);await library.save(book,{sectionIndex:0,charIndex:10},{rate:2});assert.equal((await library.listMarks(shelf.id)).length,1);await library.removeMark(mark.id);assert.equal((await library.listMarks(shelf.id)).length,0);await library.saveMark(shelf.id,{kind:'clip',sectionIndex:0,start:0,end:3,text:'The',chapter:'Chapter 1'});await library.remove(shelf.id);assert.equal((await library.listMarks(shelf.id)).length,0);assert.ok(await library.get(second.id));await library.close();
});
test('upgrading the existing library retains books, saved position and speed',async()=>{
 const name='marks-upgrade-'+Date.now();await new Promise((resolve,reject)=>{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('books',{keyPath:'id'}).put({id:'old',name:'Existing book',parts:[{text:'original text'}]});db.createObjectStore('shelf',{keyPath:'id'}).put({id:'old',position:{sectionIndex:0,charIndex:5},settings:{rate:2}})};request.onsuccess=()=>{request.result.close();resolve()};request.onerror=()=>reject(request.error)});
 const library=new BookLibrary({indexedDB,name});const before=await library.get('old');assert.equal(before.book.name,'Existing book');assert.equal(before.shelf.position.charIndex,5);assert.equal(before.shelf.settings.rate,2);await library.saveMark('old',{kind:'bookmark',sectionIndex:0,start:5,end:6,text:'original text',chapter:'Chapter 1'});assert.equal((await library.listMarks('old')).length,1);assert.deepEqual(await library.get('old'),before);await library.close();
});
test('overlapping highlights and the moving read-along preserve every character',()=>{
 const text='The traveller opened his book.';const result=markedSegments(text,[{kind:'highlight',start:4,end:13},{kind:'highlight',start:10,end:20}],8,16);assert.equal(result.map(part=>part.text).join(''),text);assert.ok(result.some(part=>part.current&&part.highlighted));assert.equal(result.filter(part=>part.highlighted).map(part=>part.text).join(''),text.slice(4,20));
 const passage=momentPassage(text,9);assert.equal(passage.start,4);assert.ok(passage.text.startsWith('traveller'));assert.equal(text.slice(passage.start,passage.end),passage.text);assert.ok(momentPassage(text,text.length).text.length>0);
});
