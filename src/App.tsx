import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { cellsForBox } from "./game/geometry";
import {
  challengeViolation,
  conflictCellKeys,
  conflictDieIds,
  currentPlayer,
  getDieAt,
  isOnBoard,
  moveDie,
  newGame,
  offBoardDice,
  placeDie,
  recentBoardChangesForCurrentTurn,
  rerollDice,
  restoreGame,
  selectDie,
  serializeGame,
  setSelectedRerollDice,
  setMode,
  wasDieMovedThisTurn,
  wouldPlaceDieConflict
} from "./game/engine";
import { groupDiceByValue, type DiceValueGroup } from "./game/diceOrdering";
import { BOARD_SIZE, DICE_VALUES, type ActionMode, type DiceValue, type Die, type GameState, type Player, type PlayerColor } from "./game/types";
import { isTabletopViewportSupported } from "./tabletopFit";

const STORAGE_KEY = "disuko-save-v1";
const DRAG_THRESHOLD_PX = 8;
const REROLL_STACK_LONG_PRESS_MS = 450;
const INVALID_MOVE_ANIMATION_MS = 2160;
const COMPLETION_HIGHLIGHT_MS = 780;
const COMPLETION_BONUS_MS = 980;
const COMPACT_TRAY_INITIAL_HEIGHT_PX = 720;
const COMPACT_TRAY_RELEASE_MARGIN_PX = 96;
const CONFETTI_COLORS = ["#fff1bf", "#f4b515", "#08a832", "#0878d6", "#e43322"] as const;
const logoUrl = `${import.meta.env.BASE_URL}logo.png`;
const boardIndexes = Array.from({ length: 36 }, (_, index) => ({
  row: Math.floor(index / 6),
  col: index % 6
}));
const confettiPieces = Array.from({ length: 64 }, (_, index) => ({
  id: index,
  laneOffset: (((index * 37) % 101) / 100 - 0.5) * 2,
  landingOffset: (((index * 53) % 101) / 100 - 0.5) * 2,
  delayMs: (index % 16) * 64,
  durationMs: 1820 + (index % 6) * 130,
  widthRem: 0.28 + (index % 3) * 0.08,
  heightRem: 0.48 + (index % 4) * 0.08,
  spinDeg: (index % 2 === 0 ? 1 : -1) * (420 + (index % 7) * 48),
  color: CONFETTI_COLORS[index % CONFETTI_COLORS.length]
}));

const pipPositions: Record<number, { col: number; row: number }> = {
  1: { col: 1, row: 1 },
  2: { col: 3, row: 1 },
  3: { col: 1, row: 2 },
  4: { col: 2, row: 2 },
  5: { col: 3, row: 2 },
  6: { col: 1, row: 3 },
  7: { col: 3, row: 3 }
};

const pipMap: Record<DiceValue, number[]> = {
  1: [4],
  2: [1, 7],
  3: [1, 4, 7],
  4: [1, 2, 6, 7],
  5: [1, 2, 4, 6, 7],
  6: [1, 2, 3, 5, 6, 7]
};

const playerColorCssVars: Record<PlayerColor, string> = {
  blue: "var(--blue)",
  red: "var(--red)",
  green: "var(--green)",
  yellow: "var(--yellow)"
};

type SetupStartOptions = {
  playerCount: 2 | 3 | 4;
  tabletopMode: boolean;
};

type TabletopSlot = "top" | "right" | "bottom" | "left";
type CompletionRewardPhase = "highlight" | "bonus";

interface ViewportSize {
  width: number;
  height: number;
  rootFontSizePx: number;
}

interface InvalidPlacementPreview {
  id: number;
  die: Die;
  playerId: string;
  startX: number;
  startY: number;
  returnX: number;
  returnY: number;
}

interface TrackedTurn {
  seed: string;
  turnNumber: number;
  currentPlayerIndex: number;
}

type DragPointerEvent = {
  pointerId: number;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
};

interface QueuedCompletionReward {
  playerId: string;
  completedKeys: string[];
}

interface CompletionReward extends QueuedCompletionReward {
  id: number;
  activeIndex: number;
  phase: CompletionRewardPhase;
}

interface BoardCompletionReward {
  id: number;
  activeKey: string | null;
  bonusActions: number | null;
  color: string;
  playerSlot?: TabletopSlot;
}

interface BoardInvalidMoveMessage {
  id: number;
  color: string;
  playerSlot?: TabletopSlot;
}

interface WinnerCelebrationLayout {
  playerId: string;
  playerNumber: number;
  color: string;
  playerSlot: TabletopSlot;
  trayX: number;
  trayY: number;
  trayWidth: number;
  trayHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

interface CompletionSegment {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  outline: "area" | "die";
}

export default function App(): ReactElement {
  const [booting, setBooting] = useState(true);
  const [game, setGame] = useState<GameState | null>(() => loadSavedGame());
  const [showSetup, setShowSetup] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), 900);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!game) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, serializeGame(game));
  }, [game]);

  const startGame = ({ playerCount, tabletopMode }: SetupStartOptions) => {
    setGame(newGame({ playerCount, tabletopMode }));
    setShowSetup(false);
    setShowMenu(false);
  };

  if (booting) {
    return <SplashScreen />;
  }

  if (!game || showSetup) {
    return <SetupScreen onStart={startGame} onCancel={game ? () => setShowSetup(false) : undefined} />;
  }

  return (
    <GameScreen
      game={game}
      onCommit={setGame}
      onOpenMenu={() => setShowMenu(true)}
      onNewGame={() => setShowSetup(true)}
    >
      {showMenu && !game.tabletopMode ? (
        <MenuOverlay
          game={game}
          onResume={() => setShowMenu(false)}
          onNewGame={() => {
            setShowMenu(false);
            setShowSetup(true);
          }}
        />
      ) : null}
    </GameScreen>
  );
}

function SplashScreen(): ReactElement {
  return (
    <main className="splash-screen" aria-label="Loading Disuko">
      <div className="splash-mark">
        <img src={logoUrl} alt="Disuko" />
      </div>
      <div className="splash-dice" aria-hidden="true">
        <span className="loader-die loader-die-blue" />
        <span className="loader-die loader-die-red" />
      </div>
    </main>
  );
}

function getViewportSize(): ViewportSize {
  if (typeof window === "undefined") {
    return {
      width: Number.POSITIVE_INFINITY,
      height: Number.POSITIVE_INFINITY,
      rootFontSizePx: 16
    };
  }

  const rootFontSizePx = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);

  return {
    width: window.innerWidth,
    height: window.innerHeight,
    rootFontSizePx: Number.isFinite(rootFontSizePx) && rootFontSizePx > 0 ? rootFontSizePx : 16
  };
}

function useViewportSize(): ViewportSize {
  const [viewportSize, setViewportSize] = useState<ViewportSize>(() => getViewportSize());

  useEffect(() => {
    const updateViewportSize = () => setViewportSize(getViewportSize());

    updateViewportSize();
    window.addEventListener("resize", updateViewportSize);
    window.addEventListener("orientationchange", updateViewportSize);

    return () => {
      window.removeEventListener("resize", updateViewportSize);
      window.removeEventListener("orientationchange", updateViewportSize);
    };
  }, []);

  return viewportSize;
}

