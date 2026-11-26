#!/bin/bash
# Compile-check the Unity receiver without Unity: UnityEngine / UniVRM10 are replaced by tiny stubs (Stubs.cs).
# Needs mono's C# compiler (apt-get install -y mono-mcs). Checks both input systems.
cd "$(dirname "$0")/../.." || exit 1
F=native/unity/Assets/MirrorMocap/MirrorMocapReceiver.cs
for def in ENABLE_INPUT_SYSTEM ENABLE_LEGACY_INPUT_MANAGER; do
  mcs -langversion:Latest -target:library -nowarn:0649,0169,0414 -define:$def -out:/tmp/mirror-mocap-check.dll tools/unity-stubs/Stubs.cs "$F" && echo "$def: OK" || exit 1
done
