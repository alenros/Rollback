import { describe, expect, it } from 'vitest';
import { applyTheme, currentTheme, parseTheme, THEMES } from '../../src/lib/theme';

// A stand-in for <html>: only dataset is touched.
const fakeRoot = (theme?: string) => ({ dataset: theme ? { theme } : {} }) as unknown as HTMLElement;

describe('parseTheme', () => {
    it('accepts every known theme', () => {
        for (const t of THEMES) expect(parseTheme(t)).toBe(t);
    });
    it('rejects unknown, empty and non-string values', () => {
        expect(parseTheme('neon')).toBeNull();
        expect(parseTheme('')).toBeNull();
        expect(parseTheme(null)).toBeNull();
        expect(parseTheme(undefined)).toBeNull();
    });
});

describe('applyTheme / currentTheme', () => {
    it('sets data-theme for a trial theme', () => {
        const root = fakeRoot();
        applyTheme(root, 'harmonies-soft');
        expect(root.dataset.theme).toBe('harmonies-soft');
        expect(currentTheme(root)).toBe('harmonies-soft');
    });
    it('removes data-theme for box-art, the default', () => {
        const root = fakeRoot('harmonies-bold');
        applyTheme(root, 'box-art');
        expect(root.dataset.theme).toBeUndefined();
        expect(currentTheme(root)).toBe('box-art');
    });
    it('reads an unknown attribute as box-art', () => {
        expect(currentTheme(fakeRoot('neon'))).toBe('box-art');
    });
});
