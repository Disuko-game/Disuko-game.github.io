import { describe, expect, it } from "vitest";
import { isTabletopViewportSupported } from "./tabletopFit";

describe("tabletop viewport fit", () => {
  it("allows two-player tabletop on small screens", () => {
    expect(
      isTabletopViewportSupported({
        playerCount: 2,
        viewportWidthPx: 320,
        viewportHeightPx: 480
      })
    ).toBe(true);
  });

  it("blocks three-player tabletop below the width threshold", () => {
    expect(
      isTabletopViewportSupported({
        playerCount: 3,
        viewportWidthPx: 511,
        viewportHeightPx: 600,
        rootFontSizePx: 16
      })
    ).toBe(false);
  });

  it("blocks three-player tabletop below the height threshold", () => {
    expect(
      isTabletopViewportSupported({
        playerCount: 3,
        viewportWidthPx: 700,
        viewportHeightPx: 479,
        rootFontSizePx: 16
      })
    ).toBe(false);
  });

  it("blocks four-player tabletop below the taller height threshold", () => {
    expect(
      isTabletopViewportSupported({
        playerCount: 4,
        viewportWidthPx: 700,
        viewportHeightPx: 575,
        rootFontSizePx: 16
      })
    ).toBe(false);
  });

  it("allows three- and four-player tabletop on tablet or desktop dimensions", () => {
    expect(
      isTabletopViewportSupported({
        playerCount: 3,
        viewportWidthPx: 1024,
        viewportHeightPx: 768,
        rootFontSizePx: 16
      })
    ).toBe(true);
    expect(
      isTabletopViewportSupported({
        playerCount: 4,
        viewportWidthPx: 1024,
        viewportHeightPx: 768,
        rootFontSizePx: 16
      })
    ).toBe(true);
  });
});
