# tools/ue/warroom_render.py
import glob
import os
import struct
import time
import traceback
import zlib

import unreal


# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

LEVEL_PATH = "/Game/Maps/WarRoom"
CAMERA_LABEL = "WR_Camera_Main"

SEQUENCE_DIRECTORY = "/Game/__Generated"
SEQUENCE_NAME = "WarRoom_MRQ_OneFrame"
SEQUENCE_ASSET_PATH = "{}/{}".format(
    SEQUENCE_DIRECTORY,
    SEQUENCE_NAME,
)

SCREENSHOT_STEM = "warroom_ue"
SCREENSHOT_WIDTH = 1280
SCREENSHOT_HEIGHT = 800

FRAME_RATE = 24
ENGINE_WARM_UP_FRAMES = 32
RENDER_WARM_UP_FRAMES = 16

RENDER_TIMEOUT_SECONDS = 15 * 60
PROGRESS_INTERVAL_SECONDS = 30

OUTPUT_DIRECTORY = os.path.normpath(
    os.path.abspath(
        os.path.join(
            unreal.Paths.project_saved_dir(),
            "Screenshots",
            "WindowsEditor",
        )
    )
)

EXPECTED_OUTPUT_PATH = os.path.join(
    OUTPUT_DIRECTORY,
    SCREENSHOT_STEM + ".png",
)


# -----------------------------------------------------------------------------
# References that must remain alive until the asynchronous render completes
# -----------------------------------------------------------------------------

_ASYNC_ACTIVE = False
_DONE = False
_TICK_HANDLE = None
_EXECUTOR = None
_QUEUE_SUBSYSTEM = None
_SEQUENCE = None
_MID_REFS = []

_RENDER_START_MONOTONIC = 0.0
_NEXT_PROGRESS_TIME = float(PROGRESS_INTERVAL_SECONDS)


# -----------------------------------------------------------------------------
# General helpers
# -----------------------------------------------------------------------------

def _safe_set(obj, property_name, value):
    try:
        obj.set_editor_property(property_name, value)
        return True
    except Exception:
        return False


def _required_set(obj, property_name, value):
    try:
        obj.set_editor_property(property_name, value)
    except Exception as error:
        raise RuntimeError(
            "Could not set {}.{}: {}".format(
                obj.get_class().get_name(),
                property_name,
                error,
            )
        )


def _require_unreal_types(type_names):
    missing = [
        type_name
        for type_name in type_names
        if not hasattr(unreal, type_name)
    ]

    if missing:
        raise RuntimeError(
            "Required Unreal Python types are unavailable: {}. "
            "Enable the Movie Render Queue/Movie Render Pipeline and "
            "Sequencer Scripting plugins, restart Unreal Editor, and retry."
            .format(", ".join(missing))
        )


def _get_actor_label(actor):
    try:
        return actor.get_actor_label()
    except Exception:
        return actor.get_name()


def _find_actor_by_label(actor_subsystem, wanted_label):
    matches = []

    for actor in actor_subsystem.get_all_level_actors():
        if _get_actor_label(actor) == wanted_label:
            matches.append(actor)

    if not matches:
        raise RuntimeError(
            "Actor with label {!r} was not found in {}".format(
                wanted_label,
                LEVEL_PATH,
            )
        )

    if len(matches) > 1:
        raise RuntimeError(
            "Multiple actors have label {!r}".format(wanted_label)
        )

    return matches[0]


def _get_static_mesh_component(actor):
    try:
        component = actor.get_component_by_class(
            unreal.StaticMeshComponent
        )
        if component is not None:
            return component
    except Exception:
        pass

    try:
        component = actor.get_editor_property("static_mesh_component")
        if component is not None:
            return component
    except Exception:
        pass

    return None


# -----------------------------------------------------------------------------
# Dynamic-material reconstruction
#
# warroom_scene.py creates MIDs after saving the level. Those instances are not
# persistent across editor processes, so this renderer reconstructs them before
# PIE duplicates the editor world for MRQ.
# -----------------------------------------------------------------------------

