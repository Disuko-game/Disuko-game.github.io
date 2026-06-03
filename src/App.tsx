import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode
} from "react";
import {
  boardDiceForPlayer,
  challengeViolation,
  conflictCellKeys,
  conflictDieIds,
  currentPlayer,
  detectConflicts,
  endAction,
  getDieAt,
  isOnBoard,
  moveDie,
  newGame,
  offBoardDice,
  placeDie,
  remainingDiceCount,
  rerollDice,
  restoreGame,
  selectDie,
  serializeGame,
  setMode
} from "./game/engine";
import { orderTrayDice } from "./game/diceOrdering";
import type { ActionMode, DiceValue, Die, GameState, Player } from "./game/types";

const STORAGE_KEY = "disuko-save-v1";
const DRAG_THRESHOLD_PX = 8;
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
  const [dragPreview, setDragPreview] = useState<{ die: Die; x: number; y: number } | null>(null);
  const dragCandidate = useRef<{
    dieId: string;
    pointerId: number;
    startX: number;
    startY: number;
    isDragging: boolean;
  } | null>(null);
  const suppressNextClick = useRef(false);
  const activePlayer = currentPlayer(game);
  const activeTurnLabel = activePlayer.name.trim().toLowerCase() === "you" ? "Your turn" : `${activePlayer.name}'s turn`;
  const conflicts = useMemo(() => detectConflicts(game), [game]);
  const conflictDice = useMemo(() => conflictDieIds(game), [game]);
  const conflictCells = useMemo(() => conflictCellKeys(game), [game]);
  const selectedDie = game.dice.find((die) => game.selectedDieIds.includes(die.id));
  const currentTrayDice = useMemo(
    () => orderTrayDice(offBoardDice(game, activePlayer.id)),
    [game, activePlayer.id]
  );

  const commitMode = (mode: ActionMode) => onCommit(setMode(game, mode));

  const handleTrayDie = (die: Die) => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }

    if (game.mode === "reroll") {
      onCommit(selectDie(game, die.id, true));
      return;
    }

    onCommit(selectDie(setMode(game, "place"), die.id));
  };

  const handleBoardDie = (die: Die) => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }

    if (die.ownerId !== activePlayer.id || game.phase === "won") {
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
    if (die.ownerId !== activePlayer.id || game.phase === "won") {
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
      commitMode("reroll");
      return;
    }

    onCommit(rerollDice(game, game.selectedDieIds));
  };

  return (
    <main className="game-shell">
      <header className="game-header">
        <button className="round-icon" type="button" aria-label="Open menu" onClick={onOpenMenu}>
          <span />
          <span />
          <span />
        </button>
        <img className="game-logo" src={logoUrl} alt="Disuko" />
        <button className="new-game-chip" type="button" onClick={onNewGame}>
          New
        </button>
      </header>

      <PlayerStrip game={game} activePlayer={activePlayer} />

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
        draggingDieId={dragPreview?.die.id ?? null}
        onCell={handleCell}
        onDie={handleBoardDie}
        onDiePointerDown={handleDiePointerDown}
        onDiePointerMove={handleDiePointerMove}
        onDiePointerUp={handleDiePointerUp}
        onDiePointerCancel={handleDiePointerCancel}
      />

      <div className="side-stack">
        <StatusBanner game={game} conflicts={conflicts.length} />

        <section className="control-dock" aria-label="Game controls">
          <DiceTray
            dice={currentTrayDice}
            selectedIds={new Set(game.selectedDieIds)}
            player={activePlayer}
            mode={game.mode}
            draggingDieId={dragPreview?.die.id ?? null}
            onDie={handleTrayDie}
            onDiePointerDown={handleDiePointerDown}
            onDiePointerMove={handleDiePointerMove}
            onDiePointerUp={handleDiePointerUp}
            onDiePointerCancel={handleDiePointerCancel}
          />

          <div className="action-grid">
            <ActionButton
              color="blue"
              icon={<MiniDieIcon />}
              label={game.mode === "reroll" ? "Reroll" : "Roll"}
              active={game.mode === "reroll"}
              onClick={handleReroll}
            />
            <ActionButton
              color="red"
              icon={<ChallengeIcon />}
              label="Challenge"
              active={game.mode === "challenge"}
              onClick={() => onCommit(challengeViolation(game))}
            />
            <button className="end-action-button" type="button" onClick={() => onCommit(endAction(game))}>
              End Action
            </button>
          </div>
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

function PlayerStrip({ game, activePlayer }: { game: GameState; activePlayer: Player }): ReactElement {
  return (
    <section className="player-strip" aria-label="Players">
      {game.players.map((player) => {
        const remaining = remainingDiceCount(game, player.id);
        const placed = boardDiceForPlayer(game, player.id).length;
        const isActive = player.id === activePlayer.id && game.phase !== "won";
        const isWinner = player.id === game.winnerId;

        return (
          <article
            className={`player-card card-${player.color} ${isActive ? "is-active" : ""} ${
              isWinner ? "is-winner" : ""
            }`}
            key={player.id}
          >
            <span className={`player-dot dot-${player.color}`} />
            <span className="player-name">{player.name}</span>
            <strong>{remaining}</strong>
            <small>{placed} placed</small>
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
  dice,
  selectedIds,
  player,
  mode,
  draggingDieId,
  onDie,
  onDiePointerDown,
  onDiePointerMove,
  onDiePointerUp,
  onDiePointerCancel
}: {
  dice: Die[];
  selectedIds: Set<string>;
  player: Player;
  mode: ActionMode;
  draggingDieId: string | null;
  onDie: (die: Die) => void;
  onDiePointerDown: (event: ReactPointerEvent<HTMLElement>, die: Die) => void;
  onDiePointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onDiePointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onDiePointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}): ReactElement {
  return (
    <section className="dice-tray" aria-label={`${player.name}'s dice tray`}>
      <div className="tray-heading">
        <span className={`player-dot dot-${player.color}`} />
        <strong>{mode === "reroll" ? "Tap dice to reroll" : "Dice tray"}</strong>
      </div>
      <div className="tray-scroll">
        {dice.length === 0 ? (
          <p className="empty-tray">All dice are on the board.</p>
        ) : (
          dice.map((die) => (
            <button
              className={`tray-die ${selectedIds.has(die.id) ? "is-selected" : ""} ${
                draggingDieId === die.id ? "is-dragging-source" : ""
              }`}
              key={die.id}
              type="button"
              onClick={() => onDie(die)}
              onPointerDown={(event) => onDiePointerDown(event, die)}
              onPointerMove={onDiePointerMove}
              onPointerUp={onDiePointerUp}
              onPointerCancel={onDiePointerCancel}
            >
              <DieFace die={die} selected={selectedIds.has(die.id)} draggingSource={draggingDieId === die.id} compact />
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function StatusBanner({ game, conflicts }: { game: GameState; conflicts: number }): ReactElement {
  const rolls = game.challengeRolls
    ?.map((roll) => `${game.players.find((player) => player.id === roll.playerId)?.name ?? "Player"} ${roll.value}`)
    .join(" vs ");

  return (
    <section className={`status-banner ${conflicts > 0 ? "has-conflict" : ""}`} aria-live="polite">
      <p>{game.message}</p>
      {rolls ? <small>Challenge roll: {rolls}</small> : null}
    </section>
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
  onClick
}: {
  color: "blue" | "green" | "gold" | "red";
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button className={`action-button action-${color} ${active ? "is-active" : ""}`} type="button" onClick={onClick}>
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
  draggingSource = false,
  compact = false,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel
}: {
  die: Die;
  selected?: boolean;
  conflicted?: boolean;
  draggingSource?: boolean;
  compact?: boolean;
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
      } ${draggingSource ? "is-dragging-source" : ""} ${compact ? "is-compact" : ""}`}
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

function ChallengeIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v9" />
      <path d="M12 18h.01" />
      <circle cx="12" cy="12" r="9" />
    </svg>
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
