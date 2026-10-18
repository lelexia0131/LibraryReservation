"""Build the Windows ICO from the existing Android artwork (requires Pillow)."""
from pathlib import Path
import xml.etree.ElementTree as ET
from PIL import Image

root = Path(__file__).resolve().parent.parent
resources = root / 'android/app/src/main/res'
android_attr = '{http://schemas.android.com/apk/res/android}'
adaptive = ET.parse(resources / 'mipmap-anydpi-v26/ic_launcher.xml').getroot()
foreground_name = adaptive.find('foreground').get(android_attr + 'drawable').split('/')[-1]
background_name = adaptive.find('background').get(android_attr + 'drawable').split('/')[-1]
background = next(item.text for item in ET.parse(resources / 'values/ic_launcher_background.xml').getroot()
                  if item.get('name') == background_name)
foreground = Image.open(resources / f'mipmap-xxxhdpi/{foreground_name}.png').convert('RGBA')
legacy = Image.open(resources / 'mipmap-xxxhdpi/ic_launcher.png').convert('RGBA')

# Use the high-resolution artwork, with the existing legacy launcher's silhouette.
# Only the alpha silhouette is scaled from 192px; no low-resolution color artwork is enlarged.
mask = legacy.getchannel('A').resize((256, 256), Image.Resampling.LANCZOS)
art = foreground.crop(foreground.getbbox()).resize((208, 208), Image.Resampling.LANCZOS)
icon = Image.new('RGBA', (256, 256), background)
icon.alpha_composite(art, (24, 24))
icon.putalpha(mask)
icon.save(root / 'build/icon.ico', sizes=[(size, size) for size in [16, 24, 32, 48, 64, 128, 256]])
print('Generated build/icon.ico: 16, 24, 32, 48, 64, 128, 256px')
