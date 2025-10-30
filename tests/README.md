# Test Suite

This directory contains end-to-end tests for the Miofive Video Converter application using Playwright.

## Test Structure

- **api.spec.js** - API endpoint tests that verify server responses
- **app.spec.js** - Basic application UI tests
- **folder-browser.spec.js** - Folder browser functionality tests
- **scan.spec.js** - Video scanning functionality tests

## Running Tests

### Prerequisites

1. Install dependencies:
   ```bash
   npm install
   ```

2. Install Playwright browsers (first time only):
   ```bash
   npx playwright install chromium
   ```

### Run All Tests

```bash
npm test
```

### Run Tests in Headed Mode

To see the browser while tests run:

```bash
npm run test:headed
```

### Run Tests in UI Mode

To use Playwright's interactive UI:

```bash
npm run test:ui
```

### Run Specific Test File

```bash
npx playwright test tests/api.spec.js
```

### Run Tests with Debugging

```bash
npx playwright test --debug
```

## Test Coverage

The test suite covers:

1. **Application Loading**
   - Homepage loads with correct title
   - All UI elements are visible and functional
   - FFmpeg availability check

2. **Pre-Scan Filters**
   - Filter controls visibility
   - Date preset functionality
   - Clear button functionality

3. **Folder Browser**
   - Modal open/close functionality
   - Folder navigation
   - Path persistence

4. **Scan Functionality**
   - Video file scanning
   - Channel filtering (A/B)
   - Timeline display
   - File list generation
   - Select all functionality

5. **API Endpoints**
   - `/check-ffmpeg` - FFmpeg availability
   - `/list-directories` - Directory listing
   - `/scan` - Video scanning
   - `/combine` - Video combining

## CI/CD Integration

Tests are automatically run in GitHub Actions on every push and pull request. The CI workflow:

1. Uses a Docker container with FFmpeg pre-installed
2. Installs Node.js and dependencies
3. Installs Playwright browsers
4. Runs the test suite

## Writing New Tests

When adding new tests:

1. Follow the existing test structure
2. Use descriptive test names
3. Clean up any test data in `afterEach` hooks
4. Use appropriate timeouts for async operations
5. Add both positive and negative test cases

## Debugging Failed Tests

If a test fails:

1. Check the test output for error messages
2. Review screenshots in `test-results/` directory
3. View the trace file:
   ```bash
   npx playwright show-trace test-results/<trace-file>.zip
   ```
4. Run the specific test in headed mode to see what's happening

## Notes

- Tests create temporary directories in `/tmp` for mock video files
- All test data is cleaned up after each test
- The server is automatically started before tests and stopped after
- Tests use the configuration in `playwright.config.js`
