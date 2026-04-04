#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs, { readFileSync } from "node:fs";
import "dotenv/config";
import { Command } from "commander";
import { mergeFiles, test } from "./handlers.ts";

const program = new Command();

program
	.name("rediscord")
	.description("record discord voice and stage channels !!")
	.version("1.0"); // ill cry if i have to make more versions of this

program
	.command("init <token>")
	.description("intialize .env variables")
	.option(
		"-f, --fps <fps>",
		"set the fps of recordings (higher wont help choppiness, only use for lower framerate)",
		"30",
	)
	.option(
		"-p, --port <port>",
		"set the port for the local server to use",
		"6767",
	)
	.action((token, options) => {
		fs.writeFile(
			".env",
			`DISCORD_TOKEN=${token}\nFPS=${options.fps}\nPORT=${options.port}\n`,
			() => {},
		);
		console.log("Created the following .env file:");
		console.log(`   DISCORD_TOKEN=${token}`);
		console.log(`   FPS=${options.fps}`);
		console.log(`   PORT=${options.port}`);
	});

program
	.command("start-server")
	.description("starts the local server")
	.action(async () => {
		if (!process.env.DISCORD_TOKEN || !process.env.FPS || !process.env.PORT) {
			console.error(".env not initialized, run init");
			return;
		}

		if (fs.existsSync(".pid")) {
			try {
				await fetch(`http://localhost:${process.env.PORT}`);
				console.error(`server already running on port ${process.env.PORT}`);
				return;
			} catch {}
		}

		spawn("npx", ["ts-node", "app.ts"], {
			stdio: "inherit",
			detached: true,
			shell: process.platform === "win32",
		}).unref();

		let i = 0;

		for (; i < 30; i++) {
			try {
				await fetch(`http://localhost:${process.env.PORT}`);
				break;
			} catch {}
			await new Promise((res) => setTimeout(res, 500));
		}

		if (i === 30) {
			console.error("server failed to start");
		} else {
			const pid = readFileSync(".pid", "utf-8");
			console.log(`server started at port ${process.env.PORT} (PID: ${pid})`);
		}

		return;
	});

program
	.command("stop-server")
	.description("stops the local server")
	.action(() => {
		if (!fs.existsSync(".pid")) {
			console.error("server is not currently running");
			return;
		}

		const pid = parseInt(fs.readFileSync(".pid", "utf-8"), 10);

		try {
			process.kill(pid);
		} catch (e) {
			console.error(
				e.message === "kill ESRCH"
					? "server is not currently running"
					: `error occurred: ${e.message};`,
			);
			return;
		}
		fs.unlinkSync(".pid");

		console.log(`server at port ${process.env.PORT} stopped (PID: ${pid})`);
	});

program
	.command("test")
	.description(
		"launches headless chrome for a while so that you can make sure it doesn't make any noise",
	)
	.option(
		"-d, --debug",
		"enables debug mode (opens headed chrome instead of headless)",
		false,
	)
	.action(async (options) => {
		console.log(
			"launching chrome, if no audio plays ensure audio_test.mp3 exists",
		);

		await test(options.debug);

		console.log("closed chrome");
	});

program
	.command("start-recording <channelInviteLink>")
	.description(
		`start recording a voice/stage channel (channelInviteLink: "https://discord.gg/{code thingy})`,
	)
	.option(
		"-m, --send-messages",
		"whether or not to send messages in the channel's chat (this'll prolly get your account banned)",
		false,
	)
	.option(
		"-s, --streamer <streamer>",
		"person to watch the stream of, leave blank to not watch a stream",
	)
	.option(
		"-f, --file-name <fileName>",
		"name of the recording's file (no extension, myVideo NOT myVideo.mp4), leave blank to be assigned automatically",
	)
	.option(
		"-d, --debug",
		"enables debug mode (opens headed chrome instead of headless, press cancel if it asks to open discord app)",
		false,
	)
	.option(
		"--delete-sidebar",
		"deletes the entire sidebar instead of just the guilds tab",
		false,
	)
	.action(
		async (
			channelInviteLink,
			{ debug, deleteSidebar, sendMessages, streamer, fileName },
		) => {
			const data = JSON.stringify({
				channelInviteLink,
				debug,
				deleteSidebar,
				sendMessages,
				streamer,
				fileName,
			});

			console.log(debug);
			console.log(sendMessages);

			try {
				const res = await (
					await fetch(`http://localhost:${process.env.PORT}`, {
						method: "POST",
						body: data,
						headers: { "Content-Type": "application/json" },
					})
				).text();

				console.log(res);
			} catch (e) {
				if (e.message === "fetch failed")
					console.error("server is not up, run start-server first");
				else console.error(`error occurred: ${e.message}`);
				return;
			}
		},
	);

program
	.command("stop-recording <channelInviteLink>")
	.description("stops the specified recording")
	.action(async (channelInviteLink) => {
		let recordings;
		try {
			recordings = await (
				await fetch(`http://localhost:${process.env.PORT}`, {
					signal: AbortSignal.timeout(3000),
				})
			).text();
		} catch {
			console.error("start the server via start-server first");
			return;
		}

		if (recordings === "No recordings in progress") {
			console.error("no ongoing recordings");
			return;
		}

		console.log(recordings);

		if (!channelInviteLink || !recordings?.includes(channelInviteLink)) {
			console.error(
				`ensure you entered the correct invite link used, list: ${recordings}`,
			);
			return;
		}

		const data = JSON.stringify({
			channelInviteLink,
		});

		const res = await (
			await fetch(`http://localhost:${process.env.PORT}`, {
				method: "DELETE",
				body: data,
				headers: { "Content-Type": "application/json" },
			})
		).text();
		console.log(res);
	});

program
	.command("display")
	.description("displays ongoing recordings")
	.action(async () => {
		try {
			const res = await fetch(`http://localhost:${process.env.PORT}`, {
				AbortSignal: AbortSignal.timeout(3000),
			});
			console.log(await res.text());
		} catch (e) {
			console.error(
				`error: ${e.message}\nensure you started the server via start-server first`,
			);
			return;
		}
	});

program
	.command("merge <filePath>")
	.option(
		"-o, --output <outputFile>",
		"output file path (eg. myVideos/recording.mp4 ONLY MP4)",
	)
	.option(
		"-p --preset <preset>",
		"encoding preset for ffmpeg (faster -> larger file size)",
	)
	.description(
		"merges and synchronizes raw video + audio files if stopped abruptly (ensure audio and video end at the same absolute time)\ndo not include file extension in filePath (eg. raw/video instead of raw/video.mp4)",
	)
	.action(async (filePath, options) => {
		const presetOptions = [
			"ultrafast",
			"superfast",
			"veryfast",
			"faster",
			"fast",
			"medium",
			"slow",
			"slower",
			"veryslow",
		];
		if (options.preset && !presetOptions.includes(options.preset)) {
			console.error(`preset can only be: ${presetOptions.join(", ")}`);
			return;
		}
		try {
			console.log(
				`merged files into ${await mergeFiles(`${filePath}.mp4`, `${filePath}.m4a`, options.preset, options.output)}`,
			);
		} catch (e) {
			console.error(
				`error: ${e.message}\nensure the specified filePath is correct, ffmpeg is installed properly, and the files have been recovered (are not corrupted)`,
			);
			return;
		}
	});

program.parse();
