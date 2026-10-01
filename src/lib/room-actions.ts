/**
 * Firebase glue. Every state change runs as a Realtime Database transaction, so
 * two players acting at once can't both win a race: Firebase re-runs the loser's
 * update function against the new state, and the rules engine rejects it if it's
 * no longer legal.
 */
import { firebase, getDatabase } from './firebase';
import {
    applyAction, GameError, normalizeGame, startGame, startNextRound,
    type Action, type GameState,
} from './game';
import { DEFAULT_RULESET_ID, getRuleset, RULESETS, type RulesetId } from './rulesets';
import { GameStatus } from './game-status';
import type { Player } from './player';
import { generatePlayerId, generateRoomCode, playersInOrder, type Room } from './room';
import { buildEvents, eventKey, type TelemetryEvent } from './telemetry';

const roomRef = (code: string) => getDatabase().ref(`rooms/${code}`);

/**
 * Run `update` as a transaction on `ref`. `update` may throw a GameError to abort;
 * the error is rethrown to the caller once Firebase settles.
 */
async function transact<T>(
    ref: firebase.database.Reference,
    update: (current: T) => T,
): Promise<firebase.database.DataSnapshot> {
    let error: unknown = null;
    const result = await ref.transaction((current: T | null) => {
        error = null;
        // With a cold cache the first attempt sees null; returning it lets the
        // server reply with the real value and Firebase retries.
        if (current === null) return current;
        try {
            return update(current);
        } catch (e) {
            error = e;
            return undefined; // abort
        }
    }, undefined, false);
    if (error) throw error;
    if (!result.snapshot.exists()) throw new GameError('Room not found');
    return result.snapshot;
}

export async function createRoom(playerName: string): Promise<{ roomCode: string; player: Player }> {
    const db = getDatabase();
    let roomCode = generateRoomCode();
    while ((await db.ref(`rooms/${roomCode}`).once('value')).exists()) {
        roomCode = generateRoomCode();
    }
    const player: Player = { id: generatePlayerId(), name: playerName, isHost: true, joinedAt: Date.now() };
    const room: Room = {
        code: roomCode,
        name: `${playerName}'s Room`,
        status: GameStatus.WAITING,
        players: { [player.id]: player },
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        hostId: player.id,
        rulesetId: DEFAULT_RULESET_ID,
    };
    await roomRef(roomCode).set(room);
    return { roomCode, player };
}

export async function joinRoom(roomCode: string, playerName: string): Promise<Player> {
    const ref = roomRef(roomCode);
    if (!(await ref.once('value')).exists()) throw new GameError('Room not found');
    const player: Player = { id: generatePlayerId(), name: playerName, isHost: false, joinedAt: Date.now() };
    await transact<Room>(ref, room => {
        if (room.status !== GameStatus.WAITING) throw new GameError('Game is already in progress');
        const max = getRuleset(room.rulesetId).maxPlayers;
        if (Object.keys(room.players ?? {}).length >= max) {
            throw new GameError(`Room is full (${max} players max)`);
        }
        return { ...room, players: { ...room.players, [player.id]: player } };
    });
    return player;
}

/** Leave the lobby. If the host leaves, the longest-waiting player becomes host. */
export async function leaveRoom(roomCode: string, playerId: string): Promise<void> {
    const ref = roomRef(roomCode);
    await ref.once('value');
    await ref.transaction((room: Room | null) => {
        if (!room) return room;
        const players = { ...room.players };
        delete players[playerId];
        const remaining = playersInOrder({ players });
        if (remaining.length === 0) return null; // last one out deletes the room
        if (room.hostId !== playerId || room.status !== GameStatus.WAITING) return { ...room, players };
        const host = remaining[0];
        players[host.id] = { ...host, isHost: true };
        return { ...room, players, hostId: host.id };
    }, undefined, false);
}

/**
 * Append telemetry events under telemetry/games/{gameId}/events. Fire-and-forget:
 * a failed write is logged and never blocks or breaks the game.
 */
function recordTelemetry(events: TelemetryEvent[]): void {
    if (events.length === 0 || !events[0].gameId) return;
    const updates: Record<string, unknown> = {};
    events.forEach((event, i) => {
        updates[`telemetry/games/${event.gameId}/events/${eventKey(event, i)}`] =
            { ...event, at: firebase.database.ServerValue.TIMESTAMP };
    });
    getDatabase().ref().update(updates).catch(error => console.warn('Telemetry write failed:', error));
}

/** Host action in the lobby: choose which ruleset the game will use. */
export async function setRoomRuleset(roomCode: string, hostId: string, rulesetId: RulesetId): Promise<void> {
    if (!(rulesetId in RULESETS)) throw new GameError('Unknown ruleset');
    const ref = roomRef(roomCode);
    await ref.once('value');
    await transact<Room>(ref, room => {
        if (room.hostId !== hostId) throw new GameError('Only the host can choose the rules');
        if (room.status !== GameStatus.WAITING) throw new GameError('The game has already started');
        const rules = getRuleset(rulesetId);
        const count = Object.keys(room.players ?? {}).length;
        if (count > rules.maxPlayers) throw new GameError(`${rules.name} allows at most ${rules.maxPlayers} players`);
        return { ...room, rulesetId };
    });
}

export async function startRoomGame(roomCode: string, hostId: string): Promise<void> {
    const ref = roomRef(roomCode);
    await ref.once('value');
    const gameId = getDatabase().ref().push().key!; // unique, time-ordered
    let started: GameState | null = null;
    await transact<Room>(ref, room => {
        started = null;
        if (room.hostId !== hostId) throw new GameError('Only the host can start the game');
        if (room.status !== GameStatus.WAITING) return room; // already started
        const players = playersInOrder(room);
        const rules = getRuleset(room.rulesetId);
        if (players.length < rules.minPlayers) throw new GameError(`Need at least ${rules.minPlayers} players`);
        started = startGame(players, Math.random, { gameId, rulesetId: rules.id as RulesetId });
        return { ...room, status: GameStatus.PLAYING, game: started };
    });
    if (started) recordTelemetry(buildEvents(null, started));
}

async function updateGame(
    roomCode: string,
    update: (state: GameState) => GameState,
    action?: Action,
): Promise<void> {
    const ref = getDatabase().ref(`rooms/${roomCode}/game`);
    // Firebase may run the update several times; the last run is the one that committed.
    let before: GameState | null = null;
    let after: GameState | null = null;
    await transact<GameState>(ref, raw => {
        before = normalizeGame(raw);
        after = update(before);
        return after;
    });
    if (before && after) recordTelemetry(buildEvents(before, after, action));
}

export function sendAction(roomCode: string, action: Action): Promise<void> {
    return updateGame(roomCode, state => applyAction(state, action), action);
}

export function beginNextRound(roomCode: string): Promise<void> {
    return updateGame(roomCode, state => startNextRound(state));
}

export function watchRoom(roomCode: string, onRoom: (room: Room | null) => void): () => void {
    const ref = roomRef(roomCode);
    const listener = ref.on('value', snap => {
        const room = snap.val() as Room | null;
        if (room?.game) room.game = normalizeGame(room.game);
        onRoom(room);
    });
    return () => ref.off('value', listener);
}
