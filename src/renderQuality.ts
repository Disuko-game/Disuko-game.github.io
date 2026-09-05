export function renderingQuality(mobile: boolean, pixelRatio: number) {
  return {
    mobile,
    pixelRatio: Math.min(pixelRatio || 1, mobile ? 1.25 : 2),
    // Zero disables the shadow pass entirely, not just its resolution.
    shadowSize: mobile ? 0 : 2048,
    frameInterval: mobile ? 1000 / 30 : 15,
    antialias: !mobile
  };
}

export function deviceRenderingQuality() {
  return renderingQuality(matchMedia("(pointer: coarse)").matches || innerWidth <= 768, devicePixelRatio);
}
