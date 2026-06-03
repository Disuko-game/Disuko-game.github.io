import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
  type ReactElement,
  type ReactNode
} from "react";
import {
  boardDiceForPlayer,
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
  remainingDiceCount,
  rerollDice,
  restoreGame,
  selectDie,
  serializeGame,
  setSelectedRerollDice,
  setMode
} from "./game/engine";
import { groupDiceByValue, type DiceValueGroup } from "./game/diceOrdering";
import type { ActionMode, DiceValue, Die, GameState, Player, PlayerColor } from "./game/types";

const STORAGE_KEY = "disuko-save-v1";
const DRAG_THRESHOLD_PX = 8;
const REROLL_STACK_LONG_PRESS_MS = 450;
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

  const startGame = (playerCount: 2 | 3 | 4, names: string[]) => {
    setGame(newGame({ playerCount, playerNames: names }));
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
      {showMenu ? (
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

function SetupScreen({
  onStart,
  onCancel
}: {
  onStart: (playerCount: 2 | 3 | 4, names: string[]) => void;
  onCancel?: () => void;
}): ReactElement {
  const [playerCount, setPlayerCount] = useState<2 | 3 | 4>(4);
  const [names, setNames] = useState(["You", "Maya", "Jordan", "Ava"]);

  const visibleNames = names.slice(0, playerCount);

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

        <div className="name-grid">
          {visibleNames.map((name, index) => (
            <label className={`name-field player-${index}`} key={index}>
              <span>Player {index + 1}</span>
              <input
                value={name}
                onChange={(event) => {
                  const next = [...names];
                  next[index] = event.target.value;
                  setNames(next);
                }}
              />
            </label>
          ))}
        </div>

        <div className="setup-actions">
          {onCancel ? (
            <button className="secondary-button" type="button" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
          <button className="primary-button" type="button" onClick={() => onStart(playerCount, names)}>
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
  const [openRailPlayerId, setOpenRailPlayerId] = useState<string | null>(null);
  const [openRerollValue, setOpenRerollValue] = useState<DiceValue | null>(null);
  const [hasExplicitRerollSelection, setHasExplicitRerollSelection] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ die: Die; x: number; y: number } | null>(null);
  const railZoneRef = useRef<HTMLDivElement | null>(null);
  const dragCandidate = useRef<{
    dieId: string;
    pointerId: number;
    startX: number;
    startY: number;
    isDragging: boolean;
  } | null>(null);
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
  const activeTurnLabel = activePlayer.name.trim().toLowerCase() === "you" ? "Your turn" : `${activePlayer.name}'s turn`;
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
  const openRailPlayer = openRailPlayerId
    ? game.players.find((player) => player.id === openRailPlayerId) ?? null
    : null;
  const openRailPlayerIndex = openRailPlayerId
    ? game.players.findIndex((player) => player.id === openRailPlayerId)
    : -1;
  const openRailAnchor = openRailPlayerIndex >= 0 ? ((openRailPlayerIndex + 0.5) / game.players.length) * 100 : 50;
  const openRailGroups = useMemo(
    () => (openRailPlayerId ? groupDiceByValue(offBoardDice(game, openRailPlayerId)) : []),
    [game, openRailPlayerId]
  );

  const clearStackLongPress = () => {
    if (!stackLongPress.current) {
      return;
    }

    window.clearTimeout(stackLongPress.current.timer);
    stackLongPress.current = null;
  };

  useEffect(() => {
    if (openRailPlayerId && !game.players.some((player) => player.id === openRailPlayerId)) {
      setOpenRailPlayerId(null);
    }
  }, [game.players, openRailPlayerId]);

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

      if (target instanceof Element && target.closest(".dice-tray")) {
        return;
      }

      setOpenRerollValue(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openRerollValue]);

  useEffect(() => {
    if (!openRailPlayerId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (target instanceof Node && railZoneRef.current?.contains(target)) {
        return;
      }

      setOpenRailPlayerId(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenRailPlayerId(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openRailPlayerId]);

  const commitMode = (mode: ActionMode) => onCommit(setMode(game, mode));

  const handleOpenMenu = () => {
    setOpenRailPlayerId(null);
    onOpenMenu();
  };

  const handleNewGame = () => {
    setOpenRailPlayerId(null);
    onNewGame();
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
      if (group.count === 1) {
        setRerollStackCount(group, selectedCountForGroup(group) === 1 ? 0 : 1);
        setOpenRerollValue(null);
        return;
      }

      setOpenRerollValue((value) => (value === group.value ? null : group.value));
      return;
    }

    onCommit(selectDie(setMode(game, "place"), group.representativeDie.id));
  };

  const handleRerollStackPointerDown = (event: ReactPointerEvent<HTMLElement>, group: DiceValueGroup) => {
    if (game.mode !== "reroll" || game.phase === "won") {
      return;
    }

    clearStackLongPress();
    event.currentTarget.setPointerCapture(event.pointerId);
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

    event.currentTarget.setPointerCapture(event.pointerId);
    dragCandidate.current = {
      dieId: die.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      isDragging: false
    };
  };

  const handleDiePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const candidate = dragCandidate.current;

    if (!candidate || candidate.pointerId !== event.pointerId) {
      return;
    }

    const die = game.dice.find((candidateDie) => candidateDie.id === candidate.dieId);

    if (!die) {
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

  const handleDiePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const candidate = dragCandidate.current;

    if (!candidate || candidate.pointerId !== event.pointerId) {
      return;
    }

    dragCandidate.current = null;

    if (!candidate.isDragging) {
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

  const handleDiePointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragCandidate.current?.pointerId !== event.pointerId) {
      return;
    }

    dragCandidate.current = null;
    setDragPreview(null);
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

  return (
    <main className="game-shell">
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

      <div className="player-rail-zone" ref={railZoneRef}>
        <PlayerStrip
          game={game}
          activePlayer={activePlayer}
          openRailPlayerId={openRailPlayerId}
          onToggleRail={(playerId) => {
            setOpenRailPlayerId((currentPlayerId) => (currentPlayerId === playerId ? null : playerId));
          }}
        />
        {openRailPlayer ? (
          <PlayerDiceRail player={openRailPlayer} groups={openRailGroups} anchorPercent={openRailAnchor} />
        ) : null}
      </div>

      <section className="turn-panel" aria-live="polite">
        <div>
          <span className={`player-dot dot-${activePlayer.color}`} />
          <strong>{game.phase === "won" ? "Game over" : activeTurnLabel}</strong>
        </div>
        <span>{game.actionCredits} action{game.actionCredits === 1 ? "" : "s"}</span>
      </section>

      <Board
        game={game}
        conflictDice={conflictDice}
        conflictCells={conflictCells}
        recentMoveHighlights={recentMoveHighlights}
        draggingDieId={dragPreview?.die.id ?? null}
        onCell={handleCell}
        onDie={handleBoardDie}
        onDiePointerDown={handleDiePointerDown}
        onDiePointerMove={handleDiePointerMove}
        onDiePointerUp={handleDiePointerUp}
        onDiePointerCancel={handleDiePointerCancel}
      />

      <div className="side-stack">
        <section className="control-dock" aria-label="Game controls">
          <DiceTray
            groups={currentTrayGroups}
            selectedIds={new Set(game.selectedDieIds)}
            player={activePlayer}
            mode={game.mode}
            draggingDieId={dragPreview?.die.id ?? null}
            openRerollValue={openRerollValue}
            rollLabel={game.mode === "reroll" ? "Reroll" : "Roll"}
            rollActive={game.mode === "reroll"}
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
        </section>
      </div>

      {dragPreview ? (
        <div className="drag-preview" style={{ left: dragPreview.x, top: dragPreview.y }} aria-hidden="true">
          <DieFace die={dragPreview.die} compact />
        </div>
      ) : null}

      {children}
    </main>
  );
}

function PlayerStrip({
  game,
  activePlayer,
  openRailPlayerId,
  onToggleRail
}: {
  game: GameState;
  activePlayer: Player;
  openRailPlayerId: string | null;
  onToggleRail: (playerId: string) => void;
}): ReactElement {
  return (
    <section className="player-strip" aria-label="Players">
      {game.players.map((player) => {
        const remaining = remainingDiceCount(game, player.id);
        const placed = boardDiceForPlayer(game, player.id).length;
        const isActive = player.id === activePlayer.id && game.phase !== "won";
        const isWinner = player.id === game.winnerId;
        const isOpen = player.id === openRailPlayerId;

        return (
          <button
            aria-controls={isOpen ? "player-dice-rail" : undefined}
            aria-expanded={isOpen}
            className={`player-card card-${player.color} ${isActive ? "is-active" : ""} ${
              isWinner ? "is-winner" : ""
            } ${isOpen ? "is-open" : ""}`}
            key={player.id}
            type="button"
            onClick={() => onToggleRail(player.id)}
          >
            <span className={`player-dot dot-${player.color}`} />
            <span className="player-name">{player.name}</span>
            <strong>{remaining}</strong>
            <small>{placed} placed</small>
          </button>
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
  onCell: (row: number, col: number) => void;
  onDie: (die: Die) => void;
  onDiePointerDown: (event: ReactPointerEvent<HTMLElement>, die: Die) => void;
  onDiePointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onDiePointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onDiePointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}): ReactElement {
  return (
    <section className="board-wrap" aria-label="Disuko board">
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
  rollLabel,
  rollActive,
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
  rollLabel: string;
  rollActive: boolean;
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
    <section className="dice-tray" aria-label={`${player.name}'s dice tray`}>
      <div className="tray-control-row">
        <DiceRail
          groups={groups}
          selectedIds={selectedIds}
          draggingDieId={draggingDieId}
          emptyLabel="All dice are on the board."
          rerollMode={mode === "reroll"}
          openRerollValue={openRerollValue}
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
          className="tray-roll-button"
          onClick={onRoll}
        />
      </div>
    </section>
  );
}

function PlayerDiceRail({
  player,
  groups,
  anchorPercent
}: {
  player: Player;
  groups: DiceValueGroup[];
  anchorPercent: number;
}): ReactElement {
  return (
    <section
      className={`player-dice-popover rail-${player.color}`}
      id="player-dice-rail"
      aria-label={`${player.name}'s dice rail`}
      style={{ "--rail-anchor": `${anchorPercent}%` } as CSSProperties}
    >
      <div className="rail-heading">
        <span className={`player-dot dot-${player.color}`} />
        <strong>{player.name}</strong>
        <small>{groups.reduce((total, group) => total + group.count, 0)} remaining</small>
      </div>
      <DiceRail groups={groups} emptyLabel="No dice in tray." readOnly />
    </section>
  );
}

function DiceRail({
  groups,
  selectedIds,
  draggingDieId,
  emptyLabel,
  readOnly = false,
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
  readOnly?: boolean;
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

  return (
    <div className={`dice-rail-groove ${readOnly ? "is-readonly" : ""}`}>
      {visibleGroups.length === 0 ? (
        <p className="empty-tray">{emptyLabel}</p>
      ) : (
        visibleGroups.map(({ group, dice, representativeDie }) => {
          const selectedCount = group.dice.filter((die) => selectedIds?.has(die.id)).length;
          const selected = selectedCount > 0;
          const displayCount = rerollMode ? group.count : dice.length;
          const multiplier =
            rerollMode && selectedCount > 0 && selectedCount < group.count
              ? `${selectedCount}/${group.count}`
              : displayCount > 1
                ? displayCount
                : undefined;

          if (readOnly || !onGroup || !onDiePointerDown || !onDiePointerMove || !onDiePointerUp || !onDiePointerCancel) {
            return (
              <span className="rail-die is-readonly" key={group.value}>
                <DieFace die={representativeDie} selected={selected} compact multiplier={multiplier} />
              </span>
            );
          }

          return (
            <span className={`rail-stack ${openRerollValue === group.value ? "has-picker" : ""}`} key={group.value}>
              <button
                aria-label={
                  rerollMode
                    ? `${group.value}, ${selectedCount} of ${group.count} selected to reroll`
                    : `${group.value}`
                }
                className={`rail-die ${selected ? "is-selected" : ""}`}
                type="button"
                onClick={() => onGroup(group)}
                onPointerDown={(event) =>
                  rerollMode && onRerollStackPointerDown
                    ? onRerollStackPointerDown(event, group)
                    : onDiePointerDown(event, representativeDie)
                }
                onPointerMove={rerollMode && onRerollStackPointerMove ? onRerollStackPointerMove : onDiePointerMove}
                onPointerUp={rerollMode && onRerollStackPointerUp ? onRerollStackPointerUp : onDiePointerUp}
                onPointerCancel={
                  rerollMode && onRerollStackPointerCancel ? onRerollStackPointerCancel : onDiePointerCancel
                }
                onPointerLeave={rerollMode && onRerollStackPointerCancel ? onRerollStackPointerCancel : undefined}
              >
                <DieFace die={representativeDie} selected={selected} compact multiplier={multiplier} />
              </button>
              {rerollMode && openRerollValue === group.value && onSetRerollCount ? (
                <StackRerollPicker group={group} selectedCount={selectedCount} onSetCount={onSetRerollCount} />
              ) : null}
            </span>
          );
        })
      )}
    </div>
  );
}

function StackRerollPicker({
  group,
  selectedCount,
  onSetCount
}: {
  group: DiceValueGroup;
  selectedCount: number;
  onSetCount: (group: DiceValueGroup, count: number) => void;
}): ReactElement {
  return (
    <div
      className="stack-reroll-picker"
      role="group"
      aria-label={`Choose how many ${group.value}s to reroll`}
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
      <button type="button" onClick={() => onSetCount(group, group.count)}>
        All
      </button>
      <button type="button" onClick={() => onSetCount(group, 0)}>
        Clear
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
  className,
  onClick
}: {
  color: "blue" | "green" | "gold" | "red";
  icon: ReactNode;
  label: string;
  active?: boolean;
  className?: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      className={`action-button action-${color} ${active ? "is-active" : ""} ${className ?? ""}`}
      type="button"
      onClick={onClick}
    >
      <span className="action-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
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
      {multiplier ? (
        <span className="die-multiplier">{typeof multiplier === "number" ? `${multiplier}x` : multiplier}</span>
      ) : null}
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
