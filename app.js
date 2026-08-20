const INITIAL_BUILTINS = (window.BUILTIN_SONGS || []).map(s => ({
  ...s,
  source:s.source || 'builtin',
  archiveId:s.archiveId || 'setlist_2026_b',
  archiveName:s.archiveName || 'Scaletta 2026 B'
}));
const ARCHIVE_BUILTINS = (window.ARCHIVE_SONGS || []).map(s => ({...s,source:s.source || 'builtin_archive'}));
const BUILTINS = [...INITIAL_BUILTINS,...ARCHIVE_BUILTINS];
let userSongs = [];
let allSongs = [];
let favorites = new Set(JSON.parse(localStorage.getItem('indaco_favorites_v1') || '[]'));
let filterFavorites = false;
let currentArchiveFilter = localStorage.getItem('indaco_archive_filter_v2') || 'setlist_2026_b';
let currentView = 'library';
let currentSongId = null;
let viewerSequence = [];
let viewerIndex = -1;
let currentObjectUrl = null;
let deferredInstallPrompt = null;
let wakeLock = null;

const DEFAULT_SETLIST = {
  id:'setlist_2026_b',
  name:'Scaletta 2026 B',
  songs: INITIAL_BUILTINS.map(s => s.id)
};
let setlists = loadSetlists();
let currentSetlistId = localStorage.getItem('indaco_current_setlist_v1') || setlists[0].id;

const $ = id => document.getElementById(id);
const views = [...document.querySelectorAll('.view')];
const navButtons = [...document.querySelectorAll('.nav-btn')];

