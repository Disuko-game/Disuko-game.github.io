import type { NewGameOptions } from "./game/types";

const DEFAULT_ROOT_FONT_SIZE_PX = 16;

export const TABLETOP_MIN_WIDTH_REM = 32;
export const TABLETOP_MIN_HEIGHT_BY_PLAYER_COUNT_REM: Record<3 | 4, number> = {
  3: 30,
  4: 36
};

export interface TabletopViewportFit {
  playerCount: NewGameOptions["playerCount"];
  viewportWidthPx: number;
  viewportHeightPx: number;
  rootFontSizePx?: number;
}

export function isTabletopViewportSupported({
  playerCount,
  viewportWidthPx,
  viewportHeightPx,
  rootFontSizePx = DEFAULT_ROOT_FONT_SIZE_PX
}: TabletopViewportFit): boolean {
  if (playerCount < 3) {
    return true;
  }

  const remPx = Number.isFinite(rootFontSizePx) && rootFontSizePx > 0 ? rootFontSizePx : DEFAULT_ROOT_FONT_SIZE_PX;
  const minWidthPx = TABLETOP_MIN_WIDTH_REM * remPx;
  const tabletopPlayerCount = playerCount as 3 | 4;
  const minHeightRem = TABLETOP_MIN_HEIGHT_BY_PLAYER_COUNT_REM[tabletopPlayerCount];
  const minHeightPx = minHeightRem * remPx;

  return viewportWidthPx >= minWidthPx && viewportHeightPx >= minHeightPx;
}
