// Single source of truth for required test coverage.
// The build (npm run test:coverage) fails if any metric drops below its value.
// Tune these percentages here; both line-of-code and branch testability are enforced.
const coverageThresholds = {
  lines: 90,
  branches: 90,
  functions: 90,
  statements: 90,
};

export default coverageThresholds;
