import fs from "node:fs";
import "dotenv/config";
import { launch, getStream } from "puppeteer-stream";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type Stream from "node:stream";
import type { Page } from "puppeteer-core";

const stealthPuppeteer = puppeteer.use(StealthPlugin());

// const browser = await chromium.launch({
const browser = await launch(stealthPuppeteer, {
	executablePath: "./chrome/win64-147.0.7727.24/chrome-win64/chrome.exe",
	// headless: "new",
	defaultViewport: {
		width: 1920,
		height: 1080,
	},
	args: ["--force-prefers-reduced-motion"],
	startDelay: 2000,
});
const pagesInfo: Map<
	string,
	{ page: Page; file: fs.WriteStream; stream: Stream.Transform }
> = new Map();

// let capture: Awaited<ReturnType<typeof saveVideo>>;

function buttonLocator(
	page: Page,
	text: string,
	extraQuery: string = "",
	timeout: number = 30000,
) {
	return page.waitForSelector(
		`::-p-xpath(//*[@role="button" and contains(., "${text}")])${extraQuery}, button::-p-text(${text})${extraQuery}`,
		{
			timeout,
		},
	);
}

export async function startRecording(
	inviteLink: string,
	channelType: "voice" | "stage",
) {
	if (pagesInfo.get(inviteLink)) {
		throw new Error("Recording already in progress, use DELETE to stop it");
	}
	const page = await browser.newPage();

	const res = await page.goto("https://www.youtube.com/shorts/tAen-tB_vAI");
	if (!res?.ok()) {
		throw new Error("Invalid Link");
	}

	await page.locator("ytd-player").click();
		
	const file = fs.createWriteStream(
		`./videos/${new Date().getMilliseconds()}-${inviteLink.split("/").at(-1)}.webm`,
	);

	await new Promise(res => setTimeout(res, 1000));

	const stream = await getStream(page, { audio: true, video: true });
	stream.pipe(file);

	pagesInfo.set(inviteLink, { page, file, stream });

	// await page.evaluate((token) => {
	// 	setInterval(() => {
	// 		const iframe = document.createElement("iframe");
	// 		document.body.appendChild(iframe);

	// 		if (!iframe.contentWindow?.localStorage) return null;

	// 		iframe.contentWindow.localStorage.token = `"${token}"`;
	// 	}, 50);

	// 	setTimeout(() => {
	// 		location.reload();
	// 	}, 2500);
	// }, process.env.DISCORD_TOKEN);

	// await (await buttonLocator(page, "Accept Invite"))?.click();

	// try {
	// 	await (await buttonLocator(page, "Continue in Browser", "", 2000))?.click();
	// } catch {
	// 	console.log("no continue");
	// }

	// await page.evaluate(async () => {
	// 	let sidebar: HTMLElement | null;
	// 	do {
	// 		await new Promise((res) => setTimeout(res, 500));
	// 		sidebar = document.querySelector('[class^="sidebar"]') as HTMLElement;
	// 	} while (!sidebar);

	// 	sidebar.style.display = "none";
	// });

	// if (channelType === "voice")
	// 	// await page.getByRole("button").getByText("Watch Stream").click();
	// 	await (await buttonLocator(page, "Watch Stream"))?.click();
	// else {
	// 	await (await buttonLocator(page, "Got it!"))?.click();
	// 	await (
	// 		await buttonLocator(page, "Call tile, stream", "::-p-xpath(/parent::*)")
	// 	)?.click();
	// }

	// await (await buttonLocator(page, "Show Chat"))?.click();

	// const file = fs.createWriteStream(
	// 	`./videos/${new Date().getMilliseconds()}-${inviteLink.split("/").at(-1)}.webm`,
	// );
	// const stream = await getStream(page, { audio: true, video: true });
	
	//stream.pipe(file);

	// contextsInfo.set(inviteLink, { context, file, stream });

	// // @ts-expect-error
	// capture = await saveVideo(page, "videos/quality.mkv", {
	// 	fps: 60,
	// });

	return;
}

export async function endRecording(inviteLink: string) {
	console.log("stop recording");

	const {page, file, stream} = pagesInfo.get(inviteLink) ?? {};

	if (!page || !file || !stream) throw new Error("Recording not found");

	stream.destroy();
	await page.close();
	file.close();
	
	pagesInfo.delete(inviteLink);

	return;
}

export function displayRecordings() {
	let recordings = pagesInfo.size ? "" : "No recordings in progess";
	pagesInfo.forEach((_, link) => {
		recordings += `${link}\n`;
	});

	return recordings;
}

// startRecording("https://discord.gg/zVTyRRnf", "voice");