function loadSetlists(){
  try{
    const saved = JSON.parse(localStorage.getItem('indaco_setlists_v1') || 'null');
    if(Array.isArray(saved) && saved.length) return saved;
  }catch(e){}
  return [DEFAULT_SETLIST];
}
function saveState(){
  localStorage.setItem('indaco_setlists_v1', JSON.stringify(setlists));
  localStorage.setItem('indaco_current_setlist_v1', currentSetlistId);
  localStorage.setItem('indaco_favorites_v1', JSON.stringify([...favorites]));
  localStorage.setItem('indaco_archive_filter_v2', currentArchiveFilter);
}
function getCurrentSetlist(){return setlists.find(s => s.id === currentSetlistId) || setlists[0];}
function songById(id){return allSongs.find(s => s.id === id);}
function escapeHtml(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function showToast(msg){const t=$('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.classList.add('hidden'),2200);}
function showModal(title,html){$('modalTitle').textContent=title;$('modalBody').innerHTML=html;$('modal').classList.remove('hidden');}
function setView(name){
  currentView=name;
  views.forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  navButtons.forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  if(name==='library')renderLibrary();
  if(name==='setlist')renderSetlists();
  if(name==='manage')renderManage();
  window.scrollTo({top:0,behavior:'instant'});
}
document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>setView(el.dataset.view)));

function archiveMap(){
  const map=new Map();
  for(const s of allSongs){
    const id=s.archiveId || 'importati_singoli';
    const name=s.archiveName || 'Importati singoli';
    if(!map.has(id))map.set(id,{id,name,count:0,builtin:true});
    const a=map.get(id);a.count++;if(!s.builtin)a.builtin=false;
  }
  return map;
}
function sortedArchives(){
  const priority={setlist_2026_b:0,archive_brani_indaco:1,importati_singoli:999};
  return [...archiveMap().values()].sort((a,b)=>(priority[a.id]??20)-(priority[b.id]??20)||a.name.localeCompare(b.name,'it'));
}
function refreshArchiveOptions(){
  const archives=sortedArchives();
  if(currentArchiveFilter!=='all'&&!archives.some(a=>a.id===currentArchiveFilter))currentArchiveFilter=archives[0]?.id||'all';
  $('archiveSelect').innerHTML=`<option value="all">Tutti i brani (${allSongs.length})</option>`+archives.map(a=>`<option value="${escapeHtml(a.id)}" ${a.id===currentArchiveFilter?'selected':''}>${escapeHtml(a.name)} (${a.count})</option>`).join('');
  const builtinArchives=archives.filter(a=>allSongs.some(s=>s.archiveId===a.id&&s.builtin));
  $('offlineArchiveSelect').innerHTML=builtinArchives.map(a=>`<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} (${a.count})</option>`).join('');
}
function refreshAllSongs(){
  allSongs=[...BUILTINS,...userSongs].sort((a,b)=>(a.order||9999)-(b.order||9999));
  refreshArchiveOptions();renderLibrary();renderSetlists();renderManage();
}
function filteredSongs(){
  const q=$('searchInput').value.trim().toLocaleLowerCase('it');
  let list=allSongs.filter(s=>{
    if(currentArchiveFilter!=='all'&&(s.archiveId||'importati_singoli')!==currentArchiveFilter)return false;
    if(filterFavorites&&!favorites.has(s.id))return false;
    const hay=`${s.title} ${s.artist||''} ${s.key||''} ${s.archiveName||''} ${s.originalName||''}`.toLocaleLowerCase('it');
    return !q||hay.includes(q);
  });
  const sort=$('sortSelect').value;
  if(sort==='az')list.sort((a,b)=>a.title.localeCompare(b.title,'it'));
  if(sort==='key')list.sort((a,b)=>(a.key||'').localeCompare(b.key||'','it')||a.title.localeCompare(b.title,'it'));
  return list;
}
function renderLibrary(){
  const list=filteredSongs();
  const archiveLabel=currentArchiveFilter==='all'?'Tutti gli archivi':(archiveMap().get(currentArchiveFilter)?.name||'Archivio');
  $('libraryCount').textContent=`${list.length} brani visualizzati · ${archiveLabel} · Scaletta: ${getCurrentSetlist().name}`;
  $('favoritesFilter').classList.toggle('active',filterFavorites);
  $('favoritesFilter').textContent=filterFavorites?'★ Solo preferiti':'☆ Preferiti';
  $('songGrid').innerHTML=list.map(s=>`
    <article class="song-card">
      <button class="song-open" data-open="${escapeHtml(s.id)}">
        <strong>${escapeHtml(s.title)}</strong>
        <small>${escapeHtml(s.artist||s.archiveName||(s.builtin?'Repertorio integrato':'Brano importato'))}</small>
        <span class="key-badge">${escapeHtml(s.key||'—')}</span>
      </button>
      <div class="song-actions">
        <button class="favorite ${favorites.has(s.id)?'active':''}" data-fav="${escapeHtml(s.id)}" title="Preferito">${favorites.has(s.id)?'★':'☆'}</button>
        <button data-add="${escapeHtml(s.id)}" title="Aggiungi alla scaletta">＋</button>
      </div>
    </article>`).join('');
  $('emptyLibrary').classList.toggle('hidden',list.length>0);
}
$('songGrid').addEventListener('click',e=>{
  const open=e.target.closest('[data-open]');if(open){openSong(open.dataset.open,filteredSongs().map(s=>s.id));return;}
  const fav=e.target.closest('[data-fav]');if(fav){toggleFavorite(fav.dataset.fav);return;}
  const add=e.target.closest('[data-add]');if(add){addSongToCurrentSetlist(add.dataset.add);return;}
});
$('archiveSelect').addEventListener('change',e=>{
  currentArchiveFilter=e.target.value;
  $('sortSelect').value=currentArchiveFilter==='setlist_2026_b'?'order':'az';
  saveState();renderLibrary();
});
$('searchInput').addEventListener('input',renderLibrary);
$('sortSelect').addEventListener('change',renderLibrary);
$('favoritesFilter').addEventListener('click',()=>{filterFavorites=!filterFavorites;renderLibrary();});
function toggleFavorite(id){favorites.has(id)?favorites.delete(id):favorites.add(id);saveState();renderLibrary();}
function addSongToCurrentSetlist(id){const s=getCurrentSetlist();s.songs.push(id);saveState();showToast(`Aggiunto a “${s.name}”`);}

function renderSetlists(){
  if(!setlists.find(s=>s.id===currentSetlistId))currentSetlistId=setlists[0].id;
  $('setlistSelect').innerHTML=setlists.map(s=>`<option value="${escapeHtml(s.id)}" ${s.id===currentSetlistId?'selected':''}>${escapeHtml(s.name)} (${s.songs.length})</option>`).join('');
  const set=getCurrentSetlist();const valid=set.songs.map(songById).filter(Boolean);
  $('setlistItems').innerHTML=valid.map((s,i)=>`
    <div class="setlist-row"><div class="setlist-number">${i+1}</div>
      <button class="setlist-main" data-set-open="${escapeHtml(s.id)}"><strong>${escapeHtml(s.title)}</strong><small>${escapeHtml(s.key||'—')} · ${escapeHtml(s.archiveName||'')}</small></button>
      <div class="row-actions"><button data-move="${i}" data-delta="-1" aria-label="Sposta su">↑</button><button data-move="${i}" data-delta="1" aria-label="Sposta giù">↓</button><button data-remove="${i}" aria-label="Rimuovi">×</button></div>
    </div>`).join('');
  $('emptySetlist').classList.toggle('hidden',valid.length>0);
}
$('setlistSelect').addEventListener('change',e=>{currentSetlistId=e.target.value;saveState();renderSetlists();renderLibrary();});
$('newSetlistBtn').addEventListener('click',()=>{const name=prompt('Nome della nuova scaletta:','Nuova scaletta');if(!name?.trim())return;const s={id:`set_${Date.now()}`,name:name.trim(),songs:[]};setlists.push(s);currentSetlistId=s.id;saveState();renderSetlists();renderLibrary();});
$('renameSetlistBtn').addEventListener('click',()=>{const s=getCurrentSetlist(),name=prompt('Nuovo nome:',s.name);if(!name?.trim())return;s.name=name.trim();saveState();renderSetlists();renderLibrary();});
$('deleteSetlistBtn').addEventListener('click',()=>{if(setlists.length===1){showToast('Deve rimanere almeno una scaletta');return;}const s=getCurrentSetlist();if(!confirm(`Eliminare “${s.name}”?`))return;setlists=setlists.filter(x=>x.id!==s.id);currentSetlistId=setlists[0].id;saveState();renderSetlists();renderLibrary();});
$('setlistItems').addEventListener('click',e=>{
  const op=e.target.closest('[data-set-open]');if(op){openSong(op.dataset.setOpen,getCurrentSetlist().songs.filter(id=>songById(id)));return;}
  const mv=e.target.closest('[data-move]');if(mv){moveSetlistItem(Number(mv.dataset.move),Number(mv.dataset.delta));return;}
  const rm=e.target.closest('[data-remove]');if(rm){getCurrentSetlist().songs.splice(Number(rm.dataset.remove),1);saveState();renderSetlists();return;}
});
function moveSetlistItem(i,d){const arr=getCurrentSetlist().songs,j=i+d;if(j<0||j>=arr.length)return;[arr[i],arr[j]]=[arr[j],arr[i]];saveState();renderSetlists();}
function startSetlist(){const ids=getCurrentSetlist().songs.filter(id=>songById(id));if(!ids.length){showToast('La scaletta è vuota');return;}openSong(ids[0],ids);}
$('startSetlistBtn').addEventListener('click',startSetlist);$('quickStartBtn').addEventListener('click',startSetlist);

function openSong(id,sequence){
  const song=songById(id);if(!song)return;
  currentSongId=id;viewerSequence=(sequence?.length?sequence:allSongs.map(s=>s.id)).filter(x=>songById(x));viewerIndex=Math.max(0,viewerSequence.indexOf(id));
  if(currentObjectUrl){URL.revokeObjectURL(currentObjectUrl);currentObjectUrl=null;}
  $('viewerSongTitle').textContent=song.title;
  $('viewerMeta').textContent=[song.artist,song.key&&`Tonalità ${song.key}`,song.archiveName].filter(Boolean).join(' · ');
  const container=$('viewerContent');container.innerHTML='';let url;
  if(song.builtin)url=song.file;else{currentObjectUrl=URL.createObjectURL(song.blob);url=currentObjectUrl;}
  $('openExternalBtn').dataset.url=url;
  if((song.type||'').startsWith('image/')){const img=document.createElement('img');img.src=url;img.alt=song.title;container.appendChild(img);}
  else{const iframe=document.createElement('iframe');iframe.title=song.title;iframe.src=`${url}#view=FitH&toolbar=1&navpanes=0`;container.appendChild(iframe);}
  $('prevSongBtn').disabled=viewerIndex<=0;$('nextSongBtn').disabled=viewerIndex>=viewerSequence.length-1;$('viewer').classList.remove('hidden');
}
function navigateViewer(delta){const ni=viewerIndex+delta;if(ni<0||ni>=viewerSequence.length)return;openSong(viewerSequence[ni],viewerSequence);}
$('prevSongBtn').addEventListener('click',()=>navigateViewer(-1));$('nextSongBtn').addEventListener('click',()=>navigateViewer(1));$('closeViewerBtn').addEventListener('click',closeViewer);
function closeViewer(){$('viewer').classList.add('hidden');$('viewerContent').innerHTML='';if(currentObjectUrl){URL.revokeObjectURL(currentObjectUrl);currentObjectUrl=null;}}
$('openExternalBtn').addEventListener('click',e=>window.open(e.currentTarget.dataset.url,'_blank'));
document.addEventListener('keydown',e=>{if($('viewer').classList.contains('hidden'))return;if(e.key==='ArrowRight')navigateViewer(1);if(e.key==='ArrowLeft')navigateViewer(-1);if(e.key==='Escape')closeViewer();});
let touchStart=null;$('viewerContent').addEventListener('touchstart',e=>{const t=e.changedTouches[0];touchStart={x:t.clientX,y:t.clientY};},{passive:true});$('viewerContent').addEventListener('touchend',e=>{if(!touchStart)return;const t=e.changedTouches[0],dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y;if(Math.abs(dx)>110&&Math.abs(dy)<60)navigateViewer(dx<0?1:-1);touchStart=null;},{passive:true});

function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('indaco_songbook_db',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('songs'))r.result.createObjectStore('songs',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function dbGetAll(){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction('songs').objectStore('songs').getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);});}
async function dbPut(song){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction('songs','readwrite').objectStore('songs').put(song);r.onsuccess=()=>res();r.onerror=()=>rej(r.error);});}
async function dbDelete(id){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction('songs','readwrite').objectStore('songs').delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error);});}

