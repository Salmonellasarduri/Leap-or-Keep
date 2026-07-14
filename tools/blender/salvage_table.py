# Leap or Keep — 卓上ホロ司令テーブル physical GLB
#
# 実行例:
#   blender -b -P tools/blender/salvage_table.py -- --glb art/salvage_table.glb
#
# Blender Z-up / 1 Blender Unit = 1 metre
#
# GLBへ含めるもの:
#   - 八角形サルベージ司令テーブル
#   - 二段構造化した凹み物理グリッド・ウェル
#   - 薄いシアン発光リム
#   - 8分割装甲カラー、交換パッチ、外周の欠け・深い傷
#   - 個別ノード化した卓上小物
#   - 背面左寄りのコックピット壁パネル、配管、アンバー計器灯
#
# GLBへ含めないもの:
#   - ホログラムタイル、駒、光柱、走査線、接地グロー
#   - ライト、カメラ
#
# 小物は prop_* Empty の子として構成する。
# three.js側では prop_mug / prop_wrench 等の親ノードを揺らせばよい。

import bpy
import math
import os
import random
import sys

from mathutils import Vector


# ----------------------------------------------------------------------
# 引数

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


GLB = arg("--glb")


# ----------------------------------------------------------------------
# 初期化

bpy.ops.wm.read_factory_settings(use_empty=True)

scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0

scene["asset_name"] = "salvage_table"
scene["coordinate_system"] = "Blender Z-up"
scene["table_surface_z"] = 0.74
scene["well_floor_z"] = 0.70
scene["well_opening_m"] = 0.91
scene["well_floor_size_m"] = 0.852
scene["well_slope_run_m"] = 0.029


# ----------------------------------------------------------------------
# 色・マテリアル

def srgb(hex_value):
    """24bit sRGB hexをBlenderのリニアRGBAへ変換する。"""
    r = ((hex_value >> 16) & 255) / 255.0
    g = ((hex_value >> 8) & 255) / 255.0
    b = (hex_value & 255) / 255.0

    def linear(c):
        if c <= 0.04045:
            return c / 12.92
        return ((c + 0.055) / 1.055) ** 2.4

    return (linear(r), linear(g), linear(b), 1.0)


def make_mat(
    name,
    base=(0.5, 0.5, 0.5, 1.0),
    rough=0.6,
    metal=0.0,
    emit=None,
    strength=1.0,
):
    m = bpy.data.materials.new(name)
    m.use_nodes = True

    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = base
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal

    if emit is not None:
        # Blender 3.x / 4.x両対応
        emission_input = bsdf.inputs.get("Emission Color")
        if emission_input is None:
            emission_input = bsdf.inputs.get("Emission")
        if emission_input is not None:
            emission_input.default_value = emit

        strength_input = bsdf.inputs.get("Emission Strength")
        if strength_input is not None:
            strength_input.default_value = strength

    return m


# 概念画の濃紺金属
mat_top = make_mat(
    "table_top_worn_navy",
    srgb(0x182229),
    rough=0.67,
    metal=0.48,
)
mat_top_plate = make_mat(
    "table_top_section_plate",
    srgb(0x202A30),
    rough=0.72,
    metal=0.40,
)
mat_frame = make_mat(
    "table_frame_dark_metal",
    srgb(0x0C1319),
    rough=0.48,
    metal=0.78,
)
mat_side = make_mat(
    "table_side_armor",
    srgb(0x111A20),
    rough=0.62,
    metal=0.66,
)
mat_side_alt = make_mat(
    "table_side_armor_alt",
    srgb(0x172128),
    rough=0.70,
    metal=0.54,
)
mat_seam = make_mat(
    "panel_seam",
    srgb(0x020609),
    rough=0.88,
    metal=0.25,
)

# ウェル
mat_well = make_mat(
    "well_floor",
    srgb(0x061116),
    rough=0.84,
    metal=0.28,
)
mat_well_slope = make_mat(
    "well_sloped_transition",
    srgb(0x09171C),
    rough=0.79,
    metal=0.34,
)
mat_well_recess = make_mat(
    "well_recess_shadow",
    srgb(0x02070A),
    rough=0.94,
    metal=0.16,
)
mat_grid_line = make_mat(
    "well_grid_engraving",
    srgb(0x09272B),
    rough=0.72,
    metal=0.30,
    emit=srgb(0x15585E),
    strength=0.015,
)
mat_cyan_rim = make_mat(
    "well_cyan_emissive_rim",
    srgb(0x07383D),
    rough=0.32,
    metal=0.22,
    emit=srgb(0x31D5DF),
    strength=1.8,
)

# ウェル外周カラー
mat_collar = make_mat(
    "well_armor_collar",
    srgb(0x263138),
    rough=0.66,
    metal=0.58,
)
mat_collar_alt = make_mat(
    "well_armor_collar_alt",
    srgb(0x1B252B),
    rough=0.72,
    metal=0.50,
)

# ハザード・摩耗
mat_hazard_yellow = make_mat(
    "hazard_yellow_worn",
    srgb(0xB37A18),
    rough=0.72,
    metal=0.20,
)
mat_hazard_black = make_mat(
    "hazard_black",
    srgb(0x100D08),
    rough=0.86,
    metal=0.16,
)
mat_scuff = make_mat(
    "exposed_edge_scuff",
    srgb(0x697177),
    rough=0.72,
    metal=0.72,
)
mat_rust = make_mat(
    "rust_stain",
    srgb(0x633817),
    rough=0.92,
    metal=0.10,
)
mat_rivet = make_mat(
    "rivet_steel",
    srgb(0x343E43),
    rough=0.44,
    metal=0.86,
)

