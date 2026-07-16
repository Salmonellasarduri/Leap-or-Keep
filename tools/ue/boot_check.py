# UE5 headless boot check — Blender式パイプラインのUE版・疎通確認
# usage: UnrealEditor-Cmd.exe <project> -ExecCmds="py this_file" -stdout -unattended -nosplash -nullrhi
# 注意: -run=pythonscript(コマンドレット)はLevelEditorSubsystem不在でnew_levelがネイティブクラッシュする
#       → フルエディタをヘッドレス起動して ExecCmds で流す(検証済みの回避)。終了は quit_editor。
import unreal

print("[BOOT] engine:", unreal.SystemLibrary.get_engine_version())

les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
ok = les.new_level("/Game/Maps/WarRoom")
print("[BOOT] new_level:", ok)

actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
# 床(スケール大の立方体)+ 検証用キューブ + ライト = 「操作できている」最小証明
cube_asset = unreal.load_asset("/Engine/BasicShapes/Cube")
floor = actors.spawn_actor_from_object(cube_asset, unreal.Vector(0, 0, -10))
floor.set_actor_scale3d(unreal.Vector(20, 20, 0.2))
floor.set_actor_label("floor")
cube = actors.spawn_actor_from_object(cube_asset, unreal.Vector(0, 0, 60))
cube.set_actor_label("probe_cube")
light = actors.spawn_actor_class(unreal.PointLight, unreal.Vector(200, -150, 300), unreal.Rotator())
light.set_actor_label("probe_light")
print("[BOOT] actors:", len(actors.get_all_level_actors()))

saved = les.save_current_level()
print("[BOOT] save_level:", saved)
print("BOOT_CHECK_OK")
unreal.SystemLibrary.quit_editor()  # ExecCmds方式はエディタが残るので明示終了
