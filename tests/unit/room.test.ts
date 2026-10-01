import { describe, expect, it } from 'vitest';
import { generateGameId } from '../../src/lib/room';

const GUID = '3f2b8c1e-9d4a-4f5e-8b6c-2a1d0e9f7c35';
const fixedUuid = () => GUID;

describe('generateGameId', () => {
    it('formats a fixed UTC time and uuid exactly', () => {
        const id = generateGameId(new Date(Date.UTC(2026, 9, 2, 14, 7, 59)), fixedUuid);
        expect(id).toBe(`2026-10-02-14:07-${GUID}`);
    });

    it('zero-pads single-digit month, day, hour and minute', () => {
        const id = generateGameId(new Date(Date.UTC(2026, 0, 5, 3, 4)), fixedUuid);
        expect(id).toBe(`2026-01-05-03:04-${GUID}`);
    });

    it('uses UTC regardless of the local time zone', () => {
        const id = generateGameId(new Date('2026-12-31T23:59:00Z'), fixedUuid);
        expect(id.startsWith('2026-12-31-23:59-')).toBe(true);
    });

    it('uses crypto.randomUUID by default and matches the format', () => {
        const id = generateGameId();
        expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}:\d{2}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(generateGameId()).not.toBe(id);
    });

    it('contains no characters forbidden in Firebase keys', () => {
        for (let i = 0; i < 20; i++) {
            expect(generateGameId()).not.toMatch(/[.#$[\]/]/);
        }
    });

    it('sorts later times after earlier ones as strings', () => {
        const times = [
            '2026-01-05T03:04:00Z',
            '2026-01-05T03:10:00Z',
            '2026-01-05T11:00:00Z',
            '2026-01-15T00:00:00Z',
            '2026-10-01T00:00:00Z',
            '2027-02-01T00:00:00Z',
        ];
        // Reverse the uuids so the order can only come from the time prefix.
        const ids = times.map((t, i) => generateGameId(new Date(t), () => `${9 - i}`.repeat(8)));
        expect([...ids].sort()).toEqual(ids);
    });
});
