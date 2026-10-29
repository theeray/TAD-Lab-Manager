"""Create the exact beta QR artwork and a printable sticker (qrcode 8.2, reportlab)."""
from pathlib import Path
import qrcode
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.utils import ImageReader
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://tad-lab-manager.web.app/equipment-checkout.html?asset=IPAD-07'
QR_DIR = ROOT / 'checkout' / 'qr'
OUTPUT = ROOT.parent / 'output' / 'pdf' / 'TAD-iPad-07-QR-Sticker.pdf'
TEMP = ROOT / '.local' / 'qr'
for directory in (QR_DIR, OUTPUT.parent, TEMP):
    directory.mkdir(parents=True, exist_ok=True)
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=12, border=4)
qr.add_data(URL)
qr.make(fit=True)
matrix = qr.get_matrix()
side = len(matrix)
rects = ''.join(f'<rect x="{x}" y="{y}" width="1" height="1"/>' for y, row in enumerate(matrix) for x, dark in enumerate(row) if dark)
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {side} {side}" width="600" height="600" role="img" aria-label="TAD Student iPad 07 checkout QR"><title>Student iPad #07 - Asset 1982096</title><desc>{URL.replace("&", "&amp;")}</desc><rect width="{side}" height="{side}" fill="white"/><g fill="black" shape-rendering="crispEdges">{rects}</g></svg>\n'
(QR_DIR / 'IPAD-07.svg').write_text(svg)
qr.make_image(fill_color='black', back_color='white').save(TEMP / 'IPAD-07.png')

for name, font in [('TAD-Sans','DejaVuSans.ttf'),('TAD-Bold','DejaVuSans-Bold.ttf'),('TAD-Mono','DejaVuSansMono-Bold.ttf')]:
    pdfmetrics.registerFont(TTFont(name, '/usr/share/fonts/truetype/dejavu/'+font))
c = canvas.Canvas(str(OUTPUT), pagesize=(612, 792))
c.setTitle('TAD Lab Manager - Student iPad 07 QR sticker')
c.setAuthor('TAD Lab Manager')
c.setFillColor(HexColor('#183c40'))
c.setFont('TAD-Bold', 22)
c.drawString(54, 738, 'iPad checkout beta')
c.setFont('TAD-Sans', 11)
c.drawString(54, 715, 'Student iPad #07  |  University asset 1982096')
c.setFillColor(HexColor('#53666c'))
c.setFont('TAD-Sans', 10)
c.drawString(54, 690, 'Print at 100% scale. Cut around the border and attach to the iPad case.')
x, y, w, h = 180, 293, 252, 342
c.setStrokeColor(HexColor('#183c40'))
c.setLineWidth(1)
c.roundRect(x, y, w, h, 12, stroke=1, fill=0)
colors = ['#36b8b2', '#ef6357', '#d6dc35', '#57c75b', '#8a60bb', '#f49a4b']
for i, color in enumerate(colors):
    c.setFillColor(HexColor(color)); c.rect(x+1+i*(w-2)/6, y+h-12, (w-2)/6, 4, stroke=0, fill=1)
c.drawImage(ImageReader(str(ROOT / 'assets' / 'tad-t-logo.png')), x+18, y+h-47, width=25, height=25, mask='auto')
c.setFillColor(HexColor('#183c40')); c.setFont('TAD-Bold', 12)
c.drawString(x+52, y+h-32, 'TAD Lab Manager')
c.setFont('TAD-Sans', 8); c.drawString(x+52, y+h-44, 'Bemidji State University')
c.setFillColor(black); c.setFont('TAD-Bold', 20)
c.drawCentredString(x+w/2, y+h-79, 'Student iPad #07')
c.setFont('TAD-Mono', 14); c.drawCentredString(x+w/2, y+h-100, 'ASSET 1982096')
c.setFont('TAD-Sans', 7); c.drawCentredString(x+w/2, y+h-116, 'PROPERTY OF THE STATE OF MINNESOTA')
size = 180
qx, qy = x+(w-size)/2, y+40
unit = size/side
c.setFillColor(white); c.rect(qx, qy, size, size, stroke=0, fill=1)
c.setFillColor(black)
for row, values in enumerate(matrix):
    for col, dark in enumerate(values):
        if dark: c.rect(qx+col*unit, qy+(side-row-1)*unit, unit, unit, stroke=0, fill=1)
c.setFillColor(HexColor('#183c40')); c.setFont('TAD-Bold', 9)
c.drawCentredString(x+w/2, y+24, 'SCAN TO CHECK OUT')
c.setFont('TAD-Sans', 8); c.drawCentredString(x+w/2, y+11, 'Verify your email. Return or re-check out every 8 weeks.')

c.setFillColor(HexColor('#183c40')); c.setFont('TAD-Bold', 12)
c.drawString(54, 245, 'Before the first beta test')
c.setFillColor(HexColor('#53666c')); c.setFont('TAD-Sans', 10)
for index, line in enumerate([
    'A verified lab manager must register Student iPad #07 with asset 1982096,',
    'then enable beta checkout. Beta notifications go to Eric Carlson and Nick Lowery.',
    'The QR points to the permanent website, so the sticker can stay on the case.',
]): c.drawString(54, 225-index*16, line)
c.setFont('TAD-Bold', 9); c.drawString(54, 148, 'QR destination')
c.setFont('TAD-Sans', 9); c.drawString(54, 132, URL)
c.linkURL(URL, (54, 128, 558, 145), relative=0, thickness=0)
c.setFont('TAD-Sans', 8); c.drawString(54, 54, 'TAD equipment checkout beta - one iPad - sticker size 3.5 x 4.75 inches')
c.showPage(); c.save()
print(OUTPUT)
print('QR:', URL)
