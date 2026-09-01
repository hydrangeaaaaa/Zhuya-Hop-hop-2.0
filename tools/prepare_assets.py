"""Deterministic asset cleanup for Zhuya Hop Hop.

Only alpha cleanup, tight cropping, alignment, and platform recolouring are used.
No generative processing or resynthesis is performed.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "assets" / "raw"
ASSETS = ROOT / "assets"
PADDING = 8


def trim(image: Image.Image, padding: int = PADDING) -> Image.Image:
    image = image.convert("RGBA")
    bbox = image.getchannel("A").getbbox()
    if not bbox:
        return Image.new("RGBA", (padding * 2 + 1, padding * 2 + 1))
    cropped = image.crop(bbox)
    output = Image.new(
        "RGBA", (cropped.width + padding * 2, cropped.height + padding * 2)
    )
    output.alpha_composite(cropped, (padding, padding))
    return output


def alpha_components(image: Image.Image, threshold: int = 12):
    alpha = image.getchannel("A")
    width, height = image.size
    pixels = alpha.load()
    visited = bytearray(width * height)
    components: list[list[tuple[int, int]]] = []

    for y in range(height):
        for x in range(width):
            index = y * width + x
            if visited[index] or pixels[x, y] <= threshold:
                continue
            visited[index] = 1
            queue = deque([(x, y)])
            component: list[tuple[int, int]] = []
            while queue:
                px, py = queue.popleft()
                component.append((px, py))
                for ny in range(max(0, py - 1), min(height, py + 2)):
                    for nx in range(max(0, px - 1), min(width, px + 2)):
                        next_index = ny * width + nx
                        if visited[next_index] or pixels[nx, ny] <= threshold:
                            continue
                        visited[next_index] = 1
                        queue.append((nx, ny))
            components.append(component)
    return components


def remove_spring_motion_marks(image: Image.Image) -> Image.Image:
    """Keep the central hand-drawn object and discard detached action ticks."""
    image = image.convert("RGBA")
    components = alpha_components(image)
    if not components:
        return image
    main = max(components, key=len)
    keep: set[tuple[int, int]] = set(main)
    # The supplied spring drawings are a single connected subject. Every other
    # alpha island is one of the little action ticks the user asked to remove.

    output = image.copy()
    alpha = output.getchannel("A")
    alpha_pixels = alpha.load()
    for y in range(output.height):
        for x in range(output.width):
            if (x, y) not in keep:
                alpha_pixels[x, y] = 0
    output.putalpha(alpha)
    return trim(output)


def standardize_spring_frames(kind: str):
    source_dir = RAW / kind
    target_dir = ASSETS / "springs" / kind
    target_dir.mkdir(parents=True, exist_ok=True)
    cleaned = [
        remove_spring_motion_marks(Image.open(source_dir / f"{index:02}.png"))
        for index in range(1, 8)
    ]
    width = max(frame.width for frame in cleaned)
    height = max(frame.height for frame in cleaned)
    for index, frame in enumerate(cleaned, 1):
        canvas = Image.new("RGBA", (width, height))
        x = (width - frame.width) // 2
        y = height - frame.height
        canvas.alpha_composite(frame, (x, y))
        canvas.save(target_dir / f"{index:02}.png", optimize=True)


def clear_rectangles(image: Image.Image, rectangles) -> Image.Image:
    output = image.convert("RGBA").copy()
    alpha = output.getchannel("A")
    for left, top, right, bottom in rectangles:
        alpha.paste(0, (left, top, right, bottom))
    output.putalpha(alpha)
    return trim(output)


def prepare_shields():
    target = ASSETS / "shields"
    target.mkdir(parents=True, exist_ok=True)
    axes = Image.open(RAW / "shield-axes.png")
    buns = Image.open(RAW / "shield-buns.png")

    # Delete only the three pairs of short accent ticks around each item.
    axes = clear_rectangles(
        axes,
        [
            (515, 135, 585, 205),
            (112, 420, 176, 495),
            (560, 595, 632, 670),
        ],
    )
    buns = clear_rectangles(
        buns,
        [
            (546, 74, 610, 132),
            (94, 706, 148, 768),
            (866, 700, 924, 762),
        ],
    )
    axes.save(target / "shield-axes.png", optimize=True)
    buns.save(target / "shield-buns.png", optimize=True)


def copy_trimmed(source: str, destination: str):
    target = ASSETS / destination
    target.parent.mkdir(parents=True, exist_ok=True)
    trim(Image.open(RAW / source)).save(target, optimize=True)


def recolour_platform(source: Image.Image, target_rgb: tuple[int, int, int]):
    source = source.convert("RGBA")
    output = Image.new("RGBA", source.size)
    source_pixels = source.load()
    output_pixels = output.load()
    for y in range(source.height):
        for x in range(source.width):
            red, green, blue, alpha = source_pixels[x, y]
            if alpha == 0:
                continue
            luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
            if luminance < 58:
                value = int(max(12, luminance * 0.55))
                output_pixels[x, y] = (value, value, value, alpha)
                continue
            texture = max(0.55, min(1.35, luminance / 145))
            output_pixels[x, y] = (
                min(255, int(target_rgb[0] * texture)),
                min(255, int(target_rgb[1] * texture)),
                min(255, int(target_rgb[2] * texture)),
                alpha,
            )
    return output


def prepare_platforms():
    target = ASSETS / "platforms"
    target.mkdir(parents=True, exist_ok=True)
    source = Image.open(target / "platform-original.png")
    variants = {
        "white": (222, 218, 204),
        "brown": (145, 99, 55),
        "yellow": (226, 178, 38),
        "blue": (41, 153, 199),
    }
    prepared = {}
    for name, colour in variants.items():
        image = recolour_platform(source, colour)
        image.save(target / f"platform-{name}.png", optimize=True)
        prepared[name] = image

    blue = prepared["blue"]
    gap = 5
    midpoint = blue.width // 2
    broken = Image.new("RGBA", (blue.width + gap, blue.height))
    left = blue.crop((0, 0, midpoint, blue.height))
    right = blue.crop((midpoint, 0, blue.width, blue.height))
    # A small stagger creates a visible hand-drawn crack without redrawing texture.
    broken.alpha_composite(left, (0, 0))
    broken.alpha_composite(right, (midpoint + gap, 1))
    broken.save(target / "platform-blue-broken.png", optimize=True)


def main():
    for source, destination in [
        ("player-normal.png", "character1/player-normal.png"),
        ("player-fall.png", "character1/player-fall.png"),
        ("player-propeller-cat.png", "character1/player-propeller-cat.png"),
        ("player-propeller-dog.png", "character1/player-propeller-dog.png"),
        ("pickup-propeller-cat.png", "pickups/pickup-propeller-cat.png"),
        ("pickup-propeller-dog.png", "pickups/pickup-propeller-dog.png"),
    ]:
        copy_trimmed(source, destination)
    standardize_spring_frames("slipper")
    standardize_spring_frames("guitar")
    prepare_shields()
    prepare_platforms()
    print("Prepared game assets in", ASSETS)


if __name__ == "__main__":
    main()