def _linear_color(r, g, b, a=1.0):
    return unreal.LinearColor(
        float(r),
        float(g),
        float(b),
        float(a),
    )


STYLE_VALUES = {
    "floor": (
        _linear_color(0.012, 0.016, 0.020),
        0.90,
    ),
    "wall": (
        _linear_color(0.018, 0.025, 0.031),
        0.82,
    ),
    "metal_dark": (
        _linear_color(0.020, 0.027, 0.032),
        0.72,
    ),
    "metal": (
        _linear_color(0.055, 0.065, 0.070),
        0.60,
    ),
    "metal_edge": (
        _linear_color(0.115, 0.075, 0.028),
        0.70,
    ),
    "well": (
        _linear_color(0.002, 0.025, 0.035),
        0.35,
    ),
    "cyan": (
        _linear_color(0.000, 0.720, 1.000),
        0.20,
    ),
    "cyan_dim": (
        _linear_color(0.000, 0.190, 0.260),
        0.35,
    ),
    "amber": (
        _linear_color(1.000, 0.240, 0.018),
        0.28,
    ),
    "mug": (
        _linear_color(0.090, 0.105, 0.100),
        0.78,
    ),
    "tool": (
        _linear_color(0.120, 0.135, 0.140),
        0.45,
    ),
    "rubber": (
        _linear_color(0.010, 0.012, 0.014),
        0.96,
    ),
}


def _style_for_actor_label(label):
    if label == "WR_Floor":
        return "floor"

    if label.startswith("WR_WallPanel_"):
        return "wall"

    if label.startswith("WR_WallRib_"):
        return "metal_edge"

    if label.startswith("WR_WallPipe_"):
        return "metal_dark"

    if label.startswith("WR_BackConsole_"):
        return "metal"

    if (
        label.startswith("WR_AmberPractical_")
        or label.startswith("WR_HoloToken_Amber_")
        or label == "WR_ToolDriverHandle"
    ):
        return "amber"

    if (
        label == "WR_TableBase"
        or label == "WR_WellSupport"
        or label.startswith("WR_TableApron_")
    ):
        return "metal_dark"

    if (
        label == "WR_TableBaseLower"
        or label.startswith("WR_TableRim_")
    ):
        return "metal_edge"

    if label == "WR_HoloWell":
        return "well"

    if (
        label.startswith("WR_HoloRim_")
        or label.startswith("WR_GridX_")
        or label.startswith("WR_GridY_")
        or label.startswith("WR_HoloToken_Cyan_")
        or label == "WR_HoloShip_Core"
    ):
        return "cyan"

    if (
        label == "WR_HoloShip_LeftWing"
        or label == "WR_HoloShip_RightWing"
    ):
        return "cyan_dim"

    if (
        label.startswith("WR_MugBody")
        or label.startswith("WR_MugHandle")
    ):
        return "mug"

    if (
        label == "WR_MugOpening"
        or label.startswith("WR_Cable_")
    ):
        return "rubber"

    if (
        label.startswith("WR_RimBolt_")
        or label.startswith("WR_ToolDriverShaft")
        or label.startswith("WR_ToolBar")
        or label.startswith("WR_LooseFastener_")
    ):
        return "tool"

    return "metal"


