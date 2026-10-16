"""Package the downloaded map snapshot and local app as one offline HTML."""
from pathlib import Path
import collections
import json
import math
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
BOUNDS = [144.9540, -37.8288, 144.9630, -37.8220]
root = ET.parse(HERE / 'southbank.osm').getroot()
nodes = {n.attrib['id']: [float(n.attrib['lat']), float(n.attrib['lon'])]
         for n in root.findall('node')}


def tags(element):
    return {t.attrib['k']: t.attrib['v'] for t in element.findall('tag')}


def inside(p):
    return BOUNDS[0] <= p[1] <= BOUNDS[2] and BOUNDS[1] <= p[0] <= BOUNDS[3]


def xy(p):
    return [p[1] * 111320 * math.cos(math.radians(-37.825)), p[0] * 111320]


def distance(a, b):
    ax, ay = xy(a)
    bx, by = xy(b)
    return math.hypot(ax - bx, ay - by)


def closest_distance(p, a, b):
    px, py = xy(p)
    ax, ay = xy(a)
    bx, by = xy(b)
    den = (bx - ax) ** 2 + (by - ay) ** 2
    t = max(0, min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / den)) if den else 0
    return math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay))


def intersects_box(points):
    return (min(p[1] for p in points) <= BOUNDS[2] and max(p[1] for p in points) >= BOUNDS[0]
            and min(p[0] for p in points) <= BOUNDS[3] and max(p[0] for p in points) >= BOUNDS[1])


ways = []
for w in root.findall('way'):
    ids = [n.attrib['ref'] for n in w.findall('nd')]
    if any(n not in nodes for n in ids):
        continue
    ways.append((w.attrib['id'], tags(w), ids, [nodes[n] for n in ids]))

roads, buildings, parks, water, rails = [], [], [], [], []
named_roads = []
for wid, t, ids, points in ways:
    if len(points) < 2 or not intersects_box(points):
        continue
    hw = t.get('highway', '')
    if hw and hw not in ('footway', 'path', 'steps', 'cycleway', 'corridor', 'services') and t.get('area') != 'yes':
        road = {'p': points, 'kind': hw, 'name': t.get('name', '')}
        roads.append(road)
        if road['name']:
            named_roads.append(road)
    if ids[0] == ids[-1]:
        if 'building' in t:
            buildings.append({'p': points, 'name': t.get('name', '')})
        elif t.get('natural') == 'water' or t.get('waterway') == 'dock':
            water.append(points)
        elif t.get('leisure') in ('park', 'garden', 'playground') or t.get('landuse') in ('grass', 'recreation_ground'):
            parks.append(points)
    if t.get('railway') in ('tram', 'light_rail', 'rail'):
        rails.append(points)

raw_edges = []
adj = collections.defaultdict(set)
for wid, t, ids, points in ways:
    hw, foot = t.get('highway', ''), t.get('foot', '')
    allowed = hw in ('footway', 'path', 'pedestrian', 'steps') or (hw == 'cycleway' and foot in ('yes', 'designated', 'permissive'))
    if not allowed or t.get('area') == 'yes' or t.get('indoor') == 'yes' or foot in ('no', 'private', 'customers'):
        continue
    if t.get('access') in ('no', 'private', 'customers') and foot not in ('yes', 'designated', 'permissive'):
        continue
    for a, b in zip(ids, ids[1:]):
        if a == b or not inside(nodes[a]) or not inside(nodes[b]) or distance(nodes[a], nodes[b]) < .03:
            continue
        raw_edges.append((a, b, t, wid))
        adj[a].add(b)
        adj[b].add(a)

seen, components = set(), []
for n in adj:
    if n in seen:
        continue
    todo, component = [n], set([n])
    seen.add(n)
    while todo:
        for v in adj[todo.pop()]:
            if v not in seen:
                seen.add(v)
                component.add(v)
                todo.append(v)
    components.append(component)