# 小物
mat_tool = make_mat(
    "tool_steel",
    srgb(0x465158),
    rough=0.38,
    metal=0.90,
)
mat_tool_dark = make_mat(
    "tool_dark_recess",
    srgb(0x11171A),
    rough=0.60,
    metal=0.70,
)
mat_rubber = make_mat(
    "plier_grip_rubber",
    srgb(0x151B1E),
    rough=0.92,
    metal=0.0,
)
mat_mug = make_mat(
    "mug_chipped_ceramic",
    srgb(0x596268),
    rough=0.76,
    metal=0.03,
)
mat_mug_chip = make_mat(
    "mug_chip_dark",
    srgb(0x171B1D),
    rough=0.90,
    metal=0.0,
)
mat_coffee = make_mat(
    "old_coffee",
    srgb(0x160A04),
    rough=0.34,
    metal=0.0,
)
mat_cable = make_mat(
    "cable_black",
    srgb(0x090D10),
    rough=0.82,
    metal=0.05,
)
mat_cable_connector = make_mat(
    "cable_connector",
    srgb(0x303A3F),
    rough=0.42,
    metal=0.82,
)
mat_slate_body = make_mat(
    "data_slate_body",
    srgb(0x11191E),
    rough=0.55,
    metal=0.58,
)
mat_slate_screen = make_mat(
    "data_slate_screen",
    srgb(0x061B20),
    rough=0.38,
    metal=0.10,
    emit=srgb(0x2AC4D0),
    strength=0.38,
)
mat_slate_ui = make_mat(
    "data_slate_ui",
    srgb(0x0A3339),
    rough=0.30,
    metal=0.05,
    emit=srgb(0x48E0E8),
    strength=0.70,
)
mat_rag = make_mat(
    "dirty_shop_rag",
    srgb(0x493E30),
    rough=0.98,
    metal=0.0,
)

# 壁・計器
mat_wall = make_mat(
    "cockpit_wall_dark",
    srgb(0x090F14),
    rough=0.74,
    metal=0.46,
)
mat_wall_plate = make_mat(
    "cockpit_wall_inset",
    srgb(0x141D22),
    rough=0.62,
    metal=0.60,
)
mat_pipe = make_mat(
    "exposed_pipe",
    srgb(0x202A2F),
    rough=0.48,
    metal=0.78,
)
mat_amber = make_mat(
    "instrument_amber",
    srgb(0x321704),
    rough=0.42,
    metal=0.15,
    emit=srgb(0xFF8B21),
    strength=2.8,
)


# ----------------------------------------------------------------------
# 基本ヘルパ

def add_box(name, size, loc, mat, rot=(0, 0, 0), scale=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name

    if scale is not None:
        o.scale = scale
    else:
        o.dimensions = size

    # Bevel幅を非等方scaleに影響させない
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    if mat is not None:
        o.data.materials.append(mat)
    return o


def add_cyl(name, r, depth, loc, mat, rot=(0, 0, 0), verts=24):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts,
        radius=r,
        depth=depth,
        location=loc,
        rotation=rot,
    )
    o = bpy.context.object
    o.name = name

    if mat is not None:
        o.data.materials.append(mat)

    for poly in o.data.polygons:
        poly.use_smooth = False

    return o


def bevel(o, width, segments=2):
    mod = o.modifiers.new("edge_bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    return o


def add_oct_prism(name, outer_points, z_bottom, z_top, mat):
    n = len(outer_points)
    verts = []

    for x, y in outer_points:
        verts.append((x, y, z_bottom))
    for x, y in outer_points:
        verts.append((x, y, z_top))

    faces = [
        tuple(range(n - 1, -1, -1)),
        tuple(range(n, n * 2)),
    ]

    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))

    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()

    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    return o


def add_extruded_polygon(name, points, z_bottom, z_top, mat):
    """凸多角形をZ方向へ押し出した薄い装甲板を作る。"""
    n = len(points)
    verts = []

    for x, y in points:
        verts.append((x, y, z_bottom))
    for x, y in points:
        verts.append((x, y, z_top))

    faces = [
        tuple(range(n - 1, -1, -1)),
        tuple(range(n, n * 2)),
    ]

    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))

    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()

    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    return o


def add_octagonal_ring(
    name,
    outer_points,
    inner_points,
    z_bottom,
    z_top,
    mat,
):
    """8頂点の外周と8頂点の角形内周を結ぶ、穴の開いた立体リング。"""
    n = 8
    verts = []

    # 0..7: 外周下
    # 8..15: 内周下
    # 16..23: 外周上
    # 24..31: 内周上
    for x, y in outer_points:
        verts.append((x, y, z_bottom))
    for x, y in inner_points:
        verts.append((x, y, z_bottom))
    for x, y in outer_points:
        verts.append((x, y, z_top))
    for x, y in inner_points:
        verts.append((x, y, z_top))

    ob = 0
    ib = n
    ot = n * 2
    it = n * 3

    faces = []

    for i in range(n):
        j = (i + 1) % n

        # 上面
        faces.append((ot + i, ot + j, it + j, it + i))

        # 下面
        faces.append((ob + j, ob + i, ib + i, ib + j))

        # 外側面
        faces.append((ob + i, ob + j, ot + j, ot + i))

        # ウェル内壁
        faces.append((ib + j, ib + i, it + i, it + j))

    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()

    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    return o


def add_sloped_octagonal_ring(
    name,
    outer_points,
    inner_points,
    outer_z,
    inner_z,
    mat,
    thickness=0.004,
):
    """
    上端開口から床外周へ落ちる傾斜面。
    outer_pointsとinner_pointsは対応する8頂点を持つ。
    """
    n = len(outer_points)
    verts = []

    for x, y in outer_points:
        verts.append((x, y, outer_z))
    for x, y in inner_points:
        verts.append((x, y, inner_z))

    faces = []

    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))

    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()

    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)

    solidify = o.modifiers.new("slope_backing", "SOLIDIFY")
    solidify.thickness = thickness
    solidify.offset = -1.0

    bevel_mod = o.modifiers.new("slope_edge_bevel", "BEVEL")
    bevel_mod.width = 0.0015
    bevel_mod.segments = 2

    return o


