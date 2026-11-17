/* Afterimage — Astra 6 (Codex), 2026. Rendering and controls; rules live in core.js. */
(() => {
  'use strict';
  const G = window.Afterimage;
  const $ = id => document.getElementById(id);
  const canvas = $('board'), ctx = canvas.getContext('2d');
  const colors = ['#8cddd0', '#d7a8c4', '#a9b7ed'];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const storageKey = 'afterimage.v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch (_) {}
  let selected = Number.isInteger(saved.selected) && G.levels[saved.selected] ? saved.selected : 0;
  let solved = new Set(Array.isArray(saved.solved) ? saved.solved.filter(n => Number.isInteger(n) && G.levels[n]) : []);
  let state = G.create(selected), actions = [], inspecting = null, note = '', previous = null, movedAt = 0;
  let geometry = {cell: 1, ox: 0, oy: 0}, lastFrame = 0;
  function apply(s, action) {
    if (Array.isArray(action) && action.length === 2 && action.every(Number.isInteger) && Math.abs(action[0]) + Math.abs(action[1]) <= 1) return G.step(s, ...action);
    if (action === 'record') return G.record(s);
    if (action === 'undo') return G.undo(s);
    if (action === 'erase') return G.removeEcho(s);
    return s;
  }
  if (Array.isArray(saved.actions) && saved.actions.length <= 5000) {
    for (const action of saved.actions) { state = apply(state, action); actions.push(action); }
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify({selected, solved: [...solved], actions})); } catch (_) {}
  }
  const level = () => G.levels[selected];
  const pad = n => String(n).padStart(2, '0');
  function displayState() {
    if (inspecting === null) return state;
    const p = state.path[inspecting];
    return {...state, tick: inspecting, x: p.x, y: p.y, path: state.path.slice(0, inspecting + 1)};
  }
  function change(action) {
    if (inspecting !== null) { note = 'You’re inspecting the past. Move the clock back to NOW.'; update(); return; }
    const before = state;
    state = apply(state, action);
    if (before !== state) {
      previous = before; movedAt = performance.now(); actions.push(action);
      note = action === 'record' ? 'Echo recorded. Time returns to zero. Move to bring it to life.' : '';
      if (state.won) solved.add(selected);
      persist();
    }
    update();
  }
  function choose(index) {
    selected = index; state = G.create(index); actions = []; inspecting = null; previous = null; note = '';
    $('hint').parentElement.open = false;
    persist(); update();
  }
  function update() {
    const l = level(), view = displayState();
    $('chapter').textContent = `CHAMBER ${l.subtitle}`;
    $('title').textContent = l.title;
    $('story').textContent = l.story;
    $('hint').textContent = l.hint;
    $('coordinates').textContent = `${pad(selected + 1)} / ${pad(G.levels.length)}`;
    $('phase').textContent = inspecting === null ? (state.won ? 'PASSAGE COMPLETE' : 'PRESENT SELF') : 'MEMORY INSPECTION';
    $('beat').replaceChildren(document.createTextNode(pad(view.tick) + ' '), Object.assign(document.createElement('small'), {textContent: '/ ' + l.limit}));
    $('echo-count').replaceChildren(document.createTextNode(state.echoes.length + ' '), Object.assign(document.createElement('small'), {textContent: '/ ' + l.maxEchoes}));
    $('time').max = state.tick; $('time').value = view.tick;
    $('time-label').textContent = `${inspecting === null ? 'NOW' : 'THEN'} / ${pad(view.tick)}`;
    $('status').textContent = state.won ? (selected === G.levels.length - 1 ? 'All five chambers crossed. You made a way for yourself.' : 'Passage complete. Your past selves held the way open.') : note || (state.tick >= l.limit ? 'Out of beats. Record this path, undo a beat, or reset the room.' : state.echoes.length ? 'Your echoes move when you do. Their last step lasts forever.' : 'Walk to a plate. Record your path. Begin again, together.');
    $('record').hidden = state.won; $('next').hidden = !state.won;
    $('next').firstChild.textContent = selected === G.levels.length - 1 ? 'Return to first chamber ' : 'Next chamber ';
    $('record').disabled = state.tick === 0 || state.echoes.length >= l.maxEchoes || inspecting !== null;
    $('undo').disabled = state.tick === 0 || inspecting !== null;
    $('erase').disabled = !state.echoes.length || inspecting !== null;
    for (const b of document.querySelectorAll('[data-move]')) b.disabled = state.won || state.tick >= l.limit || inspecting !== null;
    $('tracks').replaceChildren();
    const addTrack = (text, color, present) => {
      const e = document.createElement('span'); e.className = 'track' + (present ? ' present' : ''); e.textContent = text; e.style.color = color; $('tracks').append(e);
    };
    state.echoes.forEach((path, i) => addTrack(`E${i + 1} · ${Math.min(view.tick, path.length - 1)}/${path.length - 1}${view.tick >= path.length - 1 ? ' HOLD' : ''}`, colors[i], false));
    addTrack('YOU · ' + view.tick, '#f4c77a', true);
    $('chambers').replaceChildren();
    G.levels.forEach((l, i) => {
      const b = document.createElement('button'); b.textContent = i + 1; b.setAttribute('aria-label', `Chamber ${i + 1}: ${l.title}${solved.has(i) ? ', completed' : ''}`); b.setAttribute('aria-current', String(i === selected)); b.className = solved.has(i) ? 'solved' : ''; b.onclick = () => choose(i); $('chambers').append(b);
    });
    const doors = G.doors(view);
    canvas.setAttribute('aria-label', `${l.title}. You are at column ${view.x + 1}, row ${view.y + 1}. Beat ${view.tick} of ${l.limit}. ${Object.entries(doors).map(([k,v]) => `Door ${k.toUpperCase()} ${v ? 'open' : 'closed'}`).join('. ')}. Arrow keys move; Space waits; R records.`);
    draw(performance.now());
  }
  function line(points, color, width = 1, dash = []) {
    if (points.length < 2) return;
    ctx.beginPath(); ctx.moveTo(...points[0]); points.slice(1).forEach(p => ctx.lineTo(...p)); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
  }
  function diamond(x,y,r,color,width=1){ctx.beginPath();ctx.moveTo(x,y-r);ctx.lineTo(x+r,y);ctx.lineTo(x,y+r);ctx.lineTo(x-r,y);ctx.closePath();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  function draw(now) {
    const rect = canvas.getBoundingClientRect(), w = rect.width, h = rect.height;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w*dpr) || canvas.height !== Math.round(h*dpr)) {canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
    const l = level(), map = l.map, rows = map.length, cols = map[0].length;
    const cell = Math.min((w-44)/cols,(h-38)/rows,64), ox = (w-cols*cell)/2, oy = (h-rows*cell)/2;
    geometry = {cell,ox,oy};
    const center = p => [ox+(p.x+.5)*cell, oy+(p.y+.5)*cell];
    const s = displayState(), doors = G.doors(s);
    // Fine survey grid beyond the chamber's walls.
    ctx.strokeStyle='#8cddd009';ctx.lineWidth=1;
    for(let x=ox%cell;x<w;x+=cell){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
    for(let y=oy%cell;y<h;y+=cell){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    ctx.font=`${Math.max(8,cell*.14)}px Consolas,monospace`;ctx.textAlign='center';ctx.textBaseline='middle';
    const plates=[], gates=[];
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const tile=map[y][x],px=ox+x*cell,py=oy+y*cell,cx=px+cell/2,cy=py+cell/2;
      if(tile==='#'){
        ctx.fillStyle='#0b1416';ctx.fillRect(px+1,py+7,cell-2,cell-1);
        const g=ctx.createLinearGradient(px,py,px,py+cell);g.addColorStop(0,'#354748');g.addColorStop(1,'#29393b');ctx.fillStyle=g;ctx.fillRect(px+1,py+1,cell-2,cell-5);
        line([[px+2,py+2],[px+cell-2,py+2]],'#516563',1);
        line([[px+2,py+2],[px+2,py+cell-5]],'#ffffff08',1);
      }else{
        ctx.fillStyle='#1b2c2e';ctx.fillRect(px+1,py+1,cell-2,cell-2);
        ctx.fillStyle='#63858030';ctx.fillRect(px+4,py+4,1,1);ctx.fillRect(px+cell-5,py+cell-5,1,1);
        if(/[abc]/.test(tile))plates.push({x,y,key:tile});
        if(/[ABC]/.test(tile))gates.push({x,y,key:tile.toLowerCase()});
        if(tile==='S'){ctx.strokeStyle='#b8ccc125';ctx.strokeRect(cx-cell*.22,cy-cell*.22,cell*.44,cell*.44);ctx.fillStyle='#78938b';ctx.fillText('·',cx,cy);}
        if(tile==='E'){
          ctx.shadowColor='#f4c77a';ctx.shadowBlur=state.won?24:9;diamond(cx,cy,cell*.27,'#f4c77a',1.5);diamond(cx,cy,cell*.15,'#f4c77a60');ctx.shadowBlur=0;
          ctx.fillStyle='#f4c77a';ctx.fillRect(cx-2,cy-2,4,4);
        }
      }
    }
    // Letter-matched circuits make the causal relationship visible.
    for(const p of plates)for(const g of gates)if(p.key===g.key){const a=center(p),b=center(g);line([a,[b[0],a[1]],b],doors[p.key]?'#8cddd042':'#8cddd013',1,[3,5]);}
    for(const p of plates){const [x,y]=center(p),on=doors[p.key];ctx.fillStyle=on?'#8cddd025':'#0e1c1e';ctx.fillRect(x-cell*.26,y-cell*.26,cell*.52,cell*.52);ctx.strokeStyle=on?'#8cddd0':'#8ca39a';ctx.lineWidth=1;ctx.strokeRect(x-cell*.26,y-cell*.26,cell*.52,cell*.52);ctx.fillStyle=on?'#b4fff1':'#b6c5b4';ctx.font=`${cell*.23}px Consolas,monospace`;ctx.fillText(p.key.toUpperCase(),x,y);}
    for(const g of gates){const [x,y]=center(g),on=doors[g.key];ctx.fillStyle=on?'#8cddd010':'#d6a57418';ctx.fillRect(x-cell*.42,y-cell*.42,cell*.84,cell*.84);ctx.strokeStyle=on?'#8cddd060':'#e8b575';ctx.lineWidth=2;ctx.strokeRect(x-cell*.41,y-cell*.41,cell*.82,cell*.82);if(!on){for(let d=-.25;d<=.25;d+=.25)line([[x+d*cell,y-cell*.33],[x+d*cell,y+cell*.33]],'#e8b57580',2);}ctx.fillStyle=on?'#8cddd0':'#f4c77a';ctx.font=`${cell*.16}px Consolas,monospace`;ctx.fillText(g.key.toUpperCase(),x+cell*.30,y-cell*.29);}
    state.echoes.forEach((path,i)=>line(path.map(center),colors[i]+'40',1.5,[3,5]));
    line(s.path.map(center),'#f4c77a45',2);
    const ease = reduced || inspecting!==null ? 1 : Math.min(1,(now-movedAt)/140);
    const t = 1-Math.pow(1-ease,3);
    function actor(p,color,echo,index){
      let [x,y]=center(p);
      if(previous && previous.tick+1===s.tick && previous.echoes.length===s.echoes.length && t<1){const old=echo?G.positions(previous)[index]:previous;if(old){const [a,b]=center(old);x=a+(x-a)*t;y=b+(y-b)*t;}}
      if(echo){const angle=index*2.1; x+=Math.cos(angle)*cell*.05;y+=Math.sin(angle)*cell*.05;}
      ctx.shadowColor=color;ctx.shadowBlur=echo?10:20;ctx.beginPath();ctx.arc(x,y,cell*(echo?.16:.14),0,Math.PI*2);ctx.fillStyle=echo?'#142426':color;ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=echo?2:1;ctx.stroke();ctx.shadowBlur=0;
      if(!echo){ctx.beginPath();ctx.arc(x,y,cell*.23,0,Math.PI*2);ctx.strokeStyle='#f4c77a55';ctx.lineWidth=1;ctx.stroke();ctx.fillStyle='#fff5d9';ctx.beginPath();ctx.arc(x-cell*.025,y-cell*.04,cell*.045,0,Math.PI*2);ctx.fill();}
      else{ctx.fillStyle=color;ctx.font=`${Math.max(8,cell*.13)}px Consolas,monospace`;ctx.fillText(index+1,x,y);}
    }
    G.positions(s).forEach((p,i)=>actor(p,colors[i],true,i));actor(s,'#f4c77a',false,0);
    ctx.font='8px Consolas,monospace';ctx.fillStyle='#6f91837a';
    for(let x=1;x<cols-1;x++)ctx.fillText(pad(x),ox+(x+.5)*cell,oy-10);
    if(state.won){ctx.fillStyle='#101819d9';ctx.fillRect(w/2-123,h-38,246,28);ctx.font='10px Consolas,monospace';ctx.fillStyle='#f4c77a';ctx.fillText('THE WAY IS OPEN',w/2,h-23);}
  }
  document.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>change(b.dataset.move.split(',').map(Number)));
  $('record').onclick=()=>change('record');$('undo').onclick=()=>change('undo');$('erase').onclick=()=>change('erase');
  $('restart').onclick=()=>choose(selected);$('next').onclick=()=>choose((selected+1)%G.levels.length);
  $('help').onclick=()=>{const open=$('instructions').hidden;$('instructions').hidden=!open;$('help').setAttribute('aria-expanded',String(open));};
  $('time').oninput=()=>{const n=+$('time').value;inspecting=n===state.tick?null:n;previous=null;note='';update();};
  document.addEventListener('keydown',e=>{
    if(e.composedPath().some(node=>node.tagName==='DIALOG'))return;
    if(e.ctrlKey||e.metaKey||e.altKey||e.target.matches('input,select,textarea')||(e.target.matches('button,summary,a')&&(e.key===' '||e.key==='Enter')))return;
    const dirs={ArrowUp:[0,-1],w:[0,-1],ArrowDown:[0,1],s:[0,1],ArrowLeft:[-1,0],a:[-1,0],ArrowRight:[1,0],d:[1,0],' ':[0,0]};
    const key=e.key.length===1?e.key.toLowerCase():e.key;
    if(dirs[key]){e.preventDefault();change(dirs[key]);}else if(key==='r'&&!e.repeat){e.preventDefault();change('record');}else if(key==='z'){e.preventDefault();change('undo');}
  });
  canvas.addEventListener('pointerdown',e=>{
    const rect=canvas.getBoundingClientRect(),{cell,ox,oy}=geometry;
    const x=Math.floor((e.clientX-rect.left-ox)/cell),y=Math.floor((e.clientY-rect.top-oy)/cell);
    if(Math.abs(x-state.x)+Math.abs(y-state.y)<=1)change([x-state.x,y-state.y]);canvas.focus({preventScroll:true});
  });
  new ResizeObserver(()=>draw(performance.now())).observe(canvas);
  function frame(now){if(!document.hidden && now-lastFrame>30 && now-movedAt<220){draw(now);lastFrame=now;}requestAnimationFrame(frame);}
  update();requestAnimationFrame(frame);
})();
