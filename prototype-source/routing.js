/* Routing over mapped OSM footpaths. Flood geometry is a simulated hard closure. */
const Routing = (() => {
  const SCALE_Y = 111320, SCALE_X = 111320 * Math.cos(-37.825 * Math.PI / 180);
  const xy = p => [p[1] * SCALE_X, p[0] * SCALE_Y];
  const dist = (a, b) => Math.hypot((a[0] - b[0]) * SCALE_Y, (a[1] - b[1]) * SCALE_X);
  function project(p, a, b) {
    const q = xy(p), u = xy(a), v = xy(b), dx = v[0] - u[0], dy = v[1] - u[1];
    const t = Math.max(0, Math.min(1, ((q[0] - u[0]) * dx + (q[1] - u[1]) * dy) / (dx * dx + dy * dy || 1)));
    const point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    return {point, t, distance: dist(p, point)};
  }
  function snap(data, p) {
    let best = null;
    data.edges.forEach((e, i) => {
      const q = project(p, data.nodes[e.a], data.nodes[e.b]);
      if (!best || q.distance < best.distance) best = {...q, edge: i, name: e.name};
    });
    return best;
  }
  const cross = (a, b, c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  function onSegment(a, b, p) {
    return Math.abs(cross(a,b,p)) < 1e-9 && p[0] >= Math.min(a[0],b[0])-1e-7 && p[0] <= Math.max(a[0],b[0])+1e-7 && p[1] >= Math.min(a[1],b[1])-1e-7 && p[1] <= Math.max(a[1],b[1])+1e-7;
  }
  function segmentIntersects(a,b,c,d) {
    const abC=cross(a,b,c), abD=cross(a,b,d), cdA=cross(c,d,a), cdB=cross(c,d,b);
    return ((abC > 0 && abD < 0 || abC < 0 && abD > 0) && (cdA > 0 && cdB < 0 || cdA < 0 && cdB > 0)) || onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b);
  }
  function inPolygon(p, polygon) {
    if (!polygon || !polygon.length) return false;
    const q=xy(p), ring=polygon.map(xy);
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
      const a=ring[j],b=ring[i];
      if(onSegment(a,b,q)) return true;
      if((a[1]>q[1])!==(b[1]>q[1]) && q[0]<(b[0]-a[0])*(q[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
    }
    return inside;
  }
  function touchesFlood(a,b,polygon) {
    if(!polygon || !polygon.length) return false;
    if(inPolygon(a,polygon)||inPolygon(b,polygon)) return true;
    const u=xy(a),v=xy(b),r=polygon.map(xy);
    return r.some((p,i)=>segmentIntersects(u,v,p,r[(i+1)%r.length]));
  }
  function polygon(data, mode) {
    if(mode==='none') return [];
    const c=data.floodCentre;
    if(mode==='expanded') {
      // Illustrative pooled-water footprint, in metres east/north of the junction.
      // The lobes are a scenario design, not the output of a flood model.
      let outline=[[-120,-85],[-100,-150],[-30,-142],[10,-178],[85,-155],
        [100,-103],[160,-80],[142,-23],[210,5],[200,75],[135,83],
        [105,140],[42,122],[5,160],[-40,130],[-80,145],[-93,92],
        [-160,70],[-142,15],[-180,-23],[-153,-65]];
      // Round the boundary without introducing random shapes on each refresh.
      for(let round=0;round<2;round++){
        const next=[];
        outline.forEach((a,i)=>{const b=outline[(i+1)%outline.length];
          next.push([.75*a[0]+.25*b[0],.75*a[1]+.25*b[1]],
                    [.25*a[0]+.75*b[0],.25*a[1]+.75*b[1]]);
        });
        outline=next;
      }
      return outline.map(([east,north])=>[c[0]+north/SCALE_Y,c[1]+east/SCALE_X]);
    }
    return Array.from({length:48},(_,i)=>{
      const angle=i*Math.PI/24;
      return [c[0]+50*Math.sin(angle)/SCALE_Y,c[1]+50*Math.cos(angle)/SCALE_X];
    });
  }
  function blockedEdges(data, poly) {
    const blocked=new Set();
    if(poly.length) data.edges.forEach((e,i)=>{if(touchesFlood(data.nodes[e.a],data.nodes[e.b],poly)) blocked.add(i);});
    return blocked;
  }
  class Heap {
    constructor(){this.a=[];}
    push(value){const a=this.a;a.push(value);let i=a.length-1;while(i){let p=(i-1)>>1;if(a[p][0]<=value[0])break;a[i]=a[p];i=p;}a[i]=value;}
    pop(){const a=this.a,root=a[0],end=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1][0]<a[j][0])j++;if(a[j][0]>=end[0])break;a[i]=a[j];i=j;}a[i]=end;}return root;}
  }
  function route(data, start, end, blocked=new Set()) {
    if(!start||!end) return null;
    if(blocked.has(start.edge)||blocked.has(end.edge)) return null;
    const count=data.nodes.length, s=count,t=count+1,points=[...data.nodes,start.point,end.point];
    const adj=Array.from({length:count+2},()=>[]);
    const add=(a,b,d,edge)=>{adj[a].push([b,d,edge]);adj[b].push([a,d,edge]);};
    data.edges.forEach((e,i)=>{
      if(blocked.has(i)) return;
      const parts=[{t:0,id:e.a},{t:1,id:e.b}];
      if(start.edge===i) parts.push({t:start.t,id:s});
      if(end.edge===i) parts.push({t:end.t,id:t});
      parts.sort((a,b)=>a.t-b.t);
      for(let j=1;j<parts.length;j++) add(parts[j-1].id,parts[j].id,(parts[j].t-parts[j-1].t)*e.d,i);
    });
    const ds=new Float64Array(count+2).fill(Infinity),prev=new Int32Array(count+2).fill(-1),prevEdge=new Int32Array(count+2).fill(-1),heap=new Heap();
    ds[s]=0;heap.push([0,s]);
    while(heap.a.length){const [d,u]=heap.pop();if(d>ds[u]+1e-8)continue;if(u===t)break;for(const [v,w,e] of adj[u]){if(d+w+1e-8<ds[v]){ds[v]=d+w;prev[v]=u;prevEdge[v]=e;heap.push([ds[v],v]);}}}
    if(!Number.isFinite(ds[t])) return null;
    const ids=[],edges=[];
    for(let u=t;u!==-1;u=prev[u]){ids.push(u);if(prevEdge[u]>=0)edges.push(prevEdge[u]);}
    ids.reverse();edges.reverse();
    return {points:ids.map(i=>points[i]),distance:ds[t],edges};
  }
  function example(data) {
    const blocked=blockedEdges(data,polygon(data,'local')),c=data.floodCentre;
    const candidates=data.edges.map((e,i)=>({edge:i,t:.5,point:[(data.nodes[e.a][0]+data.nodes[e.b][0])/2,(data.nodes[e.a][1]+data.nodes[e.b][1])/2],name:e.name,distance:0}))
      .filter(p=>!blocked.has(p.edge)&&dist(p.point,c)>85&&dist(p.point,c)<330);
    const west=candidates.filter(p=>p.point[1]<c[1]-.0005).filter((_,i)=>i%3===0).slice(0,35);
    const east=candidates.filter(p=>p.point[1]>c[1]+.0005).filter((_,i)=>i%4===0).slice(0,35);
    let best=null;
    for(const a of west) for(const b of east){
      const normal=route(data,a,b),flood=route(data,a,b,blocked);
      if(!normal||!flood||!normal.edges.some(e=>blocked.has(e)))continue;
      const extra=flood.distance-normal.distance;
      const score=extra-Math.abs(normal.distance-320)*.2;
      if(extra>25&&(!best||score>best.score))best={start:a,end:b,normal:normal.distance,flood:flood.distance,score};
    }
    return best;
  }
  return {xy,dist,snap,project,inPolygon,touchesFlood,polygon,blockedEdges,route,example};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=Routing;