function SetupScreen({
  onStart,
  onCancel
}: {
  onStart: (options: SetupStartOptions) => void;
  onCancel?: () => void;
}): ReactElement {
  const [playerCount, setPlayerCount] = useState<2 | 3 | 4>(2);
  const [tabletopMode, setTabletopMode] = useState(false);
  const viewportSize = useViewportSize();
  const tabletopViewportSupported = isTabletopViewportSupported({
    playerCount,
    viewportWidthPx: viewportSize.width,
    viewportHeightPx: viewportSize.height,
    rootFontSizePx: viewportSize.rootFontSizePx
  });
  const tabletopBlockedByViewport = playerCount >= 3 && !tabletopViewportSupported;

  useEffect(() => {
    if (tabletopMode && tabletopBlockedByViewport) {
      setTabletopMode(false);
    }
  }, [tabletopBlockedByViewport, tabletopMode]);

  return (
    <main className="setup-screen">
      <section className="setup-panel" aria-labelledby="setup-title">
        <img className="setup-logo" src={logoUrl} alt="Disuko" />
        <h1 id="setup-title">Pass-and-play Disuko</h1>
        <p className="setup-copy">
          Race to place your dice on a 6x6 Sudoku board. Duplicates can stay on the table until
          another player challenges them.
        </p>

        <div className="count-selector" role="group" aria-label="Player count">
          {[2, 3, 4].map((count) => (
            <button
              className={playerCount === count ? "is-active" : ""}
              key={count}
              type="button"
              onClick={() => setPlayerCount(count as 2 | 3 | 4)}
            >
              {count} players
            </button>
          ))}
        </div>

        {tabletopBlockedByViewport ? (
          <p className="setup-warning" role="status">
            This device dimensions are not compatible with tabletop mode for more than 2 players.
          </p>
        ) : (
          <label className={`tabletop-toggle ${tabletopMode ? "is-active" : ""}`}>
            <span>Table top mode</span>
            <input
              type="checkbox"
              checked={tabletopMode}
              onChange={(event) => setTabletopMode(event.currentTarget.checked)}
            />
            <span className="toggle-track" aria-hidden="true">
              <span />
            </span>
          </label>
        )}

        <div className="setup-actions">
          {onCancel ? (
            <button className="secondary-button" type="button" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
          <button className="primary-button" type="button" onClick={() => onStart({ playerCount, tabletopMode })}>
            Start game
          </button>
        </div>
      </section>
    </main>
  );
}

function GameScreen({
  game,
  onCommit,
  onOpenMenu,
  onNewGame,
  children
}: {
  game: GameState;
  onCommit: (game: GameState) => void;
  onOpenMenu: () => void;
  onNewGame: () => void;
  children: ReactNode;
}): ReactElement {
  const [openRerollValue, setOpenRerollValue] = useState<DiceValue | null>(null);
  const [hasExplicitRerollSelection, setHasExplicitRerollSelection] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ die: Die; x: number; y: number } | null>(null);
  const [invalidPlacement, setInvalidPlacement] = useState<InvalidPlacementPreview | null>(null);
  const [completionReward, setCompletionReward] = useState<CompletionReward | null>(null);
  const [winnerCelebration, setWinnerCelebration] = useState<WinnerCelebrationLayout | null>(null);
  const [turnPromptOpen, setTurnPromptOpen] = useState(false);
  const [compactTrayLayout, setCompactTrayLayout] = useState(() => {
    const viewport = getViewportSize();

    return !game.tabletopMode && game.players.length >= 3 && viewport.height <= COMPACT_TRAY_INITIAL_HEIGHT_PX;
  });
  const shellRef = useRef<HTMLElement | null>(null);
  const invalidPlacementId = useRef(0);
  const invalidPlacementTimer = useRef<number | null>(null);
  const completionRewardId = useRef(0);
  const completionRewardActive = useRef(false);
  const completionRewardQueue = useRef<QueuedCompletionReward[]>([]);
  const completionRewardSignature = useRef<string | null>(completionActionSignature(game));
  const trackedTurn = useRef<TrackedTurn>({
    seed: game.seed,
    turnNumber: game.turnNumber,
    currentPlayerIndex: game.currentPlayerIndex
  });
  const dragCandidate = useRef<{
    dieId: string;
    pointerId: number;
    startX: number;
    startY: number;
    isDragging: boolean;
  } | null>(null);
  const clearDragListenersRef = useRef<(() => void) | null>(null);
  const stackLongPress = useRef<{
    pointerId: number;
    value: DiceValue;
    startX: number;
    startY: number;
    timer: number;
    fired: boolean;
  } | null>(null);
  const suppressNextClick = useRef(false);
  const activePlayer = currentPlayer(game);
  const actionCountLabel = `${game.actionCredits} action${game.actionCredits === 1 ? "" : "s"}`;
  const trayStatusLabel = game.mode === "reroll" ? "Select the dice to re-roll" : actionCountLabel;
  const activePlayerNumber = game.currentPlayerIndex + 1;
  const activePlayerColor = playerColorCssVars[activePlayer.color];
  const winner = game.winnerId ? game.players.find((player) => player.id === game.winnerId) : undefined;
  const conflictDice = useMemo(() => conflictDieIds(game), [game]);
  const conflictCells = useMemo(() => conflictCellKeys(game), [game]);
  const invalidPlacementPlayer = invalidPlacement
    ? game.players.find((player) => player.id === invalidPlacement.playerId)
    : undefined;
  const invalidMoveMessage: BoardInvalidMoveMessage | null = invalidPlacement
    ? {
        id: invalidPlacement.id,
        color: invalidPlacementPlayer ? playerColorCssVars[invalidPlacementPlayer.color] : activePlayerColor,
        playerSlot: game.tabletopMode ? tabletopSlotForPlayer(game, invalidPlacement.playerId) : undefined
      }
    : null;
  const rewardPlayer = completionReward
    ? game.players.find((player) => player.id === completionReward.playerId)
    : undefined;
  const completionRewardOverlay: BoardCompletionReward | null = completionReward
    ? {
        id: completionReward.id,
        activeKey:
          completionReward.phase === "highlight" ? completionReward.completedKeys[completionReward.activeIndex] : null,
        bonusActions: completionReward.phase === "bonus" ? completionReward.completedKeys.length : null,
        color: rewardPlayer ? playerColorCssVars[rewardPlayer.color] : activePlayerColor,
        playerSlot: game.tabletopMode ? tabletopSlotForPlayer(game, completionReward.playerId) : undefined
      }
    : null;
  const recentMoveHighlights = useMemo(() => {
    const playerColors = new Map(game.players.map((player) => [player.id, player.color]));
    const highlights = new Map<string, PlayerColor>();

    recentBoardChangesForCurrentTurn(game).forEach((change) => {
      const color = playerColors.get(change.playerId);

      if (color) {
        highlights.set(change.dieId, color);
      }
    });

    return highlights;
  }, [game]);
  const selectedDie = game.dice.find((die) => game.selectedDieIds.includes(die.id));
  const currentTrayGroups = useMemo(
    () => groupDiceByValue(offBoardDice(game, activePlayer.id)),
    [game, activePlayer.id]
  );
  const selectedDieIdSet = useMemo(() => new Set(game.selectedDieIds), [game.selectedDieIds]);
  const transientDieId = dragPreview?.die.id ?? invalidPlacement?.die.id ?? null;

  useLayoutEffect(() => {
    if (game.tabletopMode || game.players.length < 3) {
      setCompactTrayLayout(false);
      return;
    }

    const shell = shellRef.current;

    if (!shell) {
      return;
    }

    let animationFrame = 0;

    const measureLayout = () => {
      const opponentTray = shell.querySelector<HTMLElement>(".opponent-tray-zone");
      const board = shell.querySelector<HTMLElement>(".board-wrap");
      const activeTray = shell.querySelector<HTMLElement>(".side-stack");

      if (!opponentTray || !board || !activeTray) {
        return;
      }

      const visualViewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const viewportHeight = Math.min(window.innerHeight, visualViewportHeight);
      const shellRect = shell.getBoundingClientRect();
      const opponentRect = opponentTray.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();
      const activeTrayRect = activeTray.getBoundingClientRect();
      const shellHeight = Math.min(shellRect.height, viewportHeight - Math.max(0, shellRect.top));
      const contentBottom = Math.max(boardRect.bottom, activeTrayRect.bottom, opponentRect.bottom) - shellRect.top;
      const topCollision = boardRect.top < opponentRect.bottom + 4;
      const bottomCollision = activeTrayRect.top < boardRect.bottom + 4;
      const overflow = contentBottom > shellHeight + 2;

      setCompactTrayLayout((current) => {
        const releaseStillTight = current && contentBottom > shellHeight - COMPACT_TRAY_RELEASE_MARGIN_PX;
        const shouldCompact = topCollision || bottomCollision || overflow || releaseStillTight;

        return current === shouldCompact ? current : shouldCompact;
      });
    };

    const queueMeasure = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        measureLayout();
      });
    };

    queueMeasure();

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(queueMeasure);
    resizeObserver?.observe(shell);
    window.addEventListener("resize", queueMeasure);
    window.addEventListener("orientationchange", queueMeasure);
    window.visualViewport?.addEventListener("resize", queueMeasure);

    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }

      resizeObserver?.disconnect();
      window.removeEventListener("resize", queueMeasure);
      window.removeEventListener("orientationchange", queueMeasure);
      window.visualViewport?.removeEventListener("resize", queueMeasure);
    };
  }, [
    game.currentPlayerIndex,
    game.mode,
    game.players.length,
    game.selectedDieIds.length,
    game.tabletopMode,
    openRerollValue,
    currentTrayGroups.length
  ]);

  const clearInvalidPlacement = () => {
    if (invalidPlacementTimer.current !== null) {
      window.clearTimeout(invalidPlacementTimer.current);
      invalidPlacementTimer.current = null;
    }

    setInvalidPlacement(null);
  };

  const showCompletionReward = (reward: QueuedCompletionReward) => {
    completionRewardId.current += 1;
    completionRewardActive.current = true;
    setCompletionReward({
      id: completionRewardId.current,
      playerId: reward.playerId,
      completedKeys: reward.completedKeys,
      activeIndex: 0,
      phase: "highlight"
    });
  };

  const clearDragListeners = () => {
    clearDragListenersRef.current?.();
    clearDragListenersRef.current = null;
  };

  const clearDragState = () => {
    dragCandidate.current = null;
    setDragPreview(null);
    clearDragListeners();
  };

  const clearStackLongPress = () => {
    if (!stackLongPress.current) {
      return;
    }

    window.clearTimeout(stackLongPress.current.timer);
    stackLongPress.current = null;
  };

  useEffect(() => {
    return () => {
      if (invalidPlacementTimer.current !== null) {
        window.clearTimeout(invalidPlacementTimer.current);
      }

      clearStackLongPress();
      clearDragListeners();
    };
  }, []);

  useEffect(() => {
    completionRewardQueue.current = [];
    completionRewardActive.current = false;
    completionRewardSignature.current = completionActionSignature(game);
    setCompletionReward(null);
  }, [game.seed]);

  useEffect(() => {
    const signature = completionActionSignature(game);
    const lastAction = game.lastAction;

    if (!signature || signature === completionRewardSignature.current || !lastAction) {
      return;
    }

    completionRewardSignature.current = signature;

    const reward = {
      playerId: lastAction.playerId,
      completedKeys: [...lastAction.completedKeys]
    };

    if (completionRewardActive.current) {
      completionRewardQueue.current.push(reward);
      return;
    }

    showCompletionReward(reward);
  }, [game]);

  useEffect(() => {
    if (!completionReward) {
      return;
    }

    const timer = window.setTimeout(
      () => {
        setCompletionReward((current) => {
          if (!current || current.id !== completionReward.id) {
            return current;
          }

          if (current.phase === "highlight" && current.activeIndex < current.completedKeys.length - 1) {
            return {
              ...current,
              activeIndex: current.activeIndex + 1
            };
          }

          if (current.phase === "highlight") {
            return {
              ...current,
              phase: "bonus"
            };
          }

          const nextReward = completionRewardQueue.current.shift();

          if (nextReward) {
            completionRewardId.current += 1;
            return {
              id: completionRewardId.current,
              playerId: nextReward.playerId,
              completedKeys: nextReward.completedKeys,
              activeIndex: 0,
              phase: "highlight"
            };
          }

          completionRewardActive.current = false;
          return null;
        });
      },
      completionReward.phase === "highlight" ? COMPLETION_HIGHLIGHT_MS : COMPLETION_BONUS_MS
    );

    return () => window.clearTimeout(timer);
  }, [completionReward]);

  useEffect(() => {
    const previous = trackedTurn.current;
    const isDifferentGame = previous.seed !== game.seed;
    const didAdvanceTurn =
      !isDifferentGame &&
      game.phase === "playing" &&
      (previous.turnNumber !== game.turnNumber || previous.currentPlayerIndex !== game.currentPlayerIndex);

    trackedTurn.current = {
      seed: game.seed,
      turnNumber: game.turnNumber,
      currentPlayerIndex: game.currentPlayerIndex
    };

    if (isDifferentGame || game.phase !== "playing") {
      setTurnPromptOpen(false);
      return;
    }

    if (didAdvanceTurn) {
      clearDragState();
      setOpenRerollValue(null);
      setHasExplicitRerollSelection(false);
      clearStackLongPress();
      setTurnPromptOpen(!game.tabletopMode);
    }
  }, [game.seed, game.turnNumber, game.currentPlayerIndex, game.phase, game.tabletopMode]);

  useEffect(() => {
    if (game.mode !== "reroll") {
      setOpenRerollValue(null);
      setHasExplicitRerollSelection(false);
      clearStackLongPress();
    }
  }, [game.mode]);

  useEffect(() => {
    setOpenRerollValue(null);
    setHasExplicitRerollSelection(false);
    clearStackLongPress();
  }, [activePlayer.id]);

  useEffect(() => {
    if (openRerollValue && !currentTrayGroups.some((group) => group.value === openRerollValue)) {
      setOpenRerollValue(null);
    }
  }, [currentTrayGroups, openRerollValue]);

  useLayoutEffect(() => {
    if (game.phase !== "won" || !winner) {
      setWinnerCelebration(null);
      return;
    }

    const updateWinnerCelebration = () => {
      const tray = document.querySelector<HTMLElement>(`.dice-tray[data-player-id="${winner.id}"]`);
      const trayRect = tray?.getBoundingClientRect();
      const playerSlot = game.tabletopMode ? tabletopSlotForPlayer(game, winner.id) : "bottom";
      const fallbackX = window.innerWidth / 2;
      const fallbackY =
        playerSlot === "top"
          ? window.innerHeight * 0.12
          : playerSlot === "left" || playerSlot === "right"
            ? window.innerHeight / 2
            : window.innerHeight * 0.86;
      const playerIndex = game.players.findIndex((player) => player.id === winner.id);

      setWinnerCelebration({
        playerId: winner.id,
        playerNumber: playerIndex + 1,
        color: playerColorCssVars[winner.color],
        playerSlot,
        trayX: trayRect ? trayRect.left + trayRect.width / 2 : fallbackX,
        trayY: trayRect ? trayRect.top + trayRect.height / 2 : fallbackY,
        trayWidth: trayRect?.width ?? 220,
        trayHeight: trayRect?.height ?? 84,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      });
    };

    updateWinnerCelebration();
    window.addEventListener("resize", updateWinnerCelebration);
    window.addEventListener("orientationchange", updateWinnerCelebration);

    return () => {
      window.removeEventListener("resize", updateWinnerCelebration);
      window.removeEventListener("orientationchange", updateWinnerCelebration);
    };
  }, [game, winner]);

  useEffect(() => {
    if (!openRerollValue) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (target instanceof Element && target.closest(".dice-tray, .stack-reroll-picker")) {
        return;
      }

      setOpenRerollValue(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openRerollValue]);

  const commitMode = (mode: ActionMode) => onCommit(setMode(game, mode));

  const handleOpenMenu = () => {
    clearInvalidPlacement();
    onOpenMenu();
  };

  const handleNewGame = () => {
    clearInvalidPlacement();
    onNewGame();
  };

  const showInvalidPlacement = (die: Die, row: number, col: number) => {
    if (invalidPlacementTimer.current !== null) {
      window.clearTimeout(invalidPlacementTimer.current);
    }

    const cell = document.querySelector<HTMLElement>(`.board-cell[data-row="${row}"][data-col="${col}"]`);
    const tray =
      document.querySelector<HTMLElement>(`.dice-tray[data-player-id="${activePlayer.id}"]`) ??
      document.querySelector<HTMLElement>(".dice-tray");
    const cellRect = cell?.getBoundingClientRect();
    const trayRect = tray?.getBoundingClientRect();
    const startX = cellRect ? cellRect.left + cellRect.width / 2 : window.innerWidth / 2;
    const startY = cellRect ? cellRect.top + cellRect.height / 2 : window.innerHeight / 2;
    const endX = trayRect ? trayRect.left + trayRect.width / 2 : startX;
    const endY = trayRect ? trayRect.top + trayRect.height / 2 : startY + window.innerHeight * 0.28;
    const id = invalidPlacementId.current + 1;

    invalidPlacementId.current = id;
    setInvalidPlacement({
      id,
      die,
      playerId: activePlayer.id,
      startX,
      startY,
      returnX: endX - startX,
      returnY: endY - startY
    });
    invalidPlacementTimer.current = window.setTimeout(() => {
      setInvalidPlacement((current) => (current?.id === id ? null : current));
      invalidPlacementTimer.current = null;
    }, INVALID_MOVE_ANIMATION_MS);
  };

  const selectedCountForGroup = (group: DiceValueGroup) =>
    group.dice.filter((die) => game.selectedDieIds.includes(die.id)).length;

  const setRerollStackCount = (group: DiceValueGroup, count: number) => {
    const nextCount = Math.max(0, Math.min(group.count, count));
    const selectedIds = new Set(game.selectedDieIds);

    group.dice.forEach((die) => selectedIds.delete(die.id));
    group.dice.slice(0, nextCount).forEach((die) => selectedIds.add(die.id));

    setHasExplicitRerollSelection(true);
    onCommit(setSelectedRerollDice(game, [...selectedIds]));
  };

  const handleTrayGroup = (group: DiceValueGroup) => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }

    if (game.mode === "reroll") {
      setRerollStackCount(group, selectedCountForGroup(group) + 1);
      setOpenRerollValue(group.count > 1 ? group.value : null);
      return;
    }

    onCommit(selectDie(setMode(game, "place"), group.representativeDie.id));
  };

  const handleRerollStackPointerDown = (event: ReactPointerEvent<HTMLElement>, group: DiceValueGroup) => {
    if (game.mode !== "reroll" || game.phase === "won") {
      return;
    }

    clearStackLongPress();

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The timer still handles the hold if pointer capture is unavailable.
    }

    stackLongPress.current = {
      pointerId: event.pointerId,
      value: group.value,
      startX: event.clientX,
      startY: event.clientY,
      timer: window.setTimeout(() => {
        const current = stackLongPress.current;

        if (!current || current.pointerId !== event.pointerId || current.value !== group.value) {
          return;
        }

        current.fired = true;
        suppressNextClick.current = true;
        setRerollStackCount(group, group.count);
        setOpenRerollValue(null);
        window.setTimeout(() => {
          suppressNextClick.current = false;
        }, 0);
      }, REROLL_STACK_LONG_PRESS_MS),
      fired: false
    };
  };

  const handleRerollStackPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = stackLongPress.current;

    if (!current || current.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);

    if (distance >= DRAG_THRESHOLD_PX) {
      clearStackLongPress();
    }
  };

  const handleRerollStackPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const current = stackLongPress.current;

    if (!current || current.pointerId !== event.pointerId) {
      return;
    }

    const fired = current.fired;
    clearStackLongPress();

    if (fired) {
      event.preventDefault();
      suppressNextClick.current = true;
      window.setTimeout(() => {
        suppressNextClick.current = false;
      }, 0);
    }
  };

  const handleRerollStackPointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
    if (stackLongPress.current?.pointerId === event.pointerId) {
      clearStackLongPress();
    }
  };

  const handleBoardDie = (die: Die) => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }

    if (game.phase === "won") {
      return;
    }

    if (conflictDice.has(die.id)) {
      onCommit(challengeViolation(game, die.id));
      return;
    }

    if (isOnBoard(die) && wasDieMovedThisTurn(game, die.id)) {
      return;
    }

    onCommit(selectDie(setMode(game, "move"), die.id));
  };

  const commitDieToCell = (die: Die, row: number, col: number) => {
    const cellDie = getDieAt(game, row, col);

    if (cellDie?.id === die.id) {
      return;
    }

    if (isOnBoard(die)) {
      onCommit(moveDie(game, die.id, row, col));
      return;
    }

    if (wouldPlaceDieConflict(game, die.id, row, col)) {
      showInvalidPlacement(die, row, col);
      onCommit(placeDie(game, die.id, row, col));
      return;
    }

    onCommit(placeDie(game, die.id, row, col));
  };

  const handleCell = (row: number, col: number) => {
    const cellDie = getDieAt(game, row, col);

    if (cellDie) {
      handleBoardDie(cellDie);
      return;
    }

    if (!selectedDie) {
      return;
    }

    if (game.mode === "move" && isOnBoard(selectedDie)) {
      commitDieToCell(selectedDie, row, col);
      return;
    }

    if (game.mode === "place" && !isOnBoard(selectedDie)) {
      commitDieToCell(selectedDie, row, col);
    }
  };

  const handleDiePointerDown = (event: ReactPointerEvent<HTMLElement>, die: Die) => {
    if (game.phase === "won") {
      return;
    }

    if (isOnBoard(die) && wasDieMovedThisTurn(game, die.id)) {
      return;
    }

    clearDragListeners();
    dragCandidate.current = {
      dieId: die.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      isDragging: false
    };

    const handleDocumentPointerMove = (pointerEvent: PointerEvent) => handleDiePointerMove(pointerEvent);
    const handleDocumentPointerUp = (pointerEvent: PointerEvent) => handleDiePointerUp(pointerEvent);
    const handleDocumentPointerCancel = (pointerEvent: PointerEvent) => handleDiePointerCancel(pointerEvent);

    document.addEventListener("pointermove", handleDocumentPointerMove, { passive: false });
    document.addEventListener("pointerup", handleDocumentPointerUp, { passive: false });
    document.addEventListener("pointercancel", handleDocumentPointerCancel);
    clearDragListenersRef.current = () => {
      document.removeEventListener("pointermove", handleDocumentPointerMove);
      document.removeEventListener("pointerup", handleDocumentPointerUp);
      document.removeEventListener("pointercancel", handleDocumentPointerCancel);
    };

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Document listeners keep the drag alive if the source element cannot capture.
    }
  };

  const handleDiePointerMove = (event: DragPointerEvent) => {
    const candidate = dragCandidate.current;

    if (!candidate || candidate.pointerId !== event.pointerId) {
      return;
    }

    const die = game.dice.find((candidateDie) => candidateDie.id === candidate.dieId);

    if (!die) {
      clearDragState();
      return;
    }

    const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);

    if (!candidate.isDragging && distance < DRAG_THRESHOLD_PX) {
      return;
    }

    candidate.isDragging = true;
    event.preventDefault();
    setDragPreview({ die, x: event.clientX, y: event.clientY });
  };

  const handleDiePointerUp = (event: DragPointerEvent) => {
    const candidate = dragCandidate.current;

    if (!candidate || candidate.pointerId !== event.pointerId) {
      return;
    }

    dragCandidate.current = null;
    clearDragListeners();

    if (!candidate.isDragging) {
      setDragPreview(null);
      return;
    }

    event.preventDefault();
    suppressNextClick.current = true;
    window.setTimeout(() => {
      suppressNextClick.current = false;
    }, 0);
    setDragPreview(null);

    const die = game.dice.find((candidateDie) => candidateDie.id === candidate.dieId);
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".board-cell");
    const row = Number(target?.dataset.row);
    const col = Number(target?.dataset.col);

    if (!die || !target || !Number.isInteger(row) || !Number.isInteger(col)) {
      return;
    }

    commitDieToCell(die, row, col);
  };

  const handleDiePointerCancel = (event: DragPointerEvent) => {
    if (dragCandidate.current?.pointerId !== event.pointerId) {
      return;
    }

    clearDragState();
  };

  const handleReroll = () => {
    if (game.mode !== "reroll") {
      setOpenRerollValue(null);
      setHasExplicitRerollSelection(false);
      clearStackLongPress();
      commitMode("reroll");
      return;
    }

    setOpenRerollValue(null);
    clearStackLongPress();

    if (hasExplicitRerollSelection && game.selectedDieIds.length === 0) {
      onCommit(rerollDice(game, [], { defaultToAll: false }));
      return;
    }

    onCommit(rerollDice(game, game.selectedDieIds, { defaultToAll: !hasExplicitRerollSelection }));
    setHasExplicitRerollSelection(false);
  };

  const handleCancelReroll = () => {
    setOpenRerollValue(null);
    setHasExplicitRerollSelection(false);
    clearStackLongPress();
    onCommit(setMode(game, "place"));
  };

  const board = (
    <Board
      game={game}
      conflictDice={conflictDice}
      conflictCells={conflictCells}
      recentMoveHighlights={recentMoveHighlights}
      draggingDieId={transientDieId}
      completionReward={completionRewardOverlay}
      invalidMoveMessage={invalidMoveMessage}
      tabletopMode={game.tabletopMode}
      activePlayerColor={activePlayerColor}
      onCell={handleCell}
      onDie={handleBoardDie}
      onDiePointerDown={handleDiePointerDown}
      onDiePointerMove={handleDiePointerMove}
      onDiePointerUp={handleDiePointerUp}
      onDiePointerCancel={handleDiePointerCancel}
    />
  );

  const renderPlayerTray = (player: Player) => {
    const isActive = player.id === activePlayer.id;
    const trayMode = isActive ? game.mode : "place";
    const trayGroups = isActive ? currentTrayGroups : groupDiceByValue(offBoardDice(game, player.id));
    const disabled = !isActive || game.phase === "won";
    const rerollReady = isActive && game.mode === "reroll" && game.selectedDieIds.length > 0;

    return (
      <DiceTray
        groups={trayGroups}
        selectedIds={isActive ? selectedDieIdSet : new Set<string>()}
        player={player}
        mode={trayMode}
        draggingDieId={transientDieId}
        openRerollValue={isActive ? openRerollValue : null}
        actionCountLabel={isActive ? trayStatusLabel : "0 actions"}
        rollLabel={rerollReady ? "ready" : "re-roll"}
        rollColor={rerollReady ? "green" : "blue"}
        rollActive={rerollReady}
        disabled={disabled}
        hidePlayerName={game.tabletopMode}
        className={isActive ? "is-active-player" : undefined}
        onGroup={handleTrayGroup}
        onRoll={handleReroll}
        onCancelReroll={handleCancelReroll}
        onSetRerollCount={setRerollStackCount}
        onRerollStackPointerDown={handleRerollStackPointerDown}
        onRerollStackPointerMove={handleRerollStackPointerMove}
        onRerollStackPointerUp={handleRerollStackPointerUp}
        onRerollStackPointerCancel={handleRerollStackPointerCancel}
        onDiePointerDown={handleDiePointerDown}
        onDiePointerMove={handleDiePointerMove}
        onDiePointerUp={handleDiePointerUp}
        onDiePointerCancel={handleDiePointerCancel}
      />
    );
  };

  return (
    <main
      className={`game-shell ${game.tabletopMode ? "is-tabletop" : ""} ${
        compactTrayLayout ? "has-compact-trays" : ""
      }`}
      ref={shellRef}
      style={game.tabletopMode ? ({ "--active-player-color": activePlayerColor } as CSSProperties) : undefined}
    >
      {game.tabletopMode ? (
        <header className="tabletop-tools" aria-label="Game controls">
          <button className="new-game-chip" type="button" onClick={handleNewGame}>
            New
          </button>
        </header>
      ) : (
        <>
          <header className="game-header">
            <button className="round-icon" type="button" aria-label="Open menu" onClick={handleOpenMenu}>
              <span />
              <span />
              <span />
            </button>
            <img className="game-logo" src={logoUrl} alt="Disuko" />
            <button className="new-game-chip" type="button" onClick={handleNewGame}>
              New
            </button>
          </header>

          <OpponentTrayStrip game={game} activePlayer={activePlayer} hiddenDieId={transientDieId} />

          {board}

          <div className="side-stack">
            <section className="control-dock" aria-label="Game controls">
              {renderPlayerTray(activePlayer)}
            </section>
          </div>
        </>
      )}

      {game.tabletopMode ? <TabletopPlayArea game={game} board={board} renderTray={renderPlayerTray} /> : null}

      {dragPreview ? (
        <div className="drag-preview" style={{ left: dragPreview.x, top: dragPreview.y }} aria-hidden="true">
          <DieFace die={dragPreview.die} compact />
        </div>
      ) : null}

      {invalidPlacement ? (
        <>
          <div
            className="invalid-return-preview"
            style={
              {
                left: invalidPlacement.startX,
                top: invalidPlacement.startY,
                "--invalid-return-x": `${invalidPlacement.returnX}px`,
                "--invalid-return-y": `${invalidPlacement.returnY}px`
              } as CSSProperties
            }
            aria-hidden="true"
          >
            <DieFace die={invalidPlacement.die} compact />
          </div>
        </>
      ) : null}

      {turnPromptOpen && game.phase === "playing" && !game.tabletopMode ? (
        <TurnStartPrompt player={activePlayer} playerNumber={activePlayerNumber} onPlay={() => setTurnPromptOpen(false)} />
      ) : null}

      {winnerCelebration ? <WinnerCelebration layout={winnerCelebration} onNewGame={handleNewGame} /> : null}

      {children}
    </main>
  );
}

