const $ = id => document.getElementById(id);
const base = $('base'), live = $('live'), cur = $('cur'), ti = $('ti');
const bctx = base.getContext('2d'), lctx = live.getContext('2d'), cctx = cur.getContext('2d');
const ZH = $('zoom-hud'), TT = $('toast'), BU = $('btn-undo'), BR = $('btn-redo');

const COLORS = [
  // Neutrals
  '#1a1a1a','#555555','#888888','#bbbbbb','#ffffff',
  // Reds / Pinks
  '#e03535','#e8806a','#f4b8b0','#c9506e','#f472b6',
  // Oranges / Yellows
  '#f97316','#fbbf24','#fde68a','#a16207','#854d0e',
  // Greens
  '#22c55e','#86efac','#166534','#4ade80','#6ee7b7',
  // Blues
  '#3b82f6','#93c5fd','#1e40af','#0ea5e9','#7dd3fc',
  // Purples / Warm
  '#a855f7','#d8b4fe','#7c3aed','#c4b49a','#a898ae'
];
const PEN_W = [2,6,16], ERASER_W = [28,60,110], FONT_SZ = [22,36,60], RDP_EPS = [1.5,3,6];
const MIN_SCALE = 0.05, MAX_SCALE = 20, MIN_D2 = 4;
const dpr = Math.min(window.devicePixelRatio||1, 2);
const SNAP_DIST = 5; // screen pixels for snap-to-shape
const SHAPE_TOOLS = new Set(['rect','diamond','ellipse','line']);

let vp = {x:0,y:0,scale:1};
let tool='pen', ci=0, wi=0;
let strokes=[], undoStack=[[]], histIdx=0;
let isDrawing=false, drawPts=[];
let shapeStart=null, shapeEnd=null;
let arrowMode=0; // 0=none, 1=arrow at end, 2=both arrows
let spaceDown=false, mousePanning=false, midPanning=false;
let panStart=null, vpAtPanStart=null, rafId=null;
let curSX=-999, curSY=-999;

function resize() {
  const W=innerWidth, H=innerHeight;
  for (const c of [base,live,cur]) {
    c.width=Math.round(W*dpr); c.height=Math.round(H*dpr);
    c.style.width=W+'px'; c.style.height=H+'px';
  }
  scheduleRedraw(); drawCursorAt(curSX,curSY);
}
window.addEventListener('resize', resize);

const s2w = (sx,sy) => ({x:(sx-vp.x)/vp.scale, y:(sy-vp.y)/vp.scale});
const applyVP = ctx => ctx.setTransform(vp.scale*dpr,0,0,vp.scale*dpr,vp.x*dpr,vp.y*dpr);

function setZoom(ns, cx, cy) {
  const rf = ns/vp.scale;
  vp.x = cx-(cx-vp.x)*rf; vp.y = cy-(cy-vp.y)*rf; vp.scale=ns;
  ZH.textContent = Math.round(ns*100)+'%';
}
function zoomAt(factor,cx,cy){ setZoom(Math.max(MIN_SCALE,Math.min(MAX_SCALE,vp.scale*factor)),cx,cy); }

function drawGrid() {
  const W=base.width/dpr, H=base.height/dpr;
  let sp=32;
  while(sp*vp.scale<16) sp*=4;
  while(sp*vp.scale>64) sp/=2;
  const ox=-vp.x/vp.scale, oy=-vp.y/vp.scale;
  const x1=(W-vp.x)/vp.scale, y1=(H-vp.y)/vp.scale;
  const sx=Math.floor(ox/sp)*sp, sy=Math.floor(oy/sp)*sp;
  const r=1/vp.scale;
  bctx.fillStyle='rgba(0,0,0,.08)';
  bctx.beginPath();
  for(let gx=sx;gx<=x1+sp;gx+=sp)
    for(let gy=sy;gy<=y1+sp;gy+=sp)
      bctx.rect(gx-r,gy-r,r*2,r*2);
  bctx.fill();
}

/* ── Snap-to-shape ── */
function getSnapAnchors(s) {
  if (s.type==='circle') {
    return [{x:s.cx+s.r,y:s.cy},{x:s.cx-s.r,y:s.cy},{x:s.cx,y:s.cy+s.r},{x:s.cx,y:s.cy-s.r}];
  }
  if (s.type==='ellipse') {
    const rx=Math.abs(s.x2-s.x1)/2, ry=Math.abs(s.y2-s.y1)/2;
    const cx=(s.x1+s.x2)/2, cy=(s.y1+s.y2)/2;
    return [{x:cx+rx,y:cy},{x:cx-rx,y:cy},{x:cx,y:cy+ry},{x:cx,y:cy-ry}];
  }
  if (s.type==='rect') {
    const lx=Math.min(s.x1,s.x2), ly=Math.min(s.y1,s.y2);
    const rx=Math.max(s.x1,s.x2), ry=Math.max(s.y1,s.y2);
    const mx=(lx+rx)/2, my=(ly+ry)/2;
    return [{x:lx,y:ly},{x:rx,y:ly},{x:rx,y:ry},{x:lx,y:ry},
            {x:mx,y:ly},{x:rx,y:my},{x:mx,y:ry},{x:lx,y:my}];
  }
  if (s.type==='diamond') {
    const cx=(s.x1+s.x2)/2, cy=(s.y1+s.y2)/2;
    const hw=Math.abs(s.x2-s.x1)/2, hh=Math.abs(s.y2-s.y1)/2;
    return [{x:cx,y:cy-hh},{x:cx+hw,y:cy},{x:cx,y:cy+hh},{x:cx-hw,y:cy},
            {x:cx+hw/2,y:cy-hh/2},{x:cx+hw/2,y:cy+hh/2},{x:cx-hw/2,y:cy+hh/2},{x:cx-hw/2,y:cy-hh/2}];
  }
  return [];
}

function snapToShapes(wx, wy) {
  const threshold = SNAP_DIST / vp.scale;
  let best=null, bestD2=threshold*threshold;
  for (const s of strokes) {
    for (const a of getSnapAnchors(s)) {
      const d2=(a.x-wx)**2+(a.y-wy)**2;
      if (d2<bestD2) { bestD2=d2; best=a; }
    }
  }
  return best ? {x:best.x,y:best.y,snapped:true} : {x:wx,y:wy,snapped:false};
}

/* ── Shape & line rendering ── */
function drawArrowHead(ctx, fx, fy, tx, ty, size) {
  const angle=Math.atan2(ty-fy,tx-fx), spread=0.42;
  ctx.beginPath();
  ctx.moveTo(tx,ty);
  ctx.lineTo(tx-size*Math.cos(angle-spread),ty-size*Math.sin(angle-spread));
  ctx.lineTo(tx-size*Math.cos(angle+spread),ty-size*Math.sin(angle+spread));
  ctx.closePath();
  ctx.fill();
}

