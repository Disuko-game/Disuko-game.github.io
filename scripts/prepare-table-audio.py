"""Edit ElevenLabs takes into a shared, bounded, attack-aligned PCM game library.

Original takes and signed download URLs stay in output/audio (never deploy these).
Both players ship identical mono 48 kHz / 16-bit WAV masters for fast local playback.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import wave
import numpy as np

RATE = 48000
SOURCE = Path('output/audio/originals')
WEB = Path('public/audio/table-v1')
QUEST = Path('quest/DisukoMR/Assets/Resources/Audio/TableV1')
WEB.mkdir(parents=True, exist_ok=True)
QUEST.mkdir(parents=True, exist_ok=True)
downloads = json.loads(Path('output/audio/downloads.json').read_text())

def decode(path):
    result = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(RATE),
                             '-f', 'f32le', '-'], capture_output=True, check=True)
    return np.frombuffer(result.stdout, dtype='<f4').copy()

def prepare(samples, key):
    samples -= np.mean(samples)
    peak = float(np.max(np.abs(samples)))
    if peak < 0.001: raise ValueError(f'Silent take: {key}')
    # Remove lead-in below -32 dB relative to the take, retaining a 2 ms preattack.
    audible = np.flatnonzero(np.abs(samples) > peak * 0.025)
    start = max(0, int(audible[0]) - 96)
    end = min(len(samples), int(audible[-1]) + 1200)
    limit = 0.18 if key.startswith('dice-') else {'pickup': 0.24, 'drop': 0.22, 'click': 0.12}.get(key, 3)
    if key.startswith('dice-') or key in ('drop', 'click'):
        # Extract the dominant single contact; rolling is assembled from physics events.
        hit = int(np.argmax(np.abs(samples)))
        start = max(start, hit - int(RATE * 0.012))
        # Walk back to a quiet boundary so the onset isn't clipped.
        quiet = np.flatnonzero(np.abs(samples[max(0, hit-2400):hit]) < peak * 0.025)
        if len(quiet): start = max(0, hit - 2400) + int(quiet[-1])
        start = max(0, start - 96)
    end = min(end, start + int(limit * RATE))
    out = samples[start:end].copy()
    out *= 0.75 / max(float(np.max(np.abs(out))), 1e-6)
    fade = min(len(out)//4, int(RATE * (0.018 if key.startswith('dice-') else 0.025)))
    out[-fade:] *= np.linspace(1, 0, fade)
    out[:48] *= np.linspace(0, 1, min(48, len(out)))
    return out, start / RATE

manifest = {'version': 'table-v1', 'provider': 'ElevenLabs', 'model': 'eleven_text_to_sound_v2',
            'flow_id': '3xiatL7kBXVWROQvW0aB', 'sample_rate': RATE, 'channels': 1, 'clips': []}
for row in downloads:
    key = row['key']
    candidates = []
    for index, generation in enumerate(row['generations']):
        path = SOURCE / f'{key}-{index}.mp3'
        if not path.exists(): continue
        out, start = prepare(decode(path), key)
        rms = float(np.sqrt(np.mean(out**2)))
        # Prefer a clear isolated transient over a sustained/noisy take for collision Foley.
        crest = 0.75 / max(rms, 1e-6)
        candidates.append((crest, index, generation, out, start))
    count = 3 if key.startswith('dice-') or key in ('pickup', 'drop', 'click') else 1
    candidates.sort(key=lambda item: item[0], reverse=True)
    if len(candidates) < count: raise ValueError(f'Not enough takes for {key}')
    for number, (_, index, generation, samples, start) in enumerate(candidates[:count], 1):
        name = f'{key}-{number}.wav'
        pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()
        with wave.open(str(WEB / name), 'wb') as writer:
            writer.setnchannels(1); writer.setsampwidth(2); writer.setframerate(RATE); writer.writeframes(pcm)
        data = (WEB / name).read_bytes()
        (QUEST / name).write_bytes(data)
        manifest['clips'].append({'file': name, 'cue': key, 'generation_id': generation['id'],
                                  'prompt': generation['prompt'], 'source_take': index,
                                  'trim_start_seconds': round(start, 5),
                                  'duration_seconds': round(len(samples) / RATE, 5),
                                  'peak_dbfs': round(float(20*np.log10(np.max(np.abs(samples)))), 2),
                                  'rms_dbfs': round(float(20*np.log10(np.sqrt(np.mean(samples**2)))), 2),
                                  'sha256': hashlib.sha256(data).hexdigest()})
        print(f'{name}: {len(samples)/RATE:.3f}s, source {index}, attack {start:.3f}s')
        # Preload tiny Foley clips; no streaming, spatialised mono, no lossy re-encoding.
        guid = hashlib.md5(('disuko-audio-table-v1/' + name).encode()).hexdigest()
        (QUEST / (name + '.meta')).write_text(f'''fileFormatVersion: 2
guid: {guid}
AudioImporter:
  externalObjects: {{}}
  serializedVersion: 7
  defaultSettings:
    serializedVersion: 2
    loadType: 0
    sampleRateSetting: 0
    sampleRateOverride: 48000
    compressionFormat: 0
    quality: 1
    conversionMode: 0
    preloadAudioData: 1
  platformSettingOverrides: {{}}
  forceToMono: 1
  normalize: 0
  ambisonic: 0
  loadInBackground: 0
  userData:
  assetBundleName:
  assetBundleVariant:
''')
Path('art/audio').mkdir(parents=True, exist_ok=True)
Path('art/audio/table-v1.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f"Prepared {len(manifest['clips'])} clips; total {sum(p.stat().st_size for p in WEB.glob('*.wav')):,} bytes")
