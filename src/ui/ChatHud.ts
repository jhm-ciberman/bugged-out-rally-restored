import { arialFont } from './GuiControls';

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
/** Left and top of the visible window, in pixels from the screen corner (`ChatScrollHud` in ChatHud.gui). */
const WINDOW_X = 8;
const WINDOW_Y = 58;
/** Height of the visible window, the shortest of the three sizes (`$pref::ChatHudLength = 1`). */
const WINDOW_HEIGHT = 72;
/** The text sits one pixel inside the window, on each side. */
const TEXT_INSET = 1;
/** Indent of a message's wrapped lines (`lineContinuedIndex`). */
const CONTINUED_INDENT = 10;

/**
 * The race's message log at the top left (`MainChatHud`): who joined, who wrecked, what the player picked up.
 * New lines go at the bottom, and once the window is full the oldest scroll out of view at the top.
 */
export class ChatHud {
    readonly element = document.createElement('div');
    private readonly _lines = document.createElement('div');

    constructor() {
        Object.assign(this.element.style, {
            position: 'absolute',
            left: `${WINDOW_X}px`,
            top: `${WINDOW_Y}px`,
            height: `${WINDOW_HEIGHT}px`,
            overflow: 'hidden',
        });
        Object.assign(this._lines.style, {
            position: 'absolute',
            left: `${TEXT_INSET}px`,
            right: `${TEXT_INSET}px`,
            top: `${TEXT_INSET}px`,
            font: arialFont(LINE_HEIGHT, true),
            lineHeight: `${LINE_HEIGHT}px`,
        });
        this.element.append(this._lines);
    }

    /**
     * Adds a message at the bottom of the log.
     */
    addLine(text: string, color: ChatColor = ChatColor.plain): void {
        const line = document.createElement('div');
        line.textContent = text;
        Object.assign(line.style, {
            color: COLORS[color],
            paddingLeft: `${CONTINUED_INDENT}px`,
            textIndent: `-${CONTINUED_INDENT}px`,
        });
        this._lines.append(line);
        while (this._lines.childElementCount > MAX_LINES) this._lines.firstElementChild?.remove();
        this._scrollToBottom();
    }

    /**
     * Sizes the log for a screen `width` pixels wide.
     */
    resize(width: number): void {
        // The log's dialog is laid out for a 640 pixel screen and stretched to the real one: its box keeps a
        // fixed margin on the right of a parent that takes 400/640 of the width.
        this.element.style.width = `${Math.max(0, (width * 400) / 640 - 144)}px`;
        this._scrollToBottom();
    }

    private _scrollToBottom(): void {
        const overflow = this._lines.offsetHeight + TEXT_INSET - WINDOW_HEIGHT;
        this._lines.style.top = `${overflow > 0 ? TEXT_INSET - overflow : TEXT_INSET}px`;
    }
}
