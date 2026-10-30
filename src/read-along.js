// Keep the reading viewport separate from the live listening position.
export function setupReadAlong({reader,button,message,getPosition,render,onBrowse=()=>{}}){
 let following=true,view=null,expectedScroll=reader.scrollTop;
 const loaded=()=>!!getPosition();
 function controls(){
  button.disabled=!loaded();button.textContent=following?'Following audio':'Follow along';
  button.setAttribute('aria-pressed',String(following));
  message.textContent=!loaded()?'Open a book to read along.':following?'Following the audio. Scroll or select text to browse freely.':'Browsing freely. Audio can keep playing. Tap Follow along to return to your listening position.';
 }
 function draw(){if(view)render({...view},following);expectedScroll=reader.scrollTop;controls()}
 function browse(){if(!loaded()||!following)return;following=false;onBrowse();controls()}
 function update({refresh=false}={}){
  const position=getPosition();
  if(following){view=position?{...position}:null;draw()}
  else if(refresh)draw();
  else controls();
 }
 function follow(){following=true;update()}
 function reset(){following=true;view=null;update()}
 for(const name of ['wheel','touchstart','pointerdown'])reader.addEventListener(name,browse,{passive:true});
 reader.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))browse()});
 // Includes scrollbar/assistive scrolling, without mistaking our own scroll for browsing.
 reader.addEventListener('scroll',()=>{if(Math.abs(reader.scrollTop-expectedScroll)>1)browse()},{passive:true});
 controls();
 return {update,follow,reset,browse,get following(){return following},get position(){return view?{...view}:null}};
}
