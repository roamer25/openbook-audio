// Switch views without replacing book DOM or the persistent audio element.
export function setupAppViews({document,window,onOpen=()=>{},hasBook=()=>false}){
 const views=new Map([...document.querySelectorAll('[data-app-view]')].map(node=>[node.dataset.appView,node]));
 const labels={player:'Now listening',books:'My library',read:'Read along',study:'Book study',moments:'Saved moments',settings:'Voice & speed'};
 const positions=new Map();let current=null,started=false;
 window.history.scrollRestoration='manual';
 const home=document.getElementById('viewHome'),label=document.getElementById('viewLabel'),mini=document.getElementById('miniPlayer');
 function refresh(){
  const loaded=hasBook();mini.hidden=current==='player'||!loaded;
  const title=document.getElementById('bookTitle').textContent,chapter=document.getElementById('chapterTimingTitle').textContent;
  const titleNode=document.getElementById('miniTitle'),chapterNode=document.getElementById('miniChapter'),toggle=document.getElementById('miniPlay');
  if(titleNode.textContent!==title)titleNode.textContent=title;
  if(chapterNode.textContent!==chapter)chapterNode.textContent=chapter;
  const paused=document.getElementById('play').textContent==='▶';toggle.textContent=paused?'▶':'❚❚';toggle.setAttribute('aria-label',paused?'Play narration':'Pause narration');
 }
 function show(name,{target,focus=true}={}){
  if(!views.has(name))name='player';
  const changed=current!==name;
  if(current&&changed)positions.set(current,window.scrollY||0);
  for(const [id,node] of views){node.hidden=id!==name;node.setAttribute('aria-hidden',String(id!==name))}
  current=name;home.hidden=name==='player';label.textContent=labels[name];document.title=name==='player'?'OpenBook Audio':labels[name]+' · OpenBook Audio';
  document.querySelectorAll('[data-view]').forEach(button=>{if(button.dataset.view===name)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')});
  onOpen(name);refresh();
  if(changed){if(focus)views.get(name).focus({preventScroll:true});window.scrollTo({top:positions.get(name)||0,behavior:'auto'})}
  if(target)document.getElementById(target)?.scrollIntoView({behavior:'smooth',block:'start'});
 }
 function open(name,options={}){
  if(!views.has(name))name='player';
  if(window.location.hash!=='#'+name){window.history[options.replace?'replaceState':'pushState'](null,'','#'+name)}
  show(name,options);
 }
 document.addEventListener('click',event=>{const button=event.target.closest?.('[data-view]');if(!button||button.disabled)return;event.preventDefault();open(button.dataset.view,{target:button.dataset.viewTarget})});
 document.getElementById('miniPlay').onclick=()=>document.getElementById('play').click();
 function fromLocation(){const name=window.location.hash.slice(1);show(views.has(name)?name:'player')}
 window.addEventListener('popstate',fromLocation);window.addEventListener('hashchange',fromLocation);
 const observer=new window.MutationObserver(refresh);for(const id of ['play','bookTitle','chapterTimingTitle'])observer.observe(document.getElementById(id),{childList:true,characterData:true,subtree:true});
 return {open,refresh,start(){if(started)return;started=true;fromLocation()},get current(){return current}};
}
