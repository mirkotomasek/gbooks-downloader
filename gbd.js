(async function() {

    // -------------------------------------------------------------------------
    // --- 1. CONFIGURATION & SETUP ---
    // -------------------------------------------------------------------------

    /**
     * Extracts and sanitizes the book title from the DOM to use as a filename prefix.
     * @returns {string} A safe, clean filename prefix.
     */
    function getFilenamePrefix() {
        const titleElement = document.querySelector('h1.gb-volume-title');
        if (!titleElement) {
            Logger.warn("Could not find book title element. Using default 'Book' prefix.");
            return 'Book';
        }
        // Sanitize the title: replace spaces with hyphens and remove invalid characters.
        return titleElement.innerText
            .replace(/\s+/g, '-') // Replace one or more spaces with a single hyphen
            .replace(/[\\/:*?"<>|]/g, ''); // Remove characters invalid in filenames
    }

    const CONFIG = {
        FILENAME_PREFIX: getFilenamePrefix(),
        API_REQUEST_DELAY_MS: 50,
        DOWNLOAD_DELAY_MS: 200,
        BOOK_ID: new URLSearchParams(window.location.search).get('id'),
    };

    const Logger = {
        _log(message, styles) { console.log(message, styles); },
        info(message) { this._log(`%cINFO: ${message}`, 'color: #03A9F4;'); },
        success(message) { this._log(`%cSUCCESS: ${message}`, 'color: #4CAF50; font-weight: bold;'); },
        warn(message) { this._log(`%cWARN: ${message}`, 'color: #FFC107;'); },
        error(message, error) { console.error(`ERROR: ${message}`, error); },
        group(name) { console.group(name); },
        groupEnd() { console.groupEnd(); },
    };

    // -------------------------------------------------------------------------
    // --- 2. SERVICE MODULES (Separation of Concerns) ---
    // -------------------------------------------------------------------------

    const ApiService = {
        async getPageManifest() {
            const manifestUrl = `/books?id=${CONFIG.BOOK_ID}&jscmd=click3&pg=PP1`;
            const response = await fetch(manifestUrl);
            if (!response.ok) throw new Error(`Failed to fetch page manifest (HTTP ${response.status})`);
            const data = await response.json();
            const pids = data?.page?.map(p => p.pid);
            if (!pids || pids.length === 0) throw new Error("Could not parse the list of page IDs from the API response.");
            return pids;
        },
        async getPageBatch(pid) {
            const url = `/books?id=${CONFIG.BOOK_ID}&jscmd=click3&pg=${pid}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch page batch for PID ${pid} (HTTP ${response.status})`);
            const data = await response.json();
            const pageData = data?.page;
            if (!pageData) throw new Error(`Invalid API response for PID ${pid}.`);
            const urlMap = new Map();
            for (const page of pageData) {
                if (page.src && page.pid) urlMap.set(page.pid, page.src);
            }
            return urlMap;
        }
    };

    const DownloaderService = {
        async downloadFile({ url, filename }) {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch image data (HTTP ${response.status})`);
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = objectUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(objectUrl);
        }
    };
    
    // -------------------------------------------------------------------------
    // --- 3. MAIN ORCHESTRATOR ---
    // -------------------------------------------------------------------------

    async function main() {
        Logger.group('Google Books Downloader Initializing...');
        Logger.info(`Script Version: 2.1.0`);
        Logger.info(`Book ID: ${CONFIG.BOOK_ID}`);
        Logger.info(`Filename Prefix: "${CONFIG.FILENAME_PREFIX}"`);
        if (!CONFIG.BOOK_ID) {
            Logger.error("Could not find Book ID in the URL. Please navigate to a book page.");
            Logger.groupEnd();
            return;
        }
        Logger.groupEnd();

        let downloadJobs = [];
        
        try {
            Logger.group('STEP 1: Fetching Page Links');
            const allPids = await ApiService.getPageManifest();
            Logger.info(`Found a manifest for ${allPids.length} pages.`);
            const signedUrlMap = new Map();
            for (let i = 0; i < allPids.length; i++) {
                const pid = allPids[i];
                if (signedUrlMap.has(pid)) continue;
                Logger.info(`Fetching data for page ${i + 1}/${allPids.length}...`);
                const batchMap = await ApiService.getPageBatch(pid);
                batchMap.forEach((url, pid) => signedUrlMap.set(pid, url));
                await new Promise(resolve => setTimeout(resolve, CONFIG.API_REQUEST_DELAY_MS));
            }
            Logger.groupEnd();

            const padding = String(allPids.length).length;
            downloadJobs = allPids
                .map((pid, i) => {
                    const url = signedUrlMap.get(pid);
                    if (!url) return null;
                    const pageNumber = String(i + 1).padStart(padding, '0');
                    return { url, filename: `${CONFIG.FILENAME_PREFIX}-${pageNumber}.png` };
                })
                .filter(Boolean);

            if (downloadJobs.length !== allPids.length) {
                Logger.warn(`Could only resolve URLs for ${downloadJobs.length} of ${allPids.length} pages.`);
            }

            Logger.group('STEP 2: Downloading Files');
            Logger.warn("Your browser will now ask for permission to download multiple files. YOU MUST CLICK 'ALLOW'.");
            const failedDownloads = [];
            for (let i = 0; i < downloadJobs.length; i++) {
                const job = downloadJobs[i];
                Logger.info(`Downloading ${i + 1}/${downloadJobs.length}: ${job.filename}`);
                try {
                    await DownloaderService.downloadFile(job);
                } catch(e) {
                    Logger.error(`Failed to download ${job.filename}`, e);
                    failedDownloads.push(job.filename);
                }
                await new Promise(resolve => setTimeout(resolve, CONFIG.DOWNLOAD_DELAY_MS));
            }
            Logger.groupEnd();

            Logger.group('Summary');
            Logger.success(`Process complete. Successfully downloaded ${downloadJobs.length - failedDownloads.length} of ${downloadJobs.length} files.`);
            if (failedDownloads.length > 0) {
                Logger.warn(`The following ${failedDownloads.length} files failed:`);
                failedDownloads.forEach(filename => Logger.warn(`  - ${filename}`));
            }
            Logger.groupEnd();
        } catch (error) {
            Logger.error("A critical error occurred and the script had to stop.", error);
        }
    }

    main();
})();