import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { boxIndex, cellsForBox } from "./game/geometry";
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
  wouldMoveDieConflict,
  wouldPlaceDieConflict
} from "./game/engine";
import { groupDiceByValue, type DiceValueGroup } from "./game/diceOrdering";
import { BOARD_SIZE, DICE_VALUES, type ActionMode, type DiceValue, type Die, type GameState, type Player, type PlayerColor } from "./game/types";
import {
  commitRoomGameState,
  createCurrentProfile,
  createRoom,
  currentRoomStatus,
  inviteFriendToRoom,
  joinRoom,
  joinRoomByCode,
  leaveRoom,
  loadCurrentProfile,
  loadCurrentRooms,
  loadFriendsState,
  loadPublicRooms,
  loadRoomBundle,
  loadRoomInvites,
  optimisticRoomAfterGameCommit,
  playerIdForSeat,
  respondToFriendRequest,
  respondToRoomInvite,
  sendFriendRequest,
  startRoomIfReady,
  subscribeToPlayerEvents,
  subscribeToRoom,
  updateCurrentProfileName,
  type CurrentRoomSummary,
  type FriendSummary,
  type FriendsState,
  type PublicRoomSummary,
  type RoomBundle,
  type RoomInviteSummary,
  type RoomVisibility
} from "./lib/disukoMultiplayer";
import { isSupabaseConfigured, type DisukoProfileRow } from "./lib/supabase";
import { isTabletopViewportSupported } from "./tabletopFit";

const STORAGE_KEY = "disuko-save-v1";
const DRAG_THRESHOLD_PX = 8;
const REROLL_STACK_LONG_PRESS_MS = 450;
const INVALID_MOVE_ANIMATION_MS = 2160;
const COMPLETION_HIGHLIGHT_MS = 780;
const COMPLETION_BONUS_MS = 980;
const COMPACT_TRAY_INITIAL_HEIGHT_PX = 720;
const COMPACT_TRAY_RELEASE_MARGIN_PX = 96;
const COMPLETION_FEEDBACK_COLOR = "var(--blue)";
const CONFLICT_BLOCKER_FEEDBACK_COLOR = COMPLETION_FEEDBACK_COLOR;
const INVALID_MOVE_FEEDBACK_COLOR = "#f34c34";
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

type AppView = "home" | "local-setup" | "local-game" | "online-games" | "online-create" | "online-join" | "friends" | "settings";
type TabletopSlot = "top" | "right" | "bottom" | "left";
type CompletionRewardPhase = "highlight" | "bonus";
type InvalidReturnKind = "move" | "place";

type CreateGameRequest = {
  playerCount: 2 | 3 | 4;
  invitedProfileIds: string[];
  hasOpenSeats: boolean;
};

interface OnlineDashboardData {
  friendsState: FriendsState;
  currentRooms: CurrentRoomSummary[];
  publicRooms: PublicRoomSummary[];
  roomInvites: RoomInviteSummary[];
}

interface ViewportSize {
  width: number;
  height: number;
  rootFontSizePx: number;
}

interface ScreenPoint {
  x: number;
  y: number;
}

