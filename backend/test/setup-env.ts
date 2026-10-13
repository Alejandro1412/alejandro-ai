/* Environment for e2e tests: isolated database, inline queue (no Redis required), deterministic secrets. */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/alejandro_test';
process.env.QUEUE_DRIVER = 'inline';
delete process.env.REDIS_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-access-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-at-least-32-characters-long';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.AI_DEFAULT_PROVIDER = 'mock';
process.env.EMBEDDINGS_PROVIDER = 'local';
process.env.SWAGGER_ENABLED = 'false';
process.env.WHATSAPP_APP_SECRET = 'test-whatsapp-secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.WHATSAPP_DEFAULT_CLINIC_SLUG = 'novacare';
process.env.RATE_LIMIT_MAX = '10000';
process.env.AUTH_RATE_LIMIT_MAX = '10000';
process.env.PUBLIC_CHAT_RATE_LIMIT_MAX = '1000';
