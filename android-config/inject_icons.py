from PIL import Image
import os

src = Image.open("client/assets/icon-512.png").convert("RGBA")
sizes = {
    "android/app/src/main/res/mipmap-mdpi":     48,
    "android/app/src/main/res/mipmap-hdpi":     72,
    "android/app/src/main/res/mipmap-xhdpi":    96,
    "android/app/src/main/res/mipmap-xxhdpi":  144,
    "android/app/src/main/res/mipmap-xxxhdpi": 192,
}
for folder, size in sizes.items():
    os.makedirs(folder, exist_ok=True)
    resized = src.resize((size, size), Image.LANCZOS)
    resized.save(f"{folder}/ic_launcher.png")
    resized.save(f"{folder}/ic_launcher_round.png")
    resized.save(f"{folder}/ic_launcher_foreground.png")
    print(f"  {size}x{size} -> {folder}")
print("All icons injected!")
