# tools/ue/warroom_scene.py
import math
import traceback
import unreal


LEVEL_PATH = "/Game/Maps/WarRoom"
SCREENSHOT_FILENAME = "warroom_ue.png"
SCREENSHOT_WIDTH = 1280
SCREENSHOT_HEIGHT = 800
SCREENSHOT_WAIT_TICKS = 120

_DEFER_QUIT = False
_TICK_HANDLE = None
_TICK_COUNT = 0
_SCREENSHOT_TASK = None
_MID_REFS = []


try:
    print("[SCENE] WarRoom scene build started")

    level_subsystem = unreal.get_editor_subsystem(
        unreal.LevelEditorSubsystem
    )
    actor_subsystem = unreal.get_editor_subsystem(
        unreal.EditorActorSubsystem
    )

    if level_subsystem is None:
        raise RuntimeError("LevelEditorSubsystem is unavailable")
    if actor_subsystem is None:
        raise RuntimeError("EditorActorSubsystem is unavailable")

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------

    def vec(x, y, z):
        return unreal.Vector(float(x), float(y), float(z))


    def rot(pitch=0.0, yaw=0.0, roll=0.0):
        return unreal.Rotator(float(pitch), float(yaw), float(roll))


    def scale(x, y, z):
        return unreal.Vector(float(x), float(y), float(z))


    def color8(r, g, b, a=255):
        return unreal.Color(int(r), int(g), int(b), int(a))


    def linear_color(r, g, b, a=1.0):
        return unreal.LinearColor(float(r), float(g), float(b), float(a))


    def safe_set(obj, property_name, value):
        try:
            obj.set_editor_property(property_name, value)
            return True
        except Exception:
            return False


    def look_at_rotation(source, target):
        dx = target.x - source.x
        dy = target.y - source.y
        dz = target.z - source.z
        horizontal = math.sqrt(dx * dx + dy * dy)

        yaw = math.degrees(math.atan2(dy, dx))
        pitch = math.degrees(math.atan2(dz, horizontal))
        return unreal.Rotator(pitch, yaw, 0.0)


    def load_required_asset(path):
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if asset is None:
            raise RuntimeError(
                "Required asset could not be loaded: {}".format(path)
            )
        return asset


    def spawn_actor(actor_class, label, location, rotation=None):
        if rotation is None:
            rotation = rot()

        actor = actor_subsystem.spawn_actor_from_class(
            actor_class,
            location,
            rotation,
            False,
        )

        if actor is None:
            raise RuntimeError(
                "Failed to spawn actor: {}".format(label)
            )

        actor.set_actor_label(label)
        return actor


    BASIC_MATERIAL = load_required_asset(
        "/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"
    )
    MESH_CUBE = load_required_asset(
        "/Engine/BasicShapes/Cube.Cube"
    )
    MESH_CYLINDER = load_required_asset(
        "/Engine/BasicShapes/Cylinder.Cylinder"
    )
    MESH_CONE = load_required_asset(
        "/Engine/BasicShapes/Cone.Cone"
    )
    MESH_SPHERE = load_required_asset(
        "/Engine/BasicShapes/Sphere.Sphere"
    )

    STYLE_VALUES = {
        "floor": (
            linear_color(0.012, 0.016, 0.020),
            0.90,
        ),
        "wall": (
            linear_color(0.018, 0.025, 0.031),
            0.82,
        ),
        "metal_dark": (
            linear_color(0.020, 0.027, 0.032),
            0.72,
        ),
        "metal": (
            linear_color(0.055, 0.065, 0.070),
            0.60,
        ),
        "metal_edge": (
            linear_color(0.115, 0.075, 0.028),
            0.70,
        ),
        "well": (
            linear_color(0.002, 0.025, 0.035),
            0.35,
        ),
        "cyan": (
            linear_color(0.000, 0.720, 1.000),
            0.20,
        ),
        "cyan_dim": (
            linear_color(0.000, 0.190, 0.260),
            0.35,
        ),
        "amber": (
            linear_color(1.000, 0.240, 0.018),
            0.28,
        ),
        "mug": (
            linear_color(0.090, 0.105, 0.100),
            0.78,
        ),
        "tool": (
            linear_color(0.120, 0.135, 0.140),
            0.45,
        ),
        "rubber": (
            linear_color(0.010, 0.012, 0.014),
            0.96,
        ),
    }

    styled_components = []


    def spawn_mesh(
        mesh,
        label,
        location,
        actor_scale,
        rotation=None,
        style="metal",
        cast_shadow=True,
    ):
        actor = spawn_actor(
            unreal.StaticMeshActor,
            label,
            location,
            rotation if rotation is not None else rot(),
        )
        actor.set_actor_scale3d(actor_scale)

        component = actor.get_editor_property(
            "static_mesh_component"
        )
        component.set_static_mesh(mesh)
        component.set_material(0, BASIC_MATERIAL)
        safe_set(component, "cast_shadow", bool(cast_shadow))

        styled_components.append((component, style))
        return actor


    def spawn_cube(
        label,
        location,
        actor_scale,
        rotation=None,
        style="metal",
        cast_shadow=True,
    ):
        return spawn_mesh(
            MESH_CUBE,
            label,
            location,
            actor_scale,
            rotation,
            style,
            cast_shadow,
        )


    def spawn_cylinder(
        label,
        location,
        actor_scale,
        rotation=None,
        style="metal",
        cast_shadow=True,
    ):
        return spawn_mesh(
            MESH_CYLINDER,
            label,
            location,
            actor_scale,
            rotation,
            style,
            cast_shadow,
        )


    def spawn_cone(
        label,
        location,
        actor_scale,
        rotation=None,
        style="metal",
        cast_shadow=True,
    ):
        return spawn_mesh(
            MESH_CONE,
            label,
            location,
            actor_scale,
            rotation,
            style,
            cast_shadow,
        )


    def spawn_sphere(
        label,
        location,
        actor_scale,
        rotation=None,
        style="metal",
        cast_shadow=True,
    ):
        return spawn_mesh(
            MESH_SPHERE,
            label,
            location,
            actor_scale,
            rotation,
            style,
            cast_shadow,
        )


    def spawn_cylinder_between(
        label,
        start,
        end,
        radius_cm,
        style="rubber",
        cast_shadow=True,
    ):
        dx = end.x - start.x
        dy = end.y - start.y
        dz = end.z - start.z
        length = math.sqrt(dx * dx + dy * dy + dz * dz)

        if length <= 0.001:
            raise RuntimeError(
                "Zero-length cylinder requested: {}".format(label)
            )

        midpoint = vec(
            (start.x + end.x) * 0.5,
            (start.y + end.y) * 0.5,
            (start.z + end.z) * 0.5,
        )

        direction = vec(
            dx / length,
            dy / length,
            dz / length,
        )
        cylinder_rotation = unreal.MathLibrary.make_rot_from_z(
            direction
        )

        return spawn_cylinder(
            label,
            midpoint,
            scale(
                radius_cm / 50.0,
                radius_cm / 50.0,
                length / 100.0,
            ),
            cylinder_rotation,
            style,
            cast_shadow,
        )


    def configure_light_component(
        component,
        intensity,
        light_color,
        attenuation_radius=None,
        casts_shadows=True,
    ):
        try:
            component.set_mobility(
                unreal.ComponentMobility.MOVABLE
            )
        except Exception:
            safe_set(
                component,
                "mobility",
                unreal.ComponentMobility.MOVABLE,
            )

        # UE5 local-light intensity is physical: lumens/candelas, not the
        # single/double-digit brightness scale common in Blender/three.js.
        # Force lumens when the engine exposes LightUnits so values such as
        # 50_000 and 150_000 have an explicit, stable meaning.
        if hasattr(unreal, "LightUnits"):
            safe_set(
                component,
                "intensity_units",
                unreal.LightUnits.LUMENS,
            )

        safe_set(component, "use_inverse_squared_falloff", True)
        safe_set(component, "affects_world", True)
        safe_set(component, "visible", True)

        if not safe_set(component, "intensity", float(intensity)):
            raise RuntimeError(
                "Failed to set required light intensity on {}".format(
                    component.get_name()
                )
            )

        if not safe_set(component, "light_color", light_color):
            raise RuntimeError(
                "Failed to set required light color on {}".format(
                    component.get_name()
                )
            )

        safe_set(
            component,
            "cast_shadows",
            bool(casts_shadows),
        )
        safe_set(
            component,
            "volumetric_scattering_intensity",
            0.15,
        )

        if attenuation_radius is not None:
            if not safe_set(
                component,
                "attenuation_radius",
                float(attenuation_radius),
            ):
                raise RuntimeError(
                    "Failed to set attenuation radius on {}".format(
                        component.get_name()
                    )
                )


    def spawn_point_light(
        label,
        location,
        intensity,
        light_color,
        attenuation_radius,
        casts_shadows=False,
        source_radius=4.0,
    ):
        actor = spawn_actor(
            unreal.PointLight,
            label,
            location,
            rot(),
        )
        component = actor.get_editor_property(
            "point_light_component"
        )

        configure_light_component(
            component,
            intensity,
            light_color,
            attenuation_radius,
            casts_shadows,
        )
        safe_set(
            component,
            "source_radius",
            float(source_radius),
        )
        safe_set(
            component,
            "soft_source_radius",
            float(source_radius * 1.5),
        )
        return actor


    def spawn_spot_light(
        label,
        location,
        target,
        intensity,
        light_color,
        attenuation_radius,
        inner_angle,
        outer_angle,
        casts_shadows=True,
    ):
        actor = spawn_actor(
            unreal.SpotLight,
            label,
            location,
            look_at_rotation(location, target),
        )
        component = actor.get_editor_property(
            "spot_light_component"
        )

        configure_light_component(
            component,
            intensity,
            light_color,
            attenuation_radius,
            casts_shadows,
        )

        component.set_inner_cone_angle(float(inner_angle))
        component.set_outer_cone_angle(float(outer_angle))

        safe_set(component, "source_radius", 18.0)
        safe_set(component, "soft_source_radius", 28.0)
        return actor


    def apply_dynamic_materials():
        created = 0

        for component, style_name in styled_components:
            tint, roughness = STYLE_VALUES.get(
                style_name,
                STYLE_VALUES["metal"],
            )

            try:
                mid = component.create_dynamic_material_instance(
                    0,
                    BASIC_MATERIAL,
                )

                if mid is None:
                    mid = unreal.MaterialInstanceDynamic.create(
                        BASIC_MATERIAL,
                        component,
                    )
                    component.set_material(0, mid)

                if mid is not None:
                    # BasicShapeMaterial's Color is base color only.
                    # It is deliberately not treated as emissive lighting.
                    mid.set_vector_parameter_value("Color", tint)
                    mid.set_scalar_parameter_value(
                        "Roughness",
                        roughness,
                    )
                    _MID_REFS.append(mid)
                    created += 1
            except Exception as material_error:
                unreal.log_warning(
                    "[SCENE] Dynamic material fallback on {}: {}".format(
                        component.get_name(),
                        material_error,
                    )
                )

        print(
            "[SCENE] Dynamic materials applied: {}".format(created)
        )


    # -------------------------------------------------------------------------
    # Load and clear the target level
    # -------------------------------------------------------------------------

    print("[SCENE] Loading {}".format(LEVEL_PATH))
    load_result = level_subsystem.load_level(LEVEL_PATH)
    print("[SCENE] load_level returned {}".format(load_result))

    existing_actors = list(
        actor_subsystem.get_all_level_actors()
    )
    destroyed_count = 0

    for existing_actor in existing_actors:
        try:
            if actor_subsystem.destroy_actor(existing_actor):
                destroyed_count += 1
        except Exception:
            # WorldSettings, builder brushes, or other required actors may
            # refuse destruction. Template scene actors are still removed.
            pass

    print(
        "[SCENE] Cleared {} existing actors".format(
            destroyed_count
        )
    )
    print("[SCENE] Building environment")

    # -------------------------------------------------------------------------
    # Floor and curved cockpit wall
    # -------------------------------------------------------------------------

    spawn_cube(
        "WR_Floor",
        vec(0, 0, -10),
        scale(8.0, 8.0, 0.20),
        style="floor",
    )

    wall_radius = 310.0
    wall_angles = [22.0, 38.0, 54.0, 70.0, 86.0]

    for index, angle_deg in enumerate(wall_angles):
        angle_rad = math.radians(angle_deg)
        wall_x = wall_radius * math.cos(angle_rad)
        wall_y = wall_radius * math.sin(angle_rad)
        tangent_yaw = angle_deg + 90.0

        spawn_cube(
            "WR_WallPanel_{:02d}".format(index),
            vec(wall_x, wall_y, 130),
            scale(1.10, 0.18, 2.60),
            rot(0, tangent_yaw, 0),
            "wall",
        )

        spawn_cube(
            "WR_WallRib_{:02d}".format(index),
            vec(
                wall_x - 3.0 * math.cos(angle_rad),
                wall_y - 3.0 * math.sin(angle_rad),
                130,
            ),
            scale(0.09, 0.30, 2.72),
            rot(0, tangent_yaw, 0),
            "metal_edge",
        )

    pipe_angles = [30.0, 33.0, 79.0, 82.0]

    for index, angle_deg in enumerate(pipe_angles):
        angle_rad = math.radians(angle_deg)
        radius = wall_radius - 23.0

        spawn_cylinder(
            "WR_WallPipe_{:02d}".format(index),
            vec(
                radius * math.cos(angle_rad),
                radius * math.sin(angle_rad),
                132,
            ),
            scale(0.055, 0.055, 2.35),
            style="metal_dark",
        )

    # Background console blocks and amber practicals.
    for index, z_value in enumerate([62.0, 90.0, 118.0]):
        spawn_cube(
            "WR_BackConsole_{:02d}".format(index),
            vec(214, 211, z_value),
            scale(0.62, 0.28, 0.22),
            rot(0, 135, 0),
            "metal",
        )

    for index, offset in enumerate([-18.0, 0.0, 18.0]):
        spawn_cube(
            "WR_AmberPractical_{:02d}".format(index),
            vec(
                210 + offset,
                205 - offset,
                151,
            ),
            scale(0.10, 0.035, 0.035),
            rot(0, 135, 0),
            "amber",
            False,
        )

    spawn_point_light(
        "WR_AmberPracticalLight",
        vec(196, 193, 156),
        7500.0,
        color8(255, 106, 28),
        165.0,
        False,
        2.0,
    )

    # -------------------------------------------------------------------------
    # Octagonal salvage command table
    # -------------------------------------------------------------------------

    print("[SCENE] Building command table")

    spawn_cylinder(
        "WR_TableBase",
        vec(0, 0, 42),
        scale(1.15, 1.15, 0.65),
        style="metal_dark",
    )

    spawn_cylinder(
        "WR_TableBaseLower",
        vec(0, 0, 14),
        scale(0.88, 0.88, 0.24),
        style="metal_edge",
    )

    # Under-well support.
    spawn_cube(
        "WR_WellSupport",
        vec(0, 0, 76),
        scale(0.98, 0.98, 0.10),
        style="metal_dark",
    )

    # Eight chunky apron pieces.
    apron_specs = [
        (
            "N",
            vec(0, 57, 80),
            scale(0.92, 0.26, 0.20),
            0.0,
        ),
        (
            "S",
            vec(0, -57, 80),
            scale(0.92, 0.26, 0.20),
            0.0,
        ),
        (
            "E",
            vec(57, 0, 80),
            scale(0.26, 0.92, 0.20),
            0.0,
        ),
        (
            "W",
            vec(-57, 0, 80),
            scale(0.26, 0.92, 0.20),
            0.0,
        ),
        (
            "NE",
            vec(49, 49, 80),
            scale(0.36, 0.24, 0.20),
            -45.0,
        ),
        (
            "NW",
            vec(-49, 49, 80),
            scale(0.36, 0.24, 0.20),
            45.0,
        ),
        (
            "SE",
            vec(49, -49, 80),
            scale(0.36, 0.24, 0.20),
            45.0,
        ),
        (
            "SW",
            vec(-49, -49, 80),
            scale(0.36, 0.24, 0.20),
            -45.0,
        ),
    ]

    for suffix, location, actor_scale, yaw in apron_specs:
        spawn_cube(
            "WR_TableApron_{}".format(suffix),
            location,
            actor_scale,
            rot(0, yaw, 0),
            "metal_dark",
        )

    # Eight-piece upper rim, producing a clear octagonal silhouette.
    rim_specs = [
        (
            "N",
            vec(0, 57, 92),
            scale(0.92, 0.26, 0.12),
            0.0,
        ),
        (
            "S",
            vec(0, -57, 92),
            scale(0.92, 0.26, 0.12),
            0.0,
        ),
        (
            "E",
            vec(57, 0, 92),
            scale(0.26, 0.92, 0.12),
            0.0,
        ),
        (
            "W",
            vec(-57, 0, 92),
            scale(0.26, 0.92, 0.12),
            0.0,
        ),
        (
            "NE",
            vec(49, 49, 92),
            scale(0.36, 0.24, 0.12),
            -45.0,
        ),
        (
            "NW",
            vec(-49, 49, 92),
            scale(0.36, 0.24, 0.12),
            45.0,
        ),
        (
            "SE",
            vec(49, -49, 92),
            scale(0.36, 0.24, 0.12),
            45.0,
        ),
        (
            "SW",
            vec(-49, -49, 92),
            scale(0.36, 0.24, 0.12),
            -45.0,
        ),
    ]

    for suffix, location, actor_scale, yaw in rim_specs:
        spawn_cube(
            "WR_TableRim_{}".format(suffix),
            location,
            actor_scale,
            rot(0, yaw, 0),
            "metal_edge",
        )

    # Recessed 86 cm holographic well.
    spawn_cube(
        "WR_HoloWell",
        vec(0, 0, 82),
        scale(0.86, 0.86, 0.02),
        style="well",
        cast_shadow=False,
    )

    # Cyan inner rim.
    inner_rim_specs = [
        (
            "N",
            vec(0, 43, 84),
            scale(0.86, 0.018, 0.012),
        ),
        (
            "S",
            vec(0, -43, 84),
            scale(0.86, 0.018, 0.012),
        ),
        (
            "E",
            vec(43, 0, 84),
            scale(0.018, 0.86, 0.012),
        ),
        (
            "W",
            vec(-43, 0, 84),
            scale(0.018, 0.86, 0.012),
        ),
    ]

    for suffix, location, actor_scale in inner_rim_specs:
        spawn_cube(
            "WR_HoloRim_{}".format(suffix),
            location,
            actor_scale,
            style="cyan",
            cast_shadow=False,
        )

    # 5x5 grid: six divisions on each axis.
    grid_positions = [
        -42.0,
        -25.2,
        -8.4,
        8.4,
        25.2,
        42.0,
    ]

    for index, position in enumerate(grid_positions):
        spawn_cube(
            "WR_GridX_{:02d}".format(index),
            vec(position, 0, 84.2),
            scale(0.008, 0.84, 0.008),
            style="cyan",
            cast_shadow=False,
        )

        spawn_cube(
            "WR_GridY_{:02d}".format(index),
            vec(0, position, 84.25),
            scale(0.84, 0.008, 0.008),
            style="cyan",
            cast_shadow=False,
        )

    # Holographic markers / ship-like tokens.
    spawn_cone(
        "WR_HoloToken_Cyan_01",
        vec(-23, 20, 90),
        scale(0.060, 0.060, 0.120),
        rot(0, -18, 0),
        "cyan",
        False,
    )
    spawn_cone(
        "WR_HoloToken_Cyan_02",
        vec(24, -21, 89),
        scale(0.050, 0.050, 0.100),
        rot(0, 35, 0),
        "cyan",
        False,
    )
    spawn_cube(
        "WR_HoloToken_Amber_01",
        vec(14, 19, 87),
        scale(0.095, 0.045, 0.045),
        rot(0, 72, 0),
        "amber",
        False,
    )

    # A simple multi-part cyan ship marker.
    spawn_cube(
        "WR_HoloShip_Core",
        vec(-8, -15, 88),
        scale(0.150, 0.040, 0.050),
        rot(0, 18, 0),
        "cyan",
        False,
    )
    spawn_cube(
        "WR_HoloShip_LeftWing",
        vec(-11, -18, 87.5),
        scale(0.055, 0.130, 0.025),
        rot(0, 18, 0),
        "cyan_dim",
        False,
    )
    spawn_cube(
        "WR_HoloShip_RightWing",
        vec(-5, -12, 87.5),
        scale(0.055, 0.130, 0.025),
        rot(0, 18, 0),
        "cyan_dim",
        False,
    )

    # Rim bolts.
    bolt_positions = [
        (-54, -54),
        (-54, 54),
        (54, -54),
        (54, 54),
        (0, -65),
        (0, 65),
        (-65, 0),
        (65, 0),
    ]

    for index, (bolt_x, bolt_y) in enumerate(
        bolt_positions
    ):
        spawn_cylinder(
            "WR_RimBolt_{:02d}".format(index),
            vec(bolt_x, bolt_y, 98.6),
            scale(0.026, 0.026, 0.016),
            style="tool",
        )

    # -------------------------------------------------------------------------
    # Tabletop props
    # -------------------------------------------------------------------------

    print("[SCENE] Adding tabletop props")

    # Mug.
    spawn_cylinder(
        "WR_MugBody",
        vec(-27, -61, 104),
        scale(0.095, 0.095, 0.120),
        style="mug",
    )
    spawn_cylinder(
        "WR_MugOpening",
        vec(-27, -61, 110.2),
        scale(0.068, 0.068, 0.006),
        style="rubber",
        cast_shadow=False,
    )
    spawn_cube(
        "WR_MugHandleTop",
        vec(-18, -61, 107),
        scale(0.070, 0.025, 0.022),
        style="mug",
    )
    spawn_cube(
        "WR_MugHandleSide",
        vec(-15, -61, 103),
        scale(0.020, 0.025, 0.075),
        style="mug",
    )
    spawn_cube(
        "WR_MugHandleBottom",
        vec(-18, -61, 99.5),
        scale(0.070, 0.025, 0.022),
        style="mug",
    )

    # Tools on the right rim.
    spawn_cube(
        "WR_ToolDriverShaft",
        vec(58, 11, 102),
        scale(0.035, 0.250, 0.025),
        rot(0, 8, 0),
        "tool",
    )
    spawn_cylinder(
        "WR_ToolDriverHandle",
        vec(56, -4, 102),
        scale(0.038, 0.038, 0.120),
        rot(90, 8, 0),
        "amber",
    )
    spawn_cube(
        "WR_ToolBar",
        vec(58, 35, 101.5),
        scale(0.045, 0.280, 0.030),
        rot(0, -12, 0),
        "tool",
    )
    spawn_cube(
        "WR_ToolBarHead",
        vec(61, 48, 102),
        scale(0.120, 0.055, 0.040),
        rot(0, -12, 0),
        "tool",
    )

    # Loose hardware.
    for index, (x_value, y_value) in enumerate(
        [
            (53, -27),
            (59, -34),
            (48, -39),
            (64, -20),
        ]
    ):
        spawn_cylinder(
            "WR_LooseFastener_{:02d}".format(index),
            vec(x_value, y_value, 101),
            scale(0.026, 0.026, 0.075),
            rot(90, 20 * index, 0),
            "tool",
        )

    # Segmented cables draped across near rim and floor-facing edge.
    cable_paths = [
        [
            vec(-67, -39, 103),
            vec(-76, -50, 101),
            vec(-72, -68, 98),
            vec(-58, -79, 94),
        ],
        [
            vec(-52, 64, 102),
            vec(-68, 73, 99),
            vec(-83, 68, 95),
            vec(-93, 55, 92),
        ],
        [
            vec(18, -66, 102),
            vec(30, -78, 98),
            vec(37, -92, 91),
            vec(39, -106, 82),
        ],
    ]

    for cable_index, cable_points in enumerate(
        cable_paths
    ):
        for segment_index in range(
            len(cable_points) - 1
        ):
            spawn_cylinder_between(
                "WR_Cable_{:02d}_{:02d}".format(
                    cable_index,
                    segment_index,
                ),
                cable_points[segment_index],
                cable_points[segment_index + 1],
                1.25 if cable_index < 2 else 0.9,
                "rubber",
            )

    # -------------------------------------------------------------------------
    # Lighting
    # -------------------------------------------------------------------------

    print("[SCENE] Creating high-output physical lighting")
    print(
        "[SCENE] Local-light intensity units are lumens; "
        "single/double-digit values are effectively dark in this UE setup"
    )

    spawn_spot_light(
        "WR_WarmKey",
        vec(-210, -235, 340),
        vec(0, 0, 84),
        150000.0,
        color8(255, 145, 72),
        1100.0,
        28.0,
        58.0,
        True,
    )

    spawn_point_light(
        "WR_CoolRim",
        vec(175, 205, 190),
        30000.0,
        color8(25, 210, 255),
        600.0,
        True,
        12.0,
    )

    spawn_point_light(
        "WR_NeutralFill",
        vec(-70, 100, 245),
        18000.0,
        color8(112, 145, 170),
        550.0,
        False,
        10.0,
    )

    well_light_positions = [
        (-28, -28),
        (-28, 28),
        (28, -28),
        (28, 28),
    ]

    for index, (light_x, light_y) in enumerate(
        well_light_positions
    ):
        spawn_point_light(
            "WR_WellLight_{:02d}".format(index),
            vec(light_x, light_y, 92),
            9000.0,
            color8(0, 220, 255),
            220.0,
            False,
            2.5,
        )

    # Fail-safe work light. BasicShapeMaterial's "Color" parameter is base
    # color, not emissive, so the cyan/amber MIDs cannot be trusted to glow.
    # This shadowless overhead point light guarantees that the table and well
    # receive direct light even if every decorative light/material path fails.
    spawn_point_light(
        "WR_FailSafeWorkLight",
        vec(0, -20, 225),
        50000.0,
        color8(235, 244, 255),
        700.0,
        False,
        20.0,
    )

    # A weak, cool directional light raises the whole scene floor without
    # becoming the visual key. Directional-light intensity uses lux, unlike
    # the lumen-based local lights above.
    directional = spawn_actor(
        unreal.DirectionalLight,
        "WR_CoolDirectionalFill",
        vec(0, 0, 300),
        rot(-52.0, -135.0, 0.0),
    )
    directional_component = (
        directional.get_editor_property(
            "directional_light_component"
        )
    )

    try:
        directional_component.set_mobility(
            unreal.ComponentMobility.MOVABLE
        )
    except Exception:
        safe_set(
            directional_component,
            "mobility",
            unreal.ComponentMobility.MOVABLE,
        )

    safe_set(
        directional_component,
        "intensity",
        4.0,
    )
    safe_set(
        directional_component,
        "light_color",
        color8(92, 132, 190),
    )
    safe_set(
        directional_component,
        "cast_shadows",
        False,
    )
    safe_set(
        directional_component,
        "volumetric_scattering_intensity",
        0.10,
    )

    skylight = spawn_actor(
        unreal.SkyLight,
        "WR_SkyLight",
        vec(0, 0, 210),
        rot(),
    )
    skylight_component = skylight.get_editor_property(
        "light_component"
    )

    try:
        skylight_component.set_mobility(
            unreal.ComponentMobility.MOVABLE
        )
    except Exception:
        safe_set(
            skylight_component,
            "mobility",
            unreal.ComponentMobility.MOVABLE,
        )

    # Capture the scene instead of depending on a specified cubemap.
    if hasattr(unreal, "SkyLightSourceType"):
        safe_set(
            skylight_component,
            "source_type",
            unreal.SkyLightSourceType.SLS_CAPTURED_SCENE,
        )

    safe_set(
        skylight_component,
        "intensity_scale",
        1.0,
    )
    safe_set(
        skylight_component,
        "light_color",
        color8(92, 122, 148),
    )
    safe_set(
        skylight_component,
        "lower_hemisphere_is_solid_color",
        True,
    )
    safe_set(
        skylight_component,
        "lower_hemisphere_color",
        linear_color(0.005, 0.008, 0.012),
    )

    try:
        skylight_component.recapture_sky()
    except Exception:
        pass

    # -------------------------------------------------------------------------
    # Post process
    # -------------------------------------------------------------------------

    print("[SCENE] Configuring post process")

    post_process = spawn_actor(
        unreal.PostProcessVolume,
        "WR_PostProcess",
        vec(0, 0, 0),
        rot(),
    )
    safe_set(post_process, "unbound", True)
    safe_set(post_process, "enabled", True)
    safe_set(post_process, "blend_weight", 1.0)
    safe_set(post_process, "priority", 10.0)

    pp_settings = post_process.get_editor_property(
        "settings"
    )

    safe_set(
        pp_settings,
        "override_bloom_intensity",
        True,
    )
    safe_set(pp_settings, "bloom_intensity", 2.1)
    safe_set(
        pp_settings,
        "override_bloom_threshold",
        True,
    )
    safe_set(pp_settings, "bloom_threshold", 0.15)

    # WR_PostProcess is the sole exposure owner. Do not add exposure
    # overrides to WR_Camera_Main: MRQ must see the same fixed exposure
    # through CameraCut. Legacy brightness and EV100 names are both
    # attempted for UE-version tolerance; safe_set silently ignores
    # properties absent in this version.
    if hasattr(unreal, "AutoExposureMethod"):
        safe_set(
            pp_settings,
            "override_auto_exposure_method",
            True,
        )
        safe_set(
            pp_settings,
            "auto_exposure_method",
            unreal.AutoExposureMethod.AEM_MANUAL,
        )

    safe_set(
        pp_settings,
        "override_auto_exposure_min_brightness",
        True,
    )
    safe_set(
        pp_settings,
        "auto_exposure_min_brightness",
        1.0,
    )
    safe_set(
        pp_settings,
        "override_auto_exposure_max_brightness",
        True,
    )
    safe_set(
        pp_settings,
        "auto_exposure_max_brightness",
        1.0,
    )

    safe_set(
        pp_settings,
        "override_auto_exposure_min_ev100",
        True,
    )
    safe_set(
        pp_settings,
        "auto_exposure_min_ev100",
        0.0,
    )
    safe_set(
        pp_settings,
        "override_auto_exposure_max_ev100",
        True,
    )
    safe_set(
        pp_settings,
        "auto_exposure_max_ev100",
        0.0,
    )

    safe_set(
        pp_settings,
        "override_auto_exposure_apply_physical_camera_exposure",
        True,
    )
    safe_set(
        pp_settings,
        "auto_exposure_apply_physical_camera_exposure",
        False,
    )
    safe_set(
        pp_settings,
        "override_auto_exposure_bias",
        True,
    )
    safe_set(
        pp_settings,
        "auto_exposure_bias",
        0.0,
    )

    safe_set(
        pp_settings,
        "override_vignette_intensity",
        True,
    )
    safe_set(
        pp_settings,
        "vignette_intensity",
        0.34,
    )

    safe_set(
        pp_settings,
        "override_ambient_occlusion_intensity",
        True,
    )
    safe_set(
        pp_settings,
        "ambient_occlusion_intensity",
        1.15,
    )
    safe_set(
        pp_settings,
        "override_ambient_occlusion_radius",
        True,
    )
    safe_set(
        pp_settings,
        "ambient_occlusion_radius",
        125.0,
    )

    safe_set(
        pp_settings,
        "override_color_saturation",
        True,
    )
    safe_set(
        pp_settings,
        "color_saturation",
        unreal.Vector4(0.92, 0.96, 1.02, 1.0),
    )

    post_process.set_editor_property(
        "settings",
        pp_settings,
    )

    # -------------------------------------------------------------------------
    # Camera
    # -------------------------------------------------------------------------

    print("[SCENE] Creating screenshot camera")

    camera_location = vec(-300, -360, 650)
    camera_target = vec(0, 0, 86)

    camera = spawn_actor(
        unreal.CameraActor,
        "WR_Camera_Main",
        camera_location,
        look_at_rotation(
            camera_location,
            camera_target,
        ),
    )

    print(
        "[SCENE] camera at ({:.1f}, {:.1f}, {:.1f}) looking at "
        "({:.1f}, {:.1f}, {:.1f})".format(
            camera_location.x,
            camera_location.y,
            camera_location.z,
            camera_target.x,
            camera_target.y,
            camera_target.z,
        )
    )

    camera_component = camera.get_editor_property(
        "camera_component"
    )
    camera_component.set_field_of_view(50.0)
    safe_set(camera_component, "aspect_ratio", 1.6)
    safe_set(
        camera_component,
        "constrain_aspect_ratio",
        True,
    )

    # Camera exposure is intentionally untouched. WR_PostProcess is the
    # only actor allowed to control exposure.

    # -------------------------------------------------------------------------
    # Save persistent geometry, lights, post process, and camera first.
    # Dynamic material instances are applied afterward for this render
    # session.
    # -------------------------------------------------------------------------

    print("[SCENE] Saving current level")
    save_result = level_subsystem.save_current_level()

    if not save_result:
        raise RuntimeError(
            "save_current_level returned False"
        )

    print("[SCENE] Level saved")

    apply_dynamic_materials()

    # -------------------------------------------------------------------------
    # Screenshot and deferred shutdown
    # -------------------------------------------------------------------------

    print("[SCENE] Requesting high-resolution screenshot")

    _SCREENSHOT_TASK = (
        unreal.AutomationLibrary.take_high_res_screenshot(
            SCREENSHOT_WIDTH,
            SCREENSHOT_HEIGHT,
            SCREENSHOT_FILENAME,
            camera,
        )
    )

    if _SCREENSHOT_TASK is None:
        raise RuntimeError(
            "take_high_res_screenshot returned None"
        )

    try:
        if not _SCREENSHOT_TASK.is_valid_task():
            raise RuntimeError(
                "High-resolution screenshot task is invalid"
            )
    except AttributeError:
        pass


    def _finish_and_quit(success):
        global _TICK_HANDLE

        try:
            if _TICK_HANDLE is not None:
                unreal.unregister_slate_post_tick_callback(
                    _TICK_HANDLE
                )
                _TICK_HANDLE = None
        except Exception:
            pass

        try:
            if success:
                print("SCENE_OK")
        finally:
            unreal.SystemLibrary.quit_editor()


    def _on_slate_post_tick(delta_seconds):
        global _TICK_COUNT

        try:
            _TICK_COUNT += 1

            if _TICK_COUNT >= SCREENSHOT_WAIT_TICKS:
                _finish_and_quit(True)

        except Exception:
            print("[SCENE] ERROR during screenshot wait")
            traceback.print_exc()
            _finish_and_quit(False)


    _TICK_HANDLE = (
        unreal.register_slate_post_tick_callback(
            _on_slate_post_tick
        )
    )
    _DEFER_QUIT = True

    print(
        "[SCENE] Screenshot queued; waiting {} Slate ticks".format(
            SCREENSHOT_WAIT_TICKS
        )
    )

except BaseException:
    print("[SCENE] ERROR")
    traceback.print_exc()

finally:
    if not _DEFER_QUIT:
        try:
            if _TICK_HANDLE is not None:
                unreal.unregister_slate_post_tick_callback(
                    _TICK_HANDLE
                )
                _TICK_HANDLE = None
        except Exception:
            pass

        unreal.SystemLibrary.quit_editor()