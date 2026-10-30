// Use only the book's original text, not generated chapter announcements.
export function kindleSearchText(text,offset=0){
 if(!text?.trim())return '';
 const normalize=value=>value.replace(/\u00ad/g,'').replace(/(\p{L})-\s*\n\s*(\p{L})/gu,'$1$2').replace(/\s+/g,' ').trim();
 const rawPosition=Math.max(0,Math.min(text.length-1,Number.isFinite(offset)?offset:0));
 const prefix=normalize(text.slice(0,rawPosition));text=normalize(text);
 const position=Math.min(text.length-1,prefix.length);
 let sentence=text,start=0;
 if(globalThis.Intl?.Segmenter){
  for(const item of new Intl.Segmenter('en',{granularity:'sentence'}).segment(text)){
   if(item.index+item.segment.length>position){sentence=item.segment;start=item.index;break}
  }
 }
 const words=Array.from(sentence.matchAll(/\S+/g));
 const whole=normalize(sentence);
 if(words.length>=6&&words.length<=22&&whole.length<=160)return whole;
 // A long sentence or missing punctuation still yields a short, whole-word
 // search phrase containing the current word and a little preceding context.
 let current=words.findIndex(word=>word.index+word[0].length>position-start);
 if(current<0)current=words.length-1;
 const first=Math.max(0,Math.min(current-4,words.length-14));
 if(!words.length)return whole;
 const end=Math.min(words.length,first+14);
 return normalize(sentence.slice(words[first].index,words[end-1].index+words[end-1][0].length));
}

export function setupKindlePlace({button,panel,field,message,location,copyButton,closeButton,getPlace,pause,save,clipboard=globalThis.navigator?.clipboard}){
 let revision=0;
 function reset(){revision++;panel.hidden=true;field.value='';message.textContent='';location.textContent=''}
 function refresh(){button.disabled=!getPlace()?.text?.trim();if(button.disabled)reset()}
 async function copy(){
  const text=field.value,version=revision;if(!text)return;
  try{
   if(!clipboard?.writeText)throw Error('Clipboard unavailable');
   await clipboard.writeText(text);
   if(version===revision)message.textContent='Copied. Open the same book in Kindle and paste into its in-book search.';
  }catch{
   if(version!==revision)return;
   field.focus();field.select();field.setSelectionRange?.(0,text.length);
   message.textContent='Automatic copy was unavailable. Select and copy the text below, or type the phrase into Kindle’s in-book search.';
  }
 }
 button.onclick=()=>{
  const place=getPlace();if(!place?.text?.trim())return;
  pause();save();revision++;
  field.value=kindleSearchText(place.text,place.offset);
  location.textContent=[place.book,place.chapter].filter(Boolean).join(' · ');
  panel.hidden=false;message.textContent='Copying your search text…';
  panel.scrollIntoView?.({behavior:'smooth',block:'nearest'});void copy();
 };
 copyButton.onclick=copy;
 closeButton.onclick=()=>{reset();button.focus()};
 refresh();return {reset,refresh};
}
