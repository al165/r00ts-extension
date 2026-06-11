import type { Colour, GlyphDrawFn, GlyphParams } from './types.ts';


export const glyphState: GlyphParams[] = [
    {
        glyphName: "line_h",
        label: "water",
        rgb: [255, 255, 255],
        bg: "#99c1f1",
        fg: "#FFF",
    },
    {
        glyphName: "cross",
        label: "grass",
        rgb: [255, 0, 255],
        bg: "#FFF",
        fg: "#ff70b3",
    },
    {
        glyphName: "blank",
        label: "land",
        rgb: [0, 0, 255],
        bg: "#FFF",
        fg: "#ff70b3",
    },

    {
        glyphName: "wedge",
        label: "wood",
        rgb: [0, 255, 255],
        bg: "#FFF",
        fg: "#ff70b3",
    },
    {
        glyphName: "blank",
        label: "residential",
        rgb: [0, 255, 0],
        bg: "#FFF",
        fg: "#ff70b3",
    }
];

export function colourToString(c: Colour | string): string {
    if (typeof c === "string")
        return c
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

const DEFAULT_FG = 'black';

export const GLYPH_FUNCTIONS: { name: string, fn: GlyphDrawFn }[] = [
    {
        name: "blank",
        fn: (_ctx, _s, _fg) => { }
    },

    {
        name: "line_h",
        fn: (ctx, s, fg) => {
            ctx.strokeStyle = colourToString(fg);

            ctx.beginPath();
            ctx.moveTo(0, s);
            ctx.lineTo(s, s);
            ctx.stroke();
        }
    },
    {
        name: "line_v",
        fn: (ctx, s, fg) => {
            ctx.strokeStyle = colourToString(fg);

            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, s);
            ctx.stroke();
        }
    },

    {
        name: "circle_small",
        fn: (ctx, s, fg) => {
            ctx.fillStyle = colourToString(fg);

            ctx.beginPath();
            ctx.arc(s / 2, s / 2, s / 3, 0, Math.PI * 2);
            ctx.fill();
        }
    },

    {
        name: "circle",
        fn: (ctx, s, fg) => {
            ctx.fillStyle = colourToString(fg);

            ctx.beginPath();
            ctx.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2);
            ctx.fill();
        }
    },

    {
        name: "wedge",
        fn: (ctx, s, fg) => {
            ctx.fillStyle = colourToString(fg);

            ctx.moveTo(0, 0);
            ctx.lineTo(s, 0);
            ctx.lineTo(0, s);
            ctx.closePath();
            ctx.fill();
        }
    },

    {
        name: "triangle",
        fn: (ctx, s, fg) => {
            ctx.fillStyle = colourToString(fg);

            ctx.moveTo(s / 2, 0);
            ctx.lineTo(s, s);
            ctx.lineTo(0, s);
            ctx.closePath();
            ctx.fill();
        }
    },
    {
        name: "triangle_d",
        fn: (ctx, s, fg) => {
            ctx.fillStyle = colourToString(fg);

            ctx.moveTo(s / 2, s);
            ctx.lineTo(s, 0);
            ctx.lineTo(0, 0);
            ctx.closePath();
            ctx.fill();
        }
    },

    {
        name: "cross",
        fn: (ctx, s, fg) => {
            ctx.strokeStyle = colourToString(fg);

            const o = s * 0.1;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(o, o);
            ctx.lineTo(s - 0, s - 0);
            ctx.moveTo(o, s - o);
            ctx.lineTo(s - o, o);
            ctx.stroke();
        }
    },

    {
        name: "slash",
        fn: (ctx, s, fg) => {
            ctx.strokeStyle = colourToString(fg);

            const o = s * 0.1;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(o, o);
            ctx.lineTo(s - o, s - o);
            ctx.stroke();
        }
    }
];