def _apply_dynamic_materials(actor_subsystem):
    global _MID_REFS

    basic_material = unreal.EditorAssetLibrary.load_asset(
        "/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"
    )

    if basic_material is None:
        raise RuntimeError(
            "Could not load /Engine/BasicShapes/BasicShapeMaterial"
        )

    _MID_REFS = []
    created = 0
    failed_labels = []

    for actor in actor_subsystem.get_all_level_actors():
        label = _get_actor_label(actor)

        if not label.startswith("WR_"):
            continue

        component = _get_static_mesh_component(actor)
        if component is None:
            continue

        style_name = _style_for_actor_label(label)
        tint, roughness = STYLE_VALUES[style_name]

        try:
            mid = component.create_dynamic_material_instance(
                0,
                basic_material,
            )

            if mid is None:
                mid = unreal.MaterialInstanceDynamic.create(
                    basic_material,
                    component,
                )

                if mid is not None:
                    component.set_material(0, mid)

            if mid is None:
                failed_labels.append(label)
                continue

            mid.set_vector_parameter_value("Color", tint)
            mid.set_scalar_parameter_value("Roughness", roughness)

            _MID_REFS.append(mid)
            created += 1

        except Exception:
            failed_labels.append(label)
            unreal.log_warning(
                "[SCENE] MID reconstruction failed for {}".format(label)
            )

    if created == 0:
        raise RuntimeError(
            "No dynamic materials were reconstructed; "
            "the WarRoom mesh actors may be missing"
        )

    print("[SCENE] Dynamic materials reapplied: {}".format(created))

    if failed_labels:
        print(
            "[SCENE] WARNING: MID failed on {} actor(s): {}".format(
                len(failed_labels),
                ", ".join(failed_labels),
            )
        )


# -----------------------------------------------------------------------------
# Level Sequence creation
# -----------------------------------------------------------------------------

def _make_binding_id(sequence, binding):
    try:
        return sequence.get_binding_id(binding)
    except Exception:
        binding_id = unreal.MovieSceneObjectBindingID()
        binding_id.set_editor_property(
            "guid",
            binding.get_id(),
        )
        return binding_id


def _create_one_frame_sequence(camera):
    if unreal.EditorAssetLibrary.does_asset_exist(
        SEQUENCE_ASSET_PATH
    ):
        print(
            "[SCENE] Replacing generated sequence {}".format(
                SEQUENCE_ASSET_PATH
            )
        )

        if not unreal.EditorAssetLibrary.delete_asset(
            SEQUENCE_ASSET_PATH
        ):
            raise RuntimeError(
                "Could not replace generated sequence asset: {}".format(
                    SEQUENCE_ASSET_PATH
                )
            )

    unreal.EditorAssetLibrary.make_directory(
        SEQUENCE_DIRECTORY
    )

    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    factory = unreal.LevelSequenceFactoryNew()

    sequence = asset_tools.create_asset(
        SEQUENCE_NAME,
        SEQUENCE_DIRECTORY,
        unreal.LevelSequence,
        factory,
    )

    if sequence is None:
        raise RuntimeError(
            "Failed to create {}".format(SEQUENCE_ASSET_PATH)
        )

    sequence.set_display_rate(
        unreal.FrameRate(
            numerator=FRAME_RATE,
            denominator=1,
        )
    )
    sequence.set_playback_start(0)
    sequence.set_playback_end(1)

    # A possessable is intentional here. The camera is stored in the persistent
    # WarRoom map and receives a stable binding which resolves in the PIE copy.
    camera_binding = sequence.add_possessable(camera)

    if camera_binding is None:
        raise RuntimeError(
            "Failed to add camera possessable to Level Sequence"
        )

    try:
        camera_cut_track = sequence.add_track(
            unreal.MovieSceneCameraCutTrack
        )
    except Exception:
        # Compatibility fallback for older UE5 Python bindings.
        camera_cut_track = sequence.add_master_track(
            unreal.MovieSceneCameraCutTrack
        )

    if camera_cut_track is None:
        raise RuntimeError(
            "Failed to create MovieSceneCameraCutTrack"
        )

    camera_cut_section = camera_cut_track.add_section()

    if camera_cut_section is None:
        raise RuntimeError(
            "Failed to create camera-cut section"
        )

    camera_cut_section.set_range(0, 1)
    camera_cut_section.set_camera_binding_id(
        _make_binding_id(sequence, camera_binding)
    )

    saved = unreal.EditorAssetLibrary.save_loaded_asset(
        sequence,
        False,
    )

    if not saved:
        raise RuntimeError(
            "Failed to save {}".format(SEQUENCE_ASSET_PATH)
        )

    print(
        "[SCENE] One-frame camera-cut sequence saved: {}".format(
            sequence.get_path_name()
        )
    )

    return sequence


