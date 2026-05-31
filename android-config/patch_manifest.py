import re
path = "android/app/src/main/AndroidManifest.xml"
c = open(path).read()
c = re.sub(
    r'(<activity\b)([^>]*?android:name="\.MainActivity")',
    r'\1\2\n            android:screenOrientation="sensorLandscape"',
    c
)
open(path, "w").write(c)
print("Landscape orientation set in AndroidManifest.xml")
