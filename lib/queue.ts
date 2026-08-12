import { Queue } from 'bullmq';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const parsed = new URL(redisUrl);

export const redisConnection = {
  host: parsed.hostname,
  port: Number(parsed.port || 6379),
  username: parsed.username || undefined,
  password: parsed.password || undefined,
  db: Number(parsed.pathname.replace('/', '') || 0),
};

const globalForQueue = globalThis as unknown as { verifierQueue?: Queue };

export const verificationQueue = globalForQueue.verifierQueue ?? new Queue('email-verification', {
  connection: redisConnection,
});

if (process.env.NODE_ENV !== 'production') globalForQueue.verifierQueue = verificationQueue;
