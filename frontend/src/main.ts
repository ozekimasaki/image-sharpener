import { zip } from 'fflate';
import { browserCapabilities, type OutputFormat, type FormatInfo } from './browserCapabilities.js';

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
  usedFallback?: {
    requestedFormat: OutputFormat;
    actualFormat: OutputFormat;
    reason: string;
  };
};

const DEFAULT_CONCURRENCY = Math.min(6, Math.max(1, navigator.hardwareConcurrency || 4));

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
  async function runner(): Promise<void> {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) break;
      results[current] = await worker(items[current], current);
    }
  }
  const parallel = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: parallel }, () => runner()))
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
const showCompatibilityBtn = $('#showCompatibility') as HTMLButtonElement;
const browserCompatibilitySection = $('#browserCompatibility') as HTMLElement;
const compatibilityInfo = $('#compatibilityInfo') as HTMLElement;

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

async function decodeImageFromUrl(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}

async function encodeCanvas(
  canvas: HTMLCanvasElement, 
  format: OutputFormat, 
  quality: number
): Promise<{ blob: Blob; actualFormat: OutputFormat; usedFallback?: { requestedFormat: OutputFormat; reason: string } }> {
  // 指定形式が対応しているかチェック
  const isSupported = await browserCapabilities.isFormatSupported(format);
  let actualFormat = format;
  let usedFallback: { requestedFormat: OutputFormat; reason: string } | undefined;
  
  if (!isSupported) {
    // フォールバック形式を決定
    actualFormat = await browserCapabilities.getBestFallbackFormat(format);
    usedFallback = {
      requestedFormat: format,
      reason: `${format.toUpperCase()}未対応のため${actualFormat.toUpperCase()}で出力`
    };
  }
  
  const type = getMimeType(actualFormat);
  
  try {
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, type, quality)
    );
    
    if (!blob) {
      throw new Error(`Failed to encode image as ${actualFormat}`);
    }
    
    // エンコード結果の検証
    if (blob.type !== type) {
      // 予期しない形式の場合、さらにフォールバックを試行
      if (actualFormat !== 'jpeg') {
        const fallbackBlob: Blob | null = await new Promise((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', quality)
        );
        
        if (fallbackBlob && fallbackBlob.type === 'image/jpeg') {
          return {
            blob: fallbackBlob,
            actualFormat: 'jpeg',
            usedFallback: {
              requestedFormat: format,
              reason: `${actualFormat.toUpperCase()}エンコード失敗のためJPEGで出力`
            }
          };
        }
      }
      
      throw new Error(`エンコード結果の形式が不正です: 期待=${type}, 実際=${blob.type}`);
    }
    
    return { blob, actualFormat, usedFallback };
    
  } catch (err) {
    if (actualFormat === 'jpeg') {
      // JPEG でも失敗した場合は諦める
      throw err;
    }
    
    // JPEG でリトライ
    try {
      const fallbackBlob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality)
      );
      
      if (!fallbackBlob) {
        throw new Error('JPEG エンコードも失敗しました');
      }
      
      return {
        blob: fallbackBlob,
        actualFormat: 'jpeg',
        usedFallback: {
          requestedFormat: format,
          reason: `${actualFormat.toUpperCase()}エンコード失敗のためJPEGで出力`
        }
      };
    } catch {
      throw new Error(`画像のエンコードに失敗しました: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }
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
    const img = await decodeImageFromUrl(originalUrl);
    const canvas = createCanvasFromImage(img);
    const result = await encodeCanvas(canvas, format, quality);
    
    const actualFormat = result.actualFormat;
    const ext = getExtension(actualFormat);
    const nameWithoutExt = file.name.replace(/\.[^.]+$/, '');
    
    image.processedBlob = result.blob;
    image.processedSize = result.blob.size;
    image.resultFilename = `${nameWithoutExt}.${ext}`;
    image.processedUrl = URL.createObjectURL(result.blob);
    
    // フォールバック情報を保存
    if (result.usedFallback) {
      image.usedFallback = {
        requestedFormat: result.usedFallback.requestedFormat,
        actualFormat: actualFormat,
        reason: result.usedFallback.reason
      };
    }
    
  } catch (err) {
    image.error = err instanceof Error ? err.message : 'Unknown error';
  }
  return image;
}

function renderItem(img: QueuedImage) {
  const el = document.createElement('article');
  el.className = 'item';
  el.dataset.id = img.id;
  
  // フォールバック情報の表示
  const fallbackInfo = img.usedFallback 
    ? `<div class="fallback-notice">⚠️ ${img.usedFallback.reason}</div>`
    : '';
  
  el.innerHTML = `
    <div class="thumbs">
      <figure>
        <img src="${img.originalUrl}" alt="元画像プレビュー" />
      </figure>
      <figure>
        ${img.processedUrl ? `<img src="${img.processedUrl}" alt="変換後プレビュー" />` : '<div style="height:140px"></div>'}
      </figure>
    </div>
    <div class="meta">
      <div>元: ${formatBytes(img.originalSize)}${img.file.type ? ` (${img.file.type})` : ''}</div>
      <div>後: ${img.processedSize ? formatBytes(img.processedSize) : '-'}${img.processedBlob ? ` (${img.processedBlob.type})` : ''}</div>
      ${img.error ? `<div style="color:#fca5a5">エラー: ${img.error}</div>` : ''}
      ${fallbackInfo}
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

function setGlobalBusy(busy: boolean) {
  if (busy) {
    list?.setAttribute('aria-busy', 'true');
    dropzone?.setAttribute('aria-busy', 'true');
    downloadAllBtn.setAttribute('aria-disabled', 'true');
    retryFailedBtn.setAttribute('aria-disabled', 'true');
  } else {
    list?.removeAttribute('aria-busy');
    dropzone?.removeAttribute('aria-busy');
    downloadAllBtn.removeAttribute('aria-disabled');
    retryFailedBtn.removeAttribute('aria-disabled');
  }
}

function updateQualityUI() {
  const format = (formatSelect.value as OutputFormat) ?? 'webp';
  const isPng = format === 'png';
  qualityInput.disabled = isPng;
  qualityValue.textContent = isPng ? 'N/A' : qualityInput.value;
  qualityInput.title = isPng ? 'PNGでは品質設定は無効です' : '';
}

async function handleFiles(files: FileList | null) {
  if (!files || files.length === 0) return;
  const format = (formatSelect.value as OutputFormat) ?? 'webp';
  const quality = Number(qualityInput.value);
  const items = Array.from(files);
  const results = await mapWithConcurrency(items, DEFAULT_CONCURRENCY, (file) => processFile(file, format, quality));
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
    updateQualityUI();
  });
  qualityInput.addEventListener('change', () => {
    // 品質変更時は再エンコード
    reprocessAll();
  });
  formatSelect.addEventListener('change', () => {
    // 出力形式変更時は再エンコード
    updateQualityUI();
    reprocessAll();
  });
  retryFailedBtn.addEventListener('click', () => {
    reprocessFailedOnly();
  });
  
  // ブラウザ対応状況表示ボタン
  showCompatibilityBtn.addEventListener('click', () => {
    if (browserCompatibilitySection.style.display === 'none' || browserCompatibilitySection.style.display === '') {
      showBrowserCompatibility();
    } else {
      hideBrowserCompatibility();
    }
  });
}

