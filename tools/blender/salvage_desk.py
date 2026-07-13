# Leap or Keep — Phase 0 スパイク: サルベージ船オペレーター卓ジオラマ
# 実行例(headless):
#   blender -b -P tools/blender/salvage_desk.py -- --render all --samples 64 --res 1280x720 --out tmp/blender
#   blender -b -P tools/blender/salvage_desk.py -- --glb tools/blender/export/salvage_desk.glb
# スタイル: art/PROMPTS.md 準拠 — 深宇宙のニアブラック青背景、ティール+アンバーのネオンリム、レトロフューチャー
import bpy
import math
import sys
import os

# ---------------------------------------------------------------- 引数
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


RENDER = arg("--render")            # None | "main" | "hero" | "side" | "all"
GLB = arg("--glb")                  # 出力GLBパス
SAMPLES = int(arg("--samples", "64"))
RES = arg("--res", "1280x720")
OUT = arg("--out", "tmp/blender")
RES_X, RES_Y = (int(v) for v in RES.split("x"))

TEAL = (0.05, 0.85, 0.85, 1.0)
AMBER = (1.0, 0.45, 0.08, 1.0)
RED = (1.0, 0.05, 0.02, 1.0)
DARKMETAL = (0.028, 0.033, 0.042, 1.0)
DESKTOP = (0.045, 0.052, 0.065, 1.0)

