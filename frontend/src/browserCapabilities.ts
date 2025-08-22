/**
 * ブラウザの画像形式対応検出モジュール
 * AVIF, WebP, JPEG, PNG の対応状況を検出し、フォールバック戦略を提供
 */

export type OutputFormat = 'webp' | 'jpeg' | 'png' | 'avif';

export interface FormatSupport {
  avif: boolean;
  webp: boolean;
  jpeg: boolean;
  png: boolean;
}

export interface FormatInfo {
  format: OutputFormat;
  label: string;
  supported: boolean;
  fallbackInfo?: {
    format: OutputFormat;
    reason: string;
  };
}

/**
 * ブラウザ機能検出クラス
 */
export class BrowserCapabilityDetector {
  private supportCache: FormatSupport | null = null;
  private detectionPromise: Promise<FormatSupport> | null = null;

  /**
   * AVIF サポートを検出
   */
  private async checkAVIFSupport(): Promise<boolean> {
    try {
      // 1x1の小さなテストキャンバスを作成
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      
      // 白いピクセルを描画
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1, 1);
      
      // AVIF形式でエンコードを試行
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/avif', 0.8)
      );
      
      // エンコード成功かつ正しいMIMEタイプかチェック
      return blob !== null && blob.type === 'image/avif';
    } catch {
      return false;
    }
  }

  /**
   * WebP サポートを検出
   */
  private async checkWebPSupport(): Promise<boolean> {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1, 1);
      
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.8)
      );
      
      return blob !== null && blob.type === 'image/webp';
    } catch {
      return false;
    }
  }

  /**
   * 全画像形式の対応状況を検出
   */
  async detectSupport(): Promise<FormatSupport> {
    // キャッシュがあれば返す
    if (this.supportCache) {
      return this.supportCache;
    }

    // 検出処理が進行中なら待つ
    if (this.detectionPromise) {
      return this.detectionPromise;
    }

    // 検出処理を開始
    this.detectionPromise = this.performDetection();
    this.supportCache = await this.detectionPromise;
    return this.supportCache;
  }

  /**
   * 実際の検出処理
   */
  private async performDetection(): Promise<FormatSupport> {
    const [avif, webp] = await Promise.all([
      this.checkAVIFSupport(),
      this.checkWebPSupport()
    ]);

    return {
      avif,
      webp,
      jpeg: true, // JPEG は全ブラウザ対応
      png: true,  // PNG は全ブラウザ対応
    };
  }

  /**
   * サポート済み形式の一覧を取得
   */
  async getSupportedFormats(): Promise<OutputFormat[]> {
    const support = await this.detectSupport();
    const formats: OutputFormat[] = [];
    
    if (support.avif) formats.push('avif');
    if (support.webp) formats.push('webp');
    formats.push('jpeg', 'png'); // 常にサポート
    
    return formats;
  }

  /**
   * 指定された形式が対応しているかチェック
   */
  async isFormatSupported(format: OutputFormat): Promise<boolean> {
    const support = await this.detectSupport();
    return support[format];
  }

  /**
   * フォールバック形式を決定
   */
  async getBestFallbackFormat(requestedFormat: OutputFormat): Promise<OutputFormat> {
    const support = await this.detectSupport();
    
    // 要求された形式が対応していれば、そのまま返す
    if (support[requestedFormat]) {
      return requestedFormat;
    }

    // フォールバック優先順位
    if (requestedFormat === 'avif') {
      if (support.webp) return 'webp';
      return 'jpeg'; // JPEG は必ず対応
    }
    
    if (requestedFormat === 'webp') {
      return 'jpeg'; // JPEG は必ず対応
    }
    
    // PNG と JPEG は常に対応しているため、変更不要
    return requestedFormat;
  }

  /**
   * UI表示用のフォーマット情報を取得
   */
  async getFormatInfoList(): Promise<FormatInfo[]> {
    const support = await this.detectSupport();
    
    const formatInfos: FormatInfo[] = [
      {
        format: 'webp',
        label: 'WebP（推奨）',
        supported: support.webp,
        fallbackInfo: support.webp ? undefined : {
          format: 'jpeg',
          reason: 'WebP未対応のため'
        }
      },
      {
        format: 'jpeg',
        label: 'JPEG',
        supported: support.jpeg,
      },
      {
        format: 'png',
        label: 'PNG',
        supported: support.png,
      },
      {
        format: 'avif',
        label: 'AVIF',
        supported: support.avif,
        fallbackInfo: support.avif ? undefined : {
          format: support.webp ? 'webp' : 'jpeg',
          reason: 'AVIF未対応のため'
        }
      }
    ];
    
    return formatInfos;
  }

  /**
   * ブラウザ情報を取得（デバッグ用）
   */
  getBrowserInfo(): { userAgent: string; supportedFormats?: OutputFormat[] } {
    return {
      userAgent: navigator.userAgent,
    };
  }
}

// シングルトンインスタンス
export const browserCapabilities = new BrowserCapabilityDetector();