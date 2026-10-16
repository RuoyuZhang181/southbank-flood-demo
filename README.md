# Southbank FloodRoute Demo

A small, offline pedestrian route-planning prototype for Southbank, Melbourne.
Built for the ENGR90051 Team 4Q project, with AI assistance in implementation.

The map uses real OpenStreetMap geometry. **All flood areas are simulated.**
Routes and crossings have not been independently verified by a field walk.

## Try the demo

1. Click **Code → Download ZIP** on GitHub and extract the folder.
2. Open **southbank-flood-demo.html** in Chrome or Edge.
3. Click **Load example journey**, or select your own start and destination on the map.

No internet, installation, server or API key is required to run the HTML.
GitHub's normal file view displays the code; download the HTML to run it.
A `127.0.0.1` preview address only works on the computer running that preview.

## Features

- Click anywhere in the pilot area; the selected point snaps to the nearest mapped walking path.
- Calculate a shortest walking route using Dijkstra's algorithm.
- Compare **No flooding**, **Local flood** and a larger irregular **Expanded** flood.
- Close every walking segment that touches the simulated flood footprint.
- Show a clear message for a closed endpoint or a disconnected journey.
- Compare the selected route with the route without flooding.
- Show distance and estimated walking time at an assumed 4 km/h, rounded up to whole minutes; crossing waits are excluded.
- Run from a single HTML file with the map, data and Leaflet library embedded.

## Edit and rebuild

To edit or add features, work in `prototype-source`:

| File | Purpose |
| --- | --- |
| `index.template.html` | Interface, labels, layout and styles |
| `app.js` | Map display, point selection, scenario controls and route results |
| `routing.js` | Route algorithm, path snapping and flood polygons |
| `build_demo.py` | Prepare the walking graph and package a standalone HTML |
| `southbank.osm` | Original map snapshot |
| `map-source.json` | Map provenance and snapshot date |
| `example.json` | Example start and destination for the current graph |
| `leaflet.js`, `leaflet.css` | Local Leaflet 1.9.4 dependency |

After changing a source file, install Python 3 if needed, then run this from the repository folder:

```sh
python prototype-source/build_demo.py
```

On Windows, `py -3 prototype-source/build_demo.py` is an alternative.
The build uses only Python's standard library; no `pip install` is required.
It replaces `southbank-flood-demo.html`. Reopen or refresh that file to see changes.
Rebuilding uses the included map snapshot and does not download new map data.

If you replace the map snapshot or change the graph bounds/filtering, update the provenance and regenerate or remove `example.json`, because its edge references belong to the current graph.

## Team collaboration

- Anyone can download this public repository or create a fork.
- To push directly to this repository, the owner must invite the teammate as a collaborator.
- Use a separate branch for changes, then open a pull request for review.
- Include the rebuilt HTML when updating source, so teammates can still download and run the current demo.
- The repository does not automatically publish a website or enable GitHub Pages.

## 中文使用说明

### 直接使用

在 GitHub 点击 **Code → Download ZIP**，解压后双击 `southbank-flood-demo.html`，使用 Chrome 或 Edge 打开即可。完全离线，无需安装 Python 或其他软件。

- 点 **Load example journey** 加载示例。
- 切换 **No flooding / Local flood / Expanded** 比较不同情景。
- 点 **Reset journey** 后，依次点击地图选择起点和终点。
- 点击位置会吸附到附近的步行路径，路线以吸附后的位置为准。
- 若起终点被洪水覆盖，重新选点；若路网被切断，页面显示无可用路线。

### 修改功能

修改 `prototype-source` 中的源码，再运行：

```sh
python prototype-source/build_demo.py
```

这会重新生成根目录的 HTML。只修改源码不会自动更新旧 HTML。
运行 Demo 不需要 Python；修改后重新打包才需要 Python 3。

公开仓库允许所有人查看和下载，但不代表所有人都可以直接上传修改。组员可以通过 Fork 和 Pull Request 提交改动，或由仓库所有者邀请为协作者。

## Data and attribution

© OpenStreetMap contributors, ODbL 1.0. Snapshot downloaded on 16 October 2026.
Leaflet 1.9.4 uses the BSD 2-Clause licence.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the included Leaflet licence.

This is a demonstration of routing logic under simulated closures. A route result does not establish safety during a real flood; a no-route result refers only to the included demo network.
