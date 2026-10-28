// Photo booth backend: stores each print for 14 days and serves the guest
// page the booth's QR code points to.
//
// Secret (wrangler secret put): BOOTH_KEY, which the iPad sends on every upload.
// Vars in wrangler.toml: ALLOWED_ORIGIN, NAMES, DATE_TEXT, FILE_PREFIX.

const DAY = 86400;
const KEEP_DAYS = 14;
const MAX_BYTES = 8 * 1024 * 1024;
const ID = /^[a-f0-9-]{20,40}$/i;

const cors = (env) => ({
  'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Booth-Key',
  'Access-Control-Max-Age': '86400',
});

const json = (env, data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors(env) } });

function authorized(req, env) {
  const key = req.headers.get('X-Booth-Key') || '';
  if (!env.BOOTH_KEY || key.length !== env.BOOTH_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ env.BOOTH_KEY.charCodeAt(i);
  return diff === 0;
}

function expiryText(expiresAt) {
  return new Date(expiresAt * 1000).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York',
  });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });

    // iPad uploads a finished print.
    let m = path.match(/^\/api\/photo\/([^/]+)$/);
    if (m && req.method === 'PUT') {
      if (!authorized(req, env)) return json(env, { error: 'unauthorized' }, 401);
      const id = m[1];
      if (!ID.test(id)) return json(env, { error: 'bad id' }, 400);
      const existing = await env.PHOTOS.getWithMetadata(`p:${id}`, 'stream');
      if (existing.value) {
        existing.value.cancel?.();
        return json(env, { ok: true, expiresAt: existing.metadata?.expiresAt });
      }
      const body = await req.arrayBuffer();
      if (!body.byteLength || body.byteLength > MAX_BYTES) return json(env, { error: 'bad size' }, 413);
      const head = new Uint8Array(body.slice(0, 3));
      if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return json(env, { error: 'not a jpeg' }, 415);
      const expiresAt = Math.floor(Date.now() / 1000) + KEEP_DAYS * DAY;
      await env.PHOTOS.put(`p:${id}`, body, { expiration: expiresAt, metadata: { expiresAt, bytes: body.byteLength } });
      return json(env, { ok: true, expiresAt });
    }

    // Guest page and the image itself.
    m = path.match(/^\/i\/([^/]+)\.jpg$/);
    if (m && req.method === 'GET') {
      if (!ID.test(m[1])) return new Response('Not found', { status: 404 });
      const photo = await env.PHOTOS.get(`p:${m[1]}`, 'stream');
      if (!photo) return new Response('Not found', { status: 404 });
      const headers = {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      };
      if (url.searchParams.has('download')) {
        headers['Content-Disposition'] = `attachment; filename="${env.FILE_PREFIX}-${m[1].slice(0, 8)}.jpg"`;
      }
      return new Response(photo, { headers });
    }

    m = path.match(/^\/p\/([^/]+)$/);
    if (m && req.method === 'GET') {
      const id = m[1];
      if (!ID.test(id)) return page(env, notFound(env), 404);
      const photo = await env.PHOTOS.getWithMetadata(`p:${id}`, 'stream');
      if (!photo.value) return page(env, notFound(env), 404);
      photo.value.cancel?.();
      return page(env, guestPage(env, id, photo.metadata?.expiresAt));
    }

    if (path === '/' || path === '/health') return new Response('ok', { headers: cors(env) });
    return new Response('Not found', { status: 404 });
  },
};

function page(env, body, status = 200) {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#F3ECDD">
<title>${esc(env.NAMES)} Photo Booth</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,500&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
<style>
:root{--cream:#F3ECDD;--green:#3E5541;--deep:#2C4033;--sage:#8A9B7E;--ink:#2E3A2D;--warn:#8A3B2E}
*{box-sizing:border-box}
body{margin:0;background:var(--cream);color:var(--ink);font-family:Jost,Arial,sans-serif;-webkit-text-size-adjust:100%}
main{max-width:560px;margin:0 auto;padding:calc(28px + env(safe-area-inset-top)) 16px 48px;text-align:center}
.eyebrow{font-size:12px;letter-spacing:.38em;text-transform:uppercase;color:var(--sage);margin:0 0 6px}
h1{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:500;font-size:clamp(38px,11vw,56px);line-height:1.05;color:var(--deep);margin:0}
.date{font-weight:300;font-size:13px;letter-spacing:.34em;text-transform:uppercase;color:var(--green);margin:10px 0 22px}
.warn{border:1.5px solid var(--warn);color:var(--warn);padding:14px 16px;font-size:15px;line-height:1.45;margin:0 0 22px;text-align:left}
.warn strong{font-weight:500}
img{display:block;width:auto;max-width:100%;max-height:60vh;height:auto;margin:0 auto;box-shadow:0 1px 2px rgba(44,64,51,.2),0 14px 34px rgba(44,64,51,.18);-webkit-touch-callout:default}
.btn{display:block;margin:24px 0 10px;background:var(--green);color:var(--cream);text-decoration:none;font-weight:500;font-size:15px;letter-spacing:.2em;text-transform:uppercase;padding:18px}
.help{font-size:14px;line-height:1.5;color:var(--ink);opacity:.8;margin:0}
</style></head><body><main>${body}</main></body></html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function header(env) {
  return `<p class="eyebrow">Photo booth</p><h1>${esc(env.NAMES)}</h1><p class="date">${esc(env.DATE_TEXT)}</p>`;
}

function guestPage(env, id, expiresAt) {
  const daysLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt * 1000 - Date.now()) / (DAY * 1000))) : KEEP_DAYS;
  const until = expiresAt ? expiryText(expiresAt) : '';
  return `${header(env)}
<p class="warn"><strong>Save your photo now.</strong> This link stops working ${daysLeft <= 1 ? 'tomorrow' : `in ${daysLeft} days`}${until ? `, on ${esc(until)}` : ''}. After that it is gone.</p>
<img id="print" src="/i/${id}.jpg" alt="Your photo booth print">
<a class="btn" id="save" href="/i/${id}.jpg?download">Save photo</a>
<p class="help">You can also press and hold the photo, then tap <strong>Save to Photos</strong>.</p>
<script>
// Phones: the share sheet saves straight to Photos. The file is fetched
// ahead of time because the share sheet must open right on the tap.
var file=null;
fetch('/i/${id}.jpg').then(function(r){return r.blob()}).then(function(b){
  var f=new File([b],'${esc(env.FILE_PREFIX)}-${id.slice(0, 8)}.jpg',{type:'image/jpeg'});
  try{if(navigator.canShare&&navigator.canShare({files:[f]}))file=f}catch(e){}
}).catch(function(){});
document.getElementById('save').addEventListener('click',function(e){
  if(!file)return;
  e.preventDefault();
  navigator.share({files:[file]}).catch(function(){});
});
</script>`;
}

function notFound(env) {
  return `${header(env)}<p class="help" style="font-size:17px">This photo link has expired or does not exist. Photo booth links work for ${KEEP_DAYS} days after the wedding photo is taken.</p>`;
}
