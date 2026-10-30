import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {BookLibrary,bookIdentity} from '../src/book-library.js';
import {ListeningProgress,clockTime} from '../src/listening-progress.js';
const book={name:'A Voyage',parts:[{title:'Part One',text:'one two three four five six'},{title:'Part Two',text:'seven eight nine ten'}],contents:[{title:'Opening',sectionIndex:0,charIndex:0},{title:'Middle',sectionIndex:0,charIndex:14},{title:'Ending',sectionIndex:1,charIndex:0}],contentsSource:'Book table of contents'};
test('library persists a complete book, position and settings across reopening',async()=>{
 const name='test-roundtrip-'+Date.now();let library=new BookLibrary({indexedDB,name});const entry=await library.save(book,{sectionIndex:0,charIndex:0},{rate:1});await library.update(entry.id,{sectionIndex:1,charIndex:6},{rate:2,voice:'ai:edwin',timing:{words:20,seconds:10}});await library.close();library=new BookLibrary({indexedDB,name});
 const saved=await library.get(entry.id);assert.deepEqual(saved.book.parts,book.parts);assert.deepEqual(saved.book.contents,book.contents);assert.deepEqual(saved.shelf.position,{sectionIndex:1,charIndex:6});assert.equal(saved.shelf.settings.rate,2);assert.equal(saved.shelf.settings.voice,'ai:edwin');assert.equal((await library.list()).length,1);await library.remove(entry.id);assert.equal(await library.get(entry.id),null);assert.equal((await library.list()).length,0);await library.close();
});
test('reimporting a book has a stable identity and does not duplicate library entries',async()=>{
 const library=new BookLibrary({indexedDB,name:'test-dedup-'+Date.now()});const first=await library.save(book,{sectionIndex:0,charIndex:0},{rate:1});const second=await library.save(book,{sectionIndex:0,charIndex:5},{rate:2});assert.equal(first.id,second.id);assert.equal(first.id,await bookIdentity(book));assert.equal((await library.list()).length,1);await library.close();
});
test('unavailable storage reports a failure rather than falsely claiming a save',async()=>{const library=new BookLibrary({indexedDB:null});await assert.rejects(library.save(book,{},{}),/unavailable/)});
test('chapter ranges respect subchapters within a single file',()=>{
 const timing=new ListeningProgress(book.parts,book.contents);const values=timing.at(0,14,1);assert.equal(values.chapter.title,'Middle');assert.equal(values.chapter.done,0);assert.equal(values.chapter.total,3);assert.equal(values.book.done,3);assert.equal(values.book.total,10);assert.equal(values.book.percent,30);
});
test('remaining times scale with speed while progress percentages remain stable',()=>{const timing=new ListeningProgress(book.parts,book.contents);const normal=timing.at(1,0,1),double=timing.at(1,0,2);assert.equal(double.book.remaining,normal.book.remaining/2);assert.equal(double.chapter.duration,normal.chapter.duration/2);assert.equal(double.book.percent,normal.book.percent);assert.equal(timing.at(1,book.parts[1].text.length,2).book.remaining,0)});
test('time estimates calibrate from generated audio and can be restored',()=>{const timing=new ListeningProgress(book.parts,book.contents);timing.observe(0,0,book.parts[0].text.length,3);timing.observe(0,0,book.parts[0].text.length,3);assert.equal(timing.at(0,0,2).book.duration,2.5);const copy=new ListeningProgress(book.parts,book.contents);copy.restore({words:20,seconds:10});assert.equal(copy.at(0,0,2).book.duration,2.5);assert.equal(clockTime(3723),'1:02:03')});
