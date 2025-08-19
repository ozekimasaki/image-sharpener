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
  return res;
}

export default {
  async fetch(request: Request, env: AssetsEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return withSecurityHeaders(new Response('ok'));
    const resp = await env.ASSETS.fetch(request);
    return withSecurityHeaders(resp);
  },
};


