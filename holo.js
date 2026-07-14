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
  let selfHitT0 = 0, selfHitId = null; // Phase2磨き(Gemini初見指摘): 被弾時に自機を見失わないビーコン
  function fx(ev) {
    if (!active) return;
    const { META } = dbg();
    if (ev.type === "boom") { burst(ev.x, ev.y, !!ev.big); if (ev.big) { disturb(0.6); cabinKick(ev.x - 1.5, ev.y - 1.5, 130, 5); } bg.eyeSpike = performance.now() + 170; return; }
    if (ev.type === "flash") {
      for (const c of ev.cells || []) { const st = tileState[c.y * GRID + c.x]; if (st) st.hot = 1; }
      bg.eyeSpike = performance.now() + 170; // 発射の瞬間、椅子の眼が見開く
      return;
    }
    if (ev.type === "hitflash") {
      glitches.set(ev.unitId, performance.now() + 180);
      const { S } = dbg(); // 自機側の被弾は投影全体が乱れる(Phase 2.5)
      const u = S && S.enc && S.enc.units.find(x => x.id === ev.unitId);
      if (u && u.side === "player") { disturb(1); cabinAlert(0.95); cabinKick(u.x - 1.5, 0.6, DMG_T, DMG_R, 1); selfHitT0 = performance.now(); selfHitId = ev.unitId; } // Phase2: 被弾=赤アラート+鋭いキック+自機ビーコン(Gemini初見指摘=赤の中で自機を見失う)
      return;
    }
    if (ev.type === "shake") {
      cabinKick(0.25, 1, SHAKE_T * (ev.n || 1), SHAKE_R * (ev.n || 1)); // Phase2: 攻撃反動=下方向の一撃(link段階)。CSS classシェイクは統一のため廃止
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

  // ==== ウォーテーブルPhase2: 反応する船内(embodied command) ====================
  // Solの処方=ランダム揺れでなく「指令方向と反対へ押される」方向性プッシュ+被弾の鋭いキック+赤アラート。
  // 実装=three.jsカメラ/ライトは触らず、canvasのCSS transform(合成のみ=部屋PBR再描画ゼロ=fpsゲート不変)と
  // 赤ヴィネットのopacity脈動だけで表現。減衰バネで「よろけて戻る」+わずかなオーバーシュート(二次リバウンド)。
  const cabin = { x: 0, y: 0, r: 0, vx: 0, vy: 0, vr: 0, sh: 0, vsh: 0, applied: false };
  const blag = { x: 0, y: 0, r: 0, sh: 0 };          // Sol#4a: 盤ホロは部屋を~40ms遅れて追う(減衰した接続感=剛結でない)
  let wBoost = 0;                                     // Sol#4b: 被弾は周波数も上げる(強打ほど速くスナップ)
  let alertUntil = 0, alertMag = 0, alertT0 = 0;
  // 調律(スクリーンpx/度。速度impulseを与え、W(固有角)/Z(減衰比)のバネで0へ)
  const CAB_W = 33, CAB_Z = 0.42;                     // ζ<1=不足減衰→よろけ+小リバウンド、~250msで収束
  const INERTIA_T = 270, INERTIA_R = 14;              // 慣性プッシュ(移動)の並進/回転impulse(ドリフト時~0.26°=Sol 0.15-0.35°域)
  const DRIFT_MUL = 1.7, MOVE_MUL = 0.6;              // ドリフト(慣性)ビートは強く/通常移動は控えめ
  const DMG_T = 700, DMG_R = 60;                       // 被弾の鋭いキック(~0.66°=Sol 0.5-1.2°域)
  const SHAKE_T = 170, SHAKE_R = 9;                    // 攻撃反動(link段階)
  function reducedMotionFx() {
    if ((dbg().META || {}).fxLite) return true;
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (_) { return false; }
  }
  // dx,dy=スクリーン方向(x右/y下)。並進impulse tMag・回転impulse rMag(符号はdxで決める)。snap=被弾で周波数up。
  function cabinKick(dx, dy, tMag, rMag, snap) {
    if (reducedMotionFx()) return;
    const n = Math.hypot(dx, dy) || 1;
    cabin.vx += (dx / n) * tMag; cabin.vy += (dy / n) * tMag;
    cabin.vr += (rMag || 0) * (dx >= 0 ? 1 : -1);
    cabin.vsh += (rMag || 0) * 0.5 * (dx >= 0 ? 1 : -1); // ホロの一瞬のせん断(Sol: 較正が乱れる)
    if (snap) wBoost = Math.max(wBoost, snap);           // Sol#4b: 強打は速くスナップ
  }
  function cabinAlert(mag) { // 被弾赤アラート(赤非常灯の点灯+脈動。動きと独立=減モーションでも点く)
    const now = performance.now();
    alertT0 = now; alertUntil = now + (mag > 0.7 ? 2300 : 1450); alertMag = Math.max(alertMag, mag);
  }
  function stepCabin(now, dt) {
    if (typeof document === "undefined") return;
    wBoost *= Math.exp(-Math.min(40, dt) / 220);        // 被弾スナップは~220msで通常周波数へ緩む
    const W = CAB_W * (1 + 0.5 * wBoost);               // Sol#4b: 強打直後は固有周波数を最大+50%(速くスナップ)
    const acc = (p, v) => -W * W * p - 2 * CAB_Z * W * v; // 減衰バネ→0
    // 大きなdt(負荷/スロットル/タブ復帰)でも明示Eulerが発散しないよう≤8msに細分化して積分
    for (let rem = Math.min(80, dt); rem > 1e-4; rem -= 8) {
      const h = Math.min(8, rem) / 1000;
      cabin.vx += acc(cabin.x, cabin.vx) * h; cabin.x += cabin.vx * h;
      cabin.vy += acc(cabin.y, cabin.vy) * h; cabin.y += cabin.vy * h;
      cabin.vr += acc(cabin.r, cabin.vr) * h; cabin.r += cabin.vr * h;
      cabin.vsh += acc(cabin.sh, cabin.vsh) * h; cabin.sh += cabin.vsh * h;
    }
    // 安全クランプ: 数値ブリップでも船内が暴れない上限(通常ピーク~7px/0.66°よりずっと上=常用は非クリップ)
    const cl = (v, m) => v < -m ? -m : v > m ? m : v;
    cabin.x = cl(cabin.x, 48); cabin.y = cl(cabin.y, 48); cabin.r = cl(cabin.r, 3.5); cabin.sh = cl(cabin.sh, 3.5);
    cabin.vx = cl(cabin.vx, 1400); cabin.vy = cl(cabin.vy, 1400); cabin.vr = cl(cabin.vr, 500); cabin.vsh = cl(cabin.vsh, 500);
    // 盤ホロは部屋を~40msの時定数で追う(Sol#4a・#3: 同方向だが少し遅れて減衰=剛結でない接続感)
    const la = 1 - Math.exp(-Math.min(40, dt) / 40);
    blag.x += (cabin.x - blag.x) * la; blag.y += (cabin.y - blag.y) * la; blag.r += (cabin.r - blag.r) * la; blag.sh += (cabin.sh - blag.sh) * la;
    const live = Math.abs(cabin.x) + Math.abs(cabin.y) + Math.abs(cabin.r) + Math.abs(cabin.sh)
      + Math.abs(cabin.vx) + Math.abs(cabin.vy) + Math.abs(cabin.vr) + Math.abs(blag.x) + Math.abs(blag.y) > 0.03;
    if (live) {
      const mag = Math.min(1, (Math.abs(cabin.x) + Math.abs(cabin.y)) / 20 + Math.abs(cabin.r) / 1.1);
      const sc = 1 + mag * 0.05; // オーバースキャン=揺れで部屋canvasの縁の外(背景)が覗くのを隠す
      // 部屋(3D世界)は全振幅で揺れる=「世界が反応」。盤ホロは遅延した0.55=戦術盤の可読性+減衰した接続感。
      if (bg.canvas) bg.canvas.style.transform =
        `translate(${cabin.x.toFixed(2)}px,${cabin.y.toFixed(2)}px) rotate(${cabin.r.toFixed(3)}deg) scale(${sc.toFixed(3)})`;
      if (canvas) canvas.style.transform =
        `translate(${(blag.x * 0.55).toFixed(2)}px,${(blag.y * 0.55).toFixed(2)}px) rotate(${(blag.r * 0.55).toFixed(3)}deg) skewX(${blag.sh.toFixed(3)}deg)`;
      cabin.applied = true;
    } else if (cabin.applied) { // 収束→inline transformを1度だけ消す(以後アイドルコスト0)
      cabin.x = cabin.y = cabin.r = cabin.sh = cabin.vx = cabin.vy = cabin.vr = cabin.vsh = 0;
      blag.x = blag.y = blag.r = blag.sh = 0;
      if (bg.canvas) bg.canvas.style.transform = "";
      if (canvas) canvas.style.transform = "";
      cabin.applied = false;
    }
    // 赤アラート: エッジ・ヴィネットのopacityを脈動(Sol: 1.5-2Hz)。onset直後は少し強い=露出ディップ相当。
    if (bg.alert) {
      let op = 0;
      if (now < alertUntil) {
        const reduce = reducedMotionFx();
        const life = 1 - (now - alertT0) / (alertUntil - alertT0);           // 1→0のエンベロープ
        const onset = Math.min(1, (now - alertT0) / 120);                    // 立ち上がりの一瞬強め
        const pulse = reduce ? 0.6 : (0.55 + 0.45 * Math.sin(now / 1000 * Math.PI * 2 * 1.8)); // ~1.8Hz
        op = alertMag * (0.35 + 0.65 * life) * (0.4 + 0.6 * pulse) * (0.5 + 0.5 * onset);
      } else if (alertMag) { alertMag = 0; }
      const cur = bg.alert.__op || 0;
      if (Math.abs(op - cur) > 0.004) { bg.alert.style.opacity = op.toFixed(3); bg.alert.__op = op; }
    }
  }
  function cabinReset() { // 戦闘離脱時にtransform/アラートを消す
    cabin.x = cabin.y = cabin.r = cabin.sh = cabin.vx = cabin.vy = cabin.vr = cabin.vsh = 0;
    blag.x = blag.y = blag.r = blag.sh = 0; wBoost = 0;
    cabin.applied = false; alertUntil = 0; alertMag = 0;
    try { if (bg.canvas) bg.canvas.style.transform = ""; if (canvas) canvas.style.transform = "";
      if (bg.alert) { bg.alert.style.opacity = "0"; bg.alert.__op = 0; } } catch (_) {}
  }

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
    bg.alert = document.createElement("div"); // Phase2: 被弾赤アラートのエッジ・ヴィネット層
    bg.alert.id = "cabin-alert";
    document.body.insertBefore(bg.alert, app);
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
      const moved = RESTAGE ? positionTable(w, h) : positionRig(w, h); // 盤の矩形が変わった時のみ再配置(=再描画要求。ビート中は不変)
      // 背景は視差移動/リサイズ/リグ再配置時のみ再描画(ビート中は静止=描画スキップで負荷ゼロ。preserveで前フレーム保持)
      if (!room.drawn || moved || w !== room.lw || h !== room.lh
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
  const room = { loading: false, failed: false, obj: null, lights: [], fog: null, active: false, lpx: 0, lpy: 0, lw: 0, lh: 0, drawn: false, rig: null, brx: -1, bry: -1, brw: -1 };
  // ウォーテーブルPhase1: 卓に「投影機ソケット」を実在させ、盤ホロが卓上の実機から立ち上がって見せる。
  // リグは静的ジオメトリ+レイアウト変化時だけ再配置=dirty-renderスキップを壊さない(ビート中コスト0)。
  const DESK_Y = 0.7375; // desk_top上面(Blender(0,0.38,0.70)size(_,_,0.075)→three-Y 0.70+0.0375。salvage_desk.py:302と一致)
  const PROJ = { x: 0.0, z: 0.0 };  // 初期フォールバック中心(初回描画でpositionRigが盤直下へ再配置)
  let _ray = null, _deskPlane = null, _ndc = null, _hit = null;
  // 盤ホロ(前面canvas・HUD次第で左右に寄る)の実位置へソケットを毎レイアウト追従させる。
  // 盤前端中央のスクリーン点を部屋カメラで卓平面(y=DESK_Y)へ逆投影し、そこへリグを置く。
  // 盤の矩形が変わった時のみtrue(=再描画要求)。ビート中は矩形不変=描画スキップ維持。
  function positionRig(cw, ch) {
    if (!room.rig || typeof document === "undefined") return false;
    const b = document.getElementById("board"); if (!b) return false;
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2, by = r.top + r.height;
    if (Math.abs(cx - room.brx) < 1 && Math.abs(by - room.bry) < 1 && Math.abs(r.width - room.brw) < 1) return false;
    room.brx = cx; room.bry = by; room.brw = r.width;
    if (!_ray) { _ray = new THREE.Raycaster(); _deskPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -DESK_Y); _ndc = new THREE.Vector2(); _hit = new THREE.Vector3(); }
    _ndc.set((cx / cw) * 2 - 1, -((by - r.height * 0.05) / ch) * 2 + 1); // 前端よりわずかに奥=土台が盤下端の下へ覗く
    _ray.setFromCamera(_ndc, bg.cam);
    const hit = _ray.ray.intersectPlane(_deskPlane, _hit);
    if (hit) room.rig.position.set(hit.x, DESK_Y, hit.z + 0.03); // +z=手前へ寄せ、土台が盤下端から少し覗く
    return true;
  }
  // 卓上化(RESTAGE): 卓全体を動かし、ウェル(器)を盤ホロの真下へ整列。盤中心を部屋カメラでウェル面(y=0.70)へ逆投影。
  let _wellPlane = null;
  function positionTable(cw, ch) {
    if (!room.obj || typeof document === "undefined") return false;
    const b = document.getElementById("board"); if (!b) return false;
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (Math.abs(cx - room.brx) < 1 && Math.abs(cy - room.bry) < 1 && Math.abs(r.width - room.brw) < 1) return false;
    room.brx = cx; room.bry = cy; room.brw = r.width;
    if (!_ray) { _ray = new THREE.Raycaster(); _deskPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -DESK_Y); _ndc = new THREE.Vector2(); _hit = new THREE.Vector3(); }
    if (!_wellPlane) _wellPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.70);
    _ndc.set((cx / cw) * 2 - 1, -(cy / ch) * 2 + 1);
    _ray.setFromCamera(_ndc, bg.cam);
    const hit = _ray.ray.intersectPlane(_wellPlane, _hit);
    if (hit) { // ウェル中心 local(0,0.70,0) を hit へ。scale時もウェルy=0.70を保つようpos.yを補正。
      room.obj.scale.setScalar(TABLE_SCALE);
      room.obj.position.set(hit.x, 0.70 * (1 - TABLE_SCALE), hit.z);
    }
    return true;
  }
  // Phase4 Stage1(?restage=1&board3d=1): 部屋の同一3D空間に GRID×GRID のホロタイルを実在させる(入力なし・静的)。
  // 卓(room.obj)の子=positionTableで卓が動けば自動追従+scale継承。ウェル床(local y=0.70)の上に浮遊。
  function buildBoard3D(obj) {
    if (room.board3d || typeof THREE === "undefined") return;
    const root = new THREE.Group();
    root.position.set(0, 0.735, 0); // ウェル床+3.5cm(卓ローカル)
    const N = GRID, span = 0.86, pitch = span / N, tile = pitch * 0.9;
    const tileGeo = new THREE.PlaneGeometry(tile, tile);
    const edgeGeo = new THREE.EdgesGeometry(tileGeo);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const px = (x - (N - 1) / 2) * pitch, pz = (y - (N - 1) / 2) * pitch;
      const face = new THREE.Mesh(tileGeo, new THREE.MeshBasicMaterial({
        color: 0x2fb8cc, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      face.rotation.x = -Math.PI / 2; face.position.set(px, 0, pz); root.add(face);
      const edge = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
        color: 0x5fe6f0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      edge.rotation.x = -Math.PI / 2; edge.position.set(px, 0.001, pz); root.add(edge);
    }
    obj.add(root);
    room.board3d = root;
  }
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
      fetch(RESTAGE ? "art/salvage_table.glb" : "art/salvage_room.glb").then(r => { if (!r.ok) throw new Error("glb " + r.status); return r.arrayBuffer(); }),
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
    if (RESTAGE) obj.position.set(0, 0, -0.43); // 卓上化: ウェル中心(three z=0)をカメラ注視点(z=-0.43)へ寄せる(第1パス・要調整)
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
    room.fog = new THREE.FogExp2(0x080d11, RESTAGE ? 0.035 : 0.10); // 卓上化はフォグ薄め(卓が沈まない)
    if (!RESTAGE) buildRoomRig(); // 卓上化ではウェルが物理アンカー=旧投影機ソケットは不要
    if (BOARD3D) buildBoard3D(obj); // Phase4 Stage1: ウェルに3Dホロタイル(入力なし・卓の子=positionTableで追従)
    roomShow();
    // ウォームアップ: 実レンダ1発でシェーダ+ジオメトリをGPUへ(初回ビート中の166msヒッチ回避。fps既定経路の要)
    try { roomCam(bg.canvas.clientWidth || 1280, bg.canvas.clientHeight || 800); bg.renderer.render(bg.scene, bg.cam); } catch (_) {}
  }

  // ==== ウォーテーブルPhase1: 卓上のサルベージ投影機ソケット(静的リグ) ====
  // Solステージング=45-60cmの改造ユニット/不揃い装甲/露出ボルト/4本のシアン発光ポスト。
  // 盤ホロ(前面canvas)がこの実機の発光面から立ち上がって見える。全て静的=fpsコスト0。
  function buildRoomRig() {
    if (room.rig || typeof THREE === "undefined") return;
    const rig = new THREE.Group();
    // 子はリグ局所座標(原点=卓面上の接地中心。yは卓面からの高さ)。配置はrig.positionで一括移動。
    const metalDark = new THREE.MeshStandardMaterial({ color: 0x1c1710, roughness: 0.60, metalness: 0.55 });
    const metalHousing = new THREE.MeshStandardMaterial({ color: 0x181410, roughness: 0.66, metalness: 0.50 }); // ブラケット暗色housing
    const metalPlate = new THREE.MeshStandardMaterial({ color: 0x2a2219, roughness: 0.74, metalness: 0.42 });
    const seamMat = new THREE.MeshStandardMaterial({ color: 0x0d0a07, roughness: 0.80, metalness: 0.30 });     // 継ぎ目の暗い溝
    // 発光: ACES白飛び対策=シアンはアパーチャ/コア/リップのみ。輝度は加算グロー(トーン後も加算=シアン保持)で足す。
    const apertureMat = new THREE.MeshStandardMaterial({ color: 0x0a1c20, emissive: 0x3fd0e0, emissiveIntensity: 1.3, roughness: 0.40, metalness: 0.30 });
    const lipMat = new THREE.MeshStandardMaterial({ color: 0x0a1c20, emissive: 0x35c2d6, emissiveIntensity: 1.15, roughness: 0.45, metalness: 0.30 });
    const lampAmber = new THREE.MeshStandardMaterial({ color: 0x1a0f04, emissive: 0xff9a3c, emissiveIntensity: 1.4, roughness: 0.50, metalness: 0.30 });
    const add = (geo, mat, x, y, z, ry) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (ry) m.rotation.y = ry; rig.add(m); return m; };
    const haloTex = bgRadialTex(64, "rgba(80,215,230,0.95)", "rgba(80,215,230,0)");
    const addHalo = (x, y, z, w, h, op) => { const g = add(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, opacity: op == null ? 0.52 : op, blending: THREE.AdditiveBlending, depthWrite: false }), x, y, z);
      g.scale.set(w, h, 1); g.renderOrder = 4; return g; };
    // Sol再監査#1: 非発光の中性エッジキャッチで暗い合成中でもハードのシルエットを保つ(ワイヤ縁を淡く)
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x5c6d75, transparent: true, opacity: 0.30 });
    const edgeCatch = (mesh) => { const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMat); mesh.add(e); return e; };
    // === 基部プリンス(低・広。盤footprint内は隠れる前提。前面/ブラケット/井戸だけ盤外へ覗かせる) ===
    add(new THREE.BoxGeometry(0.72, 0.06, 0.42), metalDark, 0, 0.030, 0);
    edgeCatch(add(new THREE.BoxGeometry(0.60, 0.028, 0.34), metalPlate, 0.012, 0.075, -0.01, 0.04)); // 天板(非対称)
    // === 前面ファサード(Sol#1: 盤下端の下に露出する暗い前面=着地の主読点。継ぎ目/ボルト/アンバー計器/埋込リップ) ===
    const bz = 0.17, bf = bz + 0.026; // ファサードz・前面z
    edgeCatch(add(new THREE.BoxGeometry(0.76, 0.11, 0.05), metalDark, 0, 0.055, bz));       // 本体(盤前縁より広い)
    add(new THREE.BoxGeometry(0.22, 0.07, 0.006), seamMat, -0.19, 0.055, bf);              // 継ぎ目プレートL(非対称)
    add(new THREE.BoxGeometry(0.15, 0.055, 0.006), seamMat, 0.16, 0.048, bf);              // 継ぎ目プレートR
    add(new THREE.BoxGeometry(0.70, 0.013, 0.006), lipMat, 0, 0.090, bf);                  // シアンリップ=前面に彫込む横溝(浮かせない)
    for (let i = 0; i < 4; i++)                                                            // 大ボルト4本
      add(new THREE.CylinderGeometry(0.017, 0.017, 0.014, 10), metalPlate, -0.28 + i * 0.187, 0.030, bf + 0.002).rotation.x = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 10), lampAmber, 0.315, 0.076, bf + 0.002).rotation.x = Math.PI / 2; // アンバー計器灯1点
    // === エミッタ・ブラケット(Sol#2: 前2本=機械的ブラケット。暗housing+足+クランプ+内向きシアンアパーチャ。発光はコアのみ) ===
    const bracket = (px, pz, tilt) => {
      const inw = px < 0 ? 1 : -1;                                                          // 内向き(中心へ)
      add(new THREE.BoxGeometry(0.07, 0.028, 0.07), metalHousing, px, 0.014, pz);           // 暗い足
      const body = add(new THREE.CylinderGeometry(0.028, 0.033, 0.10, 12), metalHousing, px, 0.078, pz); // 暗housing(非発光)
      if (tilt) body.rotation.z = inw * 0.11;                                               // 1本だけ傾ける(損傷=非対称)
      edgeCatch(body);                                                                       // Sol再監査#1: シルエット保持
      add(new THREE.CylinderGeometry(0.037, 0.037, 0.018, 12), metalPlate, px, 0.052, pz);  // クランプ・カラー
      const ap = add(new THREE.BoxGeometry(0.012, 0.05, 0.03), apertureMat, px + inw * 0.028, 0.100, pz); // 内向きシアンアパーチャ
      ap.rotation.y = inw * 0.5;
      addHalo(px + inw * 0.03, 0.100, pz + 0.02, 0.10, 0.15, 0.55);                         // アパーチャのシアン核ハロー(body発光でなく)
      addHalo(px + inw * 0.03, 0.100, pz + 0.03, 0.045, 0.055, 0.85);                       // Sol再監査#2: アパーチャ起点の高輝度コア点
    };
    bracket(-0.32, 0.14, false);
    bracket(0.32, 0.14, true);
    for (const px of [-0.30, 0.30]) {                                                        // 後2本(盤下=ほぼ隠れる):短い暗ポスト+小シアン先端
      add(new THREE.CylinderGeometry(0.022, 0.026, 0.075, 10), metalHousing, px, 0.060, -0.13);
      add(new THREE.CylinderGeometry(0.020, 0.020, 0.010, 10), apertureMat, px, 0.100, -0.13);
    }
    // === エミッタ発光面(この円盤の上にグリッドが浮く=Sol処方) ===
    const discTex = bgRadialTex(128, "rgba(95,220,230,0.9)", "rgba(95,220,230,0)");
    const disc = add(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: discTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0.100, 0);
    disc.rotation.x = -Math.PI / 2; disc.scale.set(0.56, 0.36, 1); disc.renderOrder = 3;
    // === 投影スピル(Sol#3: 各前アパーチャ→盤角の浅いシアン台形シート。盤外/下のみ覗く) ===
    const sheetTex = bgRadialTex(64, "rgba(90,210,225,0.5)", "rgba(90,210,225,0)");
    for (const sgn of [-1, 1]) {
      const sheet = add(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: sheetTex, transparent: true, opacity: 0.30, blending: THREE.AdditiveBlending, depthWrite: false }), sgn * 0.24, 0.15, 0.08);
      sheet.rotation.x = -Math.PI / 2.4; sheet.scale.set(0.30, 0.44, 1); sheet.renderOrder = 3;
    }
    // === 接地の光の井戸(Sol#3: 約1.5倍広く・柔らかく・青寄りシアン=投影スピル。盤外へあふれる分が着地を語る) ===
    const glowTex = bgRadialTex(128, "rgba(65,180,220,0.55)", "rgba(65,180,220,0)");
    const glow = add(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0.004, 0.02);
    glow.rotation.x = -Math.PI / 2; glow.scale.set(2.0, 1.45, 1); glow.renderOrder = 2;
    // === 接地影(接触AO=暗い放射。卓が暗いので控えめ) ===
    const shTex = bgRadialTex(128, "rgba(0,0,0,0.62)", "rgba(0,0,0,0)");
    const sh = add(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shTex, transparent: true, opacity: 0.5, depthWrite: false }), 0, 0.002, 0);
    sh.rotation.x = -Math.PI / 2; sh.scale.set(1.0, 0.66, 1); sh.renderOrder = 1;
    rig.position.set(PROJ.x, DESK_Y, PROJ.z); // 初期フォールバック。初回描画でpositionRigが盤直下へ
    room.rig = rig;
    bg.scene.add(rig);
  }

  // 部屋を前面に(絵アンカーを隠し・フォグ/トーン/ヴィネットを部屋用に)
  function roomShow() {
    if (!room.obj) return;
    room.obj.visible = true;
    for (const l of room.lights) l.visible = true;
    if (room.rig) room.rig.visible = true;
    if (bg.boardGlow) bg.boardGlow.visible = false; // 部屋モードはリグの接地グローが担う(screen空間boardGlowは退避)
    setAnchorsVisible(false);
    bg.scene.fog = room.fog;
    bg.renderer.toneMapping = THREE.ACESFilmicToneMapping;             // 部屋はPBR(bg canvasは独立レンダラ=盤ホロに影響なし)
    bg.renderer.toneMappingExposure = RESTAGE ? 1.02 : 0.90;           // 監査#2: 1.05→0.90(発光平板を沈める)。卓上化はほんの少し明るく(オーナーFB)
    try { document.body.classList.add("room-live"); } catch (_) {}     // CSSヴィネット(#holo-curtainを全画面暗角へ)
    room.active = true;
  }
  // 部屋を退避(2Dマット絵へ。トグルOFF時)
  function roomHide() {
    if (room.obj) room.obj.visible = false;
    for (const l of room.lights) l.visible = false;
    if (room.rig) room.rig.visible = false;
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

  const RESTAGE = (() => { try { return new URLSearchParams(location.search).get("restage") === "1"; } catch (_) { return false; } })(); // 卓上化再ステージの作業フラグ(?restage=1)
  const TABLE_SCALE = 0.9; // 卓のスケール(ウェルが盤ホロ幅に合うよう目視調整する値)
  const BOARD3D = RESTAGE && (() => { try { return new URLSearchParams(location.search).get("board3d") === "1"; } catch (_) { return false; } })(); // Phase4試作: 盤を部屋の3Dオブジェへ(?restage=1&board3d=1)
  function roomCam(w, h) {
    const px = bg.px * 0.004, py = bg.py * 0.004;
    if (RESTAGE) {
      // 再ステージStep1(?restage=1): 盤のCSS(perspective:1050px+rotateX34°)=「水平面を約56°見下ろす」と同じ潰れ方(Sol)。
      // 56°見下ろし+FOV=CSS perspective一致で机が盤と同率に潰れ、盤が卓に載って見える。新テーブルモデルと組で仕上げる。
      bg.cam.fov = 2 * Math.atan((h / 2) / 1050) * 180 / Math.PI; // vFOV=CSS一致(aspectで水平も自動一致)
      bg.cam.aspect = w / h; bg.cam.near = 0.05; bg.cam.far = 60;
      bg.cam.position.set(0 + px, 2.22 + py, 0.57);          // 約56°見下ろし(Sol: eye)
      bg.cam.lookAt(0 + px * 0.4, 0.75 + py * 0.4, -0.43);   // aim(机上面 y≈0.7375 の少し上)
    } else {
      // 現行(既定): Blender cam_room(38mm・約22°見下ろし)。再ステージ完了まで既定はこのまま。
      const hfov = 2 * Math.atan(18 / 38);
      bg.cam.fov = 2 * Math.atan(Math.tan(hfov / 2) * h / w) * 180 / Math.PI;
      bg.cam.aspect = w / h; bg.cam.near = 0.05; bg.cam.far = 60;
      bg.cam.position.set(0 + px, 1.62 + py, 1.58);
      bg.cam.lookAt(0 + px * 0.4, 0.82 + py * 0.4, -0.43);
    }
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
    cabinReset(); // Phase2: 揺れ/赤アラートのinline transformを消して離脱
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
        if (u.side === "player") { // Phase2: 自機移動→船内が慣性でよろける。Sol=指令方向の反対へ押される(両軸とも反対で統一)
          const dd = wrapDir ? DIRS[wrapDir] : { x: u.x - rec.gx, y: u.y - rec.gy }; // grid→screen(+x右/+y下)
          const mul = driftBeat ? DRIFT_MUL : MOVE_MUL;                              // ドリフト=慣性ビートは強く/通常移動は控えめ
          cabinKick(-dd.x, -dd.y, INERTIA_T * mul, INERTIA_R * mul);
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
      // 自機ビーコン: 被弾~1.1sは足元光を明シアン白へ+拡大脈動=赤アラート中でも自機を発見できる(Gemini初見指摘)
      if (selfHitId === id && now - selfHitT0 < 1100) {
        const t = (now - selfHitT0) / 1100, ping = 0.5 + 0.5 * Math.sin(now / 70);
        rec.glow.material.color.setHex(0xcffcff);
        rec.glow.material.opacity = (0.4 + 0.5 * ping) * (1 - 0.35 * t);
        rec.glow.scale.setScalar(1 + 0.9 * t);
        if (rec.edges) rec.edges.material.opacity = 0.85 + 0.15 * ping;
        rec._beaconOn = true;
      } else {
        if (rec._beaconOn) { // ビーコン終了時に既定へ1度だけ戻す
          rec.glow.material.color.setHex(rec.side === "player" ? COL.player : (rec.side === "hazard" ? COL.hazard : COL.enemy));
          rec.glow.scale.setScalar(1); if (rec.edges) rec.edges.material.opacity = 0.8; rec._beaconOn = false;
        }
        rec.glow.material.opacity = rec._hl ? 0.3 : 0.16; // 意図ホバー中は足元光を増す
      }
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
    try { stepCabin(now, dt); } catch (_) {}              // Phase2: 反応する船内(CSS変形/赤アラート=三再描画なし)

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
    rigInfo() { // Phase1診断: ソケットの存在/可視/ワールド位置/スクリーン投影
      if (!room.rig) return { rig: false, active: room.active, obj: !!room.obj, loading: room.loading, failed: room.failed };
      const w = bg.canvas.clientWidth, h = bg.canvas.clientHeight, p = room.rig.position;
      const proj = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(bg.cam); return [Math.round((v.x * 0.5 + 0.5) * w), Math.round((-v.y * 0.5 + 0.5) * h), +v.z.toFixed(3)]; };
      let board = null; try { const b = document.getElementById("board"); const r = b.getBoundingClientRect(); board = { cx: Math.round(r.left + r.width / 2), by: Math.round(r.top + r.height) }; } catch (_) {}
      return { rig: true, active: room.active, vis: room.rig.visible, children: room.rig.children.length,
        pos: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)],
        originScreen: proj(p.x, p.y, p.z), postTL: proj(p.x - 0.19, p.y + 0.265, p.z - 0.12), board };
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
