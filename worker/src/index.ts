type AssetsEnv = {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
};

function withSecurityHeaders(response: Response): Response {
  const res = new Response(response.body, response);
  const headers = res.headers;
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' blob: data:",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // HSTSはHTTPS配信前提。Cloudflare/Workers経由のHTTPSを想定
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return res;
}

export default {
  async fetch(request: Request, env: AssetsEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return withSecurityHeaders(new Response('ok'));
    const resp = await env.ASSETS.fetch(request);
    const contentType = resp.headers.get('content-type') || '';
    const resWithHeaders = withSecurityHeaders(resp);
    // 簡易キャッシュポリシー: HTMLはno-store, それ以外は長期
    if (contentType.includes('text/html')) {
      resWithHeaders.headers.set('Cache-Control', 'no-store');
    } else if (
      contentType.includes('text/css') ||
      contentType.includes('javascript') ||
      contentType.startsWith('image/')
    ) {
      resWithHeaders.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
    return resWithHeaders;
  },
};


