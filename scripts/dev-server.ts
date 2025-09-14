import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

// Load .env.local (if present) and then .env as fallback, BEFORE importing handlers
dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'x-supabase-auth'] }));
app.use(express.json({ limit: '2mb' }));

// Preflight for all /api routes
app.options('/api/*', (req, res) => {
  res.status(204).end();
});

// Simple health endpoint
app.get('/api/_health', (req, res) => {
  res.status(200).json({ ok: true });
});

// Defer importing handlers until after env is loaded
async function mountRoutes() {
  const { default: authHandler } = await import('../api/auth');
  const { default: chatHandler } = await import('../api/chat');
  const { default: partnersHandler } = await import('../api/partners');
  const { default: getTestHandler } = await import('../api/getTest');
  const { default: submitTestHandler } = await import('../api/submitTest');

  // Debug: ensure handlers are functions
  // eslint-disable-next-line no-console
  console.log('[dev-server] Handlers:', {
    auth: typeof authHandler,
    chat: typeof chatHandler,
    partners: typeof partnersHandler,
    getTest: typeof getTestHandler,
    submitTest: typeof submitTestHandler,
  });

  app.get('/api/auth', (req, res) => authHandler(req as any, res as any));

  app.get('/api/chat', (req, res) => chatHandler(req as any, res as any));
  app.post('/api/chat', (req, res) => chatHandler(req as any, res as any));
  app.options('/api/chat', (req, res) => chatHandler(req as any, res as any));

  app.get('/api/partners', (req, res) => partnersHandler(req as any, res as any));
  app.post('/api/partners', (req, res) => partnersHandler(req as any, res as any));
  app.delete('/api/partners', (req, res) => partnersHandler(req as any, res as any));
  app.options('/api/partners', (req, res) => partnersHandler(req as any, res as any));

  app.get('/api/getTest', (req, res) => getTestHandler(req as any, res as any));
  app.post('/api/getTest', (req, res) => getTestHandler(req as any, res as any));
  app.options('/api/getTest', (req, res) => getTestHandler(req as any, res as any));

  app.post('/api/submitTest', (req, res) => submitTestHandler(req as any, res as any));
  app.options('/api/submitTest', (req, res) => submitTestHandler(req as any, res as any));

  // Debug: Print mounted routes
  const routes: string[] = [];
  // @ts-expect-error express internals
  app._router.stack.forEach((m: any) => {
    if (m.route && m.route.path) {
      const methods = Object.keys(m.route.methods)
        .filter((k) => m.route.methods[k])
        .map((k) => k.toUpperCase())
        .join(',');
      routes.push(`${methods} ${m.route.path}`);
    }
  });
  // eslint-disable-next-line no-console
  console.log('[dev-server] Mounted routes:', routes);
}

mountRoutes()
  .then(() => {
    // 404 handler must be registered AFTER routes
    app.use((req, res) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Not Found' });
      } else {
        res.status(404).send('Not Found');
      }
    });

    app.listen(PORT, '0.0.0.0', () => {
      // eslint-disable-next-line no-console
      console.log(`[dev-server] API listening on http://0.0.0.0:${PORT}`);
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[dev-server] Failed to mount routes:', err);
    process.exit(1);
  });