def add_curve_paths(
    name,
    paths,
    mat,
    bevel_depth=0.006,
    bevel_resolution=2,
    resolution=2,
):
    """
    paths:
      [
        ([(x,y,z), ...], cyclic_bool),
        ...
      ]
    """
    curve_data = bpy.data.curves.new(name + "_curve", "CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = resolution
    curve_data.bevel_depth = bevel_depth
    curve_data.bevel_resolution = bevel_resolution
    curve_data.fill_mode = "FULL"

    for points, cyclic in paths:
        spline = curve_data.splines.new("POLY")
        spline.points.add(len(points) - 1)

        for p, co in zip(spline.points, points):
            p.co = (co[0], co[1], co[2], 1.0)

        spline.use_cyclic_u = cyclic

    o = bpy.data.objects.new(name, curve_data)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    return o


def add_rod_between(name, start, end, radius, mat, verts=16):
    a = Vector(start)
    b = Vector(end)
    delta = b - a

    o = add_cyl(
        name,
        radius,
        delta.length,
        (a + b) * 0.5,
        mat,
        verts=verts,
    )
    o.rotation_euler = delta.to_track_quat("Z", "Y").to_euler()
    return o


def make_prop_root(name, loc, rot=(0, 0, 0)):
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.06
    root.location = loc
    root.rotation_euler = rot

    root["dynamic_prop"] = True
    root["inertia_group"] = name
    return root


def parent_all(root, objects):
    for o in objects:
        o.parent = root


def convert_curves_to_mesh():
    curves = [o for o in bpy.data.objects if o.type == "CURVE"]

    for o in curves:
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.convert(target="MESH")
        o.select_set(False)


# ----------------------------------------------------------------------
# 八角テーブル本体
#
# 外形はX/Yとも約1.50m。
# 角を落とした八角形で、ウェル上端開口は約0.91m角。

OUTER_A = 0.75
OUTER_B = 0.55
INNER = 0.455

outer_points = [
    (OUTER_A, OUTER_B),
    (OUTER_B, OUTER_A),
    (-OUTER_B, OUTER_A),
    (-OUTER_A, OUTER_B),
    (-OUTER_A, -OUTER_B),
    (-OUTER_B, -OUTER_A),
    (OUTER_B, -OUTER_A),
    (OUTER_A, -OUTER_B),
]

# 8分割した正方形内周。対応する外周頂点とリング面を張る。
inner_points = [
    (INNER, 0.0),
    (INNER, INNER),
    (0.0, INNER),
    (-INNER, INNER),
    (-INNER, 0.0),
    (-INNER, -INNER),
    (0.0, -INNER),
    (INNER, -INNER),
]

table_core = add_oct_prism(
    "table_octagonal_core",
    outer_points,
    z_bottom=0.555,
    z_top=0.688,
    mat=mat_side,
)
bevel(table_core, 0.012, 2)

table_ring = add_octagonal_ring(
    "table_top_octagonal_frame",
    outer_points,
    inner_points,
    z_bottom=0.682,
    z_top=0.740,
    mat=mat_top,
)
bevel(table_ring, 0.008, 2)


# ----------------------------------------------------------------------
# 二段構造ウェル
#
# 上端開口: 0.910m
# 床:       0.852m
# 傾斜面:   片側29mm
#
# 上端から短い垂直壁を残し、その下を29mmの傾斜面で床へ接続する。

FLOOR_HALF = 0.426
floor_edge_points = [
    (FLOOR_HALF, 0.0),
    (FLOOR_HALF, FLOOR_HALF),
    (0.0, FLOOR_HALF),
    (-FLOOR_HALF, FLOOR_HALF),
    (-FLOOR_HALF, 0.0),
    (-FLOOR_HALF, -FLOOR_HALF),
    (0.0, -FLOOR_HALF),
    (FLOOR_HALF, -FLOOR_HALF),
]

# 深い影を作る下地。上端開口寸法に合わせる。
bevel(
    add_box(
        "well_recess",
        (0.910, 0.910, 0.024),
        (0, 0, 0.679),
        mat_well_recess,
    ),
    0.008,
    2,
)

# 上面がZ=0.700。床面寸法0.852mを維持。
bevel(
    add_box(
        "well_floor",
        (0.852, 0.852, 0.014),
        (0, 0, 0.693),
        mat_well,
    ),
    0.006,
    2,
)

# 上端開口から床へ落ちる片側29mmの傾斜面。
# 外側Z=0.718から床面Z=0.700へ接続し、上部には短い垂直壁を残す。
add_sloped_octagonal_ring(
    "well_sloped_transition",
    inner_points,
    floor_edge_points,
    outer_z=0.718,
    inner_z=0.700,
    mat=mat_well_slope,
    thickness=0.004,
)

# 約0.5mmの物理刻線。
# 床から突出させず、上面を床面とほぼ同じ高さへ合わせる。
grid_positions = (-0.2125, 0.0, 0.2125)
GRID_WIDTH = 0.0014
GRID_DEPTH = 0.0005
GRID_CENTER_Z = 0.69975

for i, x in enumerate(grid_positions):
    add_box(
        f"well_grid_x_{i}",
        (GRID_WIDTH, 0.835, GRID_DEPTH),
        (x, 0, GRID_CENTER_Z),
        mat_grid_line,
    )

for i, y in enumerate(grid_positions):
    add_box(
        f"well_grid_y_{i}",
        (0.835, GRID_WIDTH, GRID_DEPTH),
        (0, y, GRID_CENTER_Z),
        mat_grid_line,
    )

# 床側へ下げた物理LED/inlay。
# 幅6mm、高さ5mm、中心Z=0.7045。
RIM_HALF = 0.429
RIM_WIDTH = 0.006
RIM_HEIGHT = 0.005
RIM_Z = 0.7045

add_box(
    "well_rim_cyan_front",
    (0.852, RIM_WIDTH, RIM_HEIGHT),
    (0, -RIM_HALF, RIM_Z),
    mat_cyan_rim,
)
add_box(
    "well_rim_cyan_back",
    (0.852, RIM_WIDTH, RIM_HEIGHT),
    (0, RIM_HALF, RIM_Z),
    mat_cyan_rim,
)
add_box(
    "well_rim_cyan_left",
    (RIM_WIDTH, 0.852, RIM_HEIGHT),
    (-RIM_HALF, 0, RIM_Z),
    mat_cyan_rim,
)
add_box(
    "well_rim_cyan_right",
    (RIM_WIDTH, 0.852, RIM_HEIGHT),
    (RIM_HALF, 0, RIM_Z),
    mat_cyan_rim,
)


# ----------------------------------------------------------------------
# ウェル外周8分割装甲カラー
#
# 幅55mm、段差4〜5mm、外側四隅30mm面取り。
# 4枚の辺パネルと4枚の三角コーナーパネルで8分割する。

COLLAR_INNER = INNER
COLLAR_OUTER = 0.510
COLLAR_CHAMFER = 0.030
COLLAR_BASE_Z = 0.740

collar_specs = [
    (
        "well_collar_front",
        [
            (-COLLAR_OUTER + COLLAR_CHAMFER, -COLLAR_OUTER),
            (COLLAR_OUTER - COLLAR_CHAMFER, -COLLAR_OUTER),
            (COLLAR_INNER, -COLLAR_INNER),
            (-COLLAR_INNER, -COLLAR_INNER),
        ],
        0.744,
        mat_collar,
    ),
    (
        "well_collar_front_right_chamfer",
        [
            (COLLAR_INNER, -COLLAR_INNER),
            (COLLAR_OUTER - COLLAR_CHAMFER, -COLLAR_OUTER),
            (COLLAR_OUTER, -COLLAR_OUTER + COLLAR_CHAMFER),
        ],
        0.745,
        mat_collar_alt,
    ),
    (
        "well_collar_right",
        [
            (COLLAR_INNER, -COLLAR_INNER),
            (COLLAR_OUTER, -COLLAR_OUTER + COLLAR_CHAMFER),
            (COLLAR_OUTER, COLLAR_OUTER - COLLAR_CHAMFER),
            (COLLAR_INNER, COLLAR_INNER),
        ],
        0.744,
        mat_collar,
    ),
    (
        "well_collar_back_right_chamfer",
        [
            (COLLAR_INNER, COLLAR_INNER),
            (COLLAR_OUTER, COLLAR_OUTER - COLLAR_CHAMFER),
            (COLLAR_OUTER - COLLAR_CHAMFER, COLLAR_OUTER),
        ],
        0.745,
        mat_collar_alt,
    ),
    (
        "well_collar_back",
        [
            (-COLLAR_INNER, COLLAR_INNER),
            (COLLAR_INNER, COLLAR_INNER),
            (COLLAR_OUTER - COLLAR_CHAMFER, COLLAR_OUTER),
            (-COLLAR_OUTER + COLLAR_CHAMFER, COLLAR_OUTER),
        ],
        0.744,
        mat_collar,
    ),
    (
        "well_collar_back_left_chamfer",
        [
            (-COLLAR_INNER, COLLAR_INNER),
            (-COLLAR_OUTER + COLLAR_CHAMFER, COLLAR_OUTER),
            (-COLLAR_OUTER, COLLAR_OUTER - COLLAR_CHAMFER),
        ],
        0.745,
        mat_collar_alt,
    ),
    (
        "well_collar_left",
        [
            (-COLLAR_OUTER, COLLAR_OUTER - COLLAR_CHAMFER),
            (-COLLAR_OUTER, -COLLAR_OUTER + COLLAR_CHAMFER),
            (-COLLAR_INNER, -COLLAR_INNER),
            (-COLLAR_INNER, COLLAR_INNER),
        ],
        0.744,
        mat_collar,
    ),
    (
        "well_collar_front_left_chamfer",
        [
            (-COLLAR_INNER, -COLLAR_INNER),
            (-COLLAR_OUTER, -COLLAR_OUTER + COLLAR_CHAMFER),
            (-COLLAR_OUTER + COLLAR_CHAMFER, -COLLAR_OUTER),
        ],
        0.745,
        mat_collar_alt,
    ),
]

for name, points, z_top, mat in collar_specs:
    collar_piece = add_extruded_polygon(
        name,
        points,
        z_bottom=COLLAR_BASE_Z,
        z_top=z_top,
        mat=mat,
    )
    bevel(collar_piece, 0.0015, 2)


# ----------------------------------------------------------------------
# 卓上フレームの装甲区画・継ぎ目

top_plates = [
    (
        "top_plate_front",
        (0.78, 0.115, 0.006),
        (0, -0.620, 0.743),
    ),
    (
        "top_plate_back",
        (0.78, 0.115, 0.006),
        (0, 0.620, 0.743),
    ),
    (
        "top_plate_left",
        (0.115, 0.78, 0.006),
        (-0.620, 0, 0.743),
    ),
    (
        "top_plate_right",
        (0.115, 0.78, 0.006),
        (0.620, 0, 0.743),
    ),
]

for name, size, loc in top_plates:
    bevel(add_box(name, size, loc, mat_top_plate), 0.004, 2)

# 主要継ぎ目
for i, x in enumerate((-0.39, 0.39)):
    add_box(
        f"top_front_seam_{i}",
        (0.009, 0.13, 0.003),
        (x, -0.620, 0.747),
        mat_seam,
    )
    add_box(
        f"top_back_seam_{i}",
        (0.009, 0.13, 0.003),
        (x, 0.620, 0.747),
        mat_seam,
    )

for i, y in enumerate((-0.39, 0.39)):
    add_box(
        f"top_left_seam_{i}",
        (0.13, 0.009, 0.003),
        (-0.620, y, 0.747),
        mat_seam,
    )
    add_box(
        f"top_right_seam_{i}",
        (0.13, 0.009, 0.003),
        (0.620, y, 0.747),
        mat_seam,
    )


# ----------------------------------------------------------------------
# 交換パッチ板
#
# 卓面の高さに合わせた3枚の交換板。
# 元の卓上寸法を変えず、既存装甲上または露出卓面上へ薄く追加する。

repair_patch_specs = [
    (
        "repair_patch_plate_0",
        (0.145, 0.080, 0.003),
        (0.530, -0.570, 0.7415),
        math.radians(-7),
    ),
    (
        "repair_patch_plate_1",
        (0.150, 0.065, 0.003),
        (-0.330, 0.600, 0.7475),
        math.radians(4),
    ),
    (
        "repair_patch_plate_2",
        (0.105, 0.075, 0.003),
        (0.610, 0.135, 0.7475),
        math.radians(-3),
    ),
]

for name, size, loc, rot_z in repair_patch_specs:
    patch = add_box(
        name,
        size,
        loc,
        mat_top_plate,
        rot=(0, 0, rot_z),
    )
    bevel(patch, 0.004, 2)


# ----------------------------------------------------------------------
# 側面装甲パネル

for i in range(8):
    p0 = Vector((*outer_points[i], 0.0))
    p1 = Vector((*outer_points[(i + 1) % 8], 0.0))
    delta = p1 - p0
    mid = (p0 + p1) * 0.5
    angle = math.atan2(delta.y, delta.x)

    panel_mat = mat_side_alt if i in (1, 3, 5, 7) else mat_side

    bevel(
        add_box(
            f"side_armor_panel_{i}",
            (delta.length - 0.032, 0.036, 0.103),
            (mid.x, mid.y, 0.620),
            panel_mat,
            rot=(0, 0, angle),
        ),
        0.006,
        2,
    )

    # パネル中央の浅い補強板
    add_box(
        f"side_armor_inset_{i}",
        (delta.length * 0.48, 0.008, 0.050),
        (
            mid.x - math.sin(angle) * 0.022,
            mid.y + math.cos(angle) * 0.022,
            0.618,
        ),
        mat_frame,
        rot=(0, 0, angle),
    )

# 正面フェイシア
bevel(
    add_box(
        "front_apron",
        (1.04, 0.045, 0.155),
        (0, -0.716, 0.625),
        mat_frame,
    ),
    0.008,
    2,
)

for i, x in enumerate((-0.34, 0.0, 0.34)):
    add_box(
        f"front_apron_seam_{i}",
        (0.010, 0.010, 0.126),
        (x, -0.742, 0.623),
        mat_seam,
    )

for i, x in enumerate((-0.46, -0.23, 0.23, 0.46)):
    add_cyl(
        f"front_apron_rivet_{i}",
        0.012,
        0.009,
        (x, -0.745, 0.670),
        mat_rivet,
        rot=(math.radians(90), 0, 0),
        verts=12,
    )


# ----------------------------------------------------------------------
# ハザード縞
#
# 浮いた棒ではなく、装甲カラー上へ0.8mm厚で収まる寸法にクリップ。
# 黒い下地も0.5mm厚の薄いインレイとする。

# 正面左寄り。frontカラー上面Z=0.744。
add_box(
    "hazard_front_mount",
    (0.400, 0.048, 0.0005),
    (-0.200, -0.4825, 0.74425),
    mat_hazard_black,
)

for i in range(7):
    add_box(
        f"hazard_front_yellow_{i}",
        (0.024, 0.038, 0.0008),
        (-0.350 + i * 0.050, -0.4825, 0.7449),
        mat_hazard_yellow,
        rot=(0, 0, math.radians(34)),
    )

# 左奥。leftカラー上面Z=0.744。
add_box(
    "hazard_left_mount",
    (0.048, 0.280, 0.0005),
    (-0.4825, 0.220, 0.74425),
    mat_hazard_black,
)

for i in range(5):
    add_box(
        f"hazard_left_yellow_{i}",
        (0.038, 0.024, 0.0008),
        (-0.4825, 0.100 + i * 0.060, 0.7449),
        mat_hazard_yellow,
        rot=(0, 0, math.radians(34)),
    )


# ----------------------------------------------------------------------
# リベット

top_rivets = [
    (-0.48, -0.680),
    (-0.24, -0.680),
    (0.0, -0.680),
    (0.24, -0.680),
    (0.48, -0.680),
    (-0.48, 0.680),
    (-0.24, 0.680),
    (0.0, 0.680),
    (0.24, 0.680),
    (0.48, 0.680),
    (-0.680, -0.40),
    (-0.680, 0.0),
    (-0.680, 0.40),
    (0.680, -0.40),
    (0.680, 0.0),
    (0.680, 0.40),
    (-0.605, -0.605),
    (0.605, -0.605),
    (-0.605, 0.605),
    (0.605, 0.605),
]

for i, (x, y) in enumerate(top_rivets):
    add_cyl(
        f"top_rivet_{i}",
        0.0105,
        0.008,
        (x, y, 0.750),
        mat_rivet,
        verts=12,
    )


# ----------------------------------------------------------------------
# 摩耗・擦り傷
#
# テクスチャに依存せず、GLB上でも読める薄い実ジオメトリ。

random.seed(7401)

scuff_zones = [
    (-0.55, -0.55, 0.16, 0.11),
    (0.53, -0.56, 0.15, 0.10),
    (-0.57, 0.10, 0.08, 0.28),
    (0.57, 0.28, 0.08, 0.20),
    (-0.10, 0.62, 0.26, 0.07),
]

scuff_index = 0
for cx, cy, rx, ry in scuff_zones:
    for _ in range(3):
        x = cx + random.uniform(-rx, rx)
        y = cy + random.uniform(-ry, ry)
        length = random.uniform(0.035, 0.095)
        width = random.uniform(0.002, 0.005)
        angle = random.uniform(-38.0, 38.0)

        add_box(
            f"top_scuff_{scuff_index}",
            (length, width, 0.0015),
            (x, y, 0.757),
            mat_scuff if scuff_index % 3 else mat_rust,
            rot=(0, 0, math.radians(angle)),
        )
        scuff_index += 1


# ----------------------------------------------------------------------
# 外周角の欠け・深い傷
#
# 8つの外周角それぞれへ深い暗部と露出金属の縁を加える。
# テーブル外形自体は変えず、GLB上で読める傷ジオメトリにする。

for i, point in enumerate(outer_points):
    prev_point = Vector(outer_points[(i - 1) % len(outer_points)])
    next_point = Vector(outer_points[(i + 1) % len(outer_points)])
    tangent = next_point - prev_point
    angle = math.atan2(tangent.y, tangent.x)

    x = point[0] * 0.965
    y = point[1] * 0.965
    gouge_length = 0.034 + (i % 3) * 0.007
    gouge_width = 0.005 + (i % 2) * 0.002

    add_box(
        f"outer_corner_gouge_{i}",
        (gouge_length, gouge_width, 0.0012),
        (x, y, 0.7403),
        mat_seam,
        rot=(0, 0, angle + math.radians(-14 + i * 4)),
    )

    add_box(
        f"outer_corner_exposed_edge_{i}",
        (gouge_length * 0.72, 0.0025, 0.0010),
        (
            x - math.sin(angle) * 0.004,
            y + math.cos(angle) * 0.004,
            0.7407,
        ),
        mat_scuff if i % 3 else mat_rust,
        rot=(0, 0, angle + math.radians(-10 + i * 3)),
    )


# ----------------------------------------------------------------------
# 欠けたマグ

def add_chipped_mug_body(
    name,
    outer_radius,
    inner_radius,
    height,
    bottom_thickness,
    mat,
    segments=32,
):
    verts = []
    faces = []

    chip_center = math.radians(135)
    chip_width = math.radians(18)
    chip_drop = 0.025

    top_heights = []

    for i in range(segments):
        a = (math.tau * i) / segments
        d = abs((a - chip_center + math.pi) % math.tau - math.pi)

        if d < chip_width:
            z = height - chip_drop * (1.0 - d / chip_width)
        else:
            z = height

        top_heights.append(z)

    # 外底
    for i in range(segments):
        a = math.tau * i / segments
        verts.append(
            (
                outer_radius * math.cos(a),
                outer_radius * math.sin(a),
                0.0,
            )
        )

    # 外上
    for i in range(segments):
        a = math.tau * i / segments
        verts.append(
            (
                outer_radius * math.cos(a),
                outer_radius * math.sin(a),
                top_heights[i],
            )
        )

    # 内上
    for i in range(segments):
        a = math.tau * i / segments
        verts.append(
            (
                inner_radius * math.cos(a),
                inner_radius * math.sin(a),
                top_heights[i] - 0.002,
            )
        )

    # 内底
    for i in range(segments):
        a = math.tau * i / segments
        verts.append(
            (
                inner_radius * math.cos(a),
                inner_radius * math.sin(a),
                bottom_thickness,
            )
        )

    ob = 0
    ot = segments
    it = segments * 2
    ib = segments * 3

    for i in range(segments):
        j = (i + 1) % segments

        faces.append((ob + i, ob + j, ot + j, ot + i))
        faces.append((it + j, ib + j, ib + i, it + i))
        faces.append((ot + i, ot + j, it + j, it + i))

    outer_bottom_center = len(verts)
    verts.append((0, 0, 0))

    inner_bottom_center = len(verts)
    verts.append((0, 0, bottom_thickness))

    for i in range(segments):
        j = (i + 1) % segments
        faces.append((outer_bottom_center, ob + j, ob + i))
        faces.append((inner_bottom_center, ib + i, ib + j))

    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()

    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    return o


# 左装甲板上面Z=0.746へ実接地。
mug_root = make_prop_root(
    "prop_mug",
    (-0.585, 0.265, 0.746),
    rot=(0, 0, math.radians(-8)),
)

mug_parts = []

mug_body = add_chipped_mug_body(
    "mug_body",
    outer_radius=0.050,
    inner_radius=0.040,
    height=0.102,
    bottom_thickness=0.010,
    mat=mat_mug,
)
mug_parts.append(mug_body)

mug_handle = add_curve_paths(
    "mug_handle",
    [
        (
            [
                (-0.046, 0.0, 0.078),
                (-0.078, 0.0, 0.082),
                (-0.088, 0.0, 0.055),
                (-0.080, 0.0, 0.026),
                (-0.046, 0.0, 0.030),
            ],
            False,
        )
    ],
    mat_mug,
    bevel_depth=0.007,
    bevel_resolution=3,
)
mug_parts.append(mug_handle)

coffee = add_cyl(
    "mug_old_coffee",
    0.037,
    0.002,
    (0, 0, 0.079),
    mat_coffee,
    verts=28,
)
mug_parts.append(coffee)

# 欠けた位置の暗い傷
chip_mark = add_box(
    "mug_chip_mark",
    (0.014, 0.004, 0.024),
    (-0.035, 0.035, 0.088),
    mat_mug_chip,
    rot=(0, math.radians(-18), math.radians(-45)),
)
mug_parts.append(chip_mark)

parent_all(mug_root, mug_parts)


# ----------------------------------------------------------------------
# レンチ

# 子メッシュ最下点が左装甲板上面Z=0.746へ接地。
wrench_root = make_prop_root(
    "prop_wrench",
    (-0.592, -0.105, 0.743),
    rot=(0, 0, math.radians(-21)),
)

wrench_parts = []

wrench_parts.append(
    bevel(
        add_box(
            "wrench_shank",
            (0.255, 0.022, 0.010),
            (0, 0, 0.008),
            mat_tool,
        ),
        0.005,
        2,
    )
)

# リング側
wrench_parts.append(
    add_cyl(
        "wrench_ring_end",
        0.034,
        0.010,
        (-0.142, 0, 0.008),
        mat_tool,
        verts=16,
    )
)
wrench_parts.append(
    add_cyl(
        "wrench_ring_hole",
        0.018,
        0.012,
        (-0.142, 0, 0.014),
        mat_tool_dark,
        verts=12,
    )
)

# オープンジョー側
wrench_parts.append(
    bevel(
        add_box(
            "wrench_jaw_upper",
            (0.070, 0.018, 0.011),
            (0.140, 0.024, 0.009),
            mat_tool,
            rot=(0, 0, math.radians(25)),
        ),
        0.004,
        2,
    )
)
wrench_parts.append(
    bevel(
        add_box(
            "wrench_jaw_lower",
            (0.070, 0.018, 0.011),
            (0.140, -0.024, 0.009),
            mat_tool,
            rot=(0, 0, math.radians(-25)),
        ),
        0.004,
        2,
    )
)

parent_all(wrench_root, wrench_parts)


# ----------------------------------------------------------------------
# ペンチ

# 約26mm内寄せし、左装甲板上面へ実接地。
pliers_root = make_prop_root(
    "prop_pliers",
    (-0.568, -0.371, 0.743),
    rot=(0, 0, math.radians(14)),
)

pliers_parts = []

# グリップ
pliers_parts.append(
    bevel(
        add_box(
            "pliers_grip_left",
            (0.030, 0.190, 0.018),
            (-0.040, -0.080, 0.012),
            mat_rubber,
            rot=(0, 0, math.radians(-10)),
        ),
        0.009,
        3,
    )
)
pliers_parts.append(
    bevel(
        add_box(
            "pliers_grip_right",
            (0.030, 0.190, 0.018),
            (0.040, -0.080, 0.012),
            mat_rubber,
            rot=(0, 0, math.radians(10)),
        ),
        0.009,
        3,
    )
)

# 金属アーム
pliers_parts.append(
    bevel(
        add_box(
            "pliers_arm_left",
            (0.022, 0.145, 0.014),
            (-0.018, 0.055, 0.013),
            mat_tool,
            rot=(0, 0, math.radians(9)),
        ),
        0.004,
        2,
    )
)
pliers_parts.append(
    bevel(
        add_box(
            "pliers_arm_right",
            (0.022, 0.145, 0.014),
            (0.018, 0.055, 0.013),
            mat_tool,
            rot=(0, 0, math.radians(-9)),
        ),
        0.004,
        2,
    )
)

# 顎
pliers_parts.append(
    bevel(
        add_box(
            "pliers_jaw_left",
            (0.018, 0.082, 0.015),
            (-0.020, 0.150, 0.014),
            mat_tool,
            rot=(0, 0, math.radians(-6)),
        ),
        0.003,
        2,
    )
)
pliers_parts.append(
    bevel(
        add_box(
            "pliers_jaw_right",
            (0.018, 0.082, 0.015),
            (0.020, 0.150, 0.014),
            mat_tool,
            rot=(0, 0, math.radians(6)),
        ),
        0.003,
        2,
    )
)

pliers_parts.append(
    add_cyl(
        "pliers_pivot",
        0.024,
        0.020,
        (0, 0.034, 0.014),
        mat_rivet,
        verts=16,
    )
)

parent_all(pliers_root, pliers_parts)


# ----------------------------------------------------------------------
# とぐろケーブル + 垂れた線

# カーブ断面の最下点が卓面Z=0.740付近へ接地。
cable_root = make_prop_root(
    "prop_cable",
    (-0.535, 0.570, 0.7425),
)

cable_paths = []

for loop_index, radius in enumerate((0.105, 0.087, 0.069)):
    points = []
    for i in range(32):
        a = math.tau * i / 32
        points.append(
            (
                radius * math.cos(a),
                radius * 0.70 * math.sin(a),
                0.004 + loop_index * 0.006,
            )
        )
    cable_paths.append((points, True))

# 左側フレームを通って前端から垂れる。
# 中央ウェルには入れない。
cable_paths.append(
    (
        [
            (-0.080, -0.015, 0.020),
            (-0.125, -0.165, 0.018),
            (-0.120, -0.390, 0.010),
            (-0.125, -0.690, -0.010),
            (-0.130, -1.120, -0.020),
            (-0.125, -1.315, -0.135),
        ],
        False,
    )
)

cable_mesh = add_curve_paths(
    "cable_coil_and_drop",
    cable_paths,
    mat_cable,
    bevel_depth=0.0065,
    bevel_resolution=2,
)

connector = add_cyl(
    "cable_connector",
    0.012,
    0.055,
    (-0.125, -1.315, -0.170),
    mat_cable_connector,
    rot=(math.radians(90), 0, 0),
    verts=12,
)

parent_all(cable_root, [cable_mesh, connector])


# ----------------------------------------------------------------------
# ボルト・ナット

def build_loose_bolt(name, loc, rot_z):
    root = make_prop_root(name, loc, rot=(0, 0, rot_z))

    shaft = add_cyl(
        name + "_shaft",
        0.006,
        0.060,
        (0.020, 0, 0.010),
        mat_tool,
        rot=(0, math.radians(90), 0),
        verts=12,
    )
    head = add_cyl(
        name + "_head",
        0.014,
        0.014,
        (-0.016, 0, 0.010),
        mat_rivet,
        rot=(0, math.radians(90), 0),
        verts=6,
    )

    parent_all(root, [shaft, head])


def build_loose_nut(name, loc, rot_z):
    root = make_prop_root(name, loc, rot=(0, 0, rot_z))

    body = add_cyl(
        name + "_body",
        0.018,
        0.011,
        (0, 0, 0.007),
        mat_tool,
        verts=6,
    )
    hole = add_cyl(
        name + "_hole",
        0.008,
        0.013,
        (0, 0, 0.011),
        mat_tool_dark,
        verts=12,
    )

    parent_all(root, [body, hole])


# 各位置の卓面／装甲板高さに合わせて実接地。
build_loose_bolt(
    "prop_bolt_0",
    (0.572, 0.330, 0.742),
    math.radians(20),
)
build_loose_bolt(
    "prop_bolt_1",
    (0.622, 0.405, 0.736),
    math.radians(-18),
)
build_loose_bolt(
    "prop_bolt_2",
    (0.535, 0.485, 0.736),
    math.radians(42),
)

build_loose_nut(
    "prop_nut_0",
    (0.674, 0.300, 0.7445),
    math.radians(11),
)
build_loose_nut(
    "prop_nut_1",
    (0.586, 0.540, 0.7385),
    math.radians(-20),
)


# ----------------------------------------------------------------------
# データスレート

# 45mm内寄せ。底面は装甲カラー上面Z=0.744へ接地。
slate_root = make_prop_root(
    "prop_data_slate",
    (0.547, -0.145, 0.742),
    rot=(0, 0, math.radians(11)),
)

slate_parts = []

slate_parts.append(
    bevel(
        add_box(
            "data_slate_body",
            (0.225, 0.145, 0.020),
            (0, 0, 0.012),
            mat_slate_body,
        ),
        0.012,
        3,
    )
)
slate_parts.append(
    bevel(
        add_box(
            "data_slate_screen",
            (0.181, 0.104, 0.006),
            (-0.005, 0, 0.025),
            mat_slate_screen,
        ),
        0.006,
        2,
    )
)

ui_specs = [
    ((0.088, 0.007, 0.002), (-0.020, 0.026, 0.029)),
    ((0.116, 0.006, 0.002), (0.000, 0.004, 0.029)),
    ((0.072, 0.006, 0.002), (-0.022, -0.018, 0.029)),
    ((0.035, 0.006, 0.002), (0.040, -0.036, 0.029)),
]

for i, (size, loc) in enumerate(ui_specs):
    slate_parts.append(
        add_box(
            f"data_slate_ui_{i}",
            size,
            loc,
            mat_slate_ui,
        )
    )

# 側面ボタン
slate_parts.append(
    add_box(
        "data_slate_button",
        (0.020, 0.010, 0.008),
        (0.105, -0.045, 0.018),
        mat_hazard_yellow,
    )
)

parent_all(slate_root, slate_parts)


# ----------------------------------------------------------------------
# ウエス

def add_rag_mesh(name, mat):
    xs = (-0.145, -0.050, 0.050, 0.145)
    ys = (-0.180, -0.060, 0.060, 0.165)

    verts = []
    faces = []

    random.seed(116)

    for y in ys:
        for x in xs:
            # 手前へはみ出した部分を下方へ垂らす
            drape = min(0.0, y + 0.070) * 0.82
            ripple = random.uniform(-0.006, 0.010)
            verts.append(
                (
                    x + random.uniform(-0.012, 0.012),
                    y + random.uniform(-0.010, 0.010),
                    drape + ripple,
                )
            )

    width = len(xs)

    for row in range(len(ys) - 1):
        for col in range(len(xs) - 1):
            a = row * width + col
            b = a + 1
            c = a + width + 1
            d = a + width
            faces.append((a, b, c, d))

    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()

    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)

    solidify = o.modifiers.new("rag_thickness", "SOLIDIFY")
    solidify.thickness = 0.003

    bevel_mod = o.modifiers.new("rag_soft_edges", "BEVEL")
    bevel_mod.width = 0.002
    bevel_mod.segments = 2

    return o


