(() => {
  'use strict';
  const data=MAP_DATA, $=id=>document.getElementById(id), esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const bounds=L.latLngBounds([data.bounds[1],data.bounds[0]],[data.bounds[3],data.bounds[2]]);
  const map=L.map('map',{zoomControl:false,attributionControl:true,minZoom:15,maxZoom:19,zoomSnap:.25,maxBounds:bounds.pad(.06),maxBoundsViscosity:1,doubleClickZoom:false});
  map.fitBounds(bounds,{padding:[24,80]});
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · ODbL');
  L.control.scale({imperial:false,position:'bottomleft',maxWidth:100}).addTo(map);
  L.control.zoom({position:'bottomright'}).addTo(map);
  const Home=L.Control.extend({options:{position:'bottomright'},onAdd(){const b=L.DomUtil.create('button','reset-view leaflet-bar');b.type='button';b.title='Show full pilot area';b.setAttribute('aria-label',b.title);b.innerHTML='<svg viewBox="0 0 20 20"><path d="M3 8V3h5m4 0h5v5m0 4v5h-5m-4 0H3v-5"/></svg>';L.DomEvent.disableClickPropagation(b);L.DomEvent.on(b,'click',()=>map.fitBounds(bounds,{padding:[24,80]}));return b;}});
  new Home().addTo(map);
  const pane=(name,z)=>{map.createPane(name);map.getPane(name).style.zIndex=z;};
  pane('ground',210);pane('roads',240);pane('walks',280);pane('flood',310);pane('closures',330);pane('names',350);pane('comparison',390);pane('route',410);
  const vectorOptions={interactive:false,smoothFactor:0};
  data.parks.forEach(p=>L.polygon(p,{...vectorOptions,pane:'ground',stroke:false,fillColor:'#dce8d2',fillOpacity:1}).addTo(map));
  data.water.forEach(p=>L.polygon(p,{...vectorOptions,pane:'ground',stroke:false,fillColor:'#b4d6da',fillOpacity:1}).addTo(map));
  data.buildings.forEach(b=>L.polygon(b.p,{...vectorOptions,pane:'ground',color:'#cdd5c8',weight:.8,fillColor:'#dce1d5',fillOpacity:.9}).addTo(map));
  data.roads.forEach(r=>{
    let width=10;
    if(['primary','trunk','motorway','motorway_link'].includes(r.kind))width=17;
    if(['service','residential','unclassified'].includes(r.kind))width=7;
    L.polyline(r.p,{...vectorOptions,pane:'roads',color:'#d8dfd3',weight:width+2,lineCap:'round'}).addTo(map);
    L.polyline(r.p,{...vectorOptions,pane:'roads',color:'#fcfcf6',weight:width,lineCap:'round'}).addTo(map);
  });
  data.rails.forEach(p=>L.polyline(p,{...vectorOptions,pane:'roads',color:'#bdc6bb',weight:1,dashArray:'3 5',opacity:.7}).addTo(map));
  const walkLayer=L.layerGroup().addTo(map);
  data.edges.forEach(e=>{
    const line=L.polyline([data.nodes[e.a],data.nodes[e.b]],{pane:'walks',color:'#9aaf8d',weight:2,opacity:.8});
    line.bindTooltip(esc(e.name),{className:'path-tooltip',sticky:true});
    line.addTo(walkLayer);
  });
  data.labels.forEach(label=>L.marker(label.p,{pane:'names',interactive:false,icon:L.divIcon({className:'road-name',html:'<span style="transform:rotate('+label.angle+'deg)">'+esc(label.name)+'</span>',iconSize:[150,15],iconAnchor:[75,7]})}).addTo(map));
  data.pois.forEach(p=>L.marker(p.p,{pane:'names',interactive:false,icon:L.divIcon({className:'poi',html:esc(p.name),iconSize:[105,40],iconAnchor:[52,20]})}).addTo(map));
  const floodLayer=L.layerGroup().addTo(map),closedLayer=L.layerGroup().addTo(map),baselineLayer=L.layerGroup().addTo(map),routeLayer=L.layerGroup().addTo(map),markerLayer=L.layerGroup().addTo(map);
  const state={mode:'start',scenario:'local',start:null,end:null,polygon:[],blocked:new Set(),baseline:null,result:null};
  let exampleCache=null,toastTimer;
  const fmt=d=>d>=1000?(d/1000).toFixed(2)+' km':Math.round(d)+' m';
  function toast(text){$('toast').textContent=text;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3200);}
  function instruction(text,error=false){$('instruction').textContent=text;$('instruction').classList.toggle('error',error);}
  function setMode(mode){state.mode=mode;['start','end'].forEach(k=>{$('set-'+k).classList.toggle('active',mode===k);$('set-'+k).setAttribute('aria-pressed',String(mode===k));});$('map').classList.add('selecting');$('map-instruction').textContent='Click anywhere to '+(mode==='start'?'set your start':'set your destination');}
  function renderFields(){
    ['start','end'].forEach(k=>{const p=state[k],el=$(k+'-value');el.classList.toggle('placeholder',!p);el.textContent=p?p.name:'Choose on the map';$(k+'-hint').textContent=p?(p.distance>1?'Snapped '+Math.round(p.distance)+' m to path':p.point[0].toFixed(5)+', '+p.point[1].toFixed(5)):'Any point → nearest walking path';});
    $('swap').disabled=!(state.start&&state.end);
    markerLayer.clearLayers();
    ['start','end'].forEach(k=>{
      const p=state[k];if(!p)return;
      const invalid=state.blocked.has(p.edge)||Routing.inPolygon(p.point,state.polygon);
      L.marker(p.point,{zIndexOffset:2000,icon:L.divIcon({className:'',html:'<span class="point-pin '+(k==='end'?'destination ':'')+(invalid?'invalid':'')+'">'+(k==='start'?'A':'B')+'</span>',iconSize:[31,31],iconAnchor:[15,15]})})
        .bindTooltip((k==='start'?'Start: ':'Destination: ')+esc(p.name),{direction:'top',offset:[0,-14],className:'path-tooltip'}).addTo(markerLayer);
    });
  }
  function drawRoute(){
    routeLayer.clearLayers();baselineLayer.clearLayers();
    if($('baseline').checked&&state.baseline&&state.scenario!=='none'){
      L.polyline(state.baseline.points,{...vectorOptions,pane:'comparison',color:'#fffef9',weight:7,opacity:.9}).addTo(baselineLayer);
      L.polyline(state.baseline.points,{...vectorOptions,pane:'comparison',color:'#848d96',weight:3,dashArray:'6 7',opacity:.9}).addTo(baselineLayer);
    }
    if(state.result){
      L.polyline(state.result.points,{...vectorOptions,pane:'route',color:'#fffef9',weight:9,opacity:1,lineCap:'round',lineJoin:'round'}).addTo(routeLayer);
      L.polyline(state.result.points,{...vectorOptions,pane:'route',color:'#16845e',weight:5,opacity:1,lineCap:'round',lineJoin:'round'}).addTo(routeLayer);
    }
  }
  function calculate(){
    state.result=null;state.baseline=null;renderFields();
    $('result').classList.remove('error');
    if(!state.start||!state.end){
      $('result-status').textContent='Ready to plan';$('result-main').innerHTML='<p class="result-empty">'+(state.start?'Choose your destination':'Where are you heading?')+'</p>';
      $('result-detail').textContent='Select two points. The route will follow mapped walking paths.';drawRoute();return;
    }
    const invalidStart=state.blocked.has(state.start.edge)||Routing.inPolygon(state.start.point,state.polygon),invalidEnd=state.blocked.has(state.end.edge)||Routing.inPolygon(state.end.point,state.polygon);
    if(invalidStart||invalidEnd){
      setMode(invalidStart?'start':'end');
      $('result').classList.add('error');$('result-status').textContent='Point on a closed path';$('result-main').innerHTML='<p class="result-empty">Choose another '+(invalidStart?'start':'destination')+'.</p>';
      $('result-detail').textContent='The selected point is on a path closed by the current simulated flood.';
      instruction('Select a new '+(invalidStart?'start':'destination')+' outside the closed paths.',true);drawRoute();return;
    }
    state.baseline=Routing.route(data,state.start,state.end);
    state.result=Routing.route(data,state.start,state.end,state.blocked);
    if(!state.result){
      $('result').classList.add('error');$('result-status').textContent='No available route';$('result-main').innerHTML='<p class="result-empty">No route in this area.</p>';
      $('result-detail').textContent='The simulated flood disconnects these points within the demo network. Try other points or another scenario.';
      instruction('No available route in the demo area.',true);drawRoute();return;
    }
    const extra=Math.max(0,state.result.distance-(state.baseline?.distance||0));
    $('result-status').textContent=state.scenario==='none'?'Walking route found':'Route avoids closed paths';
    const length=state.result.distance>=1000?(state.result.distance/1000).toFixed(2):Math.round(state.result.distance);
    const walkMinutes=Math.ceil(state.result.distance/4000*60);
    $('result-main').innerHTML='<div class="distance-line"><span class="distance-number">'+length+'</span><span class="distance-unit">'+(state.result.distance>=1000?'km':'metres')+' walking</span></div>'+
      '<div class="walking-time" title="Estimated at 4 km/h, excluding crossing waits."><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.2"/><path d="M10 5.5v4.8l3.2 2"/></svg><span>Estimated walk <strong>'+walkMinutes+' min</strong></span></div>';
    $('result-detail').textContent=state.scenario==='none'?'Shortest route on the selected walking network.':extra>1?'+'+fmt(extra)+' compared with no flooding. All selected route segments avoid simulated closures.':'This route remains available in the current simulated scenario.';
    instruction(state.result.distance<1?'Start and destination are at the same location.':'Route updated. Click a field to move either point.');
    drawRoute();
  }
  function changeScenario(mode){
    state.scenario=mode;state.polygon=Routing.polygon(data,mode);state.blocked=Routing.blockedEdges(data,state.polygon);
    document.querySelectorAll('[data-scenario]').forEach(b=>{b.classList.toggle('active',b.dataset.scenario===mode);b.setAttribute('aria-pressed',String(b.dataset.scenario===mode));});
    floodLayer.clearLayers();closedLayer.clearLayers();
    if(state.polygon.length){
      L.polygon(state.polygon,{...vectorOptions,pane:'flood',color:'#63a9cc',weight:1.5,dashArray:'5 5',fillColor:'#8ac9e1',fillOpacity:.38}).addTo(floodLayer);
      const position=mode==='local'?[data.floodCentre[0]+.00048,data.floodCentre[1]]:[data.floodCentre[0]+.00155,data.floodCentre[1]];
      L.marker(position,{pane:'names',interactive:false,icon:L.divIcon({className:'flood-label',html:'Simulated flood',iconSize:[130,16],iconAnchor:[65,8]})}).addTo(floodLayer);
    }
    state.blocked.forEach(i=>{const e=data.edges[i];L.polyline([data.nodes[e.a],data.nodes[e.b]],{...vectorOptions,pane:'closures',color:'#bd624b',weight:3,opacity:.9}).addTo(closedLayer);});
    $('scenario-note').textContent=mode==='none'?'All mapped walking paths are available. Compare this route with a flood scenario.':mode==='local'?'A simulated flood near Whiteman & Clarendon closes '+state.blocked.size+' path segments.':'A larger, irregular simulated flood covers nearby streets and closes '+state.blocked.size+' path segments.';
    calculate();
  }
  function pick(latlng){
    const p=[latlng.lat,latlng.lng];
    if(!bounds.contains(latlng)){toast('Choose a point inside the pilot area.');return;}
    if(Routing.inPolygon(p,state.polygon)){toast('This point is inside the simulated flood. Choose outside it.');return;}
    const selected=Routing.snap(data,p);
    if(!selected)return;
    if(state.blocked.has(selected.edge)||Routing.inPolygon(selected.point,state.polygon)){toast('The nearest walking path is closed. Please choose another point.');return;}
    state[state.mode]=selected;
    const wasStart=state.mode==='start';
    calculate();
    if(wasStart&&!state.end){setMode('end');instruction('Now click the map to choose your destination.');}
    if(selected.distance>12)toast('Point moved '+Math.round(selected.distance)+' m to the nearest mapped walking path.');
  }
  map.on('click',e=>pick(e.latlng));
  $('set-start').onclick=()=>{setMode('start');instruction('Click the map to '+(state.start?'move':'choose')+' your start.');};
  $('set-end').onclick=()=>{setMode('end');instruction('Click the map to '+(state.end?'move':'choose')+' your destination.');};
  $('swap').onclick=()=>{[state.start,state.end]=[state.end,state.start];calculate();};
  $('reset').onclick=()=>{state.start=null;state.end=null;changeScenario('local');setMode('start');instruction('Click the map to choose your start.');map.fitBounds(bounds,{padding:[24,80]});};
  $('baseline').onchange=drawRoute;
  document.querySelectorAll('[data-scenario]').forEach(b=>b.onclick=()=>changeScenario(b.dataset.scenario));
  function loadExample(){
    exampleCache=exampleCache||data.example||Routing.example(data);
    if(!exampleCache){toast('Please select a start and destination on the map.');return;}
    state.start={...exampleCache.start};state.end={...exampleCache.end};
    changeScenario('local');setMode('end');
    instruction('Example loaded. Switch scenarios to compare routes.');
    map.fitBounds(bounds,{padding:[24,80]});
  }
  $('example').onclick=loadExample;
  $('source-stats').textContent='OSM snapshot: '+data.sourceDate+' · '+data.nodes.length+' walking nodes · '+data.edges.length+' path segments. Short disconnected path fragments are omitted. Source geometry has not been independently surveyed.';
  $('about').onclick=()=>$('about-dialog').showModal();$('close-about').onclick=()=>$('about-dialog').close();
  $('about-dialog').onclick=e=>{if(e.target===$('about-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}};
  changeScenario('local');setMode('start');
  // Expose read-only accessors for a lightweight smoke check and future iteration.
  window.SouthbankDemo={map,data,state,Routing,loadExample,changeScenario};
})();
