/**
 * PDF bank-statement text extraction.
 *
 * Banks hand out statements as PDFs, so the scrub has to read them
 * directly rather than making the broker find a CSV export. This module
 * turns a PDF into the same plain text lines the paste parser already
 * understands.
 *
 * Still no AI and still no upload: pdf.js runs in the browser, the bytes
 * never leave the machine, and the text goes straight into the local
 * parser.
 *
 * A PDF has no concept of a "line" — it is a bag of positioned text
 * fragments. Reconstructing rows means grouping fragments by their Y
 * coordinate, sorting each group left to right, and re-inserting the
 * whitespace the layout implies. That grouping is the interesting part and
 * lives in groupTextItemsIntoLines(), which is pure so it can be tested
 * without loading pdf.js.
 */

/** The subset of a pdf.js text item this module needs. */
export interface PdfTextItem {
  str: string;
  /** Horizontal position (PDF user units, origin bottom-left). */
  x: number;
  /** Vertical position. Higher = further up the page. */
  y: number;
  /** Advance width of the fragment. */
  width: number;
  /** Font size, used to size the "is this a column gap?" threshold. */
  height: number;
}

export interface PdfExtractResult {
  /** Reconstructed text, one visual row per line. */
  text: string;
  lines: string[];
  pageCount: number;
  /** False when the PDF carries no text layer (i.e. it is a scan). */
  hasTextLayer: boolean;
}

/**
 * Group positioned fragments into visual rows.
 *
 * Fragments within `yTolerance` of each other are one row. Within a row,
 * a horizontal gap wider than roughly one space becomes a single space and
 * a wide gap (a column boundary) becomes three, which keeps the date /
 * description / amount columns distinguishable to the line parser.
 */
export function groupTextItemsIntoLines(items: PdfTextItem[], yTolerance = 2.5): string[] {
  const usable = items.filter((it) => it.str && it.str.trim().length > 0);
  if (!usable.length) return [];

  // Top of the page first, so rows come out in reading order.
  const sorted = [...usable].sort((a, b) => b.y - a.y);

  const rows: PdfTextItem[][] = [];
  let current: PdfTextItem[] = [];
  let rowY = sorted[0].y;

  for (const item of sorted) {
    if (Math.abs(item.y - rowY) <= yTolerance) {
      current.push(item);
    } else {
      if (current.length) rows.push(current);
      current = [item];
      rowY = item.y;
    }
  }
  if (current.length) rows.push(current);

  const lines: string[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd: number | null = null;
    let prevSize = 10;

    for (const item of row) {
      const size = item.height > 0 ? item.height : prevSize;
      if (prevEnd !== null) {
        const gap = item.x - prevEnd;
        // Thresholds scale with the font so small print doesn't read as
        // one run-on word and large print doesn't explode into columns.
        const spaceWidth = Math.max(1.5, size * 0.25);
        if (gap > spaceWidth * 3) text += '   ';
        else if (gap > spaceWidth * 0.4) text += ' ';
        // Anything tighter is the same word split across fragments.
      }
      text += item.str;
      prevEnd = item.x + item.width;
      prevSize = size;
    }

    const trimmed = text.replace(/\s+$/, '');
    if (trimmed.trim()) lines.push(trimmed);
  }
  return lines;
}

/**
 * Read a PDF and return its text, row by row.
 *
 * pdf.js is imported lazily so the ~1MB library only loads when someone
 * actually drops a PDF in, and the worker URL is resolved through the
 * bundler (`new URL(..., import.meta.url)`), which is the pattern webpack
 * understands.
 */
export async function extractPdfText(data: ArrayBuffer): Promise<PdfExtractResult> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = new Uint8Array(data);

  const open = () =>
    pdfjs.getDocument({
      // getDocument takes ownership of the buffer, so each attempt gets a
      // fresh copy — otherwise a retry sees a detached array.
      data: bytes.slice(),
      // Statements are plain text; skipping these keeps the payload small
      // and avoids network fetches for font/cmap assets.
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;

  /*
   * Worker setup — deliberately NOT the `new URL(..., import.meta.url)`
   * form the pdf.js docs suggest.
   *
   * That form makes webpack copy the worker out as a raw asset
   * (static/media/pdf.worker.min.*.mjs). Next then runs Terser over that
   * file as a classic script, and it dies on the worker's own import /
   * export statements:
   *
   *     'import', and 'export' cannot be used outside of module code
   *
   * Importing the worker as a normal module instead means webpack
   * processes it like any other code — it lands in a lazy chunk that is
   * minified correctly, and no loose .mjs asset is ever emitted. pdf.js
   * checks globalThis.pdfjsWorker before it tries to spawn a worker, so
   * this is a supported path, not a hack.
   *
   * The cost is that parsing runs on the main thread. For a handful of
   * statements that is well under a second, and it is worth it for a
   * build that works on any host without bundler configuration.
   */
  if (!(globalThis as any).pdfjsWorker) {
    const workerModule: any = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    (globalThis as any).pdfjsWorker = workerModule;
  }
  pdfjs.GlobalWorkerOptions.workerSrc = '';

  const doc = await open();

  const lines: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = (content.items || [])
      .filter((it: any) => typeof it.str === 'string')
      .map((it: any) => ({
        str: it.str,
        x: it.transform?.[4] ?? 0,
        y: it.transform?.[5] ?? 0,
        width: it.width ?? 0,
        height: it.height ?? Math.abs(it.transform?.[3] ?? 10),
      }));
    lines.push(...groupTextItemsIntoLines(items));
    page.cleanup();
  }

  // A scanned statement parses fine and yields almost nothing — that is a
  // different problem from a broken file and needs a different message.
  const meaningful = lines.filter((l) => l.trim().length > 3).length;

  return {
    text: lines.join('\n'),
    lines,
    pageCount: doc.numPages,
    hasTextLayer: meaningful >= 5,
  };
}