# -----------------------------------------------------------------------------
# MRQ output and validation
# -----------------------------------------------------------------------------

def _remove_previous_outputs():
    os.makedirs(OUTPUT_DIRECTORY, exist_ok=True)

    pattern = os.path.join(
        OUTPUT_DIRECTORY,
        "**",
        SCREENSHOT_STEM + "*.png",
    )

    removed = 0

    for path in glob.glob(pattern, recursive=True):
        if not os.path.isfile(path):
            continue

        basename = os.path.basename(path)

        if not basename.startswith(SCREENSHOT_STEM):
            continue

        os.remove(path)
        removed += 1

    if removed:
        print(
            "[SCENE] Removed {} previous screenshot(s)".format(
                removed
            )
        )


def _configure_mrq_job(sequence):
    global _QUEUE_SUBSYSTEM

    _QUEUE_SUBSYSTEM = unreal.get_editor_subsystem(
        unreal.MoviePipelineQueueSubsystem
    )

    if _QUEUE_SUBSYSTEM is None:
        raise RuntimeError(
            "MoviePipelineQueueSubsystem is unavailable"
        )

    queue = _QUEUE_SUBSYSTEM.get_queue()

    if queue is None:
        raise RuntimeError("MRQ queue is unavailable")

    queue.delete_all_jobs()

    job = queue.allocate_new_job(
        unreal.MoviePipelineExecutorJob
    )

    if job is None:
        raise RuntimeError("Could not allocate MRQ job")

    level_asset_name = LEVEL_PATH.rsplit("/", 1)[-1]
    level_object_path = "{}.{}".format(
        LEVEL_PATH,
        level_asset_name,
    )

    _required_set(job, "job_name", "WarRoom PNG")
    _required_set(
        job,
        "map",
        unreal.SoftObjectPath(level_object_path),
    )
    _required_set(
        job,
        "sequence",
        unreal.SoftObjectPath(sequence.get_path_name()),
    )

    config = job.get_configuration()

    if config is None:
        raise RuntimeError("MRQ job configuration is unavailable")

    output_setting = config.find_or_add_setting_by_class(
        unreal.MoviePipelineOutputSetting
    )
    deferred_pass = config.find_or_add_setting_by_class(
        unreal.MoviePipelineDeferredPassBase
    )
    png_output = config.find_or_add_setting_by_class(
        unreal.MoviePipelineImageSequenceOutput_PNG
    )
    anti_aliasing = config.find_or_add_setting_by_class(
        unreal.MoviePipelineAntiAliasingSetting
    )

    if output_setting is None:
        raise RuntimeError("Could not create MRQ output setting")

    if deferred_pass is None:
        raise RuntimeError("Could not create deferred-render pass")

    if png_output is None:
        raise RuntimeError("Could not create PNG output setting")

    if anti_aliasing is None:
        raise RuntimeError("Could not create anti-aliasing setting")

    for setting in (
        output_setting,
        deferred_pass,
        png_output,
        anti_aliasing,
    ):
        try:
            setting.set_is_enabled(True)
        except Exception:
            pass

    _required_set(
        output_setting,
        "output_directory",
        unreal.DirectoryPath(OUTPUT_DIRECTORY),
    )
    _required_set(
        output_setting,
        "file_name_format",
        SCREENSHOT_STEM,
    )
    _required_set(
        output_setting,
        "output_resolution",
        unreal.IntPoint(
            x=SCREENSHOT_WIDTH,
            y=SCREENSHOT_HEIGHT,
        ),
    )
    _required_set(
        output_setting,
        "override_existing_output",
        True,
    )
    _required_set(
        output_setting,
        "flush_disk_writes_per_shot",
        True,
    )
    _required_set(
        output_setting,
        "use_custom_playback_range",
        True,
    )
    _required_set(
        output_setting,
        "custom_start_frame",
        0,
    )
    _required_set(
        output_setting,
        "custom_end_frame",
        1,
    )
    _required_set(
        output_setting,
        "use_custom_frame_rate",
        True,
    )
    _required_set(
        output_setting,
        "output_frame_rate",
        unreal.FrameRate(
            numerator=FRAME_RATE,
            denominator=1,
        ),
    )
    _required_set(
        output_setting,
        "output_frame_step",
        1,
    )
    _required_set(
        output_setting,
        "handle_frame_count",
        0,
    )
    _required_set(
        output_setting,
        "auto_version",
        False,
    )
    _required_set(
        output_setting,
        "version_number",
        1,
    )
    _required_set(
        output_setting,
        "zero_pad_frame_numbers",
        4,
    )

    _required_set(
        anti_aliasing,
        "engine_warm_up_count",
        ENGINE_WARM_UP_FRAMES,
    )
    _required_set(
        anti_aliasing,
        "render_warm_up_count",
        RENDER_WARM_UP_FRAMES,
    )
    _required_set(
        anti_aliasing,
        "render_warm_up_frames",
        True,
    )
    _required_set(
        anti_aliasing,
        "use_camera_cut_for_warm_up",
        False,
    )
    _required_set(
        anti_aliasing,
        "spatial_sample_count",
        1,
    )
    _required_set(
        anti_aliasing,
        "temporal_sample_count",
        1,
    )

    print(
        "[SCENE] MRQ configured: {}x{}, frame 0 only".format(
            SCREENSHOT_WIDTH,
            SCREENSHOT_HEIGHT,
        )
    )
    print(
        "[SCENE] Render output requested: {}".format(
            EXPECTED_OUTPUT_PATH
        )
    )

    return queue