function TabletopPlayArea({
  game,
  board,
  renderTray
}: {
  game: GameState;
  board: ReactElement;
  renderTray: (player: Player) => ReactElement;
}): ReactElement {
  const activePlayer = currentPlayer(game);
  const slots = tabletopSlotsFor(game.players.length);

  return (
    <section className={`tabletop-play-area tabletop-count-${game.players.length}`} aria-label="Table top play area">
      <div className="tabletop-board-slot">{board}</div>
      {game.players.map((player, index) => {
        const slot = slots[index] ?? "bottom";
        const sideSlot = slot === "left" || slot === "right";

        return (
          <div
            className={`tabletop-tray-slot tabletop-slot-${slot} ${sideSlot ? "is-side" : ""} ${
              player.id === activePlayer.id ? "is-active" : ""
            }`}
            key={player.id}
            style={{ "--tray-player-color": playerColorCssVars[player.color] } as CSSProperties}
          >
            <div className="tabletop-tray-inner">{renderTray(player)}</div>
          </div>
        );
      })}
    </section>
  );
}

function tabletopSlotsFor(playerCount: number): TabletopSlot[] {
  if (playerCount === 2) {
    return ["bottom", "top"];
  }

  if (playerCount === 3) {
    return ["bottom", "left", "right"];
  }

  return ["bottom", "top", "left", "right"];
}

