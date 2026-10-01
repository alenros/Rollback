import type { GameState } from './game';
import type { GameStatus } from './game-status';
import type { Player } from './player';
import type { RulesetId } from './rulesets';

export interface Room {
    code: string;
    name: string;
    status: GameStatus;
    players: { [playerId: string]: Player };
    createdAt: any;
    hostId: string;
    /** Chosen by the host in the lobby; copied into the game when it starts. */
    rulesetId?: RulesetId;
    game?: GameState;
};

export function generateRoomCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase().padEnd(6, '0');
}

export function generatePlayerId(): string {
    return 'player_' + Math.random().toString(36).substring(2, 11);
}

/** Players in join order, which is also the clockwise seating order. */
export function playersInOrder(room: Pick<Room, 'players'>): Player[] {
    return Object.values(room.players ?? {}).sort((a, b) => a.joinedAt - b.joinedAt);
}
