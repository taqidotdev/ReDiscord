const { launch, getStream } = require("puppeteer-stream");
const fs = require("node:fs");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

async function test() {
    const file = fs.createWriteStream("videos/test.webm");

    const browser = await launch(puppeteer, {
        executablePath: "./chrome/win64-147.0.7727.24/chrome-win64/chrome.exe",
        defaultViewport: { width: 1920, height: 1080 },
        // Ensure extensions are enabled and the browser is "normal"
        args: ["--no-sandbox", "--disable-setuid-sandbox"] 
    });

    try {
        // 1. Get all open pages and close the extra 'about:blank' page
        const pages = await browser.pages();
        console.log(pages)
        pages.forEach(async (page) => await page.close()); 
        const page = await browser.newPage();

        // 2. Navigate and wait for the page to be FULLY ready
        // 'networkidle2' ensures no more than 2 network connections are active
        await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ", {
            waitUntil: "networkidle2"
        });

        // 3. IMPORTANT: Wait for a specific element to ensure the DOM is painted
        await page.waitForSelector("video", { timeout: 10000 });
        
        // 4. Force focus one last time
        await page.bringToFront();

        // 5. Wrap getStream in try/catch to handle the "Extension" error gracefully
        console.log("Attempting to start stream...");
        const stream = await getStream(page, { 
            audio: true, 
            video: true,
            frameSize: 30 // Optional: can help with stability
        });

        console.log("Recording started");
        stream.pipe(file);

        setTimeout(async () => {
            // Check if stream exists before destroying to avoid crashes
            if (stream) await stream.destroy();
            await browser.close();
            file.close();
            console.log("Finished");
        }, 1000 * 10);

    } catch (err) {
        console.error("FATAL ERROR:", err);
        await browser.close();
    }
}

test();