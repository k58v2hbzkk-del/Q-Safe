import math
LIME="#C6FF3D"; LIME2="#8BFF7A"; INK="#0A0A0A"; PAPER="#F3F2EC"

def mark(id, fg, gap_color, size=240, x=0, y=0, grad=True):
    """Q-key monogram on a 240 grid: thick ring + key blade tail, separated by a knockout gap."""
    s=size/240
    cx,cy=120,112
    R,r=96,56          # ring outer / inner
    # key blade: rotated 45deg rounded bar from inside ring to beyond, with two teeth
    blade = (
      f'<g transform="translate({cx} {cy}) rotate(45)">'
      f'<rect x="30" y="-17" width="118" height="34" rx="17"/>'
      # teeth (key bits) hanging off the blade's lower side
      f'<rect x="96" y="10" width="18" height="28" rx="5"/>'
      f'<rect x="122" y="10" width="18" height="20" rx="5"/>'
      f'</g>')
    blade_gap = (
      f'<g transform="translate({cx} {cy}) rotate(45)">'
      f'<rect x="22" y="-27" width="134" height="54" rx="27"/>'
      f'<rect x="88" y="0" width="34" height="48" rx="12"/>'
      f'<rect x="114" y="0" width="34" height="40" rx="12"/>'
      f'</g>')
    fill = f'url(#g{id})' if grad else fg
    defs = f'''<defs>
      <linearGradient id="g{id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="{LIME}"/><stop offset="1" stop-color="{LIME2}"/>
      </linearGradient>
      <mask id="m{id}" maskUnits="userSpaceOnUse" x="0" y="0" width="240" height="240">
        <rect width="240" height="240" fill="#fff"/>
        <g fill="#000">{blade_gap}</g>
      </mask>
    </defs>'''
    ring = f'<path fill-rule="evenodd" mask="url(#m{id})" fill="{fill}" d="M{cx-R} {cy} a{R} {R} 0 1 0 {2*R} 0 a{R} {R} 0 1 0 {-2*R} 0 Z M{cx-r} {cy} a{r} {r} 0 1 1 {2*r} 0 a{r} {r} 0 1 1 {-2*r} 0 Z"/>'
    # small "one-time key" dot in the ring centre
    dot = f'<circle cx="{cx}" cy="{cy}" r="15" fill="{fill}"/>'
    return f'<g transform="translate({x} {y}) scale({s})">{defs}{ring}<g fill="{fill}">{blade}</g>{dot}</g>'

font='font-family="Inter Display" font-weight="800"'
def wordmark(x,y,size,fg,accent):
    # "QSafe": tight tracking, the Q carries the accent
    return (f'<text x="{x}" y="{y}" {font} font-size="{size}" letter-spacing="{-size*0.045:.1f}" fill="{fg}">'
            f'Q<tspan fill="{fg}">Safe</tspan></text>')
