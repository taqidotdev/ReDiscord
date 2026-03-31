import fs from "node:fs";
import {
	type BrowserContext,
	chromium,
	type Locator,
	type Page,
} from "patchright";
import { type PageVideoCapture, saveVideo } from "playwright-video";
import { startAudioCapture, stopAudioCapture } from "application-loopback";
import "dotenv/config";
import {
	type ChildProcessWithoutNullStreams,
	spawn,
	spawnSync,
} from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.DISCORD_TOKEN || !process.env.FPS || !process.env.PORT)
	throw new Error("env variables not specified");

const contextsInfo: Map<
	string,
	{
		context?: BrowserContext;
		page?: Page;
		recording?: {
			capture: PageVideoCapture;
			audioCapture: ChildProcessWithoutNullStreams;
			recordingPath: string;
			pid: string;
		};
		sendMessages?: boolean;
		breakStartRecording: () => void;
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

async function calculateOffset(
	videoPath: string,
	audioPath: string,
): Promise<{ offset: string; beepTimestamp: number; flashTimestamp: number }> {
	const audioResult = spawnSync(
		"ffmpeg",
		[
			"-i",
			audioPath,
			"-t",
			"2",
			"-af",
			[
				"bandpass=f=12500:width_type=h:w=5000",
				"astats=metadata=1:reset=1",
				"ametadata=print:file=-",
			].join(","),
			"-f",
			"null",
			"-",
		],
		{ encoding: "utf8", windowsHide: true },
	);

	const audioResultLines = audioResult.stdout.split("\n");

	let currentTime = 0;
	let beepTimestamp = 0;

	for (const line of audioResultLines) {
		if (line.includes("pts_time:")) {
			currentTime = parseFloat(line.split("pts_time:")[1].trim());
		}
		if (line.includes("lavfi.astats.Overall.Peak_level=")) {
			const rms = parseFloat(line.split("=")[1]);
			if (rms > -40 && beepTimestamp === 0) {
				beepTimestamp = currentTime;
				break;
			}
		}
	}

	const videoResult = spawnSync(
		"ffmpeg",
		[
			"-i",
			videoPath,
			"-t",
			"2",
			"-vf",
			"negate,blackframe=amount=98:threshold=32",
			"-an",
			"-f",
			"null",
			"-",
		],
		{ encoding: "utf8", windowsHide: true },
	);

	const videoMatch = videoResult.stderr.match(/t:(\d+\.\d+)/);
	const flashTimestamp = videoMatch ? parseFloat(videoMatch[1]) : 0;

	console.log(flashTimestamp);
	console.log(beepTimestamp);

	return {
		offset: (flashTimestamp - beepTimestamp).toFixed(6).toString(),
		beepTimestamp,
		flashTimestamp,
	};
}

async function calculateRatio(
	videoPath: string,
	audioPath: string,
	beepTimestamp: number,
	flashTimestamp: number,
) {
	const videoLength =
		parseFloat(
			spawnSync(
				"ffprobe",
				[
					"-v",
					"error",
					"-show_entries",
					"format=duration",
					"-of",
					"default=noprint_wrappers=1:nokey=1",
					videoPath,
				],
				{ windowsHide: true },
			).stdout.toString(),
		) - flashTimestamp;

	const audioLength =
		parseFloat(
			spawnSync(
				"ffprobe",
				[
					"-v",
					"error",
					"-show_entries",
					"format=duration",
					"-of",
					"default=noprint_wrappers=1:nokey=1",
					audioPath,
				],
				{ windowsHide: true },
			).stdout.toString(),
		) - beepTimestamp;

	console.log((audioLength / videoLength).toFixed(6));

	return (audioLength / videoLength).toFixed(6);
}

export async function mergeFiles(
	videoPath: string,
	audioPath: string,
	outputPath?: string,
): Promise<string> {
	const { offset, beepTimestamp, flashTimestamp } = await calculateOffset(
		videoPath,
		audioPath,
	);

	const filePath =
		outputPath ??
		`./recordings/${videoPath.split("/").at(-1) ?? videoPath.split("/").at(-2)}`;

	console.log(beepTimestamp);
	console.log(flashTimestamp);

	spawnSync(
		"ffmpeg",
		[
			"-y",
			"-i",
			videoPath,
			"-itsoffset",
			offset,
			"-i",
			audioPath,
			"-ss",
			"5",
			"-filter:v",
			`setpts=${await calculateRatio(videoPath, audioPath, beepTimestamp, flashTimestamp)}*PTS`,
			"-c:v",
			"libx264",
			"-c:a",
			"copy",
			"-map",
			"0:v:0",
			"-map",
			"1:a:0",
			filePath,
		],
		{ windowsHide: true },
	);

	console.log("merged");
	return filePath;
}

export async function startRecording(
	inviteLink: string,
	channelType: "voice" | "stage",
	sendMessages?: boolean,
	streamer?: string,
	fileName?: string,
) {
	console.log([inviteLink, channelType, sendMessages, streamer, fileName]);
	const browserServer = await chromium.launchServer({
		ignoreDefaultArgs: ["--mute-audio"],
		headless: false,
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
		new Promise<void>((res) =>
			contextsInfo.set(inviteLink, { breakStartRecording: res }),
		).then(() => {
			throw new Error("Recording manually interrupted");
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
			const iframe = document.createElement("iframe");
			document.body.appendChild(iframe);

			if (!iframe.contentWindow?.localStorage) return null;

			iframe.contentWindow.localStorage.token = `"${token}"`;

			document.body.removeChild(iframe);

			setTimeout(() => {
				location.reload();
			}, 2500);
		}, process.env.DISCORD_TOKEN);

		try {
			await page
				.getByRole("button")
				.getByText("Accept Invite")
				.click({ timeout: 15000 });
		} catch {}

		const continueInBrowser = page.getByRole("button", {
			name: "Continue in Browser",
		});

		const clickContinuously = async (locator: Locator) => {
			try {
				await locator.waitFor({ timeout: 30000 });
				await locator.click();
				clickContinuously(locator);
			} catch {}
		};

		clickContinuously(continueInBrowser);

		const acceptAs = page.getByRole("button", { name: "Accept as " });
		acceptAs
			.waitFor()
			.then(() => acceptAs.click())
			.catch(() => {});

		if (channelType === "stage")
			try {
				await page
					.getByRole("button")
					.getByText("Got it!")
					.click({ timeout: 10000 });
			} catch {}

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
				closeStreamButton
					.waitFor({ timeout: 0 })
					.then(async () => {
						try {
							console.log("stream closed");
							message("Stream closed, attempting to reconnect");
							await closeStreamButton.click();
							console.log("close stream button clicked");
							await watchStream();
							console.log("watching for stream");
						} catch {}
					})
					.catch((e) => console.log("lalala" + e));
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

		const recordingFilePath = `./raw/${fileName ?? `${inviteLink.split("/").at(-1) ?? inviteLink.split("/").at(-2)}-${Date.now()}`}`;

		console.log(recordingFilePath);

		fs.mkdirSync("./raw", { recursive: true });
		fs.mkdirSync("./recordings", { recursive: true });

		const capture = await saveVideo(
			// @ts-expect-error
			page,
			`${recordingFilePath}.mp4`,
			{
				fps: process.env.FPS,
			},
		);

		console.log("video started");

		const audioCapture = spawn(
			"ffmpeg",
			[
				"-y",
				"-use_wallclock_as_timestamps",
				"1",
				"-f",
				"s16le",
				"-ar",
				"48000",
				"-ac",
				"2",
				"-i",
				"pipe:0",
				"-af",
				"aresample=async=1:min_hard_comp=0.100000,asetpts=PTS-STARTPTS",
				"-c:a",
				"aac",
				"-q:a",
				"2",
				`${recordingFilePath}.m4a`,
			],
			{ windowsHide: true },
		);

		let chunkReceived: null | (() => void);
		const audioStarted = new Promise<void>((res) => (chunkReceived = res));

		startAudioCapture(pid, {
			onData: (chunk) => {
				try {
					audioCapture.stdin.write(chunk);
					if (chunkReceived) {
						chunkReceived();
						chunkReceived = null;
					}
				} catch {}
			},
		});

		await page.evaluate(() => {
			const audioContext = new window.AudioContext();
			const oscillator = audioContext.createOscillator();
			const gain = audioContext.createGain();
			gain.gain.value = 0.2;

			oscillator.connect(gain);
			gain.connect(audioContext.destination);

			const now = audioContext.currentTime;
			oscillator.frequency.setValueAtTime(440, now);

			oscillator.start(now);
			oscillator.stop(now + 0.5);
		});

		await audioStarted;
		await page.waitForTimeout(1500);

		console.log("audio started");

		// stuff to sync video nd audio
		await page.evaluate(async () => {
			await new Promise<void>((res) => {
				const audioContext = new window.AudioContext();
				const oscillator = audioContext.createOscillator();
				const gain = audioContext.createGain();
				gain.gain.value = 0.2;

				oscillator.connect(gain);
				gain.connect(audioContext.destination);

				const now = audioContext.currentTime;
				oscillator.frequency.setValueAtTime(10000, now);

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
			breakStartRecording: () => {
				return "recording already started";
			},
		});
	} catch (e) {
		await browserServer.close();
		console.log(e);
		throw e;
	}

	return;
}

export async function endRecording(inviteLink: string) {
	console.log("stop recording");

	const { context, page, recording, sendMessages } =
		contextsInfo.get(inviteLink) ??
		contextsInfo.get(
			inviteLink.split("/").at(-1)
				? `${inviteLink}/`
				: inviteLink.slice(0, inviteLink.lastIndexOf("/")),
		) ??
		{};

	if (!context || !recording) throw new Error("Recording not found");
	if (!page) throw new Error("Page not found");

	await recording.capture.stop();
	stopAudioCapture(recording.pid);
	recording.audioCapture.stdin.end();

	await new Promise((res) => recording.audioCapture.on("close", res));

	console.log("merging");

	mergeFiles(
		`${recording.recordingPath}.mp4`,
		`${recording.recordingPath}.m4a`,
	);

	contextsInfo.delete(inviteLink);
	if (sendMessages) await messageBase(page, "Stopped recording").catch();

	await context.close();

	return;
}

export function interruptRecording(inviteLink: string) {
	const context =
		contextsInfo.get(inviteLink) ??
		contextsInfo.get(
			inviteLink.split("/").at(-1)
				? `${inviteLink}/`
				: inviteLink.slice(0, inviteLink.lastIndexOf("/")),
		);
	if (context) context.breakStartRecording();
}

export function displayRecordings() {
	let recordings = contextsInfo.size ? "" : "No recordings in progress";
	contextsInfo.forEach((_, link) => {
		recordings += `${link}\n`;
	});

	return recordings;
}

export async function test() {
	const browser = await chromium.launch({
		args: [
			"--autoplay-policy=no-user-gesture-required",
			"--allow-file-access-from-files",
		],
		ignoreDefaultArgs: ["--mute-audio"],
	});

	const page = await (
		await browser.newContext({
			viewport: {
				width: 1920,
				height: 1080,
			},
			reducedMotion: "reduce",
		})
	).newPage();

	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const audioPath = path.resolve(__dirname, "audio_test.mp3");

	await page.goto(`file://${audioPath}`);

	await page
		.evaluate(() => {
			const audio = document.querySelector("audio");
			if (!audio) throw new Error("audio_test.mp3 not found");
			audio.play();
		})
		.catch(() => {});

	await new Promise<void>((res) => setTimeout(res, 214000));

	await browser.close();

	return;
}

// await startRecording("https://discord.gg/TJYUAuTR", "voice", true);
// await new Promise<void>((res) => setTimeout(res, 10 * 1000));
// await endRecording("https://discord.gg/TJYUAuTR");