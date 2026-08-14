async function loadPdfJs() {
  if ((window as any).pdfjsLib) return (window as any).pdfjsLib;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load PDF.js'));
    document.head.appendChild(script);
  });
  const lib = (window as any).pdfjsLib;
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

export async function pdfToGrid(file: File, gapThreshold = 12): Promise<string[][]> {
  const lib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: buf }).promise;
  const grid: string[][] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    // Group items by y (merge within 2px)
    const rowMap: Record<string, { x: number; text: string; width: number }[]> = {};
    for (const item of content.items as any[]) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      
      let key = Object.keys(rowMap).find(k => Math.abs(Number(k) - y) <= 2);
      if (key === undefined) key = String(y);
      if (!rowMap[key]) rowMap[key] = [];
      rowMap[key].push({ x: item.transform[4], text: item.str, width: item.width });
    }

    const ys = Object.keys(rowMap).map(Number).sort((a, b) => b - a); // top → bottom
    for (const y of ys) {
      const items = rowMap[y].sort((a, b) => a.x - b.x);
      const cells = splitIntoCells(items, gapThreshold);
      if (cells.length) grid.push(cells);
    }
  }
  return grid;
}
