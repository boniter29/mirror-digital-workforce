from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "build-resources" / "icon.png"
SIZE = 1024

image = Image.new("RGBA", (SIZE, SIZE), (243, 240, 232, 255))
draw = ImageDraw.Draw(image)

# Apple-like warm neutral tile with the dark green used by Mirror OS.
draw.rounded_rectangle((72, 72, 952, 952), radius=224, fill=(31, 57, 45, 255))
draw.rounded_rectangle((112, 112, 912, 912), radius=190, outline=(242, 196, 166, 255), width=18)
draw.line((196, 258, 828, 258), fill=(242, 196, 166, 255), width=14)
draw.line((196, 766, 828, 766), fill=(242, 196, 166, 255), width=14)

font_candidates = [
    Path("C:/Windows/Fonts/msyhbd.ttc"),
    Path("C:/Windows/Fonts/msyh.ttc"),
    Path("C:/Windows/Fonts/simhei.ttf"),
]
font_path = next((path for path in font_candidates if path.exists()), None)
font = ImageFont.truetype(str(font_path), 430) if font_path else ImageFont.load_default()
label = "镜"
box = draw.textbbox((0, 0), label, font=font)
width = box[2] - box[0]
height = box[3] - box[1]
draw.text(((SIZE - width) / 2, (SIZE - height) / 2 - box[1] - 4), label, font=font, fill=(247, 244, 237, 255))

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
image.save(OUTPUT, optimize=True)
print(OUTPUT)