// Draw rect/diamond/ellipse/line — ctx must already have viewport transform applied
function drawShapeStroke(ctx, type, x1, y1, x2, y2, color, w, arrows, snapPt) {
  ctx.strokeStyle=color; ctx.fillStyle=color;
  ctx.lineWidth=w; ctx.lineCap='round'; ctx.lineJoin='round';
  if (type==='rect') {
    const lx=Math.min(x1,x2),ly=Math.min(y1,y2),rw=Math.abs(x2-x1),rh=Math.abs(y2-y1);
    ctx.strokeRect(lx,ly,rw,rh);
  } else if (type==='diamond') {
    const cx=(x1+x2)/2,cy=(y1+y2)/2,hw=Math.abs(x2-x1)/2,hh=Math.abs(y2-y1)/2;
    ctx.beginPath();
    ctx.moveTo(cx,cy-hh); ctx.lineTo(cx+hw,cy); ctx.lineTo(cx,cy+hh); ctx.lineTo(cx-hw,cy);
    ctx.closePath(); ctx.stroke();
  } else if (type==='ellipse') {
    const rx=Math.abs(x2-x1)/2, ry=Math.abs(y2-y1)/2;
    if (rx<1||ry<1) return;
    ctx.beginPath();
    ctx.ellipse((x1+x2)/2,(y1+y2)/2,rx,ry,0,0,Math.PI*2);
    ctx.stroke();
  } else if (type==='line') {
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    const asz=Math.max(10,w*3.5);
    if (arrows===1||arrows===2) drawArrowHead(ctx,x1,y1,x2,y2,asz);
    if (arrows===2) drawArrowHead(ctx,x2,y2,x1,y1,asz);
    // snap indicator at current end
    if (snapPt) {
      const r=5/vp.scale;
      ctx.save(); ctx.globalAlpha=0.65;
      ctx.beginPath(); ctx.arc(snapPt.x,snapPt.y,r,0,Math.PI*2); ctx.fill();
      ctx.restore();
    }
  }
}

function renderStroke(ctx, s) {
  ctx.save();
  if (s.type==='text') {
    ctx.fillStyle=s.color;
    ctx.font=`${s.fs}px 'Lora',Georgia,serif`;
    s.text.split('\n').forEach((ln,i)=>ctx.fillText(ln,s.x,s.y+i*s.fs*1.35));
  } else if (s.type==='circle') {
    ctx.strokeStyle=s.color; ctx.lineWidth=s.w; ctx.lineCap='round';
    ctx.beginPath(); ctx.arc(s.cx,s.cy,s.r,0,Math.PI*2); ctx.stroke();
  } else if (SHAPE_TOOLS.has(s.type)) {
    drawShapeStroke(ctx,s.type,s.x1,s.y1,s.x2,s.y2,s.color,s.w,s.arrows||0,null);
  } else {
    ctx.strokeStyle=ctx.fillStyle=s.type==='eraser'?'#fff':s.color;
    ctx.lineWidth=s.w; ctx.lineCap='round'; ctx.lineJoin='round';
    const p=s.pts;
    if(!p?.length){ctx.restore();return;}
    if(p.length===1){ctx.beginPath();ctx.arc(p[0].x,p[0].y,s.w/2,0,Math.PI*2);ctx.fill();}
    else{
      ctx.beginPath(); ctx.moveTo(p[0].x,p[0].y);
      for(let i=1;i<p.length-1;i++)
        ctx.quadraticCurveTo(p[i].x,p[i].y,(p[i].x+p[i+1].x)/2,(p[i].y+p[i+1].y)/2);
      ctx.lineTo(p[p.length-1].x,p[p.length-1].y); ctx.stroke();
    }
  }
  ctx.restore();
}

function scheduleRedraw() {
  if(rafId) return;
  rafId=requestAnimationFrame(()=>{rafId=null;redrawBase();});
}
function redrawBase() {
  _repositionNotes();
  bctx.setTransform(1,0,0,1,0,0);
  bctx.fillStyle='#fff'; bctx.fillRect(0,0,base.width,base.height);
  applyVP(bctx); drawGrid();
  for(const s of strokes) renderStroke(bctx,s);
}

function drawCursorAt(sx,sy) {
  cctx.setTransform(1,0,0,1,0,0); cctx.clearRect(0,0,cur.width,cur.height);
  if(sx<0||sy<0) return;
  if(tool==='pen'){
    cctx.fillStyle=COLORS[ci];
    cctx.beginPath(); cctx.arc(sx*dpr,sy*dpr,5*dpr,0,Math.PI*2); cctx.fill();
  } else if(tool==='eraser'){
    const r=Math.max(8,ERASER_W[wi]*vp.scale/2);
    cctx.strokeStyle='rgba(80,80,80,.7)'; cctx.lineWidth=1.5*dpr;
    cctx.setLineDash([4*dpr,3*dpr]);
    cctx.beginPath(); cctx.arc(sx*dpr,sy*dpr,r*dpr,0,Math.PI*2); cctx.stroke();
  }
}
const setCursorStyle = t => {
  if (t==='text') live.style.cursor='text';
  else if (t==='hand') live.style.cursor='grab';
  else if (t==='sticky') live.style.cursor='crosshair';
  else if (SHAPE_TOOLS.has(t)) live.style.cursor='crosshair';
  else live.style.cursor='none';
};

function rdp(pts,eps) {
  if(pts.length<=2) return pts;
  const a=pts[0], b=pts[pts.length-1];
  const dx=b.x-a.x, dy=b.y-a.y, len2=dx*dx+dy*dy;
  let mx=0, mi=0;
  for(let i=1;i<pts.length-1;i++){
    const d=len2===0?Math.hypot(pts[i].x-a.x,pts[i].y-a.y)
      :Math.abs(dy*pts[i].x-dx*pts[i].y+b.x*a.y-b.y*a.x)/Math.sqrt(len2);
    if(d>mx){mx=d;mi=i;}
  }
  return mx>eps?[...rdp(pts.slice(0,mi+1),eps).slice(0,-1),...rdp(pts.slice(mi),eps)]:[a,b];
}
function simplify(s) {
  if(s.type==='text'||!s.pts||s.pts.length<=2) return s;
  return {...s,pts:rdp(s.pts,s.type==='eraser'?10:(RDP_EPS[PEN_W.indexOf(s.w)]??2))};
}

function detectCircle(pts) {
  const n=pts.length;
  if(n<12) return null;
  let cx=0,cy=0;
  for(const p of pts){cx+=p.x;cy+=p.y;}
  cx/=n; cy/=n;
  let sumD=0,sumD2=0,arcLen=0;
  const d=new Array(n);
  for(let i=0;i<n;i++){
    d[i]=Math.hypot(pts[i].x-cx,pts[i].y-cy); sumD+=d[i];
    if(i) arcLen+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);
  }
  const r=sumD/n;
  if(r<10) return null;
  for(let i=0;i<n;i++) sumD2+=(d[i]-r)**2;
  if(Math.sqrt(sumD2/n)/r>0.26||arcLen<Math.PI*r*1.5) return null;
  if(Math.hypot(pts[0].x-pts[n-1].x,pts[0].y-pts[n-1].y)>r*0.55) return null;
  return {cx,cy,r};
}

function animateCircleSnap(s,onDone) {
  const dur=340,start=performance.now();
  function frame(now) {
    const t=Math.min((now-start)/dur,1);
    const sp=t<0.65?(t/0.65)*1.06:1.06-((t-0.65)/0.35)*0.06;
    lctx.setTransform(1,0,0,1,0,0); lctx.clearRect(0,0,live.width,live.height);
    lctx.save(); applyVP(lctx);
    lctx.translate(s.cx,s.cy); lctx.scale(0.82+0.18*sp,0.82+0.18*sp); lctx.translate(-s.cx,-s.cy);
    lctx.globalAlpha=Math.min(t*4,1); lctx.strokeStyle=s.color; lctx.lineWidth=s.w; lctx.lineCap='round';
    lctx.beginPath(); lctx.arc(s.cx,s.cy,s.r,0,Math.PI*2); lctx.stroke();
    lctx.restore();
    t<1?requestAnimationFrame(frame):onDone();
  }
  requestAnimationFrame(frame);
}

