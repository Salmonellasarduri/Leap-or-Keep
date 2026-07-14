// holo.js — Phase 2: ホロ盤面(リアルタイム3D)
// 設計: docs/design-phase2-holo.md
// 原則: DOM盤面は透明ヒット面として温存し、CSS投影(perspective:1050px + rotateX(--tilt))と
//       数学的に同一のカメラで盤とコマだけを3D描画する。ロジック(LOGIC区間)には一切触れない。
// 失敗はすべて呼び出し側の try/catch(holoKill)が拾い、DOM盤面へ劣化する。
import * as THREE from "./vendor/three/three.module.min.js";

// ---- パレット(Sol指針: ティール基調・明シアンはリム/選択のみ・アンバー・コーラルは局所) ----
const COL = {
  tileBase:   0x0d2226, tileDim: 0x081418,
  selOk:      0x1f7a78, selOkHi: 0x2ea9a5, hover: 0x49c9c4,
  threat:     0x5a1a26, threatHi: 0x7a2430,
  charge:     0x6a4a1a, flare: 0x5a3d14,
  blocked:    0x1a1016, well: 0x241a42, // wellは面を暗めに(識別は回転リングと DOM 🌀 が担う — Sol #5 面α抑制)
  grid:       0x2e8e91, frame: 0x73d8d5,
  player:     0x73d8d5, playerBody: 0x2e8e91,
  enemy:      0xe7a85b, enemyBody: 0x8a5a2a,
  danger:     0xd85c45, hazard: 0x5a6a72,
  boss:       0xff5470,
};
const TAU = Math.PI * 2;

// イージング
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeOutBack = t => { const s = 1.25; const u = t - 1; return 1 + (s + 1) * u * u * u + s * u * u; }; // 慣性オーバーシュート
const easeInQuad = t => t * t;