$('songFile').addEventListener('change',e=>{const f=e.target.files[0];if(f&&!$('songTitle').value)$('songTitle').value=filenameToTitle(f.name);});
function filenameToTitle(name){
  let s=name.replace(/\.[^.]+$/,'').replace(/#U[0-9A-Fa-f]{4}/g,' ').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
  const letters=[...s].filter(c=>/[A-Za-zÀ-ÿ]/.test(c));
  if(letters.length&&letters.filter(c=>c===c.toUpperCase()).length/letters.length>.72){s=s.toLocaleLowerCase('it').replace(/(^|[\s'’/(])([a-zà-öø-ÿ])/g,(m,a,b)=>a+b.toLocaleUpperCase('it'));}
  return s||'Brano senza titolo';
}
function safeArchiveId(name){return `archive_${name.toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,45)||'zip'}_${Date.now()}`;}
function guessType(name){const ext=name.split('.').pop().toLowerCase();return ext==='pdf'?'application/pdf':ext==='png'?'image/png':ext==='webp'?'image/webp':'image/jpeg';}
function isSupportedSongFile(name){return /\.(pdf|png|jpe?g|webp)$/i.test(name);}
$('addSongForm').addEventListener('submit',async e=>{
  e.preventDefault();const file=$('songFile').files[0];if(!file)return;
  const song={id:`user_${Date.now()}`,title:$('songTitle').value.trim(),artist:$('songArtist').value.trim(),key:$('songKey').value.trim()||'—',type:file.type||guessType(file.name),name:file.name,originalName:file.name,blob:file,order:10000+Date.now(),builtin:false,source:'user',archiveId:'importati_singoli',archiveName:'Importati singoli'};
  await dbPut(song);userSongs=await dbGetAll();if($('addToCurrentSetlist').checked)getCurrentSetlist().songs.push(song.id);saveState();e.target.reset();currentArchiveFilter='importati_singoli';refreshAllSongs();showToast('Brano aggiunto');
});
$('quickImportBtn').addEventListener('click',async()=>{
  const files=[...$('quickFiles').files].filter(f=>isSupportedSongFile(f.name));if(!files.length){showToast('Seleziona almeno un file');return;}
  const stamp=Date.now();for(const [i,file] of files.entries())await dbPut({id:`user_${stamp}_${i}`,title:filenameToTitle(file.name),artist:'',key:'—',type:file.type||guessType(file.name),name:file.name,originalName:file.name,blob:file,order:10000+stamp+i,builtin:false,source:'user',archiveId:'importati_singoli',archiveName:'Importati singoli'});
  userSongs=await dbGetAll();$('quickFiles').value='';currentArchiveFilter='importati_singoli';refreshAllSongs();showToast(`${files.length} brani importati`);
});
$('zipFile').addEventListener('change',e=>{const f=e.target.files[0];if(f&&!$('zipArchiveName').value)$('zipArchiveName').value=filenameToTitle(f.name);});
$('zipImportBtn').addEventListener('click',importZipArchive);
async function importZipArchive(){
  const zipFile=$('zipFile').files[0],archiveName=$('zipArchiveName').value.trim();
  if(!zipFile){showToast('Seleziona un file ZIP');return;}if(!archiveName){showToast('Inserisci il nome della cartella');return;}if(!window.JSZip){alert('Modulo ZIP non disponibile');return;}
  const progress=$('zipImportProgress');progress.classList.remove('hidden');progress.textContent='Lettura del file ZIP…';$('zipImportBtn').disabled=true;
  try{
    const zip=await JSZip.loadAsync(zipFile);
    const entries=Object.values(zip.files).filter(x=>!x.dir&&!x.name.includes('__MACOSX')&&isSupportedSongFile(x.name));
    if(!entries.length)throw new Error('Nello ZIP non risultano PDF o immagini compatibili');
    const archiveId=safeArchiveId(archiveName),stamp=Date.now();let imported=0,errors=0;
    for(const [i,entry] of entries.entries()){
      const originalName=entry.name.split('/').pop();progress.textContent=`Estrazione ${i+1} di ${entries.length}: ${originalName}`;
      try{
        const bytes=await entry.async('uint8array');const type=guessType(originalName);const blob=new Blob([bytes],{type});
        await dbPut({id:`zip_${stamp}_${i}`,title:filenameToTitle(originalName),artist:'',key:'—',type,name:originalName,originalName,blob,order:20000+stamp+i,builtin:false,source:'zip',archiveId,archiveName});imported++;
      }catch(err){console.error(entry.name,err);errors++;}
      if(i%8===0)await new Promise(r=>setTimeout(r,0));
    }
    userSongs=await dbGetAll();currentArchiveFilter=archiveId;$('zipFile').value='';$('zipArchiveName').value='';refreshAllSongs();saveState();
    progress.textContent=`Completato: ${imported} file importati${errors?`, ${errors} non importati`:''}.`;showToast(`Creato archivio “${archiveName}”`);
  }catch(err){progress.textContent=`Errore: ${err.message}`;alert(`Impossibile importare lo ZIP: ${err.message}`);}finally{$('zipImportBtn').disabled=false;}
}

function renderManage(){
  const groups=new Map();for(const s of userSongs){const id=s.archiveId||'importati_singoli';if(!groups.has(id))groups.set(id,{name:s.archiveName||'Importati singoli',songs:[]});groups.get(id).songs.push(s);}
  $('userSongList').innerHTML=[...groups.entries()].sort((a,b)=>a[1].name.localeCompare(b[1].name,'it')).map(([archiveId,g])=>`
    <details class="archive-details"><summary><span>📁 <strong>${escapeHtml(g.name)}</strong> <small>${g.songs.length} brani</small></span><button class="danger-soft mini" data-delete-archive="${escapeHtml(archiveId)}" type="button">Elimina cartella</button></summary>
      <div>${g.songs.sort((a,b)=>a.title.localeCompare(b.title,'it')).map(s=>`<div class="user-song-row"><div><strong>${escapeHtml(s.title)}</strong><small> · ${escapeHtml(s.key||'—')}</small></div><div><button data-edit-user="${escapeHtml(s.id)}">Modifica</button> <button class="danger-soft" data-delete-user="${escapeHtml(s.id)}">Elimina</button></div></div>`).join('')}</div>
    </details>`).join('');
  $('noUserSongs').classList.toggle('hidden',userSongs.length>0);
  $('archiveManagerList').innerHTML=sortedArchives().map(a=>`<div class="archive-manager-row"><div><strong>📁 ${escapeHtml(a.name)}</strong><small>${a.count} brani · ${a.builtin?'integrato nell’app':'salvato sul dispositivo'}</small></div><button data-open-archive="${escapeHtml(a.id)}">Apri</button></div>`).join('');
}
$('archiveManagerList').addEventListener('click',e=>{const b=e.target.closest('[data-open-archive]');if(!b)return;currentArchiveFilter=b.dataset.openArchive;saveState();setView('library');});
$('userSongList').addEventListener('click',async e=>{
  const delArchive=e.target.closest('[data-delete-archive]');if(delArchive){e.preventDefault();e.stopPropagation();await deleteUserArchive(delArchive.dataset.deleteArchive);return;}
  const edit=e.target.closest('[data-edit-user]');if(edit){await editUserSong(edit.dataset.editUser);return;}
  const del=e.target.closest('[data-delete-user]');if(del){await deleteUserSong(del.dataset.deleteUser);return;}
});
async function editUserSong(id){
  const s=userSongs.find(x=>x.id===id);if(!s)return;const title=prompt('Titolo:',s.title);if(!title?.trim())return;const artist=prompt('Artista:',s.artist||'');if(artist===null)return;const key=prompt('Tonalità:',s.key||'—');if(key===null)return;await dbPut({...s,title:title.trim(),artist:artist.trim(),key:key.trim()||'—'});userSongs=await dbGetAll();refreshAllSongs();
}
async function deleteUserSong(id){
  const s=userSongs.find(x=>x.id===id);if(!s||!confirm(`Eliminare “${s.title}”?`))return;await dbDelete(id);userSongs=await dbGetAll();setlists.forEach(set=>set.songs=set.songs.filter(x=>x!==id));favorites.delete(id);saveState();refreshAllSongs();
}
async function deleteUserArchive(archiveId){
  const songs=userSongs.filter(s=>(s.archiveId||'importati_singoli')===archiveId);if(!songs.length)return;const name=songs[0].archiveName||'Archivio';if(!confirm(`Eliminare la cartella “${name}” e tutti i suoi ${songs.length} brani?`))return;
  for(const s of songs)await dbDelete(s.id);const ids=new Set(songs.map(s=>s.id));setlists.forEach(set=>set.songs=set.songs.filter(id=>!ids.has(id)));songs.forEach(s=>favorites.delete(s.id));userSongs=await dbGetAll();currentArchiveFilter='setlist_2026_b';saveState();refreshAllSongs();showToast('Cartella eliminata');
}

$('downloadArchiveOfflineBtn').addEventListener('click',downloadArchiveOffline);
async function downloadArchiveOffline(){
  const archiveId=$('offlineArchiveSelect').value;const songs=allSongs.filter(s=>s.archiveId===archiveId&&s.builtin&&s.file);if(!songs.length){showToast('Archivio già disponibile offline');return;}
  if(!('caches' in window)){showToast('Cache offline non supportata');return;}
  const progress=$('offlineProgress');progress.classList.remove('hidden');$('downloadArchiveOfflineBtn').disabled=true;
  try{
    const cache=await caches.open('indaco-songbook-v2');let done=0,skipped=0,failed=0;
    for(const s of songs){
      progress.textContent=`Download offline ${done+skipped+failed+1} di ${songs.length}: ${s.title}`;
      try{if(await cache.match(s.file)){skipped++;continue;}const resp=await fetch(s.file);if(!resp.ok)throw new Error(String(resp.status));await cache.put(s.file,resp.clone());done++;}catch(err){console.error(s.file,err);failed++;}
    }
    progress.textContent=`Offline completato: ${done} scaricati, ${skipped} già presenti${failed?`, ${failed} errori`:''}.`;showToast('Archivio disponibile offline');
  }finally{$('downloadArchiveOfflineBtn').disabled=false;}
}

function blobToDataURL(blob){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(blob);});}
function dataURLToBlob(dataURL){const [head,data]=dataURL.split(','),mime=(head.match(/:(.*?);/)||[])[1]||'application/octet-stream';const bin=atob(data),arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);return new Blob([arr],{type:mime});}
$('exportBackupBtn').addEventListener('click',async()=>{const exported=[];for(const s of userSongs)exported.push({...s,blob:undefined,fileData:await blobToDataURL(s.blob)});const payload={format:'indaco-songbook-backup',version:2,createdAt:new Date().toISOString(),userSongs:exported,setlists,favorites:[...favorites],currentSetlistId,currentArchiveFilter};downloadBlob(new Blob([JSON.stringify(payload)],{type:'application/json'}),`Indaco_Songbook_Backup_${new Date().toISOString().slice(0,10)}.indaco`);});
$('importBackupInput').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const data=JSON.parse(await file.text());if(data.format!=='indaco-songbook-backup')throw new Error('Formato non valido');for(const s of data.userSongs||[]){const {fileData,...meta}=s;await dbPut({...meta,blob:dataURLToBlob(fileData),builtin:false,source:meta.source||'user',archiveId:meta.archiveId||'importati_singoli',archiveName:meta.archiveName||'Importati singoli'});}if(Array.isArray(data.setlists)&&data.setlists.length)setlists=data.setlists;favorites=new Set(data.favorites||[]);currentSetlistId=data.currentSetlistId||setlists[0].id;currentArchiveFilter=data.currentArchiveFilter||'setlist_2026_b';userSongs=await dbGetAll();saveState();refreshAllSongs();showToast('Backup importato');}catch(err){alert(`Impossibile importare il backup: ${err.message}`);}e.target.value='';});
function downloadBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);}

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;});
$('installBtn').addEventListener('click',async()=>{if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;return;}const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);showModal('Installa Indaco Songbook',ios?`<p>Su iPad o iPhone:</p><ol><li>Apri questa pagina in <strong>Safari</strong>.</li><li>Tocca <strong>Condividi</strong>.</li><li>Scegli <strong>Aggiungi alla schermata Home</strong>.</li><li>Conferma con <strong>Aggiungi</strong>.</li></ol>`:`<p>Apri il menu del browser e scegli <strong>Installa app</strong> oppure <strong>Aggiungi alla schermata Home</strong>.</p>`);});
$('modalCloseBtn').addEventListener('click',()=>$('modal').classList.add('hidden'));$('modal').addEventListener('click',e=>{if(e.target===$('modal'))$('modal').classList.add('hidden');});
async function toggleWakeLock(){if(!('wakeLock'in navigator)){showToast('Blocco schermo non supportato');return;}try{if(wakeLock){await wakeLock.release();wakeLock=null;$('wakeLockBtn').textContent='☀️';showToast('Blocco schermo disattivato');}else{wakeLock=await navigator.wakeLock.request('screen');$('wakeLockBtn').textContent='🔆';showToast('Schermo mantenuto acceso');wakeLock.addEventListener('release',()=>{$('wakeLockBtn').textContent='☀️';wakeLock=null;});}}catch(e){showToast('Impossibile mantenere acceso lo schermo');}}
$('wakeLockBtn').addEventListener('click',toggleWakeLock);
function updateConnection(){const online=navigator.onLine;$('connectionStatus').textContent=online?'ONLINE':'OFFLINE';$('connectionStatus').classList.toggle('offline',!online);}
window.addEventListener('online',updateConnection);window.addEventListener('offline',updateConnection);updateConnection();
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('service-worker.js').catch(console.error));
(async function init(){try{userSongs=await dbGetAll();}catch(e){console.error(e);}refreshAllSongs();setView('library');})();