const LS_KEY='cicada_v1';
function saveLS(){try{localStorage.setItem(LS_KEY,JSON.stringify({strokes,vp}));}catch{}}

function pushHistory() {
  undoStack=undoStack.slice(0,histIdx+1);
  undoStack.push(JSON.parse(JSON.stringify(strokes)));
  histIdx++; _updBtns(); saveLS();
}
function _updBtns() {
  BU.disabled=histIdx===0; BR.disabled=histIdx===undoStack.length-1;
}

const clearLive = () => { lctx.setTransform(1,0,0,1,0,0); lctx.clearRect(0,0,live.width,live.height); };

function appendLiveSeg(ctx,pts,color,width) {
  const n=pts.length;
  if(n<2) return;
  ctx.strokeStyle=ctx.fillStyle=color;
  ctx.lineWidth=width; ctx.lineCap='round'; ctx.lineJoin='round';
  ctx.beginPath();
  if(n===2){ctx.moveTo(pts[0].x,pts[0].y);ctx.lineTo(pts[1].x,pts[1].y);}
  else{
    const i=n-2,p0=pts[i-1]??pts[i];
    ctx.moveTo((p0.x+pts[i].x)/2,(p0.y+pts[i].y)/2);
    ctx.quadraticCurveTo(pts[i].x,pts[i].y,(pts[i].x+pts[i+1].x)/2,(pts[i].y+pts[i+1].y)/2);
  }
  ctx.stroke();
}

function commitStroke() {
  // Shape/line commit
  if (shapeStart && SHAPE_TOOLS.has(tool)) {
    const end=shapeEnd||shapeStart;
    const dx=end.x-shapeStart.x, dy=end.y-shapeStart.y;
    if (dx*dx+dy*dy>0.01) {
      const s=tool==='line'
        ? {type:'line',x1:shapeStart.x,y1:shapeStart.y,x2:end.x,y2:end.y,color:COLORS[ci],w:PEN_W[wi],arrows:arrowMode}
        : {type:tool,x1:shapeStart.x,y1:shapeStart.y,x2:end.x,y2:end.y,color:COLORS[ci],w:PEN_W[wi]};
      strokes=[...strokes,s]; pushHistory();
      renderStroke(bctx,s);
    }
    clearLive(); shapeStart=null; shapeEnd=null;
    return;
  }
  // Pen/eraser commit
  if(!drawPts.length) return;
  const isE=tool==='eraser', ew=isE?ERASER_W[wi]:PEN_W[wi];
  if(!isE){
    const c=detectCircle(drawPts);
    if(c){
      drawPts=[]; clearLive();
      const s={type:'circle',cx:c.cx,cy:c.cy,r:c.r,color:COLORS[ci],w:ew};
      animateCircleSnap(s,()=>{strokes=[...strokes,s];pushHistory();renderStroke(bctx,s);clearLive();});
      return;
    }
  }
  const s=simplify({type:isE?'eraser':'pen',color:COLORS[ci],w:ew,pts:drawPts});
  strokes=[...strokes,s]; pushHistory();
  if(!isE){renderStroke(bctx,s);clearLive();}
  drawPts=[];
}

function cancelStroke() {
  drawPts=[]; shapeStart=null; shapeEnd=null; clearLive();
  if(tool==='eraser') scheduleRedraw();
}

function startDraw(sx,sy) {
  isDrawing=true;
  if (SHAPE_TOOLS.has(tool)) {
    let p=s2w(sx,sy);
    if (tool==='line') { const sn=snapToShapes(p.x,p.y); p=sn; }
    shapeStart={x:p.x,y:p.y}; shapeEnd={x:p.x,y:p.y};
    return;
  }
  const p=s2w(sx,sy); drawPts=[p];
  const isE=tool==='eraser', ew=isE?ERASER_W[wi]:PEN_W[wi];
  const ctx=isE?bctx:lctx;
  applyVP(ctx);
  ctx.fillStyle=isE?'#fff':COLORS[ci];
  ctx.beginPath(); ctx.arc(p.x,p.y,ew/2,0,Math.PI*2); ctx.fill();
}

function continueDraw(sx,sy) {
  if(!isDrawing) return;
  if (SHAPE_TOOLS.has(tool)&&shapeStart) {
    let p=s2w(sx,sy);
    let snapPt=null;
    if (tool==='line') {
      const sn=snapToShapes(p.x,p.y);
      p=sn;
      if (sn.snapped) snapPt={x:sn.x,y:sn.y};
    }
    shapeEnd={x:p.x,y:p.y};
    clearLive();
    lctx.save(); applyVP(lctx);
    drawShapeStroke(lctx,tool,shapeStart.x,shapeStart.y,p.x,p.y,
                    COLORS[ci],PEN_W[wi],tool==='line'?arrowMode:0,snapPt);
    lctx.restore();
    return;
  }
  const p=s2w(sx,sy), last=drawPts[drawPts.length-1];
  const dsx=(p.x-last.x)*vp.scale, dsy=(p.y-last.y)*vp.scale;
  if(dsx*dsx+dsy*dsy<MIN_D2) return;
  drawPts.push(p);
  const isE=tool==='eraser';
  appendLiveSeg(isE?bctx:lctx,drawPts,isE?'#fff':COLORS[ci],isE?ERASER_W[wi]:PEN_W[wi]);
}

const endDraw = () => { if(isDrawing){isDrawing=false;commitStroke();} };

const activePointers = new Map();
let drawingPid=-1, pinchGest=null;

function _pairGest() {
  const it=activePointers.values();
  const a=it.next().value, b=it.next().value;
  if(!b) return null;
  return {mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},dist:Math.hypot(b.x-a.x,b.y-a.y)};
}

live.addEventListener('pointerdown', e=>{
  e.preventDefault();
  live.setPointerCapture(e.pointerId);
  activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const isMouse=e.pointerType==='mouse';
  if(isMouse&&e.button===1){
    if(isDrawing){cancelStroke();drawingPid=-1;}
    midPanning=true;panStart={x:e.clientX,y:e.clientY};vpAtPanStart={...vp};
    live.style.cursor='grabbing';return;
  }
  if(spaceDown&&isMouse&&e.button===0){
    if(isDrawing){cancelStroke();drawingPid=-1;}
    mousePanning=true;panStart={x:e.clientX,y:e.clientY};vpAtPanStart={...vp};
    live.style.cursor='grabbing';return;
  }
  if(tool==='hand'&&isMouse&&e.button===0){
    mousePanning=true;panStart={x:e.clientX,y:e.clientY};vpAtPanStart={...vp};
    live.style.cursor='grabbing';return;
  }
  if(activePointers.size>=2){
    if(isDrawing){cancelStroke();drawingPid=-1;}
    pinchGest=_pairGest();return;
  }
  if(pinchGest||(!isMouse&&false)||(isMouse&&e.button!==0)) return;
  if(tool==='text'){openTextInput(e.clientX,e.clientY);return;}
  if(tool==='sticky'){_addNote(e.clientX,e.clientY);return;}
  drawingPid=e.pointerId;
  startDraw(e.clientX,e.clientY);
});

