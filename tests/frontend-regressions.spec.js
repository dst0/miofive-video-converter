// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

test.describe('Frontend Correctness & Regression Suite', () => {
    let testDir;

    test.beforeEach(async () => {
        testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fe-regressions-'));
    });

    test.afterEach(async () => {
        if (testDir) {
            try {
                await fs.rm(testDir, { recursive: true, force: true });
            } catch {
                // ignore cleanup error
            }
        }
    });

    test('default scan timeline range includes final clip duration and preserves selectAll checked', async ({ page }) => {
        await page.route('**/scan', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    count: 3,
                    files: [
                        {
                            filename: '010125_100000_010125_050000_000001A.MP4',
                            path: '/mock/000001A.MP4',
                            utcTime: '2025-01-01T10:00:00.000Z',
                            duration: 60,
                            fileType: 'Normal',
                            channel: 'A',
                        },
                        {
                            filename: '010125_100100_010125_050100_000002A.MP4',
                            path: '/mock/000002A.MP4',
                            utcTime: '2025-01-01T10:01:00.000Z',
                            duration: 60,
                            fileType: 'Normal',
                            channel: 'A',
                        },
                        {
                            filename: '010125_100200_010125_050200_000003A.MP4',
                            path: '/mock/000003A.MP4',
                            utcTime: '2025-01-01T10:02:00.000Z',
                            duration: 60,
                            fileType: 'Normal',
                            channel: 'A',
                        },
                    ],
                }),
            });
        });

        await page.goto('/');
        await page.locator('#folderPath').fill('/mock/videos');
        await page.locator('#scanBtn').click();

        await page.waitForSelector('.file-list', { timeout: 10000 });

        // Verify selectAll is checked by default
        const selectAll = page.locator('#selectAll');
        await expect(selectAll).toBeChecked();

        // Verify all individual clip checkboxes are checked
        const checkboxes = page.locator('.file-checkbox');
        const count = await checkboxes.count();
        expect(count).toBe(3);
        for (let i = 0; i < count; i++) {
            await expect(checkboxes.nth(i)).toBeChecked();
        }

        // Verify that the timeline range covers the complete span including final clip duration (10:03:00.000Z, not last start 10:02:00.000Z)
        const expectedTimeline = await page.evaluate(() => {
            const formatLocal = (d) => {
                const pad = (n, len = 2) => String(n).padStart(len, '0');
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
            };
            const normalizeInputVal = (d) => {
                const temp = document.createElement('input');
                temp.type = 'datetime-local';
                temp.step = '0.001';
                temp.value = formatLocal(d);
                return temp.value;
            };
            const expectedStartDate = new Date('2025-01-01T10:00:00.000Z');
            const expectedEndDate = new Date('2025-01-01T10:03:00.000Z');
            const wrongEndDate = new Date('2025-01-01T10:02:00.000Z');
            return {
                expectedStartDisplay: expectedStartDate.toLocaleString(),
                expectedEndDisplay: expectedEndDate.toLocaleString(),
                wrongEndDisplay: wrongEndDate.toLocaleString(),
                expectedManualStart: normalizeInputVal(expectedStartDate),
                expectedManualEnd: normalizeInputVal(expectedEndDate),
                wrongManualEnd: normalizeInputVal(wrongEndDate),
            };
        });

        // Wait for deferred timeline initialization (100ms timer) by asserting populated manual inputs
        await expect(page.locator('#manualEndTime')).toHaveValue(expectedTimeline.expectedManualEnd);
        await expect(page.locator('#manualStartTime')).toHaveValue(expectedTimeline.expectedManualStart);

        // Verify exact timeline end corresponding to 2025-01-01T10:03:00.000Z and not 10:02:00.000Z
        await expect(page.locator('#rangeEndDisplay')).toHaveText(expectedTimeline.expectedEndDisplay);
        await expect(page.locator('#results .timeline-label-end')).toHaveText(expectedTimeline.expectedEndDisplay);
        expect(await page.locator('#rangeEndDisplay').textContent()).not.toBe(expectedTimeline.wrongEndDisplay);
        expect(await page.locator('#manualEndTime').inputValue()).not.toBe(expectedTimeline.wrongManualEnd);

        // Verify start range display
        await expect(page.locator('#rangeStartDisplay')).toHaveText(expectedTimeline.expectedStartDisplay);
        await expect(page.locator('#results .timeline-label-start')).toHaveText(expectedTimeline.expectedStartDisplay);
    });

    test('wholly inside-clip range calculation in production DOM includes the containing clip', async ({ page }) => {
        await page.route('**/scan', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    count: 2,
                    files: [
                        {
                            filename: '010125_100000_010125_050000_000001A.MP4',
                            path: '/mock/000001A.MP4',
                            utcTime: '2025-01-01T10:00:00.000Z',
                            duration: 60,
                            fileType: 'Normal',
                            channel: 'A',
                        },
                        {
                            filename: '010125_100100_010125_050100_000002A.MP4',
                            path: '/mock/000002A.MP4',
                            utcTime: '2025-01-01T10:01:00.000Z',
                            duration: 60,
                            fileType: 'Normal',
                            channel: 'A',
                        },
                    ],
                }),
            });
        });

        await page.goto('/');
        await page.locator('#folderPath').fill('/mock/videos');
        await page.locator('#scanBtn').click();

        await page.waitForSelector('.file-list', { timeout: 10000 });
        await expect(page.locator('#manualStartTime')).not.toHaveValue('');

        // Clip 1 is 10:00:00 to 10:01:00. Set manual range strictly inside Clip 1: 10:00:10 to 10:00:25
        await page.evaluate(() => {
            const startInput = document.getElementById('manualStartTime');
            const endInput = document.getElementById('manualEndTime');
            if (!startInput || !endInput) return;
            const baseDate = new Date(startInput.value);
            const selStartDate = new Date(baseDate.getTime() + 10000);
            const selEndDate = new Date(baseDate.getTime() + 25000);

            const format = (d) => {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                const h = String(d.getHours()).padStart(2, '0');
                const min = String(d.getMinutes()).padStart(2, '0');
                const s = String(d.getSeconds()).padStart(2, '0');
                const ms = String(d.getMilliseconds()).padStart(3, '0');
                return `${y}-${m}-${day}T${h}:${min}:${s}.${ms}`;
            };

            startInput.value = format(selStartDate);
            startInput.dispatchEvent(new Event('change'));
            endInput.value = format(selEndDate);
            endInput.dispatchEvent(new Event('change'));
        });

        // Clip 1 should remain visible in the production DOM and checked
        const firstFileItem = page.locator('.file-item').first();
        await expect(firstFileItem).toBeVisible();
        const firstCheckbox = page.locator('.file-checkbox').first();
        await expect(firstCheckbox).toBeChecked();
        await expect(page.locator('.count')).toContainText('1 in selected range');
    });

    test('rapid sequential scans abort previous in-flight requests and avoid race conditions', async ({ page }) => {
        let scanCalls = 0;

        await page.route('**/scan', async (route) => {
            scanCalls++;
            const callNumber = scanCalls;
            if (callNumber === 1) {
                // Delay first scan response to allow second scan to supersede it
                await new Promise((r) => setTimeout(r, 600));
                try {
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            count: 1,
                            files: [
                                {
                                    filename: '010125_100000_010125_050000_000001A.MP4',
                                    path: '/slow/000001A.MP4',
                                    utcTime: '2025-01-01T10:00:00.000Z',
                                    duration: 10,
                                    fileType: 'Normal',
                                    channel: 'A',
                                },
                            ],
                        }),
                    });
                } catch {
                    // Route was aborted or closed
                }
            } else {
                // Second scan responds quickly with different files
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        count: 2,
                        files: [
                            {
                                filename: '010125_100100_010125_050100_000002A.MP4',
                                path: '/fast/000002A.MP4',
                                utcTime: '2025-01-01T10:01:00.000Z',
                                duration: 10,
                                fileType: 'Normal',
                                channel: 'A',
                            },
                            {
                                filename: '010125_100200_010125_050200_000003A.MP4',
                                path: '/fast/000003A.MP4',
                                utcTime: '2025-01-01T10:02:00.000Z',
                                duration: 10,
                                fileType: 'Normal',
                                channel: 'A',
                            },
                        ],
                    }),
                });
            }
        });

        await page.goto('/');
        await page.locator('#folderPath').fill('/path/one');
        await page.locator('#scanBtn').click();

        // Immediately trigger second scan before first scan completes
        await page.locator('#folderPath').fill('/path/two');
        await page.locator('#scanBtn').click();

        // Wait for scan to complete and verify count shows 2 files (from scan 2), not 1 file (from slow scan 1)
        await page.waitForSelector('.file-list', { timeout: 5000 });
        const countText = await page.locator('.count').textContent();
        expect(countText).toContain('Found 2 file(s)');

        // Wait an extra moment to ensure delayed response does not overwrite results
        await page.waitForTimeout(700);
        const finalCountText = await page.locator('.count').textContent();
        expect(finalCountText).toContain('Found 2 file(s)');
    });

    test('repeated scans cleanly reinitialize timeline without listener leaks', async ({ page }) => {
        const mockFile = '010125_100000_010125_050000_000001A.MP4';
        await fs.writeFile(path.join(testDir, mockFile), 'content');

        await page.goto('/');
        await page.locator('#folderPath').fill(testDir);

        // Run scan 3 times consecutively
        for (let i = 0; i < 3; i++) {
            await page.locator('#scanBtn').click();
            await page.waitForSelector('.file-list', { timeout: 5000 });
            await expect(page.locator('.count')).toContainText('Found 1 file(s)');
        }

        // Timeline controls should remain interactive
        await page.locator('#resetRange').click();
        await expect(page.locator('#selectAll')).toBeChecked();
    });

    test('extreme calendar spans cap day markers at 64 in production DOM', async ({ page }) => {
        await page.goto('/');

        // Initialize player screen with files spanning 1000 days (e.g. 2020 to 2022)
        const minTimestamp = new Date('2020-01-01T00:00:00.000Z').getTime();
        const maxTimestamp = new Date('2022-10-01T00:00:00.000Z').getTime(); // > 1000 days

        await page.evaluate(async ({ minTime, maxTime }) => {
            const files = [
                {
                    filename: '010120_000000_010120_000000_000001A.MP4',
                    path: 'test-data/Normal/010120_000000_010120_000000_000001A.MP4',
                    utcTime: new Date(minTime).toISOString(),
                    duration: 60,
                    fileType: 'Normal',
                    channel: 'A',
                },
                {
                    filename: '100122_000000_100122_000000_000002A.MP4',
                    path: 'test-data/Normal/100122_000000_100122_000000_000002A.MP4',
                    utcTime: new Date(maxTime).toISOString(),
                    duration: 60,
                    fileType: 'Normal',
                    channel: 'A',
                },
            ];
            const playerModule = await import('/player.js?v=export-range-1');
            playerModule.showPlayerScreen(files, { autoplay: false });
        }, { minTime: minTimestamp, maxTime: maxTimestamp });

        await page.waitForSelector('#playerScreen', { state: 'visible' });

        // Count the actual midnight markers created by production generateTimeMarkers in the DOM
        const markerCount = await page.locator('#playerScreen #timeMarkers .time-marker.midnight').count();
        expect(markerCount).toBeGreaterThan(0);
        expect(markerCount).toBeLessThanOrEqual(64);
    });

    test('stale media events after player back navigation are safely ignored on both player instances', async ({ page }) => {
        const pageErrors = [];
        page.on('pageerror', (err) => pageErrors.push(err));

        await page.goto('/');

        // Initialize player screen with mock files
        await page.evaluate(async () => {
            const mockFiles = [
                {
                    filename: '010125_100000_010125_050000_000001A.MP4',
                    path: 'test-data/Normal/010125_100000_010125_050000_000001A.MP4',
                    utcTime: '2025-01-01T10:00:00.000Z',
                    duration: 2,
                    fileType: 'Normal',
                    channel: 'A',
                },
                {
                    filename: '010125_100100_010125_050100_000002A.MP4',
                    path: 'test-data/Normal/010125_100100_010125_050100_000002A.MP4',
                    utcTime: '2025-01-01T10:01:00.000Z',
                    duration: 2,
                    fileType: 'Normal',
                    channel: 'A',
                },
            ];
            const playerModule = await import('/player.js?v=export-range-1');
            playerModule.showPlayerScreen(mockFiles);
        });

        await page.waitForSelector('#playerScreen', { state: 'visible' });

        // Navigate back to scan screen
        await page.locator('#backBtn').click();
        await page.waitForSelector('#mainScreen', { state: 'visible' });
        await expect(page.locator('#playerScreen')).toBeHidden();

        // Dispatch stale media events on BOTH production player elements (videoPlayer1 and videoPlayer2)
        await page.evaluate(() => {
            const players = [document.getElementById('videoPlayer1'), document.getElementById('videoPlayer2')].filter(Boolean);
            for (const p of players) {
                p.dispatchEvent(new Event('timeupdate'));
                p.dispatchEvent(new Event('ended'));
                p.dispatchEvent(new Event('pause'));
                p.dispatchEvent(new Event('play'));
            }
        });

        // Verify player screen stays hidden and no page errors were thrown
        await expect(page.locator('#playerScreen')).toBeHidden();
        expect(pageErrors).toEqual([]);
    });

    test('folder browser cancellation properly resets purpose and path across modal switches', async ({ page }) => {
        await page.goto('/');

        // Open player screen then export modal
        await page.evaluate(async () => {
            const mockFiles = [
                {
                    filename: '010125_100000_010125_050000_000001A.MP4',
                    path: 'test-data/Normal/010125_100000_010125_050000_000001A.MP4',
                    utcTime: '2025-01-01T10:00:00.000Z',
                    duration: 2,
                    fileType: 'Normal',
                    channel: 'A',
                },
            ];
            const playerModule = await import('/player.js?v=export-range-1');
            playerModule.showPlayerScreen(mockFiles);
        });

        await page.waitForSelector('#playerScreen', { state: 'visible' });
        await page.locator('#exportVideosBtn').click();
        await page.waitForSelector('#exportModal', { state: 'visible' });

        // Open folder browser for export
        await page.locator('#exportBrowseFolderBtn').click();
        await page.waitForSelector('#folderBrowserModal', { state: 'visible' });

        // Cancel folder browser
        await page.locator('#cancelBrowserBtn').click();
        await expect(page.locator('#folderBrowserModal')).toBeHidden();

        // Close export modal
        await page.locator('#exportCancelBtn').click();
        await expect(page.locator('#exportModal')).toBeHidden();

        // Back to scan screen
        await page.locator('#backBtn').click();
        await page.waitForSelector('#mainScreen', { state: 'visible' });

        // Open folder browser for scan
        await page.locator('#browseFolderBtn').click();
        await page.waitForSelector('#folderBrowserModal', { state: 'visible' });

        // Verify folder browser modal is visible
        await expect(page.locator('#folderBrowserModal')).toBeVisible();
        await page.locator('#cancelBrowserBtn').click();
        await expect(page.locator('#folderBrowserModal')).toBeHidden();
    });

    test('requested export range is retained when scanned durations are unavailable until loaded metadata', async ({ page }) => {
        await page.goto('/');

        // Initialize player screen with files lacking preloaded durations (duration: undefined)
        await page.evaluate(async () => {
            const filesWithoutDurations = [
                {
                    filename: '010125_100000_010125_050000_000001A.MP4',
                    path: 'test-data/Normal/010125_100000_010125_050000_000001A.MP4',
                    utcTime: '2025-01-01T10:00:00.000Z',
                    duration: undefined,
                    fileType: 'Normal',
                    channel: 'A',
                },
            ];
            const playerModule = await import('/player.js?v=export-range-1');
            playerModule.showPlayerScreen(filesWithoutDurations, {
                autoplay: false,
                exportRange: { start: 5, end: 15 },
            });
        });

        await page.waitForSelector('#playerScreen', { state: 'visible' });

        // Simulate video metadata loading with a duration of 30 seconds
        await page.evaluate(() => {
            const player = document.getElementById('videoPlayer1');
            Object.defineProperty(player, 'duration', { value: 30, configurable: true });
            player.dispatchEvent(new Event('loadedmetadata'));
        });

        // Open the export modal
        await page.locator('#exportVideosBtn').click();
        await page.waitForSelector('#exportModal', { state: 'visible' });

        // Assert that the preselected export range (5s to 15s) was retained and populated
        await expect(page.locator('#exportRangeStart')).toHaveValue('00:05.000');
        await expect(page.locator('#exportRangeEnd')).toHaveValue('00:15.000');
    });

    test('latest seek wins across clip change followed immediately by same-clip seek while readiness pending', async ({ page }) => {
        await page.goto('/');

        await page.evaluate(async () => {
            const mockFiles = [
                {
                    filename: '010125_100000_010125_050000_000001A.MP4',
                    path: 'test-data/Normal/010125_100000_010125_050000_000001A.MP4',
                    utcTime: '2025-01-01T10:00:00.000Z',
                    duration: 2,
                    fileType: 'Normal',
                    channel: 'A',
                },
                {
                    filename: '010125_100100_010125_050100_000002A.MP4',
                    path: 'test-data/Normal/010125_100100_010125_050100_000002A.MP4',
                    utcTime: '2025-01-01T10:01:00.000Z',
                    duration: 2,
                    fileType: 'Normal',
                    channel: 'A',
                },
                {
                    filename: '010125_100200_010125_050200_000003A.MP4',
                    path: 'test-data/Normal/010125_100200_010125_050200_000003A.MP4',
                    utcTime: '2025-01-01T10:02:00.000Z',
                    duration: 2,
                    fileType: 'Normal',
                    channel: 'A',
                },
                {
                    filename: '010125_100300_010125_050300_000004A.MP4',
                    path: 'test-data/Normal/010125_100300_010125_050300_000004A.MP4',
                    utcTime: '2025-01-01T10:03:00.000Z',
                    duration: 2,
                    fileType: 'Normal',
                    channel: 'A',
                },
            ];
            const playerModule = await import('/player.js?v=export-range-1');
            playerModule.showPlayerScreen(mockFiles, { autoplay: false });
        });

        await page.waitForSelector('#playerScreen', { state: 'visible' });

        // Phase 1: Exercise videoPlayer1 (activePlayerIndex = 0)
        const player1Result = await page.evaluate(async () => {
            const playerModule = await import('/player.js?v=export-range-1');
            const player1 = document.getElementById('videoPlayer1');
            const player2 = document.getElementById('videoPlayer2');

            // Force readyState to 0 (HAVE_NOTHING) on videoPlayer1
            let player1Ready = 0;
            Object.defineProperty(player1, 'readyState', {
                get: () => player1Ready,
                configurable: true,
            });
            let mockTime1 = 0;
            Object.defineProperty(player1, 'currentTime', {
                get: () => mockTime1,
                set: (v) => { mockTime1 = v; },
                configurable: true,
            });

            const initialActiveId = player1.classList.contains('active-player') ? player1.id : player2.id;

            // First seek across clip change: seek to clip 1 at local 0.5s (global 2.5s within 2s media bounds)
            playerModule.seekToGlobalTime(2.5);

            // Immediately seek again within the same clip to local 1.5s (global 3.5s within 2s media bounds)
            playerModule.seekToGlobalTime(3.5);

            // Dispatch loadeddata to simulate media buffered
            player1Ready = 4;
            player1.dispatchEvent(new Event('loadeddata'));

            return {
                initialActiveId,
                player1Time: mockTime1,
                player2Time: player2.currentTime,
                player1IsActive: player1.classList.contains('active-player'),
                player2IsActive: player2.classList.contains('active-player'),
            };
        });

        // Verify videoPlayer1 assertions
        expect(player1Result.initialActiveId).toBe('videoPlayer1');
        expect(player1Result.player1IsActive).toBe(true);
        expect(player1Result.player2IsActive).toBe(false);
        // The second seek (local 1.5s) must win over the first seek (local 0.5s)
        expect(player1Result.player1Time).toBe(1.5);
        expect(player1Result.player1Time).not.toBe(0.5);

        // Phase 2: Drive actual production player switching to videoPlayer2 via #nextBtn click
        await page.locator('#nextBtn').click();

        // Phase 3: Exercise videoPlayer2 (activePlayerIndex = 1)
        const player2Result = await page.evaluate(async () => {
            const playerModule = await import('/player.js?v=export-range-1');
            const player1 = document.getElementById('videoPlayer1');
            const player2 = document.getElementById('videoPlayer2');

            const activeBeforeSeek = player2.classList.contains('active-player') ? player2.id : player1.id;

            // Force readyState to 0 (HAVE_NOTHING) on videoPlayer2
            let player2Ready = 0;
            Object.defineProperty(player2, 'readyState', {
                get: () => player2Ready,
                configurable: true,
            });
            let mockTime2 = 0;
            Object.defineProperty(player2, 'currentTime', {
                get: () => mockTime2,
                set: (v) => { mockTime2 = v; },
                configurable: true,
            });

            // First seek across clip change: seek from clip 2 to clip 3 at local 0.5s (global 6.5s within 2s media bounds)
            playerModule.seekToGlobalTime(6.5);

            // Immediately seek again within the same clip to local 1.5s (global 7.5s within 2s media bounds)
            playerModule.seekToGlobalTime(7.5);

            // Dispatch loadeddata to simulate media buffered for videoPlayer2
            player2Ready = 4;
            player2.dispatchEvent(new Event('loadeddata'));

            return {
                activeBeforeSeek,
                player1Time: player1.currentTime,
                player2Time: mockTime2,
                player1IsActive: player1.classList.contains('active-player'),
                player2IsActive: player2.classList.contains('active-player'),
            };
        });

        // Verify videoPlayer2 assertions
        expect(player2Result.activeBeforeSeek).toBe('videoPlayer2');
        expect(player2Result.player2IsActive).toBe(true);
        expect(player2Result.player1IsActive).toBe(false);
        // The second seek (local 1.5s) must win over the first seek (local 0.5s) on videoPlayer2
        expect(player2Result.player2Time).toBe(1.5);
        expect(player2Result.player2Time).not.toBe(0.5);
        // videoPlayer1 currentTime must remain intact and not corrupted by videoPlayer2 seek
        expect(player2Result.player1Time).toBe(1.5);
    });

    test('cancelled or closed export modal request cannot mutate or close a newly opened modal', async ({ page }) => {
        let exportRequestDeferredResolve;
        const exportRequestPromise = new Promise((resolve) => {
            exportRequestDeferredResolve = resolve;
        });

        await page.route('**/export', async (route) => {
            // Delay response until test explicitly signals
            await exportRequestPromise;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, output: '/output/test.mp4' }),
            });
        });

        await page.goto('/');

        await page.evaluate(async () => {
            const mockFiles = [
                {
                    filename: '010125_100000_010125_050000_000001A.MP4',
                    path: 'test-data/Normal/010125_100000_010125_050000_000001A.MP4',
                    utcTime: '2025-01-01T10:00:00.000Z',
                    duration: 2,
                    fileType: 'Normal',
                    channel: 'A',
                },
            ];
            const playerModule = await import('/player.js?v=export-range-1');
            playerModule.showPlayerScreen(mockFiles, { autoplay: false });
        });

        await page.waitForSelector('#playerScreen', { state: 'visible' });
        await page.locator('#exportVideosBtn').click();
        await page.waitForSelector('#exportModal', { state: 'visible' });

        await page.evaluate((dir) => {
            document.getElementById('exportOutputFolder').value = dir;
        }, testDir);

        // Click export to initiate delayed export
        await page.locator('#exportConfirmBtn').click();
        await expect(page.locator('#exportStatus .loading')).toBeVisible();

        // User cancels / closes the modal while export is in progress
        await page.locator('#exportCancelBtn').click();
        await expect(page.locator('#exportModal')).toBeHidden();

        // User promptly re-opens the export modal to configure a new export
        await page.locator('#exportVideosBtn').click();
        await page.waitForSelector('#exportModal', { state: 'visible' });
        await page.locator('#exportOutputFilename').fill('second_attempt.mp4');

        // Now let the first in-flight export request resolve
        exportRequestDeferredResolve();
        await page.waitForTimeout(400);

        // The newly opened export modal MUST remain open and visible, not closed by the stale response
        await expect(page.locator('#exportModal')).toBeVisible();
        await expect(page.locator('#exportOutputFilename')).toHaveValue('second_attempt.mp4');
    });

    test('cancelling active scan by modifying input or channel removes stale scanning indicator', async ({ page }) => {
        let scanResolve;
        const scanPromise = new Promise((resolve) => {
            scanResolve = resolve;
        });

        await page.route('**/scan', async (route) => {
            await scanPromise;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ count: 0, files: [] }),
            });
        });

        await page.goto('/');
        await page.locator('#folderPath').fill(testDir);
        await page.locator('#scanBtn').click();

        // Verify scanning indicator is visible
        await expect(page.locator('#results .loading')).toBeVisible();

        // Modify input to trigger cancelActiveScan
        await page.locator('#folderPath').fill(`${testDir}/modified`);

        // The stale loading indicator must be immediately cleared from #results
        await expect(page.locator('#results .loading')).toHaveCount(0);
        await expect(page.locator('#scanBtn')).toBeEnabled();
        await expect(page.locator('#scanBtn')).toHaveText('Scan');

        scanResolve();
    });

    test('out-of-order folder navigation responses cannot mismatch rendered path and selected path', async ({ page }) => {
        let slowFolderResolve;
        const slowFolderPromise = new Promise((r) => { slowFolderResolve = r; });

        await page.route('**/list-directories', async (route) => {
            const body = route.request().postDataJSON();
            if (body && body.path === 'slow-folder') {
                await slowFolderPromise;
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        directories: [{ name: 'slow-sub', path: 'slow-folder/slow-sub' }],
                        currentPath: 'slow-folder',
                    }),
                });
            } else if (body && body.path === 'fast-folder') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        directories: [{ name: 'fast-sub', path: 'fast-folder/fast-sub' }],
                        currentPath: 'fast-folder',
                    }),
                });
            } else {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        directories: [
                            { name: 'slow-folder', path: 'slow-folder' },
                            { name: 'fast-folder', path: 'fast-folder' },
                        ],
                        currentPath: '',
                    }),
                });
            }
        });

        await page.goto('/');
        await page.locator('#browseFolderBtn').click();
        await page.waitForSelector('#folderBrowserModal', { state: 'visible' });

        // Wait for initial root folder listing to render
        await page.waitForSelector('.folder-item[data-path="slow-folder"]');
        await page.waitForSelector('.folder-item[data-path="fast-folder"]');

        // Click slow-folder via real clickable navigation (starts slow request)
        await page.locator('.folder-item[data-path="slow-folder"]').click();
        await expect(page.locator('#folderTree .loading-folders')).toBeVisible();

        // Close modal while request is pending to test close/reopen generation isolation
        await page.locator('#cancelBrowserBtn').click();
        await expect(page.locator('#folderBrowserModal')).toBeHidden();

        // Reopen folder browser
        await page.locator('#browseFolderBtn').click();
        await page.waitForSelector('#folderBrowserModal', { state: 'visible' });
        await page.waitForSelector('.folder-item[data-path="fast-folder"]');

        // Click fast-folder via real clickable navigation
        await page.locator('.folder-item[data-path="fast-folder"]').click();
        await page.waitForSelector('.folder-item[data-path="fast-folder/fast-sub"]');
        await expect(page.locator('#currentPathDisplay')).toHaveText('fast-folder');

        // Select the current fast-folder
        await page.locator('#selectFolderBtn').click();
        await expect(page.locator('#folderPath')).toHaveValue('fast-folder');

        // Now resolve the delayed slow-folder response
        slowFolderResolve();
        await page.waitForTimeout(300);

        // Verify the selected folder is still fast-folder and wasn't clobbered
        await expect(page.locator('#folderPath')).toHaveValue('fast-folder');

        // If folder browser is opened again, it does not show stale slow-folder
        await page.locator('#browseFolderBtn').click();
        await page.waitForSelector('#folderBrowserModal', { state: 'visible' });
        await expect(page.locator('#currentPathDisplay')).not.toHaveText('slow-folder');
        await page.locator('#cancelBrowserBtn').click();
    });

    test('non-autoplay export flow remains paused and videoPlayer1 has no static autoplay attribute', async ({ page }) => {
        await page.goto('/');

        // 1. Verify videoPlayer1 has no static autoplay attribute in HTML markup
        const hasAutoplay = await page.locator('#videoPlayer1').evaluate(el => el.hasAttribute('autoplay'));
        expect(hasAutoplay).toBe(false);

        // 2. Open export flow with autoplay: false
        await page.evaluate(async () => {
            const mockFiles = [
                {
                    filename: '010125_100000_010125_050000_000001A.MP4',
                    path: 'test-data/Normal/010125_100000_010125_050000_000001A.MP4',
                    utcTime: '2025-01-01T10:00:00.000Z',
                    duration: 2,
                    fileType: 'Normal',
                    channel: 'A',
                },
            ];
            const playerModule = await import('/player.js?v=export-range-1');
            playerModule.showExportFlow(mockFiles);
        });

        await page.waitForSelector('#playerScreen', { state: 'visible' });
        await page.waitForTimeout(400);

        const isPaused = await page.locator('#videoPlayer1').evaluate(el => el.paused);
        expect(isPaused).toBe(true);
    });

    test('showPlayerScreen does not mutate caller array by sorting in place', async ({ page }) => {
        await page.goto('/');

        const originalFirstFile = await page.evaluate(async () => {
            const files = [
                {
                    filename: '010125_100200_010125_050200_000003A.MP4',
                    path: 'test-data/Normal/010125_100200_010125_050200_000003A.MP4',
                    utcTime: '2025-01-01T10:02:00.000Z',
                    duration: 2,
                    fileType: 'Normal',
                    channel: 'A',
                },
                {
                    filename: '010125_100000_010125_050000_000001A.MP4',
                    path: 'test-data/Normal/010125_100000_010125_050000_000001A.MP4',
                    utcTime: '2025-01-01T10:00:00.000Z',
                    duration: 2,
                    fileType: 'Normal',
                    channel: 'A',
                },
            ];
            const playerModule = await import('/player.js?v=export-range-1');
            playerModule.showPlayerScreen(files, { autoplay: false });
            return files[0].filename;
        });

        // The caller's array must preserve its initial order (000003A first)
        expect(originalFirstFile).toBe('010125_100200_010125_050200_000003A.MP4');
    });
});