# 約25mm内寄せ。低い頂点が卓面へ触れる高さまで下げる。
rag_root = make_prop_root(
    "prop_rag",
    (-0.504, -0.591, 0.746),
    rot=(0, 0, math.radians(-8)),
)
rag = add_rag_mesh("dirty_rag", mat_rag)
rag.parent = rag_root


# ----------------------------------------------------------------------
# コックピット壁パネルの示唆
#
# 左〜中央奥だけを使用し、上部右側はUI用に空ける。

def add_curved_cockpit_panel():
    xs = (-0.78, -0.55, -0.32, -0.09, 0.16)
    zs = (0.82, 1.03, 1.24, 1.45)

    verts = []
    faces = []

    for z in zs:
        for x in xs:
            # 左右が後退する、浅い曲面
            curve = ((x + 0.31) / 0.60) ** 2
            y = 0.835 + 0.055 * curve
            verts.append((x, y, z))

    width = len(xs)

    for row in range(len(zs) - 1):
        for col in range(len(xs) - 1):
            a = row * width + col
            b = a + 1
            c = a + width + 1
            d = a + width
            faces.append((a, b, c, d))

    mesh = bpy.data.meshes.new("cockpit_panel_curved_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()

    o = bpy.data.objects.new("cockpit_panel_curved", mesh)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat_wall)

    solidify = o.modifiers.new("panel_thickness", "SOLIDIFY")
    solidify.thickness = 0.030

    edge_bevel = o.modifiers.new("panel_edge_bevel", "BEVEL")
    edge_bevel.width = 0.008
    edge_bevel.segments = 2

    return o


