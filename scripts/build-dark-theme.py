#!/usr/bin/env python3
"""Génère public/cdi/theme-dark.css à partir de public/cdi/cdi.css.

Chaque couleur claire devient une surface sombre (luminosité inversée, teinte conservée), les couleurs
vives sont éclaircies pour le texte et assombries pour les fonds. À relancer après toute modification
des couleurs de cdi.css :  python3 scripts/build-dark-theme.py
"""
import colorsys
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public/cdi/cdi.css"
TARGET = ROOT / "public/cdi/theme-dark.css"
PREFIX = 'html[data-theme="dark"]'
# Éléments imprimés ou lus par un scanner : toujours sur fond clair.
KEEP_LIGHT = (".badge", ".qr-code", ".tice-wordmark", ".barcode", ".borne")
VARIABLES = {
    "--blue": "#8f99ff", "--ink": "#e6e8f5", "--muted": "#a6acc4", "--line": "#2d3252",
    "--canvas": "#0d1020", "--pale": "#1d2245", "--white": "#161a2d", "--green": "#5fd09a", "--red": "#ff8189",
    "--shadow": "0 4px 14px #00000059", "--blue-fill": "#4652d8",
}
COLOR = re.compile(r"#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b|(?<![-\w])(?:white|black)(?![-\w])")


def parse(text):
    """Découpe le CSS en [(préambule, déclarations | sous-règles)]."""
    rules, i = [], 0
    while i < len(text):
        start = text.find("{", i)
        if start < 0:
            break
        prelude = text[i:start].strip()
        depth, j = 1, start + 1
        while depth:
            depth += {"{": 1, "}": -1}.get(text[j], 0)
            j += 1
        body = text[start + 1:j - 1]
        rules.append((prelude, parse(body) if prelude.startswith("@") else body))
        i = j
    return rules


def to_rgb(token):
    token = {"white": "#ffffff", "black": "#000000"}.get(token.lower(), token)
    digits = token[1:]
    if len(digits) in (3, 4):
        digits = "".join(c * 2 for c in digits)
    alpha = digits[6:8]
    return [int(digits[k:k + 2], 16) / 255 for k in (0, 2, 4)], alpha


def convert(token, prop):
    (r, g, b), alpha = to_rgb(token)
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    if alpha and l > 0.9:
        return token  # Voile blanc translucide posé sur un fond coloré : inchangé.
    vivid = s > 0.45 and 0.12 < l < 0.72
    background = prop.startswith("background")
    if vivid and background:
        l = min(max(l, 0.36), 0.48)
    elif vivid:
        l, s = max(l, 0.7), min(s, 0.85)
    else:
        if s < 0.05:
            h = 230 / 360
        s = min(max(s, 0.12), 0.3)
        l = 0.09 + (1 - l) * 0.83
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return "#" + "".join(f"{round(v * 255):02x}" for v in (r, g, b)) + alpha


def declarations(body, selector):
    out = []
    for part in body.split(";"):
        if ":" not in part:
            continue
        prop, value = (x.strip() for x in part.split(":", 1))
        prop_l = prop.lower()
        if prop_l in VARIABLES or "shadow" in prop_l:
            continue
        if prop_l.startswith("background") and "var(--blue)" in value:
            out.append(f"{prop}:{value.replace('var(--blue)', 'var(--blue-fill)')}")
            continue
        if not COLOR.search(value):
            continue
        if prop_l == "color" and COLOR.fullmatch(value.replace("!important", "").strip() or "") and to_rgb(COLOR.search(value).group())[0] == [1, 1, 1]:
            continue  # Texte blanc sur fond coloré : inchangé.
        out.append(f"{prop}:{COLOR.sub(lambda m: convert(m.group(), prop_l), value)}")
    return out


def emit(rules, indent=""):
    lines = []
    for prelude, body in rules:
        if prelude.startswith("@media print"):
            continue
        if isinstance(body, list):
            inner = emit(body, indent + "  ")
            if inner:
                lines += [f"{indent}{prelude}{{", *inner, f"{indent}}}"]
            continue
        selectors = [s.strip() for s in prelude.split(",")]
        selectors = [s for s in selectors if not any(k in s for k in KEEP_LIGHT)]
        decls = declarations(body, prelude)
        if not selectors or not decls:
            continue
        scoped = ",".join(f"{PREFIX} {s}" if s != ":root" else PREFIX for s in selectors)
        lines.append(f"{indent}{scoped}{{{';'.join(decls)}}}")
    return lines


def main():
    rules = parse(re.sub(r"/\*.*?\*/", "", SOURCE.read_text(encoding="utf-8"), flags=re.S))
    header = [
        "/* Fichier généré par scripts/build-dark-theme.py à partir de cdi.css : ne pas modifier à la main. */",
        "@media screen{",
        f"{PREFIX}{{color-scheme:dark;{';'.join(f'{k}:{v}' for k, v in VARIABLES.items())}}}",
    ]
    manual = [
        f"{PREFIX} body{{background:var(--canvas)}}",
        f"{PREFIX} .notice.warning{{background:#3a2a0d;border-color:#7a5a1c;color:#ffd99a}}",
        f"{PREFIX} img.tice-brand-icon,{PREFIX} .tice-wordmark img{{filter:none}}",
        f"{PREFIX} .masthead .tice-wordmark{{background:#fff;padding:5px 8px;border-radius:6px}}",
        f"{PREFIX} .tice-hero-logo{{background:#fff;padding:14px 18px;border-radius:10px}}",
        f"{PREFIX} .borne-hero{{background:linear-gradient(150deg,#1b2050,#141836);color:#e6e8f5}}",
        f"{PREFIX} .borne-hero p{{color:#c4c9ef}}",
        f"{PREFIX} .borne-scan input{{border-color:#3a4170}}",
        f"{PREFIX} .borne-state[data-tone=warning]{{background:#3a2a0d;color:#ffd99a}}",
        f"{PREFIX} .borne-feedback.success,{PREFIX} .borne-status{{background:#123d2a;color:#7ee0ad}}",
        f"{PREFIX} .borne-feedback.error,{PREFIX} .borne-status[data-state=closed]{{background:#4a1820;color:#ff9ba2}}",
        f"{PREFIX} :focus-visible{{outline-color:#9aa6ff}}",
    ]
    TARGET.write_text("\n".join(header + emit(rules, "  ") + ["  " + m for m in manual] + ["}", ""]), encoding="utf-8")
    print(f"{TARGET.relative_to(ROOT)} généré.")


if __name__ == "__main__":
    sys.exit(main())
