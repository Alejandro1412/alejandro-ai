// Vercel Function: every /api/* request is rewritten here and served by the NestJS backend
// (built to backend/dist by the build command). See backend/src/serverless.ts.
module.exports = require('../backend/dist/serverless').default;