add_curved_cockpit_panel()

# 曲面上の区画板
bevel(
    add_box(
        "cockpit_inset_upper",
        (0.340, 0.024, 0.175),
        (-0.535, 0.802, 1.285),
        mat_wall_plate,
        rot=(math.radians(2), 0, math.radians(-2)),
    ),
    0.012,
    2,
)

bevel(
    add_box(
        "cockpit_inset_lower",
        (0.295, 0.024, 0.130),
        (-0.205, 0.802, 0.985),
        mat_wall_plate,
    ),
    0.010,
    2,
)

# 壁面継ぎ目
add_box(
    "cockpit_seam_vertical",
    (0.010, 0.012, 0.520),
    (-0.355, 0.787, 1.135),
    mat_seam,
)
add_box(
    "cockpit_seam_horizontal",
    (0.690, 0.012, 0.010),
    (-0.300, 0.787, 1.105),
    mat_seam,
)

# アンバー計器灯
amber_lamps = [
    (-0.635, 0.784, 1.305),
    (-0.585, 0.784, 1.305),
    (-0.535, 0.784, 1.305),
    (-0.485, 0.784, 1.305),
    (-0.240, 0.784, 0.995),
    (-0.200, 0.784, 0.995),
]

for i, loc in enumerate(amber_lamps):
    add_cyl(
        f"cockpit_amber_lamp_{i}",
        0.012 if i < 4 else 0.009,
        0.012,
        loc,
        mat_amber,
        rot=(math.radians(90), 0, 0),
        verts=12,
    )