async function downloadAll() {
  // 集合ZIPを作る
  setGlobalBusy(true);
  try {
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
  } catch (e) {
    console.error('ZIP作成中にエラーが発生しました', e);
  } finally {
    setGlobalBusy(false);
  }
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
  setGlobalBusy(true);
  const format = (formatSelect.value as OutputFormat) ?? 'webp';
  const quality = Number(qualityInput.value);
  try {
    await mapWithConcurrency(queue, DEFAULT_CONCURRENCY, async (image) => {
      try {
        const imgEl = await decodeImageFromUrl(image.originalUrl);
        const canvas = createCanvasFromImage(imgEl);
        const result = await encodeCanvas(canvas, format, quality);
        
        if (image.processedUrl) URL.revokeObjectURL(image.processedUrl);
        
        const actualFormat = result.actualFormat;
        const ext = getExtension(actualFormat);
        const nameWithoutExt = image.file.name.replace(/\.[^.]+$/, '');
        
        image.processedBlob = result.blob;
        image.processedSize = result.blob.size;
        image.resultFilename = `${nameWithoutExt}.${ext}`;
        image.processedUrl = URL.createObjectURL(result.blob);
        image.error = undefined;
        
        // フォールバック情報を更新
        if (result.usedFallback) {
          image.usedFallback = {
            requestedFormat: result.usedFallback.requestedFormat,
            actualFormat: actualFormat,
            reason: result.usedFallback.reason
          };
        } else {
          image.usedFallback = undefined;
        }
        
      } catch (err) {
        image.error = err instanceof Error ? err.message : 'Unknown error';
        image.usedFallback = undefined;
      }
    });
  } finally {
    isReprocessing = false;
    refreshList();
    setGlobalBusy(false);
  }
}

