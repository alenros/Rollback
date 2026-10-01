import type { Player } from './player';

// Player identity lives in localStorage, like obviously-static: no accounts, and a
// page refresh keeps you in your seat.

export function getSavedName(): string {
    return localStorage.getItem('playerName') ?? '';
}

export function saveName(name: string): void {
    localStorage.setItem('playerName', name);
}

export function getCurrentPlayer(): Player | null {
    const raw = localStorage.getItem('currentPlayer');
    try {
        return raw ? JSON.parse(raw) as Player : null;
    } catch {
        return null;
    }
}

export function saveSession(roomCode: string, player: Player): void {
    localStorage.setItem('currentRoom', roomCode);
    localStorage.setItem('currentPlayer', JSON.stringify(player));
}

export function clearSession(): void {
    localStorage.removeItem('currentRoom');
    localStorage.removeItem('currentPlayer');
}

export function getRoomCodeFromUrl(): string | null {
    return new URLSearchParams(window.location.search).get('code')?.toUpperCase() ?? null;
}

export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}
