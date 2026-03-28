import fs from "node:fs";
import { type BrowserContext, chromium, type Page } from "patchright";
import "dotenv/config";

if (!process.env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN not specified");

const browser = await chromium.launch({
	headless: false,
	args: [
		"--disable-features=WebRtcHideLocalIpsWithMdns",
		"--use-fake-ui-for-media-stream",
		"--enable-usermedia-screen-capturing",
	],
	ignoreDefaultArgs: ["--mute-audio"],
});
const contextsInfo: Map<
	string,
	{
		context: BrowserContext;
		page: Page;
		sendMessages?: boolean;
	}
> = new Map();

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
	sendMessages?: boolean,
	streamer?: string,
	fileName?: string,
) {
	const context = await browser.newContext({
		viewport: {
			width: 1920,
			height: 1080,
		},
		reducedMotion: "reduce",
	});

	try {
		const page = await context.newPage();

		const message = sendMessages
			? (message: string) => messageBase(page, message)
			: () => {};

		const res = await page.goto(inviteLink);

		if (!res?.ok()) {
			throw new Error("Invalid Link");
		}

		await page.evaluate((token) => {
			const iframe = document.createElement("iframe");
			document.body.appendChild(iframe);

			if (!iframe.contentWindow?.localStorage) return null;

			iframe.contentWindow.localStorage.token = `"${token}"`;

			document.body.removeChild(iframe);

			setTimeout(() => {
				location.reload();
			}, 2500);
		}, process.env.DISCORD_TOKEN);

		// try {
		// 	await page
		// 		.getByRole("button", { name: "Continue in Browser" })
		// 		.click({ timeout: 10000 });
		// } catch {
		try {
			await page
				.getByRole("button")
				.getByText("Accept Invite")
				.click({ timeout: 10000 });
			await (new Promise((res) =>
				setTimeout(async () => {
					await page.keyboard.press("Escape");
					res();
				}, 1000),
			) as Promise<void>);
		} catch {}
		// }

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
			const sidebar = document.querySelector(
				'[class^="sidebar"]',
			) as HTMLElement;
			if (!sidebar) return;
			sidebar.style.display = "none";
		});

		console.log("hid sidebar");

		if (streamer) {
			const handleStreamClose = () => {
				const closeStreamButton = page
					.getByRole("button", { name: "Close Stream" })
					.first();
				console.log("handling stream");
				closeStreamButton.waitFor().then(async () => {
					console.log("stream closed");
					await closeStreamButton.click();
					console.log("close stream button clicked");
					await watchStream();
					console.log("watching for stream");
				});
			};

			const watchStream: (
				timeout?: number,
				recursive?: boolean,
			) => Promise<void> = async (timeout = 60000, recursive = true) => {
				try {
					await page
						.getByRole("button", { name: `Call tile, stream, ${streamer}` })
						.locator("..")
						.click({ timeout });
					handleStreamClose();
					message(`Connected to ${streamer}'s stream`);
				} catch (e) {
					if (!(e instanceof Error)) return;
					if (e.name === "TimeoutError") {
						await message(
							`Stream doesn't exist, waiting for ${streamer} to stream`,
						);
						if (recursive) await watchStream();
					} else {
						console.log(e);
					}
				}
			};

			message(`Attempting to connect to ${streamer}'s stream`);
			await watchStream(5000);
		}

		fs.mkdirSync("./videos", { recursive: true });
		const writeStream = fs.createWriteStream(
			`./videos/${`${fileName ?? `${inviteLink.split("/").at(-1)}-${Date.now()}`}`}.webm`,
			{ flags: "a" },
		);

		await page.exposeFunction("write", (bufferData: number[]) => {
			writeStream.write(Buffer.from(bufferData));
		});
		await page.exposeFunction("end", writeStream.end.bind(writeStream));

		await page.evaluate(async () => {
			navigator.mediaDevices
				.getDisplayMedia({
					video: true,
					audio: {
						// @ts-expect-error
						chromeMediaSource: "tab",
					},
					preferCurrentTab: true,
				})
				.then((mediaStream) => {
					const recorderWindow = window as unknown as Window & {
						_recorder: MediaRecorder;
						write: (data: number[]) => boolean;
						end: () => void;
					};
					recorderWindow._recorder = new MediaRecorder(mediaStream, {
						mimeType: "video/webm;codecs=vp9,opus",
					});

					recorderWindow._recorder.ondataavailable = async (blobChunk) => {
						const buffer = await blobChunk.data.arrayBuffer();
						recorderWindow.write(Array.from(new Uint8Array(buffer)));
					};
					recorderWindow._recorder.onstop = () => {
						recorderWindow.end();
					};

					recorderWindow._recorder.start(1000);
				});
		});

		message("Started recording");

		contextsInfo.set(inviteLink, {
			context,
			page,
			sendMessages,
		});
	} catch (e) {
		await context.close();
		throw e;
	}

	return;
}

export async function endRecording(inviteLink: string) {
	console.log("stop recording");

	const { context, page, sendMessages } = contextsInfo.get(inviteLink) ?? {};

	if (!context) throw new Error("Recording not found");
	if (!page) throw new Error("Page not found");

	await page.evaluate(() => {
		const recorderWindow = window as unknown as Window & {
			_recorder: MediaRecorder;
			write: (data: number[]) => boolean;
			end: () => void;
		};
		recorderWindow._recorder.stop();
	});

	contextsInfo.delete(inviteLink);

	if (sendMessages) await messageBase(page, "Stopped recording").catch();

	await context.close();

	return;
}

export function displayRecordings() {
	let recordings = contextsInfo.size ? "" : "No recordings in progress";
	contextsInfo.forEach((_, link) => {
		recordings += `${link}\n`;
	});

	return recordings;
}