async function reprocessFailedOnly() {
  if (isReprocessing) return;
  const failed = queue.filter(q => q.error);
  if (failed.length === 0) return;
  isReprocessing = true;
  downloadAllBtn.disabled = true;
  retryFailedBtn.disabled = true;
  setGlobalBusy(true);
  const format = (formatSelect.value as OutputFormat) ?? 'webp';
  const quality = Number(qualityInput.value);
  try {
    await mapWithConcurrency(failed, DEFAULT_CONCURRENCY, async (image) => {
      try {
        const imgEl = await decodeImageFromUrl(image.originalUrl);
        const canvas = createCanvasFromImage(imgEl);
        const result = await encodeCanvas(canvas, format, quality);
        
        if (image.processedUrl) URL.revokeObjectURL(image.processedUrl);
        
        const actualFormat = result.actualFormat;
        const ext = getExtension(actualFormat);
        const nameWithoutExt = image.file.name.replace(/\.[^.]+$/, '');
        
        image.processedBlob = result.blob;
        image.processedSize = result.blob.size;
        image.resultFilename = `${nameWithoutExt}.${ext}`;
        image.processedUrl = URL.createObjectURL(result.blob);
        image.error = undefined;
        
        // フォールバック情報を更新
        if (result.usedFallback) {
          image.usedFallback = {
            requestedFormat: result.usedFallback.requestedFormat,
            actualFormat: actualFormat,
            reason: result.usedFallback.reason
          };
        } else {
          image.usedFallback = undefined;
        }
        
      } catch (err) {
        image.error = err instanceof Error ? err.message : 'Unknown error';
        image.usedFallback = undefined;
      }
    });
  } finally {
    isReprocessing = false;
    refreshList();
    setGlobalBusy(false);
  }
}

// 起動時UI同期、ブラウザ機能検出、クリーンアップ
async function initializeApp() {
  // ブラウザ機能検出
  try {
    const formatInfos = await browserCapabilities.getFormatInfoList();
    updateFormatSelector(formatInfos);
  } catch (error) {
    console.warn('ブラウザ機能検出に失敗しました:', error);
  }
  
  updateQualityUI();
}

// フォーマットセレクターの更新
function updateFormatSelector(formatInfos: FormatInfo[]) {
  // 現在の選択を保存
  const currentValue = formatSelect.value;
  
  // オプションをクリア
  formatSelect.innerHTML = '';
  
  // 新しいオプションを追加
  formatInfos.forEach(info => {
    const option = document.createElement('option');
    option.value = info.format;
    
    // ラベルにサポート状況を追加
    let label = info.label;
    if (!info.supported && info.fallbackInfo) {
      label += ` → ${info.fallbackInfo.format.toUpperCase()}自動切替`;
    }
    
    option.textContent = label;
    option.disabled = false; // 全て有効にする（フォールバックがあるため）
    
    formatSelect.appendChild(option);
  });
  
  // 元の選択を復元（可能なら）
  if (Array.from(formatSelect.options).some(opt => opt.value === currentValue)) {
    formatSelect.value = currentValue;
  }
}

// ブラウザ対応状況の表示
async function showBrowserCompatibility() {
  try {
    const formatInfos = await browserCapabilities.getFormatInfoList();
    const support = await browserCapabilities.detectSupport();
    
    let html = '<table class="compatibility-table">';
    html += '<thead><tr><th>形式</th><th>対応状況</th><th>備考</th></tr></thead>';
    html += '<tbody>';
    
    formatInfos.forEach(info => {
      const statusIcon = info.supported ? '✅' : '❌';
      const statusText = info.supported ? '対応' : '未対応';
      const notes = info.fallbackInfo ? info.fallbackInfo.reason : '-';
      
      html += `<tr>`;
      html += `<td><strong>${info.format.toUpperCase()}</strong></td>`;
      html += `<td>${statusIcon} ${statusText}</td>`;
      html += `<td>${notes}</td>`;
      html += `</tr>`;
    });
    
    html += '</tbody></table>';
    html += `<p class="browser-info">ブラウザ: ${navigator.userAgent.split(' ').slice(-2).join(' ')}</p>`;
    
    compatibilityInfo.innerHTML = html;
    browserCompatibilitySection.style.display = 'block';
    showCompatibilityBtn.textContent = 'ブラウザ対応状況を隠す';
    
  } catch (error) {
    compatibilityInfo.innerHTML = '<p style="color: #fca5a5;">ブラウザ対応状況の取得に失敗しました。</p>';
    browserCompatibilitySection.style.display = 'block';
  }
}

// ブラウザ対応状況の非表示
function hideBrowserCompatibility() {
  browserCompatibilitySection.style.display = 'none';
  showCompatibilityBtn.textContent = 'ブラウザ対応状況を表示';
}

// アプリを初期化
initializeApp();

window.addEventListener('beforeunload', () => {
  for (const item of queue) {
    try { URL.revokeObjectURL(item.originalUrl); } catch {}
    if (item.processedUrl) {
      try { URL.revokeObjectURL(item.processedUrl); } catch {}
    }
  }
});