def _paeth_predictor(a, b, c):
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)

    if pa <= pb and pa <= pc:
        return a

    if pb <= pc:
        return b

    return c


def _verify_png_is_not_black(path):
    with open(path, "rb") as png_file:
        data = png_file.read()

    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError(
            "Output is not a valid PNG: {}".format(path)
        )

    position = 8
    width = None
    height = None
    bit_depth = None
    color_type = None
    interlace_method = None
    idat_chunks = []

    while position + 12 <= len(data):
        chunk_length = struct.unpack(
            ">I",
            data[position:position + 4],
        )[0]

        chunk_type = data[position + 4:position + 8]
        chunk_start = position + 8
        chunk_end = chunk_start + chunk_length

        if chunk_end + 4 > len(data):
            raise RuntimeError("PNG contains a truncated chunk")

        chunk_data = data[chunk_start:chunk_end]

        if chunk_type == b"IHDR":
            (
                width,
                height,
                bit_depth,
                color_type,
                compression_method,
                filter_method,
                interlace_method,
            ) = struct.unpack(">IIBBBBB", chunk_data)

            if compression_method != 0 or filter_method != 0:
                raise RuntimeError(
                    "Unsupported PNG compression/filter method"
                )

        elif chunk_type == b"IDAT":
            idat_chunks.append(chunk_data)

        elif chunk_type == b"IEND":
            break

        position = chunk_end + 4

    if width is None or height is None:
        raise RuntimeError("PNG has no IHDR chunk")

    if width != SCREENSHOT_WIDTH or height != SCREENSHOT_HEIGHT:
        raise RuntimeError(
            "Unexpected PNG size: {}x{}; expected {}x{}".format(
                width,
                height,
                SCREENSHOT_WIDTH,
                SCREENSHOT_HEIGHT,
            )
        )

    if bit_depth != 8:
        raise RuntimeError(
            "Unexpected PNG bit depth {}; expected 8".format(
                bit_depth
            )
        )

    if interlace_method != 0:
        raise RuntimeError(
            "Interlaced PNG validation is not supported"
        )

    channels_by_color_type = {
        0: 1,  # Grayscale
        2: 3,  # RGB
        4: 2,  # Grayscale + alpha
        6: 4,  # RGBA
    }

    if color_type not in channels_by_color_type:
        raise RuntimeError(
            "Unsupported PNG color type {}".format(color_type)
        )

    channels = channels_by_color_type[color_type]
    bytes_per_pixel = channels
    row_bytes = width * channels

    try:
        raw = zlib.decompress(b"".join(idat_chunks))
    except Exception as error:
        raise RuntimeError(
            "Could not decompress PNG data: {}".format(error)
        )

    expected_raw_size = height * (row_bytes + 1)

    if len(raw) != expected_raw_size:
        raise RuntimeError(
            "Unexpected decompressed PNG size: {} bytes; expected {}"
            .format(len(raw), expected_raw_size)
        )

    previous_row = bytearray(row_bytes)
    raw_position = 0
    nonblack_pixels = 0
    brightness_threshold = 3

    for _row_index in range(height):
        filter_type = raw[raw_position]
        raw_position += 1

        filtered_row = raw[
            raw_position:raw_position + row_bytes
        ]
        raw_position += row_bytes

        reconstructed = bytearray(row_bytes)

        for byte_index in range(row_bytes):
            source_value = filtered_row[byte_index]

            left = (
                reconstructed[byte_index - bytes_per_pixel]
                if byte_index >= bytes_per_pixel
                else 0
            )
            up = previous_row[byte_index]
            up_left = (
                previous_row[byte_index - bytes_per_pixel]
                if byte_index >= bytes_per_pixel
                else 0
            )

            if filter_type == 0:
                predicted = 0
            elif filter_type == 1:
                predicted = left
            elif filter_type == 2:
                predicted = up
            elif filter_type == 3:
                predicted = (left + up) // 2
            elif filter_type == 4:
                predicted = _paeth_predictor(
                    left,
                    up,
                    up_left,
                )
            else:
                raise RuntimeError(
                    "Unsupported PNG row filter {}".format(
                        filter_type
                    )
                )

            reconstructed[byte_index] = (
                source_value + predicted
            ) & 0xFF

        if color_type == 0:
            for index in range(0, row_bytes, 1):
                if reconstructed[index] > brightness_threshold:
                    nonblack_pixels += 1

        elif color_type == 2:
            for index in range(0, row_bytes, 3):
                if (
                    reconstructed[index] > brightness_threshold
                    or reconstructed[index + 1] > brightness_threshold
                    or reconstructed[index + 2] > brightness_threshold
                ):
                    nonblack_pixels += 1

        elif color_type == 4:
            for index in range(0, row_bytes, 2):
                if (
                    reconstructed[index] > brightness_threshold
                    and reconstructed[index + 1] > 0
                ):
                    nonblack_pixels += 1

        elif color_type == 6:
            for index in range(0, row_bytes, 4):
                if (
                    reconstructed[index + 3] > 0
                    and (
                        reconstructed[index] > brightness_threshold
                        or reconstructed[index + 1] > brightness_threshold
                        or reconstructed[index + 2] > brightness_threshold
                    )
                ):
                    nonblack_pixels += 1

        previous_row = reconstructed

    # Require at least 0.01% visibly non-black pixels. This rejects a fully
    # cleared/black render while allowing deliberately dark cinematography.
    minimum_nonblack_pixels = max(
        64,
        (width * height) // 10000,
    )

    if nonblack_pixels < minimum_nonblack_pixels:
        raise RuntimeError(
            "PNG validation failed: only {} non-black pixels; "
            "the image is effectively black".format(nonblack_pixels)
        )

    return width, height, nonblack_pixels


