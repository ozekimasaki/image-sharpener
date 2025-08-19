import { zip } from 'fflate';

type OutputFormat = 'webp' | 'jpeg' | 'png' | 'avif';

type QueuedImage = {
  id: string;
  file: File;
  originalUrl: string;
  processedBlob?: Blob;
  processedUrl?: string;
  resultFilename?: string;
  originalSize: number;
  processedSize?: number;
  error?: string;
};

function getMimeType(format: OutputFormat): string {
  return format === 'webp'
    ? 'image/webp'
    : format === 'jpeg'
    ? 'image/jpeg'
    : format === 'png'
    ? 'image/png'
    : 'image/avif';
}

function getExtension(format: OutputFormat): string {
  return format === 'jpeg' ? 'jpg' : format;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  async function run(): Promise<void> {
    const current = nextIndex++;
    if (current >= items.length) return;
    const res = await worker(items[current], current);
    results[current] = res;
    await run();
  }
  const runners: Promise<void>[] = [];
  const parallel = Math.min(concurrency, items.length);
  for (let i = 0; i < parallel; i++) runners.push(run());
  await Promise.all(runners);
  return results;
}

const $ = <T extends HTMLElement>(selector: string): T => {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Required element not found: ${selector}`);
  return el as T;
};

const fileInput = $('#fileInput') as HTMLInputElement;
const dropzone = $('#dropzone');
const list = $('#list');
const qualityInput = $('#quality') as HTMLInputElement;
const qualityValue = $('#qualityValue');
const formatSelect = $('#format') as HTMLSelectElement;
const downloadAllBtn = $('#downloadAll') as HTMLButtonElement;
const retryFailedBtn = $('#retryFailed') as HTMLButtonElement;

const queue: QueuedImage[] = [];
let isReprocessing = false;

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function createCanvasFromImage(img: HTMLImageElement) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);
  return canvas;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function decodeFirstFrame(file: File): Promise<HTMLImageElement> {
  // GIFはMVPで先頭フレームのみ
  const dataUrl = await readFileAsDataURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = dataUrl;
  await img.decode();
  return img;
}

async function encodeCanvas(canvas: HTMLCanvasElement, format: OutputFormat, quality: number): Promise<Blob> {
  const type = getMimeType(format);
  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, type, quality)
  );
  if (!blob) throw new Error('Failed to encode image');
  if (blob.type !== type) {
    throw new Error(`このブラウザは ${type} のエンコードに未対応です`);
  }
  return blob;
}

async function processFile(file: File, format: OutputFormat, quality: number): Promise<QueuedImage> {
  const originalUrl = URL.createObjectURL(file);
  const image: QueuedImage = {
    id: crypto.randomUUID(),
    file,
    originalUrl,
    originalSize: file.size,
  };

  try {
    const img = await decodeFirstFrame(file);
    const canvas = createCanvasFromImage(img);
    const blob = await encodeCanvas(canvas, format, quality);
    const ext = getExtension(format);
    const nameWithoutExt = file.name.replace(/\.[^.]+$/, '');
    image.processedBlob = blob;
    image.processedSize = blob.size;
    image.resultFilename = `${nameWithoutExt}.${ext}`;
    image.processedUrl = URL.createObjectURL(blob);
  } catch (err) {
    image.error = err instanceof Error ? err.message : 'Unknown error';
  }
  return image;
}

function renderItem(img: QueuedImage) {
  const el = document.createElement('article');
  el.className = 'item';
  el.dataset.id = img.id;
  el.innerHTML = `
    <div class="thumbs">
      <figure>
        <img src="${img.originalUrl}" alt="original preview" />
      </figure>
      <figure>
        ${img.processedUrl ? `<img src="${img.processedUrl}" alt="processed preview" />` : '<div style="height:140px"></div>'}
      </figure>
    </div>
    <div class="meta">
      <div>元: ${formatBytes(img.originalSize)}${img.file.type ? ` (${img.file.type})` : ''}</div>
      <div>後: ${img.processedSize ? formatBytes(img.processedSize) : '-'}${img.processedBlob ? ` (${img.processedBlob.type})` : ''}</div>
      ${img.error ? `<div style="color:#fca5a5">Error: ${img.error}</div>` : ''}
    </div>
    <div class="actions">
      <button data-action="download">個別DL</button>
      <button data-action="remove">削除</button>
    </div>
  `;

  el.querySelector('[data-action="download"]')?.addEventListener('click', () => {
    if (!img.processedBlob || !img.resultFilename) return;
    const a = document.createElement('a');
    a.href = img.processedUrl!;
    a.download = img.resultFilename;
    a.click();
  });
  el.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
    const idx = queue.findIndex(q => q.id === img.id);
    if (idx >= 0) {
      URL.revokeObjectURL(queue[idx].originalUrl);
      if (queue[idx].processedUrl) URL.revokeObjectURL(queue[idx].processedUrl);
      queue.splice(idx, 1);
      refreshList();
    }
  });

  return el;
}

function refreshList() {
  if (!list) return;
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const item of queue) frag.appendChild(renderItem(item));
  list.appendChild(frag);
  updateDownloadAllState();
}

function updateDownloadAllState() {
  const hasAny = queue.some(q => q.processedBlob);
  downloadAllBtn.disabled = !hasAny;
  const hasFailed = queue.some(q => q.error);
  retryFailedBtn.disabled = !hasFailed;
}

async function handleFiles(files: FileList | null) {
  if (!files || files.length === 0) return;
  const format = (formatSelect.value as OutputFormat) ?? 'webp';
  const quality = Number(qualityInput.value);
  const items = Array.from(files);
  const results = await mapWithConcurrency(items, 4, (file) => processFile(file, format, quality));
  queue.push(...results);
  refreshList();
}

function setupDnD() {
  if (!dropzone) return;
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    const dt = (e as DragEvent).dataTransfer;
    handleFiles(dt?.files ?? null);
  });
}

function setupInputs() {
  fileInput.addEventListener('change', () => handleFiles(fileInput.files));
  qualityInput.addEventListener('input', () => {
    qualityValue.textContent = qualityInput.value;
  });
  qualityInput.addEventListener('change', () => {
    // 品質変更時は再エンコード
    reprocessAll();
  });
  formatSelect.addEventListener('change', () => {
    // 出力形式変更時は再エンコード
    reprocessAll();
  });
  retryFailedBtn.addEventListener('click', () => {
    reprocessFailedOnly();
  });
}

async function downloadAll() {
  // 集合ZIPを作る
  const files: Record<string, Uint8Array> = {};
  for (const item of queue) {
    if (!item.processedBlob || !item.resultFilename) continue;
    const arrayBuffer = await item.processedBlob.arrayBuffer();
    files[item.resultFilename] = new Uint8Array(arrayBuffer);
  }
  const zipped: Uint8Array = await new Promise((resolve, reject) =>
    zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data!)))
  );
  const blob = new Blob([zipped], { type: 'application/zip' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'images.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

downloadAllBtn.addEventListener('click', () => {
  downloadAll();
});

setupDnD();
setupInputs();

async function reprocessAll() {
  if (isReprocessing || queue.length === 0) return;
  isReprocessing = true;
  downloadAllBtn.disabled = true;
  const format = (formatSelect.value as OutputFormat) ?? 'webp';
  const quality = Number(qualityInput.value);
  try {
    await mapWithConcurrency(queue, 4, async (image) => {
      try {
        const imgEl = await decodeFirstFrame(image.file);
        const canvas = createCanvasFromImage(imgEl);
        const blob = await encodeCanvas(canvas, format, quality);
        if (image.processedUrl) URL.revokeObjectURL(image.processedUrl);
        const ext = getExtension(format);
        const nameWithoutExt = image.file.name.replace(/\.[^.]+$/, '');
        image.processedBlob = blob;
        image.processedSize = blob.size;
        image.resultFilename = `${nameWithoutExt}.${ext}`;
        image.processedUrl = URL.createObjectURL(blob);
        image.error = undefined;
      } catch (err) {
        image.error = err instanceof Error ? err.message : 'Unknown error';
      }
    });
  } finally {
    isReprocessing = false;
    refreshList();
  }
}

async function reprocessFailedOnly() {
  if (isReprocessing) return;
  const failed = queue.filter(q => q.error);
  if (failed.length === 0) return;
  isReprocessing = true;
  downloadAllBtn.disabled = true;
  retryFailedBtn.disabled = true;
  const format = (formatSelect.value as OutputFormat) ?? 'webp';
  const quality = Number(qualityInput.value);
  try {
    await mapWithConcurrency(failed, 4, async (image) => {
      try {
        const imgEl = await decodeFirstFrame(image.file);
        const canvas = createCanvasFromImage(imgEl);
        const blob = await encodeCanvas(canvas, format, quality);
        if (image.processedUrl) URL.revokeObjectURL(image.processedUrl);
        const ext = getExtension(format);
        const nameWithoutExt = image.file.name.replace(/\.[^.]+$/, '');
        image.processedBlob = blob;
        image.processedSize = blob.size;
        image.resultFilename = `${nameWithoutExt}.${ext}`;
        image.processedUrl = URL.createObjectURL(blob);
        image.error = undefined;
      } catch (err) {
        image.error = err instanceof Error ? err.message : 'Unknown error';
      }
    });
  } finally {
    isReprocessing = false;
    refreshList();
  }
}