live.addEventListener('pointermove', e=>{
  e.preventDefault();
  if(e.pointerType!=='touch'){curSX=e.clientX;curSY=e.clientY;drawCursorAt(curSX,curSY);}
  if(!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(mousePanning||midPanning){
    vp.x=vpAtPanStart.x+(e.clientX-panStart.x);
    vp.y=vpAtPanStart.y+(e.clientY-panStart.y);
    scheduleRedraw();return;
  }
  if(pinchGest&&activePointers.size>=2){
    const g=_pairGest();if(!g)return;
    const ns=Math.max(MIN_SCALE,Math.min(MAX_SCALE,vp.scale*g.dist/pinchGest.dist));
    const rf=ns/vp.scale;
    vp.x=pinchGest.mid.x-(pinchGest.mid.x-vp.x)*rf+(g.mid.x-pinchGest.mid.x);
    vp.y=pinchGest.mid.y-(pinchGest.mid.y-vp.y)*rf+(g.mid.y-pinchGest.mid.y);
    vp.scale=ns;pinchGest=g;
    ZH.textContent=Math.round(ns*100)+'%';
    scheduleRedraw();
    if(tool==='eraser') drawCursorAt(curSX,curSY);
    return;
  }
  if(isDrawing&&e.pointerId===drawingPid) continueDraw(e.clientX,e.clientY);
});

function _pointerEnd(e) {
  e.preventDefault();
  activePointers.delete(e.pointerId);
  if(mousePanning||midPanning){
    if(!e.buttons||e.button===1){
      mousePanning=midPanning=false;
      setCursorStyle(tool);
      if(spaceDown) live.style.cursor='grab';
    }
    return;
  }
  if(e.pointerId===drawingPid){drawingPid=-1;endDraw();return;}
  if(activePointers.size<2) pinchGest=null;
}
live.addEventListener('pointerup',_pointerEnd);
live.addEventListener('pointercancel',e=>{
  e.preventDefault();
  activePointers.delete(e.pointerId);
  if(e.pointerId===drawingPid){cancelStroke();drawingPid=-1;}
  if(activePointers.size<2) pinchGest=null;
  mousePanning=midPanning=false;
  setCursorStyle(tool);
});
live.addEventListener('pointerleave',e=>{
  if(!activePointers.has(e.pointerId)){curSX=-999;curSY=-999;drawCursorAt(-1,-1);}
});

live.addEventListener('wheel',e=>{
  e.preventDefault();
  if(isDrawing) return;
  if(e.ctrlKey||e.metaKey||tool==='hand') zoomAt(Math.pow(0.998,e.deltaY),e.clientX,e.clientY);
  else{vp.x-=e.deltaX*1.2;vp.y-=e.deltaY*1.2;ZH.textContent=Math.round(vp.scale*100)+'%';}
  scheduleRedraw();
  if(tool==='eraser'&&curSX>0) drawCursorAt(curSX,curSY);
},{passive:false});

document.addEventListener('keydown',e=>{
  if(ti.style.display==='block') return;
  if(document.activeElement?.closest('.sticky')) return;
  if(e.code==='Space'&&!spaceDown&&!isDrawing&&!e.repeat){spaceDown=true;e.preventDefault();live.style.cursor='grab';}
  const mod=e.ctrlKey||e.metaKey;
  if(mod&&e.key==='z'){e.preventDefault();BU.click();}
  if(mod&&(e.key==='y'||(e.shiftKey&&e.key==='Z'))){e.preventDefault();BR.click();}
  if(!mod&&!e.shiftKey){
    if(e.key==='p') $('btn-pen').click();
    if(e.key==='t') $('btn-text').click();
    if(e.key==='e') $('btn-eraser').click();
    if(e.key==='h') $('btn-hand').click();
    if(e.key==='r') _activateShapeTool('rect');
    if(e.key==='d') _activateShapeTool('diamond');
    if(e.key==='l') _activateShapeTool('line');
    if(e.key==='0'){vp.x=0;vp.y=0;vp.scale=1;ZH.textContent='100%';scheduleRedraw();}
  }
});
document.addEventListener('keyup',e=>{
  if(document.activeElement?.closest('.sticky')) return;
  if(e.code==='Space'){spaceDown=false;mousePanning=false;setCursorStyle(tool);}
});

let _txC=false;
function openTextInput(sx,sy) {
  const p=s2w(sx,sy), fs=FONT_SZ[wi], sfs=fs*vp.scale;
  ti.style.cssText=`display:block;left:${sx}px;top:${sy-sfs*.82}px;font-size:${sfs}px;color:${COLORS[ci]};height:auto;min-height:${sfs*1.35}px`;
  ti.value='';ti.dataset.wx=p.x;ti.dataset.wy=p.y;ti.dataset.fs=fs;ti.dataset.ci=ci;
  ti.focus();
}
ti.addEventListener('keydown',e=>{
  if(e.key==='Escape'){ti.style.display='none';return;}
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();commitText();return;}
  setTimeout(()=>{ti.style.height='auto';ti.style.height=ti.scrollHeight+'px';},0);
});
ti.addEventListener('blur',()=>{if(!_txC)commitText();});
function commitText() {
  if(_txC||ti.style.display==='none') return;
  _txC=true;ti.style.display='none';
  const txt=ti.value.trim();
  if(txt){
    const s={type:'text',text:txt,color:COLORS[+ti.dataset.ci],x:+ti.dataset.wx,y:+ti.dataset.wy,fs:+ti.dataset.fs};
    strokes=[...strokes,s];pushHistory();renderStroke(bctx,s);
  }
  _txC=false;
}

BU.addEventListener('click',()=>{if(histIdx>0){histIdx--;strokes=JSON.parse(JSON.stringify(undoStack[histIdx]));redrawBase();_updBtns();saveLS();}});
BR.addEventListener('click',()=>{if(histIdx<undoStack.length-1){histIdx++;strokes=JSON.parse(JSON.stringify(undoStack[histIdx]));redrawBase();_updBtns();saveLS();}});

function updateLineBtnTitle() {}

const TOOL_BTNS = ['pen','text','eraser','hand','sticky'].map(t=>$('btn-'+t));
TOOL_BTNS.forEach(btn=>{
  btn.addEventListener('click',()=>{
    const t=btn.id.slice(4);
    TOOL_BTNS.forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');
    tool=t;
    if(ti.style.display==='block') commitText();
    setCursorStyle(tool);
    drawCursorAt(curSX,curSY);
    _syncShapesBtn();
    _syncLineBtn();
  });
});
/* ── Color picker ── */
const _colorPicker=$('color-picker');
const _btnColor=$('btn-color');
const _colorDot=$('color-dot');

// Build color grid
COLORS.forEach((c,i)=>{
  const b=document.createElement('button');
  b.className='cb';
  b.style.background=c;
  b.title=c;
  b.dataset.ci=i;
  if(c==='#ffffff') b.style.boxShadow='inset 0 0 0 1px rgba(0,0,0,.15)';
  _colorPicker.appendChild(b);
});

function _syncColorBtn(){
  _colorDot.style.background=COLORS[ci];
}
_syncColorBtn();

