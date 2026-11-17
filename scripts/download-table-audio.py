"""Download generated ElevenLabs takes using the local, temporary URL manifest."""
import concurrent.futures
import json
from pathlib import Path
import urllib.request

root = Path('output/audio/originals')
root.mkdir(parents=True, exist_ok=True)

def download(job):
    key, index, generation = job
    path = root / f'{key}-{index}.mp3'
    if not path.exists():
        with urllib.request.urlopen(generation['content_url'], timeout=90) as response:
            path.write_bytes(response.read())
    return f'{path.name}: {path.stat().st_size}'

jobs = [(row['key'], i, generation)
        for row in json.loads(Path('output/audio/downloads.json').read_text())
        for i, generation in enumerate(row['generations']) if generation.get('content_url')]
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
    for result in executor.map(download, jobs):
        print(result)