function tabletopSlotForPlayer(game: GameState, playerId: string): TabletopSlot {
  const playerIndex = game.players.findIndex((player) => player.id === playerId);
  const slots = tabletopSlotsFor(game.players.length);

  return slots[playerIndex] ?? "bottom";
}

function WinnerCelebration({
  layout,
  onNewGame
}: {
  layout: WinnerCelebrationLayout;
  onNewGame: () => void;
}): ReactElement {
  return (
    <div className="winner-celebration" aria-hidden={false}>
      <div className="winner-confetti-field" aria-hidden="true">
        {confettiPieces.map((piece) => (
          <span className="winner-confetti-piece" key={piece.id} style={confettiPieceStyle(piece, layout)} />
        ))}
      </div>
      <section
        className={`winner-panel faces-${layout.playerSlot}`}
        style={{ "--winner-color": layout.color } as CSSProperties}
        role="dialog"
        aria-labelledby="winner-title"
      >
        <strong id="winner-title">Player {layout.playerNumber} won!</strong>
        <button type="button" onClick={onNewGame}>
          New game
        </button>
      </section>
    </div>
  );
}

function confettiPieceStyle(
  piece: (typeof confettiPieces)[number],
  layout: WinnerCelebrationLayout
): CSSProperties {
  const path = confettiPiecePath(piece, layout);

  return {
    "--confetti-start-x": `${path.startX}px`,
    "--confetti-start-y": `${path.startY}px`,
    "--confetti-end-x": `${path.endX}px`,
    "--confetti-end-y": `${path.endY}px`,
    "--confetti-color": piece.color,
    "--confetti-delay": `${piece.delayMs}ms`,
    "--confetti-duration": `${piece.durationMs}ms`,
    "--confetti-spin": `${piece.spinDeg}deg`,
    "--confetti-width": `${piece.widthRem}rem`,
    "--confetti-height": `${piece.heightRem}rem`
  } as CSSProperties;
}