function _openColorPicker(){
  const r=_btnColor.getBoundingClientRect();
  _colorPicker.style.bottom=(innerHeight-r.top+8)+'px';
  // keep within viewport
  let left=r.left+r.width/2-(_colorPicker.offsetWidth||172)/2;
  left=Math.max(8,Math.min(left,innerWidth-180));
  _colorPicker.style.left=left+'px';
  _colorPicker.classList.remove('sp-hidden');
  _colorPicker.querySelectorAll('.cb').forEach(b=>
    b.classList.toggle('on',+b.dataset.ci===ci));
}
function _closeColorPicker(){_colorPicker.classList.add('sp-hidden');}

_btnColor.addEventListener('click',()=>{
  if(_colorPicker.classList.contains('sp-hidden')) _openColorPicker();
  else _closeColorPicker();
});

_colorPicker.addEventListener('click',e=>{
  const b=e.target.closest('.cb');
  if(!b) return;
  ci=+b.dataset.ci;
  _colorPicker.querySelectorAll('.cb').forEach(x=>x.classList.toggle('on',+x.dataset.ci===ci));
  _syncColorBtn();
  if(ti.style.display==='block') ti.style.color=COLORS[ci];
  drawCursorAt(curSX,curSY);
  _closeColorPicker();
});

document.addEventListener('pointerdown',e=>{
  if(!_colorPicker.classList.contains('sp-hidden')&&
     !_colorPicker.contains(e.target)&&e.target!==_btnColor)
    _closeColorPicker();
},true);
const WIDTH_BTNS = document.querySelectorAll('.wb');
WIDTH_BTNS.forEach((b,i)=>{
  b.addEventListener('click',()=>{
    WIDTH_BTNS.forEach(x=>x.classList.remove('on'));
    b.classList.add('on');wi=i;
    drawCursorAt(curSX,curSY);
  });
});
$('zoom-hud').addEventListener('click',()=>{
  vp.x=0;vp.y=0;vp.scale=1;ZH.textContent='100%';
  scheduleRedraw();drawCursorAt(curSX,curSY);
});

/* ── Shape & line pickers ── */
const _shapePicker=$('shape-picker');
const _linePicker=$('line-picker');
const _btnShapes=$('btn-shapes');
const _btnLine=$('btn-line');