def _locate_and_normalize_output():
    pattern = os.path.join(
        OUTPUT_DIRECTORY,
        "**",
        SCREENSHOT_STEM + "*.png",
    )

    candidates = [
        path
        for path in glob.glob(pattern, recursive=True)
        if os.path.isfile(path)
    ]

    if not candidates:
        raise RuntimeError(
            "MRQ reported success but no PNG matching {} was found under {}"
            .format(
                SCREENSHOT_STEM + "*.png",
                OUTPUT_DIRECTORY,
            )
        )

    candidates.sort(
        key=lambda path: os.path.getmtime(path),
        reverse=True,
    )

    rendered_path = candidates[0]

    # Some UE versions append a frame number even when file_name_format omits
    # {frame_number}. Normalize the single generated frame to the requested
    # stable filename.
    if os.path.normcase(os.path.abspath(rendered_path)) != os.path.normcase(
        os.path.abspath(EXPECTED_OUTPUT_PATH)
    ):
        if os.path.exists(EXPECTED_OUTPUT_PATH):
            os.remove(EXPECTED_OUTPUT_PATH)

        os.replace(rendered_path, EXPECTED_OUTPUT_PATH)
        rendered_path = EXPECTED_OUTPUT_PATH

    return rendered_path


# -----------------------------------------------------------------------------
# Async lifecycle
# -----------------------------------------------------------------------------

