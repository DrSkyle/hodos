import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const brandDir = path.join(rootDir, 'brand');
const webPublicDir = path.join(rootDir, 'apps/web/public');
const masterPngPath = path.join(webPublicDir, 'hodos-icon.png');

if (!fs.existsSync(masterPngPath)) {
  throw new Error(`Missing master Hodos icon at ${masterPngPath}`);
}

fs.mkdirSync(brandDir, { recursive: true });
fs.mkdirSync(webPublicDir, { recursive: true });

// Derive all raster sizes, SVGs, ICO, and wordmark from the master apps/web/public/hodos-icon.png via Python Pillow
const pyScript = `
import base64
import io
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(${JSON.stringify(rootDir)})
web_pub = root / "apps/web/public"
brand_dir = root / "brand"
master = Image.open(web_pub / "hodos-icon.png").convert("RGBA")

# 1. Standard raster icons
for name, size in [
    ("favicon-16.png", 16),
    ("favicon-32.png", 32),
    ("apple-touch-icon.png", 180),
    ("icon-192.png", 192),
    ("icon-512.png", 512),
]:
    master.resize((size, size), Image.Resampling.LANCZOS).save(web_pub / name, "PNG", optimize=True)

# 2. Multi-size favicon.ico
master.resize((32, 32), Image.Resampling.LANCZOS).save(
    web_pub / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)]
)

# 2b. iOS refuses to draw transparency, and a maskable icon must be full bleed
#     with its art inside the safe zone. Both are flattened onto the paper tone.
paper = (250, 248, 242, 255)

apple = Image.new("RGBA", (180, 180), paper)
apple.paste(master.resize((180, 180), Image.Resampling.LANCZOS), (0, 0), master.resize((180, 180), Image.Resampling.LANCZOS))
apple.convert("RGB").save(web_pub / "apple-touch-icon.png", "PNG", optimize=True)

maskable = Image.new("RGBA", (512, 512), paper)
inner = master.resize((410, 410), Image.Resampling.LANCZOS)
maskable.paste(inner, (51, 51), inner)
maskable.convert("RGB").save(web_pub / "icon-maskable-512.png", "PNG", optimize=True)

# 3. Circular master (1024x1024)
size = 1024
round_img = master.resize((size, size), Image.Resampling.LANCZOS)
circle_mask = Image.new("L", (size, size), 0)
ImageDraw.Draw(circle_mask).ellipse((0, 0, size, size), fill=255)
round_out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
round_out.paste(round_img, (0, 0), circle_mask)
round_out.save(web_pub / "hodos-round.png", "PNG", optimize=True)

# 4. Embedded SVG brandmarks (brand/icon.svg, apps/web/public/brandmark.svg, icon.svg, icon-round.svg)
buf = io.BytesIO()
master.resize((512, 512), Image.Resampling.LANCZOS).convert("RGB").save(buf, format="JPEG", quality=90, optimize=True)
b64 = base64.b64encode(buf.getvalue()).decode("ascii")

square_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Hodos">
  <defs>
    <clipPath id="squircle">
      <rect width="512" height="512" rx="112" ry="112" />
    </clipPath>
  </defs>
  <image href="data:image/jpeg;base64,{b64}" width="512" height="512" preserveAspectRatio="xMidYMid slice" clip-path="url(#squircle)" />
</svg>
"""

round_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Hodos">
  <defs>
    <clipPath id="circle">
      <circle cx="256" cy="256" r="256" />
    </clipPath>
  </defs>
  <image href="data:image/jpeg;base64,{b64}" width="512" height="512" preserveAspectRatio="xMidYMid slice" clip-path="url(#circle)" />
</svg>
"""

for p in [brand_dir / "icon.svg", web_pub / "brandmark.svg", web_pub / "icon.svg"]:
    p.write_text(square_svg, encoding="utf-8")
(web_pub / "icon-round.svg").write_text(round_svg, encoding="utf-8")
`;

execFileSync('python3', ['-c', pyScript], { stdio: 'inherit' });
console.log('Brand assets synchronized from apps/web/public/hodos-icon.png');