function colourDistSquared(a: Colour, b: Colour) {
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function createGlyph(size: number, drawFn: GlyphDrawFn, fg?: Colour | string, bg?: Colour | string) {
    const canvas = new OffscreenCanvas(size, size);
    if (typeof canvas === "undefined") {
        console.log("Offscreen canvas is not avaliable");
        return null;
    }

    const ctx = canvas.getContext("2d");
    if (ctx == null) {
        console.log("2d context not created")
        return null;
    }

    if (fg == null)
        fg = DEFAULT_FG;

    if (bg != null) {
        if (typeof bg == "string") ctx.fillStyle = bg;
        else ctx.fillStyle = colourToString(bg);

        ctx.fillRect(0, 0, size, size);
    }
    drawFn(ctx, size, fg);

    return canvas;
}

export class RasteriserPalette {
    private glyphFunctions: { [key: string]: GlyphDrawFn } = {};
    public palette: GlyphParams[] = glyphState;

    private glyphPaletteCanvas: HTMLCanvasElement | OffscreenCanvas;
    private glyphPaletteCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

    private glyphSize: number = 10;

    private glyphCache: Map<number, OffscreenCanvas> = new Map();

    constructor(glyphPaletteCanvas?: HTMLCanvasElement | OffscreenCanvas, glyphSize = 10) {
        if (glyphPaletteCanvas === undefined)
            this.glyphPaletteCanvas = new OffscreenCanvas(this.glyphSize, this.glyphSize);
        else
            this.glyphPaletteCanvas = glyphPaletteCanvas;

        if (this.glyphPaletteCanvas instanceof OffscreenCanvas)
            this.glyphPaletteCtx = this.glyphPaletteCanvas.getContext('2d');
        else
            this.glyphPaletteCtx = this.glyphPaletteCanvas.getContext('2d');

        this.glyphSize = glyphSize;

        // Some default glyphs
        for (const glyphFn of GLYPH_FUNCTIONS)
            this.addGlyph(glyphFn.name, glyphFn.fn)

        this.setGlyphSize(this.glyphSize);
        this.renderGlyphPalette();
    }

    addGlyph(glyphName: string, drawFn: GlyphDrawFn) {
        this.glyphFunctions[glyphName] = drawFn;
    }

    glyphForColour(colour: Colour): OffscreenCanvas | null {
        if (this.palette.length == 0)
            return null;

        const colourKey = (colour[0] & 0xF0) << 4 | (colour[1] & 0xF0) | (colour[2] >> 4);
        if (this.glyphCache.has(colourKey))
            return this.glyphCache.get(colourKey) as OffscreenCanvas;

        //console.log(`Cache miss: ${colourKey} (size: ${this.glyphCache.size})`);

        let best = this.palette[0];
        let bestDist = Infinity;

        for (const entry of this.palette) {
            const dist = colourDistSquared(entry.rgb, colour);
            if (dist < bestDist) {
                bestDist = dist;
                best = entry;
            }
        }

        if (best.canvas) {
            this.glyphCache.set(colourKey, best.canvas);
            return best.canvas;
        }

        return null;
    }

    setGlyphSize(newSize: number) {
        this.glyphSize = newSize;

        // Re-render the glyph palette
        for (const entry of this.palette) {
            const { glyphName, fg, bg } = entry;
            entry.canvas = createGlyph(this.glyphSize, this.glyphFunctions[glyphName], fg, bg);
        }

        this.renderGlyphPalette();
    }

    renderGlyphPalette() {
        this.glyphPaletteCanvas.width = 2 * this.glyphSize;
        this.glyphPaletteCanvas.height = this.palette.length * this.glyphSize;

        if (this.glyphPaletteCtx == null)
            return;

        for (let i = 0; i < this.palette.length; i++) {
            const { rgb, canvas } = this.palette[i];
            this.glyphPaletteCtx.fillStyle = colourToString(rgb);
            this.glyphPaletteCtx.fillRect(
                0, i * this.glyphSize, this.glyphSize, this.glyphSize
            );

            if (canvas != null) {
                this.glyphPaletteCtx.drawImage(canvas, this.glyphSize, i * this.glyphSize);
            }
        }
    }
};

export class MapRaseriser {
    private glyphOverlayCanvas: HTMLCanvasElement;
    private mapCanvas: HTMLCanvasElement;
    private glyphOverlayCtx: CanvasRenderingContext2D | null;

    private offscreenCanvas: HTMLCanvasElement | OffscreenCanvas;
    private offscreenCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

    private glyphSize: number;

    private rows: number = 1;
    private cols: number = 1;

    public rasterPalette: RasteriserPalette;

    constructor(
        glyphOverlayCanvas: HTMLCanvasElement,
        mapCanvas: HTMLCanvasElement,
        offscreenCanvas?: HTMLCanvasElement | OffscreenCanvas,
        glyphPaletteCanvas?: HTMLCanvasElement | OffscreenCanvas,
        glyphSize: number = 10
    ) {
        this.mapCanvas = mapCanvas;
        this.glyphSize = glyphSize;
        this.glyphOverlayCanvas = glyphOverlayCanvas;

        if (offscreenCanvas === undefined)
            this.offscreenCanvas = new OffscreenCanvas(1, 1);
        else
            this.offscreenCanvas = offscreenCanvas;

        this.glyphOverlayCtx = this.glyphOverlayCanvas.getContext('2d');
        if (this.glyphOverlayCtx)
            this.glyphOverlayCtx.imageSmoothingEnabled = false;

        if (this.offscreenCanvas instanceof OffscreenCanvas)
            this.offscreenCtx = this.offscreenCanvas.getContext('2d', { alpha: false });
        else
            this.offscreenCtx = this.offscreenCanvas.getContext('2d', { alpha: false });

        if (this.offscreenCtx)
            this.offscreenCtx.imageSmoothingEnabled = false;

        this.rasterPalette = new RasteriserPalette(glyphPaletteCanvas, this.glyphSize);

        this.resize();
    }

    resize(width?: number, height?: number) {
        // TODO: keep canvas size same but change glyphOverlayCtx.scale to dpr?
        const dpr = window.devicePixelRatio || 1;
        if (width != undefined)
            this.glyphOverlayCanvas.width = width / dpr;

        if (height != undefined)
            this.glyphOverlayCanvas.height = height / dpr;

        this.cols = Math.floor(this.glyphOverlayCanvas.width / this.glyphSize);
        this.rows = Math.floor(this.glyphOverlayCanvas.height / this.glyphSize);

        this.offscreenCanvas.width = this.cols;
        this.offscreenCanvas.height = this.rows;

        this.renderGlyphs();
    }

    renderGlyphs() {
        if (this.offscreenCtx == null || this.glyphOverlayCtx == null) return;

        // Downsample map canvas
        this.offscreenCtx.drawImage(this.mapCanvas, 0, 0, this.cols, this.rows);
        const { data } = this.offscreenCtx.getImageData(0, 0, this.cols, this.rows);
        const pixels = new Uint32Array(data.buffer);
        for (let i = 0, len = pixels.length; i < len; i++) {
            const px = pixels[i]; // one read instead of three
            const r = px & 0xFF;
            const g = (px >> 8) & 0xFF;
            const b = (px >> 16) & 0xFF;
            const col = i / this.cols;
            const row = i % this.cols;

            const glyph = this.rasterPalette.glyphForColour([r, g, b]);

            if (glyph) this.glyphOverlayCtx.drawImage(glyph, row * this.glyphSize, col * this.glyphSize);
        }
    }

    setGlyphSize(newSize: number) {
        if (newSize == this.glyphSize)
            return;

        this.glyphSize = newSize;
        this.rasterPalette.setGlyphSize(newSize);

        this.resize();
    }

    refresh() {
        this.rasterPalette.setGlyphSize(this.glyphSize);
        this.rasterPalette.renderGlyphPalette();
        this.renderGlyphs();
    }

}
