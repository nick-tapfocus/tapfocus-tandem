export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-supabase-auth');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  res.status(200).json({ ok: true, message: 'pong' });
}

