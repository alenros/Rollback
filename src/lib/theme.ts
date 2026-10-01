// Trial themes: chosen by data-theme on <html> and remembered per browser. Box-art is the default (no attribute).
export const THEMES = ['box-art', 'harmonies-bold', 'cuphead-casino', 'cuphead-inkwell', 'cuphead-cardtable'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_KEY = 'rollback-theme';

export const THEME_LABELS: Record<Theme, { short: string; title: string }> = {
    'box-art': { short: 'Box-art', title: 'Box-art (current look)' },
    'harmonies-bold': { short: 'Harmonies', title: 'Harmonies: recolored box-art' },
    'cuphead-casino': { short: 'Casino', title: "Cuphead A: devil's casino (dark)" },
    'cuphead-inkwell': { short: 'Inkwell', title: 'Cuphead B: inkwell film (sepia)' },
    'cuphead-cardtable': { short: 'Cards', title: 'Cuphead C: card-table hybrid' },
};

export function parseTheme(value: unknown): Theme | null {
    return typeof value === 'string' && (THEMES as readonly string[]).includes(value) ? (value as Theme) : null;
}

export function currentTheme(root: HTMLElement): Theme {
    return parseTheme(root.dataset.theme) ?? 'box-art';
}

export function applyTheme(root: HTMLElement, theme: Theme): void {
    if (theme === 'box-art') delete root.dataset.theme;
    else root.dataset.theme = theme;
}

export function saveTheme(theme: Theme): void {
    try {
        localStorage.setItem(THEME_KEY, theme);
    } catch {
        // Storage blocked (private mode, disabled site data): the switch still applies to this page.
    }
}
