#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs, { readFileSync } from "node:fs";
import { request } from "node:http";
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
	.option("-f, --fps <fps>", "set the fps of recordings", "30")
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

		spawn("node", ["app.ts"], {
			stdio: "inherit",
			detached: true,
		}).unref();

		let pid;
		await new Promise((res) => setTimeout(res, 1500));
		try {
			pid = readFileSync(".pid", "utf-8");
		} catch {
			await new Promise((res) => setTimeout(res, 3500));
			try {
				pid = readFileSync(".pid", "utf-8");
			} catch {
				console.error("server failed to start (could not find pid)");
			}
		}

		console.log(`server started at port ${process.env.PORT} (PID: ${pid})`);

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
		"launches headless chrome for 60 seconds so that you can make sure it doesn't make any noise",
	)
	.action(async () => {
		console.log(
			"launching chrome, if no audio plays ensure audio_test.mp3 exists",
		);

		await test();

		console.log("closed chrome");
	});

program
	.command("start-recording <channelType> <channelInviteLink>")
	.description(
		`start recording a voice/stage channel (channelType: "voice" or "stage", channelInviteLink: "https://discord.gg/{code thingy})`,
	)
	.option(
		"-m, --send-messages",
		"whether or not to send messages in the channel's chat",
		false,
	)
	.option(
		"-s, --streamer",
		"person to watch the stream of, leave blank to not watch a stream",
	)
	.option(
		"-f, --file-name <fileName>",
		"name of the recording's file, leave blank to be assigned automatically",
	)
	.action(async (channelType, channelInviteLink, options) => {
		const pingResponse = await fetch(`http://localhost:${process.env.PORT}`, {
			signal: AbortSignal.timeout(3000),
		});
		if (!pingResponse.ok) {
			console.error("server is not up, run start-server first");
			return;
		}

		const data = JSON.stringify({
			channelInviteLink,
			channelType,
			sendMessages: options.sendMessages,
			streamer: options.streamer,
			fileName: options.fileName,
		});

		const req = request(
			{
				hostname: "localhost",
				port: process.env.PORT,
				path: "/",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": data.length,
				},
			},
			(res) => {
				let resData = "";

				res.on("data", (chunk) => (resData += chunk));
				res.on("close", () => {
					console.log("asihgfhaohg");
					console.log(resData);
				});
			},
		);

		req.on("error", (e) => console.error(e));

		req.write(data);
		req.end();
	});

program
	.command("stop-recording <channelInviteLink>")
	.action(async (channelInviteLink) => {
		let recordings;
		try {
			recordings = await fetch(`http://localhost:${process.env.PORT}`, {
				signal: AbortSignal.timeout(3000),
			});
		} catch {
			console.error("start the server via start-server first");
			return;
		}

		if (recordings === "No recordings in progress") {
			console.error("no ongoing recordings");
			return;
		}

		if (!channelInviteLink || !recordings.includes(channelInviteLink)) {
			console.error(
				`ensure you entered the correct invite link used, list: ${recordings}`,
			);
			return;
		}

		const data = JSON.stringify({
			channelInviteLink,
			channelType,
			sendMessages: options.sendMessages,
			streamer: options.streamer,
			fileName: options.fileName,
		});

		const req = request(
			{
				hostname: "localhost",
				port: process.env.PORT,
				path: "/",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": data.length,
				},
			},
			(res) => {
				let resData = "";

				res.on("data", (chunk) => (resData += chunk));
				res.on("close", () => {
					console.log(resData);
				});
			},
		);

		req.on("error", (e) => console.error(e));

		req.write(data);
		req.end();
	});

program
	.command("display")
	.description("displays ongoing recordings")
	.action(async () => {
		try {
			const res = await fetch(`http://localhost:${process.env.PORT}`, {
				AbortSignal: AbortSignal.timeout(3000),
			});
			console.log((await res.json()).response);
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
	.description(
		"do not include file extension in filePath (eg. raw/video instead of raw/video.mp4)\nmerges and synchronizes recovered raw video + audio files if stopped abruptly",
	)
	.action(async (filePath, options) => {
		try {
			console.log(
				`merged files into ${await mergeFiles(`${filePath}.mp4`, `${filePath}.m4a`, options.output)}`,
			);
		} catch (e) {
			console.error(
				`error: ${e.message}\nensure the specified filePath is correct, ffmpeg is installed properly, and the files have been recovered (are not corrupted)`,
			);
			return;
		}
	});

program.parse();
