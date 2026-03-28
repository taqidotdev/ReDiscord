import { type BrowserContext, chromium, type Page } from "patchright";
import { saveVideo } from "playwright-video";
import "dotenv/config";

const browser = await chromium.launch({
	// headless: false,
	ignoreDefaultArgs: ["--mute-audio"],
});
const contextsInfo: Map<
	string,
	{ context: BrowserContext; streamInterval: NodeJS.Timeout | null, sendMessagesPage?: Page }
> = new Map();

let capture: Awaited<ReturnType<typeof saveVideo>>;

async function messageBase(page: Page, message: string) {
	try {
		console.log(`attempting to send "${message}"`);
		await page.getByRole("textbox", { name: "Message" }).fill(message);
		await page.keyboard.press("Enter");
	} catch (e) {
		console.log(e);
	}
}

export async function startRecording(
	inviteLink: string,
	channelType: "voice" | "stage",
	sendMessages: boolean = false,
	streamer?: string,
) {
	const context = await browser.newContext({
		viewport: {
			width: 1920,
			height: 1080,
		},
		reducedMotion: "reduce",
	});

	const page = await context.newPage();

	const message = sendMessages
		? (message: string) => messageBase(page, message)
		: () => {};

	const res = await page.goto(inviteLink);

	if (!res?.ok()) {
		throw new Error("Invalid Link");
	}

	await page.evaluate((token) => {
		setInterval(() => {
			const iframe = document.createElement("iframe");
			document.body.appendChild(iframe);

			if (!iframe.contentWindow?.localStorage) return null;

			iframe.contentWindow.localStorage.token = `"${token}"`;
		}, 50);

		setTimeout(() => {
			location.reload();
		}, 2500);
	}, process.env.DISCORD_TOKEN);

	await page.getByRole("button").getByText("Accept Invite").click();

	if (channelType === "stage")
		await page
			.getByRole("button")
			.getByText("Got it!")
			.click({ timeout: 5000 })
			.catch();

	console.log("trying to show chat");

	await page.getByRole("button", { name: "Show Chat" }).click();

	console.log("showed chat, hiding sidebar");

	await page.evaluate(() => {
		const sidebar = document.querySelector('[class^="sidebar"]') as HTMLElement;
		if (!sidebar) return;
		sidebar.style.display = "none";
	});

	console.log("hid sidebar");

	let streamInterval: NodeJS.Timeout | null = null;

	if (streamer) {
		const watchStream = async (timeout: number = 60000) =>
			await page
				.getByRole("button", { name: `Call tile, stream, ${streamer}` })
				.locator("..")
				.click({ timeout })
				.catch(async (e) => {
					if (e.name === "TimeoutError") {
						await message(
							`Stream doesn't exist, waiting for ${streamer} to stream`,
						);
						await watchStream(60000);
					} else {
						console.log(e);
					}
				});

		message(`Attempting to connect to ${streamer}'s stream`);
		await watchStream(5000);
		message(`Connected to ${streamer}'s stream`);

		streamInterval = setInterval(async () => {
			console.log("checking stream");
			const closeStream = page
				.getByRole("button", { name: "Close Stream" })
				.first();
			if (await closeStream.isVisible()) {
				await closeStream.click();
				await message(`${streamer}'s stream stopped, waiting for stream`);
				await watchStream();
				await message(`Reconnected to ${streamer}'s stream`);
			}
		}, 2500);
	}

	// @ts-expect-error
	capture = await saveVideo(page, "videos/quality.mkv", {
		fps: 60,
	});

	message("Started recording");

	contextsInfo.set(inviteLink, { context, streamInterval, sendMessagesPage: (sendMessages ? page : undefined) });

	return { context, page };
}

export async function endRecording(inviteLink: string) {
	console.log("stop recording");

	const { context, streamInterval, sendMessagesPage } = contextsInfo.get(inviteLink) ?? {};

	if (!context) throw new Error("Recording not found");
	if (streamInterval) clearInterval(streamInterval);

	await capture.stop();
	contextsInfo.delete(inviteLink);

	if (sendMessagesPage) await messageBase(sendMessagesPage, "Stopped recording").catch();

	context.close();
	return;
}

export function displayRecordings() {
	let recordings = contextsInfo.size ? "" : "No recordings in progess";
	contextsInfo.forEach((_, link) => {
		recordings += `${link}\n`;
	});

	return recordings;
}

