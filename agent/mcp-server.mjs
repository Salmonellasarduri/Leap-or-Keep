// Leap or Keep — MCPサーバ(AIエージェントがツール呼び出しでプレイする)
// 登録例(Claude Code): claude mcp add leap-or-keep -- node E:/Project/Leap-or-Keep/agent/mcp-server.mjs
// ツール: lok_new_run → lok_state ⇄ lok_choose を繰り返す → 終了時に診断とログ
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { newGame, legalChoices, applyChoice, observe, autoForward, LK } from "./protocol.mjs";

let S = null;
let LOG = { opts: null, ids: [], says: [] };

function view(note) {
  const obs = observe(S);
  const cs = legalChoices(S);
  const lines = [];
  if (note) lines.push(note);
  lines.push(obs);
  if (cs.length) {
    lines.push(`\nCHOICES(lok_chooseにidを渡す):`);
    for (const c of cs) lines.push(`  ${c.id}  …${c.label}`);
  } else {
    lines.push("\n(ラン終了 — lok_log で記録を取得できる)");
  }
  return lines.join("\n");
}

const server = new McpServer({ name: "leap-or-keep", version: "0.9.0" });

server.tool(
  "lok_new_run",
  "新しいランを開始する。以後 lok_state で観測し lok_choose で行動する。ゲームのルール: カード=行動=寿命。2枚選び▲航行/▼戦闘を旗艦(船)と随伴機(機)に割当。移動した者は次ラウンド同方向に1マス滑る(慣性)。盤の端はループ。敵の行動は全て事前予告される。各ゾーンの後で「跳ぶ(深く・強敵・良い遺物)」か「帰る(勝利確定)」を選ぶ。",
  {
    seed: z.number().int().optional().describe("乱数シード(省略=ランダム)。同シード同選択=同展開"),
    ship: z.enum(["vagrants", "bellyroll", "astra"]).optional().describe("船体: vagrants=標準 / bellyroll=物理特化(衝突無傷・物理+1) / astra=射程+1の紙装甲"),
    asc: z.number().int().min(0).max(3).optional().describe("アセンション難度0-3"),
    contracts: z.array(z.enum(["heavy", "swarm", "throttle", "norepair", "minefield", "fragile"])).optional()
      .describe("航行契約(リスク自選 — 盛るほどスコア倍率と称号)"),
  },
  async (a) => {
    const opts = { seed: a.seed ?? Math.floor(Math.random() * 1e9), ship: a.ship || "vagrants", asc: a.asc || 0, contracts: a.contracts || [] };
    S = newGame(opts);
    LOG = { opts, ids: [], says: [] };
    return { content: [{ type: "text", text: view(`# 新規ラン seed=${opts.seed} ship=${opts.ship}`) }] };
  }
);

server.tool("lok_state", "現在の盤面・敵意図・手札・合法手リストを観測する", {}, async () => {
  if (!S) return { content: [{ type: "text", text: "ランが無い — lok_new_run から始める" }] };
  return { content: [{ type: "text", text: view() }] };
});

server.tool(
  "lok_choose",
  "合法手リストのidを実行する(複数可=順に適用)。強制フェイズ(合法手1つ)は自動進行。sayで判断への一言実況を残せる(記事素材になる)",
  {
    ids: z.array(z.string()).min(1).describe("CHOICESに列挙されたid(複数なら順に適用、途中失敗で停止)"),
    say: z.string().optional().describe("この判断への一言コメント(キャラクターとしての実況 — lok_logの実況タイムラインに載る)"),
  },
  async ({ ids, say }) => {
    if (!S) return { content: [{ type: "text", text: "ランが無い — lok_new_run から始める" }] };
    if (say) LOG.says.push({ at: LOG.ids.length, text: say });
    const notes = [];
    for (const id of ids) {
      const legal = legalChoices(S);
      if (!legal.some(c => c.id === id) && !/^(leap:|loadout:)/.test(id)) {
        notes.push(`✖ "${id}" は合法手にない(直前までは適用済み)`);
        return { content: [{ type: "text", text: notes.join("\n") + "\n" + view() }] };
      }
      const r = applyChoice(S, id);
      if (!r.ok) { notes.push(`✖ 失敗: ${id}: ${r.msg || "?"}`); return { content: [{ type: "text", text: notes.join("\n") + "\n" + view() }] }; }
      LOG.ids.push(id);
      notes.push(`✔ ${id}`);
      const fwd = autoForward(S);
      if (fwd.length) { LOG.ids.push(...fwd); notes.push(`⏩ 自動進行: ${fwd.join(" → ")}`); }
      if (S.run.over) break;
    }
    return { content: [{ type: "text", text: view(notes.join("\n")) }] };
  }
);

server.tool("lok_log", "ランの記録(シード・全選択ID・スコア・船長診断)を取得 — 記事/共有用", {}, async () => {
  if (!S) return { content: [{ type: "text", text: "ランが無い" }] };
  const over = S.run.over;
  const timeline = LOG.ids.map((id, i) => {
    const said = LOG.says.filter(x => x.at === i).map(x => x.text);
    return said.length ? `${id}  💬「${said.join("」「")}」` : id;
  });
  const data = {
    opts: LOG.opts, choices: LOG.ids.length,
    over, win: S.run.win, reason: S.run.reason, zone: S.run.zone,
    score: over ? LK.runScore(S) : null,
    captain: over ? LK.captainType(S) : null,
    timeline,
    recentLog: S.run.log.slice(0, 30).map(l => l.msg),
  };
  return { content: [{ type: "text", text: JSON.stringify(data, null, 1) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