function confettiPiecePath(
  piece: (typeof confettiPieces)[number],
  layout: WinnerCelebrationLayout
): { startX: number; startY: number; endX: number; endY: number } {
  const laneSpread = Math.max(160, layout.trayWidth * 1.18);
  const landingSpread = Math.max(54, Math.min(layout.trayWidth, layout.trayHeight * 2.4));
  const laneOffset = piece.laneOffset * laneSpread;
  const landingOffset = piece.landingOffset * landingSpread * 0.48;
  const offscreen = 32;

  if (layout.playerSlot === "top") {
    return {
      startX: clamp(layout.trayX + laneOffset, -offscreen, layout.viewportWidth + offscreen),
      startY: layout.viewportHeight + offscreen,
      endX: clamp(layout.trayX + landingOffset, -offscreen, layout.viewportWidth + offscreen),
      endY: layout.trayY
    };
  }

  if (layout.playerSlot === "left") {
    return {
      startX: layout.viewportWidth + offscreen,
      startY: clamp(layout.trayY + laneOffset, -offscreen, layout.viewportHeight + offscreen),
      endX: layout.trayX,
      endY: clamp(layout.trayY + landingOffset, -offscreen, layout.viewportHeight + offscreen)
    };
  }

  if (layout.playerSlot === "right") {
    return {
      startX: -offscreen,
      startY: clamp(layout.trayY + laneOffset, -offscreen, layout.viewportHeight + offscreen),
      endX: layout.trayX,
      endY: clamp(layout.trayY + landingOffset, -offscreen, layout.viewportHeight + offscreen)
    };
  }

  return {
    startX: clamp(layout.trayX + laneOffset, -offscreen, layout.viewportWidth + offscreen),
    startY: -offscreen,
    endX: clamp(layout.trayX + landingOffset, -offscreen, layout.viewportWidth + offscreen),
    endY: layout.trayY
  };
}

