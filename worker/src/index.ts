export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');
    return new Response(
      'Deploy the frontend build to Cloudflare Pages or Workers Sites. This worker is a placeholder.',
      { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } }
    );
  },
};