export function createHolo(ctx) {
  const { dbg, LK, ui, onFatal } = ctx;
  const GRID = LK.CONFIG.GRID;
  const DIRS = LK.DIRS;

  // ---- renderer(eager生成: 失敗はここで投げて呼び出し側の catch → __holoFailed) ----
  const canvas = document.createElement("canvas");
  canvas.id = "holo-canvas";
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;

  // R21: コンテキストロスト → 即DOM復帰(致命扱いにはしない: restoredで復帰を試みる)
  let ctxLost = false;
  canvas.addEventListener("webglcontextlost", e => {
    e.preventDefault(); ctxLost = true;
    document.body.classList.remove("holo");
    stopLoop();
    try { window.__holoFailed = true; } catch (_) {}
  }, false);
  canvas.addEventListener("webglcontextrestored", () => {
    ctxLost = false; needsBuild = true;
    try { sync(); } catch (e) { onFatal && onFatal(e); }
  }, false);

  const scene = new THREE.Scene();
  const boardGroup = new THREE.Group(); // 原点=盤中心、y上向き(scene座標)。rotation.xでtilt再現
  scene.add(boardGroup);
  const camera = new THREE.PerspectiveCamera(40, 1, 100, 2400);
  camera.matrixAutoUpdate = true;

  // ---- キャリブレーション状態 ----
  const calib = {
    cell: 92, gap: 5, padX: 11, padY: 11, // pad=padding+border(border-box左上からセル群までの距離)
    bx: 0, by: 0, bw: 0, bh: 0,           // #board のboardwrapローカル配置(untransformed)
    canL: 0, canT: 0, canW: 0, canH: 0,   // canvas のboardwrapローカル矩形
    ox: 0, oy: 0,                         // 盤中心(boardwrapローカル)
    tiltDeg: 0, zh: 212,
  };
  const BLEED = 64, BLEED_BOT = 44;

  // 盤ローカル(border-box左上原点, y下向きpx) → boardGroupローカル(盤中心原点, y上向き)
  function bl(lx, ly, z) { return new THREE.Vector3(lx - calib.bw / 2, -(ly - calib.bh / 2), z || 0); }
  function cellLocal(x, y) { // セル中心の盤ローカルpx
    return { x: calib.padX + x * (calib.cell + calib.gap) + calib.cell / 2,
             y: calib.padY + y * (calib.cell + calib.gap) + calib.cell / 2 };
  }
  function cellPos(x, y, z) { const c = cellLocal(x, y); return bl(c.x, c.y, z); }

  function calibrate(board, wrapEl) {
    const cellEl = board.querySelector(".cell");
    if (!cellEl) return false;
    const bs = getComputedStyle(board);
    calib.cell = parseFloat(getComputedStyle(cellEl).width) || 92;
    calib.gap = parseFloat(bs.gap) || 5;
    calib.padX = (parseFloat(bs.paddingLeft) || 10) + (parseFloat(bs.borderLeftWidth) || 1);
    calib.padY = (parseFloat(bs.paddingTop) || 10) + (parseFloat(bs.borderTopWidth) || 1);
    calib.bx = board.offsetLeft; calib.by = board.offsetTop;
    calib.bw = board.offsetWidth; calib.bh = board.offsetHeight;
    calib.ox = calib.bx + calib.bw / 2; calib.oy = calib.by + calib.bh / 2;
    calib.tiltDeg = board.classList.contains("tilt")
      ? (parseFloat(bs.getPropertyValue("--tilt")) || 34) : 0;
    calib.zh = parseFloat(board.style.getPropertyValue("--zh")) || 212;

    // canvas 矩形(boardwrapローカル)
    calib.canL = calib.bx - BLEED; calib.canT = calib.by - BLEED;
    calib.canW = calib.bw + BLEED * 2; calib.canH = calib.bh + BLEED + BLEED_BOT;
    canvas.style.left = calib.canL + "px"; canvas.style.top = calib.canT + "px";
    canvas.style.width = calib.canW + "px"; canvas.style.height = calib.canH + "px";
    // R5: shakeクラス用に回転中心を盤中心へ
    canvas.style.transformOrigin = (calib.ox - calib.canL) + "px " + (calib.oy - calib.canT) + "px";
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(calib.canW, calib.canH, false);

    // R1: tiltはワールド回転で再現(φ = -θ: CSS rotateX正=上辺が奥へ)
    boardGroup.rotation.x = -calib.tiltDeg * Math.PI / 180;

    // カメラ: 視点=(perspective-origin, +1050)、視線は-z。非対称視錐台をmakePerspectiveで手組み(R2)
    const d = 1050, near = 100, far = 2400;
    const ex = wrapEl.offsetWidth / 2 - calib.ox;   // scene座標(盤中心原点, y上向き)
    const ey = -(wrapEl.offsetHeight / 2 - calib.oy);
    camera.position.set(ex, ey, d);
    camera.rotation.set(0, 0, 0);
    const sL = calib.canL - calib.ox, sR = calib.canL + calib.canW - calib.ox;
    const sT = -(calib.canT - calib.oy), sB = -(calib.canT + calib.canH - calib.oy);
    const k = near / d;
    camera.projectionMatrix.makePerspective((sL - ex) * k, (sR - ex) * k, (sT - ey) * k, (sB - ey) * k, near, far);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.updateMatrixWorld(true);
    boardGroup.updateMatrixWorld(true);
    return true;
  }

  // boardGroupローカル点 → boardwrapローカルpx(検証・デバッグ用)
  function projectLocal(v3) {
    const v = v3.clone();
    boardGroup.localToWorld(v);
    v.project(camera);
    return { x: (v.x + 1) / 2 * calib.canW + calib.canL, y: (1 - (v.y + 1) / 2) * calib.canH + calib.canT };
  }

  // R24: セル4隅の3D投影bbox vs DOMセルrect bbox(閾値2.5px)
  function calibCheck() {
    const board = document.getElementById("board");
    const wrapEl = document.getElementById("boardwrap");
    if (!board || !wrapEl || !active) return { ok: false, reason: "inactive" };
    const wr = wrapEl.getBoundingClientRect();
    let maxErr = 0; const G = GRID;
    for (const [cx, cy] of [[0, 0], [G - 1, 0], [0, G - 1], [G - 1, G - 1], [(G - 1) >> 1, (G - 1) >> 1]]) {
      const el = board.querySelector(`[data-xy="${cx},${cy}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const dom = { l: r.left - wr.left, t: r.top - wr.top, r: r.right - wr.left, b: r.bottom - wr.top };
      const c = cellLocal(cx, cy), h = calib.cell / 2;
      let l = 1e9, t = 1e9, rr = -1e9, b = -1e9;
      for (const [ox, oy] of [[-h, -h], [h, -h], [-h, h], [h, h]]) {
        const p = projectLocal(bl(c.x + ox, c.y + oy, 0));
        l = Math.min(l, p.x); rr = Math.max(rr, p.x); t = Math.min(t, p.y); b = Math.max(b, p.y);
      }
      maxErr = Math.max(maxErr, Math.abs(l - dom.l), Math.abs(t - dom.t), Math.abs(rr - dom.r), Math.abs(b - dom.b));
    }
    return { ok: maxErr <= 2.5, maxErr: +maxErr.toFixed(2), tilt: calib.tiltDeg };
  }

  // ---- タイル(InstancedMesh 1draw) ----
  let tileMesh = null, gridLines = null, frameLine = null, wellRing = null;
  let needsBuild = true;
  // Phase 2.5: 井戸(投影ボリューム)の環境オブジェクト
  const env = { objs: [], stars: [], nebula: null, plate: null, lastZh: -1 };

  // Canvas生成テクスチャ(外部アセットゼロ方針)
  function makeTex(w, h, draw) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const tileState = []; // per index {base:Color, pulse:0|1(sel/cue), hot:0..1(flash減衰), kind}
  const _c = new THREE.Color(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);

  function roundedRectGeo(w, h, r) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2 + r, -h / 2);
    s.lineTo(w / 2 - r, -h / 2); s.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0);
    s.lineTo(w / 2, h / 2 - r); s.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2);
    s.lineTo(-w / 2 + r, h / 2); s.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI);
    s.lineTo(-w / 2, -h / 2 + r); s.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5);
    return new THREE.ShapeGeometry(s, 6);
  }

  function buildBoard() {
    for (const o of [tileMesh, gridLines, frameLine, wellRing]) if (o) { boardGroup.remove(o); o.geometry.dispose(); o.material.dispose(); }
    for (const o of env.objs) { boardGroup.remove(o); if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }
    env.objs = []; env.stars = []; env.nebula = null; env.plate = null; env.lastZh = -1;
    const n = GRID * GRID;
    const geo = roundedRectGeo(calib.cell - 6, calib.cell - 6, 9);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.62, depthWrite: false }); // Sol R2: 面は薄く
    tileMesh = new THREE.InstancedMesh(geo, mat, n);
    tileMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    tileState.length = 0;
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const i = y * GRID + x;
      _m.compose(cellPos(x, y, 0), _q, _s);
      tileMesh.setMatrixAt(i, _m);
      tileMesh.setColorAt(i, _c.setHex(COL.tileBase));
      tileState.push({ base: new THREE.Color(COL.tileBase), pulse: 0, hot: 0, raise: 0 });
    }
    boardGroup.add(tileMesh);

    // グリッド線+外周フレーム(加算)
    const pts = [];
    const x0 = calib.padX - 2, y0 = calib.padY - 2;
    const x1 = calib.padX + GRID * calib.cell + (GRID - 1) * calib.gap + 2, y1 = y0 + (x1 - x0);
    for (let i = 1; i < GRID; i++) {
      const gx = calib.padX + i * calib.cell + (i - .5) * calib.gap;
      pts.push(bl(gx, y0, 1), bl(gx, y1, 1), bl(x0, calib.padY + i * calib.cell + (i - .5) * calib.gap, 1), bl(x1, calib.padY + i * calib.cell + (i - .5) * calib.gap, 1));
    }
    gridLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: COL.grid, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false })); // Sol R2: 内側線は控えめ
    boardGroup.add(gridLines);
    const fr = [bl(x0, y0, 1), bl(x1, y0, 1), bl(x1, y0, 1), bl(x1, y1, 1), bl(x1, y1, 1), bl(x0, y1, 1), bl(x0, y1, 1), bl(x0, y0, 1)];
    frameLine = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(fr),
      new THREE.LineBasicMaterial({ color: COL.frame, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    boardGroup.add(frameLine);
    // 四隅の投影点(Sol #3: 「どこから投影されているか」の接地情報)
    const dotGeo = new THREE.CircleGeometry(2.6, 12);
    const dotMat = new THREE.MeshBasicMaterial({ color: COL.frame, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const [cx, cy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.copy(bl(cx, cy, 1.5));
      frameLine.add(dot); // frameLineと一緒にdispose/removeされるよう子に
    }

    // 重力渦リング(位置はsyncで)
    wellRing = new THREE.Mesh(
      new THREE.RingGeometry(calib.cell * 0.18, calib.cell * 0.34, 24, 1, 0, Math.PI * 1.62),
      new THREE.MeshBasicMaterial({ color: 0x9a7ae8, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    wellRing.visible = false;
    boardGroup.add(wellRing);

    buildSpaceWell(x0, y0, x1, y1);
    needsBuild = false;
  }

  // ---- Phase 2.5: 投影井戸 — 「卓の上に宇宙が現出している」体積表現 ----
  // 井戸プレート(2D背景のかぶりを遮断) + 星屑3層 + ゾーン星雲 + 四隅の投影光柱
  function buildSpaceWell(x0, y0, x1, y1) {
    const W = x1 - x0, H = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const add = o => { env.objs.push(o); boardGroup.add(o); return o; };

    // 1) 井戸プレート: 深部の不透明底(feather縁のCanvasテクスチャ) — 課題①「後ろの2Dかぶり」の根治
    const plateTex = makeTex(256, 256, (g, w, h) => {
      const r = 26, f = 20; // 角丸とfeather幅
      g.clearRect(0, 0, w, h);
      // feathered rounded rect: 外周をぼかしたグラデで塗る
      g.filter = `blur(${f / 2}px)`; // 未対応環境では無視される(縁が硬くなるだけ)
      g.fillStyle = "#040b10";
      g.beginPath();
      if (g.roundRect) g.roundRect(f, f, w - f * 2, h - f * 2, r);
      else g.rect(f, f, w - f * 2, h - f * 2); // roundRect未対応(旧Safari)は角丸なしで劣化
      g.fill();
      g.filter = "none";
      // 中心をわずかに青緑へ(完全な黒潰れ禁止 — Sol暗部3段階)
      const rad = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
      rad.addColorStop(0, "rgba(10,26,32,0.5)"); rad.addColorStop(1, "rgba(4,11,16,0)");
      g.globalCompositeOperation = "source-atop"; g.fillStyle = rad; g.fillRect(0, 0, w, h);
    });
    env.plate = add(new THREE.Mesh(
      new THREE.PlaneGeometry(W * 1.14, H * 1.14),
      new THREE.MeshBasicMaterial({ map: plateTex, transparent: true, opacity: 0.94, depthWrite: false })));
    env.plate.position.copy(bl(cx, cy, -58));
    env.plate.renderOrder = -4;

    // 2) 星屑3層(井戸の中に沈む多層パララックス。緩慢ドリフト)
    const starSpecs = [
      { n: 80, z: -14, size: 2.0, op: 0.8, speed: 2.4 },
      { n: 55, z: -30, size: 1.6, op: 0.55, speed: 1.4 },
      { n: 38, z: -46, size: 1.2, op: 0.35, speed: 0.8 },
    ];
    for (const sp of starSpecs) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(sp.n * 3);
      for (let i = 0; i < sp.n; i++) {
        pos[i * 3] = x0 + Math.random() * W; pos[i * 3 + 1] = y0 + Math.random() * H; pos[i * 3 + 2] = sp.z;
      }
      // 盤ローカル(y下向き)で生成→scene系へはbl()と同じ変換を頂点側で行う
      for (let i = 0; i < sp.n; i++) { pos[i * 3] -= calib.bw / 2; pos[i * 3 + 1] = -(pos[i * 3 + 1] - calib.bh / 2); }
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0xbfe0e8, size: sp.size, transparent: true, opacity: sp.op,
        blending: THREE.AdditiveBlending, depthWrite: false }));
      pts.renderOrder = -2;
      pts.frustumCulled = false;
      env.stars.push({ pts, ...sp, x0: x0 - calib.bw / 2, w: W, yTop: -(y0 - calib.bh / 2) });
      add(pts);
    }

    // 3) ゾーン星雲(色相はsyncでcalib.zhから着色)
    const nebTex = makeTex(256, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (const [bx, by, br, a] of [[0.38, 0.42, 0.34, 0.5], [0.62, 0.58, 0.28, 0.4], [0.52, 0.36, 0.2, 0.3]]) {
        const rad = g.createRadialGradient(w * bx, h * by, 4, w * bx, h * by, w * br);
        rad.addColorStop(0, `rgba(255,255,255,${a})`); rad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = rad; g.fillRect(0, 0, w, h);
      }
    });
    env.nebula = add(new THREE.Mesh(
      new THREE.PlaneGeometry(W * 0.96, H * 0.96),
      new THREE.MeshBasicMaterial({ map: nebTex, transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false })));
    env.nebula.position.copy(bl(cx, cy, -38));
    env.nebula.renderOrder = -3;

    // 4) 四隅の投影光柱(卓の中から盤へ — 「どこから投影されているか」)
    const beamMat = new THREE.MeshBasicMaterial({ color: COL.frame, transparent: true, opacity: 0.08, // Sol最終研磨: 盤外周との接続感
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beamGeo = new THREE.CylinderGeometry(1.1, 4.2, 58, 6, 1, true);
    for (const [bx, by] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      const beam = add(new THREE.Mesh(beamGeo, beamMat));
      beam.rotation.x = Math.PI / 2; // Y軸筒→Z軸(盤法線)
      beam.position.copy(bl(bx, by, -28));
      beam.renderOrder = -1;
    }
  }

  // 被弾時の投影乱れ(課題②の「投影されている実在感」— 位置ジッタは使わない=DOMラベル剥離回避)
  let disturbUntil = 0, disturbAmp = 0;
  function disturb(amp) { disturbAmp = Math.max(disturbAmp, amp); disturbUntil = performance.now() + 200; }

  // ---- コマ ----
  const units = new Map(); // id -> {group, body, glow, gx, gy, tween, ghost, type, side, charging, raise}
  function pieceSpec(u) {
    const t = u.type, boss = /apex|juggernaut|broodmother/.test(t);
    const mk = (geo, color, h) => ({ geo, color, h });
    switch (t) {
      case "ship":    return mk(new THREE.ConeGeometry(15, 24, 4), COL.player, 24);
      case "drone":   return mk(new THREE.OctahedronGeometry(10), COL.player, 20);
      case "miner":   return mk(new THREE.BoxGeometry(13, 13, 13), COL.enemy, 18);
      case "pirate":  return mk(new THREE.TetrahedronGeometry(13), COL.enemy, 18);
      case "jelly":   return mk(new THREE.SphereGeometry(11, 10, 8), COL.enemy, 20);
      case "hunter":  return mk(new THREE.ConeGeometry(8, 22, 3), COL.enemy, 22);
      case "sentinel":return mk(new THREE.CylinderGeometry(8, 11, 20, 6), COL.danger, 20);
      case "warden":  return mk(new THREE.BoxGeometry(19, 10, 14), COL.enemy, 14);
      case "splitter":return mk(new THREE.IcosahedronGeometry(11), COL.enemy, 20);
      case "larva":   return mk(new THREE.TetrahedronGeometry(7), COL.enemy, 12);
      case "mender":  return mk(new THREE.TorusGeometry(8, 2.6, 6, 14), COL.enemy, 16);
      case "blinker": return mk(new THREE.OctahedronGeometry(11), 0xb08ae8, 20);
      case "bomber":  return mk(new THREE.SphereGeometry(9, 8, 6), COL.danger, 16);
      case "apex":    return mk(new THREE.OctahedronGeometry(17), COL.boss, 30);
      case "juggernaut": return mk(new THREE.BoxGeometry(22, 15, 17), COL.boss, 22);
      case "broodmother": return mk(new THREE.SphereGeometry(15, 10, 8), COL.boss, 26);
      case "debris":  return mk(new THREE.DodecahedronGeometry(11), COL.hazard, 18);
      case "mine":    return mk(new THREE.OctahedronGeometry(9), COL.danger, 14);
      default:        return mk(new THREE.ConeGeometry(10, 18, 5), boss ? COL.boss : COL.enemy, 18);
    }
  }
  function heightScale() { return calib.tiltDeg ? 1 : 0.35; } // R8: フラット時は低浮彫り

  function makeUnit(u) {
    // Sol R2処方: 「半透明の樹脂模型」→「輝線で再構成された投影体」
    // 内側=陣営色の薄い面(α0.16-0.22) + 1.035倍のBackSide加算シアン外殻(α0.48)
    const spec = pieceSpec(u);
    const group = new THREE.Group();
    const hs = heightScale();
    const zTop = spec.h / 2 * hs + 2;
    const body = new THREE.Mesh(spec.geo,
      new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.2, depthWrite: false }));
    body.rotation.x = Math.PI / 2; // +Y軸ジオメトリを盤法線(+Z)へ
    body.scale.z = hs;
    body.position.z = zTop;
    group.add(body);
    const shell = new THREE.Mesh(spec.geo,
      new THREE.MeshBasicMaterial({ color: COL.player, transparent: true, opacity: 0.48,
        side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    shell.rotation.x = Math.PI / 2;
    shell.scale.set(1.035, 1.035, hs * 1.035);
    shell.position.z = zTop;
    group.add(shell);
    const isPlayer = u.side === "player";
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(calib.cell * 0.28, 20),
      new THREE.MeshBasicMaterial({ color: isPlayer ? COL.player : (u.side === "hazard" ? COL.hazard : COL.enemy),
        transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.z = 0.8;
    group.add(glow);
    let edges = null;
    if (isPlayer) { // 自機はさらに輪郭線(明シアンはリム限定のSol指針)
      edges = new THREE.LineSegments(new THREE.EdgesGeometry(spec.geo),
        new THREE.LineBasicMaterial({ color: COL.player, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }));
      edges.rotation.x = Math.PI / 2; edges.scale.z = hs; edges.position.z = zTop;
      group.add(edges);
    }
    group.position.copy(cellPos(u.x, u.y, 0));
    boardGroup.add(group);
    return { group, body, shell, glow, edges, gx: u.x, gy: u.y, tween: null, type: u.type, side: u.side,
      phase: Math.random() * TAU, charging: false, raise: 0, spec, zTop };
  }
  function disposeUnit(rec) {
    boardGroup.remove(rec.group);
    rec.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }

  // ---- トゥイーン(R13: 論理座標比較・cancel-and-replace・開始は現在の視覚位置) ----
  const tweens = new Set();
  function tweenUnit(rec, to, dur, ease, hold) {
    if (rec.tween) { tweens.delete(rec.tween); rec.tween = null; }
    const from = rec.group.position.clone();
    const tw = { rec, from, to, t0: performance.now(), dur, ease, hold: hold || 0 };
    rec.tween = tw; tweens.add(tw);
  }
  function stepTweens(now) {
    for (const tw of tweens) {
      let t = (now - tw.t0) / tw.dur;
      if (t >= 1) { tw.rec.group.position.copy(tw.to); tw.rec.group.visible = true; tweens.delete(tw); if (tw.rec.tween === tw) tw.rec.tween = null; continue; }
      if (tw.hold && t < tw.hold) { tw.rec.group.visible = false; continue; } // wrap入場の先頭ホールド
      if (tw.hold) { tw.rec.group.visible = true; t = (t - tw.hold) / (1 - tw.hold); }
      const k = tw.ease(t);
      tw.rec.group.position.lerpVectors(tw.from, tw.to, k);
    }
  }

  // wrap退場ゴースト(R15: 並行2相・総尺430ms)
  const ghosts = new Set();
  function spawnExitGhost(rec, dirKey) {
    const d = DIRS[dirKey]; if (!d) return;
    const g = rec.group.clone(true);
    g.traverse(o => { if (o.material) o.material = o.material.clone(); });
    boardGroup.add(g);
    const from = rec.group.position.clone();
    const to = from.clone().add(new THREE.Vector3(d.x * calib.cell * 1.15, -d.y * calib.cell * 1.15, 0));
    ghosts.add({ g, from, to, t0: performance.now(), dur: 170 });
  }
  function stepGhosts(now) {
    for (const gh of ghosts) {
      const t = Math.min(1, (now - gh.t0) / gh.dur);
      gh.g.position.lerpVectors(gh.from, gh.to, easeInQuad(t));
      gh.g.traverse(o => { if (o.material) o.material.opacity = (o.material.opacity || 1) * 0.86; });
      if (t >= 1) { boardGroup.remove(gh.g); gh.g.traverse(o => { if (o.material) o.material.dispose(); }); ghosts.delete(gh); }
    }
  }

  // ---- fxミラー(boom/flash/hitflash/shake) ----
  const bursts = new Set(); // {mesh(ring), t0, dur, big}
  const sparks = []; // Points用パーティクル {x,y,z,vx,vy,vz,life}
  let sparkPoints = null, sparkGeo = null;
  const MAXSPARK = 160;
  function ensureSparks() {
    if (sparkPoints) return;
    sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAXSPARK * 3), 3));
    sparkPoints = new THREE.Points(sparkGeo,
      new THREE.PointsMaterial({ color: 0xffc890, size: 3.4, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    sparkPoints.frustumCulled = false;
    boardGroup.add(sparkPoints);
  }
  function burst(x, y, big) {
    // Sol R2処方: 塗った円ではなく薄いエネルギー波面(バンド幅8%リング+外側グロー、拡大260ms+消滅160ms)
    const { META } = dbg();
    ensureSparks();
    const p = cellPos(x, y, 4);
    const n = META.fxLite ? 6 : (big ? 20 : 14);
    for (let i = 0; i < n && sparks.length < MAXSPARK; i++) {
      const a = Math.random() * TAU, sp = (big ? 3.2 : 2.1) * (0.5 + Math.random());
      sparks.push({ x: p.x, y: p.y, z: p.z + 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 1.4 + Math.random() * 1.8, life: 1 });
    }
    const mkRing = (inner, outer, color, op) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 40),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.position.copy(p); boardGroup.add(m); return m;
    };
    const wave = mkRing(0.945, 1.0, big ? COL.danger : 0xffb08a, 0.55); // 主波面(輝線、バンド5.5% — Sol R2最終研磨)
    const halo = mkRing(0.82, 1.0, 0xff8068, 0.17);                     // 二次グロー(R1比0.7倍)
    const R = calib.cell * (big ? 1.5 : 0.9);
    bursts.add({ wave, halo, t0: performance.now(), grow: 270, fade: 170, R, big });
  }
  function stepFx(now, dt) {
    for (const b of bursts) {
      const el = now - b.t0;
      const tg = Math.min(1, el / b.grow);
      const s = Math.max(0.06, easeOutCubic(tg)) * b.R;
      b.wave.scale.set(s, s, 1); b.halo.scale.set(s * 0.96, s * 0.96, 1);
      const fade = el <= b.grow ? 1 : Math.max(0, 1 - (el - b.grow) / b.fade);
      b.wave.material.opacity = 0.55 * fade;
      b.halo.material.opacity = 0.17 * fade * (1 - tg * 0.5);
      if (el >= b.grow + b.fade) {
        for (const m of [b.wave, b.halo]) { boardGroup.remove(m); m.geometry.dispose(); m.material.dispose(); }
        bursts.delete(b);
      }
    }
    if (sparkPoints) {
      const pos = sparkGeo.attributes.position.array;
      let alive = 0;
      for (const s of sparks) {
        s.life -= dt / 290; if (s.life <= 0) continue; // Sol R2: 火花寿命180-320ms
        s.x += s.vx * dt / 16; s.y += s.vy * dt / 16; s.z += s.vz * dt / 16; s.vz -= 0.09 * dt / 16;
        pos[alive * 3] = s.x; pos[alive * 3 + 1] = s.y; pos[alive * 3 + 2] = s.z;
        sparks[alive++] = s;
      }
      sparks.length = alive;
      sparkGeo.setDrawRange(0, alive);
      sparkGeo.attributes.position.needsUpdate = true;
      sparkPoints.visible = alive > 0;
    }
  }
  const glitches = new Map(); // unitId -> until(ms)
  function fx(ev) {
    if (!active) return;
    const { META } = dbg();
    if (ev.type === "boom") { burst(ev.x, ev.y, !!ev.big); if (ev.big) disturb(0.6); bg.eyeSpike = performance.now() + 170; return; }
    if (ev.type === "flash") {
      for (const c of ev.cells || []) { const st = tileState[c.y * GRID + c.x]; if (st) st.hot = 1; }
      bg.eyeSpike = performance.now() + 170; // 発射の瞬間、椅子の眼が見開く
      return;
    }
    if (ev.type === "hitflash") {
      glitches.set(ev.unitId, performance.now() + 180);
      const { S } = dbg(); // 自機側の被弾は投影全体が乱れる(Phase 2.5)
      const u = S && S.enc && S.enc.units.find(x => x.id === ev.unitId);
      if (u && u.side === "player") disturb(1);
      return;
    }
    if (ev.type === "shake") {
      if (META.fxLite) return;
      const cls = ev.n >= 3 ? "shake3" : (ev.n === 2 ? "shake2" : "shake");
      canvas.classList.remove("shake", "shake2", "shake3"); void canvas.offsetWidth; canvas.classList.add(cls);
      return;
    }
  }
  let ambientPauseUntil = 0;
  function hitStop(ms) { ambientPauseUntil = performance.now() + (ms || 90); } // R18: 移動トゥイーンは止めない

  // ---- hover ----
  let hoverKey = null;
  function hover(x, y) { hoverKey = x + "," + y; }
  function hoverOff() { hoverKey = null; }
  function hlUnit(id, on) { const rec = units.get(id); if (rec) rec._hl = !!on; } // 意図リストホバー→機体増光(Sol D)

  // ==== Phase 3a: 背景シーン(2枚分割 — 敵対レビュー反映) ====================
  // 盤ホロcanvasとは独立した全画面fixed canvas。deskbg.webpの「完成した一人称卓の絵」を
  // マット平面として置き、視差・相手の眼・窓外の船骸・塵・ゾーン光で「生きた空間」にする。
  // DOM整合制約なし(遠景のみ)なので視差が自由。unlit素材のみ=盤ホロとのトーン混在なし。
  const bg = {
    canvas: null, curtain: null, renderer: null, scene: null, cam: null,
    ready: false, failed: false, group: null, matte: null, imgW: 1600, imgH: 900,
    eyes: [], eyeBlink: 0, wreck: null, winGlow: null, lampGlow: null, boardGlow: null,
    dustN: null, dustF: null, px: 0, py: 0, mx: 0, my: 0,
    lastW: 0, lastH: 0, lastZh: -1, coverW: 0, coverH: 0, topY: 0,
  };
  // 絵の中のアンカー(deskbg.webp 1600x900 の画像内割合)
  const ART_ANCHOR = {
    eyeL: [0.497, 0.145], eyeR: [0.532, 0.145],  // 空の椅子の背もたれ上部の闇(凡例テキスト行より下)
    window: [0.865, 0.135, 0.26, 0.24],           // 右上の窓(cx,cy,w,h)
    lamp: [0.235, 0.13],                          // 左上ランプヘッド
    dust: [0.13, 0.08, 0.33, 0.62],               // ランプ光条の塵域(x,y,w,h)
  };

  function bgInit() {
    if (bg.failed || bg.canvas || bg.loading || typeof document === "undefined") return;
    bg.loading = true; // 画像ロード中の再入で二重ビルドしない(眼が4個になる事故の再発防止)
    const img = new Image();
    img.onload = () => { try { bg.imgW = img.naturalWidth; bg.imgH = img.naturalHeight; bgBuild(img); } catch (e) { bg.failed = true; } };
    img.onerror = () => { bg.failed = true; }; // art/なしデプロイ=劣化哲学どおり2Dプレートのまま
    img.src = "art/deskbg.webp";
  }

  function bgRadialTex(size, inner, outer) {
    return makeTex(size, size, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      r.addColorStop(0, inner); r.addColorStop(1, outer);
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    });
  }

  function bgBuild(img) {
    const app = document.getElementById("app");
    bg.canvas = document.createElement("canvas");
    bg.canvas.id = "holo-bg";
    document.body.insertBefore(bg.canvas, app);
    bg.curtain = document.createElement("div");
    bg.curtain.id = "holo-curtain";
    document.body.insertBefore(bg.curtain, app); // canvasの後=同z-indexでも上に描かれる
    // P6: グリーブル装飾層(機材のフチ。英字のみ=情報と装飾の分離。curtainの後=最前の-1層)
    const gre = document.createElement("div");
    gre.id = "greeble";
    gre.innerHTML = `<div class="gb-ruler"></div>
      <div class="gb-build">LK_REL_0.9.15 // SALVAGE OPS CONSOLE</div>
      <div class="gb-vert">DEEP-FIELD RECLAMATION UNIT 06 — AUTH: VAGRANT</div>`;
    document.body.insertBefore(gre, app);
    bg.canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); bgKill(); }, false);

    bg.renderer = new THREE.WebGLRenderer({ canvas: bg.canvas, alpha: true, antialias: false, powerPreference: "low-power", preserveDrawingBuffer: true }); // preserve=部屋モードで静止フレームを保持し再描画をスキップ(fps)
    bg.renderer.setClearColor(0x000000, 0);
    bg.scene = new THREE.Scene();
    bg.cam = new THREE.PerspectiveCamera(45, 1, 10, 4000);
    bg.cam.position.set(0, 0, 1000);
    bg.group = new THREE.Group(); // マット+絵アンカーの子(視差はこのグループを動かす)
    bg.scene.add(bg.group);

    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace; // CSS表示とトーン一致(レビューF4)
    tex.needsUpdate = true;
    bg.matte = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tex, depthWrite: false }));
    bg.group.add(bg.matte);

    // 相手の眼(空の椅子の上、アンバーの2点。Inscryption処方「相手の実在」の最小形)
    const eyeTex = bgRadialTex(64, "rgba(255,190,110,0.95)", "rgba(255,190,110,0)");
    for (let i = 0; i < 2; i++) {
      const eye = new THREE.Mesh(new THREE.PlaneGeometry(13, 13),
        new THREE.MeshBasicMaterial({ map: eyeTex, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false }));
      bg.group.add(eye); bg.eyes.push(eye);
    }
    // 窓のゾーン光(ゾーンアイデンティティの回収 — #zonebg非表示の補償)
    bg.winGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: bgRadialTex(128, "rgba(255,255,255,0.55)", "rgba(255,255,255,0)"),
        transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
    bg.group.add(bg.winGlow);
    // 窓外を漂う船骸シルエット
    const ws = new THREE.Shape();
    ws.moveTo(-30, 4); ws.lineTo(-12, 12); ws.lineTo(8, 9); ws.lineTo(26, 14); ws.lineTo(30, 2);
    ws.lineTo(14, -6); ws.lineTo(18, -12); ws.lineTo(-4, -10); ws.lineTo(-22, -13); ws.lineTo(-28, -4); ws.closePath();
    bg.wreck = new THREE.Mesh(new THREE.ShapeGeometry(ws),
      new THREE.MeshBasicMaterial({ color: 0x020609, transparent: true, opacity: 0.9, depthWrite: false }));
    // 縁光: 黒塗りでなく「星明かりを受けた船骸」に見せる(Sol Phase3a指摘)
    const wreckRim = new THREE.LineSegments(new THREE.EdgesGeometry(bg.wreck.geometry),
      new THREE.LineBasicMaterial({ color: 0x73d8d5, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
    bg.wreck.add(wreckRim);
    bg.group.add(bg.wreck);
    // ランプの呼吸(まれな明滅)
    bg.lampGlow = new THREE.Mesh(new THREE.PlaneGeometry(90, 90),
      new THREE.MeshBasicMaterial({ map: bgRadialTex(128, "rgba(255,180,90,0.5)", "rgba(255,180,90,0)"),
        transparent: true, opacity: 0.10, blending: THREE.AdditiveBlending, depthWrite: false }));
    bg.group.add(bg.lampGlow);
    // 盤下グロー(ホログラムが卓面に落とす光 — DOM盤の位置を毎フレーム追う。視差非連動なのでscene直下)
    bg.boardGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: bgRadialTex(128, "rgba(80,200,200,0.5)", "rgba(80,200,200,0)"),
        transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false }));
    bg.scene.add(bg.boardGlow);
    // 塵2層(ランプ光条の中を漂う)
    const mkDust = (n, size, op) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0xffd9a8, size, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));
      pts.frustumCulled = false; pts.userData.n = n; pts.userData.seed = Math.random() * 1000;
      bg.scene.add(pts); return pts;
    };
    bg.dustN = mkDust(26, 2.6, 0.5); bg.dustF = mkDust(36, 1.7, 0.3);

    // P8: コックピット近景レイヤー(部屋の約2.2倍視差=「頭がガラスの内側にある」奥行き手がかり)
    // 上2隅シルエット+下端コンソール縁のみ(下隅は手札域と衝突/画面辺中央は塞がない — Metroid Prime原則)
    bg.near = new THREE.Group();
    bg.scene.add(bg.near);
    // Sol Phase4最終研磨: 前景は背景比+6-8%明るく・縁光2px・遮蔽影12-16px(暗背景に溶けて「同じ画面層」に見えるのを防ぐ)
    const silMat = new THREE.MeshBasicMaterial({ color: 0x0a141a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    const silShadow = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
    const rimMat = new THREE.LineBasicMaterial({ color: 0x73d8d5, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
    const triShape = new THREE.Shape(); // 単位直角三角形(斜辺=画面内側)
    triShape.moveTo(0, 0); triShape.lineTo(1, 0); triShape.lineTo(0, 1); triShape.closePath();
    const triGeo = new THREE.ShapeGeometry(triShape);
    const triEdge = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)]);
    bg.corners = [];
    for (let i = 0; i < 2; i++) { // 0=左上, 1=右上
      const grp = new THREE.Group();
      const sh = new THREE.Mesh(triGeo, silShadow); // 遮蔽影(本体より7%大きい影絵=擬似ペナンブラ)
      sh.scale.set(1.07, 1.07, 1); sh.position.z = -0.5;
      grp.add(sh);
      grp.add(new THREE.Mesh(triGeo, silMat));
      grp.add(new THREE.Line(triEdge, rimMat));
      bg.near.add(grp); bg.corners.push(grp);
    }
    const conShape = new THREE.Shape(); // 下端コンソール縁(上辺がわずかに狭い台形)
    conShape.moveTo(0, 0); conShape.lineTo(1, 0); conShape.lineTo(0.985, 1); conShape.lineTo(0.015, 1); conShape.closePath();
    bg.console = new THREE.Mesh(new THREE.ShapeGeometry(conShape),
      new THREE.MeshBasicMaterial({ color: 0x0c171b, transparent: true, opacity: 0.94, depthWrite: false, side: THREE.DoubleSide }));
    // 縁光は2px厚のクワッド(WebGLの線は1px制限のため)+上方向へ落ちる遮蔽影ストリップ
    bg.consoleRim = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x2e8e91, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
    const shadowTex = makeTex(8, 64, (g, w, h) => {
      const lg = g.createLinearGradient(0, h, 0, 0);
      lg.addColorStop(0, "rgba(0,0,0,0.55)"); lg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = lg; g.fillRect(0, 0, w, h);
    });
    bg.consoleShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    bg.near.add(bg.console); bg.near.add(bg.consoleRim); bg.near.add(bg.consoleShadow);

    window.addEventListener("mousemove", e => {
      bg.mx = (e.clientX / window.innerWidth - 0.5) * 2;
      bg.my = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });
    bg.ready = true;
    if (active) bgShow(); // 画像ロードがsyncより遅れた場合もその場で有効化(次renderを待たない)
  }

  // 画像内割合(fx,fy: y下向き) → bgワールド座標(カバー配置後)
  function artPt(fx, fy) {
    return { x: (fx - 0.5) * bg.coverW, y: bg.topY - fy * bg.coverH };
  }

  function bgLayout() {
    const w = bg.canvas.clientWidth, h = bg.canvas.clientHeight;
    if (!w || !h) return false;
    if (Math.abs(w - bg.lastW) > 8 || Math.abs(h - bg.lastH) > 8) { // 再サイズ暴発防止(URLバー伸縮対策)
      bg.lastW = w; bg.lastH = h;
      bg.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      bg.renderer.setSize(w, h, false);
      bg.cam.aspect = w / h;
      bg.cam.fov = 2 * Math.atan(h / 2000) * 180 / Math.PI; // z=0平面でワールド=CSSpx
      bg.cam.updateProjectionMatrix();
      // cover + 下端揃え(CSSのbackground: cover / center bottom を再現)+ 視差ぶんオーバースキャン
      const s = Math.max(w / bg.imgW, h / bg.imgH) * 1.05;
      bg.coverW = bg.imgW * s; bg.coverH = bg.imgH * s;
      bg.matte.scale.set(bg.coverW, bg.coverH, 1);
      bg.matte.position.y = -h / 2 + bg.coverH / 2;
      bg.topY = bg.matte.position.y + bg.coverH / 2;
      // 絵アンカーの再配置
      const [elx, ely] = ART_ANCHOR.eyeL, [erx, ery] = ART_ANCHOR.eyeR;
      const pl = artPt(elx, ely), pr = artPt(erx, ery);
      bg.eyes[0].position.set(pl.x, pl.y, 2); bg.eyes[1].position.set(pr.x, pr.y, 2);
      const [wx, wy, ww, wh] = ART_ANCHOR.window;
      const pw = artPt(wx, wy);
      bg.winGlow.position.set(pw.x, pw.y, 1);
      bg.winGlow.scale.set(ww * bg.coverW * 1.4, wh * bg.coverH * 1.8, 1);
      const plmp = artPt(...ART_ANCHOR.lamp);
      bg.lampGlow.position.set(plmp.x, plmp.y, 1);
      // P8: 近景レイヤーのレイアウト(z=40の拡大率 1000/(1000-40) を打ち消す係数)
      if (bg.near) {
        const k = (1000 - 40) / 1000;
        const cw = w * 0.20 * k, ch = h * 0.15 * k; // 上限: 幅22%×高18%以内(視界不良クレーム回避)
        const mob = w <= 620;
        bg.corners[0].visible = bg.corners[1].visible = !mob;
        bg.corners[0].position.set(-w / 2 * k, h / 2 * k, 40); bg.corners[0].scale.set(cw, -ch, 1);   // 左上(y下向きに伸ばす)
        bg.corners[1].position.set(w / 2 * k, h / 2 * k, 40); bg.corners[1].scale.set(-cw, -ch, 1);  // 右上(x左向きに伸ばす)
        const conH = h * 0.085 * k;
        bg.console.position.set(-w / 2 * k * 1.02, -h / 2 * k - 1, 40);
        bg.console.scale.set(w * k * 1.04, conH, 1);
        const conTop = bg.console.position.y + conH;
        bg.consoleRim.position.set(0, conTop, 40.6);           // 2px厚の縁光クワッド
        bg.consoleRim.scale.set(w * k * 1.01, 2, 1);
        bg.consoleShadow.position.set(0, conTop + 7.5, 40.3);  // 上方向へ15pxの遮蔽影
        bg.consoleShadow.scale.set(w * k * 1.04, 15, 1);
      }
    }
    return true;
  }

  function bgDraw(now, dt, amb) {
    if (!bg.ready || ctxLost) return;
    if (!bgLayout()) return;
    const { S, META } = dbg();
    roomReconcile(); // META.room3dトグルと実状態を毎フレーム調停(既定ONの初回ロードもここ)
    // 相手の実在の呼応: 敵の手番は眼が強く・赤く灯る(「向こうが打っている」)
    const enemyTurn = S && S.enc && (S.enc.step === "enemy" || S.enc.phase === "enemy");
    bg.eyeHeat = bg.eyeHeat === undefined ? 0 : bg.eyeHeat;
    bg.eyeHeat += ((enemyTurn ? 1 : 0) - bg.eyeHeat) * Math.min(1, dt / 400);
    // 視差: 部屋がわずかに逆方向へ(盤とテーブルのDOM整合は不変 — 遠景のみ動く)
    const par = (META.fxLite || !amb) ? 0 : 1;
    bg.px += ((-bg.mx * 10 * par) - bg.px) * 0.06;
    bg.py += ((bg.my * 6 * par) - bg.py) * 0.06;
    bg.group.position.set(bg.px, bg.py, 0);
    // 視線リーン: 盤へ乗り出す間、部屋は1.5%後退+4%減光(Sol: 盤と背景の相対運動)
    const leanT = document.body.classList.contains("gaze-lean") ? 1 : 0;
    bg.lean = (bg.lean || 0) + (leanT - (bg.lean || 0)) * Math.min(1, dt / 350);
    const ls = 1 - bg.lean * 0.015;
    bg.group.scale.set(ls, ls, 1);
    bg.matte.material.color.setScalar(1 - bg.lean * 0.04);
    // P8: 近景は部屋の約2.2倍振幅で同方向に動き(多層係数の最上段)、リーン時は迫る(相対運動の増幅)
    if (bg.near) {
      bg.near.position.set(bg.px * 2.2, bg.py * 2.2, 0);
      const ns = 1 + bg.lean * 0.008;
      bg.near.scale.set(ns, ns, 1);
    }
    // 相手の眼: ゆっくり明滅+まれな瞬き
    if (amb) {
      const breathe = 0.55 + 0.2 * Math.sin(now / (1700 - bg.eyeHeat * 900)) + bg.eyeHeat * 0.3;
      if (bg.eyeBlink < now) { if (Math.random() < 0.004) bg.eyeBlink = now + 140; }
      const blink = bg.eyeBlink > now ? 0.12 : 1;
      const spike = bg.eyeSpike > now ? 0.35 : 0; // 攻撃確定の瞬間だけ強く(Sol: 色より輝度)
      for (const e of bg.eyes) {
        e.material.opacity = Math.min(1, breathe + spike) * blink;
        e.material.color.setRGB(1, 1 - bg.eyeHeat * 0.15, 1 - bg.eyeHeat * 0.2); // 暖色へ10-20%だけ(赤い警告灯にしない — Sol D)
        e.scale.y = blink < 1 ? 0.15 : 1;
      }
      // 窓外の船骸: 窓の可視域内をゆっくり横切る(48秒周期)+微回転
      const [wx, wy, ww] = ART_ANCHOR.window;
      const t = ((now / 48000) + 0.4) % 1;
      const p0 = artPt(wx + ww * 0.30, wy + 0.02), p1 = artPt(wx - ww * 0.30, wy - 0.03);
      bg.wreck.position.set(p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t, 1.5);
      bg.wreck.rotation.z = now / 90000;
      // ランプの呼吸(まれにチラつく)
      bg.lampGlow.material.opacity = 0.08 + 0.03 * Math.sin(now / 2300) + (Math.random() < 0.006 ? 0.08 : 0);
      // 窓のゾーン光
      if (bg.lastZh !== calib.zh) { bg.winGlow.material.color.setHSL((calib.zh % 360) / 360, 0.6, 0.6); bg.lastZh = calib.zh; }
      bg.winGlow.material.opacity = 0.13 + 0.05 * Math.sin(now / 3600);
      // 塵: ランプ光条内を漂う
      for (const pts of [bg.dustN, bg.dustF]) {
        const near = pts === bg.dustN, n = pts.userData.n, seed = pts.userData.seed;
        const pos = pts.geometry.attributes.position.array;
        const [dx0, dy0, dw, dh] = ART_ANCHOR.dust;
        for (let i = 0; i < n; i++) {
          const ph = seed + i * 37.7;
          const fx = dx0 + dw * (0.5 + 0.5 * Math.sin(ph + now / (9000 + i * 331)));
          const fy = dy0 + dh * (((ph * 7.13 + now / 26000) % 1 + 1) % 1); // ゆっくり沈降(0..1ループ)
          const p = artPt(fx, fy);
          const px2 = p.x + bg.px * (near ? 2.2 : 0.5), py2 = p.y + bg.py * (near ? 2.2 : 0.5);
          pos[i * 3] = px2; pos[i * 3 + 1] = py2; pos[i * 3 + 2] = near ? 4 : 2;
        }
        pts.geometry.attributes.position.needsUpdate = true;
      }
    }
    // Phase 5: GLB部屋モードはBlender一人称カメラを再現(px写像カメラを毎フレーム上書き)
    if (room.active) {
      const w = bg.canvas.clientWidth, h = bg.canvas.clientHeight;
      roomCam(w, h);
      // 背景は視差移動/リサイズ時のみ再描画(ビート中は静止=描画スキップで負荷ゼロ。前フレームはpreserveで保持)
      if (!room.drawn || w !== room.lw || h !== room.lh
          || Math.abs(bg.px - room.lpx) > 4e-4 || Math.abs(bg.py - room.lpy) > 4e-4) {
        bg.renderer.render(bg.scene, bg.cam);
        room.lpx = bg.px; room.lpy = bg.py; room.lw = w; room.lh = h; room.drawn = true;
      }
      return;
    }
    // 盤下グロー: DOM盤の実位置を追う(gBCR読みのみ — レビューF1の読み書き分離)
    const boardEl = document.getElementById("board");
    if (boardEl) {
      const r = boardEl.getBoundingClientRect();
      const w = bg.canvas.clientWidth, h = bg.canvas.clientHeight;
      bg.boardGlow.position.set(r.left + r.width / 2 - w / 2, h / 2 - (r.top + r.height * 0.72), 3);
      bg.boardGlow.scale.set(r.width * 1.5, r.height * 0.9, 1);
      bg.boardGlow.visible = true;
    } else bg.boardGlow.visible = false;
    bg.renderer.render(bg.scene, bg.cam);
  }

  // ==== Phase 5: BlenderフルGLB部屋 — Claude→Blender→GLB→three.js 一気通貫 ====
  // 既定ON(META.room3d===false で明示OFF / ?room=0 強制OFF / ?room=1 強制ON)。
  // 見た目=この three.js リグ(GLBはCyclesライトを持ち込まない)。GLB失敗/WebGL不可はマット絵へ自動退避。
  // 照明数値は Sol 独立監査(tmp/sol-room-audit.md)処方。テーマ憲章: docs/design-room-theme.md。
  const room = { loading: false, failed: false, obj: null, lights: [], fog: null, active: false, lpx: 0, lpy: 0, lw: 0, lh: 0, drawn: false };
  function roomWanted() {
    let q = null; try { q = new URLSearchParams(location.search).get("room"); } catch (_) {}
    if (q === "1") return true;
    if (q === "0") return false;
    return (dbg().META || {}).room3d !== false; // 既定ON
  }

  function roomInit() {
    if (!roomWanted()) return;
    if (room.loading || room.failed || room.obj) return;
    room.loading = true;
    Promise.all([
      import("./vendor/three/GLTFLoader.js"),
      fetch("art/salvage_room.glb").then(r => { if (!r.ok) throw new Error("glb " + r.status); return r.arrayBuffer(); }),
    ]).then(([mod, buf]) => new Promise((res, rej) => new mod.GLTFLoader().parse(buf, "art/", res, rej)))
      .then(gltf => { roomBuild(gltf.scene); })
      .catch(e => { room.failed = true; try { console.info("room3d unavailable:", e && e.message || e); } catch (_) {} });
  }

  // トグル調停: 毎フレーム META.room3d と実状態を突き合わせる(ラン中トグルでリロード不要)
  function roomReconcile() {
    const want = roomWanted();
    if (want && !room.obj && !room.loading && !room.failed) { roomInit(); return; }
    if (!room.obj) return;
    if (want && !room.active) roomShow();
    else if (!want && room.active) roomHide();
  }

  function roomBuild(obj) {
    // glTFはY-up(Blender Z-up から変換済み)。シーン単位=メートルのまま、カメラをBlenderの一人称位置へ。
    room.obj = obj;
    bg.scene.add(obj);
    // ==== 暖⇔冷の照明リグ(決定的レバー — Sol独立監査の処方値。左=暖色タングステン / 右奥=冷色) ====
    // 座標=Blender(x, z, -y)。decay=2.0(物理falloff)で「本物の光源」に。過度な寒色フィルで前景を平板化しない。
    const mk = l => { bg.scene.add(l); room.lights.push(l); return l; };
    // 既定ON=モバイルfpsゲート必須のため4灯に絞る(6→4。暖1/冷3で二元性は保つ)。
    // ① 暖色タングステンの手元プール(最終: 1050→1150・cone54→60=コンセプトの広いタングステン・ウォッシュへ寄せる。左ベンチ全体を舐める)
    const key = mk(new THREE.SpotLight(0xff9a4d, 1150, 3.2, Math.PI * 60 / 360, 0.65, 2.0));
    key.position.set(-0.95, 1.38, -0.45);
    key.target.position.set(-1.15, 0.68, 0.28); mk(key.target);       // 露出した左ベンチ(x=40-280,y=300-570px)
    // ② 冷色アンビエント(最終監査#4: 0.16→0.32=黒潰れした周辺ジオメトリの道具シルエット/金属反応を出す。1050キー+露出0.90で二元性は維持)
    mk(new THREE.HemisphereLight(0x6fb0c2, 0x05090c, 0.32));
    // ③ 冷色リアリム: 右奥のみ(#3FB8D0/decay2 で右壁・容器側=奥行きの冷色)
    const rear = mk(new THREE.PointLight(0x3fb8d0, 27, 3.5, 2.0)); rear.position.set(1.35, 1.55, -1.45);
    // ④ 正面フィル(確認監査: 8→11=×1.35・左下の道具バンク寄りへ。#7899A3・影なし・暗部金属を6-8%luma上限で回収)
    const front = mk(new THREE.PointLight(0x7899a3, 11, 6, 2.0)); front.position.set(-0.35, 1.55, 1.35);
    // 大気: 冷色の指数フォグ=奥へ落ちる暗がり(密度0.10・#080D11。手前の暖色プールが際立つ)
    room.fog = new THREE.FogExp2(0x080d11, 0.10);
    roomShow();
    // ウォームアップ: 実レンダ1発でシェーダ+ジオメトリをGPUへ(初回ビート中の166msヒッチ回避。fps既定経路の要)
    try { roomCam(bg.canvas.clientWidth || 1280, bg.canvas.clientHeight || 800); bg.renderer.render(bg.scene, bg.cam); } catch (_) {}
  }

  // 部屋を前面に(絵アンカーを隠し・フォグ/トーン/ヴィネットを部屋用に)
  function roomShow() {
    if (!room.obj) return;
    room.obj.visible = true;
    for (const l of room.lights) l.visible = true;
    setAnchorsVisible(false);
    bg.scene.fog = room.fog;
    bg.renderer.toneMapping = THREE.ACESFilmicToneMapping;             // 部屋はPBR(bg canvasは独立レンダラ=盤ホロに影響なし)
    bg.renderer.toneMappingExposure = 0.90;                            // 監査#2: 1.05→0.90(発光平板を沈める)
    try { document.body.classList.add("room-live"); } catch (_) {}     // CSSヴィネット(#holo-curtainを全画面暗角へ)
    room.active = true;
  }
  // 部屋を退避(2Dマット絵へ。トグルOFF時)
  function roomHide() {
    if (room.obj) room.obj.visible = false;
    for (const l of room.lights) l.visible = false;
    setAnchorsVisible(true);
    bg.scene.fog = null;
    bg.renderer.toneMapping = THREE.NoToneMapping;                     // 2Dマットは非トーンマップ(SRGBそのまま=CSS一致)
    bg.renderer.toneMappingExposure = 1;
    try { document.body.classList.remove("room-live"); } catch (_) {}
    room.active = false; room.drawn = false; // 再表示時は必ず1枚描く
  }
  function setAnchorsVisible(v) { // boardGlowはbgDrawが毎フレーム管理するので触らない
    if (bg.matte) bg.matte.visible = v;
    for (const e of bg.eyes) e.visible = v;
    for (const k of ["winGlow", "lampGlow", "wreck", "dustN", "dustF"]) if (bg[k]) bg[k].visible = v;
  }

  function roomCam(w, h) {
    // Blender cam_room(38mm/36mmセンサ・横FOV50.6°)をthree座標へ: eye(0,1.62,1.58)→aim(0,0.82,-0.43)
    const hfov = 2 * Math.atan(18 / 38);
    bg.cam.fov = 2 * Math.atan(Math.tan(hfov / 2) * h / w) * 180 / Math.PI;
    bg.cam.aspect = w / h;
    bg.cam.near = 0.05; bg.cam.far = 60; // 部屋はメートル空間 — px用のnear10だと全てニアクリップされる
    // マウス視差: 頭が数cm動く(DOM整合の制約なし — 部屋は自由)
    const px = bg.px * 0.004, py = bg.py * 0.004;
    bg.cam.position.set(0 + px, 1.62 + py, 1.58);
    bg.cam.lookAt(0 + px * 0.4, 0.82 + py * 0.4, -0.43);
    bg.cam.updateProjectionMatrix();
  }

  function bgShow() {
    if (!bg.ready) return;
    if (!document.body.classList.contains("holo3")) {
      document.body.classList.add("holo3");
      // holo3のCSS(HUD枠・手札トレイ等)がレイアウトを動かす — 次renderを待たず盤canvasを再キャリブ(実測8.4px残留の修正)
      requestAnimationFrame(() => { try { if (active) sync(); } catch (e) { onFatal && onFatal(e); } });
    }
  }
  function bgHide() { document.body.classList.remove("holo3"); }
  function bgKill() {
    bg.failed = true; bgHide();
    try { if (bg.canvas) bg.canvas.remove(); if (bg.curtain) bg.curtain.remove();
      const g = document.getElementById("greeble"); if (g) g.remove(); } catch (_) {}
    bg.canvas = null; bg.ready = false;
  }

  // ---- 同期(冪等・全量) ----
  let active = false, lastEnc = null, lastStep = null, rafId = 0, lastT = 0;

  function deactivate() {
    if (!active && !document.body.classList.contains("holo")) return;
    active = false;
    document.body.classList.remove("holo");
    bgHide();
    stopLoop();
    if (canvas.parentElement) canvas.remove();
  }

  function sync() {
    const { S, UI, META } = dbg();
    const board = document.getElementById("board");
    const wrapEl = document.getElementById("boardwrap");
    const on = S && S.enc && S.screen === "battle" && META.holo !== false && !ctxLost && board && wrapEl;
    if (!on) { deactivate(); return; }

    if (canvas.parentElement !== wrapEl) wrapEl.appendChild(canvas);
    const prevCell = calib.cell, prevTilt = calib.tiltDeg;
    if (!calibrate(board, wrapEl)) { deactivate(); return; }
    if (needsBuild || calib.cell !== prevCell) buildBoard();
    if (calib.tiltDeg !== prevTilt) { // tilt切替: コマ高さ再構成が要るので作り直し
      for (const [, rec] of units) disposeUnit(rec);
      units.clear();
    }
    document.body.classList.add("holo");
    active = true;
    bgInit(); bgShow(); // Phase 3a: 背景シーン(準備できたフレームからフェードイン)
    if (bg.ready) roomInit(); // Phase 5(実験): ?room=1 でGLB部屋(失敗は絵へフォールバック)

    const enc = S.enc;
    const encChanged = enc !== lastEnc;
    const driftBeat = lastStep === "drift" && !encChanged; // R14
    // wrap情報はflip()のspliceより先に非破壊で読む(D3)
    const wrapMap = {};
    if (enc.wrapFx) for (const w of enc.wrapFx) wrapMap[w.unitId] = w.dir;

    // -- タイル状態 --
    const ov = ui.intentOverlays();
    const sel = ui.selectableCells();
    // 姿勢制御(restshift)の行き先もsel-ok扱いで光らせる — holoではセルの光は3Dタイル層が担う(FB)
    const extraSel = new Set();
    if (enc.phase === "restshift" && LK.restShiftOptions)
      for (const o of LK.restShiftOptions(S)) extraSel.add(o.x + "," + o.y);
    const zBase = new THREE.Color().setHSL((calib.zh % 360) / 360, 0.45, 0.085);
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const i = y * GRID + x, key = x + "," + y, st = tileState[i];
      const o = ov[key], sc = (sel.cells && sel.cells[key]) || extraSel.has(key);
      st.pulse = 0; st.raise = 0;
      if (o && o.threat.length) st.base.setHex(COL.threat);
      else if ((o && o.charge.length) || enc.flareRow === y) st.base.setHex(enc.flareRow === y ? COL.flare : COL.charge);
      else if (sc) { st.base.setHex(COL.selOk); st.pulse = 1; if (calib.tiltDeg) st.raise = 10; }
      else if (enc.well && enc.well.x === x && enc.well.y === y) st.base.setHex(COL.well);
      else if (sel.blocked && sel.blocked[key]) st.base.setHex(COL.blocked);
      else st.base.copy(zBase).lerp(new THREE.Color(COL.tileBase), 0.55);
    }
    if (enc.well) { wellRing.visible = true; wellRing.position.copy(cellPos(enc.well.x, enc.well.y, 2)); }
    else wellRing.visible = false;

    // -- コマ --
    const seen = new Set();
    for (const u of enc.units) {
      if (!u.alive) continue;
      seen.add(u.id);
      let rec = units.get(u.id);
      if (!rec) {
        rec = makeUnit(u); units.set(u.id, rec);
        if (!encChanged) { // 途中スポーン(産卵・分裂・機雷散布)はポップイン
          rec.group.scale.set(.01, .01, .01);
          rec._popT0 = performance.now();
        }
      } else if (encChanged) { // R12: 新戦域はトゥイーンなしスナップ
        if (rec.tween) { tweens.delete(rec.tween); rec.tween = null; }
        rec.group.position.copy(cellPos(u.x, u.y, 0));
        rec.gx = u.x; rec.gy = u.y;
      } else if (rec.gx !== u.x || rec.gy !== u.y) {
        const to = cellPos(u.x, u.y, 0);
        const wrapDir = wrapMap[u.id];
        if (wrapDir) {
          spawnExitGhost(rec, wrapDir);
          const d = DIRS[wrapDir];
          rec.group.position.copy(to).add(new THREE.Vector3(-d.x * calib.cell * 1.15, d.y * calib.cell * 1.15, 0));
          tweenUnit(rec, to, 430, easeOutCubic, 0.4); // 並行2相・先頭40%ホールド(R15)
        } else if (driftBeat) {
          tweenUnit(rec, to, 500, easeOutBack); // 慣性オーバーシュート(D4)
        } else {
          tweenUnit(rec, to, 340, easeOutCubic); // DOM FLIPと同尺
        }
        rec.gx = u.x; rec.gy = u.y;
      }
      rec.charging = !!(u.type === "sentinel" && u.charge) || !!(enc.intents && enc.intents.some(it => it.unitId === u.id && it.chargeCells));
      rec.raise = (calib.tiltDeg && sel.cells && sel.cells[u.x + "," + u.y]) ? 10 : 0; // R8
    }
    for (const [id, rec] of units) if (!seen.has(id)) { disposeUnit(rec); units.delete(id); }

    lastEnc = enc;
    lastStep = enc.step;
    startLoop();
    draw(performance.now(), 16); // 同一フレームで即描画(空白フラッシュ防止, R16)
    return { driftBeat }; // flip()がDOMラベルFLIPの尺を3Dと揃えるのに使う(D4)
  }

  // ---- rAFループ ----
  function startLoop() { if (!rafId) { lastT = performance.now(); rafId = requestAnimationFrame(tick); } }
  function stopLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }
  function tick(now) {
    rafId = 0;
    if (!active || !document.getElementById("board")) { deactivate(); return; }
    const dt = Math.min(50, now - lastT); lastT = now;
    draw(now, dt);
    rafId = requestAnimationFrame(tick);
  }

  function draw(now, dt) {
    if (ctxLost) return;
    const { META } = dbg();
    const amb = now > ambientPauseUntil && !META.fxLite;
    stepTweens(now);
    stepGhosts(now);
    if (now > ambientPauseUntil) stepFx(now, dt);

    // タイル色(パルス・フラッシュ・ホバー)
    const pt = (Math.sin(now / 340) + 1) / 2;
    for (let i = 0; i < tileState.length; i++) {
      const st = tileState[i];
      _c.copy(st.base);
      if (st.pulse) _c.lerp(new THREE.Color(COL.selOkHi), pt * 0.6);
      if (st.hot > 0) { _c.lerp(new THREE.Color(0xffffff), st.hot * 0.85); st.hot = Math.max(0, st.hot - dt / 450); }
      if (hoverKey !== null) {
        const hx = i % GRID, hy = (i / GRID) | 0;
        if (hoverKey === hx + "," + hy) _c.lerp(new THREE.Color(COL.hover), 0.5);
      }
      tileMesh.setColorAt(i, _c);
      // 浮上(スナップ, R8)
      const x = i % GRID, y = (i / GRID) | 0;
      _m.compose(cellPos(x, y, st.raise), _q, _s);
      tileMesh.setMatrixAt(i, _m);
    }
    tileMesh.instanceColor.needsUpdate = true;
    tileMesh.instanceMatrix.needsUpdate = true;

    // コマ: ボブ・ちらつき・チャージ・グリッチ・浮上・ポップイン
    for (const [id, rec] of units) {
      const bob = amb ? Math.sin(now / 620 + rec.phase) * 2.2 : 0;
      // ジッタは前フレーム分を必ず巻き戻してから加える(静止駒での累積ドリフト防止)
      if (rec.tween) { rec._jx = 0; rec._jy = 0; } // トゥイーンが位置を上書き済みなら巻き戻し不要
      rec.group.position.x -= rec._jx || 0; rec.group.position.y -= rec._jy || 0;
      rec._jx = 0; rec._jy = 0;
      const g = glitches.get(id);
      if (g) {
        if (now > g) glitches.delete(id);
        else { rec._jx = (Math.random() - .5) * 5; rec._jy = (Math.random() - .5) * 5; }
      }
      rec.group.position.x += rec._jx; rec.group.position.y += rec._jy;
      rec.body.position.z = rec.spec.h / 2 * heightScale() + 2 + bob + rec.raise;
      if (rec.edges) rec.edges.position.z = rec.body.position.z;
      rec.glow.position.z = 0.8 + rec.raise;
      rec.glow.material.opacity = rec._hl ? 0.3 : 0.16; // 意図ホバー中は足元光を増す
      if (rec._popT0) {
        const t = Math.min(1, (now - rec._popT0) / 220);
        const s = easeOutBack(t);
        rec.group.scale.set(s, s, s);
        if (t >= 1) rec._popT0 = 0;
      }
      // Sol R2: αゆらぎは周期1.6-2.2s・振幅±0.06(外殻)/±0.03(面)
      rec.body.material.opacity = amb ? 0.2 + Math.sin(now / 300 + rec.phase) * 0.03 : 0.2;
      if (rec.shell) rec.shell.material.opacity = amb ? 0.48 + Math.sin(now / 320 + rec.phase * 3) * 0.06 : 0.48;
      if (rec.charging) {
        const cp = (Math.sin(now / 200) + 1) / 2;
        rec.body.material.color.setHex(COL.danger).lerp(new THREE.Color(0xffffff), cp * 0.45);
        rec.body.material.opacity = 0.3 + cp * 0.2; // 危険予告は振幅を上げる(Sol #5)
      } else rec.body.material.color.setHex(rec.spec.color); // チャージ明滅後の色戻し
    }
    if (wellRing.visible && amb) wellRing.rotation.z = now / 1200; // Sol #5: 0.7-1.0 rad/s
    try { bgDraw(now, dt, amb); } catch (e) { bgKill(); } // 背景シーンは死んでも盤ホロを巻き込まない

    // ---- Phase 2.5: 井戸の宇宙(星ドリフト・星雲・投影乱れ) ----
    for (const st of env.stars) {
      if (amb) {
        const pos = st.pts.geometry.attributes.position.array;
        const dx = st.speed * dt / 1000;
        for (let i = 0; i < pos.length; i += 3) {
          pos[i] += dx;
          if (pos[i] > st.x0 + st.w) pos[i] -= st.w;
        }
        st.pts.geometry.attributes.position.needsUpdate = true;
      }
    }
    if (env.nebula) {
      if (amb) env.nebula.rotation.z = now / 60000;
      if (env.lastZh !== calib.zh) { // ゾーン色相で星雲を着色
        env.nebula.material.color.setHSL((calib.zh % 360) / 360, 0.55, 0.62);
        env.lastZh = calib.zh;
      }
    }
    // 被弾時の投影乱れ: ジオメトリは動かさず透明度だけを高周波でフラッター(DOMラベル剥離なし)
    if (now < disturbUntil) {
      const k = disturbAmp * (0.5 + 0.5 * Math.sin(now / 13) * Math.sin(now / 7));
      tileMesh.material.opacity = 0.62 * (1 - 0.55 * k);
      gridLines.material.opacity = 0.2 * (1 - 0.7 * k);
      frameLine.material.opacity = 0.45 * (1 - 0.6 * k);
      for (const st of env.stars) st.pts.material.opacity = st.op * (1 - 0.8 * k);
      if (env.nebula) env.nebula.material.opacity = 0.3 * (1 - 0.7 * k);
    } else if (disturbAmp > 0) {
      disturbAmp = 0;
      tileMesh.material.opacity = 0.62; gridLines.material.opacity = 0.2; frameLine.material.opacity = 0.45;
      for (const st of env.stars) st.pts.material.opacity = st.op;
      if (env.nebula) env.nebula.material.opacity = 0.3;
    }

    renderer.render(scene, camera);
  }

  // ---- デバッグ公開(R24) ----
  const debug = {
    get ready() { return active; },
    calibCheck,
    project: (x, y) => projectLocal(cellPos(x, y, 0)),
    calib,
    bgInfo() {
      if (!bg.ready) return { ready: false, failed: bg.failed };
      const w = bg.canvas.clientWidth, h = bg.canvas.clientHeight;
      return { ready: true, cover: [bg.coverW, bg.coverH], topY: bg.topY, group: [bg.px, bg.py],
        eyes: bg.eyes.map(e => ({ wx: e.position.x, wy: e.position.y, sx: w / 2 + e.position.x + bg.px, sy: h / 2 - (e.position.y + bg.py), op: e.material.opacity, vis: e.visible })) };
    },
  };

  function dispose() {
    deactivate();
    bgKill();
    for (const [, rec] of units) disposeUnit(rec);
    units.clear();
    try { renderer.dispose(); } catch (_) {}
    try { if (bg.renderer) bg.renderer.dispose(); } catch (_) {}
  }

  window.addEventListener("resize", () => { if (active) { try { sync(); } catch (e) { onFatal && onFatal(e); } } });

  return { sync, fx, hitStop, hover, hoverOff, hlUnit, dispose, debug };
}