function completionActionSignature(game: GameState): string | null {
  const action = game.lastAction;

  if (!action || action.completedKeys.length === 0) {
    return null;
  }

  return [
    game.seed,
    game.turnNumber,
    game.boardChanges.length,
    action.type,
    action.playerId,
    action.dieId ?? "",
    action.completedKeys.join("|")
  ].join(":");
}

function completionSegmentsForKey(key: string, game: GameState): CompletionSegment[] {
  const [kind, rawIndex] = key.split(":");
  const index = Number(rawIndex);

  if (!Number.isInteger(index)) {
    return [];
  }

  if (kind === "row" && index >= 0 && index < BOARD_SIZE) {
    return [{ row: index, col: 0, rowSpan: 1, colSpan: BOARD_SIZE, outline: "area" }];
  }

  if (kind === "column" && index >= 0 && index < BOARD_SIZE) {
    return [{ row: 0, col: index, rowSpan: BOARD_SIZE, colSpan: 1, outline: "area" }];
  }

  if (kind === "box") {
    try {
      const cells = cellsForBox(index);
      const rows = cells.map((cell) => cell.row);
      const cols = cells.map((cell) => cell.col);
      const row = Math.min(...rows);
      const col = Math.min(...cols);

      return [
        {
          row,
          col,
          rowSpan: Math.max(...rows) - row + 1,
          colSpan: Math.max(...cols) - col + 1,
          outline: "area"
        }
      ];
    } catch {
      return [];
    }
  }

  if (kind === "value" && DICE_VALUES.includes(index as DiceValue)) {
    return game.dice
      .filter((die) => isOnBoard(die) && die.value === index)
      .map((die) => ({
        row: die.row as number,
        col: die.col as number,
        rowSpan: 1,
        colSpan: 1,
        outline: "die"
      }));
  }

  return [];
}

