import { useEffect, useState } from "react";
import { isTableSoundEnabled, setTableSoundEnabled } from "./tableAudio";

export function SoundToggle() {
  const [enabled, setEnabled] = useState(isTableSoundEnabled);
  useEffect(() => {
    const update = () => setEnabled(isTableSoundEnabled());
    window.addEventListener("disuko-sound-change", update);
    return () => window.removeEventListener("disuko-sound-change", update);
  }, []);
  return <button type="button" className="secondary-button" data-sound-toggle aria-pressed={enabled}
    onClick={() => setTableSoundEnabled(!enabled)}>Sound: {enabled ? "On" : "Off"}</button>;
}
