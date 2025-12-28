
// MediaUtils.ts
export const compressImage = async (
    blob: Blob,
    maxSizeMB: number = 0.95,
    opts?: {
        maxDimension?: number;            // default 2000
        preserveTransparency?: boolean;   // default true
        jpegQualityStart?: number;        // default 0.82
        jpegQualityMin?: number;          // default 0.5
        downscaleStep?: number;           // default 0.9
        alphaSampleStride?: number;       // default 16 (performance)
    }
): Promise<Blob> => {
    const {
        maxDimension = 2000,
        preserveTransparency = true,
        jpegQualityStart = 0.82,
        jpegQualityMin = 0.5,
        downscaleStep = 0.9,
        alphaSampleStride = 16,
    } = opts ?? {};

    const maxBytes = maxSizeMB * 1024 * 1024;

    // Helper: canvas.toBlob -> Promise
    const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
        new Promise<Blob | null>((resolve) => {
            canvas.toBlob((b) => resolve(b), type, quality);
        });

    // Helper: load image
    const loadImage = (b: Blob) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(b);
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = (e) => {
                URL.revokeObjectURL(url);
                reject(e);
            };
            img.src = url;
        });

    // Helper: detect alpha by sampling pixels
    const hasAlpha = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
        try {
            const { data } = ctx.getImageData(0, 0, w, h);
            // Check alpha channel every N pixels for speed
            const stride = Math.max(1, alphaSampleStride);
            for (let i = 3; i < data.length; i += 4 * stride) {
                if (data[i] < 255) return true;
            }
        } catch {
            // If getImageData fails for any reason, assume no alpha
        }
        return false;
    };

    // If it's already small AND (either we don't care about transparency
    // OR it's already in a format that preserves alpha), we can return early.
    // NOTE: we still might want to convert HEIC/HEIF etc; this function does so by re-encoding.
    // We'll keep it simple: if it's small, we still inspect transparency needs.
    const img = await loadImage(blob);

    // Resize to maxDimension first
    let width = img.width;
    let height = img.height;

    if (width > maxDimension || height > maxDimension) {
        if (width > height) {
            height = Math.round(height * (maxDimension / width));
            width = maxDimension;
        } else {
            width = Math.round(width * (maxDimension / height));
            height = maxDimension;
        }
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;

    // Draw once without background so we can check alpha
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const alphaPresent = preserveTransparency ? hasAlpha(ctx, width, height) : false;

    // Decide output format:
    // - If alpha present AND we want to preserve it => PNG
    // - Else => JPEG
    const outType = alphaPresent ? "image/png" : "image/jpeg";

    // If we're outputting JPEG, paint a background (prevents dark/black in some pipelines)
    if (outType === "image/jpeg") {
        ctx.save();
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    }

    // 1) JPEG path: adjust quality down until size <= max
    if (outType === "image/jpeg") {
        // If original is already small-ish and JPEG conversion likely makes it smaller,
        // we can still run one pass and return.
        let quality = jpegQualityStart;

        while (true) {
            const out = await canvasToBlob(canvas, outType, quality);
            if (!out) return blob;

            if (out.size <= maxBytes || quality <= jpegQualityMin) return out;

            quality = Math.max(jpegQualityMin, quality - 0.1);
        }
    }

    // 2) PNG path (alpha): PNG ignores quality; shrink dimensions until size <= max
    // Start with current canvas; if too big, iteratively downscale.
    let out = await canvasToBlob(canvas, outType);
    if (!out) return blob;

    if (out.size <= maxBytes) return out;

    // Downscale loop for PNG
    let curCanvas = canvas;
    let curW = width;
    let curH = height;

    // Prevent infinite loops / tiny thumbnails
    const MIN_DIM = 320;

    while (out.size > maxBytes && curW > MIN_DIM && curH > MIN_DIM) {
        curW = Math.round(curW * downscaleStep);
        curH = Math.round(curH * downscaleStep);

        const nextCanvas = document.createElement("canvas");
        nextCanvas.width = curW;
        nextCanvas.height = curH;

        const nextCtx = nextCanvas.getContext("2d");
        if (!nextCtx) return out;

        nextCtx.clearRect(0, 0, curW, curH);
        nextCtx.drawImage(curCanvas, 0, 0, curW, curH);

        curCanvas = nextCanvas;
        out = (await canvasToBlob(curCanvas, outType)) ?? out;
    }

    return out;
};

function base64ToBlob(base64: string, mime = "application/octet-stream"): Blob {
    // base64 might be raw ("iVBORw0...") OR a data URL ("data:image/png;base64,iVBORw0...")
    const pure = base64.includes("base64,") ? base64.split("base64,")[1] : base64;

    const byteStr = atob(pure);
    const len = byteStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = byteStr.charCodeAt(i);

    return new Blob([bytes], { type: mime });
}

export function coerceToBlob(img: any): Blob | null {
    if (!img) return null;

    // Already a Blob/File
    if (img instanceof Blob) return img;

    // Ant Design / rc-upload commonly stores the File here:
    if (img.originFileObj instanceof Blob) return img.originFileObj;
    if (img.file instanceof Blob) return img.file;

    // Some libs provide `raw` or `blob`
    if (img.raw instanceof Blob) return img.raw;
    if (img.blob instanceof Blob) return img.blob;

    // Your case: has `contents` base64 string
    if (typeof img.contents === "string" && img.contents.length > 0) {
        return base64ToBlob(img.contents, img.type || "application/octet-stream");
    }

    // Sometimes a thumbUrl is a data URL
    if (typeof img.thumbUrl === "string" && img.thumbUrl.startsWith("data:")) {
        // Pull mime out of data url
        const mimeMatch = img.thumbUrl.match(/^data:(.*?);base64,/);
        const mime = mimeMatch?.[1] || img.type || "application/octet-stream";
        return base64ToBlob(img.thumbUrl, mime);
    }

    return null;
}
