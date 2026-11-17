"""Build table-v2 from the user's four selected wood takes; preserve approved cues."""
import hashlib
import json
from pathlib import Path
import subprocess
import wave
import numpy as np

RATE = 48000
WEB = Path('public/audio/table-v2')
QUEST = Path('quest/DisukoMR/Assets/Resources/Audio/TableV2')
WEB.mkdir(parents=True, exist_ok=True)
QUEST.mkdir(parents=True, exist_ok=True)
previous = json.loads(Path('art/audio/table-v1.json').read_text())
preferred = json.loads(Path('output/audio/preferred-downloads.json').read_text())[1:]
collisions = json.loads(Path('output/audio/die-revision-downloads.json').read_text())
manifest = {**previous, 'version': 'table-v2', 'clips': [],
            'selection': 'User approved original ElevenLabs clips 5–8 (four wood takes), excluded clip 4. Preserve all other approved cues.'}

def decode(path):
    result = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'],
                            capture_output=True, check=True)
    return np.frombuffer(result.stdout, '<f4').copy()

def write(name, samples, metadata):
    with wave.open(str(WEB / name), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes((samples * 32767).astype('<i2').tobytes())
    record(name, metadata)

def record(name, metadata):
    data = (WEB / name).read_bytes()
    (QUEST / name).write_bytes(data)
    guid = hashlib.md5(('disuko-audio-table-v2/' + name).encode()).hexdigest()
    old_meta = Path('quest/DisukoMR/Assets/Resources/Audio/TableV1') / (name + '.meta')
    template = old_meta if old_meta.exists() else Path('quest/DisukoMR/Assets/Resources/Audio/TableV1/dice-wall-1.wav.meta')
    lines = template.read_text().splitlines()
    lines = [('guid: ' + guid) if line.startswith('guid: ') else line for line in lines]
    (QUEST / (name + '.meta')).write_text('\n'.join(lines) + '\n')
    with wave.open(str(WEB / name)) as w:
        samples = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(float) / 32768
    manifest['clips'].append({**metadata, 'file': name,
                              'duration_seconds': round(len(samples) / RATE, 5),
                              'peak_dbfs': round(float(20*np.log10(np.max(np.abs(samples)))), 2),
                              'rms_dbfs': round(float(20*np.log10(np.sqrt(np.mean(samples**2)))), 2),
                              'sha256': hashlib.sha256(data).hexdigest()})

def natural_contact(samples):
    samples -= np.mean(samples)
    peak = float(np.max(np.abs(samples)))
    audible = np.flatnonzero(np.abs(samples) > peak * .02)
    start = max(0, int(audible[0]) - 96)
    end = min(len(samples), int(audible[-1]) + 1200)
    out = samples[start:end].copy()
    out *= .75 / float(np.max(np.abs(out)))
    # Preserve the original attack and complete woody body; no strongest-peak slicing.
    fade = min(384, len(out)//4)
    out[-fade:] *= np.linspace(1, 0, fade)
    out[:48] *= np.linspace(0, 1, 48)
    return out, start / RATE

for clip in previous['clips']:
    if clip['cue'].startswith('dice-'): continue
    name = clip['file']
    (WEB / name).write_bytes((Path('public/audio/table-v1') / name).read_bytes())
    record(name, clip)

for index, generation in enumerate(preferred):
    samples, start = natural_contact(decode(Path(f'output/audio/originals/dice-wall-{index}.mp3')))
    for kind in ('floor', 'wall'):
        name = f'dice-{kind}-{index+1}.wav'
        write(name, samples, {'cue': f'dice-{kind}', 'generation_id': generation['id'], 'prompt': generation['prompt'],
                              'original_result_number': index + 5, 'user_approved': True,
                              'trim_start_seconds': round(start, 5)})

choices = []
for index, generation in enumerate(collisions):
    path = Path(f'output/audio/originals/dice-collision-new-{index}.mp3')
    if not path.exists(): continue
    samples, start = natural_contact(decode(path))
    crest = float(np.max(np.abs(samples)) / np.sqrt(np.mean(samples**2)))
    choices.append((crest, generation, samples, start))
choices.sort(key=lambda item: item[0], reverse=True)
for number, (_, generation, samples, start) in enumerate(choices[:3], 1):
    write(f'dice-die-{number}.wav', samples, {'cue': 'dice-die', 'generation_id': generation['id'],
                                            'prompt': generation['prompt'], 'trim_start_seconds': round(start, 5)})
assert len(manifest['clips']) == 25
Path('art/audio/table-v2.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Prepared 25 table-v2 files, {sum(p.stat().st_size for p in WEB.glob("*.wav")):,} bytes; approved cues unchanged.')
