// Leap or Keep — headless rule-check + balance simulation
// usage: node tests/sim.mjs [runsPerPolicy]
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, "..", "index.html"), "utf8");
const m = html.match(/\/\* ===== LOGIC-START ===== \*\/([\s\S]*?)\/\* ===== LOGIC-END ===== \*\//);
if (!m) { console.error("LOGIC markers not found"); process.exit(1); }
const sandbox = { module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox, { filename: "logic.js" });
const LK = sandbox.module.exports;

let failed = 0, passed = 0;
function ok(cond, name, detail) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`); }
}

// ---------- unit tests ----------
console.log("== rule checks ==");
{
  // torus math (GRID=5)
  const G=LK.CONFIG.GRID;
  ok(G===5, "grid is 5 (odd torus, L-011)");
  ok(LK.wrap(-1) === G-1 && LK.wrap(G) === 0, "wrap");
  ok(LK.tdelta(0, G-1) === -1, "tdelta shortest path");
  ok(LK.tdist({x:0,y:0},{x:3,y:3}) === 4, "tdist wraps both axes");
}
{
  // encounter setup
  const s = LK.newRun(42);
  LK.startEncounter(s, null);
  ok(s.enc.units.filter(u=>u.side==="player").length === 2, "2 player units spawn");
  ok(LK.cardsIn(s,"hand").length === 6, "hand = 6");
  ok(LK.cardsIn(s,"reserve").length === 4, "reserve = 4");
  ok(s.enc.phase === "player", "round1 starts at player phase");
  ok(s.enc.intents.length === LK.enemies(s.enc).length, "intents planned for each enemy");
}
{
  // move + drift + wrap via real card play
  const s = LK.newRun(42);
  LK.startEncounter(s, null);
  const hand = LK.cardsIn(s,"hand");
  const r0 = LK.selectPair(s, hand[0].uid, "top", hand[1].uid);
  ok(r0.ok, "selectPair");
  const spec = LK.actionSpec(s,0);
  ok(spec.kind === "move" || spec.kind === "brake_move" || spec.kind === "ram", "first half is movement-ish: " + spec.kind);
  const ship = LK.unitById(s.enc,"ship");
  if (spec.kind === "move") {
    const opts = LK.moveOptions(s, ship, spec);
    ok(opts.length > 0, "move options exist");
    ok(opts.every(o=>o.steps===spec.n), "moves are exactly n (L-002)", JSON.stringify(opts));
    // 奇数トーラス(L-011): 同一カードの4方向は全て異なるマスに着く=方向曖昧性が構造的に消える
    const keys=opts.map(o=>o.x+","+o.y);
    ok(new Set(keys).size===keys.length, "odd grid: all move dirs land on distinct cells (L-011)", JSON.stringify(keys));
    const o=opts[0];
    const noDir = LK.execAction(s,0,{unitId:"ship",cell:{x:o.x,y:o.y}});
    ok(noDir.ok, "unambiguous move works without dir", noDir.msg);
    ok(ship.drift===o.dir, "drift matches movement dir (L-001)", "drift="+ship.drift);
    ok(ship.x===o.x && ship.y===o.y, "ship landed exactly n cells away");
  } else { LK.fizzleAction(s,0); }
  if (s.enc.pending && !s.enc.pending[0].done) LK.fizzleAction(s,0);
  LK.fizzleAction(s,1);
  // undo: ターン丸ごと巻き戻し
  ok(s.enc.awaitEnd === true, "awaitEnd after both halves");
  const posBefore = {x:ship.x, y:ship.y, drift:ship.drift};
  const ru = LK.undoTurn(s);
  ok(ru.ok, "undoTurn works", ru.msg);
  const ship2 = LK.unitById(s.enc,"ship");
  ok(ship2.x===0 && ship2.y===1 && ship2.drift===null, "undo restores ship position+drift");
  ok(LK.cardsIn(s,"hand").length===6 && !s.enc.pending, "undo restores hand and clears pending");
  // やり直して確定
  const hand2 = LK.cardsIn(s,"hand");
  LK.selectPair(s, hand2[0].uid, "top", hand2[1].uid);
  LK.fizzleAction(s,0); LK.fizzleAction(s,1);
  ok(LK.commitTurn(s).ok, "commitTurn");
  if (s.enc.phase === "enemy") LK.enemyPhaseAll(s);
  while (LK.pendingDamage(s)) LK.resolveDamage(s,"hp");
  if (s.enc && s.enc.phase === "drift") LK.driftPhase(s);
  while (LK.pendingDamage(s)) LK.resolveDamage(s,"hp");
  ok(LK.cardsIn(s,"discard").length >= 2, "played cards went to discard");
  ok(s.enc.round === 2 || s.run.over || s.enc.phase==="cleared", "round advanced");
}
{
  // rest: hand <2 forces rest, loses 1 permanently
  const s = LK.newRun(7);
  LK.startEncounter(s, null);
  // burn through hand: 3 turns of fizzle-fizzle
  for (let t=0;t<3 && !s.run.over && s.enc.phase==="player";t++) {
    const hand = LK.cardsIn(s,"hand");
    LK.selectPair(s, hand[0].uid, "top", hand[1].uid);
    LK.fizzleAction(s,0); LK.fizzleAction(s,1);
    if (s.enc.awaitEnd) LK.commitTurn(s);
    if (s.enc.phase === "enemy") LK.enemyPhaseAll(s);
    while (LK.pendingDamage(s)) LK.resolveDamage(s,"hp");
    if (s.enc && s.enc.phase === "drift") LK.driftPhase(s);
    while (LK.pendingDamage(s)) LK.resolveDamage(s,"hp");
  }
  if (!s.run.over && s.enc.phase === "rest") {
    const before = LK.aliveCards(s).length;
    const ship = LK.unitById(s.enc,"ship");
    // 自選は船HP-1
    const hpBefore = ship.hp;
    if (hpBefore > 1) {
      const pick = [...LK.cardsIn(s,"hand"), ...LK.cardsIn(s,"discard")][0];
      const r = LK.doRest(s, "choose", pick.uid);
      ok(r.ok, "doRest choose");
      ok(ship.hp === hpBefore-1, "choose rest costs 1 ship HP");
      ok(LK.cardByUid(s,pick.uid).loc === "lost", "chosen card is lost");
    } else {
      const r = LK.doRest(s, "random");
      ok(r.ok, "doRest random");
    }
    ok(LK.aliveCards(s).length === before-1, "rest loses exactly 1 card");
    ok(LK.cardsIn(s,"discard").length === 0, "rest recovers discard");
  } else {
    ok(s.run.over || s.enc.phase==="rest" || s.enc.phase==="damage" || s.enc.phase==="cleared",
       "after 3 empty turns: rest or terminal state, got phase=" + (s.enc&&s.enc.phase));
  }
}
{
  // damage burn negation
  const s = LK.newRun(11);
  LK.startEncounter(s, null);
  const ship = LK.unitById(s.enc,"ship");
  s.enc.dmgQueue.push({unitId:"ship",dmg:2,src:"テスト"});
  const hand = LK.cardsIn(s,"hand");
  const hp0 = ship.hp, alive0 = LK.aliveCards(s).length;
  const r = LK.resolveDamage(s,"burn",hand[0].uid);
  ok(r.ok, "burn negation accepted", r.msg);
  ok(ship.hp === hp0, "burn negates all damage");
  ok(LK.aliveCards(s).length === alive0-1, "burn loses the card");
}
{
  // exhaustion loss
  const s = LK.newRun(3);
  LK.startEncounter(s, null);
  for (const c of s.run.cards) c.loc = "lost";
  s.run.cards[0].loc = "hand"; // 1 card left
  s.enc.step = "upkeep"; LK.pump(s);
  ok(s.run.over && !s.run.win && s.run.reason === "exhausted", "exhaustion ends run");
}
{
  // クラッシュ・サルベージ: ドリフト衝突キル → 消耗から回収
  const s = LK.newRun(13);
  LK.startEncounter(s, null);
  s.enc.units=s.enc.units.filter(u=>u.side!=="hazard"); // テストの再現性のためハザード除去
  s.enc.container=null;
  const es = LK.enemies(s.enc);
  if (es.length >= 2) {
    const [a,b] = es;
    a.x=1; a.y=4; b.x=2; b.y=4; a.hp=1; a.drift="right";
    for (const p of LK.players(s.enc)) p.drift=null;
    const disc = LK.cardsIn(s,"hand")[0]; disc.loc="discard";
    s.enc.step="drift"; s.enc.phase=null;
    LK.driftPhase(s);
    ok(!a.alive, "collision kills 1hp enemy");
    ok(s.enc.phase==="crashsalvage", "physics kill triggers salvage phase", "phase="+s.enc.phase);
    const r = LK.crashSalvagePick(s, disc.uid);
    ok(r.ok && disc.loc==="hand", "salvage recovers card to hand");
  }
}
{
  // 展開遺物: カードを失うと遺物も消滅(deployedStatus)
  const s = LK.newRun(21);
  s.pendingRelic = LK.RELIC_DEFS[0];
  s.run.route = "safe"; s.screen="relic";
  LK.resolveRelic(s, "deploy");
  const dcard = s.run.cards.find(c=>c.relicId);
  ok(!!dcard, "deployed card carries relicId");
  ok(LK.deployedStatus(s)[0].alive === true, "deployed relic alive while card alive");
  ok(LK.cargoValue(s) === 0, "deploy gives no cargo value");
  dcard.loc = "lost";
  ok(LK.deployedStatus(s)[0].alive === false, "relic destroyed when card lost");
}
{
  // カード強化(+): 主要数値が1伸びる
  const s=LK.newRun(31);
  const c=s.run.cards.find(c=>c.defId==="c_salvo");
  c.up=true;
  ok(LK.cardSpec(s,c,"bottom").dmg===4, "upgrade adds +1 dmg (salvo 3->4)");
  ok(LK.cardSpec(s,c,"top").n===2, "upgrade adds +1 move (salvo 1->2)");
  // ラベルも実数値に追従(エージェント実プレイ#001の実害バグ指摘)
  const ram=s.run.cards.find(c=>c.defId==="c_ram"); ram.up=true;
  const rl=LK.cardSpec(s,ram,"top").label;
  ok(rl.includes("突進3")&&rl.includes("3ダメージ")&&!rl.includes("2"), "upgraded ram label shows real values", rl);
  ok(LK.cardSpec(s,c,"top").label.includes("2"), "upgraded move label shows real value", LK.cardSpec(s,c,"top").label);
}
{
  // 船体パッシブ: ベリーロール=物理無傷+与ダメ+1
  const s=LK.newRun(33, null, {shipId:"bellyroll"});
  LK.startEncounter(s,null);
  s.enc.units=s.enc.units.filter(u=>u.side!=="hazard"); s.enc.container=null;
  const ship=LK.unitById(s.enc,"ship");
  ok(ship.maxHp===10, "bellyroll hp 10");
  const e=LK.enemies(s.enc)[0];
  e.x=1; e.y=0; e.hp=3; ship.x=0; ship.y=0; ship.drift="right";
  LK.unitById(s.enc,"drone").drift=null;
  s.enc.step="drift"; s.enc.phase=null;
  LK.driftPhase(s);
  ok(ship.hp===10, "bellyroll takes 0 from collision", "hp="+ship.hp);
  ok(e.hp===1, "bellyroll deals 2 collision dmg (1+1)", "ehp="+e.hp);
  while(LK.pendingDamage(s)) LK.resolveDamage(s,"hp");
  // アストラ=射程+1
  const s2=LK.newRun(34, null, {shipId:"astra"});
  LK.startEncounter(s2,null);
  const sh2=LK.unitById(s2.enc,"ship");
  ok(sh2.maxHp===7, "astra hp 7 (glass cannon)");
  const e2=LK.enemies(s2.enc)[0];
  e2.x=LK.wrap(sh2.x+2); e2.y=sh2.y;
  const ts=LK.attackTargets(s2, sh2, {kind:"attack",dmg:1,range:1});
  ok(ts.includes(e2), "astra range+1 (range1 reaches dist2)");
}
{
  // 深淵II: リープ燃料2枚
  const s=LK.newRun(35,null,{asc:2});
  ok(LK.fuelCost(s)===2, "asc2 fuel cost is 2");
  const r1=LK.doLeap(s, s.run.cards[0].uid);
  ok(!r1.ok, "single fuel rejected at asc2");
  const r2=LK.doLeap(s, [s.run.cards[0].uid, s.run.cards[1].uid]);
  ok(r2.ok && s.run.zone===2, "two fuels leap at asc2");
}
{
  // leap burns fuel, zone increments; keep wins
  const s = LK.newRun(5);
  const c0 = s.run.cards[0];
  const r = LK.doLeap(s, c0.uid);
  ok(r.ok && c0.loc==="lost" && s.run.zone===2, "leap burns a card and advances zone");
  const s2 = LK.newRun(5);
  LK.doKeep(s2);
  ok(s2.run.over && s2.run.win, "keep wins the run");
}

{
  // 敵レジストリ網羅: 出現しうる全タイプが 定義・AI・説明・アイコン を持つ(L-028: splitter AI漏れの再発防止)
  const types=new Set(["larva","mine","bomber","juggernaut","broodmother"]); // 派生スポーン+ボス抽選分
  for(const zt of LK.ZONE_TABLE) for(const key of ["e1","safe","danger"]) for(const t of zt[key]) types.add(t);
  for(const t of types){
    const d=LK.ENEMY_DEFS[t];
    ok(!!d, `enemy def exists: ${t}`);
    ok(!d || (!!d.desc && !!d.icon), `enemy desc+icon: ${t}`);
    if(t!=="mine"&&t!=="debris") ok(!!LK.ENEMY_AI[t], `enemy AI exists: ${t}`);
  }
}

// ---------- v0.8: 新敵・ギミック・契約(アークナイツ調査の翻訳) ----------
// 統制された盤面を作るヘルパ: プレイヤー2機+指定した敵だけ
function arena(seed, foes){
  const s=LK.newRun(seed);
  s.run.cards=[
    {uid:"a0",defId:"c_salvo",loc:"pool",up:false},
    {uid:"a1",defId:"c_burn",loc:"pool",up:false},
    {uid:"a2",defId:"c_burn",loc:"pool",up:false},
    {uid:"a3",defId:"c_patch",loc:"pool",up:false},
    {uid:"a4",defId:"c_evade",loc:"pool",up:false},
    {uid:"a5",defId:"c_salvo",loc:"pool",up:false},
  ];
  LK.startEncounter(s,["a0","a1","a2","a3","a4","a5"]);
  const enc=s.enc;
  enc.units=enc.units.filter(u=>u.side==="player");
  enc.container=null; enc.well=null; enc.flareRow=null;
  let i=0;
  for(const f of foes){
    const d=LK.ENEMY_DEFS[f.type];
    enc.units.push({id:f.id||("X"+(i++)), side:f.side||"enemy", type:f.type, name:d.name, icon:d.icon,
      x:f.x, y:f.y, hp:f.hp??d.hp, maxHp:f.maxHp??f.hp??d.hp, dmg:d.dmg,
      drift:f.drift||null, shield:0, alive:true, charge:null, patIdx:0});
  }
  const ship=LK.unitById(enc,"ship"); ship.x=0; ship.y=1; ship.drift=null;
  const drone=LK.unitById(enc,"drone"); drone.x=4; drone.y=4; drone.drift=null;
  return s;
}
// 旗艦のサルヴォ(攻撃3)で対象を撃つ
function shoot(s, targetId){
  const r0=LK.selectPair(s,"a0","bottom","a1");
  if(!r0.ok) return r0;
  const r=LK.execAction(s,0,{unitId:"ship",targetId});
  return r;
}
{
  // 装甲種カラパス: 武器-1軽減、物理は素通し
  const s=arena(91,[{id:"W",type:"warden",x:1,y:1,hp:3}]);
  const W=LK.unitById(s.enc,"W");
  const r=shoot(s,"W");
  ok(r.ok, "shoot warden", r.msg);
  ok(W.hp===1, "warden armor cuts weapon dmg 3->2 (hp 3->1)", "hp="+W.hp);
  const s2=arena(191,[{id:"W",type:"warden",x:1,y:1,hp:3}]);
  const W2=LK.unitById(s2.enc,"W");
  LK.unitById(s2.enc,"ship").drift="right";
  s2.enc.step="drift"; s2.enc.phase=null;
  LK.driftPhase(s2);
  ok(W2.hp===2, "collision bypasses armor (hp 3->2)", "hp="+W2.hp);
  while(LK.pendingDamage(s2)) LK.resolveDamage(s2,"hp");
}
{
  // 分裂体ミトス: 死亡時に幼体2体
  const s=arena(92,[{id:"S",type:"splitter",x:1,y:1,hp:1}]);
  shoot(s,"S");
  const larvae=LK.enemies(s.enc).filter(u=>u.type==="larva");
  ok(!LK.unitById(s.enc,"S").alive, "splitter dies");
  ok(larvae.length===2, "splitter spawns 2 larvae", "n="+larvae.length);
  ok(larvae.every(l=>LK.tdist(l,{x:1,y:1})===1), "larvae spawn adjacent");
}
{
  // 自爆種ボムスポア: どんな死でも周囲1マスに2ダメージ(歩く機雷)
  const s=arena(93,[{id:"B",type:"bomber",x:1,y:1,hp:1},{id:"M",type:"miner",x:1,y:2,hp:3}]);
  const M=LK.unitById(s.enc,"M");
  shoot(s,"B");
  ok(!LK.unitById(s.enc,"B").alive, "bomber dies to gunfire");
  ok(M.hp===1, "bomber death explosion hits adjacent enemy for 2", "hp="+M.hp);
  ok(LK.pendingDamage(s)!==null, "adjacent ship is queued for explosion damage");
  while(LK.pendingDamage(s)) LK.resolveDamage(s,"hp");
}
{
  // 修復網メンダー: 最も傷ついた敵を毎ターン+1(優先目標の強制)
  const s=arena(94,[{id:"H",type:"mender",x:3,y:1,hp:2},{id:"M",type:"miner",x:1,y:1,hp:1,maxHp:2}]);
  s.enc.step="intents"; s.enc.phase=null; LK.pump(s);
  const it=s.enc.intents.find(i=>i.unitId==="H");
  ok(it && it.healTarget==="M", "mender telegraphs heal target", JSON.stringify(it&&it.healTarget));
  s.enc.step="enemy"; s.enc.phase="enemy";
  LK.enemyPhaseAll(s);
  ok(LK.unitById(s.enc,"M").hp===2, "mender heals wounded ally +1");
  while(LK.pendingDamage(s)) LK.resolveDamage(s,"hp");
}
{
  // 転移種ブリンカー: 遠距離なら最寄りユニットの間合い2へ位相転移(慣性なし)
  const s=arena(95,[{id:"B",type:"blinker",x:3,y:4,hp:2}]);
  const drone=LK.unitById(s.enc,"drone"); drone.x=1; drone.y=3;
  s.enc.step="intents"; s.enc.phase=null; LK.pump(s);
  const it=s.enc.intents.find(i=>i.unitId==="B");
  ok(it && it.teleport && it.moveTo, "blinker plans teleport", JSON.stringify(it&&it.moveTo));
  s.enc.step="enemy"; s.enc.phase="enemy";
  LK.enemyPhaseAll(s);
  const B=LK.unitById(s.enc,"B");
  ok(LK.tdist(B,drone)===2, "blinker lands at ring distance 2", "d="+LK.tdist(B,drone));
  ok(B.drift===null, "teleport carries no drift");
  while(LK.pendingDamage(s)) LK.resolveDamage(s,"hp");
}
{
  // 重力渦: 隣のユニットを引き込む+渦上では慣性が消える
  const s=arena(96,[{id:"M",type:"miner",x:3,y:3,hp:9}]);
  const ship=LK.unitById(s.enc,"ship");
  ship.x=1; ship.y=1; ship.drift=null;
  s.enc.well={x:2,y:1};
  s.enc.step="drift"; s.enc.phase=null;
  LK.driftPhase(s);
  ok(ship.x===2&&ship.y===1, "well pulls adjacent unit in", `at ${ship.x},${ship.y}`);
  while(LK.pendingDamage(s)) LK.resolveDamage(s,"hp");
  ship.drift="right";
  s.enc.step="drift"; s.enc.phase=null;
  LK.driftPhase(s);
  ok(ship.x===2&&ship.y===1&&ship.drift===null, "drift dies on the well (free brake)", `at ${ship.x},${ship.y} drift=${ship.drift}`);
  while(LK.pendingDamage(s)) LK.resolveDamage(s,"hp");
}
{
  // 太陽フレア(Z4): 3の倍数Rで行を予告 → 翌R頭に行全体へ1ダメージ
  const s=arena(97,[{id:"M",type:"miner",x:3,y:3,hp:9}]);
  s.run.zone=4;
  s.enc.round=3;
  s.enc.step="intents"; s.enc.phase=null; LK.pump(s);
  ok(s.enc.flareRow!==null&&s.enc.flareRow!==undefined, "flare warns at round%3===0", "row="+s.enc.flareRow);
  const row=s.enc.flareRow;
  // 予告行に犠牲ユニットを置いて発火を確認
  const vx=[0,1,2,3,4].find(x=>!LK.unitAt(s.enc,x,row));
  s.enc.units.push({id:"V",side:"enemy",type:"miner",name:"犠牲",icon:"🤖",x:vx,y:row,hp:1,maxHp:1,dmg:1,drift:null,shield:0,alive:true,patIdx:0});
  s.enc.step="intents"; s.enc.phase=null; LK.pump(s);
  ok(!LK.unitById(s.enc,"V").alive, "flare fires next round: row unit took 1 and died");
  while(LK.pendingDamage(s)) LK.resolveDamage(s,"hp");
}
{
  // ボス抽選: ランごとに正体が変わり、ラン内では固定(周回動機)
  const seen=new Set();
  for(let seed=400;seed<420;seed++){
    const s=LK.newRun(seed);
    s.run.zone=5; s.run.encIdx=1; s.run.route="safe";
    const l1=LK.encounterEnemyList(s), l2=LK.encounterEnemyList(s);
    const boss=l1.find(t=>LK.ENEMY_DEFS[t].boss);
    ok(!!boss, "z5 enc2 contains a boss", JSON.stringify(l1));
    ok(l2.includes(boss), "boss type memoized within run");
    seen.add(boss);
  }
  ok(seen.size>=2, "boss identity varies across runs", [...seen].join(","));
}
{
  // グレイヴ・ローラー: 照準(橙レーン)→翌Rに轢断突進、最初の1体に2+自分も1軋む
  const s=arena(98,[{id:"J",type:"juggernaut",x:3,y:2,hp:12}]);
  const ship=LK.unitById(s.enc,"ship"); ship.x=0; ship.y=2; ship.drift=null;
  s.enc.step="intents"; s.enc.phase=null; LK.pump(s);
  let it=s.enc.intents.find(i=>i.unitId==="J");
  ok(it && it.aimDir && it.chargeCells && it.chargeCells.length===4, "juggernaut aims a full lane", JSON.stringify(it&&it.aimDir));
  s.enc.step="enemy"; s.enc.phase="enemy"; LK.enemyPhaseAll(s);
  const J=LK.unitById(s.enc,"J");
  ok(J.rushDir===it.aimDir, "aim stores rush direction");
  s.enc.step="intents"; s.enc.phase=null; LK.pump(s);
  it=s.enc.intents.find(i=>i.unitId==="J");
  ok(it && it.rush && it.attackCells.length===4, "next round telegraphs the rush lane in red");
  s.enc.step="enemy"; s.enc.phase="enemy"; LK.enemyPhaseAll(s);
  ok(s.enc.dmgQueue.some(q=>q.unitId==="ship"&&q.dmg===2), "rush hits first unit on lane for 2");
  ok(J.hp===11, "juggernaut hurts itself on impact (12->11)", "hp="+J.hp);
  ok(LK.tdist(J,ship)===1, "juggernaut stops adjacent to victim", "d="+LK.tdist(J,ship));
  while(LK.pendingDamage(s)) LK.resolveDamage(s,"hp");
}
{
  // マザー・ミトス: 殴らず産卵、近づかれたら距離3へ位相転移
  const s=arena(99,[{id:"B",type:"broodmother",x:3,y:2,hp:10}]);
  s.enc.round=1; // 奇数R=幼体
  s.enc.step="intents"; s.enc.phase=null; LK.pump(s);
  let it=s.enc.intents.find(i=>i.unitId==="B");
  ok(it && it.summon && it.summon.type==="larva", "broodmother telegraphs larva egg", JSON.stringify(it&&it.summon));
  s.enc.step="enemy"; s.enc.phase="enemy"; LK.enemyPhaseAll(s);
  ok(LK.enemies(s.enc).some(u=>u.type==="larva"), "egg hatches into enemy larva");
  const ship=LK.unitById(s.enc,"ship"); ship.x=2; ship.y=2; // 隣接圧
  s.enc.round=3;
  s.enc.step="intents"; s.enc.phase=null; LK.pump(s);
  it=s.enc.intents.find(i=>i.unitId==="B");
  ok(it && it.teleport && it.moveTo, "broodmother plans escape teleport when pressured");
  s.enc.step="enemy"; s.enc.phase="enemy"; LK.enemyPhaseAll(s);
  const B=LK.unitById(s.enc,"B");
  ok(LK.players(s.enc).every(p=>LK.tdist(B,p)>=3), "teleport lands at distance>=3 from all players", "d="+LK.tdist(B,ship));
  // ボス撃破は種類を問わず「伝説」フラグ — playerフェーズまで進めてから撃つ
  while(LK.pendingDamage(s)) LK.resolveDamage(s,"hp");
  if(s.enc.phase==="drift") LK.driftPhase(s);
  while(LK.pendingDamage(s)) LK.resolveDamage(s,"hp");
  const adj=[[1,0],[-1,0],[0,1],[0,-1]]
    .map(([dx,dy])=>({x:LK.wrap(ship.x+dx),y:LK.wrap(ship.y+dy)}))
    .find(c=>!LK.unitAt(s.enc,c.x,c.y));
  B.x=adj.x; B.y=adj.y; B.hp=1;
  const r=shoot(s,"B");
  ok(r.ok && !B.alive && s.run.bossKilled===true, "killing any boss sets bossKilled", r.msg||("phase="+s.enc.phase));
  while(LK.pendingDamage(s)) LK.resolveDamage(s,"hp");
}
{
  // トーラスラップ通知: 縁越えドリフトは wrapFx に記録される(UIが退場→入場アニメに使う)
  const s=arena(100,[{id:"M",type:"miner",x:3,y:3,hp:9}]);
  const ship=LK.unitById(s.enc,"ship"); ship.x=0; ship.y=1; ship.drift="left";
  s.enc.step="drift"; s.enc.phase=null; LK.driftPhase(s);
  ok(ship.x===4, "drift wraps across seam");
  ok((s.enc.wrapFx||[]).some(w=>w.unitId==="ship"&&w.dir==="left"), "seam crossing recorded in wrapFx", JSON.stringify(s.enc.wrapFx));
  const before=(s.enc.wrapFx||[]).length;
  ship.drift="left"; // 4→3: 縁越えなし
  s.enc.step="drift"; s.enc.phase=null; LK.driftPhase(s);
  ok((s.enc.wrapFx||[]).length===before, "normal drift adds no wrap note");
  while(LK.pendingDamage(s)) LK.resolveDamage(s,"hp");
}
{
  // 航行契約(危機契約翻訳): 全6タグの効果+スコア倍率
  const s=LK.newRun(51,null,{contracts:["heavy","throttle","minefield","fragile","norepair","swarm"]});
  ok(LK.fuelCost(s)===2, "throttle: fuel cost 1->2");
  ok(s.run.shipHp===6, "fragile: vagrants start hull 8->6", "hp="+s.run.shipHp);
  LK.startEncounter(s,null);
  ok(LK.unitById(s.enc,"ship").hp===6, "fragile hull applies in encounter");
  const es=LK.enemies(s.enc);
  ok(es.length===3, "swarm: z1 first encounter 2->3 enemies", "n="+es.length);
  ok(es.every(e=>e.maxHp===LK.ENEMY_DEFS[e.type].hp+1), "heavy: all enemies +1 hp");
  ok(s.enc.units.filter(u=>u.type==="mine").length===2, "minefield: +2 mines (z1 base 0)");
  const rr=LK.applyResupply(s);
  ok(!rr.ok, "norepair: resupply blocked");
  ok(Math.abs(LK.contractMult(s.run)-2.2)<1e-9, "6 contracts -> x2.2 multiplier");
  ok(LK.runScore(s)===Math.round(LK.aliveCards(s).length*3*2.2), "score multiplied by contracts", "score="+LK.runScore(s));
}

{
  // 船長診断(3軸8型): レジストリ網羅+判定+サブ称号+カウンター
  const keys=Object.keys(LK.CAPTAIN_TYPES);
  ok(keys.length===8, "8 captain types");
  const combos=new Set(keys.map(k=>{const t=LK.CAPTAIN_TYPES[k];return `${t.f}${t.r}${t.c}`;}));
  ok(combos.size===8, "axis combos exhaustive (2^3)");
  ok(keys.every(k=>{const t=LK.CAPTAIN_TYPES[k];return t.name&&t.title&&t.praise&&t.weak&&t.rarity>0;}), "all types fully written");
  const totalRarity=keys.reduce((s,k)=>s+LK.CAPTAIN_TYPES[k].rarity,0);
  ok(totalRarity===100, "rarity sums to 100%", "sum="+totalRarity);

  function fakeRun(over){
    const s=LK.newRun(1);
    Object.assign(s.run,{kills:10,physKills:0,routeTotal:4,routeDanger:0,contracts:[],deployed:[],
      undoCount:0,chooseRest:0,zone:3,totalRounds:20},over);
    return s;
  }
  ok(LK.captainType(fakeRun({})).id==="merchant", "merchant: 砲・堅実・即興");
  ok(LK.captainType(fakeRun({physKills:5})).id==="brawler", "brawler: +物理");
  ok(LK.captainType(fakeRun({routeDanger:4})).id==="gambler", "gambler: +危険ルート");
  ok(LK.captainType(fakeRun({undoCount:3})).id==="surveyor", "surveyor: +熟慮");
  ok(LK.captainType(fakeRun({physKills:5,routeDanger:4})).id==="pirate", "pirate: 物理+危険");
  ok(LK.captainType(fakeRun({physKills:5,undoCount:3})).id==="engineer", "engineer: 物理+熟慮");
  ok(LK.captainType(fakeRun({routeDanger:4,undoCount:3})).id==="sniper", "sniper: 危険+熟慮");
  ok(LK.captainType(fakeRun({physKills:5,routeDanger:4,undoCount:3})).id==="hunter", "hunter: 全部盛り");
  const s2=fakeRun({physKills:9,kills:12});
  s2.run.bossKilled=true; s2.run.win=true; s2.run.contracts=["heavy","swarm","fragile"];
  const ct=LK.captainType(s2);
  ok(ct.subs.includes("👑伝説")&&ct.subs.includes("💥轢断魔")&&ct.subs.includes("☠鉄の契約者"), "sub titles stack", JSON.stringify(ct.subs));
  ok(typeof ct.jab==="string"&&ct.jab.length>0, "data-driven jab generated");
  // カウンター配線
  const s3=LK.newRun(5);
  LK.chooseRoute(s3,"danger"); LK.chooseRoute(s3,"safe");
  ok(s3.run.routeTotal===2&&s3.run.routeDanger===1, "route counters wired");
}

{
  // 全カード×両面スモークテスト: 全アクション種が最低1回実行できることを機械検証(網羅QA)
  console.log("== all-cards smoke test ==");
  function paramsFor(s,unit,spec){
    switch(spec.kind){
      case "move": { const o=LK.moveOptions(s,unit,spec)[0]; return o?{unitId:unit.id,cell:{x:o.x,y:o.y},dir:o.dir}:null; }
      case "brake_move": return {unitId:unit.id, cell:null};
      case "ram": { const o=LK.ramOptions(s,unit,spec)[0]; return o?{unitId:unit.id,dir:o.dir}:null; }
      case "warp": { for(let x=0;x<LK.CONFIG.GRID;x++)for(let y=0;y<LK.CONFIG.GRID;y++) if(!LK.unitAt(s.enc,x,y)) return {unitId:unit.id,cell:{x,y}}; return null; }
      case "attack": case "attack_line": case "pierce": case "push": case "pull": case "attack_push": case "attack_pull": case "execute": {
        const t=LK.attackTargets(s,unit,spec)[0]; return t?{unitId:unit.id,targetId:t.id}:null; }
      case "spawnhaz": return {unitId:unit.id};
      case "setdrift": { const t=LK.attackTargets(s,unit,spec)[0]; return t?{unitId:unit.id,targetId:t.id,dir:"up"}:null; }
      case "attack_all": case "pull_all": case "heal": case "shield": return {unitId:unit.id};
      case "attack_multi": { const ts=LK.attackTargets(s,unit,spec); return ts.length?{unitId:unit.id,targetIds:[ts[0].id]}:null; }
      case "salvage": { const d=LK.cardsIn(s,"discard")[0]; return d?{unitId:unit.id,salvageUid:d.uid}:null; }
    }
    return null;
  }
  for(const defId of Object.keys(LK.CARD_DEFS)){
    for(const half of ["top","bottom"]){
      const s=LK.newRun(77);
      s.run.cards=[
        {uid:"t0",defId,loc:"pool",up:false},
        {uid:"t1",defId:"c_burn",loc:"pool",up:false},
        {uid:"t2",defId:"c_burn",loc:"pool",up:false},
        {uid:"t3",defId:"c_patch",loc:"pool",up:false},
        {uid:"t4",defId:"c_evade",loc:"pool",up:false},
        {uid:"t5",defId:"c_salvo",loc:"pool",up:false},
      ];
      LK.startEncounter(s,["t0","t1","t2","t3","t4","t5"]);
      // 統制された盤面: 敵1体(HP9)を(1,1)に、他は排除。船(0,1)・無ドリフト
      const enc=s.enc;
      enc.units=enc.units.filter(u=>u.side==="player");
      enc.units.push({id:"E",side:"enemy",type:"miner",name:"標的",icon:"🤖",x:1,y:1,hp:9,maxHp:9,dmg:1,drift:null,shield:0,alive:true,patIdx:0});
      enc.container=null;
      for(const u of enc.units) u.drift=null;
      const ship=LK.unitById(enc,"ship");
      ship.x=0; ship.y=1; ship.hp=3; // healが意味を持つように減らしておく
      const r0=LK.selectPair(s,"t0",half,"t1");
      if(!r0.ok){ ok(false, `selectPair ${defId}.${half}`, r0.msg); continue; }
      const c2=LK.cardByUid(s,"t2"); c2.loc="discard"; // salvage用
      const spec=LK.actionSpec(s,0);
      const params=paramsFor(s,ship,spec);
      if(!params){ ok(false, `paramsFor ${defId}.${half} (${spec.kind})`, "no valid target engineered"); continue; }
      const r=LK.execAction(s,0,params);
      ok(r.ok, `exec ${defId}.${half} (${spec.kind})`, r.msg);
    }
  }
}

// ---------- policy simulation ----------
function shuffle(arr, rnd){ const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }

function makePolicy(kind, rnd) {
  const smart = kind==="greedy" || kind==="deep";
  return {
    loadout(s){ return null; }, // default first-6
    pickPair(s){
      const hand = LK.cardsIn(s,"hand");
      if (smart) {
        // 攻撃半分を持つカードを優先してペアに
        const scored = hand.map(c=>{
          const d=LK.defOf(c);
          const atk=(d.bottom.kind||"").startsWith("attack")?2:( ["push","pull"].includes(d.bottom.kind)?1:0 );
          return {c,atk};
        }).sort((a,b)=>b.atk-a.atk);
        return [scored[0].c.uid,"top",scored[1].c.uid];
      }
      const sh = shuffle(hand, rnd);
      return [sh[0].uid, rnd()<0.5?"top":"bottom", sh[1].uid];
    },
    execHalf(s, idx){
      // 即時勝利(L-015)で残り行動が自動完了している場合がある
      if(!s.enc || !s.enc.pending || !s.enc.pending[idx] || s.enc.pending[idx].done) return;
      const spec = LK.actionSpec(s, idx);
      const enc = s.enc;
      const smart = kind==="greedy" || kind==="deep";
      const units = smart ? LK.players(enc) : shuffle(LK.players(enc), rnd);
      for (const u of units) {
        switch (spec.kind) {
          case "move": case "brake_move": {
            const opts = LK.moveOptions(s,u,spec);
            if (spec.kind==="brake_move" && (!opts.length || rnd()<0.3)) {
              if (LK.execAction(s,idx,{unitId:u.id,cell:null}).ok) return;
              continue;
            }
            if (!opts.length) continue;
            let cell;
            if (smart) {
              const es = LK.enemies(enc);
              if (es.length) {
                cell = opts.reduce((best,o)=>{
                  const d = Math.min(...es.map(e=>LK.tdist(o,e)));
                  return (!best||d<best.d)?{o,d}:best;
                },null).o;
              } else cell = opts[0];
            } else cell = opts[Math.floor(rnd()*opts.length)];
            if (LK.execAction(s,idx,{unitId:u.id,cell:{x:cell.x,y:cell.y},dir:cell.dir}).ok) return;
            break;
          }
          case "ram": {
            for (const k of shuffle(LK.DIR_KEYS,rnd))
              if (LK.execAction(s,idx,{unitId:u.id,dir:k}).ok) return;
            break;
          }
          case "warp": {
            for (let x=0;x<LK.CONFIG.GRID;x++) for (let y=0;y<LK.CONFIG.GRID;y++)
              if (!LK.unitAt(enc,x,y) && LK.execAction(s,idx,{unitId:u.id,cell:{x,y}}).ok) return;
            break;
          }
          case "attack": case "attack_line": case "pierce": case "push": case "pull": case "setdrift": case "attack_push": case "attack_pull": {
            let ts = LK.attackTargets(s,u,spec).filter(t=>t.side==="enemy");
            if (!ts.length) continue;
            if (smart) ts=[...ts].sort((a,b)=>a.hp-b.hp);
            const params = {unitId:u.id, targetId:ts[0].id};
            if (spec.kind==="setdrift") params.dir = LK.DIR_KEYS[Math.floor(rnd()*4)];
            if (LK.execAction(s,idx,params).ok) return;
            break;
          }
          case "attack_all": case "pull_all": case "spawnhaz": {
            if (LK.execAction(s,idx,{unitId:u.id}).ok) return;
            break;
          }
          case "execute": {
            const ts=LK.attackTargets(s,u,spec).filter(t=>t.side==="enemy").sort((a,b)=>a.hp-b.hp);
            if (ts.length && LK.execAction(s,idx,{unitId:u.id,targetId:ts[0].id}).ok) return;
            break;
          }
          case "attack_multi": {
            const ts = LK.attackTargets(s,u,spec).filter(t=>t.side==="enemy");
            if (!ts.length) continue;
            const ids = ts.slice(0,spec.count).map(t=>t.id);
            if (LK.execAction(s,idx,{unitId:u.id,targetIds:ids}).ok) return;
            break;
          }
          case "heal": {
            const hurt = units.filter(x=>x.hp<x.maxHp).sort((a,b)=>(a.hp/a.maxHp)-(b.hp/b.maxHp));
            const t = (smart && hurt.length) ? hurt[0] : u;
            if (LK.execAction(s,idx,{unitId:t.id}).ok) return;
            break;
          }
          case "shield": { if (LK.execAction(s,idx,{unitId:u.id}).ok) return; break; }
          case "salvage": {
            const d = LK.cardsIn(s,"discard");
            if (d.length && LK.execAction(s,idx,{unitId:u.id,salvageUid:d[0].uid}).ok) return;
            break;
          }
        }
      }
      LK.fizzleAction(s, idx);
    },
    onDamage(s){
      const q = LK.pendingDamage(s);
      const u = LK.unitById(s.enc, q.unitId);
      const eff = Math.max(0, q.dmg - u.shield);
      const burnable = [...LK.cardsIn(s,"discard"), ...LK.cardsIn(s,"hand")];
      const lethal = u.hp <= eff && u.id==="ship";
      const spare = LK.aliveCards(s).length > 4;
      if (burnable.length && (lethal || (kind==="greedy" && u.hp<=eff))) {
        LK.resolveDamage(s,"burn",burnable[0].uid);
      } else LK.resolveDamage(s,"hp");
    },
    onRest(s){
      const ship=LK.unitById(s.enc,"ship");
      if (smart && ship.hp>=3) {
        // HPを払ってでも弱いカードを選んで捨てる
        const hand=[...LK.cardsIn(s,"hand"), ...LK.cardsIn(s,"discard")];
        const scored=hand.map(c=>{const d=LK.defOf(c);
          let v=0; if(d.relic)v+=5; if((d.bottom.kind||"").startsWith("attack"))v+=d.bottom.dmg||1; if(d.bottom.kind==="heal")v+=2;
          return {c,v};}).sort((a,b)=>a.v-b.v);
        const r=LK.doRest(s,"choose",scored[0].c.uid);
        if(!r.ok) LK.doRest(s,"random");
      } else {
        LK.doRest(s,"random");
      }
    },
    route(s){
      if (kind==="deep") return "danger";
      return kind==="greedy" ? (LK.aliveCards(s).length>=8?"danger":"safe") : (rnd()<0.5?"danger":"safe");
    },
    relic(s){
      if (kind==="deep") return "deploy";
      return kind==="greedy" ? (LK.aliveCards(s).length>=7?"seal":"deploy") : (rnd()<0.5?"deploy":"seal");
    },
    leapOrKeep(s){
      if (s.run.zone >= LK.CONFIG.ZONES) return "keep";
      if (kind==="deep") return LK.aliveCards(s).length>=4 ? "leap" : "keep";
      if (kind==="greedy") return LK.aliveCards(s).length>=7 ? "leap" : "keep";
      return "leap"; // random policy: 死ぬまで潜る
    },
    fuel(s){
      const cards=LK.aliveCards(s);
      if (smart){
        const scored=cards.map(c=>{const d=LK.defOf(c);let v=0;if(d.relic)v+=5;if((d.bottom.kind||"").startsWith("attack"))v+=d.bottom.dmg||1;return {c,v};}).sort((a,b)=>a.v-b.v);
        return scored[0].c.uid;
      }
      return cards[Math.floor(rnd()*cards.length)].uid;
    },
  };
}

function simulateRun(seed, kind) {
  const rnd = (()=>{ let a=seed^0x9e3779b9; return ()=>{ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; })();
  const P = makePolicy(kind, rnd);
  const s = LK.newRun(seed);
  LK.startEncounter(s, P.loadout(s));
  let guard = 0;
  while (!s.run.over) {
    if (++guard > 3000) return {stuck:true, seed, phase:s.enc&&s.enc.phase, step:s.enc&&s.enc.step, zone:s.run.zone};
    if (s.enc) {
      if (LK.pendingDamage(s)) { P.onDamage(s); continue; }
      if (s.enc.phase === "cleared") {
        LK.finishEncounter(s);
        if (s.screen === "upgrade") {
          // 整備ドック三択: 船体が痛んでいれば補給、元気なら強化(保険vs投資)
          const sd=LK.shipDef(s.run.shipId);
          const hull=s.run.shipHp??sd.hp;
          if (kind!=="random" && hull<=sd.hp-3) LK.applyResupply(s);
          else if (kind==="random" && rnd()<0.33) LK.applyScrapLoot(s);
          else {
            const cands=LK.aliveCards(s).filter(c=>!c.up);
            const pick=cands.length?[...cands].sort((a,b)=>((LK.defOf(b).bottom.dmg||0)-(LK.defOf(a).bottom.dmg||0)))[0].uid:null;
            LK.applyUpgrade(s,pick);
          }
        }
        if (s.screen === "route") { LK.chooseRoute(s, P.route(s)); LK.startEncounter(s, P.loadout(s)); s.screen="battle"; }
        else if (s.screen === "relic") {
          LK.resolveRelic(s, P.relic(s));
          const lk = P.leapOrKeep(s);
          if (lk === "keep") LK.doKeep(s);
          else { const r = LK.doLeap(s, P.fuel(s)); if (r.ok && !s.run.over) { LK.startEncounter(s, P.loadout(s)); s.screen="battle"; } }
        }
        continue;
      }
      if (s.enc.phase === "rest") { P.onRest(s); continue; }
      if (s.enc.phase === "crashsalvage") {
        const d=LK.cardsIn(s,"discard");
        const ship=LK.unitById(s.enc,"ship");
        if (ship.hp<ship.maxHp && (!d.length || ship.hp<=ship.maxHp-2)) LK.crashSalvageRepair(s);
        else if (d.length) LK.crashSalvagePick(s, d[0].uid);
        else LK.crashSalvageRepair(s);
        continue;
      }
      if (s.enc.phase === "drift") { LK.driftPhase(s); continue; }
      if (s.enc.phase === "enemy") {
        // テレグラフ正直性(L-003): 攻撃予告マス外のプレイヤーは攻撃ダメージを受けないこと
        const tel = new Set();
        for (const it of s.enc.intents) {
          const eu = LK.unitById(s.enc, it.unitId);
          if (eu && eu.alive) for (const c of it.attackCells) tel.add(c.x+","+c.y);
        }
        LK.enemyPhaseAll(s);
        for (const q of s.enc.dmgQueue) {
          if (/攻撃|主砲/.test(q.src)) {
            const v = LK.unitById(s.enc, q.unitId);
            if (v && !tel.has(v.x+","+v.y)) telegraphViolations.push({seed, src:q.src, at:v.x+","+v.y});
          }
        }
        continue;
      }
      if (s.enc.phase === "player") {
        const [a,half,b] = P.pickPair(s);
        const r = LK.selectPair(s,a,half,b);
        if (!r.ok) return {stuck:true,seed,reason:"selectPair:"+r.msg};
        P.execHalf(s,0); P.execHalf(s,1);
        if (s.enc && s.enc.awaitEnd) LK.commitTurn(s);
        continue;
      }
      return {stuck:true, seed, phase:s.enc.phase, step:s.enc.step};
    }
    return {stuck:true, seed, reason:"no enc, screen="+s.screen};
  }
  return { seed, win:s.run.win, zone:s.run.zone, reason:s.run.reason, rounds:s.run.totalRounds,
    cargo:LK.cargoValue(s), cardsLeft:LK.aliveCards(s).length, rests:s.run.restCount, burns:s.run.burnCount };
}

const N = Number(process.argv[2] || 200);
console.log(`\n== policy simulation (${N} runs/policy) ==`);
const telegraphViolations = [];
const zone4plus = {};
for (const kind of ["random","greedy","deep"]) {
  const rs = [];
  let stuck = 0;
  for (let i=0;i<N;i++) {
    const r = simulateRun(1000+i, kind);
    if (r.stuck) { stuck++; if (stuck<=3) console.error("  STUCK:", JSON.stringify(r)); continue; }
    rs.push(r);
  }
  const avg = f => (rs.reduce((s,r)=>s+f(r),0)/Math.max(1,rs.length));
  const winRate = avg(r=>r.win?1:0);
  const wins = rs.filter(r=>r.win);
  const winCargo = wins.length ? wins.reduce((s,r)=>s+r.cargo,0)/wins.length : 0;
  const winZone = wins.length ? wins.reduce((s,r)=>s+r.zone,0)/wins.length : 0;
  const causes = {};
  rs.forEach(r=>{causes[r.reason]=(causes[r.reason]||0)+1;});
  console.log(`${kind.padEnd(7)} | stuck:${stuck} win:${(winRate*100).toFixed(0)}% avgZone:${avg(r=>r.zone).toFixed(2)} avgRounds:${avg(r=>r.rounds).toFixed(1)} rests:${avg(r=>r.rests).toFixed(1)} burns:${avg(r=>r.burns).toFixed(1)} | wins→ zone:${winZone.toFixed(1)} cargo:${winCargo.toFixed(1)} | causes:${JSON.stringify(causes)}`);
  globalThis["_stats_"+kind] = {winRate, avgZone:avg(r=>r.zone), stuck, avgRounds:avg(r=>r.rounds), winCargo, winZone,
    deepReach: rs.filter(r=>r.zone>=4).length/Math.max(1,rs.length)};
}

const g = globalThis["_stats_greedy"], r = globalThis["_stats_random"], d = globalThis["_stats_deep"];
ok(telegraphViolations.length===0, "telegraph honesty: no attack damage outside red cells (L-003)",
   JSON.stringify(telegraphViolations.slice(0,3)));
ok(g.stuck===0 && r.stuck===0 && d.stuck===0, "no stuck runs");
ok(g.winRate > r.winRate + 0.3, "skill signal: greedy banks wins far more than random", `greedy=${(g.winRate*100).toFixed(0)}% random=${(r.winRate*100).toFixed(0)}%`);
ok(g.winCargo >= 1, "greedy wins carry real cargo (seal is viable)", `winCargo=${g.winCargo.toFixed(1)}`);
// v0.7 コンボ前提難度: botは物理キル連鎖・貫通・船体管理を活用できないため下限を緩く設定(人間検証はplayrun)
ok(d.deepReach > 0.1, "deploy-heavy strategy makes zone4+ reachable (bot floor)", `reach=${(d.deepReach*100).toFixed(0)}%`);
ok(d.winRate >= 0.04, "full-depth runs are survivable sometimes (N=200で~0.10、小Nの二項揺れを許容)", `deep winRate=${(d.winRate*100).toFixed(0)}%`);
ok(g.avgRounds < 60 && d.avgRounds < 60, "run length sane (<60 rounds)", `greedy=${g.avgRounds.toFixed(1)} deep=${d.avgRounds.toFixed(1)}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
