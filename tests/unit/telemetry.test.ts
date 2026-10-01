import { describe, expect, it } from 'vitest';
import type { Color, Die } from '../../src/lib/dice';
import { applyAction, startGame, startNextRound, type GameState } from '../../src/lib/game';
import { buildEvents, eventKey } from '../../src/lib/telemetry';

const die = (id: string, value: number, sides: Die['sides'] = 12, color: Color = 'red'): Die => ({ id, color, sides, value });
const ones = () => 0;

function threePlayerState(hands: Record<string, Die[]>): GameState {
    const s = startGame([{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Cat' }], ones, { gameId: 'g1' });
    return { ...s, hands, turn: 'a' };
}

describe('buildEvents', () => {
    it('opens with gameStart and roundStart, without player names', () => {
        const s = startGame([{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Ben' }], ones, { gameId: 'g1' });
        const events = buildEvents(null, s);
        expect(events.map(e => e.type)).toEqual(['gameStart', 'roundStart']);
        expect(events[0]).toMatchObject({
            gameId: 'g1', seq: 0, playerCount: 2, seating: ['a', 'b'],
            rulesetId: 'colors', rulesVersion: '2026-10-01-colors',
        });
        expect(JSON.stringify(events)).not.toMatch(/Ann|Ben/);
        const round = events[1] as Extract<typeof events[number], { type: 'roundStart' }>;
        expect(round.hands.a).toHaveLength(9);
        expect(round.hands.a[0]).toMatch(/^[a-z]+:\d+:\d+$/);
    });

    it('records a beat with the hand, the beaten play and the pickup', () => {
        let s = threePlayerState({
            a: [die('a1', 5), die('a2', 7)],
            b: [die('b1', 9), die('b2', 9), die('b3', 2)],
            c: [die('c1', 1)],
        });
        s = applyAction(s, { type: 'play', playerId: 'a', dieIds: ['a1'] }, ones);
        const before = s;
        const action = { type: 'play' as const, playerId: 'b', dieIds: ['b1', 'b2'] };
        const after = applyAction(before, action, ones);
        const [event] = buildEvents(before, after, action);
        expect(event).toMatchObject({
            type: 'play', seq: 2, round: 1, trick: 1, player: 'b',
            hand: ['red:12:9', 'red:12:9', 'red:12:2'],
            play: { kind: 'set', count: 2, value: 9, color: 'red' },
            beat: { kind: 'single', count: 1, value: 5, color: 'red' },
            pickedUp: ['red:12:1'],
            wentOut: false,
            handSizes: { a: 1, b: 2, c: 1 },
        });
    });

    it('records whether a pass was forced, and each reroll', () => {
        let s = threePlayerState({
            a: [die('a1', 5), die('a2', 7)],
            b: [die('b1', 9), die('b2', 3)],
            c: [die('c1', 1)],
        });
        s = applyAction(s, { type: 'play', playerId: 'a', dieIds: ['a1'] }, ones);
        const action = { type: 'pass' as const, playerId: 'b', rerollIds: ['b2'] };
        const [event] = buildEvents(s, applyAction(s, action, ones), action);
        expect(event).toMatchObject({
            type: 'pass', player: 'b', allowance: 1,
            beatOptions: 1, // the single 9
            rerolls: [{ from: 'red:12:3', to: 'red:12:1' }],
        });
    });

    it('records a pickup with the die before and after its reroll', () => {
        let s = threePlayerState({
            a: [die('a1', 5), die('a2', 7)],
            b: [die('b1', 3)],
            c: [die('c1', 1)],
        });
        s = applyAction(s, { type: 'play', playerId: 'a', dieIds: ['a1'] }, ones);
        const action = { type: 'pickup' as const, playerId: 'b', dieId: 'a1' };
        const [event] = buildEvents(s, applyAction(s, action, ones), action);
        expect(event).toMatchObject({
            type: 'pickup', player: 'b', beatOptions: 0,
            die: { from: 'red:12:5', to: 'red:12:1' },
            trickEnded: true,
        });
    });

    it('records a replace with the die given, the die taken and the table after', () => {
        let s = threePlayerState({ a: [die('a1', 5), die('a2', 7)], b: [die('b1', 6)], c: [die('c1', 1)] });
        s = { ...s, rulesetId: 'colors-replace' };
        s = applyAction(s, { type: 'play', playerId: 'a', dieIds: ['a1'] }, ones);
        const action = { type: 'replace' as const, playerId: 'b', handDieId: 'b1', tableDieId: 'a1' };
        const [event] = buildEvents(s, applyAction(s, action, ones), action);
        expect(event).toMatchObject({
            type: 'replace', player: 'b', hand: ['red:12:6'],
            table: { kind: 'single', value: 5 }, tableAfter: { kind: 'single', value: 6 },
            given: 'red:12:6', die: { from: 'red:12:5', to: 'red:12:1' },
            beatOptions: 1, trickEnded: false,
        });
    });

    it('adds roundEnd and, after the last round, gameEnd', () => {
        let s = threePlayerState({ a: [die('a1', 5)], b: [die('b1', 9)], c: [die('c1', 1)] });
        s = { ...s, round: 3, totalRounds: 3 };
        s = applyAction(s, { type: 'play', playerId: 'a', dieIds: ['a1'] }, ones); // a out
        s = applyAction(s, { type: 'pass', playerId: 'b', rerollIds: [] }, ones);
        const before = applyAction(s, { type: 'pass', playerId: 'c', rerollIds: [] }, ones); // b leads
        const action = { type: 'play' as const, playerId: 'b', dieIds: ['b1'] };
        const events = buildEvents(before, applyAction(before, action, ones), action);
        expect(events.map(e => e.type)).toEqual(['play', 'roundEnd', 'gameEnd']);
        expect(events[1]).toMatchObject({ finished: ['a', 'b', 'c'], tricks: 2 });
    });

    it('records the next round start and keys events in order', () => {
        let s = threePlayerState({ a: [die('a1', 5)], b: [die('b1', 9)], c: [die('c1', 1)] });
        s = { ...s, phase: 'roundOver', roundResults: [['c', 'a', 'b']] };
        const next = startNextRound(s, ones);
        const [event] = buildEvents(s, next);
        expect(event).toMatchObject({ type: 'roundStart', round: 2, leader: 'c', seq: s.seq + 1 });
        expect(eventKey(event, 0) > eventKey({ ...event, seq: s.seq }, 1)).toBe(true);
    });
});
