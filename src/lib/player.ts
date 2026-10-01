export interface Player {
    id: string;
    name: string;
    isHost: boolean;
    /** Join time; the lobby order becomes the clockwise seating order. */
    joinedAt: number;
};
