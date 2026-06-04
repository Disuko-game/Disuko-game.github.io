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
import type { ActionMode, DiceValue, Die, GameState, Player, PlayerColor } from "./game/types";
import { isTabletopViewportSupported } from "./tabletopFit";

const STORAGE_KEY = "disuko-save-v1";
const DRAG_THRESHOLD_PX = 8;
const REROLL_STACK_LONG_PRESS_MS = 450;
const INVALID_MOVE_ANIMATION_MS = 2160;
const logoUrl = `${import.meta.env.BASE_URL}logo.png`;
const boardIndexes = Array.from({ length: 36 }, (_, index) => ({
  row: Math.floor(index / 6),
  col: index % 6
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

interface ViewportSize {
  width: number;
  height: number;
  rootFontSizePx: number;
}

interface InvalidPlacementPreview {
  id: number;
  die: Die;
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
  const [turnPromptOpen, setTurnPromptOpen] = useState(false);
  const invalidPlacementId = useRef(0);
  const invalidPlacementTimer = useRef<number | null>(null);
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
  const conflictDice = useMemo(() => conflictDieIds(game), [game]);
  const conflictCells = useMemo(() => conflictCellKeys(game), [game]);
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

  const clearInvalidPlacement = () => {
    if (invalidPlacementTimer.current !== null) {
      window.clearTimeout(invalidPlacementTimer.current);
      invalidPlacementTimer.current = null;
    }

    setInvalidPlacement(null);
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

  const board = (
    <Board
      game={game}
      conflictDice={conflictDice}
      conflictCells={conflictCells}
      recentMoveHighlights={recentMoveHighlights}
      draggingDieId={transientDieId}
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

    return (
      <DiceTray
        groups={trayGroups}
        selectedIds={isActive ? selectedDieIdSet : new Set<string>()}
        player={player}
        mode={trayMode}
        draggingDieId={transientDieId}
        openRerollValue={isActive ? openRerollValue : null}
        actionCountLabel={isActive ? trayStatusLabel : "0 actions"}
        rollLabel={isActive && game.mode === "reroll" ? `Reroll ${game.selectedDieIds.length}` : "Roll"}
        rollActive={isActive && game.mode === "reroll"}
        disabled={disabled}
        hidePlayerName={game.tabletopMode}
        className={isActive ? "is-active-player" : undefined}
        onGroup={handleTrayGroup}
        onRoll={handleReroll}
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
      className={`game-shell ${game.tabletopMode ? "is-tabletop" : ""}`}
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
          <div className="invalid-move-toast" role="status" aria-live="assertive">
            invalid move
          </div>
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
  tabletopMode?: boolean;
  activePlayerColor?: string;
  onCell: (row: number, col: number) => void;
  onDie: (die: Die) => void;
  onDiePointerDown: (event: ReactPointerEvent<HTMLElement>, die: Die) => void;
  onDiePointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onDiePointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onDiePointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}): ReactElement {
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
  rollActive,
  disabled = false,
  hidePlayerName = false,
  className,
  onGroup,
  onRoll,
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
  rollActive: boolean;
  disabled?: boolean;
  hidePlayerName?: boolean;
  className?: string;
  onGroup: (group: DiceValueGroup) => void;
  onRoll: () => void;
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
      <div className="tray-status-row" aria-live="polite">
        <span className="tray-action-counter">{actionCountLabel}</span>
      </div>
      <div className="tray-control-row">
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
        <ActionButton
          color="blue"
          icon={<MiniDieIcon />}
          label={rollLabel}
          active={rollActive}
          disabled={disabled}
          className="tray-roll-button"
          onClick={onRoll}
        />
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
