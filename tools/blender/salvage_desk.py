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

# ---------------------------------------------------------------- 背景プレートモード
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
scene.view_settings.exposure = 0.18
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
