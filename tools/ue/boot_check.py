# UE5 headless boot check — Blender式パイプラインのUE版・疎通確認
# usage: UnrealEditor-Cmd.exe <project> -ExecCmds="py this_file" -stdout -unattended -nosplash -nullrhi
# 教訓: ①-run=pythonscript(コマンドレット)はエディタ文脈不在でspawn時にネイティブクラッシュ→ExecCmds方式
#       ②スクリプト例外でquit_editor不達→エディタが永久残留 — 必ずtry/finallyで終了させる
import unreal

try:
    print("[BOOT] engine:", unreal.SystemLibrary.get_engine_version())

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ok = les.new_level("/Game/Maps/WarRoom")
    print("[BOOT] new_level:", ok)

    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    cube_asset = unreal.load_asset("/Engine/BasicShapes/Cube")
    floor = actors.spawn_actor_from_object(cube_asset, unreal.Vector(0, 0, -10))
    floor.set_actor_scale3d(unreal.Vector(20, 20, 0.2))
    floor.set_actor_label("floor")
    cube = actors.spawn_actor_from_object(cube_asset, unreal.Vector(0, 0, 60))
    cube.set_actor_label("probe_cube")
    light = actors.spawn_actor_from_class(unreal.PointLight, unreal.Vector(200, -150, 300), unreal.Rotator())
    light.set_actor_label("probe_light")
    print("[BOOT] actors:", len(actors.get_all_level_actors()))

    saved = les.save_current_level()
    print("[BOOT] save_level:", saved)
    print("BOOT_CHECK_OK")
except Exception as e:  # 失敗も必ずログして終了へ(ゾンビ防止)
    print("[BOOT] FAILED:", repr(e))
finally:
    unreal.SystemLibrary.quit_editor()
