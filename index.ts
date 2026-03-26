import { chromium, type Locator } from "patchright";
import { saveVideo } from "playwright-video";
import "dotenv/config";


// const browser = await chromium.launch();
const browser = await chromium.launch({
	headless: false,
	ignoreDefaultArgs: ["--mute-audio"]
});
const context = await browser.newContext({
	baseURL: "https://discord.com",
	viewport: {
		width: 1920,
		height: 1080,
	},
	reducedMotion: "reduce",
});
const page = await context.newPage();

await page.goto("/channels/@me");

await page.evaluate((token) => {
	setInterval(() => {
		const iframe = document.createElement("iframe");
		document.body.appendChild(iframe);

		if (!iframe.contentWindow?.localStorage) return;

		iframe.contentWindow.localStorage.token = `"${token}"`;
	}, 50);

	setTimeout(() => {
		location.reload();
	}, 2500);
}, process.env.DISCORD_TOKEN);

const notificationRegEx = /^\((.*?)\)/;
const ackRegEx = /\/ack\/?$/i;

async function handleRecord() {
	let lastElement: Locator;
	while (true) {
		const title = await page.title();
		if (notificationRegEx.test(title)) {
			await page.keyboard.press("Control+Alt+Shift+ArrowDown");

			let acknowledged = false;
			page.waitForRequest(ackRegEx).then(() => (acknowledged = true));

			while (!acknowledged) {
				page.keyboard.press("Escape");
				await page.waitForTimeout(1000);
			}

			lastElement = page
				.getByRole("list", { name: "Messages in " })
				.locator("li")
				.last();
			console.log(await lastElement.getByText(/^record.*/i).count());
			if (await lastElement.getByText(/^record.*/i).count()) break;

			setTimeout(async () => await page.goto("/channels/@me"), 500);
		}

		await new Promise((res) => setTimeout(res, 1000));
	}

	console.log("recording");

	const isVoice = await lastElement.getByText("Join Voice").isVisible();

	await lastElement.getByRole("button").getByText("Join").click();

	if (isVoice) {
		console.log("visible");
		await page.getByRole("button").getByText("Watch Stream").click();
	} else {
		console.log("invisible");

		await page.getByRole("button").getByText("Got it!").click();
		await page
			.getByRole("button", { name: "Call tile, stream" })
			.locator("..")
			.click();
	}

	await page.getByRole("button", { name: "Show Chat" }).click();

	await page.evaluate(() => {
		const sidebar = document.querySelector('[class^="sidebar"]') as HTMLElement;
		if (!sidebar) return;
		sidebar.style.display = "none";
	});

    // @ts-expect-error
    const capture = await saveVideo(page, "videos/quality.mkv", {
        fps: 60,
    });

	await page.waitForTimeout(5000);

	await capture.stop();

	console.log("stop recording");

	handleRecord();
}

handleRecord();
