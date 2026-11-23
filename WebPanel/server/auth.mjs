import crypto from 'node:crypto';

const AUTH_SECRET = process.env.AUTH_SECRET || crypto.createHash('sha256').update('adtv-dev-secret-change-in-prod').digest('hex');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

export function verifyCredentials(username, password) {
  return username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
}

export function issueToken(username) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: username,
      iat: Date.now(),
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = user;
  next();
}