const _SP_ICONS={
  rect:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="1"/></svg>`,
  diamond:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,3 21,12 12,21 3,12"/></svg>`,
  ellipse:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="10" ry="6"/></svg>`,
  shapes:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>`,
  line0:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="20" x2="20" y2="4"/></svg>`,
  line1:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="20" x2="18" y2="6"/><polyline points="13,5 19,5 19,11"/></svg>`,
  line2:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="20" x2="20" y2="4"/><polyline points="15,5 20,4 19,10"/><polyline points="9,19 4,20 5,14"/></svg>`
};

function _syncShapesBtn(){
  const isShape=tool==='rect'||tool==='diamond'||tool==='ellipse';
  _btnShapes.innerHTML=isShape?_SP_ICONS[tool]:_SP_ICONS.shapes;
  _btnShapes.classList.toggle('on',isShape);
}
function _syncLineBtn(){
  _btnLine.innerHTML=tool==='line'?_SP_ICONS['line'+arrowMode]:_SP_ICONS.line0;
  _btnLine.classList.toggle('on',tool==='line');
}

function _closePickers(){
  _shapePicker.classList.add('sp-hidden');
  _linePicker.classList.add('sp-hidden');
}

function _openPicker(picker,anchorBtn){
  _closePickers();
  const r=anchorBtn.getBoundingClientRect();
  picker.style.bottom=(innerHeight-r.top+8)+'px';
  picker.style.left=r.left+'px';
  picker.classList.remove('sp-hidden');
  picker.querySelectorAll('.sp-item').forEach(b=>{
    const toolMatch=b.dataset.tool===tool;
    const arrowMatch=b.dataset.arrows===undefined||+b.dataset.arrows===arrowMode;
    b.classList.toggle('on',toolMatch&&arrowMatch);
  });
}

function _activateShapeTool(t,arrows){
  tool=t;
  if(t==='line'&&arrows!==undefined) arrowMode=arrows;
  TOOL_BTNS.forEach(b=>b.classList.remove('on'));
  _syncShapesBtn();
  _syncLineBtn();
  setCursorStyle(tool);
  drawCursorAt(curSX,curSY);
  _closePickers();
}

_btnShapes.addEventListener('click',()=>{
  if(_shapePicker.classList.contains('sp-hidden')) _openPicker(_shapePicker,_btnShapes);
  else _closePickers();
});
_btnLine.addEventListener('click',()=>{
  if(_linePicker.classList.contains('sp-hidden')) _openPicker(_linePicker,_btnLine);
  else _closePickers();
});

_shapePicker.querySelectorAll('.sp-item').forEach(btn=>{
  btn.addEventListener('click',()=>_activateShapeTool(btn.dataset.tool));
});
_linePicker.querySelectorAll('.sp-item').forEach(btn=>{
  btn.addEventListener('click',()=>_activateShapeTool('line',+btn.dataset.arrows));
});

document.addEventListener('pointerdown',e=>{
  if(!_shapePicker.classList.contains('sp-hidden')&&!_shapePicker.contains(e.target)&&e.target!==_btnShapes)
    _shapePicker.classList.add('sp-hidden');
  if(!_linePicker.classList.contains('sp-hidden')&&!_linePicker.contains(e.target)&&e.target!==_btnLine)
    _linePicker.classList.add('sp-hidden');
},true);

/* ── Sticky notes ── */
const LS_NOTES='cicada_notes_v1';
let _notes=[];
// note shape: {id, wx, wy, ww, wh, text, color}
// wx/wy = top-left corner in world coords; ww/wh = size in world coords

// [header bg, body bg]
const STICKY_THEMES=[
  ['#fde047','#fef9c3'], // yellow (default)
  ['#86efac','#dcfce7'], // green
  ['#93c5fd','#dbeafe'], // blue
  ['#f9a8d4','#fce7f3'], // pink
  ['#d8b4fe','#f3e8ff'], // purple
  ['#fdba74','#ffedd5'], // orange
];

function _saveNotes(){
  try{localStorage.setItem(LS_NOTES,JSON.stringify(_notes));}catch{}
}

// Convert world size to screen pixels
const _ws2s = v => v * vp.scale;
// Convert screen size to world units
const _ss2w = v => v / vp.scale;
// World point → screen point
const _wp2s = (wx, wy) => ({x: wx * vp.scale + vp.x, y: wy * vp.scale + vp.y});

function _repositionNotes(){
  document.querySelectorAll('.sticky').forEach(el=>{
    const id=+el.dataset.nid;
    const note=_notes.find(n=>n.id===id);
    if(!note) return;
    const sp=_wp2s(note.wx,note.wy);
    el.style.left=sp.x+'px';
    el.style.top=sp.y+'px';
    el.style.width=_ws2s(note.ww)+'px';
    el.style.height=_ws2s(note.wh)+'px';
  });
}

function _applyTheme(el, ci){
  const [hdr, body]=STICKY_THEMES[ci]||STICKY_THEMES[0];
  el.style.background=body;
  el.querySelector('.sticky-hdr').style.background=hdr;
  el.querySelectorAll('.sticky-swatch').forEach(sw=>sw.classList.toggle('on',+sw.dataset.sci===ci));
}

function _createStickyEl(note){
  const el=document.createElement('div');
  el.className='sticky';
  el.dataset.nid=note.id;
  const sp=_wp2s(note.wx,note.wy);
  el.style.cssText=`left:${sp.x}px;top:${sp.y}px;width:${_ws2s(note.ww)}px;height:${_ws2s(note.wh)}px`;

  // build palette swatches HTML
  const swatchesHtml=STICKY_THEMES.map(([hc],i)=>
    `<button class="sticky-swatch" data-sci="${i}" title="Color ${i+1}" style="background:${hc}"></button>`
  ).join('');

  el.innerHTML=`<div class="sticky-hdr"><div class="sticky-palette">${swatchesHtml}</div><button class="sticky-close" title="Delete">×</button></div><textarea class="sticky-ta" placeholder="Note…"></textarea><div class="sticky-rsz"></div>`;
  const ta=el.querySelector('.sticky-ta');
  ta.value=note.text||'';
  _applyTheme(el, note.color??0);

  // drag header
  const hdr=el.querySelector('.sticky-hdr');
  hdr.addEventListener('pointerdown',e=>{
    if(e.target.closest('.sticky-close')) return;
    e.preventDefault();
    hdr.style.cursor='grabbing';
    const startSP=_wp2s(note.wx,note.wy);
    const ox=e.clientX-startSP.x, oy=e.clientY-startSP.y;
    const onMove=ev=>{
      const sx=ev.clientX-ox, sy=ev.clientY-oy;
      note.wx=(sx-vp.x)/vp.scale; note.wy=(sy-vp.y)/vp.scale;
      el.style.left=sx+'px'; el.style.top=sy+'px';
    };
    const onUp=()=>{
      hdr.style.cursor='grab';
      document.removeEventListener('pointermove',onMove);
      document.removeEventListener('pointerup',onUp);
      _saveNotes();
    };
    document.addEventListener('pointermove',onMove);
    document.addEventListener('pointerup',onUp);
  });

  // resize handle
  const rsz=el.querySelector('.sticky-rsz');
  rsz.addEventListener('pointerdown',e=>{
    e.preventDefault();
    const sx=e.clientX, sy=e.clientY, sww=note.ww, swh=note.wh;
    const MIN_SW=_ss2w(160), MIN_SH=_ss2w(100);
    const onMove=ev=>{
      note.ww=Math.max(MIN_SW, sww+_ss2w(ev.clientX-sx));
      note.wh=Math.max(MIN_SH, swh+_ss2w(ev.clientY-sy));
      el.style.width=_ws2s(note.ww)+'px'; el.style.height=_ws2s(note.wh)+'px';
    };
    const onUp=()=>{
      document.removeEventListener('pointermove',onMove);
      document.removeEventListener('pointerup',onUp);
      _saveNotes();
    };
    document.addEventListener('pointermove',onMove);
    document.addEventListener('pointerup',onUp);
  });

  // text edit
  ta.addEventListener('input',()=>{note.text=ta.value;_saveNotes();});

  // color swatches
  el.querySelectorAll('.sticky-swatch').forEach(sw=>{
    sw.addEventListener('click',e=>{
      e.stopPropagation();
      note.color=+sw.dataset.sci;
      _applyTheme(el,note.color);
      _saveNotes();
    });
  });

  // close
  el.querySelector('.sticky-close').addEventListener('click',()=>{
    el.remove();
    _notes=_notes.filter(n=>n!==note);
    _saveNotes();
  });

  document.body.appendChild(el);
  return el;
}

function _addNote(sx, sy){
  // sx/sy are screen coords of the click; convert to world coords for top-left
  const wx=sx!==undefined?(sx-100-vp.x)/vp.scale:(innerWidth/2-100-vp.x)/vp.scale;
  const wy=sy!==undefined?(sy-14-vp.y)/vp.scale:(innerHeight/2-80-vp.y)/vp.scale;
  // store world size at scale=1 equivalent: 200px / scale so it looks ~200px at current zoom
  const ww=_ss2w(200), wh=_ss2w(160);
  const note={id:Date.now(),wx,wy,ww,wh,text:'',color:0};
  _notes.push(note);
  const el=_createStickyEl(note);
  _saveNotes();
  setTimeout(()=>el.querySelector('.sticky-ta').focus(),0);
}

// Load saved notes — migrate old screen-coord format (x/y/w/h) to world coords
(()=>{
  try{
    const saved=localStorage.getItem(LS_NOTES);
    if(saved){
      _notes=JSON.parse(saved).map(n=>{
        if(n.wx===undefined){
          // legacy: stored as screen pixels at scale=1
          return{id:n.id,wx:n.x??0,wy:n.y??0,ww:n.w??200,wh:n.h??160,text:n.text||'',color:n.color??0};
        }
        return n;
      });
      _notes.forEach(n=>_createStickyEl(n));
    }
  }catch{}
})();

// btn-sticky is managed as a TOOL_BTN — no separate click handler needed

/* ── Binary codec ──
   v3: LZ-compressed (legacy)   v4: plain+VP   v5: deflate+VP  (old flag byte: tc<<6|col<<3|wId)
   v6: plain+VP (new flag byte) v7: deflate+VP (new flag byte: tc<<5|col<<2|wId)
   New flag byte supports 8 type codes (3 bits):
     0=pen 1=eraser 2=text 3=circle 4=rect 5=diamond 6=ellipse 7=line
*/
function _vw(o,v){v=v>>>0;do{let b=v&127;v>>>=7;o.push(v?b|128:b)}while(v)}
function _zw(o,v){_vw(o,v>=0?v*2:(-v-1)*2+1)}
function _vr(b,p){let v=0,s=0;do{const x=b[p.i++];v|=(x&127)<<s;s+=7;if(!(x&128))break}while(1);return v>>>0}
function _zr(b,p){const v=_vr(b,p);return(v&1)?-((v+1)>>1):v>>1}

// Legacy decoder (v3/v4/v5) — unchanged
function decodeBody(bytes,hasVP) {
  const p={i:0};
  let rvp=null;
  if(hasVP){
    const su=bytes[p.i]|(bytes[p.i+1]<<8);p.i+=2;
    rvp={scale:su/1000,cx:_zr(bytes,p),cy:_zr(bytes,p)};
  }
  const count=bytes[p.i]|(bytes[p.i+1]<<8);p.i+=2;
  const ss=[];
  for(let si=0;si<count;si++){
    const flags=bytes[p.i++],tc=(flags>>6)&3,col=(flags>>3)&7,wId=flags&3;
    const color=COLORS[Math.min(col,COLORS.length-1)];
    const type=tc===1?'eraser':tc===2?'text':tc===3?'circle':'pen';
    if(type==='circle'){
      const cx=_zr(bytes,p),cy=_zr(bytes,p),r=_vr(bytes,p);
      ss.push({type:'circle',cx,cy,r,color,w:PEN_W[wId]||PEN_W[0]});
    }else if(type==='text'){
      const x=(bytes[p.i]|(bytes[p.i+1]<<8))-32768;p.i+=2;
      const y=(bytes[p.i]|(bytes[p.i+1]<<8))-32768;p.i+=2;
      const tl=_vr(bytes,p);
      const text=new TextDecoder().decode(bytes.slice(p.i,p.i+tl));p.i+=tl;
      ss.push({type:'text',text,color,x,y,fs:FONT_SZ[wId]||FONT_SZ[0]});
    }else{
      const ptc=bytes[p.i]|(bytes[p.i+1]<<8);p.i+=2;
      const pts=[];
      if(ptc>0){
        let x=(bytes[p.i]|(bytes[p.i+1]<<8))-32768;p.i+=2;
        let y=(bytes[p.i]|(bytes[p.i+1]<<8))-32768;p.i+=2;
        pts.push({x,y});
        for(let i=1;i<ptc;i++){x+=_zr(bytes,p);y+=_zr(bytes,p);pts.push({x,y});}
      }
      ss.push({type,color,w:type==='eraser'?(ERASER_W[wId]||ERASER_W[0]):(PEN_W[wId]||PEN_W[0]),pts});
    }
  }
  return{strokes:ss,vp:rvp};
}

// v6/v7 encoder
function encodeBodyV6(ss,viewport) {
  const out=[];
  if(viewport){
    const su=Math.round(viewport.scale*1000)&0xFFFF;
    out.push(su&255,su>>8);_zw(out,Math.round(viewport.cx));_zw(out,Math.round(viewport.cy));
  }
  out.push(ss.length&255,ss.length>>8);
  for(const s of ss){
    const tc=s.type==='eraser'?1:s.type==='text'?2:s.type==='circle'?3
             :s.type==='rect'?4:s.type==='diamond'?5:s.type==='ellipse'?6
             :s.type==='line'?7:0;
    const col=Math.max(0,COLORS.indexOf(s.color));
    const wId=s.type==='text'?Math.max(0,FONT_SZ.indexOf(s.fs))
              :s.type==='eraser'?Math.max(0,ERASER_W.indexOf(s.w))
              :Math.max(0,PEN_W.indexOf(s.w));
    out.push((tc<<5)|(col<<2)|(wId&3));
    if(s.type==='circle'){
      _zw(out,Math.round(s.cx));_zw(out,Math.round(s.cy));_vw(out,Math.max(0,Math.round(s.r)));
    }else if(s.type==='text'){
      const x=Math.max(0,Math.min(65535,Math.round(s.x)+32768));
      const y=Math.max(0,Math.min(65535,Math.round(s.y)+32768));
      out.push(x&255,x>>8,y&255,y>>8);
      const tb=new TextEncoder().encode((s.text||'').slice(0,500));
      _vw(out,tb.length);for(const b of tb)out.push(b);
    }else if(s.type==='rect'||s.type==='diamond'||s.type==='ellipse'){
      _zw(out,Math.round(s.x1));_zw(out,Math.round(s.y1));
      _zw(out,Math.round(s.x2));_zw(out,Math.round(s.y2));
    }else if(s.type==='line'){
      out.push(s.arrows||0);
      _zw(out,Math.round(s.x1));_zw(out,Math.round(s.y1));
      _zw(out,Math.round(s.x2));_zw(out,Math.round(s.y2));
    }else{
      const pts=s.pts||[];
      out.push(pts.length&255,pts.length>>8);
      if(!pts.length)continue;
      const x0=Math.max(0,Math.min(65535,Math.round(pts[0].x)+32768));
      const y0=Math.max(0,Math.min(65535,Math.round(pts[0].y)+32768));
      out.push(x0&255,x0>>8,y0&255,y0>>8);
      let px=Math.round(pts[0].x),py=Math.round(pts[0].y);
      for(let i=1;i<pts.length;i++){
        const x=Math.round(pts[i].x),y=Math.round(pts[i].y);
        _zw(out,x-px);_zw(out,y-py);px=x;py=y;
      }
    }
  }
  return new Uint8Array(out);
}

// v6/v7 decoder
function decodeBodyV6(bytes,hasVP) {
  const p={i:0};
  let rvp=null;
  if(hasVP){
    const su=bytes[p.i]|(bytes[p.i+1]<<8);p.i+=2;
    rvp={scale:su/1000,cx:_zr(bytes,p),cy:_zr(bytes,p)};
  }
  const count=bytes[p.i]|(bytes[p.i+1]<<8);p.i+=2;
  const ss=[];
  for(let si=0;si<count;si++){
    const flags=bytes[p.i++];
    const tc=(flags>>5)&7, col=(flags>>2)&7, wId=flags&3;
    const color=COLORS[Math.min(col,COLORS.length-1)];
    const type=tc===1?'eraser':tc===2?'text':tc===3?'circle'
               :tc===4?'rect':tc===5?'diamond':tc===6?'ellipse':tc===7?'line':'pen';
    if(type==='circle'){
      const cx=_zr(bytes,p),cy=_zr(bytes,p),r=_vr(bytes,p);
      ss.push({type:'circle',cx,cy,r,color,w:PEN_W[wId]||PEN_W[0]});
    }else if(type==='text'){
      const x=(bytes[p.i]|(bytes[p.i+1]<<8))-32768;p.i+=2;
      const y=(bytes[p.i]|(bytes[p.i+1]<<8))-32768;p.i+=2;
      const tl=_vr(bytes,p);
      const text=new TextDecoder().decode(bytes.slice(p.i,p.i+tl));p.i+=tl;
      ss.push({type:'text',text,color,x,y,fs:FONT_SZ[wId]||FONT_SZ[0]});
    }else if(type==='rect'||type==='diamond'||type==='ellipse'){
      const x1=_zr(bytes,p),y1=_zr(bytes,p),x2=_zr(bytes,p),y2=_zr(bytes,p);
      ss.push({type,x1,y1,x2,y2,color,w:PEN_W[wId]||PEN_W[0]});
    }else if(type==='line'){
      const arrows=bytes[p.i++];
      const x1=_zr(bytes,p),y1=_zr(bytes,p),x2=_zr(bytes,p),y2=_zr(bytes,p);
      ss.push({type:'line',x1,y1,x2,y2,color,w:PEN_W[wId]||PEN_W[0],arrows});
    }else{
      const ptc=bytes[p.i]|(bytes[p.i+1]<<8);p.i+=2;
      const pts=[];
      if(ptc>0){
        let x=(bytes[p.i]|(bytes[p.i+1]<<8))-32768;p.i+=2;
        let y=(bytes[p.i]|(bytes[p.i+1]<<8))-32768;p.i+=2;
        pts.push({x,y});
        for(let i=1;i<ptc;i++){x+=_zr(bytes,p);y+=_zr(bytes,p);pts.push({x,y});}
      }
      ss.push({type,color,w:type==='eraser'?(ERASER_W[wId]||ERASER_W[0]):(PEN_W[wId]||PEN_W[0]),pts});
    }
  }
  return{strokes:ss,vp:rvp};
}

const toB64u=b=>{let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')};
const fromB64u=s=>{const b=atob(s.replace(/-/g,'+').replace(/_/g,'/'));const r=new Uint8Array(b.length);for(let i=0;i<b.length;i++)r[i]=b.charCodeAt(i);return r};

async function tryDeflate(b){
  if(!('CompressionStream' in window))return{b,v:false};
  try{const cs=new CompressionStream('deflate-raw');const w=cs.writable.getWriter();w.write(b);w.close();const c=new Uint8Array(await new Response(cs.readable).arrayBuffer());return c.length<b.length?{b:c,v:true}:{b,v:false};}catch{return{b,v:false};}
}
async function tryInflate(b){
  if(!('DecompressionStream' in window))return b;
  try{const ds=new DecompressionStream('deflate-raw');const w=ds.writable.getWriter();w.write(b);w.close();return new Uint8Array(await new Response(ds.readable).arrayBuffer());}catch{return b;}
}

async function strokesToHash(ss) {
  const W=innerWidth,H=innerHeight;
  const body=encodeBodyV6(ss,{scale:vp.scale,cx:Math.round((-vp.x+W/2)/vp.scale),cy:Math.round((-vp.y+H/2)/vp.scale)});
  const{b:payload,v:deflated}=await tryDeflate(body);
  const full=new Uint8Array(2+payload.length);
  full[0]=0xAB;full[1]=deflated?7:6;full.set(payload,2);
  return toB64u(full);
}

async function hashToStrokes(hash) {
  try{
    const bytes=fromB64u(hash);
    if(bytes[0]===0xAB){
      const v=bytes[1];
      let body=bytes.slice(2);
      if(v===6||v===7){
        if(v===7)body=await tryInflate(body);
        return decodeBodyV6(body,true);
      }
      const hasVP=v===4||v===5;
      if(v===3||v===5)body=await tryInflate(body);
      return decodeBody(body,hasVP);
    }
  }catch(e){console.warn('bin:',e);}
  try{
    if(typeof LZString!=='undefined'){
      const json=LZString.decompressFromEncodedURIComponent(hash);
      if(json){
        const CV={'var(--c0)':'#363028','var(--c1)':'#C9A89A','var(--c2)':'#8FA89A','var(--c3)':'#8A9BAE','var(--c4)':'#C4B49A','var(--c5)':'#A898AE'};
        return{strokes:JSON.parse(json).map(s=>({...s,color:CV[s.color]||s.color||COLORS[0]})),vp:null};
      }
    }
  }catch(e){console.warn('lz:',e);}
  return null;
}

$('btn-export').addEventListener('click',()=>{
  const data=JSON.stringify({version:1,strokes,viewport:{scale:vp.scale,x:vp.x,y:vp.y},notes:_notes},null,2);
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([data],{type:'application/json'}));
  a.download='cicada-'+(new Date().toISOString().slice(0,10))+'.json';
  a.click(); URL.revokeObjectURL(a.href);
});

const _fileInput=$('file-input');
$('btn-import').addEventListener('click',()=>_fileInput.click());
_fileInput.addEventListener('change',e=>{
  const file=e.target.files[0]; if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const data=JSON.parse(ev.target.result);
      if(!Array.isArray(data.strokes)) throw new Error('invalid');
      strokes=data.strokes;
      if(data.viewport){vp.scale=data.viewport.scale;vp.x=data.viewport.x;vp.y=data.viewport.y;ZH.textContent=Math.round(vp.scale*100)+'%';}
      undoStack=[[],JSON.parse(JSON.stringify(strokes))];histIdx=1;
      redrawBase();_updBtns();saveLS();
      // restore notes
      document.querySelectorAll('.sticky').forEach(el=>el.remove());
      _notes=Array.isArray(data.notes)?data.notes:[];
      _notes.forEach(n=>_createStickyEl(n));
      _saveNotes();
      toast('Imported '+strokes.length+' stroke'+(strokes.length!==1?'s':'')+(data.notes?.length?' + '+data.notes.length+' note'+(data.notes.length!==1?'s':''):''));
    }catch{toast('Import failed: invalid file');}
  };
  reader.readAsText(file);
  _fileInput.value='';
});

$('btn-clear').addEventListener('click',()=>{
  strokes=[]; undoStack=[[]]; histIdx=0;
  vp={x:0,y:0,scale:1}; ZH.textContent='100%';
  localStorage.removeItem(LS_KEY);
  document.querySelectorAll('.sticky').forEach(el=>el.remove());
  _notes=[]; _saveNotes();
  redrawBase(); _updBtns();
  history.replaceState(null,'',location.pathname);
  toast('Canvas cleared');
});

$('btn-save').addEventListener('click',async()=>{
  const btn=$('btn-save');btn.disabled=true;btn.style.opacity='.25';
  try{
    const hash=await strokesToHash(strokes);
    const url=location.origin+location.pathname+'#'+hash;
    history.replaceState(null,'','#'+hash);
    await navigator.clipboard.writeText(url).catch(()=>{});
    toast(`Link copied · ${(hash.length*.75/1024).toFixed(1)} KB`);
  }catch(e){console.error(e);toast('Save failed');}
  finally{btn.disabled=false;btn.style.opacity='';}
});

let _tT;
function toast(msg){TT.textContent=msg;TT.classList.add('show');clearTimeout(_tT);_tT=setTimeout(()=>TT.classList.remove('show'),3000);}

function fitContent() {
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const s of strokes){
    if(s.type==='text'){x0=Math.min(x0,s.x);y0=Math.min(y0,s.y-s.fs);x1=Math.max(x1,s.x+200);y1=Math.max(y1,s.y+20);}
    else if(s.type==='circle'){x0=Math.min(x0,s.cx-s.r);y0=Math.min(y0,s.cy-s.r);x1=Math.max(x1,s.cx+s.r);y1=Math.max(y1,s.cy+s.r);}
    else if(SHAPE_TOOLS.has(s.type)){x0=Math.min(x0,s.x1,s.x2);y0=Math.min(y0,s.y1,s.y2);x1=Math.max(x1,s.x1,s.x2);y1=Math.max(y1,s.y1,s.y2);}
    else if(s.pts?.length)for(const p of s.pts){x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);}
  }
  if(x0===Infinity)return;
  const W=innerWidth,H=innerHeight,pad=80;
  vp.scale=Math.min(W/(x1-x0+pad*2),H/(y1-y0+pad*2),1);
  vp.x=(W-(x1-x0+pad*2)*vp.scale)/2-x0*vp.scale+pad*vp.scale;
  vp.y=(H-(y1-y0+pad*2)*vp.scale)/2-y0*vp.scale+pad*vp.scale;
  ZH.textContent=Math.round(vp.scale*100)+'%';
  scheduleRedraw();
}

(async()=>{
  resize();redrawBase();_updBtns();setCursorStyle('pen');
  const h=location.hash.slice(1);
  if(h){
    try{
      const result=await hashToStrokes(h);
      if(result?.strokes?.length){
        strokes=result.strokes;
        undoStack=[[],JSON.parse(JSON.stringify(strokes))];histIdx=1;
        if(result.vp){
          const W=innerWidth,H=innerHeight;
          vp.scale=result.vp.scale;
          vp.x=W/2-result.vp.cx*vp.scale;vp.y=H/2-result.vp.cy*vp.scale;
          ZH.textContent=Math.round(vp.scale*100)+'%';
        }else fitContent();
        redrawBase();_updBtns();
      }
    }catch(e){console.warn('load:',e);}
  }else{
    try{
      const saved=localStorage.getItem(LS_KEY);
      if(saved){
        const data=JSON.parse(saved);
        if(Array.isArray(data.strokes)&&data.strokes.length){
          strokes=data.strokes;
          undoStack=[[],JSON.parse(JSON.stringify(strokes))];histIdx=1;
          if(data.vp){vp.x=data.vp.x;vp.y=data.vp.y;vp.scale=data.vp.scale;ZH.textContent=Math.round(vp.scale*100)+'%';}
          redrawBase();_updBtns();
        }
      }
    }catch(e){console.warn('ls:',e);}
  }
})();
