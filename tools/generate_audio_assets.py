from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path


RATE = 22_050
LOOP_RATE = 44_100
OUTPUT = Path(__file__).resolve().parents[1] / "assets" / "audio"


def envelope(progress: float, decay: float = 3.5) -> float:
    return max(0.0, 1.0 - progress) * math.exp(-decay * progress)


def sweep(start: float, end: float, duration: float, decay: float = 3.5) -> list[float]:
    count = max(1, round(RATE * duration))
    phase = 0.0
    samples: list[float] = []
    for index in range(count):
        progress = index / count
        frequency = start + (end - start) * progress
        phase += math.tau * frequency / RATE
        samples.append(math.sin(phase) * envelope(progress, decay) * 0.72)
    return samples


def mix(*tracks: list[float]) -> list[float]:
    length = max(map(len, tracks))
    result = [0.0] * length
    for track in tracks:
        for index, value in enumerate(track):
            result[index] += value / len(tracks)
    return result


def noise_burst(duration: float, seed: int, low_pass: float, gain: float) -> list[float]:
    rng = random.Random(seed)
    count = max(1, round(RATE * duration))
    smoothed = 0.0
    samples: list[float] = []
    for index in range(count):
        progress = index / count
        white = rng.uniform(-1.0, 1.0)
        smoothed += (white - smoothed) * low_pass
        samples.append((white - smoothed * 0.55) * envelope(progress, 2.2) * gain)
    return samples


def periodic_noise(
    duration: float,
    sample_rate: int,
    seed: int,
    component_count: int,
    minimum_frequency: float,
    maximum_frequency: float,
) -> list[float]:
    rng = random.Random(seed)
    count = max(1, round(sample_rate * duration))
    minimum_cycles = max(1, round(minimum_frequency * duration))
    maximum_cycles = max(minimum_cycles, round(maximum_frequency * duration))
    components: list[tuple[float, float, float]] = []
    amplitude_total = 0.0
    for _ in range(component_count):
        cycles = rng.randint(minimum_cycles, maximum_cycles)
        frequency = cycles / duration
        amplitude = rng.uniform(0.45, 1.0) / math.sqrt(max(1.0, frequency / minimum_frequency))
        phase = rng.uniform(0.0, math.tau)
        components.append((frequency, amplitude, phase))
        amplitude_total += amplitude

    samples: list[float] = []
    for index in range(count):
        time = index / sample_rate
        value = sum(
            math.sin(math.tau * frequency * time + phase) * amplitude
            for frequency, amplitude, phase in components
        )
        samples.append(value / max(1.0, amplitude_total))
    return samples


def loop_texture(kind: str, duration: float, seed: int, sample_rate: int = LOOP_RATE) -> list[float]:
    if kind == "propeller":
        air = periodic_noise(duration, sample_rate, seed, 14, 90, 650)
    else:
        air = periodic_noise(duration, sample_rate, seed, 30, 45, 720)

    count = len(air)
    samples: list[float] = []
    for index in range(count):
        time = index / sample_rate
        if kind == "propeller":
            pulse = 0.55 + 0.45 * max(0.0, math.sin(math.tau * 8 * time)) ** 2
            tone = math.sin(math.tau * 280 * time) * 0.17
            tone += math.sin(math.tau * 360 * time) * 0.055
            value = (tone + air[index] * 0.045) * pulse
        else:
            gust = 0.72 + 0.1 * math.sin(math.tau * time / duration)
            value = air[index] * gust * 0.16
        samples.append(value)
    return samples


def save(name: str, samples: list[float], sample_rate: int = RATE) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    peak = max(1.0, max(abs(value) for value in samples))
    frames = b"".join(
        struct.pack("<h", round(max(-1.0, min(1.0, value / peak)) * 30_000))
        for value in samples
    )
    with wave.open(str(OUTPUT / name), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        audio.writeframes(frames)


def main() -> None:
    cues = {
        "start.wav": mix(sweep(480, 760, 0.16), sweep(720, 1040, 0.16)),
        "jump.wav": sweep(255, 330, 0.10, 4.8),
        "spring.wav": sweep(175, 690, 0.22, 2.8),
        "pickup.wav": mix(sweep(610, 930, 0.13), sweep(820, 1180, 0.13)),
        "medal.wav": mix(sweep(850, 1260, 0.13), sweep(1130, 1510, 0.13)),
        "shield.wav": mix(sweep(380, 720, 0.18), sweep(520, 900, 0.18)),
        "shield-hit.wav": mix(sweep(230, 90, 0.18, 4.6), noise_burst(0.18, 17, 0.18, 0.24)),
        "shot.wav": mix(sweep(730, 1040, 0.07, 6.5), noise_burst(0.07, 31, 0.2, 0.18)),
        "hit.wav": mix(sweep(160, 70, 0.14, 5.2), noise_burst(0.14, 47, 0.16, 0.28)),
        "break.wav": mix(sweep(150, 55, 0.16, 5.0), noise_burst(0.16, 59, 0.12, 0.36)),
        "death.wav": sweep(280, 75, 0.42, 2.3),
        "sword-start.wav": mix(sweep(450, 920, 0.24, 2.2), noise_burst(0.24, 71, 0.1, 0.30)),
        "propeller-loop.wav": loop_texture("propeller", 2.0, 83),
        "sword-loop.wav": loop_texture("sword", 2.0, 97),
    }
    for name, samples in cues.items():
        save(name, samples, LOOP_RATE if name.endswith("-loop.wav") else RATE)


if __name__ == "__main__":
    main()
