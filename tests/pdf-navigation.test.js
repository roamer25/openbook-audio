import test from 'node:test';
import assert from 'node:assert/strict';
import {importPdf,pdfTextPage} from '../src/pdf-navigation.js';
import {ListeningProgress} from '../src/listening-progress.js';
import {chapterPassage} from '../src/chapter-narration.js';
import {narrationChunk} from '../src/buffered-narrator.js';

const item=(str,y=700,size=12,x=50)=>({str,transform:[size,0,0,size,x,y],width:str.length*size*.5,hasEOL:true});
const page=(...lines)=>lines.map((line,index)=>typeof line==='string'?item(line,720-index*25):item(...line));
const file={name:'Book.pdf',arrayBuffer:async()=>new ArrayBuffer(1)};
function library(pages,{outline=null,destinations={},labels=null,annotations={}}={}){
 let destroyed=0;const doc={numPages:pages.length,getPage:async number=>({view:[0,0,612,792],getTextContent:async()=>({items:pages[number-1]}),getAnnotations:async()=>annotations[number-1]||[],cleanup(){}}),getOutline:async()=>outline,getDestination:async name=>destinations[name]||null,getPageIndex:async ref=>ref.num-1,getPageLabels:async()=>labels,destroy:async()=>destroyed++};
 return {pdfjs:{GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve(doc)})},destroyed:()=>destroyed};
}
test('PDF bookmarks split at exact intra-page headings and join chapter continuation pages',async()=>{
 const pages=[page('Title page'),page(['Chapter 1',700,20],['The Voyage',670,18],['First chapter starts.',640],['First chapter continues.',600]),page('More of the first chapter.',['Chapter 2',400,20],['The Storm',370,18],['Second chapter starts.',340]),page('Second chapter continuation.')];
 const fake=library(pages,{outline:[{title:'Chapter 1: The Voyage',dest:'one',items:[{title:'Chapter 2: The Storm',dest:[{num:3,gen:0},{name:'XYZ'},0,420,null]}]},{title:'Broken',dest:'missing'}],destinations:{one:[{num:2,gen:0},{name:'FitH'},720]}});
 const book=await importPdf(file,fake);assert.equal(book.contentsSource,'PDF bookmarks');assert.deepEqual(book.parts.map(part=>part.title),['Front matter','Chapter 1: The Voyage','Chapter 2: The Storm']);assert.ok(book.parts[1].text.includes('More of the first chapter.'));assert.ok(!book.parts[1].text.includes('Chapter 2'));assert.ok(book.parts[2].text.endsWith('Second chapter continuation.'));assert.equal(book.contents[2].depth,1);assert.equal(fake.destroyed(),1);
 const timing=new ListeningProgress(book.parts,book.contents);assert.ok(timing.at(1,0).chapter.total>0);assert.equal(timing.at(2,0).chapter.title,'Chapter 2: The Storm');
 assert.ok(chapterPassage(book.parts[1],1,0,book.contents,narrationChunk).text.startsWith('Chapter 1: The Voyage. First chapter starts.'));
});
test('printed contents match real titles despite physical/printed page-number offsets',async()=>{
 const pages=[page('Title page'),page('Contents','The Voyage ........ 1','The Storm ........ 3'),page(['The Voyage',720,20],'First chapter prose.'),page('First chapter continued.'),page(['The Storm',720,20],'Second chapter prose.')];
 const book=await importPdf(file,library(pages));assert.equal(book.contentsSource,'Printed PDF table of contents');assert.deepEqual(book.parts.map(part=>part.title),['Front matter','The Voyage','The Storm']);assert.ok(book.parts[1].text.includes('First chapter continued.'));assert.ok(!book.parts[1].text.includes('The Storm'));assert.ok(book.parts[2].text.includes('Second chapter prose.'));
});
test('printed contents use calibrated page offsets for titles not found in extracted headings',async()=>{
 const pages=[page('Cover'),page('Contents','A Beginning .... 1','An Interlude .... 2','An Ending .... 3'),page(['A Beginning',720,20],'Beginning body.'),page('Typeset differently from the contents.','Interlude body.'),page(['An Ending',720,20],'Ending body.')];
 const book=await importPdf(file,library(pages));assert.deepEqual(book.parts.map(part=>part.title),['Front matter','A Beginning','An Interlude','An Ending']);assert.ok(book.parts[2].text.includes('Interlude body.'));
});
test('clickable contents destinations provide mid-page sections without bookmarks',async()=>{
 const pages=[page('Contents','First section ........ 1','Second section ........ 1'),page(['First section',700,20],['First body.',670],['Second section',400,20],['Second body.',370])];
 const annotations={0:[{subtype:'Link',rect:[45,688,550,705],dest:[1,{name:'XYZ'},0,720,null]},{subtype:'Link',rect:[45,663,550,680],dest:'second'}]};
 const book=await importPdf(file,library(pages,{annotations,destinations:{second:[1,{name:'FitH'},420]}}));assert.equal(book.contentsSource,'Linked PDF table of contents');assert.equal(book.parts.length,3);assert.ok(book.parts[1].text.endsWith('First body.'));assert.ok(book.parts[2].text.startsWith('Second section'));
});
test('explicit page labels resolve contents entries when title extraction is unavailable',async()=>{
 const pages=[page('Cover'),page('Contents','Alpha .... 1','Beta .... 2'),page('First text in a display font without extractable title.'),page('Second text without the title.')];
 const book=await importPdf(file,library(pages,{labels:['i','ii','1','2']}));assert.equal(book.contentsSource,'Printed PDF table of contents');assert.equal(book.parts[1].title,'Alpha');assert.equal(book.parts[2].title,'Beta');assert.ok(book.parts[1].text.startsWith('First text'));
});
test('chapter heading fallback does not turn every PDF page into a chapter',async()=>{
 const book=await importPdf(file,library([page(['Chapter 1',720,20],['The Journey',690,18],'Some opening prose.'),page('A continuation page without a heading.'),page(['Chapter 2',720,20],['The Return',690,18],'Closing prose.')]));
 assert.equal(book.contentsSource,'Detected PDF headings');assert.equal(book.parts.length,2);assert.ok(book.parts[0].text.includes('A continuation page'));assert.ok(book.parts[1].title.includes('The Return'));
});
test('unstructured PDF stays together and reports unavailable chapter boundaries',async()=>{
 const book=await importPdf(file,library([page('A plain document starts.'),page('It continues on another page.')]));assert.equal(book.parts.length,1);assert.ok(book.parts[0].text.includes('another page'));assert.match(book.navigationNotice,/No reliable PDF chapter/);
});
test('scanned PDF error is explicit and parser resources are released',async()=>{
 const fake=library([[]]);await assert.rejects(importPdf(file,fake),/OCR is not available/);assert.equal(fake.destroyed(),1);
});
test('PDF text extraction joins split words and retains explicit word gaps',()=>{
 const split=[{...item('Chap',700,20,50),hasEOL:false,width:40},{...item('ter',700,20,90),hasEOL:false,width:30},item('1',700,20,127)];assert.equal(pdfTextPage(split).text,'Chapter 1');
});
test('printed footer numbers resolve contents pages when headings cannot be matched',async()=>{
 const pages=[page('Cover'),page('Contents','Alpha .... 1','Beta .... 2'),page('Opening body text in an unusual title font.',['1',30]),page('Closing body text.',['2',30])];
 const book=await importPdf(file,library(pages));assert.equal(book.contentsSource,'Printed PDF table of contents');assert.equal(book.parts[1].title,'Alpha');assert.equal(book.parts[2].title,'Beta');
});
test('contents entries with wrapped titles retain their whole title',async()=>{
 const pages=[page('Contents','The beginning of','a long voyage .... 1','The return .... 2'),page(['The beginning of',720,20],['a long voyage',690,20],'First body paragraph.'),page(['The return',720,20],'Second body paragraph.')];
 const book=await importPdf(file,library(pages));assert.equal(book.contentsSource,'Printed PDF table of contents');assert.ok(book.parts[1].title.includes('The beginning of'));assert.ok(book.parts[1].title.includes('a long voyage'));assert.ok(book.parts[1].text.includes('First body paragraph'));
});
test('large printed headings provide sections when chapters have no number labels',async()=>{
 const pages=[page(['The Voyage',720,20],'A sufficiently long opening paragraph establishes the usual body font.'),page('The opening chapter continues with more prose.'),page(['The Storm',720,20],'Another sufficiently long paragraph follows this second heading.')];
 const book=await importPdf(file,library(pages));assert.equal(book.contentsSource,'Detected PDF headings');assert.equal(book.parts.length,2);assert.ok(book.parts[0].text.includes('continues'));assert.equal(book.parts[1].title,'The Storm');
});
