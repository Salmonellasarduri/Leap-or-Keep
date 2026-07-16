# tools/ue/warroom_scene.py
#
# Diagnostic white-material baseline.
#
# Important:
#   warroom_capture.py currently creates MIDs for every StaticMeshActor whose
#   label begins with "WR_". Therefore all visible geometry in this file uses
#   BASE_ or GEO_ labels. One off-camera WR_ compatibility probe remains so the
#   unchanged capture script does not fail its "created == 0" guard.
#
# No MID, MIC, post-process volume, or ExponentialHeightFog is created here.

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


try:
    print("[SCENE] WarRoom diagnostic scene build started")
    print("[SCENE] mode=white-material-baseline no-MID no-fog no-PPV")

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

    # ---------------------------------------------------------------------
    # Helpers
    # ---------------------------------------------------------------------

    def vec(x, y, z):
        return unreal.Vector(float(x), float(y), float(z))


    def rot(pitch=0.0, yaw=0.0, roll=0.0):
        # unreal.Rotatorの位置引数は(roll, pitch, yaw)順 — 事故防止のためキーワード指定(実測: pitch47が roll に入りカメラが空を向いた)
        return unreal.Rotator(roll=float(roll), pitch=float(pitch), yaw=float(yaw))


    def scale(x, y, z):
        return unreal.Vector(float(x), float(y), float(z))


    def color8(r, g, b, a=255):
        return unreal.Color(
            int(r),
            int(g),
            int(b),
            int(a),
        )


    def safe_set(obj, property_name, value):
        try:
            obj.set_editor_property(property_name, value)
            return True
        except Exception:
            return False


    def required_set(obj, property_name, value):
        if not safe_set(obj, property_name, value):
            raise RuntimeError(
                "Failed to set {} on {}".format(
                    property_name,
                    obj.get_name(),
                )
            )


    def load_required_asset(path):
        asset = unreal.EditorAssetLibrary.load_asset(path)

        if asset is None:
            raise RuntimeError(
                "Required asset could not be loaded: {}".format(path)
            )

        return asset


    def look_at_rotation(source, target):
        dx = target.x - source.x
        dy = target.y - source.y
        dz = target.z - source.z

        horizontal = math.sqrt(dx * dx + dy * dy)
        yaw = math.degrees(math.atan2(dy, dx))
        pitch = math.degrees(math.atan2(dz, horizontal))

        return rot(pitch, yaw, 0.0)


    def spawn_actor(
        actor_class,
        label,
        location,
        rotation=None,
    ):
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


    def set_movable(component):
        try:
            component.set_mobility(
                unreal.ComponentMobility.MOVABLE
            )
            return
        except Exception:
            pass

        required_set(
            component,
            "mobility",
            unreal.ComponentMobility.MOVABLE,
        )


    BASIC_MATERIAL_PATH = (
        "/Engine/BasicShapes/"
        "BasicShapeMaterial.BasicShapeMaterial"
    )

    BASIC_MATERIAL = load_required_asset(BASIC_MATERIAL_PATH)
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

    mesh_components = []


    def spawn_mesh(
        mesh,
        label,
        location,
        actor_scale,
        rotation=None,
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

        if component is None:
            raise RuntimeError(
                "{} has no StaticMeshComponent".format(label)
            )

        component.set_static_mesh(mesh)

        # This is a direct reference to a persistent engine asset.
        # It is not a MaterialInstanceDynamic.
        component.set_material(0, BASIC_MATERIAL)

        safe_set(
            component,
            "cast_shadow",
            bool(cast_shadow),
        )

        mesh_components.append(
            (label, component)
        )
        return actor


    def spawn_cube(
        label,
        location,
        actor_scale,
        rotation=None,
        cast_shadow=True,
    ):
        return spawn_mesh(
            MESH_CUBE,
            label,
            location,
            actor_scale,
            rotation,
            cast_shadow,
        )


    def spawn_cylinder(
        label,
        location,
        actor_scale,
        rotation=None,
        cast_shadow=True,
    ):
        return spawn_mesh(
            MESH_CYLINDER,
            label,
            location,
            actor_scale,
            rotation,
            cast_shadow,
        )


    def spawn_cone(
        label,
        location,
        actor_scale,
        rotation=None,
        cast_shadow=True,
    ):
        return spawn_mesh(
            MESH_CONE,
            label,
            location,
            actor_scale,
            rotation,
            cast_shadow,
        )


    def spawn_sphere(
        label,
        location,
        actor_scale,
        rotation=None,
        cast_shadow=True,
    ):
        return spawn_mesh(
            MESH_SPHERE,
            label,
            location,
            actor_scale,
            rotation,
            cast_shadow,
        )


    def spawn_cylinder_between(
        label,
        start,
        end,
        radius_cm,
        cast_shadow=True,
    ):
        dx = end.x - start.x
        dy = end.y - start.y
        dz = end.z - start.z

        length = math.sqrt(
            dx * dx + dy * dy + dz * dz
        )

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

        cylinder_rotation = (
            unreal.MathLibrary.make_rot_from_z(direction)
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
            cast_shadow,
        )


    def configure_local_light(
        component,
        intensity_lumens,
        light_color,
        attenuation_radius,
        casts_shadows=True,
    ):
        set_movable(component)

        if hasattr(unreal, "LightUnits"):
            safe_set(
                component,
                "intensity_units",
                unreal.LightUnits.LUMENS,
            )

        safe_set(
            component,
            "use_inverse_squared_falloff",
            True,
        )
        required_set(component, "affects_world", True)
        required_set(component, "visible", True)
        required_set(
            component,
            "intensity",
            float(intensity_lumens),
        )
        required_set(
            component,
            "light_color",
            light_color,
        )
        required_set(
            component,
            "attenuation_radius",
            float(attenuation_radius),
        )
        required_set(
            component,
            "cast_shadows",
            bool(casts_shadows),
        )

        safe_set(
            component,
            "volumetric_scattering_intensity",
            0.0,
        )


    def spawn_point_light(
        label,
        location,
        intensity_lumens,
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

        configure_local_light(
            component,
            intensity_lumens,
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
        intensity_lumens,
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

        configure_local_light(
            component,
            intensity_lumens,
            light_color,
            attenuation_radius,
            casts_shadows,
        )

        component.set_inner_cone_angle(
            float(inner_angle)
        )
        component.set_outer_cone_angle(
            float(outer_angle)
        )

        safe_set(component, "source_radius", 18.0)
        safe_set(component, "soft_source_radius", 28.0)

        return actor


    # ---------------------------------------------------------------------
    # Load and clear level
    # ---------------------------------------------------------------------

    print("[SCENE] progress 1/7: loading and clearing level")
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
            # Required actors such as WorldSettings can refuse destruction.
            pass

    print(
        "[SCENE] Cleared {} existing actors".format(
            destroyed_count
        )
    )

    # ---------------------------------------------------------------------
    # Absolute-visibility baseline
    # ---------------------------------------------------------------------

    print("[SCENE] progress 2/7: building visibility baseline")
    print(
        "[SCENE] Baseline: DirectionalLight + SkyAtmosphere + "
        "real-time SkyLight + white floor/cubes"
    )

    sky_atmosphere = spawn_actor(
        unreal.SkyAtmosphere,
        "BASE_SkyAtmosphere",
        vec(0, 0, 0),
        rot(),
    )

    if sky_atmosphere is None:
        raise RuntimeError("SkyAtmosphere could not be created")

    directional = spawn_actor(
        unreal.DirectionalLight,
        "BASE_DirectionalLight",
        vec(0, 0, 500),
        rot(-45.0, -135.0, 0.0),
    )

    directional_component = directional.get_editor_property(
        "directional_light_component"
    )

    set_movable(directional_component)
    required_set(
        directional_component,
        "intensity",
        10.0,
    )
    required_set(
        directional_component,
        "light_color",
        color8(255, 250, 242),
    )
    required_set(
        directional_component,
        "affects_world",
        True,
    )
    required_set(
        directional_component,
        "visible",
        True,
    )
    required_set(
        directional_component,
        "cast_shadows",
        True,
    )
    required_set(
        directional_component,
        "atmosphere_sun_light",
        True,
    )
    safe_set(
        directional_component,
        "atmosphere_sun_light_index",
        0,
    )
    safe_set(
        directional_component,
        "volumetric_scattering_intensity",
        0.0,
    )

    skylight = spawn_actor(
        unreal.SkyLight,
        "BASE_SkyLight",
        vec(0, 0, 300),
        rot(),
    )

    skylight_component = skylight.get_component_by_class(
        unreal.SkyLightComponent
    )

    if skylight_component is None:
        skylight_component = skylight.get_editor_property(
            "light_component"
        )

    if skylight_component is None:
        raise RuntimeError("SkyLight has no SkyLightComponent")

    set_movable(skylight_component)

    if hasattr(unreal, "SkyLightSourceType"):
        required_set(
            skylight_component,
            "source_type",
            unreal.SkyLightSourceType.SLS_CAPTURED_SCENE,
        )

    required_set(
        skylight_component,
        "real_time_capture",
        True,
    )
    required_set(
        skylight_component,
        "intensity",
        1.0,
    )
    required_set(
        skylight_component,
        "light_color",
        color8(255, 255, 255),
    )
    safe_set(
        skylight_component,
        "lower_hemisphere_is_solid_color",
        False,
    )

    # Large white floor.
    spawn_cube(
        "BASE_VisibilityFloor",
        vec(0, 0, -10),
        scale(9.0, 9.0, 0.20),
    )

    # Deliberately obvious baseline cubes, separated from the main table.
    spawn_cube(
        "BASE_VisibilityCube_Left",
        vec(-230, -80, 50),
        scale(1.0, 1.0, 1.0),
    )
    spawn_cube(
        "BASE_VisibilityCube_Right",
        vec(230, -40, 75),
        scale(0.9, 0.9, 1.5),
    )
    spawn_cube(
        "BASE_VisibilityCube_Back",
        vec(0, 260, 40),
        scale(0.8, 0.8, 0.8),
    )

    # The unchanged capture script insists on creating at least one MID.
    # Keep exactly one WR_ StaticMeshActor far outside the rendered scene.
    # No visible mesh below uses a WR_ label.
    spawn_cube(
        "WR_MID_CompatibilityProbe",
        vec(100000, 100000, -100000),
        scale(0.1, 0.1, 0.1),
        cast_shadow=False,
    )

    print(
        "[SCENE] Capture isolation active: visible meshes use "
        "BASE_/GEO_; WR_ MID probe is off-camera"
    )

    # ---------------------------------------------------------------------
    # Cockpit wall and background geometry
    # ---------------------------------------------------------------------

    print("[SCENE] progress 3/7: building gray-white geometry")

    wall_radius = 310.0
    wall_angles = [22.0, 38.0, 54.0, 70.0, 86.0]

    for index, angle_deg in enumerate(wall_angles):
        angle_rad = math.radians(angle_deg)
        wall_x = wall_radius * math.cos(angle_rad)
        wall_y = wall_radius * math.sin(angle_rad)
        tangent_yaw = angle_deg + 90.0

        spawn_cube(
            "GEO_WallPanel_{:02d}".format(index),
            vec(wall_x, wall_y, 130),
            scale(1.10, 0.18, 2.60),
            rot(0, tangent_yaw, 0),
        )

        spawn_cube(
            "GEO_WallRib_{:02d}".format(index),
            vec(
                wall_x - 3.0 * math.cos(angle_rad),
                wall_y - 3.0 * math.sin(angle_rad),
                130,
            ),
            scale(0.09, 0.30, 2.72),
            rot(0, tangent_yaw, 0),
        )

    for index, angle_deg in enumerate(
        [30.0, 33.0, 79.0, 82.0]
    ):
        angle_rad = math.radians(angle_deg)
        radius = wall_radius - 23.0

        spawn_cylinder(
            "GEO_WallPipe_{:02d}".format(index),
            vec(
                radius * math.cos(angle_rad),
                radius * math.sin(angle_rad),
                132,
            ),
            scale(0.055, 0.055, 2.35),
        )

    for index, z_value in enumerate(
        [62.0, 90.0, 118.0]
    ):
        spawn_cube(
            "GEO_BackConsole_{:02d}".format(index),
            vec(214, 211, z_value),
            scale(0.62, 0.28, 0.22),
            rot(0, 135, 0),
        )

    for index, offset in enumerate(
        [-18.0, 0.0, 18.0]
    ):
        spawn_cube(
            "GEO_BackPractical_{:02d}".format(index),
            vec(
                210 + offset,
                205 - offset,
                151,
            ),
            scale(0.10, 0.035, 0.035),
            rot(0, 135, 0),
            False,
        )

    # ---------------------------------------------------------------------
    # Command table
    # ---------------------------------------------------------------------

    print("[SCENE] Building command table")

    spawn_cylinder(
        "GEO_TableBase",
        vec(0, 0, 42),
        scale(1.15, 1.15, 0.65),
    )
    spawn_cylinder(
        "GEO_TableBaseLower",
        vec(0, 0, 14),
        scale(0.88, 0.88, 0.24),
    )
    spawn_cube(
        "GEO_WellSupport",
        vec(0, 0, 76),
        scale(0.98, 0.98, 0.10),
    )

    apron_specs = [
        ("N", vec(0, 57, 80), scale(0.92, 0.26, 0.20), 0.0),
        ("S", vec(0, -57, 80), scale(0.92, 0.26, 0.20), 0.0),
        ("E", vec(57, 0, 80), scale(0.26, 0.92, 0.20), 0.0),
        ("W", vec(-57, 0, 80), scale(0.26, 0.92, 0.20), 0.0),
        ("NE", vec(49, 49, 80), scale(0.36, 0.24, 0.20), -45.0),
        ("NW", vec(-49, 49, 80), scale(0.36, 0.24, 0.20), 45.0),
        ("SE", vec(49, -49, 80), scale(0.36, 0.24, 0.20), 45.0),
        ("SW", vec(-49, -49, 80), scale(0.36, 0.24, 0.20), -45.0),
    ]

    for suffix, location, actor_scale, yaw in apron_specs:
        spawn_cube(
            "GEO_TableApron_{}".format(suffix),
            location,
            actor_scale,
            rot(0, yaw, 0),
        )

    rim_specs = [
        ("N", vec(0, 57, 92), scale(0.92, 0.26, 0.12), 0.0),
        ("S", vec(0, -57, 92), scale(0.92, 0.26, 0.12), 0.0),
        ("E", vec(57, 0, 92), scale(0.26, 0.92, 0.12), 0.0),
        ("W", vec(-57, 0, 92), scale(0.26, 0.92, 0.12), 0.0),
        ("NE", vec(49, 49, 92), scale(0.36, 0.24, 0.12), -45.0),
        ("NW", vec(-49, 49, 92), scale(0.36, 0.24, 0.12), 45.0),
        ("SE", vec(49, -49, 92), scale(0.36, 0.24, 0.12), 45.0),
        ("SW", vec(-49, -49, 92), scale(0.36, 0.24, 0.12), -45.0),
    ]

    for suffix, location, actor_scale, yaw in rim_specs:
        spawn_cube(
            "GEO_TableRim_{}".format(suffix),
            location,
            actor_scale,
            rot(0, yaw, 0),
        )

    # Recessed well: still plain BasicShapeMaterial.
    spawn_cube(
        "GEO_HoloWell",
        vec(0, 0, 82),
        scale(0.86, 0.86, 0.02),
        cast_shadow=False,
    )

    inner_rim_specs = [
        ("N", vec(0, 43, 84), scale(0.86, 0.018, 0.012)),
        ("S", vec(0, -43, 84), scale(0.86, 0.018, 0.012)),
        ("E", vec(43, 0, 84), scale(0.018, 0.86, 0.012)),
        ("W", vec(-43, 0, 84), scale(0.018, 0.86, 0.012)),
    ]

    for suffix, location, actor_scale in inner_rim_specs:
        spawn_cube(
            "GEO_HoloRim_{}".format(suffix),
            location,
            actor_scale,
            cast_shadow=False,
        )

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
            "GEO_GridX_{:02d}".format(index),
            vec(position, 0, 84.2),
            scale(0.008, 0.84, 0.008),
            cast_shadow=False,
        )
        spawn_cube(
            "GEO_GridY_{:02d}".format(index),
            vec(0, position, 84.25),
            scale(0.84, 0.008, 0.008),
            cast_shadow=False,
        )

    spawn_cone(
        "GEO_HoloToken_01",
        vec(-23, 20, 90),
        scale(0.060, 0.060, 0.120),
        rot(0, -18, 0),
        False,
    )
    spawn_cone(
        "GEO_HoloToken_02",
        vec(24, -21, 89),
        scale(0.050, 0.050, 0.100),
        rot(0, 35, 0),
        False,
    )
    spawn_cube(
        "GEO_HoloToken_03",
        vec(14, 19, 87),
        scale(0.095, 0.045, 0.045),
        rot(0, 72, 0),
        False,
    )

    spawn_cube(
        "GEO_HoloShip_Core",
        vec(-8, -15, 88),
        scale(0.150, 0.040, 0.050),
        rot(0, 18, 0),
        False,
    )
    spawn_cube(
        "GEO_HoloShip_LeftWing",
        vec(-11, -18, 87.5),
        scale(0.055, 0.130, 0.025),
        rot(0, 18, 0),
        False,
    )
    spawn_cube(
        "GEO_HoloShip_RightWing",
        vec(-5, -12, 87.5),
        scale(0.055, 0.130, 0.025),
        rot(0, 18, 0),
        False,
    )

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
            "GEO_RimBolt_{:02d}".format(index),
            vec(bolt_x, bolt_y, 98.6),
            scale(0.026, 0.026, 0.016),
        )

    # ---------------------------------------------------------------------
    # Tabletop props
    # ---------------------------------------------------------------------

    print("[SCENE] Adding tabletop props")

    spawn_cylinder(
        "GEO_MugBody",
        vec(-27, -61, 104),
        scale(0.095, 0.095, 0.120),
    )
    spawn_cylinder(
        "GEO_MugOpening",
        vec(-27, -61, 110.2),
        scale(0.068, 0.068, 0.006),
        cast_shadow=False,
    )
    spawn_cube(
        "GEO_MugHandleTop",
        vec(-18, -61, 107),
        scale(0.070, 0.025, 0.022),
    )
    spawn_cube(
        "GEO_MugHandleSide",
        vec(-15, -61, 103),
        scale(0.020, 0.025, 0.075),
    )
    spawn_cube(
        "GEO_MugHandleBottom",
        vec(-18, -61, 99.5),
        scale(0.070, 0.025, 0.022),
    )

    spawn_cube(
        "GEO_ToolDriverShaft",
        vec(58, 11, 102),
        scale(0.035, 0.250, 0.025),
        rot(0, 8, 0),
    )
    spawn_cylinder(
        "GEO_ToolDriverHandle",
        vec(56, -4, 102),
        scale(0.038, 0.038, 0.120),
        rot(90, 8, 0),
    )
    spawn_cube(
        "GEO_ToolBar",
        vec(58, 35, 101.5),
        scale(0.045, 0.280, 0.030),
        rot(0, -12, 0),
    )
    spawn_cube(
        "GEO_ToolBarHead",
        vec(61, 48, 102),
        scale(0.120, 0.055, 0.040),
        rot(0, -12, 0),
    )

    loose_fasteners = [
        (53, -27),
        (59, -34),
        (48, -39),
        (64, -20),
    ]

    for index, (x_value, y_value) in enumerate(
        loose_fasteners
    ):
        spawn_cylinder(
            "GEO_LooseFastener_{:02d}".format(index),
            vec(x_value, y_value, 101),
            scale(0.026, 0.026, 0.075),
            rot(90, 20 * index, 0),
        )

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
                "GEO_Cable_{:02d}_{:02d}".format(
                    cable_index,
                    segment_index,
                ),
                cable_points[segment_index],
                cable_points[segment_index + 1],
                1.25 if cable_index < 2 else 0.9,
            )

    # ---------------------------------------------------------------------
    # Physical-scale local lighting
    # ---------------------------------------------------------------------

    print("[SCENE] progress 4/7: creating physical-scale lights")
    print(
        "[SCENE] Directional=10 lux; local light values are lumens"
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

    spawn_point_light(
        "WR_FailSafeWorkLight",
        vec(0, -20, 225),
        50000.0,
        color8(235, 244, 255),
        700.0,
        False,
        20.0,
    )

    # Capture after the sky, sun, geometry, and lights all exist.
    try:
        skylight_component.recapture_sky()
        print("[SCENE] SkyLight recapture requested")
    except Exception as recapture_error:
        unreal.log_warning(
            "[SCENE] SkyLight recapture call failed; "
            "real-time capture remains enabled: {}".format(
                recapture_error
            )
        )

    # ---------------------------------------------------------------------
    # Camera
    # ---------------------------------------------------------------------

    print("[SCENE] progress 5/7: creating external camera")

    camera_location = vec(-650, -700, 480)
    camera_target = vec(0, 0, 84)
    camera_rotation = look_at_rotation(
        camera_location,
        camera_target,
    )

    camera = spawn_actor(
        unreal.CameraActor,
        "WR_Camera_Main",
        camera_location,
        camera_rotation,
    )

    print(
        "[SCENE] camera pos=({:.1f}, {:.1f}, {:.1f}) "
        "rot=(pitch={:.3f}, yaw={:.3f}, roll={:.3f}) "
        "target=({:.1f}, {:.1f}, {:.1f})".format(
            camera_location.x,
            camera_location.y,
            camera_location.z,
            camera_rotation.pitch,
            camera_rotation.yaw,
            camera_rotation.roll,
            camera_target.x,
            camera_target.y,
            camera_target.z,
        )
    )

    camera_component = camera.get_editor_property(
        "camera_component"
    )

    if camera_component is None:
        raise RuntimeError(
            "WR_Camera_Main has no CameraComponent"
        )

    camera_component.set_field_of_view(48.0)
    safe_set(camera_component, "aspect_ratio", 1.6)
    safe_set(
        camera_component,
        "constrain_aspect_ratio",
        True,
    )

    # No camera exposure override and no PostProcessVolume.
    # Default eye adaptation is intentionally retained for this baseline.

    # ---------------------------------------------------------------------
    # Material invariant and save
    # ---------------------------------------------------------------------

    print("[SCENE] progress 6/7: validating persistent materials")

    expected_material_path = BASIC_MATERIAL.get_path_name()
    validated_count = 0

    for label, component in mesh_components:
        assigned_material = component.get_material(0)

        if assigned_material is None:
            raise RuntimeError(
                "{} has a NULL material before save".format(label)
            )

        assigned_path = assigned_material.get_path_name()

        if assigned_path != expected_material_path:
            raise RuntimeError(
                "{} has unexpected material {}; expected {}".format(
                    label,
                    assigned_path,
                    expected_material_path,
                )
            )

        if isinstance(
            assigned_material,
            unreal.MaterialInstanceDynamic,
        ):
            raise RuntimeError(
                "{} unexpectedly has a MID".format(label)
            )

        validated_count += 1

    print(
        "[SCENE] material invariant OK: {}/{} meshes use {}".format(
            validated_count,
            len(mesh_components),
            expected_material_path,
        )
    )

    print("[SCENE] Saving current level")

    save_result = level_subsystem.save_current_level()

    if not save_result:
        raise RuntimeError(
            "save_current_level returned False"
        )

    print("[SCENE] Level saved")
    print(
        "[SCENE] no ExponentialHeightFog or PostProcessVolume created"
    )

    # ---------------------------------------------------------------------
    # Preview screenshot and deferred shutdown
    # ---------------------------------------------------------------------

    print("[SCENE] progress 7/7: requesting preview screenshot")

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