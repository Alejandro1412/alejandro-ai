/** @type {import('jest').Config} */
const base = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
  testEnvironment: 'node',
};
module.exports = {
  testTimeout: 60000,
  projects: [
    { ...base, displayName: 'unit', rootDir: 'src', testRegex: '.*\\.spec\\.ts$', setupFiles: ['<rootDir>/../test/setup-env.ts'] },
    { ...base, displayName: 'e2e', rootDir: 'test', testRegex: '.*\\.e2e-spec\\.ts$', setupFiles: ['<rootDir>/setup-env.ts'], globalSetup: '<rootDir>/global-setup.ts' },
  ],
};