def _unregister_tick_callback():
    global _TICK_HANDLE

    if _TICK_HANDLE is None:
        return

    try:
        unreal.unregister_slate_post_tick_callback(
            _TICK_HANDLE
        )
    except Exception:
        pass

    _TICK_HANDLE = None


def _cancel_executor():
    if _EXECUTOR is None:
        return

    try:
        if _EXECUTOR.is_rendering():
            _EXECUTOR.cancel_all_jobs()
    except Exception:
        try:
            _EXECUTOR.cancel_all_jobs()
        except Exception:
            pass


def _finish_and_quit(success):
    global _ASYNC_ACTIVE
    global _DONE

    if _DONE:
        return

    _DONE = True
    _ASYNC_ACTIVE = False

    try:
        _unregister_tick_callback()

        if not success:
            _cancel_executor()

        if success:
            print("RENDER_OK")

    finally:
        unreal.SystemLibrary.quit_editor()


def _on_executor_error(
    executor,
    errored_pipeline,
    is_fatal,
    error_text,
):
    print(
        "[SCENE] MRQ {}: {}".format(
            "FATAL ERROR" if is_fatal else "warning",
            str(error_text),
        )
    )

    if is_fatal:
        _finish_and_quit(False)


def _on_executor_finished(executor, success):
    if _DONE:
        return

    if not success:
        print("[SCENE] ERROR: MRQ executor completed unsuccessfully")
        _finish_and_quit(False)
        return

    print("[SCENE] MRQ finished; validating PNG")

    try:
        rendered_path = _locate_and_normalize_output()

        (
            verified_width,
            verified_height,
            nonblack_pixels,
        ) = _verify_png_is_not_black(rendered_path)

        file_size = os.path.getsize(rendered_path)

        print(
            "[SCENE] PNG validated: {}x{}, {} bytes, "
            "{} non-black pixels".format(
                verified_width,
                verified_height,
                file_size,
                nonblack_pixels,
            )
        )
        print("[SCENE] Screenshot path: {}".format(rendered_path))

        _finish_and_quit(True)

    except BaseException:
        print("[SCENE] ERROR during PNG validation")
        traceback.print_exc()
        _finish_and_quit(False)


def _on_slate_post_tick(delta_seconds):
    global _NEXT_PROGRESS_TIME

    if _DONE or not _ASYNC_ACTIVE:
        return

    try:
        elapsed = time.monotonic() - _RENDER_START_MONOTONIC

        if elapsed >= _NEXT_PROGRESS_TIME:
            print(
                "[SCENE] MRQ rendering: {:.0f}s elapsed".format(
                    elapsed
                )
            )

            while elapsed >= _NEXT_PROGRESS_TIME:
                _NEXT_PROGRESS_TIME += PROGRESS_INTERVAL_SECONDS

        if elapsed >= RENDER_TIMEOUT_SECONDS:
            print(
                "[SCENE] ERROR: MRQ timed out after {:.0f}s".format(
                    elapsed
                )
            )
            _finish_and_quit(False)

    except BaseException:
        print("[SCENE] ERROR in MRQ watchdog")
        traceback.print_exc()
        _finish_and_quit(False)


