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
    needsBuild = false;
  }

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
    if (ev.type === "boom") { burst(ev.x, ev.y, !!ev.big); return; }
    if (ev.type === "flash") { for (const c of ev.cells || []) { const st = tileState[c.y * GRID + c.x]; if (st) st.hot = 1; } return; }
    if (ev.type === "hitflash") { glitches.set(ev.unitId, performance.now() + 180); return; }
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

  // ---- 同期(冪等・全量) ----
  let active = false, lastEnc = null, lastStep = null, rafId = 0, lastT = 0;

  function deactivate() {
    if (!active && !document.body.classList.contains("holo")) return;
    active = false;
    document.body.classList.remove("holo");
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

    const enc = S.enc;
    const encChanged = enc !== lastEnc;
    const driftBeat = lastStep === "drift" && !encChanged; // R14
    // wrap情報はflip()のspliceより先に非破壊で読む(D3)
    const wrapMap = {};
    if (enc.wrapFx) for (const w of enc.wrapFx) wrapMap[w.unitId] = w.dir;

    // -- タイル状態 --
    const ov = ui.intentOverlays();
    const sel = ui.selectableCells();
    const zBase = new THREE.Color().setHSL((calib.zh % 360) / 360, 0.45, 0.085);
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const i = y * GRID + x, key = x + "," + y, st = tileState[i];
      const o = ov[key], sc = sel.cells && sel.cells[key];
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

    renderer.render(scene, camera);
  }

  // ---- デバッグ公開(R24) ----
  const debug = {
    get ready() { return active; },
    calibCheck,
    project: (x, y) => projectLocal(cellPos(x, y, 0)),
    calib,
  };

  function dispose() {
    deactivate();
    for (const [, rec] of units) disposeUnit(rec);
    units.clear();
    try { renderer.dispose(); } catch (_) {}
  }

  window.addEventListener("resize", () => { if (active) { try { sync(); } catch (e) { onFatal && onFatal(e); } } });

  return { sync, fx, hitStop, hover, hoverOff, dispose, debug };
}
