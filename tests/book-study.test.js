import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {analyzeBook,buildQuiz,studyRanges} from '../src/book-study.js';
import {BookLibrary} from '../src/book-library.js';
const first='Covenant means a binding agreement between parties with obligations and promises. John Owen taught that covenant expresses the relationship established by a solemn promise. Grace refers to favor freely given without any claim of merit by the recipient. John Owen wrote that grace is received as a gift rather than earned by human effort. Faith means trusting a promise and acting upon the assurance it provides. Nehemiah Coxe argued that faith receives the promise and rests upon the word of the giver. Hope means a confident expectation of the good that has been promised. Nehemiah Coxe taught that hope looks forward while faith trusts the promise already given.';
const second='Mystery means a hidden truth that becomes known through revelation and careful explanation. Thomas Jefferson wrote that knowledge should be pursued through patient inquiry. Thomas Jefferson argued that mystery requires investigation and thoughtful reflection. Wisdom refers to sound judgment formed through experience and instruction. Wisdom and mystery require careful reading to understand the discussion.';
const parts=[{title:'Promises',text:first},{title:'Later chapter',text:second}],contents=[{title:'Promises',sectionIndex:0,charIndex:0},{title:'Later chapter',sectionIndex:1,charIndex:0}];
test('chapter and read-so-far scopes respect exact intra-file boundaries without spoilers',()=>{
 const text=first+'\n\n'+second,offset=first.length+2;
 const p=[{title:'Book',text}],c=[{title:'First',sectionIndex:0,charIndex:0},{title:'Second',sectionIndex:0,charIndex:offset}];
 assert.deepEqual(studyRanges(p,c,'chapter',{sectionIndex:0,charIndex:5}),[{sectionIndex:0,start:0,end:offset}]);
 const study=analyzeBook({parts:p,contents:c,scope:'sofar',position:{sectionIndex:0,charIndex:100}});
 for(const item of [...study.terms,...study.people]){assert.ok(item.evidence.end<=100);assert.equal(text.slice(item.evidence.start,item.evidence.end),item.evidence.text)}
 const chapter=analyzeBook({parts,contents,scope:'chapter',position:{sectionIndex:0,charIndex:10}});
 assert.ok(!chapter.terms.some(t=>/mystery/i.test(t.label)));assert.ok(!chapter.people.some(t=>/Jefferson/i.test(t.label)));
 assert.equal(analyzeBook({parts,contents,scope:'sofar',position:{sectionIndex:0,charIndex:0}}).wordCount,0);
});
test('terms, people and definition questions are supported by exact source passages',()=>{
 const study=analyzeBook({parts,contents,scope:'book'});assert.ok(study.terms.some(t=>t.label==='Covenant'));assert.ok(study.people.some(p=>p.label==='John Owen'));assert.ok(study.people.some(p=>p.label==='Nehemiah Coxe'));
 const quiz=buildQuiz(study,{count:20,random:()=>0.4});assert.ok(quiz.length>=5);assert.ok(quiz.some(q=>q.prompt.includes('describe this way')));assert.ok(quiz.some(q=>q.kind==='person'));
 for(const q of quiz){assert.equal(parts[q.evidence.sectionIndex].text.slice(q.evidence.start,q.evidence.end),q.evidence.text);if(q.prompt.includes('describe this way'))assert.ok(q.evidence.text.includes(q.passage));assert.ok(q.evidence.text.toLowerCase().includes(q.options[q.answer].toLowerCase()));assert.equal(new Set(q.options).size,q.options.length);assert.ok(q.options.length>=2);assert.ok(!q.passage.toLowerCase().includes(q.options[q.answer].toLowerCase()))}
});
test('custom entries must occur in scope, hidden entries stay out of new quizzes, sparse text stays honest',()=>{
 const study=analyzeBook({parts,contents,scope:'chapter',position:{sectionIndex:0,charIndex:0},custom:[{kind:'term',label:'solemn promise'},{kind:'person',label:'Imaginary Person'},{kind:'term',label:'mystery'}]});
 assert.ok(study.terms.some(t=>t.label==='solemn promise'));assert.ok(![...study.people,...study.terms].some(t=>/Imaginary|mystery/.test(t.label)));
 const id=study.terms[0].id;assert.ok(buildQuiz(study,{count:20,hidden:[id]}).every(q=>q.id!==id));
 assert.deepEqual(buildQuiz(analyzeBook({parts:[{text:'A short note.'}],scope:'book'})),[]);
});
test('study migration preserves books, marks and playback, and study stays isolated by book',async()=>{
 const name='study-'+Date.now();await new Promise((resolve,reject)=>{const req=indexedDB.open(name,2);req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('books',{keyPath:'id'}).put({id:'old',name:'Existing book',parts});db.createObjectStore('shelf',{keyPath:'id'}).put({id:'old',position:{sectionIndex:1,charIndex:50},settings:{rate:2}});db.createObjectStore('marks',{keyPath:'id'}).createIndex('bookId','bookId');const tx=req.transaction;tx.objectStore('marks').put({id:'h',bookId:'old',kind:'highlight',sectionIndex:0,start:0,end:8,text:'Covenant'})};req.onsuccess=()=>{req.result.close();resolve()};req.onerror=()=>reject(req.error)});
 let library=new BookLibrary({indexedDB,name}),before=await library.get('old');const state={custom:[],hidden:[],study:analyzeBook({parts,contents,scope:'book'}),quiz:{answers:[1,null],index:1},history:[{score:3,total:5}]};await library.saveStudy('old',state);await library.close();library=new BookLibrary({indexedDB,name});assert.deepEqual(await library.getStudy('old'),state);assert.deepEqual(await library.get('old'),before);assert.equal((await library.listMarks('old')).length,1);assert.equal(await library.getStudy('other'),null);await assert.rejects(library.saveStudy('missing',state));await library.remove('old');assert.equal(await library.getStudy('old'),null);await library.close();
});

test('changing definitions retain matching evidence and short quizzes include people and terms',()=>{
 const extra='Grace refers to a generous welcome offered freely to an undeserving stranger. ';
 const study=analyzeBook({parts:[{text:first+' '+extra}],scope:'book'});
 const quiz=buildQuiz(study,{count:2,random:()=>0.1});assert.equal(quiz.length,2);assert.ok(quiz.some(q=>q.kind==='person'));assert.ok(quiz.some(q=>q.kind==='term'));
 for(const q of buildQuiz(study,{count:20})){if(q.prompt.includes('describe this way'))assert.ok(q.evidence.text.includes(q.passage))}
});