# ---------------------------------------------------------------- 初期化
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def make_mat(name, base=(0.5, 0.5, 0.5, 1), rough=0.6, metal=0.0,
             emit=None, strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = base
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = emit
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


def add_box(name, size, loc, mat, rot=(0, 0, 0), scale=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = scale or (size[0] / 2, size[1] / 2, size[2] / 2)
    o.data.materials.append(mat)
    return o


def add_cyl(name, r, depth, loc, mat, rot=(0, 0, 0), verts=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth,
                                        location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    return o


# ---------------------------------------------------------------- マテリアル
mat_desk = make_mat("desk", (0.018, 0.022, 0.03, 1), rough=0.55, metal=0.6)
mat_frame = make_mat("frame", DARKMETAL, rough=0.7, metal=0.8)
mat_floor = make_mat("floor", (0.012, 0.014, 0.02, 1), rough=0.9)
mat_tile = make_mat("tile_teal", (0.01, 0.05, 0.05, 1), rough=0.4,
                    emit=TEAL, strength=2.2)
mat_tile_warn = make_mat("tile_warn", (0.06, 0.02, 0.005, 1), rough=0.4,
                         emit=AMBER, strength=2.6)
mat_ship = make_mat("ship", (0.04, 0.25, 0.28, 1), rough=0.35, metal=0.7,
                    emit=TEAL, strength=1.8)
mat_enemy = make_mat("enemy", (0.12, 0.02, 0.01, 1), rough=0.5,
                     emit=RED, strength=1.6)
mat_card = make_mat("card_face", (0.012, 0.015, 0.022, 1), rough=0.62)
mat_card_edge = make_mat("card_edge", (0.01, 0.04, 0.04, 1), rough=0.4,
                         emit=TEAL, strength=1.4)
mat_screen = make_mat("screen_text", (0.02, 0.01, 0.0, 1), rough=0.5,
                      emit=AMBER, strength=2.0)
mat_relic = make_mat("relic_body", (0.06, 0.055, 0.05, 1), rough=0.45, metal=0.85)
mat_relic_glow = make_mat("relic_glow", (0.05, 0.02, 0, 1), rough=0.3,
                          emit=AMBER, strength=5.0)
mat_star = make_mat("star", (0, 0, 0, 1), emit=(0.9, 0.95, 1.0, 1), strength=6.0)
mat_lamp_ind = make_mat("indicator", (0.03, 0.01, 0, 1), emit=AMBER, strength=2.5)

# ---------------------------------------------------------------- 部屋・机
add_box("floor", (8, 8, 0.1), (0, 0, -0.05), mat_floor)
add_box("desk_top", (1.9, 1.0, 0.06), (0, 0, 0.75), mat_desk)
add_box("desk_leg_l", (0.08, 0.9, 0.72), (-0.86, 0, 0.36), mat_frame)
add_box("desk_leg_r", (0.08, 0.9, 0.72), (0.86, 0, 0.36), mat_frame)
add_box("desk_back", (1.9, 0.08, 0.3), (0, 0.5, 0.9), mat_frame)      # 背面立ち上がり(低め)
add_box("desk_lip", (1.9, 0.05, 0.05), (0, -0.515, 0.765), mat_frame)  # 手前の縁(面一)

# ---------------------------------------------------------------- 4×4 ホロ盤面
TILE = 0.115
GAP = 0.02
HOVER = 0.86
warn_tiles = {(2, 1), (2, 2)}          # 敵テレグラフ(アンバー)
origin = -1.5 * (TILE + GAP)
for gx in range(4):
    for gy in range(4):
        x = origin + gx * (TILE + GAP)
        y = origin + gy * (TILE + GAP) + 0.08
        mat = mat_tile_warn if (gx, gy) in warn_tiles else mat_tile
        add_box(f"tile_{gx}{gy}", (TILE, TILE, 0.012), (x, y, HOVER), mat)

# プロジェクター台座
add_cyl("projector", 0.09, 0.05, (0, 0.08, 0.785), mat_frame, verts=16)

# 自機トークン(くさび形=船、盤面奥向きに寝かせる) — タイル(1,0)に配置
bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.032, depth=0.075,
                                location=(origin + (TILE + GAP), origin + 0.08,
                                          HOVER + 0.035),
                                rotation=(math.radians(-90), 0, 0))
ship = bpy.context.object
ship.name = "ship_token"
ship.data.materials.append(mat_ship)

# 敵トークン(八面体)×2 — テレグラフしているタイルの奥
for i, (gx, gy) in enumerate([(2, 2), (3, 1)]):
    x = origin + gx * (TILE + GAP)
    y = origin + gy * (TILE + GAP) + 0.08
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.04,
                                          location=(x, y, HOVER + 0.05))
    e = bpy.context.object
    e.name = f"enemy_{i}"
    e.data.materials.append(mat_enemy)

# ---------------------------------------------------------------- 手札カード(4枚ファン、机に接地)
CARD_W, CARD_H, CARD_T = 0.115, 0.165, 0.004
TILT = math.radians(24)                  # 机から軽く起こしてカメラに顔を向ける
# カードのローカル法線/上方向(X軸回転TILT後)
n = (0.0, -math.sin(TILT), math.cos(TILT))       # 法線(面の向き)
u = (0.0, math.cos(TILT), math.sin(TILT))        # カード面内の上方向
for i in range(4):
    t = (i - 1.5) / 1.5
    x = t * 0.26
    y = -0.30 + abs(t) * 0.015
    lift = 0.02 if i == 2 else 0.0       # 1枚だけ浮かせる(選択中)
    rot_z = -t * math.radians(8)
    # 机上面(0.78)に下端が触れる高さ: 中心 = 0.78 + (H/2)*sin(TILT) + 余白
    cz = 0.78 + (CARD_H / 2) * math.sin(TILT) + 0.006 + lift
    add_box(f"card_{i}_edge", (CARD_W, CARD_H, CARD_T),
            (x, y, cz), mat_card_edge, rot=(TILT, 0, rot_z))
    add_box(f"card_{i}_face", (CARD_W * 0.88, CARD_H * 0.88, CARD_T),
            (x + n[0] * 0.003, y + n[1] * 0.003, cz + n[2] * 0.003),
            mat_card, rot=(TILT, 0, rot_z))
    # カード中央の簡易アイコン(発光シジル)
    ix = x + n[0] * 0.006 + u[0] * 0.012
    iy = y + n[1] * 0.006 + u[1] * 0.012
    iz = cz + n[2] * 0.006 + u[2] * 0.012
    add_box(f"card_{i}_icon", (0.034, 0.034, CARD_T),
            (ix, iy, iz), mat_card_edge, rot=(TILT, 0, rot_z))

# ---------------------------------------------------------------- 小道具
# 遺物キャニスター(右奥) — 発光スリット入り円筒
add_cyl("relic", 0.055, 0.16, (0.62, 0.22, 0.83), mat_relic,
        rot=(0, math.radians(90), math.radians(15)))
add_cyl("relic_slit", 0.057, 0.018, (0.62, 0.22, 0.83), mat_relic_glow,
        rot=(0, math.radians(90), math.radians(15)))

# コンソール画面(左奥、傾き) — 空エンプティに親子付けしてまとめて回す
scr_root = bpy.data.objects.new("scr_root", None)
bpy.context.collection.objects.link(scr_root)
scr_panel = add_box("console_screen", (0.42, 0.02, 0.3), (0, 0, 0), mat_frame)
scr_children = [scr_panel]
for r in range(5):
    w = 0.26 - (r % 3) * 0.055
    ln = add_box(f"scr_line_{r}", (w, 0.006, 0.02),
                 (-(0.26 - w) / 2, -0.013, 0.09 - r * 0.046), mat_screen)
    scr_children.append(ln)
for c in scr_children:
    c.parent = scr_root
scr_root.location = (-0.62, 0.36, 1.02)
scr_root.rotation_euler = (math.radians(-14), 0, math.radians(18))

# 船体インジケーター(蝋燭の代替: 残機ランプ3灯)
for i in range(3):
    add_cyl(f"hull_lamp_{i}", 0.016, 0.05 + i * 0.02,
            (0.42, -0.28 + i * 0.055, 0.805 + (0.05 + i * 0.02) / 2),
            mat_lamp_ind, verts=12)

# マグカップ(孤独なコーヒー)
add_cyl("mug", 0.045, 0.1, (-0.5, -0.18, 0.83), make_mat(
    "mug", (0.035, 0.045, 0.055, 1), rough=0.4), verts=20)

# ---------------------------------------------------------------- 星窓(背景)
add_box("window_void", (3.2, 0.05, 0.9), (0, 1.6, 1.5),
        make_mat("void", (0.0, 0.002, 0.006, 1), rough=1.0))
import random
random.seed(707)                       # 診断ベンチと同じシード
for i in range(70):
    sx = random.uniform(-1.5, 1.5)
    sz = random.uniform(1.12, 1.9)
    s = random.uniform(0.004, 0.011)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=6, ring_count=4, radius=s,
                                         location=(sx, 1.57, sz))
    st = bpy.context.object
    st.name = f"star_{i}"
    st.data.materials.append(mat_star)