def _bind_delegate(delegate, callback):
    try:
        delegate.add_callable_unique(callback)
        return
    except Exception:
        pass

    try:
        delegate.add_callable(callback)
        return
    except Exception as error:
        raise RuntimeError(
            "Could not bind MRQ delegate: {}".format(error)
        )


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

try:
    print("[SCENE] WarRoom MRQ render started")
    print("[SCENE] Loading {}".format(LEVEL_PATH))

    _require_unreal_types(
        [
            "LevelSequence",
            "LevelSequenceFactoryNew",
            "MovieSceneCameraCutTrack",
            "MovieSceneObjectBindingID",
            "MoviePipelineQueueSubsystem",
            "MoviePipelineExecutorJob",
            "MoviePipelinePIEExecutor",
            "MoviePipelineOutputSetting",
            "MoviePipelineDeferredPassBase",
            "MoviePipelineImageSequenceOutput_PNG",
            "MoviePipelineAntiAliasingSetting",
        ]
    )

    level_subsystem = unreal.get_editor_subsystem(
        unreal.LevelEditorSubsystem
    )
    actor_subsystem = unreal.get_editor_subsystem(
        unreal.EditorActorSubsystem
    )

    if level_subsystem is None:
        raise RuntimeError(
            "LevelEditorSubsystem is unavailable"
        )

    if actor_subsystem is None:
        raise RuntimeError(
            "EditorActorSubsystem is unavailable"
        )

    level_subsystem.load_level(LEVEL_PATH)

    camera = _find_actor_by_label(
        actor_subsystem,
        CAMERA_LABEL,
    )

    print(
        "[SCENE] Camera found: {}".format(
            _get_actor_label(camera)
        )
    )

    camera_component = camera.get_component_by_class(
        unreal.CameraComponent
    )

    if camera_component is None:
        raise RuntimeError(
            "{} has no CameraComponent".format(CAMERA_LABEL)
        )

    _safe_set(camera_component, "aspect_ratio", 1.6)
    _safe_set(camera_component, "constrain_aspect_ratio", True)

    _apply_dynamic_materials(actor_subsystem)

    _SEQUENCE = _create_one_frame_sequence(camera)

    _remove_previous_outputs()
    _configure_mrq_job(_SEQUENCE)

    _EXECUTOR = unreal.MoviePipelinePIEExecutor()

    if _EXECUTOR is None:
        raise RuntimeError(
            "Could not construct MoviePipelinePIEExecutor"
        )

    _bind_delegate(
        _EXECUTOR.on_executor_finished_delegate,
        _on_executor_finished,
    )
    _bind_delegate(
        _EXECUTOR.on_executor_errored_delegate,
        _on_executor_error,
    )

    _TICK_HANDLE = unreal.register_slate_post_tick_callback(
        _on_slate_post_tick
    )

    _RENDER_START_MONOTONIC = time.monotonic()
    _NEXT_PROGRESS_TIME = float(PROGRESS_INTERVAL_SECONDS)
    _ASYNC_ACTIVE = True

    print(
        "[SCENE] Starting MoviePipelinePIEExecutor "
        "with {} engine + {} render warm-up frames".format(
            ENGINE_WARM_UP_FRAMES,
            RENDER_WARM_UP_FRAMES,
        )
    )

    _QUEUE_SUBSYSTEM.render_queue_with_executor_instance(
        _EXECUTOR
    )

    print("[SCENE] MRQ job submitted")

except BaseException:
    _ASYNC_ACTIVE = False
    print("[SCENE] ERROR")
    traceback.print_exc()

finally:
    # Once MRQ has been submitted, its callbacks own shutdown. Any failure
    # before asynchronous ownership begins exits here.
    if not _ASYNC_ACTIVE and not _DONE:
        try:
            _unregister_tick_callback()
            _cancel_executor()
        finally:
            unreal.SystemLibrary.quit_editor()