function centerOfElement(element: HTMLElement): ScreenPoint {
  const rect = element.getBoundingClientRect();

  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

interface InvalidMovePreview {
  id: number;
  die: Die;
  returnKind: InvalidReturnKind;
  startX: number;
  startY: number;
  returnX: number;
  returnY: number;
}

interface ConflictBlockerHighlight {
  id: number;
  dieIds: string[];
  color: string;
  messageColor: string;
  playerSlot?: TabletopSlot;
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

interface WinnerCelebrationLayout {
  playerId: string;
  playerNumber: number;
  playerName: string;
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
  const [view, setView] = useState<AppView>("home");
  const [showMenu, setShowMenu] = useState(false);
  const [profile, setProfile] = useState<DisukoProfileRow | null>(null);
  const [profileName, setProfileName] = useState("");
  const [friendsState, setFriendsState] = useState<FriendsState>(emptyFriendsState);
  const [currentRooms, setCurrentRooms] = useState<CurrentRoomSummary[]>([]);
  const [publicRooms, setPublicRooms] = useState<PublicRoomSummary[]>([]);
  const [roomInvites, setRoomInvites] = useState<RoomInviteSummary[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [onlineLoading, setOnlineLoading] = useState(true);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const currentRoomSubscriptionKey = useMemo(
    () => currentRooms.map((summary) => summary.room.id).sort().join("|"),
    [currentRooms]
  );
  const joinablePublicRooms = useMemo(() => {
    const currentRoomIds = new Set(currentRooms.map((summary) => summary.room.id));

    return publicRooms.filter((summary) => !currentRoomIds.has(summary.room.id));
  }, [currentRooms, publicRooms]);
  const hasOnlineAlert = profile
    ? roomInvites.length > 0 || currentRooms.some((summary) => currentRoomStatus(summary.room, profile.id) === "your-turn")
    : false;

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

  const applyDashboardData = (data: OnlineDashboardData) => {
    setFriendsState(data.friendsState);
    setCurrentRooms(data.currentRooms);
    setPublicRooms(data.publicRooms);
    setRoomInvites(data.roomInvites);
  };

  const refreshDashboard = async (currentProfile = profile) => {
    if (!currentProfile) {
      return;
    }

    applyDashboardData(await loadOnlineDashboard(currentProfile.id));
  };

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setOnlineLoading(false);
      return;
    }

    let canceled = false;

    const load = async () => {
      try {
        const nextProfile = await loadCurrentProfile();

        if (canceled) {
          return;
        }

        setProfile(nextProfile);
        setProfileName(nextProfile?.display_name ?? "");

        if (nextProfile) {
          const dashboard = await loadOnlineDashboard(nextProfile.id);

          if (!canceled) {
            applyDashboardData(dashboard);
          }
        }
      } catch (caughtError) {
        if (!canceled) {
          setOnlineError(formatError(caughtError));
        }
      } finally {
        if (!canceled) {
          setOnlineLoading(false);
        }
      }
    };

    void load();

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!profile) {
      return;
    }

    return subscribeToPlayerEvents(profile.id, () => {
      void refreshDashboard(profile);
    });
  }, [profile]);

  useEffect(() => {
    if (!profile || !currentRoomSubscriptionKey) {
      return;
    }

    const unsubscribes = currentRoomSubscriptionKey
      .split("|")
      .filter(Boolean)
      .map((roomId) => subscribeToRoom(roomId, () => {
        void refreshDashboard(profile);
      }));

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [profile, currentRoomSubscriptionKey]);

  const startGame = ({ playerCount, tabletopMode }: SetupStartOptions) => {
    setGame(newGame({ playerCount, tabletopMode }));
    setShowMenu(false);
    setView("local-game");
  };

  const handleProfileSave = async (displayName: string) => {
    setOnlineBusy(true);
    setOnlineError(null);

    try {
      const nextProfile = profile
        ? await updateCurrentProfileName(profile.id, displayName)
        : await createCurrentProfile(displayName);

      setProfile(nextProfile);
      setProfileName(nextProfile.display_name);
      await refreshDashboard(nextProfile);
    } catch (caughtError) {
      setOnlineError(formatError(caughtError));
    } finally {
      setOnlineBusy(false);
    }
  };

  const handleFriendRequest = async (friendCode: string) => {
    if (!profile) {
      return;
    }

    setOnlineBusy(true);
    setOnlineError(null);

    try {
      await sendFriendRequest(profile.id, friendCode);
      await refreshDashboard(profile);
    } catch (caughtError) {
      setOnlineError(formatError(caughtError));
    } finally {
      setOnlineBusy(false);
    }
  };

  const handleFriendResponse = async (request: FriendSummary, status: "accepted" | "declined" | "canceled") => {
    if (!profile) {
      return;
    }

    setOnlineBusy(true);
    setOnlineError(null);

    try {
      await respondToFriendRequest(request.request.id, status);
      await refreshDashboard(profile);
    } catch (caughtError) {
      setOnlineError(formatError(caughtError));
    } finally {
      setOnlineBusy(false);
    }
  };

  const handleCreateOnlineGame = async ({ playerCount, invitedProfileIds, hasOpenSeats }: CreateGameRequest) => {
    if (!profile) {
      return;
    }

    setOnlineBusy(true);
    setOnlineError(null);

    try {
      const bundle = await createRoom(profile.id, {
        playerCount,
        visibility: hasOpenSeats ? "public" : "private"
      });

      await Promise.all(invitedProfileIds.map((friendProfileId) => inviteFriendToRoom(bundle.room.id, profile.id, friendProfileId)));
      await refreshDashboard(profile);
      setActiveRoomId(bundle.room.id);
    } catch (caughtError) {
      setOnlineError(formatError(caughtError));
    } finally {
      setOnlineBusy(false);
    }
  };

  const handleJoinByCode = async (joinCode: string) => {
    if (!profile) {
      return;
    }

    setOnlineBusy(true);
    setOnlineError(null);

    try {
      const bundle = await joinRoomByCode(profile.id, joinCode);
      setActiveRoomId(bundle.room.id);
    } catch (caughtError) {
      setOnlineError(formatError(caughtError));
    } finally {
      setOnlineBusy(false);
    }
  };

  const handleJoinRoom = async (roomId: string) => {
    if (!profile) {
      return;
    }

    setOnlineBusy(true);
    setOnlineError(null);

    try {
      const bundle = await joinRoom(profile.id, roomId);
      setActiveRoomId(bundle.room.id);
    } catch (caughtError) {
      setOnlineError(formatError(caughtError));
    } finally {
      setOnlineBusy(false);
    }
  };

  const handleRoomInvite = async (invite: RoomInviteSummary, status: "accepted" | "declined") => {
    if (!profile) {
      return;
    }

    setOnlineBusy(true);
    setOnlineError(null);

    try {
      const bundle = await respondToRoomInvite(invite.invite, profile.id, status);
      await refreshDashboard(profile);

      if (bundle) {
        setActiveRoomId(bundle.room.id);
      }
    } catch (caughtError) {
      setOnlineError(formatError(caughtError));
    } finally {
      setOnlineBusy(false);
    }
  };

  if (booting) {
    return <SplashScreen />;
  }

  if (activeRoomId && profile) {
    return (
      <OnlineRoomSession
        roomId={activeRoomId}
        profile={profile}
        friends={friendsState.friends}
        onExit={() => {
          setActiveRoomId(null);
          void refreshDashboard(profile);
          setView("online-games");
        }}
      />
    );
  }

  if (isSupabaseConfigured() && onlineLoading) {
    return <OnlineLoadingScreen />;
  }

  if (isSupabaseConfigured() && !profile) {
    return (
      <ProfileGate
        initialName={profileName}
        busy={onlineBusy}
        error={onlineError}
        onSubmit={handleProfileSave}
      />
    );
  }

  if (!isSupabaseConfigured() && isOnlineView(view)) {
    return <OnlineSetupNeeded onBack={() => setView("home")} />;
  }

  if (view === "local-game" && game) {
    return (
      <GameScreen
        game={game}
        onCommit={setGame}
        onOpenMenu={() => setShowMenu(true)}
        onNewGame={() => setView("local-setup")}
      >
        {showMenu && !game.tabletopMode ? (
          <MenuOverlay
            game={game}
            onResume={() => setShowMenu(false)}
            onNewGame={() => {
              setShowMenu(false);
              setView("local-setup");
            }}
          />
        ) : null}
      </GameScreen>
    );
  }

  if (view === "local-setup" || view === "local-game") {
    return (
      <LocalSetupScreen
        onStart={startGame}
        onCancel={() => setView("home")}
      />
    );
  }

  if (view === "online-games" && profile) {
    return (
      <OnlineGamesScreen
        profile={profile}
        rooms={currentRooms}
        invites={roomInvites}
        busy={onlineBusy}
        error={onlineError}
        onBack={() => setView("home")}
        onOpenRoom={(roomId) => {
          setOnlineError(null);
          setActiveRoomId(roomId);
        }}
        onAcceptInvite={(invite) => void handleRoomInvite(invite, "accepted")}
        onDeclineInvite={(invite) => void handleRoomInvite(invite, "declined")}
        onCreate={() => setView("online-create")}
        onJoin={() => setView("online-join")}
        onRefresh={() => void refreshDashboard(profile)}
      />
    );
  }

  if (view === "online-create" && profile) {
    return (
      <OnlineCreateGameScreen
        profile={profile}
        friends={friendsState.friends}
        busy={onlineBusy}
        error={onlineError}
        onBack={() => setView("online-games")}
        onCreate={(request) => void handleCreateOnlineGame(request)}
      />
    );
  }

  if (view === "online-join" && profile) {
    return (
      <OnlineJoinGameScreen
        rooms={joinablePublicRooms}
        busy={onlineBusy}
        error={onlineError}
        onBack={() => setView("online-games")}
        onJoinByCode={(joinCode) => void handleJoinByCode(joinCode)}
        onJoinRoom={(roomId) => void handleJoinRoom(roomId)}
        onRefresh={() => void refreshDashboard(profile)}
      />
    );
  }

  if (view === "friends" && profile) {
    return (
      <FriendsScreen
        profile={profile}
        friendsState={friendsState}
        busy={onlineBusy}
        error={onlineError}
        onBack={() => setView("home")}
        onSendRequest={(friendCode) => void handleFriendRequest(friendCode)}
        onRespond={(request, status) => void handleFriendResponse(request, status)}
      />
    );
  }

  if (view === "settings" && profile) {
    return (
      <SettingsScreen
        profile={profile}
        busy={onlineBusy}
        error={onlineError}
        onBack={() => setView("home")}
        onSaveProfile={(displayName) => void handleProfileSave(displayName)}
      />
    );
  }

  return (
    <HomeScreen
      hasLocalGame={Boolean(game)}
      hasOnlineAlert={hasOnlineAlert}
      onlineName={profile?.display_name ?? null}
      onLocalGame={() => setView(game ? "local-game" : "local-setup")}
      onOnlineGame={() => setView("online-games")}
      onFriends={() => setView("friends")}
      onSettings={() => setView("settings")}
    />
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

const emptyFriendsState: FriendsState = {
  friends: [],
  incoming: [],
  outgoing: []
};

function isOnlineView(view: AppView): boolean {
  return view === "online-games" || view === "online-create" || view === "online-join" || view === "friends" || view === "settings";
}

async function loadOnlineDashboard(profileId: string): Promise<OnlineDashboardData> {
  const [friendsState, currentRooms, publicRooms, roomInvites] = await Promise.all([
    loadFriendsState(profileId),
    loadCurrentRooms(profileId),
    loadPublicRooms(),
    loadRoomInvites(profileId)
  ]);

  return {
    friendsState,
    currentRooms,
    publicRooms,
    roomInvites
  };
}

function OnlineLoadingScreen(): ReactElement {
  return (
    <main className="setup-screen">
      <section className="setup-panel online-panel">
        <img className="setup-logo" src={logoUrl} alt="Disuko" />
        <p className="setup-copy">Connecting to Supabase...</p>
      </section>
    </main>
  );
}

function OnlineSetupNeeded({ onBack }: { onBack: () => void }): ReactElement {
  return (
    <main className="setup-screen">
      <section className="setup-panel online-panel" aria-labelledby="online-config-title">
        <img className="setup-logo" src={logoUrl} alt="Disuko" />
        <h1 id="online-config-title">Online setup needed</h1>
        <p className="setup-copy">
          Add your Supabase publishable key to <strong>.env.local</strong>, using <strong>.env.example</strong> as the template.
        </p>
        <div className="setup-actions">
          <button className="primary-button" type="button" onClick={onBack}>
            Back
          </button>
        </div>
      </section>
    </main>
  );
}

function ProfileGate({
  initialName,
  busy,
  error,
  onSubmit
}: {
  initialName: string;
  busy: boolean;
  error: string | null;
  onSubmit: (displayName: string) => void;
}): ReactElement {
  const [displayName, setDisplayName] = useState(initialName);

  useEffect(() => {
    setDisplayName(initialName);
  }, [initialName]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(displayName);
  };

  return (
    <main className="setup-screen">
      <section className="setup-panel profile-gate-panel" aria-labelledby="profile-gate-title">
        <img className="setup-logo" src={logoUrl} alt="Disuko" />
        <h1 id="profile-gate-title">Create username</h1>
        <p className="setup-copy">This name appears in online games and friend invites.</p>
        {error ? <p className="setup-warning" role="alert">{error}</p> : null}
        <form className="online-card profile-gate-form" onSubmit={handleSubmit}>
          <input
            aria-label="Username"
            maxLength={32}
            placeholder="Username"
            value={displayName}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
          />
          <button className="primary-button" type="submit" disabled={busy}>
            Continue
          </button>
        </form>
      </section>
    </main>
  );
}

function HomeScreen({
  hasLocalGame,
  hasOnlineAlert,
  onlineName,
  onLocalGame,
  onOnlineGame,
  onFriends,
  onSettings
}: {
  hasLocalGame: boolean;
  hasOnlineAlert: boolean;
  onlineName: string | null;
  onLocalGame: () => void;
  onOnlineGame: () => void;
  onFriends: () => void;
  onSettings: () => void;
}): ReactElement {
  return (
    <main className="setup-screen home-screen">
      <section className="setup-panel home-panel" aria-labelledby="home-title">
        <img className="setup-logo" src={logoUrl} alt="Disuko" />
        <h1 id="home-title">Disuko</h1>
        {onlineName ? <p className="setup-copy">Playing as {onlineName}</p> : null}

        <div className="home-action-grid" aria-label="Main menu">
          <button className="home-action-button is-local" type="button" onClick={onLocalGame}>
            <strong>Local Game</strong>
            <span>{hasLocalGame ? "Resume table" : "Choose players"}</span>
          </button>
          <button className="home-action-button is-online" type="button" onClick={onOnlineGame}>
            {hasOnlineAlert ? <span className="home-alert-badge" aria-label="Online action needed">!</span> : null}
            <strong>Online Game</strong>
            <span>Current games</span>
          </button>
          <button className="home-action-button is-friends" type="button" onClick={onFriends}>
            <strong>Friends</strong>
            <span>Codes and requests</span>
          </button>
          <button className="home-action-button is-settings" type="button" onClick={onSettings}>
            <strong>Settings</strong>
            <span>Profile</span>
          </button>
        </div>
      </section>
    </main>
  );
}

function OnlineFrame({
  title,
  onBack,
  children
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}): ReactElement {
  const titleId = `${title.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}-title`;

  return (
    <main className="setup-screen online-screen">
      <section className="setup-panel online-panel" aria-labelledby={titleId}>
        <div className="online-heading">
          <img className="setup-logo" src={logoUrl} alt="Disuko" />
          <button className="secondary-button online-back" type="button" onClick={onBack}>
            Back
          </button>
        </div>
        <h1 id={titleId}>{title}</h1>
        {children}
      </section>
    </main>
  );
}

function OnlineGamesScreen({
  profile,
  rooms,
  invites,
  busy,
  error,
  onBack,
  onOpenRoom,
  onAcceptInvite,
  onDeclineInvite,
  onCreate,
  onJoin,
  onRefresh
}: {
  profile: DisukoProfileRow;
  rooms: CurrentRoomSummary[];
  invites: RoomInviteSummary[];
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onOpenRoom: (roomId: string) => void;
  onAcceptInvite: (invite: RoomInviteSummary) => void;
  onDeclineInvite: (invite: RoomInviteSummary) => void;
  onCreate: () => void;
  onJoin: () => void;
  onRefresh: () => void;
}): ReactElement {
  return (
    <OnlineFrame title="Online games" onBack={onBack}>
      {error ? <p className="setup-warning" role="alert">{error}</p> : null}
      <div className="online-stack">
        {invites.length > 0 ? (
          <RoomInviteList
            invites={invites}
            disabled={busy}
            onAccept={onAcceptInvite}
            onDecline={onDeclineInvite}
          />
        ) : null}
        <CurrentGamesList
          rooms={rooms}
          profileId={profile.id}
          disabled={busy}
          onOpen={onOpenRoom}
        />
        <section className="online-card online-bottom-actions">
          <div className="online-card-title-row">
            <h2>Play online</h2>
            <button className="secondary-button online-small-button" type="button" onClick={onRefresh}>
              Refresh
            </button>
          </div>
          <div className="online-action-row">
            <button className="primary-button" type="button" disabled={busy} onClick={onCreate}>
              Create New Game
            </button>
            <button className="secondary-button" type="button" disabled={busy} onClick={onJoin}>
              Join a Game
            </button>
          </div>
        </section>
      </div>
    </OnlineFrame>
  );
}

function RoomInviteList({
  invites,
  disabled,
  onAccept,
  onDecline
}: {
  invites: RoomInviteSummary[];
  disabled: boolean;
  onAccept: (invite: RoomInviteSummary) => void;
  onDecline: (invite: RoomInviteSummary) => void;
}): ReactElement {
  return (
    <section className="online-card">
      <div className="online-card-title-row">
        <h2>Game invites</h2>
        <span className="online-count-chip">{invites.length}</span>
      </div>
      <div className="online-list">
        {invites.map((invite) => (
          <article className="online-list-item" key={invite.invite.id}>
            <div>
              <strong>{invite.sender ? `Invite from ${invite.sender.display_name}` : "Game invite"}</strong>
              <span>{invite.sender?.display_name ?? "A friend"} invited you.</span>
            </div>
            <button className="primary-button online-small-button" type="button" disabled={disabled} onClick={() => onAccept(invite)}>
              Accept
            </button>
            <button className="secondary-button online-small-button" type="button" disabled={disabled} onClick={() => onDecline(invite)}>
              Decline
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function OnlineJoinGameScreen({
  rooms,
  busy,
  error,
  onBack,
  onJoinByCode,
  onJoinRoom,
  onRefresh
}: {
  rooms: PublicRoomSummary[];
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onJoinByCode: (joinCode: string) => void;
  onJoinRoom: (roomId: string) => void;
  onRefresh: () => void;
}): ReactElement {
  const [joinCode, setJoinCode] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onJoinByCode(joinCode);
  };

  return (
    <OnlineFrame title="Join a game" onBack={onBack}>
      {error ? <p className="setup-warning" role="alert">{error}</p> : null}
      <div className="online-stack">
        <section className="online-card">
          <h2>Invite code</h2>
          <form className="online-inline-form" onSubmit={handleSubmit}>
            <input
              aria-label="Invite code"
              placeholder="Invite code"
              value={joinCode}
              onChange={(event) => setJoinCode(event.currentTarget.value.toUpperCase())}
            />
            <button className="primary-button" type="submit" disabled={busy}>
              Join
            </button>
          </form>
        </section>
        <section className="online-card">
          <div className="online-card-title-row">
            <h2>Open games</h2>
            <button className="secondary-button online-small-button" type="button" disabled={busy} onClick={onRefresh}>
              Refresh
            </button>
          </div>
          {rooms.length === 0 ? <p className="online-empty">No public games are waiting.</p> : null}
          <div className="online-list">
            {rooms.map((summary) => (
              <article className="online-list-item" key={summary.room.id}>
                <div>
                  <strong>{summary.host ? `${summary.host.display_name}'s open game` : "Open game"}</strong>
                  <span>
                    {summary.host?.display_name ?? "Host"} - {summary.joinedSeats}/{summary.room.player_count} seats
                  </span>
                </div>
                <button className="secondary-button online-small-button" type="button" disabled={busy} onClick={() => onJoinRoom(summary.room.id)}>
                  Join
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </OnlineFrame>
  );
}

function FriendsScreen({
  profile,
  friendsState,
  busy,
  error,
  onBack,
  onSendRequest,
  onRespond
}: {
  profile: DisukoProfileRow;
  friendsState: FriendsState;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSendRequest: (friendCode: string) => void;
  onRespond: (request: FriendSummary, status: "accepted" | "declined" | "canceled") => void;
}): ReactElement {
  const [friendCode, setFriendCode] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSendRequest(friendCode);
    setFriendCode("");
  };

  return (
    <OnlineFrame title="Friends" onBack={onBack}>
      {error ? <p className="setup-warning" role="alert">{error}</p> : null}
      <div className="online-stack">
        <section className="online-card">
          <div className="online-profile-row">
            <div>
              <span className="online-label">Username</span>
              <strong>{profile.display_name}</strong>
            </div>
            <div>
              <span className="online-label">Friend code</span>
              <strong>{profile.friend_code}</strong>
            </div>
          </div>
          <form className="online-inline-form" onSubmit={handleSubmit}>
            <input
              aria-label="Friend code"
              placeholder="Friend code"
              value={friendCode}
              onChange={(event) => setFriendCode(event.currentTarget.value.toUpperCase())}
            />
            <button className="secondary-button" type="submit" disabled={busy}>
              Add
            </button>
          </form>
        </section>
        <section className="online-card">
          <h2>Friend list</h2>
          <FriendRequestList
            incoming={friendsState.incoming}
            outgoing={friendsState.outgoing}
            friends={friendsState.friends}
            disabled={busy}
            onRespond={async (request, status) => onRespond(request, status)}
          />
        </section>
      </div>
    </OnlineFrame>
  );
}

function SettingsScreen({
  profile,
  busy,
  error,
  onBack,
  onSaveProfile
}: {
  profile: DisukoProfileRow;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSaveProfile: (displayName: string) => void;
}): ReactElement {
  const [displayName, setDisplayName] = useState(profile.display_name);

  useEffect(() => {
    setDisplayName(profile.display_name);
  }, [profile.display_name]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSaveProfile(displayName);
  };

  return (
    <OnlineFrame title="Settings" onBack={onBack}>
      {error ? <p className="setup-warning" role="alert">{error}</p> : null}
      <div className="online-stack">
        <section className="online-card">
          <h2>Profile</h2>
          <form className="online-inline-form" onSubmit={handleSubmit}>
            <input
              aria-label="Username"
              maxLength={32}
              value={displayName}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
            <button className="primary-button" type="submit" disabled={busy}>
              Save
            </button>
          </form>
          <div className="online-profile-row">
            <div>
              <span className="online-label">Friend code</span>
              <strong>{profile.friend_code}</strong>
            </div>
          </div>
        </section>
      </div>
    </OnlineFrame>
  );
}

function OnlineCreateGameScreen({
  profile,
  friends,
  busy,
  error,
  onBack,
  onCreate
}: {
  profile: DisukoProfileRow;
  friends: FriendSummary[];
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onCreate: (request: CreateGameRequest) => void;
}): ReactElement {
  const [guestSlots, setGuestSlots] = useState<Array<{ enabled: boolean; profile: DisukoProfileRow | null }>>([
    { enabled: true, profile: null },
    { enabled: false, profile: null },
    { enabled: false, profile: null }
  ]);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const enabledGuests = guestSlots.filter((slot) => slot.enabled);
  const playerCount = (1 + enabledGuests.length) as 2 | 3 | 4;
  const invitedProfileIds = enabledGuests
    .map((slot) => slot.profile?.id)
    .filter((profileId): profileId is string => Boolean(profileId));
  const hasOpenSeats = enabledGuests.some((slot) => !slot.profile);

  const updateGuestSlot = (index: number, nextSlot: { enabled: boolean; profile: DisukoProfileRow | null }) => {
    setGuestSlots((currentSlots) => currentSlots.map((slot, slotIndex) => slotIndex === index ? nextSlot : slot));
  };

  const enableGuestSlot = (index: number) => {
    updateGuestSlot(index, { enabled: true, profile: null });
    setPickerIndex(index);
  };

  const removeGuestSlot = (index: number) => {
    if (index === 0) {
      updateGuestSlot(index, { enabled: true, profile: null });
      return;
    }

    updateGuestSlot(index, { enabled: false, profile: null });
  };

  const chooseFriend = (friendProfile: DisukoProfileRow | null) => {
    if (pickerIndex === null) {
      return;
    }

    updateGuestSlot(pickerIndex, { enabled: true, profile: friendProfile });
    setPickerIndex(null);
  };

  const availableFriends = useMemo(() => {
    if (pickerIndex === null) {
      return friends;
    }

    const selectedIds = new Set(
      guestSlots
        .map((slot, index) => index === pickerIndex ? null : slot.profile?.id)
        .filter((profileId): profileId is string => Boolean(profileId))
    );

    return friends.filter((friend) => !selectedIds.has(friend.profile.id));
  }, [friends, guestSlots, pickerIndex]);

  return (
    <OnlineFrame title="Create game" onBack={onBack}>
      {error ? <p className="setup-warning" role="alert">{error}</p> : null}
      <div className="online-stack">
        <section className="online-card create-game-card">
          <div className="create-slot-grid" aria-label="Player slots">
            <article className="create-slot is-you">
              <strong>{profile.display_name}</strong>
              <span>You</span>
            </article>
            {guestSlots.map((slot, index) => (
              <article className={`create-slot ${slot.enabled ? "is-enabled" : "is-disabled"}`} key={index}>
                {slot.enabled ? (
                  <>
                    <button className="create-slot-main" type="button" onClick={() => setPickerIndex(index)}>
                      <strong>{slot.profile?.display_name ?? "Open seat"}</strong>
                      <span>{slot.profile ? "Invited friend" : index === 0 ? "Second player" : `Player ${index + 2}`}</span>
                    </button>
                    {index > 0 ? (
                      <button className="create-slot-remove" type="button" onClick={() => removeGuestSlot(index)}>
                        Remove
                      </button>
                    ) : null}
                  </>
                ) : (
                  <button className="create-slot-add" type="button" onClick={() => enableGuestSlot(index)}>
                    <strong>Add</strong>
                    <span>Player {index + 2}</span>
                  </button>
                )}
              </article>
            ))}
          </div>
          <p className="online-empty">
            Open seats appear in Join a Game. Friend seats send invites and fill when accepted.
          </p>
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => onCreate({ playerCount, invitedProfileIds, hasOpenSeats })}
          >
            Create Game
          </button>
        </section>
      </div>
      {pickerIndex !== null ? (
        <FriendPicker
          friends={availableFriends}
          slotLabel={`Player ${pickerIndex + 2}`}
          disabled={busy}
          onChoose={chooseFriend}
          onClose={() => setPickerIndex(null)}
        />
      ) : null}
    </OnlineFrame>
  );
}

function FriendPicker({
  friends,
  slotLabel,
  disabled,
  onChoose,
  onClose
}: {
  friends: FriendSummary[];
  slotLabel: string;
  disabled: boolean;
  onChoose: (profile: DisukoProfileRow | null) => void;
  onClose: () => void;
}): ReactElement {
  return createPortal(
    <div className="friend-picker-backdrop" role="dialog" aria-modal="true" aria-labelledby="friend-picker-title">
      <section className="friend-picker-panel">
        <h2 id="friend-picker-title">{slotLabel}</h2>
        <button className="secondary-button" type="button" disabled={disabled} onClick={() => onChoose(null)}>
          Leave Open
        </button>
        <div className="online-list">
          {friends.map((friend) => (
            <article className="online-list-item" key={friend.profile.id}>
              <div>
                <strong>{friend.profile.display_name}</strong>
                <span>{friend.profile.friend_code}</span>
              </div>
              <button className="primary-button online-small-button" type="button" disabled={disabled} onClick={() => onChoose(friend.profile)}>
                Select
              </button>
            </article>
          ))}
          {friends.length === 0 ? <p className="online-empty">No available friends for this seat.</p> : null}
        </div>
        <button className="secondary-button" type="button" onClick={onClose}>
          Cancel
        </button>
      </section>
    </div>,
    document.body
  );
}

function CurrentGamesList({
  rooms,
  profileId,
  disabled,
  onOpen
}: {
  rooms: CurrentRoomSummary[];
  profileId: string;
  disabled: boolean;
  onOpen: (roomId: string) => void;
}): ReactElement {
  return (
    <section className="online-card current-games-card">
      <div className="online-card-title-row">
        <h2>Current games</h2>
        <span className="online-count-chip">{rooms.length}</span>
      </div>
      {rooms.length === 0 ? <p className="online-empty">No current games yet.</p> : null}
      <div className="online-list current-games-list">
        {rooms.map((summary) => {
          const status = currentRoomStatus(summary.room, profileId);
          const playersLabel = currentRoomPlayersLabel(summary, profileId);
          const detail = currentRoomDetail(summary, profileId);

          return (
            <article className={`online-list-item current-game-item is-${status}`} key={summary.room.id}>
              <div className="current-game-main">
                <div className="current-game-title-row">
                  <strong>{currentRoomTitle(summary, profileId)}</strong>
                  <span className={`online-turn-pill is-${status}`}>{currentRoomStatusLabel(status)}</span>
                </div>
                <span>{playersLabel}</span>
                <span>{detail}</span>
              </div>
              <button
                className={status === "your-turn" ? "primary-button online-small-button" : "secondary-button online-small-button"}
                type="button"
                disabled={disabled}
                onClick={() => onOpen(summary.room.id)}
              >
                Open
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function currentRoomStatusLabel(status: ReturnType<typeof currentRoomStatus>): string {
  if (status === "your-turn") {
    return "Your turn";
  }

  if (status === "waiting") {
    return "Waiting";
  }

  if (status === "finished") {
    return "Finished";
  }

  return "Lobby";
}

function currentRoomTitle(summary: CurrentRoomSummary, profileId: string): string {
  const otherPlayers = summary.players
    .filter((player) => player.profile_id !== profileId)
    .map((player) => player.profile.display_name);

  if (otherPlayers.length > 0) {
    return `Game with ${otherPlayers.join(", ")}`;
  }

  if (summary.room.host_profile_id === profileId) {
    return "Your game";
  }

  return "Online game";
}

function currentRoomPlayersLabel(summary: CurrentRoomSummary, profileId: string): string {
  const otherPlayers = summary.players
    .filter((player) => player.profile_id !== profileId)
    .map((player) => player.profile.display_name);

  if (otherPlayers.length === 0) {
    return "Waiting for players";
  }

  return `With ${otherPlayers.join(", ")}`;
}

function currentRoomDetail(summary: CurrentRoomSummary, profileId: string): string {
  const status = currentRoomStatus(summary.room, profileId);

  if (status === "lobby") {
    return `${roomVisibilityLabel(summary.room.visibility)} lobby - ${summary.players.length}/${summary.room.player_count} seats`;
  }

  if (status === "finished") {
    return finishedRoomDetail(summary);
  }

  const turnNumber = summary.room.game_state?.turnNumber;

  if (status === "your-turn") {
    return turnNumber ? `Turn ${turnNumber} - make your move` : "Make your move";
  }

  const activeProfileId = summary.room.turn_profile_id;
  const activePlayer = activeProfileId
    ? summary.players.find((player) => player.profile_id === activeProfileId)
    : undefined;

  return activePlayer
    ? `Waiting on ${activePlayer.profile.display_name}${turnNumber ? ` - turn ${turnNumber}` : ""}`
    : "Waiting for the next turn";
}

function finishedRoomDetail(summary: CurrentRoomSummary): string {
  const winnerId = summary.room.game_state?.winnerId;

  if (!winnerId) {
    return "Game finished";
  }

  const seatIndex = Number(/^p([1-4])$/u.exec(winnerId)?.[1] ?? 0) - 1;
  const winner = summary.players.find((player) => player.seat_index === seatIndex);

  return `${winner?.profile.display_name ?? "A player"} won`;
}

function FriendRequestList({
  friends,
  incoming,
  outgoing,
  disabled,
  onRespond
}: {
  friends: FriendSummary[];
  incoming: FriendSummary[];
  outgoing: FriendSummary[];
  disabled: boolean;
  onRespond: (request: FriendSummary, status: "accepted" | "declined" | "canceled") => Promise<void>;
}): ReactElement {
  return (
    <div className="online-list">
      {incoming.map((request) => (
        <article className="online-list-item" key={request.request.id}>
          <div>
            <strong>{request.profile.display_name}</strong>
            <span>Wants to be friends.</span>
          </div>
          <button className="primary-button online-small-button" type="button" disabled={disabled} onClick={() => void onRespond(request, "accepted")}>
            Accept
          </button>
          <button className="secondary-button online-small-button" type="button" disabled={disabled} onClick={() => void onRespond(request, "declined")}>
            Decline
          </button>
        </article>
      ))}
      {friends.map((friend) => (
        <article className="online-list-item" key={friend.request.id}>
          <div>
            <strong>{friend.profile.display_name}</strong>
            <span>{friend.profile.friend_code}</span>
          </div>
        </article>
      ))}
      {outgoing.map((request) => (
        <article className="online-list-item" key={request.request.id}>
          <div>
            <strong>{request.profile.display_name}</strong>
            <span>Request pending.</span>
          </div>
          <button className="secondary-button online-small-button" type="button" disabled={disabled} onClick={() => void onRespond(request, "canceled")}>
            Cancel
          </button>
        </article>
      ))}
      {friends.length === 0 && incoming.length === 0 && outgoing.length === 0 ? (
        <p className="online-empty">Share your friend code or add someone else's.</p>
      ) : null}
    </div>
  );
}

function OnlineRoomSession({
  roomId,
  profile,
  friends,
  onExit
}: {
  roomId: string;
  profile: DisukoProfileRow;
  friends: FriendSummary[];
  onExit: () => void;
}): ReactElement {
  const [bundle, setBundle] = useState<RoomBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const autoStartAttemptKey = useRef<string | null>(null);

  const refreshRoom = async () => {
    const nextBundle = await loadRoomBundle(roomId);
    setBundle(nextBundle);
  };

  useEffect(() => {
    let canceled = false;

    const load = async () => {
      try {
        const nextBundle = await loadRoomBundle(roomId);

        if (!canceled) {
          setBundle(nextBundle);
        }
      } catch (caughtError) {
        if (!canceled) {
          setError(formatError(caughtError));
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      canceled = true;
    };
  }, [roomId]);

  useEffect(() => {
    return subscribeToRoom(roomId, () => {
      void refreshRoom();
    });
  }, [roomId]);

  const handleLeave = async () => {
    setSaving(true);
    setError(null);

    try {
      await leaveRoom(profile.id, roomId);
      onExit();
    } catch (caughtError) {
      setError(formatError(caughtError));
    } finally {
      setSaving(false);
    }
  };

  const handleInvite = async (friendProfileId: string) => {
    setSaving(true);
    setError(null);

    try {
      await inviteFriendToRoom(roomId, profile.id, friendProfileId);
      await refreshRoom();
    } catch (caughtError) {
      setError(formatError(caughtError));
      await refreshRoom();
    } finally {
      setSaving(false);
    }
  };

  const handleOnlineCommit = (nextGame: GameState) => {
    if (!bundle || saving) {
      return;
    }

    if (bundle.room.turn_profile_id && bundle.room.turn_profile_id !== profile.id) {
      setError("It is not your turn yet.");
      return;
    }

    const currentBundle = bundle;
    const optimisticRoom = optimisticRoomAfterGameCommit(currentBundle.room, currentBundle.players, profile.id, nextGame);

    setSaving(true);
    setError(null);

    if (optimisticRoom) {
      setBundle({
        ...currentBundle,
        room: optimisticRoom
      });
    }

    void commitRoomGameState(currentBundle.room, currentBundle.players, profile.id, nextGame)
      .then(async (result) => {
        if (result.ok && result.room) {
          setBundle((latest) => latest ? { ...latest, room: result.room as RoomBundle["room"] } : latest);
          return;
        }

        setError(result.reason === "not-your-turn" ? "It is not your turn yet." : "The room changed. Refreshed the board.");
        await refreshRoom();
      })
      .catch(async (caughtError: unknown) => {
        setError(formatError(caughtError));
        await refreshRoom();
      })
      .finally(() => setSaving(false));
  };

  useEffect(() => {
    if (!bundle || saving || bundle.room.status !== "lobby" || bundle.players.length !== bundle.room.player_count) {
      return;
    }

    const attemptKey = `${bundle.room.id}:${bundle.room.state_version}:${bundle.players.length}`;

    if (autoStartAttemptKey.current === attemptKey) {
      return;
    }

    let canceled = false;

    autoStartAttemptKey.current = attemptKey;
    setSaving(true);
    setError(null);

    void startRoomIfReady(bundle)
      .then((nextBundle) => {
        if (!canceled) {
          setBundle(nextBundle);
        }
      })
      .catch(async (caughtError: unknown) => {
        if (!canceled) {
          setError(formatError(caughtError));
          await refreshRoom();
        }
      })
      .finally(() => {
        if (!canceled) {
          setSaving(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [bundle, saving]);

  if (loading || !bundle) {
    return (
      <main className="setup-screen online-screen">
        <section className="setup-panel online-panel">
          <img className="setup-logo" src={logoUrl} alt="Disuko" />
          <p className="setup-copy">Loading room...</p>
          {error ? <p className="setup-warning" role="alert">{error}</p> : null}
        </section>
      </main>
    );
  }

  if (!bundle.room.game_state || bundle.room.status === "lobby") {
    const seatedFriendIds = new Set(bundle.players.map((player) => player.profile_id));
    const pendingInvites = bundle.pendingInvites.filter((invite) => !seatedFriendIds.has(invite.invite.recipient_profile_id));
    const pendingInviteByRecipientId = new Map(pendingInvites.map((invite) => [invite.invite.recipient_profile_id, invite]));
    const emptySeatIndexes = Array.from({ length: bundle.room.player_count }, (_, seatIndex) => seatIndex).filter((seatIndex) => {
      return !bundle.players.some((player) => player.seat_index === seatIndex);
    });
    const pendingInviteBySeatIndex = new Map(emptySeatIndexes.map((seatIndex, index) => [seatIndex, pendingInvites[index]]));
    const friendsNotSeated = friends.filter((friend) => !seatedFriendIds.has(friend.profile.id));

    return (
      <main className="setup-screen online-screen">
        <section className="setup-panel online-panel" aria-labelledby="room-title">
          <img className="setup-logo" src={logoUrl} alt="Disuko" />
          <h1 id="room-title">Game lobby</h1>
          <p className="setup-copy">
            {roomVisibilityLabel(bundle.room.visibility)} game - {bundle.players.length}/{bundle.room.player_count} seats
          </p>
          {error ? <p className="setup-warning" role="alert">{error}</p> : null}

          <section className="online-card">
            <h2>Players</h2>
            <div className="online-list">
              {Array.from({ length: bundle.room.player_count }, (_, seatIndex) => {
                const player = bundle.players.find((candidate) => candidate.seat_index === seatIndex);
                const pendingInvite = pendingInviteBySeatIndex.get(seatIndex);

                return (
                  <article className={`online-list-item ${pendingInvite ? "is-pending-invite" : ""}`} key={seatIndex}>
                    <div>
                      <strong>{player?.profile.display_name ?? pendingInvite?.recipient.display_name ?? `Seat ${seatIndex + 1}`}</strong>
                      <span>{player ? playerIdForUiSeat(seatIndex) : pendingInvite ? "Invited" : "Waiting"}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="online-card">
            <h2>Invite friends</h2>
            <div className="online-list">
              {friendsNotSeated.map((friend) => {
                const pendingInvite = pendingInviteByRecipientId.get(friend.profile.id);

                return (
                  <article className={`online-list-item ${pendingInvite ? "is-pending-invite" : ""}`} key={friend.profile.id}>
                    <div>
                      <strong>{friend.profile.display_name}</strong>
                      <span>{pendingInvite ? "Invite pending" : friend.profile.friend_code}</span>
                    </div>
                    <button
                      className="secondary-button online-small-button"
                      type="button"
                      disabled={saving || Boolean(pendingInvite)}
                      onClick={() => void handleInvite(friend.profile.id)}
                    >
                      {pendingInvite ? "Pending" : "Invite"}
                    </button>
                  </article>
                );
              })}
              {friends.length === 0 ? <p className="online-empty">Add friends from the online dashboard to invite them here.</p> : null}
              {friends.length > 0 && friendsNotSeated.length === 0 ? <p className="online-empty">Every friend is already seated in this room.</p> : null}
            </div>
          </section>

          <div className="setup-actions">
            <button className="secondary-button" type="button" disabled={saving} onClick={() => void handleLeave()}>
              Leave
            </button>
            {bundle.players.length === bundle.room.player_count ? (
              <span className="online-lobby-status" role="status">{saving ? "Starting..." : "Ready"}</span>
            ) : null}
          </div>
        </section>
      </main>
    );
  }

  const game = bundle.room.game_state;
  const onlineGame = game.tabletopMode ? { ...game, tabletopMode: false } : game;
  const onlineSeat = bundle.players.find((player) => player.profile_id === profile.id);
  const onlinePlayerId = onlineSeat ? playerIdForSeat(onlineSeat.seat_index) : undefined;

  return (
    <GameScreen
      game={onlineGame}
      onCommit={handleOnlineCommit}
      onOpenMenu={() => setShowMenu(true)}
      onNewGame={onExit}
      newGameLabel="Games"
      onlinePlayerId={onlinePlayerId}
      showOnlinePlayerNames
      suppressTurnPrompt
    >
      <OnlineGameBanner
        saving={saving}
        error={error}
      />
      {showMenu ? (
        <MenuOverlay
          game={onlineGame}
          onResume={() => setShowMenu(false)}
          onNewGame={onExit}
          newGameLabel="Games"
        />
      ) : null}
    </GameScreen>
  );
}

function OnlineGameBanner({
  saving,
  error
}: {
  saving: boolean;
  error: string | null;
}): ReactElement | null {
  if (!saving && !error) {
    return null;
  }

  return (
    <aside className="online-game-banner" aria-live="polite">
      {saving ? <span>Syncing...</span> : null}
      {error ? <em>{error}</em> : null}
    </aside>
  );
}

function roomVisibilityLabel(visibility: RoomVisibility): string {
  if (visibility === "public") {
    return "Public";
  }

  if (visibility === "friends") {
    return "Friends";
  }

  return "Private";
}

function playerIdForUiSeat(seatIndex: number): string {
  return `Player ${seatIndex + 1}`;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "Something went wrong.";
}

function LocalSetupScreen({
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
        <h1 id="setup-title">Local Disuko</h1>
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
            Start Local Game
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
  newGameLabel = "New",
  onlinePlayerId,
  showOnlinePlayerNames = false,
  suppressTurnPrompt = false,
  children
}: {
  game: GameState;
  onCommit: (game: GameState) => void;
  onOpenMenu: () => void;
  onNewGame: () => void;
  newGameLabel?: string;
  onlinePlayerId?: string;
  showOnlinePlayerNames?: boolean;
  suppressTurnPrompt?: boolean;
  children: ReactNode;
}): ReactElement {
  const [openRerollValue, setOpenRerollValue] = useState<DiceValue | null>(null);
  const [hasExplicitRerollSelection, setHasExplicitRerollSelection] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ die: Die; x: number; y: number } | null>(null);
  const [invalidMovePreview, setInvalidMovePreview] = useState<InvalidMovePreview | null>(null);
  const [conflictBlockerHighlight, setConflictBlockerHighlight] = useState<ConflictBlockerHighlight | null>(null);
  const [completionReward, setCompletionReward] = useState<CompletionReward | null>(null);
  const [winnerCelebration, setWinnerCelebration] = useState<WinnerCelebrationLayout | null>(null);
  const [turnPromptOpen, setTurnPromptOpen] = useState(false);
  const [compactTrayLayout, setCompactTrayLayout] = useState(() => {
    const viewport = getViewportSize();

    return !game.tabletopMode && game.players.length >= 3 && viewport.height <= COMPACT_TRAY_INITIAL_HEIGHT_PX;
  });
  const shellRef = useRef<HTMLElement | null>(null);
  const invalidMovePreviewId = useRef(0);
  const invalidMovePreviewTimer = useRef<number | null>(null);
  const conflictBlockerHighlightId = useRef(0);
  const conflictBlockerHighlightTimer = useRef<number | null>(null);
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
    originX: number;
    originY: number;
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
  const pinnedTrayPlayer = onlinePlayerId
    ? game.players.find((player) => player.id === onlinePlayerId) ?? activePlayer
    : activePlayer;
  const actionCountLabel = `${game.actionCredits} action${game.actionCredits === 1 ? "" : "s"}`;
  const onlineWaitingTurnLabel = showOnlinePlayerNames && onlinePlayerId && activePlayer.id !== onlinePlayerId
    ? `${activePlayer.name}'s turn`
    : null;
  const canUseTurnControls = !showOnlinePlayerNames || Boolean(onlinePlayerId && activePlayer.id === onlinePlayerId);
  const trayStatusLabel = game.mode === "reroll" ? "Select the dice to re-roll" : actionCountLabel;
  const activePlayerNumber = game.currentPlayerIndex + 1;
  const activePlayerColor = playerColorCssVars[activePlayer.color];
  const winner = game.winnerId ? game.players.find((player) => player.id === game.winnerId) : undefined;
  const conflictDice = useMemo(() => conflictDieIds(game), [game]);
  const conflictCells = useMemo(() => conflictCellKeys(game), [game]);
  const completionRewardOverlay: BoardCompletionReward | null = completionReward
    ? {
        id: completionReward.id,
        activeKey:
          completionReward.phase === "highlight" ? completionReward.completedKeys[completionReward.activeIndex] : null,
        bonusActions: completionReward.phase === "bonus" ? completionReward.completedKeys.length : null,
        color: COMPLETION_FEEDBACK_COLOR,
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
  const transientDieId = dragPreview?.die.id ?? invalidMovePreview?.die.id ?? null;

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

  const clearInvalidMovePreview = () => {
    if (invalidMovePreviewTimer.current !== null) {
      window.clearTimeout(invalidMovePreviewTimer.current);
      invalidMovePreviewTimer.current = null;
    }

    setInvalidMovePreview(null);

    if (conflictBlockerHighlightTimer.current !== null) {
      window.clearTimeout(conflictBlockerHighlightTimer.current);
      conflictBlockerHighlightTimer.current = null;
    }

    setConflictBlockerHighlight(null);
  };

  const showConflictBlockerHighlight = (dieIds: string[]) => {
    if (conflictBlockerHighlightTimer.current !== null) {
      window.clearTimeout(conflictBlockerHighlightTimer.current);
      conflictBlockerHighlightTimer.current = null;
    }

    const uniqueDieIds = [...new Set(dieIds)];

    if (uniqueDieIds.length === 0) {
      setConflictBlockerHighlight(null);
      return;
    }

    const id = conflictBlockerHighlightId.current + 1;
    conflictBlockerHighlightId.current = id;
    setConflictBlockerHighlight({
      id,
      dieIds: uniqueDieIds,
      color: CONFLICT_BLOCKER_FEEDBACK_COLOR,
      messageColor: INVALID_MOVE_FEEDBACK_COLOR,
      playerSlot: game.tabletopMode ? tabletopSlotForPlayer(game, activePlayer.id) : undefined
    });
    conflictBlockerHighlightTimer.current = window.setTimeout(() => {
      setConflictBlockerHighlight((current) => (current?.id === id ? null : current));
      conflictBlockerHighlightTimer.current = null;
    }, INVALID_MOVE_ANIMATION_MS);
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
      if (invalidMovePreviewTimer.current !== null) {
        window.clearTimeout(invalidMovePreviewTimer.current);
      }

      if (conflictBlockerHighlightTimer.current !== null) {
        window.clearTimeout(conflictBlockerHighlightTimer.current);
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
      setTurnPromptOpen(!game.tabletopMode && !suppressTurnPrompt);
    }
  }, [game.seed, game.turnNumber, game.currentPlayerIndex, game.phase, game.tabletopMode, suppressTurnPrompt]);

  useEffect(() => {
    if (suppressTurnPrompt) {
      setTurnPromptOpen(false);
    }
  }, [suppressTurnPrompt]);

  useEffect(() => {
    if (canUseTurnControls) {
      return;
    }

    clearDragState();
    clearStackLongPress();
    setOpenRerollValue(null);
    setHasExplicitRerollSelection(false);
  }, [canUseTurnControls]);

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
        playerName: winner.name,
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
    clearInvalidMovePreview();
    onOpenMenu();
  };

  const handleNewGame = () => {
    clearInvalidMovePreview();
    onNewGame();
  };

  const findRenderedDieCenter = (die: Die): ScreenPoint | null => {
    if (die.row !== null && die.col !== null) {
      const boardDie = document.querySelector<HTMLElement>(
        `.board-cell[data-row="${die.row}"][data-col="${die.col}"] .die-face`
      );

      if (boardDie) {
        return centerOfElement(boardDie);
      }
    }

    const dieElement = Array.from(document.querySelectorAll<HTMLElement>("[data-die-id]")).find(
      (element) =>
        element.dataset.dieId === die.id && !element.closest(".drag-preview, .invalid-return-preview")
    );

    return dieElement ? centerOfElement(dieElement) : null;
  };

  const findTrayCenter = (playerId: string): ScreenPoint | null => {
    const tray =
      document.querySelector<HTMLElement>(`.dice-tray[data-player-id="${playerId}"]`) ??
      document.querySelector<HTMLElement>(".dice-tray");

    return tray ? centerOfElement(tray) : null;
  };

  const showInvalidMoveReturn = (
    die: Die,
    from: ScreenPoint,
    to?: ScreenPoint | null,
    options: { playerId?: string; returnKind?: InvalidReturnKind } = {}
  ) => {
    if (invalidMovePreviewTimer.current !== null) {
      window.clearTimeout(invalidMovePreviewTimer.current);
    }

    const playerId = options.playerId ?? die.ownerId;
    const destination = to ?? findRenderedDieCenter(die) ?? findTrayCenter(playerId) ?? {
      x: from.x,
      y: from.y + window.innerHeight * 0.28
    };
    const id = invalidMovePreviewId.current + 1;
    const returnKind = options.returnKind ?? (isOnBoard(die) ? "move" : "place");

    invalidMovePreviewId.current = id;
    setInvalidMovePreview({
      id,
      die,
      returnKind,
      startX: from.x,
      startY: from.y,
      returnX: destination.x - from.x,
      returnY: destination.y - from.y
    });
    invalidMovePreviewTimer.current = window.setTimeout(() => {
      setInvalidMovePreview((current) => (current?.id === id ? null : current));
      invalidMovePreviewTimer.current = null;
    }, INVALID_MOVE_ANIMATION_MS);
  };

  const showInvalidPlacement = (
    die: Die,
    row: number,
    col: number,
    returnPath?: { from: ScreenPoint; to: ScreenPoint }
  ) => {
    const cell = document.querySelector<HTMLElement>(`.board-cell[data-row="${row}"][data-col="${col}"]`);
    const from =
      returnPath?.from ?? (cell ? centerOfElement(cell) : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const to = returnPath?.to ?? findRenderedDieCenter(die) ?? findTrayCenter(activePlayer.id);

    showInvalidMoveReturn(die, from, to, {
      playerId: activePlayer.id,
      returnKind: "place"
    });
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
    if (!canUseTurnControls) {
      return;
    }

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
    if (!canUseTurnControls || game.mode !== "reroll" || game.phase === "won") {
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
    if (!canUseTurnControls) {
      return;
    }

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

  const commitDieToCell = (
    die: Die,
    row: number,
    col: number,
    returnPath?: { from: ScreenPoint; to: ScreenPoint }
  ) => {
    const cellDie = getDieAt(game, row, col);

    if (cellDie?.id === die.id) {
      return;
    }

    if (cellDie) {
      const cell = document.querySelector<HTMLElement>(`.board-cell[data-row="${row}"][data-col="${col}"]`);
      const from = returnPath?.from ?? (cell ? centerOfElement(cell) : findRenderedDieCenter(die));

      showInvalidMoveReturn(die, from ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }, returnPath?.to);
      return;
    }

    if (isOnBoard(die)) {
      if (wouldMoveDieConflict(game, die.id, row, col)) {
        const cell = document.querySelector<HTMLElement>(`.board-cell[data-row="${row}"][data-col="${col}"]`);
        const from = returnPath?.from ?? (cell ? centerOfElement(cell) : findRenderedDieCenter(die));

        showInvalidMoveReturn(die, from ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }, returnPath?.to, {
          returnKind: "move"
        });
        showConflictBlockerHighlight(conflictBlockerDieIds(game, die, row, col));
      }

      onCommit(moveDie(game, die.id, row, col));
      return;
    }

    if (wouldPlaceDieConflict(game, die.id, row, col)) {
      showInvalidPlacement(die, row, col, returnPath);
      showConflictBlockerHighlight(conflictBlockerDieIds(game, die, row, col));
      onCommit(placeDie(game, die.id, row, col));
      return;
    }

    onCommit(placeDie(game, die.id, row, col));
  };

  const handleCell = (row: number, col: number) => {
    if (!canUseTurnControls) {
      return;
    }

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
    if (!canUseTurnControls || game.phase === "won") {
      return;
    }

    if (isOnBoard(die) && wasDieMovedThisTurn(game, die.id)) {
      return;
    }

    clearDragListeners();
    const origin = centerOfElement(event.currentTarget);
    dragCandidate.current = {
      dieId: die.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
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
    const releasePoint = { x: event.clientX, y: event.clientY };
    const originPoint = { x: candidate.originX, y: candidate.originY };
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".board-cell");
    const row = Number(target?.dataset.row);
    const col = Number(target?.dataset.col);

    if (!die) {
      return;
    }

    if (!target || !Number.isInteger(row) || !Number.isInteger(col)) {
      showInvalidMoveReturn(die, releasePoint, originPoint);
      return;
    }

    commitDieToCell(die, row, col, { from: releasePoint, to: originPoint });
  };

  const handleDiePointerCancel = (event: DragPointerEvent) => {
    if (dragCandidate.current?.pointerId !== event.pointerId) {
      return;
    }

    clearDragState();
  };

  const handleReroll = () => {
    if (!canUseTurnControls) {
      return;
    }

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
    if (!canUseTurnControls) {
      return;
    }

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
      conflictBlockerHighlight={conflictBlockerHighlight}
      tabletopMode={game.tabletopMode}
      activePlayerColor={activePlayerColor}
      canInteract={canUseTurnControls && game.phase !== "won"}
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
    const isPinnedOnlineTray = Boolean(showOnlinePlayerNames && onlinePlayerId && player.id === onlinePlayerId);
    const trayMode = isActive ? game.mode : "place";
    const trayGroups = isActive ? currentTrayGroups : groupDiceByValue(offBoardDice(game, player.id));
    const disabled = !canUseTurnControls || !isActive || game.phase === "won";
    const rerollReady = canUseTurnControls && isActive && game.mode === "reroll" && game.selectedDieIds.length > 0;
    const playerActionCountLabel = isActive
      ? canUseTurnControls
        ? trayStatusLabel
        : onlineWaitingTurnLabel ?? `${activePlayer.name}'s turn`
      : isPinnedOnlineTray && onlineWaitingTurnLabel
        ? onlineWaitingTurnLabel
        : "0 actions";
    const trayClassName = [
      isActive ? "is-active-player" : "",
      showOnlinePlayerNames ? "is-online-tray" : ""
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <DiceTray
        groups={trayGroups}
        selectedIds={isActive && canUseTurnControls ? selectedDieIdSet : new Set<string>()}
        player={player}
        mode={trayMode}
        draggingDieId={transientDieId}
        openRerollValue={isActive ? openRerollValue : null}
        actionCountLabel={playerActionCountLabel}
        rollLabel={rerollReady ? "ready" : "re-roll"}
        rollColor={rerollReady ? "green" : "blue"}
        rollActive={rerollReady}
        disabled={disabled}
        hidePlayerName={game.tabletopMode}
        showPlayerName={showOnlinePlayerNames}
        className={trayClassName}
        style={{ "--tray-player-color": playerColorCssVars[player.color] } as CSSProperties}
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
            {newGameLabel}
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
              {newGameLabel}
            </button>
          </header>

          <OpponentTrayStrip
            game={game}
            pinnedPlayer={pinnedTrayPlayer}
            activePlayer={activePlayer}
            hiddenDieId={transientDieId}
            showPlayerNames={showOnlinePlayerNames}
          />

          {board}

          <div className="side-stack">
            <section className="control-dock" aria-label="Game controls">
              {renderPlayerTray(pinnedTrayPlayer)}
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

      {invalidMovePreview ? (
        <>
          <div
            className={`invalid-return-preview ${
              invalidMovePreview.returnKind === "move" ? "is-board-move" : "is-placement"
            }`}
            style={
              {
                left: invalidMovePreview.startX,
                top: invalidMovePreview.startY,
                "--invalid-return-x": `${invalidMovePreview.returnX}px`,
                "--invalid-return-y": `${invalidMovePreview.returnY}px`
              } as CSSProperties
            }
            aria-hidden="true"
          >
            <DieFace die={invalidMovePreview.die} compact />
          </div>
        </>
      ) : null}

      {turnPromptOpen && game.phase === "playing" && !game.tabletopMode && !suppressTurnPrompt ? (
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
        <strong id="winner-title">{layout.playerName || `Player ${layout.playerNumber}`} won!</strong>
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

function conflictBlockerDieIds(game: GameState, die: Die, row: number, col: number): string[] {
  const targetBox = boxIndex(row, col);

  return game.dice
    .filter((candidate) => {
      if (candidate.id === die.id || !isOnBoard(candidate) || candidate.value !== die.value) {
        return false;
      }

      return (
        candidate.row === row ||
        candidate.col === col ||
        boxIndex(candidate.row as number, candidate.col as number) === targetBox
      );
    })
    .map((candidate) => candidate.id);
}

function dieOutlineSegmentsForIds(game: GameState, dieIds: string[]): CompletionSegment[] {
  const dieIdSet = new Set(dieIds);

  return game.dice
    .filter((die) => dieIdSet.has(die.id) && isOnBoard(die))
    .map((die) => ({
      row: die.row as number,
      col: die.col as number,
      rowSpan: 1,
      colSpan: 1,
      outline: "die"
    }));
}

function completionSegmentStyle(segment: CompletionSegment, color: string, index: number): CSSProperties {
  return {
    "--completion-color": color,
    "--completion-row": segment.row,
    "--completion-col": segment.col,
    "--completion-row-span": segment.rowSpan,
    "--completion-col-span": segment.colSpan,
    "--completion-trace-delay": `${index * 42}ms`
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
  pinnedPlayer,
  activePlayer,
  hiddenDieId,
  showPlayerNames = false
}: {
  game: GameState;
  pinnedPlayer: Player;
  activePlayer: Player;
  hiddenDieId: string | null;
  showPlayerNames?: boolean;
}): ReactElement {
  const opponents = game.players.filter((player) => player.id !== pinnedPlayer.id);

  return (
    <section className="opponent-tray-zone" aria-label="Other players">
      {opponents.map((player) => {
        const playerIndex = game.players.findIndex((candidate) => candidate.id === player.id) + 1;
        const rowClassName = [
          `opponent-tray-row opponent-${player.color}`,
          player.id === activePlayer.id ? "is-active-player" : ""
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <article className={rowClassName} key={player.id}>
            <strong>{showPlayerNames ? player.name : `Player ${playerIndex}`}</strong>
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
  conflictBlockerHighlight,
  tabletopMode = false,
  activePlayerColor,
  canInteract,
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
  conflictBlockerHighlight: ConflictBlockerHighlight | null;
  tabletopMode?: boolean;
  activePlayerColor?: string;
  canInteract: boolean;
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
  const conflictBlockerSegments = conflictBlockerHighlight
    ? dieOutlineSegmentsForIds(game, conflictBlockerHighlight.dieIds)
    : [];
  const bonusLabel = completionReward?.bonusActions
    ? `+${completionReward.bonusActions} Action${completionReward.bonusActions === 1 ? "" : "s"}`
    : null;

  return (
    <section
      className={`board-wrap ${tabletopMode ? "is-tabletop-board" : ""} ${canInteract ? "" : "is-readonly"}`}
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
              disabled={!canInteract}
              onClick={canInteract ? () => onCell(row, col) : undefined}
            >
              {die ? (
                <DieFace
                  die={die}
                  selected={game.selectedDieIds.includes(die.id)}
                  conflicted={conflictDice.has(die.id)}
                  recentMoveColor={recentMoveColor}
                  moveLocked={moveLocked}
                  draggingSource={draggingDieId === die.id}
                  onClick={canInteract ? () => onDie(die) : undefined}
                  onPointerDown={canInteract ? (event) => onDiePointerDown(event, die) : undefined}
                  onPointerMove={canInteract ? onDiePointerMove : undefined}
                  onPointerUp={canInteract ? onDiePointerUp : undefined}
                  onPointerCancel={canInteract ? onDiePointerCancel : undefined}
                />
              ) : null}
            </button>
          );
        })}
        {completionSegments.map((segment, index) => (
          <div
            className={`completion-highlight-segment ${segment.outline === "die" ? "is-dice-outline" : ""}`}
            key={`${completionReward?.id}-${completionReward?.activeKey}-${index}`}
            style={completionSegmentStyle(
              segment,
              completionReward?.color ?? COMPLETION_FEEDBACK_COLOR,
              index
            )}
            aria-hidden="true"
          />
        ))}
        {conflictBlockerSegments.map((segment, index) => (
          <div
            className="completion-highlight-segment is-dice-outline is-conflict-blocker"
            key={`${conflictBlockerHighlight?.id}-${index}`}
            style={completionSegmentStyle(
              segment,
              conflictBlockerHighlight?.color ?? CONFLICT_BLOCKER_FEEDBACK_COLOR,
              index
            )}
            aria-hidden="true"
          />
        ))}
        {conflictBlockerHighlight ? (
          <div
            className={`completion-bonus-pop conflict-message-pop ${
              conflictBlockerHighlight.playerSlot ? `faces-${conflictBlockerHighlight.playerSlot}` : ""
            }`}
            key={`${conflictBlockerHighlight.id}-message`}
            style={{ "--completion-color": conflictBlockerHighlight.messageColor } as CSSProperties}
            role="status"
            aria-live="polite"
          >
            Invalid move
          </div>
        ) : null}
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
  showPlayerName = false,
  className,
  style,
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
  showPlayerName?: boolean;
  className?: string;
  style?: CSSProperties;
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
      style={style}
      aria-label={hidePlayerName ? `${player.color} dice tray` : `${player.name}'s dice tray`}
    >
      <div className="tray-control-row">
        <div className="tray-dice-column">
          <div
            className={`tray-status-row ${mode === "reroll" ? "is-reroll-message" : ""} ${
              showPlayerName ? "has-player-name" : ""
            }`}
            aria-live="polite"
          >
            {showPlayerName ? <span className="tray-player-name">{player.name}</span> : null}
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
          {mode === "reroll" && !disabled ? (
            <button className="reroll-cancel-button" type="button" onClick={onCancelReroll}>
              Cancel
            </button>
          ) : null}
          <ActionButton
            color={rollColor}
            icon={<MiniDieIcon />}
            label={rollLabel}
            active={rollActive}
            disabled={disabled}
            className="tray-roll-button"
            onClick={onRoll}
          />
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
    <div
      className={`dice-rail-groove ${readOnly ? "is-readonly" : ""} ${className ?? ""}`}
      style={
        {
          "--rail-group-count": Math.max(visibleGroups.length, 1),
          "--rail-gap-count": Math.max(visibleGroups.length - 1, 0)
        } as CSSProperties
      }
    >
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
  onNewGame,
  newGameLabel = "New game"
}: {
  game: GameState;
  onResume: () => void;
  onNewGame: () => void;
  newGameLabel?: string;
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
            {newGameLabel}
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
      data-die-id={die.id}
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
