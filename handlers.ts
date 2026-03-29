import fs from "node:fs";
import { type BrowserContext, chromium, type Page } from "patchright";
import { type PageVideoCapture, saveVideo } from "playwright-video";
import { startAudioCapture, stopAudioCapture } from "application-loopback";
import "dotenv/config";
import {
	type ChildProcessWithoutNullStreams,
	execSync,
	spawn,
} from "node:child_process";

if (!process.env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN not specified");

const contextsInfo: Map<
	string,
	{
		context: BrowserContext;
		page: Page;
		recording: {
			capture: PageVideoCapture;
			audioCapture: ChildProcessWithoutNullStreams;
			recordingPath: string;
			pid: string;
		};
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

async function calculateSync(
	videoPath: string,
	audioPath: string,
): Promise<string> {
	const audioResult = execSync(
		`ffmpeg -t 10 -i "${audioPath}" -af "bandpass=f=12500:width_type=h:w=5000,astats=metadata=1:reset=1" -f null -`,
		{ stdio: "pipe" },
	).toString();

	const audioMatches = [...audioResult.matchAll(/pkt_pts_time: (\d+\.\d+)/g)];
	const beepTimestamp =
		audioMatches.length > 0 ? parseFloat(audioMatches[0][1]) : 0;

	const videoResult = execSync(
		`ffmpeg -t 10 -i "${videoPath}" -vf "showinfo" -f null - 2>&1`,
		{ stdio: "pipe" },
	).toString();
	const videoMatches = [...videoResult.matchAll(/pkt_pts_time: (\d+\.\d+)/g)];
	const flashTimestamp =
		videoMatches.length > 0 ? parseFloat(videoMatches[0][1]) : 0;

	return (beepTimestamp - flashTimestamp).toFixed(3).toString();
}

export async function startRecording(
	inviteLink: string,
	channelType: "voice" | "stage",
	sendMessages?: boolean,
	streamer?: string,
	fileName?: string,
) {
	const browserServer = await chromium.launchServer({
		headless: false,
		ignoreDefaultArgs: ["--mute-audio"],
	});

	const pid = browserServer.process().pid?.toString();

	if (!pid) throw new Error("Process ID could not be found");

	const browser = await chromium.connect(browserServer.wsEndpoint());

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

		// console.log("setting audio output");

		// await page.getByRole("button", {name: "User Settings"}).click();
		// await page.locator('[data-nav-anchor-key="voice_speakers_output_select"]').getByRole("button").click();
		// await page.getByRole("option", {name: `Voicemeeter In ${contextsInfo.size + 1}`}).click();
		// await page.getByRole("button", {name: "close"}).click();

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
				try {
					const closeStreamButton = page
						.getByRole("button", { name: "Close Stream" })
						.first();
					console.log("handling stream");
					closeStreamButton.waitFor().then(async () => {
						try {
							console.log("stream closed");
							message("Stream closed, attempting to reconnect");
							await closeStreamButton.click();
							console.log("close stream button clicked");
							await watchStream();
							console.log("watching for stream");
						} catch {}
					});
				} catch {}
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
					}
				}
			};

			message(`Attempting to connect to ${streamer}'s stream`);
			await watchStream(5000);
		}

		const recordingFilePath = `./raw/${fileName ?? `${inviteLink.split("/").at(-1)}-${Date.now()}`}`;

		fs.mkdirSync("./raw", { recursive: true });
		fs.mkdirSync("./recordings", { recursive: true });

		const capture = await saveVideo(
			// @ts-expect-error
			page,
			`${recordingFilePath}.mp4`,
		);

		const audioCapture = spawn("ffmpeg", [
			"-y",
			"-use_wallclock_as_timestamps", "1",
			"-f", "s16le", 
			"-ar", "48000", 
			"-ac", "2",
			"-i", "pipe:0",
			"-af", "aresample=async=1:min_hard_comp=0.100000,asetpts=PTS-STARTPTS",
			"-c:a", "aac",
			"-q:a", "2",
			`${recordingFilePath}.m4a`,
		]);

		let chunkReceived: null | (() => void);
		const audioStarted = new Promise<void>(res => chunkReceived = res); 

		startAudioCapture(pid, {
			onData: (chunk) => {
				try {
					audioCapture.stdin.write(chunk);
					if(chunkReceived) {
						chunkReceived();
						chunkReceived = null;
					}
				} catch {}
			},
		});

		await audioStarted;

		// stuff to sync video nd audio
		await page.evaluate(async () => {
			await new Promise<void>((res) => {
				const audioContext = new window.AudioContext();
				const oscillator = audioContext.createOscillator();
				const gain = audioContext.createGain();
				gain.gain.value = 0.4;

				oscillator.connect(gain);
				gain.connect(audioContext.destination);

				const now = audioContext.currentTime;
				oscillator.frequency.setValueAtTime(10000, now);
				oscillator.frequency.linearRampToValueAtTime(10000, now + 0.5);

				const flash = document.createElement("div");
				flash.style.cssText =
					"position:fixed;inset:0;background:white;z-index:999999;";
				document.body.appendChild(flash);

				oscillator.start(now);
				oscillator.stop(now + 0.5);

				setTimeout(() => {
					flash.remove();
					res();
				}, 500);
			});
		});

		message("Started recording");

		contextsInfo.set(inviteLink, {
			context,
			page,
			recording: {
				capture,
				audioCapture,
				recordingPath: recordingFilePath,
				pid,
			},
			sendMessages,
		});
	} catch (e) {
		await browserServer.close();
		throw e;
	}

	return;
}

export async function endRecording(inviteLink: string) {
	console.log("stop recording");

	const { context, page, recording, sendMessages } =
		contextsInfo.get(inviteLink) ?? {};

	if (!context || !recording) throw new Error("Recording not found");
	if (!page) throw new Error("Page not found");

	await recording.capture.stop();
	stopAudioCapture(recording.pid);
	recording.audioCapture.stdin.end();

	await new Promise((res) => recording.audioCapture.on("close", res));

	console.log(
		await calculateSync(
			`${recording.recordingPath}.mp4`,
			`${recording.recordingPath}.m4a`,
		),
	);

	const mergeFiles = spawn("ffmpeg", [
		"-y",
		"-i",
		`${recording.recordingPath}.mp4`,
		"-itsoffset",
		await calculateSync(
			`${recording.recordingPath}.mp4`,
			`${recording.recordingPath}.m4a`,
		),
		"-i",
		`${recording.recordingPath}.m4a`,
		"-c:v",
		"copy",
		"-c:a",
		"copy",
		"-map",
		"0:v:0",
		"-map",
		"1:a:0",
		`./recordings/${recording.recordingPath.split("/").at(-1)}.mp4`,
	]);

	await new Promise((res) => mergeFiles.on("close", res));

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

await startRecording("https://discord.gg/TJYUAuTR", "voice", true, "iqat");
new Promise((r) => setTimeout(r, 10000)).then(() =>
	endRecording("https://discord.gg/TJYUAuTR"),
);