# 計器灯の暗い台座
add_box(
    "cockpit_lamp_bezel",
    (0.255, 0.018, 0.052),
    (-0.560, 0.795, 1.305),
    mat_frame,
)

# 露出配管
pipe_specs = [
    (
        "cockpit_pipe_0",
        [
            (-0.735, 0.778, 0.825),
            (-0.735, 0.778, 1.060),
            (-0.700, 0.778, 1.105),
            (-0.700, 0.778, 1.430),
        ],
        0.010,
    ),
    (
        "cockpit_pipe_1",
        [
            (-0.675, 0.772, 0.825),
            (-0.675, 0.772, 1.015),
            (-0.630, 0.772, 1.060),
            (-0.630, 0.772, 1.180),
        ],
        0.008,
    ),
    (
        "cockpit_pipe_2",
        [
            (-0.775, 0.786, 1.405),
            (-0.610, 0.786, 1.405),
            (-0.555, 0.786, 1.445),
            (-0.300, 0.786, 1.445),
        ],
        0.009,
    ),
]

for name, points, radius in pipe_specs:
    add_curve_paths(
        name,
        [(points, False)],
        mat_pipe,
        bevel_depth=radius,
        bevel_resolution=2,
    )

# 配管クランプ
pipe_clamps = [
    (-0.735, 0.772, 0.960),
    (-0.735, 0.772, 1.255),
    (-0.675, 0.766, 0.930),
    (-0.500, 0.780, 1.445),
]