# ---------------------------------------------------------------- ライティング
world = bpy.data.worlds.new("space")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.002, 0.004, 0.01, 1)   # ニアブラック青
bg.inputs[1].default_value = 0.6

# メイン: 頭上のアンバー作業灯 — スポットで「1灯の光だまり」を作る
bpy.ops.object.light_add(type='SPOT', location=(-0.15, -0.2, 2.15))
key = bpy.context.object
key.data.energy = 380
key.data.color = (1.0, 0.6, 0.26)
key.data.spot_size = math.radians(68)
key.data.spot_blend = 0.5
key.data.shadow_soft_size = 0.25
key.rotation_euler = (math.radians(8), math.radians(-4), 0)

# リム: 背面上からの淡いティール
bpy.ops.object.light_add(type='AREA', location=(0.4, 1.1, 2.2))
rim = bpy.context.object
rim.data.energy = 50
rim.data.size = 1.2
rim.data.color = (0.3, 0.9, 0.9)
rim.rotation_euler = (math.radians(-30), 0, 0)

# ---------------------------------------------------------------- カメラ
aim = bpy.data.objects.new("aim", None)
bpy.context.collection.objects.link(aim)
aim.location = (0, 0.02, 0.83)


def add_cam(name, loc, lens=35):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = loc
    tc = cam.constraints.new('TRACK_TO')
    tc.target = aim
    tc.track_axis = 'TRACK_NEGATIVE_Z'
    tc.up_axis = 'UP_Y'
    return cam


cams = {
    "main": add_cam("cam_main", (0, -1.32, 1.32), lens=34),   # 一人称着席
    "hero": add_cam("cam_hero", (-0.5, -0.95, 1.05), lens=50),  # カード+盤面クローズ
    "side": add_cam("cam_side", (-1.5, -0.85, 1.1), lens=40),   # 横からドラマチック
}

