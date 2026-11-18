/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node', // testes de tela pedem jsdom pelo docblock `@jest-environment jsdom`
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  setupFiles: ['<rootDir>/src/test/polyfills.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json', diagnostics: false }] },
};
