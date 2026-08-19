interface PdfJsLib {
  getDocument: (params: { data: ArrayBuffer }) => { promise: Promise<PdfDocument> };
  GlobalWorkerOptions: { workerSrc: string };
}

interface PdfDocument {
  numPages: number;
  getPage: (pageNum: number) => Promise<PdfPage>;
}

interface PdfPage {
  getTextContent: () => Promise<PdfTextContent>;
}

interface PdfTextContent {
  items: PdfTextItem[];
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width?: number;
}

async function loadPdfJs(): Promise<PdfJsLib> {
  if ((window as unknown as { pdfjsLib?: PdfJsLib }).pdfjsLib) {
    return (window as unknown as { pdfjsLib: PdfJsLib }).pdfjsLib!;
  }
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load PDF.js'));
    document.head.appendChild(script);
  });
  const lib = (window as unknown as { pdfjsLib: PdfJsLib }).pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return lib;
}

function splitIntoCells(items: { text: string; x: number; width: number }[], gapThreshold: number) {
  const cells: string[] = [];
  let cur: { text: string; endX: number } | null = null;
  for (const it of items) {
    const width = it.width || (it.text.length * 6);
    const endX = it.x + width;
    if (!cur) {
      cur = { text: it.text, endX };
    } else if (it.x - cur.endX > gapThreshold) {
      cells.push(cur.text.trim());
      cur = { text: it.text, endX };
    } else {
      cur.text += ' ' + it.text;
      cur.endX = endX;
    }
  }
  if (cur && cur.text.trim()) cells.push(cur.text.trim());
  return cells.filter(c => c);
}

function detectColumnBoundaries(allRows: { x: number; text: string; width: number }[][]): number[] {
  // Collect all x positions across all rows
  const xPositions: number[] = [];
  for (const row of allRows) {
    for (const item of row) {
      xPositions.push(item.x);
      xPositions.push(item.x + (item.width || item.text.length * 6));
    }
  }
  
  // Cluster x positions to find column boundaries
  xPositions.sort((a, b) => a - b);
  const boundaries: number[] = [];
  const clusterThreshold = 15; // pixels
  
  for (const x of xPositions) {
    if (boundaries.length === 0 || x - (boundaries[boundaries.length - 1] ?? -Infinity) > clusterThreshold) {
      boundaries.push(x);
    }
  }
  
  return boundaries;
}

function splitIntoCellsWithBoundaries(items: { text: string; x: number; width: number }[], boundaries: number[]): string[] {
  const cells: string[] = Array(boundaries.length).fill('');
  
  for (const it of items) {
    const centerX = it.x + (it.width || it.text.length * 6) / 2;
    // Find which column this item belongs to
    let colIdx = boundaries.findIndex((b, i) => {
      const next = boundaries[i + 1] ?? Infinity;
      return centerX >= b && centerX < next;
    });
    if (colIdx === -1) colIdx = boundaries.length - 1;
    if (colIdx >= 0 && colIdx < cells.length) {
      cells[colIdx] = (cells[colIdx] + ' ' + it.text).trim();
    }
  }
  
  return cells.filter(c => c);
}

function isLikelyHeaderRow(cells: string[]): boolean {
  const headerKeywords = ['symbol', 'qty', 'quantity', 'price', 'buy', 'avg', 'cost', 'isin', 'company', 'name', 'security', 'instrument', 'shares', 'units', 'rate', 'value', 'amount'];
  const joined = cells.join(' ').toLowerCase();
  return headerKeywords.some(k => joined.includes(k));
}

export interface PdfGridResult {
  rows: string[][];
  metadata: {
    pageCount: number;
    hasMultiPageHeaders: boolean;
    columnBoundaries: number[];
  };
}

export async function pdfToGrid(file: File, gapThreshold = 12): Promise<PdfGridResult> {
  const lib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: buf }).promise;
  const allPagesRows: { x: number; text: string; width: number }[][] = [];
  const pageRowMaps: Record<number, Record<string, { x: number; text: string; width: number }[]>> = {};

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    // Group items by y (merge within 2px)
    const rowMap: Record<string, { x: number; text: string; width: number }[]> = {};
    for (const item of content.items as PdfTextItem[]) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] ?? 0);
      
      let key = Object.keys(rowMap).find(k => Math.abs(Number(k) - y) <= 2);
      if (key === undefined) key = String(y);
      if (!rowMap[key]) rowMap[key] = [];
      rowMap[key]!.push({ x: item.transform[4] ?? 0, text: item.str, width: item.width ?? 0 });
    }
    
    pageRowMaps[p] = rowMap;
    
    // Collect all rows for boundary detection
    for (const y of Object.keys(rowMap)) {
      const items = rowMap[y];
      if (items && items.length > 0) {
        allPagesRows.push(items.sort((a, b) => a.x - b.x));
      }
    }
  }

  // Detect column boundaries from all pages
  const boundaries = detectColumnBoundaries(allPagesRows);
  
  // Now build grid using detected boundaries
  const grid: string[][] = [];
  let hasRepeatedHeader = false;
  let headerRowPattern: string[] | null = null;

  for (let p = 1; p <= pdf.numPages; p++) {
    const rowMap = pageRowMaps[p];
    if (!rowMap) continue;
    const ys = Object.keys(rowMap).map(Number).sort((a, b) => b - a); // top → bottom
    
    for (const y of ys) {
      const items = rowMap[y];
      if (!items || items.length === 0) continue;
      const sortedItems = items.sort((a, b) => a.x - b.x);
      
      // Use boundary-based splitting if we have good boundaries, otherwise fallback to gap-based
      let cells: string[];
      if (boundaries.length >= 2) {
        cells = splitIntoCellsWithBoundaries(sortedItems, boundaries);
      } else {
        cells = splitIntoCells(sortedItems, gapThreshold);
      }
      
      if (cells.length === 0) continue;
      
      // Detect repeated headers across pages
      if (isLikelyHeaderRow(cells)) {
        if (headerRowPattern && arraysEqual(headerRowPattern, cells)) {
          hasRepeatedHeader = true;
          continue; // Skip repeated header
        }
        headerRowPattern = cells;
      }
      
      grid.push(cells);
    }
  }

  return {
    rows: grid,
    metadata: {
      pageCount: pdf.numPages,
      hasMultiPageHeaders: hasRepeatedHeader,
      columnBoundaries: boundaries,
    }
  };
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, i) => (val ?? '').toLowerCase().trim() === (b[i] ?? '').toLowerCase().trim());
}

// Backward compatibility export
export async function pdfToGridLegacy(file: File, gapThreshold = 12): Promise<string[][]> {
  const result = await pdfToGrid(file, gapThreshold);
  return result.rows;
}
