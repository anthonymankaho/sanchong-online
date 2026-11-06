/* Contract mock for the Qwen-compatible provider. Serves POST /v1/chat/completions
 * returning a valid completion whose JSON content is controlled by POST /__mode.
 *   node test-mock.js [port]
 */
const http = require('http');
const PORT = Number(process.argv[2] || 9998);

let mode = 'noop';
let targetId = 1;
let last = null;

function contentFor() {
  switch (mode) {
    case 'noop': return { message: 'ok', operations: [] };
    case 'update': return { message: 'update', operations: [{ op: 'update_unit', id: targetId, fields: { price: 450000 }, sig: '' }] };
    case 'create': return { message: 'create', operations: [{ op: 'create_unit', fields: { estate: 'AI新盤', price: 100000 } }] };
    case 'checklist': return { message: 'cl', operations: [{ op: 'set_checklist', unit_id: targetId, items: [{ category: '小區環境', item: '小區整體環境', score: 5 }], sig: '' }] };
    case 'invalid': return { message: 'bad', operations: [{ op: 'delete_unit', id: targetId }] };
    case 'badfield': return { message: 'bad', operations: [{ op: 'update_unit', id: targetId, fields: { nope: 1 }, sig: '' }] };
    case 'malformed': return 'this is not json';
    default: return { message: 'ok', operations: [] };
  }
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/__mode') {
      try { const o = JSON.parse(body); mode = o.mode; if (o.id) targetId = Number(o.id); } catch (e) {}
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return;
    }
    if (req.method === 'GET' && req.url === '/__last') {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(last)); return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch (e) {}
      last = {
        capped: parsed.max_tokens === 700,
        hasAuth: /^Bearer .+/.test(req.headers['authorization'] || ''),
        model: parsed.model,
        mode,
      };
      if (mode === '429') { res.writeHead(429); res.end('{}'); return; }
      const content = contentFor();
      const payload = {
        choices: [{ message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }
    res.writeHead(404); res.end('{}');
  });
}).listen(PORT, '127.0.0.1', () => console.log('mock on ' + PORT));
