# M7 大判アート一括生成: Codex CLI(gpt-image-2)で生成 → generated_imagesからart/へコピー
# usage: pwsh tools/genart.ps1 [-Only name1,name2]
param([string[]]$Only)
if($Only){ $Only = ($Only -join ",") -split "," | ForEach-Object { $_.Trim() } } # -File経由でも配列化

$ROOT = Split-Path $PSScriptRoot -Parent
$ART = Join-Path $ROOT "art"
$LOG = Join-Path $ROOT "tmp\genart-log.txt"
New-Item -ItemType Directory -Force $ART | Out-Null
New-Item -ItemType Directory -Force (Join-Path $ROOT "tmp") | Out-Null

$STYLE = "Pulp sci-fi book cover illustration, painterly bold shapes, deep space near-black blue background, teal and amber neon rim lighting, high contrast, slightly retro-futuristic, cinematic, no text, no watermark, no UI elements."

$MANIFEST = @(
  @{n="title-hero";   r="landscape 3:2"; p="A small patched-up salvage spaceship with a tiny drone companion approaching a colossal ancient alien gate structure floating in a glowing nebula, seen from behind, sense of awe and curiosity."},
  @{n="zone1";        r="landscape 3:2"; p="Asteroid debris belt with shipwreck fragments drifting, cold blue tones, sparse composition, darker at edges. Background plate for a game board, keep center area calm."},
  @{n="zone2";        r="landscape 3:2"; p="A graveyard of derelict pirate ships, faint red lantern lights, thin fog, ominous. Background plate for a game board, keep center area calm."},
  @{n="zone3";        r="landscape 3:2"; p="A whispering green nebula with distant bioluminescent jellyfish-like shapes. Background plate for a game board, keep center area calm."},
  @{n="zone4";        r="landscape 3:2"; p="Silent ancient defense outpost ruins glowing orange, geometric monolith fragments. Background plate for a game board, keep center area calm."},
  @{n="zone5";        r="landscape 3:2"; p="A single colossal black monolith tomb radiating dim red light in empty crimson-black space, temple-like silence. Background plate for a game board, keep center area calm."},
  @{n="relic-nano";   r="square 1:1";    p="An ancient silver nano-repair vat artifact on a pedestal, something faintly pulsing inside, treated like a holy relic, dramatic museum lighting."},
  @{n="relic-coil";   r="square 1:1";    p="An unstable phase coil artifact: a metallic coil whose edges blur and double like a glitch, hovering above a pedestal."},
  @{n="relic-anchor"; r="square 1:1";    p="A graviton anchor artifact: a black anchor-like device with surrounding dust and pebbles falling toward it, on a pedestal."},
  @{n="relic-fusion"; r="square 1:1";    p="A cracked fusion core artifact: a dark sphere leaking blinding starlight through fissures, on a pedestal."},
  @{n="relic-starmap";r="square 1:1";    p="A dead civilization star map artifact: a holographic disc projecting vanished constellations, on a pedestal."},
  @{n="relic-annihil";r="square 1:1";    p="An annihilation protocol fragment: a sinister black crystal chip with faint red inner glow, on a pedestal, feels dangerous."},
  @{n="ship-vagrants";r="square 1:1";    p="A patched utilitarian salvage frigate spaceship, cyan stripe livery, dependable workhorse, 3/4 side view, full ship visible."},
  @{n="ship-bellyroll";r="square 1:1";   p="A heavily armored ramming spaceship with a massive reinforced prow, battle-scarred hull, amber stripe livery, 3/4 side view, full ship visible."},
  @{n="ship-astra";   r="square 1:1";    p="A slender long-range artillery spaceship with a disproportionately long cannon, purple stripe livery, elegant but fragile, 3/4 side view, full ship visible."}
)

function Gen-One($item){
  $out = Join-Path $ROOT ("tmp\art-gen-" + $item.n + ".txt")
  $prompt = "Generate ONE image using your image generation tool. STYLE: $STYLE SUBJECT: $($item.p) Aspect: $($item.r). Do NOT attempt to write or copy any files in the workspace (sandbox denies it). Your final message must contain ONLY the absolute path of the generated PNG file."
  '' | codex exec -C $ROOT -s read-only --skip-git-repo-check -o $out $prompt 2>&1 | Out-Null
  if(!(Test-Path $out)){ return "no-output" }
  $msg = Get-Content $out -Raw
  if($msg -match '([A-Za-z]:\\[^\s`"''<>|]+\.png)'){
    $src = $Matches[1]
    if(Test-Path $src){
      Copy-Item -LiteralPath $src (Join-Path $ART ($item.n + ".png")) -Force
      return "ok"
    }
    return "path-missing: $src"
  }
  return ("no-path: " + $msg.Substring(0,[Math]::Min(120,$msg.Length)))
}

"start $(Get-Date -Format o)" | Out-File $LOG
foreach($item in $MANIFEST){
  if($Only -and ($Only -notcontains $item.n)){ continue }
  $dest = Join-Path $ART ($item.n + ".png")
  if(Test-Path $dest){ "$($item.n): skip(exists)" | Tee-Object -Append $LOG; continue }
  $r = Gen-One $item
  if($r -ne "ok"){ Start-Sleep 5; $r = Gen-One $item } # 1リトライ
  "$($item.n): $r $(Get-Date -Format HH:mm:ss)" | Tee-Object -Append $LOG
}
"done $(Get-Date -Format o)" | Out-File $LOG -Append
Get-ChildItem $ART -Filter *.png | Select-Object Name,Length