main = max(components, key=len)
node_ids = sorted(main, key=int)
node_index = {n: i for i, n in enumerate(node_ids)}
edges, seen_edges = [], set()
for a, b, t, wid in raw_edges:
    if a not in main or b not in main:
        continue
    key = tuple(sorted((a, b)))
    if key in seen_edges:
        continue
    seen_edges.add(key)
    mid = [(nodes[a][0] + nodes[b][0]) / 2, (nodes[a][1] + nodes[b][1]) / 2]
    nearest = min(named_roads, key=lambda road: min(closest_distance(mid, u, v) for u, v in zip(road['p'], road['p'][1:])))
    name = t.get('name') or ('Crossing · ' if t.get('footway') == 'crossing' else 'Path near ') + nearest['name']
    edges.append({'a': node_index[a], 'b': node_index[b], 'd': round(distance(nodes[a], nodes[b]), 3),
                  'name': name, 'way': wid, 'kind': t.get('footway', t['highway'])})

labels = []
for name in sorted({r['name'] for r in named_roads}):
    candidates = []
    for road in named_roads:
        if road['name'] != name:
            continue
        for a, b in zip(road['p'], road['p'][1:]):
            mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
            if inside(mid):
                candidates.append((distance(a, b), a, b, mid))
    if not candidates:
        continue
    length, a, b, mid = max(candidates)
    if length < 35 or name in ('West Gate Freeway', 'Kings Way'):
        continue
    ax, ay = xy(a)
    bx, by = xy(b)
    angle = math.degrees(math.atan2(-(by - ay), bx - ax))
    if angle > 90:
        angle -= 180
    if angle < -90:
        angle += 180
    labels.append({'p': mid, 'name': name, 'angle': round(angle, 2)})

poi_names = {'Crown Melbourne', 'Crown Metropol Hotel', 'Crown Promenade Hotel', 'The Tea House',
             'Southbank Police Station', 'Clarendon Towers', 'Boyd Community Hub', 'Boyd Community Park'}
pois = []
for wid, t, ids, points in ways:
    if t.get('name') in poi_names:
        # Use the footprint's bounding centre, avoiding repeated ring end points.
        mid = [(min(p[0] for p in points) + max(p[0] for p in points)) / 2,
               (min(p[1] for p in points) + max(p[1] for p in points)) / 2]
        if inside(mid):
            pois.append({'p': mid, 'name': t['name']})

source_meta = json.loads((HERE / 'map-source.json').read_text(encoding='utf-8'))
data = {'bounds': BOUNDS, 'nodes': [nodes[n] for n in node_ids], 'edges': edges,
        'roads': roads, 'buildings': buildings, 'parks': parks, 'water': water, 'rails': rails,
        'labels': labels, 'pois': pois, 'sourceDate': source_meta['downloadedOn'],
        'floodCentre': [-37.825213, 144.957006]}
if (HERE / 'example.json').exists():
    data['example'] = json.loads((HERE / 'example.json').read_text(encoding='utf-8'))
payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
css = (HERE / 'leaflet.css').read_text(encoding='utf-8')
# All marker artwork is an inline div; the default image icons are never used.
css = css.replace('url(images/layers.png)', 'none').replace('url(images/layers-2x.png)', 'none').replace('url(images/marker-icon.png)', 'none')
js = (HERE / 'leaflet.js').read_text(encoding='utf-8')
js = '\n'.join(line for line in js.splitlines() if 'sourceMappingURL=' not in line)
html = (HERE / 'index.template.html').read_text(encoding='utf-8')
html = html.replace('/*__LEAFLET_CSS__*/', css).replace('/*__LEAFLET_JS__*/', js)
html = html.replace('/*__DATA__*/', 'const MAP_DATA = ' + payload + ';')
html = html.replace('/*__ROUTER__*/', (HERE / 'routing.js').read_text(encoding='utf-8'))
html = html.replace('/*__APP__*/', (HERE / 'app.js').read_text(encoding='utf-8'))
html = html.replace('<!--__LEAFLET_LICENSE__-->', '<!--\n' + (HERE / 'LEAFLET-LICENSE.txt').read_text(encoding='utf-8') + '\n-->')
out = HERE.parent / 'southbank-flood-demo.html'
out.write_text(html, encoding='utf-8')
(HERE / 'map-data.json').write_text(payload.replace('<\\/', '</'), encoding='utf-8')
print(json.dumps({'file': str(out), 'bytes': out.stat().st_size, 'nodes': len(node_ids), 'edges': len(edges),
                  'buildings': len(buildings), 'roads': len(roads), 'water': len(water)}, ensure_ascii=False))