for i, loc in enumerate(pipe_clamps):
    add_cyl(
        f"cockpit_pipe_clamp_{i}",
        0.018,
        0.010,
        loc,
        mat_rivet,
        rot=(math.radians(90), 0, 0),
        verts=12,
    )

# パネル外周の重いリブ
add_curve_paths(
    "cockpit_panel_upper_rib",
    [
        (
            [
                (-0.790, 0.815, 1.470),
                (-0.560, 0.800, 1.490),
                (-0.300, 0.795, 1.495),
                (0.160, 0.835, 1.465),
            ],
            False,
        )
    ],
    mat_frame,
    bevel_depth=0.018,
    bevel_resolution=2,
)


# ----------------------------------------------------------------------
# 書き出し前処理

# glTF exporterで確実に扱えるようCurveをMesh化
convert_curves_to_mesh()

# ライト・カメラが追加されていないことを保証
for o in list(bpy.data.objects):
    if o.type in {"LIGHT", "CAMERA"}:
        bpy.data.objects.remove(o, do_unlink=True)

# すべてのMeshへ物理部分タグ
for o in bpy.data.objects:
    if o.type == "MESH":
        o["salvage_table_physical"] = True


# ----------------------------------------------------------------------
# GLB出力

if GLB:
    output_path = os.path.abspath(GLB)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        export_apply=True,
        export_extras=True,
    )

    print(f"[GLB] exported: {output_path}")
    print(
        "[GLB] physical-only asset; no cameras, lights, holo tiles, tokens, "
        "scanlines or dynamic glow"
    )
else:
    print(
        "[BUILD] salvage table constructed. "
        "Pass --glb art/salvage_table.glb to export."
    )