# ---------------------------------------------------------------- フル部屋モード(Phase 5: 一人称テーブルのGLB化)
# Sol R1数値処方(docs/HANDOFF-phase2-holo-board.md): 暗部3段階 #020609/#081217/#172123/#10191B、
# 卓面 rough .76-.82 / metal .15-.22、フレームのみ metal .65 / rough .48、シアンは縁5-15mm限定、
# コーラルは1箇所のみ、発光体3-5個、露出+0.7EV
if "--room" in argv:
    def srgb(hexv):
        r = ((hexv >> 16) & 255) / 255; g = ((hexv >> 8) & 255) / 255; b = (hexv & 255) / 255
        # ガンマ近似→リニア
        return (r ** 2.2, g ** 2.2, b ** 2.2, 1.0)

    # 旧Phase0の星窓・残機ランプ・浮遊コンソール板は撤去(部屋モードでは新しい実体に置換される)
    for o in [o for o in bpy.data.objects if o.name == "window_void" or o.name.startswith("star_")
              or o.name.startswith("hull_lamp_") or o.name == "console_screen"
              or o.name.startswith("scr_line_") or o.name == "scr_root"]:
        bpy.data.objects.remove(o, do_unlink=True)

    WALL = srgb(0x081217); MACHINE = srgb(0x10191B); DESKC = srgb(0x172123)
    mat_wall = make_mat("wall", WALL, rough=0.85, metal=0.05)
    mat_machine = make_mat("machine", MACHINE, rough=0.7, metal=0.3)
    mat_desk_sol = make_mat("desk_sol", DESKC, rough=0.79, metal=0.18)       # Sol卓面
    mat_frame_sol = make_mat("frame_sol", MACHINE, rough=0.48, metal=0.65)   # 外周フレームのみ金属
    mat_edge_teal = make_mat("edge_teal", (0.01, 0.05, 0.05, 1), rough=0.4,
                             emit=(0.18, 0.56, 0.57, 1), strength=1.6)       # #2E8E91 縁光
    mat_eye = make_mat("ai_eye", (0.02, 0.01, 0, 1), emit=(0.91, 0.66, 0.36, 1), strength=10.0)  # #E7A85B
    mat_coral = make_mat("coral_grip", (0.10, 0.02, 0.01, 1), rough=0.5,
                         emit=(0.85, 0.36, 0.27, 1), strength=0.5)           # #D85C45(1箇所のみ・控えめ)

    # ---- Sol R2(tmp/sol-room-r1.md)適用 ----
    def bevel(o, w, segs=3):
        m = o.modifiers.new("bev", 'BEVEL'); m.width = w; m.segments = segs
        return o

    # #1 卓=装甲ワークベンチ: 旧机を撤去し、天板+外周フレーム+ボルトで再構成
    for oname in ("desk_top", "desk_back", "desk_lip", "desk_leg_l", "desk_leg_r", "projector", "mug"):
        o = bpy.data.objects.get(oname)
        if o: bpy.data.objects.remove(o, do_unlink=True)
    mat_bench = make_mat("bench_top", srgb(0x303A39), rough=0.63, metal=0.32)
    mat_bench_frame = make_mat("bench_frame", srgb(0x151C1D), rough=0.38, metal=0.72)
    bevel(add_box("desk_top", (2.30, 1.18, 0.075), (0, 0.38, 0.70), mat_bench), 0.018)
    bevel(add_box("desk_frame", (2.42, 1.30, 0.055), (0, 0.38, 0.665), mat_bench_frame), 0.012)
    add_box("desk_leg_l2", (0.12, 1.0, 0.63), (-1.05, 0.38, 0.32), mat_bench_frame)
    add_box("desk_leg_r2", (0.12, 1.0, 0.63), (1.05, 0.38, 0.32), mat_bench_frame)
    for i, (bx, by) in enumerate([(-1.06, -0.14), (-1.06, 0.90), (1.06, -0.14), (1.06, 0.90),
                                   (-0.9, -0.17), (0.9, -0.17), (-0.9, 0.93), (0.9, 0.93)]):
        add_cyl(f"bolt2_{i}", 0.013, 0.008, (bx, by, 0.742), mat_bench_frame, verts=10)
    # (卓の輝線は撤去 — 浮いて見える。シアン縁は容器コア・コンソール灯・窓下縁が既に担う)

    # 壁(背面+左右)とパネル継ぎ目
    add_box("wall_back", (5.6, 0.1, 3.0), (0, 2.1, 1.5), mat_wall)
    add_box("wall_left", (0.1, 4.4, 3.0), (-2.6, 0.4, 1.5), mat_wall)
    add_box("wall_right", (0.1, 4.4, 3.0), (2.6, 0.4, 1.5), mat_wall)
    for i in range(4):  # 背面パネルの浅い継ぎ目(埋め込み機器: ベベル代わりの浮き板)
        add_box(f"panel_{i}", (0.9, 0.04, 0.7), (-1.9 + i * 1.25, 2.04, 1.15 + (i % 2) * 0.5), mat_machine)

    # 窓(右上、painting準拠の構図) — 枠+虚空+星+船骸+シアン縁
    add_box("win_frame", (1.5, 0.12, 1.05), (1.55, 2.02, 1.78), mat_frame_sol)
    add_box("win_void", (1.32, 0.06, 0.88), (1.55, 2.0, 1.78),
            make_mat("void2", (0.0, 0.002, 0.006, 1), rough=1.0))
    add_box("win_glow", (1.34, 0.02, 0.02), (1.55, 1.96, 1.34), mat_edge_teal)  # 窓下縁のシアン
    random.seed(707)
    for i in range(46):
        sx = 1.55 + random.uniform(-0.6, 0.6)
        sz = 1.78 + random.uniform(-0.38, 0.38)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=6, ring_count=4,
                                             radius=random.uniform(0.003, 0.008),
                                             location=(sx, 1.97, sz))
        st = bpy.context.object; st.name = f"wstar_{i}"; st.data.materials.append(mat_star)
    # 船骸シルエット(窓の中、ほぼ黒)
    add_box("wreck_sil", (0.5, 0.04, 0.16), (1.75, 1.98, 1.9),
            make_mat("wreck", (0.004, 0.008, 0.012, 1), rough=0.9),
            rot=(0, math.radians(12), math.radians(-8)))

    # 相手席(中央奥) — 椅子+暗いシルエット+琥珀の眼2点(ゲーム内の「相手の実在」と同一存在)
    add_box("chair_seat", (0.5, 0.45, 0.08), (0, 1.35, 0.55), mat_machine)
    add_box("chair_back", (0.5, 0.08, 0.75), (0, 1.55, 0.95), mat_machine)
    add_box("chair_arm_l", (0.06, 0.4, 0.3), (-0.27, 1.35, 0.65), mat_frame_sol)
    add_box("chair_arm_r", (0.06, 0.4, 0.3), (0.27, 1.35, 0.65), mat_frame_sol)
    bust = add_box("ai_bust", (0.34, 0.2, 0.42), (0, 1.5, 1.35),
                   make_mat("bust", (0.006, 0.01, 0.014, 1), rough=0.95))
    for i, ex in enumerate((-0.055, 0.055)):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.024,
                                             location=(ex, 1.37, 1.42))  # バスト前面(1.40)より手前=同一平面で消えない
        e = bpy.context.object; e.name = f"ai_eye_{i}"; e.data.materials.append(mat_eye)

    # サルベージ小道具(Sol R1: 「印刷する・挿す・引く・封印する」の動詞)
    # 左奥: 伝票プリンター兼カード排出口(幅0.9 高0.35 投入口=カード幅1.2倍)
    bevel(add_box("printer", (0.9, 0.5, 0.35), (-1.35, 1.3, 0.95), mat_machine), 0.02)
    add_box("printer_slot", (CARD_W * 1.2, 0.05, 0.02), (-1.35, 1.02, 0.98), mat_edge_teal)
    add_box("printer_lamp", (0.03, 0.03, 0.03), (-1.05, 1.03, 1.08), mat_lamp_ind)
    add_box("printer_leg", (0.7, 0.4, 0.72), (-1.35, 1.32, 0.36), mat_machine)  # 接地(Sol #5)
    # 右横: クランプレバー(赤い握り=コーラル1点)
    add_box("lever_base", (0.1, 0.1, 0.03), (0.86, 0.05, 0.752), mat_bench_frame)
    add_cyl("lever_rod", 0.016, 0.35, (0.86, 0.05, 0.92), mat_bench_frame,
            rot=(math.radians(-30), 0, 0), verts=12)
    add_cyl("lever_grip", 0.028, 0.08, (0.86, -0.03, 1.06), mat_coral,
            rot=(math.radians(-30), 0, 0), verts=12)

    # #2 デスクランプ(Sol数値): ベース+支柱+シェード+発光面+スポット55W
    mat_lampshell = make_mat("lampshell", srgb(0x151C1D), rough=0.4, metal=0.7)
    bevel(add_box("lamp_base", (0.32, 0.24, 0.055), (-0.92, 0.55, 0.765), mat_lampshell), 0.008)
    add_cyl("lamp_pole", 0.016, 0.48, (-0.87, 0.62, 1.02), mat_lampshell,
            rot=(math.radians(12), math.radians(-8), 0), verts=12)
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.13, radius2=0.05, depth=0.20,
                                    location=(-0.80, 0.72, 1.28),
                                    rotation=(math.radians(158), math.radians(-14), 0))
    shade = bpy.context.object; shade.name = "lamp_shade"; shade.data.materials.append(mat_lampshell)
    add_cyl("lamp_face", 0.08, 0.015, (-0.77, 0.665, 1.20),
            make_mat("lamp_face", (0.05, 0.02, 0, 1), emit=(0.95, 0.71, 0.42, 1), strength=7.0),
            rot=(math.radians(158), math.radians(-14), 0), verts=16)
    bpy.ops.object.light_add(type='SPOT', location=(-0.78, 0.67, 1.24))
    dlamp = bpy.context.object
    dlamp.data.energy = 55
    dlamp.data.color = (1.0, 0.72, 0.42)
    dlamp.data.spot_size = math.radians(58)
    dlamp.data.spot_blend = 0.45
    # 照射点 (-0.38, 0.28, 0.70) へ向ける
    import mathutils
    dv = mathutils.Vector((-0.38, 0.28, 0.70)) - dlamp.location
    dlamp.rotation_euler = dv.to_track_quat('-Z', 'Y').to_euler()

    # #3 縦型エネルギー容器(旧relicを置換)
    for oname in ("relic", "relic_slit"):
        o = bpy.data.objects.get(oname)
        if o: bpy.data.objects.remove(o, do_unlink=True)
    mat_cap = make_mat("can_cap", srgb(0x1B2222), rough=0.28, metal=0.82)
    mat_glass = make_mat("can_glass", (1, 1, 1, 1), rough=0.10)
    try:
        gb = mat_glass.node_tree.nodes["Principled BSDF"]
        gb.inputs["Transmission Weight"].default_value = 1.0
        gb.inputs["IOR"].default_value = 1.45
    except Exception:
        pass
    bevel(add_cyl("can_cap_top", 0.135, 0.075, (0.91, 0.70, 1.163), mat_cap, verts=24), 0.008)
    bevel(add_cyl("can_cap_bot", 0.135, 0.075, (0.91, 0.70, 0.775), mat_cap, verts=24), 0.008)
    add_cyl("can_glass", 0.125, 0.30, (0.91, 0.70, 0.97), mat_glass, verts=24)
    add_cyl("can_core", 0.055, 0.25, (0.91, 0.70, 0.97),
            make_mat("can_core", (0, 0.05, 0.05, 1), emit=(0.26, 0.90, 0.88, 1), strength=3.2), verts=16)
    for i in range(3):
        a = math.radians(120 * i)
        add_box(f"can_bracket_{i}", (0.018, 0.02, 0.42),
                (0.91 + 0.135 * math.cos(a), 0.70 + 0.135 * math.sin(a), 0.97), mat_cap)
    bpy.ops.object.light_add(type='POINT', location=(0.91, 0.55, 1.0))
    cl = bpy.context.object; cl.data.energy = 12; cl.data.color = (0.25, 0.85, 0.85)

    # #4 背面コンソール(黒箱→計器: 傾き12°+ステータス灯8個)
    con_root = bpy.data.objects.new("con_root", None)
    bpy.context.collection.objects.link(con_root)
    body = bevel(add_box("con_body", (1.62, 0.18, 0.34), (0, 0, 0),
                         make_mat("con_body", srgb(0x192324), rough=0.46, metal=0.58)), 0.022, 4)
    scrn = add_box("con_screen", (1.28, 0.012, 0.19), (0, -0.096, 0.01),
                   make_mat("con_screen", srgb(0x07191C), rough=0.4, emit=(0.03, 0.10, 0.11, 1), strength=0.35))
    lamps = []
    for i in range(8):
        warn = i in (2, 6)
        lm = add_box(f"con_lamp_{i}", (0.014, 0.006, 0.006), (-0.49 + i * 0.14, -0.096, -0.135),
                     make_mat(f"con_l{i}", (0.01, 0.01, 0.01, 1),
                              emit=(1.0, 0.44, 0.31, 1) if warn else (0.27, 0.79, 0.79, 1),
                              strength=3.0 if warn else 2.0))
        lamps.append(lm)
    for o in [body, scrn] + lamps:
        o.parent = con_root
    con_root.location = (0, 1.09, 1.03)
    con_root.rotation_euler = (math.radians(-12), 0, 0)

    # 床の暗部を機器面(#10191B)へ
    fl = bpy.data.objects.get("floor")
    if fl: fl.data.materials.clear(); fl.data.materials.append(mat_machine)
    # 旧キー/リムライトはSol #5の2灯構成に譲る
    key.data.energy = 0
    rim.data.energy = 0
    bpy.ops.object.light_add(type='AREA', location=(0, 0.55, 2.30))
    ceil = bpy.context.object
    ceil.data.energy = 140; ceil.data.size = 1.4; ceil.data.size_y = 0.65
    ceil.data.color = (0.62, 0.87, 0.88)
    bpy.ops.object.light_add(type='AREA', location=(1.20, 1.30, 1.55))
    rear = bpy.context.object
    rear.data.energy = 90; rear.data.size = 0.7; rear.data.size_y = 0.45
    rear.data.color = (0.26, 0.78, 0.82)
    rear.rotation_euler = (math.radians(-55), 0, math.radians(35))

    # 一人称カメラ(Sol R2: 38mm / eye(0,-1.58,1.62) / aim(0,0.43,0.82) — 広角の箱庭感を消す)
    aim_room = bpy.data.objects.new("aim_room", None)
    bpy.context.collection.objects.link(aim_room)
    aim_room.location = (0, 0.43, 0.82)
    cams["room"] = add_cam("cam_room", (0.0, -1.58, 1.62), lens=38)
    for c in cams["room"].constraints:
        if c.type == 'TRACK_TO': c.target = aim_room