function completionSegmentStyle(segment: CompletionSegment, color: string): CSSProperties {
  return {
    "--completion-color": color,
    "--completion-row": segment.row,
    "--completion-col": segment.col,
    "--completion-row-span": segment.rowSpan,
    "--completion-col-span": segment.colSpan
  } as CSSProperties;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function TurnStartPrompt({
  player,
  playerNumber,
  onPlay
}: {
  player: Player;
  playerNumber: number;
  onPlay: () => void;
}): ReactElement {
  return (
    <div className="turn-start-backdrop" role="dialog" aria-modal="true" aria-labelledby="turn-start-title">
      <section className={`turn-start-card turn-${player.color}`}>
        <strong id="turn-start-title">Player {playerNumber}'s turn</strong>
        <button type="button" autoFocus onClick={onPlay}>
          Play
        </button>
      </section>
    </div>
  );
}

function OpponentTrayStrip({
  game,
  activePlayer,
  hiddenDieId
}: {
  game: GameState;
  activePlayer: Player;
  hiddenDieId: string | null;
}): ReactElement {
  const opponents = game.players.filter((player) => player.id !== activePlayer.id);

  return (
    <section className="opponent-tray-zone" aria-label="Other players">
      {opponents.map((player) => {
        const playerIndex = game.players.findIndex((candidate) => candidate.id === player.id) + 1;

        return (
          <article className={`opponent-tray-row opponent-${player.color}`} key={player.id}>
            <strong>Player {playerIndex}</strong>
            <DiceRail
              groups={groupDiceByValue(offBoardDice(game, player.id))}
              draggingDieId={hiddenDieId}
              emptyLabel="No dice"
              readOnly
              className="opponent-dice-rail"
            />
          </article>
        );
      })}
    </section>
  );
}

function Board({
  game,
  conflictDice,
  conflictCells,
  recentMoveHighlights,
  draggingDieId,
  completionReward,
  invalidMoveMessage,
  tabletopMode = false,
  activePlayerColor,
  onCell,
  onDie,
  onDiePointerDown,
  onDiePointerMove,
  onDiePointerUp,
  onDiePointerCancel
}: {
  game: GameState;
  conflictDice: Set<string>;
  conflictCells: Set<string>;
  recentMoveHighlights: Map<string, PlayerColor>;
  draggingDieId: string | null;
  completionReward: BoardCompletionReward | null;
  invalidMoveMessage: BoardInvalidMoveMessage | null;
  tabletopMode?: boolean;
  activePlayerColor?: string;
  onCell: (row: number, col: number) => void;
  onDie: (die: Die) => void;
  onDiePointerDown: (event: ReactPointerEvent<HTMLElement>, die: Die) => void;
  onDiePointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onDiePointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onDiePointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}): ReactElement {
  const completionSegments = completionReward?.activeKey
    ? completionSegmentsForKey(completionReward.activeKey, game)
    : [];
  const bonusLabel = completionReward?.bonusActions
    ? `+${completionReward.bonusActions} Action${completionReward.bonusActions === 1 ? "" : "s"}`
    : null;

  return (
    <section
      className={`board-wrap ${tabletopMode ? "is-tabletop-board" : ""}`}
      style={tabletopMode ? ({ "--active-player-color": activePlayerColor } as CSSProperties) : undefined}
      aria-label="Disuko board"
    >
      <div className="board-grid" role="grid" aria-label="6 by 6 Disuko board">
        {boardIndexes.map(({ row, col }) => {
          const die = getDieAt(game, row, col);
          const recentMoveColor = die ? recentMoveHighlights.get(die.id) : undefined;
          const moveLocked = Boolean(die && game.actionCredits > 1 && wasDieMovedThisTurn(game, die.id));
          const key = `${row}:${col}`;
          const cellClasses = [
            "board-cell",
            row === 0 || row === 3 ? "thick-top" : "",
            col === 0 || col === 2 || col === 4 ? "thick-left" : "",
            row === 5 ? "thick-bottom" : "",
            col === 5 ? "thick-right" : "",
            conflictCells.has(key) ? "has-conflict" : ""
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              aria-label={`Row ${row + 1}, column ${col + 1}${die ? `, ${die.value}` : ""}`}
              className={cellClasses}
              data-col={col}
              data-row={row}
              key={key}
              role="gridcell"
              type="button"
              onClick={() => onCell(row, col)}
            >
              {die ? (
                <DieFace
                  die={die}
                  selected={game.selectedDieIds.includes(die.id)}
                  conflicted={conflictDice.has(die.id)}
                  recentMoveColor={recentMoveColor}
                  moveLocked={moveLocked}
                  draggingSource={draggingDieId === die.id}
                  onClick={() => onDie(die)}
                  onPointerDown={(event) => onDiePointerDown(event, die)}
                  onPointerMove={onDiePointerMove}
                  onPointerUp={onDiePointerUp}
                  onPointerCancel={onDiePointerCancel}
                />
              ) : null}
            </button>
          );
        })}
        {completionSegments.map((segment, index) => (
          <div
            className={`completion-highlight-segment ${segment.outline === "die" ? "is-dice-outline" : ""}`}
            key={`${completionReward?.id}-${completionReward?.activeKey}-${index}`}
            style={completionSegmentStyle(segment, completionReward?.color ?? activePlayerColor ?? "var(--cream)")}
            aria-hidden="true"
          />
        ))}
        {completionReward?.bonusActions && bonusLabel ? (
          <div
            className={`completion-bonus-pop ${
              completionReward.playerSlot ? `faces-${completionReward.playerSlot}` : ""
            }`}
            key={`${completionReward.id}-bonus`}
            style={{ "--completion-color": completionReward.color } as CSSProperties}
            role="status"
            aria-live="polite"
          >
            {bonusLabel}
          </div>
        ) : null}
        {invalidMoveMessage ? (
          <div
            className={`invalid-move-toast ${
              invalidMoveMessage.playerSlot ? `faces-${invalidMoveMessage.playerSlot}` : ""
            }`}
            key={`invalid-${invalidMoveMessage.id}`}
            style={{ "--invalid-color": invalidMoveMessage.color } as CSSProperties}
            role="status"
            aria-live="assertive"
          >
            invalid move
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DiceTray({
  groups,
  selectedIds,
  player,
  mode,
  draggingDieId,
  openRerollValue,
  actionCountLabel,
  rollLabel,
  rollColor,
  rollActive,
  disabled = false,
  hidePlayerName = false,
  className,
  onGroup,
  onRoll,
  onCancelReroll,
  onSetRerollCount,
  onRerollStackPointerDown,
  onRerollStackPointerMove,
  onRerollStackPointerUp,
  onRerollStackPointerCancel,
  onDiePointerDown,
  onDiePointerMove,
  onDiePointerUp,
  onDiePointerCancel
}: {
  groups: DiceValueGroup[];
  selectedIds: Set<string>;
  player: Player;
  mode: ActionMode;
  draggingDieId: string | null;
  openRerollValue: DiceValue | null;
  actionCountLabel: string;
  rollLabel: string;
  rollColor: "blue" | "green";
  rollActive: boolean;
  disabled?: boolean;
  hidePlayerName?: boolean;
  className?: string;
  onGroup: (group: DiceValueGroup) => void;
  onRoll: () => void;
  onCancelReroll: () => void;
  onSetRerollCount: (group: DiceValueGroup, count: number) => void;
  onRerollStackPointerDown: (event: ReactPointerEvent<HTMLElement>, group: DiceValueGroup) => void;
  onRerollStackPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onRerollStackPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onRerollStackPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onDiePointerDown: (event: ReactPointerEvent<HTMLElement>, die: Die) => void;
  onDiePointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onDiePointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onDiePointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}): ReactElement {
  return (
    <section
      className={`dice-tray ${disabled ? "is-disabled" : ""} ${className ?? ""}`}
      data-player-id={player.id}
      aria-label={hidePlayerName ? `${player.color} dice tray` : `${player.name}'s dice tray`}
    >
      <div className="tray-control-row">
        <div className="tray-dice-column">
          <div className={`tray-status-row ${mode === "reroll" ? "is-reroll-message" : ""}`} aria-live="polite">
            <span className="tray-action-counter">{actionCountLabel}</span>
          </div>
          <DiceRail
            groups={groups}
            selectedIds={selectedIds}
            draggingDieId={draggingDieId}
            emptyLabel="All dice are on the board."
            rerollMode={mode === "reroll"}
            openRerollValue={openRerollValue}
            disabled={disabled}
            onGroup={onGroup}
            onSetRerollCount={onSetRerollCount}
            onRerollStackPointerDown={onRerollStackPointerDown}
            onRerollStackPointerMove={onRerollStackPointerMove}
            onRerollStackPointerUp={onRerollStackPointerUp}
            onRerollStackPointerCancel={onRerollStackPointerCancel}
            onDiePointerDown={onDiePointerDown}
            onDiePointerMove={onDiePointerMove}
            onDiePointerUp={onDiePointerUp}
            onDiePointerCancel={onDiePointerCancel}
          />
        </div>
        <div className="tray-action-column">
          <ActionButton
            color={rollColor}
            icon={<MiniDieIcon />}
            label={rollLabel}
            active={rollActive}
            disabled={disabled}
            className="tray-roll-button"
            onClick={onRoll}
          />
          {mode === "reroll" && !disabled ? (
            <button className="reroll-cancel-button" type="button" onClick={onCancelReroll}>
              Cancel
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function DiceRail({
  groups,
  selectedIds,
  draggingDieId,
  emptyLabel,
  className,
  readOnly = false,
  disabled = false,
  rerollMode = false,
  openRerollValue = null,
  onGroup,
  onSetRerollCount,
  onRerollStackPointerDown,
  onRerollStackPointerMove,
  onRerollStackPointerUp,
  onRerollStackPointerCancel,
  onDiePointerDown,
  onDiePointerMove,
  onDiePointerUp,
  onDiePointerCancel
}: {
  groups: DiceValueGroup[];
  selectedIds?: Set<string>;
  draggingDieId?: string | null;
  emptyLabel: string;
  className?: string;
  readOnly?: boolean;
  disabled?: boolean;
  rerollMode?: boolean;
  openRerollValue?: DiceValue | null;
  onGroup?: (group: DiceValueGroup) => void;
  onSetRerollCount?: (group: DiceValueGroup, count: number) => void;
  onRerollStackPointerDown?: (event: ReactPointerEvent<HTMLElement>, group: DiceValueGroup) => void;
  onRerollStackPointerMove?: (event: ReactPointerEvent<HTMLElement>) => void;
  onRerollStackPointerUp?: (event: ReactPointerEvent<HTMLElement>) => void;
  onRerollStackPointerCancel?: (event: ReactPointerEvent<HTMLElement>) => void;
  onDiePointerDown?: (event: ReactPointerEvent<HTMLElement>, die: Die) => void;
  onDiePointerMove?: (event: ReactPointerEvent<HTMLElement>) => void;
  onDiePointerUp?: (event: ReactPointerEvent<HTMLElement>) => void;
  onDiePointerCancel?: (event: ReactPointerEvent<HTMLElement>) => void;
}): ReactElement {
  const activeRerollButton = useRef<HTMLButtonElement | null>(null);
  const [pickerPosition, setPickerPosition] = useState<{ left: number; top: number } | null>(null);
  const visibleGroups = groups
    .map((group) => {
      const visibleDice = draggingDieId ? group.dice.filter((die) => die.id !== draggingDieId) : group.dice;

      return {
        group,
        dice: visibleDice,
        representativeDie: visibleDice[0]
      };
    })
    .filter((group) => Boolean(group.representativeDie));
  const openGroup =
    rerollMode && openRerollValue !== null
      ? groups.find((group) => group.value === openRerollValue && group.count > 1)
      : undefined;
  const openSelectedCount = openGroup ? openGroup.dice.filter((die) => selectedIds?.has(die.id)).length : 0;

  useLayoutEffect(() => {
    if (!rerollMode || openRerollValue === null || !activeRerollButton.current) {
      setPickerPosition(null);
      return;
    }

    const updatePickerPosition = () => {
      const rect = activeRerollButton.current?.getBoundingClientRect();

      if (!rect) {
        setPickerPosition(null);
        return;
      }

      const pickerHalfWidth = 58;
      const centeredLeft = rect.left + rect.width / 2;

      setPickerPosition({
        left: Math.min(Math.max(centeredLeft, pickerHalfWidth), window.innerWidth - pickerHalfWidth),
        top: Math.max(0, rect.top - 6)
      });
    };

    updatePickerPosition();
    window.addEventListener("resize", updatePickerPosition);
    window.addEventListener("scroll", updatePickerPosition, true);

    return () => {
      window.removeEventListener("resize", updatePickerPosition);
      window.removeEventListener("scroll", updatePickerPosition, true);
    };
  }, [openRerollValue, rerollMode, openSelectedCount, visibleGroups.length]);

  return (
    <div className={`dice-rail-groove ${readOnly ? "is-readonly" : ""} ${className ?? ""}`}>
      {visibleGroups.length === 0 ? (
        <p className="empty-tray">{emptyLabel}</p>
      ) : (
        visibleGroups.map(({ group, dice, representativeDie }) => {
          const selectedCount = group.dice.filter((die) => selectedIds?.has(die.id)).length;
          const selected = selectedCount > 0;
          const displayCount = rerollMode ? group.count : dice.length;
          const multiplier = displayCount > 1 ? displayCount : undefined;

          if (readOnly || !onGroup || !onDiePointerDown || !onDiePointerMove || !onDiePointerUp || !onDiePointerCancel) {
            return (
              <span className="rail-die is-readonly" key={group.value}>
                <DieFace die={representativeDie} selected={selected} compact multiplier={multiplier} />
              </span>
            );
          }

          const pickerOpen = rerollMode && group.count > 1 && openRerollValue === group.value && onSetRerollCount;

          return (
            <span className={`rail-stack ${pickerOpen ? "has-picker" : ""}`} key={group.value}>
              <button
                aria-label={
                  rerollMode
                    ? `${group.value}, ${selectedCount} of ${group.count} selected to reroll`
                    : `${group.value}`
                }
                className={`rail-die ${selected ? "is-selected" : ""}`}
                ref={pickerOpen ? activeRerollButton : undefined}
                type="button"
                disabled={disabled}
                onClick={disabled ? undefined : () => onGroup(group)}
                onPointerDown={(event) =>
                  disabled
                    ? undefined
                    : rerollMode && onRerollStackPointerDown
                      ? onRerollStackPointerDown(event, group)
                      : onDiePointerDown(event, representativeDie)
                }
                onPointerMove={
                  disabled ? undefined : rerollMode && onRerollStackPointerMove ? onRerollStackPointerMove : onDiePointerMove
                }
                onPointerUp={
                  disabled ? undefined : rerollMode && onRerollStackPointerUp ? onRerollStackPointerUp : onDiePointerUp
                }
                onPointerCancel={
                  disabled
                    ? undefined
                    : rerollMode && onRerollStackPointerCancel
                      ? onRerollStackPointerCancel
                      : onDiePointerCancel
                }
                onPointerLeave={
                  disabled ? undefined : rerollMode && onRerollStackPointerCancel ? onRerollStackPointerCancel : undefined
                }
              >
                <DieFace die={representativeDie} selected={selected} compact multiplier={multiplier} />
              </button>
            </span>
          );
        })
      )}
      {openGroup && onSetRerollCount && pickerPosition
        ? createPortal(
            <StackRerollPicker
              group={openGroup}
              selectedCount={openSelectedCount}
              style={{
                left: pickerPosition.left,
                top: pickerPosition.top
              }}
              onSetCount={onSetRerollCount}
            />,
            document.body
          )
        : null}
    </div>
  );
}

function StackRerollPicker({
  group,
  selectedCount,
  style,
  onSetCount
}: {
  group: DiceValueGroup;
  selectedCount: number;
  style?: CSSProperties;
  onSetCount: (group: DiceValueGroup, count: number) => void;
}): ReactElement {
  return (
    <div
      className="stack-reroll-picker"
      role="group"
      aria-label={`Choose how many ${group.value}s to reroll`}
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button type="button" aria-label="Select fewer dice" onClick={() => onSetCount(group, selectedCount - 1)}>
        -
      </button>
      <strong>
        {selectedCount}/{group.count}
      </strong>
      <button type="button" aria-label="Select more dice" onClick={() => onSetCount(group, selectedCount + 1)}>
        +
      </button>
    </div>
  );
}

function MenuOverlay({
  game,
  onResume,
  onNewGame
}: {
  game: GameState;
  onResume: () => void;
  onNewGame: () => void;
}): ReactElement {
  return (
    <div className="menu-backdrop" role="dialog" aria-modal="true" aria-labelledby="menu-title">
      <section className="menu-panel">
        <img src={logoUrl} alt="Disuko" />
        <h2 id="menu-title">Game menu</h2>
        <p>
          Fill rows, columns, the six 2x3 boxes, and value sets to earn extra actions. Duplicates
          remain until challenged.
        </p>
        <div className="rules-grid">
          <span>Turn</span>
          <strong>{game.turnNumber}</strong>
          <span>Players</span>
          <strong>{game.players.length}</strong>
          <span>Completed sets</span>
          <strong>{game.completedKeys.length}</strong>
        </div>
        <div className="setup-actions">
          <button className="secondary-button" type="button" onClick={onNewGame}>
            New game
          </button>
          <button className="primary-button" type="button" onClick={onResume}>
            Resume
          </button>
        </div>
      </section>
    </div>
  );
}

function ActionButton({
  color,
  icon,
  label,
  active,
  disabled = false,
  className,
  onClick
}: {
  color: "blue" | "green" | "gold" | "red";
  icon?: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      className={`action-button action-${color} ${active ? "is-active" : ""} ${className ?? ""}`}
      aria-label={label}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      {icon ? (
        <span className="action-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className={icon ? "action-label" : undefined}>{label}</span>
    </button>
  );
}

function DieFace({
  die,
  selected = false,
  conflicted = false,
  recentMoveColor,
  moveLocked = false,
  draggingSource = false,
  compact = false,
  multiplier,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel
}: {
  die: Die;
  selected?: boolean;
  conflicted?: boolean;
  recentMoveColor?: PlayerColor;
  moveLocked?: boolean;
  draggingSource?: boolean;
  compact?: boolean;
  multiplier?: number | string;
  onClick?: () => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLElement>) => void;
}): ReactElement {
  return (
    <span
      aria-label={`${die.value}`}
      className={`die-face die-${die.ownerId} ${selected ? "is-selected" : ""} ${
        conflicted ? "is-conflicted" : ""
      } ${recentMoveColor ? `is-recent-move recent-${recentMoveColor}` : ""} ${
        draggingSource ? "is-dragging-source" : ""
      } ${compact ? "is-compact" : ""}`}
      onClick={(event) => {
        if (!onClick) {
          return;
        }

        event.stopPropagation();
        onClick();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      role={onClick ? "button" : "img"}
      tabIndex={onClick ? 0 : undefined}
    >
      {pipMap[die.value].map((position) => (
        <span
          className="pip"
          key={position}
          style={{
            gridColumn: pipPositions[position].col,
            gridRow: pipPositions[position].row
          }}
        />
      ))}
      {multiplier ? <span className="die-multiplier">{multiplier}</span> : null}
      {moveLocked ? <span className="die-lock-icon" aria-hidden="true" /> : null}
    </span>
  );
}

function MiniDieIcon(): ReactElement {
  return (
    <span className="mini-die">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

function loadSavedGame(): GameState | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? restoreGame(saved) : null;
  } catch {
    return null;
  }
}
