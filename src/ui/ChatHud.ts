import { arialFont, guiPx } from './GuiControls';

/**
 * Text colors of the message log, by the `\c` index a message starts with (`ChatHudMessageProfile`).
 */
export const ChatColor = {
    /** Kills and pickups. */
    plain: 0,
    /** Other racers joining. */
    join: 1,
    /** The welcome and health messages. */
    notice: 2,
} as const;

/**
 * One of the message log's text colors.
 */
export type ChatColor = (typeof ChatColor)[keyof typeof ChatColor];

const COLORS: Record<ChatColor, string> = {
    0: 'rgb(44, 172, 181)',
    1: 'rgb(4, 235, 105)',
    2: 'rgb(219, 200, 128)',
};

/** Most lines kept (`$pref::HudMessageLogSize`). */
const MAX_LINES = 40;
/** Height of one line, the font size (`ChatHud::addLine`). */
const LINE_HEIGHT = 16;
/** Top of the log's parent control, in pixels from the top of the screen (ChatHud.gui). */
const PARENT_Y = 50;
/** Left and top of the visible window, in pixels from the screen corner (`ChatScrollHud`). */
const WINDOW_X = 8;
const WINDOW_Y = PARENT_Y + 8;
/** Height of the visible window, the shortest of the three sizes (`$pref::ChatHudLength = 1`). */
const WINDOW_HEIGHT = 72;
/** The text sits one pixel inside the window, on each side. */
const TEXT_INSET = 1;
/** Indent of a message's wrapped lines (`lineContinuedIndex`). */
const CONTINUED_INDENT = 10;
/** Lines one page up or down moves: a window's worth, less one (`ChatHud::pageUp`). */
const PAGE_LINES = Math.floor(WINDOW_HEIGHT / LINE_HEIGHT) - 1;
/**
 * The "Dwn" sign shown while scrolled back (`chatPageDown`): its size, its distance from the right edge of the
 * log's parent and its top inside it.
 */
const DOWN_SIGN = { w: 36, h: 14, right: 180, top: 58 };

/**
 * The race's message log at the top left (`MainChatHud`): who joined, who wrecked, what the player picked up.
 * New lines go at the bottom, and once the window is full the oldest scroll out of view at the top. Page up and
 * page down scroll back through older lines.
 */
export class ChatHud {
    readonly element = document.createElement('div');
    private readonly _window = document.createElement('div');
    private readonly _lines = document.createElement('div');
    private readonly _down = document.createElement('div');
    /** Lines scrolled back from the newest, 0 when the newest line is at the bottom. */
    private _linesBack = 0;
    /** Width of the screen, which places the "Dwn" sign. */
    private _screenWidth = 0;
    /** How much bigger than the design the log draws. */
    private _scale = 1;

    constructor() {
        Object.assign(this.element.style, { position: 'absolute', left: '0', top: '0' });
        Object.assign(this._window.style, {
            position: 'absolute',
            left: guiPx(WINDOW_X),
            top: guiPx(WINDOW_Y),
            height: guiPx(WINDOW_HEIGHT),
            overflow: 'hidden',
        });
        Object.assign(this._lines.style, {
            position: 'absolute',
            left: guiPx(TEXT_INSET),
            right: guiPx(TEXT_INSET),
            top: guiPx(TEXT_INSET),
            font: arialFont(LINE_HEIGHT, true),
            lineHeight: guiPx(LINE_HEIGHT),
        });
        // A `GuiButtonProfile` button: gold, black border, white centered Arial 14.
        this._down.textContent = 'Dwn';
        Object.assign(this._down.style, {
            position: 'absolute',
            top: guiPx(PARENT_Y + DOWN_SIGN.top),
            width: guiPx(DOWN_SIGN.w),
            height: guiPx(DOWN_SIGN.h),
            boxSizing: 'border-box',
            border: `${guiPx(1)} solid #000`,
            background: 'rgb(255, 192, 55)',
            color: '#fff',
            font: arialFont(14),
            lineHeight: guiPx(DOWN_SIGN.h - 2),
            textAlign: 'center',
            display: 'none',
        });
        this._window.append(this._lines);
        this.element.append(this._window, this._down);
    }

    /**
     * Adds a message at the bottom of the log. While scrolled back, the view stays where it is.
     */
    addLine(text: string, color: ChatColor = ChatColor.plain): void {
        const before = this._lines.offsetHeight;
        const line = document.createElement('div');
        line.textContent = text;
        Object.assign(line.style, {
            color: COLORS[color],
            paddingLeft: guiPx(CONTINUED_INDENT),
            textIndent: guiPx(-CONTINUED_INDENT),
        });
        this._lines.append(line);
        if (this._linesBack > 0) {
            this._linesBack += Math.round((this._lines.offsetHeight - before) / this._lineHeight);
        } else {
            // The oldest messages are only dropped while the newest are in view.
            while (this._lines.childElementCount > MAX_LINES) this._lines.firstElementChild?.remove();
        }
        this._layout();
    }

    /**
     * Scrolls back a page of older lines.
     */
    pageUp(): void {
        const hidden = this._lines.offsetHeight - WINDOW_HEIGHT * this._scale - this._linesBack * this._lineHeight;
        const lines = Math.floor(hidden / this._lineHeight + 0.5);
        if (lines <= 0) return;
        this._linesBack += Math.min(lines, PAGE_LINES);
        this._layout();
    }

    /**
     * Scrolls forward a page, toward the newest line.
     */
    pageDown(): void {
        this._linesBack -= Math.min(this._linesBack, PAGE_LINES);
        this._layout();
    }

    /**
     * Sizes the log for a screen `width` pixels wide, drawn `scale` times its design size.
     */
    resize(width: number, scale: number): void {
        this._screenWidth = width;
        this._scale = scale;
        this._layout();
    }

    private get _lineHeight(): number {
        return LINE_HEIGHT * this._scale;
    }

    private _layout(): void {
        // The log's dialog is laid out for a 640 pixel screen and stretched to the real one: its box keeps a
        // fixed margin on the right of a parent that takes 400/640 of the width.
        const parentWidth = (this._screenWidth * 400) / 640;
        this._window.style.width = `${Math.max(0, parentWidth - 144 * this._scale)}px`;
        this._down.style.left = `${parentWidth - DOWN_SIGN.right * this._scale}px`;
        const inset = TEXT_INSET * this._scale;
        const overflow = this._lines.offsetHeight + inset - WINDOW_HEIGHT * this._scale;
        const top = overflow > 0 ? inset - overflow : inset;
        this._lines.style.top = `${top + this._linesBack * this._lineHeight}px`;
        this._down.style.display = this._linesBack > 0 ? '' : 'none';
    }
}