# --plate: DOM盤面/カードを上に重ねる前提で、ゲームプレイ要素を消したクリーンな卓を出す
if "--plate" in argv:
    prefixes = ("tile_", "card_", "enemy_", "ship_token")
    for o in [o for o in bpy.data.objects
              if any(o.name.startswith(p) for p in prefixes)]:
        bpy.data.objects.remove(o, do_unlink=True)
    # DOM盤面が載る領域に「ホロ投影の余光」を仕込んでおく(合成時の馴染み用)
    bpy.ops.object.light_add(type='AREA', location=(0, 0.08, 1.1))
    holo = bpy.context.object
    holo.data.energy = 18
    holo.data.size = 0.55
    holo.data.color = (0.25, 0.9, 0.9)

# 診断: --bright で全体を明るくして配置確認(ムード無視)
if "--bright" in argv:
    bg.inputs[1].default_value = 6.0
    scene_exposure_override = 1.8
else:
    scene_exposure_override = None

# ---------------------------------------------------------------- レンダリング設定
scene.render.engine = 'CYCLES'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
try:
    scene.cycles.device = 'CPU'
except Exception:
    pass
scene.render.resolution_x = RES_X
scene.render.resolution_y = RES_Y
scene.render.film_transparent = False
# 露出: 基本0.18 / --room はSol R2処方の+0.35EV相当0.55(局所照明を先に、露出は控えめ) / --bright は診断用
scene.view_settings.exposure = 0.55 if "--room" in argv else 0.18
if scene_exposure_override is not None:
    scene.view_settings.exposure = scene_exposure_override
try:
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Punchy'
except Exception:
    pass

# ---------------------------------------------------------------- 実行
if GLB:
    os.makedirs(os.path.dirname(os.path.abspath(GLB)), exist_ok=True)
    # ライト/カメラ込みでもthree.js側で無視可。メッシュ+エミッシブを出力
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(GLB),
                              export_format='GLB', export_apply=True)
    print(f"[GLB] exported: {GLB}")

if RENDER:
    os.makedirs(OUT, exist_ok=True)
    targets = list(cams) if RENDER == "all" else [RENDER]
    for t in targets:
        scene.camera = cams[t]
        scene.render.filepath = os.path.abspath(os.path.join(OUT, f"salvage_desk_{t}.png"))
        bpy.ops.render.render(write_still=True)
        print(f"[RENDER] {scene.render.filepath}")
