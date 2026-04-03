import fs, { existsSync } from "node:fs";
import {
	type BrowserServer,
	chromium,
	type Locator,
	type Page,
} from "patchright";
import { type PageVideoCapture, saveVideo } from "playwright-video";
import { startAudioCapture, stopAudioCapture } from "application-loopback";
import "dotenv/config";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { path as ffprobePath } from "@ffprobe-installer/ffprobe";

if (!process.env.DISCORD_TOKEN || !process.env.FPS || !process.env.PORT)
	throw new Error("env variables not specified");

const contextsInfo: Map<
	string,
	{
		browserServer?: BrowserServer;
		page?: Page;
		recording?: {
			capture: PageVideoCapture;
			audioCapture: fs.WriteStream;
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

async function calculateOffset(
	videoPath: string,
	audioPath: string,
): Promise<{ offset: string; beepTimestamp: number; flashTimestamp: number }> {
	const audioResult = spawnSync(
		ffmpegPath,
		[
			"-i",
			audioPath,
			"-t",
			"10",
			"-af",
			[
				"highpass=f=10000",
				"bandpass=f=12500:width_type=h:w=1000",
				"astats=metadata=1:reset=1",
				"silencedetect=noise=-10dB:d=0.25",
			].join(","),
			"-f",
			"null",
			"-",
		],
		{ encoding: "utf8" },
	);

	const audioMatch = audioResult.stderr.match(/silence_end:\s*([\d.]+)/);
	const beepTimestamp = audioMatch ? parseFloat(audioMatch[1]) : 0;

	const videoResult = spawnSync(
		ffmpegPath,
		[
			"-i",
			videoPath,
			"-t",
			"10",
			"-vf",
			"negate,blackframe=amount=98:threshold=32",
			"-an",
			"-f",
			"null",
			"-",
		],
		{ encoding: "utf8" },
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

export async function mergeFiles(
	videoPath: string,
	audioPath: string,
	encodingPreset: string = "ultrafast",
	outputPath?: string,
): Promise<string> {
	if (!existsSync(videoPath) || !existsSync(audioPath)) {
		throw new Error("raw video/audio files not found");
	}

	console.log(videoPath);
	console.log(audioPath);

	const audioLength = parseFloat(
		spawnSync(ffprobePath, [
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"default=noprint_wrappers=1:nokey=1",
			audioPath,
		]).stdout.toString(),
	);

	if (!audioLength || Number.isNaN(audioLength) || audioLength <= 0) {
		console.log("fixing .m4a");
		const tempAudioPath = `${audioPath}.fixed.m4a`;
		spawnSync(ffmpegPath, [
			"-y",
			"-i",
			audioPath,
			"-c:a",
			"copy",
			"-movflags",
			"+faststart",
			tempAudioPath,
		]);
		fs.renameSync(tempAudioPath, audioPath);
	}

	const getVideoLength = () => {
		return parseFloat(
			spawnSync(ffprobePath, [
				"-v",
				"error",
				"-show_packets",
				"-select_streams",
				"v:0",
				"-show_entries",
				"packet=pts_time",
				"-of",
				"csv=p=0",
				videoPath,
			])
				.stdout.toString()
				.split("\n")
				.at(-2) ?? "0",
		);
	};

	let videoLength = 0;

	for (let i = 0; i < 50; i++) {
		videoLength = getVideoLength();
		console.log(videoLength);
		if (!videoLength || Number.isNaN(videoLength) || videoLength <= 0) {
			await new Promise<void>((res) => setTimeout(res, 2000));
			continue;
		}
		break;
	}

	if (videoLength <= 0) {
		throw new Error("Could not get video length (check for corruption)");
	}

	console.log(`${videoLength}, ${audioLength}`);

	const { offset, beepTimestamp, flashTimestamp } = await calculateOffset(
		videoPath,
		audioPath,
	);

	const filePath =
		outputPath ??
		`./recordings/${(videoPath.split("/").filter(Boolean).at(-1))?.replace("mkv", "mp4")}`;

	console.log(filePath);

	console.log(beepTimestamp);
	console.log(flashTimestamp);

	console.log(`${videoLength}, ${audioLength}`);

	const ratio = (
		(audioLength - beepTimestamp) /
		(videoLength - flashTimestamp)
	).toFixed(6);

	console.log(ratio);

	spawnSync(
		ffmpegPath,
		[
			"-y",
			"-i",
			videoPath,
			"-itsoffset",
			offset,
			"-i",
			audioPath,
			// "-ss",
			// "5",
			"-filter:v",
			`setpts=${ratio}*PTS`,
			"-c:v",
			"libx264",
			"-preset",
			`${encodingPreset}`,
			"-c:a",
			"copy",
			"-map",
			"0:v:0",
			"-map",
			"1:a:0",
			filePath,
		],
		{ stdio: "inherit" },
	);

	console.log("merged");
	return filePath;
}

export async function startRecording(
	inviteLink: string,
	debug: boolean = false,
	deleteEntireSidebar: boolean = false,
	sendMessages?: boolean,
	streamer?: string,
	fileName?: string,
) {
	const log = (text: string) => console.log(`${inviteLink}: ${text}`);

	log([inviteLink, sendMessages, !debug, streamer, fileName].toString());

	if (
		!inviteLink.match(
			/https?:\/\/(?:discord\.gg|discord(?:app)?\.com\/invite)\/[^\s/]+\/?/,
		)
	) {
		throw new Error("Invalid invite link");
	}

	const browserServer = await chromium.launchServer({
		ignoreDefaultArgs: ["--mute-audio"],
		headless: !debug,
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
			throw new Error("Could not load page");
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

		try {
			await page
				.getByRole("button")
				.getByText("Got it")
				.click({ timeout: 10000 });
		} catch {}

		log("trying to show chat");

		await page.getByRole("button", { name: "Show Chat" }).click();

		log("showed chat, hiding sidebar");

		await (deleteEntireSidebar
			? page.locator('[class^="sidebar"]')
			: page.getByLabel("Servers sidebar")
		).evaluate((node) => node.remove());

		log("hid sidebar");

		if (streamer) {
			const handleStreamClose = () => {
				const closeStreamButton = page
					.getByRole("button", { name: "Close Stream" })
					.first();
				log("handling stream");
				closeStreamButton
					.waitFor({ timeout: 0 })
					.then(async () => {
						try {
							log("stream closed");
							message("Stream closed, attempting to reconnect");
							await closeStreamButton.click();
							log("close stream button clicked");
							await watchStream();
							log("watching for stream");
						} catch {}
					})
					.catch((e) => console.error(e));
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

		log(recordingFilePath);

		fs.mkdirSync("./raw", { recursive: true });
		fs.mkdirSync("./recordings", { recursive: true });

		const capture = await saveVideo(
			// @ts-expect-error
			page,
			`${recordingFilePath}.mkv`,
			{
				fps: process.env.FPS,
			},
		);

		log("video started");

		const audioCapture = spawn(
			ffmpegPath,
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
				"-g",
				"585",
				"-movflags",
				"frag_keyframe+empty_moov+default_base_moof",
				"-frag_duration",
				"5000000",
				"-f",
				"mp4",
				"pipe:1",
			],
			{ stdio: ["pipe", "pipe", "inherit"] },
		);

		const fileStream = fs.createWriteStream(`${recordingFilePath}.m4a`);
		audioCapture.stdout.pipe(fileStream);

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
			gain.gain.value = 0.05;

			oscillator.connect(gain);
			gain.connect(audioContext.destination);

			const now = audioContext.currentTime;
			oscillator.frequency.setValueAtTime(440, now);

			oscillator.start(now);
			oscillator.stop(now + 0.5);
		});

		await audioStarted;
		await page.waitForTimeout(1500);

		log("audio started");

		// stuff to sync video nd audio
		await page.evaluate(async () => {
			await new Promise<void>((res) => {
				const audioContext = new window.AudioContext();
				const oscillator = audioContext.createOscillator();
				const gain = audioContext.createGain();
				gain.gain.value = 1;

				oscillator.connect(gain);
				gain.connect(audioContext.destination);

				const now = audioContext.currentTime;
				oscillator.frequency.setValueAtTime(12500, now);

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
			browserServer,
			page,
			recording: {
				capture,
				audioCapture: fileStream,
				recordingPath: recordingFilePath,
				pid,
			},
			sendMessages,
		});
	} catch (e) {
		await browserServer.close();
		contextsInfo.delete(inviteLink);
		console.error(e);
		throw e;
	}

	return;
}

export async function stopRecording(inviteLink: string) {
	console.log("\n\nstop recording !!!!\n\n");

	const { browserServer, page, recording, sendMessages } =
		contextsInfo.get(inviteLink) ??
		contextsInfo.get(
			inviteLink.split("/").at(-1)
				? `${inviteLink}/`
				: inviteLink.slice(0, inviteLink.lastIndexOf("/")),
		) ??
		{};

	if (!browserServer || !recording) throw new Error("Recording not found");
	if (!page) throw new Error("Page not found");

	recording.audioCapture.end();
	stopAudioCapture(recording.pid);
	await browserServer.close();

	if (sendMessages) await messageBase(page, "Stopping recording").catch();

	console.log("merging");

	mergeFiles(
		`${recording.recordingPath}.mkv`,
		`${recording.recordingPath}.m4a`,
	);

	return;
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

// await startRecording("https://discord.gg/TJYUAuTR", true);
// await new Promise<void>((res) => setTimeout(res, 10 * 1000));
// await stopRecording("https://discord.gg/TJYUAuTR");